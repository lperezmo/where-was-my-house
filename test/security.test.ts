import { afterEach, expect, test } from "bun:test";
import { buildTrack } from "../api/_lib/gplates";
import { fetchJson, UpstreamError } from "../api/_lib/http";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("track failure fallback has one call and concurrency budget", async () => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return new Response("unavailable", { status: 503 });
  }) as typeof fetch;

  await expect(buildTrack(11.1111, 22.2222)).rejects.toBeInstanceOf(UpstreamError);
  expect(calls).toBe(19); // plate + six chunks + twelve bounded fallbacks
  expect(maxActive).toBeLessThanOrEqual(4);
});

test("simultaneous identical tracks share one upstream build", async () => {
  let calls = 0;
  globalThis.fetch = (async (input) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const url = new URL(String(input));
    if (url.pathname.includes("assign_points_plate_ids")) {
      return new Response(JSON.stringify([42]));
    }
    const body: Record<string, { coordinates: [[number, number]] }> = {};
    for (const age of (url.searchParams.get("times") ?? "").split(",").filter(Boolean)) {
      body[age] = { coordinates: [[22.22, 11.11]] };
    }
    return new Response(JSON.stringify(body));
  }) as typeof fetch;

  const [a, b] = await Promise.all([
    buildTrack(12.34561, 23.45671),
    buildTrack(12.34562, 23.45672),
  ]);

  expect(calls).toBe(7);
  expect(a.point).toEqual({ lat: 12.34561, lon: 23.45671 });
  expect(b.point).toEqual({ lat: 12.34562, lon: 23.45672 });
});

test("fetchJson rejects a declared oversized response", async () => {
  globalThis.fetch = (async () =>
    new Response("{}", { headers: { "Content-Length": "9" } })) as typeof fetch;

  await expect(fetchJson("https://example.test/data", { maxBytes: 8 })).rejects.toMatchObject({
    message: "Upstream response was too large",
    status: 502,
  });
});

test("fetchJson cancels a chunked response that crosses the byte limit", async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"x":"'));
      controller.enqueue(new TextEncoder().encode('too large"}'));
    },
    cancel() {
      canceled = true;
    },
  });
  globalThis.fetch = (async () => new Response(body)) as typeof fetch;

  await expect(fetchJson("https://example.test/data", { maxBytes: 8 })).rejects.toMatchObject({
    message: "Upstream response was too large",
  });
  expect(canceled).toBe(true);
});

test("fetchJson preserves legitimate JSON below the byte limit", async () => {
  globalThis.fetch = (async () => new Response('{"ok":true}')) as typeof fetch;
  expect(await fetchJson("https://example.test/data", { maxBytes: 64 })).toEqual({ ok: true });
});
