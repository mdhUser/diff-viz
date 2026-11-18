# Changelog

本项目的重要变更记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

发布新版本前，必须为本版本补充 `Added` / `Changed` / `Fixed` 等条目，并让
`npm run release:check` 通过。

## [Unreleased]

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
