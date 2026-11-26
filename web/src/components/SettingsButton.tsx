import { useCallback, useState } from 'react';
import { Settings } from 'lucide-react';
import { cn } from '../cn';
import { useI18n } from '../i18n';
import { SettingsDialog } from './SettingsDialog';

interface SettingsButtonProps {
  compact?: boolean;
}

export function SettingsButton({ compact = false }: SettingsButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-ink-900/70 text-mist-500 transition hover:border-accent/30 hover:text-mist-100',
          compact ? 'h-8 w-8' : 'h-8 px-2 text-[10px]',
        )}
        title={t('设置')}
        aria-label={t('设置')}
      >
        <Settings size={14} />
        {compact ? null : <span>{t('设置')}</span>}
      </button>
      <SettingsDialog open={open} onClose={close} />
    </>
  );
}
