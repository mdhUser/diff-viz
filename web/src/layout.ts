import dagre from 'dagre';
import type { EdgeMode, LayoutDirection, ReviewEdge, ReviewNode, ReviewTable } from './types';

export const NODE_SIZES = {
  changed: { width: 256, height: 94 },
  impacted: { width: 228, height: 74 },
};

export const TABLE_SIZE = { width: 212, height: 78 };

export type GraphItemKind = 'file' | 'table';

/** A layout input: file/config node or a virtual database table node. */
export interface GraphItem {
  id: string;
  kind: GraphItemKind;
  width: number;
  height: number;
  /** Changed table/file; used exactly like `status !== 'impacted_only'`. */
  changed: boolean;
  node?: ReviewNode;
  table?: ReviewTable;
}

export interface PositionedItem extends GraphItem {
  x: number;
  y: number;
  laneId?: string;
  /** @deprecated kept for older call sites; prefer node/table. */
  laneKey?: string;
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
  positioned: PositionedItem[];
  lanes: LaneBox[];
}

export type LaneKeyFn = (item: GraphItem) => string;

const LANE_HEADER = 46;
const LANE_PADDING_X = 32;
const LANE_PADDING_BOTTOM = 22;
const LANE_GAP = 18;
const COLUMN_STEP = 64;
const ROW_GAP = 18;
const COLUMN_GAP = 26;
const MAX_ROWS_PER_COLUMN = 5;

export function sizeForNode(node: ReviewNode) {
  return node.status === 'impacted_only' ? NODE_SIZES.impacted : NODE_SIZES.changed;
}

export function itemForNode(node: ReviewNode): GraphItem {
  const size = sizeForNode(node);
  return {
    id: node.id,
    kind: 'file',
    width: size.width,
    height: size.height,
    changed: node.status !== 'impacted_only',
    node,
  };
}

export function itemForTable(table: ReviewTable): GraphItem {
  return {
    id: table.id,
    kind: 'table',
    width: TABLE_SIZE.width,
    height: TABLE_SIZE.height,
    changed: Boolean(table.changed),
    table,
  };
}

function changedOf(item: GraphItem): boolean {
  return item.changed;
}

// Keep the dagre input identical to the edges the canvas actually draws.
function graphEdgesFor(items: GraphItem[], edges: ReviewEdge[], edgeMode: EdgeMode) {
  const included = new Set(items.map((item) => item.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!included.has(edge.source) || !included.has(edge.target)) continue;
    const importer = byId.get(edge.source);
    const imported = byId.get(edge.target);
    if (!importer || !imported) continue;
    const impactMode = edgeMode === 'impact';
    const isTableEdge = imported.kind === 'table' || importer.kind === 'table';
    const importerChanged = changedOf(importer);
    const importedChanged = changedOf(imported);
    if (!isTableEdge && impactMode && importerChanged && !importedChanged) continue;
    // Table edges always point code/config -> table and never reverse.
    const source = impactMode && !isTableEdge ? edge.target : edge.source;
    const target = impactMode && !isTableEdge ? edge.source : edge.target;
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ source, target });
  }
  return result;
}

export function computeLayout(
  items: GraphItem[],
  edges: ReviewEdge[],
  direction: LayoutDirection,
  edgeMode: EdgeMode,
): PositionedItem[] {
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

  for (const item of items) graph.setNode(item.id, { width: item.width, height: item.height });
  for (const edge of graphEdgesFor(items, edges, edgeMode)) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  return items.map((item) => {
    const position = graph.node(item.id);
    return {
      ...item,
      x: (position?.x ?? 0) - item.width / 2,
      y: (position?.y ?? 0) - item.height / 2,
    };
  });
}

export function fallbackLaneKey(item: GraphItem): string {
  if (item.kind === 'table') return 'db';
  if (item.node?.moduleId) return item.node.moduleId;
  const first = (item.node?.path ?? '').split('/').filter(Boolean)[0];
  return first ?? '(root)';
}

/**
 * Swimlane layout: dagre still decides the horizontal dependency depth, then
 * items are re-banded into one horizontal lane per module/package. Within a
 * lane items are bucketed by depth and packed into columns of at most
 * MAX_ROWS_PER_COLUMN so a large module does not create a very tall lane.
 */
export function computeLaneLayout(
  items: GraphItem[],
  edges: ReviewEdge[],
  laneSpecs: LaneSpec[],
  edgeMode: EdgeMode,
  laneKeyOf: LaneKeyFn = fallbackLaneKey,
): LaneLayout {
  if (items.length === 0) {
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

  const flow = computeLayout(items, edges, 'LR', edgeMode);
  const minX = Math.min(...flow.map((item) => item.x));
  const shifted = flow.map((item) => ({ ...item, x: item.x - minX }));

  const byLane = new Map<string, PositionedItem[]>();
  for (const item of shifted) {
    const key = laneKeyOf(item);
    if (!byLane.has(key)) byLane.set(key, []);
    byLane.get(key)!.push({ ...item, laneId: key });
  }

  const orderedSpecs = [...laneSpecs];
  const specIds = new Set(orderedSpecs.map((lane) => lane.id));
  for (const key of byLane.keys()) {
    if (specIds.has(key)) continue;
    orderedSpecs.push({ id: key, label: key, path: '', kind: 'other', order: orderedSpecs.length });
  }

  const ordered: PositionedItem[] = [];
  const laneDrafts: Array<Omit<LaneBox, 'x' | 'width'> & { maxRight: number }> = [];
  let laneTop = 0;

  for (const spec of orderedSpecs) {
    const laneItems = byLane.get(spec.id) ?? [];
    if (laneItems.length === 0) continue;

    const buckets = new Map<number, PositionedItem[]>();
    for (const item of laneItems) {
      const bucket = Math.round(item.x / COLUMN_STEP);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(item);
    }
    let laneCursorX = LANE_PADDING_X;
    let maxColumnBottom = laneTop + LANE_HEADER;
    for (const bucket of [...buckets.keys()].sort((a, b) => a - b)) {
      const columns = buckets.get(bucket)!;
      columns.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
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
      changedFiles: laneItems.filter((item) => item.changed).length,
      impactedFiles: laneItems.filter((item) => !item.changed).length,
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
