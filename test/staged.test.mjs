import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import { cleanup, commitAll, makeTempRepo, run, write } from './helpers.mjs';

test('staged impact analysis uses index imports even after the worktree cache is warmed', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'src/value.ts', 'export const value = 1;\n');
    write(dir, 'src/consumer.ts', "import { value } from './value';\nexport const result = value;\n");
    write(dir, 'src/unrelated.ts', 'export const result = 0;\n');
    commitAll(dir);
    write(dir, 'src/value.ts', 'export const value = 2;\n');
    run(dir, 'git', ['add', 'src/value.ts']);
    write(dir, 'src/consumer.ts', 'export const result = 0;\n');
    write(dir, 'src/unrelated.ts', "import { value } from './value';\nexport const result = value;\n");
    write(dir, 'src/untracked.ts', "import { value } from './value';\n");

    const repo = new GitRepo(dir);
    buildReviewData(repo, { worktree: true });
    const staged = buildReviewData(repo, { staged: true });
    assert.deepEqual(staged.nodes.map((node) => [node.path, node.status]), [
      ['src/value.ts', 'modified'],
      ['src/consumer.ts', 'impacted_only'],
    ]);
    assert.deepEqual(staged.nodes[0].importedBy, ['src/consumer.ts']);
    assert.ok(staged.edges.some((edge) => edge.source === 'src/consumer.ts' && edge.target === 'src/value.ts'));
    assert.deepEqual(staged.nodes[1].impactChain, ['src/value.ts', 'src/consumer.ts']);
  } finally {
    cleanup(dir);
  }
});

test('staged dependency resolution reads staged tsconfig and newly staged files', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'tsconfig.json', '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}\n');
    write(dir, 'src/value.ts', 'export const value = 1;\n');
    commitAll(dir);
    write(dir, 'src/value.ts', 'export const value = 2;\n');
    write(dir, 'src/new.ts', "import { value } from '@/value';\nexport const result = value;\n");
    run(dir, 'git', ['add', '-A']);
    write(dir, 'tsconfig.json', '{"compilerOptions":{"paths":{"@/*":["wrong/*"]}}}\n');
    fs.unlinkSync(path.join(dir, 'src/new.ts'));

    const data = buildReviewData(new GitRepo(dir), { staged: true });
    assert.deepEqual(data.nodes.find((node) => node.path === 'src/new.ts').imports, ['src/value.ts']);
    assert.ok(data.meta.reviewOrder.indexOf('src/value.ts') < data.meta.reviewOrder.indexOf('src/new.ts'));
  } finally {
    cleanup(dir);
  }
});

test('staged workspace imports use index manifests even when package directories are removed', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'package.json', '{"private":true,"workspaces":["packages/*"]}\n');
    write(dir, 'packages/ui/package.json', '{"name":"@demo/ui","source":"src/button.ts"}\n');
    write(dir, 'packages/ui/src/button.ts', 'export const button = 1;\n');
    write(dir, 'src/app.ts', "import { button } from '@demo/ui';\nexport const app = button;\n");
    commitAll(dir);
    write(dir, 'packages/ui/src/button.ts', 'export const button = 2;\n');
    run(dir, 'git', ['add', 'packages/ui/src/button.ts']);
    write(dir, 'package.json', '{"private":true}\n');
    fs.rmSync(path.join(dir, 'packages'), { recursive: true });

    const data = buildReviewData(new GitRepo(dir), { staged: true });
    assert.equal(data.nodes.find((node) => node.path === 'src/app.ts')?.status, 'impacted_only');
    assert.deepEqual(data.nodes.find((node) => node.path === 'src/app.ts').imports, ['packages/ui/src/button.ts']);
  } finally {
    cleanup(dir);
  }
});

test('staged Go imports use the index module name', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'go.mod', 'module example.com/demo\n\ngo 1.22\n');
    write(dir, 'internal/value/value.go', 'package value\nconst Value = 1\n');
    write(dir, 'app/app.go', 'package app\nimport "example.com/demo/internal/value"\nvar Result = value.Value\n');
    commitAll(dir);
    write(dir, 'internal/value/value.go', 'package value\nconst Value = 2\n');
    run(dir, 'git', ['add', 'internal/value/value.go']);
    write(dir, 'go.mod', 'module example.com/unstaged\n\ngo 1.22\n');

    const data = buildReviewData(new GitRepo(dir), { staged: true });
    assert.equal(data.nodes.find((node) => node.path === 'app/app.go')?.status, 'impacted_only');
  } finally {
    cleanup(dir);
  }
});

test('staged Python imports resolve source roots absent from the worktree', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'lib/value.py', 'VALUE = 1\n');
    write(dir, 'app.py', 'from value import VALUE\nresult = VALUE\n');
    commitAll(dir);
    write(dir, 'lib/value.py', 'VALUE = 2\n');
    run(dir, 'git', ['add', 'lib/value.py']);
    fs.rmSync(path.join(dir, 'lib'), { recursive: true });

    const data = buildReviewData(new GitRepo(dir), { staged: true });
    assert.equal(data.nodes.find((node) => node.path === 'app.py')?.status, 'impacted_only');
  } finally {
    cleanup(dir);
  }
});
