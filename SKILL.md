---
name: diff-viz
description: Use after completing code changes when the user wants to review a git diff visually, understand change impact/topology in swimlanes, inspect config/database changes, read GitHub PR / GitLab MR reviewer comments, inspect TODO/FIXME items, or hand off a change for human review. Generates a dependency graph of modified and impacted files, a local interactive Web UI with code diffs, reviewer comments and agent-written summaries/review todos. Trigger phrases include 变更 review、代码改动可视化、diff 拓扑、影响分析、PR review、MR 评论、泳道图、数据库表、查看改动/待办、谁依赖这个文件、diff-viz.
---

# diff-viz

把一次 Git 变更转成「变更 + 依赖拓扑 + Diff + 待确认项」的可视化 Review 页面。工具是零运行时依赖的 Node CLI，自带构建好的前端；在本机启动 HTTP 服务并打开浏览器。

> 本 SKILL.md 适用于 **diff-viz CLI >= 1.5.3**（含泳道、配置/数据库视图、GitHub PR / GitLab MR 与 Reviewer 评论）。用 `diff-viz --version` 检查；技能内容与源码同步更新，重新执行 `diff-viz skill install --force` 可刷新已安装的副本。

## 安装

Agent 技能目录只需要本 `SKILL.md`；CLI 独立安装，不需要把 `bin/src/dist` 复制进 skills 目录。

```bash
# 1. 安装 CLI（任选其一）
npm install -g diff-viz-cli
pnpm add -g diff-viz-cli

# 2. 注册 skill（自动创建薄 SKILL.md 链接）
diff-viz skill install --agent dsh      # dsh | claude | cursor | agents | antigravity（或 agy）
```

手动安装：把本文件放到 `<agent>/skills/diff-viz/SKILL.md` 即可。

> **命令约定**：下文所有 `diff-viz` 指已安装的 CLI。
> - 如果 `diff-viz` 不在 PATH，用 `npx -y diff-viz-cli` 代替。
> - 只有从源码目录直接运行、且本文件所在目录包含 `bin/diff-viz.mjs` 时，才用 `node "$SKILL_DIR/bin/diff-viz.mjs"`（`$SKILL_DIR` 指本 `SKILL.md` 所在目录）。
> - 不需要 `dist/` 或 `npm install`；npm 包已经包含前端构建产物。

## 何时使用

- Agent 刚完成一组代码修改，需要用户逐个文件 Review。
- 用户想知道改动的下游影响（哪些未修改文件会被波及）。
- 需要把 Agent 的改动总结、风险点、待确认 TODO 与代码 Diff 放在同一页面上。
- 需要快速定位本次新增的 `TODO` / `FIXME` 注释。
- **改动横跨多个仓库**，或者用户要看服务之间的依赖与影响 → 走「多仓库工作区」。
- 用户给的是 **GitHub Pull Request / GitLab Merge Request**，希望直接看 diff 拓扑和 Reviewer 评论。
- 用户想按 **模块/目录/包泳道**、**配置绑定** 或 **数据库表/SQL** 来理解改动。

## 前置条件

- Node.js >= 20，当前目录位于 Git 仓库内。
- 已安装 `diff-viz` CLI，或允许用 `npx -y diff-viz-cli` 临时运行。
- 本 skill 只需要 `SKILL.md`；不要把整个工具包复制到 skills 目录。

## 标准流程（Agent 必须按此顺序）

### 1. 查看变更

```bash
git status --short
git diff --stat
```

确定变更文件列表，以及是否有未跟踪的新文件。

### 2. 写出注解文件

在仓库根目录创建 `.diff-review-annotations.json`。只需注解**有代码改动的文件**（`added` / `modified` / `deleted`），不要为 `impacted_only` 编造摘要。

```json
{
  "meta": {
    "overallSummary": "一句话说明本次改动的目的、范围与风险。"
  },
  "nodes": {
    "src/auth/jwt.ts": {
      "summary": "这个文件改了什么，核心逻辑是什么。",
      "impactAnalysis": "谁会受影响、需要重点验证什么；没有下游就明确说明。",
      "riskLevel": "high",
      "todos": [
        {
          "text": "需要人工确认的具体点",
          "severity": "high",
          "category": "compatibility"
        }
      ]
    }
  }
}
```

