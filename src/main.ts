import { fetchFossils, fetchGeology, fetchTrack, geocode } from "./api";
import { createLatitudeChart } from "./chart";
import { renderFossils } from "./fossils";
import { createGlobe } from "./globe";
import { beltFor, describe, periodAt } from "./narrative";
import { positionAt } from "./position";
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
const themeBtn = el<HTMLButtonElement>("theme");

const globe = createGlobe(el("globe"));
const timeline = createTimeline(el("timeline"), { onSeek: seek, onScale: () => chart.redraw() });
const chart = createLatitudeChart(el("chart"), timeline.scale, seek);

let track: Track | null = null;
let ageMa = 0;
let placeLabel = "this location";
let trackAbort: AbortController | null = null;
let fossilAbort: AbortController | null = null;
let fossilTimer: number | undefined;

/* Theme ------------------------------------------------------------------- */

let theme = localStorage.getItem("wwmh-theme") ?? "auto";

/** The button offers the theme you would switch to, not the one you are in. */
function isDark(): boolean {
  if (theme !== "auto") return theme === "dark";
  return !window.matchMedia("(prefers-color-scheme: light)").matches;
}

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const next = isDark() ? "Light" : "Dark";
  themeBtn.textContent = next;
  themeBtn.setAttribute("aria-label", `Switch to ${next.toLowerCase()} theme`);
}

applyTheme();

themeBtn.addEventListener("click", () => {
  theme = isDark() ? "light" : "dark";
  localStorage.setItem("wwmh-theme", theme);
  applyTheme();
});

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
