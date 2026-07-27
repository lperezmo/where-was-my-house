import type { Fossil, FossilResult } from "../../src/types";
import { clamp, fetchJson, TtlCache, UpstreamError } from "./http";

const BASE = "https://paleobiodb.org/data1.2/occs/list.json";
const BOX_DEG = 1.5;
const MAX_RECORDS = 40;
const UPSTREAM_LIMIT = 300;
const TIMEOUT_MS = 10000;

const cache = new TtlCache<FossilResult>(200, 6 * 60 * 60 * 1000);

/** PBDB rank codes, from https://paleobiodb.org/data1.2/config.json?show=ranks (24 is unused). */
const RANKS: Record<number, string> = {
  2: "subspecies",
  3: "species",
  4: "subgenus",
  5: "genus",
  6: "subtribe",
  7: "tribe",
  8: "subfamily",
  9: "family",
  10: "superfamily",
  11: "infraorder",
  12: "suborder",
  13: "order",
  14: "superorder",
  15: "infraclass",
  16: "subclass",
  17: "class",
  18: "superclass",
  19: "subphylum",
  20: "phylum",
  21: "superphylum",
  22: "subkingdom",
  23: "kingdom",
  25: "unranked clade",
  26: "informal",
};

interface PbdbRecord {
  tna?: string;
  rnk?: number | string;
  eag?: number | string;
  lag?: number | string;
  lng?: number | string;
  lat?: number | string;
  pln?: number | string | null;
  pla?: number | string | null;
}

interface PbdbBody {
  records?: PbdbRecord[];
  errors?: string[];
  status_code?: number;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rankName(v: unknown): string {
  const n = num(v);
  if (n != null && RANKS[n]) return RANKS[n] as string;
  return typeof v === "string" && v.trim() !== "" ? v : "unranked";
}

export interface FossilQuery {
  lat: number;
  lon: number;
  maxMa: number;
  minMa: number;
}

/**
 * A box in modern coordinates. Longitude is clamped rather than split at the
 * antimeridian: PBDB cannot express a wrapped box in one query and a point that
 * close to 180 loses only a sliver of a very sparse ocean region.
 */
export function bboxFor(lat: number, lon: number) {
  return {
    latmin: clamp(lat - BOX_DEG, -90, 90),
    latmax: clamp(lat + BOX_DEG, -90, 90),
    lngmin: clamp(lon - BOX_DEG, -180, 180),
    lngmax: clamp(lon + BOX_DEG, -180, 180),
  };
}

function cacheKey(q: FossilQuery): string {
  return `${q.lat.toFixed(2)},${q.lon.toFixed(2)},${q.maxMa},${q.minMa}`;
}

export async function fetchFossils(q: FossilQuery): Promise<FossilResult> {
  const key = cacheKey(q);
  const cached = cache.get(key);
  if (cached) return cached;

  const box = bboxFor(q.lat, q.lon);
  const url =
    `${BASE}?lngmin=${box.lngmin}&lngmax=${box.lngmax}` +
    `&latmin=${box.latmin}&latmax=${box.latmax}` +
    `&max_ma=${q.maxMa}&min_ma=${q.minMa}` +
    `&show=coords,paleoloc,attr&limit=${UPSTREAM_LIMIT}`;

  const body = await fetchJson<PbdbBody>(url, { timeoutMs: TIMEOUT_MS, acceptErrorBody: true });

  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    throw new UpstreamError("Fossil database rejected the query", 502);
  }
  const raw = Array.isArray(body?.records) ? (body.records as PbdbRecord[]) : [];

  const targetMa = (q.maxMa + q.minMa) / 2;
  const best = new Map<string, { fossil: Fossil; distance: number }>();

  for (const r of raw) {
    const name = typeof r?.tna === "string" ? r.tna.trim() : "";
    const lng = num(r?.lng);
    const lat = num(r?.lat);
    const eag = num(r?.eag);
    const lag = num(r?.lag);
    if (!name || lng == null || lat == null || eag == null || lag == null) continue;

    const maxMa = Math.max(eag, lag);
    const minMa = Math.min(eag, lag);
    const fossil: Fossil = {
      name,
      rank: rankName(r?.rnk),
      maxMa,
      minMa,
      paleoLat: num(r?.pla),
      paleoLon: num(r?.pln),
      lat,
      lon: lng,
    };

    // Distance from the requested window: zero while the record's own range
    // covers it, otherwise the gap to the nearer edge.
    const distance =
      targetMa > maxMa ? targetMa - maxMa : targetMa < minMa ? minMa - targetMa : 0;

    const prev = best.get(name);
    if (!prev || distance < prev.distance) best.set(name, { fossil, distance });
  }

  const ordered = [...best.values()]
    .sort((a, b) => a.distance - b.distance || a.fossil.name.localeCompare(b.fossil.name))
    .map((e) => e.fossil);

  const result: FossilResult = {
    records: ordered.slice(0, MAX_RECORDS),
    truncated: ordered.length > MAX_RECORDS || raw.length >= UPSTREAM_LIMIT,
  };
  cache.set(key, result);
  return result;
}
