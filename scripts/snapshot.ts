/** Renders standalone SVG snapshots of the globe for visual review. */
import { Window } from "happy-dom";
import { writeFileSync, readFileSync } from "node:fs";

const win = new Window({ url: "https://wherewasmyhouse.test/" });
const g = globalThis as Record<string, unknown>;
g.window = win;
g.document = win.document;
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
g.fetch = async (url: string) => {
  const age = String(url).match(/(\d+)\.json/)![1];
  return { ok: true, json: async () => JSON.parse(readFileSync(`${root}/public/coastlines/${age}.json`, "utf8")) };
};

const { createGlobe } = await import("../src/globe");
const track = JSON.parse(readFileSync(`${root}/test/fixtures/track.json`, "utf8"));

for (const age of [0, 100, 300, 400]) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const globe = createGlobe(host as never);
  globe.setTrack(track);
  globe.setAge(age);
  await new Promise((r) => setTimeout(r, 60));
  globe.setAge(age);
  const svg = host.querySelector("svg")!;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "540");
  svg.setAttribute("height", "450");
  const style = '<style>@keyframes wwmh-pulse{0%,100%{opacity:.55}50%{opacity:0}}</style>';
  writeFileSync(
    `${root}/snapshots/globe-${age}Ma.svg`,
    svg.outerHTML.replace("<defs>", `${style}<rect width="360" height="300" fill="#0a0d12"/><defs>`),
  );
  console.log(`globe-${age}Ma.svg`);
  globe.destroy();
  host.remove();
}
