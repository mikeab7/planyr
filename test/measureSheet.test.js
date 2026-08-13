/* NEW-1 — a measurement on a SHEET: the value always prints, the editing discs never do, and a
 * measurement is never printed without its number.
 *
 * The owner's Sylvestri sheet is the repro this suite encodes: exported from a whole-site zoom, each
 * length measurement printed as two fat discs joined by a stub, with the number nowhere on the page.
 * Three independent defects had to line up for that, and each gets its own case below:
 *   (a) the value label was zoom-gated, so at that zoom it was not in the DOM the sheet clones;
 *   (b) the endpoint discs had NO gate and constant screen-px sizing, so they kept their size while
 *       the drawing shrank to fit several hundred acres; and
 *   (c) nothing anywhere asserted that geometry without a value must not print at all.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  terminatorTicks, terminatedMode, TERMINATED_MODES, TERMINATOR_HALF_PX, TERMINATOR_WEIGHT_PX,
  sheetMeasureVerdict, enforceMeasureValueOnSheet, droppedMeasureWarning,
  MEASURE_GROUP_ATTR, MEASURE_MODE_ATTR, MEASURE_VERTEX_ATTR, MEASURE_TERM_ATTR, CHIP_TEXT_ATTR,
} from "../src/workspaces/site-planner/lib/measureSheet.js";
import { measureLabelVisible, measureLabelThreshold } from "../src/workspaces/site-planner/lib/measureStyle.js";
import { DIM_CALLOUT_MIN_PPF } from "../src/workspaces/site-planner/lib/labelLayout.js";

const SP = fs.readFileSync(path.join(process.cwd(), "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
const EXPORT_SHEET = fs.readFileSync(path.join(process.cwd(), "src/workspaces/site-planner/lib/exportSheet.js"), "utf8");

/* ---------------------------------------------------------------- (a) the value is never gated off
 * an export. B1152 let the user pin a per-measurement reveal zoom; that pin governs the CANVAS. */
