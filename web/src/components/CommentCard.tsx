import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, CircleDot, ExternalLink } from 'lucide-react';
import type { ReviewComment } from '../types';
import { formatTimestamp } from '../format';
import { cn } from '../cn';

export function CommentCard({
  comment,
  compact = false,
  collapsible = false,
}: {
  comment: ReviewComment;
  compact?: boolean;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = comment.body || '（空评论）';
  const needsCollapse = collapsible && body.length > 260;
  const unresolved = comment.resolved === false;
  const resolved = comment.resolved === true;
  return (
    <article
      className={cn(
        'rounded-xl border bg-[#fffdf8]',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
        unresolved ? 'border-amber/40' : 'border-line/80',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-mist-600">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-800 font-mono text-[8.5px] uppercase text-mist-300">
          {(comment.author || '?').slice(0, 1)}
        </span>
        <span className="font-medium text-mist-300">{comment.author || '未知作者'}</span>
        {comment.createdAt ? <span>{formatTimestamp(comment.createdAt)}</span> : null}
        {comment.line ? (
          <span className="rounded border border-line px-1 py-0.5 font-mono text-[8px] text-mist-500">
            L{comment.startLine && comment.startLine !== comment.line ? `${comment.startLine}-` : ''}
            {comment.line}
            {comment.side === 'old' ? ' 旧' : ''}
          </span>
        ) : null}
        {resolved ? (
          <span className="flex items-center gap-0.5 rounded border border-mint/30 bg-mint/10 px-1 py-0.5 text-mint">
            <CheckCircle2 size={8} />
            已解决
          </span>
        ) : null}
        {unresolved ? (
          <span className="flex items-center gap-0.5 rounded border border-amber/35 bg-amber/10 px-1 py-0.5 text-amber">
            <CircleDot size={8} />
            未解决
          </span>
        ) : null}
        {comment.outdated ? (
          <span className="rounded border border-line px-1 py-0.5 text-mist-600">代码已变更</span>
        ) : null}
        {comment.url ? (
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-0.5 text-accent-bright transition hover:text-accent"
          >
            远端查看
            <ExternalLink size={8} />
          </a>
        ) : null}
      </div>
      <div
        className={cn(
          'mt-2 whitespace-pre-wrap break-words text-[10.5px] leading-[1.65] text-mist-400',
          compact && !needsCollapse ? 'max-h-[120px] overflow-y-auto' : '',
          needsCollapse && !expanded ? 'max-h-[104px] overflow-hidden' : '',
        )}
      >
        {body}
      </div>
      {needsCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 flex items-center gap-0.5 text-[9px] text-accent-bright transition hover:text-accent"
        >
          {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          {expanded ? '收起' : '展开全文'}
        </button>
      ) : null}
    </article>
  );
}
