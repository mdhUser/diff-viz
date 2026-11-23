import { requestJsonRaw } from './remotes.mjs';

// Reviewer comments for a PR/MR. Comments are fetched separately from the diff
// and attached to the review so the UI can badge files that have feedback.
// A comment fetch failure must never fail the review itself.

const PAGE_SIZE = 100;
const MAX_PAGES = 6;
const MAX_COMMENTS = 500;
const MAX_BODY = 6000;

function safeHttpUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function truncateBody(body) {
  const text = String(body ?? '');
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}\n…（评论过长，已截断）` : text;
}

async function collectPages(info, baseUrl, options = {}) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${separator}per_page=${PAGE_SIZE}&page=${page}`;
    const { data } = await requestJsonRaw(info, url, options);
    const batch = Array.isArray(data) ? data : [];
    items.push(...batch);
    if (batch.length < PAGE_SIZE || items.length >= MAX_COMMENTS) break;
  }
  return items;
}

function mapGithubInline(item) {
  const line = Number.isFinite(item.line) ? item.line : Number.isFinite(item.original_line) ? item.original_line : null;
  return {
    id: `github:${item.id}`,
    provider: 'github',
    kind: 'inline',
    path: String(item.path || ''),
    oldPath: null,
    line,
    startLine: Number.isFinite(item.start_line) ? item.start_line : null,
    side: item.side === 'LEFT' ? 'old' : 'new',
    author: item.user?.login || '',
    createdAt: item.created_at || '',
    body: truncateBody(item.body),
    url: safeHttpUrl(item.html_url),
    resolved: null,
    outdated: item.line == null && item.original_line != null,
    replyTo: item.in_reply_to_id != null ? `github:${item.in_reply_to_id}` : null,
    threadId: item.in_reply_to_id != null ? `github-thread:${item.in_reply_to_id}` : `github-thread:${item.id}`,
  };
}

function mapGithubGeneral(item) {
  return {
    id: `github-issue:${item.id}`,
    provider: 'github',
    kind: 'general',
    path: '',
    oldPath: null,
    line: null,
    startLine: null,
    side: 'new',
    author: item.user?.login || '',
    createdAt: item.created_at || '',
    body: truncateBody(item.body),
    url: safeHttpUrl(item.html_url),
    resolved: null,
    outdated: false,
    replyTo: null,
    threadId: '',
  };
}

function mapGitlabNote(info, number, item) {
  const position = item.position || null;
  const path = position?.new_path || position?.old_path || '';
  const line = Number.isFinite(position?.new_line)
    ? position.new_line
    : Number.isFinite(position?.old_line)
      ? position.old_line
      : null;
  const resolved = item.resolvable === true ? Boolean(item.resolved) : null;
  return {
    id: `gitlab:${item.id}`,
    provider: 'gitlab',
    kind: path ? 'inline' : 'general',
    path,
    oldPath: position?.old_path || null,
    line,
    startLine: null,
    side: position?.old_line != null && position?.new_line == null ? 'old' : 'new',
    author: item.author?.name || item.author?.username || '',
    createdAt: item.created_at || '',
    body: truncateBody(item.body),
    url: `${info.webUrl}/-/merge_requests/${number}#note_${item.id}`,
    resolved,
    outdated: false,
    replyTo: null,
    threadId: item.discussion_id || `gitlab-note:${item.id}`,
  };
}

/**
 * Fetch all reviewer comments for a PR/MR.
 * Returns `{ comments, warnings }`; per-endpoint failures become warnings so a
 * missing `read_api`/`repo` scope only hides comments instead of breaking the
 * whole review.
 */
export async function fetchPullComments(info, number, options = {}) {
  const warnings = [];
  const env = options.env || process.env;
  const requestOptions = { ...options, env };
  const id = Number(number);
  if (!Number.isInteger(id) || id <= 0) return { comments: [], warnings: ['缺少有效的 PR/MR 编号，未读取评论。'] };
  const comments = [];

  if (info.provider === 'github') {
    try {
      const inline = await collectPages(
        info,
        `${info.apiBase}/repos/${info.path}/pulls/${id}/comments`,
        requestOptions,
      );
      comments.push(...inline.map((item) => mapGithubInline(item)));
    } catch (error) {
      warnings.push(`读取 GitHub 行内评论失败：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const general = await collectPages(
        info,
        `${info.apiBase}/repos/${info.path}/issues/${id}/comments`,
        requestOptions,
      );
      comments.push(...general.map((item) => mapGithubGeneral(item)));
    } catch (error) {
      warnings.push(`读取 GitHub 讨论评论失败：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    try {
      const notes = await collectPages(
        info,
        `${info.apiBase}/projects/${encodeURIComponent(info.path)}/merge_requests/${id}/notes?sort=asc&order_by=created_at`,
        requestOptions,
      );
      for (const note of notes) {
        if (note.system === true || note.system === 'true') continue;
        comments.push(mapGitlabNote(info, id, note));
      }
    } catch (error) {
      warnings.push(`读取 GitLab 评论失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  comments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { comments: comments.slice(0, MAX_COMMENTS), warnings };
}

/** Attach comments to review data and add per-file comment counters. */
export function attachComments(data, comments) {
  if (!data || typeof data !== 'object') return data;
  const list = Array.isArray(comments) ? comments.slice(0, MAX_COMMENTS) : [];
  const counts = new Map();
  for (const comment of list) {
    if (!comment?.path) continue;
    const path = String(comment.path).replace(/^\.\//, '');
    if (!counts.has(path)) counts.set(path, { total: 0, unresolved: 0 });
    const entry = counts.get(path);
    entry.total += 1;
    if (comment.resolved === false) entry.unresolved += 1;
  }
  for (const node of Array.isArray(data.nodes) ? data.nodes : []) {
    const paths = [node.path, node.oldPath].filter(Boolean);
    let total = 0;
    let unresolved = 0;
    for (const path of paths) {
      const entry = counts.get(String(path).replace(/^\.\//, ''));
      if (!entry) continue;
      total += entry.total;
      unresolved += entry.unresolved;
    }
    if (total > 0) {
      node.reviewComments = total;
      node.reviewCommentUnresolved = unresolved;
    }
  }
  data.comments = list;
  if (data.meta) {
    const unresolved = list.filter((comment) => comment.resolved === false).length;
    data.meta.pull = {
      ...(data.meta.pull || {}),
      commentCount: list.length,
      unresolvedCommentCount: unresolved,
    };
    data.meta.stats = { ...(data.meta.stats || {}), comments: list.length };
  }
  return data;
}

export { MAX_COMMENTS, MAX_BODY };
