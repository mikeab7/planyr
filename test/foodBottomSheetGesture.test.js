/* foodBottomSheetGesture — NEW-2 / NEW-3 (2026-10-05): the pure decisions behind the sheet's drag
 * and the structure that makes the form-open rule hold at every height. Red on the code before this
 * change (none of these exports or markers existed; the old release rule ignored speed and closed the
 * place from any low release). Browser half, with real touch drags + pictures:
 * ui-audit/verify-food-rating-and-sheet.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stopList, releaseVelocity, resolveRelease, dragBounds, clampDragHeight, FLICK_VELOCITY } from "../src/workspaces/food/lib/bottomSheetSnap.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOOD = join(REPO, "src", "workspaces", "food");
const read = (rel) => readFileSync(join(FOOD, rel), "utf8");
const STOPS = { peek: 228, half: 395, full: 575 };

describe("stopList", () => {
  it("lists the stops lowest first", () => expect(stopList(STOPS).map((s) => s.name)).toEqual(["peek", "half", "full"]));
  it("treats snaps that render at the same height as ONE stop (short content), highest name wins", () => {
    expect(stopList({ peek: 300, half: 300, full: 300 })).toEqual([{ name: "full", h: 300 }]);
    expect(stopList({ peek: 228, half: 395, full: 396 }).map((s) => s.name)).toEqual(["peek", "full"]);
  });
});

describe("releaseVelocity (px/ms, up positive)", () => {
  it("is the speed over the last ~100 ms", () => {
    expect(releaseVelocity([{ t: 0, y: 500 }, { t: 40, y: 480 }, { t: 80, y: 440 }])).toBeCloseTo(0.75);
    expect(releaseVelocity([{ t: 0, y: 400 }, { t: 80, y: 440 }])).toBeCloseTo(-0.5);
  });
  it("ignores samples older than the window, and is 0 with too little to go on", () => {
    expect(releaseVelocity([{ t: 0, y: 900 }, { t: 400, y: 500 }, { t: 450, y: 500 }])).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 500 }])).toBe(0);
    expect(releaseVelocity([])).toBe(0);
  });
});

describe("resolveRelease", () => {
  const base = { stops: STOPS, canDismiss: true };
  it("a slow release settles on the NEAREST stop", () => {
    expect(resolveRelease({ ...base, heightPx: 300, startHeight: 228, velocity: 0.1 })).toBe("peek");
    expect(resolveRelease({ ...base, heightPx: 340, startHeight: 228, velocity: 0.1 })).toBe("half");
    expect(resolveRelease({ ...base, heightPx: 500, startHeight: 395, velocity: -0.1 })).toBe("full");
  });
  it("a FLICK moves exactly ONE stop from where the drag started, in its direction — even a short one that stays nearest to the start", () => {
    const v = FLICK_VELOCITY + 0.3;
    expect(resolveRelease({ ...base, heightPx: 288, startHeight: 228, velocity: v })).toBe("half"); // 60 px up from peek
    expect(resolveRelease({ ...base, heightPx: 455, startHeight: 395, velocity: v })).toBe("full");
    expect(resolveRelease({ ...base, heightPx: 515, startHeight: 575, velocity: -v })).toBe("half");
    expect(resolveRelease({ ...base, heightPx: 335, startHeight: 395, velocity: -v })).toBe("peek");
  });
  it("a flick does not skip two stops, unless the finger itself already carried the sheet past", () => {
    const v = 1.5;
    expect(resolveRelease({ ...base, heightPx: 300, startHeight: 228, velocity: v })).toBe("half");
    expect(resolveRelease({ ...base, heightPx: 560, startHeight: 228, velocity: v })).toBe("full");
  });
  it("a twitch (tiny travel) is not a flick", () => {
    expect(resolveRelease({ ...base, heightPx: 232, startHeight: 228, velocity: 2 })).toBe("peek");
  });
  it("closing: only when allowed — below half the peek, or a flick down from the lowest stop", () => {
    expect(resolveRelease({ ...base, heightPx: 100, startHeight: 228, velocity: 0 })).toBe("dismiss");
    expect(resolveRelease({ ...base, heightPx: 200, startHeight: 228, velocity: -1 })).toBe("dismiss");
    // …never with a form open or the keyboard up (canDismiss false): lands on the lowest stop instead
    expect(resolveRelease({ ...base, canDismiss: false, heightPx: 100, startHeight: 228, velocity: 0 })).toBe("peek");
    expect(resolveRelease({ ...base, canDismiss: false, heightPx: 200, startHeight: 228, velocity: -1 })).toBe("peek");
  });
  it("short content (one real stop) can never produce a surprise snap", () => {
    const one = { peek: 300, half: 300, full: 300 };
    for (const v of [-2, 0, 2]) expect(resolveRelease({ stops: one, canDismiss: false, heightPx: 310, startHeight: 300, velocity: v })).toBe("full");
  });
});

describe("dragBounds", () => {
  it("tops out at the FULL stop (the content's own height), never the viewport — no pulling open onto empty space", () => {
    expect(dragBounds({ stops: STOPS, canDismiss: true })).toEqual({ min: 0, max: 575 });
    expect(clampDragHeight(900, dragBounds({ stops: STOPS, canDismiss: true }))).toBe(575);
  });
  it("bottoms out at the peek stop when closing is not allowed", () => {
    expect(clampDragHeight(10, dragBounds({ stops: STOPS, canDismiss: false }))).toBe(228);
  });
});

describe("structure: the form-open rule and the gesture wiring", () => {
  const sheet = read("components/BottomSheet.jsx");
  const panel = read("components/VisitPanel.jsx");
  const dishes = read("components/DishesSection.jsx");

  it("the 'Log a visit' bar yields to ANY open form, by one CSS rule — not by sheet height or typing", () => {
    expect(sheet).toMatch(/export const FORM_OPEN_CSS = [^;]*:has\(\[data-sheet-form\]\) \[data-hide-while-form\]/);
    expect(sheet).toMatch(/<style>\{TYPING_CSS \+ FORM_OPEN_CSS\}<\/style>/);
    expect(panel).toMatch(/data-testid="food-actions-row"[^>]*data-hide-while-form/);
  });
  it("every form marks itself: the dish editor, the new-visit form, the edit-visit card", () => {
    expect(dishes).toMatch(/data-testid="dish-edit-row" data-edit-card="" data-sheet-form=""/);
    expect(panel).toMatch(/<form onSubmit=\{submit\} data-sheet-form=""/);
    expect(panel).toMatch(/data-testid="food-visit-card-editing" data-sheet-form=""/);
  });
  it("the dish list box clips instead of hiding, so the open form's Save bar can pin to the sheet bottom", () => {
    expect(dishes).toMatch(/overflow: "clip"/);
  });
  it("one drag engine for the handle AND the content, deciding the release with resolveRelease", () => {
    expect(sheet).toMatch(/resolveRelease\(/);
    expect(sheet).toMatch(/addEventListener\("touchmove", onMove, \{ passive: false \}\)/);
    expect(sheet).toMatch(/closest\?\.\('input\[type="range"\]/); // a rating slider's own drag is left alone
  });
  it("closing by drag is refused with a form open or the keyboard up", () => {
    expect(sheet).toMatch(/const canDismiss = !kbOpen && !formOpen\(\)/);
  });
  it("the sheet's full height comes from the content itself, not the scroller (no creep after an over-pull)", () => {
    expect(sheet).toMatch(/innerRef\.current\?\.offsetHeight/);
  });
  it("the drag releases from the last move, not a stale render", () => {
    expect(sheet).toMatch(/heightRef\.current/);
  });
});
