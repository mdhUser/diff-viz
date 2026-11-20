import { shortId } from './util.mjs';

// Database view: statements extracted from MyBatis XML / Java annotations /
// .sql files are grouped into tables, and tables into one database component.
// This is a read-only, static model; no connection is opened.

const ENGINE_LABELS = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'PostgreSQL',
  postgres: 'PostgreSQL',
  oracle: 'Oracle',
  sqlserver: 'SQL Server',
  mssql: 'SQL Server',
  h2: 'H2',
  sqlite: 'SQLite',
  db2: 'DB2',
  clickhouse: 'ClickHouse',
  unknown: 'Database',
};

const READ_OPERATIONS = new Set(['select']);
const WRITE_OPERATIONS = new Set(['insert', 'update', 'delete', 'replace', 'merge']);

export function engineLabel(engine) {
  return ENGINE_LABELS[String(engine || 'unknown').toLowerCase()] ?? ENGINE_LABELS.unknown;
}

/** Detect the database engine from datasource config values (best effort). */
export function detectDatabaseEngine(resources) {
  const values = resources instanceof Map ? [...resources.values()] : Object.values(resources || {});
  for (const resource of values) {
    if (!resource?.values) continue;
    for (const [key, value] of Object.entries(resource.values)) {
      if (!key.includes('datasource') && !key.includes('jdbc') && !key.includes('driver')) continue;
      const jdbc = /jdbc:([a-z0-9]+):/i.exec(String(value));
      if (jdbc) return { engine: jdbc[1].toLowerCase(), label: engineLabel(jdbc[1]), source: null };
      const driver = /\.(mysql|mariadb|postgresql|oracle|sqlserver|h2|sqlite)\b/i.exec(String(value));
      if (driver) return { engine: driver[1].toLowerCase(), label: engineLabel(driver[1]), source: null };
    }
  }
  return { engine: 'unknown', label: ENGINE_LABELS.unknown, source: null };
}

/**
 * Build table/component metadata from statements collected from included nodes.
 *
 * `statements`: [{ file, id, operation, sql, line, tables, dynamic }]
 * `changedFiles` / `impactedFiles`: Sets of repo-relative paths so a table can
 * be marked changed when one of its SQL sources changed.
 */
// Long dynamic SQL bloats the lazily stored table payloads, so keep each
// statement bounded; `statementCount` still reports the true number.
const MAX_STATEMENT_CHARS = 4096;

function clampStatement(sql) {
  if (typeof sql !== 'string') return '';
  if (sql.length <= MAX_STATEMENT_CHARS) return sql;
  return `${sql.slice(0, MAX_STATEMENT_CHARS)}…`;
}

export function buildTables(
  statements,
  { changedFiles = new Set(), impactedFiles = new Set(), maxTables = 300, maxStatementsPerTable = 200 } = {},
) {
  const byTable = new Map();
  for (const statement of statements) {
    if (!statement || !Array.isArray(statement.tables)) continue;
    for (const tableName of statement.tables) {
      if (!tableName) continue;
      if (!byTable.has(tableName)) byTable.set(tableName, []);
      byTable.get(tableName).push(statement);
    }
  }

  const warnings = [];
  let tablesWithTruncatedStatements = 0;
  let clampedStatements = 0;
  const tableNames = [...byTable.keys()].sort();
  const kept = tableNames.slice(0, maxTables);
  if (tableNames.length > kept.length) {
    warnings.push(`数据表过多，仅展示 ${kept.length} 张（共 ${tableNames.length} 张）。`);
  }

  const tables = kept.map((name) => {
    const entries = byTable.get(name) || [];
    const operations = new Set();
    const sources = new Set();
    for (const entry of entries) {
      if (entry.operation) operations.add(entry.operation);
      if (entry.file) sources.add(entry.file);
    }
    const limited = entries.slice(0, maxStatementsPerTable);
    if (limited.length < entries.length) tablesWithTruncatedStatements += 1;
    const orderedOperations = ['select', 'insert', 'update', 'delete'].filter((op) => operations.has(op))
      .concat([...operations].filter((op) => !['select', 'insert', 'update', 'delete'].includes(op)).sort());
    const schema = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : null;
    return {
      id: `table:${name}`,
      name,
      schema,
      operations: orderedOperations,
      statementCount: entries.length,
      changed: [...sources].some((source) => changedFiles.has(source)),
      impacted: [...sources].some((source) => impactedFiles.has(source)),
      sources: [...sources].sort(),
      payload: shortId(`table:${name}`, 20),
      statements: limited.map((entry) => {
        const sql = clampStatement(entry.sql);
        if (sql !== entry.sql) clampedStatements += 1;
        return {
          id: entry.id,
          operation: entry.operation,
          sql,
          file: entry.file,
          line: entry.line ?? null,
          mapper: entry.namespace || '',
          dynamic: Boolean(entry.dynamic),
        };
      }),
    };
  });

  if (tablesWithTruncatedStatements > 0) {
    warnings.push(
      `${tablesWithTruncatedStatements} 张表的 SQL 条数超出上限，每表最多展示 ${maxStatementsPerTable} 条。`,
    );
  }
  if (clampedStatements > 0) {
    warnings.push(`${clampedStatements} 条 SQL 超过 ${MAX_STATEMENT_CHARS} 字符，已截断展示。`);
  }

  if (tables.length === 0) return { components: [], tables: [], warnings };

  const componentId = 'db:default';
  const components = [
    {
      id: componentId,
      kind: 'database',
      label: 'Database',
      engine: 'unknown',
      tables: tables.map((table) => table.id),
    },
  ];
  return { components, tables, warnings };
}

/** Edge relations for a statement: read-only SQL reads, DML writes. */
export function tableEdgeRelations(operations) {
  const relations = [];
  const set = new Set(operations || []);
  if ([...set].some((op) => READ_OPERATIONS.has(op))) relations.push('reads_table');
  if ([...set].some((op) => WRITE_OPERATIONS.has(op))) relations.push('writes_table');
  return relations;
}

export { ENGINE_LABELS };
