import { useMemo, useState } from 'react';
import { CircleDot, MessageSquare, X } from 'lucide-react';
import type { ReviewComment, ReviewData } from '../types';
import { CommentCard } from './CommentCard';
import { cn } from '../cn';
import { useI18n } from '../i18n';

export function CommentsPanel({
  data,
  onClose,
  onSelectNode,
}: {
  data: ReviewData;
  onClose: () => void;
  onSelectNode: (path: string) => void;
}) {
  const { t } = useI18n();
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [showGeneral, setShowGeneral] = useState(false);
  const comments = data.comments ?? [];
  const visible = unresolvedOnly ? comments.filter((comment) => comment.resolved === false) : comments;
  const general = visible.filter((comment) => !comment.path);
  const fileGroups = useMemo(() => {
    const byPath = new Map<string, ReviewComment[]>();
    for (const comment of visible) {
      if (!comment.path) continue;
      if (!byPath.has(comment.path)) byPath.set(comment.path, []);
      byPath.get(comment.path)!.push(comment);
    }
    return [...byPath.entries()]
      .map(([path, items]) => {
        const target = data.nodes.find((node) => node.path === path || node.oldPath === path);
        return {
          path,
          targetId: target?.id ?? null,
          comments: items,
          unresolved: items.filter((comment) => comment.resolved === false).length,
          exists: Boolean(target),
        };
      })
      .sort((a, b) => b.unresolved - a.unresolved || b.comments.length - a.comments.length || a.path.localeCompare(b.path));
  }, [visible, data.nodes]);
  const total = comments.length;
  const unresolvedTotal = comments.filter((comment) => comment.resolved === false).length;
  const inlineTotal = comments.filter((comment) => comment.path).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#1b292d]/20 px-4 pb-6 pt-[72px] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[78vh] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl border border-line bg-[#fffdf8] shadow-[0_30px_80px_-40px_rgba(60,50,30,0.45)]">
        <div className="flex shrink-0 items-center justify-between border-b border-line/80 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(74,95,158,0.10)] text-[#4a5f9e]">
              <MessageSquare size={14} />
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-mist-100">{t('Reviewer 评论')}</div>
              <div className="mt-0.5 text-[9px] text-mist-600">
                {t('{total} 条 · {inline} 条挂在文件上 · {general} 条整体讨论', {
                  total,
                  inline: inlineTotal,
                  general: general.length,
                })}
                {unresolvedTotal > 0 ? ` · ${t('{count} 条未解决', { count: unresolvedTotal })}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUnresolvedOnly((value) => !value)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[9.5px] transition',
                unresolvedOnly
                  ? 'border-amber/40 bg-amber/10 text-amber'
                  : 'border-line text-mist-500 hover:text-mist-200',
              )}
              title={t('只看未解决评论')}
            >
              <CircleDot size={10} />
              {t('只看未解决')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-mist-500 transition hover:bg-ink-800 hover:text-mist-100"
              aria-label={t('关闭评论面板')}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {inlineTotal === 0 && comments.length > 0 ? (
            <div className="mb-3 rounded-lg border border-line/70 bg-ink-850/40 px-3 py-2 text-[10px] leading-5 text-mist-500">
              {t('该 MR 的评论都是整体讨论，没有挂在具体文件/行上，因此文件不会显示评论徽章。')}
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-ink-850/40 px-4 py-8 text-center text-[10.5px] text-mist-600">
              {unresolvedOnly ? t('没有未解决的评论。') : t('本次 Review 没有同步到 PR/MR 评论。')}
            </div>
          ) : null}

          {fileGroups.length > 0 ? (
            <section className="mb-4">
              <div className="mb-1.5 flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.12em] text-mist-600">
                {t('按文件')}
                <span className="font-mono text-[8.5px] normal-case tracking-normal text-mist-600">
                  {t('{count} 个文件', { count: fileGroups.length })}
                </span>
              </div>
              <div className="space-y-2.5">
                {fileGroups.map((group) => (
                  <div key={group.path} className="rounded-xl border border-line/80 bg-[#fbf8f0] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!group.exists}
                        onClick={() => {
                          if (group.targetId) {
                            onSelectNode(group.targetId);
                            onClose();
                          }
                        }}
                        className={cn(
                          'min-w-0 flex-1 truncate text-left font-mono text-[10px] transition',
                          group.exists ? 'text-mist-300 hover:text-accent-bright' : 'cursor-default text-mist-600',
                        )}
                        title={
                          group.exists
                            ? t('跳转到 {path}', { path: group.path })
                            : t('{path}（当前 Review 图中没有该文件）', { path: group.path })
                        }
                      >
                        {group.path}
                      </button>
                      <span className="shrink-0 rounded border border-line px-1 py-0.5 font-mono text-[8.5px] text-mist-500">
                        {t('{count} 条', { count: group.comments.length })}
                      </span>
                      {group.unresolved > 0 ? (
                        <span className="shrink-0 rounded border border-amber/35 bg-amber/10 px-1 py-0.5 text-[8.5px] text-amber">
                          {t('未解决 {count}', { count: group.unresolved })}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 space-y-2">
                      {group.comments.map((comment) => (
                        <CommentCard key={comment.id} comment={comment} compact />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {general.length > 0 ? (
            <section className="rounded-xl border border-line/80 bg-[#fbf8f0]">
              <button
                type="button"
                onClick={() => setShowGeneral((value) => !value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-mist-500">
                  {t('整体讨论')}
                </span>
                <span className="rounded border border-line px-1 py-0.5 font-mono text-[8.5px] text-mist-500">
                  {t('{count} 条', { count: general.length })}
                </span>
                <span className="ml-auto text-[9px] text-mist-600">
                  {showGeneral ? t('收起') : t('展开')}
                </span>
              </button>
              {showGeneral ? (
                <div className="space-y-2 border-t border-line/60 px-3 py-3">
                  {general.map((comment) => (
                    <CommentCard key={comment.id} comment={comment} collapsible />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
