# Changelog

本项目的重要变更记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

发布新版本前，必须为本版本补充 `Added` / `Changed` / `Fixed` 等条目，并让
`npm run release:check` 通过。

## [Unreleased]

## [1.5.3] - 2026-11-23

### Fixed

- 文件监听触发的自动重算不再把 PR/MR Review 当成项目「记住的范围」重放：此前如果先打开过工作区 Review（启动了 watcher），再打开 PR/MR 后保存文件，watcher 会用 pull 的 range 重建该 Review，导致评论全部丢失（用模拟 fs.watch 事件复现，新增回归测试）。
- `--pr/--mr` 传完整 URL 时校验仓库归属：粘贴其他仓库的 PR/MR 链接会直接报错，而不是默默分析当前仓库同编号的 PR/MR。
- `--base origin/main` / `--base refs/heads/main` 现在会归一成 `main` 再 fetch 目标分支，不再因 refspec 拼接错误 fetch 失败。
- `gh` / `glab` token 缓存增加 5 分钟有效期，并在 401/403 后立即失效重取：登录新账号或 token 过期后不需要重启 hub。

## [1.5.2] - 2026-11-23

## [1.5.2] - 2026-11-23

### Fixed

- 修复「有评论」筛选把拓扑图清空的问题：该开关之前被持久化到 localStorage，在某个 MR 里打开后，切到只有整体讨论、没有文件级评论的 Review 时会把所有文件过滤掉，页面只剩工具栏和空白画布。现在筛选是临时的（不跨 Review 记忆），只统计文件级评论，没有文件评论时按钮不出现；即使筛选为空也显示「显示全部文件」的恢复提示。
- 同时在全局评论面板提示「评论都在整体讨论、未挂在文件上」，避免误以为文件节点漏渲染。

## [1.5.1] - 2026-11-23

## [1.5.1] - 2026-11-23

### Fixed

- 评论展示精确到文件：之前每个文件的「Reviewer 评论」抽屉都会把整条 MR 的整体讨论一起列出来，重复且干扰阅读。现在文件抽屉只显示该文件的评论；整体讨论收进全局「Reviewer 评论」面板（顶部「评论 N」、侧栏「N 评论」或抽屉里的「查看 MR 全部讨论」打开），按文件分组、支持只看未解决并跳转到对应文件。

## [1.5.0] - 2026-11-23

## [1.5.0] - 2026-11-23

### Added

- **PR/MR Reviewer 评论入图**：打开 GitHub PR / GitLab MR 时同步行内 review comments 与整体讨论（GitHub `pulls/<n>/comments` + `issues/<n>/comments`；GitLab `merge_requests/<iid>/notes`，跳过 system note，保留 resolved/行号）。
- 文件节点与左侧文件列表显示评论数徽章，未解决评论高亮为琥珀色；顶部与侧栏汇总评论总数。
- 详情抽屉新增「Reviewer 评论」Tab：作者、时间、行号、已解决/未解决、代码已变更标记、远端链接与正文；PR 整体讨论一并展示。
- 工具栏「有评论 N」开关：只看有 Reviewer 评论的文件（自动隐藏配置/数据库节点）。
- 评论随 Review 清单保存（`comments` + 节点 `reviewComments/reviewCommentUnresolved` + `meta.pull.commentCount`），读取失败只写 `meta.warnings`，不影响 Review 生成；新增 `test/comments.test.mjs` 与 CLI/hub 集成断言。

## [1.4.1] - 2026-11-23

## [1.4.1] - 2026-11-23

### Added

- 远端 PR/MR 鉴权会自动复用已登录的 `gh` / `glab` CLI token（`gh auth token`、`glab auth status --show-token`），私有仓库通常无需再手动配置环境变量；需要禁用时设置 `DIFF_VIZ_DISABLE_CLI_TOKEN=1`。token 仅在 hub 进程内存中使用。

### Fixed

- 修正 `glab` 把登录状态输出到 stderr 导致 token 读取失败的问题（`--show-token` 的输出现在会被正确解析）。

## [1.4.0] - 2026-11-23

### Added

