/* NEW-1 — the on-building edit controls arm on a ZOOM threshold derived from the smallest thing
 * they edit, not on how big the building is, and the threshold is derived from the CONTROL's own
 * size rather than from a touch-target figure.
 *
 * The defect the gate exists for: on the owner's 109-acre Bain plan, with the WHOLE SITE in the
 * viewport, the green + and red − rendered at full size over the two largest buildings on the
 * drawing, while the bump-out one of them places was a few pixels wide. B225's gate could not see
 * it — it asks whether the BUILDING has room for the cluster, and a 900 ft building has room at
 * almost any zoom a site plan is read at. The two gates measure different things and both must pass.
 *
 * The defect THIS amendment fixes: the first cut required 44 px across the bump-out, which is a
 * MINIMUM-TOUCH-TARGET figure, and the bump-out is not the touch target. On the owner's plan that
 * put Building 3 (788 × 260 ft) at 630 px — about two thirds of his canvas — before he could add or
 * remove anything. The re-derived criterion is that the placed feature is never smaller on screen
 * than the CONTROL that places it, keyline included, which is the honest half of the original rule
 * with the touch-target inflation removed.
 *
 * ⛔ THERE ARE TWO MUTATION CHECKS HERE AND BOTH ARE THE POINT. The pre-#990 rule (no zoom gate at
 * all) is replayed verbatim and must DISAGREE at the owner's whole-site zoom; the #990 rule (a 44 px
 * / 0.80 px-per-foot floor) is replayed verbatim and must DISAGREE across the band this amendment
 * opens up. A guard that passes on the old AND the new implementation is not guarding anything.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOGEAR_W, DOGEAR_D } from "../src/workspaces/site-planner/lib/dogEar.js";
import {
  FEAT_CTRL_R, FEAT_CTRL_STROKE,
  FEAT_EDIT_MIN_PX, FEAT_EDIT_MIN_PPF, FEAT_EDIT_MAX_FT_PER_PX, FEAT_EDIT_MIN_OPACITY,
  FEAT_EDIT_FADE_SPAN, featureEditOpacity,
} from "../src/workspaces/site-planner/lib/featureEditZoom.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const planner = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* The owner's reported view, reconstructed from the scale bar he photographed (0–1,000 FEET across
 * a bar a couple of hundred pixels wide ⇒ ≈0.2 px per foot) and from a 109-acre site fitting the
 * viewport. Anything in this band is "the whole site on screen" and must show no edit controls. */
const WHOLE_SITE_PPF = [0.08, 0.15, 0.2, 0.28];
/* The band this amendment OPENS: zooms the #990 floor refused and the corrected one admits. */
const REOPENED_PPF = [0.36, 0.5, 0.65, 0.79];
/* The pre-#990 rule, verbatim: the ONLY gate was the building's own footprint in px. */
const preFixArmed = (buildingFt, ppf) => buildingFt * ppf >= 72;
/* The #990 rule, verbatim: a 44 px touch target across the bump-out's short side. */
const shippedFloorPpf = 44 / DOGEAR_W;
const shippedArmed = (ppf) => ppf >= shippedFloorPpf;

describe("the threshold is derived from the CONTROL, and stated", () => {
  it("is the +/− disc's full outer width across a bump-out's short side — 0.359 px/ft, 2.78 ft/px", () => {
    expect(FEAT_CTRL_R).toBe(9);
    expect(FEAT_CTRL_STROKE).toBe(1.75);
    expect(FEAT_EDIT_MIN_PX).toBeCloseTo(19.75, 10);  // 2r + the white keyline
    expect(DOGEAR_W).toBe(55);           // the derivation's input; if this moves, the threshold moves with it
    expect(DOGEAR_D).toBe(60);
    expect(FEAT_EDIT_MIN_PPF).toBeCloseTo(0.3590909, 6);
    expect(FEAT_EDIT_MAX_FT_PER_PX).toBeCloseTo(2.7848101, 6);
  });

  it("puts the placed feature at NO LESS than the control — and no more, which was the overshoot", () => {
    const shortSidePx = DOGEAR_W * FEAT_EDIT_MIN_PPF;
    expect(shortSidePx).toBeGreaterThanOrEqual(FEAT_CTRL_R * 2 + FEAT_CTRL_STROKE);
    expect(DOGEAR_D * FEAT_EDIT_MIN_PPF).toBeGreaterThan(shortSidePx); // the deeper side clears it too
    // ⛔ The #990 rule demanded more than TWICE the disc's diameter. That is a touch target, and the
    // bump-out is not the touch target — the +/− button is, and B225 governs it.
    expect(shortSidePx).toBeLessThan(FEAT_CTRL_R * 2 * 2);
  });

  it("renders the owner's own building near a THIRD of his canvas, not two thirds", () => {
    // Building 3 on Bain: 788 ft long, on a canvas about 945 px wide (his 1600 px window less the
    // panels — the frame in which he measured the 630 px / "two thirds" overshoot).
    const lenPx = 788 * FEAT_EDIT_MIN_PPF;
    expect(lenPx).toBeGreaterThan(250);
    expect(lenPx).toBeLessThan(350);
    expect(788 * shippedFloorPpf).toBeGreaterThan(600); // the #990 floor, for contrast
  });
});

