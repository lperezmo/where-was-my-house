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

export interface GeoUnit {
  name: string;
  maxMa: number;
  minMa: number;
  liths: string[];
  environments: string[];
  /** Coarse marine/non-marine read derived from the environment terms. */
  setting: "marine" | "nonmarine" | "mixed" | "unknown";
  refs: string[];
}

export interface GeologyResult {
  /** False outside Macrostrat's coverage, which is largely North America. */
  covered: boolean;
  units: GeoUnit[];
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
