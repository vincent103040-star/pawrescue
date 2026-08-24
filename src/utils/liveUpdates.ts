/**
 * Keeps the open page in step with what other devices are doing.
 *
 * Every screen used to load its data once and then only re-fetch after a change
 * made on that same device, so a volunteer checking in on their phone didn't
 * show up on the coordinator's dashboard until it was reloaded.
 *
 * The server pushes a small "this kind of data changed" event over SSE and the
 * page re-fetches just that slice. A polling timer runs alongside as a fallback:
 * if the stream never connects (a proxy buffering text/event-stream, a network
 * that drops long-lived connections), the page still converges within one
 * interval instead of silently going stale.
 */
export type ChangeKind = 'attendance' | 'shifts' | 'signups' | 'volunteers' | 'promotions';

type Handler = (kind: ChangeKind) => void;

const POLL_INTERVAL_MS = 20000;
/** Kinds refreshed by the polling fallback -- everything the boards display. */
const ALL_KINDS: ChangeKind[] = ['attendance', 'shifts', 'signups', 'volunteers', 'promotions'];

/**
 * Starts listening. Returns a cleanup function that closes the stream and
 * stops the timer.
 */
export function subscribeToLiveUpdates(onChange: Handler): () => void {
  let source: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let streamHealthy = false;
  let stopped = false;

  const startPolling = () => {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(() => {
      // Don't poll while the tab is hidden -- nobody is looking, and it keeps
      // a backgrounded phone from waking up every 20 seconds.
      if (document.visibilityState !== 'visible') return;
      ALL_KINDS.forEach(onChange);
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  try {
    source = new EventSource('/api/events');

    source.onopen = () => {
      streamHealthy = true;
      stopPolling(); // the stream is live; the fallback isn't needed
    };

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.kind === 'connected') {
          streamHealthy = true;
          stopPolling();
          return;
        }
        if (ALL_KINDS.includes(data.kind)) onChange(data.kind);
      } catch {
        /* a malformed frame shouldn't tear down the subscription */
      }
    };

    source.onerror = () => {
      // EventSource reconnects on its own; polling covers the gap, and the
      // next successful open turns it back off.
      streamHealthy = false;
      startPolling();
    };
  } catch {
    // No EventSource support at all -- polling is the whole strategy.
    startPolling();
  }

  // If the stream hasn't come up shortly after load, assume something between
  // here and the server is holding it and start polling regardless.
  const grace = setTimeout(() => {
    if (!streamHealthy) startPolling();
  }, 4000);

  // Coming back to a tab that was hidden for a while: refresh immediately
  // rather than waiting for the next event or poll tick.
  const onVisible = () => {
    if (document.visibilityState === 'visible') ALL_KINDS.forEach(onChange);
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    clearTimeout(grace);
    stopPolling();
    document.removeEventListener('visibilitychange', onVisible);
    source?.close();
  };
}
