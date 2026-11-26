// CLI / hub / MCP translations. Chinese source strings are the dictionary keys
// (the same approach as the web UI); the CLI defaults to English.
const EN = {
  // Argument parsing and repository resolution
  '未知语言：{value}（可选 en / zh）': 'Unknown language: {value} (use en or zh).',
  '未知命令：{command}': 'Unknown command: {command}',
  '无法识别的参数：{arg}': 'Unrecognized argument: {arg}',
  '参数 {name} 不需要值': 'Option {name} does not take a value',
  '参数 {name} 需要一个值': 'Option {name} requires a value',
  '未知参数：{name}': 'Unknown option: {name}',
  '端口不合法：{port}': 'Invalid port: {port}',
  '目录不存在：{dir}': 'Directory does not exist: {dir}',
  '当前目录不是 Git 仓库：{dir}\n  请在项目根目录运行，或使用 --repo <dir> 指定仓库。':
    'Current directory is not a Git repository: {dir}\n  Run it from the repository root, or point to one with --repo <dir>.',

  // Annotation files
  '无法从 stdin 读取注解 JSON。': 'Could not read the annotations JSON from stdin.',
  '注解文件不存在：{file}': 'Annotations file does not exist: {file}',
  '注解文件不是合法 JSON：{file}': 'Annotations file is not valid JSON: {file}',

  // Review output
  '\n  ✔ 分析完成  {changed} 个变更 · {impacted} 个受影响 · +{additions} / −{deletions} · {todos} 个待办\n':
    '\n  ✔ Analysis complete  {changed} changed · {impacted} impacted · +{additions} / −{deletions} · {todos} todos\n',
  '  范围        {range}  ({branch})': '  Scope       {range}  ({branch})',
  '  数据        {path}': '  Data        {path}',
  '无法连接 diff-viz hub：{error}': 'Could not connect to the diff-viz hub: {error}',
  '注册 Review 到 hub 失败': 'Failed to register the review with the hub',
  'annotate 需要 --annotations <file|->。': 'annotate requires --annotations <file|->.',
  '--review 需要 hub 正在运行；请先运行 diff-viz hub，或用不带 --review 的 annotate 写本地数据文件。':
    '--review requires a running hub. Start `diff-viz hub`, or run annotate without --review to write a local data file.',
  '，{count} 个节点有 Agent 注解': ', {count} nodes have agent annotations',
  '✔ 已把注解写入 hub Review {reviewId}{count}': '✔ Annotations written to hub review {reviewId}{count}',
  'hub 里找不到 Review：{reviewId}': 'Review not found in the hub: {reviewId}',
  '运行中的 hub 版本过旧，不支持 /api/annotate；请运行 `diff-viz stop` 后重新打开 Review 再试。':
    'The running hub is too old and does not support /api/annotate. Run `diff-viz stop` and reopen the review.',
  '写入 hub Review 失败': 'Failed to write the hub review',
  '找不到数据文件：{path}，请先运行 diff-viz。': 'Review data not found: {path}. Run diff-viz first.',
  '已把注解同步到运行中的 hub': 'Annotations synced to the running hub',
  '运行中的 hub 版本过旧，未同步；执行 `diff-viz stop` 后重开 Review 即可看到注解':
    'The running hub is too old, so nothing was synced. Run `diff-viz stop` and reopen the review to see the annotations.',
  '已把注解同步到运行中的 hub（重新导入）': 'Annotations synced to the running hub (by re-importing the review)',
  '同步 hub 失败': 'Failed to sync with the hub',
  '  ! 注解已写入本地，但同步 hub 失败：{error}\n': '  ! Annotations were written locally, but syncing to the hub failed: {error}\n',
  '✔ 已合并注解：{count} 个节点 · {path}': '✔ Annotations merged: {count} nodes · {path}',
  '  ↳ 数据文件已升级为拆分存储（节点内容在 {dir}）\n': '  ↳ Data file upgraded to split storage (node content in {dir})\n',
  '数据文件不是合法 JSON：{path}': 'Review data is not valid JSON: {path}',

  // Hub lifecycle
  'hub 已在运行：{url}': 'Hub is already running: {url}',
  '带令牌链接：{url}': 'Token link: {url}',
  '✔ 已停止 hub（pid {pid}）': '✔ Stopped hub (pid {pid})',
  '没有发现正在运行的 hub。': 'No running hub found.',
  'Review UI  {url}\n  Hub        {hub}\n': 'Review UI  {url}\n  Hub        {hub}\n',
  '\n  ✔ 工作区分析完成  {changed} 个仓库有改动 · {impacted} 个受影响\n':
    '\n  ✔ Workspace analysis complete  {changed} repos changed · {impacted} impacted\n',
  '工作区分析失败': 'Workspace analysis failed',
  '找不到 workspace 文件：{path}\n  先运行 diff-viz workspace --init 生成模板。':
    'Workspace file not found: {path}\n  Run `diff-viz workspace --init` to create a template first.',
  '\n  ✔ 已生成 {path}': '\n  ✔ Created {path}',
  '    收录 {count} 个仓库：{repos}': '    {count} repositories: {repos}',
  '    用 links 补充 RPC / HTTP 依赖，然后运行 diff-viz workspace\n':
    '    Add RPC / HTTP dependencies with links, then run diff-viz workspace\n',
  '--pr 与 --mr 只能选一个。': 'Use either --pr or --mr, not both.',
  '读取 PR/MR 评论失败：{error}': 'Failed to read PR/MR comments: {error}',
  ' (已启动)': ' (started)',
  ' (复用中)': ' (reused)',
  '  按 Ctrl+C 停止服务\n\n': '  Press Ctrl+C to stop the server\n\n',
  '  数据文件   {path}\n': '  Data file   {path}\n',
  'Review UI 尚未构建。请在工具目录执行 `npm install && npm run build` 后重试。':
    'The review UI has not been built. Run `npm install && npm run build` in the tool directory and try again.',

  '  范围        {range}  ({branch})\n': '  Scope       {range}  ({branch})\n',
  '  数据        {path}\n': '  Data        {path}\n',
  '{prefix}：{detail}': '{prefix}: {detail}',
  'hub 已在运行：{url}\n': 'Hub is already running: {url}\n',
  '带令牌链接：{url}\n': 'Token link: {url}\n',
  '✔ 已停止 hub（pid {pid}）\n': '✔ Stopped hub (pid {pid})\n',
  '没有发现正在运行的 hub。\n': 'No running hub found.\n',
  '✔ 已把注解写入 hub Review {reviewId}{count}\n': '✔ Annotations written to hub review {reviewId}{count}\n',
  '✔ 已合并注解：{count} 个节点 · {path}\n': '✔ Annotations merged: {count} nodes · {path}\n',
  '    收录 {count} 个仓库：{repos}\n': '    {count} repositories: {repos}\n',
  '    用 links 补充 RPC / HTTP 依赖，然后运行 diff-viz workspace\n\n': '    Add RPC / HTTP dependencies with links, then run diff-viz workspace\n\n',
  '  Hub        {url}{state}\n\n': '  Hub        {url}{state}\n\n',
  // Skill install
  '参数 {arg} 需要一个值': 'Option {arg} requires a value',
  '用法：diff-viz skill install [选项]（运行 diff-viz skill --help 查看帮助）':
    'Usage: diff-viz skill install [options] (run `diff-viz skill --help` for help)',
  '未知 scope：{scope}。可选：user / project': 'Unknown scope: {scope}. Use user / project',
  '未知 agent：{agent}。可选：{agents}': 'Unknown agent: {agent}. Use {agents}',
  '\n  ✔ {verb} diff-viz skill（{method}）\n': '\n  ✔ {verb} diff-viz skill ({method})\n',
  '  目标    {target}\n': '  Target  {target}\n',
  '  模式    --dry-run，未写入磁盘\n\n': '  Mode    --dry-run, nothing written\n\n',
  '  下一步  新开一个 Agent 会话，技能列表里会出现 diff-viz\n':
    '  Next    Start a new agent session; diff-viz will appear in the skill list\n',
  '  可用    diff-viz skill install --agent {agent} --scope project\n':
    '  Also    diff-viz skill install --agent {agent} --scope project\n',
  '已安装': 'Installed',
  '已替换': 'Replaced',
  '已经安装': 'Already installed',
  '将安装': 'Would install',
  '已处理': 'Processed',
  "  带令牌链接    {url}\n": "  Token link    {url}\n",
  "  按 Ctrl+C 停止 hub\n\n": "  Press Ctrl+C to stop the hub\n\n",
  "  状态目录      {home}\n": "  State directory  {home}\n",
  "(空)": "(empty)",
  "diff-viz hub 启动超时，请检查端口或手动运行 `diff-viz hub`。": "diff-viz hub timed out while starting. Check the port or run `diff-viz hub` manually.",
  "hub 没有该 Review 快照。": "The hub has no snapshot for this review.",
  "不支持的 scope：{scope}": "Unsupported scope: {scope}",
  "不是 Git 仓库：{dir}": "Not a Git repository: {dir}",
  "不是目录：{dir}": "Not a directory: {dir}",
  "导入的数据格式不正确。": "The imported data has an invalid format.",
  "找不到该 Review 数据。": "Review data not found.",
  "找不到该 Review。": "Review not found.",
  "数据表不存在。": "Table not found.",
  "未知仓库：{id}": "Unknown repository: {id}",
  "缺少 file 参数。": "Missing file parameter.",
  "缺少 projectId。": "Missing projectId.",
  "缺少 review 参数。": "Missing review parameter.",
  "缺少 reviewId。": "Missing reviewId.",
  "缺少 workspace 文件路径。": "Missing workspace file path.",
  "缺少仓库路径。": "Missing repository path.",
  "缺少或无效的访问令牌：请从 diff-viz 打印的带 token 链接打开，或在请求头带上 X-Diff-Viz-Token（token 见 ~/.diff-viz/token）。": "Missing or invalid access token. Open the tokenized link printed by diff-viz, or send X-Diff-Viz-Token (token in ~/.diff-viz/token).",
  "缺少有效的 PR/MR 编号。": "Missing a valid PR/MR number.",
  "请求体不是合法 JSON": "Request body is not valid JSON",
  "请求体过大": "Request body too large",
  "节点不存在。": "Node not found.",
  "待办不存在：{todoId}": "Todo not found: {todoId}",
  "待办内容不能为空。": "Todo text cannot be empty.",
  "待办内容过长（最多 500 字）。": "Todo text is too long (max 500 characters).",
  "数据文件不存在，请重新运行 diff-viz。": "Review data not found. Run diff-viz again.",
  "数据文件格式不正确。": "Review data has an invalid format.",
  "节点不存在：{nodeId}": "Node not found: {nodeId}",
  "无法覆盖目标：{dir}": "Cannot overwrite target: {dir}",
  "找不到 SKILL.md：{path}": "SKILL.md not found: {path}",
  "目标已存在：{target}\n  加 --force 覆盖，或先删除它。": "Target already exists: {target}\n  Add --force to overwrite, or remove it first.",
  "目标目录不是空的 diff-viz skill 目录，拒绝覆盖：{dir}\n  请手动检查后删除，或换一个 --dir。": "Target directory is a non-empty diff-viz skill directory; refusing to overwrite: {dir}\n  Inspect and remove it manually, or choose another --dir.",
  "缺少 SKILL.md 源文件路径。": "Missing SKILL.md source path.",
  "Review 数据不是合法 JSON：{path}": "Review data is not valid JSON: {path}",
  "Review 数据格式不正确。": "Review data has an invalid format.",
  "Review 数据缺少 nodes：{path}": "Review data is missing nodes: {path}",
  "找不到 Review 数据：{path}": "Review data not found: {path}",
  "数据表内容缺失：{name}": "Table content missing: {name}",
  "缺少要导入的 Review。": "Missing review to import.",
  "节点内容缺失：{path}": "Node content missing: {path}",
  "Host 头格式不正确：{host}": "Invalid Host header: {host}",
  "Host「{host}」不在允许列表内（已拦截 DNS rebinding 请求）。": "Host \"{host}\" is not in the allowlist (DNS rebinding request blocked).",
  "Origin 协议不被允许：{origin}": "Origin protocol is not allowed: {origin}",
  "Origin 头格式不正确：{origin}": "Invalid Origin header: {origin}",
  "Origin「{origin}」不在允许列表内。": "Origin \"{origin}\" is not in the allowlist.",
  "缺少 Host 头。": "Missing Host header.",
  "语言 {id} 的 strategy 不支持：{strategy}": "Language {id} does not support strategy: {strategy}",
  "语言 {id} 缺少 extensions。": "Language {id} is missing extensions.",
  "语言 {id} 缺少 importPatterns。": "Language {id} is missing importPatterns.",
  "语言定义必须是对象。": "Language definition must be an object.",
  "语言定义缺少 id。": "Language definition is missing id.",
  "语言配置需要 { \"languages\": [...] } 或数组。": "Language config must be { \"languages\": [...] } or an array.",
  "当前仓库还没有提交，无法与目标分支比较。": "This repository has no commits yet; cannot compare with the target branch.",
  "当前仓库还没有提交，无法查看最近一次提交。": "This repository has no commits yet; cannot view the latest commit.",
  "找不到 {from} 与 {target} 的共同祖先。": "No common ancestor for {from} and {target}.",
  "无法找到 {base} 与 HEAD 的共同祖先。": "No common ancestor for {base} and HEAD.",
  "无法解析提交范围：{range}": "Could not resolve commit range: {range}",
  "无法解析提交：{commit}": "Could not resolve commit: {commit}",
  "语言配置不存在：{file}": "Language config not found: {file}",
  "语言配置读取失败（{file}）：{error}": "Failed to read language config ({file}): {error}",
  "{label} 的 scope 必须是对象或字符串。": "The scope for {label} must be an object or string.",
  "{label} 的 scope.mode 不支持：{mode}（可选 {modes}）": "Unsupported scope.mode for {label}: {mode} (use {modes})",
  "{label} 的 scope.mode=base 需要 base。": "scope.mode=base for {label} requires base.",
  "{label} 的 scope.mode=commit 需要 commit。": "scope.mode=commit for {label} requires commit.",
  "{label} 的 scope.mode=range 需要 range 或 base。": "scope.mode=range for {label} requires range or base.",
  "links[{index}].from 不是已声明的仓库：{from}（已忽略）": "links[{index}].from is not a declared repository: {from} (ignored)",
  "links[{index}].to 不是已声明的仓库：{to}（已忽略）": "links[{index}].to is not a declared repository: {to} (ignored)",
  "workspace 中仓库 id 重复：{id}": "Duplicate repository id in workspace: {id}",
  "workspace 文件不是合法 JSON：{error}": "Workspace file is not valid JSON: {error}",
  "workspace.links[{index}] 缺少 from/to。": "workspace.links[{index}] is missing from/to.",
  "workspace.repos 不能为空。": "workspace.repos cannot be empty.",
  "workspace.repos[{index}] 缺少 path。": "workspace.repos[{index}] is missing path.",
  "仓库目录不存在：{path}": "Repository directory does not exist: {path}",
  "仓库路径不是目录：{path}": "Repository path is not a directory: {path}",
  "找不到 workspace 文件：{path}": "Workspace file not found: {path}",
  "DIFF_VIZ_PROVIDER 只支持 github 或 gitlab。": "DIFF_VIZ_PROVIDER only supports github or gitlab.",
  "PR/MR URL 与当前仓库不匹配：\n  URL     {url}\n  当前仓库 {host}/{path}\n请切到对应仓库再运行，或只传 PR/MR 编号。": "PR/MR URL does not match this repository:\n  URL        {url}\n  Repository {host}/{path}\nSwitch to that repository, or pass only the PR/MR number.",
  "PR/MR 编号不合法：{number}": "Invalid PR/MR number: {number}",
  "当前 Node 版本缺少 fetch，无法访问远端 API。": "This Node version has no fetch; cannot call the remote API.",
  "找不到仓库 {path} 或 PR/MR{suffix}；请检查远端地址与访问权限。{hint}": "Repository {path} or PR/MR{suffix} not found; check the remote URL and permissions. {hint}",
  "拉取 {kind} #{number} 的 ref 失败{detail}": "Failed to fetch {kind} #{number} refs{detail}",
  "拉取后找不到 {ref}。": "Ref not found after fetching: {ref}.",
  "拉取后找不到目标分支 {branch}。": "Target branch not found after fetching: {branch}.",
  "无法从 URL 解析 PR/MR 编号：{value}": "Could not parse a PR/MR number from the URL: {value}",
  "无法确定 PR/MR 的目标分支；请用 --base <branch> 指定。": "Could not determine the PR/MR target branch; specify it with --base <branch>.",
  "无法访问 {host} API：{error}": "Could not reach the {host} API: {error}",
  "无法识别远端平台：{url}\nGitHub 企业版 / 自建 GitLab 请设置 DIFF_VIZ_PROVIDER=github|gitlab（必要时再设 DIFF_VIZ_GITHUB_HOSTS / DIFF_VIZ_GITLAB_HOSTS）。": "Could not detect the remote platform: {url}\nFor GitHub Enterprise or self-hosted GitLab, set DIFF_VIZ_PROVIDER=github|gitlab (and DIFF_VIZ_GITHUB_HOSTS / DIFF_VIZ_GITLAB_HOSTS when needed).",
  "缺少 PR/MR 编号或 URL。": "Missing PR/MR number or URL.",
  "私有仓库请设置 GITHUB_TOKEN（或 GH_TOKEN），或先 gh auth login；公开仓库可不配置。": "For private repositories set GITHUB_TOKEN (or GH_TOKEN), or run `gh auth login` first; public repositories need no token.",
  "私有仓库请设置 GITLAB_TOKEN（或 GLAB_TOKEN），或先 glab auth login；公开项目可不配置。": "For private repositories set GITLAB_TOKEN (or GLAB_TOKEN), or run `glab auth login` first; public projects need no token.",
  "仓库没有配置 {remote} 远端；请先 git remote add {remote} <url>。": "No {remote} remote is configured; run `git remote add {remote} <url>` first.",
  "访问 {host} API 超时（{ms}ms）。": "Timed out calling the {host} API ({ms}ms).",
  "{provider} API 触发限流；请设置 token 或稍后再试。{suffix}": "{provider} API rate limit hit; set a token or try again later.{suffix}",
  "{provider} API 请求失败（HTTP {status}）{suffix}": "{provider} API request failed (HTTP {status}){suffix}",
  "{provider} 鉴权失败：{hint}{suffix}": "{provider} authentication failed: {hint}{suffix}",
  "：{stderr}": ": {stderr}",
  "；请确认远端可访问、编号存在。": "; check that the remote is reachable and the number exists.",
  "…（已截断）": "… (truncated)",
  "annotations 必须是对象。": "annotations must be an object.",
  "diff 文本截断长度，默认 200000": "Diff text truncation limit (default 200000)",
  "diff-viz hub 没有运行；请先运行 `diff-viz` 或 `diff-viz hub`。": "The diff-viz hub is not running; run `diff-viz` or `diff-viz hub` first.",
  "diff-viz 命令失败：{command}": "diff-viz command failed: {command}",
  "diff-viz 本地变更 Review。使用 diff_viz_review 生成 Review，diff_viz_get_review / diff_viz_get_node 读取拓扑和 Diff，diff_viz_annotate 写入 Agent 摘要。需要先启动 hub（diff-viz 命令会自动启动）。": "Local code-change review for diff-viz. Use diff_viz_review to create a review, diff_viz_get_review / diff_viz_get_node to read the topology and diff, and diff_viz_annotate to write agent summaries. The hub must be running (the diff-viz command starts it automatically).",
  "diff-viz 没有返回 Review URL。": "diff-viz did not return a review URL.",
  "scope=base 或 PR/MR 时的目标分支": "Target branch for scope=base or a PR/MR",
  "scope=base 需要 base 参数。": "scope=base requires a base parameter.",
  "scope=commit 时的提交": "Commit for scope=commit",
  "scope=commit 需要 commit 参数。": "scope=commit requires a commit parameter.",
  "scope=pr/mr 时的编号或 URL": "PR/MR number or URL for scope=pr/mr",
  "scope=range 时必填，如 main..HEAD 或 main...HEAD": "Required for scope=range, e.g. main..HEAD or main...HEAD",
  "scope=range 需要 range 参数。": "scope=range requires a range parameter.",
  "scope={scope} 需要 pullRequest 参数。": "scope={scope} requires a pullRequest parameter.",
  "分析 Git 变更并生成/打开 diff-viz Review，返回带 token 的 URL。支持工作区、暂存区、最近提交、范围、目标分支、指定 commit、GitHub PR、GitLab MR；可同时传入 annotations 写入 Agent 摘要。": "Analyze Git changes and create/open a diff-viz review, returning a tokenized URL. Supports workspace, staged, latest commit, range, base branch, a specific commit, GitHub PR and GitLab MR; annotations can be supplied at the same time.",
  "列出 hub 中已注册的仓库/项目。": "List repositories/projects registered with the hub.",
  "列出本地 hub 保存的 Review 快照（普通 Review、PR/MR、工作区），按时间倒序。": "List review snapshots stored by the local hub (regular, PR/MR, workspace), newest first.",
  "包含懒加载内容（diff/源码/表 SQL），可能很大": "Include lazily loaded content (diff/source/table SQL); may be large",
  "只返回 Agent 常用字段（默认 true）": "Return only the fields agents usually need (default true)",
  "可选注解对象：{ meta:{overallSummary}, nodes:{ \"path\": { summary, impactAnalysis, todos } } }": "Optional annotations: { meta:{overallSummary}, nodes:{ \"path\": { summary, impactAnalysis, todos } } }",
  "可选，覆盖整体摘要": "Optional overall summary override",
  "把 Agent 摘要 / 影响分析 / 待确认项写入已有 Review（不会重新分析代码）。": "Write agent summaries / impact analysis / confirmation items into an existing review (does not re-analyze code).",
  "读取单个文件节点的完整 diff / oldContent / newContent（默认超过 200KB 截断）。": "Read one node's full diff / oldContent / newContent (truncated above 200KB by default).",
  "读取已存在的 diff-viz Review 清单（meta、节点摘要、边、评论、表/配置），默认压缩节点字段。": "Read an existing diff-viz review manifest (meta, node summaries, edges, comments, tables/config); node fields are compacted by default.",
  "需要 reviewId 或 dataPath。": "reviewId or dataPath is required.",
  "缺少 id。": "Missing id.",
  "默认 20，最多 100": "Default 20, max 100",
  "仓库目录（默认 MCP server 启动目录）": "Repository directory (defaults to the MCP server's start directory)",
  "比较范围，默认 worktree": "Comparison scope (default worktree)",
  "要写入的 hub Review id（优先）": "Hub review id to write to (preferred)",
  "没有 reviewId 时写入本地数据文件": "Local data file to write to when reviewId is absent",
  "注解对象：{ meta:{overallSummary}, nodes:{...} }": "Annotations: { meta:{overallSummary}, nodes:{...} }",
  "节点 id（通常等于仓库相对路径）": "Node id (usually the repository-relative path)",
  "未知工具：{name}": "Unknown tool: {name}",
  "未知方法：{method}": "Unknown method: {method}",
  "Review id，或带 review 参数的 URL": "Review id, or a URL containing a review parameter",
  "设置必须是 JSON 对象。": "Settings must be a JSON object.",
  "language 只能是 zh / en / null。": "language must be zh / en / null.",
  "diffLayout 只能是 unified / split。": "diffLayout must be unified / split.",
  "commentsExpanded 必须是布尔值。": "commentsExpanded must be a boolean.",
  "…（评论过长，已截断）": "… (comment too long, truncated)",
  "缺少有效的 PR/MR 编号，未读取评论。": "Missing a valid PR/MR number; comments were not read.",
  "读取 GitHub 行内评论失败：{error}": "Failed to read GitHub inline comments: {error}",
  "读取 GitHub 讨论评论失败：{error}": "Failed to read GitHub discussion comments: {error}",
  "读取 GitLab 评论失败：{error}": "Failed to read GitLab comments: {error}",
};

