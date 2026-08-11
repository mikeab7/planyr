/* NEW-1 — the on-building edit controls arm on a ZOOM threshold, and the threshold is now an
 * OWNER-SET FLOOR plus a viewport cap, not a derivation from the feature being placed.
 *
 * The defect the gate exists for: on the owner's 109-acre Bain plan, with the WHOLE SITE in the
 * viewport, the green + and red − rendered at full size over the two largest buildings on the
 * drawing, while the bump-out one of them places was a few pixels wide. B225's gate could not see
 * it — it asks whether the BUILDING has room for the cluster, and a 900 ft building has room at
 * almost any zoom a site plan is read at. The two gates measure different things and both must pass.
 *
 * ⛔ THREE VALUES, AND THE FIRST TWO WERE BOTH DERIVED FROM THE BUMP-OUT AND BOTH ERRED LATE.
 *   #990  0.80  px/ft — 44 px across the bump-out (a touch-target figure; the bump-out is not the
 *                       touch target). Sent back.
 *   #994  0.359 px/ft — the placed feature never smaller than the control that places it. Sent back
 *                       again: "it still shows up… make it available a little bit sooner."
 *   NOW   0.25  px/ft — stated, not derived, plus a cap expressed as a fraction of canvas width.
 * ALL THREE SUPERSEDED RULES ARE REPLAYED HERE AS MUTATION CHECKS and must DISAGREE with the
 * shipped one somewhere it matters. A guard that passes on the old AND the new implementation is
 * not guarding anything.
 *
 * ⛔ AND THE NEW AXIS: the floor reads the CANVAS WIDTH, so the tests below are written per canvas.
 * A gate that is absolute in px/ft alone puts a bigger share of a smaller screen under the
 * building — a third of the owner's monitor and half of his laptop at the same threshold.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOGEAR_W, DOGEAR_D } from "../src/workspaces/site-planner/lib/dogEar.js";
import {
  FEAT_CTRL_R, FEAT_CTRL_STROKE, FEAT_EDIT_MIN_PX,
  FEAT_EDIT_MIN_PPF, FEAT_EDIT_MAX_FT_PER_PX, FEAT_EDIT_MIN_OPACITY, FEAT_EDIT_FADE_SPAN,
  FEAT_EDIT_REF_SPAN_FT, FEAT_EDIT_MAX_CANVAS_FRAC, FEAT_EDIT_FLOOR_MIN_PPF,
  featureEditFloorPpf, featureEditOpacity,
} from "../src/workspaces/site-planner/lib/featureEditZoom.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const planner = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* The owner's two real canvases, both taken from HIS measurements rather than invented: the
 * ~945 px canvas inside his 1600 px monitor window (the frame he measured "a third" / "two thirds"
 * in), and the ~566 px canvas inside the 1191 px laptop viewport he now works on. */
const MONITOR_W = 945;
const LAPTOP_W = 566;
/* Building 3 on Bain — the object he judges every one of these values against. */
const B3_FT = 788;
/* His Bain frontage, back-computed from his own report: the site fills the canvas at ≈0.2 px/ft on
 * the monitor, so ≈4,725 ft across. Used only to reconstruct "whole-site zoom" per canvas. */
const BAIN_SPAN_FT = 4725;
const wholeSitePpf = (canvasW) => canvasW / BAIN_SPAN_FT;

/* THE THREE SUPERSEDED RULES, VERBATIM. */
/* Pre-#990: the ONLY gate was the building's own footprint in px. */
const preFixArmed = (buildingFt, ppf) => buildingFt * ppf >= 72;
/* #990: a 44 px touch target across the bump-out's short side. */
const floor990 = 44 / DOGEAR_W;
const armed990 = (ppf) => ppf >= floor990;
/* #994: the +/− disc's full outer width across the bump-out's short side. */
const floor994 = (FEAT_CTRL_R * 2 + FEAT_CTRL_STROKE) / DOGEAR_W;
const armed994 = (ppf) => ppf >= floor994;

describe("the floor is OWNER-SET, and the derivations it replaces are named", () => {
  it("is 0.25 px per foot — 4 feet per pixel — stated, not computed from the bump-out", () => {
    expect(FEAT_EDIT_MIN_PPF).toBe(0.25);
    expect(FEAT_EDIT_MAX_FT_PER_PX).toBe(4);
    // ⛔ It must NOT equal either failed derivation. Both were computed from the 55 ft bump-out;
    // if a future session re-derives a third time, one of these goes red.
    expect(FEAT_EDIT_MIN_PPF).not.toBeCloseTo(floor990, 4);   // 0.80 — the touch-target figure
    expect(FEAT_EDIT_MIN_PPF).not.toBeCloseTo(floor994, 4);   // 0.359 — the control's own width
    expect(FEAT_EDIT_MIN_PPF).toBeLessThan(floor994);         // …and it is EARLIER than both
  });

  it("renders his own Building 3 at about 197 px — a fifth of his monitor canvas, not a third", () => {
    const lenPx = B3_FT * featureEditFloorPpf(MONITOR_W);
    expect(lenPx).toBeGreaterThan(180);
    expect(lenPx).toBeLessThan(215);
    // For contrast, the two values he sent back, on the same canvas:
    expect(B3_FT * floor994).toBeGreaterThan(275);  // ≈283 px — "about a third"
    expect(B3_FT * floor990).toBeGreaterThan(600);  // ≈630 px — "two thirds"
  });

  it("keeps the control's own size exported — the cluster renders from it, the gate no longer does", () => {
    expect(FEAT_CTRL_R).toBe(9);
    expect(FEAT_CTRL_STROKE).toBe(1.75);
    expect(FEAT_EDIT_MIN_PX).toBeCloseTo(19.75, 10);
    // The bump-out's dimensions still exist; they are simply no longer an input here.
    expect(DOGEAR_W).toBe(55);
    expect(DOGEAR_D).toBe(60);
  });
});

