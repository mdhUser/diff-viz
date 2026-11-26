import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from './i18n.mjs';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hubAuthHeaders, hubHome, hubIsAlive, readHubInfo } from './hub.mjs';
import { readReviewStore } from './review-store.mjs';

// A small, dependency-free MCP (Model Context Protocol) stdio server. Agents
// such as Cursor / Claude Code / DSH can call diff-viz tools directly instead
// of shelling out and parsing CLI text.

const execFileAsync = promisify(execFile);
const BIN_PATH = fileURLToPath(new URL('../bin/diff-viz.mjs', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const SERVER_INFO = { name: 'diff-viz', version: pkg.version };
const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const MAX_BUFFER = 32 * 1024 * 1024;

const TOOLS = [
  {
    name: 'diff_viz_review',
    description:
      t('分析 Git 变更并生成/打开 diff-viz Review，返回带 token 的 URL。支持工作区、暂存区、最近提交、范围、目标分支、指定 commit、GitHub PR、GitLab MR；可同时传入 annotations 写入 Agent 摘要。'),
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: t('仓库目录（默认 MCP server 启动目录）') },
        scope: {
          type: 'string',
          enum: ['worktree', 'staged', 'last', 'range', 'base', 'commit', 'pr', 'mr'],
          description: t('比较范围，默认 worktree'),
        },
        range: { type: 'string', description: t('scope=range 时必填，如 main..HEAD 或 main...HEAD') },
        base: { type: 'string', description: t('scope=base 或 PR/MR 时的目标分支') },
        commit: { type: 'string', description: t('scope=commit 时的提交') },
        pullRequest: { type: ['string', 'number'], description: t('scope=pr/mr 时的编号或 URL') },
        annotations: { type: 'object', description: t('可选注解对象：{ meta:{overallSummary}, nodes:{ "path": { summary, impactAnalysis, todos } } }') },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'diff_viz_get_review',
    description: t('读取已存在的 diff-viz Review 清单（meta、节点摘要、边、评论、表/配置），默认压缩节点字段。'),
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: t('Review id，或带 review 参数的 URL') },
        compact: { type: 'boolean', description: t('只返回 Agent 常用字段（默认 true）') },
        full: { type: 'boolean', description: t('包含懒加载内容（diff/源码/表 SQL），可能很大') },
      },
      required: ['reviewId'],
      additionalProperties: false,
    },
  },
  {
    name: 'diff_viz_get_node',
    description: t('读取单个文件节点的完整 diff / oldContent / newContent（默认超过 200KB 截断）。'),
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string' },
        id: { type: 'string', description: t('节点 id（通常等于仓库相对路径）') },
        maxChars: { type: 'number', description: t('diff 文本截断长度，默认 200000') },
      },
      required: ['reviewId', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'diff_viz_annotate',
    description: t('把 Agent 摘要 / 影响分析 / 待确认项写入已有 Review（不会重新分析代码）。'),
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: t('要写入的 hub Review id（优先）') },
        dataPath: { type: 'string', description: t('没有 reviewId 时写入本地数据文件') },
        annotations: { type: 'object', description: t('注解对象：{ meta:{overallSummary}, nodes:{...} }') },
        summary: { type: 'string', description: t('可选，覆盖整体摘要') },
      },
      required: ['annotations'],
      additionalProperties: false,
    },
  },
  {
    name: 'diff_viz_list_projects',
    description: t('列出 hub 中已注册的仓库/项目。'),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'diff_viz_list_reviews',
    description: t('列出本地 hub 保存的 Review 快照（普通 Review、PR/MR、工作区），按时间倒序。'),
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: t('默认 20，最多 100') } },
      additionalProperties: false,
    },
  },
];

function hubBase(info) {
  const host = info.host === '0.0.0.0' || info.host === '::' ? '127.0.0.1' : info.host;
  return `http://${host}:${info.port}`;
}

