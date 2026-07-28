import { capture, positionAt } from "./position";
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

/** Absolute latitude cut-offs, mirrored into both hemispheres. Fills come from the theme. */
const BANDS: [number, number, string][] = [
  [66, 90, "polar"],
  [45, 66, "subpolar"],
  [30, 45, "temperate"],
  [15, 30, "subtropical"],
  [0, 15, "tropical"],
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

  for (const [lo, hi, belt] of BANDS) {
    for (const sgn of [1, -1]) {
      const top = sgn > 0 ? y(hi) : y(-lo);
      const bottom = sgn > 0 ? y(lo) : y(-hi);
      root.append(
        el("rect", { x: 0, y: top, width: W, height: bottom - top, class: `band-${belt}` }),
      );
    }
    for (const edge of [hi, -hi]) {
      root.append(el("line", { x1: 0, y1: y(edge), x2: W, y2: y(edge), class: "band-edge" }));
    }
  }

  root.append(
    el("line", { x1: 0, y1: y(0), x2: W, y2: y(0), class: "chart-equator" }),
  );
  const eq = el("text", { x: 4, y: y(0) - 3, class: "chart-equator-label" });
  eq.textContent = "EQUATOR";
  root.append(eq);

  const curve = el("path", { class: "chart-curve" });
  const cursor = el("line", { y1: 0, y2: H, class: "chart-cursor", opacity: "0" });
  const dot = el("circle", { r: 0, class: "chart-dot" });
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
    capture(container, e);
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
