import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EN, languageFromArgv, localizeRangeLabel, setLanguage, t } from '../src/i18n.mjs';
import { run } from './helpers.mjs';

const BIN = path.resolve('bin/diff-viz.mjs');
const NODE = process.execPath;

function runCli(args, env = {}) {
  return run(process.cwd(), NODE, [BIN, ...args], {
    env: { ...process.env, ...env },
  });
}

function runCliError(args, env = {}, cwd = process.cwd()) {
  try {
    run(cwd, NODE, [BIN, ...args], { env: { ...process.env, ...env } });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  throw new Error('expected the CLI to fail');
}

test('language resolution: --lang > DIFF_VIZ_LANG > English default', () => {
  assert.equal(languageFromArgv([], {}), 'en');
  assert.equal(languageFromArgv([], { DIFF_VIZ_LANG: 'zh' }), 'zh');
  assert.equal(languageFromArgv(['--lang', 'zh'], { DIFF_VIZ_LANG: 'en' }), 'zh');
  assert.equal(languageFromArgv(['--lang=en'], { DIFF_VIZ_LANG: 'zh' }), 'en');
  assert.throws(() => languageFromArgv(['--lang', 'fr'], {}), /Unknown language: fr/);
});

test('CLI help defaults to English and --lang zh switches it back', () => {
  const english = runCli(['--help'], { DIFF_VIZ_LANG: 'en' });
  assert.match(english, /local code-change review visualizer/);
  assert.match(english, /--lang <en\|zh>/);
  assert.doesNotMatch(english, /用法|本地代码变更/);

  const chinese = runCli(['--lang', 'zh', '--help'], { DIFF_VIZ_LANG: 'en' });
  assert.match(chinese, /本地代码变更可视化 Review 工具/);
  assert.match(chinese, /用法:/);
});

test('CLI errors are English by default', () => {
  const unknown = runCliError(['nope'], { DIFF_VIZ_LANG: 'en' });
  assert.match(unknown, /Unknown command: nope/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-i18n-'));
  try {
    const notGit = runCliError([], { DIFF_VIZ_LANG: 'en' }, dir);
    assert.match(notGit, /not a Git repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every t() call has an English dictionary entry', () => {
  const missing = new Set();
  for (const file of fs.readdirSync('src').filter((name) => name.endsWith('.mjs'))) {
    if (file === 'i18n.mjs') continue;
    const source = fs.readFileSync(path.join('src', file), 'utf8');
    const pattern = /\bt\('((?:\\.|[^'\\])*)'/g;
    let match;
    while ((match = pattern.exec(source))) {
      let key;
      try {
        key = eval(`'${match[1]}'`);
      } catch {
        continue;
      }
      if (!(key in EN)) missing.add(key);
    }
  }
  assert.deepEqual([...missing], [], `missing English translations: ${[...missing].join(' | ')}`);
});

test('range labels are localized for CLI output', () => {
  setLanguage('en');
  assert.equal(localizeRangeLabel('最近提交 · abc123'), 'Latest commit · abc123');
  assert.equal(localizeRangeLabel('暂存区 · abc123'), 'Staged · abc123');
  setLanguage('zh');
  assert.equal(localizeRangeLabel('最近提交 · abc123'), '最近提交 · abc123');
  assert.equal(t('注册 Review 到 hub 失败'), '注册 Review 到 hub 失败');
});
