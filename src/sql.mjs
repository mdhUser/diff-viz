import { shortId } from './util.mjs';

// Static SQL extraction for review visualization. This is deliberately a
// conservative text scanner (the CLI has no runtime dependencies), not a SQL
// parser: false negatives are preferred over inventing table/column names.

const STATEMENT_TAGS = new Set(['select', 'insert', 'update', 'delete']);
const IGNORE_TABLES = new Set([
  'dual',
  'information_schema',
  'performance_schema',
  'mysql',
  'sys',
  'pg_catalog',
]);

const OPERATION_KEYWORDS = [
  ['select', 'select'],
  ['insert', 'insert'],
  ['replace', 'insert'],
  ['update', 'update'],
  ['delete', 'delete'],
  ['merge', 'update'],
  ['with', 'select'],
];

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

function isHashCommentStart(text, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === '\n' || char === '\r' || char === ';') return true;
    if (!/\s/.test(char)) return false;
  }
  return true;
}

function stripComments(sql) {
  if (typeof sql !== 'string') return '';
  const text = sql.replace(/<!--[\s\S]*?-->/g, ' ');
  let out = '';
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += '\n';
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
        out += ' ';
      }
      continue;
    }
    if (quote) {
      out += char;
      if (char === '\\' && quote !== '`' && i + 1 < text.length) {
        out += text[++i];
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          out += text[++i];
          continue;
        }
        quote = '';
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (char === '#' && next !== '{' && isHashCommentStart(text, i)) {
      inLineComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    out += char;
  }
  return out;
}

function maskStringLiterals(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (char !== "'") {
      out += char;
      continue;
    }
    out += "'";
    i += 1;
    while (i < sql.length) {
      if (sql[i] === '\\' && i + 1 < sql.length) {
        out += '  ';
        i += 2;
        continue;
      }
      if (sql[i] === "'" && sql[i + 1] === "'") {
        out += "''";
        i += 2;
        continue;
      }
      if (sql[i] === "'") {
        out += "'";
        break;
      }
      out += ' ';
      i += 1;
    }
  }
  return out;
}

/** Turn MyBatis/annotation SQL into a readable one-liner with placeholders. */
export function normalizeSql(raw) {
  if (typeof raw !== 'string') return '';
  return stripComments(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/#\{[^}]*\}/g, '?')
    .replace(/\$\{[^}]*\}/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

export function operationOf(sql, fallback = 'select') {
  const match = /^\s*([a-z]+)/i.exec(stripComments(sql));
  if (!match) return fallback;
  const keyword = match[1].toLowerCase();
  const found = OPERATION_KEYWORDS.find(([word]) => word === keyword);
  return found ? found[1] : fallback;
}

/** Extract table names referenced by a single SQL statement. */
export function tablesFromSql(sql) {
  const text = maskStringLiterals(stripComments(String(sql ?? '')));
  const tables = new Set();
  // CTE aliases are not physical tables; skip them so `with x as (...)` does not
  // add a fake "x" table while the real table inside the CTE is kept.
  const cteNames = new Set();
  const ctePattern = /\b(?:with|,)\s+([a-z_][\w$]*)\s+as\s*\(/gi;
  let cteMatch;
  while ((cteMatch = ctePattern.exec(text)) !== null) cteNames.add(cteMatch[1].toLowerCase());
  const pattern =
    /\b(?:from|join|update|into|delete\s+from|delete)\s+((?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[A-Za-z0-9_$.]+)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[A-Za-z0-9_$]+))?)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1].replace(/\s+/g, '');
    if (!raw || /[?{}]/.test(raw)) continue;
    const parts = raw
      .split('.')
      .map((part) => part.replace(/[`"[\]]/g, '').toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1 && IGNORE_TABLES.has(parts[0])) continue;
    if (cteNames.has(parts.join('.'))) continue;
    tables.add(parts.join('.'));
  }
  return [...tables];
}

function expandMybatisIncludes(source) {
  // Resolve local <sql id="..."> fragments so statements built from <include>
  // still expose their tables. One level is enough for the common mapper style.
  const fragments = new Map();
  const sqlPattern = /<sql\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/sql>/gi;
  let match;
  while ((match = sqlPattern.exec(source)) !== null) fragments.set(match[1], match[2]);
  if (fragments.size === 0) return source;
  return source.replace(
    /<include\b[^>]*\brefid\s*=\s*["']([^"']+)["'][^>]*\/?>/gi,
    (whole, refid) => fragments.get(refid) ?? whole,
  );
}

/**
 * Extract statements from a MyBatis mapper XML. Returns
 * `[{ id, statementId, operation, sql, rawSql, dynamic, line, tables, namespace }]`.
 */
export function extractMyBatisStatements(source, { file = '', namespace = '' } = {}) {
  if (typeof source !== 'string' || !source) return [];
  const expanded = expandMybatisIncludes(source);
  const statements = [];
  const pattern = /<(select|insert|update|delete)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(expanded)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    const body = match[3] || '';
    if (!STATEMENT_TAGS.has(tag)) continue;
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const statementId = idMatch ? idMatch[1] : '';
    if (!statementId) continue;
    const rawSql = normalizeSql(body);
    if (!rawSql) continue;
    const dynamic = /<\s*(if|choose|when|foreach|where|set|trim)\b/i.test(body) || /\$\{/.test(body);
    const tables = tablesFromSql(rawSql);
    statements.push({
      id: `${namespace ? `${namespace}.` : ''}${statementId}`,
      statementId,
      operation: tag,
      sql: rawSql,
      rawSql,
      dynamic,
      line: lineAt(expanded, match.index),
      lineEnd: lineAt(expanded, match.index + match[0].length),
      tables,
      namespace,
      file,
    });
  }
  return statements;
}

/**
 * Extract statements from MyBatis annotations such as
 * `@Select("select ... from t")`. String concatenation is joined; provider
 * based annotations are skipped (no static SQL to read).
 */
export function extractAnnotationStatements(source, { file = '', packageName = '', className = '' } = {}) {
  if (typeof source !== 'string' || !source) return [];
  const statements = [];
  const pattern = /@(Select|Insert|Update|Delete)\s*\(([\s\S]*?)\)(?=\s*(?:@|\b(?:public|private|protected|static|final|abstract)\b|;|\{))/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const tag = match[1].toLowerCase();
    const args = match[2];
    const literals = [];
    const literalPattern = /"((?:[^"\\]|\\.)*)"/g;
    let literal;
    while ((literal = literalPattern.exec(args)) !== null) literals.push(literal[1]);
    if (literals.length === 0) continue;
    const rawSql = normalizeSql(literals.join(' '));
    if (!rawSql) continue;
    const simpleName = className || file.replace(/^.*\//, '').replace(/\.java$/i, '');
    const namespace = `${packageName ? `${packageName}.` : ''}${simpleName}`;
    statements.push({
      id: `${namespace}#${tag}-${shortId(`${file}:${match.index}`, 8)}`,
      statementId: `${tag}-${shortId(`${file}:${match.index}`, 8)}`,
      operation: tag,
      sql: rawSql,
      rawSql,
      dynamic: /<script\b/i.test(args),
      line: lineAt(source, match.index),
      lineEnd: lineAt(source, match.index + match[0].length),
      tables: tablesFromSql(rawSql),
      namespace,
      file,
    });
  }
  return statements;
}

