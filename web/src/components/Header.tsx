import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitBranch,
  History,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { HubProject, ReviewData } from '../types';
import { prettyRangeLabel } from '../format';

interface HeaderProps {
  data: ReviewData;
  selectedIndex: number;
  total: number;
  hasSelection: boolean;
  sidebarOpen: boolean;
  refreshing: boolean;
  openTodos: number;
  hubProjects: HubProject[];
  hubAvailable: boolean;
  currentProjectId?: string;
  onOpenRepoPanel: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleSidebar: () => void;
  onRefresh: () => void;
  onOpenComments: () => void;
  onBackToWorkspace?: () => void;
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[12.5px] font-medium tabular-nums" style={{ color: color ?? '#2f3c40' }}>
        {value}
      </span>
      <span className="text-[10.5px] text-mist-600">{label}</span>
    </div>
  );
}

export function Header({
  data,
  selectedIndex,
  total,
  hasSelection,
  sidebarOpen,
  refreshing,
  openTodos,
  hubProjects,
  hubAvailable,
  currentProjectId,
  onOpenRepoPanel,
  onPrev,
  onNext,
  onToggleSidebar,
  onRefresh,
  onOpenComments,
  onBackToWorkspace,
}: HeaderProps) {
  const { meta } = data;
  const stats = meta.stats;
  const commentCount = data.comments?.length ?? 0;
  const current = hasSelection ? selectedIndex + 1 : 0;

  return (
    <header className="topbar relative z-30 flex h-[58px] shrink-0 items-center gap-3 border-b border-line/80 px-3.5">
      {onBackToWorkspace ? (
        <button
          type="button"
          onClick={onBackToWorkspace}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-accent/25 bg-accent-soft px-2 text-[10.5px] font-medium text-accent-bright transition hover:bg-accent/15"
          title="返回工作区总览"
        >
          <ArrowLeft size={13} />
          工作区
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-mist-500 transition hover:bg-ink-750 hover:text-mist-100"
        title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
      >
        {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
      </button>

      <div className="flex items-center gap-2.5">
        <div className="logo-mark flex h-8 w-8 items-center justify-center rounded-[9px]">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6.5 7.5h4M6.5 16.5h4M13.5 7.5H18M13.5 16.5H18M10.5 7.5l3 9M10.5 16.5l3-9"
              stroke="#33449a"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <circle cx="6" cy="7.5" r="1.8" fill="#2f8f63" />
            <circle cx="6" cy="16.5" r="1.8" fill="#a97418" />
            <circle cx="18" cy="7.5" r="1.8" fill="#566fd0" />
            <circle cx="18" cy="16.5" r="1.8" fill="#c05563" />
          </svg>
        </div>
        <div className="leading-none">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-mist-50">diff-viz</span>
            <span className="rounded bg-accent-soft px-1 py-[1px] text-[8px] font-medium tracking-[0.08em] text-accent">
              LOCAL
            </span>
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-mist-600">change review</div>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-line" />

      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenRepoPanel}
          disabled={!hubAvailable}
          className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-mist-300 transition hover:bg-ink-800/70 hover:text-mist-100 disabled:cursor-default disabled:hover:bg-transparent"
          title={hubAvailable ? '切换仓库 / 查看提交历史' : meta.repo}
        >
          <GitBranch size={12.5} className="shrink-0 text-mist-600" />
          <span className="truncate font-medium">{meta.repo || 'repository'}</span>
          {hubAvailable ? <ChevronDown size={11} className="shrink-0 text-mist-600" /> : null}
        </button>
        <span className="flex shrink-0 items-center gap-1 rounded-md border border-accent/15 bg-accent-soft px-1.5 py-[3px] font-mono text-[10px] text-accent-bright">
          {meta.branch}
        </span>
        <span className="hidden max-w-[230px] truncate rounded-md border border-line bg-ink-850 px-1.5 py-[3px] font-mono text-[10px] text-mist-500 xl:inline">
          {prettyRangeLabel(meta)}
        </span>
        {commentCount > 0 ? (
          <button
            type="button"
            onClick={onOpenComments}
            className="flex shrink-0 items-center gap-1 rounded-md border border-[rgba(74,95,158,0.35)] bg-[rgba(74,95,158,0.08)] px-1.5 py-[3px] text-[9.5px] text-[#4a5f9e] transition hover:bg-[rgba(74,95,158,0.14)]"
            title={`${commentCount} 条 Reviewer 评论，点击查看全部`}
          >
            <MessageSquare size={9} />
            评论 {commentCount}
          </button>
        ) : null}
        {meta.pull?.url ? (
          <a
            href={meta.pull.url}
            target="_blank"
            rel="noreferrer"
            title={`在 ${meta.pull.host || (meta.pull.provider === 'gitlab' ? 'GitLab' : 'GitHub')} 打开`}
            className="hidden shrink-0 items-center gap-1 rounded-md border border-[rgba(196,122,44,0.35)] bg-[rgba(196,122,44,0.08)] px-1.5 py-[3px] font-mono text-[9.5px] text-[#a35f14] transition hover:bg-[rgba(196,122,44,0.14)] md:flex"
          >
            {meta.pull.provider === 'gitlab' ? 'MR' : 'PR'} #{meta.pull.number}
            <ExternalLink size={9} />
          </a>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-3.5 rounded-lg border border-line/70 bg-ink-900/60 px-3 py-1.5 lg:flex">
          <Stat value={String(stats.changedFiles)} label="变更" />
          <Stat value={`+${stats.additions}`} label="" color="#2f8f63" />
          <Stat value={`−${stats.deletions}`} label="" color="#c05563" />
          <div className="h-4 w-px bg-line" />
          <Stat value={String(stats.impactedFiles)} label="受影响" color="#435bc0" />
          <Stat value={String(openTodos)} label="待办" color="#a97418" />

        </div>

        <div className="flex items-center rounded-lg border border-line bg-ink-900/70 p-0.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasSelection}
            className="flex h-7 w-7 items-center justify-center rounded-md text-mist-400 transition hover:bg-ink-750 hover:text-mist-100 disabled:cursor-default disabled:opacity-30"
            title="上一个变更 (←)"
            aria-label="上一个变更"
          >
            <ChevronLeft size={15} />
          </button>
          <div className="flex min-w-[74px] flex-col items-center px-1 leading-none">
            <span className="font-mono text-[10.5px] tabular-nums text-mist-200">
              <span className="text-accent-bright">{current || '–'}</span>
              <span className="text-mist-600"> / {total}</span>
            </span>
            <span className="mt-1 text-[8.5px] uppercase tracking-[0.12em] text-mist-600">review</span>
          </div>
          <button
            type="button"
            onClick={onNext}
            disabled={total === 0}
            className="flex h-7 w-7 items-center justify-center rounded-md text-mist-400 transition hover:bg-ink-750 hover:text-mist-100 disabled:cursor-default disabled:opacity-30"
            title="下一个变更 (→)"
            aria-label="下一个变更"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {hubAvailable ? (
          <button
            type="button"
            onClick={onOpenRepoPanel}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-ink-900/70 text-mist-500 transition hover:border-line hover:bg-ink-750 hover:text-mist-100"
            title="仓库与提交历史"
            aria-label="仓库与提交历史"
          >
            <History size={14} />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onRefresh}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-ink-900/70 text-mist-500 transition hover:border-line hover:bg-ink-750 hover:text-mist-100"
          title="重新读取数据"
          aria-label="刷新"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>

        {meta.summarySource === 'agent' ? (
          <span className="hidden items-center gap-1 rounded-md border border-accent/25 bg-accent-soft px-1.5 py-1 text-[9.5px] text-accent-bright xl:flex">
            <Sparkles size={10} />
            Agent 总结
          </span>
        ) : null}
      </div>
    </header>
  );
}
