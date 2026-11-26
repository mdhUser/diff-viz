import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from './i18n.mjs';
import { ensurePrivateDir } from './util.mjs';

// Binding to 127.0.0.1 keeps the wider network out, but it does not stop a
// malicious page from pointing its own domain at loopback (DNS rebinding): the
// browser then treats the request as same-origin and can read every response.
// Two cheap checks close that hole:
//
//   1. the Host header must be a name we actually serve (rebinding always
//      carries the attacker's domain in Host);
//   2. API calls need a token that only the local state directory knows.
//
// The token lives in `<home>/token` (0600) so links keep working across hub
// restarts, and is delivered to the browser through the URL the CLI prints.
const TOKEN_FILE = 'token';
const COOKIE_NAME = 'diff_viz_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const LOOPBACK_HOSTNAMES = ['127.0.0.1', '::1', 'localhost'];

export function parseHostname(header) {
  if (typeof header !== 'string' || !header.trim()) return null;
  let host = header.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return null;
    return host.slice(1, end) || null;
  }
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  return host || null;
}

export function normalizeHostname(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

export function isLoopbackAddress(address) {
  const value = normalizeHostname(String(address || ''));
  return (
    value === '::1' ||
    value === '127.0.0.1' ||
    value.startsWith('127.') ||
    value === '::ffff:127.0.0.1'
  );
}

// `--host 0.0.0.0` is documented as an explicit risk; when a user opts in we
// still serve the machine's own addresses instead of rejecting every request.
export function hostAllowlist(host, { extra = process.env.DIFF_VIZ_ALLOWED_HOSTS } = {}) {
  const names = new Set(LOOPBACK_HOSTNAMES);
  const bound = normalizeHostname(host);
  if (bound && bound !== '0.0.0.0' && bound !== '::') names.add(bound);
  if (!bound || bound === '0.0.0.0' || bound === '::') {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address?.address) names.add(normalizeHostname(address.address));
      }
    }
    const machine = normalizeHostname(os.hostname());
    if (machine) {
      names.add(machine);
      names.add(`${machine}.local`);
    }
  }
  for (const entry of String(extra || '').split(',')) {
    const name = normalizeHostname(entry);
    if (name) names.add(name);
  }
  return names;
}

// Returns an error message, or null when the request may proceed. Missing Host
// is tolerated only for loopback sockets, which no browser does.
export function checkRequestTrust(req, { hostnames }) {
  const hostHeader = req.headers?.host;
  if (typeof hostHeader === 'string' && hostHeader.trim()) {
    const hostname = parseHostname(hostHeader);
    if (!hostname) return t('Host 头格式不正确：{host}', { host: hostHeader });
    if (!hostnames.has(hostname)) {
      return t('Host「{host}」不在允许列表内（已拦截 DNS rebinding 请求）。', { host: hostname });
    }
  } else if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return t('缺少 Host 头。');
  }

  const origin = req.headers?.origin;
  if (typeof origin === 'string' && origin && origin !== 'null') {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return t('Origin 头格式不正确：{origin}', { origin });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return t('Origin 协议不被允许：{origin}', { origin });
    }
    if (!hostnames.has(normalizeHostname(parsed.hostname))) {
      return t('Origin「{origin}」不在允许列表内。', { origin });
    }
  }
  return null;
}

export function tokenPath(home) {
  return path.join(home, TOKEN_FILE);
}

// Read the persistent token, creating it on first run. `DIFF_VIZ_TOKEN` wins so
// container / CI setups can pin the value; an inherited token is not written
// back to disk.
export function readOrCreateToken(home) {
  const fromEnv = process.env.DIFF_VIZ_TOKEN;
  if (fromEnv) return fromEnv.trim();
  const file = tokenPath(home);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* first run */
  }
  const token = crypto.randomBytes(24).toString('hex');
  ensurePrivateDir(home);
  try {
    fs.writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch {
    /* a read-only home still gets a working, process-local token */
  }
  return token;
}

export function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseCookies(header) {
  const jar = {};
  if (typeof header !== 'string') return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    jar[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function extractToken(req, url) {
  const header = req.headers?.['x-diff-viz-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }
  const query = url?.searchParams?.get('token');
  if (query) return query;
  const cookie = parseCookies(req.headers?.cookie)[COOKIE_NAME];
  return cookie || null;
}

// A valid `?token=` on the page URL is traded for an HttpOnly cookie so later
// navigations in the same browser work without the token in the address bar.
export function tokenCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
}
