import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeResource,
  isResourceFile,
  parseYamlKeys,
  resolveResourceImport,
} from '../src/resources.mjs';

test('recognises resource extensions', () => {
  for (const file of ['a.xml', 'a.properties', 'a.yml', 'a.yaml', 'a.sql']) {
    assert.equal(isResourceFile(file), true, file);
  }
  for (const file of ['a.java', 'a.ts', 'a.json']) assert.equal(isResourceFile(file), false, file);
});

test('analyses a MyBatis mapper: namespace, statements and tables', () => {
  const xml = `<mapper namespace="com.acme.dao.OrderDao">
  <select id="selectById">SELECT * FROM t_order WHERE id = #{id}</select>
  <update id="updateStatus">UPDATE t_order SET status = #{status}</update>
</mapper>`;
  const resource = analyzeResource('src/main/resources/mapper/OrderMapper.xml', xml);
  assert.equal(resource.resourceKind, 'xml-mybatis');
  assert.equal(resource.mapperInterface, 'com.acme.dao.OrderDao');
  assert.equal(resource.statements.length, 2);
  assert.deepEqual(resource.statements[0].tables, ['t_order']);
  assert.equal(resource.statements[1].operation, 'update');
});

test('analyses Spring XML imports, bean classes and component scans', () => {
  const xml = `<beans xmlns="http://www.springframework.org/schema/beans">
  <import resource="classpath:app/dao-beans.xml"/>
  <bean id="orderDao" class="com.acme.dao.OrderDao"/>
  <context:component-scan base-package="com.acme.service"/>
</beans>`;
  const resource = analyzeResource('src/main/resources/app/application.xml', xml);
  assert.equal(resource.resourceKind, 'xml-spring');
  assert.deepEqual(resource.imports, ['classpath:app/dao-beans.xml']);
  assert.deepEqual(resource.classRefs, ['com.acme.dao.OrderDao']);
  assert.deepEqual(resource.packages, ['com.acme.service']);
});

test('keeps unknown XML as a generic config node without edges', () => {
  const resource = analyzeResource('config/logback.xml', '<configuration><appender name="x"/></configuration>');
  assert.equal(resource.resourceKind, 'xml-generic');
  assert.deepEqual(resource.imports, []);
  assert.deepEqual(resource.classRefs, []);
});

test('parses properties keys and flat yaml keys', () => {
  const properties = analyzeResource(
    'src/main/resources/application.properties',
    '# comment\nspring.datasource.url=jdbc:mysql://localhost/x\nfeature.flag=true\n',
  );
  assert.deepEqual(properties.keys, ['spring.datasource.url', 'feature.flag']);

  assert.deepEqual(
    parseYamlKeys(`server:\n  port: 8080\n  ssl:\n    enabled: true\nmybatis:\n  mapper-locations: classpath:mapper/*.xml\n`),
    ['server', 'server.port', 'server.ssl', 'server.ssl.enabled', 'mybatis', 'mybatis.mapper-locations'],
  );

  const yaml = analyzeResource('application.yml', 'spring:\n  profiles: prod\n');
  assert.equal(yaml.resourceKind, 'yaml');
  assert.ok(yaml.keys.includes('spring.profiles'));
});

test('reads .sql resources through the SQL scanner', () => {
  const resource = analyzeResource(
    'db/migration/V2__order.sql',
    'ALTER TABLE t_order ADD COLUMN fleet_id bigint;\nINSERT INTO t_order (id) VALUES (1);\n',
  );
  assert.equal(resource.resourceKind, 'sql');
  assert.equal(resource.statements.length, 1);
  assert.deepEqual(resource.statements[0].tables, ['t_order']);
});

test('resolves Spring resource imports relative to the file and classpath root', () => {
  assert.deepEqual(resolveResourceImport('src/main/resources/app/application.xml', 'classpath:app/dao.xml'), [
    'app/dao.xml',
  ]);
  assert.deepEqual(resolveResourceImport('src/main/resources/app/application.xml', '../shared/common.xml'), [
    'src/main/resources/shared/common.xml',
  ]);
  assert.deepEqual(resolveResourceImport('src/main/resources/app/application.xml', '/app/dao.xml'), ['app/dao.xml']);
});
