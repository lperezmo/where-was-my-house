/**
 * Macrostrat-backed bedrock geology for a point.
 *
 * Macrostrat v2's default project is North America, so most of the planet has
 * no columns at all. That is reported as `covered: false`, which is a different
 * answer from "there are units here but none of this age" (`covered: true` with
 * an empty `units`). The UI has to be able to tell those apart.
 */

import type { GeologyResult, GeoUnit } from "../../src/types";
import { fetchJson, TtlCache, UpstreamError } from "./http";

const UNITS_BASE = "https://macrostrat.org/api/v2/units";
const ENVIRONMENTS_URL = "https://macrostrat.org/api/v2/defs/environments?all";

/** Macrostrat is CC-BY 4.0, so callers must be able to credit it. */
export const ATTRIBUTION =
  "Geologic units from Macrostrat (https://macrostrat.org), licensed CC-BY 4.0";

const MAX_UNITS = 25;
const MAX_LITHS = 8;
const MAX_ENVIRONMENTS = 8;
const MAX_REFS = 5;
const UNITS_TIMEOUT_MS = 12000;
const DEFS_TIMEOUT_MS = 8000;

// A zero-width window (the scrubber parked on a single age) makes every overlap
// zero, so a floor keeps the score meaningful and reduces it to "prefer the
// shortest-lived unit containing that age".
const EPSILON_MA = 1e-3;

interface MacroLith {
  name?: string;
  prop?: number;
}

interface MacroEnviron {
  environ_id?: number;
  name?: string;
  class?: string;
}

interface MacroUnit {
  unit_name?: string;
  strat_name_long?: string | null;
  Fm?: string;
  Gp?: string;
  t_age?: number;
  b_age?: number;
  t_int_name?: string;
  b_int_name?: string;
  lith?: MacroLith[];
  environ?: MacroEnviron[];
  refs?: number[];
  pbdb_occurrences?: number;
}

interface MacroUnitsBody {
  success?: {
    data?: MacroUnit[];
    /** ref_id (stringified) to a full citation. */
    refs?: Record<string, string>;
  };
}

interface EnvironDef {
  environ_id?: number;
  class?: string;
}

interface EnvironDefsBody {
  success?: { data?: EnvironDef[] };
}

/** The only two classes Macrostrat's environment vocabulary actually uses. */
type Marinity = "marine" | "non-marine";

interface RawUnits {
  units: MacroUnit[];
  refs: Record<string, string>;
}

// Keyed on the point alone so scrubbing through ages reuses one upstream call.
const rawCache = new TtlCache<RawUnits>(50, 12 * 60 * 60 * 1000);
const resultCache = new TtlCache<GeologyResult>(200, 6 * 60 * 60 * 1000);
const vocabCache = new TtlCache<Map<number, Marinity>>(1, 24 * 60 * 60 * 1000);

const VOCAB_KEY = "environments";
let vocabInFlight: Promise<Map<number, Marinity>> | null = null;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function marinity(v: unknown): Marinity | null {
  const s = text(v).toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "marine") return "marine";
  if (s === "non-marine" || s === "nonmarine") return "non-marine";
  return null;
}

/**
 * The real vocabulary from /defs/environments rather than pattern-matching the
 * free-text names. Units embed a `class` inline too, so a failure here degrades
 * to that instead of failing the request.
 */
async function environmentClasses(): Promise<Map<number, Marinity>> {
  const hit = vocabCache.get(VOCAB_KEY);
  if (hit) return hit;
  if (!vocabInFlight) {
    vocabInFlight = fetchJson<EnvironDefsBody>(ENVIRONMENTS_URL, { timeoutMs: DEFS_TIMEOUT_MS })
      .then((body) => {
        const map = new Map<number, Marinity>();
        for (const def of body?.success?.data ?? []) {
          const id = num(def?.environ_id);
          const cls = marinity(def?.class);
          if (id != null && cls) map.set(id, cls);
        }
        if (map.size === 0) throw new UpstreamError("Environment vocabulary was empty", 502);
        vocabCache.set(VOCAB_KEY, map);
        return map;
      })
      .finally(() => {
        vocabInFlight = null;
      });
  }
  return vocabInFlight;
}

