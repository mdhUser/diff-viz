# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this project are recorded here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

Before releasing a new version, you must add `Added` / `Changed` / `Fixed` entries for that version and make
`npm run release:check` pass.

## [Unreleased]

### Added

- **Antigravity skill target**: `diff-viz skill install --agent antigravity` (alias `agy`) installs into `~/.gemini/config/skills` for the user scope and `.agents/skills` for the project scope. Agent names are now trimmed and case-insensitive.

### Fixed

- Preserve a node's `ignored` flag when a Review is regenerated; it previously only survived `reviewed` and todo completion state.
- `.sql` statement splitting now handles `--`, `/* */`, and MySQL `#` comments, quoted strings, backslash/doubled-quote escapes, and reports accurate statement line ranges.
- SQL table extraction is quote-aware: single-quoted literals are masked before table matching, so values such as `'from fake_table'` no longer create fake tables; `--`/`/* */` inside strings are no longer stripped from the displayed SQL.

## [1.10.0] - 2026-11-25

### Changed

- **Per-line comment bubbles**: the toolbar Bubbles toggle is gone. Every commented line now shows a compact comment badge in the diff gutter, next to its line number, with the thread count. Clicking the badge expands or collapses only that thread; the file summary bubble has its own chevron and collapses independently. Comment lines are still forced visible and the badge follows the old/new side, so comments on folded lines remain reachable.

## [1.9.2] - 2026-11-25

### Fixed

- **Hiding review bubbles no longer blanks the code diff**: `alwaysShowLines` is part of the diff viewer's memo key but not one of the props that triggers a recompute, so toggling the bubbles off made the table render empty. The requested comment lines are now stable and independent from the bubble toggle; comment anchors also use the viewer's `R-<line>` / `L-<line>` format, so comments on folded lines expand again instead of being skipped.

## [1.9.1] - 2026-11-24

### Fixed

- **Inline review bubbles**: summary and inline reviewer comments no longer float over the code diff. They are inserted as full-width rows between diff lines (the file summary above the first hunk, each comment thread directly below its line) and are shown/hidden by the **Bubbles** toggle. Code stays readable and the bubble rows scroll with the diff.

## [1.9.0] - 2026-11-24

### Added

- **Risk and confirmation visibility in the topology**: nodes can carry `riskLevel: "high" | "medium" | "low"` from Agent annotations. High-risk nodes pulse red in the graph, their sidebar rows show a warning icon, and the legend explains the red pulse; files with open review todos are highlighted amber as **To confirm N**. The Agent Skill now requires high-risk changes (auth, payments, data migrations, concurrency, wide blast radius, missing tests, etc.) to be marked with `riskLevel: "high"`.
- **Review bubbles inside the code diff**: the file summary/impact can be shown as a dismissible summary bubble over the diff, and inline reviewer comments get gutter markers that open a comment popover at the matching line. A **Bubbles** toggle shows/hides all of them without leaving the Diff tab.
- **Changed SQL is precise**: SQL statements now carry `line`/`lineEnd`, are marked `changed` only when an added line falls inside their range, and tables expose `changedStatementCount`. The table drawer defaults to changed SQL only (toggle to all), changed statements are highlighted and ordered first in the hover card; table nodes show how many SQL statements changed.

### Changed

- Chinese changelog remains at `CHANGELOG.zh-CN.md`; English is the release-notes source from v1.8.0 onward.

## [1.8.0] - 2026-11-24

### Added

- **Web UI English/Chinese toggle**: a language switcher in the top bar (also available on the workspace overview and the loading/error pages); the language is auto-detected via `?lang=en|zh` → localStorage → browser language, and the choice is persisted and written into the URL. After switching, the page title, `<html lang>`, date/number formats, and all UI copy update instantly without a refresh.
- Covers all UI copy, including the topology graph, swimlanes, file/table cards, toolbar, sidebar, detail drawer (summary / Diff / todos / reviewer comments), comments panel, repository / version chain, workspace overview and history, empty states, and error messages.
- Added `test/i18n.test.mjs`: verifies that every `t()` string has an English translation, that placeholders match, and that English values contain no Chinese.
- Note: Agent annotations, reviewer comment bodies, and server-side heuristic summaries are data content and remain in their original language; translation of CLI output and detailed documentation is planned for a later version.

## [1.7.1] - 2026-11-24

### Changed

- Docs: added an English main README (`README.md`) and migrated the Chinese version to `README.zh-CN.md`; both versions have a language switcher at the top. The English README covers quick start, the UI, remote PRs/MRs, config/database, workspace history, Agent/MCP, data privacy, limitations, and a documentation index, preparing for the international release.

