import { Languages } from 'lucide-react';
import { useI18n } from '../i18n';

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'zh' ? 'en' : 'zh';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-ink-850 px-2 text-[9.5px] text-mist-500 transition hover:border-accent/30 hover:text-mist-200"
      title={t(lang === 'zh' ? '切换到英文' : '切换为中文')}
    >
      <Languages size={11} />
      {compact ? (lang === 'zh' ? 'EN' : '中文') : lang === 'zh' ? 'English' : '中文'}
    </button>
  );
}
