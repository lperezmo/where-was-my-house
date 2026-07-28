import { hasTiles } from "./config";
import type { MapHandle } from "./mapview";
import "./map.css";

export type { MapHandle };
export { hasTiles };

export interface MapFacade {
  open(start: { lat: number; lon: number; ageMa: number }): void;
  setAge(ageMa: number): void;
  setMarker(lat: number, lon: number): void;
  flyTo(lat: number, lon: number): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * MapLibre is the whole weight of the app, and most visits never leave the
 * globe, so it is fetched the first time the map is opened. Calls made while
 * the chunk is in flight are buffered rather than lost.
 */
export function createMap(dialog: HTMLDialogElement, onClose: () => void): MapFacade {
  const container = dialog.querySelector("#map") as HTMLElement;
  let live: MapHandle | null = null;
  let open = false;
  let loading = false;
  let queuedAge: number | null = null;
  let queuedMarker: [number, number] | null = null;

  const status = document.createElement("p");
  status.className = "map-status";
  status.textContent = "Loading the map";

  /**
   * showModal gives the backdrop, the focus trap and Escape for free, but is
   * missing in older engines and in the test DOM, so the open attribute is the
   * fallback. Escape is handled separately for that path.
   */
  function show() {
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  // A click on the backdrop lands on the dialog itself, never on its children.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) facade.close();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    facade.close();
  });

  const facade: MapFacade = {
    get isOpen() {
      return open;
    },

    open(start) {
      if (open) return;
      open = true;
      show();

      if (live) {
        live.resize();
        live.setAge(start.ageMa);
        live.setMarker(start.lat, start.lon);
        live.flyTo(start.lat, start.lon);
        return;
      }
      if (loading) return;

      loading = true;
      container.append(status);
      void (async () => {
        try {
          const { mountMap } = await import("./mapview");
          if (!open) {
            loading = false;
            status.remove();
            return;
          }
          live = mountMap(container, start);
          status.remove();
          if (queuedAge != null) live.setAge(queuedAge);
          if (queuedMarker) live.setMarker(...queuedMarker);
          queuedAge = null;
          queuedMarker = null;
        } catch {
          status.textContent = "The map could not load.";
          status.dataset.state = "failed";
        } finally {
          loading = false;
        }
      })();
    },

    setAge(ageMa) {
      if (live) live.setAge(ageMa);
      else queuedAge = ageMa;
    },

    setMarker(lat, lon) {
      if (live) live.setMarker(lat, lon);
      else queuedMarker = [lat, lon];
    },

    flyTo(lat, lon) {
      live?.flyTo(lat, lon);
    },

    close() {
      if (!open) return;
      open = false;
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      onClose();
    },
  };

  return facade;
}