function settingFor(
  environs: readonly MacroEnviron[],
  vocab: Map<number, Marinity> | null,
): GeoUnit["setting"] {
  let marine = false;
  let nonmarine = false;
  for (const e of environs) {
    const id = num(e?.environ_id);
    const cls = (id != null ? vocab?.get(id) : undefined) ?? marinity(e?.class);
    if (cls === "marine") marine = true;
    else if (cls === "non-marine") nonmarine = true;
  }
  if (marine && nonmarine) return "mixed";
  if (marine) return "marine";
  if (nonmarine) return "nonmarine";
  return "unknown";
}

function mergeSetting(a: GeoUnit["setting"], b: GeoUnit["setting"]): GeoUnit["setting"] {
  if (a === "unknown") return b;
  if (b === "unknown") return a;
  return a === b ? a : "mixed";
}

function intervalLabel(u: MacroUnit): string {
  const top = text(u?.t_int_name);
  const bottom = text(u?.b_int_name);
  if (bottom && top && bottom !== top) return `${bottom} to ${top}`;
  return bottom || top;
}

function nameFor(u: MacroUnit): string {
  const long = text(u?.strat_name_long);
  if (long) return long;
  const unit = text(u?.unit_name);
  if (unit && !/^unnamed$/i.test(unit)) return unit;
  const fm = text(u?.Fm);
  if (fm) return `${fm} Formation`;
  const gp = text(u?.Gp);
  if (gp) return `${gp} Group`;
  const interval = intervalLabel(u);
  return interval ? `Unnamed ${interval} unit` : "Unnamed unit";
}

/** Lithologies ordered by their proportion of the unit, so the dominant rock leads. */
function lithsFor(u: MacroUnit): string[] {
  return (u?.lith ?? [])
    .map((l) => ({ name: text(l?.name), prop: num(l?.prop) ?? 0 }))
    .filter((l) => l.name !== "")
    .sort((a, b) => b.prop - a.prop)
    .map((l) => l.name);
}

/**
 * Jaccard overlap of the unit's span with the requested window: 1.0 when they
 * coincide, and it falls away both when the unit misses the window and when the
 * unit is so long-lived that knowing it was here says little about that age.
 */
function relevance(unitMin: number, unitMax: number, minMa: number, maxMa: number): number {
  const overlap = Math.max(0, Math.min(maxMa, unitMax) - Math.max(minMa, unitMin));
  const union = Math.max(maxMa, unitMax) - Math.min(minMa, unitMin);
  return (overlap + EPSILON_MA) / (union + EPSILON_MA);
}

function citations(u: MacroUnit, refs: Record<string, string>): string[] {
  const out: string[] = [];
  for (const id of u?.refs ?? []) {
    const cite = text(refs[String(id)]);
    if (cite && !out.includes(cite)) out.push(cite);
  }
  return out;
}

function dedupeKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function pushCapped(target: string[], values: readonly string[], cap: number): void {
  for (const v of values) {
    if (target.length >= cap) return;
    if (!target.includes(v)) target.push(v);
  }
}

/**
 * Keep only the fields this module reads. `response=long` also carries per-unit
 * geochemical `measure` arrays that are ~95% of the payload, and holding those
 * in the cache would cost hundreds of megabytes of lambda memory for nothing.
 */
function slim(u: MacroUnit): MacroUnit {
  return {
    unit_name: u?.unit_name,
    strat_name_long: u?.strat_name_long,
    Fm: u?.Fm,
    Gp: u?.Gp,
    t_age: u?.t_age,
    b_age: u?.b_age,
    t_int_name: u?.t_int_name,
    b_int_name: u?.b_int_name,
    lith: (u?.lith ?? []).map((l) => ({ name: l?.name, prop: l?.prop })),
    environ: (u?.environ ?? []).map((e) => ({
      environ_id: e?.environ_id,
      name: e?.name,
      class: e?.class,
    })),
    refs: u?.refs,
    pbdb_occurrences: u?.pbdb_occurrences,
  };
}

