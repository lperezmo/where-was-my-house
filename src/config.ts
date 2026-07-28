/**
 * Where the paleo map tiles are served from, as `<base>/tiles/{age}/{z}/{x}/{y}.png`.
 *
 * This is public by necessity: the browser requests tiles directly, so the URL
 * is visible in devtools no matter where it is kept. It lives in an env var for
 * configurability, not secrecy, so the CDN can be repointed without a source
 * change. Vite inlines it at build time, so changing it in Vercel needs a
 * redeploy rather than taking effect live.
 *
 * Empty means no bucket is wired up yet, and the map view stays unavailable
 * rather than firing requests at a URL that cannot answer.
 */
const raw = (import.meta.env.VITE_TILE_BASE ?? "").trim();

export const TILE_BASE = raw.replace(/\/+$/, "");

export const hasTiles = TILE_BASE.length > 0;

export function tileUrl(age: number, z: number, x: number, y: number): string {
  return `${TILE_BASE}/tiles/${age}/${z}/${x}/${y}.png`;
}

/**
 * Tiles exist every 5 Myr from 0 to 540, rendered by the deeptime-open pipeline
 * from the Scotese and Wright PaleoDEM on Merdith2021 reconstructions.
 *
 * These live here rather than beside the map so the orchestrator can label the
 * view without importing the map module, which would pull MapLibre into the
 * initial bundle and undo the whole point of loading it on demand.
 */
const TILE_STEP = 5;
export const TILE_MAX_AGE = 540;

/**
 * Zoom stops at 4 because that is where the source data stops. A z4 pixel is
 * about 9.8 km at the equator and the PaleoDEM cell is 6 arcminutes, about
 * 11 km, so anything past this would be upsampling: detail that was never
 * measured. The ceiling is paleo-elevation reconstruction, not the pipeline.
 */
export const TILE_MAX_ZOOM = 4;

export function tileAgeFor(ageMa: number): number {
  const snapped = Math.round(ageMa / TILE_STEP) * TILE_STEP;
  return Math.min(TILE_MAX_AGE, Math.max(0, snapped));
}
