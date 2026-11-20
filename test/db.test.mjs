import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTables, detectDatabaseEngine, engineLabel, tableEdgeRelations } from '../src/db.mjs';

function statement(file, operation, tables, id = `${file}:${operation}`) {
  return { file, operation, tables, id, sql: 'select 1', line: 1, dynamic: false };
}

test('detects the database engine from datasource values', () => {
  const resources = new Map([
    [
      'src/main/resources/application.properties',
      { resourceKind: 'properties', values: { 'spring.datasource.url': 'jdbc:mysql://db:3306/app' } },
    ],
  ]);
  assert.equal(detectDatabaseEngine(resources).engine, 'mysql');
  assert.equal(engineLabel('mysql'), 'MySQL');
  assert.equal(engineLabel('postgresql'), 'PostgreSQL');
  assert.equal(detectDatabaseEngine(new Map()).engine, 'unknown');
});

test('groups statements into tables with operations, sources and changed flags', () => {
  const tables = buildTables(
    [
      statement('mapper/OrderMapper.xml', 'select', ['t_order']),
      statement('mapper/OrderMapper.xml', 'update', ['t_order'], 'mapper:update'),
      statement('dao/OrderDao.java', 'select', ['t_order', 't_fleet'], 'dao:select'),
      statement('db/migration.sql', 'insert', ['t_log'], 'sql:insert'),
    ],
    {
      changedFiles: new Set(['mapper/OrderMapper.xml']),
      impactedFiles: new Set(['dao/OrderDao.java']),
    },
  );
  assert.deepEqual(tables.tables.map((table) => table.name), ['t_fleet', 't_log', 't_order']);
  const order = tables.tables.find((table) => table.name === 't_order');
  assert.deepEqual(order.operations, ['select', 'update']);
  assert.equal(order.statementCount, 3);
  assert.equal(order.changed, true);
  assert.equal(order.impacted, true);
  assert.deepEqual(order.sources, ['dao/OrderDao.java', 'mapper/OrderMapper.xml']);
  assert.equal(order.payload.length, 20);
  assert.equal(order.statements.length, 3);
  assert.equal(tables.components.length, 1);
  assert.equal(tables.components[0].kind, 'database');
  assert.equal(tables.components[0].tables.length, 3);
});

test('caps tables and statements without dropping warnings', () => {
  const many = [];
  for (let index = 0; index < 5; index += 1) {
    many.push(statement('a.sql', 'select', [`t_${index}`], `a:${index}`));
  }
  const capped = buildTables(many, { maxTables: 2, maxStatementsPerTable: 1 });
  assert.equal(capped.tables.length, 2);
  assert.ok(capped.warnings.some((warning) => warning.includes('2')));

  const repeated = buildTables(
    [
      statement('a.sql', 'select', ['t_a'], 's1'),
      statement('a.sql', 'select', ['t_a'], 's2'),
    ],
    { maxStatementsPerTable: 1 },
  );
  assert.equal(repeated.tables[0].statementCount, 2);
  assert.equal(repeated.tables[0].statements.length, 1);
});

test('maps operations to read/write edge relations', () => {
  assert.deepEqual(tableEdgeRelations(['select']), ['reads_table']);
  assert.deepEqual(tableEdgeRelations(['insert', 'update']), ['writes_table']);
  assert.deepEqual(tableEdgeRelations(['select', 'delete']), ['reads_table', 'writes_table']);
});
