import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGitExcluded, findRepoRoot, GitRepo } from './git.mjs';
import { applyAnnotations, buildReviewData, mergePreviousState } from './collect.mjs';
import {
  ensureHub,
  hubAuthHeaders,
  hubIsAlive,
  readHubInfo,
  resolveHubPort,
  startHub,
  stopHub,
  withHubToken,
} from './hub.mjs';
import { workspaceTemplate } from './workspace.mjs';
import { isInside, readReviewStore, reviewLayout, writeReviewStore } from './review-store.mjs';
import { openInBrowser } from './server.mjs';
import { AGENTS, agentNames, installSkill, normalizeAgentName } from './skill.mjs';
import { writeJsonAtomic } from './util.mjs';
import { parsePullNumber, preparePullReview, pullLabel } from './remotes.mjs';
import { attachComments, fetchPullComments } from './comments.mjs';
import { getLanguage, languageFromArgv, localizeRangeLabel, setLanguage, t } from './i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

const HELP_ZH = `
diff-viz · 本地代码变更可视化 Review 工具

用法:
  diff-viz [review] [选项]           分析 Git 变更并注册到本地 hub
  diff-viz serve [选项]              把已有数据注册到 hub 并打开
  diff-viz annotate [选项]           将 Agent/人工总结合并进数据文件
  diff-viz mcp                      以 MCP stdio server 形式提供给 AI Agent 调用
  diff-viz hub [选项]                前台启动常驻 hub（只启动一次）
  diff-viz stop                      停止本地 hub
  diff-viz workspace [--init]        分析多仓库工作区（读取 ./diff-viz.workspace.json）
  diff-viz skill install [选项]      把薄 SKILL.md 注册到 Agent 技能目录

范围 (默认: 工作区有改动则看工作区，否则看最近一次提交):
  --staged                仅查看已暂存 (git diff --cached)
  --last                  查看最近一次提交
  --range <A..B|A...B>    查看提交范围
  --base <ref>            查看与目标分支的差异 (merge-base..HEAD)
  --commit <ref>          查看指定提交（父提交..该提交）
  --pr <编号|URL>         分析 GitHub PR（自动 fetch refs/pull/<n>/head）
  --mr <编号|URL>         分析 GitLab MR（自动 fetch refs/merge-requests/<iid>/head）

输出与界面:
  --data <file>           清单文件路径 (默认 <repo>/.diff-review-data.json，节点内容存 <file>.nodes/)
  --annotations <file>    生成时合并注解文件 (JSON，见 SKILL.md)
  --node <path>           annotate 时只更新指定节点
  --review <id>           annotate 时直接写入 hub 里指定 id 的 Review（含历史 commit Review）
  --languages <file>      额外语言定义 JSON（也可放 <repo>/.diff-viz/languages.json）
  --summary <text>        覆盖整体摘要
  --json-only             仅生成 JSON，不启动界面
  --port <n>              hub 端口 (默认 5173，被占用时自动 +1)
  --host <addr>           监听地址 (默认 127.0.0.1)
  --no-open               不自动打开浏览器

分析:
  --impact-depth <n>      下游影响分析深度 (默认 3)
  --max-impact <n>        最多展示多少个受影响文件 (默认 120)
  --max-scan-files <n>    依赖扫描的代码文件上限 (默认 15000)
  --no-untracked          不把未跟踪的新文件纳入 Review
  --repo <dir>            指定仓库目录 (默认当前目录)

工作区 (多仓库):
  --workspace <file>      指定 workspace JSON，分析其中所有仓库并生成服务级拓扑
  --init                  配合 workspace 命令，生成 workspace 模板

Skill:
  --agent <name>          dsh | claude | cursor | agents | antigravity（或 agy，默认 dsh）
  --scope <user|project>  安装到用户级或项目级（默认 user）
  --dir <dir>             自定义 skills 根目录
  --copy                  复制 SKILL.md（默认 symlink）
  --force                 覆盖已有安装
  --dry-run               只打印目标路径

其他:
  -h, --help              显示帮助
  -v, --version           显示版本
  --lang <en|zh>          CLI 语言（默认 en）
  --quiet                 减少日志
`;

