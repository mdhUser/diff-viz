# 数据契约与 HTTP API

## 文件布局

默认写入仓库根目录：

```text
.diff-review-data.json            # 清单（manifest）：meta + edges + 节点元数据
.diff-review-data.json.nodes/     # 每个节点一个内容文件：diff / oldContent / newContent
```

`--data <file>` 可改清单路径，节点目录固定为同级 `<file>.nodes/`。两类文件都包含完整源码，写入后会自动加入 `.git/info/exclude`；hub 状态目录里的快照权限为目录 `0700`、文件 `0600`，并按数量自动清理。

## 清单文件

```json
{
  "storage": { "format": 2, "nodesDir": ".diff-review-data.json.nodes" },
  "meta": {
    "timestamp": "2026-11-13T10:00:00Z",
    "branch": "feature/auth-update",
    "overallSummary": "本次改动重构了用户鉴权逻辑。",
    "rangeLabel": "工作区 · 7dfae4ec",
    "reviewOrder": ["src/auth/jwt.ts", "src/api/routes.ts"],
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

## 节点内容文件

`<nodesDir>/<payload>.json`：

```json
{
  "diff": "@@ -1,27 +1,39 @@ ...",
  "oldContent": "...",
  "newContent": "..."
}
```

## 字段语义

- `status`：`added` | `modified` | `deleted` | `impacted_only`。
- `edges.source` **import 了** `edges.target`（依赖方向）。UI 的「影响流向」渲染时会反向画箭头。
- `impacted_only`：文件本身没有改动，但（间接）依赖了变更文件。
- `storage.format: 2` 表示拆分存储；`nodes[].payload` 指向内容文件，`hunkCount` 是改动区块数（避免为了显示计数去读内容文件）。
- `oldContent` / `newContent` 是完整文件内容，仅用于浏览器内 Diff；超过 400,000 字符会截断，只在节点内容文件里，打开详情时通过 `/api/node` 按需加载。
- `annotate` 只重写清单；`--node <path>` 时同样不会读取或改写任何节点内容文件。旧版单文件数据仍可读取，第一次写回时自动升级。
- `impactChain`：受影响文件的传播路径（如 `["src/a.ts","src/b.ts","src/c.ts"]`），第一个元素是触发它的变更文件。
- `imports` / `importedBy`：该文件**完整**的直接依赖列表，可能包含没画进图里的文件，详情抽屉会标「图外」。
- `reviewed` / `ignored`：人工标记的已 Review / 无关改动，重新生成时保留。
- `meta.reviewOrder`：依赖优先的 Review 顺序；`meta.warnings`：扫描上限等提示。
- 额外字段（`summarySource`、`impactOrigins`、`depth`、`binary`、`diffTruncated` 等）用于界面增强，不属于必需字段。

## Agent 注解

注解文件（通常 `.diff-review-annotations.json`，不要提交到 Git）：

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
        { "text": "确认 Redis 中 refresh token 的 TTL 与 JWT 过期时间一致", "severity": "high", "category": "config" },
        { "text": "补一个过期边界的单测" }
      ]
    }
  }
}
```

- `nodes` 可以是对象（key 为路径）或数组（每项带 `path` / `id`）。
- `todos` 支持字符串或 `{ text, severity, category }`；`severity` 可选 `high` / `medium`；已存在的 TODO 按文本去重。
- 写入后节点 `summarySource` / `impactSource` 变为 `agent`，页面显示「Agent 总结」徽章。
- hub 会把注解按「项目 + 文件路径 + 归一化 diff」记在 `~/.diff-viz/annotations/<projectId>.json`（含整体概览）。同一改动在 worktree / commit / range Review 之间切换时自动复用；内容变化后不会套用旧注解。
- 给任意已有 Review（包括版本链里点开的 commit Review）写注解：`diff-viz annotate --review <id> --annotations <file>`。

## 状态持久化

- 勾选 TODO / 标记 Review：`POST /api/state` → 只重写对应 Review 的清单，不碰节点内容文件。
- 同时写入浏览器 `localStorage`，hub 不可用时仍可勾选。
- `annotate` 同步 hub 走 `/api/annotate`，只传注解而不是整份 Review；页面点刷新即可看到。
- 重新生成同一 Review 时，按 todo id / 文本保留完成状态、已 Review 标记、忽略标记和手工备注。

## hub HTTP API

hub 默认监听 `127.0.0.1:5173`，只提供本机访问。

| 端点 | 说明 |
| --- | --- |
| `GET /api/health` | 存活检查 |
| `GET /api/hub` | hub 状态与已注册仓库 |
| `POST /api/projects` / `DELETE /api/projects?id=` | 注册 / 移除仓库 |
| `GET /api/commits?project=<id>[&all=1]` | 版本链提交（默认只看当前分支） |
| `POST /api/review` | 按 scope 分析仓库并生成 Review |
| `POST /api/import` | 导入 CLI 数据（支持 `dataPath` 直接复制节点文件） |
| `GET /api/data?review=<id>[&full=1]` | Review 清单；`full=1` 合并节点内容 |
| `GET /api/node?review=<id>&id=<path>` | 单个节点的完整内容（diff / oldContent / newContent） |
| `POST /api/state` | 勾选 TODO / 已 Review / 忽略 / 添加手工待办 |
| `POST /api/annotate` | 写入 Agent 注解（只改清单，不传源码） |
| `GET /api/events` | SSE：仓库变化重算完成后通知页面刷新 |
| `POST /api/workspace` | 分析多仓库工作区 |

## 1.x 兼容约定

1.0.0 起上述文件格式、字段与 HTTP 端点视为稳定；新增字段/端点保持向后兼容，破坏性变更进入 2.0.0。旧版单文件 Review 仍可读取并在第一次写回时升级；旧版 hub 进程仍在运行时，CLI 的 `review` / `serve` 会自动回退为整份导入，`annotate` 会提示重启 hub。

完整字段定义以本文件和 `src/review-store.mjs` 为准。
