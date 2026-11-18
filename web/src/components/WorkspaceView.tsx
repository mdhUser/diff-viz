import { useMemo } from 'react';
import { FolderGit2, GitBranch, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReviewData, ServiceEdge, WorkspaceMeta, WorkspaceRepo } from '../types';
import { cn } from '../cn';

const CARD_W = 264;
const CARD_H = 118;
const GAP_X = 168;
const GAP_Y = 42;
const PAD = 56;

interface WorkspaceViewProps {
  data: ReviewData;
  refreshing?: boolean;
  onOpenReview: (reviewId: string) => void;
  onRefresh: () => void;
}

function rankColumns(repos: WorkspaceRepo[], edges: ServiceEdge[]) {
  // A depends on B means A→B; the dependency should sit to the left so the
  // graph reads "what it depends on → what changes because of it".
  const rank = new Map(repos.map((repo) => [repo.id, 0]));
  for (let pass = 0; pass < repos.length; pass += 1) {
    let moved = false;
    for (const edge of edges) {
      if (!rank.has(edge.from) || !rank.has(edge.to)) continue;
      const next = Math.max(rank.get(edge.from) ?? 0, (rank.get(edge.to) ?? 0) + 1);
      if (next !== rank.get(edge.from)) {
        rank.set(edge.from, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const columns = new Map<number, WorkspaceRepo[]>();
  for (const repo of repos) {
    const key = rank.get(repo.id) ?? 0;
    const list = columns.get(key) || [];
    list.push(repo);
    columns.set(key, list);
  }
  return columns;
}

export function WorkspaceView({ data, refreshing, onOpenReview, onRefresh }: WorkspaceViewProps) {
  const meta = data.meta as unknown as WorkspaceMeta;
  const repos = meta.repos ?? [];
  const edges = meta.serviceEdges ?? [];

  const layout = useMemo(() => {
    const columns = rankColumns(repos, edges);
    const position = new Map<string, { x: number; y: number; repo: WorkspaceRepo }>();
    const maxRank = Math.max(0, ...[...columns.keys()]);
    const maxRows = Math.max(1, ...[...columns.values()].map((list) => list.length));
    const height = Math.max(PAD * 2 + maxRows * CARD_H + (maxRows - 1) * GAP_Y, 420);
    for (const [rank, list] of columns) {
      const columnHeight = list.length * CARD_H + (list.length - 1) * GAP_Y;
      const top = (height - columnHeight) / 2;
      list.forEach((repo, index) => {
        position.set(repo.id, {
          x: PAD + rank * (CARD_W + GAP_X),
          y: top + index * (CARD_H + GAP_Y),
          repo,
        });
      });
    }
    const width = PAD * 2 + (maxRank + 1) * CARD_W + maxRank * GAP_X;
    return { position, width, height };
  }, [repos, edges]);

  return (
    <div className="app-bg flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-line/80 px-6 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-mist-100">
            <FolderGit2 size={14} className="text-accent" />
            工作区 · {meta.name}
          </div>
          <div className="mt-1 truncate font-mono text-[9.5px] text-mist-600">{meta.file}</div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-mist-500">
          <span>{meta.stats.repos} 个仓库</span>
          <span className="text-amber">{meta.stats.changed} 个有改动</span>
          <span className="text-accent">{meta.stats.impacted} 个受影响</span>
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1 rounded-md border border-line bg-ink-850 px-2 py-1 text-[10px] text-mist-400 transition hover:border-accent/30 hover:text-mist-200"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : undefined} />
            刷新
          </button>
        </div>
      </header>

      {meta.warnings && meta.warnings.length > 0 ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-line/80 bg-[#fdf6ea] px-6 py-2 text-[10px] text-amber">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {meta.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        </div>
      ) : null}

      {meta.notes && meta.notes.length > 0 ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-line/80 bg-ink-850/50 px-6 py-2 text-[10px] text-mist-500">
          <Info size={12} className="mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {meta.notes.map((note) => (
              <div key={note}>{note}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {repos.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-mist-500">
            工作区里没有可用仓库
          </div>
        ) : (
          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
              {edges.map((edge) => {
                const from = layout.position.get(edge.from);
                const to = layout.position.get(edge.to);
                if (!from || !to) return null;
                // line runs from the dependent (right) edge to the dependency (left) edge
                const x1 = from.x;
                const y1 = from.y + CARD_H / 2;
                const x2 = to.x + CARD_W;
                const y2 = to.y + CARD_H / 2;
                const distance = Math.max(40, Math.abs(x1 - x2) / 2);
                const path = `M ${x1} ${y1} C ${x1 - distance} ${y1}, ${x2 + distance} ${y2}, ${x2} ${y2}`;
                return (
                  <g key={`${edge.from}-${edge.to}`}>
                    <path d={path} fill="none" stroke="#c9bda9" strokeWidth={1.5} />
                    <circle cx={x2} cy={y2} r={3} fill="#b6a68e" />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 8}
                      textAnchor="middle"
                      className="fill-[#a8987f]"
                      fontSize={10}
                      fontFamily="ui-monospace, monospace"
                    >
                      {edge.via || edge.kind}
                    </text>
                  </g>
                );
              })}
            </svg>

            {[...layout.position.values()].map(({ x, y, repo }) => {
              const impacted = !repo.changed && (repo.depth ?? 0) > 0;
              const stats = repo.stats || {};
              return (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => onOpenReview(repo.reviewId)}
                  style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
                  className={cn(
                    'absolute flex flex-col justify-between rounded-xl border bg-[#fffdf8] px-3.5 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-22px_rgba(60,50,30,0.55)]',
                    repo.changed
                      ? 'border-amber/45 shadow-[0_10px_26px_-22px_rgba(214,160,62,0.9)]'
                      : impacted
                        ? 'border-dashed border-accent/45'
                        : 'border-line',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            repo.changed ? 'bg-amber' : impacted ? 'bg-accent' : 'bg-mist-600',
                          )}
                        />
                        <span className="truncate text-[12px] font-medium text-mist-100">{repo.name}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1 font-mono text-[9px] text-mist-600">
                        <GitBranch size={9} />
                        <span className="truncate">{repo.branch || '—'}</span>
                      </div>
                      {repo.scopeLabel && repo.scopeMode !== 'worktree' ? (
                        <div className="mt-0.5 truncate font-mono text-[8.5px] text-mist-600" title={repo.scopeLabel}>
                          {repo.scopeMode} · {repo.scopeLabel}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[9px]',
                        repo.changed
                          ? 'bg-amber/15 text-amber'
                          : impacted
                            ? 'bg-accent/15 text-accent'
                            : 'bg-ink-800 text-mist-600',
                      )}
                    >
                      {repo.changed ? '有改动' : impacted ? `受影响 · ${repo.depth}` : '未改动'}
                    </span>
                  </div>

                  <div className="flex items-end justify-between">
                    <div className="font-mono text-[10px] text-mist-500">
                      <span className="text-mint">+{stats.additions ?? 0}</span>
                      <span className="mx-1 text-mist-600">/</span>
                      <span className="text-rose">−{stats.deletions ?? 0}</span>
                      <span className="ml-2 text-mist-600">{stats.changedFiles ?? 0} 文件</span>
                    </div>
                    <span className="text-[9px] text-mist-600">打开 →</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-4 border-t border-line/80 px-6 py-2 text-[9.5px] text-mist-600">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber" />有改动
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent" />受其他服务影响
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-mist-600" />未改动
        </span>
        <span className="ml-auto">箭头 = 依赖方向（左边被依赖），改动沿反方向传播</span>
      </footer>
    </div>
  );
}
