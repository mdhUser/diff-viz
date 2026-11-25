import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DiffViewer, { type ReactDiffViewerStylesOverride } from 'react-diff-viewer-continued';
import { Columns2, FileWarning, Loader2, MessageSquare, Rows3, ScanLine, Sparkles } from 'lucide-react';
import type { ReviewComment, ReviewData, ReviewNode } from '../../types';
import { formatTimestamp, highlightLanguage } from '../../format';
import { cn } from '../../cn';
import { useI18n } from '../../i18n';

const diffStyles: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: 'transparent',
      diffViewerColor: '#2b3a3f',
      addedBackground: '#e7f4ea',
      addedColor: '#23372b',
      removedBackground: '#fbe9eb',
      removedColor: '#3b272b',
      changedBackground: '#fbf3dd',
      wordAddedBackground: '#c7e9d2',
      wordRemovedBackground: '#f7cbd1',
      addedGutterBackground: '#d9efdf',
      removedGutterBackground: '#f7d9dd',
      gutterBackground: '#f4f0e6',
      gutterBackgroundDark: '#eee9dd',
      highlightBackground: 'rgba(86, 111, 208, 0.10)',
      highlightGutterBackground: 'rgba(86, 111, 208, 0.14)',
      codeFoldGutterBackground: '#f1ede3',
      codeFoldBackground: '#f1ede3',
      emptyLineBackground: '#faf7f0',
      gutterColor: '#8b9188',
      addedGutterColor: '#2f7d54',
      removedGutterColor: '#b04c58',
      codeFoldContentColor: '#65787b',
      diffViewerTitleBackground: '#f4efe5',
      diffViewerTitleColor: '#2b3a3f',
      diffViewerTitleBorderColor: '#ddd5c4',
    },
  },
  contentText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '1.62',
  },
  lineNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
  },
  summary: {
    fontFamily: 'var(--font-sans)',
  },
};

interface DiffTabProps {
  node: ReviewNode;
  data: ReviewData;
}

