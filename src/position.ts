import type { TrackStep } from "./types";

/** Shortest signed angular difference from a to b, in degrees. */
export function deltaLon(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/**
 * The reconstruction lands on a 5 to 10 Myr grid and a scrub lands between
 * steps, so positions are interpolated between the two neighbours. Longitude is
 * walked the short way round so a point near the antimeridian does not sweep
 * backwards across the globe.
 *
 * Nothing is extrapolated. GPlates resolves no position before its plate
 * exists, so past the oldest resolved age this returns null rather than
 * repeating the last known position under a much older label.
 */
export function positionAt(steps: TrackStep[], age: number): TrackStep | null {
  if (!steps.length) return null;
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (age < first.ageMa || age > last.ageMa) return null;
  if (age === first.ageMa) return first;
  if (age === last.ageMa) return last;

  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i];
    const b = steps[i + 1];
    if (age >= a.ageMa && age <= b.ageMa) {
      const t = (age - a.ageMa) / (b.ageMa - a.ageMa || 1);
      return {
        ageMa: age,
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + deltaLon(a.lon, b.lon) * t,
      };
    }
  }
  return null;
}
