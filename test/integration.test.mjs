import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { applyAnnotations, buildReviewData, mergePreviousState, resolveScope } from '../src/collect.mjs';
import { startServer } from '../src/server.mjs';
import { cleanup, commitAll, makeTempRepo, run, write } from './helpers.mjs';

function seedRepo() {
  const dir = makeTempRepo();
  write(dir, 'tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }\n');
  write(dir, 'package.json', '{ "name": "fixture", "private": true, "workspaces": ["packages/*"] }\n');
  write(dir, 'packages/ui/package.json', '{ "name": "@demo/ui", "version": "1.0.0", "main": "src/index.ts" }\n');
  write(dir, 'packages/ui/src/index.ts', 'export const ui = "v1";\n');
  write(dir, 'src/consumer.ts', 'import { ui } from \'@demo/ui\';\n\nexport const label = ui;\n');
  write(dir, 'src/util.ts', 'export function help(value: string) {\n  return value.trim();\n}\n');
  write(dir, 'src/app.ts', "import { help } from '@/util';\n\nexport const app = help(' x ');\n");
  write(dir, 'src/other.ts', "import { app } from './app';\n\nexport const other = app;\n");
  write(dir, 'pkg/__init__.py', '');
  write(dir, 'pkg/base.py', 'VALUE = 1\n');
  write(dir, 'pkg/use.py', 'from pkg.base import VALUE\n\nresult = VALUE + 1\n');
  write(dir, 'src/main/java/com/example/config/AppConfig.java', 'package com.example.config;\n\npublic final class AppConfig {\n  public static final int TTL = 3600;\n}\n');
  write(dir, 'src/main/java/com/example/auth/TokenStore.java', 'package com.example.auth;\n\npublic class TokenStore {\n  public String issue() { return "token"; }\n}\n');
  write(
    dir,
    'src/main/java/com/example/auth/JwtService.java',
    'package com.example.auth;\n\nimport com.example.config.AppConfig;\n\npublic class JwtService {\n  private final TokenStore store = new TokenStore();\n  public int ttl() { return AppConfig.TTL; }\n  public String issue() { return store.issue(); }\n}\n',
  );
  write(
    dir,
    'src/main/java/com/example/auth/AuthGuard.java',
    'package com.example.auth;\n\npublic class AuthGuard {\n  private final JwtService service = new JwtService();\n  public boolean allow(String token) { return service.issue() != null; }\n}\n',
  );
  write(
    dir,
    'src/main/java/com/example/api/Routes.java',
    'package com.example.api;\n\nimport com.example.auth.AuthGuard;\n\npublic class Routes {\n  private final AuthGuard guard = new AuthGuard();\n  public boolean check(String token) { return guard.allow(token); }\n}\n',
  );
  write(dir, 'go.mod', 'module example.com/demo\n\ngo 1.22\n');
  write(dir, 'internal/b/b.go', 'package b\n\nconst Name = "b"\n');
  write(
    dir,
    'internal/a/a.go',
    'package a\n\nimport "example.com/demo/internal/b"\n\nvar Name = b.Name\n',
  );
  commitAll(dir, 'initial');
  return dir;
}