### Fixed

- `diff-viz stop` now waits for the hub process to actually exit and release its file-watcher handles before returning. This fixes intermittent CI failures on Windows caused by `EBUSY: resource busy or locked` during MCP/temp-directory cleanup; the stop command is also more reliable for users.

## [1.7.0] - 2026-11-23

### Added

- **MCP stdio server (`diff-viz mcp`)**: agents can communicate with diff-viz directly through MCP tools instead of relying on shell command composition. Tools: `diff_viz_review` (generates a review; supports worktree/staged/last/range/base/commit/pr/mr, optionally with annotations), `diff_viz_get_review` (manifest / node summaries / comments), `diff_viz_get_node` (full diff / source), `diff_viz_annotate` (writes back Agent summaries / todos), `diff_viz_list_projects`, and `diff_viz_list_reviews`.
- Added `docs/mcp.md`: Cursor / Claude Code / Codex config examples, tool parameters, a typical bidirectional workflow, and security notes; `docs/agent-integrations.md` was updated accordingly.
- Added `--commit <ref>` to the CLI (works with regular reviews and MCP `scope=commit`).
- Added `test/mcp.test.mjs`: the initialize/tools/list protocol, the end-to-end review→get→annotate→list loop, and unknown-tool errors.

## [1.6.0] - 2026-11-23

### Added

- **Workspace version history**: each time `diff-viz workspace` runs again, it archives a snapshot of the previous workspace (`workspace-<hash>-<timestamp>`), while the latest version keeps its stable id. The workspace page now has a "History N" dropdown in the top-right corner showing each version's time, repository count, changed/impacted counts, and per-repository comparison scope, so you can switch back to any historical version in one click; archived versions keep the service topology and repository cards, so you can still drill into a repository review.
- Added `GET /api/workspace/history?file=<workspace file>`, which returns the latest version and the list of archived versions (with `archived`, `stats`, and `scopes`); archived snapshots carry `meta.archived / archivedAt / archivedFrom` and can be read directly via `/api/data?review=`.
- Added `test/workspace-history.test.mjs`: verifies that repeated analysis generates archives, that the stable id is not replaced, and that the history API and archived data are readable.

## [1.5.5] - 2026-11-23

### Added

- Back navigation from the workspace overview to a repository review: after entering a repository from a service card, a "← Workspace" button appears at the top and the URL keeps `&from=<workspace-review-id>`; clicking the button or using the browser back button both return to the workspace overview, and refreshing the repository review does not lose the way back.

## [1.5.4] - 2026-11-23

### Changed

- Updated the Agent Skill (`SKILL.md`) to align with CLI 1.5.3: added GitHub PR / GitLab MR (`--pr/--mr`, authentication, self-hosted instances, reviewer comments and snapshot limits), the swimlane/config/database views, `--max-scan-files`, the `comments/tables/components/meta.pull` data contract, PR/MR troubleshooting, and notes on comment data security. The old Cursor user-level skill is a self-contained copy from November 18 (including bin/src/dist); re-running `diff-viz skill install --force` replaces it with a link to the repository's thin `SKILL.md`, so subsequent updates sync automatically.

## [1.5.3] - 2026-11-23

### Fixed

- Automatic recomputation triggered by the file watcher no longer replays PR/MR reviews as the project's "remembered scope": previously, if you had opened a workspace review first (starting the watcher) and then opened a PR/MR and saved a file, the watcher would rebuild that review using the pull's range, losing all comments (reproduced with simulated fs.watch events; a regression test was added).
- When a full URL is passed to `--pr/--mr`, repository ownership is now validated: pasting a PR/MR link from another repository raises an error instead of silently analyzing the PR/MR with the same number in the current repository.
- `--base origin/main` / `--base refs/heads/main` are now normalized to `main` before fetching the target branch, so fetch no longer fails due to malformed refspec concatenation.
- The `gh` / `glab` token cache now has a 5-minute TTL and is invalidated and re-fetched immediately after a 401/403: after logging in with a new account or after a token expires, you no longer need to restart the hub.

## [1.5.2] - 2026-11-23

### Fixed

- Fixed the "has comments" filter emptying the topology graph: the toggle used to be persisted to localStorage, so after being enabled in one MR, switching to a review with only general discussion and no file-level comments filtered out every file, leaving only the toolbar and a blank canvas on the page. The filter is now temporary (not remembered across reviews) and counts only file-level comments; the button does not appear when there are no file comments, and even an empty filter shows a "Show all files" recovery prompt.
- The global comments panel also notes that "all comments are in the general discussion and not attached to files", so this is not mistaken for missing file nodes.

