import fs from 'node:fs';
import path from 'node:path';
import { naturalCompare, toPosix } from './util.mjs';

// Build-system markers that define a module boundary. The nearest marker above
// a file wins, so a multi-module Maven / workspace repo gets one lane per
// module instead of one giant lane for the repository.
const MODULE_MARKERS = [
  { file: 'pom.xml', kind: 'maven' },
  { file: 'build.gradle', kind: 'gradle' },
  { file: 'build.gradle.kts', kind: 'gradle' },
  { file: 'go.mod', kind: 'go' },
  { file: 'pyproject.toml', kind: 'python' },
  { file: 'setup.py', kind: 'python' },
  { file: 'package.json', kind: 'npm' },
];

const MARKER_FILES = MODULE_MARKERS.map((marker) => marker.file);
const MARKER_KIND = new Map(MODULE_MARKERS.map((marker) => [marker.file, marker.kind]));
const ROOT_MODULE_ID = '(root)';
const OTHER_MODULE_ID = '(other)';

function posixDirname(value) {
  const index = value.lastIndexOf('/');
  return index === -1 ? '' : value.slice(0, index);
}

function markerKindFor(dir) {
  for (const file of MARKER_FILES) {
    if (fs.existsSync(path.join(dir, file))) return MARKER_KIND.get(file);
  }
  return null;
}

/**
 * Assign every file path to a module.
 *
 * Returns `{ modules, moduleOf }` where modules are sorted by file count and
 * `moduleOf` maps a repo-relative path to a module descriptor. When there are
 * more than `maxLanes` modules, the smallest ones are merged into one "其他"
 * lane; modules listed in `keepModules` (for example ones with changed files)
 * are never merged.
 */
export function detectModules(root, filePaths) {
  const absoluteRoot = path.resolve(root);
  const markerCache = new Map();
  const moduleOfPath = new Map();

  const moduleForDir = (dir) => {
    if (markerCache.has(dir)) return markerCache.get(dir);
    let current = dir;
    let result = null;
    while (current.startsWith(absoluteRoot)) {
      const kind = markerKindFor(current);
      if (kind) {
        const relative = toPosix(path.relative(absoluteRoot, current));
        result = {
          id: relative || ROOT_MODULE_ID,
          path: relative,
          label: relative ? path.basename(current) : '仓库根目录',
          kind,
        };
        break;
      }
      if (current === absoluteRoot) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (!result) {
      const relative = toPosix(path.relative(absoluteRoot, dir));
      const first = relative.split('/').filter(Boolean)[0];
      result = first
        ? { id: first, path: first, label: first, kind: 'directory' }
        : { id: ROOT_MODULE_ID, path: '', label: '仓库根目录', kind: 'root' };
    }
    markerCache.set(dir, result);
    return result;
  };

  for (const filePath of filePaths) {
    const posix = toPosix(filePath);
    if (moduleOfPath.has(posix)) continue;
    const absolute = path.resolve(absoluteRoot, posix);
    moduleOfPath.set(posix, moduleForDir(path.dirname(absolute)));
  }

  const byId = new Map();
  for (const [filePath, module] of moduleOfPath) {
    let entry = byId.get(module.id);
    if (!entry) {
      entry = { ...module, fileCount: 0, files: [] };
      byId.set(module.id, entry);
    }
    entry.fileCount += 1;
    entry.files.push(filePath);
  }

  const modules = [...byId.values()].sort(
    (a, b) => b.fileCount - a.fileCount || naturalCompare(a.id, b.id),
  );

  return {
    modules,
    moduleOf: (filePath) => moduleOfPath.get(toPosix(filePath)) ?? null,
  };
}

/**
 * Trim the lane list: keep every module containing a changed file plus the
 * largest ones up to `maxLanes`; merge the rest into a single "其他模块" lane.
 */
export function limitModules(modules, moduleOf, { maxLanes = 12, keepIds = [] } = {}) {
  const keep = new Set(keepIds);
  const sorted = [...modules].sort(
    (a, b) => b.fileCount - a.fileCount || naturalCompare(a.id, b.id),
  );
  const kept = [];
  const merged = [];
  for (const module of sorted) {
    if (kept.length < maxLanes || keep.has(module.id)) kept.push(module);
    else merged.push(module);
  }
  const strip = ({ files, ...module }) => module;
  if (merged.length === 0) {
    return { modules: kept.map(strip), moduleIdOf: (filePath) => moduleOf(filePath)?.id ?? null };
  }
  const mergedIds = new Set(merged.map((module) => module.id));
  const other = {
    id: OTHER_MODULE_ID,
    path: '',
    label: `其他模块 (${merged.length})`,
    kind: 'other',
    fileCount: merged.reduce((sum, module) => sum + module.fileCount, 0),
  };
  return {
    modules: [...kept, other].map(strip),
    moduleIdOf: (filePath) => {
      const id = moduleOf(filePath)?.id;
      if (!id) return null;
      return mergedIds.has(id) ? OTHER_MODULE_ID : id;
    },
  };
}

/**
 * Package-style label for a node. Java uses its declared package; everything
 * else uses the directory path. Deleted files are not in the scan index, so
 * fall back to the conventional src/main/java path.
 */
export function packagePathOf(filePath, javaPackage) {
  if (javaPackage) return javaPackage;
  const posix = toPosix(filePath);
  const match = /(?:^|\/)(?:src\/main|src\/test)\/java\/(.+)$/.exec(posix);
  if (match) return match[1].replace(/\/[^/]+$/, '').split('/').join('.');
  return posixDirname(posix);
}

/**
 * Order modules so that modules depending on others sit higher (entry layers
 * first, data layers last). Cycles are broken deterministically by path.
 */
export function orderModules(modules, edges, moduleOf) {
  const ids = modules.map((module) => module.id);
  const known = new Set(ids);
  const dependencies = new Map(ids.map((id) => [id, new Set()]));
  for (const edge of edges) {
    const source = moduleOf(edge.source)?.id;
    const target = moduleOf(edge.target)?.id;
    if (!source || !target || source === target || !known.has(source) || !known.has(target)) continue;
    dependencies.get(source).add(target);
  }

  // Longest-path layering with an explicit cycle guard (visiting set).
  const layers = new Map();
  const visiting = new Set();
  const layerOf = (id) => {
    if (layers.has(id)) return layers.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let layer = 0;
    for (const dep of dependencies.get(id) ?? []) {
      if (!known.has(dep)) continue;
      layer = Math.max(layer, layerOf(dep) + 1);
    }
    visiting.delete(id);
    // Cap runaway chains so a cycle cannot produce an enormous lane gap.
    layer = Math.min(layer, Math.max(1, ids.length - 1));
    layers.set(id, layer);
    return layer;
  };
  for (const id of ids) layerOf(id);

  const byId = new Map(modules.map((module) => [module.id, module]));
  return [...modules].sort((a, b) => {
    const layerDiff = (layers.get(b.id) ?? 0) - (layers.get(a.id) ?? 0);
    if (layerDiff !== 0) return layerDiff;
    const countDiff = (byId.get(b.id)?.fileCount ?? 0) - (byId.get(a.id)?.fileCount ?? 0);
    if (countDiff !== 0) return countDiff;
    return naturalCompare(a.id, b.id);
  });
}

/** Client-safe fallback: derive the lane key from a path when the review predates modules. */
export function fallbackModuleId(filePath) {
  const posix = toPosix(filePath);
  const first = posix.split('/').filter(Boolean)[0];
  return first ?? ROOT_MODULE_ID;
}

export { OTHER_MODULE_ID, ROOT_MODULE_ID };
