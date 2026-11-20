import { Layers } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import type { LaneBox } from '../layout';

export interface LaneNodeData extends Record<string, unknown> {
  lane: LaneBox;
}

export type LaneFlowNode = Node<LaneNodeData, 'lane'>;

function LaneNodeComponent({ data }: NodeProps<LaneFlowNode>) {
  const { lane } = data;
  return (
    <div
      className="pointer-events-none h-full w-full rounded-2xl border border-dashed"
      style={{
        borderColor: 'rgba(120, 132, 138, 0.28)',
        background:
          'linear-gradient(180deg, rgba(255, 253, 248, 0.55) 0%, rgba(246, 242, 233, 0.32) 100%)',
      }}
    >
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[rgba(86,111,208,0.12)] text-[#4a5f9e]">
          <Layers size={11} />
        </span>
        <span className="text-[12px] font-semibold text-[#3d4a4f]">{lane.label}</span>
        {lane.path && lane.path !== lane.label ? (
          <span className="truncate font-mono text-[9.5px] text-[#8b9188]">{lane.path}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2 font-mono text-[9px] text-[#8b9188]">
          {lane.changedFiles > 0 ? <span className="text-[#8f6210]">改 {lane.changedFiles}</span> : null}
          {lane.impactedFiles > 0 ? <span>影响 {lane.impactedFiles}</span> : null}
          <span className="rounded border border-[rgba(120,132,138,0.25)] px-1 py-0.5">
            L{lane.order + 1}
          </span>
        </span>
      </div>
      <div className="mx-4 mt-2 h-px bg-[rgba(120,132,138,0.16)]" />
    </div>
  );
}

export function LaneNode(props: NodeProps<LaneFlowNode>) {
  return <LaneNodeComponent {...props} />;
}
