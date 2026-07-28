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
