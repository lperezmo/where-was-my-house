import type { Period } from "./types";

export type { Period };

/**
 * Ages and colours are the ICS International Chronostratigraphic Chart v2026/06
 * (stratigraphy.org) with the CGMW colour scheme. Several bases moved in the
 * 2025 revision (Cretaceous, Carboniferous, Devonian, Silurian, Ordovician), so
 * these do not match older printings of the chart.
 *
 * startMa is the base of the period (older bound), endMa its top (younger).
 */
export const PERIODS: Period[] = [
  { name: "Quaternary", startMa: 2.58, endMa: 0, color: "#F9F97F" },
  { name: "Neogene", startMa: 23.04, endMa: 2.58, color: "#FFE619" },
  { name: "Paleogene", startMa: 66.0, endMa: 23.04, color: "#FD9A52" },
  { name: "Cretaceous", startMa: 143.1, endMa: 66.0, color: "#7FC64E" },
  { name: "Jurassic", startMa: 201.4, endMa: 143.1, color: "#34B2C9" },
  { name: "Triassic", startMa: 251.902, endMa: 201.4, color: "#812B92" },
  { name: "Permian", startMa: 298.9, endMa: 251.902, color: "#F04028" },
  { name: "Carboniferous", startMa: 358.86, endMa: 298.9, color: "#67A599" },
  { name: "Devonian", startMa: 419.62, endMa: 358.86, color: "#CB8C37" },
  { name: "Silurian", startMa: 443.1, endMa: 419.62, color: "#B3E1B6" },
  { name: "Ordovician", startMa: 486.85, endMa: 443.1, color: "#009270" },
  { name: "Cambrian", startMa: 538.8, endMa: 486.85, color: "#7FA056" },
];

const OLDEST = PERIODS[PERIODS.length - 1];

/**
 * A boundary age belongs to the period that begins at it, so 66 Ma reads as
 * Paleogene. Ages past the base of the Cambrian clamp rather than throw: the
 * track runs to 540 Ma and the Phanerozoic does not.
 */
export function periodAt(ageMa: number): Period {
  const age = Number.isFinite(ageMa) ? Math.max(0, ageMa) : 0;
  for (const p of PERIODS) {
    if (age <= p.startMa) return p;
  }
  return OLDEST;
}