describe("the VIEWPORT cap — the same threshold put a bigger share of a smaller screen under the building", () => {
  it("is the earlier of the absolute floor and a quarter of the canvas across a reference span", () => {
    expect(FEAT_EDIT_REF_SPAN_FT).toBe(800);
    expect(FEAT_EDIT_MAX_CANVAS_FRAC).toBe(0.25);
    // Arithmetically the cap binds below `ABS × REF ÷ FRAC` px of canvas and nowhere above it.
    const crossover = (FEAT_EDIT_MIN_PPF * FEAT_EDIT_REF_SPAN_FT) / FEAT_EDIT_MAX_CANVAS_FRAC;
    expect(crossover).toBe(800);
    expect(featureEditFloorPpf(crossover + 1)).toBe(FEAT_EDIT_MIN_PPF);
    expect(featureEditFloorPpf(crossover - 200)).toBeLessThan(FEAT_EDIT_MIN_PPF);
  });

  it("leaves his 1600 px monitor on the absolute floor and arms his laptop sooner", () => {
    expect(featureEditFloorPpf(MONITOR_W)).toBe(FEAT_EDIT_MIN_PPF);
    expect(featureEditFloorPpf(LAPTOP_W)).toBeCloseTo(0.1769, 3);
    expect(featureEditFloorPpf(LAPTOP_W)).toBeLessThan(FEAT_EDIT_MIN_PPF);
  });

  it("makes the two screens agree about SHARE, which is what he was reacting to", () => {
    const share = (canvasW) => (B3_FT * featureEditFloorPpf(canvasW)) / canvasW;
    expect(share(MONITOR_W)).toBeLessThan(0.25);
    expect(share(LAPTOP_W)).toBeLessThan(0.30);
    expect(Math.abs(share(MONITOR_W) - share(LAPTOP_W))).toBeLessThan(0.05);
    // ⛔ MUTATION CHECK — the purely-absolute 0.359 rule, which HAS no canvas term: same threshold
    // on both screens, a third of one and half of the other. That spread is the defect.
    const shareAt994 = (canvasW) => (B3_FT * floor994) / canvasW;
    expect(shareAt994(LAPTOP_W)).toBeGreaterThan(0.45);
    expect(shareAt994(LAPTOP_W) - shareAt994(MONITOR_W)).toBeGreaterThan(0.15);
  });

  it("refuses an unreadable canvas rather than guessing a floor from it", () => {
    for (const bad of [undefined, null, NaN, 0, -800, Infinity]) {
      expect(featureEditFloorPpf(bad)).toBe(FEAT_EDIT_MIN_PPF);
    }
    // …and a degenerate sliver of a canvas is clamped, never taken to zero.
    expect(featureEditFloorPpf(1)).toBe(FEAT_EDIT_FLOOR_MIN_PPF);
    expect(featureEditFloorPpf(320)).toBeCloseTo(FEAT_EDIT_FLOOR_MIN_PPF, 10);
  });
});

