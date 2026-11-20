export function basename(filePath: string): string {
  const normalized = filePath.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

export function formatSigned(value: number, sign: '+' | '−' = '+'): string {
  return `${sign}${value}`;
}

export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function truncateMiddle(value: string, max = 46): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}

const HIGHLIGHT_LANGUAGE: Record<string, string | undefined> = {
  typescript: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  jsx: 'jsx',
  python: 'python',
  go: 'go',
  rust: 'rust',
  kotlin: 'kotlin',
  csharp: 'csharp',
  ruby: 'ruby',
  java: 'java',
  json: 'json',
  xml: 'markup',
  properties: undefined,
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'markup',
  vue: 'markup',
  svelte: 'markup',
  yaml: 'yaml',
  bash: 'bash',
  sql: 'sql',
  toml: 'toml',
  text: undefined,
};

export function highlightLanguage(language: string | undefined): string | undefined {
  if (!language) return undefined;
  return HIGHLIGHT_LANGUAGE[language];
}

export function lineCount(content: string | undefined): number {
  if (!content) return 0;
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
}

export function prettyRangeLabel(meta: { rangeLabel?: string; branch?: string; mode?: string }): string {
  if (meta.rangeLabel) return meta.rangeLabel;
  if (meta.mode === 'staged') return '暂存区';
  if (meta.mode === 'worktree') return '工作区';
  return '最近提交';
}
