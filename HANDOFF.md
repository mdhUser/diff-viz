# diff-viz 交接说明

> 给接手的新会话：读完这份就能直接开工，不用再翻历史。
> 最后核对：2026-11-20，对应版本 `v1.3.0`（tag / GitHub Release 已推；npm 上最新仍是 `1.0.0`，`1.1.0`–`1.3.0` 待发布）。
> 桌面还有一份不在仓库里的体验待办清单：`~/Desktop/diff-viz-体验待办-2026-11-17.md`。

## 1. 它是什么

本地运行的代码变更 Review 可视化工具，两个身份：

1. **CLI**：读 `git diff` → 静态解析文件/配置/SQL 依赖 → 生成 `.diff-review-data.json` → 注册到常驻 hub，浏览器打开拓扑图。
2. **Agent Skill**：`SKILL.md` 定义 agent 的调用方式（`--json-only` 读数据、`annotate` 写摘要与风险点、用打印出的带 token 链接请用户看界面）。

**零运行时依赖**：`dependencies` 为空，CLI 只用 `node:*` 内置模块；前端是提交进仓库的预构建 `dist/`，clone 下来不用 `npm install` 就能跑（装依赖只为了改前端和跑测试）。要求 Node >= 20。

## 2. 当前状态（不要重复做）

- 版本 `1.3.0`，`main` 与 `origin/main` 的差异以 `git status` 为准；tag `v0.1.0` → `v1.3.0` 齐全。
- `npm test` **91/91 通过**（18 个测试文件）；`npm run typecheck`、`npm run release:check` 通过；CI 跑 ubuntu / macOS / Windows 三平台 Node 20 + ubuntu Node 24。
- 仓库：https://github.com/mdhUser/diff-viz

已完成的能力：

- **变更提取**：工作区（含未跟踪）、`--staged`、`--last`、`--range A..B`、`--base main`；界面版本链还能直接点开历史单 commit 的 Review。
- **依赖解析**：JS/TS（Vue/Svelte 走 JS 解析，支持 tsconfig `baseUrl`/`paths`）、Python、Go（go.mod module 前缀）、Java（FQCN + 同包引用）、Rust、Kotlin、C#、Ruby；`.diff-viz/languages.json` 或 `--languages` 可加自定义语言（package / relative 两种策略）。
- **配置/资源入图（v1.2.0）**：`.xml` / `.properties` / `.yml` / `.yaml` / `.sql` 扫描；MyBatis Mapper `namespace` ↔ Java Mapper 接口（`binds`）、Spring `<bean class>`（`class-ref`）、`<import resource>`（`config`）；变更过的配置始终解析，上限 2000 个文件 / 单文件 512KB。
- **数据库与 SQL（v1.3.0）**：从 MyBatis XML、Java `@Select/@Insert/@Update/@Delete`、`.sql` 提取语句并归并到表；`reads_table` / `writes_table` 边，表卡片状态、悬停前 3 条 SQL、抽屉看全部语句并跳回来源 Diff；SQL 按表懒加载。上限 300 张表 / 每表 200 条 / 单条 4096 字符，超出写 `meta.warnings`。
- **影响分析**：反向 BFS，`--impact-depth` 默认 3（最多 6）、`--max-impact` 默认 120（最多 500）；节点带 `impactChain` 展示 A → B → C。
- **泳道视图（v1.1.0）**：按模块（Maven/Gradle/npm/go.mod/pyproject 识别，可切目录/包）分层，依赖深度排序、入口层在前；最多 12 条泳道，超出合并为「其他模块」，旧 Review 按一级目录回退。
- **hub**：常驻复用端口、多仓库、`fs.watch` 防抖重算 + SSE 自动刷新、`mtime+size` 解析缓存、Review LRU 清理、状态文件 0600 / 目录 0700、重启复用上次端口。
- **访问控制（v1.1.0）**：Host 白名单防 DNS rebinding + `/api/*` 访问令牌（详见第 6 节）。
- **拆分存储（v0.8.0 / v1.3.0）**：清单 + `nodes/` 逐节点内容 + `tables/` 逐表 SQL，按需加载，`annotate --node` 不碰内容文件。
- **Agent 注解记忆**：按「项目 + 文件路径 + 归一化 diff」记在 `~/.diff-viz/annotations/<projectId>.json`，worktree → commit → range 切换时复用，内容变了不复用。
- **多仓库工作区**：`diff-viz workspace` 生成服务级拓扑，manifest 包依赖自动识别，RPC 用 `links` 补边。
- **Skill 安装**：`diff-viz skill install --agent dsh|claude|cursor|agents`。

