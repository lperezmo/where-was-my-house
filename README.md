<p align="center">
  <img src="https://raw.githubusercontent.com/lperezmo/where-was-my-house/main/assets/logo.svg" alt="Where Was My House" width="380">
</p>

# Where Was My House

Enter an address, get a 540-million-year biography of that patch of ground: the
path it took across the globe, the latitudes it sat at, the climate belts it
passed through, and the fossils actually found in the rock there.

**[wherewasmyhouse.vercel.app](https://wherewasmyhouse.vercel.app)**

Built mobile-first. No API keys.

## Prior art

Ian Webster's [Ancient Earth Globe](https://dinosaurpictures.org/ancient-earth)
(2018) is the incumbent and it is good: type an address, see where it was, with
nearby dinosaurs as a bonus. It is free and deservedly went viral. If you want
the quick look, use it. [Paleolatitude.org](https://paleolatitude.org) covers the
latitude question for researchers, interactively, back to 320 Ma.

So the ideas here are not new. What is different is resolution and continuity:

- **109 reconstructions at 5 to 10 Myr spacing**, against Ancient Earth's 26
  steps at 15 to 150 Myr intervals. This scrubs; that one jumps between slices.
- **A continuous drift track** drawn across the globe, over reconstructed
  coastlines for that same age, rather than a series of disconnected positions.
- **Paleolatitude charted over the full 540 Ma**, against Paleolatitude.org's
  320 Ma, and plotted as a curve rather than returned as a number.
- **Fossils as actual Paleobiology Database occurrences**, filtered to the age
  you are scrubbed to, with their real age ranges, rather than a fixed list of
  nearby dinosaurs.

That is a difference of degree, not of kind. Worth being honest about.

## What it will not do

The rotation model cannot place ground on a plate that does not exist yet.
Pendleton, Oregon resolves back to 410 Ma and no further. Past that the app says
it has no position, and the timeline hatches the span, rather than repeating the
last known point under an older label.

Macrostrat's rock record is largely North America. Outside it, "no coverage" and
"no rock of this age preserved here" are kept as separate answers.

## The map

The stick on the right of the globe is an altitude control. The top is the
planet seen from furthest away; pulling it down flies in, crossfading the globe
into the reconstructed paleogeography for the age you are scrubbed to and then
zooming that map to its limit. The screen never changes, so the address, the
timeline and the theme stay where they are the whole way down.

Elevation is the Scotese and Wright PaleoDEM draped on Merdith 2021
reconstructions, 109 ages at 5 Myr steps, rendered by the deeptime-open
pipeline.

Zoom stops at level 4. A z4 pixel is about 9.8 km at the equator and the
PaleoDEM cell is 6 arcminutes, about 11 km, so there is nothing finer to show:
past that point a map would be upsampling detail nobody measured. The limit is
paleo-elevation reconstruction, not the renderer.

The tiles are 1.4 GB, too much for the repo or a Vercel deployment, so they live
in object storage. Set `VITE_TILE_BASE` to the public bucket URL; without it the
stick is not shown and the rest of the app works unchanged.

The bucket needs a CORS policy allowing the site origin. MapLibre requests
raster tiles with `crossOrigin`, because WebGL cannot texture from a tainted
canvas, so without `Access-Control-Allow-Origin` the tiles download and are then
discarded, and the map stays blank with no obvious error.

## Stack

Vite, TypeScript. Vercel functions on the Bun runtime. No UI framework and no
chart library: the globe, the timeline and the latitude chart are all hand-rolled
SVG, and the initial payload is about 17 kB gzipped. MapLibre is used only for
the tiled map and is fetched on demand, so it costs nothing until it is opened.

| Service | Used for | Key needed |
|---|---|---|
| [GPlates Web Service](https://gws.gplates.org) | point reconstruction and coastlines, Merdith et al. 2021 model | no |
| [Paleobiology Database](https://paleobiodb.org) | fossil occurrences | no |
| [Macrostrat](https://macrostrat.org) | local rock units, lithology, depositional environment | no |
| [PALEOMAP PaleoDEM](https://zenodo.org/records/5460860) | paleo-elevation for the map tiles, CC BY 4.0 | no |
| [Nominatim](https://nominatim.openstreetmap.org) | geocoding | no |

## Develop

```bash
bun install
bun run dev          # http://localhost:5173, /api included
bun test             # headless DOM, recorded API fixtures
bun run coastlines   # regenerate public/coastlines, only needed if the model changes
```

Coastlines are precomputed rather than fetched live. GPlates returns about
2.2 MB in 4.5 s per age; simplified at 0.5 degrees, which is under a pixel at
the size the globe is drawn, each age is about 25 kB gzipped and comes off the
CDN.

`bun run build` typechecks and builds to `dist/`.

The `api/` functions run on Vercel's Bun runtime (`bunVersion: "1.x"` in
`vercel.json`) and export the Web-standard `{ fetch(request) }` shape. `vite dev`
mounts the same handlers behind a small Node-to-Request adapter, so the local
server exercises the deployed code path.

## Accuracy

Plate reconstructions are model output, not observation. The Merdith 2021 model
is peer reviewed and openly licensed, but positions before the Devonian are
genuinely contested in the literature and the app says so where it matters.
Fossil records are rendered exactly as PBDB returns them and are never
synthesized. Positions are interpolated between reconstructions but never
extrapolated beyond them.

## Credits

Merdith et al. (2021) rotation model via the GPlates Web Service, EarthByte
Group. Fossil occurrence data from the Paleobiology Database. Rock unit data
from Macrostrat, CC BY 4.0. Paleo-elevation from Scotese and Wright, PALEOMAP
PaleoDEMs, CC BY 4.0. Geocoding from Nominatim and OpenStreetMap contributors.
