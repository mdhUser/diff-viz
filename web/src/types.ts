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
  modules?: ReviewModule[];
  stats: {
    changedFiles: number;
    impactedFiles: number;
    additions: number;
    deletions: number;
    todos: number;
    edges?: number;
    scannedFiles?: number;
    configFiles?: number;
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
}

export type LayoutDirection = 'LR' | 'TB';
export type EdgeMode = 'impact' | 'dependency';
export type DrawerTab = 'summary' | 'diff' | 'todos';

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
