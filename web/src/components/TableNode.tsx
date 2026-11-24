import { memo } from 'react';
import { Database, KeyRound } from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ReviewTable } from '../types';
import { cn } from '../cn';
import { useI18n } from '../i18n';

export interface TableNodeData extends Record<string, unknown> {
  table: ReviewTable;
  selected: boolean;
  onHoverStart?: (tableId: string, event: { clientX: number; clientY: number }) => void;
  onHoverEnd?: (tableId: string) => void;
}

export type TableFlowNode = Node<TableNodeData, 'table'>;

function TableNodeComponent({ data }: NodeProps<TableFlowNode>) {
  const { table, selected, onHoverStart, onHoverEnd } = data;
  const { t } = useI18n();
  const operations = table.operations ?? [];
  const reads = operations.includes('select');
  const writes = operations.some((operation) => ['insert', 'update', 'delete', 'replace', 'merge'].includes(operation));
  const changed = Boolean(table.changed);
  const impacted = Boolean(table.impacted) && !changed;
  const schema = table.schema ? `${table.schema}.` : '';

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col justify-between rounded-xl border px-3 py-2.5 transition',
        selected ? 'node-selected' : '',
      )}
      style={{
        borderColor: selected
          ? 'rgba(196,122,44,0.7)'
          : impacted
            ? 'rgba(196,122,44,0.28)'
            : 'rgba(196,122,44,0.45)',
        borderStyle: impacted ? 'dashed' : 'solid',
        background: 'linear-gradient(180deg, rgba(255,251,243,0.97) 0%, rgba(250,243,231,0.95) 100%)',
        boxShadow: selected ? undefined : '0 8px 20px -18px rgba(120,70,20,0.35)',
        opacity: impacted ? 0.9 : 1,
      }}
      title={`${table.name}${table.statementCount ? ` · ${t('{count} 条 SQL', { count: table.statementCount })}` : ''}`}
      onMouseEnter={(event) => onHoverStart?.(table.id, event)}
      onMouseMove={(event) => onHoverStart?.(table.id, event)}
      onMouseLeave={() => onHoverEnd?.(table.id)}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 'none' }} />
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(196,122,44,0.12)', color: '#a35f14' }}
        >
          <Database size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="truncate font-mono text-[11.5px] font-semibold text-[#4a3a25]">
            {schema}
            <span className="text-[#2b241a]">{table.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[#8b7a63]">
            {table.statementCount ? <span>{t('{count} 条 SQL', { count: table.statementCount })}</span> : <span>{t('数据表')}</span>}
            {table.changedStatementCount ? (
              <span className="text-[#b83232]">{t('{count} 条变更', { count: table.changedStatementCount })}</span>
            ) : changed ? (
              <span className="text-[#a35f14]">{t('本次涉及')}</span>
            ) : null}
            {impacted ? <span>{t('受影响')}</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        {reads ? (
          <span className="rounded border border-[rgba(196,122,44,0.28)] bg-[rgba(196,122,44,0.08)] px-1.5 py-0.5 text-[8.5px] text-[#a35f14]">
            {t('读取')}
          </span>
        ) : null}
        {writes ? (
          <span className="rounded border border-[rgba(160,70,60,0.28)] bg-[rgba(160,70,60,0.08)] px-1.5 py-0.5 text-[8.5px] text-[#a0493f]">
            {t('写入')}
          </span>
        ) : null}
        {table.schema ? (
          <span className="ml-auto flex items-center gap-0.5 text-[8px] text-[#a89a82]">
            <KeyRound size={8} />
            {table.schema}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
