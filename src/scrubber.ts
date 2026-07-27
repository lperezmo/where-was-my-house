import { PERIODS, periodAt } from "./narrative";
import type { Period, Track, TrackStep } from "./types";
import "./chart.css";

export interface ScrubberHandle {
  setTrack(t: Track): void;
  setAge(a: number): void;
  destroy(): void;
}

const NS = "http://www.w3.org/2000/svg";
const MAX_AGE = 540;
const STRIP_H = 34;
const INSET = 9; // keeps the knob from clipping at either end
const HIT = 44;

let uid = 0;

const ABBREV: Record<string, string> = {
  quaternary: "Q",
  neogene: "Ng",
  paleogene: "Pg",
  cretaceous: "K",
  jurassic: "J",
  triassic: "Tr",
  permian: "P",
  carboniferous: "C",
  pennsylvanian: "Pn",
  mississippian: "Ms",
  devonian: "D",
  silurian: "S",
  ordovician: "O",
  cambrian: "Cm",
  ediacaran: "Ed",
  cryogenian: "Cr",
  neoproterozoic: "NP",
};

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

function abbrevOf(name: string): string {
  return ABBREV[name.trim().toLowerCase()] ?? name.slice(0, 2);
}

function textWidth(t: SVGTextElement): number {
  const measured = typeof t.getComputedTextLength === "function" ? t.getComputedTextLength() : 0;
  return measured || (t.textContent ?? "").length * 5.6;
}

