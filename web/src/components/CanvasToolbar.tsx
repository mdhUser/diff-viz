import { ArrowDown, ArrowRight, ArrowRightLeft, Database, FileCog, GitFork, Layers, MessageSquare } from 'lucide-react';
import type { EdgeMode, LayoutDirection } from '../types';
import type { LaneGroupBy } from '../lanes';
import { cn } from '../cn';
import { useI18n } from '../i18n';

interface CanvasToolbarProps {
  edgeMode: EdgeMode;
  direction: LayoutDirection;
  viewMode: 'flow' | 'lane';
  groupBy: LaneGroupBy;
  showImpacted: boolean;
  showConfig: boolean;
  showDb: boolean;
  commentsOnly: boolean;
  commentCount: number;
  changedCount: number;
  impactedCount: number;
  configCount: number;
  tableCount: number;
  onEdgeModeChange: (mode: EdgeMode) => void;
  onDirectionChange: (direction: LayoutDirection) => void;
  onViewModeChange: (mode: 'flow' | 'lane') => void;
  onGroupByChange: (groupBy: LaneGroupBy) => void;
  onToggleImpacted: () => void;
  onToggleConfig: () => void;
  onToggleDb: () => void;
  onToggleCommentsOnly: () => void;
}

export function CanvasToolbar({
  edgeMode,
  direction,
  viewMode,
  groupBy,
  showImpacted,
  showConfig,
  showDb,
  commentsOnly,
  commentCount,
  changedCount,
  impactedCount,
  configCount,
  tableCount,
  onEdgeModeChange,
  onDirectionChange,
  onViewModeChange,
  onGroupByChange,
  onToggleImpacted,
  onToggleConfig,
  onToggleDb,
  onToggleCommentsOnly,
}: CanvasToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="absolute left-3.5 top-3.5 z-20 flex items-center gap-1 rounded-xl border border-line/90 bg-ink-850/90 p-1 shadow-[0_14px_30px_-24px_rgba(60,50,30,0.35)] backdrop-blur-md">
      <div className="flex items-center rounded-lg bg-ink-900/70 p-0.5">
        <button
          type="button"
          onClick={() => onEdgeModeChange('impact')}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
            edgeMode === 'impact' ? 'bg-accent-soft text-accent-bright' : 'text-mist-500 hover:text-mist-200',
          )}
          title={t('影响流向：变更文件 → 受影响文件；改动文件之间显示上游 → 下游的 Review 顺序')}
        >
          <ArrowRightLeft size={11.5} />
          {t('影响流向')}
        </button>
        <button
          type="button"
          onClick={() => onEdgeModeChange('dependency')}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
            edgeMode === 'dependency' ? 'bg-accent-soft text-accent-bright' : 'text-mist-500 hover:text-mist-200',
          )}
          title={t('依赖流向：A → B 表示 A imports B')}
        >
          <GitFork size={11.5} />
          {t('依赖流向')}
        </button>
      </div>

      <div className="mx-0.5 h-4 w-px bg-line" />

      <div className="flex items-center rounded-lg bg-ink-900/70 p-0.5">
        <button
          type="button"
          onClick={() => onViewModeChange('flow')}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
            viewMode === 'flow' ? 'bg-accent-soft text-accent-bright' : 'text-mist-500 hover:text-mist-200',
          )}
          title={t('流向视图：单张平铺图，不按模块分泳道')}
        >
          <ArrowRightLeft size={11.5} />
          {t('流向')}
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('lane')}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
            viewMode === 'lane' ? 'bg-accent-soft text-accent-bright' : 'text-mist-500 hover:text-mist-200',
          )}
          title={t('泳道视图：按模块/目录/包分层，入口层在上')}
        >
          <Layers size={11.5} />
          {t('泳道')}
        </button>
      </div>

      {viewMode === 'lane' ? (
        <div className="flex items-center rounded-lg p-0.5">
          {([
            ['module', '模块'],
            ['directory', '目录'],
            ['package', '包'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onGroupByChange(value)}
              className={cn(
                'flex h-7 items-center rounded-md px-1.5 text-[10px] transition',
                groupBy === value ? 'bg-ink-750 text-mist-100' : 'text-mist-600 hover:text-mist-300',
              )}
              title={t('按{label}分组泳道', { label: t(label) })}
            >
              {t(label)}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => onDirectionChange('LR')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition',
              direction === 'LR' ? 'bg-ink-750 text-mist-100' : 'text-mist-600 hover:text-mist-300',
            )}
            title={t('横向布局')}
          >
            <ArrowRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => onDirectionChange('TB')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition',
              direction === 'TB' ? 'bg-ink-750 text-mist-100' : 'text-mist-600 hover:text-mist-300',
            )}
            title={t('纵向布局')}
          >
            <ArrowDown size={13} />
          </button>
        </div>
      )}

      <div className="mx-0.5 h-4 w-px bg-line" />

      {tableCount > 0 ? (
        <>
          <button
            type="button"
            onClick={onToggleDb}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
              showDb ? 'text-[#a35f14]' : 'text-mist-600',
            )}
            title={showDb ? t('隐藏数据库表') : t('显示数据库表')}
          >
            <Database size={11.5} />
            {t('数据表')}
            <span className="font-mono text-[9px] text-mist-600">{tableCount}</span>
          </button>
          <div className="mx-0.5 h-4 w-px bg-line" />
        </>
      ) : null}

      {commentCount > 0 ? (
        <>
          <button
            type="button"
            onClick={onToggleCommentsOnly}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
              commentsOnly ? 'text-[#4a5f9e]' : 'text-mist-600',
            )}
            title={commentsOnly ? t('显示全部文件') : t('只看有 Reviewer 评论的文件')}
          >
            <MessageSquare size={11.5} />
            {t('有评论')}
            <span className="font-mono text-[9px] text-mist-600">{commentCount}</span>
          </button>
          <div className="mx-0.5 h-4 w-px bg-line" />
        </>
      ) : null}

      {configCount > 0 ? (
        <>
          <button
            type="button"
            onClick={onToggleConfig}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
              showConfig ? 'text-[#2f7373]' : 'text-mist-600',
            )}
            title={showConfig ? t('隐藏配置文件节点') : t('显示配置文件节点')}
          >
            <FileCog size={11.5} />
            {t('配置')}
            <span className="font-mono text-[9px] text-mist-600">{configCount}</span>
          </button>
          <div className="mx-0.5 h-4 w-px bg-line" />
        </>
      ) : null}

      <button
        type="button"
        onClick={onToggleImpacted}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] transition',
          showImpacted ? 'text-mist-300' : 'text-mist-600',
        )}
        title={showImpacted ? t('隐藏受影响文件') : t('显示受影响文件')}
      >
        <Layers size={11.5} className={showImpacted ? 'text-accent' : ''} />
        {t('受影响')}
        <span className="font-mono text-[9px] text-mist-600">{showImpacted ? impactedCount : `${changedCount}`}</span>
        <span
          className={cn(
            'relative ml-0.5 h-3 w-[18px] rounded-full transition',
            showImpacted ? 'bg-accent/60' : 'bg-ink-750',
          )}
        >
          <span
            className={cn(
              'absolute top-[2px] h-2 w-2 rounded-full bg-white transition-all',
              showImpacted ? 'left-[9px]' : 'left-[2px]',
            )}
          />
        </span>
      </button>
    </div>
  );
}
