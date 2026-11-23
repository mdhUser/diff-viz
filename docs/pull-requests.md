# 远程 PR / MR 评审

diff-viz 现在可以直接读取仓库远端的 GitHub Pull Request / GitLab Merge Request，在 hub 里点一下就把整个 MR 的 diff 拓扑画出来，不需要手动 fetch 或 checkout。

## 界面用法

1. 打开 hub 页面，点顶部仓库名，打开「已注册仓库」窗口。
2. 切到 **PR / MR** 标签：列出远端当前开放的 PR/MR（编号、标题、作者、来源分支 → 目标分支、更新时间）。
3. 点击任意一条：diff-viz 自动 fetch 该 PR/MR 的 head 与目标分支，生成 `base...head` 的 Review，并跳到图形界面。
4. 顶部会出现 `PR #N` / `MR !N` 橙色徽章，点击可在远端网页打开；标题显示在范围标签里。

PR/MR 列表**默认 60 秒缓存**，右上角刷新按钮可强制重新拉取。

## 鉴权

远端 API 只读，且请求在本地 hub 进程内发出，token 不会发送给浏览器。

| 平台 | 环境变量 | 说明 |
| --- | --- | --- |
| GitHub | `GITHUB_TOKEN` 或 `GH_TOKEN` | 公开仓库可不配；私有仓库需要 `repo` 权限 |
| GitLab | `GITLAB_TOKEN` 或 `GLAB_TOKEN` | 私有项目需要 `read_api` 权限 |

如果本机已经 `gh auth login` / `glab auth login`，diff-viz 会自动复用 CLI 里保存的 token（只读、仅进程内存），通常不用再导出环境变量。需要禁止这种行为时设 `DIFF_VIZ_DISABLE_CLI_TOKEN=1`。

hub 会继承启动时的环境变量：

```bash
# 方式 1：已经 gh / glab 登录过，通常直接可用；否则：
export GITHUB_TOKEN=ghp_xxx        # GitLab 用 GITLAB_TOKEN
diff-viz stop                     # 让旧 hub 退出
diff-viz                          # 重新启动，会继承新环境变量
```

如果 hub 已经由 `diff-viz` 自动常驻，先 `diff-viz stop`，在目标仓库目录重新运行 `diff-viz` 即可。

## 自建 GitLab / GitHub 企业版

默认按域名识别（包含 `gitlab` 的域名按 GitLab，`github.com` 按 GitHub）。自建域名可用：

```bash
export DIFF_VIZ_PROVIDER=gitlab                 # 或 github
export DIFF_VIZ_GITLAB_HOSTS=git.mycorp.com     # 允许的域名（可逗号分隔）
export DIFF_VIZ_GITLAB_API_URL=https://git.mycorp.com/api/v4   # 可选
```

常见组合：

| 变量 | 作用 |
| --- | --- |
| `DIFF_VIZ_PROVIDER` | 强制 `github` / `gitlab`（域名不带关键字时） |
| `DIFF_VIZ_GITHUB_HOSTS` / `DIFF_VIZ_GITLAB_HOSTS` | 额外识别的域名列表 |
| `DIFF_VIZ_GITHUB_API_URL` / `DIFF_VIZ_GITLAB_API_URL` | 覆盖 API 根地址（自建 / 反向代理 / 离线镜像） |
| `DIFF_VIZ_REMOTE_URL` | 覆盖 `origin` 的检测地址（多远程或测试时） |

## CLI 用法

```bash
# GitHub PR：编号或 URL 都可以
diff-viz --pr 123
diff-viz --pr https://github.com/acme/demo/pull/123

# GitLab MR
diff-viz --mr 7
diff-viz --mr https://git.mycorp.com/group/proj/-/merge_requests/7

# 目标分支不是仓库默认分支时显式指定（origin/xxx、refs/heads/xxx 也可以）
diff-viz --pr 123 --base origin/release/1.8
```

