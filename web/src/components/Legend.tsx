import type { EdgeMode } from '../types';
import { STATUS_META } from '../status';
import { useI18n } from '../i18n';

export function Legend({ edgeMode, hasConfigEdges = false, hasTableEdges = false }: { edgeMode: EdgeMode; hasConfigEdges?: boolean; hasTableEdges?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-20 rounded-lg border border-line bg-[#fffdf8]/90 px-2.5 py-2 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {(['added', 'modified', 'deleted', 'impacted_only'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1 text-[9.5px] text-mist-500">
            <span
              className="h-[5px] w-[5px] rounded-full"
              style={{
                background: STATUS_META[status].color,
                boxShadow: status === 'impacted_only' ? 'none' : `0 0 6px ${STATUS_META[status].color}55`,
              }}
            />
            {t(STATUS_META[status].label)}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-3 border-t border-line/60 pt-1.5 text-[9.5px] text-mist-500">
        <span className="flex items-center gap-1">
          <span className="node-risk-pulse h-2 w-2 rounded-full border border-rose/80" />
          {t('高风险')}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border-2 border-[#d69000]/80" />
          {t('待确认')}
        </span>
      </div>
      <div className="mt-1.5 border-t border-line/60 pt-1.5 text-[9px] leading-4 text-mist-500">
        {edgeMode === 'impact' ? (
          <>
            <span className="text-violet-300">{t('紫色虚线「影响」')}</span> = {t('变更文件 → 受影响文件')}
            <br />
            <span className="text-sky-300">{t('蓝色「上游」')}</span> = {t('上游依赖 → 下游文件（Review 顺序）')}
            <br />
            {t('影响模式只保留因果影响边；完整 import 关系切「依赖流向」')}
            <br />
            {t('图内仅含变更 + 受影响文件；图外上游 import 见节点详情')}
            {hasConfigEdges ? (
              <>
                <br />
                <span className="text-teal-300">{t('青色「绑定/配置/引用」')}</span> = {t('代码 ↔ Mapper XML / Spring 配置')}
              </>
            ) : null}
            {hasTableEdges ? (
              <>
                <br />
                <span className="text-amber">{t('橙色「读取/写入」')}</span> = {t('Mapper XML / Java SQL → 数据库表')}
              </>
            ) : null}
          </>
        ) : (
          <>
            {t('箭头 = import 方向：')}<span className="text-mist-400">{t('A → B 表示 A imports B')}</span>
            <br />
            {t('点击节点后，连线会标出「import」关系')}
            {hasConfigEdges ? (
              <>
                <br />
                <span className="text-teal-300">{t('青色边')}</span> = {t('代码 ↔ Mapper XML / Spring 配置（绑定 / 配置 / 引用）')}
              </>
            ) : null}
            {hasTableEdges ? (
              <>
                <br />
                <span className="text-amber">{t('橙色边')}</span> = {t('代码 → 数据表（读取 / 写入）')}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
