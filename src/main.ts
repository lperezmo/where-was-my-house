import { fetchFossils, fetchGeology, fetchTrack, geocode } from "./api";
import { createLatitudeChart } from "./chart";
import { renderFossils } from "./fossils";
import { createGlobe } from "./globe";
import { createMap, DETENTS, hasTiles, mapOpacity, valueForStep } from "./map";
import { createZoomStick } from "./zoomstick";
import { beltFor, describe, periodAt } from "./narrative";
import { capture, positionAt } from "./position";
import { renderPrompt } from "./prompt";
import { createTimeline } from "./timeline";
import type { GeoResult, Track } from "./types";
import "./style.css";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = el("app");
const form = el<HTMLFormElement>("search");
const input = el<HTMLInputElement>("q");
const suggestions = el<HTMLUListElement>("suggestions");
const introStatus = el("intro-status");
const statusEl = el("status");
const loadingPlace = el("loading-place");
const placeName = el("place-name");
const ageBig = el("age-big");
const periodName = el("period-name");
const periodDot = el<HTMLElement>("period-chip").querySelector("i") as HTMLElement;
const latLine = el("lat-line");
const climateEl = el("climate");
const narrativeEl = el("narrative");
const legendNow = el("legend-now");
const fossilsEl = el("fossils");
const promptEl = el("prompt");
const themeGroup = el("theme");
const themeBtns = [...themeGroup.querySelectorAll<HTMLButtonElement>("button[data-set]")];

const globe = createGlobe(el("globe"), { onPick: flyToPick });
const timeline = createTimeline(el("timeline"), { onSeek: seek, onScale: () => chart.redraw() });
const chart = createLatitudeChart(el("chart"), timeline.scale, seek);

let track: Track | null = null;
let ageMa = 0;
let placeLabel = "this location";
let trackAbort: AbortController | null = null;
let fossilAbort: AbortController | null = null;
let fossilTimer: number | undefined;

/* Theme ------------------------------------------------------------------- */

const THEMES = ["dark", "auto", "light"];
let theme = localStorage.getItem("wwmh-theme") ?? "auto";
if (!THEMES.includes(theme)) theme = "auto";

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  for (const btn of themeBtns) {
    btn.setAttribute("aria-checked", String(btn.dataset.set === theme));
    btn.tabIndex = btn.dataset.set === theme ? 0 : -1;
  }
}

for (const btn of themeBtns) {
  btn.addEventListener("click", () => {
    theme = btn.dataset.set ?? "auto";
    localStorage.setItem("wwmh-theme", theme);
    applyTheme();
  });
}

/** Arrow keys move through the group, as a radiogroup is expected to. */
themeGroup.addEventListener("keydown", (e) => {
  const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!delta) return;
  e.preventDefault();
  const next = THEMES[(THEMES.indexOf(theme) + delta + THEMES.length) % THEMES.length];
  theme = next;
  localStorage.setItem("wwmh-theme", theme);
  applyTheme();
  themeBtns.find((b) => b.dataset.set === theme)?.focus();
});

applyTheme();

/* Split ------------------------------------------------------------------- */

const splitEl = el("split");
const WIDE = "(min-width: 900px)";

/**
 * The globe takes a share of the screen the reader can change, so the readout
 * and the copyable prompt can be given more room on a phone. Stored as a
 * percentage so it survives a rotation or a different device.
 */
function applySplit(pct: number, wide: boolean) {
  const clamped = Math.min(85, Math.max(15, pct));
  if (wide) {
    document.documentElement.style.setProperty("--split-w", `${(100 - clamped).toFixed(2)}%`);
    localStorage.setItem("wwmh-split-w", String(clamped));
  } else {
    document.documentElement.style.setProperty("--split", `${clamped.toFixed(2)}%`);
    localStorage.setItem("wwmh-split", String(clamped));
  }
}

function restoreSplit() {
  const wide = window.matchMedia(WIDE).matches;
  const saved = Number(localStorage.getItem(wide ? "wwmh-split-w" : "wwmh-split"));
  if (Number.isFinite(saved) && saved > 0) applySplit(saved, wide);
}

restoreSplit();
window.matchMedia(WIDE).addEventListener("change", restoreSplit);

