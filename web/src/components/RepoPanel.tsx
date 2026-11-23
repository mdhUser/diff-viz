import { useEffect, useState } from 'react';
import {
  Check,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  History,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { CommitInfo, HubProject, HubPullRequest } from '../types';
import { CommitGraph } from './CommitGraph';
import { apiFetch, describeResponseFailure, responseErrorDetail } from '../api';
import { cn } from '../cn';

interface RepoPanelProps {
  open: boolean;
  projects: HubProject[];
  currentProjectId?: string;
  currentSha?: string;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onOpenWorktree: (projectId: string) => void;
  onOpenCommit: (projectId: string, commit: CommitInfo) => void;
  onOpenPull: (projectId: string, pull: HubPullRequest) => void;
  onRefreshProjects: () => Promise<void> | void;
}

export function RepoPanel({
  open,
  projects,
  currentProjectId,
  currentSha,
  busy,
  error,
  onClose,
  onOpenWorktree,
  onOpenCommit,
  onOpenPull,
  onRefreshProjects,
}: RepoPanelProps) {
  const [selectedId, setSelectedId] = useState(currentProjectId ?? projects[0]?.id ?? '');
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [allBranches, setAllBranches] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [view, setView] = useState<'commits' | 'pulls'>('commits');
  const [pulls, setPulls] = useState<HubPullRequest[]>([]);
  const [pullsInfo, setPullsInfo] = useState<{ provider?: string; host?: string } | null>(null);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [pullsError, setPullsError] = useState<string | null>(null);
  const [pullsRefresh, setPullsRefresh] = useState(0);
  const [newRoot, setNewRoot] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const addProject = async () => {
    const root = newRoot.trim();
    if (!root || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const response = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        project?: HubProject;
        error?: string;
      };
      if (!response.ok || !payload.project) {
        throw new Error(describeResponseFailure(response, payload.error));
      }
      setNewRoot('');
      setSelectedId(payload.project.id);
      await onRefreshProjects();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  };

  const removeProject = async (projectId: string) => {
    setAddError(null);
    try {
      const response = await apiFetch(`/api/projects?id=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(describeResponseFailure(response, await responseErrorDetail(response)));
      }
      await onRefreshProjects();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedId(currentProjectId ?? projects[0]?.id ?? '');
  }, [open, currentProjectId, projects]);

  useEffect(() => {
    if (!open || !selectedId) return undefined;
    let cancelled = false;
    setLoadingCommits(true);
    setCommitsError(null);
    apiFetch(`/api/commits?project=${encodeURIComponent(selectedId)}&all=${allBranches ? '1' : '0'}`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(describeResponseFailure(response, await responseErrorDetail(response)));
        }
        const payload = (await response.json()) as { commits?: CommitInfo[]; branch?: string };
        if (!cancelled) {
          setCommits(payload.commits ?? []);
          setBranch(payload.branch ?? null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) setCommitsError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoadingCommits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedId, allBranches]);

  useEffect(() => {
    if (!open || !selectedId || view !== 'pulls') return undefined;
    let cancelled = false;
    setLoadingPulls(true);
    setPullsError(null);
    apiFetch(
      `/api/pulls?project=${encodeURIComponent(selectedId)}${pullsRefresh ? '&refresh=1' : ''}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(describeResponseFailure(response, await responseErrorDetail(response)));
        }
        const payload = (await response.json()) as {
          pulls?: HubPullRequest[];
          provider?: string;
          host?: string;
        };
        if (!cancelled) {
          setPulls(payload.pulls ?? []);
          setPullsInfo({ provider: payload.provider, host: payload.host });
        }
      })
      .catch((loadError) => {
        if (!cancelled) setPullsError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoadingPulls(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedId, view, pullsRefresh]);

  if (!open) return null;
  const selectedProject = projects.find((project) => project.id === selectedId) ?? projects[0];
  const projectCommits = commits;
  const formatUpdated = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  const pullHint = pullsError?.includes('鉴权') || pullsError?.includes('权限') || pullsError?.includes('限流')
    ? '私有仓库需要 token：GitHub 设置 GITHUB_TOKEN，GitLab 设置 GITLAB_TOKEN，然后重启 hub。'
    : pullsError?.includes('无法识别远端平台')
      ? '自建 GitLab / GitHub 企业版：设置 DIFF_VIZ_PROVIDER=gitlab|github 后重启 hub。'
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#1b292d]/20 px-4 pb-6 pt-[72px] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[76vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border border-line bg-[#fffdf8] shadow-[0_30px_80px_-40px_rgba(60,50,30,0.45)] md:flex-row">
        <div className="flex w-full shrink-0 flex-col border-b border-line/80 bg-ink-850/50 md:w-[250px] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-4 pb-3 pt-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-mist-200">
              <FolderGit2 size={13} className="text-accent" />
              已注册仓库
            </div>
            <span className="font-mono text-[9px] text-mist-600">{projects.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {projects.length === 0 ? (
              <div className="px-2 py-6 text-[10.5px] leading-5 text-mist-500">
                还没有仓库。在下面填仓库绝对路径添加，或在目标仓库运行一次 <code className="font-mono">diff-viz</code>。
              </div>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="group relative mb-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(project.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
                    project.id === selectedId
                      ? 'border-accent/25 bg-accent-soft'
                      : 'border-transparent hover:bg-ink-800/70',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      project.id === selectedId ? 'bg-accent/15 text-accent-bright' : 'bg-ink-800 text-mist-500',
                    )}
                  >
                    <GitBranch size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-mist-200">{project.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[8.5px] text-mist-600">{project.branch}</span>
                  </span>
                  {project.id === currentProjectId ? <Check size={11} className="shrink-0 text-mint" /> : null}
                </button>
                <button
                  type="button"
                  onClick={() => void removeProject(project.id)}
                  aria-label={`移除 ${project.name}`}
                  title="从列表移除"
                  className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded bg-[#fffdf8] text-mist-600 transition hover:text-rose group-hover:flex"
                >
                  <X size={9} />
                </button>
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addProject();
            }}
            className="border-t border-line/80 px-2 py-2"
          >
            <div className="flex items-center gap-1">
              <input
                value={newRoot}
                onChange={(event) => {
                  setNewRoot(event.target.value);
                  setAddError(null);
                }}
                placeholder="/绝对路径/到/git/仓库"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-line bg-ink-900 px-2 py-1 font-mono text-[9.5px] text-mist-200 outline-none transition placeholder:text-mist-600 focus:border-accent/40"
              />
              <button
                type="submit"
                disabled={!newRoot.trim() || adding}
                aria-label="添加仓库"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent-soft text-accent-bright transition hover:bg-accent/15 disabled:opacity-40"
              >
                {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={12} />}
              </button>
            </div>
            {addError ? (
              <div className="mt-1 break-words px-0.5 text-[9px] leading-4 text-rose">{addError}</div>
            ) : null}
          </form>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line/80 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-mist-100">
                <History size={13} className="text-accent" />
                {selectedProject?.name ?? '提交历史'}
              </div>
              <div className="mt-1 truncate font-mono text-[9px] text-mist-600">
                {selectedProject?.root ?? '选择左侧仓库'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mist-500 transition hover:bg-ink-800 hover:text-mist-100"
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <button
              type="button"
              disabled={!selectedProject || busy}
              onClick={() => selectedProject && onOpenWorktree(selectedProject.id)}
              className="mb-3 flex w-full items-center gap-3 rounded-xl border border-line bg-ink-850/60 px-3 py-3 text-left transition hover:border-accent/30 hover:bg-accent-soft/40 disabled:opacity-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mint/10 text-mint">
                <GitBranch size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-mist-200">当前工作区</span>
                <span className="mt-0.5 block text-[9.5px] text-mist-500">未提交 / 已暂存的改动</span>
              </span>
              <span className="text-[9px] text-mist-600">打开</span>
            </button>

            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setView('commits')}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9.5px] transition',
                    view === 'commits'
                      ? 'border-accent/25 bg-accent-soft text-accent-bright'
                      : 'border-transparent text-mist-600 hover:text-mist-400',
                  )}
                  title="按提交查看历史"
                >
                  <History size={10} />
                  版本链条
                </button>
                <button
                  type="button"
                  onClick={() => setView('pulls')}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9.5px] transition',
                    view === 'pulls'
                      ? 'border-accent/25 bg-accent-soft text-accent-bright'
                      : 'border-transparent text-mist-600 hover:text-mist-400',
                  )}
                  title="直接打开远端 PR / MR 的 diff 图"
                >
                  <GitPullRequest size={10} />
                  PR / MR
                </button>
              </div>

              {view === 'commits' ? (
                <span className="flex shrink-0 items-center gap-1">
                  {branch ? (
                    <span
                      className="max-w-[150px] truncate rounded border border-line px-1 py-0.5 font-mono text-[8.5px] text-mist-600"
                      title={`当前分支：${branch}`}
                    >
                      {branch}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAllBranches(false)}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[9px] transition',
                      allBranches
                        ? 'border-transparent text-mist-600 hover:text-mist-400'
                        : 'border-accent/25 bg-accent-soft text-accent-bright',
                    )}
                    title="只显示当前分支的历史"
                  >
                    当前分支
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllBranches(true)}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[9px] transition',
                      allBranches
                        ? 'border-accent/25 bg-accent-soft text-accent-bright'
                        : 'border-transparent text-mist-600 hover:text-mist-400',
                    )}
                    title="包含所有分支（含他人的远程分支）"
                  >
                    全部分支
                  </button>
                  {loadingCommits ? <Loader2 size={11} className="animate-spin text-accent" /> : null}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  {pullsInfo?.host ? (
                    <span
                      className="max-w-[180px] truncate rounded border border-line px-1 py-0.5 font-mono text-[8.5px] text-mist-600"
                      title={`${pullsInfo.provider === 'gitlab' ? 'GitLab' : 'GitHub'} · ${pullsInfo.host}`}
                    >
                      {pullsInfo.provider === 'gitlab' ? 'GitLab' : 'GitHub'} · {pullsInfo.host}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPullsRefresh((value) => value + 1)}
                    className="flex h-5 w-5 items-center justify-center rounded border border-line text-mist-600 transition hover:text-mist-300"
                    title="刷新 PR / MR 列表"
                  >
                    <RefreshCw size={10} className={loadingPulls ? 'animate-spin' : ''} />
                  </button>
                </span>
              )}
            </div>

            {view === 'commits' ? (
              <>
                {commitsError ? (
                  <div className="rounded-lg border border-rose/20 bg-rose/5 px-3 py-2 text-[10px] text-rose">
                    读取提交历史失败：{commitsError}
                  </div>
                ) : null}
                <CommitGraph
                  commits={projectCommits}
                  currentSha={currentSha}
                  disabled={busy}
                  onSelect={(commit) => {
                    if (selectedProject) onOpenCommit(selectedProject.id, commit);
                  }}
                />
              </>
            ) : (
              <div className="space-y-1.5">
                {pullsError ? (
                  <div className="rounded-lg border border-rose/20 bg-rose/5 px-3 py-2 text-[10px] leading-5 text-rose">
                    <div>读取 PR / MR 失败：{pullsError}</div>
                    {pullHint ? <div className="mt-1 text-mist-500">{pullHint}</div> : null}
                  </div>
                ) : null}
                {loadingPulls && pulls.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-850/40 px-3 py-4 text-[10px] text-mist-500">
                    <Loader2 size={12} className="animate-spin text-accent" />
                    正在读取远端 PR / MR…
                  </div>
                ) : null}
                {!loadingPulls && !pullsError && pulls.length === 0 ? (
                  <div className="rounded-lg border border-line bg-ink-850/40 px-3 py-5 text-center text-[10px] leading-5 text-mist-500">
                    没有开放的 PR / MR。
                    <br />
                    合并请求创建后会出现在这里，点击即可生成 diff 图。
                  </div>
                ) : null}
                {pulls.map((pull) => (
                  <button
                    key={pull.number}
                    type="button"
                    disabled={busy}
                    onClick={() => selectedProject && onOpenPull(selectedProject.id, pull)}
                    className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-ink-850/50 px-3 py-2.5 text-left transition hover:border-accent/30 hover:bg-accent-soft/40 disabled:opacity-50"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-bright">
                      {pull.draft ? <GitMerge size={13} /> : <GitPullRequest size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="shrink-0 font-mono text-[9.5px] text-mist-600">#{pull.number}</span>
                        <span className="truncate text-[11px] font-medium text-mist-200" title={pull.title}>
                          {pull.title}
                        </span>
                        {pull.draft ? (
                          <span className="shrink-0 rounded border border-line px-1 py-0.5 text-[8px] text-mist-600">
                            草稿
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8.5px] text-mist-600">
                        {pull.author ? <span>{pull.author}</span> : null}
                        <span className="truncate font-mono">
                          {pull.sourceBranch} → {pull.targetBranch}
                        </span>
                        {pull.updatedAt ? <span>{formatUpdated(pull.updatedAt)}</span> : null}
                      </span>
                    </span>
                    <ExternalLink size={10} className="mt-1 shrink-0 text-mist-600" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {busy ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[#fffdf8]/80 backdrop-blur-[2px]">
            <div className="flex items-center gap-2 rounded-full border border-line bg-[#fffdf8] px-3 py-2 text-[10.5px] text-mist-400 shadow-sm">
              <RefreshCw size={12} className="animate-spin text-accent" />
              正在生成 Review…
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-x-4 bottom-4 rounded-lg border border-rose/20 bg-[#fdf2f3] px-3 py-2 text-[10px] text-rose">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
