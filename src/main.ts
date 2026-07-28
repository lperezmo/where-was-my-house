import { fetchFossils, fetchGeology, fetchTrack, geocode } from "./api";
import { renderPrompt } from "./prompt";
import { createLatitudeChart, createScrubber } from "./chart";
import { createGlobe } from "./globe";
import { renderFossils } from "./fossils";
import { describe, periodAt } from "./narrative";
import type { GeoResult, Track, TrackStep } from "./types";
import "./style.css";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = el<HTMLFormElement>("search");
const input = el<HTMLInputElement>("q");
const suggestions = el<HTMLUListElement>("suggestions");
const statusEl = el<HTMLDivElement>("status");
const ageLabel = el<HTMLDivElement>("age-label");
const narrativeEl = el<HTMLParagraphElement>("narrative");
const fossilsEl = el<HTMLDivElement>("fossils");
const promptEl = el<HTMLDivElement>("prompt");

const globe = createGlobe(el("globe"));
const chart = createLatitudeChart(el("chart"), seek);
const scrubber = createScrubber(el("scrubber"), seek);

let track: Track | null = null;
let ageMa = 0;
let placeLabel = "this location";
let trackAbort: AbortController | null = null;
let fossilAbort: AbortController | null = null;
let fossilTimer: number | undefined;

let statusTimer: number | undefined;
function status(msg: string, sticky = false) {
  statusEl.textContent = msg;
  statusEl.dataset.show = msg ? "1" : "0";
  window.clearTimeout(statusTimer);
  if (msg && !sticky) statusTimer = window.setTimeout(() => status(""), 2600);
}

function stepAt(t: Track, age: number): TrackStep | null {
  let best: TrackStep | null = null;
  let bestDelta = Infinity;
  for (const s of t.steps) {
    const d = Math.abs(s.ageMa - age);
    if (d < bestDelta) {
      bestDelta = d;
      best = s;
    }
  }
  return best;
}

function seek(next: number) {
  ageMa = next;
  render();
}

function render() {
  if (!track) return;
  const period = periodAt(ageMa);
  const step = stepAt(track, ageMa);

  ageLabel.innerHTML = ageMa === 0
    ? `Today <span>${period.name}</span>`
    : `${ageMa} Ma <span>${period.name}</span>`;

  narrativeEl.textContent = step
    ? describe(step, period.name)
    : "The model has no position for this ground at this age.";

  globe.setAge(ageMa);
  chart.setAge(ageMa);
  scrubber.setAge(ageMa);
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

  const step = stepAt(track, at);
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

async function show(place: GeoResult) {
  input.value = place.name;
  placeLabel = place.name;
  suggestions.hidden = true;
  trackAbort?.abort();
  trackAbort = new AbortController();
  status("Reconstructing 540 million years...", true);
  try {
    track = await fetchTrack(place.lat, place.lon, trackAbort.signal);
    globe.setTrack(track);
    chart.setTrack(track);
    scrubber.setTrack(track);
    ageMa = 0;
    render();
    status("");
    history.replaceState(null, "", `?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}`);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
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

document.addEventListener("click", (e) => {
  if (!suggestions.contains(e.target as Node) && e.target !== input) suggestions.hidden = true;
});

const params = new URLSearchParams(location.search);
const lat = Number(params.get("lat"));
const lon = Number(params.get("lon"));
if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) {
  show({ name: `${lat}, ${lon}`, lat, lon });
}