let splitting = false;
splitEl.addEventListener("pointerdown", (e) => {
  capture(splitEl, e);
  splitting = true;
  splitEl.dataset.drag = "1";
});
splitEl.addEventListener("pointermove", (e) => {
  if (!splitting) return;
  const wide = window.matchMedia(WIDE).matches;
  applySplit(wide ? (e.clientX / window.innerWidth) * 100 : (e.clientY / window.innerHeight) * 100, wide);
});
const endSplit = () => {
  splitting = false;
  delete splitEl.dataset.drag;
};
splitEl.addEventListener("pointerup", endSplit);
splitEl.addEventListener("pointercancel", endSplit);

splitEl.addEventListener("keydown", (e) => {
  const wide = window.matchMedia(WIDE).matches;
  const back = wide ? "ArrowLeft" : "ArrowUp";
  const fwd = wide ? "ArrowRight" : "ArrowDown";
  const delta = e.key === fwd ? 4 : e.key === back ? -4 : 0;
  if (!delta) return;
  e.preventDefault();
  const key = wide ? "wwmh-split-w" : "wwmh-split";
  const current = Number(localStorage.getItem(key)) || (wide ? 60 : 52);
  applySplit(current + delta, wide);
});

/* Map --------------------------------------------------------------------- */

/**
 * Clicking the globe descends onto that spot rather than jumping somewhere with
 * no way back: the stick moves with it, so the way home is always visible.
 */
function flyToPick(lat: number, lon: number) {
  if (!hasTiles || !track) return;
  // Region: close enough that the pick was worth making, far enough that the
  // surrounding coastline still says where on the plate you have landed.
  const value = Math.max(zoom.value(), valueForStep(3));
  zoom.setValue(value, true);
  applyZoom(value, false);
  mapView.setCenter(lat, lon);
}

const stick = el("zoomstick");
const mapEl = el("map");

/**
 * The stick is an altitude control: the top notch is the globe seen from
 * furthest away, and each notch down flies in a whole tile level, until the map
 * is at the finest zoom the elevation model supports. The screen never changes,
 * so the address, the timeline and the theme all stay put while you descend.
 */
const mapView = createMap(mapEl, {
  onZoom: (value) => {
    zoom.setValue(value, true);
    applyZoom(zoom.value(), false);
  },
});

const zoom = createZoomStick(stick, {
  notches: DETENTS,
  onChange: (value) => applyZoom(value, true),
});

function applyZoom(value: number, drivePosition: boolean) {
  const step = track ? positionAt(track.steps, ageMa) : null;
  const at = { lat: step?.lat ?? 0, lon: step?.lon ?? 0, ageMa };
  mapView.setValue(value, at);
  // The globe is exactly what the map is not yet, so the two share one fade.
  globeEl.style.opacity = String(1 - mapOpacity(value));
  if (drivePosition && step && mapView.isLive) mapView.setMarker(step.lat, step.lon);
}

const globeEl = el("globe");

/** Only offered when a tile bucket is configured, so a fork without one is unaffected. */
if (hasTiles) stick.hidden = false;

// Start explicitly at the globe rather than relying on the stylesheet alone,
// so the map layer is inert from the first frame.
applyZoom(0, false);

/* Status ------------------------------------------------------------------ */

let statusTimer: number | undefined;
function status(msg: string, sticky = false) {
  const target = app.dataset.phase === "ready" ? statusEl : introStatus;
  for (const node of [statusEl, introStatus]) {
    if (node !== target) {
      node.textContent = "";
      node.dataset.show = "0";
    }
  }
  target.textContent = msg;
  target.dataset.show = msg ? "1" : "0";
  window.clearTimeout(statusTimer);
  if (msg && !sticky) statusTimer = window.setTimeout(() => status(""), 2600);
}

function phase(next: "intro" | "loading" | "ready") {
  app.dataset.phase = next;
}

/* Render ------------------------------------------------------------------ */

function fmtAge(a: number): string {
  return a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
}

function seek(next: number) {
  ageMa = next;
  render();
}

