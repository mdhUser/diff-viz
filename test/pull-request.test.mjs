import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHub } from '../src/hub.mjs';
import { readReviewStore } from '../src/review-store.mjs';
import { cleanup, commitAll, hubFetch, makeTempRepo, run, write } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../bin/diff-viz.mjs', import.meta.url));
const execFileAsync = promisify(execFile);

async function mockServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function makeRemoteRepo() {
  const root = makeTempRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-pr-remote-'));
  run(remote, 'git', ['init', '--bare', '-q']);
  run(root, 'git', ['remote', 'add', 'origin', remote]);
  write(root, 'base.ts', 'export const base = 1;\n');
  commitAll(root, 'base');
  const defaultBranch = run(root, 'git', ['symbolic-ref', '--short', 'HEAD']).trim();
  run(root, 'git', ['push', '-q', 'origin', `${defaultBranch}:refs/heads/${defaultBranch}`]);
  run(root, 'git', ['checkout', '-qb', 'feature']);
  write(root, 'feature.ts', 'export const feature = 2;\n');
  commitAll(root, 'feature');
  const featureSha = run(root, 'git', ['rev-parse', 'HEAD']).trim();
  run(root, 'git', ['push', '-q', 'origin', 'feature:refs/heads/feature']);
  run(root, 'git', ['--git-dir', remote, 'update-ref', 'refs/pull/7/head', featureSha]);
  return { root, remote, defaultBranch, featureSha };
}

function mockPullApi(server, fixture) {
  const pulls = [
    {
      number: 7,
      title: 'feat: add feature',
      user: { login: 'alice' },
      head: { ref: 'feature', sha: fixture.featureSha },
      base: { ref: fixture.defaultBranch, sha: fixture.featureSha },
      updated_at: '2026-11-22T10:00:00Z',
      html_url: 'https://github.com/acme/demo/pull/7',
      state: 'open',
    },
  ];
  server.on('request', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const url = req.url || '';
    if (/\/pulls\/7\/comments/.test(url)) {
      res.end(
        JSON.stringify([
          {
            id: 101,
            path: 'feature.ts',
            line: 1,
            body: '这个改动需要补测试',
            user: { login: 'alice' },
            created_at: '2026-11-22T10:00:00Z',
            html_url: 'https://github.com/acme/demo/pull/7#discussion_r101',
          },
        ]),
      );
      return;
    }
    if (/\/issues\/7\/comments/.test(url)) {
      res.end(
        JSON.stringify([
          {
            id: 201,
            body: '整体思路可以',
            user: { login: 'bob' },
            created_at: '2026-11-22T09:00:00Z',
            html_url: 'https://github.com/acme/demo/pull/7#issuecomment-201',
          },
        ]),
      );
      return;
    }
    if (/\/pulls\/7/.test(url)) {
      res.end(JSON.stringify(pulls[0]));
    } else {
      res.end(JSON.stringify(pulls));
    }
  });
}

function pullEnv(apiUrl) {
  return {
    DIFF_VIZ_PROVIDER: 'github',
    DIFF_VIZ_REMOTE_URL: 'https://github.com/acme/demo.git',
    DIFF_VIZ_GITHUB_API_URL: apiUrl,
    GITHUB_TOKEN: 'test-token',
  };
}