async function fetchRawUnits(lat: number, lon: number): Promise<RawUnits> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = rawCache.get(key);
  if (cached) return cached;

  const url = `${UNITS_BASE}?lat=${lat}&lng=${lon}&adjacents=true&response=long`;
  const body = await fetchJson<MacroUnitsBody>(url, { timeoutMs: UNITS_TIMEOUT_MS });
  if (!body?.success || !Array.isArray(body.success.data)) {
    throw new UpstreamError("Geology service returned an unexpected response", 502);
  }

  const raw: RawUnits = {
    units: body.success.data.map(slim),
    refs: body.success.refs && typeof body.success.refs === "object" ? body.success.refs : {},
  };
  rawCache.set(key, raw);
  return raw;
}

export interface GeologyQuery {
  lat: number;
  lon: number;
  maxMa: number;
  minMa: number;
}

export async function fetchGeology(q: GeologyQuery): Promise<GeologyResult> {
  const key = `${q.lat.toFixed(2)},${q.lon.toFixed(2)},${q.maxMa},${q.minMa}`;
  const cached = resultCache.get(key);
  if (cached) return cached;

  const [raw, vocab] = await Promise.all([
    fetchRawUnits(q.lat, q.lon),
    environmentClasses().catch(() => null),
  ]);

  // Any unit at all means Macrostrat maps this ground, whether or not rock of
  // the requested age survived here.
  const covered = raw.units.length > 0;

  const merged = new Map<string, { unit: GeoUnit; score: number; occurrences: number }>();

  for (const u of raw.units) {
    const top = num(u?.t_age);
    const bottom = num(u?.b_age);
    if (top == null || bottom == null) continue;

    const minMa = Math.min(top, bottom);
    const maxMa = Math.max(top, bottom);
    if (maxMa < q.minMa || minMa > q.maxMa) continue;

    const environs = u?.environ ?? [];
    const name = nameFor(u);
    const candidate: GeoUnit = {
      name,
      maxMa,
      minMa,
      liths: lithsFor(u).slice(0, MAX_LITHS),
      environments: environs
        .map((e) => text(e?.name))
        .filter((n) => n !== "")
        .slice(0, MAX_ENVIRONMENTS),
      setting: settingFor(environs, vocab),
      refs: citations(u, raw.refs).slice(0, MAX_REFS),
    };

    const score = relevance(minMa, maxMa, q.minMa, q.maxMa);
    const occurrences = num(u?.pbdb_occurrences) ?? 0;
    const dedupe = dedupeKey(name);
    const prev = merged.get(dedupe);

    if (!prev) {
      merged.set(dedupe, { unit: candidate, score, occurrences });
      continue;
    }

    // Adjacent columns describe the same named unit over and over. Keep the
    // ages of the instance that brackets the window best and fold in whatever
    // the other instances add.
    const better = score > prev.score;
    const keep = better ? candidate : prev.unit;
    const drop = better ? prev.unit : candidate;
    pushCapped(keep.liths, drop.liths, MAX_LITHS);
    pushCapped(keep.environments, drop.environments, MAX_ENVIRONMENTS);
    pushCapped(keep.refs, drop.refs, MAX_REFS);
    keep.setting = mergeSetting(keep.setting, drop.setting);
    merged.set(dedupe, {
      unit: keep,
      score: Math.max(score, prev.score),
      occurrences: Math.max(occurrences, prev.occurrences),
    });
  }

  const units = [...merged.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.occurrences - a.occurrences ||
        a.unit.name.localeCompare(b.unit.name),
    )
    .map((e) => e.unit)
    .slice(0, MAX_UNITS);

  const result: GeologyResult = { covered, units };
  resultCache.set(key, result);
  return result;
}
