import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { EdgeMode, LayoutDirection, ReviewEdge, ReviewTable } from '../types';
import type { LaneBox, PositionedItem } from '../layout';
import { LaneNode, type LaneFlowNode } from './LaneNode';
import { FileNode, type FileFlowNode } from './FileNode';
import { TableNode, type TableFlowNode } from './TableNode';
import { SqlHoverCard } from './SqlHoverCard';
import { STATUS_META } from '../status';
import { useI18n } from '../i18n';

const nodeTypes = { file: FileNode, lane: LaneNode, table: TableNode };

interface GraphViewProps {
  positioned: PositionedItem[];
  lanes: LaneBox[];
  viewMode: 'flow' | 'lane';
  tableDetails: Record<string, ReviewTable>;
  onRequestTable: (tableId: string) => void;
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
  positioned: PositionedItem[];
  selectedId: string | null;
  drawerWidth: number;
}) {
  const { setCenter, getZoom } = useReactFlow();
  const drawerWidthRef = useRef(drawerWidth);
  drawerWidthRef.current = drawerWidth;
  useEffect(() => {
    if (!selectedId) return undefined;
    const item = positioned.find((entry) => entry.id === selectedId);
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
  positioned: PositionedItem[];
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
        const item = current.positioned.find((entry) => entry.id === current.selectedId);
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
  tableDetails,
  onRequestTable,
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
  const { t } = useI18n();
  const [hoveredTable, setHoveredTable] = useState<{ id: string; x: number; y: number } | null>(null);

  const handleHoverStart = useCallback(
    (tableId: string, event: { clientX: number; clientY: number }) => {
      onRequestTable(tableId);
      setHoveredTable({ id: tableId, x: event.clientX, y: event.clientY });
    },
    [onRequestTable],
  );
  const handleHoverEnd = useCallback(() => setHoveredTable(null), []);

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
      const position = lane ? { x: item.x - lane.x, y: item.y - lane.y } : { x: item.x, y: item.y };
      const parent = lane ? { parentId: `lane:${lane.id}`, extent: 'parent' as const } : {};
      if (item.kind === 'table' && item.table) {
        entries.push({
          id: item.id,
          type: 'table',
          position,
          ...parent,
          width: item.width,
          height: item.height,
          draggable: false,
          selectable: false,
          zIndex: 1,
          data: {
            table: item.table,
            selected: item.id === selectedId,
            onHoverStart: handleHoverStart,
            onHoverEnd: handleHoverEnd,
          },
          style: { width: item.width, height: item.height },
        } as TableFlowNode);
        continue;
      }
      const node = item.node;
      if (!node) continue;
      entries.push({
        id: node.id,
        type: 'file',
        position,
        ...parent,
        width: item.width,
        height: item.height,
        draggable: false,
        selectable: false,
        zIndex: 1,
        data: {
          node,
          direction,
          selected: node.id === selectedId,
          openTodos: openTodoCounts[node.id] || 0,
          reviewed: Boolean(reviewedMap[node.id] ?? node.reviewed),
          ignored: Boolean(ignoredMap[node.id] ?? node.ignored),
          laneMode: viewMode === 'lane',
        },
        style: { width: item.width, height: item.height },
      } as FileFlowNode);
    }
    return entries;
  }, [
    positioned,
    lanes,
    viewMode,
    direction,
    selectedId,
    openTodoCounts,
    reviewedMap,
    ignoredMap,
    handleHoverStart,
    handleHoverEnd,
  ]);

  const flowEdges = useMemo<Edge[]>(() => {
    const byId = new Map(positioned.map((item) => [item.id, item]));
    const result: Edge[] = [];
    const seen = new Set<string>();
    for (const edge of edges) {
      const importerNode = byId.get(edge.source);
      const importedNode = byId.get(edge.target);
      if (!importerNode || !importedNode || edge.source === edge.target) continue;

      const edgeRelation = edge.relation || 'imports';
      const isTableEdge = edgeRelation === 'reads_table' || edgeRelation === 'writes_table';
      const importerChanged = importerNode.changed;
      const importedChanged = importedNode.changed;
      const impactMode = edgeMode === 'impact';

      // Table edges always point code/config -> table; they are a data-access
      // relationship, not a code impact direction.
      if (!isTableEdge && impactMode && importerChanged && !importedChanged) continue;

      const isImpact = !isTableEdge && impactMode && !importerChanged && importedChanged;
      const source = impactMode && !isTableEdge ? edge.target : edge.source;
      const target = impactMode && !isTableEdge ? edge.source : edge.target;
      const relation = isTableEdge
        ? edgeRelation
        : impactMode
          ? isImpact
            ? 'impact'
            : edgeRelation === 'imports'
              ? 'dependency'
              : edgeRelation
          : edgeRelation;
      const key = `${source}->${target}:${relation}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const connected = Boolean(selectedId && (source === selectedId || target === selectedId));
      const dimmed = Boolean(selectedId && !connected);
      const bothChanged = !isTableEdge && importerChanged && importedChanged;

      const isResourceEdge = !isTableEdge && edgeRelation !== 'imports';
      let stroke = '#8b9a9d';
      let dash: string | undefined = '3 5';
      let strokeWidth = 1.25;
      if (isTableEdge) {
        stroke = '#c47a2c';
        dash = undefined;
        strokeWidth = 1.6;
      } else if (isImpact) {
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
            ? t('影响')
            : relation === 'dependency'
              ? t('上游')
              : relation === 'binds'
                ? t('绑定')
                : relation === 'config'
                  ? t('配置')
                  : relation === 'class-ref'
                    ? t('引用')
                    : relation === 'reads_table'
                      ? t('读取')
                      : relation === 'writes_table'
                        ? t('写入')
                        : t('import'),
        labelStyle: {
          fill: connected
            ? '#26353a'
            : relation === 'impact'
              ? '#7a4fa8'
              : relation === 'dependency'
                ? '#3c6b9c'
                : ['binds', 'config', 'class-ref'].includes(relation)
                  ? '#2f7373'
                  : ['reads_table', 'writes_table'].includes(relation)
                    ? '#a35f14'
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
  }, [positioned, edges, edgeMode, selectedId, t]);

  const signature = useMemo(
    () =>
      `${positioned.map((item) => item.id).join('|')}:${direction}:${edgeMode}:${viewMode}:${lanes
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


  const hoveredItem = hoveredTable ? positioned.find((item) => item.id === hoveredTable.id) : null;
  const hoverTable = hoveredTable ? tableDetails[hoveredTable.id] ?? hoveredItem?.table ?? null : null;

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
          if (node.type === 'table') return '#c47a2c';
          const status = (node.data as { node?: { status?: keyof typeof STATUS_META } }).node?.status;
          return status ? STATUS_META[status].color : '#8b9a9d';
        }}
        nodeStrokeWidth={2}
        style={{ width: 146, height: 88, bottom: 54, right: 14 }}
      />
    </ReactFlow>
    <FocusController positioned={positioned} selectedId={selectedId} drawerWidth={drawerWidth} />
    {hoveredTable && hoverTable ? (
      <SqlHoverCard
        table={hoverTable}
        x={hoveredTable.x}
        y={hoveredTable.y}
        onOpen={(tableId) => {
          setHoveredTable(null);
          onSelect(tableId);
        }}
      />
    ) : null}
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
