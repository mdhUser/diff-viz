import type { ReviewEdge, ReviewModule, ReviewNode } from './types';
import type { LaneKeyFn, LaneSpec } from './layout';

export type LaneGroupBy = 'module' | 'directory' | 'package';

const MAX_LANES = 12;
const OTHER_LANE = '(other)';
const ROOT_LANE = '(root)';

function directoryKey(filePath: string): string {
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length <= 1) return segments[0] ?? ROOT_LANE;
  return `${segments[0]}/${segments[1]}`;
}

export function laneKeyFor(node: ReviewNode, groupBy: LaneGroupBy): string {
  if (groupBy === 'module') return node.moduleId ?? directoryKey(node.path);
  if (groupBy === 'package') return node.packagePath || directoryKey(node.path);
  return directoryKey(node.path);
}

export function makeLaneKeyFn(groupBy: LaneGroupBy): LaneKeyFn {
  return (node) => laneKeyFor(node, groupBy);
}

/**
 * Order lanes by dependency depth: a lane that depends on another lane sits
 * higher. Cycles are broken by label order.
 */
function orderLaneKeys(keys: string[], nodeLane: Map<string, string>, edges: ReviewEdge[]): string[] {
  const known = new Set(keys);
  const deps = new Map(keys.map((key) => [key, new Set<string>()]));
  for (const edge of edges) {
    const source = nodeLane.get(edge.source);
    const target = nodeLane.get(edge.target);
    if (!source || !target || source === target || !known.has(source) || !known.has(target)) continue;
    deps.get(source)?.add(target);
  }
  const layers = new Map<string, number>();
  const visiting = new Set<string>();
  const layerOf = (key: string): number => {
    if (layers.has(key)) return layers.get(key)!;
    if (visiting.has(key)) return 0;
    visiting.add(key);
    let layer = 0;
    for (const dep of deps.get(key) ?? []) layer = Math.max(layer, layerOf(dep) + 1);
    visiting.delete(key);
    layers.set(key, Math.min(layer, Math.max(1, keys.length - 1)));
    return layers.get(key)!;
  };
  for (const key of keys) layerOf(key);
  return [...keys].sort((a, b) => {
    const layerDiff = (layers.get(b) ?? 0) - (layers.get(a) ?? 0);
    if (layerDiff !== 0) return layerDiff;
    return a.localeCompare(b);
  });
}

function limitKeys(nodes: ReviewNode[], keys: string[], keyOf: (node: ReviewNode) => string): string[] {
  if (keys.length <= MAX_LANES) return keys;
  const changedKeys = new Set(
    nodes.filter((node) => node.status !== 'impacted_only').map(keyOf),
  );
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = keyOf(node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kept: string[] = [];
  const rest: string[] = [];
  for (const key of [...keys].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))) {
    if (kept.length < MAX_LANES || changedKeys.has(key)) kept.push(key);
    else rest.push(key);
  }
  return rest.length > 0 ? [...kept, OTHER_LANE] : kept;
}

/** Build ordered lane specs for the current grouping and visible graph. */
export function buildLaneSpecs(
  nodes: ReviewNode[],
  edges: ReviewEdge[],
  groupBy: LaneGroupBy,
  modules?: ReviewModule[],
): LaneSpec[] {
  const keyOf = (node: ReviewNode) => laneKeyFor(node, groupBy);
  const nodeLane = new Map<string, string>();
  for (const node of nodes) nodeLane.set(node.id, keyOf(node));
  const keys = [...new Set(nodes.map(keyOf))];
  if (keys.length === 0) return [];

  if (groupBy === 'module' && modules?.length) {
    const moduleByKey = new Map(modules.map((module) => [module.id, module]));
    const present = new Set(keys);
    const ordered: LaneSpec[] = [];
    for (const module of [...modules].sort((a, b) => a.order - b.order)) {
      if (!present.has(module.id)) continue;
      ordered.push({
        id: module.id,
        label: module.label || module.id,
        path: module.path ?? '',
        kind: module.kind,
        order: ordered.length,
      });
      present.delete(module.id);
    }
    for (const key of [...present]) {
      ordered.push({ id: key, label: key, path: '', kind: 'other', order: ordered.length });
    }
    return ordered;
  }

  const limited = limitKeys(nodes, keys, keyOf);
  const limitedSet = new Set(limited.filter((key) => key !== OTHER_LANE));
  const mergedNodeLane = new Map<string, string>();
  for (const node of nodes) {
    const key = keyOf(node);
    mergedNodeLane.set(node.id, limitedSet.has(key) ? key : OTHER_LANE);
  }
  const orderedKeys = orderLaneKeys(limited, mergedNodeLane, edges);
  return orderedKeys.map((key, index) => ({
    id: key,
    label: key === OTHER_LANE ? '其他' : key,
    path: key === OTHER_LANE || key === ROOT_LANE ? '' : key,
    kind: 'derived',
    order: index,
  }));
}
