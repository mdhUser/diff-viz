import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Settings as SettingsIcon, X } from 'lucide-react';
import { cn } from '../cn';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-lg border border-line bg-ink-900/60 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'flex h-7 items-center gap-1 rounded-md px-2.5 text-[10px] transition',
              active
                ? 'bg-accent-soft font-medium text-accent-bright'
                : 'text-mist-500 hover:text-mist-200',
            )}
          >
            {active ? <Check size={9} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 pt-0.5">
        <div className="text-[10.5px] font-medium text-mist-200">{title}</div>
        <div className="mt-1 text-[9px] leading-4 text-mist-600">{hint}</div>
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t, lang, setLang } = useI18n();
  const { settings, saveError, updateSettings } = useSettings();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // Keep the review's global shortcuts (←/→/Esc) from firing behind the modal.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    window.addEventListener('keydown', onKeyDown, true);
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[#1b292d]/25 px-4 pb-6 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="diff-viz-settings-title"
        className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-line bg-[#fffdf8] shadow-[0_30px_80px_-40px_rgba(60,50,30,0.45)]"
      >
        <div className="flex items-center justify-between border-b border-line/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent-bright">
              <SettingsIcon size={14} />
            </span>
            <div>
              <div id="diff-viz-settings-title" className="text-[12px] font-semibold text-mist-100">
                {t('设置')}
              </div>
              <div className="mt-0.5 text-[9px] text-mist-600">{t('偏好保存在本地 hub')}</div>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-mist-500 transition hover:bg-ink-800 hover:text-mist-100"
            title={t('关闭设置')}
            aria-label={t('关闭设置')}
          >
            <X size={13} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <SettingRow title={t('界面语言')} hint={t('切换后立即生效')}>
            <Choice
              value={settings.language ?? lang}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(value) => {
                setLang(value);
                updateSettings({ language: value });
              }}
            />
          </SettingRow>

          <div className="h-px bg-line/70" />

          <SettingRow title={t('Diff 默认布局')} hint={t('打开代码 Diff 时使用的默认视图')}>
            <Choice
              value={settings.diffLayout}
              options={[
                { value: 'unified', label: t('单栏') },
                { value: 'split', label: t('双栏') },
              ]}
              onChange={(value) => updateSettings({ diffLayout: value })}
            />
          </SettingRow>

          <SettingRow title={t('评论气泡默认状态')} hint={t('行号旁的评论徽标仍可逐行展开/收起')}>
            <Choice
              value={settings.commentsExpanded ? 'expanded' : 'collapsed'}
              options={[
                { value: 'expanded', label: t('展开') },
                { value: 'collapsed', label: t('收起') },
              ]}
              onChange={(value) => updateSettings({ commentsExpanded: value === 'expanded' })}
            />
          </SettingRow>
        </div>

        <div className="flex items-center justify-between border-t border-line/80 bg-ink-900/40 px-4 py-2.5">
          <span className={cn('text-[9px]', saveError ? 'text-rose' : 'text-mist-600')}>
            {saveError
              ? t('保存到 hub 失败：{error}', { error: saveError })
              : t('设置保存在本地 hub，所有浏览器共用')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 items-center rounded-md border border-accent/25 bg-accent-soft px-3 text-[10px] font-medium text-accent-bright transition hover:bg-accent/15"
          >
            {t('完成')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
