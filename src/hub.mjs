import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GitRepo, findRepoRoot } from './git.mjs';
import { applyAnnotations, buildReviewData, mergePreviousState } from './collect.mjs';
import { updateReviewState, openInBrowser } from './server.mjs';
import { computeServiceImpact, detectServiceEdges, loadWorkspace } from './workspace.mjs';
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
} = {}) {
  ensurePrivateDir(home);
  const reviewsDir = path.join(home, 'reviews');
  ensurePrivateDir(reviewsDir);
  ensurePrivateDir(path.join(home, 'cache'));
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
      if (!payload) return;
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
    if (scope === 'worktree') return `${projectId}-worktree`;
    if (scope === 'staged') return `${projectId}-staged`;
    if (scope === 'commit') return `${projectId}-commit-${String(payload.commit).slice(0, 12)}`;
    const head = data.meta?.headRef ?? '';
    return `${projectId}-${scope}-${shortId(`${payload.range ?? payload.base ?? ''}:${head}`, 10)}`;
  };

  const analyzeProject = (project, payload) => {
    const scope = payload.scope || 'worktree';
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

    const data = buildReviewData(new GitRepo(project.root), options);
    const reviewId = reviewIdFor(project.id, scope, data, payload);
    data.meta.projectId = project.id;
    data.meta.reviewId = reviewId;
    data.meta.scopeLabel = scope;
    const previous = loadReview(reviewId);
    if (previous) mergePreviousState(data, previous);
    saveReview(reviewId, data, project.id);
    lastPayloads.set(project.id, { ...payload, scope });
    watchProject(project);
    return { reviewId, data };
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
      inferredScope === 'range'
        ? `${project.id}-range-${shortId(`${meta.rangeLabel}:${meta.headRef}`, 10)}`
        : `${project.id}-${inferredScope}`;
    const reviewId = safeReviewId(payload.reviewId || meta.reviewId, inferredId);
    const patch = { projectId: project.id, reviewId };
    const dir = reviewPath(reviewId);
    ensurePrivateDir(dir);

    const previous = loadReview(reviewId);
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
    reviews.set(reviewId, readReviewStore(dir));
    project.lastReviewId = reviewId;
    project.updatedAt = formatTimestamp();
    saveProjects();
    // Only working-tree scopes can be re-derived after a file change; commit and
    // range reviews stay as they were generated.
    if (inferredScope === 'worktree' || inferredScope === 'staged') {
      lastPayloads.set(project.id, { scope: inferredScope });
      watchProject(project);
    }
    return { reviewId, data: manifest };
  };

  const handler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    try {
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
        reviews.delete(reviewId);
        sendJson(res, 200, { ok: true });
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
    startedAt: formatTimestamp(),
  });

  if (open) openInBrowser(url);
  if (!quiet) {
    process.stdout.write(`\n  diff-viz hub  ${url}\n`);
    process.stdout.write(`  状态目录      ${home}\n`);
    process.stdout.write('  按 Ctrl+C 停止 hub\n\n');
  }

  return {
    url,
    port: actualPort,
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

export async function ensureHub({ port = 5173, host = '127.0.0.1', home = hubHome() } = {}) {
  const existing = readHubInfo(home);
  if (existing && (await hubIsAlive(existing))) {
    const infoHost = existing.host === '0.0.0.0' || existing.host === '::' ? '127.0.0.1' : existing.host;
    return { url: `http://${infoHost}:${existing.port}/`, port: existing.port, info: existing, started: false };
  }

  const child = spawn(
    process.execPath,
    [BIN_PATH, 'hub', '--port', String(port), '--host', host, '--quiet'],
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
      return { url: `http://${infoHost}:${info.port}/`, port: info.port, info, started: true };
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
  try {
    fs.rmSync(hubRegistryPath(home), { force: true });
  } catch {
    /* ignore */
  }
  return { stopped: true, pid: info.pid, port: info.port };
}
