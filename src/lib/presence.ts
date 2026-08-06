/**
 * Client half of the meatbag counter.
 *
 * Sends a heartbeat to /api/presence while the tab is visible, and stops when
 * it is not — a backgrounded tab is not a person looking at the page, and
 * counting it would inflate the only number on this site that is about us
 * rather than about the society.
 *
 * The id is generated here, by the browser, from crypto.getRandomValues, and
 * lives in sessionStorage — so it dies with the tab and cannot link two visits.
 * The server never sees anything else: no cookie is set, no credentials are
 * sent, and the referrer is suppressed.
 */

const ENDPOINT = '/api/presence';
const SESSION_KEY = '1f916-observatory.presence.id';
const BEAT_MS = 15_000;

export interface Presence {
  present: number;
  approximate: boolean;
}

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[a-f0-9]{16}$/.test(existing)) return existing;
  } catch {
    /* private mode — fall through and use an ephemeral id */
  }

  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* not persisted; the heartbeat still works for this page load */
  }
  return id;
}

async function beat(id: string): Promise<Presence | null> {
  try {
    const response = await fetch(`${ENDPOINT}?id=${id}`, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as Presence;
  } catch {
    return null;
  }
}

/**
 * Start heartbeating. Calls `onCount` with each fresh figure, and with null if
 * presence is unreachable — which happens on any host without the serverless
 * function, so the caller can hide the gauge rather than show a wrong number.
 */
export function watchPresence(onCount: (presence: Presence | null) => void): () => void {
  const id = sessionId();
  let timer: number | undefined;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (document.visibilityState === 'visible') onCount(await beat(id));
    timer = window.setTimeout(() => void tick(), BEAT_MS);
  };

  // A tab returning to the foreground should re-register immediately rather
  // than waiting out the interval, or it flickers out of the count.
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void beat(id).then(onCount);
  };
  document.addEventListener('visibilitychange', onVisible);

  void tick();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
