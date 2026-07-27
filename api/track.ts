import { buildTrack } from "./_lib/gplates";
import { getQuery, isReadMethod, parseNumber, sendError, sendJson, UpstreamError } from "./_lib/http";

// The reconstruction is a deterministic model output, so the edge can hold it
// for a long time.
const CACHE_CONTROL = "public, s-maxage=604800, stale-while-revalidate=86400";

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

    const track = await buildTrack(lat, lon);
    sendJson(res, 200, track, CACHE_CONTROL);
  } catch (err) {
    if (err instanceof UpstreamError) {
      sendError(res, err.status, err.message);
      return;
    }
    sendError(res, 500, "Could not build the drift track");
  }
}
