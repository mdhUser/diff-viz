import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { attachComments, fetchPullComments } from '../src/comments.mjs';
import { detectProvider } from '../src/remotes.mjs';

async function mockServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function json(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

test('maps GitHub inline and general comments', async () => {
  const server = await mockServer((req, res) => {
    if ((req.url || '').includes('/pulls/7/comments')) {
      json(res, [
        {
          id: 11,
          path: 'feature.ts',
          line: 3,
          side: 'RIGHT',
          body: '这个分支要加空值判断',
          user: { login: 'alice' },
          created_at: '2026-11-22T10:00:00Z',
          html_url: 'https://github.com/acme/demo/pull/7#discussion_r11',
        },
        {
          id: 12,
          path: 'feature.ts',
          original_line: 2,
          line: null,
          body: '旧行评论',
          user: { login: 'bob' },
          created_at: '2026-11-22T10:01:00Z',
        },
      ]);
      return;
    }
    if ((req.url || '').includes('/issues/7/comments')) {
      json(res, [
        {
          id: 21,
          body: '整体来看没问题',
          user: { login: 'carol' },
          created_at: '2026-11-22T09:00:00Z',
          html_url: 'https://github.com/acme/demo/pull/7#issuecomment-21',
        },
      ]);
      return;
    }
    json(res, []);
  });
  try {
    const info = detectProvider('https://github.com/acme/demo.git', {
      DIFF_VIZ_GITHUB_API_URL: server.url,
    });
    const { comments, warnings } = await fetchPullComments(info, 7, { env: {} });
    assert.deepEqual(warnings, []);
    assert.equal(comments.length, 3);
    const inline = comments.find((comment) => comment.id === 'github:11');
    assert.equal(inline.kind, 'inline');
    assert.equal(inline.path, 'feature.ts');
    assert.equal(inline.line, 3);
    assert.equal(inline.author, 'alice');
    assert.equal(inline.resolved, null);
    const outdated = comments.find((comment) => comment.id === 'github:12');
    assert.equal(outdated.outdated, true);
    assert.equal(outdated.line, 2);
    const general = comments.find((comment) => comment.kind === 'general');
    assert.equal(general.path, '');
    assert.equal(general.author, 'carol');
    // Sorted by createdAt.
    assert.deepEqual(comments.map((comment) => comment.author), ['carol', 'alice', 'bob']);
  } finally {
    await server.close();
  }
});

test('maps GitLab notes, skips system notes and keeps resolved state', async () => {
  const server = await mockServer((req, res) => {
    assert.match(req.url || '', /\/merge_requests\/9\/notes/);
    json(res, [
      {
        id: 31,
        body: '这里建议用新接口',
        system: false,
        resolvable: true,
        resolved: false,
        author: { name: '毛狄辉', username: 'maodihui' },
        created_at: '2026-11-22T08:00:00Z',
        position: { new_path: 'src/a.ts', new_line: 12, old_path: 'src/a.ts', old_line: 10 },
        discussion_id: 'disc-1',
      },
      { id: 32, body: 'changed the description', system: true },
      {
        id: 33,
        body: '整体评论',
        system: false,
        resolvable: false,
        resolved: false,
        author: { name: 'Bob' },
        created_at: '2026-11-22T09:00:00Z',
      },
    ]);
  });
  try {
    const info = detectProvider('https://gitlab.example.com/acme/demo.git', {
      DIFF_VIZ_GITLAB_API_URL: server.url,
    });
    const { comments, warnings } = await fetchPullComments(info, 9, { env: {} });
    assert.deepEqual(warnings, []);
    assert.equal(comments.length, 2);
    const inline = comments.find((comment) => comment.kind === 'inline');
    assert.equal(inline.path, 'src/a.ts');
    assert.equal(inline.line, 12);
    assert.equal(inline.resolved, false);
    assert.equal(inline.threadId, 'disc-1');
    assert.match(inline.url, /#note_31$/);
    const general = comments.find((comment) => comment.kind === 'general');
    assert.equal(general.path, '');
    // General notes are not resolvable, so no resolved state is reported.
    assert.equal(general.resolved, null);
  } finally {
    await server.close();
  }
});

test('comment fetch failures become warnings instead of failing the review', async () => {
  const server = await mockServer((req, res) => json(res, { message: 'Forbidden' }, 403));
  try {
    const info = detectProvider('https://github.com/acme/demo.git', {
      DIFF_VIZ_GITHUB_API_URL: server.url,
    });
    const { comments, warnings } = await fetchPullComments(info, 7, { env: {} });
    assert.equal(comments.length, 0);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((warning) => warning.includes('评论')));
  } finally {
    await server.close();
  }
});

test('attaches comment counters to matching nodes and meta', () => {
  const data = {
    nodes: [
      { id: 'a.ts', path: 'a.ts', oldPath: 'old-a.ts' },
      { id: 'b.ts', path: 'b.ts' },
    ],
    meta: { pull: { number: 7, title: 'x' }, stats: {} },
  };
  attachComments(data, [
    { path: 'a.ts', resolved: false },
    { path: 'a.ts', resolved: true },
    { path: 'old-a.ts', resolved: false },
    { path: 'b.ts', resolved: null },
    { path: '', resolved: false },
  ]);
  assert.equal(data.comments.length, 5);
  assert.equal(data.nodes[0].reviewComments, 3);
  assert.equal(data.nodes[0].reviewCommentUnresolved, 2);
  assert.equal(data.nodes[1].reviewComments, 1);
  assert.equal(data.nodes[1].reviewCommentUnresolved, 0);
  assert.equal(data.meta.pull.commentCount, 5);
  assert.equal(data.meta.pull.unresolvedCommentCount, 3);
  assert.equal(data.meta.stats.comments, 5);
});