## [1.5.1] - 2026-11-23

### Fixed

- Comments are now displayed per file: previously each file's "Reviewer comments" drawer listed the entire MR's general discussion as well, which was repetitive and disruptive to reading. File drawers now show only that file's comments; the general discussion is folded into the global "Reviewer comments" panel (opened via "Comments N" in the top bar, "N comments" in the sidebar, or "View all MR discussion" in the drawer), grouped by file, with support for showing only unresolved comments and jumping to the corresponding file.

## [1.5.0] - 2026-11-23

### Added

- **PR/MR reviewer comments in the graph**: opening a GitHub PR / GitLab MR now syncs inline review comments and the general discussion (GitHub `pulls/<n>/comments` + `issues/<n>/comments`; GitLab `merge_requests/<iid>/notes`, skipping system notes and preserving resolved status/line numbers).
- File nodes and the left-hand file list show comment-count badges, with unresolved comments highlighted in amber; the top bar and sidebar summarize the total comment count.
- A new "Reviewer comments" tab in the detail drawer: author, time, line number, resolved/unresolved, code-changed marker, remote link, and body; the PR's general discussion is shown as well.
- A "Has comments N" toggle in the toolbar: view only files with reviewer comments (config/database nodes are hidden automatically).
- Comments are saved with the review manifest (`comments` + node `reviewComments/reviewCommentUnresolved` + `meta.pull.commentCount`); read failures only write to `meta.warnings` and do not affect review generation; added `test/comments.test.mjs` and CLI/hub integration assertions.

## [1.4.1] - 2026-11-23

### Added

- Remote PR/MR authentication automatically reuses the logged-in `gh` / `glab` CLI token (`gh auth token`, `glab auth status --show-token`), so private repositories usually no longer need manually configured environment variables; set `DIFF_VIZ_DISABLE_CLI_TOKEN=1` to disable this. Tokens are only used in the hub process's memory.

### Fixed

- Fixed token read failures caused by `glab` printing login status to stderr (the `--show-token` output is now parsed correctly).

## [1.4.0] - 2026-11-23

### Added

