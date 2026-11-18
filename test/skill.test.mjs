import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, run } from './helpers.mjs';
import { installSkill, resolveSkillsRoot, skillTargetPath } from '../src/skill.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'diff-viz.mjs');
const source = path.join(root, 'SKILL.md');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-skill-test-'));
}

test('resolves agent skill roots for user and project scope', () => {
  // path.resolve adds the current drive on Windows, so build the expected path
  // the same way instead of hard-coding a POSIX path.
  const project = path.join(os.tmpdir(), 'diff-viz-project');
  assert.equal(
    resolveSkillsRoot({ agent: 'dsh', scope: 'user' }),
    path.join(os.homedir(), '.dsh', 'skills'),
  );
  assert.equal(
    resolveSkillsRoot({ agent: 'claude', scope: 'project', cwd: project }),
    path.resolve(project, '.claude', 'skills'),
  );
  assert.equal(
    resolveSkillsRoot({ agent: 'cursor', scope: 'project', cwd: project }),
    path.resolve(project, '.cursor', 'skills'),
  );
  assert.equal(
    skillTargetPath({ agent: 'agents', scope: 'user' }),
    path.join(os.homedir(), '.agents', 'skills', 'diff-viz', 'SKILL.md'),
  );
  assert.equal(
    resolveSkillsRoot({ dir: 'custom-skills', cwd: project }),
    path.resolve(project, 'custom-skills'),
  );
  assert.throws(() => resolveSkillsRoot({ agent: 'unknown' }), /未知 agent/);
  assert.throws(() => resolveSkillsRoot({ agent: 'dsh', scope: 'global' }), /未知 scope/);
});

test('installs a symlinked thin skill and is idempotent', () => {
  const dir = makeTempDir();
  try {
    const result = installSkill({ source, dir, cwd: dir });
    assert.equal(result.status, 'installed');
    if (process.platform === 'win32') {
      // Windows needs developer mode for symlinks, so the installer copies.
      assert.equal(result.method, 'copy');
      assert.ok(fs.lstatSync(result.target).isFile());
    } else {
      assert.equal(result.method, 'symlink');
      assert.ok(fs.lstatSync(result.target).isSymbolicLink());
      assert.equal(path.resolve(path.dirname(result.target), fs.readlinkSync(result.target)), source);
    }
    assert.equal(
      path.join(dir, 'diff-viz', 'SKILL.md'),
      result.target,
    );

    const again = installSkill({ source, dir, cwd: dir });
    assert.equal(again.status, 'unchanged');
  } finally {
    cleanup(dir);
  }
});

test('copies the skill when requested', () => {
  const dir = makeTempDir();
  try {
    const result = installSkill({ source, dir, cwd: dir, copy: true });
    assert.equal(result.method, 'copy');
    assert.ok(fs.lstatSync(result.target).isFile());
    assert.match(fs.readFileSync(result.target, 'utf8'), /^---\r?\nname: diff-viz/m);
  } finally {
    cleanup(dir);
  }
});

test('refuses to overwrite without force and replaces with force', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'diff-viz', 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'old content\n');

    assert.throws(() => installSkill({ source, dir, cwd: dir, copy: true }), /目标已存在/);
    const replaced = installSkill({ source, dir, cwd: dir, copy: true, force: true });
    assert.equal(replaced.status, 'replaced');
    assert.match(fs.readFileSync(target, 'utf8'), /^---\r?\nname: diff-viz/m);
  } finally {
    cleanup(dir);
  }
});

test('dry-run does not write anything', () => {
  const dir = makeTempDir();
  try {
    const result = installSkill({ source, dir, cwd: dir, dryRun: true });
    assert.equal(result.status, 'dry-run');
    assert.ok(!fs.existsSync(path.join(dir, 'diff-viz')));
  } finally {
    cleanup(dir);
  }
});

test('force can replace an old full skill directory', () => {
  const dir = makeTempDir();
  try {
    const oldSkill = path.join(dir, 'diff-viz');
    fs.mkdirSync(path.join(oldSkill, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(oldSkill, 'SKILL.md'), 'legacy\n');
    fs.writeFileSync(path.join(oldSkill, 'bin', 'diff-viz.mjs'), 'legacy\n');

    const result = installSkill({ source, dir, cwd: dir, copy: true, force: true });
    assert.equal(result.status, 'replaced');
    assert.ok(!fs.existsSync(path.join(oldSkill, 'bin')));
    assert.match(fs.readFileSync(result.target, 'utf8'), /^---\r?\nname: diff-viz/m);
  } finally {
    cleanup(dir);
  }
});

test('CLI skill install writes a thin copy', () => {
  const dir = makeTempDir();
  try {
    const skills = path.join(dir, 'skills');
    const output = run(dir, process.execPath, [
      bin,
      'skill',
      'install',
      '--dir',
      skills,
      '--copy',
    ]);
    assert.match(output, /已安装 diff-viz skill/);
    assert.ok(fs.existsSync(path.join(skills, 'diff-viz', 'SKILL.md')));
  } finally {
    cleanup(dir);
  }
});
