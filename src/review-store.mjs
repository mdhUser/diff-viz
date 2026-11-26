import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.mjs';
import { ensurePrivateDir, readJsonSafe, shortId, toPosix, writeJsonAtomic } from './util.mjs';

/*
 * Review storage
 * ---------------
 * A Review used to be one JSON file holding every node's full source. On a
 * mid-size repo that is tens of MB, so every `annotate` / todo toggle had to
 * read and rewrite the whole thing.
 *
 * The v2 layout keeps the manifest small and stores the heavy per-node payload
 * (`diff`, `oldContent`, `newContent`) in its own file:
 *
 *   <data>.json                 manifest: meta + edges + node metadata
 *   <data>.json.nodes/<key>.json    one payload per node
 *
 * A directory target (`<reviewId>/`) uses `manifest.json` + `nodes/` instead.
 * Readers that only need annotations (annotate, hub state updates, the graph
 * payload) never touch the payload files.
 *
 * Legacy single-file reviews stay readable; `upgradeReviewStore` converts one
 * in place the first time it is written.
 */

export const REVIEW_STORAGE_FORMAT = 2;

const MANIFEST_NAME = 'manifest.json';
const PAYLOAD_FIELDS = ['diff', 'oldContent', 'newContent'];

function statKind(target) {
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) return 'dir';
    if (stat.isFile()) return 'file';
    return null;
  } catch {
    return null;
  }
}

export function countHunks(diff) {
  return typeof diff === 'string' ? (diff.match(/^@@/gm) || []).length : 0;
}

export function nodePayloadKey(node) {
  return shortId(String(node?.path || node?.id || ''), 20);
}

function isSplitManifest(data) {
  return Boolean(data && typeof data === 'object' && data.storage && Number(data.storage.format) === REVIEW_STORAGE_FORMAT);
}

/**
 * Resolve where a review's manifest and payload files live.
 * Existing directories use `manifest.json` + `nodes/`; anything else is treated
 * as a manifest file with a sibling `<file>.nodes/` directory.
 */
export function reviewLayout(target) {
  const resolved = path.resolve(String(target));
  const kind = statKind(resolved);
  if (kind === 'dir') {
    return {
      kind: 'dir',
      target: resolved,
      manifestPath: path.join(resolved, MANIFEST_NAME),
      nodesDir: path.join(resolved, 'nodes'),
      tablesDir: path.join(resolved, 'tables'),
    };
  }
  return {
    kind: 'file',
    target: resolved,
    manifestPath: resolved,
    nodesDir: path.join(path.dirname(resolved), `${path.basename(resolved)}.nodes`),
    tablesDir: path.join(path.dirname(resolved), `${path.basename(resolved)}.tables`),
  };
}

function relativeNodesDir(layout) {
  const base = path.dirname(layout.manifestPath);
  return toPosix(path.relative(base, layout.nodesDir)) || 'nodes';
}

function resolveNodesDir(manifestPath, declared) {
  const base = path.dirname(manifestPath);
  if (!declared || typeof declared !== 'string') return path.join(base, 'nodes');
  const resolved = path.resolve(base, declared);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return path.join(base, 'nodes');
  return resolved;
}

function relativeTablesDir(layout) {
  const base = path.dirname(layout.manifestPath);
  return toPosix(path.relative(base, layout.tablesDir)) || 'tables';
}

function resolveTablesDir(manifestPath, declared) {
  const base = path.dirname(manifestPath);
  if (!declared || typeof declared !== 'string') return path.join(base, 'tables');
  const resolved = path.resolve(base, declared);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return path.join(base, 'tables');
  return resolved;
}

function splitNode(node, key) {
  const stub = { ...node };
  const payload = {};
  for (const field of PAYLOAD_FIELDS) payload[field] = typeof node[field] === 'string' ? node[field] : '';
  delete stub.diff;
  delete stub.oldContent;
  delete stub.newContent;
  stub.payload = key;
  stub.hunkCount = typeof node.diff === 'string' ? countHunks(node.diff) : Number.isFinite(node.hunkCount) ? node.hunkCount : 0;
  return { stub, payload };
}

