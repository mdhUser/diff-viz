# diff-viz

[![CI](https://github.com/mdhUser/diff-viz/actions/workflows/ci.yml/badge.svg)](https://github.com/mdhUser/diff-viz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/mdhUser/diff-viz/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/diff-viz-cli.svg)](https://www.npmjs.com/package/diff-viz-cli)
[更新日志](https://github.com/mdhUser/diff-viz/blob/main/CHANGELOG.md)

**改完代码，先看清「这次改动会影响谁」，再开始 Review。**

diff-viz 把一次 Git 改动展开成一张可交互的依赖拓扑图：改了哪些文件、沿 import 链还会波及哪些**没动过**的文件、按什么顺序看、哪些点必须人工确认。点开任意文件就是摘要、影响分析、代码 Diff 和待办清单。

![diff-viz 拓扑总览](https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/overview.png)

## 快速开始

要求：Node.js >= 20，在**任意 Git 仓库根目录**执行：

```bash
npx diff-viz-cli
```

也可以全局安装一次，之后在任意仓库直接用 `diff-viz`：

```bash
npm install -g diff-viz-cli
diff-viz
```

它做三件事：

1. 分析当前改动 —— 工作区有改动就看工作区（暂存 + 未暂存 + 未跟踪），干净则看最近一次提交；
2. 写数据文件 —— `.diff-review-data.json` + `.diff-review-data.json.nodes/`，自动加入 `.git/info/exclude`，`git status` 保持干净；
3. 启动/复用本地 hub 并打开浏览器 —— CLI 随即退出，hub 留在后台供后续复用。

常用变体：

```bash
diff-viz --staged                  # 只看暂存区
diff-viz --last                    # 最近一次提交
diff-viz --range main..HEAD        # 提交范围
diff-viz --base main               # 与目标分支 merge-base 比较
diff-viz --no-open                 # 不自动开浏览器，只打印 URL
diff-viz stop                      # 停止后台 hub
```

端口默认 `5173`，被占用会自动递增，实际 URL 以终端输出为准。

### 30 秒看懂界面

| 区域 | 内容 |
| --- | --- |
| 左栏 | 整体摘要、变更文件 / 受影响文件列表、Review 进度；点文件切换 |
| 中间 | 拓扑图。紫色虚线 = 影响（改了 A 牵动 B），蓝色实线 = 依赖（A imports B），灰色节点 = 没改但受影响 |
| 右侧 | 「摘要与影响」「代码 Diff」「待确认」三段；Diff 支持单栏/双栏、完整文件、语法高亮 |
| 顶部 | 仓库切换、版本链（默认当前分支）、历史 commit 的 Review、刷新 |

快捷键：`←` / `→` 切换文件，`Esc` 关闭详情。改完代码保存后 hub 自动重算，页面通过 SSE 刷新，不用重跑命令。

## 它解决什么问题

- **这次改动会影响谁？** 普通 `git diff` 只列改过的文件，diff-viz 沿 import 链算出所有下游受影响文件，并给出「A → B → C」传播链路。
- **该按什么顺序 Review？** 按依赖关系生成 `reviewOrder`，逐个文件标记「已 Review / 待确认 / 忽略」，进度可持久化。
- **Agent 改完，哪些必须人确认？** Agent 可以把自己的总结、影响分析、风险点写成注解，直接展示在页面上；新增行里的 TODO/FIXME 也会自动扫出来。

## 常用操作

| 我想…… | 命令 / 操作 |
| --- | --- |
| Review 工作区改动 | `diff-viz` |
| Review 某次提交 / 某个范围 | `diff-viz --last` / `--range A..B` / `--base main` |
| 在界面里切换仓库、看历史提交 | 点顶部仓库名 → 左侧选仓库 → 右侧「版本链条」点提交 |
| 叠加 Agent / 人工总结 | `diff-viz annotate --data .diff-review-data.json --annotations ann.json` |
| 给已打开的任意 Review 补注解 | `diff-viz annotate --review <id> --annotations ann.json`（id 在页面 URL 的 `?review=` 后） |
| 只拿机器可读结果 | `diff-viz --json-only --quiet` |
| 重新打开已有数据 | `diff-viz serve --data .diff-review-data.json` |
| 多仓库一起分析 | `diff-viz workspace --init` → 编辑 `diff-viz.workspace.json` → `diff-viz workspace` |

完整命令与参数见 **[docs/cli-reference.md](https://github.com/mdhUser/diff-viz/blob/main/docs/cli-reference.md)**。

## 多仓库 / 微服务

一次改动横跨几个服务时，单仓视图看不到服务之间的牵连：

```bash
diff-viz workspace --init    # 在仓库父目录生成模板，自动收录同级 git 仓库
diff-viz workspace           # 分析并打开服务级拓扑
```

diff-viz 会从 `package.json` / `pom.xml` / `go.mod` / `build.gradle(.kts)` / `*.csproj` / `composer.json` 自动识别包依赖，静态解析不可靠的 RPC / HTTP 调用可在 `diff-viz.workspace.json` 的 `links` 里声明；某个服务有改动时，依赖它的服务会标记为「受影响」并给出层级。点服务卡片可进入该仓库原来的文件级拓扑。

配置格式和比较范围（`worktree` / `staged` / `last` / `range` / `base` / `commit`，支持 per-repo 覆盖）见 **[docs/cli-reference.md](https://github.com/mdhUser/diff-viz/blob/main/docs/cli-reference.md)**。

## 让 AI Agent 接进来

diff-viz 自带 Agent Skill，已适配 DSH / Claude Code / Cursor 等：

```bash
diff-viz skill install --agent dsh      # 或 claude / cursor
```

标准流程：Agent 改完代码 → 读 `git diff` 写注解文件（`meta.overallSummary` + 每个文件的 `summary` / `impactAnalysis` / `todos`）→ `diff-viz --annotations .diff-review-annotations.json` → 把 URL 和摘要给用户。不想重启服务时用 `annotate` 追加；注解会按「项目 + 文件 + 改动内容」跨 Review 复用，提交后从版本链进入也不会丢。

- 详细用法：[SKILL.md](https://github.com/mdhUser/diff-viz/blob/main/SKILL.md)
- 其他 Agent（Codex / 自定义）接入：[docs/agent-integrations.md](https://github.com/mdhUser/diff-viz/blob/main/docs/agent-integrations.md)

## 数据与隐私

- 数据文件包含完整源码，**不要提交到 Git 或分享**；生成后会自动写入 `.git/info/exclude`。
- hub 状态目录默认 `~/.diff-viz/`（不可写时自动落到系统临时目录，可用 `DIFF_VIZ_HOME` 指定）：Review 快照目录 `0700`、文件 `0600`，按数量自动清理。
- 服务只监听 `127.0.0.1`，不上传任何代码，也不需要账号。

数据结构、HTTP API 与完整字段说明见 **[docs/data-contract.md](https://github.com/mdhUser/diff-viz/blob/main/docs/data-contract.md)**。

## 已知限制

- 依赖解析是静态近似（正则/解析器，不跑 AST，也不处理运行时动态路径）：Java 同包引用可能把注释里的同名类算成依赖，可在界面「忽略」；tsconfig 只读仓库根目录，不处理 `extends` 和 monorepo 子包。
- 超过 15,000 个代码文件只扫描前 15,000 个，并在 `meta.warnings` 中提示。
- 自动刷新只对 hub 本进程分析过的仓库生效；hub 重启后需再跑一次 `diff-viz`。Linux 上 Node 的递归 `fs.watch` 不可用，会退化为不监听。
- 它是**只读的 Review 工具**：不做暂存、提交、分支、合并、推送等 Git 操作；这些仍交给 SourceTree / 命令行 / 你的 IDE。

## 版本与兼容

当前版本 **1.0.0**：从 1.0.0 起冻结对外契约（CLI 参数、数据格式 v2、hub HTTP API、Agent 注解 JSON），1.x 内不做破坏性改动，破坏性变更进入 2.0.0。旧版单文件数据仍可读取并自动升级。

版本历史见 [CHANGELOG.md](https://github.com/mdhUser/diff-viz/blob/main/CHANGELOG.md)。

## 更多文档

| 文档 | 内容 |
| --- | --- |
| [docs/cli-reference.md](https://github.com/mdhUser/diff-viz/blob/main/docs/cli-reference.md) | 全部命令、参数、环境变量、workspace 配置 |
| [docs/data-contract.md](https://github.com/mdhUser/diff-viz/blob/main/docs/data-contract.md) | 数据文件格式、字段语义、HTTP API、注解格式 |
| [docs/languages.md](https://github.com/mdhUser/diff-viz/blob/main/docs/languages.md) | 支持的语言、自定义语言、影响分析模型 |
| [docs/agent-integrations.md](https://github.com/mdhUser/diff-viz/blob/main/docs/agent-integrations.md) | Claude Code / Cursor / Codex 等 Agent 接入方式 |
| [docs/development.md](https://github.com/mdhUser/diff-viz/blob/main/docs/development.md) | 本地开发、测试、目录结构、发布流程 |

## 打赏作者

如果这个工具帮你节省了时间，欢迎微信扫码打赏，感谢支持。

<img src="https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/reward-wechat.jpg" alt="微信赞赏码" width="280" />

## License

MIT
