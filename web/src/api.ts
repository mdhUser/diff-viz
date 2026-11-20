// The hub serves source code, so every `/api/*` call (except the health probe)
// needs the access token. The CLI opens the page with `?token=...`; we keep it
// in sessionStorage for later calls and strip it from the address bar so it does
// not end up in screenshots, bookmarks or referrers. The hub also trades the
// query token for an HttpOnly cookie, which covers plain refreshes.
const TOKEN_KEY = 'diff-viz:token';

let token: string | null = null;

export function initApiToken(): void {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    token = fromUrl;
    try {
      window.sessionStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      /* sessionStorage can be blocked; the header below still works this load */
    }
    params.delete('token');
    const search = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    );
    return;
  }
  try {
    token = window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
}

export function currentToken(): string | null {
  return token;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('X-Diff-Viz-Token', token);
  return fetch(input, { ...init, headers });
}

// EventSource cannot set headers, so the token rides in the query string.
export function apiEventUrl(pathname: string): string {
  if (!token) return pathname;
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set('token', token);
  return `${url.pathname}${url.search}`;
}

// Turn a failed response into a message a human can act on. 401/403 only happen
// when the page was opened without the URL the CLI printed.
export function describeResponseFailure(response: Response, detail?: string): string {
  if (response.status === 401) {
    return 'hub 需要访问令牌：请从终端运行 diff-viz 后打开它打印的「带令牌链接」，或运行 diff-viz hub 查看该链接。';
  }
  if (response.status === 403) {
    return 'hub 拒绝了这次请求：Host 不在允许列表内（防 DNS rebinding）。请用 localhost 或 127.0.0.1 的地址打开。';
  }
  return detail || `HTTP ${response.status}`;
}

export async function responseErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload?.error;
  } catch {
    return undefined;
  }
}
