/* ⛔ NEW-6 (B435536) — A FEATURE'S NAME LABEL MAY NEVER RENDER WIDER THAN THE FEATURE IT NAMES.
 *
 * Owner report with a screenshot, 8 South / Concept A (`smqiljx5fngg`) at whole-site zoom: the
 * easement label `CONVEYANCE CHANNEL 2 DIVERSION` drawn across the plan in large type while every
 * other label on the drawing was microscopic. The frame was measured live with
 * `data-view-ppf === data-render-ppf`, so it is a real frame and not a stale-frame artifact
 * (FOREGROUND-OR-VOID).
 *
 * THE NUMBERS BELOW ARE HIS, and the fixture is the real production row — read back from
 * `public.site_elements` while writing this, not retyped from the report:
 *
 *     element  e1454917vfjirh   markup / easement, mode centerline, width 60
 *     centerline (790.69, 902.86) → (1303.47, 889.25)          ≈ 512.96 ft
 *     labelOverride "CONVEYANCE CHANNEL 2 DIVERSION"           30 characters
 *     at ppf 0.04159 the geometry rendered 21 × 3 CSS px
 *     its label rendered font-size 10.5 px, 199 px wide        9.5× the feature it names
 *     every neighbouring label computed to 1.54 / 2.38 / 2.72 / 3.74 / 4.08 px
 *
 * ⛔ THE NEIGHBOURS ARE THE PROOF THAT THE RAMP IS THE RIGHT ONE, and they are asserted below.
 * Those five sizes are not arbitrary: they are exactly `base × 0.34` for the bases actually on that
 * plan (labelSize 7 → 2.38, 8 → 2.72, the default 11 → 3.74, 12 → 4.08). The easement label alone
 * rode no ramp at all. So this suite does NOT invent a threshold — it asserts that the easement
 * label now lands in the same family as its neighbours.
 */
import { describe, it, expect } from "vitest";
import {
  featureNameLabelVisible,
  featureNameFontPx,
  featureExtentFt,
  labelTextWidthPx,
  LABEL_CHAR_W_RATIO,
  DETAIL_LABEL_MIN_PX,
  DIM_CALLOUT_MIN_PPF,
  dimFontScale,
  dimCalloutVisible,
  detailLabelVisible,
} from "../src/workspaces/site-planner/lib/labelLayout.js";

/* The owner's own row (production, `smqiljx5fngg` / `e1454917vfjirh`). The `pts` are the drawn
 * 60 ft strip; the centreline is what gives it its length. Verbatim — do not "tidy" the numbers. */
const CONVEYANCE = {
  label: "CONVEYANCE CHANNEL 2 DIVERSION",
  pts: [
    { x: 791.485967590727, y: 932.8494387342363 },
    { x: 1304.2659675907269, y: 919.2394387342363 },
    { x: 1302.6740324092732, y: 859.2605612657637 },
    { x: 789.8940324092731, y: 872.8705612657637 },
  ],
};
const REPORTED_PPF = 0.04159;   // his measured whole-site zoom
const EASE_BASE_PX = 10.5;      // the historic constant, now a base rather than a final size

describe("NEW-6 · the reported frame", () => {
  it("reproduces the owner's measured feature size and label width on the OLD rule", () => {
    const lengthFt = featureExtentFt(CONVEYANCE.pts);
    expect(lengthFt).toBeGreaterThan(510);
    expect(lengthFt).toBeLessThan(516);                       // ≈ 513 ft, as reported

    const featurePx = lengthFt * REPORTED_PPF;
    expect(featurePx).toBeGreaterThan(20.5);
    expect(featurePx).toBeLessThan(21.5);                     // the reported 21 px

    /* The OLD rule: a flat 10.5 px, no ramp. Against the browser-measured width of 199-201 px for
     * this exact string at this exact size, the estimate lands within a few percent — which is what
     * licenses using an estimate in the render body instead of a per-frame layout read. */
    const oldWidth = labelTextWidthPx(CONVEYANCE.label, EASE_BASE_PX);
    expect(oldWidth).toBeGreaterThan(190);
    expect(oldWidth).toBeLessThan(230);
    expect(oldWidth / featurePx).toBeGreaterThan(8);          // he reported 9.5×
  });

  it("HIDES the label on the reported frame — the fix", () => {
    expect(featureNameLabelVisible(CONVEYANCE.label, featureExtentFt(CONVEYANCE.pts), REPORTED_PPF, EASE_BASE_PX)).toBe(false);
  });

  it("⛔ MUTATION CHECK — the pre-fix rule SHOWS it, so this suite can fail", () => {
    // The shipped predicate, verbatim as it was: selection bypassed even the declutter floor.
    const preFix = (isSel, ppf) => isSel || dimCalloutVisible(ppf);
    expect(preFix(true, REPORTED_PPF)).toBe(true);            // …which is exactly the bug
    expect(featureNameLabelVisible(CONVEYANCE.label, featureExtentFt(CONVEYANCE.pts), REPORTED_PPF, EASE_BASE_PX)).toBe(false);
  });

  it("SELECTION does not lift the gate — there is no selected-only escape hatch", () => {
    /* Asserted structurally: the predicate takes no `selected` option at all, unlike
     * `measureLabelVisible`, whose `selected` bypass is correct for a measurement (a small object
     * whose number is the point of selecting it) and wrong for a name across a whole plan. */
    expect(featureNameLabelVisible.length).toBeLessThanOrEqual(5);
    const withJunk = featureNameLabelVisible(CONVEYANCE.label, featureExtentFt(CONVEYANCE.pts), REPORTED_PPF, EASE_BASE_PX, { selected: true, isSel: true });
    expect(withJunk).toBe(false);
  });

  it("reveals once the label genuinely fits, and the reveal is DRIVEN BY the fit", () => {
    const lengthFt = featureExtentFt(CONVEYANCE.pts);
    const shown = [];
    for (let ppf = 0.02; ppf <= 1.2; ppf += 0.002) {
      if (featureNameLabelVisible(CONVEYANCE.label, lengthFt, ppf, EASE_BASE_PX)) shown.push(ppf);
    }
    expect(shown.length).toBeGreaterThan(0);                  // it is not simply switched off
    const first = shown[0];
    expect(first).toBeGreaterThanOrEqual(DIM_CALLOUT_MIN_PPF); // never below the shared floor
    // and at the reveal, the label really does fit the feature
    expect(labelTextWidthPx(CONVEYANCE.label, featureNameFontPx(first, EASE_BASE_PX))).toBeLessThanOrEqual(lengthFt * first + 1e-9);
  });

  it("a SHORTER name on the SAME feature reveals no later — length is what waits", () => {
    const lengthFt = featureExtentFt(CONVEYANCE.pts);
    const firstAt = (text) => {
      for (let ppf = 0.02; ppf <= 4; ppf += 0.002) if (featureNameLabelVisible(text, lengthFt, ppf, EASE_BASE_PX)) return ppf;
      return Infinity;
    };
    expect(firstAt("60′ Storm")).toBeLessThanOrEqual(firstAt(CONVEYANCE.label));
  });
});

