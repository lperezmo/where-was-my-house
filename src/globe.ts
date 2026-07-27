import maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  StyleSpecification,
} from "maplibre-gl";
import type { Feature as GeoFeature, FeatureCollection, Geometry } from "geojson";
import type { Track, TrackStep } from "./types";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globe.css";

export interface GlobeHandle {
  setTrack(track: Track): void;
  setAge(ageMa: number): void;
  destroy(): void;
}

const MAX_AGE = 540;

/** Widest sampling interval in api/_lib/ages.ts is 10 Ma; a wider jump means the model had no position. */
const GAP_MA = 15;

/** Mercator tiling cannot represent the caps, so geometry stops short of the poles. */
const LAT_LIMIT = 84;

/** Degrees of arc between the camera center and the marker before the camera follows it. */
const FOLLOW_ARC = 46;

/** Grace period after the user last touched the globe, so scrubbing does not yank their view. */
const USER_GRACE_MS = 1800;

interface Palette {
  bg: string;
  ocean: string;
  accent: string;
  textDim: string;
}

const FALLBACK: Record<string, string> = {
  "--bg": "#0a0d12",
  "--ocean": "#16344d",
  "--accent": "#e0a45e",
  "--text-dim": "#93a1b5",
};

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || FALLBACK[name];
  return {
    bg: v("--bg"),
    ocean: v("--ocean"),
    accent: v("--accent"),
    textDim: v("--text-dim"),
  };
}

function reduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Shift `to` by whole turns so it lands within 180 degrees of `from`. */
function nearestLon(from: number, to: number): number {
  return to + 360 * Math.round((from - to) / 360);
}

function arcDegrees(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / r;
}

type Feature = GeoFeature<Geometry, Record<string, unknown>>;

function collection(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

function graticule(): FeatureCollection {
  const features: Feature[] = [];

  for (let lon = -180; lon < 180; lon += 30) {
    const coords: number[][] = [];
    for (let lat = -LAT_LIMIT; lat <= LAT_LIMIT; lat += 4) coords.push([lon, lat]);
    features.push({
      type: "Feature",
      properties: { kind: "meridian" },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  for (const lat of [-60, -30, 0, 30, 60]) {
    const coords: number[][] = [];
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat]);
    features.push({
      type: "Feature",
      properties: { kind: lat === 0 ? "equator" : "parallel" },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  return collection(features);
}

/** The tropics are the one belt that stays meaningful across deep time, so it is the only fill. */
function tropics(): FeatureCollection {
  const ring: number[][] = [];
  for (let lon = -180; lon <= 180; lon += 5) ring.push([lon, -23.5]);
  for (let lon = 180; lon >= -180; lon -= 5) ring.push([lon, 23.5]);
  ring.push([-180, -23.5]);
  return collection([
    {
      type: "Feature",
      properties: { kind: "tropical" },
      geometry: { type: "Polygon", coordinates: [ring] },
    },
  ]);
}

/**
 * One feature per consecutive pair, each unwrapped against its own start point. A segment can
 * therefore reach lon 181 or -181 but never further, which keeps the antimeridian crossing short
 * instead of smearing the whole way round, and stays inside the range the tiler can wrap back in.
 */
function trackFeatures(steps: TrackStep[]): FeatureCollection {
  const features: Feature[] = [];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    if (b.ageMa - a.ageMa > GAP_MA) continue;
    const lonA = wrapLon(a.lon);
    const lonB = nearestLon(lonA, wrapLon(b.lon));
    const mid = (a.ageMa + b.ageMa) / 2;
    features.push({
      type: "Feature",
      properties: { t: 1 - Math.min(1, mid / MAX_AGE) },
      geometry: {
        type: "LineString",
        coordinates: [
          [lonA, a.lat],
          [lonB, b.lat],
        ],
      },
    });
  }
  return collection(features);
}

function buildStyle(c: Palette): StyleSpecification {
  return {
    version: 8,
    name: "where-was-my-house",
    projection: { type: "globe" },
    sky: {
      "sky-color": c.bg,
      "horizon-color": c.ocean,
      "fog-color": c.bg,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.4,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.85, 4, 0.5, 6, 0],
    },
    sources: {
      graticule: { type: "geojson", data: graticule() },
      belts: { type: "geojson", data: tropics() },
      track: { type: "geojson", data: collection([]) },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": c.ocean } },
      {
        id: "tropics",
        type: "fill",
        source: "belts",
        paint: { "fill-color": c.accent, "fill-opacity": 0.06 },
      },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        filter: ["!=", ["get", "kind"], "equator"],
        // --line matches --ocean in luminance, so the grid needs the lighter dim text colour.
        paint: { "line-color": c.textDim, "line-width": 0.8, "line-opacity": 0.16 },
      },
      {
        id: "equator",
        type: "line",
        source: "graticule",
        filter: ["==", ["get", "kind"], "equator"],
        paint: { "line-color": c.textDim, "line-width": 1.4, "line-opacity": 0.3 },
      },
      {
        id: "track-casing",
        type: "line",
        source: "track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.bg,
          "line-opacity": 0.45,
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 4, 3, 5.5, 6, 7.5],
        },
      },
      {
        id: "track",
        type: "line",
        source: "track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["interpolate", ["linear"], ["get", "t"], 0, c.textDim, 1, c.accent],
          "line-opacity": ["interpolate", ["linear"], ["get", "t"], 0, 0.45, 1, 1],
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 1.8, 3, 2.6, 6, 3.6],
        },
      },
    ],
  };
}

