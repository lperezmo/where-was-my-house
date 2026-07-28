/** Renders standalone SVG snapshots of the globe and chart for visual review. */
import { Window } from "happy-dom";
import { writeFileSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const win = new Window({ url: "https://wherewasmyhouse.test/" });
const g = globalThis as Record<string, unknown>;
g.window = win;
g.document = win.document;
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};
g.fetch = async (url: string) => {
  const age = String(url).match(/(\d+)\.json/)![1];
  return { ok: true, json: async () => JSON.parse(readFileSync(`${root}/public/coastlines/${age}.json`, "utf8")) };
};

const { createGlobe } = await import("../src/globe");
const { createTimeline } = await import("../src/timeline");
const { createLatitudeChart } = await import("../src/chart");
const track = JSON.parse(readFileSync(`${root}/test/fixtures/track.json`, "utf8"));
const css = readFileSync(`${root}/src/style.css`, "utf8")
  .replace(/@media[^{]*\{[\s\S]*?\n\}\n/g, "")
  .match(/:root[^{]*\{[\s\S]*?\n\}/g)!;
const globeCss = readFileSync(`${root}/src/globe.css`, "utf8");
const chartCss = readFileSync(`${root}/src/chart.css`, "utf8");

const themes: Record<string, string> = { dark: css[0], light: `${css[0]}\n${css[1].replace(':root[data-theme="light"]', ":root")}` };

for (const [theme, tokens] of Object.entries(themes)) {
  for (const age of [0, 300]) {
    const host = win.document.createElement("div");
    win.document.body.append(host);
    const globe = createGlobe(host as never);
    globe.setTrack(track);
    globe.setAge(age);
    await new Promise((r) => setTimeout(r, 60));
    globe.setAge(age);
    const svg = host.querySelector("svg")!;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "480");
    svg.setAttribute("height", "400");
    writeFileSync(
      `${root}/snapshots/globe-${theme}-${age}Ma.svg`,
      svg.outerHTML.replace("<defs>", `<style>${tokens}${globeCss}</style><rect width="360" height="300" fill="var(--sky-2)"/><defs>`),
    );
    globe.destroy();
    host.remove();
  }

  const tlHost = win.document.createElement("div");
  const cHost = win.document.createElement("div");
  win.document.body.append(tlHost, cHost);
  const tl = createTimeline(tlHost as never, { onSeek: () => {}, onScale: () => {} });
  const chart = createLatitudeChart(cHost as never, tl.scale, () => {});
  chart.setTrack(track);
  chart.setAge(180);
  const svg = cHost.querySelector("svg")!;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "560");
  svg.setAttribute("height", "205");
  writeFileSync(
    `${root}/snapshots/chart-${theme}.svg`,
    svg.outerHTML.replace("<rect", `<style>${tokens}${chartCss}</style><rect width="360" height="132" fill="var(--chart-bg)"/><rect`),
  );
  console.log(`${theme}: globe + chart`);
}
