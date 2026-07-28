import { capture } from "./position";

/**
 * A throttle for altitude. The top of the travel is the globe seen from
 * furthest away; pulling the thumb down flies in, crossfading the globe into
 * the reconstructed map and then zooming that map to its limit.
 *
 * Value runs 0 at the globe to 1 at the closest the data supports.
 */
export interface ZoomStickHandle {
  setValue(v: number, silent?: boolean): void;
  value(): number;
  destroy(): void;
}

export interface ZoomStickOptions {
  onChange(value: number): void;
  /** Text for the readout, so the caller can name the altitude in its own terms. */
  label(value: number): string;
}

export function createZoomStick(root: HTMLElement, opts: ZoomStickOptions): ZoomStickHandle {
  const track = root.querySelector("#zoom-track") as HTMLElement;
  const fill = root.querySelector("#zoom-fill") as HTMLElement;
  const thumb = root.querySelector("#zoom-thumb") as HTMLElement;
  const label = root.querySelector("#zoom-label") as HTMLElement;
  const inBtn = root.querySelector("#zoom-in") as HTMLButtonElement;
  const outBtn = root.querySelector("#zoom-out") as HTMLButtonElement;

  let value = 0;
  let dragging = false;

  function paint() {
    const pct = value * 100;
    thumb.style.top = `${pct}%`;
    fill.style.height = `${pct}%`;
    label.textContent = opts.label(value);
    track.setAttribute("aria-valuenow", String(Math.round(pct)));
    track.setAttribute("aria-valuetext", label.textContent);
    root.dataset.at = value <= 0.001 ? "top" : value >= 0.999 ? "bottom" : "mid";
  }

  function set(next: number, silent = false) {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(1, Math.max(0, next));
    if (clamped === value) return;
    value = clamped;
    paint();
    if (!silent) opts.onChange(value);
  }

  /** Down is in, matching a throttle pulled back rather than a page scrolled. */
  function fromPointer(e: PointerEvent) {
    const box = track.getBoundingClientRect();
    // A collapsed track would divide by zero and poison the value with NaN.
    if (box.height <= 0) return;
    set((e.clientY - box.top) / box.height);
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
    const step = e.shiftKey ? 0.2 : 0.05;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      set(value + step);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      set(value - step);
    } else if (e.key === "Home") {
      e.preventDefault();
      set(0);
    } else if (e.key === "End") {
      e.preventDefault();
      set(1);
    }
  });

  inBtn.addEventListener("click", () => set(value + 0.12));
  outBtn.addEventListener("click", () => set(value - 0.12));

  paint();

  return {
    setValue: (v, silent) => set(v, silent),
    value: () => value,
    destroy() {
      root.innerHTML = "";
    },
  };
}
