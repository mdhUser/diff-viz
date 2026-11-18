import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './util.mjs';

// A workspace is a hand-maintained list of sibling repositories plus the links
// between them. Package links are detected from manifests; RPC/HTTP links that
// cannot be inferred statically are declared in the same file.

const MANIFEST_FILES = [
  'package.json',
  'pom.xml',
  'go.mod',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
];

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function readPackageJson(root) {
  const raw = readText(path.join(root, 'package.json'));
  if (!raw) return null;
  try {
    const pkg = JSON.parse(raw);
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };
    return {
      ecosystem: 'npm',
      names: uniq([pkg.name]),
      deps: Object.keys(deps),
    };
  } catch {
    return null;
  }
}

function readPomXml(root) {
  const raw = readText(path.join(root, 'pom.xml'));
  if (!raw) return null;
  const groupId = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(raw)?.[1] || '';
  const artifactId = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(raw)?.[1] || '';
  const deps = [];
  const depBlock = /<dependency>([\s\S]*?)<\/dependency>/g;
  let match;
  while ((match = depBlock.exec(raw)) !== null) {
    const block = match[1];
    const g = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block)?.[1];
    const a = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block)?.[1];
    if (g && a) deps.push(`${g}:${a}`);
    else if (a) deps.push(a);
  }
  const parentGroup = /<parent>[\s\S]*?<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(raw)?.[1];
  const finalGroup = groupId || parentGroup || '';
  return {
    ecosystem: 'maven',
    names: uniq([finalGroup && artifactId ? `${finalGroup}:${artifactId}` : artifactId, artifactId]),
    deps,
  };
}

function readGoMod(root) {
  const raw = readText(path.join(root, 'go.mod'));
  if (!raw) return null;
  const moduleName = /^\s*module\s+(\S+)/m.exec(raw)?.[1] || '';
  const deps = [];
  const requireBlock = /require\s*\(([\s\S]*?)\)/g;
  let block;
  while ((block = requireBlock.exec(raw)) !== null) {
    for (const line of block[1].split('\n')) {
      const name = line.trim().split(/\s+/)[0];
      if (name) deps.push(name);
    }
  }
  for (const line of raw.split('\n')) {
    const single = /^\s*require\s+(\S+)\s+\S+/.exec(line);
    if (single) deps.push(single[1]);
  }
  return { ecosystem: 'go', names: uniq([moduleName]), deps };
}

function readGradle(root) {
  const raw = readText(path.join(root, 'build.gradle')) || readText(path.join(root, 'build.gradle.kts'));
  if (!raw) return null;
  const group = /group\s*[=:]\s*['"]([^'"]+)['"]/.exec(raw)?.[1] || '';
  const rootName = /rootProject\.name\s*=\s*['"]([^'"]+)['"]/.exec(raw)?.[1] || '';
  const deps = [];
  const depRe = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = depRe.exec(raw)) !== null) {
    const parts = match[1].split(':');
    if (parts.length >= 2) deps.push(`${parts[0]}:${parts[1]}`);
  }
  return {
    ecosystem: 'gradle',
    names: uniq([group && rootName ? `${group}:${rootName}` : rootName]),
    deps,
  };
}

function readCsproj(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root).filter((name) => name.endsWith('.csproj'));
  } catch {
    return null;
  }
  const pieces = entries.map((name) => readText(path.join(root, name)) || '');
  if (!pieces.length) return null;
  const raw = pieces.join('\n');
  const assembly = /<AssemblyName>\s*([^<\s]+)\s*<\/AssemblyName>/.exec(raw)?.[1];
  const deps = [];
  const depRe = /<PackageReference\s+Include="([^"]+)"/g;
  let match;
  while ((match = depRe.exec(raw)) !== null) deps.push(match[1]);
  return { ecosystem: 'nuget', names: uniq([assembly]), deps };
}

function readComposer(root) {
  const raw = readText(path.join(root, 'composer.json'));
  if (!raw) return null;
  try {
    const pkg = JSON.parse(raw);
    return {
      ecosystem: 'composer',
      names: uniq([pkg.name]),
      deps: Object.keys(pkg.require || {}),
    };
  } catch {
    return null;
  }
}

/** Read the repositories' own coordinates and declared dependencies. */
export function readRepoManifest(root) {
  const readers = [readPackageJson, readPomXml, readGoMod, readGradle, readCsproj, readComposer];
  const names = [];
  const deps = [];
  const ecosystems = [];
  for (const reader of readers) {
    const found = reader(root);
    if (!found) continue;
    ecosystems.push(found.ecosystem);
    names.push(...found.names);
    deps.push(...found.deps);
  }
  return { names: uniq(names), deps: uniq(deps), ecosystems };
}

const SCOPE_MODES = new Set(['worktree', 'staged', 'last', 'range', 'base', 'commit']);

/**
 * A repo may pin its own comparison scope; a workspace-level `scope` is the
 * default for repos that do not. This is what makes cross-repo branch reviews
 * work: every repo can compare against the same target branch without the
 * caller generating range reviews by hand.
 */
