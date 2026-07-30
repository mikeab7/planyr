/* NEW-1 / NEW-2 / NEW-3 — the setback chip, made readable and made quiet.
 *
 * The B1184 grouping fix worked (thirty-plus chips down to four on the owner's Weld County
 * parcel, site sms7v3ua7ksy), so this is the SAME surface's remaining three problems, reported
 * 2026-07-30:
 *
 *   NEW-1  the chip's numerals inherited the setback LINE's colour, so a bright-green setback
 *          line produced bright-green text on a white plate — "I thought we talked about the text
 *          just being black… when I clicked reset setback line then the text went black".
 *   NEW-2  zoomed out to where the whole 62-acre parcel is a thumbnail, one full-size chip was
 *          still the loudest thing on the screen: both existing guards are RELATIVE to the
 *          parcel, so the longest edge clears them at any zoom.
 *   NEW-3  four saturated "Side · 25′" pills are too much information on a lot whose setback is
 *          the same number all the way round.
 *
 * These tests pin the pure decisions. The colour rule is a rendering fact, so it is pinned as a
 * CONTRAST floor on the tokens the chip actually uses, in both themes.
 */
import { describe, it, expect } from "vitest";
import {
  setbackChipsVisible, chipRoleWords,
  CHIP_MIN_EDGE_PX, CHIP_MIN_SEP_PX,
} from "../src/workspaces/site-planner/lib/setbackChips.js";
import { DIM_CALLOUT_MIN_PPF, dimCalloutVisible } from "../src/workspaces/site-planner/lib/labelLayout.js";
import { PALETTES } from "../src/shared/theme/palette.js";
import { readFileSync } from "node:fs";

// --- NEW-1: the chip's ink is a theme token, and it is legible on the chip's plate ------------

/* WCAG 2.x relative luminance + contrast ratio, from the same sRGB formula `ui-audit/
 * contrast-audit.mjs` applies to the CSS tokens. The chip is drawn in SVG, so its colours come
 * from the JS palette mirror rather than from `index.css` — which is exactly why it needs its own
 * guard: the CSS audit cannot see it. */
