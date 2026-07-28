import { Map as MlMap, Marker } from "maplibre-gl";
import { MAP_MAX_ZOOM, TILE_BASE, TILE_MAX_ZOOM, tileAgeFor } from "./config";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MapHandle {
  setAge(ageMa: number): void;
  setCenter(lat: number, lon: number): void;
  setMarker(lat: number, lon: number): void;
  setZoom(z: number): void;
  getZoom(): number;
  resize(): void;
  destroy(): void;
}

export interface MountOptions {
  /** Fired when the map's own gestures change zoom, so the stick can follow. */
  onZoom?(z: number): void;
}

function sourceFor(age: number) {
  return {
    type: "raster" as const,
    tiles: [`${TILE_BASE}/tiles/${age}/{z}/{x}/{y}.png`],
    tileSize: 256,
    minzoom: 0,
    maxzoom: TILE_MAX_ZOOM,
    attribution:
      'Paleogeography <a href="https://zenodo.org/records/5460860">Scotese &amp; Wright PaleoDEM</a> (CC BY 4.0), reconstructed with Merdith et al. 2021',
  };
}

/**
 * A phone paints two or three device pixels per PaleoDEM pixel even at native
 * scale. Interpolating that gap smears the shading into mush, so the cells are
 * drawn as the squares they are: coastlines stay crisp, and the grain on screen
 * is the grain of the data.
 *
 * Built once and reused, because changing age re-adds the layer and dropping
 * the paint there would leave the map sharp only until the first seek.
 */
function paleoLayer() {
  return {
    id: "paleo",
    type: "raster" as const,
    source: "paleo",
    paint: { "raster-resampling": "nearest" as const },
  };
}

export function mountMap(
  container: HTMLElement,
  start: { lat: number; lon: number; ageMa: number; zoom: number },
  opts: MountOptions = {},
): MapHandle {
  let age = tileAgeFor(start.ageMa);

  const map = new MlMap({
    container,
    center: [start.lon, start.lat],
    zoom: start.zoom,
    minZoom: 0,
    // A hard stop where the tiles land pixel for pixel. The old half step past
    // the last level, on top of the level MapLibre's 512 px zoom grid already
    // costs a 256 px source, was compounding into a visibly smeared map.
    maxZoom: MAP_MAX_ZOOM,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    style: {
      version: 8,
      sources: { paleo: sourceFor(age) },
      layers: [
        { id: "sea", type: "background", paint: { "background-color": "#0b2033" } },
        paleoLayer(),
      ],
    },
  });

  // No NavigationControl: the altitude lever is the zoom control, and a second
  // pair of buttons that knows nothing about the globe notch above z0 is
  // exactly the ambiguity the lever exists to remove.
  map.touchZoomRotate.disableRotation();

  const marker = new Marker({ color: "#e0a45e" })
    .setLngLat([start.lon, start.lat])
    .addTo(map);

  let ready = false;
  map.on("load", () => (ready = true));

  // Only report gestures the user drove, or the stick and the map would chase
  // each other every time one set the other.
  let echo = false;
  map.on("zoom", () => {
    if (!echo && opts.onZoom) opts.onZoom(map.getZoom());
  });

  /**
   * Each age is a separate tile pyramid, so changing age swaps the source
   * rather than the tile URL. Removing the layer first avoids a frame where the
   * layer points at a source that no longer exists.
   */
  function swap(next: number) {
    if (!ready || next === age) return;
    age = next;
    if (map.getLayer("paleo")) map.removeLayer("paleo");
    if (map.getSource("paleo")) map.removeSource("paleo");
    map.addSource("paleo", sourceFor(age));
    map.addLayer(paleoLayer());
  }

  return {
    setAge(next) {
      const wanted = tileAgeFor(next);
      if (ready) swap(wanted);
      else map.once("load", () => swap(wanted));
    },
    setCenter(lat, lon) {
      map.easeTo({ center: [lon, lat], duration: 500 });
    },
    setZoom(z) {
      if (Math.abs(map.getZoom() - z) < 0.01) return;
      echo = true;
      map.setZoom(z);
      echo = false;
    },
    getZoom: () => map.getZoom(),
    setMarker(lat, lon) {
      marker.setLngLat([lon, lat]);
    },
    resize() {
      map.resize();
    },
    destroy() {
      marker.remove();
      map.remove();
    },
  };
}
