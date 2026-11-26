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
      "riskLevel": "high",
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
- `meta.scanLimit`：依赖扫描的文件上限与仓库真实规模，形如 `{ limit, codeFiles, scanned, truncated }`。`truncated: true` 表示还有代码文件没被扫描，界面会在页面顶部显式警告，而不是只在侧栏底部写一行提示；旧 Review 没有该字段时按 `meta.warnings` 里的文案回退识别。
- 额外字段（`summarySource`、`impactOrigins`、`depth`、`binary`、`diffTruncated` 等）用于界面增强，不属于必需字段。
- 1.1 起节点可带泳道信息（可选）：`moduleId` / `moduleLabel` / `modulePath` / `packagePath`；`meta.modules` 为 `[{ id, label, path, kind, order, fileCount, changedFiles, impactedFiles }]`，按依赖深度排序（入口模块在前）。旧 Review 没有这些字段时，界面按路径一级目录回退推断泳道。
- 1.2 起配置节点带 `kind: "config"` 与 `resourceKind`（`xml-mybatis` / `xml-spring` / `xml-generic` / `properties` / `yaml` / `sql`）；边关系新增 `binds` / `config` / `class-ref`，方向仍是「source 依赖 target」，见 [resources.md](resources.md)。`meta.stats.configFiles` 统计变更配置数，`meta.resourceStats` 记录资源扫描上限与截断状态。

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
- 界面设置（界面语言、Diff 默认布局、评论气泡默认状态）由 hub 统一保存在 `~/.diff-viz/settings.json`（0600），同一 hub 下的所有浏览器共用；浏览器 `localStorage` 只做首屏缓存，页面加载后以 hub 返回值为准。
- 给任意已有 Review（包括版本链里点开的 commit Review）写注解：`diff-viz annotate --review <id> --annotations <file>`。

## 数据库表（1.3 起）

顶层可选字段 `components` / `tables`；SQL 文本不在清单里，按表拆到 `storage.tablesDir` 指向的目录（文件型数据是 `<data>.tables/`，hub 快照是 `<reviewId>/tables/`），由 `GET /api/table?review=&table=` 按需读取。

```json
"components": [{ "id": "db:default", "kind": "database", "label": "MySQL", "engine": "mysql", "tables": ["table:t_order"] }],
"tables": [{
  "id": "table:t_order", "name": "t_order", "schema": null,
  "componentId": "db:default", "operations": ["select", "update"],
  "statementCount": 3, "changedStatementCount": 1, "changed": true, "impacted": false,
  "sources": ["mapper/OrderMapper.xml"], "payload": "a1b2c3d4e5f6a7b8c9d0"
}]
```

- 边关系新增 `reads_table` / `writes_table`，方向固定为「SQL 来源文件 → 表」，不会随影响/依赖视图翻转。
- 表节点只做展示，不计入 `changedFiles` / `impactedFiles`；`meta.stats.tables` 与 `meta.db`（engine/label/tables）记录汇总。
- 节点可选 `riskLevel: "high" | "medium" | "low"`（Agent 注解写入；`high` 在 UI 红色闪烁，未完成 `severity: "high"` 的 todo 也会触发提醒）。Diff 中的摘要/行内评论气泡只影响展示，不改变数据。
- `tables/<payload>.json` 内容：`{ "statements": [{ id, operation, sql, file, line, lineEnd, mapper, dynamic, changed }] }`。只有本次 Diff 的新增行落在 `line..lineEnd` 范围内才 `changed: true`；表上的 `changedStatementCount` 是变更语句数。
- `/api/data?full=1` 会合并 SQL 文本；默认 `/api/data` 只有元数据。详见 [database.md](database.md)。

## 远端 PR / MR（1.4 起）

Review 的 `meta` 可选带 `pull`：

```json
"pull": {
  "provider": "github", "number": 123, "title": "feat: fleet",
  "author": "maodhui", "sourceBranch": "feature/fleet", "targetBranch": "main",
  "baseBranch": "main", "host": "github.com", "repoPath": "acme/demo",
  "url": "https://github.com/acme/demo/pull/123", "draft": false
}
```

- 生成方式：hub `POST /api/review` body `{ "projectId": "…", "pull": { "number": 123, "base": "可选目标分支" } }`；或 CLI `--pr/--mr`。hub 会先拉取 PR 详情、fetch `refs/pull/<n>/head`（GitLab `refs/merge-requests/<iid>/head`）和目标分支，再用 `base...head` 走普通 Review 管线。
- Review id 固定为 `<projectId>-pull-<number>`，重复打开复用同一份 Review/注解。
- 列表接口：`GET /api/pulls?project=<projectId>[&refresh=1][&limit=30]` → `{ provider, host, repoPath, webUrl, pulls: [...] }`，hub 端缓存 60 秒。
- `meta.rangeLabel` 为 `PR #N · 标题`、`meta.branch` 为来源分支；`meta.scopeLabel` 为 `pull`。token 只在 hub 进程内使用，不进入浏览器或数据文件。

