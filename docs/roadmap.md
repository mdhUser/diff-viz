# 迭代计划：泳道分层 · 配置入图 · 数据库 SQL 视图 · 远端 PR/MR

> 目标：把一次 Review 从「文件列表 + 流向」升级为端到端可读的链路：
> **模块/包（泳道）→ 代码 → 配置文件 → 数据库表（含 SQL）**。
> 原则：数据契约只做增量、不破坏 1.x；所有解析保持零运行时依赖、只读、可回退。

## 当前状态（2026-11-24，v1.8.0）

| 迭代 | 版本 | 状态 |
| --- | --- | --- |
| 0. 基础（模块元数据、夹具、契约骨架） | — | ✅ 完成 |
| 1. 泳道分层 | `v1.1.0` / `v1.1.1` | ✅ 完成 |
| 2. 配置/资源入图 | `v1.2.0` | ✅ 完成 |
| 3. 数据库表与 SQL 视图 | `v1.3.0` | ✅ 完成 |
| 4. 远端 PR / MR 接入 | `v1.4.0` / `v1.4.1` | ✅ 完成 |
| 5. Reviewer 评论入图 | `v1.5.0` | ✅ 完成 |
| 6. 工作区历史版本 | `v1.6.0` | ✅ 完成 |
| 7. MCP / Agent 通信 | `v1.7.0` | ✅ 完成 |
| 8. Web UI 中英文切换 | `v1.8.0` | ✅ 完成 |
| 9. CLI / 文档国际化 | 未排期 | ⏳ 待做 |

## 已完成

### v1.1.0 / v1.1.1 — 泳道分层

- 构建标记识别模块（Maven/Gradle/npm/go.mod/pyproject），按依赖深度排序，入口层在上、数据层在下；工具栏「流向 / 泳道」切换，粒度支持模块 / 目录 / 包；最多 12 条泳道，其余合并「其他模块」；旧 Review 按一级目录回退。
- 节点卡片显示 `module + package`；泳道头显示路径、变更/受影响数量。
- 同批发布并行工作：hub 访问令牌 + Host 白名单（防 DNS rebinding）、`--max-scan-files` 与扫描截断页面顶部警告。
- 关键文件：`src/modules.mjs`、`src/collect.mjs`、`web/src/layout.ts`、`web/src/lanes.ts`、`web/src/components/LaneNode.tsx`。

### v1.2.0 — 配置/资源入图

- 扫描 `.xml / .properties / .yml / .yaml / .sql`（2000 文件 / 512KB 上限，变更过的配置始终解析）。
- MyBatis `namespace` ↔ Java Mapper 接口（`binds`）、Spring `<bean class>`（`class-ref`）、`<import resource>`（`config`）入图；改 Mapper XML 会让接口与调用方进入「受影响」，影响链继续沿代码传播。
- 配置节点专属图标/徽章、工具栏「配置 N」开关、图例与抽屉「配置关联」；缓存 schema 升级、配置专属自动摘要。
- 关键文件：`src/resources.mjs`、`src/deps.mjs`、`src/collect.mjs`、`web/src/components/FileNode.tsx`、`web/src/components/tabs/SummaryTab.tsx`。

### v1.3.0 — 数据库表与 SQL 视图

- 解析 MyBatis Mapper XML、Java `@Select/@Insert/@Update/@Delete`、`.sql` 文件；按表聚合成 `tables` / `components`，生成 `reads_table` / `writes_table` 边；从 datasource 配置推断 MySQL/PostgreSQL/Oracle/SQL Server/H2/SQLite。
- 数据库泳道（`MySQL · N 张表`）、表卡片读取/写入徽章与 SQL 条数、悬停显示前 3 条 SQL（来源文件:行号、动态 SQL 标记）、`TableDetail` 抽屉展示全部语句并可跳回来源 Diff。
- SQL 按表懒加载（`<review>/tables/<payload>.json` + `/api/table`），`/api/data` 只含元数据；上限 300 表 / 每表 200 条 / 单条 4KB，超限写入 `meta.warnings`。
- 关键文件：`src/sql.mjs`、`src/db.mjs`、`src/review-store.mjs`、`src/hub.mjs`、`web/src/components/TableNode.tsx`、`TableDetail.tsx`、`SqlHoverCard.tsx`。

### v1.4.0 — 远端 PR / MR 接入

- hub「已注册仓库」窗口新增 **PR / MR** 标签：列出 GitHub PR / GitLab MR（编号、标题、作者、来源→目标分支、更新时间、草稿标记），点击即生成 `base...head` 的 Review；顶部显示 `PR #N · 标题` 并可跳远端网页。
- 平台自动识别：解析 `origin` 的 ssh/https 地址；支持 GitHub / GitLab / 自建实例（`DIFF_VIZ_PROVIDER`、`DIFF_VIZ_*_HOSTS`、`DIFF_VIZ_*_API_URL`）。token 从 `GITHUB_TOKEN` / `GITLAB_TOKEN` 读取，仅在 hub 进程内使用。
- 自动 fetch `refs/pull/<n>/head` 或 `refs/merge-requests/<iid>/head` + 目标分支；同一 PR 复用 `<projectId>-pull-<number>` Review，注解/审查状态可复用；`meta.pull` 记录元数据。
- CLI 新增 `--pr <编号|URL>` / `--mr <编号|URL>`，`--base` 可覆盖目标分支。
- 新增 `GET /api/pulls`（60s 缓存、可 `refresh=1`）与 `POST /api/review {pull}`；列表/详情/鉴权错误给出可操作提示。
- 关键文件：`src/remotes.mjs`、`src/cli.mjs`、`src/hub.mjs`、`web/src/components/RepoPanel.tsx`、`web/src/components/Header.tsx`。