function normalizeScope(raw, label) {
  if (raw === undefined || raw === null) return null;
  const value = typeof raw === 'string' ? { mode: raw } : raw;
  if (typeof value !== 'object') throw new Error(`${label} 的 scope 必须是对象或字符串。`);
  const mode = String(value.mode || '');
  if (!SCOPE_MODES.has(mode)) {
    throw new Error(`${label} 的 scope.mode 不支持：${mode}（可选 ${[...SCOPE_MODES].join(' / ')}）`);
  }
  const scope = { mode };
  if (mode === 'range') {
    const range = value.range || value.base;
    if (!range) throw new Error(`${label} 的 scope.mode=range 需要 range 或 base。`);
    scope.range = String(range);
  } else if (mode === 'base') {
    if (!value.base) throw new Error(`${label} 的 scope.mode=base 需要 base。`);
    scope.base = String(value.base);
  } else if (mode === 'commit') {
    if (!value.commit) throw new Error(`${label} 的 scope.mode=commit 需要 commit。`);
    scope.commit = String(value.commit);
  }
  return scope;
}

export function loadWorkspace(file) {
  const absolute = path.resolve(file);
  const raw = readText(absolute);
  if (!raw) throw new Error(`找不到 workspace 文件：${absolute}`);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`workspace 文件不是合法 JSON：${error.message}`);
  }
  const base = path.dirname(absolute);
  const defaultScope = normalizeScope(parsed.scope, 'workspace');
  const repos = (parsed.repos || []).map((entry, index) => {
    if (!entry || !entry.path) throw new Error(`workspace.repos[${index}] 缺少 path。`);
    const root = path.resolve(base, entry.path);
    let stat = null;
    try {
      stat = fs.statSync(root);
    } catch {
      throw new Error(`仓库目录不存在：${root}`);
    }
    if (!stat.isDirectory()) throw new Error(`仓库路径不是目录：${root}`);
    const id = String(entry.id || path.basename(root));
    const scope = normalizeScope(entry.scope, `repos[${index}]（${id}）`) || defaultScope || { mode: 'worktree' };
    return {
      id,
      label: String(entry.label || entry.id || path.basename(root)),
      root,
      path: toPosix(entry.path),
      scope,
    };
  });
  if (!repos.length) throw new Error('workspace.repos 不能为空。');
  const ids = new Set();
  for (const repo of repos) {
    if (ids.has(repo.id)) throw new Error(`workspace 中仓库 id 重复：${repo.id}`);
    ids.add(repo.id);
  }

  // Undeclared link endpoints are ignored with a warning instead of failing the
  // whole workspace: a typo in one link should not hide the other repositories.
  const warnings = [];
  const links = [];
  (parsed.links || []).forEach((link, index) => {
    if (!link || !link.from || !link.to) throw new Error(`workspace.links[${index}] 缺少 from/to。`);
    if (!ids.has(link.from)) {
      warnings.push(`links[${index}].from 不是已声明的仓库：${link.from}（已忽略）`);
      return;
    }
    if (!ids.has(link.to)) {
      warnings.push(`links[${index}].to 不是已声明的仓库：${link.to}（已忽略）`);
      return;
    }
    links.push({
      from: String(link.from),
      to: String(link.to),
      kind: String(link.kind || 'http'),
      via: link.via ? String(link.via) : '',
    });
  });

  return { name: String(parsed.name || path.basename(base)), file: absolute, repos, links, warnings };
}

/** Detect `from depends on to` edges from the manifests of both sides. */
export function detectServiceEdges(repos, declaredLinks = []) {
  const manifests = new Map();
  for (const repo of repos) manifests.set(repo.id, readRepoManifest(repo.root));

  const edges = [];
  const seen = new Set();
  const push = (from, to, kind, via) => {
    if (from === to) return;
    const key = `${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: `svc-${from}-${to}`, from, to, kind, via });
  };

  for (const repo of repos) {
    const manifest = manifests.get(repo.id);
    if (!manifest) continue;
    for (const other of repos) {
      if (other.id === repo.id) continue;
      const target = manifests.get(other.id);
      if (!target || !target.names.length) continue;
      const hit = manifest.deps.find((dep) => target.names.includes(dep));
      if (hit) push(repo.id, other.id, 'manifest', hit);
    }
  }

  for (const link of declaredLinks) push(link.from, link.to, link.kind, link.via);
  return edges;
}

/**
 * Propagate "changed" across service edges: a repo is impacted when something it
 * depends on changed. Depth is the shortest hop count from a changed repo.
 */
export function computeServiceImpact(repos, edges, changedRepoIds) {
  const changed = new Set(changedRepoIds);
  const depth = new Map();
  const origins = new Map();
  const queue = [];
  for (const id of changed) {
    depth.set(id, 0);
    origins.set(id, new Set([id]));
  }
  for (const repoId of changed) {
    for (const edge of edges) {
      if (edge.to !== repoId) continue;
      if (!depth.has(edge.from)) {
        depth.set(edge.from, 1);
        origins.set(edge.from, new Set([repoId]));
        queue.push(edge.from);
      } else if (depth.get(edge.from) > 0) {
        origins.get(edge.from)?.add(repoId);
      }
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const currentDepth = depth.get(current);
    if (currentDepth >= 6) continue;
    for (const edge of edges) {
      if (edge.to !== current) continue;
      if (depth.has(edge.from)) continue;
      depth.set(edge.from, currentDepth + 1);
      origins.set(edge.from, new Set(origins.get(current) || []));
      queue.push(edge.from);
    }
  }
  return { depth, origins };
}

export function workspaceTemplate(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const root = path.join(dir, entry.name);
    if (!fs.existsSync(path.join(root, '.git'))) continue;
    repos.push({ id: entry.name, path: `./${entry.name}` });
  }
  return { name: path.basename(path.resolve(dir)), repos, links: [] };
}

export { MANIFEST_FILES };