## 3. 代码地图

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `bin/diff-viz.mjs` | 8 | 入口，转 `src/cli.mjs` |
| `src/cli.mjs` | 691 | 参数解析、命令分发（review/serve/hub/stop/annotate/workspace/skill） |
| `src/git.mjs` | 220 | git 命令封装、scope 解析、文件内容读取 |
| `src/diff-parse.mjs` | 284 | unified diff 解析、行号定位、TODO/FIXME 扫描 |
| `src/deps.mjs` | 1013 | 代码文件扫描、import 提取、各语言 resolver、扫描上限 |
| `src/languages.mjs` | 278 | 内建语言注册表（Rust/Kotlin/C#/Ruby）+ 自定义语言 |
| `src/modules.mjs` | 211 | 泳道模块识别、依赖深度排序、限量 |
| `src/resources.mjs` | 164 | XML / properties / yaml 等配置资源解析与边 |
| `src/sql.mjs` | 236 | SQL 提取、动态 SQL 归一化、表名识别 |
| `src/db.mjs` | 157 | 表聚合、引擎推断、读写边关系、SQL 上限 |
| `src/collect.mjs` | 1054 | diff → 依赖图 → 影响 BFS → 模块/表/摘要 → 数据 JSON |
| `src/review-store.mjs` | 445 | v2 拆分存储（manifest + nodes/ + tables/）、复制、旧数据升级 |
| `src/hub.mjs` | 1418 | 常驻 hub：注册 Review、仓库列表、commit 历史、watcher、SSE、HTTP 路由 |
| `src/security.mjs` | 178 | Host 白名单、访问令牌、Cookie、鉴权辅助函数 |
| `src/server.mjs` | 305 | 旧版单 Review 服务（`serve` 已走 hub，只剩集成测试在用） |
| `src/workspace.mjs` | 345 | workspace 文件解析、服务级拓扑、模板生成 |
| `src/cache.mjs` | 47 | 扫描缓存（`mtime+size`，schema v2） |
| `src/skill.mjs` | 166 | SKILL.md 安装（symlink / copy） |
| `src/util.mjs` | 112 | 路径、JSON 原子写、权限、格式化 |
| `web/src/` | ~5.6k | React UI：`App` 编排；`components/` 有 `GraphView` `LaneNode` `TableNode` `SqlHoverCard` `TableDetail` `DetailDrawer` `Sidebar` `ScanLimitBanner` 等；`components/tabs/` 三个抽屉页 |
| `scripts/` | — | `demo.mjs`（造演示仓库）、`build-skill-package.mjs`、`check-changelog.mjs` |

数据流：`git.mjs`（取 diff 与文件）→ `deps.mjs` + `resources.mjs` + `sql.mjs`（全仓索引与解析）→ `collect.mjs`（组图、影响、模块、表、摘要）→ `review-store.mjs`（落盘）→ `hub.mjs`（存储 + API）→ `web/`（渲染）。

## 4. 常用命令

```bash
cd ~/Documents/deepseek-harness/default-workspace/diff-viz

# 开发
npm test                  # 91 个测试
npm run typecheck         # tsc --noEmit
npm run build             # 改完 web/src 必须重新构建 dist（dist 提交进仓库）
npm run release:check     # 版本号必须与 CHANGELOG 对应
npm run demo              # 造一个演示仓库并起界面

# 使用
node bin/diff-viz.mjs                       # 分析当前仓库工作区
node bin/diff-viz.mjs --staged
node bin/diff-viz.mjs --last
node bin/diff-viz.mjs --range main..HEAD
node bin/diff-viz.mjs --max-scan-files 30000
node bin/diff-viz.mjs --json-only --quiet   # 只出 JSON，给 agent 读
node bin/diff-viz.mjs annotate --data .diff-review-data.json --annotations ann.json
node bin/diff-viz.mjs annotate --review <id> --annotations ann.json
node bin/diff-viz.mjs workspace [--init]
node bin/diff-viz.mjs hub                   # 前台看 hub
node bin/diff-viz.mjs stop
```

