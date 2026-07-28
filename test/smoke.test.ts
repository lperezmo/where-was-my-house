import { expect, test, beforeAll } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";


const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

beforeAll(() => {
  const html = readFileSync(`${root}/index.html`, "utf8");
  const win = new Window({ url: "https://wherewasmyhouse.test/" });
  win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.navigator = win.navigator;
  g.location = win.location;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 16);
  g.cancelAnimationFrame = (id: number) => win.clearTimeout(id);
});

/** A plausible drift track: the 65 real ages, walked from Oregon to the tropics. */
function fakeTrack() {
  const ages: number[] = [];
  for (let a = 0; a <= 100; a += 5) ages.push(a);
  for (let a = 110; a <= 540; a += 10) ages.push(a);
  return {
    point: { lat: 45.672, lon: -118.789 },
    plateId: 1731,
    model: "MERDITH2021",
    steps: ages.map((ageMa) => ({
      ageMa,
      lat: 45.5 - ageMa * 0.11,
      lon: -118.789 + ageMa * 0.2,
    })),
    missing: [],
  };
}

test("timeline covers the whole column and round-trips ages", async () => {
  const { createTimeline } = await import("../src/timeline");
  const host = document.createElement("div");
  document.body.append(host);

  const seen: number[] = [];
  const tl = createTimeline(host, { onSeek: (a) => seen.push(a), onScale: () => {} });
  tl.setTrack(fakeTrack() as never);

  const segs = host.querySelectorAll(".tl-seg");
  expect(segs.length).toBe(12);

  // Segments must tile the strip with no gap and no overlap.
  const spans = [...segs].map((s) => {
    const st = (s as HTMLElement).style;
    return [parseFloat(st.left), parseFloat(st.width)] as const;
  });
  expect(spans[0][0]).toBeCloseTo(0, 2);
  for (let i = 1; i < spans.length; i++) {
    expect(spans[i][0]).toBeCloseTo(spans[i - 1][0] + spans[i - 1][1], 2);
  }
  const last = spans[spans.length - 1];
  expect(last[0] + last[1]).toBeCloseTo(100, 2);

  // Every period must stay wide enough to hit with a thumb.
  for (const [, w] of spans) expect(w).toBeGreaterThan(3.5);

  for (const age of [0, 2.58, 66, 143.1, 251.902, 400, 538.8]) {
    expect(tl.scale.fracToAge(tl.scale.ageToFrac(age))).toBeCloseTo(age, 1);
  }

  // Deep time on the left, today on the right.
  expect(tl.scale.ageToFrac(538.8)).toBeCloseTo(0, 3);
  expect(tl.scale.ageToFrac(0)).toBeCloseTo(1, 3);

  tl.destroy();
  host.remove();
});

test("zoom walks full extent to era to period and back", async () => {
  const { createTimeline } = await import("../src/timeline");
  const host = document.createElement("div");
  document.body.append(host);
  const tl = createTimeline(host, { onSeek: () => {}, onScale: () => {} });
  tl.setTrack(fakeTrack() as never);
  tl.setAge(100);

  const zoomIn = host.querySelector(".tl-in") as HTMLButtonElement;
  const zoomOut = host.querySelector(".tl-out") as HTMLButtonElement;

  expect(zoomIn.textContent).toContain("Mesozoic");
  expect(zoomOut.hidden).toBe(true);

  zoomIn.click();
  expect(zoomIn.textContent).toContain("Cretaceous");
  expect(zoomOut.hidden).toBe(false);

  zoomIn.click();
  expect(zoomIn.textContent).toContain("Full extent");

  zoomIn.click();
  expect(zoomIn.textContent).toContain("Mesozoic");
  expect(zoomOut.hidden).toBe(true);

  tl.destroy();
  host.remove();
});

