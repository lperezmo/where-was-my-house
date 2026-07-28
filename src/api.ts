import type { FossilResult, GeologyResult, GeoResult, Track } from "./types";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && body.error) || `Request failed (${res.status})`);
  }
  return body as T;
}

export function geocode(q: string, signal?: AbortSignal) {
  return get<{ results: GeoResult[] }>(`/api/geocode?q=${encodeURIComponent(q)}`, signal);
}

export function fetchTrack(lat: number, lon: number, signal?: AbortSignal) {
  return get<Track>(`/api/track?lat=${lat}&lon=${lon}`, signal);
}

export function fetchGeology(
  lat: number,
  lon: number,
  maxMa: number,
  minMa: number,
  signal?: AbortSignal,
) {
  const q = `lat=${lat}&lon=${lon}&maxMa=${maxMa}&minMa=${minMa}`;
  return get<GeologyResult>(`/api/geology?${q}`, signal);
}

export function fetchFossils(
  lat: number,
  lon: number,
  maxMa: number,
  minMa: number,
  signal?: AbortSignal,
) {
  const q = `lat=${lat}&lon=${lon}&maxMa=${maxMa}&minMa=${minMa}`;
  return get<FossilResult>(`/api/fossils?${q}`, signal);
}