字段规则：

- `nodes` 的 key 是相对仓库根的路径；也可以写成数组：`[{ "path": "...", ... }]`。
- `summary` / `impactAnalysis` 必须具体，避免「优化了代码」这类空话。
- `riskLevel` 可选 `high` / `medium` / `low`。**高风险改动必须标 `high`**（认证/权限、支付/金额、数据迁移/删除、并发/事务、核心链路、影响面大、缺少测试等）；标为 `high` 的文件在拓扑图里会红色闪烁，提醒 coder 优先人工 Review。风险原因写进 `impactAnalysis` 或 `todos`。
- `todos` 可以是字符串，或 `{ text, severity, category }`；`severity` 可选 `high` / `medium`。有未完成 todo 的文件会以醒目颜色标注「待确认」；`severity: high` 的 todo 也会触发红色提醒。
- 不要重复代码注释里已经存在的 TODO；工具会自动扫描新增行里的 TODO/FIXME。
- 注解文件不要提交到 Git。

### 3. 生成数据并启动界面

```bash
diff-viz \
  --annotations .diff-review-annotations.json \
  --port 5173
```

- 默认分析工作区；工作区干净时自动看最近一次提交。
- 需要指定范围时加 `--staged`、`--last`、`--range main..HEAD`、`--base main`。
- CLI 会写 `.diff-review-data.json`，**确保/复用一个常驻 hub**，把本次 Review 注册进去，然后立即退出（不再为每次分析常驻一个进程）。
- 不需要 `nohup`/后台任务；命令会正常结束并打印唯一 URL，直接把它给用户。
- hub 默认在 `http://127.0.0.1:5173`（被占用自动递增）；后续分析复用它。需要停止时运行 `diff-viz stop`。
- 如果执行环境不能打开浏览器，使用 `--no-open`，把 URL 告诉用户。
- 界面的仓库名/历史按钮可以在已注册仓库之间切换，并通过版本链条查看最近 80 个历史提交的 Diff；版本链条默认当前分支，可切换「全部分支」（含 tag/merge）。

### 4. 汇报

向用户说明：

- Review URL（实际端口）。
- 本次变更的文件数、受影响文件数、待办数（可从 `--json-only --quiet` 的 JSON 输出读取）。
- 最需要人工确认的 1–3 个风险点；高风险文件已通过 `riskLevel: high` 在拓扑图中红色闪烁。

## 远端 GitHub PR / GitLab MR

```bash
diff-viz --pr 123                       # GitHub PR 编号或 URL
diff-viz --mr 7                         # GitLab MR
diff-viz --pr 123 --base origin/release/1.8   # 目标分支不是默认分支时
```

- 会先查远端 API 确认标题/目标分支，自动 fetch `refs/pull/<n>/head`（GitLab 为 `refs/merge-requests/<iid>/head`）和目标分支，再按 `merge-base` 生成 Review。
- 传入完整 URL 时会校验仓库归属；URL 与当前 `origin` 不一致会直接报错，只传编号则使用当前仓库。
- 私有仓库鉴权：设置 `GITHUB_TOKEN` / `GITLAB_TOKEN`，或复用已登录的 `gh` / `glab`；自建实例用 `DIFF_VIZ_PROVIDER=github|gitlab`、`DIFF_VIZ_GITLAB_HOSTS`、`DIFF_VIZ_GITHUB_HOSTS`（详见 docs/pull-requests.md）。
- **Reviewer 评论**：行内评论挂到对应文件，文件节点/侧栏显示数量徽章（未解决为琥珀色）；详情抽屉「Reviewer 评论」只看当前文件；整体讨论在顶部「评论 N」的全局面板。工具栏「有评论」可只看有文件级评论的文件。
- 评论是**打开 Review 时的快照**，之后新增的评论需要重新点一次该 MR（或重新执行 `--pr/--mr`）。

## 拓扑视图：泳道 / 配置 / 数据库

