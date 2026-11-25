# diff-viz

**English** | [简体中文](README.zh-CN.md)

[![CI](https://github.com/mdhUser/diff-viz/actions/workflows/ci.yml/badge.svg)](https://github.com/mdhUser/diff-viz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/mdhUser/diff-viz/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/diff-viz-cli.svg)](https://www.npmjs.com/package/diff-viz-cli)
[![Changelog](https://img.shields.io/badge/changelog-v1.8.0-blue.svg)](https://github.com/mdhUser/diff-viz/blob/main/CHANGELOG.md)

**See who a change affects before you start reviewing it.**

diff-viz turns a Git change into an interactive dependency graph: which files changed, which **untouched** files are affected along the import chain, what order to review them in, and which decisions need a human. Click any file to get its summary, impact analysis, code diff and review todos.

![diff-viz topology overview](https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/overview.png)

> The web UI supports **English / Chinese switching** (top-bar language switch; `?lang=en` or `?lang=zh` in the URL). The detailed docs are being translated; links below currently point to mostly Chinese docs.

## Quick start

Requirements: Node.js >= 20. Run this in **any Git repository root**:

```bash
npx diff-viz-cli
```

Or install it once and use `diff-viz` anywhere:

```bash
npm install -g diff-viz-cli
diff-viz
```

It does three things:

1. **Analyzes your change** — if the worktree is dirty it reviews staged + unstaged + untracked changes; if clean it reviews the latest commit.
2. **Writes local review data** — `.diff-review-data.json` plus `.diff-review-data.json.nodes/`, automatically added to `.git/info/exclude` so `git status` stays clean.
3. **Starts/reuses a local hub and opens the browser** — the CLI exits immediately; the hub keeps running for later reviews.

Common variants:

```bash
diff-viz --staged                  # staged changes only
diff-viz --last                    # latest commit
diff-viz --range main..HEAD        # commit range
diff-viz --base main               # compare against merge-base with a target branch
diff-viz --pr 123                  # GitHub pull request
diff-viz --mr 7                    # GitLab merge request
diff-viz --no-open                 # print the URL instead of opening a browser
diff-viz stop                      # stop the background hub
```

The default port is `5173` and auto-increments when busy; use the URL printed by the CLI. The hub remembers its last port across restarts, so old links keep working (override with `--port`).

### The interface in 30 seconds

| Area | What you get |
| --- | --- |
| Left sidebar | Overall summary, changed/impacted file lists, review progress; click to select a file |
| Canvas | Dependency topology. Purple dashed = impact (A changed → B affected), blue solid = dependency (A imports B), gray nodes = untouched but impacted |
| Detail drawer | Summary & impact, code diff, review todos; side-by-side diff, full-file view, syntax highlighting |
| Top bar | Repo switcher, version chain (current branch by default), historical commit reviews, refresh, **language switch**; switch between **flow / swimlane** views (lanes by module/directory/package) and toggle **config** / **database** layers |

Keyboard: `←` / `→` move between files, `Esc` closes the drawer. When you save code, the hub re-analyzes and the page refreshes over SSE — no need to re-run the CLI.

## Why diff-viz

- **Who does this change affect?** `git diff` only lists touched files; diff-viz walks the import graph and shows every downstream file, including untouched ones, with a propagation chain (`A → B → C`).
- **What order should I review in?** A dependency-aware `reviewOrder`, per-file status (reviewed / needs confirmation / ignored), persisted locally.
- **What must a human confirm?** Agents write summaries, impact analysis and risk notes into annotations, shown directly in the page. TODO/FIXME comments in added lines are detected automatically.

## Common tasks

| I want to… | Command / action |
| --- | --- |
| Review my worktree | `diff-viz` |
| Review a commit / range | `diff-viz --last` / `--range A..B` / `--base main` |
| Switch repo or browse history in the UI | Click the repo name → pick a repo → click a commit in the version chain |
| Open a remote PR / MR | Click the repo name → **PR / MR** → pick one; or `diff-viz --pr 123` / `--mr 7` |
| Attach agent/human summaries | `diff-viz annotate --data .diff-review-data.json --annotations ann.json` |
| Annotate an already-open review | `diff-viz annotate --review <id> --annotations ann.json` (`<id>` is the `?review=` value) |
| Get machine-readable output | `diff-viz --json-only --quiet` |
| Reopen existing data | `diff-viz serve --data .diff-review-data.json` |
| Analyze several repos together | `diff-viz workspace --init` → edit `diff-viz.workspace.json` → `diff-viz workspace` |

Full CLI reference: **[docs/cli-reference.md](https://github.com/mdhUser/diff-viz/blob/main/docs/cli-reference.md)**.

## Remote GitHub PRs / GitLab MRs

Open a remote PR/MR directly from the hub: click the repo name → **PR / MR** tab → pick a request. diff-viz fetches `refs/pull/<n>/head` (GitLab: `refs/merge-requests/<iid>/head`) and the target branch, then builds the `base...head` topology.

```bash
diff-viz --pr 123                 # GitHub PR number or URL
diff-viz --mr 7                   # GitLab MR
diff-viz --pr 123 --base release/1.8   # when the target is not the default branch
```

- For private repos set `GITHUB_TOKEN` / `GITLAB_TOKEN` (or reuse an existing `gh` / `glab` login). Self-hosted GitLab: `DIFF_VIZ_PROVIDER=gitlab`, `DIFF_VIZ_GITLAB_HOSTS`, etc.
- PR/MR metadata lands in `meta.pull`; the top bar shows `PR #N · title` with a link back to the remote page.
- Reviewer comments are synced too: files with comments show count badges on nodes and in the sidebar (amber when unresolved); the detail drawer has a **Reviewer comments** tab; the **Has comments** toolbar toggle shows only files with comments.
- The same PR reuses the same review (`<projectId>-pull-<number>`), so existing agent annotations are preserved.
- Comments are a snapshot taken when the review opens; reopen the PR to fetch new comments.

Details and limitations: [docs/pull-requests.md](https://github.com/mdhUser/diff-viz/blob/main/docs/pull-requests.md).

## Config files and databases

Configuration and SQL are part of the graph:

- `.xml`: MyBatis mappers (`namespace` bound to the Java mapper interface) and Spring XML (`<bean class>`, `<import resource>`); unknown XML stays a node without guessed edges.
- `.properties` / `.yml` / `.yaml` / `.sql`: config nodes take part in layering.
- **Database tables**: SQL from MyBatis XML, Java annotations and `.sql` files is grouped into table nodes (`t_order`, …) with orange **read/write** edges into a database lane. Hover a table for SQL; click for the full statement drawer. Toggle the **Config** / **Database** layers in the toolbar.
- Editing a mapper XML marks the mapper interface and its callers as impacted.

Model, edge directions and limits: [docs/resources.md](https://github.com/mdhUser/diff-viz/blob/main/docs/resources.md), [docs/database.md](https://github.com/mdhUser/diff-viz/blob/main/docs/database.md).

## Workspaces / microservices

For a change spanning multiple services:

```bash
diff-viz workspace --init    # generate a template next to sibling Git repos
diff-viz workspace           # analyze and open the service-level topology
```

diff-viz detects package dependencies from `package.json` / `pom.xml` / `go.mod` / `build.gradle(.kts)` / `*.csproj` / `composer.json`. For RPC/HTTP calls that cannot be parsed statically, declare them in `links` inside `diff-viz.workspace.json`. A changed service marks its dependents as impacted with a depth; click a service card to open the file-level topology of that repo.

After committing, re-running `diff-viz workspace` archives the previous workspace snapshot: use the **History N** dropdown in the page header to switch between historical versions. From a repository review, **← Workspace** or browser Back returns to the overview.

Scope format (`worktree` / `staged` / `last` / `range` / `base` / `commit`, with per-repo overrides): [docs/cli-reference.md](https://github.com/mdhUser/diff-viz/blob/main/docs/cli-reference.md).

## Agents and MCP

Install the skill for your agent:

```bash
diff-viz skill install --agent dsh      # or claude / cursor / antigravity
```

An agent's standard loop: make the change → write an annotation file (`meta.overallSummary` + per-file `summary` / `impactAnalysis` / `todos`) → run `diff-viz --annotations ...` → hand the URL and summary to the user. Use `annotate` to update an existing review without restarting anything; annotations are reused per project + file + diff content, including across commits.

**MCP server** (recommended for Cursor / Claude Code / Codex): `diff-viz mcp` exposes tools that agents can call directly:

- `diff_viz_review` — generate a review (including PR/MR, ranges, commits) with optional annotations
- `diff_viz_get_review` / `diff_viz_get_node` — read the topology/summaries or a file's full diff
- `diff_viz_annotate` — write agent summaries back to a review
- `diff_viz_list_projects` / `diff_viz_list_reviews` — discover projects and historical snapshots

Setup and tool schemas: [docs/mcp.md](https://github.com/mdhUser/diff-viz/blob/main/docs/mcp.md). Skill details: [SKILL.md](https://github.com/mdhUser/diff-viz/blob/main/SKILL.md).

## Data and privacy

- Review data contains full source code. **Never commit or share it**; it is added to `.git/info/exclude` automatically.
- Hub state lives in `~/.diff-viz/` by default (falls back to a temp dir, or set `DIFF_VIZ_HOME`): review snapshots are `0700`/`0600` and pruned by count.
- The server binds to `127.0.0.1` only; it does not upload code and needs no account. It also validates the `Host` header (DNS-rebinding protection), and `/api/*` requires an access token carried in the URL printed by the CLI and stored as an HttpOnly cookie. See **hub access control** in [docs/cli-reference.md](https://github.com/mdhUser/diff-viz/blob/main/docs/cli-reference.md).

Data format and HTTP API: **[docs/data-contract.md](https://github.com/mdhUser/diff-viz/blob/main/docs/data-contract.md)**.

## Known limitations

- UI chrome is bilingual; **server-generated heuristic summaries, agent annotations and reviewer comment bodies remain in their original language** until the data layer is localized.
- Dependency resolution is a static approximation (regex/parsers, no runtime execution): same-package Java references can include same-named classes mentioned in comments (ignore them in the UI); only the repo-root tsconfig is read (`extends` and monorepo sub-packages are not resolved).
- Above 15,000 code files only the first 15,000 are scanned. The page shows a warning (`N files total, first 15,000 analyzed`); raise the cap with `--max-scan-files`.
- Auto-refresh only applies to repositories analyzed by this hub process; Linux does not support recursive `fs.watch` and falls back to no watching.
- It is a **read-only review tool**: no staging, committing, branching, merging or pushing. Keep using SourceTree / your CLI / IDE for Git operations.
- If an agent/IDE embedded browser spins forever: the page keeps an SSE connection to `/api/events`, while preview browsers often wait for `networkidle`. Automation browsers and iframes skip SSE automatically, or append `&sse=0`. For remote/container browsers `127.0.0.1` is not your machine — use port forwarding or run diff-viz inside that environment.

## Version and compatibility

Current version **1.8.0**. Since 1.0.0 the public contract (CLI flags, data format v2, hub HTTP API, agent annotation JSON) is frozen: no breaking changes within 1.x; breaking changes go to 2.0.0. Old single-file review data is still readable and upgrades automatically.

See [CHANGELOG.md](https://github.com/mdhUser/diff-viz/blob/main/CHANGELOG.md).

## Documentation

> Most detailed docs are still in Chinese; they are being translated as part of the upcoming i18n milestone.

| Document | Contents |
| --- | --- |
| [docs/cli-reference.md](https://github.com/mdhUser/diff-viz/blob/main/docs/cli-reference.md) | All commands, flags, environment variables, workspace config |
| [docs/data-contract.md](https://github.com/mdhUser/diff-viz/blob/main/docs/data-contract.md) | Data format, field semantics, HTTP API, annotation format |
| [docs/languages.md](https://github.com/mdhUser/diff-viz/blob/main/docs/languages.md) | Supported languages, custom languages, impact model |
| [docs/resources.md](https://github.com/mdhUser/diff-viz/blob/main/docs/resources.md) | Config/resource nodes, MyBatis/Spring bindings |
| [docs/database.md](https://github.com/mdhUser/diff-viz/blob/main/docs/database.md) | Database tables, SQL parsing, lazy API |
| [docs/pull-requests.md](https://github.com/mdhUser/diff-viz/blob/main/docs/pull-requests.md) | Remote PR/MR list, auth, self-hosted instances, comments |
| [docs/agent-integrations.md](https://github.com/mdhUser/diff-viz/blob/main/docs/agent-integrations.md) | Claude Code / Cursor / Codex integration |
| [docs/mcp.md](https://github.com/mdhUser/diff-viz/blob/main/docs/mcp.md) | MCP server setup, tools, agent round-trip |
| [docs/roadmap.md](https://github.com/mdhUser/diff-viz/blob/main/docs/roadmap.md) | Iteration plan and upcoming work |
| [docs/development.md](https://github.com/mdhUser/diff-viz/blob/main/docs/development.md) | Local development, tests, structure, release process |

## Development

```bash
git clone https://github.com/mdhUser/diff-viz.git
cd diff-viz
npm install
npm test
npm run typecheck
npm run build
```

Zero runtime dependencies; Node.js >= 20. See [docs/development.md](https://github.com/mdhUser/diff-viz/blob/main/docs/development.md).

## Support the project

If diff-viz saves you time, you can buy the author a coffee via WeChat:

<img src="https://raw.githubusercontent.com/mdhUser/diff-viz/main/docs/reward-wechat.jpg" alt="WeChat reward QR code" width="280" />

## License

MIT — see [LICENSE](LICENSE).