- **Remote PR / MR support**: the hub's "Registered repositories" dialog now has a **PR / MR** tab that directly lists GitHub pull requests / GitLab merge requests from the current repository's remote; clicking any of them automatically fetches `refs/pull/<n>/head` (or `refs/merge-requests/<iid>/head` for GitLab) and the target branch, then generates the diff topology graph from the `merge-base`. The top bar shows `PR #N · title` and the remote link.
- Automatic platform detection: parses the `origin` SSH/HTTPS address and supports GitHub, GitLab, and self-hosted instances; `GITHUB_TOKEN` / `GITLAB_TOKEN` are read only by the hub process, and custom domains can be configured via `DIFF_VIZ_PROVIDER` / `DIFF_VIZ_GITHUB_HOSTS` / `DIFF_VIZ_GITLAB_HOSTS` / `DIFF_VIZ_*_API_URL`.
- The same PR/MR reuses a stable review id (`<projectId>-pull-<number>`), so existing Agent summaries/todos/review state can be reused; `meta.pull` records the provider, number, title, author, source/target branches, and remote URL.
- Added `--pr <number|URL>` / `--mr <number|URL>` to the CLI, with `--base` able to override the target branch; added `GET /api/pulls?project=` (60-second cache; `refresh=1` forces a refresh) and `POST /api/review {pull}`.
- Added `test/remotes.test.mjs` / `test/pull-request.test.mjs`, covering platform detection, API mapping and authentication, ref fetching, CLI/hub end-to-end flows, and stable review ids; added [docs/pull-requests.md](https://github.com/mdhUser/diff-viz/blob/main/docs/pull-requests.md).

### Changed

- Docs: updated [docs/roadmap.md](https://github.com/mdhUser/diff-viz/blob/main/docs/roadmap.md), marking remote PR/MR support as completed in v1.4.0 and deferring subsequent proposals to v1.5; the README / CLI reference / data contract were updated accordingly.

### Fixed

- Implemented the per-statement 4KB SQL truncation promised in the documentation: previously only the two limits of "at most 300 tables / 200 statements per table" were enforced, and overlong statements were written verbatim into `<review>/tables/`. Statements longer than 4096 characters are now truncated for display (`statementCount` still reflects the actual count), and both per-table overflow and statement truncation are written to `meta.warnings`.

## [1.3.0] - 2026-11-20

### Added

- **Database tables and SQL view**: statically parses MyBatis Mapper XML, Java `@Select/@Insert/@Update/@Delete` annotations, and `.sql` files, aggregates them by table into database components and table nodes, and generates `reads_table` / `writes_table` edges; infers the engine from `spring.datasource` / `jdbc:` (MySQL/PostgreSQL/Oracle/SQL Server/H2/SQLite).
- Table cards show read/write badges and SQL statement counts; the swimlane view adds a database swimlane (`MySQL · N tables`); hovering shows the first 3 SQL statements (source file:line, dynamic SQL marker), and clicking opens the "Database tables" drawer to view all statements and jump to the source file's diff; a "Database tables N" toggle in the toolbar.
- SQL text is lazy-loaded per table into `<review>/tables/<payload>.json` (`storage.tablesDir`), and `/api/data` contains only metadata; added `GET /api/table?review=&table=`. Limits are 300 tables / 200 statements per table / 4KB per statement, with overflow written to `meta.warnings`.
- Data contract: top-level `tables` / `components`, `meta.db`, `meta.stats.tables`, and the edge relations `reads_table` / `writes_table`; documented in [docs/database.md](https://github.com/mdhUser/diff-viz/blob/main/docs/database.md).
- Added `test/db.test.mjs` / `test/tables.test.mjs`, covering SQL grouping, lazy-loaded storage, copying, and `/api/table`.

### Fixed

- Re-analysis (file watching, refreshing a bare hub page) now preserves the `--max-scan-files` limit instead of quietly reverting to the default 15000; the sidebar no longer duplicates the scan-truncation warning at the top of the page, and the banner is laid out as a single full-width line that can wrap.
- The background hub started by `ensureHub` no longer opens an extra bare hub tab: that tab would `POST /api/review` with default parameters, recomputing and overwriting the just-imported review, and also made `--no-open` ineffective; the final review link is still opened by the CLI.

## [1.2.0] - 2026-11-20

### Added

- **Config/resource nodes in the graph**: scans `.xml` / `.properties` / `.yml` / `.yaml` / `.sql` (at most 2000 files, 512KB per file; configs that changed are always parsed). A MyBatis Mapper's `namespace` is bound to the Java Mapper interface (`binds`), and Spring XML's `<bean class>` / `<import resource>` generate `class-ref` / `config` edges; changing a Mapper XML marks the interface and its callers as "impacted", and the impact chain continues to propagate along code dependencies.
- Incremental data-contract fields: node `kind: "config"` / `resourceKind`, `meta.stats.configFiles`, `meta.resourceStats`, and new `binds` / `config` / `class-ref` edges; XML / Properties support syntax labels and diff highlighting.
- UI: a dedicated icon and cyan "Config" badge for config nodes, a "Config N" toggle in the toolbar, a legend, and a "Config relations" section in the drawer; config changes use a dedicated automatic summary (stating how many files reference them).
- The scan cache schema was bumped to v2, and config parsing also reuses the cache keyed by `mtime + size`.
- Added [docs/resources.md](https://github.com/mdhUser/diff-viz/blob/main/docs/resources.md) describing the config graph model and its boundaries.

### Fixed

- `languageOf` now includes `xml` / `properties`, so config nodes no longer render as plain text; unrecognized XML only shows the node without generating speculative edges.

## [1.1.1] - 2026-11-20

### Fixed

- Windows CI: removed the placeholder cases in the module tests that hard-coded `/tmp`, avoiding `mkdtemp` failures on Windows; the remaining module/swimlane tests are unchanged.

## [1.1.0] - 2026-11-20

### Added

- **Swimlane view**: the topology graph can switch between "flow / swimlane". Swimlanes are grouped by module (detected from Maven/Gradle/npm/go.mod/pyproject build markers; can switch between directory/package granularity) and ordered top to bottom by dependency depth (entry layer first, data layer last), with the swimlane header showing the module path and changed/impacted counts; node cards show the module and Java package. At most 12 swimlanes are shown, with the rest merged into "Other modules"; older reviews without module fields fall back to inferring from the top-level directory.
- Hub access control: validates a `Host` allowlist to block DNS rebinding, and `/api/*` (except health) requires an access token; the link printed by the CLI includes `?token=`, which the page then exchanges for an HttpOnly cookie. The token is stored in `~/.diff-viz/token` (0600) and reused across restarts; `DIFF_VIZ_TOKEN` / `DIFF_VIZ_NO_AUTH` / `DIFF_VIZ_ALLOWED_HOSTS` are supported.
- `--max-scan-files <n>`: configurable dependency scan limit (default 15000).

### Fixed

- Dependency scanning on large repositories no longer degrades silently when truncated by the 15000-file limit: the top of the page shows a "N files total, only the first n were analyzed" warning and suggests raising the limit with `--max-scan-files`.

### Changed

- Calling the hub's `/api/*` directly from scripts such as `curl` now requires an `X-Diff-Viz-Token` header (or the `?token=` parameter); the CLI and pages add it automatically, and agents accessing links printed by `diff-viz` are unaffected. `DIFF_VIZ_TOKEN` pins the token, `DIFF_VIZ_NO_AUTH=1` disables authentication, and `DIFF_VIZ_ALLOWED_HOSTS` appends allowed hosts.

## [1.0.2] - 2026-11-20

### Fixed

- After a hub restart changed its port, previous review URLs failed with "connection refused": `ensureHub` now reuses the port remembered in the registry (unless `--port` is passed explicitly), and `diff-viz` / `serve` / `workspace` / the foreground `hub` all follow this rule, so links an agent printed earlier do not break because of a single restart.

## [1.0.1] - 2026-11-20

### Fixed

- Reviews opened in agent and IDE built-in browsers such as Cursor / DSH spun forever: the page keeps an `/api/events` SSE long connection open, and these browser tools usually wait for `networkidle` before considering the page loaded, so it never arrives. SSE is now skipped automatically when an automated browser is detected (`navigator.webdriver`) or the page is embedded in an iframe (the refresh button can still fetch the latest data manually), and the URL parameters `?sse=0` / `?sse=1` explicitly disable/enable it.
- Docs addition: if an agent's browser runs in a remote/container environment, `127.0.0.1` points to that environment rather than your computer, so port forwarding is required, or run `diff-viz` in that environment directly.

## [1.0.0] - 2026-11-19

**1.0 = public contract freeze.** The earlier 0.x minor versions (0.7 / 0.8 / 0.9 / 0.10) were incremented one by one according to semver rules; starting with 1.0.0, the interfaces below are considered stable, no breaking changes will be made within 1.x, and breaking changes go into 2.0.0.

### Changed

- **CLI contract**: the `review` / `serve` / `annotate` / `hub` / `stop` / `workspace` / `skill install` commands remain compatible with existing arguments; adding arguments is not a breaking change.
- **Data contract**: `.diff-review-data.json` (a `storage.format: 2` manifest) + node contents in `<data>.nodes/`, with fields described under "Data contract" in the README; added fields remain backward compatible.
- **Hub HTTP API**: `/api/health`, `/api/hub`, `/api/projects`, `/api/commits`, `/api/review`, `/api/import`, `/api/data` (including `?full=1`), `/api/node`, `/api/state`, `/api/annotate`, `/api/events`, `/api/workspace`.
- **Agent annotation contract**: `{ meta: { overallSummary }, nodes: { "<path>": { summary, impactAnalysis, todos } } }`.
- Backward compatibility: v1 single-file reviews can still be read and are upgraded automatically to the split format on the first write-back; while an older hub process is still running, the CLI's `review` / `serve` automatically fall back to a whole-review import, and `annotate` prompts you to restart the hub.
- Roll-up of the capabilities from 0.7–0.10: multi-language dependency resolution (including custom languages), parse/state caching, watch + SSE auto-refresh, impact chains, multi-repository workspace topology, split storage with on-demand node content loading, batched historical review reads (a 2,900-file repository single commit: 57–69 s → ~1 s), and Agent annotations writable on any review and reused across reviews by "project + file + normalized diff" (including the overall summary).

## [0.10.1] - 2026-11-19

### Fixed

- The overall summary (`meta.overallSummary`) used to be reused only when the change sets were exactly identical: after committing on the same branch and switching to a different commit review, a single extra or missing file made the page fall back to an auto-generated sentence (even though file-level Agent summaries were still reused). Overlap is now calculated from each changed file's "path + normalized diff", and the overall summary is also reused when the current review overlaps ≥50% with an annotated summary's changes (with at least 3 files, covering ≥50% of that summary); reviews with completely different changes still do not inherit the old summary.

## [0.10.0] - 2026-11-19

### Added

- `diff-viz annotate --review <id> --annotations <file>`: writes Agent annotations directly to an existing review in the hub, without re-analyzing or generating data files. This is useful for commit reviews opened from the version chain in the UI — previously such reviews could only show auto-generated summaries, but an agent can now add summaries/impact/todos and they appear after refreshing the page.
- The sidebar's "Change overview" always shows **Agent summary N/M** coverage: when it is 0, a muted style indicates that there are no Agent annotations yet, instead of everything looking auto-generated with no hint about where to add them.

### Fixed

- Agent annotations were lost after committing or switching reviews: annotations previously lived only in the review snapshot they were written to, so after committing, the commit review in the version chain was a new reviewId (and the worktree review could be automatically recomputed to empty changes), which made all summaries disappear. Now the hub remembers the last Agent summary/impact analysis/todos by "project + file path + change content (diff with index lines removed)", stored in `~/.diff-viz/annotations/<projectId>.json`; they are reused automatically when opening or regenerating a review with the same changes (worktree → commit → range), and existing annotated snapshots are backfilled once. **The overall summary at the top of a review (`meta.overallSummary`) is also remembered and reused by "set of changed files + their respective diffs"**, so regenerating a review no longer falls back to an auto-generated sentence. Changes with different content do not reuse old summaries.

## [0.9.2] - 2026-11-18

### Fixed

- In the single-repository view, `meta.overallSummary` was hard-clamped by `line-clamp-5` (a 242-character summary showed only about 180 characters) with no way to expand it, so it looked like "the Agent summary did not render". Summaries longer than 120 characters now show "Expand full summary / Collapse summary".
- Added an `Agent summary N/M` badge to the sidebar, telling users directly how many files have an Agent-written summary (without one they get only heuristic summaries, which makes it look as if there is no information).

## [0.9.1] - 2026-11-18

### Fixed

- The workspace page did not render `meta.overallSummary`: the key cross-service summary existed only in the JSON and was invisible on the page. A "Cross-service summary" section was added at the top (expanded by default, collapsible); the single-repository view still shows it in the left-hand "Change overview".

## [0.9.0] - 2026-11-18

### Added

- Workspaces support specifying the comparison scope per repository: `repos[].scope` can be `worktree` / `staged` / `last` / `range` / `base` / `commit`, with the workspace-level `scope` acting as the default. Comparing the same target branch across repositories no longer requires manually generating a range review for each repository.
- Service cards show the comparison scope actually used by each repository (`scopeMode` / `scopeLabel`), so the confusion of seeing "all 5 repositories changed" without knowing what they were compared against is gone.

### Fixed

- Workspace notices no longer confuse "notes" with "errors": added `meta.notes` (neutral color), and `meta.warnings` now uses an amber warning style instead of masquerading as a red error.
- The version chain used to run `git log --all` by default, pulling in colleagues' remote branches and looking like "history that is not the current branch"; it now loads only the current branch by default, the repository panel can switch to "All branches", and the branch names in the project list are refreshed accordingly.
- Historical review (commit / range) analysis used to run `git show` once per source file: clicking a commit in a repository with 2945 code files took 57–69 s, during which the hub's single thread was saturated and the page stayed stuck on "Generating review…". This now uses chunked batch reads via `git cat-file --batch`, and the old and new contents of changed files are also read in batches; a single commit review in the same repository dropped to about 1–2.5 s (`meta.durationMs` measured 938 ms / 2155 ms).
- Added the missing `GitRepo` / `scanRepository` imports in `test/git.test.mjs` (the two batch blob-read tests previously threw `ReferenceError` immediately).

## [0.8.1] - 2026-11-18

### Fixed

- On Windows, when the hub imported a review by `dataPath`, `fs.realpathSync` returned an 8.3 short path (`RUNNER~1`) while the target path was a long path, so the "data is inside the repository" check failed and the fallback to a full upload reported a format error. Switched to `realpathSync.native` to normalize both paths to the same form.
- Workspace template tests now use `os.tmpdir()` and no longer assume POSIX `/tmp`.

> Windows CI for 0.8.0 was red because of this; 0.8.1 is a patch release for the same set of changes.

## [0.8.0] - 2026-11-18

### Added

- Multi-repository workspaces: `diff-viz workspace` reads `diff-viz.workspace.json`, analyzes multiple repositories at once, and generates a service-level change topology; `workspace --init` scans sibling repositories to generate a template, and `--workspace <file>` specifies a different file.
- Cross-service dependency detection: automatically reads `package.json` / `pom.xml` / `go.mod` / `build.gradle(.kts)` / `*.csproj` / `composer.json` and matches dependency coordinates against the artifact coordinates of sibling repositories; RPC / HTTP calls that cannot be reliably parsed statically get supplementary edges via `links` declarations.
- Cross-service impact propagation: after a repository changes, repositories that depend on it are marked "impacted" and given a level, and are highlighted on the service-level graph according to dependency direction; clicking a service card opens that repository's existing file-level topology.

### Changed

- **Review storage switched to a split format (solving the large-file problem)**: `.diff-review-data.json` now keeps only `meta` / `edges` / node metadata, while `diff`, `oldContent`, and `newContent` are split into a sibling `<data>.nodes/` directory (`storage.format: 2`); hub snapshots likewise changed to `<reviewId>/manifest.json` + `nodes/`. `annotate` now rewrites only the manifest, and with `--node` it no longer reads or rewrites any node content files. Measured on an 84 MB / 120-node review: `annotate --node` went from 2.9 s with a 670 MB peak to 0.06 s and 60 MB (warm cache: 0.43 s / 545 MB); without `--node` it likewise writes only the manifest.
- Browsers load node content on demand: `/api/data` returns only the manifest, and `GET /api/node?review=<id>&id=<path>` is requested only when a detail drawer is opened; switching files within the same review does not re-download the entire data set. Older scripts that need the full data can use `/api/data?review=<id>&full=1`.
- The hub's `POST /api/state` (toggling TODOs / marking a review / ignoring) now modifies only the manifest instead of reading and writing the entire review; `annotate` now syncs to the hub via the new `POST /api/annotate`, uploading only annotations.
- CLI → hub imports support `dataPath`: when the data file is inside the repository, the hub copies node files directly and no longer serializes the entire review into the HTTP body (cross-repository/external paths still fall back to a full upload).

### Fixed

- Old single-file reviews (`.diff-review-data.json` or `~/.diff-viz/reviews/<id>.json`) can still be read; they are upgraded automatically to the split format on the first write-back, and the hub can also continue to load old snapshots.
- If an older hub process is still running during the upgrade: `review` / `serve` automatically fall back to a full upload instead of reporting an error; `annotate` prompts you to restart the hub before viewing annotations (it will not re-read and re-write the entire large file just to sync).
- The `<data>.nodes/` directory is no longer treated as untracked by `git status`: when the data file is written, the node directory is also added to `.git/info/exclude`, and untracked-file scans skip that directory as well.

## [0.7.1] - 2026-11-18

### Fixed

- On Windows, `diff-viz skill install` now defaults to copying `SKILL.md`: creating symlinks on Windows requires developer mode, and it previously fell back silently; it now copies directly, and `--dry-run` reports this accurately.
- Test scripts now use `node --test` to discover test cases automatically, instead of relying on shell expansion of `test/*.test.mjs` (Windows cmd does not expand wildcards, so tests could not run on CI at all).

### Changed

- Expanded the CI matrix to `ubuntu-latest` / `macos-latest` / `windows-latest`, and added Node 24 on ubuntu.
- Fixed three platform assumptions: Windows 8.3 short paths, symlink assertions, and CRLF line endings.

## [0.7.0] - 2026-11-18

### Added

- Rust / Kotlin / C# / Ruby dependency resolution: `mod` and `use crate::…` map to `.rs` / `mod.rs`, `import` and `using` are indexed by declared package name or namespace + file name, and `require_relative` resolves by relative path.
- `.diff-viz/languages.json` (or `--languages <file>`): register custom languages with declarative JSON, supporting the `package` / `relative` resolution strategies and `ignorePrefixes` to filter out standard libraries.
- Dependency resolution now dispatches through a language registry, so adding a language no longer requires touching the scanner.

### Changed

- Invalid language configs or missing files now raise an error directly, instead of silently degrading to "no dependency edges".

## [0.6.1] - 2026-11-17

### Added

- `diff-viz skill install`: registers the thin `SKILL.md` in DSH / Claude Code / Cursor / shared agents skill directories, supporting `--agent`, `--scope user|project`, `--dir`, `--copy`, `--force`, and `--dry-run`.
- After installation, a skill directory only needs `SKILL.md`, and copying `bin/src/dist` is no longer required.

### Changed

- Commands in `SKILL.md` now use the installed `diff-viz` (`npx -y diff-viz-cli` when not on PATH), falling back to `$SKILL_DIR/bin/diff-viz.mjs` only in source/offline mode.
- `npm run package:skill` now produces a thin package containing only `SKILL.md` by default; the offline self-contained package is built with `npm run package:skill:standalone`.

## [0.6.0] - 2026-11-17

### Added

- The hub watches analyzed repositories for file changes, automatically recomputes after a 700 ms debounce, and notifies pages to refresh via SSE (`/api/events`); `DIFF_VIZ_NO_WATCH=1` disables this. Historical reviews of the commit / range kind do not participate in automatic recomputation.
- File-level parse cache: keyed by `mtime + size`, so only changed files are re-parsed. Measured on 1200 files: 107 ms cold scan, 24 ms warm scan; the cache lives in `~/.diff-viz/cache/` and `DIFF_VIZ_NO_CACHE=1` disables it.
- Impacted files record an `impactChain`, and the detail drawer shows the propagation chain "A → B → C → D".
- Node-level "ignore": greys out files unrelated to the current change, writes the state back to the review, and syncs it to the hub.
- `annotate --node <path>`: applies annotations only to the specified node.

### Changed

- First published to npm (package name `diff-viz-cli`, command still `diff-viz`): install and use it with `npx diff-viz-cli` or `npm install -g diff-viz-cli`, no longer needing to clone the repository. `npm publish` now automatically runs the release check, type checking, tests, and build beforehand.
- The default impact analysis depth increased from 2 to 3 (`--impact-depth` can still be raised to 6).
- The state directory now uses count-based LRU cleanup (keeping the 50 most recent by default, adjustable via `DIFF_VIZ_KEEP_REVIEWS`), while always preserving each repository's `lastReviewId`.
- The `~/.diff-viz` directory is now tightened to 0700 and review files to 0600, and historical file permissions are corrected on startup.

## [0.5.0] - 2026-11-17

### Added

- The repository panel can add a local repository directly by path (`POST /api/projects`), automatically resolving it to the Git repository root and validating that the path exists and is indeed a Git repository.
- The repository panel supports removing a repository (`DELETE /api/projects?id=`), which only affects the list and does not delete existing review data.

### Changed

- The data file `.diff-review-data.json` is now automatically added to `.git/info/exclude` on first write, so it no longer appears in the user's `git status` and full source code is not accidentally committed. The user's `.gitignore` is left untouched.

## [0.4.0] - 2026-11-16

### Added

- Version chain (commit graph): draws the commit DAG by parent-child relationships in the repository panel.
- Branch, tag, and `HEAD` reference badges; visualization of lane forking/merging for merge commits.
- Loads up to 80 commits (`git log --all --date-order`); click any commit to view its historical diff.
- Historical reviews scan dependencies against the Git tree at commit time instead of substituting the current working tree.
- `GET /api/commits` returns `parents` and `refs` fields.

### Changed

- The package name was adjusted to `diff-viz-cli` (command still `diff-viz`), preparing for direct execution via `npx diff-viz-cli`.
- The published package now keeps only `bin` / `src` / `dist` and documentation, no longer including `docs/` or `scripts/`, shrinking the size from 4.6 MB to about 330 kB.

## [0.3.0] - 2026-11-16

### Added

- A single long-running hub process: one port serves multiple projects and multiple analyses.
- The CLI became a hub client: it exits immediately after registering a review, instead of starting a long-running process for each analysis.
- Repository switcher panel; choose the current workspace from registered repositories.
- Historical commit reviews: a list of recent commits, generating diffs and dependency topology per commit.
- `diff-viz hub` / `diff-viz stop` commands.
- Automatically falls back to the system temp directory when the hub state directory is not writable; `DIFF_VIZ_HOME` is supported.
- Hub state write-back and `annotate` synchronization.

### Changed

- `serve` now registers existing data with the hub instead of occupying a separate port.
- Checkbox state is written back to the hub's review cache, and `localStorage` is isolated per review.

## [0.2.0] - 2026-11-16

### Added

- Java dependency resolution: regular imports, `import static`, and package wildcard imports.
- Detection of same-package Java class references (without imports).
- Builds an FQCN index from `package` + file name, accommodating Maven / Gradle / multi-module directory layouts.
- Inner class fallback (`Outer.Inner` → `Outer.java`).
- Java diff syntax highlighting.

### Fixed

- `tsc` was unavailable because CI lacked `devDependencies`.

## [0.1.0] - 2026-11-16

### Added

- A zero-runtime-dependency Node CLI: worktree, staged, latest commit, commit range, and base comparison.
- JS/TS (tsconfig `baseUrl` / `paths`), Python, and Go dependency resolution and impact analysis.
- React Flow + dagre change topology, status colors, and impact/dependency direction switching.
- Detail drawer: summary and impact, unified/side-by-side diff, TODO/FIXME scanning and checkboxes.
- Agent annotation merging, `SKILL.md`, a local HTTP server, and automatic browser opening.
- A soft light theme, draggable left/right panels, MiniMap, and keyboard review navigation.
- Prebuilt `dist/`, so it runs without installing frontend dependencies.

[Unreleased]: https://github.com/mdhUser/diff-viz/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/mdhUser/diff-viz/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/mdhUser/diff-viz/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/mdhUser/diff-viz/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mdhUser/diff-viz/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mdhUser/diff-viz/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mdhUser/diff-viz/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mdhUser/diff-viz/releases/tag/v0.1.0