describe("the owner's report", () => {
  it("shows NOTHING at whole-site zoom — and the pre-fix rule showed everything", () => {
    for (const ppf of WHOLE_SITE_PPF) {
      expect(featureEditOpacity(ppf), `ppf ${ppf}`).toBe(0);
      // MUTATION CHECK 1: Building 3/4 on Bain are ~900 ft across, so the old gate armed here.
      expect(preFixArmed(900, ppf), `pre-fix, ppf ${ppf}`).toBe(true);
    }
  });

  it("AMENDMENT: the controls are back across the band #990's 44 px floor refused", () => {
    for (const ppf of REOPENED_PPF) {
      expect(featureEditOpacity(ppf), `ppf ${ppf}`).toBeGreaterThan(0);
      // MUTATION CHECK 2: the shipped 0.80 floor said no at every one of these zooms.
      expect(shippedArmed(ppf), `#990 floor, ppf ${ppf}`).toBe(false);
    }
  });

  it("holds identically for a 30-acre site and a 900-acre one — it is absolute zoom", () => {
    // Same zoom, wildly different buildings: the answer is the zoom's, never the building's.
    for (const buildingFt of [120, 500, 900, 2000]) {
      expect(preFixArmed(buildingFt, 0.2)).toBe(buildingFt * 0.2 >= 72); // the old rule DID vary
      expect(featureEditOpacity(0.2)).toBe(0);                            // the new one does not
      expect(featureEditOpacity(0.6)).toBeGreaterThan(0);
    }
  });
});

describe("it fades in rather than popping", () => {
  it("appears faint at the floor and reaches full strength across the ramp", () => {
    expect(featureEditOpacity(FEAT_EDIT_MIN_PPF)).toBeCloseTo(FEAT_EDIT_MIN_OPACITY, 10);
    expect(featureEditOpacity(FEAT_EDIT_MIN_PPF * (1 + FEAT_EDIT_FADE_SPAN))).toBeCloseTo(1, 10);
    expect(featureEditOpacity(FEAT_EDIT_MIN_PPF * 4)).toBe(1); // clamped, never above 1
  });

  it("is monotonic in zoom, and never returns something between 0 and the floor opacity", () => {
    let prev = -1;
    for (let ppf = 0.05; ppf < 4; ppf += 0.01) {
      const o = featureEditOpacity(ppf);
      expect(o === 0 || o >= FEAT_EDIT_MIN_OPACITY).toBe(true); // no invisible-but-clickable band
      expect(o).toBeGreaterThanOrEqual(prev === -1 ? 0 : prev);
      prev = o;
    }
  });

  it("refuses a nonsense zoom rather than rendering at one", () => {
    for (const bad of [NaN, Infinity, -1, 0, undefined, null]) expect(featureEditOpacity(bad)).toBe(0);
  });
});

describe("both clusters are wired to it, and to the RENDER view", () => {
  const body = stripComments(planner);

  it("the gate is computed once, from `rppf` — the frame the render body reasons at", () => {
    // `view.ppf` here would fade against the settled zoom while the picture is mid-gesture at
    // another one (/CLAUDE.md → the view anchor: every ppf in the RENDER BODY is `rppf`).
    expect(body).toContain("const featEditOpacity = featureEditOpacity(rppf);");
  });

  it("the building cluster AND the parking cluster both refuse to render below it", () => {
    expect(body).toContain('if (tool !== "select" || !featActiveId || !featEditOpacity) return null;');
    expect((body.match(/!featEditOpacity\) return null;/g) || []).length).toBe(2);
  });

  it("both render groups carry the opacity, so neither can pop while the other fades", () => {
    expect((body.match(/opacity=\{featEditOpacity\}/g) || []).length).toBe(2);
  });

  it("B225's container gate is still there — this ADDS a question, it does not replace one", () => {
    expect(body).toContain("const FEAT_BTN_MIN_PX = 72;");
    expect(body).toContain("< FEAT_BTN_MIN_PX) return null;");
  });

  it("the control renders FROM the constants the threshold is derived from — no second copy", () => {
    // If the disc's radius or keyline were re-hardcoded here, the gate could claim a control size
    // the app does not draw. Both defaults and every stroke width read the exported values.
    expect(body).toContain("import { featureEditOpacity, FEAT_CTRL_R, FEAT_CTRL_STROKE }");
    expect(body).toContain("onRemove, r = FEAT_CTRL_R)");
    expect(body).toContain("featPair = (key, pos, tan, opt, r = FEAT_CTRL_R)");
    // the single-toggle node (disc + 2 glyph strokes), the "+" (disc + 2) and the "−" (disc + 1):
    // 8 keyline strokes in all, and — within the cluster's own source — not one of them a literal.
    // (1.75 is a common keyline weight elsewhere in the canvas chrome; this slice is the cluster.)
    const cluster = body.slice(body.indexOf("const featNode ="), body.indexOf("const featActiveId ="));
    expect(cluster.length).toBeGreaterThan(500);
    expect((cluster.match(/strokeWidth=\{FEAT_CTRL_STROKE\}/g) || []).length).toBe(8);
    expect(cluster).not.toMatch(/strokeWidth=\{[\d.]+\}/);
    expect(cluster).not.toMatch(/r = 9\b/);
  });
});
