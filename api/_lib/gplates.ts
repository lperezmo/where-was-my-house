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
const CONCURRENCY = 8;
const CALL_TIMEOUT_MS = 12000;
const RETRY_TIMEOUT_MS = 8000;

const cache = new TtlCache<Track>(200, 6 * 60 * 60 * 1000);

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
  const body = await fetchJson<Record<string, MultiPoint>>(url, { timeoutMs });
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
  const body = await fetchJson<MultiPoint>(url, { timeoutMs: RETRY_TIMEOUT_MS });
  return readPoint(body);
}

async function fetchPlateId(lat: number, lon: number): Promise<number | null> {
  const url =
    `${BASE}/reconstruct/assign_points_plate_ids/?points=${encodeURIComponent(pointsParam(lat, lon))}` +
    `&model=${MODEL}`;
  const body = await fetchJson<unknown>(url, { timeoutMs: RETRY_TIMEOUT_MS });
  const first = Array.isArray(body) ? body[0] : null;
  const n = typeof first === "number" ? first : Number(first);
  return Number.isFinite(n) ? n : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function buildTrack(lat: number, lon: number): Promise<Track> {
  const key = trackCacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached) {
    // The key is rounded, so re-stamp the exact requested point onto the hit.
    const steps = cached.steps.map((s) => (s.ageMa === 0 ? { ageMa: 0, lat, lon } : s));
    return { ...cached, point: { lat, lon }, steps };
  }

  // Age 0 is the input point by definition, so it never goes upstream.
  const reconstructAges = AGES.filter((a) => a !== 0);
  const chunks = chunk(reconstructAges, AGES_PER_CALL);

  const resolved = new Map<number, { lat: number; lon: number } | null>();
  // A null coordinate and an unreachable service are different things, and only
  // the second one should fail the request.
  let answered = 0;
  const settled = await Promise.allSettled([
    fetchPlateId(lat, lon),
    pool(chunks, CONCURRENCY, async (ages) => {
      try {
        const map = await fetchAgeChunk(lat, lon, ages, CALL_TIMEOUT_MS);
        answered++;
        return map;
      } catch {
        // One bad age can fail a whole chunk, so fall back to per-age calls and
        // lose only the ages that genuinely fail.
        const per = await pool(ages, CONCURRENCY, async (age) => {
          try {
            const point = await fetchSingleAge(lat, lon, age);
            answered++;
            return [age, point] as const;
          } catch {
            return [age, null] as const;
          }
        });
        return new Map(per);
      }
    }),
  ]);

  const plateResult = settled[0];
  const plateId = plateResult.status === "fulfilled" ? plateResult.value : null;

  const ageResult = settled[1];
  if (ageResult.status === "rejected") {
    const err = ageResult.reason;
    throw err instanceof UpstreamError ? err : new UpstreamError("Reconstruction service failed", 502);
  }
  if (answered === 0) {
    throw new UpstreamError("Reconstruction service is unavailable", 502);
  }
  for (const map of ageResult.value) {
    for (const [age, point] of map) resolved.set(age, point);
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