function render() {
  if (!track) return;
  const period = periodAt(ageMa);
  const step = positionAt(track.steps, ageMa);

  ageBig.textContent = fmtAge(ageMa);
  periodName.textContent = period.name;
  periodDot.style.background = period.color;
  legendNow.textContent = `${fmtAge(ageMa)} Ma`;

  if (step) {
    const belt = beltFor(step.lat);
    latLine.textContent = `${Math.abs(step.lat).toFixed(1)}° ${step.lat >= 0 ? "N" : "S"} · ${belt}`;
    climateEl.textContent = belt;
    narrativeEl.textContent = describe(step, period.name);
  } else {
    latLine.textContent = "";
    climateEl.textContent = "";
    narrativeEl.textContent = "The model has no position for this ground at this age.";
  }

  globe.setAge(ageMa);
  chart.setAge(ageMa);
  timeline.setAge(ageMa);
  if (mapView.isLive) {
    mapView.setAge(ageMa);
    if (step) {
      mapView.setMarker(step.lat, step.lon);
      mapView.setCenter(step.lat, step.lon);
    }
  }
  scheduleFossils();
}

function scheduleFossils() {
  window.clearTimeout(fossilTimer);
  fossilTimer = window.setTimeout(loadFossils, 250);
}

async function loadFossils() {
  if (!track) return;
  fossilAbort?.abort();
  fossilAbort = new AbortController();
  const signal = fossilAbort.signal;
  const { lat, lon } = track.point;
  const span = Math.max(5, ageMa * 0.06);
  const maxMa = ageMa + span;
  const minMa = Math.max(0, ageMa - span);
  const at = ageMa;

  const [fossils, geology] = await Promise.all([
    fetchFossils(lat, lon, maxMa, minMa, signal).catch(() => null),
    fetchGeology(lat, lon, maxMa, minMa, signal).catch(() => null),
  ]);
  if (signal.aborted) return;

  if (fossils) renderFossils(fossilsEl, fossils, at);
  else fossilsEl.textContent = "";

  const step = positionAt(track.steps, at);
  renderPrompt(
    promptEl,
    step
      ? {
          step,
          periodName: periodAt(at).name,
          fossils: fossils?.records ?? [],
          geology,
          placeName: placeLabel,
        }
      : null,
  );
}

/* Search ------------------------------------------------------------------ */

async function show(place: GeoResult) {
  input.value = place.name;
  placeLabel = place.name;
  placeName.textContent = place.name;
  loadingPlace.textContent = place.name;
  suggestions.hidden = true;
  trackAbort?.abort();
  trackAbort = new AbortController();
  phase("loading");
  status("");
  try {
    track = await fetchTrack(place.lat, place.lon, trackAbort.signal);
    globe.setTrack(track);
    chart.setTrack(track);
    timeline.setTrack(track);
    ageMa = 0;
    phase("ready");
    render();
    history.replaceState(null, "", `?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}`);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    phase("intro");
    status((err as Error).message || "Reconstruction failed", true);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  status("Searching...", true);
  try {
    const { results } = await geocode(q);
    if (!results.length) return status("No match for that place");
    if (results.length === 1) return show(results[0]);
    suggestions.innerHTML = "";
    for (const r of results) {
      const li = document.createElement("li");
      li.textContent = r.name;
      li.addEventListener("click", () => show(r));
      suggestions.append(li);
    }
    suggestions.hidden = false;
    status("");
  } catch (err) {
    status((err as Error).message || "Search failed", true);
  }
});

el("locate").addEventListener("click", () => {
  if (!navigator.geolocation) return status("Location is not available");
  status("Locating...", true);
  navigator.geolocation.getCurrentPosition(
    (pos) =>
      show({
        name: "My location",
        lat: +pos.coords.latitude.toFixed(4),
        lon: +pos.coords.longitude.toFixed(4),
      }),
    () => status("Could not get your location"),
    { timeout: 10000 },
  );
});

el("change").addEventListener("click", () => {
  trackAbort?.abort();
  phase("intro");
  input.focus();
});

document.addEventListener("click", (e) => {
  if (!suggestions.contains(e.target as Node) && e.target !== input) suggestions.hidden = true;
});

/* Boot -------------------------------------------------------------------- */

const ticks = el("loading-ticks");
for (let i = 0; i < 65; i++) {
  const bar = document.createElement("i");
  bar.style.height = `${8 + ((i * 37) % 26)}px`;
  bar.style.animationDelay = `${(i * 17) % 1100}ms`;
  ticks.append(bar);
}

const params = new URLSearchParams(location.search);
const lat = Number(params.get("lat"));
const lon = Number(params.get("lon"));
if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) {
  show({ name: `${lat}, ${lon}`, lat, lon });
}
