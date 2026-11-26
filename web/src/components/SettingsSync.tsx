import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { useSettings } from '../settings';

/**
 * Bridges the hub-owned settings with the i18n provider: the hub language wins
 * across browsers, and the first browser to open a fresh hub seeds the value
 * from its URL/browser detection so later browsers start in the same language.
 */
export function SettingsSync() {
  const { settings, ready, updateSettings } = useSettings();
  const { lang, setLang } = useI18n();

  useEffect(() => {
    if (!ready) return;
    if (settings.language === null) {
      updateSettings({ language: lang });
      return;
    }
    if (settings.language !== lang) setLang(settings.language);
  }, [ready, settings.language, lang, setLang, updateSettings]);

  return null;
}
