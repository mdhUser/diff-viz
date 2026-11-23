import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import {
  detectProvider,
  detectRepoProvider,
  fetchPullRefs,
  getPullRequest,
  listPullRequests,
  parsePullNumber,
  parseRemoteUrl,
  preparePullReview,
} from '../src/remotes.mjs';
import { cleanup, commitAll, makeTempRepo, run, write } from './helpers.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function mockServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    handler(req, res);
  });
  const url = await listen(server);
  return {
    url,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function makeRemoteRepo() {
  const root = makeTempRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-remote-'));
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
  return { root, remote, defaultBranch, featureSha, repo: new GitRepo(root) };
}

test('parses scp-like and URL remotes', () => {
  assert.deepEqual(parseRemoteUrl('git@github.com:acme/demo.git'), {
    host: 'github.com',
    path: 'acme/demo',
    raw: 'git@github.com:acme/demo.git',
  });
  assert.equal(parseRemoteUrl('ssh://git@gitlab.example.com/group/sub/proj.git').path, 'group/sub/proj');
  assert.equal(parseRemoteUrl('https://github.com/acme/demo').host, 'github.com');
  assert.equal(parseRemoteUrl('/tmp/local-repo'), null);
  assert.equal(parseRemoteUrl('not a url'), null);
});

test('detects GitHub, GitLab and self-hosted providers', () => {
  assert.equal(detectProvider('git@github.com:acme/demo.git').provider, 'github');
  assert.equal(detectProvider('https://gitlab.com/acme/demo.git').provider, 'gitlab');
  assert.equal(detectProvider('git@git.company.com:acme/demo.git'), null);
  assert.equal(
    detectProvider('git@git.company.com:acme/demo.git', { DIFF_VIZ_PROVIDER: 'gitlab' }).provider,
    'gitlab',
  );
  assert.equal(
    detectProvider('git@code.acme.com:acme/demo.git', { DIFF_VIZ_GITLAB_HOSTS: 'code.acme.com' }).provider,
    'gitlab',
  );
  assert.equal(
    detectProvider('git@github.example.com:acme/demo.git', { DIFF_VIZ_GITHUB_HOSTS: 'github.example.com' }).provider,
    'github',
  );
});

test('parses PR/MR numbers from numbers and URLs', () => {
  assert.equal(parsePullNumber('123'), 123);
  assert.equal(parsePullNumber('https://github.com/acme/demo/pull/42'), 42);
  assert.equal(parsePullNumber('https://gitlab.com/acme/demo/-/merge_requests/7'), 7);
  assert.throws(() => parsePullNumber('https://example.com/foo'), /无法从 URL 解析/);
});

test('lists GitHub pulls with auth headers and maps fields', async () => {
  const server = await mockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify([
        {
          number: 12,
          title: 'feat: order flow',
          user: { login: 'alice' },
          head: { ref: 'feature/x', sha: 'a'.repeat(40) },
          base: { ref: 'main', sha: 'b'.repeat(40) },
          updated_at: '2026-11-20T10:00:00Z',
          html_url: 'https://github.com/acme/demo/pull/12',
          draft: false,
          state: 'open',
        },
      ]),
    );
  });
  try {
    const info = detectProvider('https://github.com/acme/demo.git', {
      DIFF_VIZ_GITHUB_API_URL: server.url,
      GITHUB_TOKEN: 'secret-token',
    });
    const pulls = await listPullRequests(info, { env: { GITHUB_TOKEN: 'secret-token' } });
    assert.equal(pulls.length, 1);
    assert.deepEqual(pulls[0], {
      provider: 'github',
      number: 12,
      title: 'feat: order flow',
      author: 'alice',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      sourceSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      updatedAt: '2026-11-20T10:00:00Z',
      url: 'https://github.com/acme/demo/pull/12',
      draft: false,
      state: 'open',
    });
    assert.equal(server.requests[0].headers.authorization, 'Bearer secret-token');
    assert.match(server.requests[0].url, /\/repos\/acme\/demo\/pulls\?/);
  } finally {
    await server.close();
  }
});

test('lists GitLab merge requests with PRIVATE-TOKEN', async () => {
  const server = await mockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify([
        {
          iid: 9,
          title: 'fix: fleet sms',
          author: { name: 'Bob' },
          source_branch: 'fix/fleet',
          target_branch: 'main',
          sha: 'c'.repeat(40),
          diff_refs: { base_sha: 'd'.repeat(40) },
          updated_at: '2026-11-21T08:00:00Z',
          web_url: 'https://gitlab.example.com/acme/demo/-/merge_requests/9',
          draft: true,
          state: 'opened',
        },
      ]),
    );
  });
  try {
    const info = detectProvider('git@gitlab.example.com:acme/demo.git', {
      DIFF_VIZ_GITLAB_API_URL: server.url,
    });
    const pulls = await listPullRequests(info, { env: { GITLAB_TOKEN: 'glpat' } });
    assert.equal(pulls[0].number, 9);
    assert.equal(pulls[0].author, 'Bob');
    assert.equal(pulls[0].draft, true);
    assert.equal(server.requests[0].headers['private-token'], 'glpat');
    assert.match(server.requests[0].url, /\/projects\/acme%2Fdemo\/merge_requests\?/);
  } finally {
    await server.close();
  }
});

test('turns auth failures into actionable errors', async () => {
  const server = await mockServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Bad credentials' }));
  });
  try {
    const info = detectProvider('https://github.com/acme/demo.git', {
      DIFF_VIZ_GITHUB_API_URL: server.url,
    });
    await assert.rejects(
      () => listPullRequests(info, { env: {} }),
      (error) => /GITHUB_TOKEN/.test(error.message) && /鉴权失败/.test(error.message),
    );
  } finally {
    await server.close();
  }
});

test('fetches PR refs and prepares a base...head range', async () => {
  const fixture = makeRemoteRepo();
  const server = await mockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        number: 7,
        title: 'feat: add feature',
        user: { login: 'alice' },
        head: { ref: 'feature', sha: fixture.featureSha },
        base: { ref: fixture.defaultBranch, sha: fixture.featureSha },
        html_url: 'https://github.com/acme/demo/pull/7',
        state: 'open',
      }),
    );
  });
  try {
    const env = {
      DIFF_VIZ_PROVIDER: 'github',
      DIFF_VIZ_REMOTE_URL: 'https://github.com/acme/demo.git',
      DIFF_VIZ_GITHUB_API_URL: server.url,
    };
    const info = detectRepoProvider(fixture.repo, { env });
    assert.equal(info.provider, 'github');
    const pull = await getPullRequest(info, 7, { env });
    assert.equal(pull.title, 'feat: add feature');
    const refs = fetchPullRefs(fixture.repo, info, 7, fixture.defaultBranch);
    assert.ok(fixture.repo.revParse(refs.headRef));
    assert.ok(fixture.repo.revParse(refs.baseRef));

    const prepared = await preparePullReview(fixture.repo, { number: 7, env });
    assert.equal(prepared.pull.baseBranch, fixture.defaultBranch);
    assert.match(prepared.range, /\.\.\./);
    const data = buildReviewData(fixture.repo, { range: prepared.range });
    assert.ok(data.nodes.some((node) => node.path === 'feature.ts' && node.status === 'added'));
  } finally {
    await server.close();
    cleanup(fixture.root);
    cleanup(fixture.remote);
  }
});
