import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureGitExcluded, isIgnored, GitRepo } from '../src/git.mjs';
import { scanRepository } from '../src/deps.mjs';
import { cleanup, commitAll, makeTempRepo, run, write } from './helpers.mjs';

test('ensureGitExcluded hides generated files without touching .gitignore', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'a.ts', 'export const a = 1;\n');
    commitAll(dir, 'init');

    const first = ensureGitExcluded(dir, '.diff-review-data.json');
    assert.equal(first.changed, true);
    assert.equal(isIgnored(dir, '.diff-review-data.json'), true);

    write(dir, '.diff-review-data.json', '{"meta":{}}');
    assert.equal(run(dir, 'git', ['status', '--porcelain']).trim(), '');
    assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);

    const second = ensureGitExcluded(dir, '.diff-review-data.json');
    assert.equal(second.changed, false);

    const exclude = fs.readFileSync(path.join(dir, '.git/info/exclude'), 'utf8');
    assert.equal(exclude.split('\n').filter((line) => line.trim() === '/.diff-review-data.json').length, 1);
  } finally {
    cleanup(dir);
  }
});

test('readFilesAt batches blob reads and reports missing paths', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'src/a.ts', 'export const a = 1;\n');
    write(dir, 'src/b.ts', 'export const b = 1;\n');
    commitAll(dir, 'init');
    const first = run(dir, 'git', ['rev-parse', 'HEAD']).trim();
    write(dir, 'src/a.ts', 'export const a = 2;\n');
    commitAll(dir, 'second');
    const second = run(dir, 'git', ['rev-parse', 'HEAD']).trim();

    const repo = new GitRepo(dir);
    const atFirst = repo.readFilesAt(first, ['src/a.ts', 'src/b.ts', 'src/missing.ts']);
    assert.equal(atFirst.get('src/a.ts').toString('utf8'), 'export const a = 1;\n');
    assert.equal(atFirst.get('src/b.ts').toString('utf8'), 'export const b = 1;\n');
    assert.equal(atFirst.get('src/missing.ts'), null);

    const atSecond = repo.readFilesAt(second, ['src/a.ts']);
    assert.equal(atSecond.get('src/a.ts').toString('utf8'), 'export const a = 2;\n');
  } finally {
    cleanup(dir);
  }
});

test('dependency scan at a commit does not spawn git show per file', () => {
  const dir = makeTempRepo();
  try {
    for (let index = 0; index < 12; index += 1) {
      write(dir, `src/m${index}.ts`, `export const m${index} = ${index};\n`);
    }
    commitAll(dir, 'init');
    const commit = run(dir, 'git', ['rev-parse', 'HEAD']).trim();

    const repo = new GitRepo(dir);
    const showCalls = [];
    const original = repo.show.bind(repo);
    repo.show = (ref, filePath) => {
      showCalls.push(filePath);
      return original(ref, filePath);
    };
    const scan = scanRepository(repo, { gitRef: commit });
    assert.ok(scan.files.has('src/m0.ts'));
    assert.ok(scan.files.has('src/m11.ts'));
    // Only the tsconfig/go.mod probes fall back to `git show`; source files
    // come from one `cat-file --batch` call per chunk.
    assert.ok(showCalls.length <= 5, `unexpected git show calls: ${showCalls.join(', ')}`);
  } finally {
    cleanup(dir);
  }
});