describe("the owner's report", () => {
  it("shows NOTHING at whole-site zoom on his screens — and the pre-fix rule showed everything", () => {
    for (const w of [400, LAPTOP_W, 800, MONITOR_W]) {
      const ws = wholeSitePpf(w);
      expect(featureEditOpacity(ws, w), `whole-site on a ${w}px canvas`).toBe(0);
      // MUTATION CHECK 1: Building 3/4 on Bain are ~900 ft across, so the old gate armed here.
      expect(preFixArmed(900, ws), `pre-fix, ${w}px canvas`).toBe(true);
    }
  });

  it("⛔ the VIEWPORT term cannot drag the controls back to the overview zoom, at ANY width", () => {
    // The cap and whole-site zoom BOTH scale with the canvas, so their ratio is a constant — the
    // property that makes the new term safe. It is 1.48 on his ≈4,725 ft Bain frontage, on a phone
    // exactly as on a monitor, so a narrower screen moves the floor and the overview together.
    const capPpf = (w) => (FEAT_EDIT_MAX_CANVAS_FRAC * w) / FEAT_EDIT_REF_SPAN_FT;
    const ratios = [320, 400, LAPTOP_W, 700, 800, MONITOR_W, 1600].map((w) => capPpf(w) / wholeSitePpf(w));
    for (const r of ratios) expect(r).toBeCloseTo(BAIN_SPAN_FT / 3200, 10);
    expect(ratios[0]).toBeGreaterThan(1.4);
  });

  it("…and on a canvas wide enough to READ the whole site, the absolute floor governs — by design", () => {
    // Above ≈1,181 px of canvas his whole site fits at better than 4 ft/px, so the controls are
    // available at the overview zoom. That is the floor being ABSOLUTE, which is the property
    // #990 was asked to protect: a screen big enough to make the edit legible gets the edit. It is
    // not the reported defect, which was the controls arming where the bump-out was a few px wide.
    const crossW = FEAT_EDIT_MIN_PPF * BAIN_SPAN_FT;
    expect(crossW).toBeCloseTo(1181.25, 2);
    expect(featureEditOpacity(wholeSitePpf(crossW - 50), crossW - 50)).toBe(0);
    expect(featureEditOpacity(wholeSitePpf(crossW + 50), crossW + 50)).toBeGreaterThan(0);
  });

  it("AMENDMENT: the controls are back across the band BOTH superseded floors refused", () => {
    // Zooms admitted now and refused by 0.359 — on his monitor, where no viewport cap applies, so
    // this band is the absolute floor moving and nothing else.
    for (const ppf of [0.25, 0.28, 0.32, 0.355]) {
      expect(featureEditOpacity(ppf, MONITOR_W), `ppf ${ppf}`).toBeGreaterThan(0);
      // MUTATION CHECK 2: the #990 floor (44 px across the bump-out) said no at every one of these.
      expect(armed990(ppf), `#990 floor, ppf ${ppf}`).toBe(false);
      // MUTATION CHECK 3: so did #994's, which is the value this item replaces.
      expect(armed994(ppf), `#994 floor, ppf ${ppf}`).toBe(false);
    }
    // …and on the laptop the cap opens a further band beneath even that.
    for (const ppf of [0.18, 0.21, 0.24]) {
      expect(featureEditOpacity(ppf, LAPTOP_W), `laptop ppf ${ppf}`).toBeGreaterThan(0);
      expect(featureEditOpacity(ppf, MONITOR_W), `monitor ppf ${ppf}`).toBe(0); // …not on the monitor
    }
  });

  it("holds identically for a 30-acre site and a 900-acre one — SITE size is still no input", () => {
    // Same zoom, same canvas, wildly different buildings: the answer is the zoom's and the
    // screen's, never the drawing's.
    for (const buildingFt of [120, 500, 900, 2000]) {
      expect(preFixArmed(buildingFt, 0.2)).toBe(buildingFt * 0.2 >= 72); // the old rule DID vary
      expect(featureEditOpacity(0.2, MONITOR_W)).toBe(0);                // the new one does not
      expect(featureEditOpacity(0.4, MONITOR_W)).toBeGreaterThan(0);
    }
  });
});

describe("it fades in rather than popping", () => {
  for (const [label, w] of [["monitor", MONITOR_W], ["laptop", LAPTOP_W], ["no canvas", undefined]]) {
    it(`appears faint at the floor and reaches full strength across the ramp (${label})`, () => {
      const floor = featureEditFloorPpf(w);
      expect(featureEditOpacity(floor, w)).toBeCloseTo(FEAT_EDIT_MIN_OPACITY, 10);
      expect(featureEditOpacity(floor * (1 + FEAT_EDIT_FADE_SPAN), w)).toBeCloseTo(1, 10);
      expect(featureEditOpacity(floor * 4, w)).toBe(1); // clamped, never above 1
    });

    it(`is monotonic in zoom and never lands between 0 and the floor opacity (${label})`, () => {
      let prev = -1;
      for (let ppf = 0.05; ppf < 4; ppf += 0.01) {
        const o = featureEditOpacity(ppf, w);
        expect(o === 0 || o >= FEAT_EDIT_MIN_OPACITY).toBe(true); // no invisible-but-clickable band
        expect(o).toBeGreaterThanOrEqual(prev === -1 ? 0 : prev);
        prev = o;
      }
    });
  }

  it("refuses a nonsense zoom rather than rendering at one", () => {
    for (const bad of [NaN, Infinity, -1, 0, undefined, null]) {
      expect(featureEditOpacity(bad, MONITOR_W)).toBe(0);
    }
  });
});

describe("both clusters are wired to it, and to the RENDER view AND the canvas width", () => {
  const body = stripComments(planner);

  it("the gate is computed once, from `rppf` and the canvas width", () => {
    // `view.ppf` here would fade against the settled zoom while the picture is mid-gesture at
    // another one (/CLAUDE.md → the view anchor: every ppf in the RENDER BODY is `rppf`).
    // `size.w` is the measured canvas — the viewport half of the floor.
    expect(body).toContain("const featEditOpacity = featureEditOpacity(rppf, size.w);");
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

  it("the control renders FROM the exported disc constants — no second copy of its size", () => {
    // If the disc's radius or keyline were re-hardcoded here, the cluster could draw a control the
    // library does not describe. Both defaults and every stroke width read the exported values.
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
