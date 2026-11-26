import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-test-'));
  run(dir, 'git', ['init', '-q']);
  run(dir, 'git', ['config', 'user.email', 'test@example.com']);
  run(dir, 'git', ['config', 'user.name', 'diff-viz test']);
  return dir;
}

export function run(cwd, command, args, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    ...options,
  });
}

export function write(dir, relativePath, content) {
  const file = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function commitAll(dir, message = 'commit') {
  run(dir, 'git', ['add', '-A']);
  run(dir, 'git', ['commit', '-qm', message]);
}

export function cleanup(dir) {
  // Windows can briefly keep a directory locked after a child process exits
  // (file watchers / antivirus). Retry instead of failing the test.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(wait, 0, 0, 200);
    }
  }
}

// Every hub endpoint except /api/health needs the access token now; keep tests
// focused on behaviour by attaching it here.
export function hubFetch(server, pathname, init = {}) {
  const headers = { 'X-Diff-Viz-Token': server.token, ...(init.headers ?? {}) };
  return fetch(`${server.url}${pathname}`, { ...init, headers });
}
