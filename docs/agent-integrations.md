# 在其他 AI Agent 中使用 diff-viz

diff-viz 本身不是 DSH 专属插件：它是一个 **零运行时依赖的 Node CLI**，只依赖本机 `git` 和 Node.js >= 20，最终界面是一个本地 HTTP 页面。因此任何能执行 shell 命令、并让你打开 `http://127.0.0.1:<port>` 的 Agent 都可以使用。

## 通用方式（所有 Agent）

```bash
# 1. 在目标仓库中
cd /path/to/repo

# 2. 生成数据并启动本地服务（-y 自动确认下载，适合 Agent）
npx -y diff-viz-cli --no-open

# 3. 浏览器打开输出中的 URL，例如
#    http://127.0.0.1:5173/
```

- 加 `--no-open` 可以避免 Agent 启动系统浏览器；由你在自己的浏览器 / 编辑器内打开 URL。
- 端口被占用时会自动递增，以终端输出为准。
- 其他范围参数：

```bash
npx -y diff-viz-cli --no-open --staged
npx -y diff-viz-cli --no-open --last
npx -y diff-viz-cli --no-open --range main..HEAD
npx -y diff-viz-cli --no-open --base main
```

如果不想每次走 `npx`，可以全局安装一次：

```bash
npm install -g diff-viz-cli
# 之后任何目录：
diff-viz --no-open
```

如果 Agent 支持 Skills，再注册一次薄 skill（只链接 `SKILL.md`）：

```bash
diff-viz skill install --agent dsh          # DeepSeek Harness
diff-viz skill install --agent claude       # Claude Code
diff-viz skill install --agent antigravity  # Antigravity（或 agy）
diff-viz skill install --agent cursor --scope project
```

## DeepSeek Harness (DSH)

DSH 从 `~/.dsh/skills`（用户级）或 `<项目>/.dsh/skills`（项目级）发现 skill：

```bash
npm install -g diff-viz-cli
diff-viz skill install --agent dsh                  # 用户级
diff-viz skill install --agent dsh --scope project  # 项目级
```

安装后新开一个 DSH 会话，技能目录里会出现 `diff-viz`。如果只想临时用、不注册 skill，直接让 Agent 运行 `npx -y diff-viz-cli --no-open` 即可。

## Antigravity

Antigravity 从 `~/.gemini/config/skills`（用户级）或 `<项目>/.agents/skills`（项目级）发现 skill：

```bash
npm install -g diff-viz-cli

diff-viz skill install --agent antigravity                  # 用户级
diff-viz skill install --agent agy                          # 简写
diff-viz skill install --agent antigravity --scope project  # 项目级
```

安装后新开一个 Antigravity 会话即可在技能列表看到 `diff-viz`。

## Claude Code

Claude Code 支持 `SKILL.md` 形式的 Agent Skills。安装 CLI 后，用内置命令注册薄 skill 即可（只链接 `SKILL.md`，不复制 `bin/src/dist`）：

```bash
npm install -g diff-viz-cli

# 用户级（所有项目可用）
diff-viz skill install --agent claude

# 或项目级（把 .claude/skills/diff-viz 提交到仓库）
diff-viz skill install --agent claude --scope project
```

等价的手动方式：

```bash
mkdir -p ~/.claude/skills/diff-viz
ln -s "$(npm root -g)/diff-viz-cli/SKILL.md" ~/.claude/skills/diff-viz/SKILL.md
```

如果是从源码使用，把 `$(npm root -g)/diff-viz-cli/SKILL.md` 换成 clone 目录里的 `SKILL.md` 即可。

之后在 Claude Code 中直接说：

```text
review 一下当前改动，用 diff-viz 展示影响拓扑
```

Claude Code 没有内置的交互式浏览器面板，CLI 会注册到常驻 hub 后立即退出，把 URL 给你，由你在系统浏览器打开。

如果你的 Claude Code 版本不支持 Skills，也可以在 `CLAUDE.md` 中加：

```markdown
## Code review visualization
After finishing code changes, run:
`npx -y diff-viz-cli --no-open`
Read `.diff-review-data.json` for machine-readable summaries (the `diff` / source of each node lives under `.diff-review-data.json.nodes/`).
Do not commit `.diff-review-data.json` or `.diff-review-data.json.nodes/` (they contain full source contents).
```

## Cursor

Cursor 目前最通用的接入方式是项目规则（Rules）。创建 `.cursor/rules/diff-viz.mdc`：