Agent 侧约定见 `SKILL.md`：先 `--json-only` 拿数据，读完源码后用 `annotate` 写回摘要/影响/TODO。CLI 打印的 Review URL 自带 `?token=`，直接把整条链接给用户。

## 5. 数据与存储契约要点

- 顶层：`meta` / `nodes` / `edges`；1.3 起还有可选的 `tables` / `components`。
- `meta`：`stats`、`reviewOrder`、`warnings`、`scanLimit`、`modules`、`db`、`scopeLabel` 等。
- `storage.format: 2`：清单只留节点元数据，正文在 `<data>.nodes/`（文件型）或 `<reviewId>/nodes/`（hub 快照）；表 SQL 在 `tables/`。旧单文件数据第一次写回时自动升级。
- `status`：`added` | `modified` | `deleted` | `impacted_only`；配置节点在 `nodes` 里带 `kind: "config"`，数据库表则在顶层 `tables`（界面布局时映射成 `kind: 'table'` 的图节点，不在 `nodes` 里）。
- `edges.source` **依赖** `edges.target`；关系有 `imports`、`binds`、`config`、`class-ref`、`reads_table`、`writes_table`。表边永远「代码 → 表」。
- `oldContent` / `newContent` 是完整文件内容（>400,000 字符截断），只在节点内容文件里，打开详情时通过 `/api/node` 取。
- `scanLimit = { limit, codeFiles, scanned, truncated }`：依赖扫描是否被上限截断；界面顶部横幅据此警告。
- 数据文件含完整源码：`.diff-review-data.json`、`.nodes/`、`.tables/` 已自动写入 `.git/info/exclude`，**不要提交或外发**。

完整定义见 `docs/data-contract.md`、`docs/languages.md`、`docs/resources.md`、`docs/database.md`。

## 6. hub 与安全（v1.1.0 起，别改坏）

- 默认只监听 `127.0.0.1:5173`，被占用自动 +1；重启复用注册表里记住的端口，之前打印的链接不会失效（显式 `--port` 可覆盖）。
- **Host 白名单**：只接受 `127.0.0.1` / `localhost` / `::1` 以及显式绑定或 `DIFF_VIZ_ALLOWED_HOSTS` 放行的主机，否则 403。这是防 DNS rebinding 的关键，不能因为「本机工具」就删掉。
- **访问令牌**：除 `GET /api/health` 外所有 `/api/*` 都要 token，可放 `X-Diff-Viz-Token`、`Authorization: Bearer`、`?token=` 或 `diff_viz_token` Cookie。令牌在 `~/.diff-viz/token`（0600，重启复用）；`diff-viz` 打印的链接自带 `?token=`，页面打开后换 HttpOnly Cookie 并从地址栏抹掉。
- `DIFF_VIZ_TOKEN` 可固定令牌；`DIFF_VIZ_NO_AUTH=1` 关闭令牌校验（保留 Host 白名单）；`DIFF_VIZ_ALLOWED_HOSTS=a,b` 追加主机。
- `ensureHub` 启动的后台 hub 固定带 `--no-open`：最终 Review 链接由 CLI 打开。**不要**让 hub 自己也开一个裸页签——那个页签会 `POST /api/review` 用默认参数重算并覆盖刚导入的 Review。
- hub 会记住每个项目最近一次分析的上限（`--max-scan-files`），文件监听 / 浏览器触发的 worktree 重算沿用它；改这块时注意别把 `lastPayloads` 里记的上限丢掉。
- 前端所有请求必须走 `web/src/api.ts` 的 `apiFetch` / `apiEventUrl`，裸 `fetch`/`EventSource` 会 401。
- API：`/api/health`（公开）、`/api/hub`、`/api/commits`、`/api/projects`、`/api/review`、`/api/import`、`/api/annotate`、`/api/data`、`/api/node`、`/api/table`、`/api/state`、`/api/events`、`/api/workspace`。

