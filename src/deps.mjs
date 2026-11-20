import fs from 'node:fs';
import path from 'node:path';
import { isProbablyBinary, naturalCompare, readJsonSafe, toPosix } from './util.mjs';
import { readScanCache, writeScanCache } from './cache.mjs';
import { analyzeResource, isResourceFile } from './resources.mjs';
import {
  EMPTY_REGISTRY,
  buildPackageIndexes,
  extractWithSpec,
  packageNameOf,
  resolveForSpec,
  specForFile,
} from './languages.mjs';

const JS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
const JS_EXTENSION_SET = new Set(JS_EXTENSIONS);
const PY_EXTENSION_SET = new Set(['.py']);
const GO_EXTENSION_SET = new Set(['.go']);
const JAVA_EXTENSION_SET = new Set(['.java']);

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
  'target',
  'Pods',
  '.idea',
  '.vscode',
]);

const MAX_SCAN_FILES = 15000;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_RESOURCE_FILES = 2000;
const MAX_RESOURCE_BYTES = 512 * 1024;

export function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

export function languageOf(filePath) {
  const ext = extensionOf(filePath);
  switch (ext) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    case '.vue':
      return 'vue';
    case '.svelte':
      return 'svelte';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.java':
      return 'java';
    case '.json':
      return 'json';
    case '.xml':
      return 'xml';
    case '.properties':
      return 'properties';
    case '.md':
      return 'markdown';
    case '.css':
      return 'css';
    case '.scss':
      return 'scss';
    case '.html':
      return 'html';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.sh':
    case '.bash':
      return 'bash';
    case '.sql':
      return 'sql';
    case '.toml':
      return 'toml';
    case '.rs':
      return 'rust';
    case '.kt':
    case '.kts':
      return 'kotlin';
    case '.cs':
      return 'csharp';
    case '.rb':
      return 'ruby';
    default:
      return 'text';
  }
}

export function isCodeFile(filePath, registry = EMPTY_REGISTRY) {
  const ext = extensionOf(filePath);
  return (
    JS_EXTENSION_SET.has(ext) ||
    PY_EXTENSION_SET.has(ext) ||
    GO_EXTENSION_SET.has(ext) ||
    JAVA_EXTENSION_SET.has(ext) ||
    registry.hasExtension(ext)
  );
}

function isSkippedPath(filePath) {
  return filePath.split('/').some((segment) => SKIP_DIRS.has(segment));
}

/** Strip comments/trailing commas from tsconfig-style JSONC. */
export function parseJsonc(text) {
  let result = '';
  let inString = false;
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        result += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      result += ch;
      if (ch === '\\') {
        result += next ?? '';
        i += 1;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    result += ch;
  }
  result = result.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* import extraction                                                   */
/* ------------------------------------------------------------------ */

const JS_PATTERNS = [
  /^[ \t]*import\s+(?:type\s+)?(?:[^'"\n]*?\sfrom\s*)?["']([^"']+)["']/gm,
  /^[ \t]*import\s+(?:type\s+)?(?:\{|(?:\*\s*as\s+\w+))[\s\S]{0,800}?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[\s\S]{0,800}?\})\s*from\s*["']([^"']+)["']/gm,
];

export function extractJsImports(source) {
  const specs = [];
  const seen = new Set();
  const add = (spec) => {
    if (!spec || seen.has(spec)) return;
    seen.add(spec);
    specs.push({ spec, kind: 'esm' });
  };
  for (const pattern of JS_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) add(match[1]);
  }
  const requireRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = requireRe.exec(source)) !== null) add(match[1]);
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicRe.exec(source)) !== null) add(match[1]);
  return specs;
}

function parseImportNames(text) {
  const names = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (current.trim()) names.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) names.push(current.trim());
  return names
    .map((name) => name.split(/\s+as\s+/i)[0].trim())
    .filter((name) => name && name !== '*' && name !== '\\');
}

