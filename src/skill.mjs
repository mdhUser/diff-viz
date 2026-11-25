import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SKILL_NAME = 'diff-viz';

// Where each agent looks for skills. `user` roots are absolute, `project`
// roots are relative to the project (repository) root.
export const AGENTS = {
  dsh: {
    label: 'DeepSeek Harness',
    userRoot: () => path.join(os.homedir(), '.dsh', 'skills'),
    projectRoot: path.join('.dsh', 'skills'),
  },
  claude: {
    label: 'Claude Code',
    userRoot: () => path.join(os.homedir(), '.claude', 'skills'),
    projectRoot: path.join('.claude', 'skills'),
  },
  cursor: {
    label: 'Cursor',
    userRoot: () => path.join(os.homedir(), '.cursor', 'skills'),
    projectRoot: path.join('.cursor', 'skills'),
  },
  agents: {
    label: 'Shared agents',
    userRoot: () => path.join(os.homedir(), '.agents', 'skills'),
    projectRoot: path.join('.agents', 'skills'),
  },
  antigravity: {
    label: 'Antigravity',
    userRoot: () => path.join(os.homedir(), '.gemini', 'config', 'skills'),
    projectRoot: path.join('.agents', 'skills'),
  },
};

const AGENT_ALIASES = {
  agy: 'antigravity',
};

export function normalizeAgentName(agent) {
  const key = String(agent ?? '').trim().toLowerCase();
  return AGENT_ALIASES[key] || key;
}

const SKILL_DIR_ENTRIES = new Set([
  'SKILL.md',
  'INSTALL.md',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'package.json',
  'bin',
  'src',
  'dist',
]);

export function agentNames() {
  return Object.keys(AGENTS);
}

export function resolveSkillsRoot({ agent = 'dsh', scope = 'user', dir, cwd = process.cwd() } = {}) {
  if (dir) return path.resolve(cwd, dir);
  const resolvedAgent = normalizeAgentName(agent);
  const entry = AGENTS[resolvedAgent];
  if (!entry) {
    throw new Error(`未知 agent：${agent}。可选：${agentNames().join(' / ')}`);
  }
  if (scope === 'user') return entry.userRoot();
  if (scope === 'project') return path.join(path.resolve(cwd), entry.projectRoot);
  throw new Error(`未知 scope：${scope}。可选：user / project`);
}

export function skillTargetPath({ agent, scope, dir, cwd } = {}) {
  return path.join(resolveSkillsRoot({ agent, scope, dir, cwd }), SKILL_NAME, 'SKILL.md');
}

function lstatSafe(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

function removeExistingSkillDir(skillDir) {
  const stat = fs.lstatSync(skillDir);
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(skillDir);
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error(`无法覆盖目标：${skillDir}`);
  }
  const entries = fs.readdirSync(skillDir);
  const looksLikeSkill = entries.length === 0 || (
    entries.includes('SKILL.md') && entries.every((entry) => SKILL_DIR_ENTRIES.has(entry))
  );
  if (!looksLikeSkill) {
    throw new Error(
      `目标目录不是空的 diff-viz skill 目录，拒绝覆盖：${skillDir}\n  请手动检查后删除，或换一个 --dir。`,
    );
  }
  fs.rmSync(skillDir, { recursive: true, force: true });
}

/**
 * Install the thin SKILL.md into an agent's skills directory.
 * The CLI itself is installed separately via npm; nothing else is copied.
 */
export function installSkill({
  source,
  agent = 'dsh',
  scope = 'user',
  dir,
  copy = false,
  force = false,
  dryRun = false,
  cwd = process.cwd(),
} = {}) {
  if (!source) throw new Error('缺少 SKILL.md 源文件路径。');
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) throw new Error(`找不到 SKILL.md：${sourcePath}`);

  // Windows needs developer mode for symlinks, so copy there by default.
  const preferCopy = copy || process.platform === 'win32';
  const resolvedAgent = dir ? agent : normalizeAgentName(agent);

  const target = skillTargetPath({ agent: resolvedAgent, scope, dir, cwd });
  const targetDir = path.dirname(target);
  const existing = lstatSafe(target);
  const existingDir = lstatSafe(targetDir);

  if (existing) {
    if (existing.isSymbolicLink()) {
      const linked = path.resolve(targetDir, fs.readlinkSync(target));
      if (linked === sourcePath) {
        return { status: 'unchanged', target, method: 'symlink', agent: resolvedAgent, scope };
      }
    } else if (existing.isFile() && preferCopy) {
      const same = fs.readFileSync(target, 'utf8') === fs.readFileSync(sourcePath, 'utf8');
      if (same) {
        return { status: 'unchanged', target, method: 'copy', agent: resolvedAgent, scope };
      }
    }
    if (!force) {
      throw new Error(`目标已存在：${target}\n  加 --force 覆盖，或先删除它。`);
    }
  }

  if (dryRun) {
    return { status: 'dry-run', target, method: preferCopy ? 'copy' : 'symlink', agent: resolvedAgent, scope };
  }

  // Replacing an old self-contained skill should remove its bin/src/dist too,
  // not just leave them next to the new thin SKILL.md.
  if (force && existingDir) {
    removeExistingSkillDir(targetDir);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  let method = preferCopy ? 'copy' : 'symlink';
  if (preferCopy) {
    fs.copyFileSync(sourcePath, target);
  } else {
    try {
      fs.symlinkSync(sourcePath, target, 'file');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes(error?.code)) throw error;
      fs.copyFileSync(sourcePath, target);
      method = 'copy';
    }
  }

  return {
    status: existing || existingDir ? 'replaced' : 'installed',
    target,
    method,
    agent: resolvedAgent,
    scope,
  };
}
