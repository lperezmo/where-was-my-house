import { buildTrack } from "./_lib/gplates";
import { getQuery, isReadMethod, parseNumber, sendError, sendJson, UpstreamError } from "./_lib/http";

// The reconstruction is a deterministic model output, so the edge can hold it
// for a long time.
const CACHE_CONTROL = "public, s-maxage=604800, stale-while-revalidate=86400";

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (!isReadMethod(request)) return sendError(405, "Method not allowed");

      const q = getQuery(request);
      const lat = parseNumber(q.get("lat"));
      const lon = parseNumber(q.get("lon"));
      if (lat == null || lon == null) return sendError(400, "lat and lon are required numbers");
      if (lat < -90 || lat > 90) return sendError(400, "lat must be between -90 and 90");
      if (lon < -180 || lon > 180) return sendError(400, "lon must be between -180 and 180");

      const track = await buildTrack(lat, lon);
      return sendJson(200, track, CACHE_CONTROL);
    } catch (err) {
      if (err instanceof UpstreamError) return sendError(err.status, err.message);
      return sendError(500, "Could not build the drift track");
    }
  },
};