## 7. 发布流程（CI 会强制）

1. 在 `CHANGELOG.md` 的 `## [Unreleased]` 下写 `Added` / `Changed` / `Fixed`，说明用户能感知到什么。
2. 把 `package.json` 版本改成与 `## [x.y.z]` 一致，顺手更新 `package-lock.json` 根版本（`npm install --package-lock-only`）与 README 的「当前版本」。
3. `npm run release:check` → `npm test` → `npm run typecheck` → `npm run build`（`dist/` 必须提交，构建产物应与提交内容逐字节一致）。
4. `npm run package:skill` 重新生成 `release/diff-viz/` 技能包（`release/` 被 gitignore）。
5. `git tag vX.Y.Z`，push 提交和 tag；`npm publish` 在**用户自己的终端**执行（沙箱里 `gh auth` / npm 登录会被拒）。
6. 更新桌面待办清单的「迭代版本链」。

## 8. 已知坑与边界

- **`dist/` 是产物也是提交物**：改了 `web/src` 不 `npm run build`，界面和 skill 包里都是旧 UI。
- **解析是静态近似**：不走 AST、不执行代码；Java 同包引用靠标识符匹配，注释/字符串里出现同名类会误报；tsconfig 只读仓库根（不处理 `extends` 和子包）。
- **上限一览**：扫描 15,000 代码文件（`--max-scan-files`）、单文件 1MB、配置资源 2,000 个 / 512KB、patch 300,000 字符、未跟踪文件 200 个、数据表 300 张 / 每表 200 条 / 单条 4KB。超限都会进 `meta.warnings`，扫描截断另有页面横幅。
- **不监听文件变化的场景**：commit / range Review 不会因文件变化重算；Linux 上 Node 的递归 `fs.watch` 不可用，会退化为不监听（README 已写明）。
- **状态目录**：默认 `~/.diff-viz`（不可写回落系统临时目录），可用 `DIFF_VIZ_HOME` 指定；`DIFF_VIZ_NO_WATCH=1` / `DIFF_VIZ_NO_CACHE=1` / `DIFF_VIZ_KEEP_REVIEWS` 可调。
- **端口**：默认 5173，被占用自动递增，别硬编码 URL，看 CLI 打印的地址。
- **沙箱环境**：DSH 会话里跑 `gh auth`、写 `~/.config/gh`、`npm login` 会被拒；push 和发布要在用户自己的终端做。
- **旧版单 Review 服务**（`src/server.mjs`）只做了 Host 校验、没有令牌：`serve` 已改走 hub，它只剩集成测试在用，别把它当公网服务用。
- **HANDOFF.md 本身不进 npm 包**（`package.json` 的 `files` 不含它），只给仓库里的开发者看。

## 9. 下一版候选（按性价比）

1. **跨仓文件级连边**（待办 15 的 B 档）：服务级拓扑只到仓库粒度，共享库被引用到哪些文件还看不到；IDL 路由匹配（C 档）继续往后排。
2. **Linux 自动刷新**：`fs.watch` 递归不可用时用轮询兜底，或在文档里给替代方案。
3. **tsconfig 覆盖**：支持 `extends` 与 monorepo 各子包自己的 `paths`。
4. **SQL 精度**：PostgreSQL / Oracle 方言、`schema.table`、动态 SQL 拼接后的表名；表名大小写归一。
5. **大图性能**：节点数超阈值时按目录/模块聚合，点进去看细节。
6. **npm 发布**：`1.3.0` 还没上 npm（最新 `1.0.0`），推广前必须补。

## 10. 接手第一步

```bash
cd ~/Documents/deepseek-harness/default-workspace/diff-viz
git log --oneline -8 && git status
npm test                 # 91 个测试
sed -n '1,60p' CHANGELOG.md
cat docs/cli-reference.md
```

然后直接说要做第 9 节里的哪一条，或提新需求。改动前端后记得 `npm run build` 并提交 `dist/`。
