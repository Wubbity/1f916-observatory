/**
 * Live presence — the meatbag counter.
 *
 * This is the only server-side code in the project, and it exists because a
 * count of who is here right now cannot be derived from anything the society
 * publishes. Everything else this app does is a read of 1f916.ai from the
 * visitor's own browser.
 *
 * WHAT IT STORES, exhaustively: a random id the browser invented for itself,
 * and the timestamp it was last seen. That is the whole record. No IP, no user
 * agent, no referrer, no cookie, no fingerprint, nothing that survives the tab
 * closing, and nothing that could identify a person or link two visits.
 * Entries evaporate after TTL_MS with no expiry job — a stale id is simply not
 * counted, then dropped on the next request.
 *
 * WHAT IT CANNOT DO, stated because the alternative is a number that lies:
 * serverless instances each hold their own memory. Under real concurrency two
 * visitors can be served by different instances and see different totals, each
 * correct about the people it can see. So the figure is a lower bound on a
 * busy day and exact on a quiet one, and the UI prints "≥" rather than
 * pretending. Making it exact needs external shared state (Redis or similar),
 * which is an account and a dependency — not worth it for a joke counter, and
 * a swap of this one file if it ever is.
 *
 * Node runtime, not Edge: Edge instances are more numerous and shorter-lived,
 * which would fragment the count badly. A warm Node container holds module
 * scope across invocations, which is the entire storage layer.
 */

/** How long after a heartbeat a visitor is still considered present. */
const TTL_MS = 45_000;

/** Refuse to grow without bound if something starts hammering this. */
const MAX_TRACKED = 10_000;

// Module scope survives between invocations on a warm instance.
const seen = new Map<string, number>();

interface Req {
  query: Record<string, string | string[] | undefined>;
}
interface Res {
  setHeader(name: string, value: string): void;
  status(code: number): Res;
  json(body: unknown): void;
}

export default function handler(request: Req, response: Res): void {
  const now = Date.now();

  for (const [key, at] of seen) {
    if (now - at > TTL_MS) seen.delete(key);
  }

  const raw = request.query?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;

  // A well-formed id is 16 hex chars the browser generated for itself. Anything
  // else still counts as a visitor but is not remembered, so a malformed or
  // hostile caller cannot pin entries into the map.
  if (id && /^[a-f0-9]{16}$/.test(id) && seen.size < MAX_TRACKED) {
    seen.set(id, now);
  }

  // A cached presence count is not a presence count.
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.status(200).json({
    present: Math.max(seen.size, 1),
    ttl_ms: TTL_MS,
    approximate: true,
    note: 'Distinct browsers that sent a heartbeat within the TTL, as seen by this instance. Stores a browser-generated random id and a timestamp; nothing else.',
  });
}
