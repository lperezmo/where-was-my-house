import { Map as MlMap, Marker, NavigationControl } from "maplibre-gl";
import { TILE_BASE, TILE_MAX_ZOOM, tileAgeFor } from "./config";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MapHandle {
  setAge(ageMa: number): void;
  flyTo(lat: number, lon: number): void;
  setMarker(lat: number, lon: number): void;
  resize(): void;
  destroy(): void;
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

export function mountMap(
  container: HTMLElement,
  start: { lat: number; lon: number; ageMa: number },
): MapHandle {
  let age = tileAgeFor(start.ageMa);

  const map = new MlMap({
    container,
    center: [start.lon, start.lat],
    zoom: 2.5,
    minZoom: 0,
    // Half a step past the last tile level, so the final zoom is a gentle
    // overzoom of real data rather than a hard stop mid-gesture.
    maxZoom: TILE_MAX_ZOOM + 0.5,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    style: {
      version: 8,
      sources: { paleo: sourceFor(age) },
      layers: [
        { id: "sea", type: "background", paint: { "background-color": "#0b2033" } },
        { id: "paleo", type: "raster", source: "paleo" },
      ],
    },
  });

  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.touchZoomRotate.disableRotation();

  const marker = new Marker({ color: "#e0a45e" })
    .setLngLat([start.lon, start.lat])
    .addTo(map);

  let ready = false;
  map.on("load", () => (ready = true));

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
    map.addLayer({ id: "paleo", type: "raster", source: "paleo" });
  }

  return {
    setAge(next) {
      const wanted = tileAgeFor(next);
      if (ready) swap(wanted);
      else map.once("load", () => swap(wanted));
    },
    flyTo(lat, lon) {
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 3), duration: 900 });
    },
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