const lum = (hex) => {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("NEW-1 — chip numerals are always the high-contrast ink, never the user's line colour", () => {
  const PLATE = "#ffffff"; // the chip plate, deliberately white in BOTH themes (a drafting plate)

  it("clears WCAG AA on the chip plate in light AND dark", () => {
    for (const theme of ["light", "dark"]) {
      const ink = PALETTES[theme].canvasChipInk;
      expect(ink, `${theme} canvasChipInk`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(ink, PLATE), `${theme} chip ink on plate`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the ink is the SAME token in both themes — the plate never flips, so the ink must not either", () => {
    expect(PALETTES.light.canvasChipInk).toBe(PALETTES.dark.canvasChipInk);
  });

  /* The regression this replaces: the text used to be `fill={pc.sbStroke || PAL.chipInk}`, so its
   * contrast was a function of a DECORATION. These are real colours a user can pick from the
   * setback-line colour field, and every one of them fails on the plate — which is why "darken the
   * user's colour" was rejected as the fix in favour of the ink token. */
  it.each([
    ["bright green", "#22c55e"],
    ["pale yellow", "#fde68a"],
    ["near white", "#f8fafc"],
    ["cyan", "#22d3ee"],
  ])("a user's %s setback line would be illegible as chip text", (_name, col) => {
    expect(contrast(col, PLATE)).toBeLessThan(4.5);
    // …and the ink we render instead is legible, whatever the line colour is.
    expect(contrast(PALETTES.light.canvasChipInk, PLATE)).toBeGreaterThanOrEqual(4.5);
  });
});

// --- NEW-2: the absolute zoom floor ----------------------------------------------------------

describe("NEW-2 — setback chips drop out at overview zoom", () => {
  const WORKING_PPF = 0.35;        // the default working zoom
  const COUNTY_PPF = 0.02;         // the owner's second screenshot: a 62-acre parcel as a thumbnail

  it("hides at county zoom and shows at working zoom", () => {
    expect(setbackChipsVisible(COUNTY_PPF)).toBe(false);
    expect(setbackChipsVisible(WORKING_PPF)).toBe(true);
  });

  it("rides the SAME shared floor as every other callout and dimension", () => {
    expect(setbackChipsVisible(DIM_CALLOUT_MIN_PPF)).toBe(dimCalloutVisible(DIM_CALLOUT_MIN_PPF));
    expect(setbackChipsVisible(DIM_CALLOUT_MIN_PPF - 0.001)).toBe(false);
    expect(setbackChipsVisible(DIM_CALLOUT_MIN_PPF)).toBe(true);
    // Reveals together with them on zoom-in, rather than standing alone over an empty county.
    for (const ppf of [0.01, 0.05, 0.1, 0.18, 0.25, 0.4, 1.2]) {
      expect(setbackChipsVisible(ppf)).toBe(dimCalloutVisible(ppf));
    }
  });

  it("a parcel whose setbacks are being EDITED keeps its chips at any zoom — the one exception", () => {
    expect(setbackChipsVisible(COUNTY_PPF, { editing: true })).toBe(true);
    expect(setbackChipsVisible(0.0001, { editing: true })).toBe(true);
  });

  /* The floor is ABSOLUTE where the two shipped guards are RELATIVE — this is why B1184's guards
   * could not have fixed it. On a 62-acre lot the longest run is ~1,700 ft, which clears the
   * on-screen edge bar at county zoom with room to spare, so exactly one chip always survived. */
  it("the relative edge guard alone cannot hide a big parcel's longest chip", () => {
    const longestRunFt = 1700;
    expect(longestRunFt * COUNTY_PPF).toBeGreaterThan(CHIP_MIN_EDGE_PX);
    expect(CHIP_MIN_SEP_PX).toBeGreaterThan(0);       // and separation never applies to a lone chip
    expect(setbackChipsVisible(COUNTY_PPF)).toBe(false);
  });
});

// --- NEW-3: the role word drops where it is redundant ----------------------------------------

const chip = (role, value, priority = 1) => ({ role, value, priority });

describe("NEW-3 — chipRoleWords: a chip is a control, not a headline", () => {
  it("a uniform parcel shows NO role words — the number is the same everywhere", () => {
    // The owner's Weld lot after B1184: four chips, one 25 ft setback all the way round.
    const items = [chip("front", 25, 900), chip("side", 25, 500), chip("rear", 25, 880), chip("side", 25, 480)];
    expect(chipRoleWords(items)).toEqual([false, false, false, false]);
  });

  it("a single chip never carries a role word", () => {
    expect(chipRoleWords([chip("rear", 25)])).toEqual([false]);
    expect(chipRoleWords([])).toEqual([]);
  });

  it("does not repeat one role three times down one boundary", () => {
    // Three rear runs at 25, plus a 40 ft front: the front makes the parcel non-uniform, so rule
    // (b) applies — the LONGEST rear keeps the word, its two siblings drop to the bare value.
    const items = [chip("front", 40, 900), chip("rear", 25, 300), chip("rear", 25, 500), chip("rear", 25, 200)];
    expect(chipRoleWords(items)).toEqual([true, false, true, false]);
  });

  it("keeps the word on every run of a role whose runs carry DIFFERENT values", () => {
    // Here the role is the only thing distinguishing two different numbers, so it must stay.
    const items = [chip("front", 40, 900), chip("side", 25, 500), chip("side", 10, 400)];
    expect(chipRoleWords(items)).toEqual([true, true, true]);
  });

  it("a mixed run (no single value) is not collapsed away by the uniform rule", () => {
    const items = [chip("front", 25, 900), chip("side", null, 500)];
    expect(chipRoleWords(items)).toEqual([true, true]);
    // …but two mixed runs and nothing else genuinely ARE all the same reading.
    expect(chipRoleWords([chip("front", null, 9), chip("rear", null, 8)])).toEqual([false, false]);
  });

  it("the surviving word lands on the most legible chip (the longest anchor edge)", () => {
    const items = [chip("front", 40, 900), chip("side", 25, 10), chip("side", 25, 999)];
    const words = chipRoleWords(items);
    expect(words[2]).toBe(true);
    expect(words[1]).toBe(false);
  });

  it("is pure — the input array is never mutated", () => {
    const items = [chip("rear", 25, 5), chip("rear", 25, 9), chip("front", 40, 900)];
    const snapshot = JSON.parse(JSON.stringify(items));
    chipRoleWords(items);
    expect(items).toEqual(snapshot);
  });
});

// --- NEW-4: the selected lot's setback chrome renders ABOVE the site elements -----------------

/* Owner, 2026-07-30: "it's annoying if I have a building already there because now I can't edit it
 * because it's behind the building. If I'm already doing the work of clicking on the parcel, then
 * the options to edit the setbacks should be above the elements."
 *
 * Paint order in an SVG is document order, so this is a structural fact about SitePlanner.jsx, not
 * a computable one — hence a source guard. The live click-through is V###. */
describe("NEW-4 — setback chrome is raised into the selection-chrome layer", () => {
  const SRC = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  const at = (needle) => {
    const i = SRC.indexOf(needle);
    expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("the chips and the grab band render after the element pass", () => {
    const elements = at("{/* elements (drawn in PIXELS");
    expect(at("{setbackChipNodes}")).toBeGreaterThan(elements);
    expect(at("{setbackGrabNode}")).toBeGreaterThan(elements);
  });

  it("…inside the export-stripped HANDLE LAYER, ahead of the vertex handles", () => {
    const chrome = at('<g data-export="skip" data-handle-layer="1">');
    const grab = at("{setbackGrabNode}");
    const chips = at("{setbackChipNodes}");
    expect(grab).toBeGreaterThan(chrome);
    expect(chips).toBeGreaterThan(grab);            // the band first, so a chip keeps its own click
    expect(at("{parcelHandles}")).toBeGreaterThan(chips);  // handles last — the smallest targets win
  });

  it("moving layer did not start printing it — the chips are still export-skipped", () => {
    expect(SRC).toContain('return <g data-export="skip">{shown.map((c) => pill(');
    // The raised band lives inside the chrome group, which is itself data-export="skip".
    expect(SRC).toContain('data-testid="setback-grab"');
  });

  it("only the INTERACTIVE chrome moved — the ring, its casing and the fill stay in the parcel band", () => {
    const chrome = at('<g data-export="skip" data-handle-layer="1">');
    expect(at('data-testid="setback-ring"')).toBeLessThan(chrome);
    expect(at('data-testid="setback-casing"')).toBeLessThan(chrome);
    expect(at('data-testid="parcel-outline"')).toBeLessThan(chrome);
  });

  /* NEW-1's own guard is `test/setbackChipInk.test.js` (the `setbackChipStyle` source guard that
     landed on main while this was in flight, and which goes one step further than this item by
     taking the border off the line colour too). What is asserted HERE is the part NEW-3 added on
     top: the ink is never re-derived from the parcel, and the border is softened by OPACITY rather
     than by picking a lighter colour — which is what keeps it a neutral hairline. */
  it("the chip's TEXT and border read the ink token, never the parcel's line colour (NEW-1)", () => {
    expect(SRC).toContain('fill={chipStyle.text} fontWeight="600">{txt}</text>');
    expect(SRC).toContain('stroke={chipStyle.stroke} strokeWidth={1} strokeOpacity={0.5}');
    expect(SRC).not.toContain('fill={sbCol}');                       // the regression
    expect(SRC).not.toContain('const sbCol = selParcel.sbStroke');   // …and its source
  });
});
