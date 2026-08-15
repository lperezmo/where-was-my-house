import type { Track, TrackStep } from "../../src/types";
import { AGES, MODEL } from "./ages";
import { UpstreamError, fetchJson, normalizeLon, pool, TtlCache } from "./http";

const BASE = "https://gws.gplates.org";

/**
 * The service accepts a comma separated `times=` list and answers all of them in
 * roughly the cost of one age, so ages are batched. Chunking still bounds the
 * blast radius: a failed chunk retries age by age instead of losing the request.
 */
const AGES_PER_CALL = 12;
const OUTBOUND_CONCURRENCY = 4;
const MAX_FALLBACK_AGES = 12;
const CALL_TIMEOUT_MS = 12000;
const RETRY_TIMEOUT_MS = 8000;
const RESPONSE_MAX_BYTES = 512 * 1024;

const cache = new TtlCache<Track>(200, 6 * 60 * 60 * 1000);
const inFlight = new Map<string, Promise<Track>>();

interface MultiPoint {
  type?: string;
  coordinates?: Array<[number, number] | null> | null;
}

export function trackCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/**
 * GPlates signals "no valid reconstruction" either as a null coordinate (with
 * return_null_points) or as the 999.99 sentinel. Both must become `missing`.
 */
function readPoint(mp: MultiPoint | null | undefined): { lat: number; lon: number } | null {
  const pair = mp?.coordinates?.[0];
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const [lon, lat] = pair;
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon: normalizeLon(lon) };
}

function pointsParam(lat: number, lon: number): string {
  return `${lon},${lat}`;
}

async function fetchAgeChunk(
  lat: number,
  lon: number,
  ages: number[],
  timeoutMs: number,
): Promise<Map<number, { lat: number; lon: number } | null>> {
  const url =
    `${BASE}/reconstruct/reconstruct_points/?points=${encodeURIComponent(pointsParam(lat, lon))}` +
    `&times=${ages.join(",")}&model=${MODEL}&return_null_points=true`;
  const body = await fetchJson<Record<string, MultiPoint>>(url, {
    timeoutMs,
    maxBytes: RESPONSE_MAX_BYTES,
  });
  const out = new Map<number, { lat: number; lon: number } | null>();
  for (const age of ages) out.set(age, readPoint(body?.[String(age)]));
  return out;
}

async function fetchSingleAge(
  lat: number,
  lon: number,
  age: number,
): Promise<{ lat: number; lon: number } | null> {
  const url =
    `${BASE}/reconstruct/reconstruct_points/?points=${encodeURIComponent(pointsParam(lat, lon))}` +
    `&time=${age}&model=${MODEL}&return_null_points=true`;
  const body = await fetchJson<MultiPoint>(url, {
    timeoutMs: RETRY_TIMEOUT_MS,
    maxBytes: RESPONSE_MAX_BYTES,
  });
  return readPoint(body);
}

async function fetchPlateId(lat: number, lon: number): Promise<number | null> {
  const url =
    `${BASE}/reconstruct/assign_points_plate_ids/?points=${encodeURIComponent(pointsParam(lat, lon))}` +
    `&model=${MODEL}`;
  const body = await fetchJson<unknown>(url, {
    timeoutMs: RETRY_TIMEOUT_MS,
    maxBytes: RESPONSE_MAX_BYTES,
  });
  const first = Array.isArray(body) ? body[0] : null;
  const n = typeof first === "number" ? first : Number(first);
  return Number.isFinite(n) ? n : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function withExactPoint(track: Track, lat: number, lon: number): Track {
  const steps = track.steps.map((s) => (s.ageMa === 0 ? { ageMa: 0, lat, lon } : s));
  return { ...track, point: { lat, lon }, steps };
}

function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function limited<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

async function buildTrackFresh(lat: number, lon: number, key: string): Promise<Track> {
  const limited = createLimiter(OUTBOUND_CONCURRENCY);

  // Age 0 is the input point by definition, so it never goes upstream.
  const reconstructAges = AGES.filter((a) => a !== 0);
  const chunks = chunk(reconstructAges, AGES_PER_CALL);

  const resolved = new Map<number, { lat: number; lon: number } | null>();
  // A null coordinate and an unreachable service are different things, and only
  // the second one should fail the request.
  let answered = 0;
  const platePromise = limited(() => fetchPlateId(lat, lon)).catch(() => null);
  const chunkResults = await Promise.all(
    chunks.map(async (ages) => {
      try {
        const map = await limited(() => fetchAgeChunk(lat, lon, ages, CALL_TIMEOUT_MS));
        answered++;
        return { map, failed: [] as number[] };
      } catch {
        return { map: new Map<number, { lat: number; lon: number } | null>(), failed: ages };
      }
    }),
  );

  for (const result of chunkResults) {
    for (const [age, point] of result.map) resolved.set(age, point);
  }

  // A failed batch may contain one bad age, but retrying every failed batch can
  // turn one anonymous request into 71 upstream calls. Spend one small, shared
  // fallback budget and mark the rest missing.
  const fallbackAges = chunkResults.flatMap((result) => result.failed).slice(0, MAX_FALLBACK_AGES);
  const retried = await pool(fallbackAges, OUTBOUND_CONCURRENCY, async (age) => {
    try {
      const point = await limited(() => fetchSingleAge(lat, lon, age));
      answered++;
      return [age, point] as const;
    } catch {
      return [age, null] as const;
    }
  });
  for (const [age, point] of retried) resolved.set(age, point);

  const plateId = await platePromise;
  if (answered === 0) {
    throw new UpstreamError("Reconstruction service is unavailable", 502);
  }

  const steps: TrackStep[] = [];
  const missing: number[] = [];
  for (const age of AGES) {
    if (age === 0) {
      steps.push({ ageMa: 0, lat, lon });
      continue;
    }
    const p = resolved.get(age) ?? null;
    if (p) steps.push({ ageMa: age, lat: p.lat, lon: p.lon });
    else missing.push(age);
  }

  const track: Track = { point: { lat, lon }, plateId, model: MODEL, steps, missing };
  cache.set(key, track);
  return track;
}

export async function buildTrack(lat: number, lon: number): Promise<Track> {
  const key = trackCacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached) return withExactPoint(cached, lat, lon);

  let pending = inFlight.get(key);
  if (!pending) {
    pending = buildTrackFresh(lat, lon, key);
    inFlight.set(key, pending);
  }

  try {
    return withExactPoint(await pending, lat, lon);
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}
