import fs from 'node:fs';
import { t } from './i18n.mjs';
import path from 'node:path';
import { toPosix } from './util.mjs';

// Extra languages are declared, not hard-coded: each spec says which extensions
// it owns, how to pull import specifiers out of a file, and which resolution
// strategy turns those specifiers into repository files.
//
// Supported strategies:
//   package  — file declares a package/namespace; imports are fully-qualified
//              names resolved against a package + file-basename index (Kotlin, C#)
//   relative — imports are paths relative to the current file (Ruby require_relative)
//   rust     — `mod x;` / `use crate::a::b::C;` mapped onto .rs files and mod.rs

const PACKAGE_STRATEGY = 'package';
const RELATIVE_STRATEGY = 'relative';
const RUST_STRATEGY = 'rust';

export const BUILTIN_LANGUAGE_SPECS = [
  {
    id: 'kotlin',
    label: 'Kotlin',
    extensions: ['.kt', '.kts'],
    strategy: PACKAGE_STRATEGY,
    packagePattern: /^[ \t]*package[ \t]+([A-Za-z_][\w.]*)/m,
    imports: [{ regex: /^[ \t]*import[ \t]+([\w.]+)(\.\*)?/gm, group: 1 }],
    ignorePrefixes: ['kotlin.', 'java.', 'javax.', 'android.', 'androidx.'],
  },
  {
    id: 'csharp',
    label: 'C#',
    extensions: ['.cs'],
    strategy: PACKAGE_STRATEGY,
    packagePattern: /^[ \t]*namespace[ \t]+([A-Za-z_][\w.]*)/m,
    imports: [{ regex: /^[ \t]*using[ \t]+(?:static[ \t]+)?([A-Za-z_][\w.]*)[ \t]*;/gm, group: 1 }],
    ignorePrefixes: ['System.', 'Microsoft.'],
  },
  {
    id: 'ruby',
    label: 'Ruby',
    extensions: ['.rb'],
    strategy: RELATIVE_STRATEGY,
    imports: [
      { regex: /require_relative[ \t]+['"]([^'"]+)['"]/g, group: 1, kind: 'relative' },
      { regex: /^[ \t]*require[ \t]+['"]([^'"]+)['"]/gm, group: 1, kind: 'plain' },
    ],
    indexNames: ['index'],
  },
  {
    id: 'rust',
    label: 'Rust',
    extensions: ['.rs'],
    strategy: RUST_STRATEGY,
    imports: [
      { regex: /^[ \t]*(?:pub[ \t]+)?mod[ \t]+([a-z_][\w]*)[ \t]*;/gm, group: 1, kind: 'mod' },
      { regex: /^[ \t]*(?:pub[ \t]+)?use[ \t]+([\w:]+)/gm, group: 1, kind: 'use' },
    ],
  },
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePatterns(patterns) {
  return (patterns || []).map((item) => {
    const source = typeof item === 'string' ? item : item.regex;
    const flags = typeof item === 'string' ? 'gm' : item.flags || 'gm';
    return {
      regex: new RegExp(source, flags.includes('g') ? flags : `${flags}g`),
      group: (typeof item === 'object' && item.group) || 1,
      kind: (typeof item === 'object' && item.kind) || 'default',
    };
  });
}

function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object') throw new Error(t('语言定义必须是对象。'));
  const id = String(raw.id || '').trim();
  if (!id) throw new Error(t('语言定义缺少 id。'));
  const extensions = (raw.extensions || []).map((ext) => String(ext).toLowerCase());
  if (!extensions.length) throw new Error(t('语言 {id} 缺少 extensions。', { id }));
  const strategy = raw.strategy || PACKAGE_STRATEGY;
  if (![PACKAGE_STRATEGY, RELATIVE_STRATEGY, RUST_STRATEGY].includes(strategy)) {
    throw new Error(t('语言 {id} 的 strategy 不支持：{strategy}', { id, strategy }));
  }
  const imports = normalizePatterns(raw.importPatterns || raw.imports);
  if (!imports.length) throw new Error(t('语言 {id} 缺少 importPatterns。', { id }));
  const ignorePrefixes = raw.ignorePrefixes || [];
  return {
    id,
    label: raw.label || id,
    extensions,
    strategy,
    packagePattern: raw.packagePattern ? new RegExp(raw.packagePattern, 'm') : null,
    imports,
    indexNames: raw.indexNames || ['index'],
    ignorePrefixes,
    ignore: ignorePrefixes.length
      ? new RegExp(`^(${ignorePrefixes.map(escapeRegExp).join('|')})`)
      : null,
    custom: true,
  };
}

export function loadLanguageSpecs(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.languages;
  if (!Array.isArray(list)) throw new Error(t('语言配置需要 { "languages": [...] } 或数组。'));
  return list.map(normalizeSpec);
}

export function createLanguageRegistry(extra = []) {
  const specs = [...BUILTIN_LANGUAGE_SPECS, ...extra];
  const byExt = new Map();
  for (const spec of specs) {
    for (const ext of spec.extensions) byExt.set(ext, spec);
  }
  return {
    specs,
    byExt,
    specForExtension(ext) {
      return byExt.get(ext) || null;
    },
    hasExtension(ext) {
      return byExt.has(ext);
    },
  };
}

