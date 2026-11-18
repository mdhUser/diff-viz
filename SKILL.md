---
name: diff-viz
description: Use after completing code changes when the user wants to review a git diff visually, understand change impact/topology, inspect TODO/FIXME items, or hand off a change for human review. Generates a dependency graph of modified and impacted files, a local interactive Web UI with code diffs, and supports agent-written summaries/impact analysis/review todos. Trigger phrases include 变更 review、代码改动可视化、diff 拓扑、影响分析、查看改动/待办、谁依赖这个文件、diff-viz.
---

# diff-viz

把一次 Git 变更转成「变更 + 依赖拓扑 + Diff + 待确认项」的可视化 Review 页面。工具是零运行时依赖的 Node CLI，自带构建好的前端；在本机启动 HTTP 服务并打开浏览器。

## 安装

Agent 技能目录只需要本 `SKILL.md`；CLI 独立安装，不需要把 `bin/src/dist` 复制进 skills 目录。

```bash
# 1. 安装 CLI（任选其一）
npm install -g diff-viz-cli
pnpm add -g diff-viz-cli

# 2. 注册 skill（自动创建薄 SKILL.md 链接）
diff-viz skill install --agent dsh      # dsh | claude | cursor | agents
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
- `todos` 可以是字符串，或 `{ text, severity, category }`；`severity` 可选 `high` / `medium`。
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
- 界面的仓库名/历史按钮可以在已注册仓库之间切换，并通过版本链条查看最近 80 个历史提交（含分支/tag/merge）的 Diff。

### 4. 汇报

向用户说明：

- Review URL（实际端口）。
- 本次变更的文件数、受影响文件数、待办数（可从 `--json-only --quiet` 的 JSON 输出读取）。
- 最需要人工确认的 1–3 个风险点。

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
| `--base <ref>` | 与目标分支 merge-base 对比 |
| `--impact-depth <n>` | 下游影响深度，默认 3（最多 6） |
| `--max-impact <n>` | 受影响文件上限，默认 120 |
| `--no-untracked` | 排除未跟踪的新文件 |
| `--data <file>` | 数据文件位置 |
| `--port <n>` / `--host <addr>` | 本地服务地址 |
| `--no-open` | 不自动打开浏览器 |
| `--json-only` | 只生成 JSON |
| `--quiet` | 减少日志 |

## 数据契约（写入 `.diff-review-data.json`）

数据是拆分存储：`.diff-review-data.json` 是清单（meta / edges / 节点元数据），
`diff`、`oldContent`、`newContent` 在 `.diff-review-data.json.nodes/<payload>.json` 里，
按需读取。Agent 通常不需要直接读这些文件，用 `--json-only` 的输出即可。

```json
{
  "storage": { "format": 2, "nodesDir": ".diff-review-data.json.nodes" },
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
      "payload": "0f2a6c8d1e3b4a5c6d7e"
    }
  ],
  "edges": [
    { "id": "e-...", "source": "src/api/routes.ts", "target": "src/auth/jwt.ts", "relation": "imports" }
  ]
}
```

关键语义：

- `status`: `added` | `modified` | `deleted` | `impacted_only`。
- `edges.source` **import 了** `edges.target`（依赖方向）。
- 浏览器「依赖流向」按这个原始方向画箭头；「影响流向」则把真正的因果边画成 `变更文件 → 受影响文件`（标「影响」），改动文件之间按 `上游 → 下游` 画（标「上游」），用于 Review 顺序。
- `impacted_only` 是未改动、但依赖链上受影响的文件；不要给它写 `summary`。
- `nodes[].imports` / `importedBy` 是完整直接依赖列表（可能包含未画进图里的文件），详情抽屉会标「图外」。
- 清单里没有 `diff` / `oldContent` / `newContent`：`nodes[].payload` 指向内容文件，浏览器打开详情时才加载（`GET /api/node?review=<id>&id=<path>`）。
- 完整字段定义见 `README.md`。

## 支持的语言

- JS / TS / JSX / TSX / Vue / Svelte：`import`、`export from`、`require()`、动态 `import()`。
- Python：`import`、`from ... import`、相对 import。
- Go：单行/块状 import，基于 `go.mod` module 前缀解析本地包。
- Java：`import`、`import static`、包通配符 import，以及同包类引用；按 `package` + 文件名解析 FQCN，适配 Maven/Gradle 目录。
- Kotlin / C#：`import` / `using`，按声明的包名或命名空间 + 文件名索引解析。
- Rust：`mod`、`use`（含 `crate::` / `super::` / `self::`）。
- Ruby：`require_relative` / `require`。
- 多仓库：`diff-viz workspace` 读取 `diff-viz.workspace.json`，按 manifest 识别包依赖、按 `links` 补充 RPC，生成服务级改动拓扑。
- 其他语言：在仓库放 `.diff-viz/languages.json`，或用 `--languages <file>` 指定，声明扩展名、import 正则和解析策略即可。
- 其他文件仍会作为变更节点展示，只是没有依赖边。

## 故障排查

- **`diff-viz: command not found`**：先 `npm install -g diff-viz-cli`，或把命令换成 `npx -y diff-viz-cli`。
- **skill 没出现在 Agent 技能列表**：运行 `diff-viz skill install --agent dsh`（或 claude / cursor），确认目标文件是 `<skills>/diff-viz/SKILL.md`，然后新开一个 Agent 会话。
- **`当前目录不是 Git 仓库`**：在仓库根目录运行，或加 `--repo <dir>`。
- **页面 404 / 空白**：npm 包已包含 `dist/`；如果是源码运行，执行 `npm run build`。
- **端口占用**：CLI 会自动 +1；从输出里读取实际 URL，或显式 `--port 5180`。
- **没有依赖边**：确认 import 路径能被静态解析（别名需要根目录 tsconfig/jsconfig 的 `baseUrl`/`paths`），以及文件在仓库内。
- **TODO 没出现**：只扫描本次 Diff 的**新增行**；已有代码里的 TODO 不会重复列出。

## 安全

- 服务只绑定 `127.0.0.1`，但数据文件包含完整的旧/新文件内容，节点内容拆在 `<data>.nodes/` 目录里。
- 不要把 `.diff-review-data.json`、`.diff-review-data.json.nodes/`、`.diff-review-annotations.json` 提交到 Git、上传或贴到公开渠道。
