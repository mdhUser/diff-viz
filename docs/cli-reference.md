# CLI 参数与命令参考

命令安装后的名字是 `diff-viz`（npm 包名 `diff-viz-cli`）。不在 PATH 时用 `npx -y diff-viz-cli` 代替。

```bash
diff-viz                        # 分析当前仓库并打开 Review
diff-viz serve                  # 把已有数据文件注册到 hub 并打开
diff-viz annotate               # 合并 Agent / 人工注解
diff-viz hub                    # 前台启动常驻 hub
diff-viz stop                   # 停止后台 hub
diff-viz workspace              # 多仓库工作区分析
diff-viz workspace --init       # 生成 workspace 模板
diff-viz skill install          # 把薄 SKILL.md 注册到 Agent 技能目录
```

## 范围

默认：工作区有改动则看工作区，干净则看最近一次提交。

| 参数 | 说明 |
| --- | --- |
| `--staged` | 仅查看暂存区 |
| `--last` | 查看最近一次提交 |
| `--range <A..B\|A...B>` | 查看提交范围 |
| `--base <ref>` | 查看与目标分支的差异（`merge-base(ref, HEAD)..HEAD`） |
| `--no-untracked` | 不把未跟踪的新文件纳入 Review |
| `--repo <dir>` | 指定仓库目录（默认当前目录） |

## 输出与界面

| 参数 | 说明 |
| --- | --- |
| `--data <file>` | 清单文件路径，默认 `<repo>/.diff-review-data.json`；节点内容写入同级 `<file>.nodes/` |
| `--annotations <file>` | 生成时合并注解 JSON（`-` 表示从 stdin 读取） |
| `--node <path>` | 仅用于 `annotate`：只更新指定节点的注解 |
| `--review <id>` | 仅用于 `annotate`：直接写入 hub 里指定 id 的 Review（含历史 commit Review），不需要本地数据文件 |
| `--summary <text>` | 覆盖整体摘要 |
| `--json-only` | 只写 JSON，不注册 hub、不启动服务 |
| `--port <n>` | hub 端口，默认 5173（被占用自动递增）；不传时 hub 重启会复用上一次记住的端口 |
| `--host <addr>` | 监听地址，默认 `127.0.0.1` |
| `--no-open` | 不自动打开浏览器 |
| `--quiet` | 减少日志输出 |

## 分析

| 参数 | 说明 |
| --- | --- |
| `--impact-depth <n>` | 下游影响分析深度，默认 3（最多 6） |
| `--max-impact <n>` | 最多展示多少个受影响文件，默认 120 |
| `--languages <file>` | 额外语言定义 JSON（也可放 `<repo>/.diff-viz/languages.json`），见 [languages.md](languages.md) |

## 工作区（多仓库）

| 参数 | 说明 |
| --- | --- |
| `workspace` | 读取 `./diff-viz.workspace.json`，分析其中所有仓库并生成服务级拓扑 |
| `--init` | 配合 `workspace`：扫描同级仓库生成模板 |
| `--workspace <file>` | 指定其他 workspace JSON（也可以放在默认位置） |

`diff-viz.workspace.json` 结构：

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

- 顶层 `scope` 是所有仓库的缺省值，`repos[].scope` 单独覆盖。`mode` 支持 `worktree`（默认）/ `staged` / `last` / `range` / `base` / `commit`；`range` 需要 `range`（或 `base`）、`base` 需要 `base`、`commit` 需要 `commit`。跨仓对比同一目标分支时写 `{ "mode": "range", "base": "global/feature/xxx" }`，不用逐仓生成 range review。
- 实际使用的范围会显示在服务卡片上（`scopeMode` / `scopeLabel`）。
- **包依赖自动识别**：读 `package.json` / `pom.xml` / `go.mod` / `build.gradle(.kts)` / `*.csproj` / `composer.json`，把依赖坐标对上兄弟仓库的产物坐标，生成 `kind: manifest` 的边。
- **RPC / HTTP 手工补充**：静态解析跨服务调用误报太高，这类边写在 `links` 里（`kind` 自定，`via` 显示在图上）；指向未声明仓库的 link 会被忽略并给出警告。
- 某个仓库有改动时，依赖它的仓库标记为「受影响」并给出层级；点服务卡片进入该仓库原有的文件级拓扑。

## Skill 安装

| 参数 | 说明 |
| --- | --- |
| `--agent <name>` | `dsh` \| `claude` \| `cursor` \| `agents`（默认 `dsh`） |
| `--scope <user\|project>` | 用户级或项目级（默认 `user`） |
| `--dir <dir>` | 自定义 skills 根目录（覆盖 agent/scope） |
| `--copy` | 复制 `SKILL.md`，不建 symlink |
| `--force` | 覆盖已有安装 |
| `--dry-run` | 只打印目标路径，不写入 |

## 状态与环境变量

hub 的状态目录默认 `~/.diff-viz/`，不可写时（例如 Agent 沙箱）自动落到系统临时目录。

| 环境变量 | 作用 |
| --- | --- |
| `DIFF_VIZ_HOME` | 指定状态目录（projects、reviews、cache、annotations） |
| `DIFF_VIZ_NO_WATCH=1` | 关闭 hub 的文件监听（默认开启，改完保存自动重算） |
| `DIFF_VIZ_NO_CACHE=1` | 关闭文件级解析缓存 |
| `DIFF_VIZ_KEEP_REVIEWS` | Review 快照保留数量，默认 50（最少 5） |
