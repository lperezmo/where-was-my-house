import { MAX_AGE } from "./_lib/ages";
import { fetchFossils } from "./_lib/pbdb";
import {
  clamp,
  getQuery,
  isReadMethod,
  parseNumber,
  sendError,
  sendJson,
  UpstreamError,
} from "./_lib/http";

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

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

      const rawMax = parseNumber(q.get("maxMa"));
      const rawMin = parseNumber(q.get("minMa"));
      let maxMa = clamp(rawMax ?? MAX_AGE, 0, MAX_AGE);
      let minMa = clamp(rawMin ?? 0, 0, MAX_AGE);
      if (minMa > maxMa) [maxMa, minMa] = [minMa, maxMa];

      const result = await fetchFossils({ lat, lon, maxMa, minMa });
      return sendJson(200, result, CACHE_CONTROL);
    } catch (err) {
      if (err instanceof UpstreamError) return sendError(err.status, err.message);
      return sendError(500, "Could not load fossil records");
    }
  },
};
