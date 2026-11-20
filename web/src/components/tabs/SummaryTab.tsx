import { CheckCircle2, Circle, CircleDashed, ExternalLink, GitBranch, Layers, Sparkles, TriangleAlert, Waypoints } from 'lucide-react';
import type { ReviewData, ReviewNode } from '../../types';
import { STATUS_META } from '../../status';
import { cn } from '../../cn';

interface SummaryTabProps {
  node: ReviewNode;
  data: ReviewData;
  reviewed: boolean;
  onToggleReviewed: () => void;
  onSelectNode: (id: string) => void;
}

export function SummaryTab({ node, data, reviewed, onToggleReviewed, onSelectNode }: SummaryTabProps) {
  const nodeById = new Map(data.nodes.map((item) => [item.id, item]));
  const edgeImports = data.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target);
  const edgeImportedBy = data.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source);
  const upstreamPaths = node.imports ?? edgeImports;
  const downstreamPaths = node.importedBy ?? edgeImportedBy;
  const upstream = [...new Set(upstreamPaths)].sort().map((path) => ({ path, node: nodeById.get(path) }));
  const downstream = [...new Set(downstreamPaths)].sort().map((path) => ({ path, node: nodeById.get(path) }));

  const RELATION_LABEL: Record<string, string> = {
    binds: '绑定',
    config: '配置',
    'class-ref': '引用',
    reads_table: '读取',
    writes_table: '写入',
  };
  const configLinks = data.edges
    .filter(
      (edge) =>
        edge.relation &&
        edge.relation !== 'imports' &&
        (edge.source === node.id || edge.target === node.id),
    )
    .map((edge) => ({
      relation: edge.relation as string,
      outgoing: edge.source === node.id,
      path: edge.source === node.id ? edge.target : edge.source,
    }));

  const impactChain = (node.impactChain ?? []).filter(Boolean);
  const changedOrigins = (node.impactOrigins ?? [])
    .map((id) => nodeById.get(id))
    .filter((item): item is ReviewNode => Boolean(item));

  return (
    <div className="animate-fade-up space-y-4 px-5 py-4">
      {node.status === 'impacted_only' ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-ink-800/50 p-3.5">
          <Layers size={15} className="mt-0.5 shrink-0 text-mist-400" />
          <div>
            <div className="text-[11.5px] font-medium text-mist-200">未修改，因依赖变更被纳入 Review</div>
            <p className="mt-1 text-[10.5px] leading-4 text-mist-500">
              该文件本身没有代码 Diff。建议确认其调用的接口/导出仍保持兼容，并按需回归相关用例。
            </p>
          </div>
        </div>
      ) : null}

      {node.renamed ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-850/60 px-3 py-2 text-[10.5px] text-mist-400">
          <GitBranch size={12} className="text-accent" />
          重命名自 <span className="font-mono text-[10px] text-mist-300">{node.oldPath}</span>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-line bg-gradient-to-b from-ink-800/70 to-ink-900/30">
        <div className="flex items-center justify-between border-b border-line/70 px-3.5 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-mist-200">
            <Sparkles size={12} className="text-accent" />
            {node.status === 'impacted_only' ? '受影响说明' : '改动摘要'}
          </span>
          {node.summarySource === 'agent' ? (
            <span className="rounded border border-accent/20 bg-accent-soft px-1.5 py-0.5 text-[8.5px] text-accent-bright">
              Agent 总结
            </span>
          ) : node.status !== 'impacted_only' ? (
            <span className="rounded border border-line px-1.5 py-0.5 text-[8.5px] text-mist-600">自动生成</span>
          ) : null}
        </div>
        <div className="whitespace-pre-wrap px-3.5 py-3 text-[11.5px] leading-[1.75] text-mist-300">
          {node.summary ||
            (node.status === 'impacted_only' ? (
              <span className="text-mist-400">
                该文件没有代码改动，因为依赖了本次变更而被纳入 Review。优先确认被调用的导出与接口约定是否保持兼容。
              </span>
            ) : (
              <span className="text-mist-600">尚未生成摘要，可由 Agent 写入 summary 字段。</span>
            ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-gradient-to-b from-ink-800/50 to-ink-900/20">
        <div className="flex items-center gap-1.5 border-b border-line/70 px-3.5 py-2.5 text-[11px] font-medium text-mist-200">
          <TriangleAlert size={12} className="text-amber" />
          影响评估
        </div>
        <div className="whitespace-pre-wrap px-3.5 py-3 text-[11.5px] leading-[1.75] text-mist-400">
          {node.impactAnalysis || <span className="text-mist-600">尚未生成影响分析。</span>}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-ink-900/30">
        <div className="flex items-center justify-between border-b border-line/70 px-3.5 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-mist-200">
            <Waypoints size={12} className="text-accent" />
            依赖关系
          </span>
          <span className="font-mono text-[9px] text-mist-600">
            {upstream.length} 导入 · {downstream.length} 被依赖
          </span>
        </div>
        <div className="divide-y divide-line/60">
          <DependencyRow
            label="导入了"
            hint="该文件 import 的上游模块（图外文件也会列出）"
            items={upstream}
            empty="没有解析到本项目内的 import"
            onSelectNode={onSelectNode}
          />
          <DependencyRow
            label="被依赖"
            hint="直接 import 该文件的模块"
            items={downstream}
            empty="没有被本项目内的文件直接引用"
            onSelectNode={onSelectNode}
          />
          {configLinks.length > 0 ? (
            <div className="px-3.5 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-medium text-[#2f7373]">配置关联</span>
                <span className="text-[9px] text-mist-600">Mapper XML / Spring 配置 / Bean 引用</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {configLinks.map((link) => (
                  <button
                    key={`${link.relation}:${link.path}:${link.outgoing ? 'out' : 'in'}`}
                    type="button"
                    onClick={() => onSelectNode(link.path)}
                    className="flex max-w-full items-center gap-1 rounded-md border border-[rgba(47,143,143,0.30)] bg-[rgba(47,143,143,0.06)] px-1.5 py-1 text-[9.5px] text-[#2f7373] transition hover:bg-[rgba(47,143,143,0.12)]"
                    title={link.path}
                  >
                    <span className="font-medium">{RELATION_LABEL[link.relation] ?? link.relation}</span>
                    <span className="text-mist-600">{link.outgoing ? '→' : '←'}</span>
                    <span className="truncate font-mono">{link.path.split('/').slice(-2).join('/')}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {impactChain.length > 1 ? (
            <div className="rounded-lg border border-line/70 bg-ink-850/40 px-3 py-2">
              <div className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-mist-600">影响链路</div>
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[9.5px] text-mist-500">
                {impactChain.map((path, index) => (
                  <span key={path} className="flex items-center gap-1">
                    {index > 0 ? <span className="text-mist-600">→</span> : null}
                    <button
                      type="button"
                      onClick={() => onSelectNode(path)}
                      className={cn(
                        'rounded px-1 py-0.5 font-mono transition hover:bg-accent-soft hover:text-accent-bright',
                        path === node.id ? 'bg-accent-soft text-accent-bright' : 'text-mist-400',
                      )}
                      title={path}
                    >
                      {path.split('/').slice(-2).join('/')}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {changedOrigins.length > 0 ? (
            <DependencyRow
              label="变更来源"
              hint="触发本次影响分析的改动"
              items={changedOrigins.map((item) => ({ path: item.path, node: item }))}
              empty=""
              onSelectNode={onSelectNode}
            />
          ) : null}
        </div>
      </section>

      <button
        type="button"
        onClick={onToggleReviewed}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition',
          reviewed
            ? 'border-mint/30 bg-mint/5 hover:bg-mint/10'
            : 'border-line bg-ink-900/40 hover:border-accent/30 hover:bg-accent-soft/40',
        )}
      >
        {reviewed ? (
          <CheckCircle2 size={17} className="shrink-0 text-mint" />
        ) : (
          <Circle size={17} className="shrink-0 text-mist-600" />
        )}
        <span className="flex-1">
          <span className={cn('block text-[11.5px] font-medium', reviewed ? 'text-mint' : 'text-mist-200')}>
            {reviewed ? '已标记为 Review 完成' : '标记为已 Review'}
          </span>
          <span className="mt-0.5 block text-[10px] text-mist-600">状态会写回本地数据文件与浏览器存储</span>
        </span>
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded border',
            reviewed ? 'border-mint bg-mint text-ink-950' : 'border-line text-transparent',
          )}
        >
          <CheckCircle2 size={11} />
        </span>
      </button>
    </div>
  );
}

function DependencyRow({
  label,
  hint,
  items,
  empty,
  onSelectNode,
}: {
  label: string;
  hint: string;
  items: Array<{ path: string; node?: ReviewNode }>;
  empty: string;
  onSelectNode: (id: string) => void;
}) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-medium text-mist-400">{label}</span>
        <span className="text-[9px] text-mist-600">{hint}</span>
      </div>
      {items.length === 0 ? (
        <div className="mt-1.5 text-[10px] text-mist-600">{empty}</div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {items.map(({ path, node: item }) => {
            if (!item) {
              return (
                <span
                  key={path}
                  className="flex max-w-full items-center gap-1 rounded-md border border-dashed border-line bg-ink-900/40 px-1.5 py-1 text-[9.5px] text-mist-600"
                  title={`${path}（未纳入当前图）`}
                >
                  <CircleDashed size={8} className="shrink-0" />
                  <span className="truncate font-mono">{path.split('/').pop()}</span>
                  <span className="shrink-0 text-[8px] opacity-70">图外</span>
                </span>
              );
            }
            const meta = STATUS_META[item.status];
            return (
              <button
                key={path}
                type="button"
                onClick={() => onSelectNode(item.id)}
                className="group flex max-w-full items-center gap-1 rounded-md border border-line bg-ink-850/70 px-1.5 py-1 text-[9.5px] text-mist-400 transition hover:border-accent/30 hover:text-mist-100"
                title={path}
              >
                <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: meta.color }} />
                <span className="truncate font-mono">{item.label}</span>
                <ExternalLink size={8} className="shrink-0 opacity-0 transition group-hover:opacity-60" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