const HELP_EN = `
diff-viz · local code-change review visualizer

Usage:
  diff-viz [review] [options]         Analyze Git changes and register them with the local hub
  diff-viz serve [options]            Register existing data with the hub and open it
  diff-viz annotate [options]         Merge agent/human annotations into the data file
  diff-viz mcp                        Run the MCP stdio server for AI agents
  diff-viz hub [options]              Start the persistent hub in the foreground
  diff-viz stop                       Stop the local hub
  diff-viz workspace [--init]         Analyze a multi-repository workspace (./diff-viz.workspace.json)
  diff-viz skill install [options]    Register the thin SKILL.md with an agent skills directory

Scope (default: worktree changes; otherwise the latest commit):
  --staged                Only staged changes (git diff --cached)
  --last                  Latest commit
  --range <A..B|A...B>    Commit range
  --base <ref>            Diff against a branch/ref (merge-base..HEAD)
  --commit <ref>          A specific commit (parent..commit)
  --pr <number|URL>       Analyze a GitHub PR (fetches refs/pull/<n>/head)
  --mr <number|URL>       Analyze a GitLab MR (fetches refs/merge-requests/<iid>/head)

Output and UI:
  --data <file>           Manifest path (default <repo>/.diff-review-data.json; node content in <file>.nodes/)
  --annotations <file>    Merge annotations while generating (JSON, see SKILL.md)
  --node <path>           Limit annotate to one node
  --review <id>           Annotate an existing hub review (including historical commit reviews)
  --languages <file>      Extra language definitions (or <repo>/.diff-viz/languages.json)
  --summary <text>        Override the overall summary
  --json-only             Print JSON only; do not start the UI
  --port <n>              Hub port (default 5173; auto-increments when busy)
  --host <addr>           Listen address (default 127.0.0.1)
  --no-open               Do not open a browser

Analysis:
  --impact-depth <n>      Downstream impact depth (default 3)
  --max-impact <n>        Maximum impacted files to show (default 120)
  --max-scan-files <n>    Maximum code files to scan (default 15000)
  --no-untracked          Exclude untracked files
  --repo <dir>            Repository directory (default: current directory)

Workspace (multi-repository):
  --workspace <file>      Analyze all repositories in a workspace JSON file
  --init                  With workspace, generate a template

Skill:
  --agent <name>          dsh | claude | cursor | agents | antigravity (or agy; default dsh)
  --scope <user|project>  User or project scope (default user)
  --dir <dir>             Custom skills root
  --copy                  Copy SKILL.md (default: symlink)
  --force                 Overwrite an existing install
  --dry-run               Print the target only

Other:
  -h, --help              Show help
  -v, --version           Show version
  --lang <en|zh>          CLI language (default en)
  --quiet                 Reduce log output
`;

function helpText() {
  return getLanguage() === 'zh' ? HELP_ZH : HELP_EN;
}

const SKILL_HELP_ZH = `
diff-viz skill install · 把 thin SKILL.md 注册到 Agent 技能目录

用法:
  diff-viz skill install [选项]

选项:
  --agent <name>           dsh | claude | cursor | agents | antigravity（或 agy，默认 dsh）
  --scope <user|project>   用户级或项目级（默认 user）
  --dir <dir>              自定义 skills 根目录（覆盖 agent/scope）
  --copy                   复制 SKILL.md，不建 symlink
  --force                  覆盖已有安装
  --dry-run                只显示目标路径，不写入
  --lang <en|zh>           CLI 语言（默认 en）
  -h, --help               显示帮助

示例:
  diff-viz skill install --agent dsh
  diff-viz skill install --agent claude --scope project
  diff-viz skill install --dir ~/.config/my-agent/skills --copy
`;

