import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startHub } from '../src/hub.mjs';
import {
  checkRequestTrust,
  extractToken,
  hostAllowlist,
  parseHostname,
  readOrCreateToken,
  tokenMatches,
  tokenPath,
} from '../src/security.mjs';
import { cleanup, hubFetch } from './helpers.mjs';

function rawRequest(port, { path: requestPath = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, method, headers },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-security-'));
}

test('host parsing drops the port and unwraps IPv6', () => {
  assert.equal(parseHostname('127.0.0.1:5173'), '127.0.0.1');
  assert.equal(parseHostname('[::1]:5173'), '::1');
  assert.equal(parseHostname('LOCALHOST'), 'localhost');
  assert.equal(parseHostname(''), null);
  assert.equal(parseHostname('[broken'), null);
});

test('host allowlist pins loopback names and honors DIFF_VIZ_ALLOWED_HOSTS', () => {
  const names = hostAllowlist('127.0.0.1', { extra: 'dev.internal, 10.0.0.5' });
  assert.ok(names.has('localhost'));
  assert.ok(names.has('127.0.0.1'));
  assert.ok(names.has('::1'));
  assert.ok(names.has('dev.internal'));
  assert.ok(!names.has('evil.example'));
});

test('trust check blocks a rebound Host header and a foreign Origin', () => {
  const hostnames = hostAllowlist('127.0.0.1', { extra: '' });
  const allowed = { headers: { host: '127.0.0.1:5173' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(checkRequestTrust(allowed, { hostnames }), null);

  const rebound = { headers: { host: 'evil.example:5173' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.match(checkRequestTrust(rebound, { hostnames }), /不在允许列表/);

  const foreignOrigin = {
    headers: { host: '127.0.0.1:5173', origin: 'https://evil.example' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.match(checkRequestTrust(foreignOrigin, { hostnames }), /Origin/);

  const sameOrigin = {
    headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(checkRequestTrust(sameOrigin, { hostnames }), null);
});

test('token file is owner-only and stable across reads', () => {
  const home = tempHome();
  try {
    const first = readOrCreateToken(home);
    assert.equal(first.length, 48);
    assert.equal(readOrCreateToken(home), first);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(tokenPath(home)).mode & 0o777, 0o600);
    }
    assert.equal(tokenMatches(first, first), true);
    assert.equal(tokenMatches(first, `${first}0`), false);
    assert.equal(tokenMatches(first, ''), false);
    assert.equal(tokenMatches(null, 'anything'), true, 'a disabled token accepts everything');
  } finally {
    cleanup(home);
  }
});

test('token is accepted from header, bearer, query string and cookie', () => {
  const url = new URL('http://127.0.0.1:5173/api/hub?token=abc');
  assert.equal(extractToken({ headers: { 'x-diff-viz-token': 'header-token' } }, url), 'header-token');
  assert.equal(extractToken({ headers: { authorization: 'Bearer bearer-token' } }, url), 'bearer-token');
  assert.equal(extractToken({ headers: {} }, url), 'abc');
  assert.equal(
    extractToken(
      { headers: { cookie: 'other=1; diff_viz_token=cookie-token' } },
      new URL('http://127.0.0.1:5173/api/hub'),
    ),
    'cookie-token',
  );
  assert.equal(extractToken({ headers: {} }, new URL('http://127.0.0.1:5173/api/hub')), null);
});

test('hub rejects a rebound Host and unauthenticated API calls', async () => {
  const home = tempHome();
  const hub = await startHub({ port: 0, host: '127.0.0.1', quiet: true, home });
  try {
    assert.ok(hub.token, 'the hub should start with a token');

    // The health probe stays public so a hub with an unknown token is detectable.
    const health = await fetch(`${hub.url}api/health`);
    assert.equal(health.status, 200);

    const unauthenticated = await fetch(`${hub.url}api/hub`);
    assert.equal(unauthenticated.status, 401);

    assert.equal((await hubFetch(hub, 'api/hub')).status, 200);
    assert.equal((await fetch(`${hub.url}api/hub?token=${hub.token}`)).status, 200);

    const rebound = await rawRequest(hub.port, {
      path: '/api/hub',
      headers: { Host: 'evil.example:5173', 'X-Diff-Viz-Token': hub.token },
    });
    assert.equal(rebound.status, 403);
    assert.match(rebound.body, /Host/);
  } finally {
    await hub.close();
    cleanup(home);
  }
});

test('the page URL trades its token for an HttpOnly cookie', async () => {
  const home = tempHome();
  const hub = await startHub({ port: 0, host: '127.0.0.1', quiet: true, home });
  try {
    const page = await fetch(`${hub.url}?token=${hub.token}`);
    assert.equal(page.status, 200);
    const setCookie = page.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /diff_viz_token=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const cookie = setCookie.split(';')[0];
    const withCookie = await fetch(`${hub.url}api/hub`, { headers: { cookie } });
    assert.equal(withCookie.status, 200);

    // A page request without a token must not mint one.
    const bare = await fetch(`${hub.url}`);
    assert.equal(bare.headers.get('set-cookie'), null);
  } finally {
    await hub.close();
    cleanup(home);
  }
});

test('a running hub records its token so the CLI can reuse it', async () => {
  const home = tempHome();
  const first = await startHub({ port: 0, host: '127.0.0.1', quiet: true, home });
  const firstToken = first.token;
  const registry = JSON.parse(fs.readFileSync(path.join(home, 'hub.json'), 'utf8'));
  assert.equal(registry.token, firstToken);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(home, 'hub.json')).mode & 0o777, 0o600);
  }

  // Restarting on a fresh port keeps the token, so previously printed links and
  // bookmarked pages survive a hub restart.
  await first.close();
  const second = await startHub({ port: 0, host: '127.0.0.1', quiet: true, home });
  try {
    assert.equal(second.token, firstToken);
  } finally {
    await second.close();
    cleanup(home);
  }
});