function mergeNode(stub, payload, { missing = false } = {}) {
  if (!payload) {
    return {
      ...stub,
      diff: '',
      oldContent: '',
      newContent: '',
      contentMissing: true,
    };
  }
  const merged = {
    ...stub,
    diff: typeof payload.diff === 'string' ? payload.diff : '',
    oldContent: typeof payload.oldContent === 'string' ? payload.oldContent : '',
    newContent: typeof payload.newContent === 'string' ? payload.newContent : '',
  };
  if (missing) merged.contentMissing = true;
  return merged;
}

function removeStalePayloads(nodesDir, keep) {
  let names = [];
  try {
    names = fs.readdirSync(nodesDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json') || keep.has(name)) continue;
    try {
      fs.rmSync(path.join(nodesDir, name), { force: true });
    } catch {
      /* a stale payload is harmless; never fail a write over it */
    }
  }
}

/**
 * Write a review in the split layout, replacing any previous content.
 * Returns the manifest that was written.
 */
export function writeReviewStore(target, data) {
  if (!data || typeof data !== 'object' || !data.meta || !Array.isArray(data.nodes)) {
    throw new Error(t('Review 数据格式不正确。'));
  }
  const layout = reviewLayout(target);
  ensurePrivateDir(path.dirname(layout.manifestPath));
  ensurePrivateDir(layout.nodesDir);

  const usedKeys = new Set();
  const keptFiles = new Set();
  const stubs = [];
  for (const node of data.nodes) {
    let key = typeof node.payload === 'string' && node.payload ? node.payload : nodePayloadKey(node);
    while (usedKeys.has(key)) key = `${key}-${usedKeys.size}`;
    usedKeys.add(key);
    const { stub, payload } = splitNode(node, key);
    const file = path.join(layout.nodesDir, `${key}.json`);
    writeJsonAtomic(file, payload);
    keptFiles.add(`${key}.json`);
    stubs.push(stub);
  }

  const tableStubs = [];
  const keptTableFiles = new Set();
  const tables = Array.isArray(data.tables) ? data.tables : [];
  if (tables.length > 0) {
    ensurePrivateDir(layout.tablesDir);
    for (const table of tables) {
      const key = typeof table.payload === 'string' && table.payload ? table.payload : shortId(table.id, 20);
      const stub = { ...table };
      const statements = Array.isArray(stub.statements) ? stub.statements : [];
      delete stub.statements;
      stub.payload = key;
      writeJsonAtomic(path.join(layout.tablesDir, `${key}.json`), { statements });
      keptTableFiles.add(`${key}.json`);
      tableStubs.push(stub);
    }
    removeStalePayloads(layout.tablesDir, keptTableFiles);
  }

  const manifest = {
    storage: {
      format: REVIEW_STORAGE_FORMAT,
      nodesDir: relativeNodesDir(layout),
      ...(tableStubs.length > 0 ? { tablesDir: relativeTablesDir(layout) } : {}),
    },
    meta: data.meta,
    edges: Array.isArray(data.edges) ? data.edges : [],
    nodes: stubs,
    ...(tableStubs.length > 0 ? { tables: tableStubs, components: data.components ?? [] } : {}),
    ...(Array.isArray(data.comments) && data.comments.length > 0 ? { comments: data.comments } : {}),
  };
  writeJsonAtomic(layout.manifestPath, manifest);
  // Only drop old payloads once the new manifest is on disk, so a crash cannot
  // leave a manifest pointing at files we already deleted.
  removeStalePayloads(layout.nodesDir, keptFiles);
  return manifest;
}

/**
 * Open a review from a manifest file, a review directory, or a legacy
 * single-file JSON. Throws when nothing valid exists unless `strict` is false.
 */
export function readReviewStore(target, { strict = true } = {}) {
  const layout = reviewLayout(target);
  const kind = statKind(layout.manifestPath);
  if (!kind) {
    if (!strict) return null;
    throw new Error(t('找不到 Review 数据：{path}', { path: layout.manifestPath }));
  }
  const raw = readJsonSafe(layout.manifestPath);
  if (!raw) throw new Error(t('Review 数据不是合法 JSON：{path}', { path: layout.manifestPath }));

  const split = isSplitManifest(raw);
  const nodesDir = split
    ? resolveNodesDir(layout.manifestPath, raw.storage.nodesDir)
    : layout.nodesDir;
  const tablesDir = split
    ? resolveTablesDir(layout.manifestPath, raw.storage.tablesDir)
    : layout.tablesDir;
  const data = split
    ? {
        meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
        edges: Array.isArray(raw.edges) ? raw.edges : [],
        nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
        ...(Array.isArray(raw.tables) ? { tables: raw.tables, components: raw.components ?? [] } : {}),
        ...(Array.isArray(raw.comments) ? { comments: raw.comments } : {}),
      }
    : raw;
  if (!Array.isArray(data.nodes)) throw new Error(t('Review 数据缺少 nodes：{path}', { path: layout.manifestPath }));

  const findNode = (idOrPath) =>
    data.nodes.find((node) => node.id === idOrPath || node.path === idOrPath) || null;

  const readPayload = (node) => {
    if (!split) return null;
    if (!node?.payload) return null;
    return readJsonSafe(path.join(nodesDir, `${node.payload}.json`));
  };

  const readTablePayload = (table) => {
    if (!table) return [];
    if (split) {
      if (!table.payload) return [];
      const payload = readJsonSafe(path.join(tablesDir, `${table.payload}.json`));
      return Array.isArray(payload?.statements) ? payload.statements : [];
    }
    return Array.isArray(table.statements) ? table.statements : [];
  };
  const findTable = (idOrName) =>
    (data.tables ?? []).find(
      (table) => table.id === idOrName || table.name === idOrName || `table:${table.name}` === idOrName,
    ) || null;

  const store = {
    layout: split ? 'split' : 'legacy',
    target: layout.target,
    manifestPath: layout.manifestPath,
    nodesDir,
    tablesDir,
    data,
    get manifest() {
      return data;
    },
    get nodeCount() {
      return data.nodes.length;
    },
    findNode,
    findTable,
    readTable(idOrName) {
      const table = findTable(idOrName);
      if (!table) return null;
      return { ...table, statements: readTablePayload(table) };
    },
    readTables() {
      return (data.tables ?? []).map((table) => ({ ...table, statements: readTablePayload(table) }));
    },
    readPayload,
    readNode(idOrPath) {
      const node = findNode(idOrPath);
      if (!node) return null;
      if (!split) return node;
      return mergeNode(node, readPayload(node));
    },
    readNodes() {
      if (!split) return data.nodes;
      return data.nodes.map((node) => mergeNode(node, readPayload(node)));
    },
    toFullData() {
      return {
        meta: data.meta,
        edges: data.edges,
        nodes: store.readNodes(),
        ...(Array.isArray(data.tables) && data.tables.length > 0
          ? { tables: store.readTables(), components: data.components ?? [] }
          : {}),
        ...(Array.isArray(data.comments) && data.comments.length > 0 ? { comments: data.comments } : {}),
      };
    },
    save() {
      if (!split) {
        writeJsonAtomic(layout.manifestPath, data);
        return data;
      }
      // Annotation-only updates rewrite the manifest and leave payload files
      // untouched; that is what makes annotate cheap on large reviews.
      writeJsonAtomic(layout.manifestPath, {
        storage: raw.storage,
        meta: data.meta,
        edges: data.edges,
        nodes: data.nodes,
        ...(Array.isArray(data.tables) && data.tables.length > 0
          ? { tables: data.tables, components: data.components ?? [] }
          : {}),
        ...(Array.isArray(data.comments) && data.comments.length > 0 ? { comments: data.comments } : {}),
      });
      return data;
    },
    upgrade() {
      if (split) return store;
      writeReviewStore(layout.manifestPath, store.toFullData());
      return readReviewStore(layout.manifestPath);
    },
  };
  return store;
}

/**
 * Copy a review into `targetDir` without re-serialising node content when the
 * source is already split. Used by the hub to snapshot an imported review.
 */
export function copyReviewStore(source, targetDir, { metaPatch = {} } = {}) {
  if (!source) throw new Error(t('缺少要导入的 Review。'));
  ensurePrivateDir(targetDir);
  const layout = reviewLayout(targetDir);
  ensurePrivateDir(layout.nodesDir);

  if (source.layout === 'split') {
    const keptFiles = new Set();
    for (const stub of source.data.nodes) {
      const key = stub.payload || nodePayloadKey(stub);
      const from = path.join(source.nodesDir, `${key}.json`);
      if (!fs.existsSync(from)) {
        throw new Error(t('节点内容缺失：{path}', { path: stub.path || stub.id || key }));
      }
      const name = `${key}.json`;
      fs.copyFileSync(from, path.join(layout.nodesDir, name));
      keptFiles.add(name);
      if (!stub.payload) stub.payload = key;
    }
    removeStalePayloads(layout.nodesDir, keptFiles);
    const sourceTables = Array.isArray(source.data.tables) ? source.data.tables : [];
    if (sourceTables.length > 0) {
      ensurePrivateDir(layout.tablesDir);
      const keptTables = new Set();
      for (const table of sourceTables) {
        const key = table.payload;
        const from = key ? path.join(source.tablesDir, `${key}.json`) : null;
        if (!from || !fs.existsSync(from)) {
          throw new Error(t('数据表内容缺失：{name}', { name: table.name || table.id || key }));
        }
        const name = `${key}.json`;
        fs.copyFileSync(from, path.join(layout.tablesDir, name));
        keptTables.add(name);
      }
      removeStalePayloads(layout.tablesDir, keptTables);
    }
    const manifest = {
      storage: {
        format: REVIEW_STORAGE_FORMAT,
        nodesDir: relativeNodesDir(layout),
        ...(sourceTables.length > 0 ? { tablesDir: relativeTablesDir(layout) } : {}),
      },
      meta: { ...source.data.meta, ...metaPatch },
      edges: source.data.edges,
      nodes: source.data.nodes,
      ...(sourceTables.length > 0
        ? { tables: source.data.tables, components: source.data.components ?? [] }
        : {}),
      ...(Array.isArray(source.data.comments) && source.data.comments.length > 0
        ? { comments: source.data.comments }
        : {}),
    };
    writeJsonAtomic(layout.manifestPath, manifest);
    return manifest;
  }

  const full = source.toFullData();
  full.meta = { ...full.meta, ...metaPatch };
  return writeReviewStore(targetDir, full);
}

/** Remove a split review (directory) or a legacy single file plus its payloads. */
export function removeReviewStore(target) {
  const layout = reviewLayout(target);
  const kind = statKind(layout.target);
  if (kind === 'dir') {
    fs.rmSync(layout.target, { recursive: true, force: true });
    return;
  }
  if (kind !== 'file') return;
  fs.rmSync(layout.target, { force: true });
  try {
    const raw = readJsonSafe(layout.manifestPath);
    if (isSplitManifest(raw)) {
      fs.rmSync(layout.nodesDir, { recursive: true, force: true });
      fs.rmSync(layout.tablesDir, { recursive: true, force: true });
    }
  } catch {
    /* best effort */
  }
}

/** True when `candidate` is the same path as, or inside, `root`. */
export function isInside(root, candidate) {
  // realpathSync.native expands Windows 8.3 short paths (RUNNER~1 → runneradmin),
  // so both sides end up in the same form and the relative check stays reliable.
  const real = (value) => {
    const absolute = path.resolve(value);
    try {
      return fs.realpathSync.native(absolute);
    } catch {
      try {
        return fs.realpathSync(absolute);
      } catch {
        return absolute;
      }
    }
  };
  const relative = path.relative(real(root), real(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
