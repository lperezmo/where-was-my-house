/**
 * Precomputes reconstructed coastlines into public/coastlines/{age}.json.
 *
 * GPlates returns about 2.2 MB and takes 4.5 s per age, which is far too slow
 * and too large to ask for at scrub time. The globe is drawn 300 px across, so
 * one pixel is roughly 0.6 degrees and simplifying at 0.5 degrees is visually
 * lossless while cutting the payload to about 25 kB gzipped.
 *
 * Run with: bun run coastlines
 */
import { mkdir, writeFile } from "node:fs/promises";
import { AGES, MODEL } from "../api/_lib/ages";

const OUT = new URL("../public/coastlines/", import.meta.url);
const TOLERANCE = 0.5;
const MIN_AREA = 1.0;
const CONCURRENCY = 3;

type Ring = [number, number][];

function ringsOf(geometry: { type: string; coordinates: unknown }): Ring[] {
  const c = geometry.coordinates;
  if (geometry.type === "Polygon") return c as Ring[];
  if (geometry.type === "MultiPolygon") return (c as Ring[][]).flat();
  return [];
}

/** Shoelace area in square degrees. Only used to drop specks, so it need not be spherical. */
function area(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(s) / 2;
}

/** Iterative Douglas-Peucker; the recursive form blows the stack on long rings. */
function simplify(points: Ring, eps: number): Ring {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = 0;
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const den = Math.hypot(dx, dy);

    for (let i = first + 1; i < last; i++) {
      const [x0, y0] = points[i];
      const dist = den
        ? Math.abs(dx * (y1 - y0) - (x1 - x0) * dy) / den
        : Math.hypot(x0 - x1, y0 - y1);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }

    if (maxDist > eps && index) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Ring = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

async function fetchAge(age: number): Promise<Ring[]> {
  const url =
    age === 0
      ? `https://gws.gplates.org/reconstruct/coastlines/?time=0&model=${MODEL}`
      : `https://gws.gplates.org/reconstruct/coastlines/?time=${age}&model=${MODEL}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${age} Ma: HTTP ${res.status}`);
  const body = (await res.json()) as { features?: { geometry: { type: string; coordinates: unknown } }[] };

  const out: Ring[] = [];
  for (const feature of body.features ?? []) {
    for (const ring of ringsOf(feature.geometry)) {
      if (area(ring) < MIN_AREA) continue;
      const small = simplify(ring, TOLERANCE);
      if (small.length < 4) continue;
      out.push(small.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]));
    }
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const queue = [...AGES];
  let done = 0;

  async function worker() {
    for (;;) {
      const age = queue.shift();
      if (age === undefined) return;
      try {
        const rings = await fetchAge(age);
        const body = JSON.stringify(rings);
        await writeFile(new URL(`${age}.json`, OUT), body);
        done += 1;
        console.log(
          `${String(done).padStart(2)}/${AGES.length}  ${String(age).padStart(3)} Ma  ` +
            `${String(rings.length).padStart(4)} rings  ${(body.length / 1024).toFixed(1)} kB`,
        );
      } catch (err) {
        console.error(`${age} Ma failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

await main();
