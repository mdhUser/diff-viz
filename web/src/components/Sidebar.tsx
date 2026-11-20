import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CornerDownRight,
  ListTodo,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { ReviewData, ReviewNode, ReviewTodo } from '../types';
import { STATUS_META } from '../status';
import { formatTimestamp } from '../format';
import { cn } from '../cn';

interface SidebarProps {
  data: ReviewData;
  selectedId: string | null;
  query: string;
  reviewedMap: Record<string, boolean>;
  isTodoDone: (nodeId: string, todo: ReviewTodo) => boolean;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
}

function matches(node: ReviewNode, query: string) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return node.path.toLowerCase().includes(needle) || node.label.toLowerCase().includes(needle);
}

export function Sidebar({ data, selectedId, query, reviewedMap, isTodoDone, onQueryChange, onSelect }: SidebarProps) {
  const { meta, nodes } = data;
  const changed = nodes.filter((node) => node.status !== 'impacted_only');
  const impacted = nodes.filter((node) => node.status === 'impacted_only');
  const order = new Map((meta.reviewOrder ?? []).map((id, index) => [id, index]));
  const sortedChanged = [...changed].sort(
    (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || a.path.localeCompare(b.path),
  );
  const visibleChanged = sortedChanged.filter((node) => matches(node, query));
  const visibleImpacted = impacted.filter((node) => matches(node, query));
  const totalOpenTodos = nodes.reduce(
    (sum, node) => sum + node.todos.filter((todo) => !isTodoDone(node.id, todo)).length,
    0,
  );
  const reviewedCount = changed.filter((node) => reviewedMap[node.id] ?? node.reviewed).length;
  const agentSummaries = changed.filter((node) => node.summarySource === 'agent').length;
  const summaryText = (meta.overallSummary || '').trim();
  // The scan cap already has a page-level banner; repeating it here just adds
  // noise, so only show it when there is no structured banner to show.
  const sidebarWarnings = (meta.warnings ?? []).filter(
    (warning) => !(meta.scanLimit?.truncated && /依赖扫描上限|capped at/i.test(warning)),
  );
  // Long overall summaries used to be clipped with no way to read the rest.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const summaryCollapsible = summaryText.length > 120;

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-line/80 bg-ink-900/55">
      <div className="shrink-0 px-3.5 pb-3 pt-3.5">
        <div className="relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-ink-800/90 to-ink-900/40 p-3.5">
          <div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-accent/10 blur-2xl" />
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-mist-300">
              <Sparkles size={12} className="text-accent" />
              变更概览
            </span>
            <span className="font-mono text-[9px] text-mist-600">{formatTimestamp(meta.timestamp)}</span>
          </div>
          {summaryText ? (
            <>
              <p
                className={cn(
                  'mt-2 whitespace-pre-line text-[11.5px] leading-[1.65] text-mist-400',
                  !summaryOpen && summaryCollapsible ? 'line-clamp-5' : '',
                )}
              >
                {summaryText}
              </p>
              {summaryCollapsible ? (
                <button
                  type="button"
                  onClick={() => setSummaryOpen((open) => !open)}
                  className="mt-1 text-[9.5px] text-accent hover:text-accent-bright"
                >
                  {summaryOpen ? '收起摘要' : '展开完整摘要'}
                </button>
              ) : null}
            </>
          ) : null}
          {changed.length > 0 ? (
            <div
              className={cn(
                'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px]',
                agentSummaries > 0
                  ? 'bg-accent-soft text-accent-bright'
                  : 'border border-line bg-ink-850/60 text-mist-600',
              )}
              title={
                agentSummaries > 0
                  ? `本 Review 有 ${agentSummaries} 个文件带 Agent 注解`
                  : '还没有 Agent 注解：先让 Agent 写注解，再用 diff-viz annotate --review <id> 写入这条 Review'
              }
            >
              <Sparkles size={9} />
              Agent 摘要 {agentSummaries}/{changed.length}
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line/70 pt-2.5">
            <div>
              <div className="font-mono text-[13px] font-medium text-mist-100">{meta.stats.changedFiles}</div>
              <div className="text-[9.5px] text-mist-600">变更文件</div>
            </div>
            <div>
              <div className="font-mono text-[13px] font-medium text-accent-bright">{meta.stats.impactedFiles}</div>
              <div className="text-[9.5px] text-mist-600">受影响文件</div>
            </div>
            <div>
              <div className="font-mono text-[13px] font-medium text-mint">+{meta.stats.additions}</div>
              <div className="text-[9.5px] text-mist-600">新增行</div>
            </div>
            <div>
              <div className="font-mono text-[13px] font-medium text-rose">−{meta.stats.deletions}</div>
              <div className="text-[9.5px] text-mist-600">删除行</div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-2 border-t border-line/70 pt-2 text-[9.5px] text-mist-600">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={10} className="text-mint" />
              {reviewedCount}/{changed.length} 已 Review
            </span>
            <span className="flex items-center gap-1">
              <ListTodo size={10} className="text-amber" />
              {totalOpenTodos} 待确认
            </span>
          </div>
        </div>

        <div className="relative mt-3">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-600" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索文件或路径…"
            className="h-8 w-full rounded-lg border border-line bg-ink-850/80 pl-8 pr-8 text-[11.5px] text-mist-200 outline-none transition placeholder:text-mist-600 focus:border-accent/40 focus:bg-ink-850"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-mist-600 hover:text-mist-200"
              aria-label="清除搜索"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <SectionTitle label="变更文件" count={visibleChanged.length} accent />
        <div className="space-y-0.5">
          {visibleChanged.map((node) => (
            <FileRow
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              reviewed={Boolean(reviewedMap[node.id] ?? node.reviewed)}
              openTodos={node.todos.filter((todo) => !isTodoDone(node.id, todo)).length}
              onClick={() => onSelect(node.id)}
            />
          ))}
          {visibleChanged.length === 0 ? (
            <div className="px-2.5 py-3 text-[11px] text-mist-600">{query ? '没有匹配的变更文件' : '暂无代码变更'}</div>
          ) : null}
        </div>

        <div className="mt-4">
          <SectionTitle label="受影响文件" count={visibleImpacted.length} />
          <div className="space-y-0.5">
            {visibleImpacted.map((node) => (
              <FileRow
                key={node.id}
                node={node}
                selected={node.id === selectedId}
                reviewed={false}
                openTodos={0}
                onClick={() => onSelect(node.id)}
              />
            ))}
            {visibleImpacted.length === 0 ? (
              <div className="px-2.5 py-3 text-[11px] text-mist-600">
                {query ? '没有匹配的受影响文件' : '未发现下游依赖文件'}
              </div>
            ) : null}
          </div>
        </div>

        {sidebarWarnings.length > 0 ? (
          <div className="mx-1 mt-4 rounded-lg border border-amber/20 bg-amber/5 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber">
              <AlertTriangle size={11} />
              分析提示
            </div>
            <ul className="mt-1.5 space-y-1">
              {sidebarWarnings.slice(0, 3).map((warning) => (
                <li key={warning} className="text-[10px] leading-4 text-mist-500">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line/70 px-3.5 py-2 font-mono text-[9px] text-mist-600">
        <span>{meta.stats.scannedFiles ?? 0} files scanned</span>
        <span>{meta.stats.edges ?? 0} edges</span>
      </div>
    </aside>
  );
}

function SectionTitle({ label, count, accent }: { label: string; count: number; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-mist-500">
        <span className={cn('h-1 w-1 rounded-full', accent ? 'bg-accent' : 'bg-mist-600')} />
        {label}
      </span>
      <span className="font-mono text-[9.5px] text-mist-600">{count}</span>
    </div>
  );
}

function FileRow({
  node,
  selected,
  reviewed,
  openTodos,
  onClick,
}: {
  node: ReviewNode;
  selected: boolean;
  reviewed: boolean;
  openTodos: number;
  onClick: () => void;
}) {
  const meta = STATUS_META[node.status];
  const impacted = node.status === 'impacted_only';
  const Icon = meta.icon;
  const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-[7px] text-left transition',
        selected ? 'border-accent/20 bg-accent-soft' : 'hover:bg-ink-800/70',
      )}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ background: meta.soft, color: meta.color }}
      >
        <Icon size={12.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-[11.5px] font-medium',
              selected ? 'text-mist-50' : 'text-mist-300 group-hover:text-mist-100',
            )}
          >
            {node.label}
          </span>
          {reviewed ? <CheckCircle2 size={11} className="shrink-0 text-mint" /> : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1 truncate font-mono text-[9px] text-mist-600">
          {impacted ? <CornerDownRight size={9} className="shrink-0" /> : null}
          <span className="truncate">{dir || '根目录'}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {impacted ? (
          <span className="rounded border border-line px-1 py-[1px] font-mono text-[8.5px] text-mist-500">
            L{node.depth ?? 1}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-mono text-[9px]">
            <span className="text-mint">+{node.stats.additions}</span>
            <span className="text-rose">−{node.stats.deletions}</span>
          </span>
        )}
        {openTodos > 0 ? (
          <span className="flex items-center gap-0.5 text-[8.5px] text-amber">
            <ListTodo size={8.5} />
            {openTodos}
          </span>
        ) : (
          <ChevronRight size={10} className="text-mist-700 opacity-0 transition group-hover:opacity-100" />
        )}
      </span>
    </button>
  );
}
