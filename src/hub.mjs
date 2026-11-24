import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GitRepo, findRepoRoot } from './git.mjs';
import { applyAnnotations, buildReviewData, mergePreviousState } from './collect.mjs';
import { detectRepoProvider, listPullRequests, preparePullReview } from './remotes.mjs';
import { attachComments, fetchPullComments } from './comments.mjs';
import { updateReviewState, openInBrowser } from './server.mjs';
import { computeServiceImpact, detectServiceEdges, loadWorkspace } from './workspace.mjs';
import {
  checkRequestTrust,
  extractToken,
  hostAllowlist,
  readOrCreateToken,
  tokenCookie,
  tokenMatches,
} from './security.mjs';
import {
  copyReviewStore,
  isInside,
  readReviewStore,
  removeReviewStore,
  writeReviewStore,
} from './review-store.mjs';
import {
  ensurePrivateDir,
  formatTimestamp,
  readJsonSafe,
  shortId,
  stateHome,
  toPosix,
  writeJsonAtomic,
} from './util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const BIN_PATH = path.resolve(__dirname, '..', 'bin', 'diff-viz.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

export function hubHome() {
  return stateHome();
}

export function hubRegistryPath(home = hubHome()) {
  return path.join(home, 'hub.json');
}

export function readHubInfo(home = hubHome()) {
  return readJsonSafe(hubRegistryPath(home));
}

// Append the access token to a URL the CLI prints / opens. Relative paths stay
// relative so existing `new URL(payload.url, hub.url)` call sites keep working.
export function withHubToken(target, token) {
  if (!token) return String(target);
  const value = String(target);
  try {
    const parsed = new URL(value, 'http://127.0.0.1');
    parsed.searchParams.set('token', token);
    return value.startsWith('/') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    return value;
  }
}

export function hubAuthHeaders(info) {
  return info?.token ? { 'X-Diff-Viz-Token': info.token } : {};
}

export async function hubIsAlive(info) {
  if (!info?.port) return false;
  const host = info.host === '0.0.0.0' || info.host === '::' ? '127.0.0.1' : info.host || '127.0.0.1';
  try {
    const response = await fetch(`http://${host}:${info.port}/api/health`, {
      signal: AbortSignal.timeout(900),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.service === 'diff-viz-hub';
  } catch {
    return false;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req, limit = 80 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(DIST_DIR, relative);
  if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (!path.extname(relative)) filePath = path.join(DIST_DIR, 'index.html');
    else {
      sendText(res, 404, 'Not found');
      return;
    }
  }
  const body = await fsp.readFile(filePath);
  const isHashedAsset = relative.startsWith('assets/');
  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-store',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    // The printed URL carries the access token; never leak it through Referer.
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function safeReviewId(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 160);
  return cleaned || fallback;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function loadProjects(home) {
  const file = path.join(home, 'projects.json');
  const raw = readJsonSafe(file);
  const projects = new Map();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item?.root || !item?.id) continue;
      projects.set(item.id, item);
    }
  }
  return projects;
}

// A snapshot is either a v2 review directory or a legacy `<id>.json` file.
function listReviewSnapshots(reviewsDir) {
  let names = [];
  try {
    names = fs.readdirSync(reviewsDir);
  } catch {
    return [];
  }
  const snapshots = [];
  for (const name of names) {
    const full = path.join(reviewsDir, name);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!fs.existsSync(path.join(full, 'manifest.json'))) continue;
      snapshots.push({ path: full, id: name, mtime: stat.mtimeMs, kind: 'dir' });
    } else if (stat.isFile() && name.endsWith('.json')) {
      snapshots.push({ path: full, id: name.replace(/\.json$/, ''), mtime: stat.mtimeMs, kind: 'file' });
    }
  }
  return snapshots;
}

function tightenReviewTree(dir) {
  // Split snapshots are created by this version with 0700/0600 already; walk
  // only when the directory mode shows it came from somewhere else. This keeps
  // hub startup O(reviews) instead of O(total node files). Windows has no
  // POSIX modes, so there is nothing to tighten there.
  if (process.platform === 'win32') return;
  try {
    if ((fs.statSync(dir).mode & 0o777) === 0o700) return;
  } catch {
    return;
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      tightenReviewTree(full);
    } else {
      try {
        fs.chmodSync(full, 0o600);
      } catch {
        /* ignore */
      }
    }
  }
}

