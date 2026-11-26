import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './util.mjs';

export const DEFAULT_HUB_SETTINGS = Object.freeze({
  language: null,
  diffLayout: 'unified',
  commentsExpanded: true,
});

export function hubSettingsPath(home) {
  return path.join(home, 'settings.json');
}

function normalizeStoredSettings(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    language: source.language === 'zh' || source.language === 'en' ? source.language : null,
    diffLayout: source.diffLayout === 'split' ? 'split' : 'unified',
    commentsExpanded: source.commentsExpanded !== false,
  };
}

export function readHubSettings(home) {
  return normalizeStoredSettings(readJsonSafe(hubSettingsPath(home)));
}

export function writeHubSettings(home, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('设置必须是 JSON 对象。');
  }
  const current = readHubSettings(home);
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, 'language')) {
    if (patch.language !== null && patch.language !== 'zh' && patch.language !== 'en') {
      throw new Error('language 只能是 zh / en / null。');
    }
    next.language = patch.language;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'diffLayout')) {
    if (patch.diffLayout !== 'unified' && patch.diffLayout !== 'split') {
      throw new Error('diffLayout 只能是 unified / split。');
    }
    next.diffLayout = patch.diffLayout;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'commentsExpanded')) {
    if (typeof patch.commentsExpanded !== 'boolean') {
      throw new Error('commentsExpanded 必须是布尔值。');
    }
    next.commentsExpanded = patch.commentsExpanded;
  }

  writeJsonAtomic(hubSettingsPath(home), {
    version: 1,
    ...next,
    updatedAt: new Date().toISOString(),
  });
  return next;
}
