import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import { resolveHubPort, startHub } from '../src/hub.mjs';
import { writeReviewStore } from '../src/review-store.mjs';
import { cleanup, commitAll, makeTempRepo, run, write } from './helpers.mjs';

test('hub registers projects, serves data, lists commits and builds historical reviews', async () => {
  const repoDir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-'));
  write(repoDir, 'src/main/java/com/acme/App.java', 'package com.acme;\n\nimport com.acme.util.Helper;\n\npublic class App { private final Helper helper = new Helper(); }\n');
  write(repoDir, 'src/main/java/com/acme/util/Helper.java', 'package com.acme.util;\n\npublic class Helper {}\n');
  commitAll(repoDir, 'initial java service');
  write(repoDir, 'src/main/java/com/acme/App.java', 'package com.acme;\n\nimport com.acme.util.Helper;\n\npublic class App { private final Helper helper = new Helper(); public String ping() { return "pong"; } }\n');

  const repo = new GitRepo(repoDir);
  const data = buildReviewData(repo, { worktree: true });
  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const imported = await fetch(`${server.url}api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: repoDir, data }),
    }).then((response) => response.json());
    assert.ok(imported.reviewId);

    const hub = await fetch(`${server.url}api/hub`).then((response) => response.json());
    assert.equal(hub.projects.length, 1);
    const projectId = hub.projects[0].id;

    const commits = await fetch(`${server.url}api/commits?project=${projectId}`).then((response) =>
      response.json(),
    );
    assert.equal(commits.commits.length, 1);
    assert.equal(commits.commits[0].subject, 'initial java service');

    const reviewResponse = await fetch(`${server.url}api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, scope: 'commit', commit: commits.commits[0].sha }),
    }).then((response) => response.json());
    assert.ok(reviewResponse.reviewId.includes('commit'));

    const review = await fetch(`${server.url}api/data?review=${reviewResponse.reviewId}`).then((response) =>
      response.json(),
    );
    assert.ok(review.nodes.some((node) => node.path.endsWith('App.java')));
    assert.ok(review.edges.some((edge) => edge.target.endsWith('Helper.java')));
    const appPath = 'src/main/java/com/acme/App.java';
    const appStub = review.nodes.find((node) => node.path === appPath);
    assert.ok(appStub.payload);
    assert.equal(appStub.oldContent, undefined, 'graph payload should not embed file content');

    const appNode = await fetch(
      `${server.url}api/node?review=${encodeURIComponent(reviewResponse.reviewId)}&id=${encodeURIComponent(appPath)}`,
    ).then((response) => response.json());
    assert.match(appNode.newContent, /public class App/);
    assert.match(appNode.diff, /@@/);
    assert.equal(appNode.contentMissing, undefined);

    const fullReview = await fetch(
      `${server.url}api/data?review=${encodeURIComponent(reviewResponse.reviewId)}&full=1`,
    ).then((response) => response.json());
    assert.match(fullReview.nodes.find((node) => node.path === appPath).newContent, /public class App/);

    const snapshotDir = path.join(home, 'reviews', reviewResponse.reviewId);
    const payloadFile = path.join(snapshotDir, 'nodes', `${appStub.payload}.json`);
    const payloadBody = fs.readFileSync(payloadFile, 'utf8');
    const payloadMtime = fs.statSync(payloadFile).mtimeMs;

    const state = await fetch(`${server.url}api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewId: reviewResponse.reviewId,
        nodeId: 'src/main/java/com/acme/App.java',
        reviewed: true,
      }),
    }).then((response) => response.json());
    assert.equal(state.ok, true);

    const updated = await fetch(`${server.url}api/data?review=${reviewResponse.reviewId}`).then((response) =>
      response.json(),
    );
    assert.equal(
      updated.nodes.find((node) => node.path === 'src/main/java/com/acme/App.java').reviewed,
      true,
    );
    // Todo/review state lives in the manifest; node payloads are untouched.
    assert.equal(fs.readFileSync(payloadFile, 'utf8'), payloadBody);
    assert.equal(fs.statSync(payloadFile).mtimeMs, payloadMtime);

    await fetch(`${server.url}api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewId: reviewResponse.reviewId,
        nodeId: 'src/main/java/com/acme/App.java',
        ignored: true,
      }),
    });
    const ignored = await fetch(`${server.url}api/data?review=${reviewResponse.reviewId}`).then((response) =>
      response.json(),
    );
    assert.equal(
      ignored.nodes.find((node) => node.path === 'src/main/java/com/acme/App.java').ignored,
      true,
    );
  } finally {
    await server.close();
    cleanup(repoDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub imports a review by data path instead of a JSON body', async () => {
  const repoDir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-path-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-outside-'));
  write(repoDir, 'a.ts', 'export const a = 1;\n');
  commitAll(repoDir, 'init');
  write(repoDir, 'a.ts', 'export const a = 2;\n');

  const dataPath = path.join(repoDir, '.diff-review-data.json');
  writeReviewStore(dataPath, buildReviewData(new GitRepo(repoDir), { worktree: true }));
  const outsidePath = path.join(outsideDir, 'outside.json');
  fs.writeFileSync(outsidePath, JSON.stringify(buildReviewData(new GitRepo(repoDir), { worktree: true })));

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const imported = await fetch(`${server.url}api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: repoDir, dataPath, reviewId: 'path-import' }),
    }).then((response) => response.json());
    assert.equal(imported.reviewId, 'path-import');
    // the hub snapshots the split files instead of a single JSON blob
    assert.ok(fs.existsSync(path.join(home, 'reviews', 'path-import', 'manifest.json')));
    assert.ok(fs.existsSync(path.join(home, 'reviews', 'path-import', 'nodes')));

    const manifest = await fetch(`${server.url}api/data?review=path-import`).then((response) => response.json());
    assert.ok(manifest.nodes.some((node) => node.path === 'a.ts'));
    const node = await fetch(`${server.url}api/node?review=path-import&id=a.ts`).then((response) =>
      response.json(),
    );
    assert.match(node.newContent, /a = 2/);

    // A data path outside the registered repository is never used for import.
    const outside = await fetch(`${server.url}api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: repoDir, dataPath: outsidePath, reviewId: 'outside' }),
    });
    assert.equal(outside.status, 500);
    assert.match((await outside.json()).error, /数据格式不正确/);
  } finally {
    await server.close();
    cleanup(repoDir);
    cleanup(outsideDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('legacy single-file snapshots keep working and accept state updates', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-legacy-'));
  const reviewsDir = path.join(home, 'reviews');
  fs.mkdirSync(reviewsDir, { recursive: true });
  const legacyPath = path.join(reviewsDir, 'legacy-1.json');
  const legacy = {
    meta: {
      timestamp: '2026-01-01T00:00:00Z',
      branch: 'main',
      overallSummary: 'legacy',
      reviewId: 'legacy-1',
      stats: { changedFiles: 1, impactedFiles: 0, additions: 1, deletions: 0, todos: 0 },
    },
    nodes: [
      {
        id: 'a.ts',
        label: 'a.ts',
        path: 'a.ts',
        status: 'modified',
        stats: { additions: 1, deletions: 0 },
        summary: '',
        impactAnalysis: '',
        todos: [],
        diff: '@@ -1 +1 @@',
        oldContent: 'OLD',
        newContent: 'NEW',
      },
    ],
    edges: [],
  };
  fs.writeFileSync(legacyPath, JSON.stringify(legacy), 'utf8');

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const data = await fetch(`${server.url}api/data?review=legacy-1`).then((response) => response.json());
    assert.equal(data.nodes[0].oldContent, 'OLD');
    const node = await fetch(`${server.url}api/node?review=legacy-1&id=a.ts`).then((response) => response.json());
    assert.equal(node.newContent, 'NEW');

    const state = await fetch(`${server.url}api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: 'legacy-1', nodeId: 'a.ts', reviewed: true }),
    }).then((response) => response.json());
    assert.equal(state.ok, true);
    const saved = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    assert.equal(saved.nodes[0].reviewed, true);
    assert.equal(saved.nodes[0].oldContent, 'OLD', 'legacy snapshots keep embedding content');
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('projects can be added by path, validated, deduplicated and removed', async () => {
  const repoDir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-'));
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-plain-'));
  write(repoDir, 'app.ts', 'export const app = 1;\n');
  commitAll(repoDir, 'init');
  fs.mkdirSync(path.join(repoDir, 'src'));

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const add = (root) =>
      fetch(`${server.url}api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      });

    const added = await add(repoDir).then((response) => response.json());
    assert.equal(added.ok, true);
    // Windows may report 8.3 short paths, so compare the resolved directory.
    assert.equal(path.basename(added.project.root), path.basename(fs.realpathSync(repoDir)));
    assert.ok(fs.statSync(added.project.root).isDirectory());
    assert.equal(added.project.name, path.basename(repoDir));

    // a subdirectory resolves to the repository root and keeps the same id
    const nested = await add(path.join(repoDir, 'src')).then((response) => response.json());
    assert.equal(nested.project.id, added.project.id);

    const hub = await fetch(`${server.url}api/hub`).then((response) => response.json());
    assert.equal(hub.projects.length, 1);

    const missing = await add(path.join(os.tmpdir(), 'diff-viz-definitely-missing'));
    assert.equal(missing.status, 500);
    assert.match((await missing.json()).error, /目录不存在/);

    const notRepo = await add(plainDir);
    assert.equal(notRepo.status, 500);
    assert.match((await notRepo.json()).error, /不是 Git 仓库/);

    const removed = await fetch(`${server.url}api/projects?id=${added.project.id}`, {
      method: 'DELETE',
    }).then((response) => response.json());
    assert.equal(removed.ok, true);

    const empty = await fetch(`${server.url}api/hub`).then((response) => response.json());
    assert.equal(empty.projects.length, 0);

    const missingDelete = await fetch(`${server.url}api/projects?id=nope`, { method: 'DELETE' });
    assert.equal(missingDelete.status, 404);
  } finally {
    await server.close();
    cleanup(repoDir);
    cleanup(plainDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});


test('commit history defaults to the checked-out branch and all=1 includes every ref', async () => {
  const repoDir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-branch-'));
  write(repoDir, 'base.txt', 'base\n');
  commitAll(repoDir, 'base commit');
  const base = run(repoDir, 'git', ['rev-parse', 'HEAD']).trim();

  run(repoDir, 'git', ['checkout', '-qb', 'feature/current']);
  write(repoDir, 'current.txt', 'current\n');
  commitAll(repoDir, 'current branch work');

  run(repoDir, 'git', ['checkout', '-qb', 'feature/other', base]);
  write(repoDir, 'other.txt', 'other\n');
  commitAll(repoDir, 'other branch work');
  run(repoDir, 'git', ['checkout', '-q', 'feature/current']);

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const project = await fetch(`${server.url}api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: repoDir }),
    }).then((response) => response.json());

    const scoped = await fetch(`${server.url}api/commits?project=${project.project.id}`).then((response) =>
      response.json(),
    );
    assert.equal(scoped.branch, 'feature/current');
    assert.equal(scoped.all, false);
    const subjects = scoped.commits.map((commit) => commit.subject);
    assert.ok(subjects.includes('current branch work'));
    assert.ok(subjects.includes('base commit'));
    assert.ok(!subjects.includes('other branch work'), 'other branches must stay out of the default chain');

    const all = await fetch(`${server.url}api/commits?project=${project.project.id}&all=1`).then((response) =>
      response.json(),
    );
    assert.equal(all.all, true);
    assert.ok(all.commits.some((commit) => commit.subject === 'other branch work'));
  } finally {
    await server.close();
    cleanup(repoDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('annotate API writes agent summaries into an existing hub review', async () => {
  const repoDir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-ann-'));
  write(repoDir, 'a.ts', 'export const a = 1;\n');
  commitAll(repoDir, 'init');
  write(repoDir, 'a.ts', 'export const a = 2;\n');
  const data = buildReviewData(new GitRepo(repoDir), { worktree: true });

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const imported = await fetch(`${server.url}api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: repoDir, data, reviewId: 'ann-review' }),
    }).then((response) => response.json());

    const before = await fetch(`${server.url}api/data?review=${imported.reviewId}`).then((response) =>
      response.json(),
    );
    const payload = before.nodes[0].payload;
    const payloadFile = path.join(home, 'reviews', imported.reviewId, 'nodes', `${payload}.json`);
    const payloadBody = fs.readFileSync(payloadFile, 'utf8');

    const annotated = await fetch(`${server.url}api/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewId: imported.reviewId,
        annotations: {
          meta: { overallSummary: 'Agent 整体总结' },
          nodes: { 'a.ts': { summary: 'Agent 文件总结', impactAnalysis: 'Agent 影响说明', todos: ['人工确认'] } },
        },
      }),
    }).then((response) => response.json());
    assert.equal(annotated.ok, true);
    assert.equal(annotated.annotated, 1);

    const after = await fetch(`${server.url}api/data?review=${imported.reviewId}`).then((response) =>
      response.json(),
    );
    assert.equal(after.meta.overallSummary, 'Agent 整体总结');
    assert.equal(after.meta.summarySource, 'agent');
    const node = after.nodes.find((item) => item.path === 'a.ts');
    assert.equal(node.summary, 'Agent 文件总结');
    assert.equal(node.summarySource, 'agent');
    assert.equal(node.impactSource, 'agent');
    assert.ok(node.todos.some((todo) => todo.source === 'agent' && todo.text === '人工确认'));
    assert.equal(fs.readFileSync(payloadFile, 'utf8'), payloadBody, 'annotate must not touch node payloads');

    const missing = await fetch(`${server.url}api/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: 'nope', annotations: { nodes: {} } }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
    cleanup(repoDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('agent annotations survive commit and are reused in another Review of the same change', async () => {
  const repoDir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-memory-'));
  write(repoDir, 'a.ts', 'export const a = 1;\n');
  commitAll(repoDir, 'init');
  write(repoDir, 'a.ts', 'export const a = 2;\n');

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const project = await fetch(`${server.url}api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: repoDir }),
    }).then((response) => response.json());
    const projectId = project.project.id;

    // Worktree Review with an agent summary.
    const worktree = await fetch(`${server.url}api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, scope: 'worktree' }),
    }).then((response) => response.json());
    await fetch(`${server.url}api/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewId: worktree.reviewId,
        annotations: {
          meta: { overallSummary: '工作区总结' },
          nodes: { 'a.ts': { summary: 'Agent 改的是常量', impactAnalysis: '无下游' } },
        },
      }),
    });

    // A commit Review generated before the annotation must pick the annotation
    // up when it is opened (reuse on read).
    run(repoDir, 'git', ['add', '-A']);
    commitAll(repoDir, 'commit change');
    const sha = run(repoDir, 'git', ['rev-parse', 'HEAD']).trim();
    const commitReview = await fetch(`${server.url}api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, scope: 'commit', commit: sha }),
    }).then((response) => response.json());
    assert.equal(commitReview.reviewId, `${projectId}-commit-${sha.slice(0, 12)}`);

    const opened = await fetch(`${server.url}api/data?review=${commitReview.reviewId}`).then((response) =>
      response.json(),
    );
    const openedNode = opened.nodes.find((node) => node.path === 'a.ts');
    assert.equal(openedNode.summary, 'Agent 改的是常量');
    assert.equal(openedNode.summarySource, 'agent');
    assert.equal(openedNode.impactSource, 'agent');
    // The review-level overview is remembered too (same change set after commit).
    assert.equal(opened.meta.overallSummary, '工作区总结');
    assert.equal(opened.meta.summarySource, 'agent');

    // Regenerating the same commit Review keeps the annotation from the store.
    const regenerated = await fetch(`${server.url}api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, scope: 'commit', commit: sha }),
    }).then((response) => response.json());
    const regeneratedData = await fetch(`${server.url}api/data?review=${regenerated.reviewId}`).then((response) =>
      response.json(),
    );
    assert.equal(regeneratedData.nodes.find((node) => node.path === 'a.ts').summarySource, 'agent');
    assert.equal(regeneratedData.meta.overallSummary, '工作区总结');
    assert.equal(regeneratedData.meta.summarySource, 'agent');

    // Different content must not inherit the stale annotation.
    write(repoDir, 'a.ts', 'export const a = 3;\n');
    const changed = await fetch(`${server.url}api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, scope: 'worktree' }),
    }).then((response) => response.json());
    const changedData = await fetch(`${server.url}api/data?review=${changed.reviewId}`).then((response) =>
      response.json(),
    );
    const changedNode = changedData.nodes.find((node) => node.path === 'a.ts');
    assert.notEqual(changedNode.summarySource, 'agent');
    assert.notEqual(changedNode.summary, 'Agent 改的是常量');
    assert.notEqual(changedData.meta.summarySource, 'agent');
  } finally {
    await server.close();
    cleanup(repoDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('overviews are reused when a new Review change set heavily overlaps', async () => {
  const repoDir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-hub-overlap-'));
  const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
  for (const file of files) write(repoDir, file, `export const ${file[0]} = 1;\n`);
  commitAll(repoDir, 'init');
  const base = run(repoDir, 'git', ['rev-parse', 'HEAD']).trim();
  for (const file of files) write(repoDir, file, `export const ${file[0]} = 2;\n`);

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const project = await fetch(`${server.url}api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: repoDir }),
    }).then((response) => response.json());
    const projectId = project.project.id;

    const worktree = await fetch(`${server.url}api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, scope: 'worktree' }),
    }).then((response) => response.json());
    await fetch(`${server.url}api/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewId: worktree.reviewId,
        annotations: {
          meta: { overallSummary: '整个 feature 的 Agent 概览' },
          nodes: { 'a.ts': { summary: 'a 的 Agent 摘要' } },
        },
      }),
    });

    // Commit the annotated work, then add one more commit touching a new file.
    commitAll(repoDir, 'commit annotated work');
    write(repoDir, 'e.ts', 'export const e = 1;\n');
    commitAll(repoDir, 'commit extra file');

    // The range Review now has 5 changed files: 4 identical to the annotated
    // worktree plus e.ts, so its overview is reused via change-set overlap.
    const range = await fetch(`${server.url}api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, scope: 'range', range: `${base}..HEAD` }),
    }).then((response) => response.json());
    const data = await fetch(`${server.url}api/data?review=${range.reviewId}`).then((response) => response.json());
    assert.equal(data.meta.overallSummary, '整个 feature 的 Agent 概览');
    assert.equal(data.meta.summarySource, 'agent');
    assert.equal(data.nodes.find((node) => node.path === 'a.ts').summarySource, 'agent');
  } finally {
    await server.close();
    cleanup(repoDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub prunes old reviews and keeps state private', async () => {
  const repoDir = makeTempRepo();
  write(repoDir, 'a.ts', 'export const a = 1;\n');
  commitAll(repoDir, 'init');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-gc-'));
  const reviewsDir = path.join(home, 'reviews');
  fs.mkdirSync(reviewsDir, { recursive: true });

  const previous = process.env.DIFF_VIZ_KEEP_REVIEWS;
  process.env.DIFF_VIZ_KEEP_REVIEWS = '5';
  // Eight stale snapshots with increasing mtimes.
  for (let index = 0; index < 8; index += 1) {
    const file = path.join(reviewsDir, `old-${index}.json`);
    fs.writeFileSync(file, JSON.stringify({ meta: { reviewId: `old-${index}` }, nodes: [], edges: [] }));
    const stamp = new Date(Date.now() - (100 - index) * 1000);
    fs.utimesSync(file, stamp, stamp);
  }
  // Two split-layout snapshots that are older than every legacy file.
  for (let index = 0; index < 2; index += 1) {
    const dir = path.join(reviewsDir, `split-${index}`);
    fs.mkdirSync(dir, { recursive: true });
    writeReviewStore(dir, { meta: { reviewId: `split-${index}` }, nodes: [], edges: [] });
    const stamp = new Date(Date.now() - 500_000 - index * 1000);
    fs.utimesSync(dir, stamp, stamp);
  }

  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const left = fs.readdirSync(reviewsDir).filter((name) => name.endsWith('.json'));
    assert.equal(left.length, 5);
    assert.ok(!left.includes('old-0.json'), 'oldest snapshot should be pruned');
    assert.ok(!fs.existsSync(path.join(reviewsDir, 'split-0')));
    assert.ok(!fs.existsSync(path.join(reviewsDir, 'split-1')));

    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(home).mode & 0o777, 0o700);
      assert.equal(fs.statSync(reviewsDir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(reviewsDir, 'old-7.json')).mode & 0o777, 0o600);
    }
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.DIFF_VIZ_KEEP_REVIEWS;
    else process.env.DIFF_VIZ_KEEP_REVIEWS = previous;
    cleanup(repoDir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub builds a workspace review across repositories', async () => {
  const common = makeTempRepo();
  const order = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-ws-'));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-ws-file-'));
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-plain-repo-'));
  try {
    write(common, 'package.json', JSON.stringify({ name: '@acme/common', version: '1.0.0' }));
    write(common, 'index.ts', 'export const fmt = (v) => v;\n');
    commitAll(common, 'init');
    write(order, 'package.json', JSON.stringify({ name: '@acme/order', dependencies: { '@acme/common': '1.0.0' } }));
    write(order, 'index.ts', 'import { fmt } from "@acme/common";\nexport const total = (n) => fmt(n);\n');
    commitAll(order, 'init');

    write(common, 'index.ts', 'export const fmt = (v) => String(v);\n');
    const workspaceFile = path.join(workspaceDir, 'diff-viz.workspace.json');
    write(
      workspaceDir,
      'diff-viz.workspace.json',
      JSON.stringify({
        name: '订单链路',
        repos: [
          { id: 'common', path: common },
          { id: 'order', path: order },
          { id: 'plain', path: plainDir },
        ],
        links: [],
      }),
    );

    const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
    try {
      const response = await fetch(`${server.url}api/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: workspaceFile }),
      }).then((res) => res.json());
      assert.equal(response.ok, true);
      assert.deepEqual(response.stats, { repos: 2, changed: 1, impacted: 1 });
      assert.match(response.warnings[0], /plain/);

      const data = await fetch(`${server.url}api/data?review=${response.reviewId}`).then((res) => res.json());
      assert.equal(data.meta.workspace, true);
      assert.equal(data.meta.repos.length, 2);
      const orderRepo = data.meta.repos.find((repo) => repo.id === 'order');
      assert.equal(orderRepo.depth, 1);
      assert.deepEqual(orderRepo.impactOrigins, ['common']);
      assert.ok(
        data.meta.serviceEdges.some(
          (edge) => edge.from === 'order' && edge.to === 'common' && edge.kind === 'manifest',
        ),
      );
    } finally {
      await server.close();
    }
  } finally {
    cleanup(common);
    cleanup(order);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});

test('workspace honors per-repo and workspace-level comparison scopes', async () => {
  const repo = makeTempRepo();
  const weird = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-ws-scope-'));
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-ws-scope-file-'));
  try {
    // main gets an initial file, then the feature branch changes it.
    write(repo, 'a.ts', 'export const a = 1;\n');
    commitAll(repo, 'init');
    run(repo, 'git', ['branch', '-M', 'main']);
    run(repo, 'git', ['checkout', '-q', '-b', 'feature']);
    write(repo, 'a.ts', 'export const a = 2;\n');
    commitAll(repo, 'feature change');

    write(weird, 'b.ts', 'export const b = 1;\n');
    commitAll(weird, 'init');

    const wsFile = path.join(wsDir, 'diff-viz.workspace.json');
    write(
      wsDir,
      'diff-viz.workspace.json',
      JSON.stringify({
        name: 'scoped workspace',
        scope: { mode: 'range', base: 'main' },
        repos: [
          { id: 'repo', path: repo },
          { id: 'weird', path: weird, scope: { mode: 'worktree' } },
        ],
        links: [],
      }),
    );

    const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
    try {
      const response = await fetch(`${server.url}api/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: wsFile }),
      }).then((res) => res.json());
      assert.equal(response.ok, true);
      const data = await fetch(`${server.url}api/data?review=${response.reviewId}`).then((res) => res.json());
      const scoped = data.meta.repos.find((item) => item.id === 'repo');
      const worktree = data.meta.repos.find((item) => item.id === 'weird');
      assert.equal(scoped.scopeMode, 'range');
      assert.match(scoped.scopeLabel, /main/);
      assert.equal(scoped.changed, true);
      assert.equal(worktree.scopeMode, 'worktree');
      assert.equal(worktree.changed, false);
    } finally {
      await server.close();
    }
  } finally {
    cleanup(repo);
    cleanup(weird);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test('a restarted hub keeps the remembered port unless --port is explicit', () => {
  assert.equal(resolveHubPort({ port: 5174 }, undefined), 5174);
  assert.equal(resolveHubPort({ port: '5180' }, undefined), 5180);
  assert.equal(resolveHubPort({ port: 5174 }, 6000), 6000);
  assert.equal(resolveHubPort(null, undefined), 5173);
  assert.equal(resolveHubPort({}, undefined), 5173);
  assert.equal(resolveHubPort({ port: 0 }, undefined), 5173);
});