describe("(a) an export is a document, not a screenshot — the value ignores every zoom gate", () => {
  const floor = DIM_CALLOUT_MIN_PPF;
  // The owner's case: zoomed right out to see a whole multi-parcel site before printing.
  const wideZoom = 0.04;

  it("below the shared floor the label is hidden on the canvas and SHOWN on the sheet", () => {
    const m = { id: "m1" };
    expect(measureLabelVisible(m, wideZoom, { globalFloor: floor })).toBe(false);
    expect(measureLabelVisible(m, wideZoom, { globalFloor: floor, sheet: true })).toBe(true);
  });

  it("a per-measurement reveal zoom (B1152) governs the canvas ONLY — the sheet overrides it", () => {
    const pinned = { id: "m2", labelPpf: 2 }; // "Close in" — hidden at any normal working zoom
    expect(measureLabelThreshold(pinned, {}, floor)).toBe(2);
    expect(measureLabelVisible(pinned, 0.35, { globalFloor: floor })).toBe(false);
    expect(measureLabelVisible(pinned, 0.35, { globalFloor: floor, sheet: true })).toBe(true);
    // Even at the very bottom of the planner's zoom range.
    expect(measureLabelVisible(pinned, 0.02, { globalFloor: floor, sheet: true })).toBe(true);
  });

  it("a Standards-level reveal zoom is overridden on the sheet too", () => {
    const settings = { measureStyle: { labelPpf: 1.5 } };
    expect(measureLabelVisible({}, wideZoom, { settings, globalFloor: floor })).toBe(false);
    expect(measureLabelVisible({}, wideZoom, { settings, globalFloor: floor, sheet: true })).toBe(true);
  });

  it("screen behaviour is byte-identical when `sheet` is absent (no regression for the canvas)", () => {
    for (const ppf of [0.02, 0.1, floor, 0.35, 3]) {
      expect(measureLabelVisible({}, ppf, { globalFloor: floor })).toBe(ppf >= floor);
    }
  });

  it("the renderer passes the sheet flag from the label frame, not from a local guess", () => {
    expect(SP).toMatch(/measureLabelVisible\(m, labelPpf, \{[^}]*sheet: labelFrame\.sheet/);
  });
});

/* --------------------------------------------------------- (b) drafting terminators, not discs */
describe("(b) the endpoint markers are an editing affordance — the sheet gets drafting ticks", () => {
  it("an open run gets exactly two ticks, one per end, centred on the end point", () => {
    const ticks = terminatorTicks([{ x: 0, y: 0 }, { x: 100, y: 0 }], { halfPx: 5 });
    expect(ticks).toHaveLength(2);
    for (const [i, t] of ticks.entries()) {
      const end = i === 0 ? { x: 0, y: 0 } : { x: 100, y: 0 };
      expect((t.x1 + t.x2) / 2).toBeCloseTo(end.x, 6);
      expect((t.y1 + t.y2) / 2).toBeCloseTo(end.y, 6);
    }
  });

  it("a tick is a 45° slash of the requested length, whatever the run's orientation", () => {
    for (const b of [{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: 70, y: -70 }, { x: -40, y: 12 }]) {
      const [t] = terminatorTicks([{ x: 0, y: 0 }, b], { halfPx: 6 });
      expect(Math.hypot(t.x2 - t.x1, t.y2 - t.y1)).toBeCloseTo(12, 6);
      // 45° to the run: |cos| between the tick direction and the run direction is 1/√2.
      const rl = Math.hypot(b.x, b.y);
      const cos = ((t.x2 - t.x1) * b.x + (t.y2 - t.y1) * b.y) / (12 * rl);
      expect(Math.abs(cos)).toBeCloseTo(Math.SQRT1_2, 6);
    }
  });

  it("a polyline terminates at its two ENDS only — interior vertices get nothing", () => {
    const ticks = terminatorTicks([{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 90, y: 30 }, { x: 140, y: 80 }]);
    expect(ticks).toHaveLength(2);
    const mids = ticks.map((t) => ({ x: (t.x1 + t.x2) / 2, y: (t.y1 + t.y2) / 2 }));
    expect(mids[0]).toEqual({ x: 0, y: 0 });
    expect(mids[1].x).toBeCloseTo(140, 6);
    expect(mids[1].y).toBeCloseTo(80, 6);
  });

  it("degenerate input never throws and never emits a NaN tick", () => {
    expect(terminatorTicks(null)).toEqual([]);
    expect(terminatorTicks([{ x: 1, y: 1 }])).toEqual([]);
    expect(terminatorTicks([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([]);   // coincident: no direction
    expect(terminatorTicks([{ x: 0, y: 0 }, { x: 5, y: 0 }], { halfPx: 0 })).toEqual([]);
    for (const t of terminatorTicks([{ x: 0, y: 0 }, { x: 3, y: 4 }])) {
      for (const v of Object.values(t)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("only open runs are terminated — an AREA is a closed outline, a COUNT has no run", () => {
    expect(TERMINATED_MODES).toEqual(["line", "polyline"]);
    expect(terminatedMode("line")).toBe(true);
    expect(terminatedMode("polyline")).toBe(true);
    expect(terminatedMode("area")).toBe(false);
    expect(terminatedMode("count")).toBe(false);
  });

  it("the vertex discs carry data-export=\"skip\" so they can never reach a sheet", () => {
    expect(SP).toMatch(new RegExp(`data-export="skip" ${MEASURE_VERTEX_ATTR}="1"`));
    // …and the terminators are rendered off the label frame's sheet flag, sized through labelK so
    // they hold one physical size on paper.
    expect(SP).toMatch(/labelFrame\.sheet && terminatedMode\(mode\)/);
    expect(SP).toMatch(new RegExp(`${MEASURE_TERM_ATTR}="1"`));
    expect(SP).toMatch(/TERMINATOR_HALF_PX \* labelK/);
    expect(SP).toMatch(/TERMINATOR_WEIGHT_PX \* labelK/);
  });

  it("a COUNT's numbered markers are the deliberate exception and still print", () => {
    // The tally text is NOT export-skipped; only the transparent grab circles are.
    expect(SP).toMatch(/data-measure-tally/);
    expect(SP).toMatch(/key=\{`h\$\{k\}`\} data-export="skip"/);
  });

  it("the tick's size constants are label-space px (scaled by k), not raw canvas px", () => {
    expect(TERMINATOR_HALF_PX).toBeGreaterThan(0);
    expect(TERMINATOR_WEIGHT_PX).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------------- (c) the invariant, asserted in code ---- */
/* A stand-in for the fragment of the DOM interface `enforceMeasureValueOnSheet` uses. The suite runs
 * in the node environment (no jsdom by design — see vitest.config.js), and the enforcement only ever
 * calls querySelectorAll / querySelector / getAttribute / remove, so this is the whole surface. */
function fakeSheet(measures) {
  const nodes = measures.map((m) => ({
    attrs: { [MEASURE_GROUP_ATTR]: m.id, [MEASURE_MODE_ATTR]: m.mode },
    hasValue: m.hasValue,
    removed: false,
    getAttribute(k) { return this.attrs[k] ?? null; },
    querySelector(sel) { return sel === `[${CHIP_TEXT_ATTR}]` && this.hasValue ? {} : null; },
    remove() { this.removed = true; },
  }));
  return {
    nodes,
    querySelectorAll(sel) {
      return sel === `[${MEASURE_GROUP_ATTR}]` ? nodes.filter((n) => !n.removed) : [];
    },
  };
}

describe("(c) a measurement never prints its geometry without its value", () => {
  it("the verdict splits on whether a value is present, nothing else", () => {
    const v = sheetMeasureVerdict([
      { id: "a", mode: "line", hasValue: true },
      { id: "b", mode: "polyline", hasValue: false },
      { id: "c", mode: "count", hasValue: true },
      { id: "d", mode: "area", hasValue: false },
    ]);
    expect(v.keep).toEqual(["a", "c"]);
    expect(v.drop).toEqual(["b", "d"]);
  });

  it("empty / missing input is a clean no-op", () => {
    expect(sheetMeasureVerdict()).toEqual({ keep: [], drop: [] });
    expect(sheetMeasureVerdict([null, undefined])).toEqual({ keep: [], drop: [] });
    expect(enforceMeasureValueOnSheet(null)).toEqual({ dropped: [] });
    expect(enforceMeasureValueOnSheet({})).toEqual({ dropped: [] });
  });

  it("the enforcement REMOVES a valueless measurement and leaves a valued one untouched", () => {
    const sheet = fakeSheet([
      { id: "keep", mode: "line", hasValue: true },
      { id: "anon", mode: "line", hasValue: false },   // the Sylvestri case: two discs and a stub
    ]);
    const { dropped } = enforceMeasureValueOnSheet(sheet);
    expect(dropped).toEqual(["anon"]);
    expect(sheet.nodes.find((n) => n.attrs[MEASURE_GROUP_ATTR] === "anon").removed).toBe(true);
    expect(sheet.nodes.find((n) => n.attrs[MEASURE_GROUP_ATTR] === "keep").removed).toBe(false);
  });

  it("a sheet where every measurement carries its value drops nothing", () => {
    const sheet = fakeSheet([
      { id: "a", mode: "line", hasValue: true },
      { id: "b", mode: "count", hasValue: true },
    ]);
    expect(enforceMeasureValueOnSheet(sheet).dropped).toEqual([]);
    expect(sheet.nodes.every((n) => !n.removed)).toBe(true);
  });

  it("LOUD-FAILURE: a drop always produces an owner-facing warning, and silence produces none", () => {
    expect(droppedMeasureWarning([])).toBe(null);
    expect(droppedMeasureWarning(null)).toBe(null);
    expect(droppedMeasureWarning(["a"])).toMatch(/One measurement was left off the sheet/);
    expect(droppedMeasureWarning(["a", "b"])).toMatch(/^⚠ 2 measurements/);
    // The owner rule: never a measurement / unit / pixel number in owner-facing copy.
    for (const d of [["a"], ["a", "b"]]) expect(droppedMeasureWarning(d)).not.toMatch(/px|pixel|zoom/i);
  });

  it("the export path enforces it on the clone, and warns — it is not left to review", () => {
    expect(EXPORT_SHEET).toMatch(/enforceMeasureValueOnSheet\(clone\)/);
    expect(EXPORT_SHEET).toMatch(/flashWarn\(droppedMeasureWarning\(dropped\)/);
    // It runs on the CLONE, right after the chrome strip — never against the live canvas.
    const stripAt = EXPORT_SHEET.indexOf('clone.querySelectorAll(\'[data-export="skip"]\')');
    const enforceAt = EXPORT_SHEET.indexOf("enforceMeasureValueOnSheet(clone)");
    expect(stripAt).toBeGreaterThan(-1);
    expect(enforceAt).toBeGreaterThan(stripAt);
  });

  it("the renderer stamps the identity the enforcement reads, from the shared constants", () => {
    expect(SP).toMatch(/\[MEASURE_GROUP_ATTR\]: m\.id \|\| `m\$\{i\}`/);
    expect(SP).toMatch(/\[MEASURE_MODE_ATTR\]: mode/);
    // Both measurement render branches (count, and the open/area one) carry the group attrs.
    expect(SP.match(/measureGroupAttrs\(m, i, mode\)/g) || []).toHaveLength(2);
  });
});

/* ------------------------------------------ (d) the wider constant-screen-px audit on the sheet */
describe("(d) constant-screen-px sizing that used to survive onto the sheet", () => {
  it("a measurement's transparent grab layers are stripped from the sheet", () => {
    expect(SP).toMatch(/<polygon data-export="skip" points=\{ptsStr\} fill="transparent"/);
    expect(SP).toMatch(/<polyline data-export="skip" points=\{ptsStr\} fill="none" stroke="transparent"/);
  });

  it("the semantic markup labels ride labelK, so they hold their size at sheet scale", () => {
    // utilRoute fitting + label, encumbrance per-call bearing, and the two vertex marks.
    expect(SP).toMatch(/fontSize=\{8 \* labelK\} fontWeight="800"/);
    expect(SP).toMatch(/fontSize=\{9 \* labelK\} fontFamily=\{NUM_FONT\}/);
    expect(SP).toMatch(/r=\{3 \* labelK\} fill="#dc2626"/);
    expect(SP).toMatch(/width=\{4 \* labelK\} height=\{4 \* labelK\}/);
  });

  /* ⛔ NEW-6 (B435536) — THE THREE CENTROID *NAME* LABELS NOW RIDE A ZOOM RAMP AS WELL AS `labelK`,
   * and this guard was rewritten rather than deleted.
   *
   * It used to pin the literals `fontSize={9.5 * labelK}` (traced) and `fontSize={11 * labelK}`
   * (encumbrance), which was the right assertion when a constant screen size was the intended
   * design. It is no longer: a feature's NAME label was rendering wider than the feature it named
   * (the owner's `CONVEYANCE CHANNEL 2 DIVERSION` at 199 px over a 21 px easement), so the size now
   * comes from `featureNameFontPx(labelPpf, …)` — the shared dimension-number ramp.
   *
   * ⚠ THE INVARIANT THIS TEST EXISTS FOR IS UNCHANGED AND STILL ASSERTED: the label must still be
   * multiplied by `labelK`, so it holds its intended size at SHEET scale rather than at screen
   * scale. Only the base moved from a literal to a named constant. Asserting the invariant instead
   * of the literal is what keeps this guard alive across a legitimate change. */
  it("NEW-6 — the centroid NAME labels still ride labelK, on top of the zoom ramp", () => {
    for (const base of ["EASE_LABEL_BASE_PX", "ENCUMBER_LABEL_BASE_PX", "TRACED_LABEL_BASE_PX"]) {
      expect(SP, `${base} must be declared`).toMatch(new RegExp(`const ${base} = [\\d.]+;`));
      // …and its rendered size must be the ramp TIMES labelK — never one without the other.
      expect(SP, `${base} must render through featureNameFontPx(...) * labelK`)
        .toMatch(new RegExp(`fontSize=\\{featureNameFontPx\\(labelPpf, ${base}\\) \\* labelK\\}`));
    }
    // and every one of them is gated by the fit rule, not merely resized
    expect((SP.match(/featureNameLabelVisible\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("in-progress tool drafts never reach a sheet (constant px, and not document content)", () => {
    // Both measure-draft branches, the draft polygon and the draft rect.
    expect(SP).toMatch(/<g data-export="skip" pointerEvents="none">\s*\{isArea && all\.length >= 3/);
    expect(SP).toMatch(/<g data-export="skip" pointerEvents="none"><rect x=\{a\.x\} y=\{a\.y\} width=\{pw\}/);
  });
});
