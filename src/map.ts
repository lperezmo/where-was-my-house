import { hasTiles, TILE_MAX_ZOOM } from "./config";
import type { MapHandle } from "./mapview";
import "./map.css";

export { hasTiles, TILE_MAX_ZOOM };

/**
 * Below this the globe is all you see; above it the map has fully taken over.
 * The band between is the crossfade, so leaving the globe is a flight rather
 * than a cut.
 */
export const FADE_START = 0.1;
export const FADE_END = 0.3;

/** Stick position to map zoom, so the whole lower travel is real map detail. */
export function zoomForValue(value: number): number {
  const t = Math.min(1, Math.max(0, (value - FADE_START) / (1 - FADE_START)));
  return t * TILE_MAX_ZOOM;
}

export function valueForZoom(z: number): number {
  return FADE_START + (Math.min(TILE_MAX_ZOOM, Math.max(0, z)) / TILE_MAX_ZOOM) * (1 - FADE_START);
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