async function hubGet(info, pathname) {
  if (!info || !(await hubIsAlive(info))) {
    throw new Error(t('diff-viz hub 没有运行；请先运行 `diff-viz` 或 `diff-viz hub`。'));
  }
  const response = await fetch(`${hubBase(info)}${pathname}`, {
    headers: { ...hubAuthHeaders(info) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `hub API 返回 HTTP ${response.status}`);
  return payload;
}

function parseReviewId(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(t('缺少 reviewId。'));
  try {
    const url = new URL(raw);
    const reviewId = url.searchParams.get('review');
    if (reviewId) return reviewId;
  } catch {
    /* not a URL */
  }
  return raw;
}

function compactReview(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    meta: data.meta,
    edges: data.edges,
    nodes: (data.nodes || []).map((node) => ({
      id: node.id,
      path: node.path,
      label: node.label,
      status: node.status,
      kind: node.kind,
      resourceKind: node.resourceKind,
      language: node.language,
      moduleId: node.moduleId,
      moduleLabel: node.moduleLabel,
      packagePath: node.packagePath,
      depth: node.depth,
      stats: node.stats,
      summary: node.summary,
      impactAnalysis: node.impactAnalysis,
      impactChain: node.impactChain,
      impactOrigins: node.impactOrigins,
      imports: node.imports,
      importedBy: node.importedBy,
      reviewComments: node.reviewComments,
      reviewCommentUnresolved: node.reviewCommentUnresolved,
      todos: node.todos,
    })),
    comments: (data.comments || []).map((comment) => ({
      ...comment,
      body: typeof comment.body === 'string' && comment.body.length > 1200 ? `${comment.body.slice(0, 1200)}…` : comment.body,
    })),
    tables: data.tables,
    components: data.components,
  };
}

async function runCli(args, { cwd, env, timeout = 180_000 } = {}) {
  try {
    const result = await execFileAsync(process.execPath, [BIN_PATH, ...args], {
      cwd,
      env,
      timeout,
      maxBuffer: MAX_BUFFER,
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    throw new Error(detail || t('diff-viz 命令失败：{command}', { command: args.join(' ') }));
  }
}

function parseReviewUrl(stdout) {
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('http://') || line.startsWith('https://'));
  const raw = lines[lines.length - 1];
  if (!raw) throw new Error(t('diff-viz 没有返回 Review URL。'));
  const url = new URL(raw);
  return {
    url: raw,
    reviewId: url.searchParams.get('review') || '',
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    token: url.searchParams.get('token') || '',
  };
}

async function toolReview(args, ctx) {
  const scope = String(args.scope || 'worktree');
  const cliArgs = ['--no-open', '--quiet'];
  if (args.repo) cliArgs.push('--repo', path.resolve(ctx.cwd, String(args.repo)));
  if (scope === 'staged') cliArgs.push('--staged');
  else if (scope === 'last') cliArgs.push('--last');
  else if (scope === 'range') {
    if (!args.range) throw new Error(t('scope=range 需要 range 参数。'));
    cliArgs.push('--range', String(args.range));
  } else if (scope === 'base') {
    if (!args.base) throw new Error(t('scope=base 需要 base 参数。'));
    cliArgs.push('--base', String(args.base));
  } else if (scope === 'commit') {
    if (!args.commit) throw new Error(t('scope=commit 需要 commit 参数。'));
    cliArgs.push('--commit', String(args.commit));
  } else if (scope === 'pr' || scope === 'mr') {
    if (!args.pullRequest) throw new Error(t('scope={scope} 需要 pullRequest 参数。', { scope }));
    cliArgs.push(`--${scope}`, String(args.pullRequest));
    if (args.base) cliArgs.push('--base', String(args.base));
  } else if (scope !== 'worktree') {
    throw new Error(t('不支持的 scope：{scope}', { scope }));
  }

  let tempAnnotations = null;
  if (args.annotations && typeof args.annotations === 'object') {
    tempAnnotations = path.join(os.tmpdir(), `diff-viz-mcp-annotations-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tempAnnotations, JSON.stringify(args.annotations, null, 2));
    cliArgs.push('--annotations', tempAnnotations);
  }
  try {
    const { stdout } = await runCli(cliArgs, ctx);
    const parsed = parseReviewUrl(stdout);
    let meta = null;
    try {
      const data = await hubGet(
        readHubInfo(ctx.env?.DIFF_VIZ_HOME || undefined),
        `/api/data?review=${encodeURIComponent(parsed.reviewId)}&t=${Date.now()}`,
      );
      meta = data.meta;
    } catch {
      /* the URL is still useful even if the summary lookup fails */
    }
    return {
      ...parsed,
      ...(args.repo ? { repo: path.resolve(ctx.cwd, String(args.repo)) } : {}),
      ...(meta
        ? {
            rangeLabel: meta.rangeLabel,
            branch: meta.branch,
            stats: meta.stats,
            pull: meta.pull,
            workspace: Boolean(meta.workspace),
          }
        : {}),
    };
  } finally {
    if (tempAnnotations) {
      try {
        fs.rmSync(tempAnnotations, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

async function toolGetReview(args, ctx) {
  const reviewId = parseReviewId(args.reviewId);
  const data = await hubGet(
    readHubInfo(ctx.env?.DIFF_VIZ_HOME || undefined),
    `/api/data?review=${encodeURIComponent(reviewId)}${args.full ? '&full=1' : ''}&t=${Date.now()}`,
  );
  return args.compact === false || args.full ? { reviewId, data } : { reviewId, data: compactReview(data) };
}

async function toolGetNode(args, ctx) {
  const reviewId = parseReviewId(args.reviewId);
  const id = String(args.id || '').trim();
  if (!id) throw new Error(t('缺少 id。'));
  const node = await hubGet(
    readHubInfo(ctx.env?.DIFF_VIZ_HOME || undefined),
    `/api/node?review=${encodeURIComponent(reviewId)}&id=${encodeURIComponent(id)}&t=${Date.now()}`,
  );
  const maxChars = Math.max(1000, Number(args.maxChars) || 200_000);
  const trim = (value) => (typeof value === 'string' && value.length > maxChars ? `${value.slice(0, maxChars)}\n${t('…（已截断）')}` : value);
  return {
    ...node,
    diff: trim(node.diff),
    oldContent: trim(node.oldContent),
    newContent: trim(node.newContent),
  };
}

async function toolAnnotate(args, ctx) {
  if (!args.annotations || typeof args.annotations !== 'object') throw new Error(t('annotations 必须是对象。'));
  const temp = path.join(os.tmpdir(), `diff-viz-mcp-annotations-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(temp, JSON.stringify(args.annotations, null, 2));
  const cliArgs = ['annotate', '--annotations', temp];
  if (args.reviewId) cliArgs.push('--review', parseReviewId(args.reviewId));
  else if (args.dataPath) cliArgs.push('--data', path.resolve(ctx.cwd, String(args.dataPath)));
  else throw new Error(t('需要 reviewId 或 dataPath。'));
  if (args.summary) cliArgs.push('--summary', String(args.summary));
  try {
    const { stdout } = await runCli(cliArgs, ctx);
    return { ok: true, output: stdout.trim() };
  } finally {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* best effort */
    }
  }
}

async function toolListProjects(_args, ctx) {
  const payload = await hubGet(readHubInfo(ctx.env?.DIFF_VIZ_HOME || undefined), '/api/hub');
  return { projects: payload.projects || [] };
}

async function toolListReviews(args, ctx) {
  const home = ctx.env?.DIFF_VIZ_HOME || hubHome();
  const reviewsDir = path.join(home, 'reviews');
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const entries = [];
  let names = [];
  try {
    names = fs.readdirSync(reviewsDir);
  } catch {
    return { reviews: [] };
  }
  for (const name of names) {
    const dir = path.join(reviewsDir, name);
    try {
      const store = readReviewStore(dir, { strict: false });
      const meta = store?.manifest?.meta;
      if (!meta) continue;
      const stat = fs.statSync(dir);
      entries.push({
        reviewId: String(meta.reviewId || name),
        timestamp: meta.timestamp || '',
        rangeLabel: meta.rangeLabel || '',
        branch: meta.branch || '',
        projectId: meta.projectId || '',
        workspace: Boolean(meta.workspace),
        pull: meta.pull ? { provider: meta.pull.provider, number: meta.pull.number, title: meta.pull.title } : null,
        stats: meta.stats || {},
        mtime: stat.mtimeMs,
      });
    } catch {
      /* skip unreadable snapshots */
    }
  }
  entries.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || b.mtime - a.mtime);
  return { reviews: entries.slice(0, limit).map(({ mtime, ...entry }) => entry) };
}

const TOOL_HANDLERS = {
  diff_viz_review: toolReview,
  diff_viz_get_review: toolGetReview,
  diff_viz_get_node: toolGetNode,
  diff_viz_annotate: toolAnnotate,
  diff_viz_list_projects: toolListProjects,
  diff_viz_list_reviews: toolListReviews,
};

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** Handle one JSON-RPC message; returns a response object or null for notifications. */
export async function handleMcpMessage(message, ctx = {}) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return rpcError(message?.id, -32600, 'Invalid Request');
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;
  if (typeof method !== 'string') return rpcError(id, -32600, 'Invalid Request');

  if (method.startsWith('notifications/')) return null;
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          t('diff-viz 本地变更 Review。使用 diff_viz_review 生成 Review，diff_viz_get_review / diff_viz_get_node 读取拓扑和 Diff，diff_viz_annotate 写入 Agent 摘要。需要先启动 hub（diff-viz 命令会自动启动）。'),
      },
    };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } };
  if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } };
  if (method === 'tools/call') {
    const name = params?.name;
    const handler = TOOL_HANDLERS[name];
    if (!handler) return rpcError(id, -32601, t('未知工具：{name}', { name }));
    const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    try {
      const result = await handler(args, { cwd: ctx.cwd || process.cwd(), env: ctx.env || process.env });
      return { jsonrpc: '2.0', id, result: textResult(result) };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: textResult(error instanceof Error ? error.message : String(error), true),
      };
    }
  }
  if (isNotification) return null;
  return rpcError(id, -32601, t('未知方法：{method}', { method }));
}

/**
 * Start the MCP stdio server. Messages are newline-delimited JSON per the MCP
 * stdio transport; stdout is reserved for protocol frames.
 */
export function startMcpServer({ stdin = process.stdin, stdout = process.stdout, cwd = process.cwd(), env = process.env } = {}) {
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  const write = (message) => {
    if (message) stdout.write(`${JSON.stringify(message)}\n`);
  };

  const handleLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      write(rpcError(null, -32700, 'Parse error'));
      return;
    }
    const response = await handleMcpMessage(message, { cwd, env });
    if (response) write(response);
  };

  rl.on('line', (line) => {
    queue = queue.then(() => handleLine(line)).catch((error) => {
      process.stderr.write(`diff-viz mcp: ${error instanceof Error ? error.stack : String(error)}\n`);
    });
  });

  return new Promise((resolve) => {
    rl.on('close', () => {
      queue.finally(resolve);
    });
  });
}

export { TOOLS, SERVER_INFO, SUPPORTED_PROTOCOLS };
