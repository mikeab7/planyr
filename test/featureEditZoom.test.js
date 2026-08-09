/* NEW-2 — the on-building edit controls arm on a ZOOM threshold derived from the smallest thing
 * they edit, not on how big the building is.
 *
 * The defect this pins: on the owner's 109-acre Bain plan, with the WHOLE SITE in the viewport, the
 * green + and red − rendered at full size over the two largest buildings on the drawing, while the
 * bump-out one of them places was a few pixels wide. B225's gate could not see it — it asks whether
 * the BUILDING has room for the cluster, and a 900 ft building has room at almost any zoom a site
 * plan is read at. The two gates measure different things and both must pass.
 *
 * ⛔ THE MUTATION CHECK IS THE POINT OF THE FIRST BLOCK: the pre-fix rule (no zoom gate at all) is
 * replayed verbatim, and it must DISAGREE at the owner's own zoom. A guard that passes on both the
 * old and the new implementation is not guarding anything.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOGEAR_W, DOGEAR_D } from "../src/workspaces/site-planner/lib/dogEar.js";
import {
  FEAT_EDIT_MIN_PX, FEAT_EDIT_MIN_PPF, FEAT_EDIT_MAX_FT_PER_PX, FEAT_EDIT_MIN_OPACITY,
  FEAT_EDIT_FADE_SPAN, featureEditOpacity,
} from "../src/workspaces/site-planner/lib/featureEditZoom.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const planner = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* The owner's reported view, reconstructed from the scale bar he photographed (0–1,000 FEET across
 * a bar a couple of hundred pixels wide) and from a 109-acre site fitting the viewport. Anything in
 * this band is "the whole site on screen" and must show no edit controls at all. */
const WHOLE_SITE_PPF = [0.15, 0.25, 0.4, 0.58];
/* The pre-fix rule, verbatim: the ONLY gate was the building's own footprint in px. */
const preFixArmed = (buildingFt, ppf) => buildingFt * ppf >= 72;

describe("the threshold is derived from the bump-out, and stated", () => {
  it("is 44 px across a bump-out's short side — 0.8 px/ft, i.e. 1.25 ft per pixel", () => {
    expect(FEAT_EDIT_MIN_PX).toBe(44);
    expect(DOGEAR_W).toBe(55);           // the derivation's input; if this moves, the threshold moves with it
    expect(DOGEAR_D).toBe(60);
    expect(FEAT_EDIT_MIN_PPF).toBeCloseTo(0.8, 10);
    expect(FEAT_EDIT_MAX_FT_PER_PX).toBeCloseTo(1.25, 10);
  });

  it("puts the control INSIDE its own subject: at the floor a bump-out is bigger than the disc", () => {
    // The control is an 18 px disc (r = 9). The thing it places must never be smaller than it.
    expect(DOGEAR_W * FEAT_EDIT_MIN_PPF).toBeGreaterThan(18 * 2);
    expect(DOGEAR_D * FEAT_EDIT_MIN_PPF).toBeGreaterThan(18 * 2);
  });
});

describe("the owner's report", () => {
  it("shows NOTHING at whole-site zoom — and the pre-fix rule showed everything", () => {
    for (const ppf of WHOLE_SITE_PPF) {
      expect(featureEditOpacity(ppf), `ppf ${ppf}`).toBe(0);
      // MUTATION CHECK: Building 3/4 on Bain are ~900 ft across, so the old gate armed here.
      expect(preFixArmed(900, ppf), `pre-fix, ppf ${ppf}`).toBe(true);
    }
  });

  it("holds identically for a 30-acre site and a 900-acre one — it is absolute zoom", () => {
    // Same zoom, wildly different buildings: the answer is the zoom's, never the building's.
    for (const buildingFt of [120, 500, 900, 2000]) {
      expect(preFixArmed(buildingFt, 0.6)).toBe(buildingFt * 0.6 >= 72); // the old rule DID vary
      expect(featureEditOpacity(0.6)).toBe(0);                            // the new one does not
      expect(featureEditOpacity(1.4)).toBeGreaterThan(0);
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
});
