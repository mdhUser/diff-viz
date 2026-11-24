import { MessageSquare } from 'lucide-react';
import type { ReviewData, ReviewNode } from '../../types';
import { useI18n } from '../../i18n';
import { CommentCard } from '../CommentCard';

export function CommentsTab({
  node,
  data,
  onOpenAllComments,
}: {
  node: ReviewNode;
  data: ReviewData;
  onOpenAllComments?: () => void;
}) {
  const { t } = useI18n();
  const all = data.comments ?? [];
  const fileComments = all.filter(
    (comment) => comment.path && (comment.path === node.path || comment.path === node.oldPath),
  );
  const generalComments = all.filter((comment) => !comment.path);
  const unresolved = fileComments.filter((comment) => comment.resolved === false).length;

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] text-mist-600">
        <span className="flex items-center gap-1 font-medium text-mist-400">
          <MessageSquare size={11} />
          {t('此文件 {count} 条', { count: fileComments.length })}
        </span>
        {unresolved > 0 ? <span className="text-amber">{t('未解决 {count} 条', { count: unresolved })}</span> : null}
        {onOpenAllComments ? (
          <button
            type="button"
            onClick={onOpenAllComments}
            className="ml-auto underline decoration-dotted underline-offset-2 transition hover:text-mist-300"
          >
            {t('查看 MR 全部讨论')}{generalComments.length > 0 ? t('（整体 {count} 条）', { count: generalComments.length }) : ''}
          </button>
        ) : null}
      </div>

      {fileComments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line/70 bg-ink-850/40 px-3 py-6 text-center text-[10px] leading-5 text-mist-600">
          {t('这个文件没有 Reviewer 评论。')}
          {generalComments.length > 0 ? (
            <>
              <br />
              {t('MR 还有 {count} 条整体讨论，可用右上角「查看 MR 全部讨论」查看。', { count: generalComments.length })}
            </>
          ) : null}
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
