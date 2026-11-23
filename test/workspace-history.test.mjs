import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHub } from '../src/hub.mjs';
import { commitAll, cleanup, hubFetch, makeTempRepo, write } from './helpers.mjs';

function makeWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-ws-history-'));
  const repos = {};
  for (const id of ['repo-a', 'repo-b']) {
    const root = makeTempRepo();
    write(root, 'a.ts', 'export const v = 1;\n');
    commitAll(root, 'init');
    repos[id] = root;
    fs.cpSync(root, path.join(base, id), { recursive: true });
  }
  const workspaceFile = path.join(base, 'diff-viz.workspace.json');
  fs.writeFileSync(
    workspaceFile,
    JSON.stringify({
      name: 'history demo',
      repos: [
        { id: 'repo-a', path: './repo-a' },
        { id: 'repo-b', path: './repo-b' },
      ],
      links: [{ from: 'repo-b', to: 'repo-a', kind: 'rpc', via: 'ACall' }],
    }),
  );
  return { base, workspaceFile, repos };
}

test('workspace history archives the previous analysis and keeps the latest stable id', async () => {
  const fixture = makeWorkspace();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-ws-history-home-'));
  const hub = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  const workspacePath = (id) => path.join(fixture.base, id);
  const analyze = () =>
    hubFetch(hub, 'api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: fixture.workspaceFile }),
    }).then((response) => response.json());
  try {
    write(workspacePath('repo-a'), 'a.ts', 'export const v = 2;\n');
    write(workspacePath('repo-b'), 'a.ts', 'export const v = 2;\n');
    const first = await analyze();
    assert.ok(first.reviewId?.startsWith('workspace-'));

    // Commit the first batch, then make a second change in one repo only.
    for (const id of ['repo-a', 'repo-b']) commitAll(workspacePath(id), 'commit batch');
    write(workspacePath('repo-a'), 'a.ts', 'export const v = 3;\n');
    // Copy the updated repo state back into the fixture roots used by the hub
    // (the workspace file points at fixture.base/<id>).
    commitAll(workspacePath('repo-a'), 'second');

    const second = await analyze();
    assert.equal(second.reviewId, first.reviewId, 'latest review id stays stable');
    assert.equal(second.stats.changed, 0, 'committed worktree is clean');
    // Make a third change so the latest snapshot has something to show.
    write(workspacePath('repo-a'), 'a.ts', 'export const v = 4;\n');
    const third = await analyze();
    assert.equal(third.reviewId, first.reviewId);
    assert.equal(third.stats.changed, 1);

    const history = await hubFetch(
      hub,
      `api/workspace/history?file=${encodeURIComponent(fixture.workspaceFile)}`,
    ).then((response) => response.json());
    assert.equal(history.ok, true);
    assert.ok(Array.isArray(history.versions));
    assert.ok(history.versions.length >= 2, 'expected archived versions');
    assert.equal(history.versions[0].reviewId, first.reviewId);
    assert.equal(history.versions[0].archived, false);
    const archived = history.versions.find((version) => version.archived && version.stats.changed === 2);
    assert.ok(archived, 'the first analysis (2 changed repos) should be archived');

    const archivedData = await hubFetch(hub, `api/data?review=${encodeURIComponent(archived.reviewId)}`).then(
      (response) => response.json(),
    );
    assert.equal(archivedData.meta.workspace, true);
    assert.equal(archivedData.meta.reviewId, archived.reviewId);
    assert.equal(archivedData.meta.archived, true);
    assert.equal(archivedData.meta.stats.changed, 2);

    const stableData = await hubFetch(hub, `api/data?review=${encodeURIComponent(first.reviewId)}`).then(
      (response) => response.json(),
    );
    assert.equal(stableData.meta.stats.changed, 1);
  } finally {
    await hub.close();
    cleanup(fixture.base);
    for (const root of Object.values(fixture.repos)) cleanup(root);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
