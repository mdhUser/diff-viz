import { useState, type FormEvent } from 'react';
import { Check, CheckCheck, ListChecks, Plus, Sparkles, TriangleAlert } from 'lucide-react';
import type { ReviewNode, ReviewTodo } from '../../types';
import { SOURCE_META, severityMeta } from '../../status';
import { cn } from '../../cn';
import { useI18n } from '../../i18n';

interface TodosTabProps {
  node: ReviewNode;
  todos: ReviewTodo[];
  isDone: (todo: ReviewTodo) => boolean;
  onToggle: (todo: ReviewTodo, completed: boolean) => void;
  onAdd: (text: string) => Promise<boolean>;
  serverOnline: boolean;
}

export function TodosTab({ node, todos, isDone, onToggle, onAdd, serverOnline }: TodosTabProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const completed = todos.filter((todo) => isDone(todo)).length;
  const percent = todos.length === 0 ? 0 : Math.round((completed / todos.length) * 100);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    const ok = await onAdd(value);
    setSubmitting(false);
    if (ok) setText('');
  };

  return (
    <div className="animate-fade-up space-y-4 px-5 py-4">
      <div className="rounded-xl border border-line bg-ink-800/50 p-3.5">
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[24px] font-medium leading-none text-mist-50">{completed}</span>
              <span className="font-mono text-[11px] text-mist-600">/ {todos.length}</span>
            </div>
            <div className="mt-1.5 text-[10px] text-mist-500">{t('待确认项已处理')}</div>
          </div>
          <span
            className={cn(
              'rounded-md border px-1.5 py-1 text-[9px]',
              percent === 100 && todos.length > 0
                ? 'border-mint/25 bg-mint/10 text-mint'
                : 'border-line text-mist-600',
            )}
          >
            {percent}%
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink-750">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-mint transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {todos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-800/60 text-mist-500">
            <ListChecks size={21} />
          </div>
          <div className="mt-3 text-[12px] font-medium text-mist-200">{t('没有待确认项')}</div>
          <p className="mt-1.5 max-w-[280px] text-[10.5px] leading-5 text-mist-600">
            {t('代码 Diff 中没有新增 TODO/FIXME，Agent 也没有标记风险点。你仍然可以在下面添加自己的 Review 备注。')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {todos.map((todo) => {
            const done = isDone(todo);
            const source = SOURCE_META[todo.source] ?? { label: todo.source, icon: Sparkles };
            const SourceIcon = source.icon;
            const severity = severityMeta(todo.severity);
            return (
              <div
                key={todo.id}
                className={cn(
                  'group rounded-xl border p-3 transition',
                  done
                    ? 'border-line/60 bg-ink-900/30 opacity-70'
                    : 'border-line bg-gradient-to-b from-ink-800/70 to-ink-900/30 hover:border-line',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    onClick={() => onToggle(todo, !done)}
                    className={cn(
                      'mt-0.5 flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border transition',
                      done
                        ? 'border-mint bg-mint text-ink-950'
                        : 'border-[#c9c2b3] bg-ink-900 text-transparent hover:border-mint/60',
                    )}
                    aria-label={done ? t('标记为未完成') : t('标记为完成')}
                  >
                    <Check size={11} strokeWidth={3} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'break-words text-[11.5px] leading-[1.6]',
                        done ? 'text-mist-600 line-through' : 'text-mist-200',
                      )}
                    >
                      {todo.text}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="flex items-center gap-1 rounded border border-line bg-ink-850 px-1.5 py-0.5 text-[8.5px] text-mist-500">
                        <SourceIcon size={8.5} />
                        {t(source.label)}
                      </span>
                      {severity ? (
                        <span
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[8.5px]"
                          style={{ background: severity.bg, color: severity.color }}
                        >
                          <TriangleAlert size={8.5} />
                          {t(severity.label)}
                        </span>
                      ) : null}
                      {todo.line ? (
                        <span className="font-mono text-[8.5px] text-mist-600">L{todo.line}</span>
                      ) : null}
                      {todo.category ? (
                        <span className="rounded border border-line px-1.5 py-0.5 text-[8.5px] text-mist-600">
                          {todo.category}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="rounded-xl border border-line bg-ink-900/40 p-2.5">
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('添加一条需要人工确认的点…')}
            maxLength={500}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-ink-850 px-2.5 text-[11px] text-mist-200 outline-none transition placeholder:text-mist-600 focus:border-accent/40"
          />
          <button
            type="submit"
            disabled={!text.trim() || submitting}
            className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-[10.5px] font-medium text-[#fbf9f4] transition hover:bg-accent-bright disabled:cursor-default disabled:opacity-40"
          >
            <Plus size={12} />
            {t('添加')}
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 px-0.5 text-[9px] text-mist-600">
          <CheckCheck size={9} />
          {serverOnline ? t('会写回 .diff-review-data.json，并同步浏览器本地状态') : t('服务不可用，仅保存在浏览器本地')}
        </div>
      </form>

      {node.status !== 'impacted_only' ? (
        <p className="px-1 text-[9.5px] leading-4 text-mist-600">
          {t('自动扫描范围：本次 Diff 新增行中的 TODO / FIXME / XXX / HACK / BUG 注释。')}
        </p>
      ) : null}
    </div>
  );
}
