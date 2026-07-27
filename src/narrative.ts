import type { ClimateBelt, TrackStep } from "./types";

export { PERIODS, periodAt } from "./periods";
export type { Period } from "./periods";

/** Conventional climate bands, by absolute latitude. */
export function beltFor(lat: number): ClimateBelt {
  const a = Math.abs(Number.isFinite(lat) ? lat : 0);
  if (a <= 23.5) return "tropical";
  if (a <= 35) return "subtropical";
  if (a <= 55) return "temperate";
  if (a <= 66.5) return "subpolar";
  return "polar";
}

type Group = "tropical" | "subtropical" | "temperate" | "cold";
type Clause = string | ((south: boolean) => string);

function groupFor(belt: ClimateBelt): Group {
  if (belt === "subpolar" || belt === "polar") return "cold";
  if (belt === "temperate") return "temperate";
  return belt;
}

/**
 * What the latitude implies given the period. Every line is a statement about
 * the belt or about global conditions, never a claim about this specific
 * ground, which the reconstruction says nothing about beyond position.
 */
const IMPLICATIONS: Record<string, Record<Group, Clause>> = {
  Quaternary: {
    tropical:
      "Tropical latitudes stayed warm right through the Quaternary glacial cycles, which registered there as swings between wetter and drier rather than as ice.",
    subtropical:
      "The subtropics sit under the descending arm of the Hadley circulation, which is why the planet's major dry belts cluster at these latitudes.",
    temperate:
      "Mid latitudes carried the full amplitude of the Quaternary glacial cycles, cooling and rebounding repeatedly over the last 2.6 million years.",
    cold: "Ice sheets repeatedly occupied these latitudes during the Quaternary, and the sun sits low or below the horizon for much of the winter here.",
  },
  Neogene: {
    tropical:
      "The Neogene cooled and dried relative to the Paleogene, and the tropics are where C4 grasslands expanded fastest as it did.",
    subtropical:
      "Neogene drying hit the subtropics hardest, and the modern arid belts largely took their present shape at these latitudes during this period.",
    temperate:
      "The Neogene was a steady slide toward the modern icehouse, so mid latitudes ran warmer and less seasonal early in the period than late.",
    cold: "By the Neogene, Antarctic ice was permanent and northern ice was building, so a high-latitude position meant real cold rather than only darkness.",
  },
  Paleogene: {
    tropical:
      "The Paleogene opened with the hottest sustained interval of the Cenozoic, and tropical latitudes ran hot year-round with almost no seasonal contrast.",
    subtropical:
      "Early Paleogene warmth pushed subtropical conditions far poleward of where they sit today, so this latitude was well inside the warm zone.",
    temperate:
      "The Paleogene began much warmer than today and cooled sharply around 34 Ma, so mid latitudes were near-subtropical early and considerably cooler by the period's close.",
    cold: "The poles were ice-free for most of the Paleogene, so high latitudes meant a long dark winter rather than a frozen one until near the period's end.",
  },
  Cretaceous: {
    tropical:
      "The Cretaceous was a greenhouse world with no permanent polar ice, and tropical latitudes sat at the warm core of it.",
    subtropical:
      "Cretaceous sea level stood well above today's and the pole-to-equator gradient was weak, so subtropical conditions reached far poleward of this latitude.",
    temperate:
      "With no permanent polar ice in the Cretaceous, the temperature gradient from equator to pole was shallow and mid latitudes ran considerably warmer than their modern counterparts.",
    cold: "There were no permanent polar ice sheets in the Cretaceous, so winters at this latitude were dark but not frozen.",
  },
  Jurassic: {
    tropical:
      "The Jurassic was warm and effectively ice-free, and tropical latitudes sat in its least seasonal band.",
    subtropical:
      "Pangaea was breaking apart through the Jurassic and new seaways were opening, which moderated the arid subtropical interiors the Triassic had left behind.",
    temperate:
      "No ice sheets are known from the Jurassic, so mid latitudes ran warmer and far less seasonal than the same latitudes do now.",
    cold: "The Jurassic had no polar ice caps, so high latitudes were cool and seasonally dark rather than glaciated.",
  },
  Triassic: {
    tropical:
      "Triassic tropical latitudes sat inside Pangaea's megamonsoon, which drove sharply alternating wet and dry seasons across the supercontinent.",
    subtropical:
      "The subtropics were the arid heart of Pangaea, and this is the latitude band the supercontinent's deserts occupied.",
    temperate:
      "Pangaea was intact through the Triassic, so mid-latitude land was often a long way from any ocean, which means wide temperature swings and little rain.",
    cold: "The Triassic was an ice-free world, so a high-latitude position meant a long dark winter rather than a frozen one.",
  },
  Permian: {
    tropical:
      "The Permian tropics stayed hot throughout, and the late Permian saw the planet warm hard into the largest extinction in the record.",
    subtropical:
      "Pangaea was fully assembled by the Permian and its subtropical interior was severely arid, which is the band this latitude falls in.",
    temperate:
      "Permian mid latitudes sat on a supercontinent with a strongly continental, strongly seasonal climate that dried further as the period went on.",
    cold: (south) =>
      south
        ? "High southern latitudes carried the last Gondwanan ice sheets into the early Permian and were ice-free by the period's end, so this latitude changed character considerably across the Permian."
        : "Permian ice was confined to the far south, so northern high latitudes were cold and dark in winter but never glaciated.",
  },
  Carboniferous: {
    tropical:
      "The coal forests of the Carboniferous were concentrated in the equatorial belt, and atmospheric oxygen reached the highest level in Earth history during this period.",
    subtropical:
      "The Carboniferous ran a steep gradient between Gondwanan ice at the south pole and a wet equatorial belt, and the subtropics sat in the dry zone between the two.",
    temperate:
      "Gondwana was glaciating through much of the Carboniferous, so mid latitudes lay between an ice-covered pole and a wet tropical belt, on a far steeper climate gradient than the Mesozoic ever had.",
    cold: (south) =>
      south
        ? "Southern high latitudes are where the Gondwanan ice sheets sat through much of the Carboniferous."
        : "Carboniferous glaciation was a southern-hemisphere affair, so northern high latitudes were cold but outside the ice.",
  },
  Devonian: {
    tropical:
      "Devonian tropical latitudes held the largest reef systems of the Paleozoic, until those reefs collapsed in the extinctions late in the period.",
    subtropical:
      "The Devonian was warm with no large ice sheets until its final stage, so subtropical latitudes ran hot and largely dry.",
    temperate:
      "Land plants and the first true forests spread through the Devonian, which changed weathering, soil formation, and atmospheric carbon dioxide worldwide.",
    cold: "The Devonian stayed warm until a short glaciation right at its end, so high latitudes were cool rather than icebound for almost all of it.",
  },
  Silurian: {
    tropical:
      "The Silurian was warm with high sea level once the Ordovician glaciation ended, and tropical latitudes were its most stable band.",
    subtropical:
      "Silurian climate was warm and equable, and since land plants were still low and simple everywhere, subtropical land surfaces carried almost no vegetation cover.",
    temperate:
      "Vascular plants were only beginning to colonise land in the Silurian, so mid-latitude land surfaces were bare or thinly covered at best.",
    cold: "Silurian ice was limited and short-lived, so high latitudes were cool rather than glaciated.",
  },
  Ordovician: {
    tropical:
      "Ordovician tropical latitudes were warm and fringed by broad shallow shelf seas, until the Hirnantian glaciation at the very end of the period.",
    subtropical:
      "The Ordovician was warm for most of its length and then ended in a sharp glaciation, so conditions at this latitude depended heavily on where in the period it sat.",
    temperate:
      "The Ordovician closed with a severe glaciation centred on Gondwana's south pole, so mid latitudes were warm for most of the period and much colder at its end.",
    cold: (south) =>
      south
        ? "Gondwana's polar region glaciated hard at the close of the Ordovician, and high southern latitudes are where that ice grew."
        : "The end-Ordovician ice was centred on Gondwana in the south, so northern high latitudes were cool but outside it.",
  },
  Cambrian: {
    tropical:
      "The Cambrian tropics were warm and ice-free, and with no land plants anywhere on Earth, land surfaces at any latitude were bare rock and microbial crust.",
    subtropical:
      "Nothing vegetated the land in the Cambrian, so subtropical land surfaces weathered and eroded in ways that have no modern analogue.",
    temperate:
      "The Cambrian was a warm world without land plants, so mid-latitude land shed sediment far faster than vegetated ground does.",
    cold: "The Cambrian was warm and largely ice-free, so even the highest latitudes were cool rather than frozen.",
  },
};

