import type { EdgeMode } from '../types';
import { STATUS_META } from '../status';

export function Legend({ edgeMode, hasConfigEdges = false }: { edgeMode: EdgeMode; hasConfigEdges?: boolean }) {
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
            {STATUS_META[status].label}
          </span>
        ))}
      </div>
      <div className="mt-1.5 border-t border-line/60 pt-1.5 text-[9px] leading-4 text-mist-500">
        {edgeMode === 'impact' ? (
          <>
            <span className="text-violet-300">紫色虚线「影响」</span> = 变更文件 → 受影响文件
            <br />
            <span className="text-sky-300">蓝色「上游」</span> = 上游依赖 → 下游文件（Review 顺序）
            <br />
            影响模式只保留因果影响边；完整 import 关系切「依赖流向」
            <br />
            图内仅含变更 + 受影响文件；图外上游 import 见节点详情
            {hasConfigEdges ? (
              <>
                <br />
                <span className="text-teal-300">青色「绑定/配置/引用」</span> = 代码 ↔ Mapper XML / Spring 配置
              </>
            ) : null}
          </>
        ) : (
          <>
            箭头 = import 方向：<span className="text-mist-400">A → B 表示 A imports B</span>
            <br />
            点击节点后，连线会标出「import」关系
            {hasConfigEdges ? (
              <>
                <br />
                <span className="text-teal-300">青色边</span> = 代码 ↔ Mapper XML / Spring 配置（绑定 / 配置 / 引用）
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
