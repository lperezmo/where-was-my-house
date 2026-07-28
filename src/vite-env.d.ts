/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public base URL for the paleo map tiles. See src/config.ts. */
  readonly VITE_TILE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