describe("NEW-6 · the size rides the SHARED ramp, not a new constant", () => {
  it("is exactly the dimension-number ramp — no fourth threshold was introduced", () => {
    for (const ppf of [0.02, 0.04159, 0.1, 0.18, 0.3, 0.45, 0.9, 4]) {
      expect(featureNameFontPx(ppf, EASE_BASE_PX)).toBeCloseTo(EASE_BASE_PX * dimFontScale(ppf), 10);
    }
  });

  it("lands in the same family as the owner's measured neighbours", () => {
    /* His five measured neighbour sizes at ppf 0.04159, and the bases that produce them. The
     * easement label at the same zoom used to be 10.5 — 2.6× to 6.8× its neighbours. */
    const NEIGHBOURS = [1.54, 2.38, 2.72, 3.74, 4.08];
    const now = featureNameFontPx(REPORTED_PPF, EASE_BASE_PX);
    expect(now).toBeLessThan(EASE_BASE_PX);                    // it scales at all now
    expect(now).toBeLessThan(Math.max(...NEIGHBOURS) * 1.5);   // and is no longer an outlier
    // the old value was the outlier it was reported as
    expect(EASE_BASE_PX / Math.max(...NEIGHBOURS)).toBeGreaterThan(2.5);
  });

  it("⛔ is NOT fixed by shrinking to a smaller constant — the size must MOVE with zoom", () => {
    const a = featureNameFontPx(0.2, EASE_BASE_PX);
    const b = featureNameFontPx(0.45, EASE_BASE_PX);
    const c = featureNameFontPx(0.9, EASE_BASE_PX);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThanOrEqual(b);                       // clamped at 1× above working zoom
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);        // a constant would fail here
  });
});