- **泳道视图**：存在多个模块时自动按模块分层（构建标记识别 Maven/Gradle/npm/go.mod/pyproject），按依赖深度排序；工具栏可切「模块 / 目录 / 包」粒度和「流向 / 泳道」。
- **配置视图**：`.xml`（MyBatis namespace → Mapper 接口、Spring bean/import）、`.properties` / `.yml` / `.yaml` / `.sql` 作为配置节点入图；改 Mapper XML 会让接口与调用方进入「受影响」。工具栏「配置」可开关。
- **数据库视图**：MyBatis XML / Java 注解 / `.sql` 里的 SQL 聚合成表节点，生成「读取/写入」边和数据库泳道；本次真正改到的语句会标红并优先显示（表详情支持「仅看变更 SQL」）；悬停表节点看 SQL，点击打开表详情抽屉。工具栏「数据表」可开关。
- **Diff 气泡**：文件摘要和行内 Reviewer 评论可在 Diff 中通过「气泡」开关显示/隐藏；有行内评论的行会出现评论气泡按钮。

细节见 `docs/pull-requests.md`、`docs/resources.md`、`docs/database.md`。

## MCP（可选，推荐 Agent 使用）

如果 Agent 支持 MCP，直接加 `diff-viz mcp` 这个 stdio server，不需要 shell 拼命令：

- `diff_viz_review`：生成 Review（支持 worktree/staged/last/range/base/commit/pr/mr，可直接带 annotations）
- `diff_viz_get_review` / `diff_viz_get_node`：读取拓扑/节点 Diff
- `diff_viz_annotate`：把摘要/影响分析/待办写回已有 Review
- `diff_viz_list_projects` / `diff_viz_list_reviews`：列出项目与历史 Review

配置示例见仓库 `docs/mcp.md`（Cursor 的 `~/.cursor/mcp.json`、Claude Code 的 `claude mcp add`、Codex 的 config.toml）。MCP 是请求/响应模式；用户在页面上的点击不会主动推送给 Agent。

## 多仓库工作区（跨服务）

一次需求同时改了几个仓库、或者用户想看「服务之间」的牵连时，用工作区模式。普通单仓 Review 不需要它。

**前置**：这些仓库能通过相对路径互相指到（通常是兄弟目录），且都是 Git 仓库。

### 1. 生成 workspace 文件

在仓库的父目录执行：

```bash
diff-viz workspace --init
```

会生成 `diff-viz.workspace.json`，自动收录同级的 Git 仓库：

```json
{
  "name": "订单链路改造",
  "repos": [
    { "id": "order", "path": "./order-service" },
    { "id": "user", "path": "./user-service" },
    { "id": "common", "path": "./common-lib" }
  ],
  "links": []
}
```

- `id` 是后面 `links` 里引用的名字，建议直接用服务名。
- 少了仓库就手动加一项；`path` 相对 workspace 文件所在目录。
- 检查一遍 `repos` 再继续，漏掉的仓库不会出现在拓扑里。
- **比较范围**：顶层 `scope` 是所有仓库的缺省值，`repos[].scope` 可单独覆盖；`mode` 支持 `worktree`（默认）/ `staged` / `last` / `range` / `base` / `commit`。跨仓对比同一目标分支时加 `"scope": { "mode": "range", "base": "global/feature/xxx" }`，不要逐仓手工生成 range review。

### 2. 补跨服务依赖

**包依赖不用写**：工具会读 `package.json` / `pom.xml` / `go.mod` / `build.gradle(.kts)` / `*.csproj` / `composer.json`，把依赖坐标和兄弟仓库的产物坐标对上。

**接口调用必须手补**（静态解析识别不了 RPC/HTTP）：

```json
"links": [
  { "from": "order", "to": "user", "kind": "rpc", "via": "UserService/GetUser" }
]
```

- `from` 依赖 `to`；`kind` 自定义（`rpc` / `http` / `mq` 都行），`via` 会显示在图上。
- 指向未声明仓库的 link 会被忽略，并写进 `meta.warnings`，不会中断分析。

### 3. 分析

```bash
diff-viz workspace             # 分析并打开服务级拓扑
diff-viz workspace --no-open   # 无浏览器 / CI
diff-viz --workspace path/to/workspace.json
```

输出会给出工作区 Review 地址，以及每个仓库各自的 Review。

