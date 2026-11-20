# 配置 / 资源文件如何入图

代码之外，diff-viz 还会把影响运行时的配置资源纳入同一张图，让「改了 XML/Mapper/Spring 配置」也能看清牵连关系。

## 扫描范围

| 扩展名 | 解析结果 |
| --- | --- |
| `.xml` | MyBatis Mapper（`<mapper namespace>` + SQL 语句）、Spring XML（`<bean class>` / `<import resource>` / `component-scan`）、其他 XML（保留为节点，不产边） |
| `.properties` | 键列表（供后续配置键匹配） |
| `.yml` / `.yaml` | 扁平化键路径（如 `spring.datasource.url`） |
| `.sql` | 语句拆分、操作类型、涉及的表 |

限制：最多 2,000 个资源文件、单文件 512 KB；**本次变更过的配置始终会解析**，不受上限影响。超限会在 `meta.warnings` / `meta.resourceStats.truncated` 中提示。解析结果与代码文件一样按 `mtime + size` 缓存（缓存 schema v2）。

## 边与影响方向

所有边沿用「source 依赖 target」的方向，因此原有反向 BFS 影响分析可以直接复用：

| relation | 方向 | 含义 |
| --- | --- | --- |
| `binds` | Java Mapper 接口 → Mapper XML | 接口由 XML 提供实现；XML 改动会命中接口的调用方 |
| `class-ref` | Spring XML → Java 类 | `<bean class="…">` 引用了该类 |
| `config` | Spring XML → Spring XML | `<import resource="classpath:…">` |

改动 `OrderMapper.xml` 时，`OrderDao` 接口（`binds` 的目标）进入「受影响」，再沿它的 import 关系传给 Service，`impactChain` 会显示传播路径。

节点新增可选字段：

```json
{
  "kind": "config",
  "resourceKind": "xml-mybatis",
  "language": "xml"
}
```

`meta.stats.configFiles` 统计本次变更的配置数，`meta.resourceStats` 记录资源扫描上限与是否截断。

## 界面

- 配置节点有独立的青色图标与「配置」徽章，卡片底部显示 `MyBatis Mapper` / `Spring XML` 等类型。
- 工具栏出现「配置 N」开关，可整体隐藏配置层；图例增加青色「绑定/配置/引用」说明。
- 详情抽屉「摘要与影响」新增「配置关联」区块，可直接跳到关联的 XML 或 Java 文件。
- 配置变更的自动摘要会说明被多少个文件引用，而不是套用代码的「修改了 N 个代码区块」。

## 已知近似

- 正则/状态机解析，不引入 XML/SQL 解析库；`<property ref>` 内部引用、`component-scan` 包到文件的映射暂不产边。
- 未识别的 XML 只作为配置节点展示，不猜测关系。
- 配置键与 `@Value("${...}")` 的匹配、配置文件之间的 include 链在后续版本补充（见 `docs/development.md` 的发布计划）。
