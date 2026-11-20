import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAnnotationStatements,
  extractMyBatisStatements,
  extractSqlFileStatements,
  groupStatementsByTable,
  normalizeSql,
  operationOf,
  tablesFromSql,
} from '../src/sql.mjs';

test('normalizes MyBatis dynamic SQL into a readable statement', () => {
  const raw = `
    SELECT * FROM t_fleet
    <where>
      <if test="id != null">AND id = #{id}</if>
      AND name = \${name}
    </where>
    <!-- comment -->
  `;
  assert.equal(normalizeSql(raw), 'SELECT * FROM t_fleet AND id = ? AND name = ?');
  assert.equal(operationOf(raw), 'select');
  assert.equal(operationOf('UPDATE t_x SET a = 1'), 'update');
  assert.equal(operationOf('REPLACE INTO t_x VALUES (1)'), 'insert');
  assert.equal(operationOf('DELETE FROM t_x WHERE id = 1'), 'delete');
});

test('extracts tables from common SQL shapes', () => {
  assert.deepEqual(
    tablesFromSql('select a.id from t_fleet a join `t_driver` d on d.id = a.driver_id'),
    ['t_fleet', 't_driver'],
  );
  assert.deepEqual(tablesFromSql('update t_fleet set status = 2 where id = 1'), ['t_fleet']);
  assert.deepEqual(tablesFromSql('insert into t_fleet(id) values (1)'), ['t_fleet']);
  assert.deepEqual(tablesFromSql('delete from t_fleet where id = 1'), ['t_fleet']);
  assert.deepEqual(tablesFromSql('select 1 from dual'), []);
  assert.deepEqual(tablesFromSql('select * from db.t_fleet'), ['db.t_fleet']);
  // CTE name is not a physical table; the real table inside it is kept.
  assert.deepEqual(tablesFromSql('with x as (select * from t_a) select * from x'), ['t_a']);
});

test('reads MyBatis mapper statements, includes and dynamic flags', () => {
  const xml = `<?xml version="1.0"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.acme.dao.OrderDao">
  <sql id="baseColumns">id, status, fleet_id</sql>
  <select id="selectById" resultType="Order">
    SELECT <include refid="baseColumns"/> FROM t_order WHERE id = #{id}
  </select>
  <update id="updateStatus">
    UPDATE t_order SET status = #{status} WHERE id = #{id}
  </update>
  <delete id="deleteById">DELETE FROM t_order WHERE id = #{id}</delete>
</mapper>`;
  const statements = extractMyBatisStatements(xml, { file: 'mapper/OrderMapper.xml', namespace: 'com.acme.dao.OrderDao' });
  assert.equal(statements.length, 3);
  const select = statements.find((statement) => statement.statementId === 'selectById');
  assert.equal(select.operation, 'select');
  assert.equal(select.id, 'com.acme.dao.OrderDao.selectById');
  assert.deepEqual(select.tables, ['t_order']);
  assert.equal(select.file, 'mapper/OrderMapper.xml');
  assert.ok(select.line > 0);
  assert.equal(statements.find((statement) => statement.statementId === 'updateStatus').operation, 'update');
  assert.equal(statements.find((statement) => statement.statementId === 'deleteById').operation, 'delete');
  assert.ok(statements.every((statement) => statement.dynamic === false));
});

test('flags dynamic mapper SQL without losing the table', () => {
  const xml = `<mapper namespace="X">
  <select id="search">
    SELECT * FROM t_fleet
    <where><if test="id != null">AND id = #{id}</if></where>
  </select>
</mapper>`;
  const [statement] = extractMyBatisStatements(xml, { namespace: 'X' });
  assert.equal(statement.dynamic, true);
  assert.deepEqual(statement.tables, ['t_fleet']);
});

test('reads MyBatis annotation SQL and skips providers', () => {
  const java = `package com.acme.dao;
public interface OrderDao {
  @Select("SELECT id, status FROM t_order WHERE fleet_id = #{fleetId}")
  List<Order> listByFleet(@Param("fleetId") Long fleetId);

  @Update(value = "UPDATE t_order SET status = #{status} WHERE id = #{id}")
  int updateStatus(Order order);

  @SelectProvider(type = SqlProvider.class, method = "build")
  List<Order> search(OrderQuery query);
}`;
  const statements = extractAnnotationStatements(java, {
    file: 'src/com/acme/dao/OrderDao.java',
    packageName: 'com.acme.dao',
    className: 'OrderDao',
  });
  assert.equal(statements.length, 2);
  assert.equal(statements[0].operation, 'select');
  assert.deepEqual(statements[0].tables, ['t_order']);
  assert.equal(statements[1].operation, 'update');
  assert.equal(statements[1].namespace, 'com.acme.dao.OrderDao');
});

test('splits .sql migration files into statements', () => {
  const sql = `-- migration
CREATE TABLE IF NOT EXISTS t_order (id bigint, status int);
INSERT INTO t_order (id, status) VALUES (1, 2);
UPDATE t_order SET status = 3 WHERE id = 1;
select * from t_order;`;
  const statements = extractSqlFileStatements(sql, { file: 'db/migration.sql' });
  assert.equal(statements.length, 3);
  assert.deepEqual(
    statements.map((statement) => statement.operation),
    ['insert', 'update', 'select'],
  );
  assert.deepEqual(statements[0].tables, ['t_order']);
  assert.equal(statements[0].line, 3);
});

test('groups statements by table for the database lane', () => {
  const statements = [
    { tables: ['t_order', 't_fleet'] },
    { tables: ['t_order'] },
    { tables: [] },
  ];
  const grouped = groupStatementsByTable(statements);
  assert.equal(grouped.get('t_order').length, 2);
  assert.equal(grouped.get('t_fleet').length, 1);
  assert.equal(grouped.size, 2);
});
