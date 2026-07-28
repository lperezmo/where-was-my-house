import { hasTiles, MAP_MAX_ZOOM, TILE_MAX_ZOOM } from "./config";
import type { MapHandle } from "./mapview";
import "./map.css";

export { hasTiles, MAP_MAX_ZOOM, TILE_MAX_ZOOM };

/**
 * One notch for the globe, then one for every tile level the pyramid actually
 * holds. Notching it rather than leaving it free is the point: between two tile
 * levels there is no further detail to uncover, only larger pixels, so a smooth
 * slider would spend most of its travel promising a sharpness the PaleoDEM
 * never had. Every push down lands somewhere the imagery genuinely changes.
 */
export interface Detent {
  /** Stick position, 0 at the globe and 1 at the deepest tile level. */
  value: number;
  /** The map zoom this notch commands. Held at 0 for the globe notch. */
  z: number;
  name: string;
  /** Ground resolution at the equator. Empty at the globe, which has no scale. */
  detail: string;
}

/**
 * At map zoom 0 the world is one 512 px grid across a 40 075 km equator, which
 * is also exactly what a z1 tile resolves. Every notch below halves it.
 */
const KM_PER_PIXEL_Z0 = 40075 / 512;

/** Named by the scale each level can actually resolve, coarsest first. */
const NAMES = ["Globe", "World", "Continent", "Region", "Terrain"];

const NOTCHES = MAP_MAX_ZOOM + 2;

export const DETENTS: Detent[] = Array.from({ length: NOTCHES }, (_, i) => {
  const z = Math.max(0, i - 1);
  const km = KM_PER_PIXEL_Z0 / 2 ** z;
  return {
    value: i / (NOTCHES - 1),
    z,
    name: NAMES[i] ?? `Zoom ${z}`,
    detail: i === 0 ? "" : `${km >= 10 ? Math.round(km) : km.toFixed(1)} km/px`,
  };
});

/** The stick position of a notch, clamped so callers can ask for a rough depth. */
export function valueForStep(index: number): number {
  return DETENTS[Math.min(DETENTS.length - 1, Math.max(0, index))].value;
}

/**
 * Below this the globe is all you see; above it the map has fully taken over.
 * The whole crossfade is packed into the gap above the first map notch, so no
 * notch is ever a half-dissolved mix of the two: by the time the thumb clicks
 * into World, the map owns the screen outright.
 */
export const FADE_START = 0.02;
export const FADE_END = DETENTS[1].value * 0.8;

/** Stick position to map zoom. The first notch below the globe is map zoom 0. */
export function zoomForValue(value: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(0, value * (NOTCHES - 1) - 1));
}

export function valueForZoom(z: number): number {
  return (Math.min(MAP_MAX_ZOOM, Math.max(0, z)) + 1) / (NOTCHES - 1);
}

/** 0 while only the globe shows, 1 once the map has fully replaced it. */
export function mapOpacity(value: number): number {
  if (value <= FADE_START) return 0;
  if (value >= FADE_END) return 1;
  return (value - FADE_START) / (FADE_END - FADE_START);
}

export interface MapFacade {
  /** Brings the map up if needed and applies the stick position. */
  setValue(value: number, at: { lat: number; lon: number; ageMa: number }): void;
  setAge(ageMa: number): void;
  setCenter(lat: number, lon: number): void;
  setMarker(lat: number, lon: number): void;
  readonly isLive: boolean;
}

export interface MapOptions {
  /** Fired when the map's own gestures move zoom, so the stick can follow. */
  onZoom(value: number): void;
}

/**
 * MapLibre is the heaviest thing in the app and most visits never leave the
 * globe, so it is fetched the first time the stick moves off the top. Calls
 * made while the chunk is in flight are buffered rather than lost.
 */
export function createMap(container: HTMLElement, opts: MapOptions): MapFacade {
  let live: MapHandle | null = null;
  let loading = false;
  let pending: { lat: number; lon: number; ageMa: number; zoom: number } | null = null;

  const status = document.createElement("p");
  status.className = "map-status";
  status.textContent = "Loading the map";

  function begin(start: { lat: number; lon: number; ageMa: number; zoom: number }) {
    if (loading || live) {
      pending = start;
      return;
    }
    loading = true;
    pending = start;
    container.append(status);
    void (async () => {
      try {
        const { mountMap } = await import("./mapview");
        const at = pending ?? start;
        live = mountMap(container, at, {
          onZoom: (z) => opts.onZoom(valueForZoom(z)),
        });
        status.remove();
      } catch {
        status.textContent = "The map could not load.";
        status.dataset.state = "failed";
      } finally {
        loading = false;
        pending = null;
      }
    })();
  }

  return {
    get isLive() {
      return live !== null;
    },

    setValue(value, at) {
      const opacity = mapOpacity(value);
      container.style.opacity = String(opacity);
      // A fully faded map must not swallow gestures meant for the globe.
      container.style.pointerEvents = opacity > 0.5 ? "auto" : "none";
      container.setAttribute("aria-hidden", opacity > 0.5 ? "false" : "true");

      if (value <= FADE_START) return;
      if (!live) {
        begin({ ...at, zoom: zoomForValue(value) });
        return;
      }
      live.resize();
      live.setZoom(zoomForValue(value));
    },

    setAge(ageMa) {
      live?.setAge(ageMa);
    },

    setCenter(lat, lon) {
      live?.setCenter(lat, lon);
    },

    setMarker(lat, lon) {
      live?.setMarker(lat, lon);
    },
  };
}
