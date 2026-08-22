import { setToken } from './session';

/**
 * Starts a real LINE Login (OAuth authorization-code flow, full-page redirect --
 * not a popup like Google's GIS). The token exchange happens server-side in
 * /api/auth/line-callback with the Channel secret.
 *
 * The authorize URL is built by the server rather than here on purpose: the
 * OAuth `state` has to be unguessable and single-use. It used to be the
 * volunteer's email in plain text, which let anyone bind their own LINE account
 * to someone else's record just by editing the URL -- now that a bound LINE
 * account can sign in, that would have been account takeover.
 */
async function requestLineAuthUrl(mode: 'bind' | 'login', email?: string): Promise<string> {
  const res = await fetch('/api/auth/line-login-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, email })
  });
  const data = await res.json();
  if (!data.success || !data.url) {
    throw new Error(data.error || '無法取得 LINE 授權連結');
  }
  return data.url;
}

/** Binds a LINE account to the already-signed-in volunteer, then returns here. */
export async function startLineBinding(email: string): Promise<void> {
  window.location.href = await requestLineAuthUrl('bind', email);
}

/** Signs in using a LINE account that was bound during Google onboarding. */
export async function startLineLogin(): Promise<void> {
  window.location.href = await requestLineAuthUrl('login');
}

/**
 * Exchanges the one-time ticket from ?lineLoggedIn=1 for the volunteer profile.
 * The ticket exists so the redirect never has to carry the volunteer's email or
 * name in the query string, where it would end up in browser history and logs.
 */
export async function exchangeLineLoginTicket(ticket: string): Promise<any | null> {
  try {
    const res = await fetch('/api/auth/line-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket })
    });
    const data = await res.json();
    if (!data.success) return null;
    // The server issues a session token with the profile; store it so this
    // volunteer's later requests are actually authenticated.
    if (data.token) setToken(data.token);
    return data.volunteer;
  } catch {
    return null;
  }
}