```mdc
---
description: Visualize git changes with diff-viz
globs:
alwaysApply: false
---

When the user asks for a visual review, or after a multi-file change:

1. Run `npx -y diff-viz-cli --no-open --annotations .diff-review-annotations.json`.
2. Write `.diff-review-annotations.json` first when you can summarize the change:
   `{ "meta": { "overallSummary": "..." }, "nodes": { "src/a.ts": { "summary": "...", "impactAnalysis": "...", "todos": ["..."] } } }`.
3. Give the user the printed `http://127.0.0.1:<port>/` URL.
4. Never commit `.diff-review-data.json`, `.diff-review-data.json.nodes/` or the annotations file.
```

然后在 Cursor 的 Agent 中要求「visual review / 变更拓扑」。如果当前 Cursor 版本支持 Agent Skills，运行 `diff-viz skill install --agent cursor --scope project` 注册即可（只链接 `SKILL.md`）。

Cursor 有内置 Browser/Preview 时可以直接打开 localhost；否则用系统浏览器。

## OpenAI Codex

在仓库根目录的 `AGENTS.md` 中加入：

```markdown
## Visual change review
After completing a code change, run:
`npx -y diff-viz-cli --no-open --annotations .diff-review-annotations.json`

- Write `.diff-review-annotations.json` with `meta.overallSummary` and per-file
  `summary` / `impactAnalysis` / `todos` before running it.
- The command registers the review with the local hub and exits after printing the URL.
- `--json-only --quiet` prints machine-readable JSON if you need to inspect the graph yourself.
- Never commit `.diff-review-data.json` or `.diff-review-data.json.nodes/`; they contain full source content.
```

Codex CLI 没有内置网页预览，用户在系统浏览器打开 URL。

## 其他 Agent / 自定义脚本

把下面这段作为系统提示或任务说明：

```text
When a code change needs review, run:
  npx -y diff-viz-cli --no-open --annotations .diff-review-annotations.json
The process stays alive; capture the printed URL and report it.
Before that, write .diff-review-annotations.json:
  { "meta": { "overallSummary": "..." },
    "nodes": { "relative/path.ts": {
      "summary": "...", "impactAnalysis": "...",
      "todos": [{ "text": "...", "severity": "high" }] } } }
Only annotate added/modified/deleted files. Use --json-only --quiet for a pure JSON result.
```

## Agent 与界面的关系

- **交互式界面是给人看的**。Agent 默认看不到页面内容；如果它需要自行检查，可以：
  - 读 `.diff-review-data.json`（清单：节点、边、摘要、todos；每个节点的 `diff`/源码在 `<data>.nodes/<payload>.json`，可按需读取）；
  - 或让 Agent 用 Playwright/Puppeteer 截图。
- Agent 生成注解后，人可以边看拓扑边勾选 TODO；勾选状态会写回 JSON，下一次 Agent 重新生成时保留。
- 需要让 Agent 修改已有结果时，执行：

```bash
npx -y diff-viz-cli annotate \
  --data .diff-review-data.json \
  --annotations .diff-review-annotations.json
```

## 内置浏览器打不开 Review URL？

Agent / IDE 自带的浏览器（Cursor Browser、DSH 右侧栏 Browser 等）打开 `http://127.0.0.1:<port>/?review=...` 一直转圈，通常是两类原因：

1. **浏览器在远程环境里**（Cursor Remote / SSH / DevContainer / 云端 Agent）：它的 `127.0.0.1` 指向那个环境，而不是你的电脑。
   - 在 Agent 所在环境里直接运行 `npx -y diff-viz-cli`，用那个环境打印的 URL；或
   - 使用编辑器的端口转发（VS Code / Cursor 的 Ports 面板转发 5174），打开转发后的地址；或
   - 在远程环境启动 hub 时监听 `--host 0.0.0.0`，但只建议在可信网络内这么做（会暴露源码）。
2. **同机但预览用「网络空闲」判断加载完成**：diff-viz 页面默认保持一条 `/api/events` SSE 长连接（用于保存代码后自动刷新），`networkidle` 永远不结束。
   - 1.0.1 起，自动化浏览器（`navigator.webdriver`）和 iframe 内嵌会自动跳过 SSE；
   - 也可以手动在 URL 后加 `&sse=0`，需要强制开启时用 `&sse=1`；
   - 跳过 SSE 后页面仍可正常 Review，只是保存后的自动刷新变成点右上角刷新按钮。

快速自检：在 Agent 的终端里执行 `curl -m 3 http://127.0.0.1:<port>/api/health`，能返回 `{"ok":true,...}` 说明网络可达；打不开则是浏览器/加载判定问题。

## MCP（推荐的标准通信方式）

diff-viz 自带 MCP stdio server，Agent 可以直接调用工具生成 Review、读取拓扑/节点、写回注解，无需拼 shell 命令：

```bash
diff-viz mcp
```

Cursor / Claude Code / Codex 的配置和完整工具表见 [mcp.md](mcp.md)。

## 限制

- 目标目录必须是 Git 仓库。
- 需要 Node.js >= 20；npm 包内已包含构建好的 `dist/`，不需要安装前端依赖。
- 其他 Agent 不提供 DSH 右侧栏 Browser 这种内置容器时，就只能在系统浏览器查看；若编辑器支持 localhost 预览，也可以贴到其预览面板。
- MCP 是请求/响应模式；如果要做“页面点击 → Agent 主动收到任务”的实时双向队列，需要额外的 hub 事件 watcher（尚未实现）。
