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

export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (!isReadMethod(req)) {
      sendError(res, 405, "Method not allowed");
      return;
    }

    const q = getQuery(req);
    const lat = parseNumber(q.lat);
    const lon = parseNumber(q.lon);
    if (lat == null || lon == null) {
      sendError(res, 400, "lat and lon are required numbers");
      return;
    }
    if (lat < -90 || lat > 90) {
      sendError(res, 400, "lat must be between -90 and 90");
      return;
    }
    if (lon < -180 || lon > 180) {
      sendError(res, 400, "lon must be between -180 and 180");
      return;
    }

    const rawMax = parseNumber(q.maxMa);
    const rawMin = parseNumber(q.minMa);
    let maxMa = clamp(rawMax ?? MAX_AGE, 0, MAX_AGE);
    let minMa = clamp(rawMin ?? 0, 0, MAX_AGE);
    if (minMa > maxMa) [maxMa, minMa] = [minMa, maxMa];

    const result = await fetchFossils({ lat, lon, maxMa, minMa });
    sendJson(res, 200, result, CACHE_CONTROL);
  } catch (err) {
    if (err instanceof UpstreamError) {
      sendError(res, err.status, err.message);
      return;
    }
    sendError(res, 500, "Could not load fossil records");
  }
}