export async function startHub({
  port = 5173,
  host = '127.0.0.1',
  open = false,
  quiet = false,
  home = hubHome(),
  auth = process.env.DIFF_VIZ_NO_AUTH !== '1',
} = {}) {
  ensurePrivateDir(home);
  const reviewsDir = path.join(home, 'reviews');
  ensurePrivateDir(reviewsDir);
  ensurePrivateDir(path.join(home, 'cache'));
  // `/api/*` is the source-code surface; everything except the health probe
  // needs this token. Host allowlisting (below) is what stops DNS rebinding.
  const token = auth ? readOrCreateToken(home) : null;
  const allowedHosts = hostAllowlist(host);
  const projectsFile = path.join(home, 'projects.json');
  const projects = loadProjects(home);
  const reviews = new Map();

  // Review snapshots embed full source, so drop the oldest ones instead of
  // letting the directory grow without bound. Never drop a project's last review.
  const pruneReviews = () => {
    const keep = Math.max(5, Number(process.env.DIFF_VIZ_KEEP_REVIEWS) || 50);
    const snapshots = listReviewSnapshots(reviewsDir);
    if (snapshots.length <= keep) return 0;
    const protectedIds = new Set(
      [...projects.values()].map((project) => project.lastReviewId).filter(Boolean),
    );
    const stats = snapshots.sort((a, b) => b.mtime - a.mtime);
    let removed = 0;
    for (const item of stats.slice(keep)) {
      if (protectedIds.has(item.id)) continue;
      try {
        removeReviewStore(item.path);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
    return removed;
  };

  // Snapshots created by an older version may still be world-readable.
  const tightenPermissions = () => {
    for (const dir of [home, reviewsDir]) {
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        /* ignore */
      }
    }
    for (const snapshot of listReviewSnapshots(reviewsDir)) {
      if (snapshot.kind === 'dir') tightenReviewTree(snapshot.path);
      else {
        try {
          fs.chmodSync(snapshot.path, 0o600);
        } catch {
          /* ignore */
        }
      }
    }
    try {
      fs.chmodSync(projectsFile, 0o600);
    } catch {
      /* ignore */
    }
  };
  pruneReviews();
  tightenPermissions();

  const saveProjects = () => {
    writeJsonAtomic(projectsFile, [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)));
  };

  // v2 snapshots are directories; `<id>.json` files stay readable so reviews
  // written by an older version keep working.
  const reviewPath = (reviewId) => path.join(reviewsDir, safeReviewId(reviewId, 'review'));
  const legacyReviewFile = (reviewId) => path.join(reviewsDir, `${safeReviewId(reviewId, 'review')}.json`);

  const sseClients = new Set();
  const watchers = new Map();
  const lastPayloads = new Map();
  const pullListCache = new Map();
  const PULL_LIST_TTL = 60_000;
  const WATCH_IGNORE = /(^|\/)(\.git|node_modules|dist|build|\.next|out|target|vendor|__pycache__|\.venv|venv)(\/|$)/;

  const broadcast = (event) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const scheduleReanalyze = (project) => {
    const entry = watchers.get(project.id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const payload = lastPayloads.get(project.id);
      if (!payload || payload.pull) return;
      try {
        const { reviewId } = analyzeProject(project, payload);
        broadcast({ type: 'review-updated', projectId: project.id, reviewId, at: Date.now() });
      } catch {
        /* mid-rebase and other transient states are expected to fail */
      }
    }, 700);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  };

  const watchProject = (project) => {
    if (process.env.DIFF_VIZ_NO_WATCH === '1' || watchers.has(project.id)) return;
    let watcher;
    try {
      watcher = fs.watch(project.root, { recursive: true, persistent: false }, (_event, filename) => {
        const relative = typeof filename === 'string' ? toPosix(filename) : '';
        if (relative && (WATCH_IGNORE.test(relative) || relative.includes('.diff-review-data.json'))) return;
        scheduleReanalyze(project);
      });
    } catch {
      return;
    }
    watcher.on('error', () => {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      watchers.delete(project.id);
    });
    watchers.set(project.id, { watcher, timer: null });
  };

  // The cache holds stores (manifest + payload dir handle), not full reviews:
  // manifest reads are small and node content is fetched from disk on demand.
  const loadStore = (reviewId) => {
    if (reviews.has(reviewId)) return reviews.get(reviewId);
    const dir = reviewPath(reviewId);
    const legacy = legacyReviewFile(reviewId);
    const target = fs.existsSync(path.join(dir, 'manifest.json'))
      ? dir
      : fs.existsSync(legacy)
        ? legacy
        : null;
    if (!target) return null;
    const store = readReviewStore(target);
    reviews.set(reviewId, store);
    return store;
  };

  const loadReview = (reviewId) => loadStore(reviewId)?.manifest ?? null;

  /* ---------------- agent annotation memory ----------------
   * Agent summaries used to live only in the Review snapshot they were
   * applied to. Committing creates a new commit Review with a different id,
   * and a watch re-analysis can overwrite the worktree Review with an empty
   * diff, so those summaries disappeared from the page. Remember the latest
   * agent summary per file+diff-content in a project-scoped store and reuse
   * it whenever the same change shows up in another Review.
   */
  const annotationsDir = path.join(home, 'annotations');
  ensurePrivateDir(annotationsDir);
  const annotationStores = new Map();
  const MAX_ANNOTATION_ENTRIES = 5000;

  const annotationStoreFile = (projectId) => path.join(annotationsDir, `${safeReviewId(projectId, 'project')}.json`);

  const readAnnotationStore = (projectId) => {
    if (annotationStores.has(projectId)) return annotationStores.get(projectId);
    const raw = readJsonSafe(annotationStoreFile(projectId));
    const store =
      raw && typeof raw === 'object' && raw.nodes && typeof raw.nodes === 'object'
        ? raw
        : { version: 1, updatedAt: null, nodes: {} };
    annotationStores.set(projectId, store);
    return store;
  };

  const saveAnnotationStore = (projectId, store) => {
    store.updatedAt = formatTimestamp();
    writeJsonAtomic(annotationStoreFile(projectId), store);
  };

  // `index` lines carry blob hashes that differ between an uncommitted file and
  // the same content after a commit; strip them so the key is content-based.
  const normalizeDiffForKey = (diff) => String(diff ?? '').replace(/^index [0-9a-f]+\.\.[0-9a-f]+.*$/gm, '');

  const annotationKey = (nodePath, diff) => shortId(`${nodePath}\u0000${normalizeDiffForKey(diff)}`, 24);

  // Review-level key for the overall agent summary: the exact set of changed
  // files and their normalized diffs. Same change committed or still in the
  // worktree keeps the key; any content change breaks it. This needs the diffs,
  // so opening an old manifest-only Review has to read the node payloads (the
  // caller may pass `readDiff`); very large Reviews skip the reuse instead.
  const MAX_OVERALL_KEY_READS = 800;
  // One pass builds both the review-level hash and the path -> content-key map
  // used for overlap matching (payloads are read at most once when needed).
  const buildChangeInfo = (nodes, readDiff = null) => {
    const changed = (nodes || []).filter((node) => node && node.status !== 'impacted_only');
    if (changed.length === 0) return null;
    const needsReads = typeof readDiff === 'function' && changed.some((node) => typeof node.diff !== 'string');
    if (needsReads && changed.length > MAX_OVERALL_KEY_READS) return null;
    const parts = [];
    const changes = {};
    for (const node of changed) {
      const diff = typeof node.diff === 'string' ? node.diff : needsReads ? readDiff(node) : undefined;
      if (typeof diff !== 'string') return null;
      const normalized = normalizeDiffForKey(diff);
      parts.push(`${node.path}\u0000${normalized}`);
      changes[node.path] = annotationKey(node.path, diff);
    }
    parts.sort();
    return { hash: shortId(parts.join('\u0001'), 24), changes };
  };
  const reviewContentKey = (nodes, readDiff = null) => buildChangeInfo(nodes, readDiff)?.hash ?? null;

  const agentTodosOf = (node) =>
    Array.isArray(node?.todos) ? node.todos.filter((todo) => todo?.source === 'agent') : [];
  const hasAgentContent = (node) =>
    Boolean(node) && (node.summarySource === 'agent' || node.impactSource === 'agent' || agentTodosOf(node).length > 0);

  const nodeDiffOf = (node, readPayload) => {
    if (typeof node.diff === 'string') return node.diff;
    if (typeof readPayload !== 'function' || !node.payload) return undefined;
    return readPayload(node)?.diff;
  };

  const harvestAnnotations = (projectId, source) => {
    const nodes = source?.nodes ?? source?.data?.nodes;
    if (!projectId || !Array.isArray(nodes)) return 0;
    const meta = source?.meta ?? source?.manifest?.meta ?? source?.data?.meta ?? null;
    const readPayload = typeof source?.readPayload === 'function' ? source.readPayload.bind(source) : null;
    const store = readAnnotationStore(projectId);
    let changed = 0;
    for (const node of nodes) {
      if (!hasAgentContent(node)) continue;
      const diff = nodeDiffOf(node, readPayload);
      if (typeof diff !== 'string') continue;
      const key = annotationKey(node.path, diff);
      const next = {
        key,
        summary: node.summarySource === 'agent' ? String(node.summary || '') : '',
        impactAnalysis: node.impactSource === 'agent' ? String(node.impactAnalysis || '') : '',
        todos: agentTodosOf(node).map((todo) => ({ ...todo })),
      };
      const current = store.nodes[node.path];
      if (
        current &&
        current.key === key &&
        current.summary === next.summary &&
        current.impactAnalysis === next.impactAnalysis &&
        JSON.stringify(current.todos || []) === JSON.stringify(next.todos)
      ) {
        continue;
      }
      store.nodes[node.path] = { ...next, updatedAt: formatTimestamp() };
      changed += 1;
    }
    // Overall summaries are review-scoped, so key them by the exact change set.
    const readDiff = readPayload ? (node) => nodeDiffOf(node, readPayload) : null;
    // Keep a path -> content-key map so a later Review with a heavily
    // overlapping change set (same branch, a few extra/removed files) can
    // still reuse its overview.
    const changeInfo = meta && meta.summarySource === 'agent' ? buildChangeInfo(nodes, readDiff) : null;
    const overallKey = changeInfo?.hash ?? null;
    const overallText = overallKey ? String(meta.overallSummary || '').trim() : '';
    if (overallKey && overallText) {
      store.overalls = store.overalls && typeof store.overalls === 'object' ? store.overalls : {};
      const changes = changeInfo.changes;
      const currentOverall = store.overalls[overallKey];
      if (!currentOverall || currentOverall.summary !== overallText) {
        store.overalls[overallKey] = { summary: overallText, changes, updatedAt: formatTimestamp() };
        changed += 1;
      } else if (changes && !currentOverall.changes) {
        currentOverall.changes = changes;
        changed += 1;
      }
      const overallKeys = Object.keys(store.overalls);
      if (overallKeys.length > MAX_ANNOTATION_ENTRIES) {
        overallKeys.sort((a, b) =>
          String(store.overalls[a].updatedAt).localeCompare(String(store.overalls[b].updatedAt)),
        );
        for (const oldKey of overallKeys.slice(0, overallKeys.length - MAX_ANNOTATION_ENTRIES)) {
          delete store.overalls[oldKey];
        }
      }
    }
    if (changed > 0) {
      const paths = Object.keys(store.nodes);
      if (paths.length > MAX_ANNOTATION_ENTRIES) {
        paths.sort((a, b) => String(store.nodes[a].updatedAt).localeCompare(String(store.nodes[b].updatedAt)));
        for (const oldPath of paths.slice(0, paths.length - MAX_ANNOTATION_ENTRIES)) delete store.nodes[oldPath];
      }
      saveAnnotationStore(projectId, store);
    }
    return changed;
  };

  const applyAnnotationsFromStore = (projectId, data, { readPayload = null } = {}) => {
    const store = readAnnotationStore(projectId);
    let applied = 0;
    // Review-level overall summary: only fill it when the current Review does
    // not already carry an agent-written overview and the change set matches.
    if (data?.meta && !(data.meta.summarySource === 'agent' && String(data.meta.overallSummary || '').trim())) {
      const readDiff = readPayload ? (node) => nodeDiffOf(node, readPayload) : null;
      const overalls = store.overalls && typeof store.overalls === 'object' ? store.overalls : {};
      const changeInfo = buildChangeInfo(data.nodes, readDiff);
      const currentChanges = changeInfo?.changes ?? null;
      const overallKey = changeInfo?.hash ?? null;
      let remembered = overallKey ? overalls[overallKey] : null;
      if (!remembered?.summary && currentChanges) {
        // Fall back to the stored overview whose change set overlaps the current
        // one the most: same branch with a few added/removed files still counts,
        // a mostly different change set does not.
        const currentCount = Object.keys(currentChanges).length;
        const minimum = Math.max(3, Math.ceil(currentCount * 0.5));
        let best = null;
        for (const entry of Object.values(overalls)) {
          if (!entry?.summary || !entry.changes) continue;
          const storedPaths = Object.keys(entry.changes);
          if (storedPaths.length === 0) continue;
          let matched = 0;
          for (const [nodePath, key] of Object.entries(entry.changes)) {
            if (currentChanges[nodePath] === key) matched += 1;
          }
          if (matched < minimum) continue;
          if (matched < Math.ceil(storedPaths.length * 0.5)) continue;
          if (!best || matched > best.matched) best = { entry, matched };
        }
        remembered = best?.entry ?? null;
      }
      if (remembered?.summary) {
        data.meta.overallSummary = remembered.summary;
        data.meta.summarySource = 'agent';
        applied += 1;
      }
    }
    for (const node of data?.nodes ?? []) {
      if (!node || node.status === 'impacted_only') continue;
      if (hasAgentContent(node)) continue;
      const entry = store.nodes[node.path];
      if (!entry) continue;
      const diff = nodeDiffOf(node, readPayload);
      if (typeof diff !== 'string' || entry.key !== annotationKey(node.path, diff)) continue;
      if (entry.summary) {
        node.summary = entry.summary;
        node.summarySource = 'agent';
      }
      if (entry.impactAnalysis) {
        node.impactAnalysis = entry.impactAnalysis;
        node.impactSource = 'agent';
      }
      const todos = Array.isArray(node.todos) ? node.todos : (node.todos = []);
      const texts = new Set(todos.map((todo) => todo?.text));
      for (const todo of entry.todos || []) {
        if (!todo?.text || texts.has(todo.text)) continue;
        todos.push({ ...todo, id: todo.id || `a-${shortId(`${node.path}::${todo.text}`, 10)}` });
        texts.add(todo.text);
      }
      applied += 1;
    }
    return applied;
  };

  // Seed the store from reviews written before this feature existed. Runs at
  // most once per project per hub process, oldest snapshots first so the most
  // recent annotation wins.
  const backfilledProjects = new Set();
  const backfillProjectAnnotations = (projectId) => {
    if (!projectId || backfilledProjects.has(projectId)) return;
    backfilledProjects.add(projectId);
    const snapshots = listReviewSnapshots(reviewsDir)
      .filter((snapshot) => snapshot.id.startsWith(`${projectId}-`))
      .sort((a, b) => a.mtime - b.mtime);
    for (const snapshot of snapshots) {
      try {
        const source = readReviewStore(snapshot.path, { strict: false });
        if (source) harvestAnnotations(projectId, source);
      } catch {
        /* a broken old snapshot must not break Review generation */
      }
    }
  };

  const projectIdOfReview = (data, reviewId) =>
    data?.meta?.projectId ||
    (typeof reviewId === 'string' && /^[0-9a-f]{12}-/.test(reviewId) ? reviewId.slice(0, 12) : null);

  // Give an already-stored Review the agent annotations remembered for the same
  // file contents; used when opening a historical Review from the version chain.
  const reuseStoredAnnotations = (store, reviewId) => {
    const data = store?.manifest;
    const projectId = projectIdOfReview(data, reviewId);
    if (!projectId) return 0;
    backfillProjectAnnotations(projectId);
    const applied = applyAnnotationsFromStore(projectId, data, {
      readPayload: (node) => store.readPayload(node),
    });
    if (applied > 0) store.save();
    return applied;
  };

  const saveReview = (reviewId, data, projectId) => {
    const dir = reviewPath(reviewId);
    ensurePrivateDir(dir);
    writeReviewStore(dir, data);
    // A legacy snapshot with the same id would shadow the new directory.
    try {
      fs.rmSync(legacyReviewFile(reviewId), { force: true });
    } catch {
      /* ignore */
    }
    reviews.set(reviewId, readReviewStore(dir));
    if (projectId) harvestAnnotations(projectId, data);
    const project = projectId ? projects.get(projectId) : null;
    if (project) {
      project.lastReviewId = reviewId;
      project.updatedAt = formatTimestamp();
      saveProjects();
    }
  };

  const normalizeRoot = (root) => {
    const absolute = path.resolve(String(root));
    try {
      return fs.realpathSync(absolute);
    } catch {
      return absolute;
    }
  };

  const registerProject = (rootInput) => {
    if (!rootInput) throw new Error('缺少仓库路径。');
    const candidate = normalizeRoot(rootInput);
    let stat = null;
    try {
      stat = fs.statSync(candidate);
    } catch {
      throw new Error(`目录不存在：${candidate}`);
    }
    if (!stat.isDirectory()) throw new Error(`不是目录：${candidate}`);
    let top = '';
    try {
      top = findRepoRoot(candidate);
    } catch {
      throw new Error(`不是 Git 仓库：${candidate}`);
    }
    if (!top) throw new Error(`不是 Git 仓库：${candidate}`);
    const repo = new GitRepo(normalizeRoot(top));
    const root = normalizeRoot(repo.root);
    const id = shortId(root, 12);
    const existing = projects.get(id);
    const project = {
      id,
      root,
      name: path.basename(root),
      branch: repo.branchName(),
      lastReviewId: existing?.lastReviewId ?? null,
      updatedAt: formatTimestamp(),
    };
    projects.set(id, project);
    saveProjects();
    return project;
  };

  const removeProject = (id) => {
    if (!id || !projects.has(id)) return false;
    projects.delete(id);
    saveProjects();
    return true;
  };

  const getProject = (idInput) => {
    if (!idInput) throw new Error('缺少 projectId。');
    const project = projects.get(idInput);
    if (!project) throw new Error(`未知仓库：${idInput}`);
    return project;
  };

  const reviewIdFor = (projectId, scope, data, payload) => {
    if (payload.pull?.number) return `${projectId}-pull-${payload.pull.number}`;
    if (scope === 'worktree') return `${projectId}-worktree`;
    if (scope === 'staged') return `${projectId}-staged`;
    if (scope === 'commit') return `${projectId}-commit-${String(payload.commit).slice(0, 12)}`;
    const head = data.meta?.headRef ?? '';
    return `${projectId}-${scope}-${shortId(`${payload.range ?? payload.base ?? ''}:${head}`, 10)}`;
  };

  const analyzeProject = (project, payload) => {
    const scope = payload.scope || 'worktree';
    // The browser has no knob for analyzer limits, and a worktree re-analysis
    // (file watch, bare hub URL) must not silently reset what the CLI asked for:
    // reuse the remembered cap unless this request sets one explicitly.
    const remembered = lastPayloads.get(project.id) || {};
    const maxScanFiles = payload.maxScanFiles ?? remembered.maxScanFiles;
    const options = {};
    if (scope === 'worktree') options.worktree = true;
    else if (scope === 'staged') options.staged = true;
    else if (scope === 'last') options.last = true;
    else if (scope === 'commit') options.commit = payload.commit;
    else if (scope === 'range') options.range = payload.range;
    else if (scope === 'base') options.base = payload.base;
    else throw new Error(`不支持的 scope：${scope}`);
    if (payload.annotations && typeof payload.annotations === 'object') options.annotations = payload.annotations;
    if (payload.summary) options.summary = String(payload.summary);
    if (maxScanFiles) options.maxScanFiles = Number(maxScanFiles);

    const data = buildReviewData(new GitRepo(project.root), options);
    const reviewId = reviewIdFor(project.id, scope, data, payload);
    data.meta.projectId = project.id;
    data.meta.reviewId = reviewId;
    data.meta.scopeLabel = payload.pull ? 'pull' : scope;
    if (payload.pull) {
      data.meta.pull = payload.pull;
      data.meta.rangeLabel =
        `${payload.pull.provider === 'gitlab' ? 'MR' : 'PR'} #${payload.pull.number}` +
        `${payload.pull.title ? ` · ${payload.pull.title}` : ''}`;
      if (payload.pull.sourceBranch) data.meta.branch = payload.pull.sourceBranch;
    }
    if (payload.pullComments) attachComments(data, payload.pullComments);
    if (payload.pullWarnings?.length) {
      data.meta.warnings = [...(data.meta.warnings || []), ...payload.pullWarnings];
    }
    const previousStore = loadStore(reviewId);
    if (previousStore) harvestAnnotations(project.id, previousStore);
    backfillProjectAnnotations(project.id);
    applyAnnotationsFromStore(project.id, data);
    const previous = previousStore?.manifest ?? null;
    if (previous) mergePreviousState(data, previous);
    saveReview(reviewId, data, project.id);
    // Only worktree/staged payloads are safe to replay from the file watcher.
    // Replaying a pull review would rebuild it without comments (the comments
    // come from a separate API call) and would replace the active review id, so
    // a PR/MR must never become the project's remembered payload.
    if (!payload.pull) {
      const { pullComments: _comments, pullWarnings: _pullWarnings, ...rememberedPayload } = payload;
      lastPayloads.set(project.id, {
        ...rememberedPayload,
        scope,
        ...(maxScanFiles ? { maxScanFiles: Number(maxScanFiles) } : {}),
      });
      watchProject(project);
    }
    return { reviewId, data };
  };

  // Workspace analyses used to overwrite a single snapshot per workspace file,
  // so committing the change made the previous graph unreachable. Archive the
  // previous stable snapshot before writing the new one; the history endpoint
  // lists those archives plus the current version.
  const archiveWorkspaceReview = (reviewId) => {
    const existing = loadStore(reviewId);
    if (!existing?.manifest?.meta?.workspace) return null;
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    let archiveId = `${reviewId}-${stamp}`;
    let suffix = 1;
    while (fs.existsSync(reviewPath(archiveId))) {
      archiveId = `${reviewId}-${stamp}-${suffix}`;
      suffix += 1;
    }
    try {
      copyReviewStore(existing, reviewPath(archiveId), {
        metaPatch: {
          reviewId: archiveId,
          archived: true,
          archivedAt: formatTimestamp(),
          archivedFrom: reviewId,
        },
      });
      reviews.delete(reviewId);
      return archiveId;
    } catch {
      // History is best effort: never fail a fresh analysis because archiving
      // the previous one failed.
      return null;
    }
  };

  const workspaceHistory = (file) => {
    const canonicalPath = (value) => {
      const resolved = path.resolve(String(value || ''));
      try {
        return fs.realpathSync.native(resolved);
      } catch {
        try {
          return fs.realpathSync(resolved);
        } catch {
          return resolved;
        }
      }
    };
    const resolvedFile = canonicalPath(file);
    const versions = [];
    for (const snapshot of listReviewSnapshots(reviewsDir)) {
      try {
        const store = readReviewStore(snapshot.path, { strict: false });
        const meta = store?.manifest?.meta;
        if (!meta?.workspace || !meta.file) continue;
        if (canonicalPath(meta.file) !== resolvedFile) continue;
        const repos = Array.isArray(meta.repos) ? meta.repos : [];
        versions.push({
          reviewId: String(meta.reviewId || snapshot.id),
          timestamp: String(meta.timestamp || ''),
          archived: Boolean(meta.archived),
          stats: meta.stats || {},
          scopes: repos.map((repo) => ({ name: repo.name, mode: repo.scopeMode, label: repo.scopeLabel })),
          mtime: snapshot.mtime,
        });
      } catch {
        /* a broken snapshot must not hide the rest of the history */
      }
    }
    versions.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || b.mtime - a.mtime);
    return versions.slice(0, 30);
  };

  // Multi-repository review: analyze each repo with the existing pipeline, then
  // merge into one service-level graph. Links come from manifests plus whatever
  // the workspace file declares.
  const analyzeWorkspace = (file) => {
    const workspace = loadWorkspace(file);
    const repos = [];
    const errors = [...(workspace.warnings || [])];
    for (const entry of workspace.repos) {
      try {
        const project = registerProject(entry.root);
        // Each repository may compare against its own scope (branch, range,
        // commit); the workspace-level scope is the default.
        const requested = entry.scope || { mode: 'worktree' };
        const payload = { scope: requested.mode };
        if (requested.range) payload.range = requested.range;
        if (requested.base) payload.base = requested.base;
        if (requested.commit) payload.commit = requested.commit;
        const { reviewId, data } = analyzeProject(project, payload);
        // Surface the per-repo scan cap on the workspace page too; otherwise a
        // truncated repo silently looks like a repo with very little impact.
        if (data.meta.scanLimit?.truncated) {
          errors.push(
            `${entry.label || entry.id}：依赖扫描只分析了前 ${data.meta.scanLimit.limit} 个代码文件（共 ${data.meta.scanLimit.codeFiles} 个），影响分析可能不完整。`,
          );
        }
        const changed = data.nodes.filter((node) => node.status !== 'impacted_only').length;
        repos.push({
          id: entry.id,
          name: entry.label,
          root: project.root,
          branch: project.branch,
          projectId: project.id,
          reviewId,
          changed,
          scopeMode: requested.mode,
          scopeLabel: data.meta.rangeLabel || requested.mode,
          stats: data.meta.stats,
        });
      } catch (error) {
        errors.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const links = detectServiceEdges(repos, workspace.links);
    const changedIds = repos.filter((repo) => repo.changed > 0).map((repo) => repo.id);
    const { depth, origins } = computeServiceImpact(repos, links, changedIds);
    const reviewId = `workspace-${shortId(path.resolve(file), 10)}`;
    const data = {
      meta: {
        workspace: true,
        name: workspace.name,
        file: path.resolve(file),
        timestamp: formatTimestamp(),
        generator: 'diff-viz',
        reviewId,
        stats: {
          repos: repos.length,
          changed: changedIds.length,
          impacted: repos.filter((repo) => (depth.get(repo.id) ?? 0) > 0).length,
        },
        warnings: errors,
        // Stored under meta because the split review storage only persists meta,
        // edges and node stubs at the top level.
        repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        root: repo.root,
        branch: repo.branch,
        projectId: repo.projectId,
        reviewId: repo.reviewId,
        changed: repo.changed > 0,
        scopeMode: repo.scopeMode,
        scopeLabel: repo.scopeLabel,
        depth: depth.get(repo.id) ?? null,
        impactOrigins: [...(origins.get(repo.id) || [])],
        stats: repo.stats,
        })),
        serviceEdges: links,
      },
      nodes: [],
      edges: [],
    };
    archiveWorkspaceReview(reviewId);
    saveReview(reviewId, data);
    return { reviewId, data };
  };

  const imports = async (payload) => {
    const project = registerProject(payload.root);
    // Same-machine imports can point at the CLI's data file: copying node files
    // avoids serialising the whole review into one HTTP body and one JSON
    // string. Only paths inside the registered repository are accepted.
    let sourceStore = null;
    if (payload.dataPath) {
      const candidate = path.resolve(String(payload.dataPath));
      if (isInside(project.root, candidate)) {
        try {
          sourceStore = readReviewStore(candidate, { strict: false });
        } catch {
          sourceStore = null;
        }
      }
    }
    let data = null;
    if (!sourceStore) {
      data = payload.data;
      if (!data?.meta || !Array.isArray(data.nodes)) throw new Error('导入的数据格式不正确。');
    }
    const meta = sourceStore ? sourceStore.manifest.meta : data.meta;
    const inferredScope =
      meta.mode === 'worktree' ? 'worktree' : meta.mode === 'staged' ? 'staged' : 'range';
    const inferredId =
      meta.pull?.number
        ? `${project.id}-pull-${meta.pull.number}`
        : inferredScope === 'range'
          ? `${project.id}-range-${shortId(`${meta.rangeLabel}:${meta.headRef}`, 10)}`
          : `${project.id}-${inferredScope}`;
    const reviewId = safeReviewId(payload.reviewId || meta.reviewId, inferredId);
    const patch = { projectId: project.id, reviewId };
    const dir = reviewPath(reviewId);
    ensurePrivateDir(dir);

    backfillProjectAnnotations(project.id);
    if (sourceStore) harvestAnnotations(project.id, sourceStore);
    if (data) applyAnnotationsFromStore(project.id, data);
    const previousStore = loadStore(reviewId);
    if (previousStore) harvestAnnotations(project.id, previousStore);
    const previous = previousStore?.manifest ?? null;
    let manifest;
    if (sourceStore) {
      if (previous) mergePreviousState(sourceStore.manifest, previous);
      manifest = copyReviewStore(sourceStore, dir, { metaPatch: patch });
    } else {
      if (previous) mergePreviousState(data, previous);
      data.meta = { ...data.meta, ...patch };
      manifest = writeReviewStore(dir, data);
    }
    try {
      fs.rmSync(legacyReviewFile(reviewId), { force: true });
    } catch {
      /* ignore */
    }
    const importedStore = readReviewStore(dir);
    reviews.set(reviewId, importedStore);
    harvestAnnotations(project.id, importedStore);
    project.lastReviewId = reviewId;
    project.updatedAt = formatTimestamp();
    saveProjects();
    // Only working-tree scopes can be re-derived after a file change; commit and
    // range reviews stay as they were generated.
    if (inferredScope === 'worktree' || inferredScope === 'staged') {
      const remembered = lastPayloads.get(project.id)?.maxScanFiles;
      const maxScanFiles = payload.maxScanFiles ?? remembered;
      lastPayloads.set(project.id, {
        scope: inferredScope,
        ...(maxScanFiles ? { maxScanFiles: Number(maxScanFiles) } : {}),
      });
      watchProject(project);
    }
    return { reviewId, data: manifest };
  };

  const handler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    try {
      const untrusted = checkRequestTrust(req, { hostnames: allowedHosts });
      if (untrusted) {
        sendJson(res, 403, { error: untrusted });
        return;
      }
      const isApi = pathname === '/api' || pathname.startsWith('/api/');
      // Health stays open so `hubIsAlive` can detect a hub whose token is not
      // known yet; it exposes no repository data.
      const needsToken = Boolean(token) && isApi && pathname !== '/api/health';
      if (needsToken && !tokenMatches(token, extractToken(req, url))) {
        sendJson(res, 401, {
          error:
            '缺少或无效的访问令牌：请从 diff-viz 打印的带 token 链接打开，或在请求头带上 X-Diff-Viz-Token（token 见 ~/.diff-viz/token）。',
        });
        return;
      }
      // Trade a valid `?token=` on a page request for an HttpOnly cookie, so
      // refreshing or bookmarking the page keeps working without the token.
      if (token && !isApi) {
        const fromUrl = url.searchParams.get('token');
        if (fromUrl && tokenMatches(token, fromUrl)) {
          res.setHeader('Set-Cookie', tokenCookie(token));
        }
      }

      if (pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'diff-viz-hub',
          port: server.address()?.port ?? port,
          reviews: reviews.size,
          projects: projects.size,
        });
        return;
      }

      if (pathname === '/api/hub') {
        sendJson(res, 200, {
          ok: true,
          home,
          projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
        });
        return;
      }

      if (pathname === '/api/pulls') {
        const project = getProject(url.searchParams.get('project'));
        const refresh = url.searchParams.get('refresh') === '1';
        const cached = pullListCache.get(project.id);
        if (!refresh && cached && Date.now() - cached.at < PULL_LIST_TTL) {
          sendJson(res, 200, cached.value);
          return;
        }
        const info = detectRepoProvider(new GitRepo(project.root));
        const pulls = await listPullRequests(info, { limit: Number(url.searchParams.get('limit')) || 30 });
        const value = {
          provider: info.provider,
          host: info.host,
          repoPath: info.path,
          webUrl: info.webUrl,
          pulls,
        };
        pullListCache.set(project.id, { at: Date.now(), value });
        sendJson(res, 200, value);
        return;
      }

      if (pathname === '/api/commits') {
        const project = getProject(url.searchParams.get('project'));
        const repo = new GitRepo(project.root);
        // Default to the checked-out branch: `--all` mixes every colleague's
        // remote branch into the version chain and makes it look unrelated to
        // the repository the user has open. The all-refs view stays available
        // explicitly via `?all=1`.
        const all = url.searchParams.get('all') === '1';
        const branch = repo.branchName();
        if (branch && branch !== project.branch) {
          project.branch = branch;
          project.updatedAt = formatTimestamp();
          saveProjects();
        }
        const args = [
          'log',
          '--date-order',
          '-n',
          '80',
          '--pretty=format:%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%aI%x1f%D',
        ];
        if (all) args.splice(1, 0, '--all');
        else if (branch && branch !== 'unborn') args.push(branch);
        else args.push('HEAD');
        const { stdout } = repo.run(args, { allowFailure: true });
        const commits = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [sha, short, parentsRaw, subject, author, date, decorations] = line.split('\x1f');
            const refs = (decorations || '')
              .split(',')
              .map((ref) => ref.trim())
              .filter(Boolean)
              .map((ref) => {
                if (ref === 'HEAD') return 'HEAD';
                if (ref.startsWith('HEAD -> ')) return `HEAD → ${ref.slice(8)}`;
                if (ref.startsWith('tag: ')) return `tag: ${ref.slice(5)}`;
                return ref;
              });
            return {
              sha,
              short,
              subject,
              author,
              date,
              parents: (parentsRaw || '').split(' ').filter(Boolean),
              refs,
            };
          });
        sendJson(res, 200, { ok: true, commits, all, branch });
        return;
      }

      if (pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        res.write('retry: 3000\n\n');
        sseClients.add(res);
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            /* closed */
          }
        }, 25_000);
        if (typeof ping.unref === 'function') ping.unref();
        req.on('close', () => {
          clearInterval(ping);
          sseClients.delete(res);
        });
        return;
      }

      if (pathname === '/api/workspace' && req.method === 'POST') {
        const payload = await readBody(req);
        if (!payload.file) throw new Error('缺少 workspace 文件路径。');
        const { reviewId, data } = analyzeWorkspace(payload.file);
        sendJson(res, 200, {
          ok: true,
          reviewId,
          url: `/?review=${encodeURIComponent(reviewId)}`,
          stats: data.meta.stats,
          warnings: data.meta.warnings,
        });
        return;
      }

      if (pathname === '/api/workspace/history') {
        const file = url.searchParams.get('file');
        if (!file) {
          sendJson(res, 400, { error: '缺少 file 参数。' });
          return;
        }
        sendJson(res, 200, { ok: true, file: path.resolve(file), versions: workspaceHistory(file) });
        return;
      }

      if (pathname === '/api/projects' && req.method === 'POST') {
        const payload = await readBody(req);
        const project = registerProject(payload.root);
        sendJson(res, 200, { ok: true, project });
        return;
      }

      if (pathname === '/api/projects' && req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!removeProject(id)) {
          sendJson(res, 404, { error: `未知仓库：${id ?? '(空)'}` });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/review' && req.method === 'POST') {
        const payload = await readBody(req);
        const project = payload.projectId ? getProject(payload.projectId) : registerProject(payload.root);
        if (payload.pull) {
          const number = Number(payload.pull.number);
          if (!Number.isInteger(number) || number <= 0) {
            sendJson(res, 400, { error: '缺少有效的 PR/MR 编号。' });
            return;
          }
          const prepared = await preparePullReview(new GitRepo(project.root), {
            number,
            base: payload.pull.base,
          });
          payload.scope = 'range';
          payload.range = prepared.range;
          payload.pull = prepared.pull;
          try {
            const fetched = await fetchPullComments(prepared.info, prepared.pull.number);
            payload.pullComments = fetched.comments;
            if (fetched.warnings.length > 0) payload.pullWarnings = fetched.warnings;
          } catch (error) {
            payload.pullWarnings = [
              `读取 PR/MR 评论失败：${error instanceof Error ? error.message : String(error)}`,
            ];
          }
        }
        const { reviewId } = analyzeProject(project, payload);
        sendJson(res, 200, {
          ok: true,
          reviewId,
          url: `/?review=${encodeURIComponent(reviewId)}`,
          project,
        });
        return;
      }

      if (pathname === '/api/import' && req.method === 'POST') {
        const payload = await readBody(req);
        const project = registerProject(payload.root);
        const { reviewId } = await imports(payload);
        sendJson(res, 200, {
          ok: true,
          reviewId,
          project,
          url: `/?review=${encodeURIComponent(reviewId)}`,
        });
        return;
      }

      // Annotation-only sync: a large review never has to be uploaded again
      // just because an agent rewrote a few summaries.
      if (pathname === '/api/annotate' && req.method === 'POST') {
        const payload = await readBody(req);
        const reviewId = safeReviewId(payload.reviewId, '');
        if (!reviewId) throw new Error('缺少 reviewId。');
        const store = loadStore(reviewId);
        if (!store) {
          sendJson(res, 404, { error: 'hub 没有该 Review 快照。' });
          return;
        }
        const data = store.manifest;
        const onlyPaths = Array.isArray(payload.onlyPaths) && payload.onlyPaths.length
          ? payload.onlyPaths.map(String)
          : null;
        applyAnnotations(data, payload.annotations, { onlyPaths });
        if (payload.summary) data.meta.overallSummary = String(payload.summary);
        data.meta.updatedAt = formatTimestamp();
        store.save();
        const annotatedProjectId = projectIdOfReview(data, reviewId);
        if (annotatedProjectId) harvestAnnotations(annotatedProjectId, store);
        reviews.delete(reviewId);
        const annotated = data.nodes.filter(
          (node) => node.summarySource === 'agent' || (node.todos || []).some((todo) => todo.source === 'agent'),
        ).length;
        sendJson(res, 200, { ok: true, reviewId, annotated, nodes: data.nodes.length });
        return;
      }

      if (pathname === '/api/data') {
        const reviewId = safeReviewId(url.searchParams.get('review'), '');
        if (!reviewId) {
          sendJson(res, 400, { error: '缺少 review 参数。' });
          return;
        }
        const store = loadStore(reviewId);
        if (!store) {
          sendJson(res, 404, { error: '找不到该 Review。' });
          return;
        }
        // Historical reviews may not carry agent annotations themselves; reuse
        // what was remembered for the same file contents (worktree → commit).
        try {
          reuseStoredAnnotations(store, reviewId);
        } catch {
          /* annotation memory is best effort; never fail a review load for it */
        }
        // Default payload is the manifest (node metadata only); `?full=1` keeps
        // the old whole-review shape for scripts that still need it.
        const data = url.searchParams.get('full') === '1' ? store.toFullData() : store.manifest;
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(data));
        return;
      }

      if (pathname === '/api/node') {
        const reviewId = safeReviewId(url.searchParams.get('review'), '');
        if (!reviewId) {
          sendJson(res, 400, { error: '缺少 review 参数。' });
          return;
        }
        const store = loadStore(reviewId);
        if (!store) {
          sendJson(res, 404, { error: '找不到该 Review。' });
          return;
        }
        const node = store.readNode(url.searchParams.get('id'));
        if (!node) {
          sendJson(res, 404, { error: '节点不存在。' });
          return;
        }
        sendJson(res, 200, node);
        return;
      }

      if (pathname === '/api/table') {
        const reviewId = safeReviewId(url.searchParams.get('review'), '');
        if (!reviewId) {
          sendJson(res, 400, { error: '缺少 review 参数。' });
          return;
        }
        const store = loadStore(reviewId);
        if (!store) {
          sendJson(res, 404, { error: '找不到该 Review。' });
          return;
        }
        const tableId = url.searchParams.get('table') || url.searchParams.get('id');
        const table = store.readTable(tableId);
        if (!table) {
          sendJson(res, 404, { error: '数据表不存在。' });
          return;
        }
        sendJson(res, 200, table);
        return;
      }

      if (pathname === '/api/state' && req.method === 'POST') {
        const payload = await readBody(req);
        const reviewId = safeReviewId(payload.reviewId, '');
        if (!reviewId) throw new Error('缺少 reviewId。');
        const store = loadStore(reviewId);
        if (!store) throw new Error('找不到该 Review 数据。');
        reviews.delete(reviewId);
        const result = updateReviewState(store.target, payload);
        sendJson(res, 200, result);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      await serveStatic(req, res, pathname);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const server = http.createServer(handler);
  let actualPort = port;
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await listen(server, actualPort, host);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error.code !== 'EADDRINUSE') throw error;
      actualPort += 1;
    }
  }
  if (lastError) throw lastError;

  const address = server.address();
  if (address && typeof address === 'object') actualPort = address.port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${displayHost}:${actualPort}/`;
  writeJsonAtomic(hubRegistryPath(home), {
    pid: process.pid,
    port: actualPort,
    host,
    home,
    token,
    startedAt: formatTimestamp(),
  });

  if (open) openInBrowser(withHubToken(url, token));
  if (!quiet) {
    process.stdout.write(`\n  diff-viz hub  ${url}\n`);
    if (token) process.stdout.write(`  带令牌链接    ${withHubToken(url, token)}\n`);
    process.stdout.write(`  状态目录      ${home}\n`);
    process.stdout.write('  按 Ctrl+C 停止 hub\n\n');
  }

  return {
    url,
    port: actualPort,
    token,
    server,
    home,
    close: () =>
      new Promise((resolve) => {
        for (const entry of watchers.values()) {
          if (entry.timer) clearTimeout(entry.timer);
          try {
            entry.watcher.close();
          } catch {
            /* ignore */
          }
        }
        watchers.clear();
        for (const client of sseClients) {
          try {
            client.end();
          } catch {
            /* ignore */
          }
        }
        sseClients.clear();
        server.close(() => {
          const info = readHubInfo(home);
          if (info?.pid === process.pid) {
            try {
              fs.rmSync(hubRegistryPath(home), { force: true });
            } catch {
              /* ignore */
            }
          }
          resolve();
        });
      }),
  };
}

// Keep the previous port when restarting a dead hub so existing Review URLs
// (and anything an agent printed earlier) stay valid. An explicit --port wins.
export function resolveHubPort(existing, requested) {
  const explicit = Number(requested);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const remembered = Number(existing?.port);
  if (Number.isFinite(remembered) && remembered > 0) return remembered;
  return 5173;
}

export async function ensureHub({ port, host = '127.0.0.1', home = hubHome() } = {}) {
  const existing = readHubInfo(home);
  if (existing && (await hubIsAlive(existing))) {
    const infoHost = existing.host === '0.0.0.0' || existing.host === '::' ? '127.0.0.1' : existing.host;
    return {
      url: `http://${infoHost}:${existing.port}/`,
      port: existing.port,
      info: existing,
      token: existing.token ?? null,
      started: false,
    };
  }

  const targetPort = resolveHubPort(existing, port);
  const child = spawn(
    process.execPath,
    // `--no-open` belongs to the caller: it opens the final Review URL itself,
    // and a second tab on the bare hub URL would POST /api/review and race the
    // import with a default-options re-analysis.
    [BIN_PATH, 'hub', '--port', String(targetPort), '--host', host, '--quiet', '--no-open'],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    },
  );
  child.unref();

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const info = readHubInfo(home);
    if (info && (await hubIsAlive(info))) {
      const infoHost = info.host === '0.0.0.0' || info.host === '::' ? '127.0.0.1' : info.host;
      return {
        url: `http://${infoHost}:${info.port}/`,
        port: info.port,
        info,
        token: info.token ?? null,
        started: true,
      };
    }
  }
  throw new Error('diff-viz hub 启动超时，请检查端口或手动运行 `diff-viz hub`。');
}

export async function stopHub(home = hubHome()) {
  const info = readHubInfo(home);
  if (!info?.pid) return { stopped: false };
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  // Wait for the process to release its file watchers: on Windows an immediate
  // temp-directory cleanup fails with EBUSY while the hub still holds the repo.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(info.pid, 0);
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    fs.rmSync(hubRegistryPath(home), { force: true });
  } catch {
    /* ignore */
  }
  return { stopped: true, pid: info.pid, port: info.port };
}
