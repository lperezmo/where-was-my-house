import { geocode } from "./_lib/nominatim";
import { getQuery, isReadMethod, sendError, sendJson, UpstreamError } from "./_lib/http";

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";
const MAX_QUERY_LENGTH = 200;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (!isReadMethod(request)) return sendError(405, "Method not allowed");

      const raw = getQuery(request).get("q");
      const q = typeof raw === "string" ? raw.trim() : "";
      if (q === "") return sendError(400, "q is required");
      if (q.length > MAX_QUERY_LENGTH) return sendError(400, "q is too long");

      const results = await geocode(q);
      return sendJson(200, { results }, CACHE_CONTROL);
    } catch (err) {
      if (err instanceof UpstreamError) return sendError(err.status, err.message);
      return sendError(500, "Could not look up that place");
    }
  },
};
