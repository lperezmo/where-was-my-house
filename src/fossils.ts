import type { Fossil, FossilResult } from "./types";
import "./narrative.css";

const ITALIC_RANKS = new Set(["genus", "subgenus", "species", "subspecies"]);

interface Entry {
  name: string;
  rank: string;
  maxMa: number;
  minMa: number;
  count: number;
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "?";
  return String(Math.round(v * 100) / 100);
}

/** Mirrors the window main.ts asks the API for, since only the age is passed in. */
function windowFor(ageMa: number): { maxMa: number; minMa: number } {
  const span = Math.max(5, ageMa * 0.06);
  return { maxMa: ageMa + span, minMa: Math.max(0, ageMa - span) };
}

function collapse(records: Fossil[]): Entry[] {
  const byTaxon = new Map<string, Entry>();
  for (const r of records) {
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    const rank = String(r.rank ?? "");
    const key = `${name}|${rank}`;
    const seen = byTaxon.get(key);
    if (seen) {
      seen.count += 1;
      if (Number.isFinite(r.maxMa)) seen.maxMa = Math.max(seen.maxMa, r.maxMa);
      if (Number.isFinite(r.minMa)) seen.minMa = Math.min(seen.minMa, r.minMa);
    } else {
      byTaxon.set(key, {
        name,
        rank,
        maxMa: Number.isFinite(r.maxMa) ? r.maxMa : NaN,
        minMa: Number.isFinite(r.minMa) ? r.minMa : NaN,
        count: 1,
      });
    }
  }
  return [...byTaxon.values()].sort((a, b) => b.maxMa - a.maxMa || a.name.localeCompare(b.name));
}

function heading(text: string, detail: string): HTMLElement {
  const h = document.createElement("h2");
  h.className = "fossils-head";
  h.append(document.createTextNode(text));
  const span = document.createElement("span");
  span.textContent = detail;
  h.append(span);
  return h;
}

function note(text: string, kind = ""): HTMLElement {
  const p = document.createElement("p");
  p.className = kind ? `fossils-note ${kind}` : "fossils-note";
  p.textContent = text;
  return p;
}

function row(entry: Entry): HTMLLIElement {
  const li = document.createElement("li");

  const name = document.createElement("span");
  name.className = "fossil-name";
  // Taxon names come straight from PBDB, so they go in as text, never markup.
  if (ITALIC_RANKS.has(entry.rank.toLowerCase())) {
    const i = document.createElement("i");
    i.textContent = entry.name;
    name.append(i);
  } else {
    name.textContent = entry.name;
  }
  if (entry.rank) {
    const rank = document.createElement("small");
    rank.className = "fossil-rank";
    rank.textContent = entry.rank;
    name.append(" ", rank);
  }
  if (entry.count > 1) {
    const badge = document.createElement("small");
    badge.className = "fossil-count";
    badge.textContent = `x${entry.count}`;
    name.append(" ", badge);
  }

  const age = document.createElement("span");
  age.className = "fossil-age";
  age.textContent = Number.isFinite(entry.maxMa) && Number.isFinite(entry.minMa)
    ? `${num(entry.maxMa)} to ${num(entry.minMa)} Ma`
    : "age not recorded";

  li.append(name, age);
  return li;
}

export function renderFossils(container: HTMLElement, r: FossilResult, ageMa: number): void {
  container.textContent = "";

  const { maxMa, minMa } = windowFor(ageMa);
  const searched = `${num(maxMa)} to ${num(minMa)} Ma`;
  const records = Array.isArray(r?.records) ? r.records : [];

  const section = document.createElement("section");
  section.className = "fossils";

  if (!records.length) {
    section.append(heading("Fossils", searched));
    section.append(note("No fossil collections recorded near here for this window."));
    section.append(
      note(
        "That is a gap in the Paleobiology Database, not evidence that nothing lived here.",
        "fossils-caveat",
      ),
    );
    container.append(section);
    return;
  }

  const entries = collapse(records);
  const label = entries.length === 1 ? "1 taxon" : `${entries.length} taxa`;
  const occ = records.length === 1 ? "1 record" : `${records.length} records`;
  section.append(heading(`${label} from ${occ}`, searched));

  const list = document.createElement("ul");
  list.className = "fossil-list";
  for (const entry of entries) list.append(row(entry));
  section.append(list);

  if (r.truncated) {
    section.append(note("More records exist in this window than the search returned.", "fossils-caveat"));
  }

  container.append(section);
}