function markerEl(kind: "now" | "home", label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `pv-marker pv-${kind} pv-off`;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  const parts = kind === "now" ? ["pv-pulse", "pv-dot"] : ["pv-ring"];
  for (const part of parts) {
    const span = document.createElement("span");
    span.className = part;
    el.append(span);
  }
  return el;
}

/** Zoom at which the sphere fills most of the shorter side of the container. */
function fitZoom(width: number, height: number): number {
  const side = Math.min(width, height);
  if (!side) return 0.8;
  const z = Math.log2((side * 0.76 * Math.PI) / 512);
  return Math.max(0, Math.min(3.2, z));
}

export function createGlobe(container: HTMLElement): GlobeHandle {
  const colors = palette();

  const root = document.createElement("div");
  root.className = "pv-globe";
  container.append(root);

  const baseZoom = fitZoom(container.clientWidth, container.clientHeight);

  const map: MapLibreMap = new maplibregl.Map({
    container: root,
    style: buildStyle(colors),
    center: [0, 20],
    zoom: baseZoom,
    minZoom: Math.max(0, baseZoom - 1),
    maxZoom: 6,
    pitch: 0,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    attributionControl: false,
    maplibreLogo: false,
    keyboard: true,
  });

  // One finger rotates the planet, two fingers zoom. Twist-to-rotate on a phone feels broken here.
  map.touchZoomRotate.disableRotation();

  // Both start at 0,0 and hidden: Marker.addTo projects its position immediately.
  const nowMarker: MapLibreMarker = new maplibregl.Marker({
    element: markerEl("now", "Reconstructed position"),
    anchor: "center",
    opacityWhenCovered: "0.22",
  }).setLngLat([0, 0]);
  const homeMarker: MapLibreMarker = new maplibregl.Marker({
    element: markerEl("home", "Present-day position"),
    anchor: "center",
    opacityWhenCovered: "0.15",
  }).setLngLat([0, 0]);

  let ready = false;
  let dead = false;
  let track: Track | null = null;
  let steps: TrackStep[] = [];
  let ageMa = 0;
  let interacting = false;
  let lastUserInput = 0;
  let userAdjusted = false;

  const canvas = map.getCanvasContainer();

  const onDown = () => {
    interacting = true;
    lastUserInput = performance.now();
    userAdjusted = true;
  };
  const onUp = () => {
    if (!interacting) return;
    interacting = false;
    lastUserInput = performance.now();
  };
  const onMoveStart = (e: { originalEvent?: unknown }) => {
    if (!e.originalEvent) return;
    lastUserInput = performance.now();
    userAdjusted = true;
  };
  const onResize = () => {
    if (userAdjusted) return;
    map.setZoom(frameZoom());
  };

  function frameZoom(): number {
    const z = fitZoom(container.clientWidth, container.clientHeight);
    map.setMinZoom(Math.max(0, z - 1));
    return z;
  }

  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  map.on("movestart", onMoveStart);
  map.on("resize", onResize);

  function cameraFree(): boolean {
    return !interacting && performance.now() - lastUserInput > USER_GRACE_MS;
  }

  function stepFor(age: number): TrackStep | null {
    let best: TrackStep | null = null;
    let bestDelta = Infinity;
    for (const s of steps) {
      const d = Math.abs(s.ageMa - age);
      if (d < bestDelta) {
        bestDelta = d;
        best = s;
      }
    }
    return bestDelta > GAP_MA ? null : best;
  }

  function show(marker: MapLibreMarker, on: boolean) {
    marker.getElement().classList.toggle("pv-off", !on);
  }

  function paint() {
    if (!ready || !track) return;
    const source = map.getSource("track") as GeoJSONSource | undefined;
    source?.setData(trackFeatures(steps));
    homeMarker.setLngLat([wrapLon(track.point.lon), track.point.lat]);
    show(homeMarker, true);
    place(false);
  }

  function place(follow: boolean) {
    if (!track) return;
    const step = stepFor(ageMa);
    if (!step) {
      show(nowMarker, false);
      return;
    }
    const lon = wrapLon(step.lon);
    nowMarker.setLngLat([lon, step.lat]);
    show(nowMarker, true);
    if (!follow || !cameraFree()) return;

    const c = map.getCenter();
    const arc = arcDegrees(c.lat, c.lng, step.lat, lon);
    if (arc < FOLLOW_ARC) return;
    map.easeTo({
      center: [nearestLon(c.lng, lon), step.lat],
      duration: reduceMotion() ? 0 : Math.min(1100, 320 + arc * 6),
    });
  }

  map.on("load", () => {
    if (dead) return;
    ready = true;
    nowMarker.addTo(map);
    homeMarker.addTo(map);
    paint();
  });

  return {
    setTrack(next: Track) {
      if (dead) return;
      track = next;
      steps = [...next.steps].sort((a, b) => a.ageMa - b.ageMa);
      userAdjusted = false;
      paint();
      const target = stepFor(ageMa) ?? { lat: next.point.lat, lon: next.point.lon };
      const c = map.getCenter();
      map.easeTo({
        center: [nearestLon(c.lng, wrapLon(target.lon)), target.lat],
        zoom: frameZoom(),
        duration: reduceMotion() ? 0 : 900,
      });
    },

    setAge(next: number) {
      if (dead) return;
      ageMa = next;
      place(true);
    },

    destroy() {
      if (dead) return;
      dead = true;
      ready = false;
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      map.off("movestart", onMoveStart);
      map.off("resize", onResize);
      nowMarker.remove();
      homeMarker.remove();
      map.remove();
      root.remove();
      track = null;
      steps = [];
    },
  };
}