const GENERIC: Record<Group, string> = {
  tropical:
    "Tropical latitudes take near-vertical sun at midday all year, with little seasonal change in day length.",
  subtropical:
    "The subtropics sit under the descending arm of the Hadley circulation, the band where the world's dry zones concentrate.",
  temperate:
    "Mid latitudes sit in the westerly belt, with a clear seasonal cycle driven by a large annual swing in sun angle.",
  cold: "At this latitude the sun is very low in winter and very high in summer, so the year is dominated by the light cycle.",
};

const POSITION: ((age: string, where: string, belt: string) => string)[] = [
  (age, where, belt) => `At ${age} Ma this ground sat ${where}, in the ${belt} belt.`,
  (age, where, belt) =>
    `${age} million years ago the model places it ${where}, at ${belt} latitudes.`,
  (age, where, belt) => `This rock lay ${where} at ${age} Ma, inside the ${belt} belt.`,
  (age, where, belt) =>
    `The reconstruction puts it ${where} for ${age} Ma, a ${belt} position.`,
  (age, where, belt) => `By ${age} Ma it had drifted ${where}, into the ${belt} belt.`,
];

const HEDGES: string[] = [
  "though plate positions before the Devonian are genuinely contested",
  "with the caveat that reconstructions disagree with each other this far back",
  "though at this age the model is one interpretation among several that differ",
];

