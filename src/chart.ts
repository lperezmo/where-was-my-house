import type { Track, TrackStep } from "./types";
import "./chart.css";

// main.ts imports createScrubber from "./chart", so it is re-exported here.
export { createScrubber } from "./scrubber";
export type { ScrubberHandle } from "./scrubber";

export interface ChartHandle {
  setTrack(t: Track): void;
  setAge(a: number): void;
  destroy(): void;
}

const NS = "http://www.w3.org/2000/svg";
const MAX_AGE = 540;
const PAD = { l: 27, r: 10, t: 10, b: 18 };
const DEG = "°";

interface Belt {
  label: string;
  from: number;
  to: number;
  cls: string;
}

const BELTS: Belt[] = [
  { label: "Tropical", from: 0, to: 23.5, cls: "tropical" },
  { label: "Subtropical", from: 23.5, to: 35, cls: "subtropical" },
  { label: "Temperate", from: 35, to: 55, cls: "temperate" },
  { label: "Subpolar", from: 55, to: 66.5, cls: "subpolar" },
  { label: "Polar", from: 66.5, to: 90, cls: "polar" },
];

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  }
  return node;
}

function sortedSteps(t: Track | null): TrackStep[] {
  if (!t || !Array.isArray(t.steps)) return [];
  return [...t.steps].sort((a, b) => a.ageMa - b.ageMa);
}

function nearest(steps: TrackStep[], age: number): TrackStep | null {
  let best: TrackStep | null = null;
  let bestDelta = Infinity;
  for (const s of steps) {
    const d = Math.abs(s.ageMa - age);
    if (d < bestDelta) {
      bestDelta = d;
      best = s;
    }
  }
  return best;
}

function latLabel(lat: number): string {
  const v = Math.abs(lat) < 0.05 ? 0 : lat;
  return `${Math.abs(v).toFixed(1)}${DEG}${v >= 0 ? "N" : "S"}`;
}