**提交后看历史版本**：每次重新执行 `diff-viz workspace` 会把上一版工作区快照归档；页面右上角「历史 N」可以切回历史版本（归档版和最新版都保留各自的仓库统计与比较范围）。工作区的服务卡片进入仓库后，点顶部「← 工作区」或浏览器后退可回到总览。

### 4. 读结果

- 服务卡片：有改动（`changed`）、受影响层级（`depth`，0 表示自身有改动）、影响来源（`impactOrigins`）。
- `meta.serviceEdges[]`：`from` 依赖 `to`，`kind: "manifest"` 表示自动识别的包依赖。
- `meta.stats`：`{ repos, changed, impacted }`；`meta.repos[].scopeMode` / `scopeLabel` 表示该仓库实际比较的范围。
- `meta.warnings` 是真实失败，`meta.notes` 是说明性信息；自己写注解时不要往 `warnings` 里塞说明文字。
- 想深入某个服务：界面上点卡片；脚本里用 `meta.repos[].reviewId` 去读该仓库的完整 Review。
- 没有浏览器时直接读 JSON：`curl -H "X-Diff-Viz-Token: $(cat ~/.diff-viz/token)" "$HUB/api/data?review=<workspace-review-id>"`，看 `meta.repos` 和 `meta.serviceEdges`。hub 的 `/api/*` 需要访问令牌（`GET /api/health` 除外），令牌在 `~/.diff-viz/token`；`diff-viz` 打印的链接里已经带好了 `?token=`。

**边界**：只到仓库粒度——共享库被具体哪些文件引用、跨仓库文件级连边都不做。单仓改动别用工作区。

## 只生成数据（CI / 无浏览器）

```bash
diff-viz --json-only --quiet --data .diff-review-data.json
```

stdout 是纯 JSON：

```json
{ "ok": true, "dataPath": "...", "meta": { "...": "..." }, "nodes": 10, "edges": 10 }
```

## 重新打开已有结果

```bash
diff-viz serve --data .diff-review-data.json --port 5173
```

`serve` 会把该数据注册到正在运行的 hub，然后退出；不会新开端口。

## 追加/更新 Agent 注解（不重启服务）

```bash
diff-viz annotate \
  --data .diff-review-data.json \
  --annotations .diff-review-annotations.json
```

然后在浏览器点右上角刷新按钮。`annotate` 支持 `--annotations -` 从 stdin 读取。只改单个文件时用 `--node <path>` 过滤。

`annotate` 只重写清单（`--node` 时也不碰节点内容文件），所以对大仓库反复写摘要不会变慢；运行中的 hub 会通过 `/api/annotate` 增量同步，无需重新上传整份 Review。

要给**界面里已经打开的 Review**（例如版本链里点开的某次 commit Review）补注解，不需要本地数据文件，直接指定 review id 即可（review id 在页面 URL 的 `?review=` 后面）：

```bash
diff-viz annotate \
  --review 92131449ad53-commit-db0bee519d3e \
  --annotations .diff-review-annotations.json
```

写入后刷新页面；文件摘要右上角会从「自动生成」变成「Agent 总结」，侧栏「变更概览」下的 **Agent 摘要 N/M** 计数也会更新。

注解（含 `meta.overallSummary` 整体概览）会按「项目 + 文件路径 + 改动内容」记在 hub 状态目录 `~/.diff-viz/annotations/<projectId>.json`：同一次改动从工作区变成 commit、或换一个 commit/range Review 打开时，Agent 总结和顶部的整体概览会自动复用；改动内容变了就不会套用旧总结。

## hub 管理

```bash
# 前台启动/查看 hub
diff-viz hub

# 停止后台 hub
diff-viz stop
```

hub 的状态目录默认是 `~/.diff-viz/`；Agent 沙箱不允许写 home 时会自动落到系统临时目录。也可以用 `DIFF_VIZ_HOME` 显式指定。

## 可选参数

