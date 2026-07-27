import { geocode } from "./_lib/nominatim";
import { getQuery, isReadMethod, sendError, sendJson, UpstreamError } from "./_lib/http";

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";
const MAX_QUERY_LENGTH = 200;

export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (!isReadMethod(req)) {
      sendError(res, 405, "Method not allowed");
      return;
    }

    const raw = getQuery(req).q;
    const q = typeof raw === "string" ? raw.trim() : "";
    if (q === "") {
      sendError(res, 400, "q is required");
      return;
    }
    if (q.length > MAX_QUERY_LENGTH) {
      sendError(res, 400, "q is too long");
      return;
    }

    const results = await geocode(q);
    sendJson(res, 200, { results }, CACHE_CONTROL);
  } catch (err) {
    if (err instanceof UpstreamError) {
      sendError(res, err.status, err.message);
      return;
    }
    sendError(res, 500, "Could not look up that place");
  }
}