export function createLatitudeChart(
  container: HTMLElement,
  onSeek: (ageMa: number) => void,
): ChartHandle {
  const root = document.createElement("div");
  root.className = "pv-chart";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Paleolatitude over the last 540 million years");
  container.append(root);

  let track: Track | null = null;
  let steps: TrackStep[] = [];
  let ageMa = 0;
  let width = 0;
  let height = 0;
  let plotW = 0;
  let plotH = 0;
  let dragging = false;
  let raf = 0;

  let cursor: SVGGElement | null = null;
  let cursorDot: SVGCircleElement | null = null;
  let cursorText: SVGTextElement | null = null;

  const clampAge = (a: number) => Math.min(MAX_AGE, Math.max(0, a));
  // Deep time on the left: 540 Ma maps to the plot origin, today to the right edge.
  const xOf = (age: number) => PAD.l + ((MAX_AGE - clampAge(age)) / MAX_AGE) * plotW;
  const yOf = (lat: number) => PAD.t + ((90 - lat) / 180) * plotH;

  function snapAge(raw: number): number {
    const s = nearest(steps, raw);
    return s ? s.ageMa : clampAge(raw);
  }

  // Ages are unevenly spaced (5 Myr to 100 Ma, then 10 Myr), so a break is only
  // real when the model failed to place the point, not when the spacing widens.
  function isBreak(prev: TrackStep, next: TrackStep, missing: number[]): boolean {
    if (next.ageMa - prev.ageMa > 25) return true;
    for (const m of missing) {
      if (m > prev.ageMa && m < next.ageMa) return true;
    }
    return false;
  }

  function segments(): TrackStep[][] {
    const missing = Array.isArray(track?.missing) ? [...track.missing].sort((a, b) => a - b) : [];
    const out: TrackStep[][] = [];
    let run: TrackStep[] = [];
    for (let i = 0; i < steps.length; i++) {
      if (i > 0 && isBreak(steps[i - 1], steps[i], missing)) {
        out.push(run);
        run = [];
      }
      run.push(steps[i]);
    }
    if (run.length) out.push(run);
    return out;
  }

  function drawBelts(svg: SVGSVGElement) {
    for (const b of BELTS) {
      for (const north of [true, false]) {
        const top = yOf(north ? b.to : -b.from);
        const bottom = yOf(north ? b.from : -b.to);
        svg.append(
          svgEl("rect", {
            class: `pv-belt pv-belt-${b.cls}`,
            x: PAD.l,
            y: top.toFixed(2),
            width: plotW,
            height: Math.max(0, bottom - top).toFixed(2),
          }),
        );
      }
      const bandH = ((b.to - b.from) / 180) * plotH;
      if (bandH >= 12 && plotW >= 230) {
        const t = svgEl("text", {
          class: "pv-belt-label",
          x: PAD.l + 5,
          y: ((yOf(b.to) + yOf(b.from)) / 2).toFixed(2),
          "dominant-baseline": "middle",
        });
        t.textContent = b.label;
        svg.append(t);
      }
    }
  }

  function drawAxes(svg: SVGSVGElement) {
    for (const lat of [60, 30, 0, -30, -60]) {
      const y = yOf(lat).toFixed(2);
      svg.append(
        svgEl("line", {
          class: lat === 0 ? "pv-equator" : "pv-grid",
          x1: PAD.l,
          x2: PAD.l + plotW,
          y1: y,
          y2: y,
        }),
      );
      const label = svgEl("text", {
        class: "pv-tick",
        x: PAD.l - 5,
        y,
        "text-anchor": "end",
        "dominant-baseline": "middle",
      });
      label.textContent = lat === 0 ? "EQ" : `${Math.abs(lat)}${lat > 0 ? "N" : "S"}`;
      if (lat === 0) label.setAttribute("class", "pv-tick pv-tick-eq");
      svg.append(label);
    }

    const stride = plotW >= 250 ? 100 : 200;
    for (let age = Math.floor(MAX_AGE / stride) * stride; age >= 0; age -= stride) {
      const x = xOf(age);
      svg.append(
        svgEl("line", {
          class: "pv-grid",
          x1: x.toFixed(2),
          x2: x.toFixed(2),
          y1: PAD.t,
          y2: PAD.t + plotH,
        }),
      );
      const t = svgEl("text", {
        class: "pv-tick",
        x: x.toFixed(2),
        y: height - 5,
        "text-anchor": age === 0 ? "end" : "middle",
      });
      t.textContent = String(age);
      svg.append(t);
    }

    const unit = svgEl("text", { class: "pv-tick", x: 1, y: height - 5 });
    unit.textContent = "Ma";
    svg.append(unit);

    svg.append(
      svgEl("rect", {
        class: "pv-frame",
        x: PAD.l,
        y: PAD.t,
        width: plotW,
        height: plotH,
      }),
    );
  }

  function drawLine(svg: SVGSVGElement) {
    for (const seg of segments()) {
      if (seg.length === 1) {
        svg.append(
          svgEl("circle", {
            class: "pv-point",
            cx: xOf(seg[0].ageMa).toFixed(2),
            cy: yOf(seg[0].lat).toFixed(2),
            r: 2,
          }),
        );
        continue;
      }
      const d = seg
        .map((s, i) => `${i ? "L" : "M"}${xOf(s.ageMa).toFixed(2)} ${yOf(s.lat).toFixed(2)}`)
        .join(" ");
      svg.append(svgEl("path", { class: "pv-path", d }));
    }
  }

  function drawCursor(svg: SVGSVGElement) {
    cursor = svgEl("g", { class: "pv-cursor" });
    cursor.append(
      svgEl("line", { class: "pv-cursor-line", x1: 0, x2: 0, y1: PAD.t, y2: PAD.t + plotH }),
    );
    cursorDot = svgEl("circle", { class: "pv-cursor-dot", cx: 0, cy: yOf(0), r: 4.5 });
    cursor.append(cursorDot);
    cursorText = svgEl("text", { class: "pv-cursor-label", x: 7, y: yOf(0) });
    cursor.append(cursorText);
    svg.append(cursor);
  }

  function drawEmpty(svg: SVGSVGElement) {
    const t = svgEl("text", {
      class: "pv-empty",
      x: (PAD.l + plotW / 2).toFixed(2),
      y: (PAD.t + plotH * 0.34).toFixed(2),
      "text-anchor": "middle",
      "dominant-baseline": "middle",
    });
    t.textContent = track ? "No positions in this model" : "Search a place to plot its drift";
    svg.append(t);
  }

  function render() {
    const w = Math.round(root.clientWidth);
    if (w <= 0) return;
    width = w;
    height = Math.round(Math.min(210, Math.max(148, w * 0.48)));
    plotW = width - PAD.l - PAD.r;
    plotH = height - PAD.t - PAD.b;
    if (plotW <= 0 || plotH <= 0) return;

    const svg = svgEl("svg", {
      class: "pv-chart-svg",
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      "aria-hidden": "true",
    });

    drawBelts(svg);
    drawAxes(svg);
    if (steps.length) drawLine(svg);
    else drawEmpty(svg);
    drawCursor(svg);

    root.dataset.empty = steps.length ? "0" : "1";
    root.replaceChildren(svg);
    updateCursor();
  }

  function updateCursor() {
    if (!cursor || !cursorDot || !cursorText) return;
    cursor.setAttribute("transform", `translate(${xOf(ageMa).toFixed(2)} 0)`);
    cursor.setAttribute("opacity", steps.length ? "1" : "0");
    const s = nearest(steps, ageMa);
    if (!s) {
      cursorDot.setAttribute("opacity", "0");
      cursorText.setAttribute("opacity", "0");
      return;
    }
    const y = yOf(s.lat);
    cursorDot.setAttribute("opacity", "1");
    cursorDot.setAttribute("cy", y.toFixed(2));
    const flip = xOf(ageMa) > PAD.l + plotW * 0.72;
    cursorText.setAttribute("opacity", "1");
    cursorText.setAttribute("x", flip ? "-7" : "7");
    cursorText.setAttribute("text-anchor", flip ? "end" : "start");
    cursorText.setAttribute("y", Math.max(PAD.t + 10, Math.min(PAD.t + plotH - 4, y - 9)).toFixed(2));
    cursorText.textContent = latLabel(s.lat);
  }

  function seekFrom(e: PointerEvent) {
    if (!steps.length || plotW <= 0) return;
    const r = root.getBoundingClientRect();
    const t = (e.clientX - r.left - PAD.l) / plotW;
    const raw = MAX_AGE * (1 - Math.min(1, Math.max(0, t)));
    const next = snapAge(raw);
    if (next === ageMa) return;
    ageMa = next;
    updateCursor();
    onSeek(next);
  }

  function onDown(e: PointerEvent) {
    if (!steps.length) return;
    dragging = true;
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // a pointer that is already gone cannot be captured; the tap still seeks
    }
    e.preventDefault();
    seekFrom(e);
  }

  function onMove(e: PointerEvent) {
    if (dragging) seekFrom(e);
  }

  function onUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  }

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);

  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  });
  ro.observe(container);

  render();

  return {
    setTrack(t: Track) {
      track = t;
      steps = sortedSteps(t);
      render();
    },
    setAge(a: number) {
      ageMa = clampAge(a);
      updateCursor();
    },
    destroy() {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.remove();
      cursor = null;
      cursorDot = null;
      cursorText = null;
    },
  };
}