export function extractPythonImports(source) {
  const imports = [];
  const lines = source.split('\n');
  let buffer = '';
  let openParens = 0;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '');
    if (buffer) {
      buffer += ` ${line.trim()}`;
    } else {
      buffer = line;
    }
    openParens += (line.match(/\(/g) || []).length;
    openParens -= (line.match(/\)/g) || []).length;
    if (openParens > 0 && /^\s*(from|import)\b/.test(buffer.trim())) continue;

    const statement = buffer.trim();
    buffer = '';
    openParens = 0;
    if (!statement) continue;

    const fromMatch = /^from\s+([.\w]+)\s+import\s+([\s\S]+)$/.exec(statement);
    if (fromMatch) {
      const module = fromMatch[1];
      const level = (module.match(/^\.+/) || [''])[0].length;
      const cleanModule = module.replace(/^\.+/, '');
      imports.push({
        kind: 'py-from',
        level,
        module: cleanModule,
        names: parseImportNames(fromMatch[2].replace(/^\(/, '').replace(/\)\s*$/, '')),
      });
      continue;
    }
    const importMatch = /^import\s+([\s\S]+)$/.exec(statement);
    if (importMatch) {
      for (const part of importMatch[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/i)[0].trim();
        if (!name || name === '*') continue;
        imports.push({ kind: 'py-import', module: name });
      }
    }
  }
  return imports;
}

export function extractGoImports(source) {
  const specs = [];
  const seen = new Set();
  const lines = source.split('\n');
  let inBlock = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (!inBlock && /^import\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^\)$/.test(line)) {
      inBlock = false;
      continue;
    }
    let body = null;
    if (inBlock) body = line;
    else if (/^import\s+/.test(line)) body = line.slice('import'.length).trim();
    if (!body) continue;
    const match = /"([^"]+)"/.exec(body);
    if (!match) continue;
    const spec = match[1];
    if (!spec || spec === 'C' || seen.has(spec)) continue;
    seen.add(spec);
    specs.push({ spec, kind: 'go-import' });
  }
  return specs;
}

export function extractJavaPackage(source) {
  const match = /^[ \t]*package[ \t]+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)[ \t]*;/m.exec(source);
  return match ? match[1] : '';
}

export function extractJavaImports(source) {
  const imports = [];
  const re = /^[ \t]*import[ \t]+(static[ \t]+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\.[ \t]*\*)?[ \t]*;/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    imports.push({
      kind: 'java-import',
      name: match[2],
      static: Boolean(match[1]),
      wildcard: Boolean(match[3]),
    });
  }
  return imports;
}

export function extractImports(filePath, source, registry = EMPTY_REGISTRY) {
  const ext = extensionOf(filePath);
  if (JS_EXTENSION_SET.has(ext)) return extractJsImports(source);
  if (PY_EXTENSION_SET.has(ext)) return extractPythonImports(source);
  if (GO_EXTENSION_SET.has(ext)) return extractGoImports(source);
  if (JAVA_EXTENSION_SET.has(ext)) return extractJavaImports(source);
  const spec = registry.specForExtension(ext);
  if (spec) return extractWithSpec(spec, source);
  return [];
}

/* ------------------------------------------------------------------ */
/* tsconfig path aliases                                               */
/* ------------------------------------------------------------------ */

function loadTsconfig(root, readFile = (name) => readText(path.join(root, name))) {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const text = readFile(name);
    if (!text) continue;
    const parsed = parseJsonc(text);
    if (!parsed) continue;
    const options = parsed.compilerOptions ?? {};
    const baseUrl = options.baseUrl ? path.posix.normalize(toPosix(options.baseUrl)).replace(/\/$/, '') : '';
    const patterns = [];
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      if (!Array.isArray(targets)) continue;
      patterns.push({ pattern, targets: targets.map((target) => String(target)) });
    }
    if (!baseUrl && patterns.length === 0) continue;
    patterns.sort((a, b) => {
      const aStar = a.pattern.indexOf('*');
      const bStar = b.pattern.indexOf('*');
      const aPrefix = aStar === -1 ? a.pattern.length : aStar;
      const bPrefix = bStar === -1 ? b.pattern.length : bStar;
      return bPrefix - aPrefix;
    });
    return { baseUrl, patterns, file: name };
  }
  return { baseUrl: '', patterns: [], file: null };
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function loadGoModule(root, readFile = (name) => readText(path.join(root, name))) {
  const text = readFile('go.mod');
  if (text) {
    const match = /^\s*module\s+(\S+)/m.exec(text);
    if (match) return { module: match[1].trim(), file: 'go.mod' };
  }
  return { module: null, file: null };
}

