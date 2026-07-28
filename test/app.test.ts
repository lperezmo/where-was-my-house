import { expect, test, beforeAll } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const fixture = (name: string) => readFileSync(`${root}/test/fixtures/${name}.json`, "utf8");

let win: Window;

/** Serves the recorded Pendleton responses so the whole app can be driven offline. */
function stubFetch() {
  return async (url: string) => {
    const path = String(url);
    const name = path.startsWith("/api/geocode")
      ? "geocode"
      : path.startsWith("/api/track")
        ? "track"
        : path.startsWith("/api/fossils")
          ? "fossils"
          : path.startsWith("/api/geology")
            ? "geology"
            : null;
    if (!name) throw new Error(`unexpected request: ${path}`);
    const body = fixture(name);
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  win = new Window({ url: "https://wherewasmyhouse.test/" });
  win.document.write(readFileSync(`${root}/index.html`, "utf8"));
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.navigator = win.navigator;
  g.location = win.location;
  g.localStorage = win.localStorage;
  g.history = win.history;
  g.fetch = stubFetch();
  g.requestAnimationFrame = (cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 16);
  g.cancelAnimationFrame = (id: number) => win.clearTimeout(id);
  await import("../src/main");
});

const $ = (sel: string) => win.document.querySelector(sel) as HTMLElement;

test("the app boots into the intro, not a blank screen", () => {
  expect($("#app").dataset.phase).toBe("intro");
  expect($("#intro h1").textContent).toContain("Where was my house");
  // The globe is drawn before any search, so the stage is never empty.
  expect($("#globe").querySelectorAll("path").length).toBeGreaterThan(10);
});

test("a search reconstructs Pendleton and fills every panel", async () => {
  ($("#q") as HTMLInputElement).value = "Pendleton Oregon";
  $("#search").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));

  for (let i = 0; i < 40 && $("#app").dataset.phase !== "ready"; i++) await tick();
  expect($("#app").dataset.phase).toBe("ready");

  expect($("#place-name").textContent).toContain("Pendleton");
  expect($("#age-big").textContent).toBe("0.00");
  expect($("#period-name").textContent).toBe("Quaternary");
  expect($("#lat-line").textContent).toContain("45.7° N");
  expect($("#narrative").textContent!.length).toBeGreaterThan(30);
  expect($("#timeline").querySelectorAll(".tl-seg").length).toBe(12);
});

test("scrubbing to 100 Ma matches the known reconstruction", async () => {
  const track = JSON.parse(fixture("track"));
  const at100 = track.steps.find((s: { ageMa: number }) => s.ageMa === 100);
  expect(at100.lat).toBeCloseTo(52.48, 2);

  const slider = $(".tl-track");
  slider.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  await tick();
  expect(Number($("#age-big").textContent)).toBeGreaterThan(0);
});

test("scrubbing past the oldest reconstruction says so instead of guessing", async () => {
  const slider = $(".tl-track");
  // Walk left with large steps until the readout passes 410 Ma.
  for (let i = 0; i < 400 && Number($("#age-big").textContent) < 430; i++) {
    slider.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, shiftKey: true }),
    );
  }
  await tick();

  expect(Number($("#age-big").textContent)).toBeGreaterThan(410);
  expect($("#narrative").textContent).toBe(
    "The model has no position for this ground at this age.",
  );
  expect($("#lat-line").textContent).toBe("");
  expect($("#timeline").querySelector(".tl-void")).not.toBeNull();
});

test("the fossil list and image prompt render from real records", async () => {
  const slider = $(".tl-track");
  for (let i = 0; i < 400 && Number($("#age-big").textContent) > 30; i++) {
    slider.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  }
  // loadFossils is debounced by 250 ms, so this waits in real time.
  await new Promise((r) => setTimeout(r, 700));

  const rows = $("#fossils").querySelectorAll(".fossil-list li");
  expect(rows.length).toBeGreaterThan(0);

  const prompt = $("#prompt").querySelector(".prompt-text");
  expect(prompt).not.toBeNull();
  expect(prompt!.textContent).toContain("Pendleton");
  expect($("#prompt").querySelector(".prompt-copy")).not.toBeNull();
});


test("the theme control has three states and marks the active one", () => {
  const btns = [...win.document.querySelectorAll("#theme button[data-set]")] as HTMLElement[];
  expect(btns.map((b) => b.dataset.set)).toEqual(["dark", "auto", "light"]);

  for (const want of ["light", "auto", "dark"]) {
    btns.find((b) => b.dataset.set === want)!.click();
    expect(win.document.documentElement.dataset.theme).toBe(want);
    expect(win.localStorage.getItem("wwmh-theme")).toBe(want);
    const checked = btns.filter((b) => b.getAttribute("aria-checked") === "true");
    expect(checked.length).toBe(1);
    expect(checked[0].dataset.set).toBe(want);
  }
});

test("the split handle resizes the globe and clamps at the extremes", () => {
  const split = $("#split");
  const root = win.document.documentElement;
  const realMatchMedia = win.matchMedia.bind(win);

  const drag = (client: number, axis: "clientX" | "clientY") => {
    const e = new win.Event("pointermove", { bubbles: true });
    Object.defineProperty(e, axis, { value: client, configurable: true });
    split.dispatchEvent(e);
  };

  // Narrow: the handle moves horizontally split between globe and readout.
  win.matchMedia = ((q: string) =>
    q.includes("900") ? { matches: false, addEventListener() {} } : realMatchMedia(q)) as never;
  split.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));

  drag(win.innerHeight * 0.3, "clientY");
  expect(parseFloat(root.style.getPropertyValue("--split"))).toBeCloseTo(30, 0);

  // Dragging past either edge must not collapse a pane to nothing.
  drag(-500, "clientY");
  expect(parseFloat(root.style.getPropertyValue("--split"))).toBe(15);
  drag(win.innerHeight * 5, "clientY");
  expect(parseFloat(root.style.getPropertyValue("--split"))).toBe(85);

  split.dispatchEvent(new win.Event("pointerup", { bubbles: true }));
  expect(win.localStorage.getItem("wwmh-split")).toBe("85");

  // Wide: the same handle drives the column width instead, stored separately.
  win.matchMedia = ((q: string) =>
    q.includes("900") ? { matches: true, addEventListener() {} } : realMatchMedia(q)) as never;
  split.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
  drag(win.innerWidth * 0.6, "clientX");
  expect(parseFloat(root.style.getPropertyValue("--split-w"))).toBeCloseTo(40, 0);
  expect(win.localStorage.getItem("wwmh-split")).toBe("85");
  split.dispatchEvent(new win.Event("pointerup", { bubbles: true }));

  win.matchMedia = realMatchMedia as never;
});

test("the chart and globe take every colour from the theme", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["chart.ts", "globe.ts"]) {
    const src = readFileSync(`${root}/src/${file}`, "utf8");
    // Colours belong in CSS so light mode can override them.
    expect(src.match(/#[0-9a-fA-F]{6}\b/g) ?? []).toEqual([]);
  }
  const css = readFileSync(`${root}/src/style.css`, "utf8");
  for (const token of ["--sea-1", "--land", "--band-tropical", "--chart-bg", "--star-show"]) {
    // Once in the dark root, once per light selector.
    expect(css.split(`${token}:`).length - 1).toBe(3);
  }
});
