import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { EN } from './en';

export type Language = 'zh' | 'en';

const STORAGE_KEY = 'diff-viz:lang';
let currentLanguage: Language = 'zh';

export function getLanguage(): Language {
  return currentLanguage;
}

export function currentLocale(): string {
  return currentLanguage === 'en' ? 'en-US' : 'zh-CN';
}

export function detectLanguage(): Language {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl === 'en' || fromUrl === 'zh') return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    /* localStorage/URL unavailable */
  }
  const navigatorLanguage = typeof navigator === 'undefined' ? '' : navigator.language || '';
  return navigatorLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}

export function translate(language: Language, key: string, vars?: Record<string, string | number>): string {
  const template = language === 'en' ? EN[key] ?? key : key;
  return interpolate(template, vars);
}

interface I18nContextValue {
  lang: Language;
  setLang: (language: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (key, vars) => translate('zh', key, vars),
});

function syncUrl(language: Language) {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('lang') === language) return;
    url.searchParams.set('lang', language);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectLanguage);
  currentLanguage = lang;

  const setLang = useCallback((language: Language) => {
    setLangState(language);
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* persistence is optional */
    }
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    syncUrl(language);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.title = lang === 'en' ? 'diff-viz · Change review' : 'diff-viz · 变更 Review';
  }, [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