/* ------------------------------------------------------------------ */
/* workspace packages                                                  */
/* ------------------------------------------------------------------ */

function expandWorkspacePattern(root, pattern) {
  const cleaned = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!cleaned) return [];
  if (!cleaned.includes('*')) return [cleaned];
  const parts = cleaned.split('/');
  let dirs = [''];
  for (const part of parts) {
    if (part === '**') return [];
    const next = [];
    for (const base of dirs) {
      if (part !== '*') {
        next.push(base ? `${base}/${part}` : part);
        continue;
      }
      let entries = [];
      try {
        entries = fs.readdirSync(path.join(root, base), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        next.push(base ? `${base}/${entry.name}` : entry.name);
      }
    }
    dirs = next;
  }
  return dirs;
}

function loadWorkspacePackages(root) {
  const manifest = readJsonSafe(path.join(root, 'package.json'));
  if (!manifest) return new Map();
  const raw = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : Array.isArray(manifest.workspaces?.packages)
      ? manifest.workspaces.packages
      : [];
  const dirs = [...new Set(raw.flatMap((pattern) => expandWorkspacePattern(root, String(pattern))))];
  const packages = new Map();
  for (const dir of dirs) {
    const pkg = readJsonSafe(path.join(root, dir, 'package.json'));
    if (!pkg?.name) continue;
    let entry = pkg.source || pkg.module || pkg.main;
    if (typeof entry === 'string') {
      entry = joinPosix(dir, entry.replace(/^\.\//, ''));
    } else {
      entry = null;
    }
    packages.set(pkg.name, { dir, entry });
  }
  return packages;
}

/* ------------------------------------------------------------------ */
/* resolver                                                            */
/* ------------------------------------------------------------------ */

function dirnamePosix(filePath) {
  const dir = path.posix.dirname(filePath);
  return dir === '.' ? '' : dir;
}

function joinPosix(...parts) {
  const joined = path.posix.normalize(parts.filter(Boolean).join('/'));
  return joined === '.' ? '' : joined.replace(/^\.\//, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createResolver({
  root,
  fileSet,
  tsconfig,
  goModule,
  workspacePackages = new Map(),
  javaIndex = { classes: new Map(), packages: new Map() },
  oldPathAliases = new Map(),
  registry = EMPTY_REGISTRY,
  packageIndexes = new Map(),
}) {
  const pythonRoots = ['', 'src', 'lib'].filter((prefix) => {
    if (!prefix) return true;
    try {
      return fs.statSync(path.join(root, prefix)).isDirectory();
    } catch {
      return false;
    }
  });

  const goFilesByDir = new Map();
  for (const filePath of fileSet) {
    if (!filePath.endsWith('.go')) continue;
    const dir = dirnamePosix(filePath);
    if (!goFilesByDir.has(dir)) goFilesByDir.set(dir, []);
    goFilesByDir.get(dir).push(filePath);
  }

  function canonical(filePath) {
    if (!filePath) return null;
    const normalized = toPosix(filePath);
    if (oldPathAliases.has(normalized)) return oldPathAliases.get(normalized);
    if (fileSet.has(normalized)) return normalized;
    return null;
  }

  function tryJsBase(base) {
    const trimmed = base.replace(/\/+$/, '');
    if (!trimmed) return null;
    const direct = canonical(trimmed);
    if (direct) return direct;
    for (const ext of JS_EXTENSIONS) {
      const candidate = canonical(`${trimmed}${ext}`);
      if (candidate) return candidate;
    }
    // TypeScript ESM style: import './x.js' but the source file is x.ts.
    const ext = path.posix.extname(trimmed);
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      const stem = trimmed.slice(0, -ext.length);
      for (const alt of ['.ts', '.tsx', '.mts', '.cts', '.d.ts']) {
        const candidate = canonical(`${stem}${alt}`);
        if (candidate) return candidate;
      }
    }
    for (const ext2 of JS_EXTENSIONS) {
      const candidate = canonical(`${trimmed}/index${ext2}`);
      if (candidate) return candidate;
    }
    return null;
  }

  function resolveJs(fromPath, spec) {
    const clean = spec.split('?')[0].split('#')[0].trim();
    if (!clean) return null;
    if (clean.startsWith('./') || clean.startsWith('../') || clean === '.' || clean === '..') {
      return tryJsBase(joinPosix(dirnamePosix(fromPath), clean));
    }
    if (tsconfig?.baseUrl) {
      const candidate = tryJsBase(joinPosix(tsconfig.baseUrl, clean));
      if (candidate) return candidate;
    }
    for (const { pattern, targets } of tsconfig?.patterns ?? []) {
      const star = pattern.indexOf('*');
      let wildcard = null;
      if (star === -1) {
        if (clean !== pattern) continue;
      } else {
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (!clean.startsWith(prefix) || !clean.endsWith(suffix)) continue;
        wildcard = clean.slice(prefix.length, clean.length - suffix.length);
      }
      for (const target of targets) {
        const filled = star === -1 ? target : target.replace('*', wildcard);
        const base = tsconfig.baseUrl ? joinPosix(tsconfig.baseUrl, filled) : joinPosix(filled);
        const candidate = tryJsBase(base);
        if (candidate) return candidate;
      }
    }

    // Monorepo workspace packages: resolve bare imports such as `@repo/ui`
    // to the package directory instead of treating them as external deps.
    for (const [name, info] of workspacePackages) {
      if (clean === name) {
        if (info.entry) {
          const direct = tryJsBase(info.entry);
          if (direct) return direct;
        }
        const candidate = tryJsBase(joinPosix(info.dir, 'src/index'));
        if (candidate) return candidate;
        const rootIndex = tryJsBase(joinPosix(info.dir, 'index'));
        if (rootIndex) return rootIndex;
        continue;
      }
      if (clean.startsWith(`${name}/`)) {
        const subpath = clean.slice(name.length + 1);
        const candidate = tryJsBase(joinPosix(info.dir, subpath));
        if (candidate) return candidate;
      }
    }
    return null;
  }

  function tryPythonModule(baseDir, modulePath) {
    const base = joinPosix(baseDir, modulePath);
    if (!base) return null;
    const direct = canonical(`${base}.py`);
    if (direct) return direct;
    const init = canonical(`${base}/__init__.py`);
    if (init) return init;
    return null;
  }

  function resolvePython(fromPath, imp) {
    const targets = new Set();
    if (imp.kind === 'py-import') {
      const modulePath = imp.module.replace(/\./g, '/');
      for (const prefix of pythonRoots) {
        const found = tryPythonModule(prefix, modulePath);
        if (found) targets.add(found);
      }
      return [...targets];
    }
    if (imp.kind !== 'py-from') return [];

    let baseDir = '';
    if (imp.level > 0) {
      baseDir = dirnamePosix(fromPath);
      for (let i = 1; i < imp.level; i += 1) baseDir = dirnamePosix(baseDir);
      const modulePath = imp.module.replace(/\./g, '/');
      const found = modulePath ? tryPythonModule(baseDir, modulePath) : null;
      if (found) targets.add(found);
      // `from . import sibling` imports submodules named by each symbol.
      if (!imp.module) {
        for (const name of imp.names) {
          const child = tryPythonModule(baseDir, name);
          if (child) targets.add(child);
        }
      }
    } else {
      const modulePath = imp.module.replace(/\./g, '/');
      for (const prefix of pythonRoots) {
        const found = tryPythonModule(prefix, modulePath);
        if (found) targets.add(found);
      }
      // `import sibling` inside a script: Python also searches the script's
      // directory (sys.path[0]).
      const local = tryPythonModule(dirnamePosix(fromPath), modulePath);
      if (local) targets.add(local);
      // `from app.auth import jwt` where jwt is a module, not a symbol.
      if (imp.module && imp.names.length > 0) {
        for (const prefix of [...pythonRoots, dirnamePosix(fromPath)]) {
          for (const name of imp.names) {
            const found = tryPythonModule(prefix, `${modulePath}/${name}`);
            if (found) targets.add(found);
          }
        }
      }
    }
    return [...targets];
  }

  function resolveJava(imp) {
    const classes = javaIndex.classes;
    const packages = javaIndex.packages;
    if (!classes || classes.size === 0) return [];

    if (imp.wildcard) {
      // `import static com.foo.Util.*` and `import com.foo.Outer.*` both name
      // a class; a plain package wildcard names a package.
      let className = imp.name;
      while (className.includes('.')) {
        if (classes.has(className)) return [classes.get(className)];
        className = className.slice(0, className.lastIndexOf('.'));
      }
      if (classes.has(className)) return [classes.get(className)];
      if (!imp.static) {
        const packageFiles = packages.get(imp.name);
        if (packageFiles?.length) {
          return packageFiles.slice(0, 40);
        }
      }
      return [];
    }

    // Normal imports and static member imports: strip member segments until a
    // known class or inner class is found.
    let name = imp.name;
    while (name.includes('.')) {
      if (classes.has(name)) return [classes.get(name)];
      name = name.slice(0, name.lastIndexOf('.'));
    }
    if (classes.has(name)) return [classes.get(name)];
    return [];
  }

  function resolveGo(spec) {
    if (!goModule) return [];
    const module = goModule.module;
    let rel = null;
    if (spec === module) rel = '';
    else if (spec.startsWith(`${module}/`)) rel = spec.slice(module.length + 1);
    if (rel === null) return [];
    const dir = rel.replace(/\/+$/, '');
    const files = (goFilesByDir.get(dir) || []).filter((filePath) => !filePath.endsWith('_test.go'));
    return files.sort(naturalCompare).slice(0, 30);
  }

  function resolve(fromPath, imp) {
    const ext = extensionOf(fromPath);
    if (JS_EXTENSION_SET.has(ext)) {
      const target = resolveJs(fromPath, imp.spec);
      return target ? [target] : [];
    }
    if (PY_EXTENSION_SET.has(ext)) return resolvePython(fromPath, imp);
    if (GO_EXTENSION_SET.has(ext)) return resolveGo(imp.spec);
    if (JAVA_EXTENSION_SET.has(ext)) return resolveJava(imp);
    const spec = registry.specForExtension(ext);
    if (spec) return resolveForSpec(spec, { fromPath, imp, fileSet, indexes: packageIndexes });
    return [];
  }

  return { resolve, pythonRoots, goFilesByDir };
}

/* ------------------------------------------------------------------ */
/* repository scan                                                     */
/* ------------------------------------------------------------------ */

function extractJavaIdentifiers(source) {
  const ids = new Set();
  const re = /\b[A-Z][A-Za-z0-9_$]{1,}\b/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    ids.add(match[0]);
    if (ids.size >= 500) break;
  }
  return [...ids];
}

