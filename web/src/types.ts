export type NodeStatus = 'added' | 'modified' | 'deleted' | 'impacted_only';

export type TodoSource = 'agent' | 'code_comment' | 'manual' | string;

export interface ReviewTodo {
  id: string;
  text: string;
  source: TodoSource;
  completed: boolean;
  severity?: 'high' | 'medium' | 'low' | string;
  category?: string;
  line?: number;
}

export interface ReviewNode {
  id: string;
  label: string;
  path: string;
  status: NodeStatus;
  stats: { additions: number; deletions: number };
  summary: string;
  impactAnalysis: string;
  todos: ReviewTodo[];
  diff?: string;
  oldContent?: string;
  newContent?: string;
  // v2 storage keeps the heavy fields in per-node payload files; the graph
  // payload only carries metadata plus these loading hints.
  payload?: string;
  hunkCount?: number;
  contentLoaded?: boolean;
  contentMissing?: boolean;
  language?: string;
  oldPath?: string;
  renamed?: boolean;
  untracked?: boolean;
  binary?: boolean;
  diffTruncated?: boolean;
  contentTruncated?: boolean;
  reviewed?: boolean;
  ignored?: boolean;
  impactChain?: string[];
  depth?: number;
  impactOrigins?: string[];
  imports?: string[];
  importedBy?: string[];
  reviewComments?: number;
  reviewCommentUnresolved?: number;
  // 1.3 additive: tables used by this file's SQL (ids like table:t_order).
  sqlTables?: string[];
  riskLevel?: 'high' | 'medium' | 'low' | string;
  summarySource?: 'auto' | 'agent' | string;
  impactSource?: string;
  reviewNotes?: string[];
  // 1.1 additive: module/package grouping for the swimlane view.
  kind?: 'code' | 'config';
  resourceKind?: string;
  moduleId?: string;
  moduleLabel?: string;
  modulePath?: string;
  packagePath?: string;
}

export interface ReviewComment {
  id: string;
  provider?: 'github' | 'gitlab' | string;
  kind: 'inline' | 'general';
  path?: string;
  oldPath?: string | null;
  line?: number | null;
  startLine?: number | null;
  side?: 'new' | 'old' | string;
  author?: string;
  createdAt?: string;
  body: string;
  url?: string;
  resolved?: boolean | null;
  outdated?: boolean;
  replyTo?: string | null;
  threadId?: string;
}

export interface SqlStatement {
  id: string;
  operation: string;
  sql: string;
  file: string;
  line?: number | null;
  lineEnd?: number | null;
  mapper?: string;
  dynamic?: boolean;
  changed?: boolean;
}

export interface ReviewTable {
  id: string;
  name: string;
  schema?: string | null;
  componentId?: string;
  operations?: string[];
  statementCount?: number;
  changedStatementCount?: number;
  changed?: boolean;
  impacted?: boolean;
  sources?: string[];
  payload?: string;
  statements?: SqlStatement[];
}

export interface ReviewComponent {
  id: string;
  kind: string;
  label: string;
  engine?: string;
  tables?: string[];
}

export interface ReviewEdge {
  id: string;
  source: string;
  target: string;
  relation?: string;
}

export interface ReviewMeta {
  timestamp: string;
  branch: string;
  overallSummary: string;
  mode?: string;
  rangeLabel?: string;
  baseRef?: string;
  newRef?: string;
  headRef?: string;
  impactDepth?: number;
  repo?: string;
  projectId?: string;
  reviewId?: string;
  scopeLabel?: string;
  scannedRef?: string;
  generator?: string;
  version?: string;
  reviewOrder?: string[];
  summarySource?: string;
  updatedAt?: string;
  // Set when the dependency scan hit its file cap; `truncated` drives the
  // top-of-page warning so a partial graph is never silently presented.
  resourceStats?: {
    limit: number;
    files: number;
    scanned: number;
    truncated: boolean;
  };
  scanLimit?: {
    limit: number;
    codeFiles: number;
    scanned: number;
    truncated: boolean;
  };
  warnings?: string[];
  durationMs?: number;
  workspace?: boolean;
  pull?: PullRequestInfo;
  modules?: ReviewModule[];
  db?: {
    engine: string;
    label: string;
    tables: number;
  };
  stats: {
    changedFiles: number;
    impactedFiles: number;
    additions: number;
    deletions: number;
    todos: number;
    edges?: number;
    scannedFiles?: number;
    configFiles?: number;
    tables?: number;
    comments?: number;
  };
}

export interface WorkspaceRepo {
  id: string;
  name: string;
  root: string;
  branch?: string;
  reviewId: string;
  changed: boolean;
  scopeMode?: string;
  scopeLabel?: string;
  depth: number | null;
  impactOrigins: string[];
  stats?: {
    changes?: number;
    changedFiles?: number;
    impactedFiles?: number;
    additions?: number;
    deletions?: number;
    todos?: number;
  };
}

export interface ServiceEdge {
  id?: string;
  from: string;
  to: string;
  kind: string;
  via?: string;
}

export interface WorkspaceMeta {
  reviewId?: string;
  workspace: true;
  name: string;
  file?: string;
  overallSummary?: string;
  stats: { repos: number; changed: number; impacted: number };
  repos: WorkspaceRepo[];
  serviceEdges: ServiceEdge[];
  warnings?: string[];
  notes?: string[];
}

export interface ReviewData {
  meta: ReviewMeta;
  nodes: ReviewNode[];
  edges: ReviewEdge[];
  tables?: ReviewTable[];
  components?: ReviewComponent[];
  comments?: ReviewComment[];
}

export type LayoutDirection = 'LR' | 'TB';
export type EdgeMode = 'impact' | 'dependency';
export type DrawerTab = 'summary' | 'diff' | 'todos' | 'comments';

export interface ReviewModule {
  id: string;
  label: string;
  path?: string;
  kind?: string;
  order: number;
  fileCount?: number;
  changedFiles?: number;
  impactedFiles?: number;
}

export interface HubPullRequest {
  provider: 'github' | 'gitlab' | string;
  number: number;
  title: string;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  sourceSha?: string;
  baseSha?: string;
  updatedAt?: string;
  url?: string;
  draft?: boolean;
  state?: string;
}

export interface PullRequestInfo extends HubPullRequest {
  commentCount?: number;
  unresolvedCommentCount?: number;
  baseBranch?: string;
  host?: string;
  repoPath?: string;
  webUrl?: string;
  remote?: string;
}

export interface HubProject {
  id: string;
  name: string;
  root: string;
  branch?: string;
  lastReviewId?: string | null;
}

export interface CommitInfo {
  sha: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[];
}