| 参数 | 作用 |
| --- | --- |
| `--staged` | 只分析暂存区 |
| `--last` | 分析最近一次提交 |
| `--range <A..B \| A...B>` | 分析提交范围 |
| `--base <ref>` | 与目标分支 merge-base 对比；配合 `--pr/--mr` 覆盖目标分支（`origin/main` 也可以） |
| `--pr <编号\|URL>` | 分析 GitHub PR（自动 fetch refs 与评论） |
| `--mr <编号\|URL>` | 分析 GitLab MR（自动 fetch refs 与评论） |
| `--impact-depth <n>` | 下游影响深度，默认 3（最多 6） |
| `--max-impact <n>` | 受影响文件上限，默认 120 |
| `--no-untracked` | 排除未跟踪的新文件 |
| `--max-scan-files <n>` | 依赖扫描代码文件上限，默认 15000（超出时页面顶部警告） |
| `--data <file>` | 数据文件位置 |
| `--port <n>` / `--host <addr>` | 本地服务地址 |
| `--no-open` | 不自动打开浏览器 |
| `--json-only` | 只生成 JSON |
| `--workspace <file>` | 多仓库工作区模式（等价于 `diff-viz workspace`） |
| `--languages <file>` | 额外语言定义 JSON |
| `--quiet` | 减少日志 |

## 数据契约（写入 `.diff-review-data.json`）

数据是拆分存储：`.diff-review-data.json` 是清单（meta / edges / 节点元数据），
`diff`、`oldContent`、`newContent` 在 `.diff-review-data.json.nodes/<payload>.json` 里，
按需读取。Agent 通常不需要直接读这些文件，用 `--json-only` 的输出即可。

```json
{
  "storage": {
    "format": 2,
    "nodesDir": ".diff-review-data.json.nodes",
    "tablesDir": ".diff-review-data.json.tables"   // 有数据库表时才存在
  },
  "meta": {
    "timestamp": "2026-11-13T10:00:00Z",
    "branch": "feature/x",
    "overallSummary": "...",
    "reviewOrder": ["src/auth/jwt.ts", "src/api/routes.ts"],
    "stats": { "changedFiles": 2, "impactedFiles": 3, "additions": 12, "deletions": 4, "todos": 2 }
  },
  "nodes": [
    {
      "id": "src/auth/jwt.ts",
      "label": "jwt.ts",
      "path": "src/auth/jwt.ts",
      "status": "modified",
      "stats": { "additions": 12, "deletions": 0 },
      "summary": "",
      "impactAnalysis": "",
      "todos": [
        { "id": "c-todo-17", "text": "TODO: ...", "source": "code_comment", "completed": false, "line": 17 }
      ],
      "hunkCount": 3,
      "kind": "code",                    // 或 config（配置节点）
      "resourceKind": "xml-mybatis",    // 配置节点类型，代码节点没有
      "moduleId": "order-service",       // 泳道信息（可选）
      "packagePath": "com.acme.order",
      "reviewComments": 2,               // 该文件的 PR/MR 评论数（无则 0/省略）
      "reviewCommentUnresolved": 1,
      "payload": "0f2a6c8d1e3b4a5c6d7e"
    }
  ],
  "edges": [
    { "id": "e-...", "source": "src/api/routes.ts", "target": "src/auth/jwt.ts", "relation": "imports" }
  ],
  // 以下为可选字段：PR/MR 元数据、Reviewer 评论、配置/数据库/模块
  "meta": { "pull": { "provider": "gitlab", "number": 7, "title": "...", "commentCount": 5 }, "modules": [], "stats": {} },
  "comments": [
    { "id": "gitlab:123", "kind": "inline", "path": "src/a.ts", "line": 12, "author": "alice", "body": "...", "resolved": false }
  ],
  "tables": [{ "id": "table:t_order", "name": "t_order", "operations": ["select"], "sources": ["mapper/OrderMapper.xml"] }],
  "components": [{ "id": "db:default", "kind": "database", "label": "MySQL" }]
}
```

关键语义：

