import dagre from 'dagre';
import type { EdgeMode, LayoutDirection, ReviewEdge, ReviewNode } from './types';

export const NODE_SIZES = {
  changed: { width: 256, height: 94 },
  impacted: { width: 228, height: 74 },
};

export interface PositionedNode {
  node: ReviewNode;
  x: number;
  y: number;
  width: number;
  height: number;
  laneId?: string;
}

export interface LaneSpec {
  id: string;
  label: string;
  path?: string;
  kind?: string;
  order: number;
}

export interface LaneBox extends LaneSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  changedFiles: number;
  impactedFiles: number;
}

export interface LaneLayout {
  positioned: PositionedNode[];
  lanes: LaneBox[];
}

export type LaneKeyFn = (node: ReviewNode) => string;

const LANE_HEADER = 46;
const LANE_PADDING_X = 32;
const LANE_PADDING_BOTTOM = 22;
const LANE_GAP = 18;
const COLUMN_STEP = 64;
const ROW_GAP = 18;
const COLUMN_GAP = 26;
const MAX_ROWS_PER_COLUMN = 5;

function sizeFor(node: ReviewNode) {
  return node.status === 'impacted_only' ? NODE_SIZES.impacted : NODE_SIZES.changed;
}

// Keep the dagre input identical to the edges the canvas actually draws.
function graphEdgesFor(nodes: ReviewNode[], edges: ReviewEdge[], edgeMode: EdgeMode) {
  const included = new Set(nodes.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!included.has(edge.source) || !included.has(edge.target)) continue;
    const importer = byId.get(edge.source);
    const imported = byId.get(edge.target);
    if (!importer || !imported) continue;
    const impactMode = edgeMode === 'impact';
    const importerChanged = importer.status !== 'impacted_only';
    const importedChanged = imported.status !== 'impacted_only';
    if (impactMode && importerChanged && !importedChanged) continue;
    const source = impactMode ? edge.target : edge.source;
    const target = impactMode ? edge.source : edge.target;
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ source, target });
  }
  return result;
}

export function computeLayout(
  nodes: ReviewNode[],
  edges: ReviewEdge[],
  direction: LayoutDirection,
  edgeMode: EdgeMode,
): PositionedNode[] {
  const graph = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: direction === 'LR' ? 30 : 44,
    ranksep: direction === 'LR' ? 104 : 74,
    edgesep: 18,
    marginx: 24,
    marginy: 24,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  });

  for (const node of nodes) {
    const size = sizeFor(node);
    graph.setNode(node.id, { ...size });
  }
  for (const edge of graphEdgesFor(nodes, edges, edgeMode)) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const size = sizeFor(node);
    const position = graph.node(node.id);
    return {
      node,
      x: (position?.x ?? 0) - size.width / 2,
      y: (position?.y ?? 0) - size.height / 2,
      width: size.width,
      height: size.height,
    };
  });
}

export function fallbackLaneKey(node: ReviewNode): string {
  if (node.moduleId) return node.moduleId;
  const first = node.path.split('/').filter(Boolean)[0];
  return first ?? '(root)';
}

/**
 * Swimlane layout: dagre still decides the horizontal dependency depth, then
 * nodes are re-banded into one horizontal lane per module/package. Within a
 * lane nodes are bucketed by depth so multiple files at the same depth stack
 * vertically instead of overlapping.
 */
export function computeLaneLayout(
  nodes: ReviewNode[],
  edges: ReviewEdge[],
  laneSpecs: LaneSpec[],
  edgeMode: EdgeMode,
  laneKeyOf: LaneKeyFn = fallbackLaneKey,
): LaneLayout {
  if (nodes.length === 0) {
    return {
      positioned: [],
      lanes: laneSpecs.map((lane) => ({
        ...lane,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        changedFiles: 0,
        impactedFiles: 0,
      })),
    };
  }

  const flow = computeLayout(nodes, edges, 'LR', edgeMode);
  const minX = Math.min(...flow.map((item) => item.x));
  const shifted = flow.map((item) => ({ ...item, x: item.x - minX }));

  const byLane = new Map<string, PositionedNode[]>();
  for (const item of shifted) {
    const key = laneKeyOf(item.node);
    if (!byLane.has(key)) byLane.set(key, []);
    byLane.get(key)!.push({ ...item, laneId: key });
  }

  const orderedSpecs = [...laneSpecs];
  const specIds = new Set(orderedSpecs.map((lane) => lane.id));
  for (const key of byLane.keys()) {
    if (specIds.has(key)) continue;
    orderedSpecs.push({ id: key, label: key, path: '', kind: 'other', order: orderedSpecs.length });
  }

  const ordered: PositionedNode[] = [];
  const laneDrafts: Array<Omit<LaneBox, 'x' | 'width'> & { maxRight: number }> = [];
  let laneTop = 0;

  for (const spec of orderedSpecs) {
    const laneNodes = byLane.get(spec.id) ?? [];
    if (laneNodes.length === 0) continue;

    // Bucket by horizontal depth, then pack each bucket into columns of at
    // most MAX_ROWS_PER_COLUMN so one module with many files does not produce a
    // 10,000px-tall lane.
    const buckets = new Map<number, PositionedNode[]>();
    for (const item of laneNodes) {
      const bucket = Math.round(item.x / COLUMN_STEP);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(item);
    }
    let laneCursorX = LANE_PADDING_X;
    let maxColumnBottom = laneTop + LANE_HEADER;
    for (const bucket of [...buckets.keys()].sort((a, b) => a - b)) {
      const columns = buckets.get(bucket)!;
      columns.sort((a, b) => a.y - b.y || a.node.id.localeCompare(b.node.id));
      const columnWidth = Math.max(...columns.map((item) => item.width));
      const baseX = Math.max(columns[0].x + LANE_PADDING_X, laneCursorX);
      for (let startIndex = 0; startIndex < columns.length; startIndex += MAX_ROWS_PER_COLUMN) {
        const chunk = columns.slice(startIndex, startIndex + MAX_ROWS_PER_COLUMN);
        const subIndex = Math.floor(startIndex / MAX_ROWS_PER_COLUMN);
        const x = baseX + subIndex * (columnWidth + COLUMN_GAP);
        let cursor = laneTop + LANE_HEADER;
        for (const item of chunk) {
          ordered.push({ ...item, x, y: cursor });
          cursor += item.height + ROW_GAP;
        }
        maxColumnBottom = Math.max(maxColumnBottom, cursor - ROW_GAP);
      }
      laneCursorX = baseX + Math.ceil(columns.length / MAX_ROWS_PER_COLUMN) * (columnWidth + COLUMN_GAP);
    }

    const laneHeight = Math.max(120, maxColumnBottom - laneTop + LANE_PADDING_BOTTOM);
    laneDrafts.push({
      ...spec,
      y: laneTop,
      height: laneHeight,
      maxRight: laneCursorX,
      changedFiles: laneNodes.filter((item) => item.node.status !== 'impacted_only').length,
      impactedFiles: laneNodes.filter((item) => item.node.status === 'impacted_only').length,
    });
    laneTop += laneHeight + LANE_GAP;
  }

  const contentWidth = Math.max(...laneDrafts.map((lane) => lane.maxRight), 320) + LANE_PADDING_X;
  const lanes: LaneBox[] = laneDrafts.map(({ maxRight, ...lane }) => ({
    ...lane,
    x: 0,
    width: contentWidth,
  }));

  return { positioned: ordered, lanes };
}
