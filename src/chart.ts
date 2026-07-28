import { positionAt } from "./position";
import type { TimeScale } from "./timeline";
import type { Track } from "./types";
import "./chart.css";

const NS = "http://www.w3.org/2000/svg";
const W = 360;
const H = 132;

export interface ChartHandle {
  setTrack(track: Track | null): void;
  setAge(age: number): void;
  /** Called when the timeline's zoom window moves, since the x axis is shared. */
  redraw(): void;
  destroy(): void;
}

/** Absolute latitude cut-offs and their tints, mirrored into both hemispheres. */
const BANDS: [number, number, string][] = [
  [66, 90, "rgb(150 196 232 / 0.11)"],
  [45, 66, "rgb(122 168 208 / 0.075)"],
  [30, 45, "rgb(147 161 181 / 0.055)"],
  [15, 30, "rgb(224 164 94 / 0.075)"],
  [0, 15, "rgb(224 164 94 / 0.135)"],
];

const y = (lat: number) => ((90 - lat) / 180) * H;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function createLatitudeChart(
  container: HTMLElement,
  scale: TimeScale,
  onSeek: (age: number) => void,
): ChartHandle {
  const root = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", "aria-hidden": "true" });

  for (const [lo, hi, fill] of BANDS) {
    for (const sgn of [1, -1]) {
      const top = sgn > 0 ? y(hi) : y(-lo);
      const bottom = sgn > 0 ? y(lo) : y(-hi);
      root.append(el("rect", { x: 0, y: top, width: W, height: bottom - top, fill }));
    }
    for (const edge of [hi, -hi]) {
      root.append(
        el("line", {
          x1: 0,
          y1: y(edge),
          x2: W,
          y2: y(edge),
          stroke: "var(--bg)",
          "stroke-width": ".6",
          opacity: ".55",
        }),
      );
    }
  }

  root.append(
    el("line", {
      x1: 0,
      y1: y(0),
      x2: W,
      y2: y(0),
      stroke: "#93a1b5",
      "stroke-width": ".6",
      "stroke-dasharray": "2 4",
      opacity: ".5",
    }),
  );
  const eq = el("text", {
    x: 4,
    y: y(0) - 3,
    "font-size": "7",
    fill: "#8a93a1",
    "letter-spacing": ".08em",
  });
  eq.textContent = "EQUATOR";
  root.append(eq);

  const curve = el("path", {
    fill: "none",
    stroke: "var(--text)",
    "stroke-width": "1.6",
    "stroke-linejoin": "round",
    opacity: ".9",
  });
  const cursor = el("line", {
    y1: 0,
    y2: H,
    stroke: "#e0a45e",
    "stroke-width": "1",
    opacity: "0",
  });
  const dot = el("circle", { r: 0, fill: "#e0a45e", stroke: "#0a0d12", "stroke-width": "1.4" });
  root.append(curve, cursor, dot);
  container.append(root);

  let track: Track | null = null;
  let age = 0;
  let dragging = false;

  /** Null past the oldest resolved age, so the curve stops instead of flattening. */
  function latAt(a: number): number | null {
    return track ? (positionAt(track.steps, a)?.lat ?? null) : null;
  }

  function draw() {
    if (!track) {
      curve.setAttribute("d", "");
      dot.setAttribute("r", "0");
      cursor.setAttribute("opacity", "0");
      return;
    }
    cursor.setAttribute("opacity", ".55");

    const parts: string[] = [];
    let pen = false;
    for (let i = 0; i <= 180; i++) {
      const f = i / 180;
      const lat = latAt(scale.fracToAge(f));
      if (lat == null) {
        pen = false;
        continue;
      }
      parts.push(`${pen ? "L" : "M"}${(f * W).toFixed(1)} ${y(lat).toFixed(1)}`);
      pen = true;
    }
    curve.setAttribute("d", parts.join(" "));

    const f = scale.ageToFrac(age);
    const lat = latAt(age);
    cursor.setAttribute("x1", (f * W).toFixed(1));
    cursor.setAttribute("x2", (f * W).toFixed(1));
    if (lat == null) {
      dot.setAttribute("r", "0");
    } else {
      dot.setAttribute("r", "4");
      dot.setAttribute("cx", (f * W).toFixed(1));
      dot.setAttribute("cy", y(lat).toFixed(1));
    }
  }

  function seek(e: PointerEvent) {
    const r = container.getBoundingClientRect();
    onSeek(scale.fracToAge(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))));
  }

  container.addEventListener("pointerdown", (e) => {
    container.setPointerCapture(e.pointerId);
    dragging = true;
    seek(e);
  });
  container.addEventListener("pointermove", (e) => dragging && seek(e));
  const end = () => (dragging = false);
  container.addEventListener("pointerup", end);
  container.addEventListener("pointercancel", end);

  draw();

  return {
    setTrack(next) {
      track = next;
      draw();
    },
    setAge(next) {
      age = next;
      draw();
    },
    redraw: draw,
    destroy() {
      root.remove();
    },
  };
}