export function scanRepository(
  repo,
  {
    includeUntracked = true,
    maxFiles = MAX_SCAN_FILES,
    gitRef = null,
    useCache = true,
    registry = EMPTY_REGISTRY,
    maxResourceFiles = MAX_RESOURCE_FILES,
    extraResourcePaths = [],
  } = {},
) {
  const warnings = [];
  const allFiles = gitRef
    ? repo.listFilesAt(gitRef)
    : repo.listFiles({ includeUntracked });
  const absoluteRoot = repo.root;
  const readTextAt = (relativePath) => {
    try {
      if (gitRef) {
        const buffer = repo.show(gitRef, relativePath);
        return buffer ? buffer.toString('utf8') : null;
      }
      return readText(path.join(absoluteRoot, relativePath));
    } catch {
      return null;
    }
  };
  const files = new Map();
  let skippedDir = 0;
  let skippedLarge = 0;
  let skippedBinary = 0;

  // Count every code file even when the scan is capped: the UI needs the real
  // number to say "only N of M were analysed" instead of silently degrading.
  const candidates = [];
  let codeFiles = 0;
  for (const filePath of allFiles) {
    const posixPath = toPosix(filePath);
    if (isSkippedPath(posixPath)) {
      skippedDir += 1;
      continue;
    }
    if (!isCodeFile(posixPath, registry)) continue;
    codeFiles += 1;
    if (candidates.length < maxFiles) candidates.push(posixPath);
  }
  const scanTruncated = codeFiles > maxFiles;
  if (scanTruncated) {
    warnings.push(
      `依赖扫描上限：仓库共有 ${codeFiles} 个代码文件，本次只分析了前 ${maxFiles} 个；未扫描的文件不会出现在拓扑和影响分析里。`,
    );
  }

  // Config/resource files (XML/MyBatis mappers, properties, yaml, SQL) take part
  // in the graph through explicit bindings. Changed resources are always
  // parsed even when the resource cap is hit, so a mapper edit never disappears.
  const resourceCandidates = [];
  const resourceSeen = new Set();
  let resourceFiles = 0;
  for (const filePath of allFiles) {
    const posixPath = toPosix(filePath);
    if (isSkippedPath(posixPath) || !isResourceFile(posixPath)) continue;
    resourceFiles += 1;
    if (resourceCandidates.length < maxResourceFiles || extraResourcePaths.includes(posixPath)) {
      if (!resourceSeen.has(posixPath)) {
        resourceSeen.add(posixPath);
        resourceCandidates.push(posixPath);
      }
    }
  }
  for (const extra of extraResourcePaths) {
    const posixPath = toPosix(extra);
    if (!posixPath || resourceSeen.has(posixPath) || !isResourceFile(posixPath)) continue;
    resourceSeen.add(posixPath);
    resourceCandidates.push(posixPath);
  }
  const resourceTruncated = resourceFiles > resourceCandidates.length;
  if (resourceTruncated) {
    warnings.push(
      `配置文件较多，仅解析前 ${resourceCandidates.length} 个（共 ${resourceFiles} 个）；变更过的配置始终会解析。`,
    );
  }

  const tsconfig = loadTsconfig(absoluteRoot, readTextAt);
  const goModule = loadGoModule(absoluteRoot, readTextAt);
  const workspacePackages = gitRef ? new Map() : loadWorkspacePackages(absoluteRoot);

  // Parsing is a pure function of file content, so an mtime+size key is enough
  // to skip re-reading unchanged files between runs.
  const caching = useCache && !gitRef && process.env.DIFF_VIZ_NO_CACHE !== '1';
  const cached = caching ? readScanCache(repo.root) : { files: {}, resources: {} };
  const nextCache = {};
  const nextResourceCache = {};

  // Blob contents at a git ref arrive via `cat-file --batch` in chunks: one
  // git process per few hundred files instead of one per file. Memory stays
  // bounded to a chunk because the map is replaced, not accumulated.
  const REF_CHUNK = 400;
  let refContents = new Map();
  let refChunkStart = -1;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const filePath = candidates[candidateIndex];
    const absolute = path.join(absoluteRoot, filePath);
    let key = null;
    if (gitRef && (refChunkStart === -1 || candidateIndex - refChunkStart >= REF_CHUNK)) {
      refChunkStart = candidateIndex;
      refContents = repo.readFilesAt(gitRef, candidates.slice(candidateIndex, candidateIndex + REF_CHUNK));
    }
    if (!gitRef) {
      try {
        const stat = fs.statSync(absolute);
        if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
          skippedLarge += 1;
          continue;
        }
        key = `${Math.round(stat.mtimeMs)}:${stat.size}`;
      } catch {
        continue;
      }
      if (caching) {
        const hit = cached.files[filePath];
        if (hit && hit.key === key && hit.entry) {
          files.set(filePath, { ...hit.entry });
          nextCache[filePath] = hit;
          continue;
        }
      }
    }

    let buffer;
    if (gitRef) {
      buffer = refContents.get(filePath);
      if (!buffer) continue;
      if (buffer.length > MAX_SOURCE_BYTES) {
        skippedLarge += 1;
        continue;
      }
    } else {
      try {
        buffer = fs.readFileSync(absolute);
      } catch {
        continue;
      }
    }
    if (isProbablyBinary(buffer)) {
      skippedBinary += 1;
      continue;
    }
    let source = buffer.toString('utf8');
    // Avoid pathological regex scans over generated bundles.
    if (source.length > MAX_SOURCE_BYTES) source = source.slice(0, MAX_SOURCE_BYTES);
    const entry = { imports: extractImports(filePath, source, registry) };
    const langSpec = specForFile(filePath, registry);
    if (langSpec) {
      entry.langId = langSpec.id;
      if (langSpec.strategy === 'package') entry.pkg = packageNameOf(langSpec, source);
    }
    if (JAVA_EXTENSION_SET.has(path.extname(filePath).toLowerCase())) {
      entry.javaPackage = extractJavaPackage(source);
      entry.javaIds = extractJavaIdentifiers(source);
    }
    files.set(filePath, entry);
    if (caching && key) nextCache[filePath] = { key, entry };
  }

  const resources = new Map();
  const RESOURCE_REF_CHUNK = 200;
  let resourceRefContents = new Map();
  let resourceRefStart = -1;
  for (let resourceIndex = 0; resourceIndex < resourceCandidates.length; resourceIndex += 1) {
    const filePath = resourceCandidates[resourceIndex];
    const absolute = path.join(absoluteRoot, filePath);
    let key = null;
    if (gitRef && (resourceRefStart === -1 || resourceIndex - resourceRefStart >= RESOURCE_REF_CHUNK)) {
      resourceRefStart = resourceIndex;
      resourceRefContents = repo.readFilesAt(
        gitRef,
        resourceCandidates.slice(resourceIndex, resourceIndex + RESOURCE_REF_CHUNK),
      );
    }
    if (!gitRef) {
      try {
        const stat = fs.statSync(absolute);
        if (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES) continue;
        key = `${Math.round(stat.mtimeMs)}:${stat.size}`;
      } catch {
        continue;
      }
      if (caching) {
        const hit = cached.resources[filePath];
        if (hit && hit.key === key && hit.entry) {
          resources.set(filePath, { ...hit.entry });
          nextResourceCache[filePath] = hit;
          continue;
        }
      }
    }
    let buffer;
    if (gitRef) {
      buffer = resourceRefContents.get(filePath);
      if (!buffer || buffer.length > MAX_RESOURCE_BYTES) continue;
    } else {
      try {
        buffer = fs.readFileSync(absolute);
      } catch {
        continue;
      }
    }
    if (isProbablyBinary(buffer)) continue;
    let source = buffer.toString('utf8');
    if (source.length > MAX_RESOURCE_BYTES) source = source.slice(0, MAX_RESOURCE_BYTES);
    const entry = analyzeResource(filePath, source);
    resources.set(filePath, entry);
    if (caching && key) nextResourceCache[filePath] = { key, entry };
  }

  const javaIndex = { classes: new Map(), packages: new Map() };
  for (const [filePath, entry] of files) {
    if (!filePath.endsWith('.java')) continue;
    const fileName = path.posix.basename(filePath);
    const className = fileName.replace(/\.java$/i, '');
    if (className === 'package-info' || className === 'module-info') continue;
    const packageName = entry.javaPackage || '';
    const fqcn = packageName ? `${packageName}.${className}` : className;
    javaIndex.classes.set(fqcn, filePath);
    if (!javaIndex.packages.has(packageName)) javaIndex.packages.set(packageName, []);
    javaIndex.packages.get(packageName).push(filePath);
  }

  for (const [filePath, entry] of files) {
    if (!entry.javaIds) continue;
    const packageName = entry.javaPackage || '';
    const selfName = path.posix.basename(filePath).replace(/\.java$/i, '');
    const identifiers = new Set(entry.javaIds);
    const samePackage = [];
    for (const sibling of javaIndex.packages.get(packageName) || []) {
      if (sibling === filePath) continue;
      const simpleName = path.posix.basename(sibling).replace(/\.java$/i, '');
      if (simpleName === selfName) continue;
      if (identifiers.has(simpleName)) samePackage.push(sibling);
    }
    entry.javaSamePackageTargets = samePackage.slice(0, 40);
  }

  if (caching) writeScanCache(repo.root, { files: nextCache, resources: nextResourceCache });

  const packageIndexes = buildPackageIndexes(registry, files);

  if (skippedLarge > 0) warnings.push(`${skippedLarge} large code files were skipped during dependency scan.`);

  return {
    files,
    resources,
    tsconfig,
    goModule,
    workspacePackages,
    javaIndex,
    packageIndexes,
    warnings,
    stats: {
      trackedFiles: allFiles.length,
      scannedFiles: files.size,
      skippedDir,
      skippedLarge,
      skippedBinary,
    },
    scanLimit: {
      limit: maxFiles,
      codeFiles,
      scanned: files.size,
      truncated: scanTruncated,
    },
    resourceStats: {
      limit: maxResourceFiles,
      files: resourceFiles,
      scanned: resources.size,
      truncated: resourceTruncated,
    },
  };
}
