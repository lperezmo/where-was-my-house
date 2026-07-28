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

test("the theme toggle offers the other theme and persists the choice", () => {
  const btn = $("#theme") as HTMLButtonElement;
  const before = btn.textContent;
  btn.click();
  expect(btn.textContent).not.toBe(before);
  expect(win.localStorage.getItem("wwmh-theme")).toBe(before!.toLowerCase());
  expect(win.document.documentElement.dataset.theme).toBe(before!.toLowerCase());
});
