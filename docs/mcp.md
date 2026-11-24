# MCP 接入（diff-viz ↔ Agent 通信）

diff-viz 现在自带一个 **MCP stdio server**，Agent 不再需要 shell 拼命令、解析文本输出，而是通过标准 MCP 工具调用：

- **Agent → diff-viz**：生成 Review、读取拓扑/节点 Diff、写入 Agent 摘要
- **diff-viz → Agent**：工具返回结构化 JSON（URL、reviewId、meta、节点、评论、tables 等）
- **双向闭环**：Agent 用 `diff_viz_review` 生成 → 用户看页面 → Agent 用 `diff_viz_get_review` / `diff_viz_get_node` 读取页面数据 → `diff_viz_annotate` 写回摘要/待办，页面刷新后可见

## 启动

```bash
diff-viz mcp
```

这是一个 stdio server：stdout 只输出 MCP JSON-RPC 帧，不需要端口。Agent 配置示例如下。

### Cursor

`~/.cursor/mcp.json`（用户级）或项目 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "diff-viz": {
      "command": "diff-viz",
      "args": ["mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add diff-viz -- diff-viz mcp
```

### Codex

`~/.codex/config.toml`：

```toml
[mcp_servers.diff-viz]
command = "diff-viz"
args = ["mcp"]
```

### 其他 Agent

任何支持 MCP stdio server 的客户端都可以用 `command: diff-viz, args: ["mcp"]` 加载。找不到 `diff-viz` 时用绝对路径（例如 `/usr/local/bin/diff-viz`），或先 `npm install -g diff-viz-cli`。

## 工具

| 工具 | 作用 | 主要参数 |
| --- | --- | --- |
| `diff_viz_review` | 分析变更并启动/复用 hub，返回带 token 的 Review URL | `repo?`, `scope?`（worktree/staged/last/range/base/commit/pr/mr）, `range?`, `base?`, `commit?`, `pullRequest?`, `annotations?` |
| `diff_viz_get_review` | 读取 Review 清单：meta、节点摘要、边、评论、表/配置 | `reviewId`（id 或 URL）, `compact?`（默认 true）, `full?` |
| `diff_viz_get_node` | 读取单个文件的完整 diff / 旧新源码 | `reviewId`, `id`, `maxChars?` |
| `diff_viz_annotate` | 把 Agent 摘要/影响分析/待办写回已有 Review | `reviewId` 或 `dataPath`, `annotations`, `summary?` |
| `diff_viz_list_projects` | 列出 hub 已注册仓库 | — |
| `diff_viz_list_reviews` | 列出本地 Review 快照（普通/PR/MR/工作区，按时间倒序） | `limit?` |

`diff_viz_review` 的 `annotations` 直接传对象即可，不需要先写临时文件：

```json
{
  "repo": "/path/to/repo",
  "scope": "worktree",
  "annotations": {
    "meta": { "overallSummary": "本次改动..." },
    "nodes": {
      "src/a.ts": {
        "summary": "改了什么",
        "impactAnalysis": "谁受影响",
        "todos": [{ "text": "需要人工确认", "severity": "high" }]
      }
    }
  }
}
```

工具结果是 MCP `content[0].text` 里的 JSON；失败时 `isError: true` 并附可操作错误信息（token、URL 不匹配、hub 未启动等）。

## 典型 Agent 流程

1. `diff_viz_review({ scope: "worktree", annotations: {...} })`
2. 把返回的 `url` 给用户打开
3. 用户看图后提问；Agent 调 `diff_viz_get_review` / `diff_viz_get_node` 读取具体文件
4. Agent 调 `diff_viz_annotate` 更新摘要/待办
5. 用户在页面刷新即可看到 Agent 的回复（页面按项目+文件+diff 内容复用注解）

## 与“UI 主动通知 Agent”的区别

MCP 是**请求/响应**模式：Agent 调用工具、diff-viz 返回结果。用户在页面上的点击（标记 Review、勾选 TODO）不会主动唤醒 Agent；目前 Agent 想要同步页面状态，需要主动调用 `diff_viz_get_review`。

如果要做“用户在页面发消息/点按钮 → Agent 后台任务收到并回复”的实时双向通道，需要再加一个 hub 事件队列 + Agent watcher（例如 `diff-viz agent watch`），这是后续迭代候选。

## 安全

- MCP server 只在本机进程内运行，不监听端口；Review 数据仍只保存在本机 hub。
- `diff_viz_review` 返回的 URL 带访问 token，方便用户直接打开；不要把该 URL 贴到公开渠道。
- Agent 只能访问本机 hub API 和本地 Review 文件，不会上传源码。