test("globe draws a graticule and both track segments", async () => {
  const { createGlobe } = await import("../src/globe");
  const host = document.createElement("div");
  document.body.append(host);

  const globe = createGlobe(host);
  const svg = host.querySelector("svg");
  expect(svg).not.toBeNull();

  // Graticule renders before any address is entered, so the globe is never blank.
  expect(host.querySelectorAll("path").length).toBeGreaterThan(10);

  globe.setTrack(fakeTrack() as never);
  globe.setAge(300);

  const paths = [...host.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
  const drawn = paths.filter((d) => d.length > 0);
  expect(drawn.length).toBeGreaterThan(10);

  // The full track and the elapsed portion are separate, non-empty paths.
  const full = host.querySelectorAll("path[stroke-dasharray]")[0];
  expect((full.getAttribute("d") ?? "").length).toBeGreaterThan(20);

  const now = host.querySelector("circle.globe-pulse") as SVGCircleElement;
  expect(Number(now.getAttribute("r"))).toBeGreaterThan(0);

  globe.destroy();
  host.remove();
});

test("latitude chart plots the reconstruction, not a fitted curve", async () => {
  const { createTimeline } = await import("../src/timeline");
  const { createLatitudeChart } = await import("../src/chart");
  const tlHost = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(tlHost, host);

  const tl = createTimeline(tlHost, { onSeek: () => {}, onScale: () => {} });
  const chart = createLatitudeChart(host, tl.scale, () => {});
  chart.setTrack(fakeTrack() as never);
  chart.setAge(200);

  const curve = host.querySelector("path") as SVGPathElement;
  const d = curve.getAttribute("d") ?? "";
  expect(d.startsWith("M")).toBe(true);
  expect(d.split(/[ML]/).length).toBeGreaterThan(100);

  // 200 Ma sits at lat 23.5 N on the fake track, so the dot is above the equator.
  const dot = host.querySelector("circle") as SVGCircleElement;
  expect(Number(dot.getAttribute("cy"))).toBeLessThan(66);
  expect(Number(dot.getAttribute("r"))).toBe(4);

  chart.destroy();
  tl.destroy();
});

test("the image prompt never claims life that did not exist yet", async () => {
  const { buildPrompt } = await import("../src/prompt");
  const step = { ageMa: 450, lat: -20, lon: 30 };

  const text = buildPrompt({
    step,
    periodName: "Ordovician",
    fossils: [],
    geology: null,
    placeName: "Pendleton",
  });
  expect(text).toContain("no trees");
  expect(text).toContain("no grasses");

  const cretaceous = buildPrompt({
    step: { ageMa: 140, lat: 30, lon: 0 },
    periodName: "Cretaceous",
    fossils: [],
    geology: null,
    placeName: "Pendleton",
  });
  expect(cretaceous).toContain("conifers, cycads and ferns only");
});

test("mixed marine and non-marine rock is reported as disagreement", async () => {
  const { buildPrompt } = await import("../src/prompt");
  const geology = {
    covered: true,
    units: [
      { name: "A", maxMa: 35, minMa: 25, liths: [], environments: ["marine"], setting: "marine", refs: [] },
      { name: "B", maxMa: 35, minMa: 25, liths: [], environments: ["fluvial"], setting: "nonmarine", refs: [] },
    ],
  };
  const text = buildPrompt({
    step: { ageMa: 30, lat: 45, lon: -118 },
    periodName: "Paleogene",
    fossils: [],
    geology: geology as never,
    placeName: "Pendleton",
  });
  expect(text).toContain("both marine and non-marine");
  expect(text).not.toContain("so this ground was underwater");
});

test("a track that stops early is never extrapolated", async () => {
  const { positionAt } = await import("../src/position");
  const steps = fakeTrack().steps.filter((s) => s.ageMa <= 410);
  const oldest = steps[steps.length - 1];

  expect(positionAt(steps, 410)).toEqual(oldest);
  expect(positionAt(steps, 405)?.lat).toBeCloseTo(45.5 - 405 * 0.11, 6);

  // Pendleton's plate does not exist before 410 Ma; nothing may be shown there.
  for (const age of [410.1, 450, 538.8]) {
    expect(positionAt(steps, age)).toBeNull();
  }
});

test("the timeline marks the span with no reconstruction", async () => {
  const { createTimeline } = await import("../src/timeline");
  const host = document.createElement("div");
  document.body.append(host);
  const tl = createTimeline(host, { onSeek: () => {}, onScale: () => {} });

  const full = fakeTrack();
  tl.setTrack(full as never);
  expect(host.querySelector(".tl-void")).toBeNull();

  tl.setTrack({ ...full, steps: full.steps.filter((s) => s.ageMa <= 410) } as never);
  const voidEl = host.querySelector(".tl-void") as HTMLElement;
  expect(voidEl).not.toBeNull();
  expect(parseFloat(voidEl.style.width)).toBeGreaterThan(5);

  tl.destroy();
  host.remove();
});

test("longitude interpolates the short way across the antimeridian", async () => {
  const { positionAt } = await import("../src/position");
  const steps = [
    { ageMa: 0, lat: 0, lon: 179 },
    { ageMa: 10, lat: 0, lon: -179 },
  ];
  const mid = positionAt(steps, 5);
  // Halfway is 180, not the 0 a naive average would give.
  expect(Math.abs(mid!.lon)).toBeCloseTo(180, 6);
});