test('builds dependency graph, impact depth, edges and todos', () => {
  const dir = seedRepo();
  try {
    write(dir, 'src/util.ts', 'export function help(value: string) {\n  // TODO: cover empty input\n  return value.trim();\n}\n');
    write(dir, 'pkg/base.py', 'VALUE = 2\n');
    write(dir, 'internal/b/b.go', 'package b\n\nconst Name = "b2"\n');
    write(dir, 'src/new.ts', '// FIXME: remove debug\nconsole.log("new");\n');
    write(dir, 'packages/ui/src/index.ts', 'export const ui = "v2";\n');
    write(
      dir,
      'src/main/java/com/example/auth/JwtService.java',
      'package com.example.auth;\n\nimport com.example.config.AppConfig;\n\npublic class JwtService {\n  private final TokenStore store = new TokenStore();\n  public int ttl() { return AppConfig.TTL; }\n  public String issue() { return store.issue(); }\n  public String refresh() { return issue(); }\n}\n',
    );

    const repo = new GitRepo(dir);
    const data = buildReviewData(repo, { untracked: true, impactDepth: 3 });
    const byPath = new Map(data.nodes.map((node) => [node.path, node]));

    assert.equal(data.meta.mode, 'worktree');
    assert.equal(byPath.get('src/util.ts').status, 'modified');
    assert.equal(byPath.get('src/new.ts').status, 'added');
    assert.equal(byPath.get('pkg/base.py').status, 'modified');

    const app = byPath.get('src/app.ts');
    const other = byPath.get('src/other.ts');
    assert.equal(app.status, 'impacted_only');
    assert.equal(app.depth, 1);
    assert.equal(other.status, 'impacted_only');
    assert.equal(other.depth, 2);

    assert.equal(byPath.get('pkg/use.py').status, 'impacted_only');
    assert.equal(byPath.get('internal/a/a.go').status, 'impacted_only');
    assert.equal(byPath.get('src/consumer.ts').status, 'impacted_only');
    assert.equal(byPath.get('src/consumer.ts').depth, 1);
    assert.equal(byPath.get('src/main/java/com/example/auth/AuthGuard.java').status, 'impacted_only');
    assert.equal(byPath.get('src/main/java/com/example/auth/AuthGuard.java').depth, 1);
    assert.equal(byPath.get('src/main/java/com/example/api/Routes.java').status, 'impacted_only');
    assert.equal(byPath.get('src/main/java/com/example/api/Routes.java').depth, 2);

    const edge = data.edges.find((item) => item.source === 'src/app.ts' && item.target === 'src/util.ts');
    assert.ok(edge, 'app imports util edge should exist');
    assert.ok(
      data.edges.some((item) => item.source === 'internal/a/a.go' && item.target === 'internal/b/b.go'),
      'Go import edge should exist',
    );
    assert.ok(
      data.edges.some((item) => item.source === 'src/consumer.ts' && item.target === 'packages/ui/src/index.ts'),
      'workspace package edge should exist',
    );
    assert.ok(byPath.get('src/util.ts').importedBy.includes('src/app.ts'));
    assert.ok(byPath.get('src/app.ts').imports.includes('src/util.ts'));

    const jwtServicePath = 'src/main/java/com/example/auth/JwtService.java';
    assert.ok(
      data.edges.some(
        (item) =>
          item.source === 'src/main/java/com/example/auth/AuthGuard.java' &&
          item.target === jwtServicePath,
      ),
      'Java same-package reference edge should exist',
    );
    assert.ok(
      data.edges.some(
        (item) =>
          item.source === 'src/main/java/com/example/api/Routes.java' &&
          item.target === 'src/main/java/com/example/auth/AuthGuard.java',
      ),
      'Java import edge should exist',
    );
    assert.ok(byPath.get(jwtServicePath).imports.includes('src/main/java/com/example/config/AppConfig.java'));
    assert.ok(byPath.get(jwtServicePath).imports.includes('src/main/java/com/example/auth/TokenStore.java'));

    const todos = byPath.get('src/util.ts').todos;
    assert.equal(todos.length, 1);
    assert.match(todos[0].text, /TODO/);

    const newTodo = byPath.get('src/new.ts').todos[0];
    assert.equal(newTodo.severity, 'high');

    assert.equal(data.meta.reviewOrder.length, 6);
    assert.ok(data.meta.reviewOrder.includes('src/new.ts'));
    assert.ok(data.meta.reviewOrder.includes('src/util.ts'));
    assert.ok(data.meta.stats.impactedFiles >= 7);
  } finally {
    cleanup(dir);
  }
});

test('scope resolution supports staged, range and last commit', () => {
  const dir = seedRepo();
  try {
    write(dir, 'src/util.ts', 'export function help() { return 1; }\n');
    run(dir, 'git', ['add', 'src/util.ts']);
    const repo = new GitRepo(dir);

    const staged = resolveScope(repo, { staged: true });
    assert.equal(staged.mode, 'staged');
    assert.match(staged.label, /暂存区/);

    const last = resolveScope(repo, { last: true });
    assert.equal(last.mode, 'rev');
    assert.ok(last.newRef);

    const range = resolveScope(repo, { range: 'HEAD..HEAD' });
    assert.equal(range.mode, 'rev');
    assert.equal(range.baseRef, repo.head);
  } finally {
    cleanup(dir);
  }
});