const EMPTY_REGISTRY = createLanguageRegistry();

export function registryFor(specs) {
  return specs && specs.length ? createLanguageRegistry(specs) : EMPTY_REGISTRY;
}

export function languageLabelForExtension(ext, registry = EMPTY_REGISTRY) {
  return registry.specForExtension(ext)?.label || null;
}

export function extractWithSpec(spec, source) {
  const imports = [];
  for (const pattern of spec.imports) {
    const regex = pattern.regex;
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      const raw = match[pattern.group];
      if (!raw) continue;
      const wildcard = /\.\*$/.test(raw);
      imports.push({
        kind: pattern.kind,
        spec: wildcard ? raw.slice(0, -2) : raw,
        wildcard,
      });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return imports;
}

export function packageNameOf(spec, source) {
  if (!spec.packagePattern) return '';
  const match = spec.packagePattern.exec(source);
  return match ? match[1] : '';
}

function resolvePackage(spec, imp, indexes) {
  if (spec.ignore && spec.ignore.test(imp.spec)) return [];
  const index = indexes.get(spec.id);
  if (!index) return [];
  const name = imp.spec;
  if (imp.wildcard) {
    return index.packages.get(name) || [];
  }
  if (index.classes.has(name)) return [index.classes.get(name)];
  // `using Acme.Services;` imports a whole namespace.
  const namespaceFiles = index.packages.get(name);
  if (namespaceFiles) return namespaceFiles;
  // `import com.foo.Bar.Member` — fall back to the longest package/class prefix.
  let candidate = name;
  while (candidate.includes('.')) {
    candidate = candidate.slice(0, candidate.lastIndexOf('.'));
    const hit = index.classes.get(candidate);
    if (hit) return [hit];
    const files = index.packages.get(candidate);
    if (files) return files;
  }
  return [];
}

function resolveRelative(spec, fromPath, imp, fileSet) {
  const dir = path.posix.dirname(fromPath);
  const bases = imp.kind === 'relative' ? [dir] : ['lib', ''];
  for (const base of bases) {
    const joined = base ? path.posix.join(base, imp.spec) : imp.spec;
    const target = path.posix.normalize(joined);
    for (const ext of spec.extensions) {
      const withExt = target.endsWith(ext) ? target : `${target}${ext}`;
      if (fileSet.has(withExt)) return [withExt];
      for (const name of spec.indexNames) {
        const indexed = path.posix.join(target, `${name}${ext}`);
        if (fileSet.has(indexed)) return [indexed];
      }
    }
  }
  return [];
}

function resolveRust(fromPath, imp, fileSet) {
  const dir = path.posix.dirname(fromPath);
  const parent = path.posix.dirname(dir);
  if (imp.kind === 'mod') {
    const candidates = [
      path.posix.join(dir, `${imp.spec}.rs`),
      path.posix.join(dir, imp.spec, 'mod.rs'),
    ];
    const hit = candidates.find((file) => fileSet.has(file));
    return hit ? [hit] : [];
  }
  let spec = imp.spec;
  let base = '';
  if (spec.startsWith('crate::')) base = 'src';
  else if (spec.startsWith('self::')) base = dir;
  else if (spec.startsWith('super::')) base = parent;
  if (base) spec = spec.slice(spec.indexOf('::') + 2);
  const segments = spec.split('::').filter(Boolean);
  for (let size = segments.length; size > 0; size -= 1) {
    const joined = path.posix.join(base, segments.slice(0, size).join('/'));
    for (const candidate of [`${joined}.rs`, path.posix.join(joined, 'mod.rs')]) {
      if (fileSet.has(candidate)) return [candidate];
    }
  }
  return [];
}

export function resolveForSpec(spec, { fromPath, imp, fileSet, indexes }) {
  if (spec.strategy === PACKAGE_STRATEGY) return resolvePackage(spec, imp, indexes);
  if (spec.strategy === RELATIVE_STRATEGY) return resolveRelative(spec, fromPath, imp, fileSet);
  if (spec.strategy === RUST_STRATEGY) return resolveRust(fromPath, imp, fileSet);
  return [];
}

export function buildPackageIndexes(registry, files) {
  const indexes = new Map();
  for (const spec of registry.specs) {
    if (spec.strategy === PACKAGE_STRATEGY) indexes.set(spec.id, { classes: new Map(), packages: new Map() });
  }
  if (indexes.size === 0) return indexes;
  for (const [filePath, entry] of files) {
    if (!entry.langId || entry.pkg === undefined) continue;
    const index = indexes.get(entry.langId);
    if (!index) continue;
    const className = path.posix.basename(filePath).replace(/\.[^.]+$/, '');
    const fqcn = entry.pkg ? `${entry.pkg}.${className}` : className;
    index.classes.set(fqcn, filePath);
    if (!index.packages.has(entry.pkg)) index.packages.set(entry.pkg, []);
    index.packages.get(entry.pkg).push(filePath);
  }
  return indexes;
}

export function describeLanguages(registry) {
  return registry.specs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    extensions: [...spec.extensions],
    strategy: spec.strategy,
    custom: Boolean(spec.custom),
  }));
}

export function specForFile(filePath, registry) {
  const ext = path.extname(filePath).toLowerCase();
  return registry.specForExtension(ext);
}

export { EMPTY_REGISTRY, toPosix };
