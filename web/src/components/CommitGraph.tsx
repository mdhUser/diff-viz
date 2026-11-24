import { useMemo } from 'react';
import { GitBranch, GitCommitHorizontal, Tag } from 'lucide-react';
import type { CommitInfo } from '../types';
import { formatTimestamp } from '../format';
import { cn } from '../cn';
import { useI18n } from '../i18n';

const ROW_HEIGHT = 54;
const LANE_WIDTH = 15;
const GRAPH_PADDING = 10;
const LANE_COLORS = ['#4f7fb3', '#2f8f63', '#a97418', '#8b5fbf', '#c05563', '#5b7f8a'];

interface CommitGraphProps {
  commits: CommitInfo[];
  currentSha?: string;
  disabled?: boolean;
  onSelect: (commit: CommitInfo) => void;
}

interface NodePosition {
  lane: number;
  row: number;
}

export function CommitGraph({ commits, currentSha, disabled, onSelect }: CommitGraphProps) {
  const { t } = useI18n();
  const layout = useMemo(() => {
    const lanes: Array<string | null> = [];
    const positions = new Map<string, NodePosition>();
    const nodes: Array<{ commit: CommitInfo; lane: number; row: number }> = [];

    commits.forEach((commit, row) => {
      let lane = lanes.findIndex((value) => value === commit.sha);
      if (lane === -1) {
        lane = lanes.findIndex((value) => value === null);
        if (lane === -1) lane = lanes.length;
      }
      positions.set(commit.sha, { lane, row });
      nodes.push({ commit, lane, row });
      lanes[lane] = null;

      const [firstParent, ...otherParents] = commit.parents;
      if (firstParent) {
        const existing = lanes.findIndex((value) => value === firstParent);
        if (existing === -1) lanes[lane] = firstParent;
      }
      for (const parent of otherParents) {
        if (lanes.includes(parent)) continue;
        let slot = lanes.findIndex((value) => value === null);
        if (slot === -1) slot = lanes.length;
        lanes[slot] = parent;
      }
      while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    });

    const maxLane = nodes.reduce((max, node) => Math.max(max, node.lane), 0);
    const graphWidth = GRAPH_PADDING * 2 + maxLane * LANE_WIDTH + 8;
    const edges: Array<{ from: NodePosition; to: NodePosition; color: string }> = [];

    for (const node of nodes) {
      for (const parent of node.commit.parents) {
        const target = positions.get(parent);
        if (!target) continue;
        edges.push({
          from: { lane: node.lane, row: node.row },
          to: target,
          color: LANE_COLORS[node.lane % LANE_COLORS.length],
        });
      }
    }

    return { nodes, edges, graphWidth };
  }, [commits]);

  if (commits.length === 0) {
    return <div className="px-2 py-6 text-[10.5px] text-mist-500">{t('这个仓库还没有提交。')}</div>;
  }

  const xFor = (lane: number) => GRAPH_PADDING + lane * LANE_WIDTH;
  const yFor = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;
  const height = commits.length * ROW_HEIGHT;

  return (
    <div className="relative" style={{ minHeight: height }}>
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={layout.graphWidth}
        height={height}
        viewBox={`0 0 ${layout.graphWidth} ${height}`}
        aria-hidden="true"
      >
        {layout.edges.map((edge, index) => {
          const x1 = xFor(edge.from.lane);
          const y1 = yFor(edge.from.row);
          const x2 = xFor(edge.to.lane);
          const y2 = yFor(edge.to.row);
          const path =
            x1 === x2
              ? `M ${x1} ${y1} L ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1} ${y1 + ROW_HEIGHT / 2}, ${x2} ${y2 - ROW_HEIGHT / 2}, ${x2} ${y2}`;
          return (
            <path
              key={`${edge.from.row}-${edge.to.row}-${index}`}
              d={path}
              fill="none"
              stroke={edge.color}
              strokeWidth={1.4}
              strokeOpacity={0.62}
              strokeLinecap="round"
            />
          );
        })}
        {layout.nodes.map((node) => {
          const x = xFor(node.lane);
          const y = yFor(node.row);
          const color = LANE_COLORS[node.lane % LANE_COLORS.length];
          const current = node.commit.sha === currentSha;
          const head = node.commit.refs.some((ref) => ref === 'HEAD' || ref.startsWith('HEAD →'));
          return (
            <g key={node.commit.sha}>
              {current ? <circle cx={x} cy={y} r={6.5} fill="none" stroke="rgba(86,111,208,0.45)" strokeWidth={2} /> : null}
              <circle
                cx={x}
                cy={y}
                r={head ? 4.4 : 3.4}
                fill={head ? '#fffdf8' : color}
                stroke={color}
                strokeWidth={head ? 2.2 : 1.4}
              />
            </g>
          );
        })}
      </svg>

      <div className="relative">
        {layout.nodes.map((node) => {
          const { commit } = node;
          const active = commit.sha === currentSha;
          return (
            <button
              key={commit.sha}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(commit)}
              className={cn(
                'group flex w-full items-start gap-2 border-b border-line/50 py-2 pr-2.5 text-left transition last:border-b-0',
                active ? 'bg-accent-soft' : 'hover:bg-ink-850/70',
                disabled ? 'cursor-default opacity-60' : '',
              )}
              style={{ height: ROW_HEIGHT, paddingLeft: layout.graphWidth + 4 }}
            >
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'truncate text-[11px]',
                      active ? 'font-semibold text-mist-50' : 'font-medium text-mist-200 group-hover:text-mist-100',
                    )}
                  >
                    {commit.subject || '(no message)'}
                  </span>
                  {commit.refs.slice(0, 4).map((ref) => (
                    <RefBadge key={ref} reference={ref} />
                  ))}
                  {commit.refs.length > 4 ? (
                    <span className="text-[8px] text-mist-600">+{commit.refs.length - 4}</span>
                  ) : null}
                </span>
                <span className="mt-1 flex items-center gap-1.5 font-mono text-[8.5px] text-mist-600">
                  <GitCommitHorizontal size={9} />
                  <span className="text-mist-500">{commit.short}</span>
                  <span>·</span>
                  <span className="truncate">{commit.author}</span>
                  <span>·</span>
                  <span className="shrink-0">{formatTimestamp(commit.date)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RefBadge({ reference }: { reference: string }) {
  if (reference === 'HEAD' || reference.startsWith('HEAD →')) {
    return (
      <span className="flex shrink-0 items-center gap-0.5 rounded border border-accent/25 bg-accent-soft px-1 py-[1px] text-[7.5px] text-accent-bright">
        <GitBranch size={7.5} />
        {reference}
      </span>
    );
  }
  if (reference.startsWith('tag: ')) {
    return (
      <span className="flex shrink-0 items-center gap-0.5 rounded border border-mint/25 bg-mint/10 px-1 py-[1px] text-[7.5px] text-mint">
        <Tag size={7.5} />
        {reference.slice(5)}
      </span>
    );
  }
  if (reference.startsWith('origin/') || reference.startsWith('upstream/')) {
    return (
      <span className="shrink-0 rounded border border-line bg-ink-850 px-1 py-[1px] text-[7.5px] text-mist-500">
        {reference}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded border border-line bg-ink-850 px-1 py-[1px] text-[7.5px] text-mist-400">
      {reference}
    </span>
  );
}