export function DiffTab({ node, data }: DiffTabProps) {
  const { t } = useI18n();
  const [splitView, setSplitView] = useState(false);
  const [fullFile, setFullFile] = useState(false);
  const [showBubbles, setShowBubbles] = useState(true);
  const diffShellRef = useRef<HTMLDivElement>(null);

  const summaryText = useMemo(
    () => [node.summary, node.impactAnalysis].map((value) => (value || '').trim()).filter(Boolean),
    [node.summary, node.impactAnalysis],
  );
  const fileComments = useMemo(
    () =>
      (data.comments ?? []).filter(
        (comment) =>
          comment.path &&
          (comment.path === node.path || comment.path === node.oldPath) &&
          Number.isFinite(comment.line),
      ),
    [data.comments, node.path, node.oldPath],
  );
  const commentsByLine = useMemo(() => {
    const byLine = new Map<number, ReviewComment[]>();
    for (const comment of fileComments) {
      const line = Number(comment.line);
      if (!Number.isFinite(line)) continue;
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line)!.push(comment);
    }
    return byLine;
  }, [fileComments]);

  // The viewer folds `alwaysShowLines` into its memo key, but it does not
  // recompute when only that prop changes; switching it while the diff is
  // mounted makes the table render empty. Keep the requested comment lines
  // independent from the bubble toggle so showing/hiding bubbles never
  // invalidates the computed diff.
  const commentAnchorLines = useMemo(
    () => [
      ...new Set(
        fileComments.map((comment) => `${comment.side === 'old' ? 'L' : 'R'}-${Number(comment.line)}`),
      ),
    ],
    [fileComments],
  );

  // Review bubbles are real rows inserted into the diff table, not floating
  // overlays: the code stays readable and the rows push the diff down. The
  // library only exposes per-line cells, so after it renders we insert one
  // full-width row after each commented line (and the summary row at the top).
  // A MutationObserver keeps them in sync when the viewer recomputes or folds.
  useEffect(() => {
    const root = diffShellRef.current;
    if (!root) return;

    const clearRows = () => {
      root.querySelectorAll('tr.diff-inline-bubble-row').forEach((row) => row.remove());
    };

    // Hiding bubbles only removes the injected rows: the diff props stay
    // untouched, so the viewer keeps its computed (and visible) diff.
    if (!showBubbles) {
      clearRows();
      return;
    }

    let frame = 0;
    let innerFrame = 0;
    let disposed = false;
    let observer: MutationObserver | null = null;
    let applying = false;

    const makeText = (tag: 'div' | 'span', className: string, text: string) => {
      const node = document.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };

    const makeRow = (tbody: Element, columns: number, kind: 'summary' | 'comment') => {
      const row = document.createElement('tr');
      row.className = `diff-inline-bubble-row diff-inline-${kind}`;
      const cell = document.createElement('td');
      cell.colSpan = columns;
      row.appendChild(cell);
      return { row, cell };
    };

    const insertBubbles = () => {
      if (disposed) return;
      applying = true;
      observer?.disconnect();
      clearRows();
      const table = root.querySelector('table');
      const tbody = table?.querySelector('tbody');
      if (table && tbody) {
        const columns = table.querySelector('colgroup')?.children.length ?? 5;

        if (summaryText.length > 0) {
          const { row, cell } = makeRow(tbody, columns, 'summary');
          const bubble = document.createElement('div');
          bubble.className = 'diff-inline-bubble diff-inline-summary';
          const title = document.createElement('div');
          title.className = 'diff-inline-bubble-title';
          const icon = document.createElement('span');
          icon.className = 'diff-inline-bubble-icon';
          icon.textContent = '✦';
          title.appendChild(icon);
          title.appendChild(document.createTextNode(t('文件摘要')));
          bubble.appendChild(title);
          bubble.appendChild(makeText('div', 'diff-inline-bubble-body', node.summary?.trim() || summaryText[0]));
          if (node.impactAnalysis?.trim()) {
            bubble.appendChild(makeText('div', 'diff-inline-bubble-sub', node.impactAnalysis.trim()));
          }
          cell.appendChild(bubble);
          tbody.insertBefore(row, tbody.firstElementChild);
        }

        for (const [line, comments] of commentsByLine) {
          const gutter = table.querySelector(`td[data-line-new="${line}"]`);
          const anchorRow = gutter?.closest('tr');
          if (!anchorRow) continue;
          const { row, cell } = makeRow(tbody, columns, 'comment');
          const thread = document.createElement('div');
          thread.className = 'diff-inline-thread';
          for (const comment of comments) {
            const bubble = document.createElement('div');
            bubble.className = 'diff-inline-comment';
            const head = document.createElement('div');
            head.className = 'diff-inline-comment-head';
            head.appendChild(makeText('span', 'diff-inline-author', comment.author || t('未知作者')));
            if (comment.createdAt) {
              head.appendChild(makeText('span', 'diff-inline-time', formatTimestamp(comment.createdAt)));
            }
            head.appendChild(makeText('span', 'diff-inline-line', `L${line}`));
            head.appendChild(
              makeText(
                'span',
                comment.resolved ? 'diff-inline-resolved' : 'diff-inline-unresolved',
                comment.resolved ? t('已解决') : t('未解决'),
              ),
            );
            if (comment.url) {
              const link = document.createElement('a');
              link.href = comment.url;
              link.target = '_blank';
              link.rel = 'noreferrer';
              link.className = 'diff-inline-link';
              link.textContent = t('远端查看');
              head.appendChild(link);
            }
            bubble.appendChild(head);
            bubble.appendChild(makeText('div', 'diff-inline-body', comment.body || ''));
            thread.appendChild(bubble);
          }
          cell.appendChild(thread);
          anchorRow.after(row);
        }
      }
      applying = false;
      if (observer) observer.observe(root, { childList: true, subtree: true });
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(innerFrame);
      frame = requestAnimationFrame(() => {
        innerFrame = requestAnimationFrame(insertBubbles);
      });
    };

    schedule();
    observer = new MutationObserver(() => {
      if (!applying) schedule();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(innerFrame);
      observer?.disconnect();
      clearRows();
    };
  }, [node.id, showBubbles, summaryText, commentsByLine, t]);

  const hunkCount = useMemo(
    () => node.hunkCount ?? (node.diff ? (node.diff.match(/^@@/gm) || []).length : 0),
    [node.hunkCount, node.diff],
  );
  const oldValue = node.oldContent ?? '';
  const newValue = node.newContent ?? '';
  const contentLoaded = node.contentLoaded === true || node.oldContent !== undefined || node.newContent !== undefined;
  const noTextChange = contentLoaded && !node.binary && oldValue === newValue;

  if (node.status === 'impacted_only') {
    return (
      <EmptyPanel
        icon={<ScanLine size={22} />}
        title={t('该文件没有代码改动')}
        description={t('它因为依赖了变更文件而被纳入 Review。可以回到「摘要」查看依赖关系与影响说明。')}
      />
    );
  }

  if (node.binary) {
    return (
      <EmptyPanel
        icon={<FileWarning size={22} />}
        title={t('二进制文件')}
        description={t('diff-viz 不渲染二进制内容的文本 Diff，请在本地工具中对比该文件。')}
      />
    );
  }

  if (node.contentMissing) {
    return (
      <EmptyPanel
        icon={<FileWarning size={22} />}
        title={t('节点内容缺失')}
        description={t('这个节点的内容文件已被清理或损坏，重新运行一次 diff-viz 即可恢复。')}
      />
    );
  }

  if (!contentLoaded) {
    return (
      <EmptyPanel
        icon={<Loader2 size={22} className="animate-spin text-accent" />}
        title={t('正在加载文件内容')}
        description={t('大仓库的节点内容按需读取，只会加载当前文件。')}
      />
    );
  }

  if (noTextChange) {
    return (
      <EmptyPanel
        icon={<ScanLine size={22} />}
        title={t('没有文本差异')}
        description={
          node.renamed
            ? t('文件从 {path} 重命名，内容未发生变化。', { path: node.oldPath ?? '' })
            : t('该文件只有模式（权限）等元数据变更，没有可展示的文本 Diff。')
        }
      />
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line/80 bg-[#fbf9f3]/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center rounded-lg bg-ink-900/80 p-0.5">
          <button
            type="button"
            onClick={() => setSplitView(true)}
            className={cn(
              'flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition',
              splitView ? 'bg-ink-750 text-mist-100' : 'text-mist-600 hover:text-mist-300',
            )}
            title={t('双栏对比')}
          >
            <Columns2 size={11} />
            {t('双栏')}
          </button>
          <button
            type="button"
            onClick={() => setSplitView(false)}
            className={cn(
              'flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition',
              !splitView ? 'bg-ink-750 text-mist-100' : 'text-mist-600 hover:text-mist-300',
            )}
            title={t('单栏对比')}
          >
            <Rows3 size={11} />
            {t('单栏')}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setFullFile((value) => !value)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] transition',
            fullFile
              ? 'border-accent/30 bg-accent-soft text-accent-bright'
              : 'border-line bg-ink-900/50 text-mist-500 hover:text-mist-300',
          )}
          title={t('显示完整文件，而不是只显示改动上下文')}
        >
          <span
            className={cn(
              'relative h-3 w-[17px] rounded-full transition',
              fullFile ? 'bg-accent/60' : 'bg-ink-750',
            )}
          >
            <span
              className={cn(
                'absolute top-[2px] h-2 w-2 rounded-full bg-white transition-all',
                fullFile ? 'left-[8px]' : 'left-[2px]',
              )}
            />
          </span>
          {t('完整文件')}
        </button>

        {summaryText.length > 0 || fileComments.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowBubbles((value) => !value)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] transition',
              showBubbles
                ? 'border-accent/30 bg-accent-soft text-accent-bright'
                : 'border-line bg-ink-900/50 text-mist-500 hover:text-mist-300',
            )}
            title={showBubbles ? t('隐藏气泡') : t('显示气泡')}
          >
            <MessageSquare size={11} />
            {t('气泡')}
            {fileComments.length > 0 ? (
              <span className="font-mono text-[8.5px] text-mist-500">{fileComments.length}</span>
            ) : null}
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2 font-mono text-[9.5px]">
          <span className="text-mint">+{node.stats.additions}</span>
          <span className="text-rose">−{node.stats.deletions}</span>
          {hunkCount > 0 ? <span className="text-mist-600">{t('{count} 处', { count: hunkCount })}</span> : null}
        </div>
      </div>

      {node.contentTruncated ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber/20 bg-amber/5 px-2.5 py-1.5 text-[10px] text-amber">
          <FileWarning size={11} />
          {t('文件内容超过展示上限，Diff 仅基于前 400,000 个字符计算。')}
        </div>
      ) : null}

      <div ref={diffShellRef} className="diff-shell relative px-1 py-2">
        <DiffViewer
          key={`${node.id}-${splitView ? 'split' : 'unified'}-${fullFile ? 'full' : 'folded'}`}
          oldValue={oldValue}
          newValue={newValue}
          splitView={splitView}
          useDarkTheme={false}
          showDiffOnly={!fullFile}
          hideSummary
          extraLinesSurroundingDiff={4}
          highlightLanguage={highlightLanguage(node.language)}
          styles={diffStyles}
          codeFoldMessageRenderer={(totalFoldedLines) => (
            <span className="diff-fold-label">{t('展开 {count} 行未改动', { count: totalFoldedLines })}</span>
          )}
          alwaysShowLines={commentAnchorLines}
          renderGutter={({ lineNumber, additionalLineNumber, prefix, additionalPrefix }) => {
            const oldLine = String(prefix) === 'L' ? lineNumber || undefined : undefined;
            const newLine =
              String(prefix) === 'R'
                ? lineNumber || additionalLineNumber || undefined
                : String(additionalPrefix) === 'R'
                  ? additionalLineNumber || undefined
                  : undefined;
            return <td className="diff-bubble-gutter" data-line-old={oldLine} data-line-new={newLine} />;
          }}
          loadingElement={() => (
            <div className="flex items-center gap-2 px-4 py-8 text-[10.5px] text-mist-500">
              <Loader2 size={13} className="animate-spin text-accent" />
              {t('正在计算 Diff…')}
            </div>
          )}
        />
      </div>
    </div>
  );
}

function EmptyPanel({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="animate-fade-up flex h-full flex-col items-center justify-center px-10 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-800/60 text-mist-500">
        {icon}
      </div>
      <div className="mt-3 text-[12.5px] font-medium text-mist-200">{title}</div>
      <p className="mt-1.5 max-w-[320px] text-[10.5px] leading-5 text-mist-600">{description}</p>
    </div>
  );
}
