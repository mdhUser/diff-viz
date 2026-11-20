import path from 'node:path';
import { extractMyBatisStatements, extractSqlFileStatements } from './sql.mjs';

// Config/resource files are not code: they participate in the graph through
// explicit, conservative bindings (MyBatis namespace, Spring bean class / import)
// so a changed XML can show which Java code consumes it.

export const RESOURCE_EXTENSIONS = new Set(['.xml', '.properties', '.yml', '.yaml', '.sql']);

export function extensionOfResource(filePath) {
  return path.posix.extname(String(filePath)).toLowerCase();
}

export function isResourceFile(filePath) {
  return RESOURCE_EXTENSIONS.has(extensionOfResource(filePath));
}

function attr(source, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(source);
  return match ? match[1] : '';
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

function allAttrs(source, tagPattern, name) {
  const values = [];
  const pattern = new RegExp(tagPattern, 'gi');
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = attr(match[0], name);
    if (value) values.push(value);
  }
  return [...new Set(values)];
}

function parseProperties(source) {
  const keys = [];
  for (const rawLine of String(source).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const match = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (match) keys.push(match[1]);
  }
  return [...new Set(keys)];
}

export function parseYamlKeys(source) {
  // Minimal indentation tracker: enough to expose `a.b.c` keys for review, not
  // a full YAML parser. Values on the same line are ignored.
  const keys = [];
  const stack = [];
  for (const rawLine of String(source).split('\n')) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#') || rawLine.trim() === '---') continue;
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*:/.exec(rawLine);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = match[2];
    stack.push({ indent, key });
    keys.push(stack.map((item) => item.key).join('.'));
  }
  return [...new Set(keys)];
}

/** Resolve a Spring resource reference into candidate repo-relative paths. */
export function resolveResourceImport(fromFile, ref) {
  const raw = String(ref || '').trim();
  const classpath = /^classpath\*?:/.test(raw);
  const clean = raw.replace(/^classpath\*?:/, '').replace(/^file:/, '').trim();
  if (!clean) return [];
  if (classpath || clean.startsWith('/')) {
    return [path.posix.normalize(clean.replace(/^\/+/, ''))];
  }
  return [path.posix.normalize(path.posix.join(path.posix.dirname(String(fromFile)), clean))];
}

/**
 * Analyse one resource file. Returns a stable shape for all kinds:
 * `{ kind, resourceKind, imports, classRefs, packages, keys, statements, namespace, mapperInterface }`.
 */
export function analyzeResource(filePath, source) {
  const ext = extensionOfResource(filePath);
  const base = {
    kind: 'config',
    resourceKind: 'generic',
    imports: [],
    classRefs: [],
    packages: [],
    keys: [],
    statements: [],
    namespace: '',
    mapperInterface: '',
  };
  if (typeof source !== 'string' || !source) return base;

  if (ext === '.properties') {
    return { ...base, resourceKind: 'properties', keys: parseProperties(source) };
  }
  if (ext === '.yml' || ext === '.yaml') {
    return { ...base, resourceKind: 'yaml', keys: parseYamlKeys(source) };
  }
  if (ext === '.sql') {
    return {
      ...base,
      resourceKind: 'sql',
      statements: extractSqlFileStatements(source, { file: filePath }),
    };
  }
  if (ext !== '.xml') return base;

  // MyBatis mapper: namespace is the mapper interface FQCN.
  const mapperMatch = /<mapper\b([^>]*)>/i.exec(source);
  if (mapperMatch) {
    const namespace = attr(source, 'namespace');
    if (namespace) {
      return {
        ...base,
        resourceKind: 'xml-mybatis',
        namespace,
        mapperInterface: namespace,
        statements: extractMyBatisStatements(source, { file: filePath, namespace }),
      };
    }
  }

  // Spring XML: resource imports and bean classes.
  if (/<beans\b/i.test(source)) {
    return {
      ...base,
      resourceKind: 'xml-spring',
      imports: allAttrs(source, '<import\\b[^>]*>', 'resource'),
      classRefs: allAttrs(source, '<bean\\b[^>]*>', 'class'),
      packages: allAttrs(source, '<(?:context:)?component-scan\\b[^>]*>', 'base-package'),
    };
  }

  // A bare <mapper> without namespace or any other XML still shows up as a
  // config node, but produces no edges (never guess).
  return { ...base, resourceKind: 'xml-generic' };
}

export function analyzeResources(entries) {
  const result = new Map();
  for (const [filePath, source] of entries) {
    result.set(filePath, analyzeResource(filePath, source));
  }
  return result;
}
