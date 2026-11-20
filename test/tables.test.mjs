import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import { startHub } from '../src/hub.mjs';
import { copyReviewStore, readReviewStore, removeReviewStore, writeReviewStore } from '../src/review-store.mjs';
import { cleanup, commitAll, hubFetch, makeTempRepo, write } from './helpers.mjs';

function sqlRepo() {
  const dir = makeTempRepo();
  write(dir, 'pom.xml', '<project><modules><module>svc-dao</module></modules></project>\n');
  write(dir, 'svc-dao/pom.xml', '<project><artifactId>svc-dao</artifactId></project>\n');
  write(
    dir,
    'svc-dao/src/main/java/com/acme/dao/OrderDao.java',
    `package com.acme.dao;

import org.apache.ibatis.annotations.Select;

public interface OrderDao {
  @Select("SELECT id, status FROM t_order WHERE id = #{id}")
  Object selectById(long id);
}
`,
  );
  write(
    dir,
    'svc-dao/src/main/resources/mapper/OrderMapper.xml',
    `<mapper namespace="com.acme.dao.OrderDao">
  <select id="selectById">SELECT * FROM t_order WHERE id = #{id}</select>
  <update id="updateStatus">UPDATE t_order SET status = #{status} WHERE id = #{id}</update>
</mapper>`,
  );
  write(
    dir,
    'svc-dao/src/main/resources/application.properties',
    'spring.datasource.url=jdbc:mysql://localhost:3306/app\n',
  );
  commitAll(dir, 'init');
  return dir;
}

function changedReview(dir) {
  write(
    dir,
    'svc-dao/src/main/resources/mapper/OrderMapper.xml',
    `<mapper namespace="com.acme.dao.OrderDao">
  <select id="selectById">SELECT * FROM t_order WHERE id = #{id} AND status = 1</select>
  <update id="updateStatus">UPDATE t_order SET status = #{status} WHERE id = #{id}</update>
</mapper>`,
  );
  return buildReviewData(new GitRepo(dir), { worktree: true });
}

test('SQL statements become table nodes with read/write edges', () => {
  const dir = sqlRepo();
  try {
    const data = changedReview(dir);
    assert.ok(Array.isArray(data.tables));
    const order = data.tables.find((table) => table.name === 't_order');
    assert.ok(order, 't_order table should exist');
    assert.deepEqual(order.operations, ['select', 'update']);
    assert.equal(order.changed, true);
    assert.ok(order.sources.includes('svc-dao/src/main/resources/mapper/OrderMapper.xml'));
    assert.ok(order.sources.includes('svc-dao/src/main/java/com/acme/dao/OrderDao.java'));
    assert.ok(order.statements.some((statement) => statement.sql.includes('t_order')));

    assert.equal(data.components.length, 1);
    assert.equal(data.components[0].engine, 'mysql');
    assert.equal(data.components[0].label, 'MySQL');
    assert.equal(data.meta.db.engine, 'mysql');
    assert.equal(data.meta.stats.tables, 1);

    const mapper = 'svc-dao/src/main/resources/mapper/OrderMapper.xml';
    const reads = data.edges.find((edge) => edge.source === mapper && edge.target === 'table:t_order' && edge.relation === 'reads_table');
    const writes = data.edges.find((edge) => edge.source === mapper && edge.target === 'table:t_order' && edge.relation === 'writes_table');
    assert.ok(reads, 'mapper → t_order reads edge');
    assert.ok(writes, 'mapper → t_order writes edge');
  } finally {
    cleanup(dir);
  }
});

test('tables persist as lazy payloads and survive copy/remove', () => {
  const dir = sqlRepo();
  const dataPath = path.join(dir, '.diff-review-data.json');
  try {
    const data = changedReview(dir);
    writeReviewStore(dataPath, data);
    const manifest = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(manifest.storage.format, 2);
    assert.ok(manifest.storage.tablesDir);
    assert.equal(manifest.tables.length, 1);
    assert.ok(!('statements' in manifest.tables[0]), 'statements are not in the manifest');
    assert.ok(fs.existsSync(path.join(`${dataPath}.tables`, `${manifest.tables[0].payload}.json`)));

    const store = readReviewStore(dataPath);
    const table = store.readTable('t_order');
    assert.equal(table.name, 't_order');
    assert.ok(table.statements.length >= 2);
    assert.equal(store.readTable('table:t_order').id, 'table:t_order');
    assert.equal(store.findTable('nope'), null);
    assert.ok(store.toFullData().tables[0].statements.length >= 2);

    const snapshot = path.join(dir, 'snapshot');
    copyReviewStore(store, snapshot);
    const copied = readReviewStore(snapshot);
    assert.equal(copied.readTable('table:t_order').statements.length, table.statements.length);
    removeReviewStore(snapshot);
    assert.equal(fs.existsSync(snapshot), false);
  } finally {
    cleanup(dir);
  }
});

test('hub serves table SQL lazily and keeps it out of /api/data', async () => {
  const dir = sqlRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-tables-hub-'));
  const dataPath = path.join(dir, '.diff-review-data.json');
  writeReviewStore(dataPath, changedReview(dir));
  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const imported = await hubFetch(server, 'api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, dataPath }),
    }).then((response) => response.json());
    assert.ok(imported.reviewId);

    const manifest = await hubFetch(server, `api/data?review=${imported.reviewId}`).then((response) => response.json());
    assert.equal(manifest.tables.length, 1);
    assert.ok(!('statements' in manifest.tables[0]));

    const table = await hubFetch(server, `api/table?review=${imported.reviewId}&table=table:t_order`).then((response) =>
      response.json(),
    );
    assert.equal(table.name, 't_order');
    assert.ok(table.statements.some((statement) => statement.operation === 'update'));

    const missing = await hubFetch(server, `api/table?review=${imported.reviewId}&table=nope`);
    assert.equal(missing.status, 404);

    const full = await hubFetch(server, `api/data?review=${imported.reviewId}&full=1`).then((response) => response.json());
    assert.ok(full.tables[0].statements.length > 0);
  } finally {
    await server.close();
    cleanup(dir);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