- `status`: `added` | `modified` | `deleted` | `impacted_only`。
- `edges.source` **import 了** `edges.target`（依赖方向）。
- 浏览器「依赖流向」按这个原始方向画箭头；「影响流向」则把真正的因果边画成 `变更文件 → 受影响文件`（标「影响」），改动文件之间按 `上游 → 下游` 画（标「上游」），用于 Review 顺序。
- `impacted_only` 是未改动、但依赖链上受影响的文件；不要给它写 `summary`。
- `nodes[].imports` / `importedBy` 是完整直接依赖列表（可能包含未画进图里的文件），详情抽屉会标「图外」。
- 清单里没有 `diff` / `oldContent` / `newContent`：`nodes[].payload` 指向内容文件，浏览器打开详情时才加载（`GET /api/node?review=<id>&id=<path>`）。
- `edges.relation` 除 `imports` 外还有 `binds`（Mapper 接口↔XML）、`config`（Spring import）、`class-ref`（Spring bean）、`reads_table` / `writes_table`（SQL 来源→表）。
- `comments` 是 PR/MR Reviewer 评论（最多 500 条、正文单条最多 6KB）；`kind: inline` 挂在文件/行，`general` 是整体讨论。SQL 文本在 `tablesDir` 按表懒加载，清单只留元数据。
- 完整字段定义见 [docs/data-contract.md](https://github.com/mdhUser/diff-viz/blob/main/docs/data-contract.md)。

## 支持的语言

- JS / TS / JSX / TSX / Vue / Svelte：`import`、`export from`、`require()`、动态 `import()`。
- Python：`import`、`from ... import`、相对 import。
- Go：单行/块状 import，基于 `go.mod` module 前缀解析本地包。
- Java：`import`、`import static`、包通配符 import，以及同包类引用；按 `package` + 文件名解析 FQCN，适配 Maven/Gradle 目录。
- Kotlin / C#：`import` / `using`，按声明的包名或命名空间 + 文件名索引解析。
- Rust：`mod`、`use`（含 `crate::` / `super::` / `self::`）。
- Ruby：`require_relative` / `require`。
- 其他语言：在仓库放 `.diff-viz/languages.json`，或用 `--languages <file>` 指定，声明扩展名、import 正则和解析策略即可。
- 其他文件仍会作为变更节点展示，只是没有依赖边。

## 故障排查

- **`diff-viz: command not found`**：先 `npm install -g diff-viz-cli`，或把命令换成 `npx -y diff-viz-cli`。
- **skill 没出现在 Agent 技能列表**：运行 `diff-viz skill install --agent dsh`（或 claude / cursor），确认目标文件是 `<skills>/diff-viz/SKILL.md`，然后新开一个 Agent 会话。
- **`当前目录不是 Git 仓库`**：在仓库根目录运行，或加 `--repo <dir>`。
- **页面 404 / 空白**：npm 包已包含 `dist/`；如果是源码运行，执行 `npm run build`。
- **端口占用**：CLI 会自动 +1；从输出里读取实际 URL，或显式 `--port 5180`。
- **没有依赖边**：确认 import 路径能被静态解析（别名需要根目录 tsconfig/jsconfig 的 `baseUrl`/`paths`），以及文件在仓库内。
- **PR/MR 列表为空或 401**：私有仓库需要 `GITHUB_TOKEN` / `GITLAB_TOKEN`（或先 `gh auth login` / `glab auth login`）；自建实例还要设 `DIFF_VIZ_PROVIDER` / `DIFF_VIZ_*_HOSTS`。
- **PR/MR URL 与当前仓库不匹配**：切到对应仓库再运行，或只传编号。
- **Reviewer 评论没有更新**：评论是打开时快照；重新点一次该 PR/MR，或重新执行 `diff-viz --pr/--mr`。
- **拓扑图空白**：如果是「有评论」筛选导致的，点画布中央「显示全部文件」；先确认 `data.nodes.length > 0`。
- **TODO 没出现**：只扫描本次 Diff 的**新增行**；已有代码里的 TODO 不会重复列出。

## 安全

- 服务只绑定 `127.0.0.1`，但数据文件包含完整的旧/新文件内容，节点内容拆在 `<data>.nodes/` 目录里。
- 不要把 `.diff-review-data.json`、`.diff-review-data.json.nodes/`、`.diff-review-data.json.tables/`、`.diff-review-annotations.json` 提交到 Git、上传或贴到公开渠道。
- PR/MR 评论正文会写入 Review 数据，可能包含内部 review 意见；同样不要外传。API token 只由 hub 进程使用，不要写进注解文件或页面。
