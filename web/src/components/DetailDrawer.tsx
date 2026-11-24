import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Circle,
  Copy,
  FileCode2,
  GitCompareArrows,
  ListChecks,
  MessageSquare,
  EyeOff,
  Sparkles,
  X,
} from 'lucide-react';
import type { DrawerTab, ReviewData, ReviewNode, ReviewTodo } from '../types';
import { STATUS_META } from '../status';
import { languageLabel } from '../language';
import { cn } from '../cn';
import { useI18n } from '../i18n';
import { SummaryTab } from './tabs/SummaryTab';
import { DiffTab } from './tabs/DiffTab';
import { TodosTab } from './tabs/TodosTab';
import { CommentsTab } from './tabs/CommentsTab';

interface DetailDrawerProps {
  node: ReviewNode;
  data: ReviewData;
  tab: DrawerTab;
  todos: ReviewTodo[];
  reviewed: boolean;
  ignored: boolean;
  isTodoDone: (todo: ReviewTodo) => boolean;
  serverOnline: boolean;
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
  onSelectNode: (id: string) => void;
  onToggleTodo: (todo: ReviewTodo, completed: boolean) => void;
  onToggleReviewed: () => void;
  onToggleIgnored: () => void;
  onAddTodo: (text: string) => Promise<boolean>;
  onOpenAllComments?: () => void;
}

