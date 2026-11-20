import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import { startHub } from '../src/hub.mjs';
import { cleanup, commitAll, hubFetch, makeTempRepo, run, write } from './helpers.mjs';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'diff-viz.mjs');
const execFileAsync = promisify(execFile);

test('CLI generates JSON-only output and merges annotations', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'src/a.ts', "export const a = 1;\n");
    commitAll(dir, 'init');
    write(dir, 'src/a.ts', "export const a = 2; // TODO: check\n");
    write(dir, 'src/untracked.ts', 'export const extra = true;\n');

    const dataPath = path.join(dir, '.diff-review-data.json');
    const output = run(dir, process.execPath, [
      bin,
      '--json-only',
      '--quiet',
      '--data',
      dataPath,
      '--no-open',
    ]);
    const result = JSON.parse(output);
    assert.equal(result.ok, true);
    assert.equal(result.meta.stats.changedFiles, 2);
    assert.ok(fs.existsSync(dataPath));

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(data.storage.format, 2);
    assert.ok(fs.existsSync(`${dataPath}.nodes`));
    assert.ok(data.nodes.some((node) => node.path === 'src/untracked.ts' && node.status === 'added'));
    assert.ok(data.nodes.find((node) => node.path === 'src/a.ts').todos.length === 1);
    // The manifest must stay small: heavy fields live in per-node payloads.
    for (const node of data.nodes) {
      assert.ok(!('diff' in node));
      assert.ok(!('oldContent' in node));
      assert.ok(node.payload);
    }
    const payloadFiles = fs.readdirSync(`${dataPath}.nodes`).sort();
    const payloadBefore = new Map(
      payloadFiles.map((name) => [name, fs.readFileSync(path.join(`${dataPath}.nodes`, name), 'utf8')]),
    );

    const annotationsPath = path.join(dir, 'annotations.json');
    fs.writeFileSync(
      annotationsPath,
      JSON.stringify({
        overallSummary: 'CLI 注解测试',
        nodes: {
          'src/a.ts': { summary: '改了常量', impactAnalysis: '无下游依赖', todos: ['人工确认常量'] },
        },
      }),
      'utf8',
    );
    run(dir, process.execPath, [bin, 'annotate', '--data', dataPath, '--annotations', annotationsPath]);
    const annotated = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(annotated.meta.overallSummary, 'CLI 注解测试');
    assert.equal(annotated.nodes.find((node) => node.path === 'src/a.ts').summary, '改了常量');
    assert.ok(annotated.nodes.find((node) => node.path === 'src/a.ts').todos.some((todo) => todo.source === 'agent'));
    // annotate only rewrites the manifest, never the node payloads.
    for (const [name, content] of payloadBefore) {
      assert.equal(fs.readFileSync(path.join(`${dataPath}.nodes`, name), 'utf8'), content);
    }

    const onlyNodePath = path.join(dir, 'annotations-node.json');
    fs.writeFileSync(
      onlyNodePath,
      JSON.stringify({ nodes: { 'src/untracked.ts': { summary: '只改这个文件' } } }),
      'utf8',
    );
    run(dir, process.execPath, [
      bin,
      'annotate',
      '--data',
      dataPath,
      '--annotations',
      onlyNodePath,
      '--node',
      'src/untracked.ts',
    ]);
    const filtered = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(filtered.nodes.find((node) => node.path === 'src/untracked.ts').summary, '只改这个文件');
    assert.equal(filtered.nodes.find((node) => node.path === 'src/a.ts').summary, '改了常量');
  } finally {
    cleanup(dir);
  }
});

test('CLI auto scope falls back to the last commit when clean', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'README.md', 'hello\n');
    write(dir, 'src/a.ts', 'export const a = 1;\n');
    commitAll(dir, 'first');
    write(dir, 'src/a.ts', 'export const a = 2;\n');
    commitAll(dir, 'second');

    const dataPath = path.join(dir, 'review.json');
    run(dir, process.execPath, [bin, '--json-only', '--quiet', '--data', dataPath, '--no-open']);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(data.meta.mode, 'rev');
    assert.match(data.meta.rangeLabel, /最近提交/);
    assert.ok(data.nodes.some((node) => node.path === 'src/a.ts'));
    assert.ok(!data.nodes.some((node) => node.path === 'README.md'));
  } finally {
    cleanup(dir);
  }
});

