export interface GeoResult {
  name: string;
  lat: number;
  lon: number;
}

export interface TrackStep {
  ageMa: number;
  lat: number;
  lon: number;
}

export interface Track {
  point: { lat: number; lon: number };
  plateId: number | null;
  model: string;
  steps: TrackStep[];
  /** Ages the reconstruction service could not resolve (plate not yet formed, etc). */
  missing: number[];
}

export interface Fossil {
  name: string;
  rank: string;
  maxMa: number;
  minMa: number;
  paleoLat: number | null;
  paleoLon: number | null;
  lat: number;
  lon: number;
}

export interface FossilResult {
  records: Fossil[];
  truncated: boolean;
}

export interface ApiError {
  error: string;
}

export interface Period {
  name: string;
  startMa: number;
  endMa: number;
  color: string;
}

export type ClimateBelt =
  | "tropical"
  | "subtropical"
  | "temperate"
  | "subpolar"
  | "polar";
