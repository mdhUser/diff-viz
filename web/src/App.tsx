import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, GitCommitHorizontal, Loader2, RefreshCw } from 'lucide-react';
import type {
  CommitInfo,
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
import { ResizeHandle } from './components/ResizeHandle';
import { RepoPanel } from './components/RepoPanel';
import { WorkspaceView } from './components/WorkspaceView';
import { computeLayout } from './layout';
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
}

function readPanelWidths(): PanelWidths {
  const fallback: PanelWidths = {
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    drawerWidth: DEFAULT_DRAWER_WIDTH,
  };
  try {
    const raw = window.localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanelWidths>;
    const sidebarWidth = clampWidth(Number(parsed.sidebarWidth), SIDEBAR_MIN, sidebarMaxWidth());
    return {
      sidebarWidth,
      drawerWidth: clampWidth(Number(parsed.drawerWidth), DRAWER_MIN, drawerMaxWidth(sidebarWidth)),
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
  const [serverOnline, setServerOnline] = useState(true);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(readPanelWidths);
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [hubAvailable, setHubAvailable] = useState(false);
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null);
  const [repoPanelOpen, setRepoPanelOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
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
          sidebarWidth: sidebarWidthNext,
          drawerWidth: clampWidth(current.drawerWidth, DRAWER_MIN, drawerMaxWidth(sidebarWidthNext)),
        };
      });
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const hydrateData = useCallback((payload: ReviewData) => {
    if (!payload?.meta || !Array.isArray(payload.nodes)) throw new Error('数据文件格式不正确');
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
    async (reviewId: string, reset = false) => {
      const response = await fetch(`/api/data?review=${encodeURIComponent(reviewId)}&t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const payload = await response.json();
          if (payload?.error) detail = payload.error;
        } catch {
          /* ignore */
        }
        throw new Error(`无法读取 Review：${detail}`);
      }
      const payload = (await response.json()) as ReviewData;
      hydrateData(payload);
      setCurrentReviewId(reviewId);
      window.history.replaceState(null, '', `/?review=${encodeURIComponent(reviewId)}`);
      if (reset) {
        setSelectedId(null);
        setTab('summary');
      }
    },
    [hydrateData],
  );

  const requestReview = useCallback(
    async ({
      projectId,
      scope,
      commit,
    }: {
      projectId: string;
      scope: 'worktree' | 'commit' | 'last' | 'staged' | 'range' | 'base';
      commit?: string;
    }) => {
      setSwitching(true);
      setSwitchError(null);
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, scope, commit }),
        });
        if (!response.ok) {
          let detail = `HTTP ${response.status}`;
          try {
            const payload = await response.json();
            if (payload?.error) detail = payload.error;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
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
        const hubResponse = await fetch('/api/hub', { cache: 'no-store' });
        if (hubResponse.ok) {
          const hub = (await hubResponse.json()) as { projects?: HubProject[] };
          if (cancelled) return;
          const hubProjects = hub.projects ?? [];
          setProjects(hubProjects);
          setHubAvailable(true);

          const reviewId = new URLSearchParams(window.location.search).get('review');
          if (reviewId) {
            await fetchReview(reviewId);
            return;
          }
          if (hubProjects.length > 0) {
            const response = await fetch('/api/review', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: hubProjects[0].id, scope: 'worktree' }),
            });
            if (!response.ok) throw new Error(`无法打开仓库：HTTP ${response.status}`);
            const payload = (await response.json()) as { reviewId: string };
            await fetchReview(payload.reviewId);
            return;
          }
          throw new Error('hub 已启动，但还没有注册仓库；请先在目标仓库运行 diff-viz。');
        }

        // Legacy single-review server.
        const response = await fetch(`/api/data?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`无法读取数据（HTTP ${response.status}）`);
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
      const response = await fetch('/api/hub', { cache: 'no-store' });
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
      await fetchReview(currentReviewId);
    } catch {
      setServerOnline(false);
    } finally {
      setRefreshing(false);
    }
  }, [currentReviewId, fetchReview]);

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
    const source = new EventSource('/api/events');
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

  const reviewIds = useMemo(() => {
    if (!data) return [];
    const changedIds = new Set(changedNodes.map((node) => node.id));
    const order = (data.meta.reviewOrder ?? []).filter((id) => changedIds.has(id));
    const seen = new Set(order);
    return [...order, ...changedNodes.map((node) => node.id).filter((id) => !seen.has(id))];
  }, [data, changedNodes]);

  const visibleNodes = useMemo(() => {
    if (!data) return [];
    return showImpacted ? data.nodes : data.nodes.filter((node) => node.status !== 'impacted_only');
  }, [data, showImpacted]);

  const visibleEdges = useMemo(() => {
    if (!data) return [];
    const ids = new Set(visibleNodes.map((node) => node.id));
    return data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }, [data, visibleNodes]);

  const positioned = useMemo(
    () => computeLayout(visibleNodes, visibleEdges, direction, edgeMode),
    [visibleNodes, visibleEdges, direction, edgeMode],
  );

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
        const response = await fetch(
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
      const response = await fetch('/api/state', {
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
            正在加载变更数据…
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="app-bg flex h-screen items-center justify-center px-6">
        <div className="w-full max-w-[460px] rounded-2xl border border-line bg-ink-850/80 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose/25 bg-rose/10 text-rose">
            <AlertTriangle size={18} />
          </div>
          <h1 className="mt-3 text-[15px] font-semibold text-mist-100">无法加载 Review 数据</h1>
          <p className="mt-1.5 text-[11.5px] leading-5 text-mist-500">{error ?? '数据为空'}</p>
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
            重新加载
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
          setCurrentReviewId(reviewId);
          void fetchReview(reviewId);
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
        onPrev={() => stepReview(-1)}
        onNext={() => stepReview(1)}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onRefresh={() => void refreshReview()}
      />

      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <div className="relative flex shrink-0" style={{ width: sidebarWidth }}>
            <Sidebar
              data={data}
              selectedId={selectedId}
              query={query}
              reviewedMap={reviewedOverrides}
              isTodoDone={isTodoDone}
              onQueryChange={setQuery}
              onSelect={(id) => selectNode(id)}
            />
            <ResizeHandle
              position="right"
              label="调整左侧栏宽度"
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
            {visibleNodes.length > 0 ? (
              <GraphView
                positioned={positioned}
                edges={visibleEdges}
                selectedId={selectedId}
                direction={direction}
                edgeMode={edgeMode}
                openTodoCounts={openTodoCounts}
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
                  <h2 className="mt-3 text-[14px] font-semibold text-mist-100">当前范围没有检测到变更</h2>
                  <p className="mt-1.5 text-[11px] leading-5 text-mist-500">
                    修改代码后重新运行 <span className="font-mono text-mist-300">diff-viz</span>，或切换到最近一次提交/
                    指定 commit 范围再试。
                  </p>
                </div>
              </div>
            )}
          </div>

          {visibleNodes.length > 0 ? (
            <>
              <CanvasToolbar
                edgeMode={edgeMode}
                direction={direction}
                showImpacted={showImpacted}
                changedCount={changedCount}
                impactedCount={data.nodes.length - changedCount}
                onEdgeModeChange={setEdgeMode}
                onDirectionChange={setDirection}
                onToggleImpacted={() => {
                  const next = !showImpacted;
                  if (!next && selectedNode?.status === 'impacted_only') selectNode(null);
                  setShowImpacted(next);
                }}
              />
              <Legend edgeMode={edgeMode} />
              {!selectedNode ? (
                <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-line/80 bg-ink-900/80 px-3 py-1.5 text-[9.5px] text-mist-500 backdrop-blur">
                  点击节点查看摘要、Diff 与待确认项 · ← → 切换 Review
                </div>
              ) : null}
            </>
          ) : null}
        </main>

        {selectedNode ? (
          <div className="absolute inset-y-0 right-0 z-30 flex" style={{ width: drawerWidth }}>
            <ResizeHandle
              position="left"
              label="调整详情面板宽度"
              onStart={() => {
                drawerDragStart.current = panelWidths.drawerWidth;
              }}
              onDelta={resizeDrawer}
              onStep={stepDrawer}
              onReset={resetDrawer}
            />
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
            />
          </div>
        ) : null}
      </div>

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
      />

      {!serverOnline ? (
        <div
          className={cn(
            'pointer-events-none fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber/25',
            'bg-[#fdf7e8] px-3 py-1.5 text-[9.5px] text-amber shadow-lg',
          )}
        >
          后端写入不可用，勾选状态已保存在浏览器本地
        </div>
      ) : null}
    </div>
  );
}