const SKILL_HELP_EN = `
diff-viz skill install · register the thin SKILL.md with an agent skills directory

Usage:
  diff-viz skill install [options]

Options:
  --agent <name>          dsh | claude | cursor | agents | antigravity (or agy; default dsh)
  --scope <user|project>  User or project scope (default user)
  --dir <dir>             Custom skills root (overrides agent/scope)
  --copy                  Copy SKILL.md instead of symlinking
  --force                 Overwrite an existing install
  --dry-run               Print the target only; do not write
  --lang <en|zh>          CLI language (default en)
  -h, --help              Show help

Examples:
  diff-viz skill install --agent dsh
  diff-viz skill install --agent claude --scope project
  diff-viz skill install --dir ~/.config/my-agent/skills --copy
`;

function skillHelpText() {
  return getLanguage() === 'zh' ? SKILL_HELP_ZH : SKILL_HELP_EN;
}

const BOOLEAN_FLAGS = new Set([
  'staged',
  'last',
  'json-only',
  'no-open',
  'no-untracked',
  'untracked',
  'help',
  'version',
  'quiet',
  'verbose',
  'init',
]);

const VALUE_FLAGS = new Set([
  'range',
  'base',
  'commit',
  'pr',
  'mr',
  'data',
  'annotations',
  'summary',
  'port',
  'host',
  'impact-depth',
  'max-impact',
  'max-scan-files',
  'repo',
  'node',
  'languages',
  'workspace',
  'review',
  'lang',
]);

function toCamel(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function parseArgs(argv) {
  const options = { command: 'review' };
  let index = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    if (!['review', 'serve', 'annotate', 'hub', 'stop', 'workspace', 'mcp'].includes(argv[0])) {
      throw new Error(t('未知命令：{command}', { command: argv[0] }));
    }
    options.command = argv[0];
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--') && arg !== '-h' && arg !== '-v') {
      throw new Error(t('无法识别的参数：{arg}', { arg }));
    }
    let name = arg;
    let inlineValue;
    if (arg.includes('=')) {
      [name, inlineValue] = arg.split(/=(.*)/s);
    }
    if (name === '-h') name = '--help';
    if (name === '-v') name = '--version';
    const key = name.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      if (inlineValue !== undefined) throw new Error(t('参数 {name} 不需要值', { name }));
      if (key === 'no-untracked') options.untracked = false;
      else options[toCamel(key)] = true;
      continue;
    }
    if (VALUE_FLAGS.has(key)) {
      const value = inlineValue !== undefined ? inlineValue : argv[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(t('参数 {name} 需要一个值', { name }));
      options[toCamel(key)] = value;
      continue;
    }
    throw new Error(t('未知参数：{name}', { name }));
  }
  return options;
}

// No explicit --port means "reuse the remembered port" (see resolveHubPort).
function hubPortOption(options) {
  if (options.port === undefined) return undefined;
  const port = Number(options.port);
  if (!Number.isFinite(port) || port <= 0) throw new Error(t('端口不合法：{port}', { port: options.port }));
  return port;
}

function repoFromOptions(options) {
  const start = path.resolve(process.cwd(), options.repo || '.');
  if (!fs.existsSync(start)) throw new Error(t('目录不存在：{dir}', { dir: start }));
  try {
    return new GitRepo(findRepoRoot(start));
  } catch {
    throw new Error(t('当前目录不是 Git 仓库：{dir}\n  请在项目根目录运行，或使用 --repo <dir> 指定仓库。', { dir: start }));
  }
}

function dataPathFor(repo, options) {
  if (options.data) return path.resolve(process.cwd(), options.data);
  return path.join(repo.root, '.diff-review-data.json');
}

