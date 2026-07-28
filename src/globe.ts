import { deltaLon, positionAt } from "./position";
import type { Track } from "./types";
import "./globe.css";

export interface GlobeHandle {
  setTrack(track: Track | null): void;
  setAge(ageMa: number): void;
  destroy(): void;
}

const NS = "http://www.w3.org/2000/svg";
const R = 150;
const CX = 180;
const CY = 168;
const D2R = Math.PI / 180;

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

interface Projected {
  x: number;
  y: number;
  front: boolean;
}

export function createGlobe(container: HTMLElement): GlobeHandle {
  const root = svg("svg", {
    viewBox: "0 0 360 300",
    preserveAspectRatio: "xMidYMid meet",
    class: "globe-svg",
    "aria-hidden": "true",
  });

  const defs = svg("defs");
  defs.innerHTML = `
    <radialGradient id="wwmh-sph" cx="34%" cy="26%" r="80%">
      <stop offset="0%" stop-color="#1d5075"/>
      <stop offset="58%" stop-color="#16344d"/>
      <stop offset="100%" stop-color="#091320"/>
    </radialGradient>
    <radialGradient id="wwmh-halo" cx="50%" cy="50%" r="50%">
      <stop offset="72%" stop-color="#2a6a94" stop-opacity="0"/>
      <stop offset="93%" stop-color="#2a6a94" stop-opacity=".30"/>
      <stop offset="100%" stop-color="#2a6a94" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="wwmh-clip"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>`;

  const stars = svg("g");
  let seed = 20260727;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 70; i++) {
    stars.append(
      svg("circle", {
        cx: (rand() * 360).toFixed(1),
        cy: (rand() * 300).toFixed(1),
        r: (rand() * 0.9 + 0.25).toFixed(2),
        fill: "#c8d6e6",
        opacity: (rand() * 0.5 + 0.12).toFixed(2),
      }),
    );
  }

  const halo = svg("circle", { cx: CX, cy: CY, r: R + 26, fill: "url(#wwmh-halo)" });
  const sphere = svg("circle", { cx: CX, cy: CY, r: R, fill: "url(#wwmh-sph)" });

  const clipped = svg("g", { "clip-path": "url(#wwmh-clip)" });
  const graticule = svg("g", { fill: "none", stroke: "#4a7d9e", "stroke-width": ".7" });
  const trackFull = svg("path", {
    fill: "none",
    stroke: "#e0a45e",
    "stroke-width": "1.2",
    opacity: ".38",
    "stroke-dasharray": "3 3",
  });
  const trackPast = svg("path", {
    fill: "none",
    stroke: "#e0a45e",
    "stroke-width": "1.6",
    opacity: ".85",
  });
  const todayDot = svg("circle", {
    r: 0,
    fill: "none",
    stroke: "#93a1b5",
    "stroke-width": "1.2",
    opacity: ".8",
  });
  const pulse = svg("circle", { r: 0, fill: "#e0a45e", class: "globe-pulse" });
  const nowDot = svg("circle", { r: 0, fill: "#e0a45e", stroke: "#0a0d12", "stroke-width": "1.5" });
  clipped.append(graticule, trackFull, trackPast, todayDot, pulse, nowDot);

  const rim = svg("circle", {
    cx: CX,
    cy: CY,
    r: R,
    fill: "none",
    stroke: "#4d86ab",
    "stroke-width": ".9",
    opacity: ".55",
  });

  root.append(defs, stars, halo, sphere, clipped, rim);
  container.append(root);

  const cam = { lat: 0, lon: 0 };
  let track: Track | null = null;
  let age = 0;
  let raf = 0;
  let dead = false;

  function project(lat: number, lon: number): Projected {
    const ph = lat * D2R;
    const la = (lon - cam.lon) * D2R;
    const p0 = cam.lat * D2R;
    const cosc = Math.sin(p0) * Math.sin(ph) + Math.cos(p0) * Math.cos(ph) * Math.cos(la);
    return {
      x: CX + R * Math.cos(ph) * Math.sin(la),
      y: CY - R * (Math.cos(p0) * Math.sin(ph) - Math.sin(p0) * Math.cos(ph) * Math.cos(la)),
      front: cosc > 0,
    };
  }

  /** A run of points is broken wherever it passes behind the sphere. */
  function polyline(pts: [number, number][]): string {
    let d = "";
    let pen = false;
    for (const [lat, lon] of pts) {
      const q = project(lat, lon);
      if (q.front) {
        d += `${pen ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)} `;
        pen = true;
      } else {
        pen = false;
      }
    }
    return d;
  }

  function drawGraticule() {
    const parts: string[] = [];
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: [number, number][] = [];
      for (let lat = -84; lat <= 84; lat += 3) pts.push([lat, lon]);
      parts.push(`<path d="${polyline(pts)}" opacity="${lon === 0 ? 0.4 : 0.2}"/>`);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: [number, number][] = [];
      for (let lon = -180; lon <= 180; lon += 3) pts.push([lat, lon]);
      parts.push(`<path d="${polyline(pts)}" opacity="${lat === 0 ? 0.4 : 0.2}"/>`);
    }
    graticule.innerHTML = parts.join("");
  }

  function draw() {
    drawGraticule();
    if (!track || !track.steps.length) {
      trackFull.setAttribute("d", "");
      trackPast.setAttribute("d", "");
      nowDot.setAttribute("r", "0");
      pulse.setAttribute("r", "0");
      todayDot.setAttribute("r", "0");
      return;
    }

    const steps = track.steps;
    trackFull.setAttribute("d", polyline(steps.map((s) => [s.lat, s.lon])));

    const past: [number, number][] = steps
      .filter((s) => s.ageMa <= age)
      .map((s) => [s.lat, s.lon]);
    const here = positionAt(steps, age);
    if (here) past.unshift([here.lat, here.lon]);
    trackPast.setAttribute("d", polyline(past));

    const today = steps[0];
    const t = project(today.lat, today.lon);
    todayDot.setAttribute("cx", t.x.toFixed(1));
    todayDot.setAttribute("cy", t.y.toFixed(1));
    todayDot.setAttribute("r", t.front ? "5" : "0");

    if (here) {
      const q = project(here.lat, here.lon);
      for (const node of [pulse, nowDot]) {
        node.setAttribute("cx", q.x.toFixed(1));
        node.setAttribute("cy", q.y.toFixed(1));
      }
      nowDot.setAttribute("r", q.front ? "6" : "0");
      pulse.setAttribute("r", q.front ? "11" : "0");
    }
  }

  function tick() {
    if (dead) return;
    const here = track ? positionAt(track.steps, age) : null;
    let moved = false;
    if (here) {
      const dLon = deltaLon(cam.lon, here.lon);
      const dLat = here.lat * 0.55 - cam.lat;
      if (Math.abs(dLon) > 0.05 || Math.abs(dLat) > 0.05) {
        cam.lon += dLon * 0.1;
        cam.lat += dLat * 0.1;
        moved = true;
      }
    }
    if (moved) draw();
    raf = requestAnimationFrame(tick);
  }

  draw();
  raf = requestAnimationFrame(tick);

  return {
    setTrack(next) {
      if (dead) return;
      track = next;
      const first = next && positionAt(next.steps, age);
      if (first) {
        cam.lon = first.lon;
        cam.lat = first.lat * 0.55;
      }
      draw();
    },
    setAge(next) {
      if (dead) return;
      age = next;
      draw();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      root.remove();
    },
  };
}