export function createScrubber(
  container: HTMLElement,
  onSeek: (ageMa: number) => void,
): ScrubberHandle {
  const clipId = `pv-scrub-clip-${++uid}`;

  const root = document.createElement("div");
  root.className = "pv-scrub";
  root.tabIndex = 0;
  root.setAttribute("role", "slider");
  root.setAttribute("aria-label", "Geologic age");
  root.setAttribute("aria-orientation", "horizontal");
  root.setAttribute("aria-valuemin", "0");
  root.setAttribute("aria-valuemax", String(MAX_AGE));

  const strip = document.createElement("div");
  strip.className = "pv-scrub-strip";

  const hit = document.createElement("div");
  hit.className = "pv-scrub-hit";
  hit.setAttribute("aria-hidden", "true");

  const ends = document.createElement("div");
  ends.className = "pv-scrub-ends";
  const oldest = document.createElement("span");
  oldest.textContent = "540 Ma";
  const youngest = document.createElement("span");
  youngest.textContent = "Today";
  ends.append(oldest, youngest);

  strip.append(hit);
  root.append(strip, ends);
  container.append(root);

  let ages: number[] = [];
  let ageMa = 0;
  let width = 0;
  let span = 0;
  let dragging = false;
  let raf = 0;
  let knob: SVGGElement | null = null;

  const clampAge = (a: number) => Math.min(MAX_AGE, Math.max(0, a));
  // Same orientation as the latitude chart: 540 Ma at the left, today at the right.
  const xOf = (age: number) => INSET + ((MAX_AGE - clampAge(age)) / MAX_AGE) * span;

  function snapAge(raw: number): number {
    if (!ages.length) return clampAge(raw);
    let best = ages[0];
    let bestDelta = Infinity;
    for (const a of ages) {
      const d = Math.abs(a - raw);
      if (d < bestDelta) {
        bestDelta = d;
        best = a;
      }
    }
    return best;
  }

  function bands(): Period[] {
    const list = Array.isArray(PERIODS) ? PERIODS : [];
    return list.filter((p) => Math.min(p.startMa, p.endMa) < MAX_AGE);
  }

  function drawStrip() {
    const w = Math.round(strip.clientWidth);
    if (w <= 0) return;
    width = w;
    span = Math.max(1, width - INSET * 2);

    const svg = svgEl("svg", {
      class: "pv-scrub-svg",
      viewBox: `0 0 ${width} ${STRIP_H}`,
      width,
      height: STRIP_H,
      "aria-hidden": "true",
    });

    const defs = svgEl("defs");
    const clip = svgEl("clipPath", { id: clipId });
    clip.append(svgEl("rect", { x: INSET, y: 0, width: span, height: STRIP_H, rx: 5 }));
    defs.append(clip);
    svg.append(defs);

    const group = svgEl("g", { "clip-path": `url(#${clipId})` });
    group.append(
      svgEl("rect", { class: "pv-scrub-bg", x: INSET, y: 0, width: span, height: STRIP_H }),
    );

    const labels: Array<{ el: SVGTextElement; full: string; room: number }> = [];
    for (const p of bands()) {
      const lo = Math.max(0, Math.min(p.startMa, p.endMa));
      const hi = Math.min(MAX_AGE, Math.max(p.startMa, p.endMa));
      if (hi <= lo) continue;
      const x = xOf(hi);
      const bandW = xOf(lo) - x;
      group.append(
        svgEl("rect", {
          class: "pv-scrub-band",
          x: x.toFixed(2),
          y: 0,
          width: Math.max(0.5, bandW).toFixed(2),
          height: STRIP_H,
          fill: p.color,
        }),
      );
      const label = svgEl("text", {
        class: "pv-scrub-band-label",
        x: (x + bandW / 2).toFixed(2),
        y: STRIP_H / 2,
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      label.textContent = p.name;
      group.append(label);
      labels.push({ el: label, full: p.name, room: bandW });
    }

    svg.append(group);

    knob = svgEl("g", { class: "pv-scrub-knob" });
    knob.append(svgEl("rect", { class: "pv-knob-halo", x: -3.5, y: 0, width: 7, height: STRIP_H, rx: 3.5 }));
    knob.append(svgEl("rect", { class: "pv-knob-bar", x: -1.5, y: 0, width: 3, height: STRIP_H, rx: 1.5 }));
    knob.append(svgEl("circle", { class: "pv-knob-dot", cx: 0, cy: STRIP_H / 2, r: 6 }));
    svg.append(knob);

    strip.replaceChildren(svg, hit);

    // Measure only once the nodes are live, then downgrade or drop what will not fit.
    for (const l of labels) {
      if (textWidth(l.el) + 8 <= l.room) continue;
      l.el.textContent = abbrevOf(l.full);
      if (textWidth(l.el) + 4 > l.room) l.el.remove();
    }

    place();
  }

  function place() {
    if (!knob) return;
    const x = xOf(ageMa);
    knob.setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
    hit.style.transform = `translateX(${Math.max(0, Math.min(width - HIT, x - HIT / 2)).toFixed(1)}px)`;
  }

  function describeAge(): string {
    let name = "";
    try {
      name = periodAt(ageMa)?.name ?? "";
    } catch {
      name = "";
    }
    const age = ageMa === 0 ? "Today" : `${ageMa} Ma`;
    return name ? `${age}, ${name}` : age;
  }

  function syncAria() {
    root.setAttribute("aria-valuenow", String(ageMa));
    root.setAttribute("aria-valuetext", describeAge());
    root.setAttribute("aria-disabled", ages.length ? "false" : "true");
    root.dataset.empty = ages.length ? "0" : "1";
  }

  function apply(next: number) {
    if (next === ageMa) return;
    ageMa = next;
    place();
    syncAria();
    onSeek(next);
  }

  function seekFrom(e: PointerEvent) {
    if (!ages.length || span <= 0) return;
    const r = strip.getBoundingClientRect();
    const t = (e.clientX - r.left - INSET) / span;
    apply(snapAge(MAX_AGE * (1 - Math.min(1, Math.max(0, t)))));
  }

  function onDown(e: PointerEvent) {
    if (!ages.length) return;
    dragging = true;
    try {
      strip.setPointerCapture(e.pointerId);
    } catch {
      // a pointer that is already gone cannot be captured; the tap still seeks
    }
    e.preventDefault();
    root.focus({ preventScroll: true });
    seekFrom(e);
  }

  function onMove(e: PointerEvent) {
    if (dragging) seekFrom(e);
  }

  function onUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (strip.hasPointerCapture(e.pointerId)) strip.releasePointerCapture(e.pointerId);
  }

  // Arrow keys are spatial: the timeline runs oldest to youngest, left to right.
  function onKey(e: KeyboardEvent) {
    if (!ages.length) return;
    const i = ages.indexOf(ageMa);
    const at = i >= 0 ? i : ages.indexOf(snapAge(ageMa));
    let next = at;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = at + 1;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = at - 1;
        break;
      case "PageUp":
        next = at - 5;
        break;
      case "PageDown":
        next = at + 5;
        break;
      case "Home":
        next = ages.length - 1;
        break;
      case "End":
        next = 0;
        break;
      default:
        return;
    }
    e.preventDefault();
    apply(ages[Math.max(0, Math.min(ages.length - 1, next))]);
  }

  strip.addEventListener("pointerdown", onDown);
  strip.addEventListener("pointermove", onMove);
  strip.addEventListener("pointerup", onUp);
  strip.addEventListener("pointercancel", onUp);
  root.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      drawStrip();
    });
  });
  ro.observe(container);

  drawStrip();
  syncAria();

  return {
    setTrack(t: Track) {
      const list: TrackStep[] = Array.isArray(t?.steps) ? t.steps : [];
      // Ascending ages; index 0 is today, the last index is the oldest step.
      ages = [...new Set(list.map((s) => s.ageMa))].sort((a, b) => a - b);
      if (ages.length) ageMa = snapAge(ageMa);
      place();
      syncAria();
    },
    setAge(a: number) {
      ageMa = clampAge(a);
      place();
      syncAria();
    },
    destroy() {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      strip.removeEventListener("pointerdown", onDown);
      strip.removeEventListener("pointermove", onMove);
      strip.removeEventListener("pointerup", onUp);
      strip.removeEventListener("pointercancel", onUp);
      root.removeEventListener("keydown", onKey);
      root.remove();
      knob = null;
      ages = [];
    },
  };
}
