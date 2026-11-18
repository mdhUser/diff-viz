import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeServiceImpact,
  detectServiceEdges,
  loadWorkspace,
  readRepoManifest,
  workspaceTemplate,
} from '../src/workspace.mjs';
import { cleanup, makeTempRepo, write } from './helpers.mjs';

test('reads npm and maven coordinates plus their dependencies', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'package.json', JSON.stringify({ name: '@acme/order', dependencies: { '@acme/common': '1.0.0' } }));
    write(
      dir,
      'pom.xml',
      '<project><groupId>com.acme</groupId><artifactId>order-svc</artifactId>' +
        '<dependencies><dependency><groupId>com.acme</groupId><artifactId>common-lib</artifactId></dependency></dependencies></project>',
    );
    const manifest = readRepoManifest(dir);
    assert.deepEqual(manifest.names.sort(), ['@acme/order', 'com.acme:order-svc', 'order-svc'].sort());
    assert.ok(manifest.deps.includes('@acme/common'));
    assert.ok(manifest.deps.includes('com.acme:common-lib'));
  } finally {
    cleanup(dir);
  }
});

test('detects package-based service edges and merges declared links', () => {
  const common = makeTempRepo();
  const order = makeTempRepo();
  const gateway = makeTempRepo();
  try {
    write(common, 'package.json', JSON.stringify({ name: '@acme/common' }));
    write(order, 'package.json', JSON.stringify({ name: '@acme/order', dependencies: { '@acme/common': '1.0.0' } }));
    write(gateway, 'package.json', JSON.stringify({ name: '@acme/gateway', dependencies: { '@acme/order': '1.0.0' } }));

    const repos = [
      { id: 'common', label: 'common', root: common },
      { id: 'order', label: 'order', root: order },
      { id: 'gateway', label: 'gateway', root: gateway },
    ];
    const edges = detectServiceEdges(repos, [{ from: 'order', to: 'gateway', kind: 'rpc', via: 'OrderService/Get' }]);
    const byKind = edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind}`).sort();
    assert.deepEqual(byKind, ['gateway->order:manifest', 'order->common:manifest', 'order->gateway:rpc']);
  } finally {
    cleanup(common);
    cleanup(order);
    cleanup(gateway);
  }
});

test('propagates changes along service edges', () => {
  const repos = [{ id: 'common' }, { id: 'order' }, { id: 'gateway' }];
  const edges = [
    { from: 'order', to: 'common' },
    { from: 'gateway', to: 'order' },
  ];
  const { depth, origins } = computeServiceImpact(repos, edges, ['common']);
  assert.equal(depth.get('common'), 0);
  assert.equal(depth.get('order'), 1);
  assert.equal(depth.get('gateway'), 2);
  assert.deepEqual([...origins.get('gateway')], ['common']);
});

test('loads a workspace file and validates its shape', () => {
  const dir = makeTempRepo();
  const repo = makeTempRepo();
  try {
    write(
      dir,
      'diff-viz.workspace.json',
      JSON.stringify({ name: 'demo', repos: [{ id: 'order', path: repo }], links: [] }),
    );
    const workspace = loadWorkspace(path.join(dir, 'diff-viz.workspace.json'));
    assert.equal(workspace.name, 'demo');
    assert.equal(workspace.repos[0].id, 'order');
    assert.equal(workspace.repos[0].root, path.resolve(repo));

    write(
      dir,
      'bad.json',
      JSON.stringify({ repos: [{ id: 'a', path: repo }, { id: 'a', path: repo }] }),
    );
    assert.throws(() => loadWorkspace(path.join(dir, 'bad.json')), /id 重复/);

    write(dir, 'broken.json', JSON.stringify({ repos: [{ id: 'a', path: './missing' }] }));
    assert.throws(() => loadWorkspace(path.join(dir, 'broken.json')), /不存在/);
  } finally {
    cleanup(dir);
    cleanup(repo);
  }
});

test('workspace template picks up sibling git repositories', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'dv-ws-'));
  const a = path.join(dir, 'alpha');
  const b = path.join(dir, 'beta');
  fs.mkdirSync(path.join(a, '.git'), { recursive: true });
  fs.mkdirSync(path.join(b, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'not-a-repo'));
  try {
    const template = workspaceTemplate(dir);
    assert.deepEqual(template.repos.map((repo) => repo.id), ['alpha', 'beta']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
