import { PERIODS } from "./periods";
import type { Period, Track } from "./types";
import "./timeline.css";

const TOTAL = 538.8;

/** Oldest first, so the strip reads left to right as deep time to today. */
const P = [...PERIODS].reverse();

const ABBR: Record<string, string> = {
  Cambrian: "Cm",
  Ordovician: "O",
  Silurian: "S",
  Devonian: "D",
  Carboniferous: "C",
  Permian: "P",
  Triassic: "Tr",
  Jurassic: "J",
  Cretaceous: "K",
  Paleogene: "Pg",
  Neogene: "N",
  Quaternary: "Q",
};

/** base, top. Used only to pick the middle zoom level. */
const ERAS: [string, number, number][] = [
  ["Paleozoic", 538.8, 251.902],
  ["Mesozoic", 251.902, 66],
  ["Cenozoic", 66, 0],
];

/** Epochs and series, ICS v2026/06. name, base, top. */
const SUBDIV: Record<string, [string, number, number][]> = {
  Cambrian: [
    ["Terreneuvian", 538.8, 521],
    ["Series 2", 521, 506.5],
    ["Miaolingian", 506.5, 497],
    ["Furongian", 497, 486.85],
  ],
  Ordovician: [
    ["Early", 486.85, 470],
    ["Middle", 470, 458.2],
    ["Late", 458.2, 443.1],
  ],
  Silurian: [
    ["Llandovery", 443.1, 433.4],
    ["Wenlock", 433.4, 427.4],
    ["Ludlow", 427.4, 423],
    ["Pridoli", 423, 419.62],
  ],
  Devonian: [
    ["Early", 419.62, 393.3],
    ["Middle", 393.3, 382.7],
    ["Late", 382.7, 358.86],
  ],
  Carboniferous: [
    ["Mississippian", 358.86, 323.4],
    ["Pennsylvanian", 323.4, 298.9],
  ],
  Permian: [
    ["Cisuralian", 298.9, 273],
    ["Guadalupian", 273, 259.5],
    ["Lopingian", 259.5, 251.902],
  ],
  Triassic: [
    ["Early", 251.902, 247.2],
    ["Middle", 247.2, 237],
    ["Late", 237, 201.4],
  ],
  Jurassic: [
    ["Early", 201.4, 174.7],
    ["Middle", 174.7, 161.5],
    ["Late", 161.5, 143.1],
  ],
  Cretaceous: [
    ["Early", 143.1, 100.5],
    ["Late", 100.5, 66],
  ],
  Paleogene: [
    ["Paleocene", 66, 56],
    ["Eocene", 56, 33.9],
    ["Oligocene", 33.9, 23.04],
  ],
  Neogene: [
    ["Miocene", 23.04, 5.333],
    ["Pliocene", 5.333, 2.58],
  ],
  Quaternary: [
    ["Pleistocene", 2.58, 0.0117],
    ["Holocene", 0.0117, 0],
  ],
};

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function tint(hex: string, amt: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const m = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function textOn(hex: string, amt: number): string {
  const r = parseInt(hex.slice(1, 3), 16) + (255 - parseInt(hex.slice(1, 3), 16)) * amt;
  const g = parseInt(hex.slice(3, 5), 16) + (255 - parseInt(hex.slice(3, 5), 16)) * amt;
  const b = parseInt(hex.slice(5, 7), 16) + (255 - parseInt(hex.slice(5, 7), 16)) * amt;
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#12161d" : "#f2f6fb";
}

const TC = P.map((p) => (luminance(p.color) > 150 ? "#12161d" : "#f2f6fb"));

/**
 * On a linear axis the Quaternary is 0.5% of the strip and unhittable, so the
 * default scale is compressed by square root and every period is given a 4.5%
 * floor. Zooming blends this toward a true linear axis inside the window.
 */
const SEGS = (() => {
  const raw = P.map((p) => Math.sqrt((p.startMa - p.endMa) / TOTAL));
  const sum = raw.reduce((a, b) => a + b, 0);
  let fr = raw.map((v) => v / sum).map((v) => Math.max(0.045, v));
  const s2 = fr.reduce((a, b) => a + b, 0);
  fr = fr.map((v) => v / s2);
  let left = 0;
  return fr.map((w) => {
    const seg = { left, w };
    left += w;
    return seg;
  });
})();

function compFrac(age: number): number {
  for (let i = 0; i < P.length; i++) {
    if (age <= P[i].startMa && (age > P[i].endMa || i === P.length - 1)) {
      return SEGS[i].left + SEGS[i].w * ((P[i].startMa - age) / (P[i].startMa - P[i].endMa));
    }
  }
  return 0;
}

function compFracToAge(fr: number): number {
  for (let i = 0; i < P.length; i++) {
    if (fr <= SEGS[i].left + SEGS[i].w || i === P.length - 1) {
      const t = Math.min(1, Math.max(0, (fr - SEGS[i].left) / SEGS[i].w));
      return P[i].startMa - t * (P[i].startMa - P[i].endMa);
    }
  }
  return 0;
}

export interface TimeScale {
  ageToFrac(age: number): number;
  fracToAge(frac: number): number;
}

export interface TimelineHandle {
  scale: TimeScale;
  setAge(age: number): void;
  setTrack(track: Track | null): void;
  destroy(): void;
}

export interface TimelineOptions {
  /** Fired when the user scrubs to a new age. */
  onSeek(age: number): void;
  /** Fired whenever the zoom window moves, so dependent axes can redraw. */
  onScale(): void;
}

function fmtAge(a: number): string {
  return a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

export function createTimeline(container: HTMLElement, opts: TimelineOptions): TimelineHandle {
  container.innerHTML = `
    <div class="tl-wrap">
      <div class="tl-bubble"><i></i><span></span></div>
      <div class="tl-ov"><div class="tl-ov-bar"><div class="tl-ov-segs"></div><div class="tl-ov-win"></div></div></div>
      <div class="tl-track" tabindex="0" role="slider" aria-label="Age" aria-valuemin="0" aria-valuemax="538.8" aria-valuenow="0">
        <div class="tl-periods"></div>
        <div class="tl-subs"></div>
        <div class="tl-thumb"><i class="tl-thumb-line"></i><i class="tl-thumb-knob"></i></div>
      </div>
      <div class="tl-recon"></div>
    </div>
    <div class="tl-axis"></div>
    <div class="tl-note"></div>
    <div class="tl-zoom">
      <button class="tl-out" type="button"></button>
      <button class="tl-in" type="button"></button>
    </div>`;

  const q = <T extends HTMLElement>(sel: string) => container.querySelector(sel) as T;
  const wrap = q(".tl-wrap");
  const bubble = q(".tl-bubble");
  const bubbleDot = q(".tl-bubble i");
  const bubbleText = q(".tl-bubble span");
  const ov = q(".tl-ov");
  const ovSegs = q(".tl-ov-segs");
  const ovWin = q<HTMLElement>(".tl-ov-win");
  const trackEl = q(".tl-track");
  const periodsEl = q(".tl-periods");
  const subsEl = q(".tl-subs");
  const thumb = q(".tl-thumb");
  const knob = q(".tl-thumb-knob");
  const reconEl = q(".tl-recon");
  const axisEl = q(".tl-axis");
  const noteEl = q(".tl-note");
  const zoomIn = q<HTMLButtonElement>(".tl-in");
  const zoomOut = q<HTMLButtonElement>(".tl-out");

  const view = { lo: 0, hi: TOTAL, mix: 0 };
  const target = { lo: 0, hi: TOTAL, mix: 0 };
  let level = 0;
  let age = 0;
  let track: Track | null = null;
  let dragging = false;
  let panning = false;
  let raf = 0;
  let dead = false;

  function ageToFrac(a: number): number {
    if (view.mix < 0.001) return compFrac(a);
    const lin = (view.hi - a) / Math.max(0.001, view.hi - view.lo);
    return compFrac(a) * (1 - view.mix) + lin * view.mix;
  }

  function fracToAge(fr: number): number {
    if (view.mix < 0.001) return compFracToAge(fr);
    let lo = 0;
    let hi = TOTAL;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      if (ageToFrac(mid) < fr) hi = mid;
      else lo = mid;
    }
    return Math.max(0, Math.min(TOTAL, (lo + hi) / 2));
  }

  const scale: TimeScale = { ageToFrac, fracToAge };

  function periodAt(a: number): Period {
    for (let i = 0; i < P.length; i++) {
      if (a <= P[i].startMa && (a > P[i].endMa || i === P.length - 1)) return P[i];
    }
    return P[0];
  }

  function eraAt(a: number) {
    return ERAS.find((e) => a <= e[1] && a >= e[2]) ?? ERAS[0];
  }

  function setWindow(lo: number, hi: number, next: number) {
    const pad = (hi - lo) * 0.035;
    target.lo = Math.max(0, lo - pad);
    target.hi = Math.min(TOTAL, hi + pad);
    target.mix = next > 0 ? 1 : 0;
    level = next;
    animate();
  }

  function doZoomIn() {
    if (level === 0) {
      const e = eraAt(age);
      setWindow(e[2], e[1], 1);
    } else if (level === 1) {
      const p = periodAt(age);
      setWindow(p.endMa, p.startMa, 2);
    } else {
      target.lo = 0;
      target.hi = TOTAL;
      target.mix = 0;
      level = 0;
      animate();
    }
  }

  function doZoomOut() {
    if (level === 2) {
      const e = eraAt(age);
      setWindow(e[2], e[1], 1);
    } else {
      target.lo = 0;
      target.hi = TOTAL;
      target.mix = 0;
      level = 0;
      animate();
    }
  }

  /**
   * The level and its labels change the moment the button is pressed, so the
   * first paint is synchronous and only the window easing waits for a frame.
   */
  function animate() {
    render();
    if (raf || dead) return;
    const step = () => {
      raf = 0;
      const near =
        Math.abs(target.lo - view.lo) < 0.02 &&
        Math.abs(target.hi - view.hi) < 0.02 &&
        Math.abs(target.mix - view.mix) < 0.002;
      if (near) {
        view.lo = target.lo;
        view.hi = target.hi;
        view.mix = target.mix;
        render();
        opts.onScale();
        return;
      }
      view.lo += (target.lo - view.lo) * 0.16;
      view.hi += (target.hi - view.hi) * 0.16;
      view.mix += (target.mix - view.mix) * 0.16;
      render();
      opts.onScale();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function seek(e: PointerEvent) {
    const r = trackEl.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (level > 0) {
      const span = target.hi - target.lo;
      if (f < 0.08 && target.hi < TOTAL) {
        const d = Math.min(span * 0.045, TOTAL - target.hi);
        target.hi += d;
        target.lo += d;
        animate();
      } else if (f > 0.92 && target.lo > 0) {
        const d = Math.min(span * 0.045, target.lo);
        target.hi -= d;
        target.lo -= d;
        animate();
      }
    }
    opts.onSeek(fracToAge(f));
  }

  function pan(e: PointerEvent) {
    if (level === 0) return;
    const r = ov.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const c = compFracToAge(f);
    const span = target.hi - target.lo;
    target.lo = Math.max(0, Math.min(TOTAL - span, c - span / 2));
    target.hi = target.lo + span;
    animate();
  }

  trackEl.addEventListener("pointerdown", (e) => {
    trackEl.setPointerCapture(e.pointerId);
    dragging = true;
    wrap.dataset.drag = "1";
    seek(e);
  });
  trackEl.addEventListener("pointermove", (e) => dragging && seek(e));
  const endDrag = () => {
    dragging = false;
    delete wrap.dataset.drag;
  };
  trackEl.addEventListener("pointerup", endDrag);
  trackEl.addEventListener("pointercancel", endDrag);

  trackEl.addEventListener("keydown", (e) => {
    const stepSize = e.shiftKey ? 0.04 : 0.008;
    const f = ageToFrac(age);
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      opts.onSeek(fracToAge(Math.max(0, f - stepSize)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      opts.onSeek(fracToAge(Math.min(1, f + stepSize)));
    }
  });

  ov.addEventListener("pointerdown", (e) => {
    if (level === 0) return;
    ov.setPointerCapture(e.pointerId);
    panning = true;
    pan(e);
  });
  ov.addEventListener("pointermove", (e) => panning && pan(e));
  const endPan = () => (panning = false);
  ov.addEventListener("pointerup", endPan);
  ov.addEventListener("pointercancel", endPan);

  zoomIn.addEventListener("click", doZoomIn);
  zoomOut.addEventListener("click", doZoomOut);

  function render() {
    const per = periodAt(age);
    const frac = ageToFrac(age);
    const mix = view.mix;

    const seg: string[] = [];
    P.forEach((p, i) => {
      const L = Math.max(0, ageToFrac(p.startMa));
      const R = Math.min(1, ageToFrac(p.endMa));
      if (R - L < 0.002) return;
      const on = p === per;
      seg.push(
        `<div class="tl-seg" style="left:${pct(L)};width:${pct(R - L)};background:${p.color};opacity:${
          on ? 1 : 0.42
        };box-shadow:${on ? "inset 0 0 0 2px var(--edge)" : "none"}">` +
          `<span style="color:${TC[i]};opacity:${on ? 1 : 0.75}">${
            R - L > 0.15 ? p.name : ABBR[p.name]
          }</span></div>`,
      );
    });

    /**
     * A plate does not exist for all of the Phanerozoic, so a track can stop
     * well short of 540 Ma. The span with no reconstruction is marked rather
     * than left looking scrubbable but silent.
     */
    if (track?.steps.length) {
      const oldest = track.steps[track.steps.length - 1].ageMa;
      const edge = ageToFrac(oldest);
      if (oldest < TOTAL - 1 && edge > 0.002) {
        seg.push(`<div class="tl-void" style="width:${pct(Math.min(1, edge))}"></div>`);
      }
    }
    periodsEl.innerHTML = seg.join("");

    if (mix > 0.02) {
      const sub: string[] = [];
      P.forEach((p) => {
        (SUBDIV[p.name] ?? []).forEach((s, i) => {
          const L = Math.max(0, ageToFrac(s[1]));
          const R = Math.min(1, ageToFrac(s[2]));
          if (R - L < 0.004) return;
          const amt = 0.1 + (i % 4) * 0.13;
          sub.push(
            `<div class="tl-sub" style="left:${pct(L)};width:${pct(R - L)};background:${tint(
              p.color,
              amt,
            )};color:${textOn(p.color, amt)}">${R - L > 0.09 ? s[0] : ""}</div>`,
          );
        });
      });
      subsEl.innerHTML = sub.join("");
    } else if (subsEl.childElementCount) {
      subsEl.innerHTML = "";
    }

    let inView = 0;
    if (mix > 0.02 && track) {
      const marks: string[] = [];
      for (const s of track.steps) {
        const f = ageToFrac(s.ageMa);
        if (f < -0.01 || f > 1.01) continue;
        if (s.ageMa <= view.hi && s.ageMa >= view.lo) inView++;
        const major = s.ageMa % 50 === 0;
        marks.push(
          `<i style="left:${pct(Math.max(0, Math.min(1, f)))};height:${major ? 9 : 5}px;opacity:${
            major ? 0.85 : 0.45
          }"></i>`,
        );
      }
      reconEl.innerHTML = marks.join("");
    } else if (reconEl.childElementCount) {
      reconEl.innerHTML = "";
    }

    if (!ovSegs.childElementCount) {
      ovSegs.innerHTML = P.map(
        (p, i) =>
          `<i style="left:${pct(SEGS[i].left)};width:${pct(SEGS[i].w)};background:${p.color}"></i>`,
      ).join("");
    }
    const ovL = compFrac(view.hi);
    const ovR = compFrac(view.lo);
    ovWin.style.left = pct(ovL);
    ovWin.style.width = pct(Math.max(0.004, ovR - ovL));

    ov.style.height = `${(mix * 16).toFixed(1)}px`;
    ov.style.marginBottom = `${(mix * 8).toFixed(1)}px`;
    ov.style.opacity = Math.min(1, mix * 1.6).toFixed(2);
    subsEl.style.height = `${(mix * 18).toFixed(1)}px`;
    subsEl.style.marginTop = `${(mix * 2).toFixed(1)}px`;
    reconEl.style.height = `${(mix * 11).toFixed(1)}px`;

    const detail = Math.min(1, Math.max(0, (mix - 0.3) * 2));
    reconEl.style.opacity = detail.toFixed(2);
    noteEl.style.opacity = detail.toFixed(2);
    noteEl.style.height = `${(mix * 16).toFixed(1)}px`;

    thumb.style.left = pct(frac);
    knob.style.width = knob.style.height = dragging ? "26px" : "20px";
    knob.style.borderWidth = dragging ? "4px" : "3px";

    bubble.style.left = frac < 0.2 ? "0%" : frac > 0.8 ? "100%" : pct(frac);
    bubble.style.transform = `translateX(${frac < 0.2 ? "0%" : frac > 0.8 ? "-100%" : "-50%"})`;
    bubbleDot.style.background = per.color;
    bubbleText.textContent = `${fmtAge(age)} Ma · ${per.name}`;

    const axisAges =
      level === 0
        ? [540, 400, 250, 100, 0]
        : [0, 1, 2, 3, 4].map((i) => view.hi - (i / 4) * (view.hi - view.lo));
    axisEl.innerHTML = axisAges
      .map((v) => {
        const xf = ageToFrac(Math.min(TOTAL, v));
        const shift = xf < 0.04 ? "0%" : xf > 0.96 ? "-100%" : "-50%";
        return `<span style="left:${pct(xf)};transform:translateX(${shift})">${
          v < 0.05 ? "today" : fmtAge(v)
        }</span>`;
      })
      .join("");

    const spacing = view.hi <= 100 ? "5 Myr steps" : view.lo >= 100 ? "10 Myr steps" : "5 to 10 Myr steps";
    noteEl.textContent = track
      ? `${fmtAge(view.hi)} to ${fmtAge(view.lo)} Ma · ${inView} reconstructions · ${spacing}`
      : "";

    const era = eraAt(age);
    zoomIn.textContent =
      level === 0 ? `Zoom in · ${era[0]}` : level === 1 ? `Zoom in · ${per.name}` : "Full extent · 540 Ma";
    zoomIn.dataset.flat = level === 2 ? "1" : "0";
    zoomOut.hidden = level === 0;
    zoomOut.textContent = `← ${level === 2 ? era[0] : "Full extent"}`;

    trackEl.setAttribute("aria-valuenow", age.toFixed(2));
    trackEl.setAttribute("aria-valuetext", `${fmtAge(age)} million years ago, ${per.name}`);
  }

  render();

  return {
    scale,
    setAge(next) {
      age = next;
      render();
    },
    setTrack(next) {
      track = next;
      render();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      container.innerHTML = "";
    },
  };
}
