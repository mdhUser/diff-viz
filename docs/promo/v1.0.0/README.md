# diff-viz v1.0.0 宣传素材

> 配图 1600×900 PNG，4 张。文案可直接复制；图 4 的界面为展示 Agent 注解效果的示意 UI。

## 图片

| 文件 | 用途 | 建议顺序 |
| --- | --- | --- |
| `images/01-cover.png` | 主封面：AI 改完代码，先看影响再 Review | 1 |
| `images/02-whats-new.png` | 1.0 六件大事：多仓 / 秒开 / Agent 注解 / 大 Review / 多语言 / 契约冻结 | 2 |
| `images/03-workspace.png` | 多仓库工作区：一次改动，跨服务传播 | 3 |
| `images/04-agent.png` | Agent 注解：写的总结，这次不会再丢 | 4 |

单图发布优先用 `01-cover.png`；轮播按 1 → 2 → 3 → 4。

## 主文案（小红书 / 公众号 / 即刻）

AI 改完代码，最怕的不是看不懂 diff，而是不知道这次改动会搞挂谁。

**diff-viz 1.0 正式版发布了。**

它把一次 Git 改动变成一张可交互的依赖拓扑图：改了什么、影响了谁、先看哪个文件、哪些点必须人工确认，一眼看完。

1.0 这次重点更新：

🧭 **多仓库工作区**
一次分析多个服务，自动读 `package.json` / `pom.xml` / `go.mod` / `build.gradle`，按产物坐标连服务边；RPC / HTTP 调用用 `links` 补边，跨仓库影响一张图。

🤖 **Agent 注解不再丢**
Agent 可以给任意 Review 写总结、影响和待办，包括界面版本链里点开的历史 commit；相同改动在 worktree → commit → range 之间自动复用。

⚡ **历史 Review 秒开**
2,900 文件的仓库，单个 commit 从 57–69 秒降到约 1–2.5 秒。

🧩 **大 Review 也轻**
拆成 manifest + 节点文件，按需加载；84MB Review 的 annotate 从 2.9 秒降到 0.06 秒，内存 670MB → 60MB。

🌐 **多语言 + 自定义**
JS/TS、Python、Go、Java、Rust、Kotlin、C#、Ruby；用 `.diff-viz/languages.json` 注册自己的语言。

🔒 **1.x 契约冻结**
CLI、数据格式、hub API 在 1.x 内保持稳定，破坏性变更进 2.0。

还是本地运行、零运行时依赖、一条命令：

```bash
npx diff-viz-cli
```

在任意 Git 仓库根目录运行，浏览器自动打开。
MIT 开源：https://github.com/mdhUser/diff-viz

#AI编程 #代码Review #开源工具 #Git #效率工具 #独立开发

## 短版（X / 微博 / 朋友圈）

diff-viz 1.0 正式版：把 AI 改完的代码，摊成一张影响图。

多仓库工作区 · Agent 注解跨 Review 复用 · 2,900 文件历史 Review 57–69s → 1–2.5s · 84MB Review annotate 2.9s → 0.06s

本地运行、零运行时依赖：

```bash
npx diff-viz-cli
```

## English（X / LinkedIn）

diff-viz 1.0 is out.

Turn a git diff into an interactive impact graph:

• multi-repo workspace topology
• agent annotations that survive commits & regenerations
• 2,900-file historical review: 57–69s → ~1–2.5s
• 84MB review annotate: 2.9s → 0.06s
• 9 languages + custom parsers
• stable 1.x contract

Local, zero runtime deps, MIT.

```bash
npx diff-viz-cli
```

## 小红书短版

AI 改完代码，我不敢直接 merge…
直到我把 diff 摊成了一张图。

diff-viz 1.0 正式版来了：

✅ 多仓库工作区：一次看多个服务的牵连
✅ Agent 写的总结，提交后也不会丢
✅ 历史 Review 秒开：2900 文件 57s → 1s 级
✅ 84MB 大 Review：annotate 2.9s → 0.06s
✅ 9 种语言 + 自定义
✅ 1.x 契约冻结，放心接

本地跑、零依赖、一条命令：

```bash
npx diff-viz-cli
```

#AI编程 #代码review #程序员 #开源 #效率工具

## 配图文案

- 图 1：1.0 正式版：AI 改完代码，先看影响再 Review
- 图 2：六件大事：多仓、秒开、Agent 注解、大 Review、多语言、契约冻结
- 图 3：多仓库工作区：一次改动，跨服务传播
- 图 4：Agent 写的总结，这次不会再丢

## 素材说明

- 品牌色：ink `#0b0f14` / paper `#f6f1e7` / ember `#d9603f` / amber `#e9a84c` / violet `#7c6cf0`。
- 源文件：同目录 `src/*.html`，用 Chrome headless 以 2× 渲染后缩放；截图素材来自 `docs/overview.png` 与 `docs/summary.png`。
- 图 4 的右侧为展示 Agent 注解、覆盖度与跨 Review 复用的示意界面，不是应用截图。