/** Stable per age, but mixed so that round ages do not all land on one phrasing. */
function pick<T>(list: T[], seed: number): T {
  const h = Math.imul(Math.round(seed * 10) + 1, 2654435761) >>> 0;
  return list[h % list.length];
}

function formatAge(ageMa: number): string {
  const a = Math.abs(ageMa) < 10 ? Math.round(ageMa * 10) / 10 : Math.round(ageMa);
  return String(a);
}

function latPhrase(lat: number, precise: boolean): string {
  const abs = Math.abs(lat);
  if (abs < 0.5) return "within half a degree of the equator";
  const deg = precise ? Math.round(abs * 10) / 10 : Math.round(abs);
  const side = lat >= 0 ? "north" : "south";
  return `${precise ? "at" : "about"} ${deg}° ${side}`;
}

function resolve(clause: Clause, south: boolean): string {
  return typeof clause === "function" ? clause(south) : clause;
}

/**
 * One or two sentences about this ground at this age. Position and period are
 * the only things known, so nothing here asserts terrain, altitude, cover, or
 * whether it was above water.
 */
export function describe(step: TrackStep, periodName: string): string {
  const belt = beltFor(step.lat);
  const group = groupFor(belt);
  const south = step.lat < 0;

  if (step.ageMa === 0) {
    return `Today this ground sits ${latPhrase(step.lat, true)}, in the ${belt} belt.`;
  }

  const table = IMPLICATIONS[periodName];
  const implication = table ? resolve(table[group], south) : GENERIC[group];

  const age = formatAge(step.ageMa);
  const where = latPhrase(step.lat, false);
  let position = pick(POSITION, step.ageMa)(age, where, belt);

  // Pre-Devonian reconstructions really do disagree, so say so rather than
  // letting the same sentence carry the same confidence at 500 Ma as at 50.
  if (step.ageMa > 420) {
    position = `${position.slice(0, -1)}, ${pick(HEDGES, step.ageMa + 3)}.`;
  }

  return `${position} ${implication}`;
}
