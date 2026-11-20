import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { GitRepo } from '../src/git.mjs';
import { buildReviewData } from '../src/collect.mjs';
import { cleanup, commitAll, makeTempRepo, write } from './helpers.mjs';

function javaRepo() {
  const dir = makeTempRepo();
  write(dir, 'pom.xml', '<project><modules><module>svc-dao</module><module>svc-core</module></modules></project>\n');
  write(dir, 'svc-dao/pom.xml', '<project><artifactId>svc-dao</artifactId></project>\n');
  write(dir, 'svc-core/pom.xml', '<project><artifactId>svc-core</artifactId></project>\n');
  write(
    dir,
    'svc-dao/src/main/java/com/acme/dao/OrderDao.java',
    'package com.acme.dao;\n\npublic interface OrderDao {\n  Object selectById(long id);\n}\n',
  );
  write(
    dir,
    'svc-dao/src/main/resources/mapper/OrderMapper.xml',
    `<mapper namespace="com.acme.dao.OrderDao">
  <select id="selectById">SELECT * FROM t_order WHERE id = #{id}</select>
</mapper>`,
  );
  write(
    dir,
    'svc-dao/src/main/resources/app/application.xml',
    `<beans>
  <bean id="orderDao" class="com.acme.dao.OrderDao"/>
  <import resource="classpath:app/dao-extra.xml"/>
</beans>`,
  );
  write(
    dir,
    'svc-dao/src/main/resources/app/dao-extra.xml',
    '<beans>\n  <bean id="helper" class="com.acme.dao.OrderDao"/>\n</beans>',
  );
  write(
    dir,
    'svc-core/src/main/java/com/acme/core/OrderService.java',
    'package com.acme.core;\n\nimport com.acme.dao.OrderDao;\n\npublic class OrderService {\n  private OrderDao dao;\n}\n',
  );
  commitAll(dir, 'init');
  return dir;
}

test('changed config files join the graph and impact the code that binds them', () => {
  const dir = javaRepo();
  try {
    write(
      dir,
      'svc-dao/src/main/resources/mapper/OrderMapper.xml',
      `<mapper namespace="com.acme.dao.OrderDao">
  <select id="selectById">SELECT * FROM t_order WHERE id = #{id} AND status = 1</select>
</mapper>`,
    );
    write(
      dir,
      'svc-dao/src/main/resources/app/application.xml',
      `<beans>
  <bean id="orderDao" class="com.acme.dao.OrderDao"/>
  <import resource="classpath:app/dao-extra.xml"/>
  <bean id="orderService" class="com.acme.core.OrderService"/>
</beans>`,
    );
    const data = buildReviewData(new GitRepo(dir), { worktree: true });
    const byPath = new Map(data.nodes.map((node) => [node.path, node]));

    const mapper = byPath.get('svc-dao/src/main/resources/mapper/OrderMapper.xml');
    assert.equal(mapper.status, 'modified');
    assert.equal(mapper.kind, 'config');
    assert.equal(mapper.resourceKind, 'xml-mybatis');
    assert.match(mapper.summary, /MyBatis Mapper/);
    assert.ok(mapper.importedBy.includes('svc-dao/src/main/java/com/acme/dao/OrderDao.java'));

    const spring = byPath.get('svc-dao/src/main/resources/app/application.xml');
    assert.equal(spring.kind, 'config');
    assert.equal(spring.resourceKind, 'xml-spring');
    assert.ok(spring.imports.includes('svc-core/src/main/java/com/acme/core/OrderService.java'));
    assert.ok(spring.imports.includes('svc-dao/src/main/resources/app/dao-extra.xml'));

    const dao = byPath.get('svc-dao/src/main/java/com/acme/dao/OrderDao.java');
    assert.equal(dao.status, 'impacted_only');
    assert.ok(dao.impactChain.includes('svc-dao/src/main/resources/mapper/OrderMapper.xml'));

    const service = byPath.get('svc-core/src/main/java/com/acme/core/OrderService.java');
    assert.equal(service.status, 'impacted_only');
    assert.ok(service.depth >= 1);

    const edge = (source, target) => data.edges.find((item) => item.source === source && item.target === target);
    assert.equal(
      edge('svc-dao/src/main/java/com/acme/dao/OrderDao.java', 'svc-dao/src/main/resources/mapper/OrderMapper.xml')?.relation,
      'binds',
    );
    assert.equal(
      edge('svc-dao/src/main/resources/app/application.xml', 'svc-dao/src/main/java/com/acme/dao/OrderDao.java')?.relation,
      'class-ref',
    );
    assert.equal(
      edge('svc-dao/src/main/resources/app/application.xml', 'svc-dao/src/main/resources/app/dao-extra.xml')?.relation,
      'config',
    );
    assert.equal(
      edge('svc-core/src/main/java/com/acme/core/OrderService.java', 'svc-dao/src/main/java/com/acme/dao/OrderDao.java')?.relation,
      'imports',
    );
    assert.equal(data.meta.stats.configFiles, 2);
  } finally {
    cleanup(dir);
  }
});
