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

# 目标分支不是仓库默认分支时显式指定
diff-viz --pr 123 --base release/1.8
```

- `--pr` / `--mr` 会先查远端 API 确认标题与目标分支，再自动 `git fetch`：
  - GitHub：`refs/pull/<n>/head`（fork PR 也可用，取目标仓库的 ref）
  - GitLab：`refs/merge-requests/<iid>/head`
- 然后按 `merge-base(目标分支, PR head)...PR head` 生成 Review，和普通 `--range` 语义一致。
- 生成的 Review 里 `meta.pull` 保存 PR/MR 元数据，`meta.rangeLabel` 显示 `PR #N · 标题`，`meta.branch` 显示来源分支。
- 同一 PR 反复打开复用同一个 Review id（`<projectId>-pull-<number>`），已有 Agent 摘要/待办/审查状态会尽量复用。

## 实现与限制

- 不引入运行时依赖：列表用 Node 内置 `fetch`，ref 用 `git fetch`，API token 只进请求头。
- 只读取 PR/MR 的代码 diff 和元数据，不同步 review 评论、审批、CI 状态。
- 私有仓库必须有 token；未配置时页面会给出提示。
- GitHub 匿名 API 有 60 次/小时限流；配置 token 后额度更高。
- 目标分支已删除、PR 来自不可访问的 fork、或远端要求额外 SSH/git 凭据时，fetch 会失败并给出 stderr。
- 列表只显示 `open` 状态；合并后的 PR 可通过提交历史查看，或等后续版本支持 `--state merged`。

## 与工作区 / 多仓库

`workspace` 模式的每个仓库仍可使用普通 scope（`range`/`base` 等）。跨仓 MR（多仓库同分支）可先在各仓库执行 `--pr` 生成 Review，或在 workspace 配置里用 `range` 指向同一目标分支。
