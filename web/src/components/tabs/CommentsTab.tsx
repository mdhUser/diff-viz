import { CheckCircle2, CircleDot, ExternalLink, MessageSquare } from 'lucide-react';
import type { ReviewComment, ReviewData, ReviewNode } from '../../types';
import { formatTimestamp } from '../../format';
import { cn } from '../../cn';

function CommentCard({ comment }: { comment: ReviewComment }) {
  const unresolved = comment.resolved === false;
  const resolved = comment.resolved === true;
  return (
    <article
      className={cn(
        'rounded-xl border bg-[#fffdf8] px-3 py-2.5',
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
      <div className="mt-2 whitespace-pre-wrap break-words text-[10.5px] leading-[1.65] text-mist-400">
        {comment.body || '（空评论）'}
      </div>
    </article>
  );
}

export function CommentsTab({ node, data }: { node: ReviewNode; data: ReviewData }) {
  const all = data.comments ?? [];
  const fileComments = all.filter(
    (comment) => comment.path && (comment.path === node.path || comment.path === node.oldPath),
  );
  const generalComments = all.filter((comment) => !comment.path);
  const pull = data.meta.pull;

  if (all.length === 0) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-xl border border-dashed border-line bg-ink-850/40 px-4 py-6 text-center text-[10.5px] leading-5 text-mist-600">
          <MessageSquare size={16} className="mx-auto mb-2 text-mist-600" />
          本次 Review 没有同步到 PR/MR 评论。
          <br />
          已有评论的 PR/MR 重新打开一次（或重新运行 `--pr/--mr`）即可带上评论。
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-mist-600">
        <span className="flex items-center gap-1 font-medium text-mist-400">
          <MessageSquare size={11} />
          此文件 {fileComments.length} 条
        </span>
        {generalComments.length > 0 ? <span>整体讨论 {generalComments.length} 条</span> : null}
        {pull?.unresolvedCommentCount ? (
          <span className="text-amber">未解决 {pull.unresolvedCommentCount} 条</span>
        ) : null}
      </div>

      {generalComments.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-mist-600">整体讨论</div>
          <div className="space-y-2">
            {generalComments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-mist-600">文件评论</div>
      {fileComments.length === 0 ? (
        <div className="rounded-lg border border-line/70 bg-ink-850/40 px-3 py-5 text-center text-[10px] text-mist-600">
          这个文件还没有 Reviewer 评论。
        </div>
      ) : (
        <div className="space-y-2">
          {fileComments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
        </div>
      )}
    </div>
  );
}