- 传入完整 URL 时会校验它属于当前仓库，避免把别的仓库的 `#123` 误当成当前仓库的 PR/MR。
- `--pr` / `--mr` 会先查远端 API 确认标题与目标分支，再自动 `git fetch`：
  - GitHub：`refs/pull/<n>/head`（fork PR 也可用，取目标仓库的 ref）
  - GitLab：`refs/merge-requests/<iid>/head`
- 然后按 `merge-base(目标分支, PR head)...PR head` 生成 Review，和普通 `--range` 语义一致。
- 生成的 Review 里 `meta.pull` 保存 PR/MR 元数据，`meta.rangeLabel` 显示 `PR #N · 标题`，`meta.branch` 显示来源分支。
- 同一 PR 反复打开复用同一个 Review id（`<projectId>-pull-<number>`），已有 Agent 摘要/待办/审查状态会尽量复用。

## Reviewer 评论

打开 PR/MR 时会一并读取 Review 评论，并挂到对应文件上：

| 平台 | 来源 | 说明 |
| --- | --- | --- |
| GitHub | `pulls/<n>/comments` + `issues/<n>/comments` | 行内 review comment + PR 整体讨论（issue comment）；旧行评论标记「代码已变更」 |
| GitLab | `merge_requests/<iid>/notes` | 跳过 system note；保留 `resolved` 状态与行号（`position.new_path/new_line`），整体讨论归为 general |

展示方式：

- 文件卡片右上角出现 💬 数量徽章；有未解决评论时按琥珀色显示（GitLab 提供 resolved 状态，GitHub REST 不返回 thread 解决状态）
- 左侧文件列表同样显示评论数；顶部统计与侧栏摘要显示总评论数
- 详情抽屉「Reviewer 评论」Tab **只显示当前文件的评论**：作者、时间、行号、已解决/未解决、远端链接、评论正文
- PR/MR 整体讨论不重复塞进每个文件：顶部「评论 N」、侧栏「N 评论」或文件评论 Tab 的「查看 MR 全部讨论」会打开全局 **Reviewer 评论面板**，整体讨论在上、文件评论按文件分组，可「只看未解决」并点击文件跳转
- 工具栏「有评论 N」开关：只看**有文件级评论**的文件（同时隐藏配置/数据库节点）；N 只统计挂在文件上的评论，仅整体讨论时按钮不出现。该筛选是临时的，不会带到下一个 Review；筛选为空时会给出「显示全部文件」的恢复入口

限制：

- 评论是**打开 Review 时的快照**。Review 打开后新增的评论需要重新打开一次 PR/MR（或重新运行 `--pr/--mr`）才会出现；后续可加「同步评论」按钮。
- 评论正文只读、纯文本展示，不渲染 Markdown 附件；单条超过 6KB 会截断，最多 500 条。
- 评论读取失败不会阻断 Review，会写入 `meta.warnings`（常见原因：token 缺少 `read_api`/`repo` 权限）。
- GitHub 无法通过 REST 拿到 thread 的 resolved 状态，因此 GitHub 评论不显示「已解决/未解决」。

## 实现与限制

- 不引入运行时依赖：列表用 Node 内置 `fetch`，ref 用 `git fetch`，API token 只进请求头。
- 只读取 PR/MR 的代码 diff 和元数据，不同步 review 评论、审批、CI 状态。
- 私有仓库必须有 token；未配置时页面会给出提示。
- GitHub 匿名 API 有 60 次/小时限流；配置 token 后额度更高。
- 目标分支已删除、PR 来自不可访问的 fork、或远端要求额外 SSH/git 凭据时，fetch 会失败并给出 stderr。
- 列表只显示 `open` 状态；合并后的 PR 可通过提交历史查看，或等后续版本支持 `--state merged`。

## 与工作区 / 多仓库

`workspace` 模式的每个仓库仍可使用普通 scope（`range`/`base` 等）。跨仓 MR（多仓库同分支）可先在各仓库执行 `--pr` 生成 Review，或在 workspace 配置里用 `range` 指向同一目标分支。
