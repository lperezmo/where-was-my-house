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
- **A continuous drift track** drawn across the globe, rather than a series of
  disconnected positions.
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

## Stack

Vite, TypeScript. Vercel functions on the Bun runtime. No UI framework, no chart
library, no map library: the globe, the timeline and the latitude chart are all
hand-rolled SVG. Initial payload is about 14 kB gzipped.

| Service | Used for | Key needed |
|---|---|---|
| [GPlates Web Service](https://gws.gplates.org) | point reconstruction, Merdith et al. 2021 model | no |
| [Paleobiology Database](https://paleobiodb.org) | fossil occurrences | no |
| [Macrostrat](https://macrostrat.org) | local rock units, lithology, depositional environment | no |
| [Nominatim](https://nominatim.openstreetmap.org) | geocoding | no |

## Develop

```bash
bun install
bun run dev          # http://localhost:5173, /api included
bun test             # headless DOM, recorded API fixtures
```

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
from Macrostrat, CC BY 4.0. Geocoding from Nominatim and OpenStreetMap
contributors.
