import type { GeoResult } from "../../src/types";
import { fetchJson, normalizeLon, TtlCache } from "./http";

const BASE = "https://nominatim.openstreetmap.org/search";
const MAX_RESULTS = 5;
const TIMEOUT_MS = 8000;

// Nominatim's usage policy caps request rate, so repeat queries are served
// locally for a day.
const cache = new TtlCache<GeoResult[]>(200, 24 * 60 * 60 * 1000);

interface NominatimHit {
  display_name?: string;
  name?: string;
  lat?: string | number;
  lon?: string | number;
}

function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function geocode(q: string): Promise<GeoResult[]> {
  const key = q.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const url =
    `${BASE}?q=${encodeURIComponent(q.trim())}&format=jsonv2` +
    `&limit=${MAX_RESULTS}&addressdetails=0`;
  const body = await fetchJson<NominatimHit[]>(url, { timeoutMs: TIMEOUT_MS });

  const results: GeoResult[] = [];
  for (const hit of Array.isArray(body) ? body : []) {
    const lat = toNumber(hit?.lat);
    const lon = toNumber(hit?.lon);
    const name = hit?.display_name || hit?.name;
    if (lat == null || lon == null || !name) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    results.push({ name, lat, lon: normalizeLon(lon) });
    if (results.length >= MAX_RESULTS) break;
  }

  cache.set(key, results);
  return results;
}
