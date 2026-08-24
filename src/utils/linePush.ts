import { authFetch } from './session';
export type LineNotificationType = 'shiftChanges' | 'urgentRecruitment' | 'checkInReminder';

/**
 * Sends a real LINE push message to one volunteer (identified by email — the backend
 * looks up their linked lineUserId). Falls back gracefully (isFallback) if that
 * volunteer hasn't completed LINE Login yet, hasn't set LINE_CHANNEL_ACCESS_TOKEN, or
 * has this notification type turned off in their preferences (checked server-side).
 */
export async function sendLinePush(
  email: string,
  message: string,
  notificationType?: LineNotificationType
): Promise<{ ok: boolean; simulated: boolean }> {
  try {
    const res = await authFetch('/api/line/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, message, notificationType })
    });
    const data = await res.json();
    return { ok: !!data.success, simulated: !!data.isFallback };
  } catch {
    return { ok: false, simulated: true };
  }
}

/**
 * Sends a real LINE broadcast to every friend of the official account.
 * Falls back gracefully (isFallback) if LINE_CHANNEL_ACCESS_TOKEN isn't set.
 */
export async function sendLineBroadcast(message: string): Promise<{ ok: boolean; simulated: boolean }> {
  try {
    const res = await authFetch('/api/line/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    return { ok: !!data.success, simulated: !!data.isFallback };
  } catch {
    return { ok: false, simulated: true };
  }
}