// Keep the generated data file out of `git status`. Writing to .git/info/exclude
// avoids touching the user's .gitignore, so nothing shows up in their diff.
// Node payloads live in a sibling directory, which needs the same treatment.
function hideDataFile(repo, dataPath) {
  const relative = path.relative(repo.root, dataPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  try {
    ensureGitExcluded(repo.root, relative);
    const nodesRelative = path.relative(repo.root, reviewLayout(dataPath).nodesDir);
    if (nodesRelative && !nodesRelative.startsWith('..') && !path.isAbsolute(nodesRelative)) {
      ensureGitExcluded(repo.root, `${nodesRelative}/`);
    }
  } catch {
    /* never fail a review because of an unwritable exclude file */
  }
}

function readAnnotations(filePath) {
  if (filePath === '-') {
    try {
      const raw = fs.readFileSync(0, 'utf8');
      return JSON.parse(raw);
    } catch {
      throw new Error(t('无法从 stdin 读取注解 JSON。'));
    }
  }
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) throw new Error(t('注解文件不存在：{file}', { file: resolved }));
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(t('注解文件不是合法 JSON：{file}', { file: resolved }));
  }
}

function printSummary(data, dataPath) {
  const { meta } = data;
  const stats = meta.stats;
  process.stdout.write(
    t('\n  ✔ 分析完成  {changed} 个变更 · {impacted} 个受影响 · +{additions} / −{deletions} · {todos} 个待办\n', {
      changed: stats.changedFiles,
      impacted: stats.impactedFiles,
      additions: stats.additions,
      deletions: stats.deletions,
      todos: stats.todos,
    }),
  );
  process.stdout.write(t('  范围        {range}  ({branch})\n', { range: localizeRangeLabel(meta.rangeLabel), branch: meta.branch }));
  process.stdout.write(t('  数据        {path}\n', { path: dataPath }));
}

