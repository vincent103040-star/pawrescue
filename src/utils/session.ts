/**
 * Session token handling.
 *
 * The signed-in role used to live in localStorage and nothing else -- the
 * server never checked it, so "being an admin" was just a string in the
 * browser. Now the server issues a token on login and verifies it on every
 * protected request; this module stores that token and attaches it.
 *
 * The token still sits in localStorage (that's where browser session state
 * belongs), but it's no longer a claim -- it's a credential the server issued
 * and can revoke, so editing it by hand gets you signed out, not promoted.
 */
const TOKEN_KEY = 'paw_session_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * fetch() with the session token attached. Use this for anything the server
 * protects; plain fetch still works for public reads.
 */
export function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/** Asks the server who this token belongs to. Null when it's missing or stale. */
export async function fetchCurrentSession(): Promise<
  { role: 'admin' | 'volunteer'; volunteer?: any; admin?: any } | null
> {
  if (!getToken()) return null;
  try {
    const res = await authFetch('/api/auth/me');
    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* clearing locally matters more than the server round-trip succeeding */
  }
  clearToken();
}