test('annotate upgrades a legacy single-file review to split storage', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'a.ts', 'export const a = 1;\n');
    commitAll(dir, 'init');
    const legacyPath = path.join(dir, 'legacy.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        meta: {
          timestamp: '2026-01-01T00:00:00Z',
          branch: 'main',
          overallSummary: '',
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
            oldContent: 'old\n',
            newContent: 'new\n',
          },
        ],
        edges: [],
      }),
      'utf8',
    );
    const annotationsPath = path.join(dir, 'legacy-ann.json');
    fs.writeFileSync(
      annotationsPath,
      JSON.stringify({ nodes: { 'a.ts': { summary: '迁移后仍在' } } }),
      'utf8',
    );

    const output = run(dir, process.execPath, [bin, 'annotate', '--data', legacyPath, '--annotations', annotationsPath]);
    assert.match(output, /升级为拆分存储/);

    const manifest = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    assert.equal(manifest.storage.format, 2);
    assert.equal(manifest.nodes[0].summary, '迁移后仍在');
    assert.ok(!('oldContent' in manifest.nodes[0]));
    const payload = JSON.parse(
      fs.readFileSync(path.join(`${legacyPath}.nodes`, `${manifest.nodes[0].payload}.json`), 'utf8'),
    );
    assert.equal(payload.oldContent, 'old\n');
    assert.equal(payload.newContent, 'new\n');
  } finally {
    cleanup(dir);
  }
});

test('CLI annotate --review writes annotations into a running hub review', async () => {
  const dir = makeTempRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-cli-ann-review-'));
  try {
    write(dir, 'src/a.ts', 'export const a = 1;\n');
    commitAll(dir, 'init');
    write(dir, 'src/a.ts', 'export const a = 2;\n');
    const data = buildReviewData(new GitRepo(dir), { worktree: true });
    const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
    try {
      const imported = await hubFetch(server, `api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: dir, data, reviewId: 'cli-review-target' }),
      }).then((response) => response.json());
      assert.ok(imported.reviewId);

      const annotationsPath = path.join(dir, 'ann.json');
      fs.writeFileSync(
        annotationsPath,
        JSON.stringify({
          meta: { overallSummary: 'CLI --review 总结' },
          nodes: { 'src/a.ts': { summary: 'CLI --review 文件摘要', todos: ['人工确认'] } },
        }),
        'utf8',
      );

      // The hub runs in this test process, so the CLI must be spawned async:
      // a blocking execFileSync would stall the event loop and the health
      // probe would time out before the hub could answer.
      const { stdout: output } = await execFileAsync(
        process.execPath,
        [bin, 'annotate', '--review', imported.reviewId, '--annotations', annotationsPath],
        { cwd: dir, env: { ...process.env, DIFF_VIZ_HOME: home }, encoding: 'utf8' },
      );
      assert.match(output, /已把注解写入 hub Review/);

      const review = await hubFetch(server, `api/data?review=${imported.reviewId}`).then((response) =>
        response.json(),
      );
      assert.equal(review.meta.overallSummary, 'CLI --review 总结');
      const node = review.nodes.find((item) => item.path === 'src/a.ts');
      assert.equal(node.summary, 'CLI --review 文件摘要');
      assert.equal(node.summarySource, 'agent');

      const missing = await execFileAsync(
        process.execPath,
        [bin, 'annotate', '--review', 'nope', '--annotations', annotationsPath],
        { cwd: dir, env: { ...process.env, DIFF_VIZ_HOME: home }, encoding: 'utf8' },
      ).then(
        () => '',
        (error) => String(error.stderr || error.stdout || error.message),
      );
      assert.match(missing, /找不到 Review/);
    } finally {
      await server.close();
    }
  } finally {
    cleanup(dir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
