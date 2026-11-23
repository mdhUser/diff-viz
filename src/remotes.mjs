import { spawnSync } from 'node:child_process';

// Remote pull-request integration for GitHub and GitLab. The CLI stays
// dependency-free: HTTP goes through the global fetch, refs are fetched with
// plain `git fetch`, and provider detection only needs `git remote get-url`.

const DEFAULT_TIMEOUT_MS = 10_000;
const GITHUB_HOSTS_DEFAULT = 'github.com';
const GITLAB_HOSTS_DEFAULT = '';

function splitHosts(value) {
  return String(value || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/** Parse `git@host:path`, `ssh://git@host/path` and `https://host/path` remotes. */
export function parseRemoteUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let host = '';
  let pathname = '';
  const scpLike = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw);
  if (!raw.includes('://') && scpLike) {
    host = scpLike[1];
    pathname = scpLike[2];
  } else {
    try {
      const parsed = new URL(raw);
      host = parsed.hostname;
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }
  pathname = pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const segments = pathname.split('/').filter(Boolean);
  if (!host || segments.length < 2) return null;
  return { host: host.toLowerCase(), path: segments.join('/'), raw };
}

/**
 * Detect the hosting provider from a remote URL. Self-hosted GitLab instances
 * often do not contain "gitlab" in the hostname, so they can be declared with
 * DIFF_VIZ_PROVIDER / DIFF_VIZ_GITLAB_HOSTS (same for GitHub Enterprise).
 */
export function detectProvider(remoteUrl, env = process.env) {
  const parsed = typeof remoteUrl === 'string' ? parseRemoteUrl(remoteUrl) : remoteUrl;
  if (!parsed) return null;
  const override = String(env.DIFF_VIZ_PROVIDER || '').trim().toLowerCase();
  if (override && override !== 'github' && override !== 'gitlab') {
    throw new Error('DIFF_VIZ_PROVIDER 只支持 github 或 gitlab。');
  }
  const githubHosts = new Set([
    ...splitHosts(GITHUB_HOSTS_DEFAULT),
    ...splitHosts(env.DIFF_VIZ_GITHUB_HOSTS),
    ...splitHosts(env.DIFF_VIZ_GITHUB_HOST),
  ]);
  const gitlabHosts = new Set([
    ...splitHosts(GITLAB_HOSTS_DEFAULT),
    ...splitHosts(env.DIFF_VIZ_GITLAB_HOSTS),
    ...splitHosts(env.DIFF_VIZ_GITLAB_HOST),
  ]);
  const host = parsed.host;
  let provider = override || null;
  if (!provider) {
    if (githubHosts.has(host) || host === 'github.com' || host.startsWith('github.')) provider = 'github';
    else if (gitlabHosts.has(host) || host.includes('gitlab')) provider = 'gitlab';
  }
  if (!provider) return null;
  const webBase = `https://${host}`;
  if (provider === 'github') {
    const apiBase =
      env.DIFF_VIZ_GITHUB_API_URL ||
      (host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`);
    return {
      provider,
      host,
      path: parsed.path,
      remoteUrl: parsed.raw,
      webBase,
      apiBase: String(apiBase).replace(/\/+$/, ''),
      webUrl: `${webBase}/${parsed.path}`,
    };
  }
  const apiBase = env.DIFF_VIZ_GITLAB_API_URL || `https://${host}/api/v4`;
  return {
    provider,
    host,
    path: parsed.path,
    remoteUrl: parsed.raw,
    webBase,
    apiBase: String(apiBase).replace(/\/+$/, ''),
    webUrl: `${webBase}/${parsed.path}`,
  };
}

/** Read `origin` (or another remote) from the repo and detect its provider. */
export function detectRepoProvider(repo, { remote = 'origin', env = process.env } = {}) {
  const result = repo.run(['remote', 'get-url', remote], { allowFailure: true });
  const remoteUrl = String(env.DIFF_VIZ_REMOTE_URL || result.stdout || '').trim();
  if (!remoteUrl) {
    throw new Error(`仓库没有配置 ${remote} 远端；请先 git remote add ${remote} <url>。`);
  }
  const info = detectProvider(remoteUrl, env);
  if (!info) {
    throw new Error(
      `无法识别远端平台：${remoteUrl}\n` +
        'GitHub 企业版 / 自建 GitLab 请设置 DIFF_VIZ_PROVIDER=github|gitlab（必要时再设 DIFF_VIZ_GITHUB_HOSTS / DIFF_VIZ_GITLAB_HOSTS）。',
    );
  }
  return { ...info, remote };
}

const cliTokenCache = new Map();

/** Extract the token from `glab auth status --show-token` output. */
export function parseGlabTokenOutput(output) {
  const text = String(output || '');
  const keyring = /Token found in operating system keyring:\s*(\S+)/i.exec(text);
  if (keyring) return keyring[1];
  const tokenLine = /\bToken:\s*(\S+)/i.exec(text);
  return tokenLine ? tokenLine[1] : '';
}

export function parseGhTokenOutput(output) {
  const token = String(output || '').trim().split(/\s+/)[0] || '';
  return /^(gh[opsu]_|github_pat_)/.test(token) ? token : '';
}

// Reuse an existing `gh` / `glab` login instead of forcing everyone to export
// another environment variable. The token is only held in memory and is never
// written to review data or sent to the browser.
function discoverCliToken(provider, host) {
  if (process.env.DIFF_VIZ_DISABLE_CLI_TOKEN === '1') return '';
  const key = `${provider}:${host}`;
  if (cliTokenCache.has(key)) return cliTokenCache.get(key);
  let token = '';
  try {
    if (provider === 'github') {
      const result = spawnSync('gh', ['auth', 'token', '--hostname', host], {
        encoding: 'utf8',
        timeout: 3500,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      token = parseGhTokenOutput(`${result.stdout || ''}\n${result.stderr || ''}`);
    } else {
      // `glab` prints the status (including --show-token) on stderr.
      const result = spawnSync('glab', ['auth', 'status', '--show-token', '--hostname', host], {
        encoding: 'utf8',
        timeout: 3500,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      token = parseGlabTokenOutput(`${result.stdout || ''}\n${result.stderr || ''}`);
    }
  } catch {
    token = '';
  }
  cliTokenCache.set(key, token);
  return token;
}

function providerToken(info, env) {
  const fromEnv =
    info.provider === 'github'
      ? env.GITHUB_TOKEN || env.GH_TOKEN || ''
      : env.GITLAB_TOKEN || env.GLAB_TOKEN || '';
  return fromEnv || discoverCliToken(info.provider, info.host);
}

function authHeaders(info, env) {
  const token = providerToken(info, env);
  if (info.provider === 'github') {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }
  return {
    Accept: 'application/json',
    ...(token ? { 'PRIVATE-TOKEN': token } : {}),
  };
}

function authHint(provider) {
  return provider === 'github'
    ? '私有仓库请设置 GITHUB_TOKEN（或 GH_TOKEN），或先 gh auth login；公开仓库可不配置。'
    : '私有仓库请设置 GITLAB_TOKEN（或 GLAB_TOKEN），或先 glab auth login；公开项目可不配置。';
}

export async function requestJsonRaw(
  info,
  url,
  { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 版本缺少 fetch，无法访问远端 API。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: authHeaders(info, env),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`访问 ${info.host} API 超时（${timeoutMs}ms）。`);
    throw new Error(`无法访问 ${info.host} API：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const status = response.status;
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.message || payload?.error || '';
    } catch {
      /* ignore */
    }
    const suffix = detail ? `（${detail}）` : '';
    if (status === 401 || status === 403) {
      throw new Error(`${info.provider === 'github' ? 'GitHub' : 'GitLab'} 鉴权失败：${authHint(info.provider)}${suffix}`);
    }
    if (status === 404) {
      throw new Error(`找不到仓库 ${info.path} 或 PR/MR${suffix}；请检查远端地址与访问权限。${authHint(info.provider)}`);
    }
    if (status === 429 || /rate limit/i.test(detail)) {
      throw new Error(`${info.provider} API 触发限流；请设置 token 或稍后再试。${suffix}`);
    }
    throw new Error(`${info.provider} API 请求失败（HTTP ${status}）${suffix}`);
  }
  return { data: await response.json(), headers: response.headers };
}

async function requestJson(info, url, options = {}) {
  const { data } = await requestJsonRaw(info, url, options);
  return data;
}

function safeHttpUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function mapGithubPull(item) {
  return {
    provider: 'github',
    number: Number(item.number),
    title: String(item.title || ''),
    author: item.user?.login || '',
    sourceBranch: item.head?.ref || '',
    targetBranch: item.base?.ref || '',
    sourceSha: item.head?.sha || '',
    baseSha: item.base?.sha || '',
    updatedAt: item.updated_at || item.created_at || '',
    url: safeHttpUrl(item.html_url),
    draft: Boolean(item.draft),
    state: item.state || '',
  };
}

function mapGitlabPull(item) {
  return {
    provider: 'gitlab',
    number: Number(item.iid),
    title: String(item.title || ''),
    author: item.author?.name || item.author?.username || '',
    sourceBranch: item.source_branch || '',
    targetBranch: item.target_branch || '',
    sourceSha: item.sha || '',
    baseSha: item.diff_refs?.base_sha || '',
    updatedAt: item.updated_at || item.created_at || '',
    url: safeHttpUrl(item.web_url),
    draft: Boolean(item.draft || item.work_in_progress),
    state: item.state || '',
  };
}

/** List open pull requests / merge requests for the repository. */
export async function listPullRequests(info, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const env = options.env || process.env;
  if (info.provider === 'github') {
    const url = `${info.apiBase}/repos/${info.path}/pulls?state=open&sort=updated&direction=desc&per_page=${limit}`;
    const items = await requestJson(info, url, { ...options, env });
    return (Array.isArray(items) ? items : []).map(mapGithubPull);
  }
  const url = `${info.apiBase}/projects/${encodeURIComponent(info.path)}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=${limit}`;
  const items = await requestJson(info, url, { ...options, env });
  return (Array.isArray(items) ? items : []).map(mapGitlabPull);
}

/** Fetch one PR/MR (used when opening a review). */
export async function getPullRequest(info, number, options = {}) {
  const env = options.env || process.env;
  const id = Number(number);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`PR/MR 编号不合法：${number}`);
  if (info.provider === 'github') {
    const item = await requestJson(info, `${info.apiBase}/repos/${info.path}/pulls/${id}`, { ...options, env });
    return mapGithubPull(item);
  }
  const item = await requestJson(
    info,
    `${info.apiBase}/projects/${encodeURIComponent(info.path)}/merge_requests/${id}`,
    { ...options, env },
  );
  return mapGitlabPull(item);
}

/** Accept a bare number, a PR/MR URL, or a URL with a number fragment. */
export function parsePullNumber(input, info) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('缺少 PR/MR 编号或 URL。');
  if (/^\d+$/.test(raw)) return Number(raw);
  const githubMatch = /\/pull\/(\d+)(?:[/?#]|$)/i.exec(raw);
  const gitlabMatch = /\/merge_requests\/(\d+)(?:[/?#]|$)/i.exec(raw);
  const match = info?.provider === 'gitlab' ? gitlabMatch || githubMatch : githubMatch || gitlabMatch;
  if (!match) throw new Error(`无法从 URL 解析 PR/MR 编号：${raw}`);
  return Number(match[1]);
}

function defaultBaseBranch(repo, remote = 'origin') {
  const symbolic = repo.run(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], {
    allowFailure: true,
  });
  const value = String(symbolic.stdout || '').trim();
  if (symbolic.status === 0 && value) {
    return value.startsWith(`${remote}/`) ? value.slice(remote.length + 1) : value;
  }
  for (const candidate of ['main', 'master']) {
    if (repo.revParse(`refs/remotes/${remote}/${candidate}`)) return candidate;
  }
  return null;
}

/**
 * Fetch the PR/MR head + target branch into local refs. GitHub fork PRs are
 * fetched from the base repository's refs/pull/<n>/head; GitLab exposes
 * refs/merge-requests/<iid>/head in the target project.
 */
export function fetchPullRefs(repo, info, number, baseBranch, { remote = 'origin' } = {}) {
  const headRemoteRef = info.provider === 'github' ? `refs/pull/${number}/head` : `refs/merge-requests/${number}/head`;
  const headRef = `refs/diff-viz/pull/${number}`;
  const baseRef = `refs/remotes/${remote}/${baseBranch}`;
  const result = repo.run(
    ['fetch', '--no-tags', remote, `+${headRemoteRef}:${headRef}`, `+refs/heads/${baseBranch}:${baseRef}`],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(
      `拉取 ${info.provider === 'github' ? 'PR' : 'MR'} #${number} 的 ref 失败` +
        (stderr ? `：${stderr}` : '；请确认远端可访问、编号存在。'),
    );
  }
  if (!repo.revParse(headRef)) throw new Error(`拉取后找不到 ${headRef}。`);
  if (!repo.revParse(baseRef)) throw new Error(`拉取后找不到目标分支 ${baseBranch}。`);
  return { headRef, baseRef, baseBranch };
}

/**
 * Resolve everything needed to analyze a PR/MR: provider, metadata, base
 * branch, fetched refs and the `base...head` range used by the review pipeline.
 */
export async function preparePullReview(repo, { number, base, remote = 'origin', env = process.env, ...options } = {}) {
  const info = detectRepoProvider(repo, { remote, env });
  const pull = await getPullRequest(info, number, { env, ...options });
  const baseBranch = String(base || pull.targetBranch || defaultBaseBranch(repo, remote) || '').trim();
  if (!baseBranch) {
    throw new Error('无法确定 PR/MR 的目标分支；请用 --base <branch> 指定。');
  }
  const refs = fetchPullRefs(repo, info, pull.number, baseBranch, { remote });
  return {
    info,
    pull: {
      ...pull,
      baseBranch,
      remote,
      host: info.host,
      repoPath: info.path,
      webUrl: pull.url || `${info.webUrl}/pull/${pull.number}`,
    },
    baseRef: refs.baseRef,
    headRef: refs.headRef,
    range: `${refs.baseRef}...${refs.headRef}`,
  };
}

export function pullLabel(pull) {
  const provider = pull?.provider === 'gitlab' ? 'MR' : 'PR';
  return `${provider} #${pull?.number}${pull?.title ? ` · ${pull.title}` : ''}`;
}
