import { capture } from "./position";

/**
 * A gated altitude lever, closer to a gear selector than to a slider. The top
 * notch is the globe seen from furthest away; pushing the thumb down clicks
 * through the notches one at a time, crossfading the globe into the
 * reconstructed map and then stepping that map a whole tile level per notch.
 *
 * Every notch carries its own name on the gate, so what the lever is set to is
 * legible beside the thumb rather than in a caption somewhere else.
 *
 * Value runs 0 at the globe to 1 at the closest the data supports.
 */
export interface ZoomStickHandle {
  /** Frees the thumb to sit between notches, for zoom the map's own gestures drove. */
  setValue(v: number, silent?: boolean): void;
  value(): number;
  destroy(): void;
}

export interface ZoomStickNotch {
  value: number;
  name: string;
  detail: string;
}

export interface ZoomStickOptions {
  /** The gate, in any order; the stick sorts them from the top down. */
  notches: ZoomStickNotch[];
  onChange(value: number): void;
}

export function createZoomStick(root: HTMLElement, opts: ZoomStickOptions): ZoomStickHandle {
  const track = root.querySelector("#zoom-track") as HTMLElement;
  const gate = root.querySelector("#zoom-gate") as HTMLElement;
  const fill = root.querySelector("#zoom-fill") as HTMLElement;
  const thumb = root.querySelector("#zoom-thumb") as HTMLElement;
  const inBtn = root.querySelector("#zoom-in") as HTMLButtonElement;
  const outBtn = root.querySelector("#zoom-out") as HTMLButtonElement;

  const notches = [...opts.notches].sort((a, b) => a.value - b.value);
  const last = notches.length - 1;

  const rows = notches.map((notch) => {
    const row = document.createElement("div");
    row.className = "zoom-notch";
    row.style.top = `${notch.value * 100}%`;

    const chip = document.createElement("span");
    chip.className = "zoom-chip";

    const name = document.createElement("span");
    name.className = "zoom-name";
    name.textContent = notch.name;

    const detail = document.createElement("span");
    detail.className = "zoom-detail";
    detail.textContent = notch.detail;

    chip.append(name, detail);
    row.append(chip, document.createElement("i"));
    gate.append(row);
    return row;
  });

  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(last));

  let value = 0;
  let dragging = false;

  /** The notch the thumb reads as, which is simply the one it is closest to. */
  function indexFor(v: number) {
    let best = 0;
    for (let i = 1; i < notches.length; i++) {
      if (Math.abs(notches[i].value - v) < Math.abs(notches[best].value - v)) best = i;
    }
    return best;
  }

  function paint() {
    const pct = value * 100;
    thumb.style.top = `${pct}%`;
    fill.style.height = `${pct}%`;

    const i = indexFor(value);
    for (let k = 0; k < rows.length; k++) rows[k].dataset.on = k === i ? "1" : "0";

    const notch = notches[i];
    track.setAttribute("aria-valuenow", String(i));
    track.setAttribute("aria-valuetext", notch.detail ? `${notch.name}, ${notch.detail}` : notch.name);
    root.dataset.at = value <= 0 ? "top" : value >= 1 ? "bottom" : "mid";
  }

  function set(next: number, silent = false) {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(1, Math.max(0, next));
    if (clamped === value) return;
    value = clamped;
    paint();
    if (!silent) opts.onChange(value);
  }

  function snapTo(i: number) {
    set(notches[Math.min(last, Math.max(0, i))].value);
  }

  /**
   * One notch per push. A thumb parked between notches, which only a pinch on
   * the map itself can do, moves on to the next notch in the direction asked
   * for rather than snapping backwards to the one it happens to be nearest.
   */
  function step(delta: number) {
    const i = indexFor(value);
    const drift = value - notches[i].value;
    if (Math.abs(drift) > 1e-6 && Math.sign(drift) !== Math.sign(delta)) snapTo(i);
    else snapTo(i + delta);
  }

  /** Down is in, matching a lever pushed forward rather than a page scrolled. */
  function fromPointer(e: PointerEvent) {
    const box = track.getBoundingClientRect();
    // A collapsed track would divide by zero and poison the value with NaN.
    if (box.height <= 0) return;
    const raw = (e.clientY - box.top) / box.height;
    snapTo(indexFor(Math.min(1, Math.max(0, raw))));
  }

  track.addEventListener("pointerdown", (e) => {
    capture(track, e);
    dragging = true;
    root.dataset.drag = "1";
    fromPointer(e);
  });
  track.addEventListener("pointermove", (e) => dragging && fromPointer(e));
  const end = () => {
    dragging = false;
    delete root.dataset.drag;
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);

  track.addEventListener("keydown", (e) => {
    const key = e.key;
    if (key === "ArrowDown" || key === "ArrowRight" || key === "PageDown") {
      e.preventDefault();
      step(1);
    } else if (key === "ArrowUp" || key === "ArrowLeft" || key === "PageUp") {
      e.preventDefault();
      step(-1);
    } else if (key === "Home") {
      e.preventDefault();
      snapTo(0);
    } else if (key === "End") {
      e.preventDefault();
      snapTo(last);
    }
  });

  // A trackpad emits a burst of small deltas per flick, so the notches are
  // rate limited: one click of the gate per gesture, not a slide to the floor.
  let wheelAt = 0;
  root.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 160) return;
      wheelAt = now;
      step(e.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );

  inBtn.addEventListener("click", () => step(1));
  outBtn.addEventListener("click", () => step(-1));

  paint();

  return {
    setValue: (v, silent) => set(v, silent),
    value: () => value,
    destroy() {
      root.innerHTML = "";
    },
  };
}
