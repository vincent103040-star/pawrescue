/**
 * Builds the real LINE Login authorize URL. A full-page redirect (LINE Login uses
 * the standard OAuth authorization-code flow, not a popup like Google's GIS), so the
 * token exchange happens server-side in /api/auth/line-callback with the Channel secret.
 */
export function buildLineLoginUrl(email: string): string {
  const channelId = (import.meta as any).env?.VITE_LINE_LOGIN_CHANNEL_ID;
  const redirectUri = `${window.location.origin}/api/auth/line-callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId || '',
    redirect_uri: redirectUri,
    state: email,
    scope: 'profile openid'
  });

  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}