describe("NEW-6 · the fit rule itself", () => {
  const LONG = "A".repeat(40);

  it("never returns true when the estimated label is wider than the feature", () => {
    for (const ft of [40, 120, 513, 2000]) {
      for (let ppf = 0.02; ppf <= 6; ppf += 0.01) {
        if (!featureNameLabelVisible(LONG, ft, ppf, EASE_BASE_PX)) continue;
        expect(labelTextWidthPx(LONG, featureNameFontPx(ppf, EASE_BASE_PX))).toBeLessThanOrEqual(ft * ppf + 1e-9);
      }
    }
  });

  it("reuses the two existing gates rather than re-deriving them", () => {
    // below the shared declutter floor: never, whatever the fit says
    expect(featureNameLabelVisible("x", 100000, DIM_CALLOUT_MIN_PPF - 0.001, EASE_BASE_PX)).toBe(false);
    // a feature that is still a tick rather than a band: never (B149's rule)
    const tickPpf = 0.5;
    const tickFt = (DETAIL_LABEL_MIN_PX - 1) / tickPpf;
    expect(detailLabelVisible(tickFt, tickPpf)).toBe(false);
    expect(featureNameLabelVisible("x", tickFt, tickPpf, EASE_BASE_PX)).toBe(false);
  });

  it("`sheet` lifts ONLY the screen-declutter floor, never the fit", () => {
    /* The export rule: a zoom-declutter gate lifts on paper, a physical-room gate does not.
     * ppf 0.07 is chosen so the two gates DISAGREE — below the 0.18 declutter floor, but the
     * 513 ft feature already projects past the 30 px band threshold, so only the floor is in the
     * way. (At 0.05 the band gate blocks it too and the case would prove nothing.) */
    const SHEET_PPF = 0.07;
    expect(513 * SHEET_PPF).toBeGreaterThan(DETAIL_LABEL_MIN_PX);
    expect(SHEET_PPF).toBeLessThan(DIM_CALLOUT_MIN_PPF);
    expect(featureNameLabelVisible("60′", 513, SHEET_PPF, EASE_BASE_PX)).toBe(false);
    expect(featureNameLabelVisible("60′", 513, SHEET_PPF, EASE_BASE_PX, { sheet: true })).toBe(true);
    // …but a label that cannot fit still cannot print, sheet or no sheet
    expect(featureNameLabelVisible(LONG, 513, SHEET_PPF, EASE_BASE_PX, { sheet: true })).toBe(false);
    // nor does `sheet` lift the band gate — a tick is still a tick on paper
    expect(featureNameLabelVisible("60′", 20, 0.5, EASE_BASE_PX, { sheet: true })).toBe(false);
  });

  it("refuses every unusable input rather than guessing", () => {
    for (const bad of [null, undefined, NaN, Infinity, -1, 0]) {
      expect(featureNameLabelVisible("x", bad, 0.5, EASE_BASE_PX)).toBe(false);
      expect(featureNameLabelVisible("x", 513, bad, EASE_BASE_PX)).toBe(false);
    }
    expect(featureNameLabelVisible("", 513, 0.5, EASE_BASE_PX)).toBe(true);   // an empty name costs no width
  });
});

describe("NEW-6 · featureExtentFt", () => {
  it("is the GREATEST extent, so orientation does not change when a name appears", () => {
    const horiz = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 10 }, { x: 0, y: 10 }];
    const vert = horiz.map((p) => ({ x: p.y, y: p.x }));
    expect(featureExtentFt(horiz)).toBeCloseTo(500, 9);
    expect(featureExtentFt(vert)).toBeCloseTo(500, 9);
    expect(featureNameLabelVisible("Storm Esmt", featureExtentFt(horiz), 0.4, EASE_BASE_PX))
      .toBe(featureNameLabelVisible("Storm Esmt", featureExtentFt(vert), 0.4, EASE_BASE_PX));
  });

  it("returns 0 for anything unusable — which reads as 'cannot fit' and hides the label", () => {
    for (const bad of [null, undefined, [], [{}], [{ x: NaN, y: 1 }]]) expect(featureExtentFt(bad)).toBe(0);
    expect(featureNameLabelVisible("x", featureExtentFt(null), 4, EASE_BASE_PX)).toBe(false);
  });
});

describe("NEW-6 · the character-width ratio is MEASURED, and its bound is recorded", () => {
  /* Measured in Chromium against this app's own built stylesheet (Inter, font-weight 700, via
   * getBBox().width) at font sizes 4 / 6 / 8 / 10.5 / 14 px. These are observations, pinned here so
   * a future change to the constant has to argue with the measurement rather than with a guess. */
  const MEASURED = {
    "CONVEYANCE CHANNEL 2 DIVERSION": [0.6250, 0.6444],
    "LATERAL 10 (PHASE 2 MDP)": [0.5764, 0.6146],
    "60′ Storm Sewer Esmt": [0.5313, 0.5583],
    "Drainage Easement": [0.5294, 0.5686],
    "50′ Utility Esmt": [0.4531, 0.4896],
  };
  const PATHOLOGICAL = [1.0125, 1.0714];   // a run of the widest glyph, all caps

  it("over-predicts every realistic label — the safe direction for a 'never wider' rule", () => {
    for (const [text, [lo, hi]] of Object.entries(MEASURED)) {
      expect(hi).toBeLessThan(LABEL_CHAR_W_RATIO);
      expect(lo).toBeLessThan(LABEL_CHAR_W_RATIO);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("⛔ is NOT an upper bound for a pathological string, and says so rather than pretending", () => {
    /* A run of the widest glyph measures above the constant, so such a label reveals slightly EARLY.
     * Recorded deliberately: the alternative is a per-frame layout read in the render body, which
     * this repo's view-independence rules do not permit. It can never be the 9.5× case. */
    expect(Math.min(...PATHOLOGICAL)).toBeGreaterThan(LABEL_CHAR_W_RATIO);
    const worstOver = Math.max(...PATHOLOGICAL) / LABEL_CHAR_W_RATIO;
    expect(worstOver).toBeLessThan(1.6);    // bounded: at worst ~1.6× the estimate, never 9.5×
  });

  it("scales linearly with font size, so one ratio serves every zoom", () => {
    expect(labelTextWidthPx("abcd", 10)).toBeCloseTo(labelTextWidthPx("abcd", 5) * 2, 9);
    expect(labelTextWidthPx("abcd", 8)).toBeCloseTo(4 * 8 * LABEL_CHAR_W_RATIO, 9);
  });
});
