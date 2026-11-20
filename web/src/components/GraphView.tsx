import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import type { EdgeMode, LayoutDirection, ReviewEdge } from '../types';
import type { LaneBox, PositionedNode } from '../layout';
import { LaneNode, type LaneFlowNode } from './LaneNode';
import { FileNode, type FileFlowNode } from './FileNode';
import { STATUS_META } from '../status';

const nodeTypes = { file: FileNode, lane: LaneNode };

interface GraphViewProps {
  positioned: PositionedNode[];
  lanes: LaneBox[];
  viewMode: 'flow' | 'lane';
  edges: ReviewEdge[];
  selectedId: string | null;
  direction: LayoutDirection;
  edgeMode: EdgeMode;
  openTodoCounts: Record<string, number>;
  reviewedMap: Record<string, boolean>;
  ignoredMap: Record<string, boolean>;
  drawerWidth?: number;
  sidebarWidth?: number;
  onSelect: (id: string | null) => void;
  onInit?: (instance: ReactFlowInstance) => void;
}

function FocusController({
  positioned,
  selectedId,
  drawerWidth,
}: {
  positioned: PositionedNode[];
  selectedId: string | null;
  drawerWidth: number;
}) {
  const { setCenter, getZoom } = useReactFlow();
  const drawerWidthRef = useRef(drawerWidth);
  drawerWidthRef.current = drawerWidth;
  useEffect(() => {
    if (!selectedId) return undefined;
    const item = positioned.find((entry) => entry.node.id === selectedId);
    if (!item) return undefined;
    const timer = window.setTimeout(() => {
      const zoom = Math.max(getZoom(), 0.85);
      const drawerOffset = drawerWidthRef.current / 2 / zoom;
      void setCenter(item.x + item.width / 2 + drawerOffset, item.y + item.height / 2, {
        zoom,
        duration: 380,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [selectedId, positioned, setCenter, getZoom]);
  return null;
}

function ViewportResizer({
  positioned,
  selectedId,
  drawerWidth,
  resizeKey,
}: {
  positioned: PositionedNode[];
  selectedId: string | null;
  drawerWidth: number;
  resizeKey: string;
}) {
  const { fitView, setCenter, getZoom } = useReactFlow();
  const stateRef = useRef({ positioned, selectedId, drawerWidth });
  stateRef.current = { positioned, selectedId, drawerWidth };
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      if (current.selectedId) {
        const item = current.positioned.find((entry) => entry.node.id === current.selectedId);
        if (!item) return;
        const zoom = Math.max(getZoom(), 0.8);
        void setCenter(
          item.x + item.width / 2 + current.drawerWidth / 2 / zoom,
          item.y + item.height / 2,
          { zoom, duration: 280 },
        );
      } else {
        void fitView({ padding: 0.18, duration: 280, maxZoom: 1.05 });
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [resizeKey, fitView, setCenter, getZoom]);

  return null;
}

function GraphCanvas({
  positioned,
  lanes,
  viewMode,
  edges,
  selectedId,
  direction,
  edgeMode,
  openTodoCounts,
  reviewedMap,
  ignoredMap,
  drawerWidth = 0,
  sidebarWidth = 0,
  onSelect,
  onInit,
}: GraphViewProps) {
  const { fitView } = useReactFlow();

  const nodes = useMemo<Node[]>(() => {
    const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
    const entries: Node[] = [];
    for (const lane of lanes) {
      entries.push({
        id: `lane:${lane.id}`,
        type: 'lane',
        position: { x: lane.x, y: lane.y },
        width: lane.width,
        height: lane.height,
        draggable: false,
        selectable: false,
        zIndex: 0,
        data: { lane },
        style: { width: lane.width, height: lane.height },
      } as LaneFlowNode);
    }
    for (const item of positioned) {
      const lane = item.laneId ? laneById.get(item.laneId) : undefined;
      entries.push({
        id: item.node.id,
        type: 'file',
        position: lane ? { x: item.x - lane.x, y: item.y - lane.y } : { x: item.x, y: item.y },
        ...(lane ? { parentId: `lane:${lane.id}`, extent: 'parent' as const } : {}),
        width: item.width,
        height: item.height,
        draggable: false,
        selectable: false,
        zIndex: 1,
        data: {
          node: item.node,
          direction,
          selected: item.node.id === selectedId,
          openTodos: openTodoCounts[item.node.id] || 0,
          reviewed: Boolean(reviewedMap[item.node.id] ?? item.node.reviewed),
          ignored: Boolean(ignoredMap[item.node.id] ?? item.node.ignored),
          laneMode: viewMode === 'lane',
        },
        style: { width: item.width, height: item.height },
      } as FileFlowNode);
    }
    return entries;
  }, [positioned, lanes, viewMode, direction, selectedId, openTodoCounts, reviewedMap, ignoredMap]);

  const flowEdges = useMemo<Edge[]>(() => {
    const byId = new Map(positioned.map((item) => [item.node.id, item.node]));
    const result: Edge[] = [];
    const seen = new Set<string>();
    for (const edge of edges) {
      const importerNode = byId.get(edge.source);
      const importedNode = byId.get(edge.target);
      if (!importerNode || !importedNode || edge.source === edge.target) continue;

      const importerChanged = importerNode.status !== 'impacted_only';
      const importedChanged = importedNode.status !== 'impacted_only';
      const impactMode = edgeMode === 'impact';

      // An unchanged file that the changed file imports is not a downstream
      // impact of this change. Showing that edge in impact mode would reverse
      // it into a false "untouched file caused the change" arrow; it remains
      // available in dependency mode.
      if (impactMode && importerChanged && !importedChanged) continue;

      const isImpact = impactMode && !importerChanged && importedChanged;
      const source = impactMode ? edge.target : edge.source;
      const target = impactMode ? edge.source : edge.target;
      const edgeRelation = edge.relation || 'imports';
      const relation = impactMode ? (isImpact ? 'impact' : edgeRelation === 'imports' ? 'dependency' : edgeRelation) : edgeRelation;
      const key = `${source}->${target}:${relation}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const connected = Boolean(selectedId && (source === selectedId || target === selectedId));
      const dimmed = Boolean(selectedId && !connected);
      const bothChanged = importerChanged && importedChanged;

      const isResourceEdge = edgeRelation !== 'imports';
      let stroke = '#8b9a9d';
      let dash: string | undefined = '3 5';
      let strokeWidth = 1.25;
      if (isImpact) {
        stroke = '#8b5fbf';
        dash = '7 5';
        strokeWidth = 1.9;
      } else if (isResourceEdge) {
        stroke = '#2f8f8f';
        dash = edgeRelation === 'config' ? '2 4' : '4 3';
        strokeWidth = 1.6;
      } else if (bothChanged) {
        stroke = '#4f7fb3';
        dash = undefined;
        strokeWidth = 1.9;
      }
      if (connected) {
        stroke = '#2f4f8f';
        dash = undefined;
        strokeWidth = 2.5;
      }

      result.push({
        id: edge.id,
        source,
        target,
        type: 'smoothstep',
        animated: connected,
        label:
          relation === 'impact'
            ? '影响'
            : relation === 'dependency'
              ? '上游'
              : relation === 'binds'
                ? '绑定'
                : relation === 'config'
                  ? '配置'
                  : relation === 'class-ref'
                    ? '引用'
                    : 'import',
        labelStyle: {
          fill: connected
            ? '#26353a'
            : relation === 'impact'
              ? '#7a4fa8'
              : relation === 'dependency'
                ? '#3c6b9c'
                : ['binds', 'config', 'class-ref'].includes(relation)
                  ? '#2f7373'
                  : '#66797c',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: '#fffdf8',
          fillOpacity: 0.95,
          stroke: '#ddd5c4',
          strokeWidth: 1,
        },
        labelBgPadding: [6, 2],
        labelBgBorderRadius: 5,
        style: {
          stroke,
          strokeWidth,
          strokeDasharray: dash,
          opacity: dimmed ? 0.1 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 22,
          height: 22,
        },
      } as Edge);
    }
    return result;
  }, [positioned, edges, edgeMode, selectedId]);

  const signature = useMemo(
    () =>
      `${positioned.map((item) => item.node.id).join('|')}:${direction}:${edgeMode}:${viewMode}:${lanes
        .map((lane) => lane.id)
        .join(',')}`,
    [positioned, direction, edgeMode, viewMode, lanes],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 420, maxZoom: 1.05 });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [signature, fitView]);


  return (
    <div className="h-full w-full">
    <ReactFlow
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
      minZoom={0.2}
      maxZoom={1.8}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      selectionOnDrag={false}
      onNodeClick={(_, node) => {
        if (node.type === 'lane') return;
        onSelect(node.id);
      }}
      onPaneClick={() => onSelect(null)}
      onInit={onInit}
      proOptions={{ hideAttribution: true }}
      className="diff-flow"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.15} color="#d8d2c4" />
      <Controls showInteractive={false} position="bottom-right" style={{ bottom: 14, right: 14 }} />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        maskColor="rgba(246, 242, 233, 0.72)"
        nodeColor={(node) => {
          if (node.type === 'lane') return '#f1ecdf';
          const status = (node.data as { node?: { status?: keyof typeof STATUS_META } }).node?.status;
          return status ? STATUS_META[status].color : '#8b9a9d';
        }}
        nodeStrokeWidth={2}
        style={{ width: 146, height: 88, bottom: 54, right: 14 }}
      />
    </ReactFlow>
    <FocusController positioned={positioned} selectedId={selectedId} drawerWidth={drawerWidth} />
    <ViewportResizer
      positioned={positioned}
      selectedId={selectedId}
      drawerWidth={drawerWidth}
      resizeKey={`${sidebarWidth}:${drawerWidth}`}
    />
    </div>
  );
}

export function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
