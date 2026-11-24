import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, CornerUpRight, FileCog, ListTodo, MessageSquare } from 'lucide-react';
import type { LayoutDirection, ReviewNode } from '../types';
import { STATUS_META } from '../status';
import { dirname } from '../format';
import { cn } from '../cn';
import { useI18n } from '../i18n';

export interface FileNodeData extends Record<string, unknown> {
  node: ReviewNode;
  direction: LayoutDirection;
  selected: boolean;
  openTodos: number;
  highRisk: boolean;
  reviewed: boolean;
  ignored: boolean;
  laneMode: boolean;
}

export type FileFlowNode = Node<FileNodeData, 'file'>;

function FileNodeComponent({ data }: NodeProps<FileFlowNode>) {
  const { node, direction, selected, openTodos, reviewed, ignored, laneMode, highRisk } = data;
  const { t } = useI18n();
  const meta = STATUS_META[node.status];
  const isConfig = node.kind === 'config';
  const needsConfirmation = openTodos > 0;
  const Icon = isConfig ? FileCog : meta.icon;
  const configLabel =
    node.resourceKind === 'xml-mybatis'
      ? 'MyBatis Mapper'
      : node.resourceKind === 'xml-spring'
        ? 'Spring XML'
        : node.resourceKind === 'xml-generic'
          ? t('XML 配置')
          : node.resourceKind === 'properties'
            ? 'Properties'
            : node.resourceKind === 'yaml'
              ? 'YAML'
              : node.resourceKind === 'sql'
                ? 'SQL'
                : t('配置');
  const impacted = node.status === 'impacted_only';
  const vertical = direction === 'TB';
  const moduleLabel = node.moduleLabel ? t(node.moduleLabel) : '';
  const contextPath = node.packagePath || dirname(node.path) || t('仓库根目录');
  const contextLine = laneMode
    ? contextPath
    : [moduleLabel, contextPath].filter(Boolean).join(' · ') || t('仓库根目录');
  const titleParts = [node.path, moduleLabel, node.packagePath].filter(Boolean);
  const width = impacted ? 228 : 256;

  return (
    <div
      className={`graph-node relative flex flex-col justify-between rounded-xl border bg-[#fffdf8]/95 px-3 py-2.5 ${
        selected ? 'node-selected' : ''
      } ${highRisk ? 'node-risk-pulse' : needsConfirmation ? 'node-confirm-glow' : ''}`}
      style={{
        width,
        height: impacted ? 74 : 94,
        borderColor: selected
          ? 'rgba(86,111,208,0.65)'
          : highRisk
            ? 'rgba(212,58,58,0.85)'
            : needsConfirmation
              ? 'rgba(214,144,0,0.75)'
              : isConfig
                ? 'rgba(47,143,143,0.38)'
                : impacted
                  ? 'rgba(107,124,140,0.28)'
                  : 'rgba(221,213,196,0.95)',
        borderStyle: impacted ? 'dashed' : 'solid',
        opacity: ignored ? 0.42 : impacted ? 0.88 : 1,
        boxShadow: selected || highRisk || needsConfirmation ? undefined : '0 8px 20px -18px rgba(60,50,30,0.35)',
      }}
      title={titleParts.join('\n')}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        style={{ background: impacted ? '#8b9a9d' : meta.color, opacity: 0.8 }}
      />
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        style={{ background: impacted ? '#8b9a9d' : meta.color, opacity: 0.8 }}
      />

      <span
        className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-r"
        style={{ background: meta.color, opacity: selected ? 1 : 0.8 }}
      />

      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ background: meta.soft, color: meta.color }}
        >
          <Icon size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold leading-5 text-mist-100">{node.label}</span>
            {node.renamed ? <CornerUpRight size={11} className="shrink-0 text-mist-600" aria-label={t('重命名')} /> : null}
          </div>
          <div className="truncate font-mono text-[10px] leading-4 text-mist-600" title={titleParts.join(' · ')}>
            {contextLine}
          </div>
        </div>
        <span className="mt-0.5 flex shrink-0 items-center gap-1">
          {isConfig ? (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide"
              style={{ background: 'rgba(47,143,143,0.10)', color: '#2f7373', border: '1px solid rgba(47,143,143,0.30)' }}
              title={configLabel}
            >
              {t('配置')}
            </span>
          ) : null}
          {highRisk ? (
            <span
              className="flex items-center gap-0.5 rounded border border-[rgba(212,58,58,0.45)] bg-[rgba(212,58,58,0.10)] px-1 py-0.5 text-[8.5px] font-medium text-[#b83232]"
              title={t('高风险改动，请优先人工确认')}
            >
              <AlertTriangle size={8.5} />
              {t('高风险')}
            </span>
          ) : needsConfirmation ? (
            <span
              className="flex items-center gap-0.5 rounded border border-[rgba(214,144,0,0.4)] bg-[rgba(214,144,0,0.10)] px-1 py-0.5 text-[8.5px] font-medium text-[#9a6a00]"
              title={t('{count} 个待确认项', { count: openTodos })}
            >
              <ListTodo size={8.5} />
              {t('待确认')} {openTodos}
            </span>
          ) : null}
          {(node.reviewComments ?? 0) > 0 ? (
            <span
              className={cn(
                'flex items-center gap-0.5 rounded px-1 py-0.5 text-[8.5px] font-medium',
                (node.reviewCommentUnresolved ?? 0) > 0
                  ? 'bg-[rgba(169,116,24,0.12)] text-[#a97418]'
                  : 'bg-[rgba(86,111,208,0.10)] text-[#4a5f9e]',
              )}
              title={`${t('{count} 条 Reviewer 评论', { count: node.reviewComments ?? 0 })}${
                (node.reviewCommentUnresolved ?? 0) > 0
                  ? t('，{count} 条未解决', { count: node.reviewCommentUnresolved ?? 0 })
                  : ''
              }`}
            >
              <MessageSquare size={8.5} />
              {node.reviewComments}
            </span>
          ) : null}
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide"
            style={{ background: meta.soft, color: meta.color, border: `1px solid ${meta.border}` }}
          >
            {t(meta.label)}
          </span>
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {impacted ? (
          <span className="truncate text-[10px] text-mist-600">
            {t('未改动')}
            {node.impactOrigins?.length
              ? ` · ${t('依赖 {count} 处变更', { count: node.impactOrigins.length })}`
              : ` · ${t('依赖链影响')}`}
          </span>
        ) : isConfig ? (
          <span className="truncate font-mono text-[10px] text-mist-500" title={configLabel}>
            {t(configLabel)}
          </span>
        ) : (
          <span className="flex items-center gap-2 font-mono text-[10.5px]">
            <span className="text-mint">+{node.stats.additions}</span>
            <span className="text-rose">−{node.stats.deletions}</span>
            {node.binary ? <span className="text-mist-600">binary</span> : null}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          {openTodos > 0 ? (
            <span className="flex items-center gap-0.5 rounded bg-[rgba(169,116,24,0.10)] px-1 py-0.5 text-[9.5px] text-amber">
              <ListTodo size={10} />
              {openTodos}
            </span>
          ) : null}
          {reviewed ? <CheckCircle2 size={13} className="text-mint" aria-label={t('已 Review')} /> : null}
        </span>
      </div>
    </div>
  );
}

export const FileNode = memo(FileNodeComponent);