let language = initialLanguage();

function initialLanguage() {
  const raw = String(process.env.DIFF_VIZ_LANG || '').trim().toLowerCase();
  return raw === 'zh' || raw === 'zh-cn' || raw === 'zh_cn' ? 'zh' : 'en';
}

export function getLanguage() {
  return language;
}

export function setLanguage(value) {
  language = value === 'zh' ? 'zh' : 'en';
  return language;
}

function normalizeFlag(value) {
  const next = String(value ?? '').trim().toLowerCase();
  if (next === 'en' || next === 'zh') return next;
  throw new Error(EN['未知语言：{value}（可选 en / zh）'].replace('{value}', String(value)));
}

/** Resolve the CLI language: --lang > DIFF_VIZ_LANG > default English. */
export function languageFromArgv(argv = process.argv.slice(2), env = process.env) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--lang') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(EN['参数 {name} 需要一个值'].replace('{name}', '--lang'));
      }
      return normalizeFlag(value);
    }
    if (arg.startsWith('--lang=')) return normalizeFlag(arg.slice('--lang='.length));
  }
  const raw = String(env.DIFF_VIZ_LANG || '').trim().toLowerCase();
  return raw === 'zh' || raw === 'zh-cn' || raw === 'zh_cn' ? 'zh' : 'en';
}

export function t(key, vars) {
  const template = language === 'zh' ? key : EN[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}


/** Localise the generated review scope label for CLI output. */
export function localizeRangeLabel(label) {
  if (language === 'zh' || !label) return label;
  return String(label)
    .replace(/^工作区 · 初始提交$/, 'Workspace · initial commit')
    .replace(/^工作区 · /, 'Workspace · ')
    .replace(/^暂存区（初始提交）$/, 'Staged (initial commit)')
    .replace(/^暂存区 · /, 'Staged · ')
    .replace(/^最近提交 · /, 'Latest commit · ')
    .replace(/^首个提交 · /, 'First commit · ')
    .replace(/^提交 /, 'Commit ');
}

export { EN };
