# 数据库表与 SQL 视图

diff-viz 会把代码和 Mapper 里的 SQL 静态解析成「数据库表」节点，画进同一张拓扑图：谁读写了哪张表、哪张表因为本次改动受到影响、具体 SQL 是什么。整个过程只读，不连数据库、不执行 SQL。

## 数据来源

| 来源 | 解析内容 |
| --- | --- |
| MyBatis Mapper XML | `<select|insert|update|delete>` 语句、`<include refid>` 本地片段、`id`、行号、动态 SQL 标记 |
| Java MyBatis 注解 | `@Select` / `@Insert` / `@Update` / `@Delete` 的字符串 SQL（`@SelectProvider` 跳过） |
| `.sql` 文件 | 按 `;` 拆分的迁移/脚本语句 |

表名从 `FROM / JOIN / UPDATE / INTO / DELETE FROM` 中保守提取：去掉反引号/引号、归一 `schema.table`、忽略 `dual` 和信息模式表、排除 CTE 别名；`#{}` / `${}` 归一成 `?`，`<if>/<foreach>` 等动态标签展开成可读文本并标记「动态 SQL」。识别不了的 SQL 不会猜测。

## 数据模型（manifest 增量）

```json
{
  "components": [
    { "id": "db:default", "kind": "database", "label": "MySQL", "engine": "mysql", "tables": ["table:t_order"] }
  ],
  "tables": [
    {
      "id": "table:t_order",
      "name": "t_order",
      "schema": null,
      "componentId": "db:default",
      "operations": ["select", "update"],
      "statementCount": 3,
      "changed": true,
      "impacted": false,
      "sources": ["mapper/OrderMapper.xml"],
      "payload": "a1b2c3d4e5f6a7b8c9d0"
    }
  ]
}
```

- SQL 文本不放在 `/api/data`：按表拆到 `<review>/tables/<payload>.json`（`storage.tablesDir`），打开悬停卡或详情抽屉时才按需读取。
- 表只做展示：不计入 `changedFiles / impactedFiles`，`reviewOrder` 只包含文件和配置节点；`meta.stats.tables` 记录表数量。
- 数据库引擎从 `spring.datasource.url` / `jdbc:` / driver 配置推断（MySQL / PostgreSQL / Oracle / SQL Server / H2 / SQLite…），失败显示 `Database`。
- 上限：最多 300 张表、每表 200 条语句、单条 SQL 4KB（超出部分仍统计 `statementCount`，并写入 `meta.warnings`）。

## 边与影响

| relation | 方向 | 含义 |
| --- | --- | --- |
| `reads_table` | SQL 来源文件 → 表 | SELECT 读取该表 |
| `writes_table` | SQL 来源文件 → 表 | INSERT / UPDATE / DELETE 写入该表 |

表边永远保持「代码 → 表」方向，不随「影响/依赖」视图翻转；橙色实线、标签「读取/写入」。表的 `changed` 表示来源文件里有变更，`impacted` 表示来源文件进入了受影响集合。

## HTTP API

```bash
# 某张表的全部 SQL（含 file/line/operation/mapper/dynamic）
curl -H "X-Diff-Viz-Token: $(cat ~/.diff-viz/token)" \
  'http://127.0.0.1:5173/api/table?review=<reviewId>&table=table:t_order'
```

`/api/data?review=<id>` 只返回表元数据，`?full=1` 会合并 SQL 文本（脚本/兼容用途）。

## 界面

- 泳道视图最后一条是数据库泳道（`MySQL · N 张表`），表卡片显示读取/写入徽章与 SQL 条数。
- 鼠标悬停表节点：弹出前 3 条 SQL（操作类型、来源文件:行号、动态 SQL 标记），可直接打开该文件。
- 点击表节点：右侧抽屉展示表名、操作类型、来源文件、全部 SQL；点击来源文件跳到文件 Diff。
- 工具栏「数据表 N」开关可整体隐藏数据库层。

## 已知近似

- 静态正则提取：动态表名（`${table}`）、跨 Mapper 的 `<include>` 外部片段、`@SelectProvider` 生成的 SQL 无法解析，会标记或跳过。
- 只分析「本次图内文件」（变更 + 受影响）里的 SQL，不会输出整库表结构。
- 不做跨服务数据血缘：workspace 视图暂不聚合各服务的表。
