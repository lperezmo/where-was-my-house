import type { Fossil, GeologyResult, TrackStep } from "./types";
import { beltFor } from "./narrative";
import "./prompt.css";

export interface PromptContext {
  step: TrackStep;
  periodName: string;
  fossils: Fossil[];
  geology: GeologyResult | null;
  placeName: string;
}

const BELT_SCENE: Record<string, string> = {
  tropical: "equatorial light, high sun, heavy humidity",
  subtropical: "strong dry sunlight, arid haze",
  temperate: "mild seasonal light, broken cloud",
  subpolar: "low raking sunlight, cold air",
  polar: "long shadows, weak sun near the horizon",
};

function hemisphere(lat: number): string {
  if (Math.abs(lat) < 0.5) return "on the equator";
  return `${Math.abs(Math.round(lat))} degrees ${lat >= 0 ? "north" : "south"}`;
}

function settingPhrase(g: GeologyResult | null): string | null {
  const units = g?.units ?? [];
  if (!units.length) return null;

  const marine = units.filter((u) => u.setting === "marine").length;
  const nonmarine = units.filter((u) => u.setting === "nonmarine").length;
  const mixed = units.some((u) => u.setting === "mixed");

  const envs = [...new Set(units.flatMap((u) => u.environments))]
    .filter((e) => !/indet\.?$/i.test(e))
    .slice(0, 4);
  const where = envs.length ? ` (${envs.join(", ")})` : "";

  if (g?.nearbyOnly) {
    if (marine && !nonmarine && !mixed) {
      return `Nearby rock of this age is marine${where}, suggesting marine conditions in the surrounding area; conditions at this exact location are uncertain`;
    }
    if (nonmarine && !marine && !mixed) {
      return `Nearby rock of this age is non-marine${where}, suggesting dry land in the surrounding area; conditions at this exact location are uncertain`;
    }
    if (marine || nonmarine || mixed) {
      return `Nearby rock of this age records both marine and non-marine conditions${where}, so the surrounding shoreline likely moved; conditions at this exact location are uncertain`;
    }
  }

  if (marine && !nonmarine && !mixed) {
    return `The rock preserved here from this time is marine${where}, so this ground was underwater`;
  }
  if (nonmarine && !marine && !mixed) {
    return `The rock preserved here from this time is non-marine${where}, so this ground was dry land`;
  }
  if (marine || nonmarine || mixed) {
    return `Rock of this age near here records both marine and non-marine conditions${where}, so this was close to a shoreline or the shoreline moved`;
  }
  return null;
}

/** Life is only named where the record supports it; vagueness beats invention. */
function lifePhrase(fossils: Fossil[]): string | null {
  const named = fossils
    .filter((f) => f.rank === "species" || f.rank === "genus")
    .slice(0, 6)
    .map((f) => f.name);
  if (!named.length) return null;
  return `Fossils actually recovered from this location and age include ${named.join(", ")}. Feature these rather than generic prehistoric animals`;
}

export function buildPrompt(ctx: PromptContext): string {
  const { step, periodName, geology, fossils, placeName } = ctx;
  const belt = beltFor(step.lat);
  const lines: string[] = [];

  lines.push(
    `A wide landscape of the ground beneath ${placeName} as it was ${step.ageMa} million years ago, during the ${periodName}.`,
  );
  lines.push(
    `At that time this ground lay ${hemisphere(step.lat)}, in the ${belt} zone: ${BELT_SCENE[belt]}.`,
  );

  const setting = settingPhrase(geology);
  if (setting) lines.push(setting + ".");

  const life = lifePhrase(fossils);
  if (life) lines.push(life + ".");

  if (step.ageMa >= 420) {
    lines.push(
      "There are no trees, no grasses and no flowering plants anywhere on Earth at this date. Land surfaces are bare rock, sediment and low microbial or early plant cover. Do not add modern vegetation.",
    );
  } else if (step.ageMa >= 130) {
    lines.push(
      "There are no grasses and no flowering plants in this scene. Vegetation is conifers, cycads and ferns only.",
    );
  }

  lines.push("No people, no buildings, no modern animals. Natural light, no text.");

  return lines.join("\n\n");
}

function tierNote(ctx: PromptContext): string {
  const hasGeology = Boolean(ctx.geology?.units?.length);
  const hasLife = ctx.fossils.length > 0;
  const nearbyGeology = hasGeology && ctx.geology?.nearbyOnly;
  if (nearbyGeology && hasLife)
    return "Grounded in the plate model, the nearby rock record and real fossil finds.";
  if (nearbyGeology)
    return "Grounded in the plate model and the nearby rock record. No fossils are recorded here for this age.";
  if (hasGeology && hasLife) return "Grounded in the plate model, the local rock record and real fossil finds.";
  if (hasGeology) return "Grounded in the plate model and the local rock record. No fossils are recorded here for this age.";
  if (hasLife) return "Grounded in the plate model and real fossil finds. The rock record here is not mapped.";
  if (ctx.geology && !ctx.geology.covered)
    return "Grounded in the plate model only. Rock mapping does not cover this part of the world.";
  return "Grounded in the plate model only. No rock or fossil record here for this age.";
}

export function renderPrompt(container: HTMLElement, ctx: PromptContext | null): void {
  container.textContent = "";
  if (!ctx) return;

  const text = buildPrompt(ctx);

  const card = document.createElement("section");
  card.className = "prompt-card";

  const head = document.createElement("div");
  head.className = "prompt-head";
  const title = document.createElement("h2");
  title.textContent = "Imagine my ancient neighborhood";
  const note = document.createElement("p");
  note.className = "prompt-note";
  note.textContent = tierNote(ctx);
  head.append(title, note);

  const body = document.createElement("pre");
  body.className = "prompt-text";
  body.textContent = text;

  const actions = document.createElement("div");
  actions.className = "prompt-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "prompt-copy";
  copy.textContent = "Copy prompt";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
    } catch {
      const r = document.createRange();
      r.selectNodeContents(body);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      copy.textContent = "Select and copy";
    }
    window.setTimeout(() => (copy.textContent = "Copy prompt"), 2000);
  });
  actions.append(copy);

  const caveat = document.createElement("p");
  caveat.className = "prompt-caveat";
  caveat.textContent =
    "Paste into any image generator. What comes back is an illustration, not a reconstruction: the latitude, rock and fossils are real, everything you see is invented around them.";

  card.append(head, body, actions, caveat);
  container.append(card);
}
