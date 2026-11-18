import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MAX_BUFFER = 1024 * 1024 * 512;

export function runGit(root, args, options = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: options.encoding === 'buffer' ? null : 'utf8',
    maxBuffer: MAX_BUFFER,
    input: options.input,
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr ? String(result.stderr).trim() : `git ${args.join(' ')} failed`;
    throw new Error(stderr);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ? String(result.stderr) : '',
  };
}

export function findRepoRoot(startDir) {
  const { stdout } = runGit(startDir, ['rev-parse', '--show-toplevel']);
  return stdout.trim();
}

export function gitPath(root, relative) {
  const result = runGit(root, ['rev-parse', '--git-path', relative], { allowFailure: true });
  const value = result.stdout.trim();
  if (result.status !== 0 || !value) return null;
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

export function isIgnored(root, relativePath) {
  const result = runGit(root, ['check-ignore', '-q', '--', relativePath], { allowFailure: true });
  return result.status === 0;
}

// Make a generated file invisible to `git status` without touching the user's
// .gitignore (and therefore without creating a commit). `.git/info/exclude` is
// local to the clone and works for worktrees too, since we ask Git for the path.
export function ensureGitExcluded(root, relativePath) {
  const rel = relativePath.split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return { changed: false, reason: 'outside' };
  if (isIgnored(root, rel)) return { changed: false, reason: 'already' };

  const pattern = `/${rel}`;
  const candidates = [gitPath(root, 'info/exclude'), path.join(root, '.git', 'info', 'exclude')].filter(
    Boolean,
  );

  for (const file of candidates) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const listed = existing
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) => line === pattern || line === rel);
      if (!listed) {
        const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(file, `${prefix}${pattern}\n`);
      }
      if (isIgnored(root, rel)) return { changed: !listed, file };
    } catch {
      /* try the next candidate */
    }
  }
  return { changed: false, reason: 'failed' };
}

export class GitRepo {
  constructor(root) {
    this.root = path.resolve(root);
    this._emptyTree = null;
    this._head = undefined;
  }

  run(args, options) {
    return runGit(this.root, args, options);
  }

  revParse(ref) {
    const result = this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true });
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
  }

  get head() {
    if (this._head === undefined) this._head = this.revParse('HEAD');
    return this._head;
  }

  get emptyTree() {
    if (this._emptyTree) return this._emptyTree;
    const { stdout } = this.run(['mktree'], { allowFailure: true });
    this._emptyTree = stdout.trim() || '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    return this._emptyTree;
  }

  branchName() {
    const result = this.run(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
    const value = result.stdout.trim();
    if (!value || value === 'HEAD') return this.head ? this.head.slice(0, 8) : 'unborn';
    return value;
  }

  isDirty() {
    const { stdout } = this.run(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], {
      allowFailure: true,
    });
    return stdout.length > 0;
  }

  mergeBase(a, b = 'HEAD') {
    const result = this.run(['merge-base', a, b], { allowFailure: true });
    return result.status === 0 ? result.stdout.trim() : null;
  }

  show(ref, filePath) {
    const result = this.run(['show', `${ref}:${filePath}`], { allowFailure: true, encoding: 'buffer' });
    if (result.status !== 0) return null;
    return result.stdout;
  }

  showIndex(filePath) {
    const result = this.run(['show', `:${filePath}`], { allowFailure: true, encoding: 'buffer' });
    if (result.status !== 0) return null;
    return result.stdout;
  }

  /**
   * Read many `<ref>:<path>` blobs with a single git process.
   *
   * Historical reviews scan every source file at a commit. Spawning `git show`
   * once per file made that take tens of seconds on a mid-size repo (2900 files
   * ≈ 43 s at ~15 ms/process); `cat-file --batch` turns it into a handful of
   * process launches. Chunked so a huge repo does not produce one giant buffer.
   */
  readFilesAt(ref, filePaths, { chunkSize = 400 } = {}) {
    const result = new Map();
    const batchable = [];
    for (const filePath of filePaths) {
      result.set(filePath, null);
      // A newline would split the batch query, so fall back to `git show`.
      if (filePath.includes('\n')) continue;
      batchable.push(filePath);
    }
    for (const filePath of filePaths.filter((item) => item.includes('\n'))) {
      result.set(filePath, this.show(ref, filePath));
    }
    for (let start = 0; start < batchable.length; start += chunkSize) {
      const chunk = batchable.slice(start, start + chunkSize);
      const input = `${chunk.map((filePath) => `${ref}:${filePath}`).join('\n')}\n`;
      const { stdout } = this.run(['cat-file', '--batch'], { input, encoding: 'buffer' });
      let position = 0;
      for (const filePath of chunk) {
        const headerEnd = stdout.indexOf(0x0a, position);
        if (headerEnd === -1) break;
        const header = stdout.subarray(position, headerEnd).toString('utf8');
        position = headerEnd + 1;
        if (header.endsWith(' missing')) continue;
        const separator = header.lastIndexOf(' ');
        const size = Number(header.slice(separator + 1));
        if (!Number.isFinite(size)) break;
        // header is `<oid> <type> <size>`; only blobs carry useful content.
        if (!header.includes(' blob ')) {
          position += size + 1;
          continue;
        }
        result.set(filePath, stdout.subarray(position, position + size));
        position += size + 1; // trailing LF after the payload
      }
    }
    return result;
  }

  listFiles({ includeUntracked = true } = {}) {
    const args = ['ls-files', '-z'];
    if (includeUntracked) args.push('--cached', '--others', '--exclude-standard');
    const { stdout } = this.run(args);
    return stdout.split('\0').filter(Boolean);
  }

  listUntracked() {
    const { stdout } = this.run(['ls-files', '--others', '--exclude-standard', '-z']);
    return stdout.split('\0').filter(Boolean);
  }

  listFilesAt(ref) {
    const { stdout } = this.run(['ls-tree', '-r', '--name-only', '-z', ref]);
    return stdout.split('\0').filter(Boolean);
  }

  commitInfo(ref) {
    const result = this.run(['log', '-1', '--pretty=%H%x1f%h%x1f%s%x1f%an%x1f%aI', ref], { allowFailure: true });
    if (result.status !== 0) return null;
    const [sha, short, subject, author, date] = result.stdout.trim().split('\x1f');
    return { sha, short, subject, author, date };
  }

  changedFilesSince(ref) {
    const { stdout } = this.run(['diff', '--name-only', '-z', ref, '--']);
    return stdout.split('\0').filter(Boolean);
  }

  logSubject(ref) {
    const result = this.run(['log', '-1', '--pretty=%s', ref], { allowFailure: true });
    return result.status === 0 ? result.stdout.trim() : '';
  }
}
