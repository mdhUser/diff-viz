import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGitExcluded, findRepoRoot, GitRepo } from './git.mjs';
import { applyAnnotations, buildReviewData, mergePreviousState } from './collect.mjs';
import { ensureHub, hubIsAlive, readHubInfo, resolveHubPort, startHub, stopHub } from './hub.mjs';
import { workspaceTemplate } from './workspace.mjs';
import { isInside, readReviewStore, reviewLayout, writeReviewStore } from './review-store.mjs';
import { openInBrowser } from './server.mjs';
import { AGENTS, agentNames, installSkill } from './skill.mjs';
import { writeJsonAtomic } from './util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

const HELP = `
diff-viz · 本地代码变更可视化 Review 工具

用法:
  diff-viz [review] [选项]           分析 Git 变更并注册到本地 hub
  diff-viz serve [选项]              把已有数据注册到 hub 并打开
  diff-viz annotate [选项]           将 Agent/人工总结合并进数据文件
  diff-viz hub [选项]                前台启动常驻 hub（只启动一次）
  diff-viz stop                      停止本地 hub
  diff-viz workspace [--init]        分析多仓库工作区（读取 ./diff-viz.workspace.json）
  diff-viz skill install [选项]      把薄 SKILL.md 注册到 Agent 技能目录

范围 (默认: 工作区有改动则看工作区，否则看最近一次提交):
  --staged                仅查看已暂存 (git diff --cached)
  --last                  查看最近一次提交
  --range <A..B|A...B>    查看提交范围
  --base <ref>            查看与目标分支的差异 (merge-base..HEAD)

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
  --no-untracked          不把未跟踪的新文件纳入 Review
  --repo <dir>            指定仓库目录 (默认当前目录)

工作区 (多仓库):
  --workspace <file>      指定 workspace JSON，分析其中所有仓库并生成服务级拓扑
  --init                  配合 workspace 命令，生成 workspace 模板

Skill:
  --agent <name>          dsh | claude | cursor | agents（默认 dsh）
  --scope <user|project>  安装到用户级或项目级（默认 user）
  --dir <dir>             自定义 skills 根目录
  --copy                  复制 SKILL.md（默认 symlink）
  --force                 覆盖已有安装
  --dry-run               只打印目标路径

其他:
  -h, --help              显示帮助
  -v, --version           显示版本
  --quiet                 减少日志
`;

const SKILL_HELP = `
diff-viz skill install · 把 thin SKILL.md 注册到 Agent 技能目录

用法:
  diff-viz skill install [选项]

选项:
  --agent <name>           dsh | claude | cursor | agents（默认 dsh）
  --scope <user|project>   用户级或项目级（默认 user）
  --dir <dir>              自定义 skills 根目录（覆盖 agent/scope）
  --copy                   复制 SKILL.md，不建 symlink
  --force                  覆盖已有安装
  --dry-run                只显示目标路径，不写入
  -h, --help               显示帮助

示例:
  diff-viz skill install --agent dsh
  diff-viz skill install --agent claude --scope project
  diff-viz skill install --dir ~/.config/my-agent/skills --copy
`;

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
  'data',
  'annotations',
  'summary',
  'port',
  'host',
  'impact-depth',
  'max-impact',
  'repo',
  'node',
  'languages',
  'workspace',
  'review',
]);

