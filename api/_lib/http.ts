/**
 * Shared plumbing for the serverless handlers: JSON responses, upstream fetch
 * with a hard timeout, a bounded worker pool, and a small TTL cache.
 */

export const USER_AGENT = "paleo-vantage/0.1 (github.com/lperezmo/paleo-vantage)";

const JSON_TYPE = "application/json; charset=utf-8";

export function sendJson(res: any, status: number, body: unknown, cacheControl?: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", JSON_TYPE);
  // Errors must never be cached by the edge, otherwise a transient upstream
  // failure sticks around for the whole s-maxage window.
  res.setHeader("Cache-Control", cacheControl ?? "no-store");
  res.end(JSON.stringify(body));
}

export function sendError(res: any, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** Query params, preferring the platform-parsed object and falling back to the raw URL. */
export function getQuery(req: any): Record<string, string> {
  const out: Record<string, string> = {};
  const q = req?.query;
  if (q && typeof q === "object") {
    for (const [k, v] of Object.entries(q)) {
      if (Array.isArray(v)) {
        if (v.length > 0) out[k] = String(v[0]);
      } else if (v != null) {
        out[k] = String(v);
      }
    }
    if (Object.keys(out).length > 0) return out;
  }
  const raw = typeof req?.url === "string" ? req.url : "";
  const i = raw.indexOf("?");
  if (i >= 0) {
    for (const [k, v] of new URLSearchParams(raw.slice(i + 1))) out[k] = v;
  }
  return out;
}

export function parseNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const s = value.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Wrap longitude into -180..180 so clients never receive a wrapped-past value. */
export function normalizeLon(lon: number): number {
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (Object.is(x, -0)) x = 0;
  return x;
}

export class UpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Parse and return the body even when the upstream status is not 2xx. */
  acceptErrorBody?: boolean;
}

/**
 * Fetch JSON with a per-call timeout. Upstream bodies are never surfaced to the
 * caller: they get a short generic message and the status is normalized.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 10000, headers, acceptErrorBody = false } = opts;
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers },
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new UpstreamError(timedOut ? "Upstream request timed out" : "Upstream request failed", 504);
  }

  if (!res.ok && !acceptErrorBody) {
    throw new UpstreamError(
      res.status >= 500 ? "Upstream service is unavailable" : "Upstream rejected the request",
      502,
    );
  }

  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError("Upstream returned an unreadable response", 502);
  }
}

/** Run `fn` over `items` with at most `limit` in flight. Order of results matches input. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.min(Math.max(1, limit), items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Insertion-ordered LRU with a TTL. Instances are per-lambda and die with it,
 * which is fine: the edge Cache-Control header does the durable caching.
 */
export class TtlCache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** True for GET and HEAD; everything else is rejected with 405 by the handlers. */
export function isReadMethod(req: any): boolean {
  const m = typeof req?.method === "string" ? req.method.toUpperCase() : "GET";
  return m === "GET" || m === "HEAD";
}
