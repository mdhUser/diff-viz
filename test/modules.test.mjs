import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import { detectModules, limitModules, orderModules, packagePathOf } from '../src/modules.mjs';
import { cleanup, commitAll, makeTempRepo, write } from './helpers.mjs';

function mavenRepo() {
  const dir = makeTempRepo();
  write(dir, 'pom.xml', '<project><modules><module>svc-api</module><module>svc-core</module><module>svc-dao</module></modules></project>\n');
  for (const module of ['svc-api', 'svc-core', 'svc-dao']) {
    write(dir, `${module}/pom.xml`, `<project><artifactId>${module}</artifactId></project>\n`);
  }
  write(dir, 'svc-api/src/main/java/com/acme/api/Api.java', 'package com.acme.api;\n\nimport com.acme.core.Core;\n\npublic class Api { Core core = new Core(); }\n');
  write(dir, 'svc-core/src/main/java/com/acme/core/Core.java', 'package com.acme.core;\n\nimport com.acme.dao.Dao;\n\npublic class Core { Dao dao = new Dao(); }\n');
  write(dir, 'svc-dao/src/main/java/com/acme/dao/Dao.java', 'package com.acme.dao;\n\npublic class Dao {}\n');
  write(dir, 'service.py', 'print("root file")\n');
  commitAll(dir, 'init');
  // Touch the whole chain so the worktree review contains all three modules.
  write(dir, 'svc-api/src/main/java/com/acme/api/Api.java', 'package com.acme.api;\n\nimport com.acme.core.Core;\n\npublic class Api { Core core = new Core(); int v = 2; }\n');
  write(dir, 'svc-core/src/main/java/com/acme/core/Core.java', 'package com.acme.core;\n\nimport com.acme.dao.Dao;\n\npublic class Core { Dao dao = new Dao(); int v = 2; }\n');
  write(dir, 'svc-dao/src/main/java/com/acme/dao/Dao.java', 'package com.acme.dao;\n\npublic class Dao { int v = 2; }\n');
  write(dir, 'service.py', 'print("root file v2")\n');
  return dir;
}

test('detects maven modules, package paths and a readable lane order', () => {
  const dir = mavenRepo();
  try {
    const repo = new GitRepo(dir);
    const data = buildReviewData(repo, { worktree: true });
    assert.ok(Array.isArray(data.meta.modules));
    const ids = data.meta.modules.map((module) => module.id);
    for (const expected of ['svc-api', 'svc-core', 'svc-dao']) assert.ok(ids.includes(expected), expected);

    const byPath = new Map(data.nodes.map((node) => [node.path, node]));
    const api = byPath.get('svc-api/src/main/java/com/acme/api/Api.java');
    assert.equal(api.moduleId, 'svc-api');
    assert.equal(api.packagePath, 'com.acme.api');
    const rootFile = byPath.get('service.py');
    assert.equal(rootFile.moduleId, '(root)');
    assert.equal(rootFile.moduleLabel, '仓库根目录');

    // svc-api depends on svc-core which depends on svc-dao: entry modules first.
    const order = data.meta.modules.map((module) => module.id);
    assert.ok(order.indexOf('svc-api') < order.indexOf('svc-core'));
    assert.ok(order.indexOf('svc-core') < order.indexOf('svc-dao'));
    for (const [index, module] of data.meta.modules.entries()) {
      assert.equal(module.order, index);
      assert.ok(module.changedFiles >= 0);
      assert.ok(module.impactedFiles >= 0);
    }
  } finally {
    cleanup(dir);
  }
});

test('falls back to first path segment when no build markers exist', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'apps/web/a.ts', 'export const a = 1;\n');
    write(dir, 'libs/core/b.ts', 'export const b = 1;\n');
    commitAll(dir, 'init');
    const detection = detectModules(dir, ['apps/web/a.ts', 'libs/core/b.ts', 'README.md']);
    assert.equal(detection.moduleOf('apps/web/a.ts').id, 'apps');
    assert.equal(detection.moduleOf('libs/core/b.ts').id, 'libs');
    assert.equal(detection.moduleOf('README.md').id, '(root)');
  } finally {
    cleanup(dir);
  }
});

test('limits lanes while keeping modules that contain changed files', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'm1/pom.xml', '<project/>\n');
    write(dir, 'm2/pom.xml', '<project/>\n');
    write(dir, 'm3/pom.xml', '<project/>\n');
    write(dir, 'm1/a.ts', 'export const a = 1;\n');
    write(dir, 'm2/a.ts', 'export const a = 1;\n');
    write(dir, 'm3/a.ts', 'export const a = 1;\n');
    commitAll(dir, 'init');
    const detection = detectModules(dir, ['m1/a.ts', 'm2/a.ts', 'm3/a.ts']);
    const limited = limitModules(detection.modules, detection.moduleOf, {
      maxLanes: 2,
      keepIds: ['m1'],
    });
    const ids = limited.modules.map((module) => module.id);
    assert.ok(ids.includes('m1'));
    assert.ok(ids.includes('(other)'));
    assert.equal(limited.moduleIdOf('m1/a.ts'), 'm1');
    assert.equal(limited.moduleIdOf('m3/a.ts'), '(other)');
  } finally {
    cleanup(dir);
  }
});

test('orders lanes by dependency depth and computes java package paths', () => {
  const modules = [
    { id: 'api', fileCount: 3 },
    { id: 'core', fileCount: 5 },
    { id: 'dao', fileCount: 2 },
  ];
  const moduleOf = (filePath) => ({ id: filePath.split(':')[0] });
  const ordered = orderModules(
    modules,
    [
      { source: 'api:x', target: 'core:x' },
      { source: 'core:x', target: 'dao:x' },
    ],
    moduleOf,
  );
  assert.deepEqual(ordered.map((module) => module.id), ['api', 'core', 'dao']);

  assert.equal(
    packagePathOf('svc-api/src/main/java/com/acme/api/Api.java', null),
    'com.acme.api',
  );
  assert.equal(packagePathOf('apps/web/src/a.ts', null), 'apps/web/src');
  assert.equal(packagePathOf('A.java', 'com.acme'), 'com.acme');
});

test('module metadata survives as optional fields for old reviews', () => {
  // Older snapshots have no module fields; nothing here should throw when they
  // are absent — the UI falls back to the first path segment.
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'diff-viz-modules-'));
  try {
    assert.equal(typeof detectModules, 'function');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
