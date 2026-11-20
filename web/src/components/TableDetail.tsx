import { ArrowUpRight, Database, Loader2, X } from 'lucide-react';
import type { ReviewComponent, ReviewTable } from '../types';

const OPERATION_LABEL: Record<string, string> = {
  select: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  replace: 'INSERT',
  merge: 'MERGE',
};

export function TableDetail({
  table,
  components,
  loading,
  onClose,
  onSelectSource,
}: {
  table: ReviewTable;
  components: ReviewComponent[] | undefined;
  loading: boolean;
  onClose: () => void;
  onSelectSource: (path: string) => void;
}) {
  const component = (components ?? []).find((item) => item.id === table.componentId);
  const operations = table.operations ?? [];
  const statements = table.statements ?? [];

  return (
    <aside className="animate-drawer relative z-20 flex h-full w-full min-w-0 flex-col border-l border-line/90 bg-[#fbf9f3] shadow-[-24px_0_60px_-38px_rgba(60,50,30,0.35)]">
      <div className="shrink-0 border-b border-line/80 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-md border border-[rgba(196,122,44,0.3)] bg-[rgba(196,122,44,0.08)] px-1.5 py-0.5 text-[9.5px] font-medium text-[#a35f14]">
              <Database size={10} />
              {component?.label ?? 'Database'}
            </span>
            {table.changed ? (
              <span className="rounded border border-[rgba(196,122,44,0.3)] px-1.5 py-0.5 text-[8.5px] text-[#a35f14]">
                本次涉及
              </span>
            ) : null}
            {table.impacted && !table.changed ? (
              <span className="rounded border border-line px-1.5 py-0.5 text-[8.5px] text-mist-600">受影响</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-mist-500 transition hover:bg-ink-800 hover:text-mist-100"
            aria-label="关闭数据表详情"
          >
            <X size={15} />
          </button>
        </div>
        <h2 className="mt-2 truncate font-mono text-[16px] font-semibold text-mist-50" title={table.name}>
          {table.schema ? `${table.schema}.` : ''}
          {table.name}
        </h2>
        <div className="mt-1.5 flex items-center gap-2 text-[9.5px] text-mist-600">
          {operations.map((operation) => (
            <span
              key={operation}
              className="rounded border border-[rgba(196,122,44,0.28)] bg-[rgba(196,122,44,0.06)] px-1.5 py-0.5 font-mono text-[8.5px] text-[#a35f14]"
            >
              {OPERATION_LABEL[operation] ?? operation.toUpperCase()}
            </span>
          ))}
          <span>{table.statementCount ?? statements.length} 条 SQL</span>
          <span className="ml-auto">来源 {table.sources?.length ?? 0} 个文件</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 text-[9px] font-medium uppercase tracking-[0.12em] text-mist-600">来源文件</div>
        <div className="mb-4 flex flex-wrap gap-1">
          {(table.sources ?? []).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => onSelectSource(source)}
              className="flex max-w-full items-center gap-1 rounded-md border border-line bg-ink-850/60 px-1.5 py-1 text-[9.5px] text-mist-400 transition hover:border-accent/30 hover:text-mist-200"
              title={source}
            >
              <span className="truncate font-mono">{source.split('/').slice(-2).join('/')}</span>
              <ArrowUpRight size={9} />
            </button>
          ))}
        </div>

        <div className="mb-2 flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.12em] text-mist-600">
          <span>SQL 语句</span>
          {loading ? <Loader2 size={11} className="animate-spin text-accent" /> : null}
        </div>
        {statements.length === 0 && !loading ? (
          <div className="rounded-lg border border-line/70 bg-ink-850/40 px-3 py-6 text-center text-[10px] text-mist-600">
            没有读取到 SQL 语句。
          </div>
        ) : null}
        <div className="space-y-2.5">
          {statements.map((statement) => (
            <div key={statement.id} className="overflow-hidden rounded-xl border border-line/80 bg-[#fffdf8]">
              <div className="flex items-center gap-2 border-b border-line/60 bg-[#f6f1e5] px-2.5 py-1.5 text-[8.5px] text-mist-600">
                <span className="rounded bg-[rgba(196,122,44,0.12)] px-1 py-0.5 font-mono text-[8px] text-[#a35f14]">
                  {OPERATION_LABEL[statement.operation] ?? statement.operation.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSource(statement.file)}
                  className="truncate font-mono transition hover:text-mist-200"
                  title={statement.file}
                >
                  {statement.file.split('/').slice(-2).join('/')}
                </button>
                {statement.line ? <span>:{statement.line}</span> : null}
                {statement.mapper ? <span className="truncate text-mist-600">{statement.mapper}</span> : null}
                {statement.dynamic ? <span className="ml-auto shrink-0 text-amber">动态 SQL</span> : null}
              </div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all px-2.5 py-2 font-mono text-[9.5px] leading-[1.6] text-[#3d4a4f]">
                {statement.sql}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