test('CLI --pr analyzes a remote pull request and records meta.pull', async () => {
  const fixture = makeRemoteRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-pr-cli-'));
  const server = http.createServer();
  mockPullApi(server, fixture);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const { stdout: output } = await execFileAsync(
      process.execPath,
      [CLI, '--pr', '7', '--json-only', '--no-open'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: { ...process.env, ...pullEnv(apiUrl), DIFF_VIZ_HOME: home },
      },
    );
    const payload = JSON.parse(output);
    assert.equal(payload.ok, true);
    assert.equal(payload.meta.pull.number, 7);
    assert.equal(payload.meta.pull.provider, 'github');
    assert.match(payload.meta.rangeLabel, /PR #7/);
    assert.equal(payload.meta.branch, 'feature');
    assert.ok(payload.nodes >= 1);
    assert.equal(payload.meta.pull.commentCount, 2);
    const store = readReviewStore(path.join(fixture.root, '.diff-review-data.json'));
    assert.equal(store.manifest.meta.pull.commentCount, 2);
    assert.equal(store.manifest.comments.length, 2);
    assert.equal(store.manifest.nodes.find((node) => node.path === 'feature.ts')?.reviewComments, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(fixture.root);
    cleanup(fixture.remote);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub lists remote pulls and opens them as a stable review', async () => {
  const fixture = makeRemoteRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-pr-hub-'));
  const server = http.createServer();
  mockPullApi(server, fixture);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const previousEnv = { ...process.env };
  Object.assign(process.env, pullEnv(apiUrl), { DIFF_VIZ_HOME: home });
  const hub = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const project = await hubFetch(hub, 'api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: fixture.root }),
    })
      .then((response) => response.json())
      .then((payload) => payload.project);
    assert.ok(project?.id);

    const list = await hubFetch(hub, `api/pulls?project=${project.id}`).then((response) => response.json());
    assert.equal(list.provider, 'github');
    assert.equal(list.pulls.length, 1);
    assert.equal(list.pulls[0].number, 7);
    assert.equal(list.pulls[0].sourceBranch, 'feature');

    const first = await hubFetch(hub, 'api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, pull: { number: 7 } }),
    }).then((response) => response.json());
    assert.equal(first.reviewId, `${project.id}-pull-7`);

    const data = await hubFetch(hub, `api/data?review=${first.reviewId}`).then((response) => response.json());
    assert.equal(data.meta.pull.number, 7);
    assert.match(data.meta.rangeLabel, /PR #7/);
    assert.ok(data.nodes.some((node) => node.path === 'feature.ts'));
    assert.equal(data.meta.pull.commentCount, 2);
    assert.equal(data.comments.length, 2);
    assert.equal(data.nodes.find((node) => node.path === 'feature.ts')?.reviewComments, 1);

    const second = await hubFetch(hub, 'api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, pull: { number: 7 } }),
    }).then((response) => response.json());
    assert.equal(second.reviewId, first.reviewId);
  } finally {
    await hub.close();
    await new Promise((resolve) => server.close(resolve));
    cleanup(fixture.root);
    cleanup(fixture.remote);
    fs.rmSync(home, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    Object.assign(process.env, previousEnv);
  }
});

test('file-watch re-analysis never overwrites a pull review', async () => {
  const fixture = makeRemoteRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-pr-watch-'));
  const server = http.createServer();
  mockPullApi(server, fixture);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const previousEnv = { ...process.env };
  Object.assign(process.env, pullEnv(apiUrl), { DIFF_VIZ_HOME: home });

  // Trigger the hub watcher deterministically instead of relying on FSEvents.
  const originalWatch = fs.watch;
  const fakeWatchers = [];
  class FakeWatcher {
    constructor(listener) {
      this.listener = listener;
    }
    on() {
      return this;
    }
    close() {}
  }
  fs.watch = (_dir, _options, listener) => {
    const watcher = new FakeWatcher(listener);
    fakeWatchers.push(watcher);
    return watcher;
  };

  const hub = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const project = await hubFetch(hub, 'api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: fixture.root }),
    })
      .then((response) => response.json())
      .then((payload) => payload.project);
    await hubFetch(hub, 'api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, scope: 'worktree' }),
    });
    const pull = await hubFetch(hub, 'api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, pull: { number: 7 } }),
    }).then((response) => response.json());
    assert.equal(fakeWatchers.length, 1, 'worktree review should start a watcher');

    const reviewDir = path.join(home, 'reviews', pull.reviewId);
    const before = readReviewStore(reviewDir).manifest.comments?.length;
    assert.ok(before > 0, 'pull review should have comments');

    fakeWatchers[0].listener('change', 'base.ts');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const after = readReviewStore(reviewDir).manifest.comments?.length;
    assert.equal(after, before, 'watcher must not rebuild the pull review without comments');
    assert.equal(readReviewStore(reviewDir).manifest.meta.pull.number, 7);
  } finally {
    fs.watch = originalWatch;
    await hub.close();
    await new Promise((resolve) => server.close(resolve));
    cleanup(fixture.root);
    cleanup(fixture.remote);
    fs.rmSync(home, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    Object.assign(process.env, previousEnv);
  }
});
