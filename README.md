# diff-viz

[![CI](https://github.com/mdhUser/diff-viz/actions/workflows/ci.yml/badge.svg)](https://github.com/mdhUser/diff-viz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/mdhUser/diff-viz/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/diff-viz-cli.svg)](https://www.npmjs.com/package/diff-viz-cli)
[更新日志](https://github.com/mdhUser/diff-viz/blob/main/CHANGELOG.md)

本地运行的代码变更可视化 Review 工具：读取 Git diff，静态解析文件依赖，生成可交互的变更拓扑图，并启动一个常驻本地 hub 查看改动摘要、代码 Diff 与待确认事项。hub 可复用、可切换仓库、可浏览历史提交。

![diff-viz 拓扑总览](https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/overview.png)

## 为什么用它

普通 `git diff` 只能线性地看文件，很难回答这些问题：

- 这次改动会沿 import 链影响哪些**没有改过**的文件？
- 先看哪个文件、后看哪个文件，才是正确的 Review 顺序？
- Agent 改完之后，哪些点必须由人确认？代码里新加的 TODO/FIXME 散落在哪？

`diff-viz` 把这些问题整合成一张「变更 → 影响」的有向图，并提供一个可点击的详情抽屉。

## 功能

- **变更提取**：工作区（暂存 + 未暂存）、暂存区、最近一次提交、commit range、与目标分支对比。
- **依赖拓扑**：静态解析 JS/TS（含 `tsconfig` 的 `baseUrl` / `paths` 别名）、Python、Go、Java、Rust、Kotlin、C#、Ruby 的 import，构建 Nodes / Edges；支持用 `.diff-viz/languages.json` 增加自定义语言。
- **状态区分**：新增（绿）、修改（黄）、删除（红）、受影响但未改动（灰色虚线）。
- **Review 流程**：按依赖顺序给出 reviewOrder，`←` / `→` 逐个文件切换，标记已 Review；与本次改动无关的文件可以「忽略」，在图上弱化显示。
- **影响链路**：每个受影响文件记录 `impactChain`，详情里能看到「A → B → C → D」是怎么传播过来的。
- **版本链条**：提交 DAG、分支/tag/merge 车道，默认只看当前分支，可切换到全部分支；点击历史 commit 查看当时的 Diff 与拓扑。
- **界面体验**：柔和亮色主题、可拖拽左右面板、缩放/小地图、键盘导航。
- **三段式详情**：改动摘要与影响评估、Side-by-Side / Unified 代码 Diff（语法高亮）、待确认 TODO 列表。
- **Agent 注解**：Agent 可把自己的总结、影响分析、风险点写入 JSON；界面直接展示并支持勾选确认。
- **单 hub 复用**：多个仓库、多次分析共用一个常驻进程，不再为每次 Review 启动新端口。
- **实时**：hub 监听文件变化并自动重算，页面通过 SSE 自动刷新，不用手动重跑。
- **多仓库工作区**：`diff-viz workspace` 一次分析多个仓库，按 manifest 自动识别包依赖、按声明补充 RPC 调用，生成服务级改动拓扑并沿依赖方向传播影响。
- **仓库与历史**：界面内按路径添加/移除仓库、切换已注册仓库，通过版本链条浏览最多 80 个提交（默认当前分支，可切换含分支、tag、merge 的全部分支），查看历史 commit 的 Diff + 依赖拓扑。
- **状态持久化**：勾选、已 Review、忽略状态写回 hub 的 Review 缓存，同时备份到 `localStorage`。
- **零运行时依赖**：CLI 只用 Node.js 内置模块；`dist/` 已包含构建好的前端资源。

## 快速开始

要求：Node.js >= 20，Git 仓库。在**任意 Git 仓库根目录**执行：

```bash
# 方式一：不安装，直接运行（npx 会先下载并缓存）
npx diff-viz-cli

# 方式二：全局安装一次，之后在任意仓库直接用 diff-viz
npm install -g diff-viz-cli
diff-viz
```

包名是 `diff-viz-cli`，安装后的命令是 `diff-viz`。也可以用 `pnpm dlx diff-viz-cli` / `bunx diff-viz-cli` 临时运行。

> 第一次运行 `npx` 会提示确认安装，输入 `y` 即可；之后会走本地缓存，启动基本无感知。

默认行为：

1. 当前工作区有改动 → Review 工作区（包含暂存与未暂存、未跟踪的新文件）。
2. 工作区干净 → Review 最近一次提交。
3. 生成 `.diff-review-data.json`（清单：meta / 依赖边 / 节点元数据）和 `.diff-review-data.json.nodes/`（每个节点一份 `diff` 与完整源码）。
4. 确保一个常驻 hub 在 `http://127.0.0.1:5173`（端口被占用会自动递增），把本次结果注册进去并打开浏览器。
5. CLI 随后退出；hub 留在后台，后续分析复用它。

hub 默认把项目列表和 Review 缓存放在 `~/.diff-viz/`；如果该目录不可写（例如 Agent 沙箱），会自动落到系统临时目录。也可以显式指定：

```bash
DIFF_VIZ_HOME=/path/to/state diff-viz
```

## 常用命令

```bash
# hub 管理
diff-viz hub      # 前台启动/查看 hub
diff-viz stop     # 停止后台 hub

# 只看已暂存
diff-viz --staged

# 最近一次提交
diff-viz --last

# 指定 commit 范围（支持 A..B / A...B）
diff-viz --range main..HEAD

# 与目标分支比较（自动取 merge-base）
diff-viz --base main

# 只生成 JSON，不开界面
diff-viz --json-only --quiet

# 重新打开已有的数据文件（注册到 hub，不新起进程）
diff-viz serve --data .diff-review-data.json

# 前台启动/查看 hub，停止 hub
diff-viz hub
diff-viz stop

# 把 Agent / 人工总结合并进已有数据
diff-viz annotate \
  --data .diff-review-data.json \
  --annotations .diff-review-annotations.json

# 直接给 hub 里某条 Review 写注解（例如界面版本链里点开的 commit Review）
diff-viz annotate \
  --review 92131449ad53-commit-db0bee519d3e \
  --annotations .diff-review-annotations.json
```

完整参数：

| 参数 | 说明 |
| --- | --- |
| `--staged` | 仅查看暂存区 |
| `--last` | 最近一次提交 |
| `--range <A..B\|A...B>` | 提交范围 |
| `--base <ref>` | 与目标分支的 merge-base 比较 |
| `--data <file>` | 清单文件路径，默认 `<repo>/.diff-review-data.json`；节点内容写入同级 `<file>.nodes/` |
| `--annotations <file>` | 生成时合并注解 JSON |
| `--node <path>` | 仅用于 `annotate`：只更新指定节点的注解 |
| `--review <id>` | 仅用于 `annotate`：直接写入 hub 里指定 id 的 Review（含历史 commit Review），不需要本地数据文件 |
| `--languages <file>` | 额外语言定义 JSON，默认读取 `<repo>/.diff-viz/languages.json` |
| `--workspace <file>` | 分析多仓库工作区并生成服务级拓扑 |
| `--init` | 配合 `workspace` 命令，扫描同级仓库生成模板 |
| `--summary <text>` | 覆盖整体摘要 |
| `--impact-depth <n>` | 下游影响深度，默认 3（最多 6） |
| `--max-impact <n>` | 最多展示受影响文件数，默认 120 |
| `--no-untracked` | 不纳入未跟踪的新文件 |
| `--json-only` | 只写 JSON，不注册 hub、不启动服务 |
| `--port <n>` | hub 端口，默认 5173（被占用自动递增） |
| `--host <addr>` | 监听地址，默认 127.0.0.1 |
| `--no-open` | 不自动打开浏览器 |
| `--repo <dir>` | 指定仓库目录 |
| `hub` | 前台启动/查看常驻 hub |
| `stop` | 停止后台 hub |
| `--quiet` | 减少日志输出 |

## 多仓库工作区

一次改动横跨几个服务时，单仓视图看不到服务之间的牵连。工作区模式把多个仓库一起分析，并在服务级别画出依赖与影响。

```bash
# 在仓库的父目录生成模板（自动收录同级的 git 仓库）
diff-viz workspace --init

# 分析并打开服务级拓扑（默认读取 ./diff-viz.workspace.json）
diff-viz workspace

# 指定其他 workspace 文件
diff-viz --workspace path/to/diff-viz.workspace.json
```

`diff-viz.workspace.json`：

```json
{
  "name": "订单链路改造",
  "scope": { "mode": "range", "base": "main" },
  "repos": [
    { "id": "order", "path": "../order-service" },
    { "id": "user", "path": "../user-service", "scope": { "mode": "worktree" } },
    { "id": "common", "path": "../common-lib" }
  ],
  "links": [
    { "from": "order", "to": "user", "kind": "rpc", "via": "UserService/GetUser" }
  ]
}
```

- **比较范围**：顶层 `scope` 是所有仓库的缺省值，`repos[].scope` 可以单独覆盖。`mode` 支持 `worktree`（默认）/ `staged` / `last` / `range` / `base` / `commit`，其中 `range` 需要 `range`（或 `base`）、`base` 需要 `base`、`commit` 需要 `commit`。跨仓库对比同一目标分支时，把 `scope` 写成 `{ "mode": "range", "base": "global/feature/xxx" }` 即可，不用逐仓生成 range review。
- **比较范围会显示在服务卡片上**（`scopeMode` / `scopeLabel`），避免「都显示有改动，但不知道拿什么在比」。

- **包依赖自动识别**：读每个仓库的 `package.json` / `pom.xml` / `go.mod` / `build.gradle(.kts)` / `*.csproj` / `composer.json`，把「依赖坐标」和兄弟仓库的「产物坐标」对上，生成 `kind: manifest` 的边。
- **RPC / HTTP 手工补充**：静态解析跨服务调用误报太高，这类边写在 `links` 里（`kind` 自定，`via` 会显示在图上）。指向未声明仓库的 link 会被忽略并给出警告。
- **影响传播**：某个仓库有改动时，依赖它的仓库标记为「受影响」并给出层级，服务级图上按依赖方向高亮。
- **点进单个服务**：服务卡片点开后进入该仓库原有的文件级拓扑，两套视图共享同一份改动数据。

服务级图只回答「哪些服务改了、谁被牵连、按什么顺序看」；跨服务的文件级精确连边不在当前范围内。

## 界面

### 拓扑视图

- 默认「影响流向」：
  - `影响`（紫色虚线）= 变更文件 → 受它影响的下游文件；
  - `上游`（蓝色实线）= 上游依赖 → 下游文件，用于确定 Review 顺序，不宣称因果关系。
  - 已经改动、但只是「依赖了某个受影响文件」的边不会画成反向影响边；完整 import 关系切到「依赖流向」查看。
- 「依赖流向」：箭头恢复为 `A imports B` 的原始方向，展示当前图内文件的真实 import 关系；图外上游依赖见节点详情。
- 「受影响」开关用于隐藏/显示未改动的下游文件。
- 左右两块面板都可以拖拽边缘调整宽度：拖动分隔条即可，双击或按 `Home` 恢复默认宽度；宽度按浏览器保存在 `localStorage` 中。键盘用户可以先 `Tab` 聚焦分隔条，再用 `←` / `→` 调整。
- 支持横向 / 纵向布局、缩放、拖拽画布、MiniMap。
- 节点颜色与左上角图例一致；虚线边框表示该文件本身没有改动。
- 抽屉右上角的「忽略」会把与本次改动无关的文件标灰（透明度 42%），状态会写回 Review；适合压掉 Java 同包匹配这类误报。
- hub 监听工作区文件变化，改完代码保存后图会自动重算，页面通过 SSE 收到通知并刷新，不需要重新运行 CLI。

### 仓库与提交历史

点击顶部仓库名（或历史图标）打开面板：

- 左侧列出 hub 中注册过的仓库，点击切换；底部输入框可按绝对路径添加仓库（自动解析到 Git 仓库根目录并校验），条目 hover 出现 × 可移除；
- 右侧「当前工作区」重新分析未提交改动；
- 「版本链条」按提交父子关系绘制，显示 `HEAD`、分支、tag 和 merge 车道；默认只加载当前分支的历史，面板右上角可切换「全部分支」，最多加载 80 个 commit。
- 点击任意提交节点，查看该提交的 Diff 和依赖拓扑。

![版本链条](https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/version-chain.png)

切换后 URL 会变成 `?review=...`，刷新页面仍停留在同一个 Review。

### 详情抽屉

![摘要与影响](https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/summary.png)

- **摘要与影响**：展示 `summary` / `impactAnalysis`，以及完整的上游 import、下游依赖（包括未画进图里的文件）、变更来源。
- **代码 Diff**：默认 Unified 单栏（窄抽屉更易读），可切换双栏、完整文件；支持语法高亮、按行号定位、折叠未改动区域。
- **待确认**：自动扫描新增行中的 TODO/FIXME/XXX/HACK/BUG，也展示 Agent 写入的 `todos`；可勾选完成、添加人工备注。

![代码 Diff](https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/diff.png)

![待确认项](https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/todos.png)

快捷键：`←` / `→` 切换 Review 文件，`Esc` 关闭抽屉。

## Agent 集成

推荐流程（也适用于任意 LLM Agent）：

1. Agent 完成代码修改。
2. Agent 阅读 `git diff`，写出注解文件 `.diff-review-annotations.json`。
3. 运行 `diff-viz --annotations` 生成数据并拉起界面。
4. 把本地 URL 和整体摘要告诉用户。

### 安装 Agent Skill

`SKILL.md` 是薄适配层：只注册这一个文件，CLI 仍然通过 npm 安装，不需要把整个包复制进 skills 目录。

```bash
# 用户级：DSH / Claude Code / Cursor
diff-viz skill install --agent dsh
diff-viz skill install --agent claude
diff-viz skill install --agent cursor

# 项目级
diff-viz skill install --agent cursor --scope project

# 自定义目录 / 复制而不是软链
diff-viz skill install --dir ~/.config/my-agent/skills --copy
```

支持 `--dry-run` 先看目标路径，`--force` 覆盖已有安装。安装后新开一个 Agent 会话，技能列表里就会出现 `diff-viz`。

注解文件格式：

```json
{
  "meta": {
    "overallSummary": "本次改动重构了 refresh token 轮换逻辑，并同步调整了 TS/Python/Go/Java 四端调用。"
  },
  "nodes": {
    "src/auth/jwt.ts": {
      "summary": "新增 refreshToken()，verifyToken() 增加 exp 类型校验。",
      "impactAnalysis": "authGuard 和 /api/routes 依赖 verifyToken；旧客户端没有 refresh 字段，需要兼容。",
      "todos": [
        {
          "text": "确认 Redis 中 refresh token 的 TTL 与 JWT 过期时间一致",
          "severity": "high",
          "category": "config"
        },
        { "text": "补一个过期边界的单测" }
      ]
    }
  }
}
```

- `nodes` 也可以是数组，每项带 `path` 或 `id`。
- `todos` 支持字符串或 `{ text, severity, category }`；`severity` 可选 `high` / `medium`。
- 已存在的 TODO 会按文本去重。
- 不想重启服务时，修改注解文件后执行 `annotate`，浏览器点「刷新」即可。

完整的 Agent 使用说明见 [SKILL.md](https://github.com/mdhUser/diff-viz/blob/main/SKILL.md)。

在其他 Agent（Claude Code / Cursor / OpenAI Codex 等）中安装和使用，见 [docs/agent-integrations.md](https://github.com/mdhUser/diff-viz/blob/main/docs/agent-integrations.md)。

## 数据契约

默认写入 `.diff-review-data.json`（清单）和 `.diff-review-data.json.nodes/`（节点内容）。清单只保留 meta、依赖边和节点元数据，`diff` / `oldContent` / `newContent` 按节点拆到单独文件，`annotate` 与 hub 的状态写入因此不必整份读写大仓库的 Review。

清单 `.diff-review-data.json`：

```json
{
  "storage": { "format": 2, "nodesDir": ".diff-review-data.json.nodes" },
  "meta": {
    "timestamp": "2026-11-13T10:00:00Z",
    "branch": "feature/auth-update",
    "overallSummary": "本次改动重构了用户鉴权逻辑。",
    "rangeLabel": "工作区 · 7dfae4ec",
    "stats": { "changedFiles": 10, "impactedFiles": 3, "additions": 68, "deletions": 16, "todos": 6 }
  },
  "nodes": [
    {
      "id": "src/auth/jwt.ts",
      "label": "jwt.ts",
      "path": "src/auth/jwt.ts",
      "status": "modified",
      "stats": { "additions": 12, "deletions": 0 },
      "summary": "新增 refreshToken()。",
      "impactAnalysis": "影响 authGuard 与 routes。",
      "todos": [
        { "id": "c-todo-17", "text": "TODO: ...", "source": "code_comment", "completed": false, "line": 17 }
      ],
      "hunkCount": 3,
      "payload": "0f2a6c8d1e3b4a5c6d7e",
      "language": "typescript",
      "imports": ["src/utils/format.ts"],
      "importedBy": ["src/api/routes.ts", "src/auth/refresh.ts"]
    }
  ],
  "edges": [
    { "id": "e-...", "source": "src/api/routes.ts", "target": "src/auth/jwt.ts", "relation": "imports" }
  ]
}
```

节点内容 `.diff-review-data.json.nodes/<payload>.json`：

```json
{
  "diff": "@@ -1,27 +1,39 @@ ...",
  "oldContent": "...",
  "newContent": "..."
}
```

约定：

- `status`: `added` | `modified` | `deleted` | `impacted_only`。
- `edges.source` **import 了** `edges.target`（依赖边）。UI 的「影响流向」会在渲染时反向画箭头。
- `impacted_only` 表示该文件没有改动，但（间接）依赖了变更文件。
- `storage.format: 2` 表示拆分存储；`nodes[].payload` 指向 `<nodesDir>/<payload>.json`，`hunkCount` 是改动区块数（避免为了显示计数去读内容文件）。
- `oldContent` / `newContent` 是完整文件内容，仅用于浏览器内 Diff；超过 400,000 字符会截断。它们只在节点内容文件里，浏览器打开详情时通过 `/api/node` 按需加载。
- `annotate` 只重写清单：`--node <path>` 时同样不会读取或改写任何节点内容文件。旧版单文件数据仍可读取，第一次写回时自动升级成拆分格式。
- 需要整份数据（脚本/兼容用途）时用 `/api/data?review=<id>&full=1`，hub 会临时合并节点内容。
- `impactChain` 是受影响文件的传播路径（如 `["src/a.ts","src/b.ts","src/c.ts"]`），第一个元素是触发它的变更文件。
- `ignored` 表示该节点被人工标记为无关改动；`reviewed` 表示已 Review，二者都会在重新生成时保留。
- `imports` / `importedBy` 是该文件**完整**的直接依赖列表，包含没有画进图里的上游文件；详情抽屉会把这些文件标成「图外」。
- `meta.reviewOrder` 是依赖优先的 Review 顺序；`meta.warnings` 记录扫描上限等提示。
- 额外字段（`summarySource`、`reviewed`、`impactOrigins`、`depth`、`binary` 等）用于界面增强，不属于必需字段。
- Agent 注解会按「项目 + 文件路径 + 改动内容」记在 hub 状态目录的 `~/.diff-viz/annotations/<projectId>.json`：同一次改动从工作区变成 commit、或从 commit 换到 range Review 时，Agent 整体概览、文件总结/影响分析/待办都会自动复用；文件内容再变则不会套用旧总结。

## 版本与兼容性（1.x）

项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)：`0.y.z` 阶段 minor 版本递增（0.7 → 0.8 → 0.9 → 0.10），**1.0.0 表示对外契约冻结**，不是「0.9 的下一个数字」。

1.x 内以下接口保持兼容，破坏性变更进入 2.0.0：

- **CLI**：`diff-viz` / `serve` / `annotate` / `hub` / `stop` / `workspace` / `skill install` 及现有参数（新增参数不算破坏）。
- **数据**：`.diff-review-data.json`（`storage.format: 2` 清单）+ `<data>.nodes/` 节点内容；新增字段保持向后兼容。
- **hub API**：`/api/health`、`/api/hub`、`/api/projects`、`/api/commits`、`/api/review`、`/api/import`、`/api/data`（含 `?full=1`）、`/api/node`、`/api/state`、`/api/annotate`、`/api/events`、`/api/workspace`。
- **Agent 注解 JSON**：`{ meta: { overallSummary }, nodes: { "<path>": { summary, impactAnalysis, todos } } }`。

兼容旧版本：v1 单文件 Review 仍可读取，第一次写回时自动升级为拆分格式；旧版 hub 进程仍在运行时，`review` / `serve` 会自动回退到整份导入，`annotate` 会提示重启 hub。

## 依赖解析与影响模型

| 语言 | 解析内容 | 解析范围 |
| --- | --- | --- |
| JS / TS / JSX / TSX / Vue / Svelte | `import`、`export ... from`、`require()`、动态 `import()` | 相对路径、`tsconfig.json` / `jsconfig.json` 的 `baseUrl`、`paths`、`index.*`、`.js` → `.ts` |
| Python | `import a.b`、`from a.b import x`、相对 import | 仓库根目录与 `src/`，`module.py` / `module/__init__.py` |
| Go | `import "..."`、import block | `go.mod` 的 module 前缀 → 目录下的 `.go` 文件 |
| Java | `import com.foo.Bar;`、`import static ...`、`import com.foo.*`、同包类引用 | 按 `package` + 文件名建立 FQCN 索引，支持 Maven/Gradle 的 `src/main/java`、多模块目录 |
| Kotlin | `import com.foo.Bar`、`import com.foo.*` | 同 `package` + 文件名索引；忽略 `kotlin.*` / `java.*` / `androidx.*` 等标准库 |
| C# | `using Acme.Services;`、`using static ...` | 按 `namespace` + 文件名索引，先匹配命名空间再匹配类；忽略 `System.*` / `Microsoft.*` |
| Rust | `mod foo;`、`use crate::a::b::C;`、`super::` / `self::` | `foo.rs` / `foo/mod.rs`；`crate::` 映射到 `src/`，逐段回退到最近的模块文件 |
| Ruby | `require_relative 'x'`、`require 'x'` | 相对当前文件解析，或按 `lib/`、仓库根目录查找 `x.rb` / `x/index.rb` |
| 自定义 | 由 `.diff-viz/languages.json` 定义的 `importPatterns` | `strategy` 可选 `package`（声明式包 + 文件名）或 `relative`（相对路径） |

### 自定义语言

仓库里放 `.diff-viz/languages.json`（或用 `--languages <file>` 指定）即可注册新语言，不需要改代码：

```json
{
  "languages": [
    {
      "id": "foo",
      "label": "Foo",
      "extensions": [".foo"],
      "strategy": "package",
      "packagePattern": "^package ([\\w.]+)",
      "importPatterns": ["^use ([\\w.]+)"]
    }
  ]
}
```

- `strategy: "package"` —— 文件头声明包名，import 写成 `包名.文件名`（Kotlin / C# 这类）；`packagePattern` 用第一个捕获组取包名。
- `strategy: "relative"` —— import 是相对路径（Ruby 这类），用 `indexNames` 指定目录入口文件名。
- `ignorePrefixes` 可排除标准库命名空间。配置写错会直接报错，不会静默丢边。

影响分析从每个变更文件出发，沿 `被 import` 的反向关系寻找下游文件，最多 `--impact-depth` 层（默认 3）、`--max-impact` 个节点，并为每个受影响文件记录 `impactChain`，详情里能看到「A → B → C」的传播路径。只展示仓库内文件；`node_modules`、`vendor`、`dist` 等目录会被跳过。

## 状态持久化

- 勾选 TODO / 标记 Review → `POST /api/state` → 只重写 hub 中对应 Review 的清单，不碰节点内容文件。
- 同时写入 `localStorage`，hub 不可用时仍可勾选。
- `annotate` 同步到 hub 走 `/api/annotate`，只传注解而不是整份 Review；页面点右上角刷新即可看到。
- 重新生成同一 Review 时，会按 todo id / 文本保留完成状态、已 Review 标记和忽略标记，并保留手工添加的备注。
- hub 只监听 `127.0.0.1`，不对局域网开放。

## 目录结构

```
diff-viz/
├── bin/diff-viz.mjs        # CLI 入口
├── src/
│   ├── cli.mjs             # 参数解析与命令
│   ├── collect.mjs         # diff → 依赖图 → 数据文件
│   ├── review-store.mjs    # 拆分存储：清单 + 逐节点内容文件、旧格式读取/升级
│   ├── diff-parse.mjs      # unified diff 解析 / TODO 扫描
│   ├── deps.mjs            # JS/TS、Python、Go、Java import 解析 + 扫描缓存
│   ├── cache.mjs           # 文件级解析缓存（mtime + size）
│   ├── languages.mjs       # 语言注册表（内置 + 自定义语言）
│   ├── workspace.mjs       # 多仓库工作区：manifest 依赖检测、服务级影响传播
│   ├── review-store.mjs    # Review 拆分存储（manifest + 节点内容目录）
│   ├── git.mjs             # Git 命令封装、.git/info/exclude 写入
│   ├── hub.mjs             # 常驻 hub：仓库注册、历史 Review、watch/SSE、状态 API
│   ├── server.mjs          # 单 Review HTTP 服务（兼容/测试）
│   └── util.mjs
├── web/                    # React + Vite + Tailwind 前端源码
├── dist/                   # 已构建前端资源
├── test/                   # node:test 测试
├── scripts/demo.mjs        # 生成演示仓库并启动
├── SKILL.md                # Agent Skill 说明
├── CHANGELOG.md            # 版本变更记录
└── README.md
```

## 开发与测试

从源码运行（改前端才需要）：

```bash
git clone https://github.com/mdhUser/diff-viz.git
cd diff-viz
npm install
npm run build
node bin/diff-viz.mjs        # 或 npm link 后使用 diff-viz
```

```bash
npm test
npm run typecheck
npm run release:check   # 校验当前版本在 CHANGELOG.md 中有发布说明
npm run demo            # 创建 .demo 演示仓库并启动界面
npm run package:skill   # 生成薄 skill 包 release/diff-viz-skill.zip（只含 SKILL.md）
npm run package:skill:standalone  # 可选：离线自包含包（含 bin/src/dist）
```

前端技术栈：React 18、Vite、Tailwind CSS v4、`@xyflow/react`、`dagre`、`react-diff-viewer-continued`、`lucide-react`。

## 发布新版本

发布流程（详细说明见 [CHANGELOG.md](https://github.com/mdhUser/diff-viz/blob/main/CHANGELOG.md)）：

1. 在 `CHANGELOG.md` 的 `## [Unreleased]` 下写清楚本版本的 **Added / Changed / Fixed**；只写 feature 名称不够，要说明用户能感知到什么。
2. 把 `Unreleased` 改成新版本号，并补上日期。
3. 更新 `package.json` 版本：

   ```bash
   npm version 0.7.0 --no-git-tag-version
   npm run release:check
   ```

4. 构建并打包 skill：

   ```bash
   npm run build
   npm run package:skill              # 薄包：release/diff-viz-skill.zip
   npm run package:skill:standalone   # 可选：离线自包含包
   npm pack --dry-run          # 确认 tarball 只包含 bin/src/dist 与文档
   ```

5. 提交、打 tag、推送：

   ```bash
   git add -A
   git commit -m "Release v0.7.0"
   git tag -a v0.7.0 -m "v0.7.0"
   git push origin main --tags
   ```

6. 发布到 npm（包名 `diff-viz-cli`，命令仍是 `diff-viz`）：

   ```bash
   npm login      # 首次或换机器
   npm publish    # 会先跑 prepublishOnly（release check / typecheck / test / build）
   npm view diff-viz-cli version --prefer-online
   npx diff-viz-cli@latest --version
   ```

   `publishConfig` 已声明 public，不需要 `--access`。注意两点：

   - 新包第一次发布时，registry 会先创建一个公开的 `0.0.0-stage` 占位版本，真实版本可能延迟几分钟才在 `npm view` 里可见；以 npmjs.com 页面或 `--prefer-online` 的结果为准，不要因为刚发布后仍看到 404 就重复改版本号。
   - 如果账号/团队启用了 staged publishing，`npm publish` 会被替换为 `npm stage publish` + `npm stage approve <stage-id>`（都需要 npm >= 11.15，并用 2FA 审批）；未审批的 staged 版本不会公开，可在 npmjs.com 的 Staged Packages 页面 Approve 或 Reject。

7. 在 GitHub `Releases` 创建对应 tag 的 release，**把 CHANGELOG 里该版本的内容复制到 release notes**，并上传 `release/diff-viz-skill.zip` 作为 asset。
8. 确认 CI 通过、npm 上能拉到新版本、Release 页面能下载 asset。

`npm run release:check` 已接入 CI：版本号在 CHANGELOG 中缺失或内容过少时，CI 会失败。

## 限制

- 依赖解析是**静态正则/AST 近似**，不执行代码，也不解析运行时动态路径；别名只读取仓库根目录的 tsconfig/jsconfig。Java 同包引用通过标识符近似匹配，注释/字符串中的同名类名可能产生少量误报。
- 大型 monorepo 超过 15,000 个代码文件时只扫描前 15,000 个，并在 `meta.warnings` 中提示。
- 二进制文件只标记状态，不渲染文本 Diff。
- 自动刷新只对 hub **本进程里分析过**的仓库生效；hub 重启后需要再运行一次 `diff-viz` 才会重新挂监听。commit / range 这类历史 Review 不会自动重算。
- `fs.watch` 的 recursive 模式在 macOS / Windows 可用，Linux 上 Node 不支持，会自动退化为不监听；也可以用 `DIFF_VIZ_NO_WATCH=1` 主动关闭。
- 数据文件（清单 + `<data>.nodes/` 目录）包含完整源码内容，**不要提交到 Git 或分享**；节点目录会自动写入 `.git/info/exclude`。`~/.diff-viz/reviews` 里的缓存同样是完整源码（目录 0700、文件 0600，并按数量自动清理）。

## 最近版本

| 版本 | 主要内容 |
| --- | --- |
| `v1.0.0` | 冻结对外契约（CLI / 数据格式 v2 / hub API / Agent 注解），兼容旧数据与旧 hub；汇总 0.7–0.10 能力 |
| `v0.10.x` | Agent 注解可写入任意已有 Review；hub 按「项目 + 文件 + 归一化 diff」跨 Review 复用总结/影响/待办与整体概览 |
| `v0.9.x` | 版本链默认当前分支；历史 Review 批量读取（2,900 文件单 commit 57–69 s → ~1 s）；工作区 per-repo 比较范围；概览展开与 Agent 覆盖徽章 |
| `v0.8.x` | 多仓库工作区拓扑；Review 拆分存储（84 MB 级 annotate 2.9 s / 670 MB → 0.06 s / 60 MB）与节点内容按需加载 |
| `v0.7.x` | Rust / Kotlin / C# / Ruby 依赖解析、自定义语言、CI 三平台矩阵 |
| `v0.6.1` | 薄 skill 安装（`diff-viz skill install`）、SKILL.md 与 CLI 解耦、thin/standalone 打包 |
| `v0.6.0` | 首次发布到 npm；文件监听 + SSE 自动刷新、解析缓存、影响链路、节点忽略、Review 清理与权限收紧 |
| `v0.5.0` | 界面内添加/移除仓库、生成文件自动进 `.git/info/exclude` |
| `v0.4.0` | 版本链条、分支/tag/merge 图、历史 commit Review |
| `v0.3.0` | 单 hub 复用、仓库切换、历史提交、后台进程管理 |
| `v0.2.0` | Java 服务依赖解析、同包引用、Java 高亮 |
| `v0.1.0` | 初始版本：CLI、依赖拓扑、Diff、TODO、Agent Skill |

完整记录见 [CHANGELOG.md](https://github.com/mdhUser/diff-viz/blob/main/CHANGELOG.md)。

## 打赏作者

如果这个工具帮你节省了时间，欢迎微信扫码打赏，感谢支持。

<img src="https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/reward-wechat.jpg" alt="微信赞赏码" width="280" />

## License

MIT
