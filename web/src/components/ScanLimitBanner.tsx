import { TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { ReviewMeta } from '../types';

// The dependency scan stops after N code files. That used to surface only as a
// line in `meta.warnings` at the very bottom of the sidebar, so a big-repo user
// could stare at a truncated graph without ever knowing it. This banner sits at
// the top of the page and states the real numbers.
interface ScanLimitInfo {
  limit: number;
  codeFiles: number;
  legacyWarning: string | null;
}

function truncationOf(meta: ReviewMeta): ScanLimitInfo | null {
  const limit = meta.scanLimit;
  if (limit?.truncated) {
    return { limit: limit.limit, codeFiles: limit.codeFiles, legacyWarning: null };
  }
  // Reviews generated before `scanLimit` existed only carry the warning text.
  const legacy =
    (meta.warnings ?? []).find((warning) => /capped at/i.test(warning) || /依赖扫描上限/.test(warning)) ?? null;
  return legacy ? { limit: 0, codeFiles: 0, legacyWarning: legacy } : null;
}

function count(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function ScanLimitBanner({ meta }: { meta: ReviewMeta }) {
  const [dismissed, setDismissed] = useState(false);
  const info = truncationOf(meta);
  if (!info || dismissed) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-amber/30 bg-[#fdf6ea] px-4 py-2 text-[11px] text-amber"
    >
      <TriangleAlert size={13} className="mt-[1px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 leading-[1.65]">
        <span className="font-medium">依赖扫描已截断，当前拓扑是不完整的</span>
        {info.legacyWarning ? (
          <span className="text-mist-500">{info.legacyWarning}</span>
        ) : (
          <span className="text-mist-500">
            仓库共有 {count(info.codeFiles)} 个代码文件，本次只分析了前 {count(info.limit)} 个；
            未扫描的文件不会出现在依赖拓扑和影响分析里，可能漏掉受影响文件。
          </span>
        )}
        <span className="text-mist-600">
          需要完整结果时，用 <span className="font-mono">diff-viz --max-scan-files &lt;更大的数字&gt;</span> 重跑。
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="关闭扫描截断提示"
        className="mt-[1px] shrink-0 rounded p-0.5 text-amber/70 transition hover:bg-amber/10 hover:text-amber"
      >
        <X size={12} />
      </button>
    </div>
  );
}