test('annotation merge and prior review state preservation', () => {
  const dir = seedRepo();
  try {
    write(dir, 'src/util.ts', 'export function help() { return 1; }\n');
    const repo = new GitRepo(dir);
    const data = buildReviewData(repo, { untracked: true });
    applyAnnotations(data, {
      meta: { overallSummary: 'Agent 总结' },
      nodes: {
        'src/util.ts': {
          summary: '精简了 help 实现',
          impactAnalysis: '调用方无需调整',
          todos: ['补一个单测'],
        },
      },
    });
    const util = data.nodes.find((node) => node.path === 'src/util.ts');
    assert.equal(data.meta.overallSummary, 'Agent 总结');
    assert.equal(util.summary, '精简了 help 实现');
    assert.equal(util.summarySource, 'agent');
    assert.equal(util.todos.length, 1);
    assert.equal(util.todos[0].source, 'agent');

    util.todos[0].completed = true;
    util.reviewed = true;
    const reread = buildReviewData(repo, { untracked: true });
    applyAnnotations(reread, {
      nodes: { 'src/util.ts': { todos: ['补一个单测'] } },
    });
    mergePreviousState(reread, data);
    const merged = reread.nodes.find((node) => node.path === 'src/util.ts');
    assert.equal(merged.reviewed, true);
    assert.equal(merged.todos[0].completed, true);
  } finally {
    cleanup(dir);
  }
});

test('server serves data and persists todo/review state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-server-'));
  const dataPath = path.join(dir, 'data.json');
  const initial = {
    meta: {
      timestamp: '2026-01-01T00:00:00Z',
      branch: 'main',
      overallSummary: 'test',
      stats: { changedFiles: 1, impactedFiles: 0, additions: 1, deletions: 0, todos: 1 },
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
        todos: [{ id: 't1', text: 'todo', source: 'code_comment', completed: false }],
        diff: '',
      },
    ],
    edges: [],
  };
  await fsPromises.writeFile(dataPath, JSON.stringify(initial), 'utf8');
  const server = await startServer({ dataPath, port: 0, host: '127.0.0.1', open: false, quiet: true });
  try {
    assert.notEqual(server.port, 0);
    const health = await fetch(`${server.url}api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const data = await fetch(`${server.url}api/data`).then((response) => response.json());
    assert.equal(data.nodes[0].path, 'a.ts');

    const stateResponse = await fetch(`${server.url}api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'a.ts', todoId: 't1', completed: true, reviewed: true }),
    });
    assert.equal(stateResponse.status, 200);
    const saved = JSON.parse(await fsPromises.readFile(dataPath, 'utf8'));
    assert.equal(saved.nodes[0].todos[0].completed, true);
    assert.equal(saved.nodes[0].reviewed, true);

    const addResponse = await fetch(`${server.url}api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'a.ts', action: 'addTodo', text: 'manual note' }),
    });
    const added = await addResponse.json();
    assert.equal(added.todo.text, 'manual note');
    assert.equal(added.todo.source, 'manual');
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports the dependency scan cap with the real code-file count', () => {
  const dir = seedRepo();
  try {
    const repo = new GitRepo(dir);
    const capped = buildReviewData(repo, { worktree: true, maxScanFiles: 4 });
    assert.equal(capped.meta.scanLimit.truncated, true);
    assert.equal(capped.meta.scanLimit.limit, 4);
    assert.ok(capped.meta.scanLimit.codeFiles > 4, 'the real file count must be reported');
    assert.ok(capped.meta.scanLimit.scanned <= 4);
    assert.ok(
      capped.meta.warnings.some((warning) => /依赖扫描上限/.test(warning)),
      'the warning should name the cap and the real total',
    );

    const full = buildReviewData(repo, { worktree: true });
    assert.equal(full.meta.scanLimit.truncated, false);
    assert.equal(full.meta.scanLimit.limit, 15000);
  } finally {
    cleanup(dir);
  }
});