### v1.5.0 — Reviewer 评论入图

- 打开 PR/MR 时读取 GitHub 行内评论 + issue 评论、GitLab notes；跳过 system note，保留 resolved/line 信息。
- 文件节点与侧栏显示评论数徽章（未解决为琥珀色），头部/侧栏汇总总评论数；抽屉新增「Reviewer 评论」Tab；工具栏「有评论」过滤只看评论文件。
- 评论随 Review 清单持久化；读取失败降级为 `meta.warnings`，不阻断 Review。
- 关键文件：`src/comments.mjs`、`src/cli.mjs`、`src/hub.mjs`、`src/review-store.mjs`、`web/src/components/tabs/CommentsTab.tsx`、`FileNode.tsx`、`Sidebar.tsx`。

### v1.6.0 — 工作区历史版本

- 每次重新分析同一个 workspace 文件时归档上一版快照，最新版保留稳定 id；页面「历史 N」切换历史版本（时间、仓库统计、比较范围、归档标记）。
- `GET /api/workspace/history?file=` 返回最新与归档版本；归档 `meta` 带 `archived/archivedAt/archivedFrom`。
- 关键文件：`src/hub.mjs`（归档与历史 API）、`web/src/components/WorkspaceView.tsx`（历史下拉）、`test/workspace-history.test.mjs`。

### v1.7.0 — MCP / Agent 通信

- 新增 `diff-viz mcp` stdio server：`diff_viz_review/get_review/get_node/annotate/list_projects/list_reviews`，Agent 可生成 Review、读取拓扑与 Diff、写回摘要。
- 新增 `docs/mcp.md` 与 Cursor/Claude/Codex 配置示例；CLI 补 `--commit`。
- 关键文件：`src/mcp.mjs`、`src/cli.mjs`、`test/mcp.test.mjs`。

### v1.8.0 — Web UI 中英文切换

- 前端 i18n：中文源文案作为 key + 英文词典，`I18nProvider`/`useI18n`；按 `?lang` → localStorage → 浏览器语言检测，切换即时生效并写入 URL/本地存储。
- 覆盖全部界面组件与工作区/错误/加载页；日期使用当前 locale；顶栏与工作区均有语言切换器。
- 新增 i18n 覆盖测试；服务端摘要/Agent 注解/评论正文保持原文，CLI 输出和详细文档翻译顺延到 v1.9。
- 关键文件：`web/src/i18n/`、`LanguageSwitch.tsx`、全部 `web/src/components/*`、`test/i18n.test.mjs`。

## 数据契约增量（1.x 兼容）

- 节点：`kind: "code" | "config"`、`resourceKind`、`moduleId/moduleLabel/modulePath`、`packagePath`。
- `meta`：`modules[]`、`db{engine,label,tables}`、`stats.configFiles`、`stats.tables`、`resourceStats`、`scanLimit`。
- 顶层（可选）：`tables[]`、`components[]`；`storage.tablesDir`。
- 边 `relation`：`imports | binds | config | class-ref | reads_table | writes_table`，方向统一为「source 依赖 target」；表边固定「代码 → 表」不随视图翻转。
- 旧数据：无新字段时前端回退（目录泳道、隐藏配置/DB 层）；旧单文件 Review 可读并在写回时升级。

## 后续迭代 v1.6（提议）

1. **properties / yaml 键引用**：`@Value("${key}")`、`@ConfigurationProperties(prefix)` 与配置键建立边，配置改动能命中使用方；keys 已在 v1.2 解析，补键索引与 Java 注解匹配。
2. **Spring `component-scan` 包映射**：把 `base-package` 映射到包内 Java 文件，补齐 Spring 配置到代码的边。
3. **泳道折叠与搜索**：泳道头折叠/展开；搜索命中时隐藏空泳道；超大图按泳道虚拟化。
4. **中间件组件**：`components[].kind` 扩展 `cache` / `mq`（Redis/MQ），先做配置识别 + 组件节点，不做协议解析。
5. **workspace 级数据库视图**：各服务表在服务级视图中聚合展示（跨服务数据血缘仍不做）。
6. **演示与文档**：`scripts/demo.mjs` 增加 Java + MyBatis + 多模块夹具；更新 README 截图与推广素材；性能基准脚本（泳道 + 大仓 SQL 解析）。

验收门槛（沿用现有流程）：`npm test`、`npm run typecheck`、`npm run build`、`release:check` 全绿；CI 三平台矩阵通过；新增数据字段保持增量，旧 Review 正常回退。

## 设计取舍（已定）

- **泳道布局**：复用 dagre 计算依赖深度，再按模块分带 + 深度分桶打包（每列最多 5 行），避免单模块文件多时拉出超长泳道；不使用 dagre compound clusters（边路由与回归风险更高）。
- **配置节点**：正则/状态机静态解析，不引入 XML/SQL 解析库；未识别内容保留节点、不猜测边。方向统一「依赖方 → 被依赖方」，复用现有反向 BFS 影响分析。
- **数据库表**：作为展示型虚拟节点，不计入 `changedFiles/impactedFiles`；SQL 文本懒加载，manifest 只保留元数据，避免大仓库首屏变慢。
- **PR/MR 接入**：平台识别只依赖 `origin` URL 与可覆盖的环境变量；拉取走 `git fetch` + 原生 `fetch`，不新增运行时依赖；Review 用 `merge-base(base, head)..head` 三点范围，与 PR 显示 diff 一致；API token 只留在 hub 进程，不下发浏览器；PR 的 ref 视为不可变快照，不参与工作区文件监听。
- **零依赖**：运行时仍然只用 Node 内置模块，SQL/XML 解析均为手写扫描器。
