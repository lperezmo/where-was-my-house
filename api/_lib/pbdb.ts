import type { Fossil, FossilResult } from "../../src/types";
import { clamp, fetchJson, TtlCache, UpstreamError } from "./http";

const BASE = "https://paleobiodb.org/data1.2/occs/list.json";
const BOX_DEG = 1.5;
const MAX_RECORDS = 40;
const UPSTREAM_LIMIT = 300;
const TIMEOUT_MS = 10000;
const EARTH_KM = 6371;

/**
 * Relevance weights, summing to 1. A rich bbox yields far more taxa than fit in
 * MAX_RECORDS, so the cut has to be made on something. Each term below is
 * computed from fields PBDB returns, never from a list of favoured animals.
 */
const W_AGE_FIT = 0.4;
const W_SPECIFICITY = 0.22;
const W_ABUNDANCE = 0.18;
const W_PROXIMITY = 0.1;
const W_DISTINCTNESS = 0.1;

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
  phl?: string | null;
  cll?: string | null;
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

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** PBDB fills unplaced taxonomic levels with a NO_<LEVEL>_SPECIFIED placeholder. */
function specified(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || (s.startsWith("NO_") && s.endsWith("_SPECIFIED"))) return null;
  return s;
}

/**
 * Rank codes are an ordinal scale from subspecies (2) to kingdom (23), so score
 * specificity off the scale itself rather than inventing a mapping. A named
 * species tells the reader more than an indeterminate family. Codes 25 and 26
 * (unranked clade, informal) sit outside the series and stay neutral.
 */
function specificity(code: number | null): number {
  if (code == null || code >= 25) return 0.45;
  return clamp((24 - code) / 21, 0, 1);
}

/**
 * Fraction of the record's own stated age range that falls inside the window
 * asked about, which under a flat prior is the chance the occurrence belongs to
 * that window. A mammal pinned to a 2.3 Ma land-mammal age says far more about
 * 30 Ma than a leaf binned into a 6.6 Ma Early Oligocene interval.
 */
function ageFit(maxMa: number, minMa: number, qMax: number, qMin: number): number {
  const span = maxMa - minMa;
  if (span <= 0) return maxMa <= qMax && maxMa >= qMin ? 1 : 0;
  return clamp((Math.min(maxMa, qMax) - Math.max(minMa, qMin)) / span, 0, 1);
}

/** Codepoint order, so the tiebreak cannot shift with the runtime's locale data. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Bucket {
  fossil: Fossil;
  fit: number;
  near: number;
  rankCode: number | null;
  group: string | null;
  count: number;
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
    `&show=coords,paleoloc,attr,class&limit=${UPSTREAM_LIMIT}`;

  const body = await fetchJson<PbdbBody>(url, { timeoutMs: TIMEOUT_MS, acceptErrorBody: true });

  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    throw new UpstreamError("Fossil database rejected the query", 502);
  }
  const raw = Array.isArray(body?.records) ? (body.records as PbdbRecord[]) : [];

  // Distance is scored against the box corner rather than against the spread of
  // what came back, so a cluster of localities 130 km away all read as "far"
  // instead of one of them being stretched into a winner.
  const cornerKm = Math.max(
    haversineKm(q.lat, q.lon, box.latmax, box.lngmax),
    haversineKm(q.lat, q.lon, box.latmin, box.lngmin),
  );

  const buckets = new Map<string, Bucket>();

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

    const fit = ageFit(maxMa, minMa, q.maxMa, q.minMa);
    const near = cornerKm > 0 ? 1 - Math.min(1, haversineKm(q.lat, q.lon, lat, lng) / cornerKm) : 1;
    const rankCode = num(r?.rnk);
    const group = specified(r?.cll) ?? specified(r?.phl);

    const prev = buckets.get(name);
    if (!prev) {
      buckets.set(name, { fossil, fit, near, rankCode, group, count: 1 });
      continue;
    }
    prev.count += 1;
    if (!prev.group) prev.group = group;
    if (fit > prev.fit || (fit === prev.fit && near > prev.near)) {
      prev.fossil = fossil;
      prev.fit = fit;
      prev.near = near;
      prev.rankCode = rankCode;
    }
  }

  const all = [...buckets.values()];
  const groupSize = new Map<string, number>();
  let maxCount = 1;
  for (const b of all) {
    if (b.count > maxCount) maxCount = b.count;
    if (b.group) groupSize.set(b.group, (groupSize.get(b.group) ?? 0) + 1);
  }
  let maxGroup = 1;
  for (const n of groupSize.values()) if (n > maxGroup) maxGroup = n;

  const scored = all.map((b) => {
    const abundance = maxCount > 1 ? Math.log2(1 + b.count) / Math.log2(1 + maxCount) : 1;
    // The nth near-identical member of an already well represented group adds
    // less than the first member of a group nothing else covers. Taxa PBDB could
    // not place take the crowded value rather than a bonus for being unplaced.
    const size = b.group ? (groupSize.get(b.group) ?? maxGroup) : maxGroup;
    const distinctness = maxGroup > 1 ? 1 - Math.log2(1 + size) / Math.log2(1 + maxGroup) : 1;
    const score =
      W_AGE_FIT * b.fit +
      W_SPECIFICITY * specificity(b.rankCode) +
      W_ABUNDANCE * abundance +
      W_PROXIMITY * b.near +
      W_DISTINCTNESS * distinctness;
    return { fossil: b.fossil, score };
  });

  // Every term is a function of the taxon alone, so taking the head of this sort
  // can never drop a taxon that outscored one it kept.
  scored.sort((a, b) => b.score - a.score || byName(a.fossil.name, b.fossil.name));

  const result: FossilResult = {
    records: scored.slice(0, MAX_RECORDS).map((e) => e.fossil),
    truncated: scored.length > MAX_RECORDS || raw.length >= UPSTREAM_LIMIT,
  };
  cache.set(key, result);
  return result;
}
