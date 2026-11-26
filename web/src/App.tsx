import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, GitCommitHorizontal, Loader2, RefreshCw } from 'lucide-react';
import type {
  CommitInfo,
  ReviewTable,
  DrawerTab,
  EdgeMode,
  HubProject,
  LayoutDirection,
  ReviewData,
  ReviewNode,
  ReviewTodo,
} from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { GraphView } from './components/GraphView';
import { CanvasToolbar } from './components/CanvasToolbar';
import { Legend } from './components/Legend';
import { DetailDrawer } from './components/DetailDrawer';
import { TableDetail } from './components/TableDetail';
import { CommentsPanel } from './components/CommentsPanel';
import { SettingsButton } from './components/SettingsButton';
import { ResizeHandle } from './components/ResizeHandle';
import { RepoPanel } from './components/RepoPanel';
import { useI18n } from './i18n';
import { ScanLimitBanner } from './components/ScanLimitBanner';
import { WorkspaceView } from './components/WorkspaceView';
import { computeLaneLayout, computeLayout, itemForNode, itemForTable, type GraphItem, type LaneSpec } from './layout';
import { buildLaneSpecs, makeLaneKeyFn, type LaneGroupBy } from './lanes';
import { apiEventUrl, apiFetch, describeResponseFailure, responseErrorDetail } from './api';
import { cn } from './cn';

interface PersistedState {
  todos?: Record<string, boolean>;
  reviewed?: Record<string, boolean>;
  ignored?: Record<string, boolean>;
  extraTodos?: Record<string, ReviewTodo[]>;
}

function readPersisted(key: string): PersistedState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedState;
  } catch {
    return {};
  }
}

function stateKeyFor(meta: { repo?: string; branch?: string; reviewId?: string } | undefined): string {
  return `diff-viz:${meta?.repo ?? 'repo'}:${meta?.branch ?? 'unknown'}:${meta?.reviewId ?? 'live'}`;
}

const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 440;
const DRAWER_MIN = 400;
const DRAWER_MAX = 900;
const DEFAULT_SIDEBAR_WIDTH = 296;
const DEFAULT_DRAWER_WIDTH = 584;
const UI_PREFS_KEY = 'diff-viz:ui:v1';

function clampWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function sidebarMaxWidth(): number {
  const viewport = window.innerWidth || 1680;
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, viewport - 360));
}

function drawerMaxWidth(sidebarWidth: number): number {
  const viewport = window.innerWidth || 1680;
  return Math.max(360, Math.min(DRAWER_MAX, viewport - sidebarWidth - 240));
}

interface PanelWidths {
  sidebarWidth: number;
  drawerWidth: number;
  viewMode: 'auto' | 'flow' | 'lane';
  groupBy: LaneGroupBy;
  showConfig: boolean;
  showDb: boolean;
}

function readPanelWidths(): PanelWidths {
  const fallback: PanelWidths = {
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    drawerWidth: DEFAULT_DRAWER_WIDTH,
    viewMode: 'auto',
    groupBy: 'module',
    showConfig: true,
    showDb: true,
  };
  try {
    const raw = window.localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanelWidths>;
    const sidebarWidth = clampWidth(Number(parsed.sidebarWidth), SIDEBAR_MIN, sidebarMaxWidth());
    return {
      sidebarWidth,
      drawerWidth: clampWidth(Number(parsed.drawerWidth), DRAWER_MIN, drawerMaxWidth(sidebarWidth)),
      viewMode: ['auto', 'flow', 'lane'].includes(String(parsed.viewMode))
        ? (parsed.viewMode as PanelWidths['viewMode'])
        : 'auto',
      groupBy: ['module', 'directory', 'package'].includes(String(parsed.groupBy))
        ? (parsed.groupBy as LaneGroupBy)
        : 'module',
      showConfig: parsed.showConfig !== false,
      showDb: parsed.showDb !== false,
    };
  } catch {
    return fallback;
  }
}

function mergeTodos(node: ReviewNode, extra: ReviewTodo[] | undefined): ReviewTodo[] {
  const base = node.todos ?? [];
  if (!extra?.length) return base;
  const ids = new Set(base.map((todo) => todo.id));
  const texts = new Set(base.map((todo) => todo.text));
  return [...base, ...extra.filter((todo) => !ids.has(todo.id) && !texts.has(todo.text))];
}