function meaningfulSqlOffset(piece) {
  let index = 0;
  while (index < piece.length) {
    while (index < piece.length && /\s/.test(piece[index])) index += 1;
    if (piece[index] === '-' && piece[index + 1] === '-') {
      const nl = piece.indexOf('\n', index + 2);
      if (nl === -1) return piece.length;
      index = nl + 1;
      continue;
    }
    if (piece[index] === '/' && piece[index + 1] === '*') {
      const close = piece.indexOf('*/', index + 2);
      if (close === -1) return piece.length;
      index = close + 2;
      continue;
    }
    if (piece[index] === '#' && piece[index + 1] !== '{' && isHashCommentStart(piece, index)) {
      const nl = piece.indexOf('\n', index + 1);
      if (nl === -1) return piece.length;
      index = nl + 1;
      continue;
    }
    break;
  }
  return index;
}

/** Split a `.sql` migration file into statements, keeping per-statement lines. */
export function extractSqlFileStatements(source, { file = '' } = {}) {
  if (typeof source !== 'string' || !source) return [];
  const statements = [];
  const text = source;
  let start = 0;
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === '\\' && quote !== '`' && i + 1 < text.length) {
        i += 1;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          i += 1;
          continue;
        }
        quote = '';
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (char === '#' && next !== '{' && isHashCommentStart(text, i)) {
      inLineComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === ';') {
      pushPiece(text.slice(start, i), start);
      start = i + 1;
    }
  }
  pushPiece(text.slice(start), start);

  function pushPiece(piece, pieceStart) {
    const rawSql = normalizeSql(piece);
    if (!rawSql) return;
    const offset = meaningfulSqlOffset(piece);
    const meaningfulStart = pieceStart + offset;
    const meaningfulEnd = pieceStart + Math.max(offset, piece.trimEnd().length);
    const operation = operationOf(rawSql, '');
    if (!operation || !['select', 'insert', 'update', 'delete'].includes(operation)) return;
    statements.push({
      id: `${file}#${shortId(`${file}:${pieceStart}`, 8)}`,
      statementId: `sql-${shortId(`${file}:${pieceStart}`, 8)}`,
      operation,
      sql: rawSql,
      rawSql,
      dynamic: false,
      line: lineAt(text, meaningfulStart),
      lineEnd: lineAt(text, meaningfulEnd),
      tables: tablesFromSql(rawSql),
      namespace: '',
      file,
    });
  }
  return statements;
}

/** Group statements by normalized table name: `Map<table, statements[]>`. */
export function groupStatementsByTable(statements) {
  const byTable = new Map();
  for (const statement of statements) {
    for (const table of statement.tables) {
      if (!byTable.has(table)) byTable.set(table, []);
      byTable.get(table).push(statement);
    }
  }
  return byTable;
}

export { IGNORE_TABLES };
