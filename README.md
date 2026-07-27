# Paleo Vantage

Enter an address, get a 540-million-year biography of that patch of ground: the
path it took across the globe, the latitudes it sat at, the climate belts it
passed through, and the fossils actually found in the rock there.

Built mobile-first. No API keys.

## Prior art, and why this is different

Ian Webster's [Ancient Earth Globe](https://dinosaurpictures.org/ancient-earth)
(2018) does the headline version of this: type an address, see where it was. It
is free, well made, and went viral for good reason. If you want the quick look,
use it.

This is the deeper cut, and specifically:

- **109 reconstructions at 5 to 10 Myr spacing**, against Ancient Earth's 26
  steps at 15 to 150 Myr intervals. Yours scrubs continuously instead of
  jumping between fixed slices.
- **A drift track.** Ancient Earth teleports you between time steps. This draws
  the continuous path your ground actually took across the planet.
- **Paleolatitude over time as a chart.** The thing that most changes what a
  place *was* is the latitude it sat at, and nobody plots it for a point.
- **Fossils from the rock beneath you.** Paleobiology Database occurrences for
  your location, filtered to the age you are looking at.

The parts exist separately: [PBDB Navigator](https://paleobiodb.org/navigator/)
serves fossils to researchers, [Paleolatitude.org](https://paleolatitude.org)
serves paleolatitude numbers to researchers. Neither is aimed at someone with an
address. That combination for one point, told as a narrative, is the gap.

## Stack

Vite, TypeScript, MapLibre GL. Vercel serverless functions. No UI framework, no
chart library, hand-rolled SVG.

| Service | Used for | Key needed |
|---|---|---|
| [GPlates Web Service](https://gws.gplates.org) | point reconstruction, Merdith et al. 2021 model | no |
| [Paleobiology Database](https://paleobiodb.org) | fossil occurrences | no |
| [Nominatim](https://nominatim.openstreetmap.org) | geocoding | no |

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
vercel dev           # if you need the /api functions locally
```

`npm run build` typechecks and builds to `dist/`.

## Accuracy

Plate reconstructions are model output, not observation. The Merdith 2021 model
is peer reviewed and openly licensed, but positions before the Devonian are
genuinely contested in the literature and the app says so where it matters.
Fossil records are rendered exactly as PBDB returns them and are never
synthesized.

## Credits

Merdith et al. (2021) rotation model via the GPlates Web Service, EarthByte
Group. Fossil occurrence data from the Paleobiology Database. Geocoding from
Nominatim and OpenStreetMap contributors.
