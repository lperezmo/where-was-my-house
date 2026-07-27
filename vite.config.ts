import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

/**
 * Vite's dev server speaks Node req/res, the Bun runtime handlers speak
 * Request/Response. The endpoints are GET-only, so the request body is not
 * forwarded.
 */
function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const one of v) headers.append(k, one);
    else if (v != null) headers.set(k, v);
  }
  const host = req.headers.host ?? "localhost";
  return new Request(new URL(req.url ?? "/", `http://${host}`), {
    method: req.method ?? "GET",
    headers,
  });
}

async function writeResponse(res: ServerResponse, response: Response, isHead: boolean) {
  res.statusCode = response.status;
  for (const [k, v] of response.headers) res.setHeader(k, v);
  if (isHead) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

// Vercel serves api/*.ts as functions in production. Locally, mount the same
// handlers as middleware so `vite dev` exercises the real code path.
function apiDev(): Plugin {
  return {
    name: "api-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();
        const name = url.slice(5).split("?")[0].replace(/\/+$/, "");
        if (!/^[a-z0-9-]+$/.test(name)) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const response = await mod.default.fetch(toRequest(req));
          await writeResponse(res, response, req.method === "HEAD");
        } catch (err) {
          server.config.logger.error(`[api] ${name}: ${(err as Error).message}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Local API handler failed" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [apiDev()],
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
