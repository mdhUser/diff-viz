import { useMemo, useState, type ReactNode } from 'react';
import DiffViewer, { type ReactDiffViewerStylesOverride } from 'react-diff-viewer-continued';
import { Columns2, FileWarning, Loader2, Rows3, ScanLine } from 'lucide-react';
import type { ReviewNode } from '../../types';
import { highlightLanguage } from '../../format';
import { cn } from '../../cn';

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
}

export function DiffTab({ node }: DiffTabProps) {
  const [splitView, setSplitView] = useState(false);
  const [fullFile, setFullFile] = useState(false);

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
        title="该文件没有代码改动"
        description="它因为依赖了变更文件而被纳入 Review。可以回到「摘要」查看依赖关系与影响说明。"
      />
    );
  }

  if (node.binary) {
    return (
      <EmptyPanel
        icon={<FileWarning size={22} />}
        title="二进制文件"
        description="diff-viz 不渲染二进制内容的文本 Diff，请在本地工具中对比该文件。"
      />
    );
  }

  if (node.contentMissing) {
    return (
      <EmptyPanel
        icon={<FileWarning size={22} />}
        title="节点内容缺失"
        description="这个节点的内容文件已被清理或损坏，重新运行一次 diff-viz 即可恢复。"
      />
    );
  }

  if (!contentLoaded) {
    return (
      <EmptyPanel
        icon={<Loader2 size={22} className="animate-spin text-accent" />}
        title="正在加载文件内容"
        description="大仓库的节点内容按需读取，只会加载当前文件。"
      />
    );
  }

  if (noTextChange) {
    return (
      <EmptyPanel
        icon={<ScanLine size={22} />}
        title="没有文本差异"
        description={
          node.renamed
            ? `文件从 ${node.oldPath} 重命名，内容未发生变化。`
            : '该文件只有模式（权限）等元数据变更，没有可展示的文本 Diff。'
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
            title="双栏对比"
          >
            <Columns2 size={11} />
            双栏
          </button>
          <button
            type="button"
            onClick={() => setSplitView(false)}
            className={cn(
              'flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition',
              !splitView ? 'bg-ink-750 text-mist-100' : 'text-mist-600 hover:text-mist-300',
            )}
            title="单栏对比"
          >
            <Rows3 size={11} />
            单栏
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
          title="显示完整文件，而不是只显示改动上下文"
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
          完整文件
        </button>

        <div className="ml-auto flex items-center gap-2 font-mono text-[9.5px]">
          <span className="text-mint">+{node.stats.additions}</span>
          <span className="text-rose">−{node.stats.deletions}</span>
          {hunkCount > 0 ? <span className="text-mist-600">{hunkCount} 处</span> : null}
        </div>
      </div>

      {node.contentTruncated ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber/20 bg-amber/5 px-2.5 py-1.5 text-[10px] text-amber">
          <FileWarning size={11} />
          文件内容超过展示上限，Diff 仅基于前 400,000 个字符计算。
        </div>
      ) : null}

      <div className="diff-shell px-1 py-2">
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
            <span className="diff-fold-label">展开 {totalFoldedLines} 行未改动</span>
          )}
          loadingElement={() => (
            <div className="flex items-center gap-2 px-4 py-8 text-[10.5px] text-mist-500">
              <Loader2 size={13} className="animate-spin text-accent" />
              正在计算 Diff…
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