function toCamel(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function parseArgs(argv) {
  const options = { command: 'review' };
  let index = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    if (!['review', 'serve', 'annotate', 'hub', 'stop', 'workspace'].includes(argv[0])) {
      throw new Error(`未知命令：${argv[0]}`);
    }
    options.command = argv[0];
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--') && arg !== '-h' && arg !== '-v') {
      throw new Error(`无法识别的参数：${arg}`);
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
      if (inlineValue !== undefined) throw new Error(`参数 ${name} 不需要值`);
      if (key === 'no-untracked') options.untracked = false;
      else options[toCamel(key)] = true;
      continue;
    }
    if (VALUE_FLAGS.has(key)) {
      const value = inlineValue !== undefined ? inlineValue : argv[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${name} 需要一个值`);
      options[toCamel(key)] = value;
      continue;
    }
    throw new Error(`未知参数：${name}`);
  }
  return options;
}

// No explicit --port means "reuse the remembered port" (see resolveHubPort).
function hubPortOption(options) {
  if (options.port === undefined) return undefined;
  const port = Number(options.port);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`端口不合法：${options.port}`);
  return port;
}

function repoFromOptions(options) {
  const start = path.resolve(process.cwd(), options.repo || '.');
  if (!fs.existsSync(start)) throw new Error(`目录不存在：${start}`);
  try {
    return new GitRepo(findRepoRoot(start));
  } catch {
    throw new Error(`当前目录不是 Git 仓库：${start}\n  请在项目根目录运行，或使用 --repo <dir> 指定仓库。`);
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
      throw new Error('无法从 stdin 读取注解 JSON。');
    }
  }
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) throw new Error(`注解文件不存在：${resolved}`);
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`注解文件不是合法 JSON：${resolved}`);
  }
}

function printSummary(data, dataPath) {
  const { meta } = data;
  const stats = meta.stats;
  process.stdout.write(
    `\n  ✔ 分析完成  ${stats.changedFiles} 个变更 · ${stats.impactedFiles} 个受影响 · +${stats.additions} / −${stats.deletions} · ${stats.todos} 个待办\n`,
  );
  process.stdout.write(`  范围        ${meta.rangeLabel}  (${meta.branch})\n`);
  process.stdout.write(`  数据        ${dataPath}\n`);
}

async function callHub(hubUrl, endpoint, body) {
  try {
    return await fetch(new URL(endpoint, hubUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`无法连接 diff-viz hub：${error instanceof Error ? error.message : String(error)}`);
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
  return new Error(`${prefix}：${detail}`);
}

// Importing by path lets the hub copy node files instead of receiving one huge
// JSON body. Paths outside the repository fall back to an explicit upload, and
// so does an older hub that predates dataPath imports.
async function uploadReview(hubUrl, { root, data, dataPath, reviewId }) {
  const request = (body) => callHub(hubUrl, 'api/import', body);
  let response = await request(dataPath ? { root, dataPath, reviewId } : { root, data, reviewId });
  if (!response.ok && dataPath) {
    // Only retry when the hub rejected the request shape, not when it genuinely
    // failed to read our split files (that would silently lose node content).
    let detail = '';
    try {
      detail = String((await response.clone().json())?.error ?? '');
    } catch {
      /* not JSON; keep the status-only decision */
    }
    const shapeRejected = response.status === 405 || /数据格式不正确|未知参数|dataPath/.test(detail);
    if (shapeRejected) {
      const full = data ?? readReviewStore(dataPath).toFullData();
      response = await request({ root, data: full, reviewId });
    }
  }
  if (!response.ok) throw await hubError(response, '注册 Review 到 hub 失败');
  return response.json();
}

async function syncAnnotations(hubUrl, { root, reviewId, annotations, onlyPaths, summary }) {
  const response = await callHub(hubUrl, 'api/annotate', {
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
    process.stdout.write(SKILL_HELP);
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
      if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${arg} 需要一个值`);
      options[arg.slice(2)] = value;
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
    throw new Error(`无法识别的参数：${arg}`);
  }

  if (subcommand !== 'install') {
    throw new Error('用法：diff-viz skill install [选项]（运行 diff-viz skill --help 查看帮助）');
  }
  if (!['user', 'project'].includes(options.scope)) {
    throw new Error(`未知 scope：${options.scope}。可选：user / project`);
  }
  if (!options.dir && !AGENTS[options.agent]) {
    throw new Error(`未知 agent：${options.agent}。可选：${agentNames().join(' / ')}`);
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
    installed: '已安装',
    replaced: '已替换',
    unchanged: '已经安装',
    'dry-run': '将安装',
  }[result.status] || '已处理';

  process.stdout.write(`\n  ✔ ${verb} diff-viz skill（${result.method}）\n`);
  process.stdout.write(`  目标    ${result.target}\n`);
  if (result.status === 'dry-run') {
    process.stdout.write('  模式    --dry-run，未写入磁盘\n\n');
    return;
  }
  process.stdout.write('  下一步  新开一个 Agent 会话，技能列表里会出现 diff-viz\n');
  if (!options.dir && options.scope === 'user') {
    process.stdout.write(`  可用    diff-viz skill install --agent ${options.agent} --scope project\n`);
  }
  process.stdout.write('\n');
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'skill') {
    runSkillCommand(argv.slice(1));
    return;
  }

  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.version) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  if (options.command === 'hub') {
    const existing = readHubInfo();
    if (existing && (await hubIsAlive(existing))) {
      const infoHost = existing.host === '0.0.0.0' || existing.host === '::' ? '127.0.0.1' : existing.host;
      process.stdout.write(`hub 已在运行：http://${infoHost}:${existing.port}/\n`);
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
    process.stdout.write(result.stopped ? `✔ 已停止 hub（pid ${result.pid}）\n` : '没有发现正在运行的 hub。\n');
    return;
  }

  if (options.command === 'annotate') {
    if (!options.annotations) throw new Error('annotate 需要 --annotations <file|->。');
    const annotations = readAnnotations(options.annotations);
    const onlyPaths = options.node ? [String(options.node)] : null;

    // Annotate a Review that already lives in the hub (for example a commit
    // Review opened from the version chain) without regenerating anything.
    if (options.review) {
      const reviewId = String(options.review);
      const hub = readHubInfo();
      if (!hub || !(await hubIsAlive(hub))) {
        throw new Error('--review 需要 hub 正在运行；请先运行 diff-viz hub，或用不带 --review 的 annotate 写本地数据文件。');
      }
      const hubUrl = hubUrlFor(hub);
      const response = await syncAnnotations(hubUrl, {
        reviewId,
        annotations,
        onlyPaths,
        summary: options.summary,
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        const count = Number.isFinite(payload.annotated) ? `，${payload.annotated} 个节点有 Agent 注解` : '';
        process.stdout.write(`✔ 已把注解写入 hub Review ${reviewId}${count}\n`);
        return;
      }
      if (response.status === 404) throw new Error(`hub 里找不到 Review：${reviewId}`);
      if (response.status === 405) {
        throw new Error('运行中的 hub 版本过旧，不支持 /api/annotate；请运行 `diff-viz stop` 后重新打开 Review 再试。');
      }
      throw await hubError(response, '写入 hub Review 失败');
    }

    const repo = repoFromOptions(options);
    const dataPath = dataPathFor(repo, options);
    let store;
    try {
      store = readReviewStore(dataPath);
    } catch {
      throw new Error(`找不到数据文件：${dataPath}，请先运行 diff-viz。`);
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
    const hub = readHubInfo();
    let syncNote = null;
    if (hub && (await hubIsAlive(hub))) {
      const hubUrl = hubUrlFor(hub);
      try {
        const response = await syncAnnotations(hubUrl, {
          root: repo.root,
          reviewId: data.meta?.reviewId,
          annotations,
          onlyPaths,
          summary: options.summary,
        });
        if (response.ok) {
          syncNote = '已把注解同步到运行中的 hub';
        } else if (response.status === 405) {
          // An older hub has no /api/annotate. Re-uploading the whole review
          // would be exactly the large-file cost this format removes, so ask
          // the user to restart it instead.
          syncNote = '运行中的 hub 版本过旧，未同步；执行 `diff-viz stop` 后重开 Review 即可看到注解';
        } else if (response.status === 404) {
          // The hub has no snapshot for this review (fresh state dir or pruned
          // history). Import by path when possible so node content is copied
          // instead of uploaded as one JSON body.
          const imported = await uploadReview(hubUrl, {
            root: repo.root,
            reviewId: data.meta?.reviewId,
            ...(isInside(repo.root, dataPath)
              ? { dataPath }
              : { data: readReviewStore(dataPath).toFullData() }),
          });
          if (imported.reviewId) {
            applyReviewIds(dataPath, { reviewId: imported.reviewId, projectId: imported.project?.id });
          }
          syncNote = '已把注解同步到运行中的 hub（重新导入）';
        } else {
          throw await hubError(response, '同步 hub 失败');
        }
        process.stdout.write(`  ↳ ${syncNote}\n`);
      } catch (error) {
        process.stdout.write(`  ! 注解已写入本地，但同步 hub 失败：${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    const annotated = data.nodes.filter((node) => node.summarySource === 'agent' || (node.todos || []).some((todo) => todo.source === 'agent')).length;
    process.stdout.write(`✔ 已合并注解：${annotated} 个节点 · ${dataPath}\n`);
    if (upgraded) {
      process.stdout.write(`  ↳ 数据文件已升级为拆分存储（节点内容在 ${reviewLayout(dataPath).nodesDir}）\n`);
    }
    return;
  }

  if (options.command === 'serve') {
    const repo = repoFromOptions(options);
    const dataPath = options.data
      ? path.resolve(process.cwd(), options.data)
      : dataPathFor(repo, options);
    if (!fs.existsSync(dataPath)) {
      throw new Error(`找不到数据文件：${dataPath}，请先运行 diff-viz。`);
    }
    const store = readReviewStore(dataPath, { strict: false });
    if (!store) throw new Error(`数据文件不是合法 JSON：${dataPath}`);
    const data = store.manifest;
    const hub = await ensureHub({
      port: hubPortOption(options),
      host: options.host || '127.0.0.1',
    });
    const imported = await uploadReview(hub.url, {
      root: repo.root,
      reviewId: data.meta?.reviewId,
      ...(isInside(repo.root, dataPath) ? { dataPath } : { data: store.toFullData() }),
    });
    applyReviewIds(dataPath, { reviewId: imported.reviewId, projectId: imported.project?.id });
    const reviewUrl = new URL(imported.url, hub.url).toString();
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
      process.stdout.write(`\n  ✔ 已生成 ${path.relative(process.cwd(), target) || target}\n`);
      process.stdout.write(`    收录 ${template.repos.length} 个仓库：${template.repos.map((repo) => repo.id).join(', ') || '(未发现)'}\n`);
      process.stdout.write('    用 links 补充 RPC / HTTP 依赖，然后运行 diff-viz workspace\n\n');
      return;
    }

    if (!fs.existsSync(target)) {
      throw new Error(`找不到 workspace 文件：${target}\n  先运行 diff-viz workspace --init 生成模板。`);
    }
    const hub = await ensureHub({ port: hubPortOption(options), host: options.host || '127.0.0.1' });
    const response = await callHub(hub.url, 'api/workspace', { file: target });
    if (!response.ok) throw await hubError(response, '工作区分析失败');
    const payload = await response.json();
    const url = new URL(payload.url, hub.url).toString();
    if (!options.noOpen && !process.env.CI) openInBrowser(url);
    process.stdout.write(
      `\n  ✔ 工作区分析完成  ${payload.stats.changed} 个仓库有改动 · ${payload.stats.impacted} 个受影响\n`,
    );
    for (const warning of payload.warnings || []) process.stdout.write(`  ! ${warning}\n`);
    process.stdout.write(`\n  Workspace  ${url}\n  Hub        ${hub.url}\n\n`);
    return;
  }

  const repo = repoFromOptions(options);
  const dataPath = dataPathFor(repo, options);
  const previous = readReviewStore(dataPath, { strict: false })?.manifest ?? null;
  const data = buildReviewData(repo, {
    staged: options.staged,
    last: options.last,
    range: options.range,
    base: options.base,
    impactDepth: options.impactDepth,
    maxImpact: options.maxImpact,
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
  const imported = await uploadReview(hub.url, {
    root: repo.root,
    reviewId: data.meta?.reviewId,
    ...(isInside(repo.root, dataPath) ? { dataPath, data } : { data }),
  });
  applyReviewIds(dataPath, {
    reviewId: imported.reviewId,
    projectId: imported.project?.id ?? data.meta.projectId,
  });
  const reviewUrl = new URL(imported.url, hub.url).toString();

  if (options.quiet) {
    process.stdout.write(`${reviewUrl}\n`);
  } else {
    process.stdout.write(`\n  Review UI  ${reviewUrl}\n`);
    process.stdout.write(`  Hub        ${hub.url}${hub.started ? ' (已启动)' : ' (复用中)'}\n\n`);
  }
  if (!options.noOpen && !process.env.CI) openInBrowser(reviewUrl);
}