- **远端 PR / MR 接入**：hub「已注册仓库」窗口新增 **PR / MR** 标签，直接列出当前仓库远端的 GitHub Pull Request / GitLab Merge Request；点击任意一条即自动 fetch `refs/pull/<n>/head`（GitLab 为 `refs/merge-requests/<iid>/head`）和目标分支，按 `merge-base` 生成 diff 拓扑图。顶部显示 `PR #N · 标题` 与远端链接。
- 平台自动识别：解析 `origin` 的 ssh/https 地址，支持 GitHub、GitLab 与自建实例；`GITHUB_TOKEN` / `GITLAB_TOKEN` 仅由 hub 进程读取，自建域名可用 `DIFF_VIZ_PROVIDER` / `DIFF_VIZ_GITHUB_HOSTS` / `DIFF_VIZ_GITLAB_HOSTS` / `DIFF_VIZ_*_API_URL` 配置。
- 同一 PR/MR 复用稳定 Review id（`<projectId>-pull-<number>`），已有 Agent 摘要/待办/审查状态可复用；`meta.pull` 记录 provider、编号、标题、作者、来源/目标分支与远端 URL。
- CLI 新增 `--pr <编号|URL>` / `--mr <编号|URL>`，`--base` 可覆盖目标分支；新增 `GET /api/pulls?project=`（60 秒缓存、`refresh=1` 强制刷新）与 `POST /api/review {pull}`。
- 新增 `test/remotes.test.mjs` / `test/pull-request.test.mjs`，覆盖平台识别、API 映射与鉴权、ref 拉取、CLI/hub 端到端与稳定 Review id；新增 [docs/pull-requests.md](https://github.com/mdhUser/diff-viz/blob/main/docs/pull-requests.md)。

### Changed

- 文档：更新 [docs/roadmap.md](https://github.com/mdhUser/diff-viz/blob/main/docs/roadmap.md)，把远端 PR/MR 接入记为 v1.4.0 已完成，后续提议顺延为 v1.5；README / CLI 参考 / 数据契约同步补充。

### Fixed

- 补齐文档承诺的单条 SQL 4KB 截断：之前只实现了「最多 300 张表 / 每表 200 条」两个上限，超长语句会原样写进 `<review>/tables/`。现在超过 4096 字符的语句截断展示（`statementCount` 仍是真实条数），每表条数超限和语句截断都会写入 `meta.warnings`。

## [1.3.0] - 2026-11-20

### Added

- **数据库表与 SQL 视图**：静态解析 MyBatis Mapper XML、Java `@Select/@Insert/@Update/@Delete` 注解和 `.sql` 文件，按表聚合成数据库组件与表节点，生成 `reads_table` / `writes_table` 边；从 `spring.datasource` / `jdbc:` 推断引擎（MySQL/PostgreSQL/Oracle/SQL Server/H2/SQLite）。
- 表卡片显示读取/写入徽章与 SQL 条数；泳道视图新增数据库泳道（`MySQL · N 张表`）；悬停显示前 3 条 SQL（来源文件:行号、动态 SQL 标记），点击打开「数据表」抽屉查看全部语句并可跳到来源文件 Diff；工具栏「数据表 N」开关。
- SQL 文本按表懒加载到 `<review>/tables/<payload>.json`（`storage.tablesDir`），`/api/data` 只含元数据；新增 `GET /api/table?review=&table=`。上限 300 张表 / 每表 200 条 / 单条 4KB，超出写入 `meta.warnings`。
- 数据契约：顶层 `tables` / `components`，`meta.db`、`meta.stats.tables`、边关系 `reads_table` / `writes_table`；文档 [docs/database.md](https://github.com/mdhUser/diff-viz/blob/main/docs/database.md)。
- 新增 `test/db.test.mjs` / `test/tables.test.mjs`，覆盖 SQL 分组、懒加载存储、复制与 `/api/table`。

### Fixed

- 重新分析（文件监听、裸 hub 页面刷新）会保留 `--max-scan-files` 上限，不再悄悄恢复默认 15000；侧栏不再重复页面顶部的扫描截断警告，横幅改成一整行可换行排版。
- `ensureHub` 启动的后台 hub 不再额外打开一个裸 hub 页签：那个页签会 `POST /api/review` 用默认参数重算、覆盖刚导入的 Review，也让 `--no-open` 失效；最终 Review 链接仍由 CLI 打开。

## [1.2.0] - 2026-11-20

### Added

- **配置/资源节点入图**：扫描 `.xml` / `.properties` / `.yml` / `.yaml` / `.sql`（最多 2000 个文件、单文件 512KB，变更过的配置始终解析）。MyBatis Mapper 的 `namespace` 绑定到 Java Mapper 接口（`binds`），Spring XML 的 `<bean class>` / `<import resource>` 生成 `class-ref` / `config` 边；改动 Mapper XML 会让接口与调用方进入「受影响」，影响链继续沿代码依赖传播。
- 数据契约增量字段：节点 `kind: "config"` / `resourceKind`，`meta.stats.configFiles`、`meta.resourceStats`，边新增 `binds` / `config` / `class-ref`；XML / Properties 支持语法标签与 Diff 高亮。
- UI：配置节点专属图标与青色「配置」徽章、工具栏「配置 N」开关、图例与抽屉「配置关联」区块；配置变更使用专属自动摘要（说明被多少文件引用）。
- 扫描缓存 schema 升到 v2，配置解析同样按 `mtime + size` 复用缓存。
- 新增 [docs/resources.md](https://github.com/mdhUser/diff-viz/blob/main/docs/resources.md) 说明配置入图模型与边界。

### Fixed

- `languageOf` 增加 `xml` / `properties`，配置节点不再显示为纯文本；未识别的 XML 只展示节点、不产生猜测边。

## [1.1.1] - 2026-11-20

### Fixed

- Windows CI：删除模块测试里硬编码 `/tmp` 的空壳用例，避免 Windows 上 `mkdtemp` 失败；其余模块/泳道用例不变。

## [1.1.0] - 2026-11-20

### Added

- **泳道视图**：拓扑图可在「流向 / 泳道」之间切换。泳道按模块（Maven/Gradle/npm/go.mod/pyproject 构建标记识别，可切目录/包粒度）分组，按依赖深度从上到下排列（入口层在前、数据层在后），泳道头显示模块路径与变更/受影响数量；节点卡片显示 module 与 Java package。最多 12 条泳道，超出部分合并为「其他模块」；旧 Review 没有模块字段时按一级目录回退推断。
- hub 访问控制：校验 `Host` 白名单挡住 DNS rebinding，`/api/*`（除 health）要求访问令牌；CLI 打印的链接带 `?token=`，页面随后换成 HttpOnly Cookie。令牌存 `~/.diff-viz/token`（0600），重启后复用；支持 `DIFF_VIZ_TOKEN` / `DIFF_VIZ_NO_AUTH` / `DIFF_VIZ_ALLOWED_HOSTS`。
- `--max-scan-files <n>`：可调依赖扫描上限（默认 15000）。

### Fixed

- 大仓库依赖扫描被 15000 文件上限截断时不再静默降级：页面顶部显示「共 N 个文件，只分析了前 n 个」的警告，并提示用 `--max-scan-files` 调高上限。

### Changed

- 直接用 `curl` 等脚本调 hub `/api/*` 需要加 `X-Diff-Viz-Token` 头（或 `?token=` 参数）；CLI 与页面会自动带上，Agent 用 `diff-viz` 打印的链接访问不受影响。`DIFF_VIZ_TOKEN` 可固定令牌，`DIFF_VIZ_NO_AUTH=1` 可关闭鉴权，`DIFF_VIZ_ALLOWED_HOSTS` 可追加允许的 Host。

## [1.0.2] - 2026-11-20

### Fixed

- hub 重启后端口变化导致之前的 Review URL 直接「拒绝连接」：`ensureHub` 现在会复用注册表里记住的端口（除非显式传 `--port`），`diff-viz` / `serve` / `workspace` / 前台 `hub` 都遵循这个规则，Agent 之前打印的链接不会因为一次重启失效。

## [1.0.1] - 2026-11-20

### Fixed

- Cursor / DSH 等 Agent、IDE 内置浏览器打开 Review 一直转圈：页面会保持一条 `/api/events` SSE 长连接，而这类浏览器工具通常要等 `networkidle` 才认为加载完成，于是永远等不到。现在检测到自动化浏览器（`navigator.webdriver`）或在 iframe 内嵌时会自动跳过 SSE（刷新按钮仍可手动拉取最新数据），也支持 URL 参数 `?sse=0` / `?sse=1` 显式关闭/开启。
- 文档补充：如果 Agent 的浏览器运行在远程 / 容器环境，`127.0.0.1` 指向的是那个环境而不是你的电脑，需要端口转发，或直接在该环境里运行 `diff-viz`。

## [1.0.0] - 2026-11-19

**1.0 = 对外契约冻结。** 此前 0.x 的 minor 版本（0.7 / 0.8 / 0.9 / 0.10）按 semver 规则逐个递增；从 1.0.0 起，下列接口视为稳定，1.x 内不做破坏性改动，破坏性变更进入 2.0.0。

### Changed

- **CLI 契约**：`review` / `serve` / `annotate` / `hub` / `stop` / `workspace` / `skill install` 命令与现有参数保持兼容；新增参数不算破坏性变更。
- **数据契约**：`.diff-review-data.json`（`storage.format: 2` 清单）+ `<data>.nodes/` 节点内容，字段见 README「数据契约」；新增字段保持向后兼容。
- **hub HTTP API**：`/api/health`、`/api/hub`、`/api/projects`、`/api/commits`、`/api/review`、`/api/import`、`/api/data`（含 `?full=1`）、`/api/node`、`/api/state`、`/api/annotate`、`/api/events`、`/api/workspace`。
- **Agent 注解契约**：`{ meta: { overallSummary }, nodes: { "<path>": { summary, impactAnalysis, todos } } }`。
- 兼容旧版本：v1 单文件 Review 仍可读取并在第一次写回时自动升级为拆分格式；旧版 hub 进程仍在运行时，CLI 的 `review` / `serve` 会自动回退到整份导入，`annotate` 会提示重启 hub。
- 汇总 0.7–0.10 的能力：多语言依赖解析（含自定义语言）、解析/状态缓存、watch + SSE 自动刷新、影响链路、多仓库工作区拓扑、拆分存储与节点内容按需加载、历史 Review 批量读取（2,900 文件仓库单 commit 57–69 s → ~1 s）、任意 Review 可写 Agent 注解并按「项目 + 文件 + 归一化 diff」跨 Review 复用（含整体概览）。

## [0.10.1] - 2026-11-19

### Fixed

- 整体概览（`meta.overallSummary`）原来只在改动集合完全一致时复用：同一分支提交后换一条 commit Review，只要文件多一个或少一个，页面就退回自动生成的一句话（文件级 Agent 摘要却能复用）。现在按每个变更文件的「路径 + 归一化 diff」计算重合度，当前 Review 与某条已注解概览的改动重合 ≥50%（且至少 3 个文件、覆盖该概览 ≥50%）时也复用整体概览；改动完全不同的 Review 仍不会套用旧概览。

## [0.10.0] - 2026-11-19

### Added

- `diff-viz annotate --review <id> --annotations <file>`：直接给 hub 里已有的 Review 写 Agent 注解，不需要重新分析或生成数据文件。适用于界面版本链里点开的 commit Review——之前这类 Review 只能显示自动生成摘要，现在可以让 Agent 补上总结/影响/待办后刷新页面即可看到。
- 侧栏「变更概览」始终显示 **Agent 摘要 N/M** 覆盖度：为 0 时用弱化样式提示还没有 Agent 注解，不再是「看起来全是自动生成」却不知道去哪补。

### Fixed

- Agent 注解在提交 / 切换 Review 后丢失：注解原来只存在写入时的那条 Review 快照里，提交后版本链里的 commit Review 是新的 reviewId（且 worktree Review 可能被自动重算成空改动），所以总结全部消失。现在 hub 会按「项目 + 文件路径 + 改动内容（去掉 index 行后的 diff）」记住最后一次 Agent 总结/影响分析/待办，存放在 `~/.diff-viz/annotations/<projectId>.json`；打开或重新生成相同改动的 Review（worktree → commit → range）时自动复用，并对旧的已注解快照做一次回填。**Review 顶部的整体概览（`meta.overallSummary`）也会按「变更文件集合 + 各自 diff」记住并复用**，重新生成 Review 不会再退回自动生成的一句话。内容不同的改动不会复用旧总结。

## [0.9.2] - 2026-11-18

### Fixed

- 单仓视图的 `meta.overallSummary` 被 `line-clamp-5` 硬截断（242 字的摘要只显示约 180 字）且没有展开入口，看起来像「Agent 总结没渲染」。现在超过 120 字显示「展开完整摘要 / 收起摘要」。
- 侧栏新增 `Agent 摘要 N/M` 徽章，直接告诉用户有多少文件带了 Agent 写的 summary（不带时只有启发式摘要，看起来像没有信息）。

## [0.9.1] - 2026-11-18

### Fixed

- 工作区页面没有渲染 `meta.overallSummary`：关键的跨服务总结只有 JSON 里有、页面上看不到。现在顶部新增「跨服务摘要」区块（默认展开，可收起），单仓视图仍显示在左侧「变更概览」。

## [0.9.0] - 2026-11-18

### Added

- 工作区支持按仓库指定比较范围：`repos[].scope` 可以是 `worktree` / `staged` / `last` / `range` / `base` / `commit`，工作区顶层的 `scope` 作为缺省值。跨仓库对比同一目标分支时不再需要手工生成每个仓库的 range review。
- 服务卡片显示该仓库实际使用的比较范围（`scopeMode` / `scopeLabel`），只能看到「5 个仓都有改动」却不知道拿什么在比的困惑没有了。

### Fixed

- 工作区提示条分不清「说明」和「错误」：新增 `meta.notes`（中性色），`meta.warnings` 改为琥珀色告警样式，不再用红色冒充报错。
- 版本链条原来默认执行 `git log --all`，把同事的远程分支也混进来，看起来像「不是当前分支的历史」；现在默认只加载当前分支，仓库面板可切换「全部分支」，并会同步刷新项目列表里的分支名。
- 历史 Review（commit / range）分析原来对每个源文件各跑一次 `git show`：2945 个代码文件的仓库点一个提交要等 57–69 s，期间 hub 的单线程被占满，页面一直卡在「正在生成 Review…」。改为 `git cat-file --batch` 分块批量读取，变更文件的新旧内容也批量读取；同一仓库单次 commit Review 降到约 1–2.5 s（`meta.durationMs` 实测 938 ms / 2155 ms）。
- 补上 `test/git.test.mjs` 缺失的 `GitRepo` / `scanRepository` 导入（批量 blob 读取的两个测试此前直接 `ReferenceError`）。

## [0.8.1] - 2026-11-18

### Fixed

- Windows 上 hub 按 `dataPath` 导入 Review 时，`fs.realpathSync` 返回 8.3 短路径（`RUNNER~1`）而目标路径是长路径，导致「数据在仓库内」判定失败、回退成整份上传后报格式错误。改用 `realpathSync.native` 统一两侧路径形式。
- 工作区模板测试改用 `os.tmpdir()`，不再假设 POSIX 的 `/tmp`。

> 0.8.0 的 Windows CI 因此为红色；0.8.1 是同一批改动的补丁版本。

## [0.8.0] - 2026-11-18

### Added

- 多仓库工作区：`diff-viz workspace` 读取 `diff-viz.workspace.json`，一次分析多个仓库并生成服务级改动拓扑；`workspace --init` 扫描同级仓库生成模板，`--workspace <file>` 指定其他文件。
- 服务间依赖识别：自动读取 `package.json` / `pom.xml` / `go.mod` / `build.gradle(.kts)` / `*.csproj` / `composer.json`，把依赖坐标与兄弟仓库的产物坐标对上；静态解析不可靠的 RPC / HTTP 调用通过 `links` 声明补边。
- 跨服务影响传播：仓库改动后，依赖它的仓库标记为「受影响」并给出层级，服务级图上按依赖方向高亮；点击服务卡片进入该仓库原有的文件级拓扑。

### Changed

- **Review 存储改为拆分格式（解决大文件问题）**：`.diff-review-data.json` 只保留 `meta` / `edges` / 节点元数据，`diff`、`oldContent`、`newContent` 拆到同级 `<data>.nodes/` 目录（`storage.format: 2`）；hub 快照同样改为 `<reviewId>/manifest.json` + `nodes/`。`annotate` 只重写清单，`--node` 时不再读取或改写任何节点内容文件。84 MB / 120 节点的 Review 实测：`annotate --node` 从 2.9 s、峰值内存 670 MB 降到 0.06 s、60 MB（暖缓存对比 0.43 s / 545 MB）；无 `--node` 时同样只写清单。
- 浏览器按需加载节点内容：`/api/data` 只返回清单，打开详情抽屉时才请求 `GET /api/node?review=<id>&id=<path>`；同 Review 内切换文件不会重复下载整份数据。需要完整数据的老脚本可用 `/api/data?review=<id>&full=1`。
- hub 的 `POST /api/state`（勾选 TODO / 标记 Review / 忽略）只改清单，不再整份读写 Review；`annotate` 同步 hub 改用新增的 `POST /api/annotate`，只上传注解。
- CLI → hub 的导入支持 `dataPath`：数据文件在仓库内时由 hub 直接复制节点文件，不再把整份 Review 序列化进 HTTP body（跨仓库/外部路径仍回退为完整上传）。

### Fixed

- 旧的单文件 Review（`.diff-review-data.json` 或 `~/.diff-viz/reviews/<id>.json`）仍可读取；第一次写回时自动升级为拆分格式，hub 也能继续加载旧快照。
- 升级时如果旧版本的 hub 进程还在跑：`review` / `serve` 会自动回退到整份上传而不是报错；`annotate` 会提示重启 hub 后再看注解（不会为了同步重新读写整份大文件）。
- `<data>.nodes/` 目录不再被 `git status` 当成未跟踪文件：数据文件写入时同时把节点目录加入 `.git/info/exclude`，未跟踪文件扫描也会跳过该目录。

## [0.7.1] - 2026-11-18

### Fixed

- Windows 上 `diff-viz skill install` 默认改为复制 `SKILL.md`：Windows 创建符号链接需要开发者模式，之前会静默回退，现在直接按复制处理，`--dry-run` 也如实报告。
- 测试脚本改用 `node --test` 自动发现用例，不再依赖 shell 展开 `test/*.test.mjs`（Windows 的 cmd 不展开通配符，CI 上直接跑不起来）。

### Changed

- CI 矩阵扩展到 `ubuntu-latest` / `macos-latest` / `windows-latest`，并在 ubuntu 上补跑 Node 24。
- 修掉三处平台假设：Windows 的 8.3 短路径、symlink 断言、CRLF 换行。

## [0.7.0] - 2026-11-18

### Added

- Rust / Kotlin / C# / Ruby 依赖解析：`mod` 与 `use crate::…` 映射到 `.rs` / `mod.rs`，`import` 与 `using` 按声明的包名或命名空间 + 文件名索引，`require_relative` 按相对路径解析。
- `.diff-viz/languages.json`（或 `--languages <file>`）：用声明式 JSON 注册自定义语言，支持 `package` / `relative` 两种解析策略和 `ignorePrefixes` 过滤标准库。
- 依赖解析改为按语言注册表分发，加语言不需要再动扫描器。

### Changed

- 语言配置写错或文件不存在时直接报错，不再静默退化成「没有依赖边」。

## [0.6.1] - 2026-11-17

### Added

- `diff-viz skill install`：把薄 `SKILL.md` 注册到 DSH / Claude Code / Cursor / 共享 agents 技能目录，支持 `--agent`、`--scope user|project`、`--dir`、`--copy`、`--force`、`--dry-run`。
- 安装后 skill 目录里只需要 `SKILL.md`，不再需要复制 `bin/src/dist`。

### Changed

- `SKILL.md` 的命令改为使用已安装的 `diff-viz`（不在 PATH 时用 `npx -y diff-viz-cli`），源码/离线模式才回退到 `$SKILL_DIR/bin/diff-viz.mjs`。
- `npm run package:skill` 默认生成只含 `SKILL.md` 的薄包；离线自包含包改用 `npm run package:skill:standalone`。

## [0.6.0] - 2026-11-17

### Added

- hub 监听已分析仓库的文件变化，700 ms 防抖后自动重算，并通过 SSE（`/api/events`）通知页面刷新；`DIFF_VIZ_NO_WATCH=1` 可关闭。commit / range 类历史 Review 不参与自动重算。
- 文件级解析缓存：以 `mtime + size` 为 key，只重新解析变化的文件。1200 文件实测冷扫 107 ms、热扫 24 ms；缓存位于 `~/.diff-viz/cache/`，`DIFF_VIZ_NO_CACHE=1` 可关闭。
- 受影响文件记录 `impactChain`，详情抽屉展示「A → B → C → D」的传播链路。
- 节点级「忽略」：把与本次改动无关的文件标灰，状态写回 Review 并同步 hub。
- `annotate --node <path>`：只把注解应用到指定节点。

### Changed

- 首次发布到 npm（包名 `diff-viz-cli`，命令仍是 `diff-viz`）：`npx diff-viz-cli` 或 `npm install -g diff-viz-cli` 即可安装使用，不再需要 clone 仓库。`npm publish` 前会自动执行 release check、类型检查、测试和构建。
- 影响分析默认深度从 2 提升到 3（`--impact-depth` 仍可调到 6）。
- 状态目录按数量做 LRU 清理（默认保留最近 50 份，`DIFF_VIZ_KEEP_REVIEWS` 可调），并始终保留各仓库的 `lastReviewId`。
- `~/.diff-viz` 目录收紧为 0700、Review 文件为 0600，启动时顺带修正历史文件权限。

## [0.5.0] - 2026-11-17

### Added

- 仓库面板可直接按路径添加本地仓库（`POST /api/projects`），自动解析到 Git 仓库根目录，并校验路径存在、且确实是 Git 仓库。
- 仓库面板支持移除仓库（`DELETE /api/projects?id=`），只影响列表，不删除已有 Review 数据。

### Changed

- 数据文件 `.diff-review-data.json` 首次写入时自动加入 `.git/info/exclude`，不再出现在用户的 `git status` 里，也避免完整源码被误提交。不改动用户的 `.gitignore`。

## [0.4.0] - 2026-11-16

### Added

- 版本链条（commit graph）：在仓库面板中按父子关系绘制提交 DAG。
- 分支、tag、`HEAD` 引用徽章；merge commit 的车道分叉/汇合可视化。
- 最多加载 80 个提交（`git log --all --date-order`），点击任意提交查看历史 Diff。
- 历史 Review 按提交时的 Git tree 扫描依赖，而不是用当前工作区代替。
- `GET /api/commits` 返回 `parents`、`refs` 字段。

### Changed

- 包名调整为 `diff-viz-cli`，命令仍是 `diff-viz`，为 `npx diff-viz-cli` 直接运行做好准备。
- 安装包只保留 `bin` / `src` / `dist` 与文档，不再包含 `docs/`、`scripts/`，体积从 4.6 MB 降到约 330 kB。

## [0.3.0] - 2026-11-16

### Added

- 单 hub 常驻进程：一个端口服务多个项目、多次分析。
- CLI 变为 hub 客户端：注册 Review 后立即退出，不再为每次分析启动常驻进程。
- 仓库切换面板；从已注册仓库中选择当前工作区。
- 历史提交 Review：最近提交列表、按 commit 生成 Diff 和依赖拓扑。
- `diff-viz hub` / `diff-viz stop` 命令。
- hub 状态目录不可写时自动回退到系统临时目录；支持 `DIFF_VIZ_HOME`。
- hub 状态写回与 `annotate` 同步。

### Changed

- `serve` 改为把已有数据注册到 hub，不再单独占用端口。
- 勾选状态写回 hub 的 Review 缓存，并以 review 维度隔离 `localStorage`。

## [0.2.0] - 2026-11-16

### Added

- Java 依赖解析：普通 import、`import static`、包通配符 import。
- Java 同包类引用（无 import）识别。
- `package` + 文件名构建 FQCN 索引，适配 Maven / Gradle / 多模块目录。
- 内部类回退（`Outer.Inner` → `Outer.java`）。
- Java Diff 语法高亮。

### Fixed

- CI 缺少 `devDependencies` 导致 `tsc` 不可用的问题。

## [0.1.0] - 2026-11-16

### Added

- 零运行时依赖的 Node CLI：工作区、暂存区、最近提交、commit range、base 对比。
- JS/TS（tsconfig `baseUrl` / `paths`）、Python、Go 依赖解析与影响分析。
- React Flow + dagre 变更拓扑、状态颜色、影响/依赖方向切换。
- 详情抽屉：摘要与影响、Unified/双栏 Diff、TODO/FIXME 扫描与勾选。
- Agent 注解合并、`SKILL.md`、本地 HTTP 服务与浏览器自动打开。
- 柔和亮色主题、可拖拽左右面板、MiniMap、键盘 Review 导航。
- 已构建 `dist/`，无需安装前端依赖即可运行。

[Unreleased]: https://github.com/mdhUser/diff-viz/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/mdhUser/diff-viz/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/mdhUser/diff-viz/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/mdhUser/diff-viz/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mdhUser/diff-viz/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mdhUser/diff-viz/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mdhUser/diff-viz/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mdhUser/diff-viz/releases/tag/v0.1.0
