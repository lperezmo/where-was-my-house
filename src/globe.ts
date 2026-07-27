import type { Track } from "./types";
import "./globe.css";

export interface GlobeHandle {
  setTrack(track: Track): void;
  setAge(ageMa: number): void;
  destroy(): void;
}

function loadingEl(): HTMLElement {
  const el = document.createElement("div");
  el.className = "pv-loading";
  const ring = document.createElement("span");
  ring.className = "pv-loading-ring";
  const text = document.createElement("span");
  text.className = "pv-loading-text";
  text.textContent = "Loading the globe";
  el.append(ring, text);
  return el;
}

function setLoadingText(el: HTMLElement, message: string) {
  const text = el.querySelector(".pv-loading-text");
  if (text) text.textContent = message;
}

/**
 * MapLibre and its stylesheet are the bulk of the bundle, so everything that
 * touches them lives in ./globe-map and is fetched on demand. The handle comes
 * back synchronously and buffers the latest call of each kind, so a track
 * submitted before the chunk lands is replayed rather than lost, and a destroy
 * during the fetch stops the map from ever being built.
 */
export function createGlobe(container: HTMLElement): GlobeHandle {
  const loading = loadingEl();
  container.append(loading);

  let live: GlobeHandle | null = null;
  let dead = false;
  let queuedTrack: Track | null = null;
  let queuedAge: number | null = null;

  void (async () => {
    try {
      const { mountGlobe } = await import("./globe-map");
      if (dead) return;
      live = mountGlobe(container, () => loading.remove());
      if (queuedTrack) live.setTrack(queuedTrack);
      if (queuedAge != null) live.setAge(queuedAge);
      queuedTrack = null;
      queuedAge = null;
    } catch {
      if (dead) return;
      loading.dataset.state = "failed";
      setLoadingText(loading, "The globe could not load.");
    }
  })();

  return {
    setTrack(next: Track) {
      if (dead) return;
      if (live) live.setTrack(next);
      else queuedTrack = next;
    },

    setAge(next: number) {
      if (dead) return;
      if (live) live.setAge(next);
      else queuedAge = next;
    },

    destroy() {
      if (dead) return;
      dead = true;
      queuedTrack = null;
      queuedAge = null;
      loading.remove();
      live?.destroy();
      live = null;
    },
  };
}
