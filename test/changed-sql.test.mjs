import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import { cleanup, commitAll, makeTempRepo, write } from './helpers.mjs';

test('only SQL statements inside changed lines are marked as changed', () => {
  const dir = makeTempRepo();
  try {
    write(dir, 'mapper/OrderMapper.xml', `<mapper namespace="com.acme.dao.OrderDao">
  <select id="selectById">SELECT id FROM t_order WHERE id = #{id}</select>
  <update id="touch">UPDATE t_order SET touched_at = NOW() WHERE id = #{id}</update>
</mapper>\n`);
    commitAll(dir, 'init');
    write(dir, 'mapper/OrderMapper.xml', `<mapper namespace="com.acme.dao.OrderDao">
  <select id="selectById">SELECT id, status FROM t_order WHERE id = #{id}</select>
  <update id="touch">UPDATE t_order SET touched_at = NOW() WHERE id = #{id}</update>
</mapper>\n`);
    const data = buildReviewData(new GitRepo(dir), { worktree: true });
    assert.equal(data.tables.length, 1);
    const table = data.tables[0];
    assert.equal(table.name, 't_order');
    assert.equal(table.changedStatementCount, 1);
    const select = table.statements.find((statement) => statement.id.endsWith('.selectById'));
    const update = table.statements.find((statement) => statement.id.endsWith('.touch'));
    assert.equal(select.changed, true);
    assert.equal(update.changed, false);
    assert.ok(select.lineEnd >= select.line);
  } finally {
    cleanup(dir);
  }
});