## PR/MR 评论（1.5 起）

打开 PR/MR Review 时会附带 `comments`（最多 500 条，正文单条最多 6000 字符）：

```json
"comments": [{
  "id": "gitlab:123", "provider": "gitlab", "kind": "inline",
  "path": "src/a.ts", "line": 12, "side": "new",
  "author": "毛狄辉", "createdAt": "2026-11-22T08:00:00Z",
  "body": "这里建议用新接口", "url": "https://gitlab…/-/merge_requests/9#note_123",
  "resolved": false, "outdated": false, "threadId": "disc-1"
}]
```

- `kind`：`inline`（挂在文件/行）或 `general`（PR 整体讨论，`path` 为空）。
- 节点新增可选 `reviewComments`（该文件评论数）与 `reviewCommentUnresolved`（未解决数）；`meta.pull.commentCount` / `unresolvedCommentCount`、`meta.stats.comments` 为汇总。
- 评论随 review 清单保存（`comments` 顶层字段），不单独懒加载；旧 Review 无该字段时界面按 0 处理。
- 读取失败不阻断 Review，警告写入 `meta.warnings`。

## 工作区历史（1.6 起）

hub 每次重新分析同一个 workspace 文件时，会先把上一版快照归档为 `workspace-<hash>-<timestamp>`，最新版仍使用稳定的 `workspace-<hash>` id。查询：

```json
GET /api/workspace/history?file=<workspace 文件的绝对路径>
{
  "ok": true,
  "file": "/path/to/diff-viz.workspace.json",
  "versions": [
    { "reviewId": "workspace-83ae372a8e", "timestamp": "...", "archived": false, "stats": { "repos": 2, "changed": 1, "impacted": 1 }, "scopes": [] },
    { "reviewId": "workspace-83ae372a8e-20261123100211", "timestamp": "...", "archived": true, "stats": { "repos": 2, "changed": 2, "impacted": 0 } }
  ]
}
```

归档快照的 `meta` 带 `archived: true`、`archivedAt`、`archivedFrom`；`meta.file` 与 `stats` 保持不变，可直接用 `GET /api/data?review=<归档 id>` 读取。

## 状态持久化

- 勾选 TODO / 标记 Review：`POST /api/state` → 只重写对应 Review 的清单，不碰节点内容文件。
- 同时写入浏览器 `localStorage`，hub 不可用时仍可勾选。
- `annotate` 同步 hub 走 `/api/annotate`，只传注解而不是整份 Review；页面点刷新即可看到。
- 重新生成同一 Review 时，按 todo id / 文本保留完成状态、已 Review 标记、忽略标记和手工备注。

## hub HTTP API

hub 默认监听 `127.0.0.1:5173`，只提供本机访问。只绑 loopback 挡不住 DNS rebinding（恶意页面让域名解析到 `127.0.0.1`，浏览器就会当成同源），所以还有两道校验：

- **Host 白名单**：`Host` 的 hostname 必须是 `127.0.0.1` / `localhost` / `::1`，或显式绑定/放行的主机，否则返回 403。rebinding 请求的 `Host` 永远是攻击者自己的域名，这一步能直接拦掉。
- **访问令牌**：除 `GET /api/health`（存活检查）外，所有 `/api/*` 都要求令牌，可以放在 `X-Diff-Viz-Token` 头、`Authorization: Bearer`、`?token=` 查询参数或 `diff_viz_token` Cookie 里。令牌在 hub 首次启动时生成到 `~/.diff-viz/token`（0600）并在重启后复用；`diff-viz` 打印的链接带 `?token=`，页面首次以该链接打开时会换成 HttpOnly Cookie，之后刷新/书签都不用再带 token。直接用脚本调 API 时从 CLI 打印的地址或 `~/.diff-viz/hub.json` 取 `token`。

| 端点 | 说明 |
| --- | --- |
| `GET /api/health` | 存活检查（唯一不需要令牌的端点） |
| `GET /api/hub` | hub 状态与已注册仓库 |
| `GET /api/settings` / `POST /api/settings` | 读取 / 更新共享界面设置（`language`、`diffLayout`、`commentsExpanded`），写入 `~/.diff-viz/settings.json` |
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

1.0.0 起上述文件格式、字段与 HTTP 端点视为稳定；新增字段/端点保持向后兼容，破坏性变更进入 2.0.0。1.1.0 起 hub 的 `/api/*` 额外要求访问令牌并校验 `Host`（安全修复，见上文「hub HTTP API」）：CLI 与页面会自动带上，直接用脚本调 API 时需要 `X-Diff-Viz-Token` 头或 `?token=` 参数。旧版单文件 Review 仍可读取并在第一次写回时升级；旧版 hub 进程仍在运行时，CLI 的 `review` / `serve` 会自动回退为整份导入，`annotate` 会提示重启 hub。

完整字段定义以本文件和 `src/review-store.mjs` 为准。
