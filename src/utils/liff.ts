import liff from '@line/liff';

/**
 * LIFF is only meaningful when the app is opened inside LINE's in-app browser via
 * a LIFF URL (liff.line.me/{liffId}) with VITE_LIFF_ID configured. In a normal
 * desktop/mobile browser this quietly resolves to false and the app behaves exactly
 * as before -- LIFF is additive, not a replacement for the existing login flow.
 */
let initPromise: Promise<boolean> | null = null;

export function initLiff(): Promise<boolean> {
  const liffId = (import.meta as any).env?.VITE_LIFF_ID;
  if (!liffId) return Promise.resolve(false);

  if (!initPromise) {
    initPromise = liff
      .init({ liffId })
      .then(() => true)
      .catch((err) => {
        console.warn('LIFF init failed', err);
        return false;
      });
  }
  return initPromise;
}

export function isInLiffClient(): boolean {
  try {
    return liff.isInClient();
  } catch {
    return false;
  }
}

/**
 * Returns the LINE profile to prefill the application form with, or null when not
 * running inside LINE (desktop browser, LIFF not configured, or not logged in).
 */
export async function getLiffVolunteerIdentity(): Promise<{ name: string; lineId: string } | null> {
  await initLiff();
  if (!isInLiffClient()) return null;

  try {
    if (!liff.isLoggedIn()) return null;
    const profile = await liff.getProfile();
    return { name: profile.displayName, lineId: profile.userId };
  } catch (err) {
    console.warn('LIFF getProfile failed', err);
    return null;
  }
}