export function DetailDrawer({
  node,
  data,
  tab,
  todos,
  reviewed,
  ignored,
  isTodoDone,
  serverOnline,
  onTabChange,
  onClose,
  onSelectNode,
  onToggleTodo,
  onToggleReviewed,
  onToggleIgnored,
  onAddTodo,
  onOpenAllComments,
}: DetailDrawerProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const meta = STATUS_META[node.status];
  const Icon = meta.icon;
  const hunkCount = node.hunkCount ?? (node.diff ? (node.diff.match(/^@@/gm) || []).length : 0);
  const todoOpen = todos.filter((todo) => !isTodoDone(todo)).length;
  const commentCount = node.reviewComments ?? 0;
  const unresolvedComments = node.reviewCommentUnresolved ?? 0;

  useEffect(() => {
    setCopied(false);
  }, [node.id]);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(node.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="animate-drawer relative z-20 flex h-full w-full min-w-0 flex-col border-l border-line/90 bg-[#fbf9f3] shadow-[-24px_0_60px_-38px_rgba(60,50,30,0.35)]">
      <div className="shrink-0 border-b border-line/80 px-5 pb-0 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9.5px] font-medium"
              style={{ color: meta.color, background: meta.soft, borderColor: meta.border }}
            >
              <Icon size={10} />
              {t(meta.label)}
            </span>
            {node.status === 'impacted_only' ? (
              <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[8.5px] text-mist-600">
                depth {node.depth ?? 1}
              </span>
            ) : null}
            {node.untracked ? (
              <span className="rounded border border-line px-1.5 py-0.5 text-[8.5px] text-mist-600">untracked</span>
            ) : null}
            {node.binary ? (
              <span className="rounded border border-line px-1.5 py-0.5 text-[8.5px] text-mist-600">binary</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={copyPath}
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[9.5px] text-mist-600 transition hover:bg-ink-800 hover:text-mist-200"
              title={t('复制路径')}
            >
              <Copy size={11} />
              {copied ? t('已复制') : t('复制路径')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-mist-500 transition hover:bg-ink-800 hover:text-mist-100"
              aria-label={t('关闭详情')}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold leading-6 tracking-[-0.01em] text-mist-50">
              {node.label}
            </h2>
            <div className="mt-0.5 truncate font-mono text-[9.5px] text-mist-600" title={node.path}>
              {node.path}
            </div>
            {node.renamed && node.oldPath ? (
              <div className="mt-1 font-mono text-[9px] text-mist-600">
                {t('原路径')} <span className="text-mist-500">{node.oldPath}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onToggleReviewed}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[9.5px] transition',
              reviewed
                ? 'border-mint/30 bg-mint/10 text-mint'
                : 'border-line bg-ink-850 text-mist-500 hover:border-accent/30 hover:text-mist-200',
            )}
          >
            {reviewed ? <CheckCircle2 size={11} /> : <Circle size={11} />}
            {reviewed ? t('已 Review') : t('标记 Review')}
          </button>
          <button
            type="button"
            onClick={onToggleIgnored}
            title={ignored ? t('取消忽略') : t('标记为无关改动，图上弱化显示')}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[9.5px] transition',
              ignored
                ? 'border-line bg-ink-800 text-mist-400'
                : 'border-line bg-ink-850 text-mist-600 hover:border-accent/30 hover:text-mist-300',
            )}
          >
            <EyeOff size={11} />
            {ignored ? t('已忽略') : t('忽略')}
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-3 text-[9.5px] text-mist-600">
          {node.status === 'impacted_only' ? (
            <span className="text-mist-400">{t('未修改 · 依赖变更影响')}</span>
          ) : (
            <>
              <span className="font-mono text-mint">+{node.stats.additions}</span>
              <span className="font-mono text-rose">−{node.stats.deletions}</span>
              {hunkCount > 0 ? <span className="font-mono">{t('{count} 处改动', { count: hunkCount })}</span> : null}
              <span className="font-mono">{languageLabel(node.language)}</span>
            </>
          )}
          {commentCount > 0 ? (
            <span
              className={cn('flex items-center gap-1', unresolvedComments > 0 ? 'text-amber' : 'text-mist-500')}
              title={`${t('{count} 条 Reviewer 评论', { count: commentCount })}${unresolvedComments > 0 ? t('，{count} 条未解决', { count: unresolvedComments }) : ''}`}
            >
              <MessageSquare size={10} />
              {t('{count} 评论', { count: commentCount })}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <FileCode2 size={10} />
            {todos.length} todos
          </span>
        </div>

        <div className="mt-3 flex items-center gap-0.5">
          <TabButton
            active={tab === 'summary'}
            icon={<Sparkles size={12} />}
            label={t('摘要与影响')}
            onClick={() => onTabChange('summary')}
          />
          <TabButton
            active={tab === 'diff'}
            icon={<GitCompareArrows size={12} />}
            label={t('代码 Diff')}
            onClick={() => onTabChange('diff')}
          />
          <TabButton
            active={tab === 'todos'}
            icon={<ListChecks size={12} />}
            label={t('待确认')}
            count={todos.length}
            badge={todoOpen}
            onClick={() => onTabChange('todos')}
          />
          <TabButton
            active={tab === 'comments'}
            icon={<MessageSquare size={12} />}
            label={t('Reviewer 评论')}
            count={commentCount}
            badge={unresolvedComments}
            onClick={() => onTabChange('comments')}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'summary' ? (
          <SummaryTab
            node={node}
            data={data}
            reviewed={reviewed}
            onToggleReviewed={onToggleReviewed}
            onSelectNode={onSelectNode}
          />
        ) : null}
        {tab === 'diff' ? <DiffTab node={node} /> : null}
        {tab === 'comments' ? (
          <CommentsTab node={node} data={data} onOpenAllComments={onOpenAllComments} />
        ) : null}
        {tab === 'todos' ? (
          <TodosTab
            node={node}
            todos={todos}
            isDone={isTodoDone}
            onToggle={onToggleTodo}
            onAdd={onAddTodo}
            serverOnline={serverOnline}
          />
        ) : null}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  icon,
  label,
  count,
  badge,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex h-9 items-center gap-1.5 px-2.5 text-[10.5px] transition',
        active ? 'text-mist-100' : 'text-mist-600 hover:text-mist-300',
      )}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 ? (
        <span className={cn('font-mono text-[9px]', badge ? 'text-amber' : 'text-mist-600')}>{count}</span>
      ) : null}
      {active ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" /> : null}
    </button>
  );
}