async function callHub(hub, endpoint, body) {
  try {
    return await fetch(new URL(endpoint, hub.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Diff-Viz-Lang': getLanguage(), ...hubAuthHeaders(hub) },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(t('无法连接 diff-viz hub：{error}', { error: error instanceof Error ? error.message : String(error) }));
  }
}

async function hubError(response, prefix) {
  let detail = `HTTP ${response.status}`;
  try {
    const payload = await response.json();
    if (payload?.error) detail = payload.error;
  } catch {
    /* ignore */
  }
  return new Error(t('{prefix}：{detail}', { prefix, detail }));
}

// Importing by path lets the hub copy node files instead of receiving one huge
// JSON body. Paths outside the repository fall back to an explicit upload, and
// so does an older hub that predates dataPath imports.
async function uploadReview(hub, { root, data, dataPath, reviewId, maxScanFiles }) {
  // Carry the analysis limit along: the hub re-analyzes this scope on file
  // changes, and it must keep the cap the user asked for instead of reverting
  // to the default.
  const base = { root, reviewId, ...(maxScanFiles ? { maxScanFiles: Number(maxScanFiles) } : {}) };
  const request = (body) => callHub(hub, 'api/import', { ...base, ...body });
  let response = await request(dataPath ? { dataPath } : { data });
  if (!response.ok && dataPath) {
    // Only retry when the hub rejected the request shape, not when it genuinely
    // failed to read our split files (that would silently lose node content).
    let detail = '';
    try {
      detail = String((await response.clone().json())?.error ?? '');
    } catch {
      /* not JSON; keep the status-only decision */
    }
    const shapeRejected = response.status === 405 || /数据格式不正确|未知参数|dataPath|invalid data|unknown option/i.test(detail);
    if (shapeRejected) {
      const full = data ?? readReviewStore(dataPath).toFullData();
      response = await request({ data: full });
    }
  }
  if (!response.ok) throw await hubError(response, t('注册 Review 到 hub 失败'));
  return response.json();
}

async function syncAnnotations(hub, { root, reviewId, annotations, onlyPaths, summary }) {
  const response = await callHub(hub, 'api/annotate', {
    root,
    reviewId,
    annotations,
    onlyPaths,
    summary,
  });
  return response;
}

function hubUrlFor(info) {
  const host = info.host === '0.0.0.0' || info.host === '::' ? '127.0.0.1' : info.host;
  return `http://${host}:${info.port}/`;
}

// Keep the hub-assigned ids on disk without rewriting node payloads.
function applyReviewIds(dataPath, { reviewId, projectId }) {
  const store = readReviewStore(dataPath);
  store.manifest.meta.reviewId = reviewId;
  if (projectId !== undefined) store.manifest.meta.projectId = projectId;
  store.save();
}

async function keepAlive(server) {
  await new Promise((resolve) => {
    const shutdown = async () => {
      try {
        await server.close();
      } finally {
        resolve();
      }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

function runSkillCommand(argv) {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(skillHelpText());
    return;
  }

  let subcommand = null;
  const options = { agent: 'dsh', scope: 'user' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === 'install' && !subcommand) {
      subcommand = arg;
      continue;
    }
    if (arg === '--agent' || arg === '--scope' || arg === '--dir') {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(t('参数 {arg} 需要一个值', { arg }));
      options[arg.slice(2)] = value;
      continue;
    }
    if (arg === '--lang') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--lang=')) {
      continue;
    }
    if (arg === '--copy') {
      options.copy = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    throw new Error(t('无法识别的参数：{arg}', { arg }));
  }

  if (subcommand !== 'install') {
    throw new Error(t('用法：diff-viz skill install [选项]（运行 diff-viz skill --help 查看帮助）'));
  }
  if (!['user', 'project'].includes(options.scope)) {
    throw new Error(t('未知 scope：{scope}。可选：user / project', { scope: options.scope }));
  }
  if (!options.dir && !AGENTS[normalizeAgentName(options.agent)]) {
    throw new Error(t('未知 agent：{agent}。可选：{agents}', { agent: options.agent, agents: agentNames().join(' / ') }));
  }

  let cwd = process.cwd();
  if (options.scope === 'project' && !options.dir) {
    try {
      cwd = findRepoRoot(cwd);
    } catch {
      /* fall back to cwd when this is not a Git repository */
    }
  }

  const result = installSkill({
    source: path.resolve(__dirname, '..', 'SKILL.md'),
    ...options,
    cwd,
  });
  const verb = {
    installed: t('已安装'),
    replaced: t('已替换'),
    unchanged: t('已经安装'),
    'dry-run': t('将安装'),
  }[result.status] || t('已处理');

  process.stdout.write(t('\n  ✔ {verb} diff-viz skill（{method}）\n', { verb, method: result.method }));
  process.stdout.write(t('  目标    {target}\n', { target: result.target }));
  if (result.status === 'dry-run') {
    process.stdout.write(t('  模式    --dry-run，未写入磁盘\n\n'));
    return;
  }
  process.stdout.write(t('  下一步  新开一个 Agent 会话，技能列表里会出现 diff-viz\n'));
  if (!options.dir && options.scope === 'user') {
    process.stdout.write(t('  可用    diff-viz skill install --agent {agent} --scope project\n', { agent: options.agent }));
  }
  process.stdout.write('\n');
}


function stripLanguageArg(argv) {
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--lang') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--lang=')) continue;
    args.push(arg);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  setLanguage(languageFromArgv(argv));
  const args = stripLanguageArg(argv);
  if (args[0] === 'skill') {
    runSkillCommand(args.slice(1));
    return;
  }

  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (options.version) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  if (options.command === 'mcp') {
    const { startMcpServer } = await import('./mcp.mjs');
    await startMcpServer();
    return;
  }

  if (options.command === 'hub') {
    const existing = readHubInfo();
    if (existing && (await hubIsAlive(existing))) {
      const infoHost = existing.host === '0.0.0.0' || existing.host === '::' ? '127.0.0.1' : existing.host;
      const hubUrl = `http://${infoHost}:${existing.port}/`;
      process.stdout.write(t('hub 已在运行：{url}\n', { url: hubUrl }));
      if (existing.token) process.stdout.write(t('带令牌链接：{url}\n', { url: withHubToken(hubUrl, existing.token) }));
      return;
    }
    const server = await startHub({
      port: resolveHubPort(existing, hubPortOption(options)),
      host: options.host || '127.0.0.1',
      open: !options.noOpen && !process.env.CI,
      quiet: options.quiet,
    });
    await keepAlive(server);
    return;
  }

  if (options.command === 'stop') {
    const result = await stopHub();
    process.stdout.write(result.stopped ? t('✔ 已停止 hub（pid {pid}）\n', { pid: result.pid }) : t('没有发现正在运行的 hub。\n'));
    return;
  }

  if (options.command === 'annotate') {
    if (!options.annotations) throw new Error(t('annotate 需要 --annotations <file|->。'));
    const annotations = readAnnotations(options.annotations);
    const onlyPaths = options.node ? [String(options.node)] : null;

    // Annotate a Review that already lives in the hub (for example a commit
    // Review opened from the version chain) without regenerating anything.
    if (options.review) {
      const reviewId = String(options.review);
      const info = readHubInfo();
      if (!info || !(await hubIsAlive(info))) {
        throw new Error(t('--review 需要 hub 正在运行；请先运行 diff-viz hub，或用不带 --review 的 annotate 写本地数据文件。'));
      }
      const hub = { url: hubUrlFor(info), token: info.token };
      const response = await syncAnnotations(hub, {
        reviewId,
        annotations,
        onlyPaths,
        summary: options.summary,
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        const count = Number.isFinite(payload.annotated) ? t('，{count} 个节点有 Agent 注解', { count: payload.annotated }) : '';
        process.stdout.write(t('✔ 已把注解写入 hub Review {reviewId}{count}\n', { reviewId, count }));
        return;
      }
      if (response.status === 404) throw new Error(t('hub 里找不到 Review：{reviewId}', { reviewId }));
      if (response.status === 405) {
        throw new Error(t('运行中的 hub 版本过旧，不支持 /api/annotate；请运行 `diff-viz stop` 后重新打开 Review 再试。'));
      }
      throw await hubError(response, t('写入 hub Review 失败'));
    }

    const repo = repoFromOptions(options);
    const dataPath = dataPathFor(repo, options);
    let store;
    try {
      store = readReviewStore(dataPath);
    } catch {
      throw new Error(t('找不到数据文件：{path}，请先运行 diff-viz。', { path: dataPath }));
    }
    // Only the manifest is loaded here: summaries and todos live in node
    // metadata, so a 100 MB review does not have to be read or rewritten.
    const data = store.manifest;
    applyAnnotations(data, annotations, { onlyPaths });
    if (options.summary) data.meta.overallSummary = options.summary;
    data.meta.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    let upgraded = false;
    if (store.layout === 'legacy') {
      // One-time migration: the next annotate only touches the manifest.
      store.upgrade();
      upgraded = true;
    } else {
      store.save();
    }
    hideDataFile(repo, dataPath);
    const info = readHubInfo();
    let syncNote = null;
    if (info && (await hubIsAlive(info))) {
      const hub = { url: hubUrlFor(info), token: info.token };
      try {
        const response = await syncAnnotations(hub, {
          root: repo.root,
          reviewId: data.meta?.reviewId,
          annotations,
          onlyPaths,
          summary: options.summary,
        });
        if (response.ok) {
          syncNote = t('已把注解同步到运行中的 hub');
        } else if (response.status === 405) {
          // An older hub has no /api/annotate. Re-uploading the whole review
          // would be exactly the large-file cost this format removes, so ask
          // the user to restart it instead.
          syncNote = t('运行中的 hub 版本过旧，未同步；执行 `diff-viz stop` 后重开 Review 即可看到注解');
        } else if (response.status === 404) {
          // The hub has no snapshot for this review (fresh state dir or pruned
          // history). Import by path when possible so node content is copied
          // instead of uploaded as one JSON body.
          const imported = await uploadReview(hub, {
            root: repo.root,
            reviewId: data.meta?.reviewId,
            ...(isInside(repo.root, dataPath)
              ? { dataPath }
              : { data: readReviewStore(dataPath).toFullData() }),
          });
          if (imported.reviewId) {
            applyReviewIds(dataPath, { reviewId: imported.reviewId, projectId: imported.project?.id });
          }
          syncNote = t('已把注解同步到运行中的 hub（重新导入）');
        } else {
          throw await hubError(response, t('同步 hub 失败'));
        }
        process.stdout.write(`  ↳ ${syncNote}\n`);
      } catch (error) {
        process.stdout.write(t('  ! 注解已写入本地，但同步 hub 失败：{error}\n', { error: error instanceof Error ? error.message : String(error) }));
      }
    }
    const annotated = data.nodes.filter((node) => node.summarySource === 'agent' || (node.todos || []).some((todo) => todo.source === 'agent')).length;
    process.stdout.write(t('✔ 已合并注解：{count} 个节点 · {path}\n', { count: annotated, path: dataPath }));
    if (upgraded) {
      process.stdout.write(t('  ↳ 数据文件已升级为拆分存储（节点内容在 {dir}）\n', { dir: reviewLayout(dataPath).nodesDir }));
    }
    return;
  }

  if (options.command === 'serve') {
    const repo = repoFromOptions(options);
    const dataPath = options.data
      ? path.resolve(process.cwd(), options.data)
      : dataPathFor(repo, options);
    if (!fs.existsSync(dataPath)) {
      throw new Error(t('找不到数据文件：{path}，请先运行 diff-viz。', { path: dataPath }));
    }
    const store = readReviewStore(dataPath, { strict: false });
    if (!store) throw new Error(t('数据文件不是合法 JSON：{path}', { path: dataPath }));
    const data = store.manifest;
    const hub = await ensureHub({
      port: hubPortOption(options),
      host: options.host || '127.0.0.1',
    });
    const imported = await uploadReview(hub, {
      root: repo.root,
      reviewId: data.meta?.reviewId,
      maxScanFiles: options.maxScanFiles,
      ...(isInside(repo.root, dataPath) ? { dataPath } : { data: store.toFullData() }),
    });
    applyReviewIds(dataPath, { reviewId: imported.reviewId, projectId: imported.project?.id });
    const reviewUrl = withHubToken(new URL(imported.url, hub.url).toString(), hub.token);
    if (!options.noOpen && !process.env.CI) openInBrowser(reviewUrl);
    process.stdout.write(`\n  Review UI  ${reviewUrl}\n  Hub        ${hub.url}\n\n`);
    return;
  }

  if (options.command === 'workspace' || options.workspace) {
    const target = options.workspace
      ? path.resolve(process.cwd(), String(options.workspace))
      : path.resolve(process.cwd(), 'diff-viz.workspace.json');

    if (options.init) {
      const template = workspaceTemplate(process.cwd());
      writeJsonAtomic(target, template);
      process.stdout.write(t('\n  ✔ 已生成 {path}', { path: path.relative(process.cwd(), target) || target }));
      process.stdout.write(t('    收录 {count} 个仓库：{repos}\n', { count: template.repos.length, repos: template.repos.map((repo) => repo.id).join(', ') || '(none)' }));
      process.stdout.write(t('    用 links 补充 RPC / HTTP 依赖，然后运行 diff-viz workspace\n\n'));
      return;
    }

    if (!fs.existsSync(target)) {
      throw new Error(t('找不到 workspace 文件：{path}\n  先运行 diff-viz workspace --init 生成模板。', { path: target }));
    }
    const hub = await ensureHub({ port: hubPortOption(options), host: options.host || '127.0.0.1' });
    const response = await callHub(hub, 'api/workspace', { file: target });
    if (!response.ok) throw await hubError(response, t('工作区分析失败'));
    const payload = await response.json();
    const url = withHubToken(new URL(payload.url, hub.url).toString(), hub.token);
    if (!options.noOpen && !process.env.CI) openInBrowser(url);
    process.stdout.write(
      t('\n  ✔ 工作区分析完成  {changed} 个仓库有改动 · {impacted} 个受影响\n', {
        changed: payload.stats.changed,
        impacted: payload.stats.impacted,
      }),
    );
    for (const warning of payload.warnings || []) process.stdout.write(`  ! ${warning}\n`);
    process.stdout.write(`\n  Workspace  ${url}\n  Hub        ${hub.url}\n\n`);
    return;
  }

  const repo = repoFromOptions(options);
  const dataPath = dataPathFor(repo, options);
  const previous = readReviewStore(dataPath, { strict: false })?.manifest ?? null;

  // Remote PR/MR: resolve metadata + fetch refs, then reuse the normal
  // range-review pipeline. `--base` becomes the target-branch override.
  let pull = null;
  let pullInfo = null;
  if (options.pr || options.mr) {
    if (options.pr && options.mr) throw new Error(t('--pr 与 --mr 只能选一个。'));
    const input = options.pr || options.mr;
    const prepared = await preparePullReview(repo, {
      number: parsePullNumber(input),
      input,
      base: options.base,
    });
    pull = prepared.pull;
    pullInfo = prepared.info;
    options.range = prepared.range;
    delete options.base;
  }

  const data = buildReviewData(repo, {
    staged: options.staged,
    last: options.last,
    range: options.range,
    base: options.base,
    commit: options.commit,
    impactDepth: options.impactDepth,
    maxImpact: options.maxImpact,
    maxScanFiles: options.maxScanFiles,
    untracked: options.untracked,
    summary: options.summary,
    annotationFile: options.annotations ? path.resolve(process.cwd(), options.annotations) : null,
    languages: options.languages || null,
    excludePaths: [
      dataPath,
      reviewLayout(dataPath).nodesDir,
      options.annotations && options.annotations !== '-'
        ? path.resolve(process.cwd(), options.annotations)
        : null,
    ],
    version: pkg.version,
  });
  if (pull) {
    data.meta.pull = pull;
    data.meta.rangeLabel = pullLabel(pull);
    data.meta.scopeLabel = 'pull';
    if (pull.sourceBranch) data.meta.branch = pull.sourceBranch;
    if (pullInfo) {
      try {
        const fetched = await fetchPullComments(pullInfo, pull.number);
        attachComments(data, fetched.comments);
        if (fetched.warnings.length > 0) {
          data.meta.warnings = [...(data.meta.warnings || []), ...fetched.warnings];
        }
      } catch (error) {
        data.meta.warnings = [
          ...(data.meta.warnings || []),
          t('读取 PR/MR 评论失败：{error}', { error: error instanceof Error ? error.message : String(error) }),
        ];
      }
    }
  }
  mergePreviousState(data, previous);
  if (options.summary) data.meta.overallSummary = options.summary;
  writeReviewStore(dataPath, data);
  hideDataFile(repo, dataPath);

  if (!options.quiet && !options.jsonOnly) printSummary(data, dataPath);

  if (options.jsonOnly) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          dataPath,
          meta: data.meta,
          nodes: data.nodes.length,
          edges: data.edges.length,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const hub = await ensureHub({
    port: hubPortOption(options),
    host: options.host || '127.0.0.1',
  });
  const imported = await uploadReview(hub, {
    root: repo.root,
    reviewId: data.meta?.reviewId,
    maxScanFiles: options.maxScanFiles,
    ...(isInside(repo.root, dataPath) ? { dataPath, data } : { data }),
  });
  applyReviewIds(dataPath, {
    reviewId: imported.reviewId,
    projectId: imported.project?.id ?? data.meta.projectId,
  });
  const reviewUrl = withHubToken(new URL(imported.url, hub.url).toString(), hub.token);

  if (options.quiet) {
    process.stdout.write(`${reviewUrl}\n`);
  } else {
    process.stdout.write(`\n  Review UI  ${reviewUrl}\n`);
    process.stdout.write(t('  Hub        {url}{state}\n\n', { url: hub.url, state: hub.started ? t(' (已启动)') : t(' (复用中)') }));
  }
  if (!options.noOpen && !process.env.CI) openInBrowser(reviewUrl);
}