export function App() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>('summary');
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [direction, setDirection] = useState<LayoutDirection>('LR');
  const [edgeMode, setEdgeMode] = useState<EdgeMode>('impact');
  const [showImpacted, setShowImpacted] = useState(true);
  const [todoOverrides, setTodoOverrides] = useState<Record<string, boolean>>({});
  const [reviewedOverrides, setReviewedOverrides] = useState<Record<string, boolean>>({});
  const [ignoredOverrides, setIgnoredOverrides] = useState<Record<string, boolean>>({});
  const [extraTodos, setExtraTodos] = useState<Record<string, ReviewTodo[]>>({});
  const [tableDetails, setTableDetails] = useState<Record<string, ReviewTable>>({});
  const tableRequests = useRef(new Set<string>());
  const [serverOnline, setServerOnline] = useState(true);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(readPanelWidths);
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [hubAvailable, setHubAvailable] = useState(false);
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null);
  const [workspaceReturnId, setWorkspaceReturnId] = useState<string | null>(null);
  const currentReviewIdRef = useRef<string | null>(null);
  currentReviewIdRef.current = currentReviewId;
  const [repoPanelOpen, setRepoPanelOpen] = useState(false);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentsOnly, setCommentsOnly] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const { t, lang } = useI18n();
  const sidebarDragStart = useRef(panelWidths.sidebarWidth);
  const drawerDragStart = useRef(panelWidths.drawerWidth);
  const sidebarWidth = panelWidths.sidebarWidth;
  const drawerWidth = panelWidths.drawerWidth;

  const storageKey = stateKeyFor(data?.meta);
  const currentProjectId =
    data?.meta.projectId ?? projects.find((project) => project.name === data?.meta.repo)?.id;

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(panelWidths));
    } catch {
      /* width persistence is optional */
    }
  }, [panelWidths]);

  useEffect(() => {
    const handleWindowResize = () => {
      setPanelWidths((current) => {
        const sidebarWidthNext = clampWidth(current.sidebarWidth, SIDEBAR_MIN, sidebarMaxWidth());
        return {
          ...current,
          sidebarWidth: sidebarWidthNext,
          drawerWidth: clampWidth(current.drawerWidth, DRAWER_MIN, drawerMaxWidth(sidebarWidthNext)),
        };
      });
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const hydrateData = useCallback((payload: ReviewData) => {
    if (!payload?.meta || !Array.isArray(payload.nodes)) throw new Error(t('数据文件格式不正确'));
    setData(payload);
    setError(null);
    setServerOnline(true);
    const persisted = readPersisted(stateKeyFor(payload.meta));
    setTodoOverrides(persisted.todos ?? {});
    setReviewedOverrides(persisted.reviewed ?? {});
    setIgnoredOverrides(persisted.ignored ?? {});
    setExtraTodos(persisted.extraTodos ?? {});
    setSelectedId((current) =>
      current && payload.nodes.some((node) => node.id === current) ? current : null,
    );
  }, []);

  const fetchReview = useCallback(
    async (
      reviewId: string,
      reset = false,
      options: { fromWorkspace?: string | null; history?: 'replace' | 'push' | 'none' } = {},
    ) => {
      const response = await apiFetch(`/api/data?review=${encodeURIComponent(reviewId)}&t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const detail = await responseErrorDetail(response);
        throw new Error(t('无法读取 Review：{detail}', { detail: describeResponseFailure(response, detail) }));
      }
      const payload = (await response.json()) as ReviewData;
      hydrateData(payload);
      setCurrentReviewId(reviewId);
      const fromWorkspace = options.fromWorkspace ?? null;
      setWorkspaceReturnId(fromWorkspace);
      const historyMode = options.history ?? 'replace';
      if (historyMode !== 'none') {
        const url = `/?review=${encodeURIComponent(reviewId)}${
          fromWorkspace ? `&from=${encodeURIComponent(fromWorkspace)}` : ''
        }&lang=${lang}`;
        if (historyMode === 'push') window.history.pushState(null, '', url);
        else window.history.replaceState(null, '', url);
      }
      if (reset) {
        setSelectedId(null);
        setTab('summary');
      }
    },
    [hydrateData, lang],
  );

  // Browser Back from a repository opened via the workspace overview should
  // return to the overview instead of leaving the app.
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const reviewId = params.get('review');
      if (!reviewId || reviewId === currentReviewIdRef.current) return;
      void fetchReview(reviewId, true, {
        fromWorkspace: params.get('from'),
        history: 'none',
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [fetchReview]);

  const requestReview = useCallback(
    async ({
      projectId,
      scope,
      commit,
      pull,
    }: {
      projectId: string;
      scope?: 'worktree' | 'commit' | 'last' | 'staged' | 'range' | 'base';
      commit?: string;
      pull?: { number: number; base?: string };
    }) => {
      setSwitching(true);
      setSwitchError(null);
      try {
        const response = await apiFetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pull ? { projectId, pull } : { projectId, scope, commit }),
        });
        if (!response.ok) {
          const detail = await responseErrorDetail(response);
          throw new Error(describeResponseFailure(response, detail));
        }
        const payload = (await response.json()) as { reviewId: string };
        await fetchReview(payload.reviewId, true);
        setRepoPanelOpen(false);
        setSelectedId(null);
      } catch (switchFailure) {
        setSwitchError(switchFailure instanceof Error ? switchFailure.message : String(switchFailure));
      } finally {
        setSwitching(false);
      }
    },
    [fetchReview],
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const hubResponse = await apiFetch('/api/hub', { cache: 'no-store' });
        if (hubResponse.status === 401 || hubResponse.status === 403) {
          throw new Error(describeResponseFailure(hubResponse));
        }
        if (hubResponse.ok) {
          const hub = (await hubResponse.json()) as { projects?: HubProject[] };
          if (cancelled) return;
          const hubProjects = hub.projects ?? [];
          setProjects(hubProjects);
          setHubAvailable(true);

          const initialParams = new URLSearchParams(window.location.search);
          const reviewId = initialParams.get('review');
          if (reviewId) {
            await fetchReview(reviewId, false, { fromWorkspace: initialParams.get('from') });
            return;
          }
          if (hubProjects.length > 0) {
            const response = await apiFetch('/api/review', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: hubProjects[0].id, scope: 'worktree' }),
            });
            if (!response.ok) {
              throw new Error(
                t('无法打开仓库：{detail}', { detail: describeResponseFailure(response, await responseErrorDetail(response)) }),
              );
            }
            const payload = (await response.json()) as { reviewId: string };
            await fetchReview(payload.reviewId);
            return;
          }
          throw new Error(t('hub 已启动，但还没有注册仓库；请先在目标仓库运行 diff-viz。'));
        }

        // Legacy single-review server.
        const response = await apiFetch(`/api/data?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(t('无法读取数据：{detail}', { detail: describeResponseFailure(response, await responseErrorDetail(response)) }));
        }
        hydrateData((await response.json()) as ReviewData);
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fetchReview, hydrateData]);

  const refreshProjects = useCallback(async () => {
    try {
      const response = await apiFetch('/api/hub', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { projects?: HubProject[] };
      setProjects(payload.projects ?? []);
    } catch {
      /* keep the last known list */
    }
  }, []);

  const openRepoPanel = useCallback(async () => {
    setSwitchError(null);
    setRepoPanelOpen(true);
    await refreshProjects();
  }, [refreshProjects]);

  const refreshReview = useCallback(async () => {
    if (!currentReviewId) return;
    setRefreshing(true);
    try {
      await fetchReview(currentReviewId, false, { fromWorkspace: workspaceReturnId });
    } catch {
      setServerOnline(false);
    } finally {
      setRefreshing(false);
    }
  }, [currentReviewId, fetchReview, workspaceReturnId]);

  // The hub re-analyzes on file changes and pushes a review id over SSE; pull the
  // new data only when it belongs to the review currently open in this tab.
  //
  // SSE is an intentionally endless request. Agent/IDE built-in browsers usually
  // wait for `networkidle` before treating a page as loaded, so keeping the
  // stream open made those previews spin forever. Skip it for automation
  // (navigator.webdriver) and support `?sse=0` / `?sse=1` overrides; the refresh
  // button still pulls the latest data.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return undefined;
    const sseParam = new URLSearchParams(window.location.search).get('sse');
    const automation = typeof navigator !== 'undefined' && navigator.webdriver === true;
    // A same-origin iframe comparison does not touch cross-origin properties.
    const embedded = window.self !== window.top;
    if (sseParam === '0') return undefined;
    if (sseParam !== '1' && (automation || embedded)) return undefined;
    const source = new EventSource(apiEventUrl('/api/events'));
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; reviewId?: string };
        if (payload.type !== 'review-updated') return;
        if (payload.reviewId && currentReviewId && payload.reviewId !== currentReviewId) return;
        void refreshReview();
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => {
      source.close();
    };
  }, [currentReviewId, refreshReview]);

  useEffect(() => {
    if (!data) return;
    try {
      const payload: PersistedState = {
        todos: todoOverrides,
        reviewed: reviewedOverrides,
        ignored: ignoredOverrides,
        extraTodos,
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      /* localStorage may be unavailable; in-memory state still works */
    }
  }, [data, storageKey, todoOverrides, reviewedOverrides, ignoredOverrides, extraTodos]);

  const changedNodes = useMemo(
    () => (data ? data.nodes.filter((node) => node.status !== 'impacted_only') : []),
    [data],
  );

  const tableCount = data?.tables?.length ?? 0;
  const commentCount = data?.comments?.length ?? 0;
  const configCount = useMemo(
    () => changedNodes.filter((node) => node.kind === 'config').length,
    [changedNodes],
  );

  const reviewIds = useMemo(() => {
    if (!data) return [];
    const changedIds = new Set(changedNodes.map((node) => node.id));
    const order = (data.meta.reviewOrder ?? []).filter((id) => changedIds.has(id));
    const seen = new Set(order);
    return [...order, ...changedNodes.map((node) => node.id).filter((id) => !seen.has(id))];
  }, [data, changedNodes]);

  const showConfig = panelWidths.showConfig;
  const showDb = panelWidths.showDb;
  const fileCommentCount = useMemo(
    () => (data?.nodes ?? []).reduce((sum, node) => sum + (node.reviewComments ?? 0), 0),
    [data],
  );
  // The "有评论" filter is a transient exploration tool: it must not carry
  // over to another MR, and it must never blank a review whose comments are all
  // MR-wide (no file-level comments to filter on).
  const effectiveCommentsOnly = commentsOnly && fileCommentCount > 0;
  useEffect(() => {
    setCommentsOnly(false);
  }, [data?.meta.reviewId]);
  const visibleNodes = useMemo(() => {
    if (!data) return [];
    let nodes = showImpacted ? data.nodes : data.nodes.filter((node) => node.status !== 'impacted_only');
    if (!showConfig) nodes = nodes.filter((node) => node.kind !== 'config');
    if (effectiveCommentsOnly) nodes = nodes.filter((node) => (node.reviewComments ?? 0) > 0);
    return nodes;
  }, [data, showImpacted, showConfig, effectiveCommentsOnly]);

  const visibleTables = useMemo(() => {
    if (!data?.tables?.length || effectiveCommentsOnly) return [];
    return showDb ? data.tables : [];
  }, [data, showDb, effectiveCommentsOnly]);

  const visibleEdges = useMemo(() => {
    if (!data) return [];
    const ids = new Set(visibleNodes.map((node) => node.id));
    for (const table of visibleTables) ids.add(table.id);
    return data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }, [data, visibleNodes, visibleTables]);

  const viewMode = panelWidths.viewMode;
  const groupBy = panelWidths.groupBy;
  const effectiveViewMode: 'flow' | 'lane' =
    viewMode === 'auto' ? ((data?.meta.modules?.length ?? 0) > 1 ? 'lane' : 'flow') : viewMode;
  const setViewMode = useCallback(
    (mode: 'flow' | 'lane') => setPanelWidths((current) => ({ ...current, viewMode: mode })),
    [],
  );
  const setGroupBy = useCallback(
    (next: LaneGroupBy) => setPanelWidths((current) => ({ ...current, groupBy: next })),
    [],
  );

  const layoutItems: GraphItem[] = useMemo(
    () => [...visibleNodes.map(itemForNode), ...visibleTables.map(itemForTable)],
    [visibleNodes, visibleTables],
  );

  const laneSpecs = useMemo<LaneSpec[]>(() => {
    if (!data || effectiveViewMode !== 'lane') return [];
    const specs = buildLaneSpecs(visibleNodes, visibleEdges, groupBy, data.meta.modules);
    if (visibleTables.length > 0) {
      specs.push({
        id: 'db',
        label: `${data.meta.db?.label ?? 'Database'} · ${t('{count} 张表', { count: visibleTables.length })}`,
        path: '',
        kind: 'database',
        order: specs.length,
      });
    }
    return specs;
  }, [data, effectiveViewMode, visibleNodes, visibleEdges, groupBy, visibleTables]);

  const layout = useMemo(() => {
    if (effectiveViewMode === 'lane' && laneSpecs.length > 0) {
      return computeLaneLayout(layoutItems, visibleEdges, laneSpecs, edgeMode, makeLaneKeyFn(groupBy));
    }
    return { positioned: computeLayout(layoutItems, visibleEdges, direction, edgeMode), lanes: [] };
  }, [effectiveViewMode, laneSpecs, layoutItems, visibleEdges, edgeMode, direction, groupBy]);

  const selectedNode = useMemo(
    () => data?.nodes.find((node) => node.id === selectedId) ?? null,
    [data, selectedId],
  );

  // v2 reviews ship node metadata only; the diff payload is fetched when a
  // drawer is opened so large reviews never download every file at once.
  useEffect(() => {
    if (!selectedId || !currentReviewId || !data) return undefined;
    const node = data.nodes.find((item) => item.id === selectedId);
    if (!node || node.status === 'impacted_only' || node.contentLoaded) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch(
          `/api/node?review=${encodeURIComponent(currentReviewId)}&id=${encodeURIComponent(selectedId)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const full = (await response.json()) as ReviewNode;
        if (cancelled) return;
        setData((current) =>
          current
            ? {
                ...current,
                nodes: current.nodes.map((item) =>
                  item.id === selectedId ? { ...item, ...full, contentLoaded: true } : item,
                ),
              }
            : current,
        );
      } catch {
        if (cancelled) return;
        setData((current) =>
          current
            ? {
                ...current,
                nodes: current.nodes.map((item) =>
                  item.id === selectedId ? { ...item, contentLoaded: true, contentMissing: true } : item,
                ),
              }
            : current,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, selectedId, currentReviewId]);

  const isTodoDone = useCallback(
    (nodeId: string, todo: ReviewTodo) => todoOverrides[`${nodeId}::${todo.id}`] ?? Boolean(todo.completed),
    [todoOverrides],
  );

  const isReviewed = useCallback(
    (node: ReviewNode) => reviewedOverrides[node.id] ?? Boolean(node.reviewed),
    [reviewedOverrides],
  );

  const openTodoCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of data?.nodes ?? []) {
      const todos = mergeTodos(node, extraTodos[node.id]);
      counts[node.id] = todos.filter((todo) => !isTodoDone(node.id, todo)).length;
    }
    return counts;
  }, [data, extraTodos, isTodoDone]);

  const openTodoTotal = useMemo(
    () => Object.values(openTodoCounts).reduce((sum, value) => sum + value, 0),
    [openTodoCounts],
  );

  const highRiskNodes = useMemo(() => {
    const ids = new Set<string>();
    for (const node of data?.nodes ?? []) {
      if (node.riskLevel === 'high') {
        ids.add(node.id);
        continue;
      }
      const todos = mergeTodos(node, extraTodos[node.id]);
      if (todos.some((todo) => todo.severity === 'high' && !isTodoDone(node.id, todo))) ids.add(node.id);
    }
    return ids;
  }, [data, extraTodos, isTodoDone]);

  const selectedTodos = useMemo(
    () => (selectedNode ? mergeTodos(selectedNode, extraTodos[selectedNode.id]) : []),
    [selectedNode, extraTodos],
  );

  const selectedIndex = selectedNode ? reviewIds.indexOf(selectedNode.id) : -1;

  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const stepReview = useCallback(
    (delta: 1 | -1) => {
      if (reviewIds.length === 0) return;
      const current = selectedNode ? reviewIds.indexOf(selectedNode.id) : -1;
      if (current === -1) {
        selectNode(reviewIds[0]);
        return;
      }
      const next = Math.min(reviewIds.length - 1, Math.max(0, current + delta));
      selectNode(reviewIds[next]);
    },
    [reviewIds, selectedNode, selectNode],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === 'Escape') {
        selectNode(null);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepReview(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepReview(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectNode, stepReview]);

  const postState = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const response = await apiFetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, reviewId: currentReviewId }),
      });
      if (!response.ok) throw new Error('request failed');
      const json = (await response.json()) as { ok?: boolean; todo?: ReviewTodo };
      setServerOnline(true);
      return json;
    } catch {
      setServerOnline(false);
      return null;
    }
  }, [currentReviewId]);

  const toggleTodo = useCallback(
    (todo: ReviewTodo, completed: boolean) => {
      if (!selectedNode) return;
      setTodoOverrides((current) => ({ ...current, [`${selectedNode.id}::${todo.id}`]: completed }));
      void postState({ nodeId: selectedNode.id, todoId: todo.id, completed });
    },
    [selectedNode, postState],
  );

  const toggleReviewed = useCallback(() => {
    if (!selectedNode) return;
    const next = !isReviewed(selectedNode);
    setReviewedOverrides((current) => ({ ...current, [selectedNode.id]: next }));
    void postState({ nodeId: selectedNode.id, reviewed: next });
  }, [selectedNode, isReviewed, postState]);

  const isIgnored = useCallback(
    (node: ReviewNode) => ignoredOverrides[node.id] ?? Boolean(node.ignored),
    [ignoredOverrides],
  );

  const toggleIgnored = useCallback(() => {
    if (!selectedNode) return;
    const next = !isIgnored(selectedNode);
    setIgnoredOverrides((current) => ({ ...current, [selectedNode.id]: next }));
    void postState({ nodeId: selectedNode.id, ignored: next });
  }, [selectedNode, isIgnored, postState]);

  const addTodo = useCallback(
    async (text: string): Promise<boolean> => {
      if (!selectedNode) return false;
      const result = await postState({ nodeId: selectedNode.id, action: 'addTodo', text });
      const todo: ReviewTodo =
        result?.todo ?? {
          id: `local-${Date.now().toString(36)}`,
          text,
          source: 'manual',
          completed: false,
        };
      setExtraTodos((current) => ({
        ...current,
        [selectedNode.id]: [...(current[selectedNode.id] ?? []), todo],
      }));
      return true;
    },
    [selectedNode, postState],
  );

  const loadTable = useCallback(
    async (tableId: string) => {
      if (!currentReviewId || tableDetails[tableId] || tableRequests.current.has(tableId)) return;
      tableRequests.current.add(tableId);
      try {
        const response = await apiFetch(
          `/api/table?review=${encodeURIComponent(currentReviewId)}&table=${encodeURIComponent(tableId)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as ReviewTable;
        setTableDetails((current) => ({ ...current, [tableId]: payload }));
      } catch {
        /* the hover card keeps the metadata-only fallback */
      } finally {
        tableRequests.current.delete(tableId);
      }
    },
    [currentReviewId, tableDetails],
  );

  const selectedTable = useMemo(
    () => data?.tables?.find((table) => table.id === selectedId) ?? null,
    [data, selectedId],
  );

  useEffect(() => {
    if (!selectedTable) return;
    void loadTable(selectedTable.id);
  }, [selectedTable, loadTable]);

  const resizeSidebar = useCallback((delta: number) => {
    setPanelWidths((current) => ({
      ...current,
      sidebarWidth: clampWidth(sidebarDragStart.current + delta, SIDEBAR_MIN, sidebarMaxWidth()),
    }));
  }, []);

  const stepSidebar = useCallback((delta: number) => {
    setPanelWidths((current) => ({
      ...current,
      sidebarWidth: clampWidth(current.sidebarWidth + delta, SIDEBAR_MIN, sidebarMaxWidth()),
    }));
  }, []);

  const resetSidebar = useCallback(() => {
    setPanelWidths((current) => ({ ...current, sidebarWidth: DEFAULT_SIDEBAR_WIDTH }));
  }, []);

  const resizeDrawer = useCallback((delta: number) => {
    setPanelWidths((current) => ({
      ...current,
      drawerWidth: clampWidth(drawerDragStart.current + delta, DRAWER_MIN, drawerMaxWidth(current.sidebarWidth)),
    }));
  }, []);

  const stepDrawer = useCallback((delta: number) => {
    setPanelWidths((current) => ({
      ...current,
      drawerWidth: clampWidth(current.drawerWidth + delta, DRAWER_MIN, drawerMaxWidth(current.sidebarWidth)),
    }));
  }, []);

  const resetDrawer = useCallback(() => {
    setPanelWidths((current) => ({
      ...current,
      drawerWidth: clampWidth(DEFAULT_DRAWER_WIDTH, DRAWER_MIN, drawerMaxWidth(current.sidebarWidth)),
    }));
  }, []);

  if (loading) {
    return (
      <div className="app-bg flex h-screen items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="logo-mark flex h-12 w-12 items-center justify-center rounded-2xl">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6.5 7.5h4M6.5 16.5h4M13.5 7.5H18M13.5 16.5H18M10.5 7.5l3 9M10.5 16.5l3-9"
                stroke="#33449a"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <circle cx="6" cy="7.5" r="1.8" fill="#2f8f63" />
              <circle cx="6" cy="16.5" r="1.8" fill="#a97418" />
              <circle cx="18" cy="7.5" r="1.8" fill="#566fd0" />
              <circle cx="18" cy="16.5" r="1.8" fill="#c05563" />
            </svg>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[11px] text-mist-500">
            <Loader2 size={13} className="animate-spin text-accent" />
            {t('正在加载变更数据…')}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="app-bg relative flex h-screen items-center justify-center px-6">
        <div className="absolute right-4 top-4 z-10">
          <SettingsButton compact />
        </div>
        <div className="w-full max-w-[460px] rounded-2xl border border-line bg-ink-850/80 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose/25 bg-rose/10 text-rose">
            <AlertTriangle size={18} />
          </div>
          <h1 className="mt-3 text-[15px] font-semibold text-mist-100">{t('无法加载 Review 数据')}</h1>
          <p className="mt-1.5 text-[11.5px] leading-5 text-mist-500">{error ?? t('数据为空')}</p>
          <div className="mt-4 rounded-lg border border-line bg-ink-950/70 px-3 py-2 font-mono text-[10px] text-mist-400">
            node bin/diff-viz.mjs
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              window.location.reload();
            }}
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11px] font-medium text-[#fbf9f4] transition hover:bg-accent-bright"
          >
            <RefreshCw size={12} />
            {t('重新加载')}
          </button>
        </div>
      </div>
    );
  }

  if (data && data.meta.workspace) {
    return (
      <WorkspaceView
        data={data}
        refreshing={refreshing}
        onOpenReview={(reviewId) => {
          const workspaceId = currentReviewId;
          setCurrentReviewId(reviewId);
          void fetchReview(reviewId, true, {
            fromWorkspace: workspaceId,
            history: 'push',
          });
        }}
        onOpenWorkspaceReview={(reviewId) => {
          setCurrentReviewId(reviewId);
          void fetchReview(reviewId, true, { history: 'replace' });
        }}
        onRefresh={() => void refreshReview()}
      />
    );
  }

  const changedCount = changedNodes.length;

  return (
    <div className="app-bg flex h-screen flex-col overflow-hidden">
      <Header
        data={data}
        selectedIndex={selectedIndex}
        total={reviewIds.length}
        hasSelection={Boolean(selectedNode)}
        sidebarOpen={sidebarOpen}
        refreshing={refreshing}
        openTodos={openTodoTotal}
        hubProjects={projects}
        hubAvailable={hubAvailable}
        currentProjectId={currentProjectId}
        onOpenRepoPanel={() => void openRepoPanel()}
        onOpenComments={() => setCommentsPanelOpen(true)}
        onBackToWorkspace={
          workspaceReturnId
            ? () => {
                void fetchReview(workspaceReturnId, true, { history: 'replace' });
              }
            : undefined
        }
        onPrev={() => stepReview(-1)}
        onNext={() => stepReview(1)}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onRefresh={() => void refreshReview()}
      />

      <ScanLimitBanner meta={data.meta} />

      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <div className="relative flex shrink-0" style={{ width: sidebarWidth }}>
            <Sidebar
              data={data}
              selectedId={selectedId}
              query={query}
              reviewedMap={reviewedOverrides}
        riskNodeIds={highRiskNodes}
              isTodoDone={isTodoDone}
              onQueryChange={setQuery}
              onSelect={(id) => selectNode(id)}
        onOpenComments={() => setCommentsPanelOpen(true)}
            />
            <ResizeHandle
              position="right"
              label={t('调整左侧栏宽度')}
              onStart={() => {
                sidebarDragStart.current = panelWidths.sidebarWidth;
              }}
              onDelta={resizeSidebar}
              onStep={stepSidebar}
              onReset={resetSidebar}
            />
          </div>
        ) : null}

        <main className="relative min-w-0 flex-1">
          <div className="canvas-shell absolute inset-0">
            {data.nodes.length > 0 ? (
              <GraphView
                positioned={layout.positioned}
                lanes={layout.lanes}
                viewMode={effectiveViewMode}
                tableDetails={tableDetails}
                onRequestTable={(tableId) => void loadTable(tableId)}
                edges={visibleEdges}
                selectedId={selectedId}
                direction={direction}
                edgeMode={edgeMode}
                openTodoCounts={openTodoCounts}
                riskNodeIds={highRiskNodes}
                reviewedMap={reviewedOverrides}
                ignoredMap={ignoredOverrides}
                drawerWidth={selectedNode ? drawerWidth : 0}
                sidebarWidth={sidebarOpen ? sidebarWidth : 0}
                onSelect={selectNode}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-8">
                <div className="max-w-[380px] text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-ink-800/70 text-mist-500">
                    <GitCommitHorizontal size={22} />
                  </div>
                  <h2 className="mt-3 text-[14px] font-semibold text-mist-100">{t('当前范围没有检测到变更')}</h2>
                  <p className="mt-1.5 text-[11px] leading-5 text-mist-500">
                    {t('修改代码后重新运行')} <span className="font-mono text-mist-300">diff-viz</span>{t('，或切换到最近一次提交/指定 commit 范围再试。')}
                  </p>
                </div>
              </div>
            )}
            {data.nodes.length > 0 && visibleNodes.length === 0 ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-8">
                <div className="pointer-events-auto max-w-[360px] rounded-xl border border-line bg-[#fffdf8] px-4 py-4 text-center shadow-sm">
                  <div className="text-[12px] font-medium text-mist-100">{t('当前筛选下没有可显示的文件')}</div>
                  <p className="mt-1 text-[10px] leading-5 text-mist-600">
                    {t('Reviewer 评论只出现在 MR 整体讨论中，没有挂在具体文件上，所以「有评论」筛选为空。')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCommentsOnly(false);
                      setPanelWidths((current) => ({ ...current, showConfig: true, showDb: true }));
                    }}
                    className="mt-2 rounded-md border border-accent/30 bg-accent-soft px-2.5 py-1 text-[10px] text-accent-bright transition hover:bg-accent/15"
                  >
                    {t('显示全部文件')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {data.nodes.length > 0 ? (
            <>
              <CanvasToolbar
                edgeMode={edgeMode}
                direction={direction}
                viewMode={effectiveViewMode}
                groupBy={groupBy}
                showImpacted={showImpacted}
                changedCount={changedCount}
                impactedCount={data.nodes.length - changedCount}
                showConfig={showConfig}
                configCount={configCount}
                showDb={showDb}
                tableCount={tableCount}
                commentsOnly={effectiveCommentsOnly}
                commentCount={fileCommentCount}
                onEdgeModeChange={setEdgeMode}
                onDirectionChange={setDirection}
                onViewModeChange={setViewMode}
                onGroupByChange={setGroupBy}
                onToggleConfig={() =>
                  setPanelWidths((current) => ({ ...current, showConfig: !current.showConfig }))
                }
                onToggleDb={() => setPanelWidths((current) => ({ ...current, showDb: !current.showDb }))}
                onToggleCommentsOnly={() => setCommentsOnly((value) => !value)}
                onToggleImpacted={() => {
                  const next = !showImpacted;
                  if (!next && selectedNode?.status === 'impacted_only') selectNode(null);
                  setShowImpacted(next);
                }}
              />
              <Legend
                edgeMode={edgeMode}
                hasConfigEdges={(data?.edges ?? []).some(
                  (edge) => edge.relation && !['imports', 'reads_table', 'writes_table'].includes(edge.relation),
                )}
                hasTableEdges={tableCount > 0}
              />
              {!selectedNode && !selectedTable ? (
                <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-line/80 bg-ink-900/80 px-3 py-1.5 text-[9.5px] text-mist-500 backdrop-blur">
                  {t('点击节点查看摘要、Diff 与待确认项 · ← → 切换 Review')}
                </div>
              ) : null}
            </>
          ) : null}
        </main>

        {selectedNode || selectedTable ? (
          <div className="absolute inset-y-0 right-0 z-30 flex" style={{ width: drawerWidth }}>
            <ResizeHandle
              position="left"
              label={t('调整详情面板宽度')}
              onStart={() => {
                drawerDragStart.current = panelWidths.drawerWidth;
              }}
              onDelta={resizeDrawer}
              onStep={stepDrawer}
              onReset={resetDrawer}
            />
            {selectedTable ? (
              <TableDetail
                table={tableDetails[selectedTable.id] ?? selectedTable}
                components={data.components}
                loading={!tableDetails[selectedTable.id]}
                onClose={() => selectNode(null)}
                onSelectSource={(path) => {
                  selectNode(path);
                  setTab('diff');
                }}
              />
            ) : null}
            {selectedNode ? (
            <DetailDrawer
              node={selectedNode}
              data={data}
              tab={tab}
              todos={selectedTodos}
              reviewed={isReviewed(selectedNode)}
              ignored={isIgnored(selectedNode)}
              isTodoDone={(todo) => isTodoDone(selectedNode.id, todo)}
              serverOnline={serverOnline}
              onTabChange={setTab}
              onClose={() => selectNode(null)}
              onSelectNode={selectNode}
              onToggleTodo={toggleTodo}
              onToggleReviewed={toggleReviewed}
              onToggleIgnored={toggleIgnored}
              onAddTodo={addTodo}
              onOpenAllComments={() => setCommentsPanelOpen(true)}
            />
            ) : null}
          </div>
        ) : null}
      </div>

      {commentsPanelOpen && data ? (
        <CommentsPanel
          data={data}
          onClose={() => setCommentsPanelOpen(false)}
          onSelectNode={(path) => {
            selectNode(path);
            setTab('comments');
            setCommentsPanelOpen(false);
          }}
        />
      ) : null}

      <RepoPanel
        open={repoPanelOpen}
        projects={projects}
        currentProjectId={currentProjectId}
        currentSha={data?.meta.headRef}
        busy={switching}
        error={switchError}
        onClose={() => {
          setRepoPanelOpen(false);
          setSwitchError(null);
        }}
        onOpenWorktree={(projectId) => {
          void requestReview({ projectId, scope: 'worktree' });
        }}
        onRefreshProjects={refreshProjects}
        onOpenCommit={(projectId, commit) => {
          void requestReview({ projectId, scope: 'commit', commit: commit.sha });
        }}
        onOpenPull={(projectId, pull) => {
          void requestReview({ projectId, pull: { number: pull.number } });
        }}
      />

      {!serverOnline ? (
        <div
          className={cn(
            'pointer-events-none fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber/25',
            'bg-[#fdf7e8] px-3 py-1.5 text-[9.5px] text-amber shadow-lg',
          )}
        >
          {t('后端写入不可用，勾选状态已保存在浏览器本地')}
        </div>
      ) : null}
    </div>
  );
}
