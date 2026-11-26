import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiFetch, describeResponseFailure, responseErrorDetail } from './api';

export type DiffLayout = 'unified' | 'split';
export type SettingsLanguage = 'zh' | 'en';

export interface AppSettings {
  language: SettingsLanguage | null;
  diffLayout: DiffLayout;
  commentsExpanded: boolean;
}

const STORAGE_KEY = 'diff-viz:settings:v1';

export const DEFAULT_SETTINGS: AppSettings = {
  language: null,
  diffLayout: 'unified',
  commentsExpanded: true,
};

export function normalizeSettings(input: unknown): AppSettings {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    language: value.language === 'zh' || value.language === 'en' ? value.language : null,
    diffLayout: value.diffLayout === 'split' ? 'split' : 'unified',
    commentsExpanded: value.commentsExpanded !== false,
  };
}

function readCachedSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeCachedSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* cache is optional; the hub remains authoritative */
  }
}

interface SettingsContextValue {
  settings: AppSettings;
  ready: boolean;
  saveError: string | null;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  ready: false,
  saveError: null,
  updateSettings: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(readCachedSettings);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const postChain = useRef<Promise<void>>(Promise.resolve());

  const persistToHub = useCallback((next: AppSettings) => {
    // Serialise writes so a slow request cannot overwrite a newer change.
    postChain.current = postChain.current.then(async () => {
      try {
        const response = await apiFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
        if (!response.ok) {
          throw new Error(describeResponseFailure(response, await responseErrorDetail(response)));
        }
        setSaveError(null);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    });
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      const next = normalizeSettings({ ...settingsRef.current, ...patch });
      settingsRef.current = next;
      setSettings(next);
      writeCachedSettings(next);
      setSaveError(null);
      persistToHub(next);
    },
    [persistToHub],
  );

  // The hub owns the settings so every browser sees the same values.
  // localStorage is only a first-paint cache, replaced as soon as the hub answers.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch('/api/settings', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(describeResponseFailure(response, await responseErrorDetail(response)));
        }
        const payload = (await response.json()) as { settings?: unknown; initialized?: boolean };
        if (cancelled) return;
        if (payload.initialized === false) {
          // First run against this hub: publish the browser's previous settings
          // instead of discarding the values users configured before this upgrade.
          persistToHub(settingsRef.current);
          return;
        }
        const next = normalizeSettings(payload?.settings);
        settingsRef.current = next;
        setSettings(next);
        writeCachedSettings(next);
      } catch {
        // Keep the cached settings when the hub is an older build or offline.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [persistToHub]);

  const value = useMemo(
    () => ({ settings, ready, saveError, updateSettings }),
    [settings, ready, saveError, updateSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
