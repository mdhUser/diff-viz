import { Database, ArrowUpRight } from 'lucide-react';
import type { ReviewTable } from '../types';
import { useI18n } from '../i18n';

const OPERATION_LABEL: Record<string, string> = {
  select: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  replace: 'INSERT',
  merge: 'MERGE',
};

export function SqlHoverCard({
  table,
  x,
  y,
  onOpen,
}: {
  table: ReviewTable;
  x: number;
  y: number;
  onOpen: (tableId: string) => void;
}) {
  const { t } = useI18n();
  const allStatements = table.statements ?? [];
  const changedStatements = allStatements.filter((statement) => statement.changed);
  const statements = (changedStatements.length > 0
    ? [...changedStatements, ...allStatements.filter((statement) => !statement.changed)]
    : allStatements
  ).slice(0, 3);
  const total = table.statementCount ?? table.statements?.length ?? 0;
  const left = Math.min(Math.max(12, x + 18), window.innerWidth - 500);
  const top = Math.min(Math.max(12, y + 16), window.innerHeight - 260);
  return (
    <div
      className="pointer-events-auto fixed z-[100] w-[470px] rounded-xl border border-[rgba(196,122,44,0.35)] bg-[#fffdf8] p-3 shadow-[0_18px_40px_-20px_rgba(80,50,20,0.45)]"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2 border-b border-line/70 pb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[rgba(196,122,44,0.12)] text-[#a35f14]">
          <Database size={12} />
        </span>
        <span className="font-mono text-[11.5px] font-semibold text-mist-100">{table.name}</span>
        <span className="text-[9px] text-mist-600">{t('{count} 条 SQL', { count: total })}</span>
        {changedStatements.length > 0 ? (
          <span className="rounded border border-[rgba(212,58,58,0.35)] bg-[rgba(212,58,58,0.06)] px-1 py-0.5 text-[8px] text-[#b83232]">
            {t('{count} 条变更', { count: changedStatements.length })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(table.id)}
          className="ml-auto flex items-center gap-0.5 rounded border border-[rgba(196,122,44,0.3)] px-1.5 py-0.5 text-[9px] text-[#a35f14] transition hover:bg-[rgba(196,122,44,0.08)]"
        >
          {t('查看全部')}
          <ArrowUpRight size={9} />
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {statements.length === 0 ? (
          <div className="text-[10px] text-mist-600">{t('正在读取 SQL…')}</div>
        ) : (
          statements.map((statement) => (
            <div key={statement.id} className="rounded-lg border border-line/60 bg-[#fbf8f0] p-2">
              <div className="flex items-center gap-2 text-[8.5px] text-mist-600">
                <span className="rounded bg-[rgba(196,122,44,0.12)] px-1 py-0.5 font-mono text-[8px] text-[#a35f14]">
                  {OPERATION_LABEL[statement.operation] ?? statement.operation.toUpperCase()}
                </span>
                {statement.changed ? (
                  <span className="rounded bg-[rgba(212,58,58,0.10)] px-1 py-0.5 text-[8px] text-[#b83232]">
                    {t('本次变更')}
                  </span>
                ) : null}
                <span className="truncate font-mono">{statement.file.split('/').slice(-2).join('/')}</span>
                {statement.line ? <span>:{statement.line}</span> : null}
                {statement.dynamic ? <span className="text-amber">{t('动态 SQL')}</span> : null}
              </div>
              <pre className="mt-1 max-h-[52px] overflow-hidden whitespace-pre-wrap break-all font-mono text-[9px] leading-[1.5] text-[#3d4a4f]">
                {statement.sql}
              </pre>
            </div>
          ))
        )}
      </div>
      {total > statements.length && statements.length > 0 ? (
        <div className="mt-1.5 text-right text-[8.5px] text-mist-600">
          {t('点击「查看全部」查看其余 {count} 条', { count: total - statements.length })}
        </div>
      ) : null}
    </div>
  );
}
