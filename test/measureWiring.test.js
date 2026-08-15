/* Source-level wiring guards for the measurement styling / label work (NEW-1 · NEW-2 · NEW-3).
 *
 * WHY a source scan and not only pure-unit tests: the pure layers below (measureStyle,
 * measureLabel, standardsApply) can be perfectly green while nothing on the canvas calls them —
 * which is exactly how a feature ships dead (the B1127 "a new kind with no render branch is a
 * silent spinner" trap). These assert the CALL SITES exist, so removing the wiring goes red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");
const EXPORT_SHEET = read("../src/workspaces/site-planner/lib/exportSheet.js");

describe("NEW-1: measurements are styled through the ONE resolver, on every mode", () => {
  it("the render calls measureStyle and no longer hardcodes the accent", () => {
    /* B548816 — the `accent` OPTION is gone, not merely un-hardcoded. Passing PAL.accent is what
       gave a measurement the markup family's default fill colour and camouflaged it, so the
       resolver now owns the built-in ink and refuses to take one from a caller. */
    expect(SP).toMatch(/const st = measureStyle\(m, \{ uncalibrated: calibrationState === "uncalibrated", selected: isSel \}\)/);
    expect(SP).not.toMatch(/measureStyle\(m, \{ accent:/);
    // the old hardcoded line — the whole point of the item — must be gone
    expect(SP).not.toMatch(/const mcolor = warn \? "#b45309" : PAL\.accent/);
  });
  it("stroke, weight, dash, fill and fill opacity all come off the resolved style", () => {
    expect(SP).toMatch(/stroke=\{mcolor\} strokeWidth=\{st\.weight\} strokeDasharray=\{mdash\}/);
    expect(SP).toMatch(/fill=\{st\.fill\} fillOpacity=\{st\.fillOpacity\}/);
    expect(SP).toMatch(/const mdash = dashArray\(st\.dash, st\.weight\)/);
  });
  it("the COUNT mode markers follow the style too (not just area)", () => {
    expect(SP).toMatch(/fill=\{mcolor \+ "28"\} stroke=\{mcolor\} strokeWidth=\{st\.weight\}/);
  });
  it("all four creation paths stamp the Standards defaults", () => {
    // the two-click distance, plus polyline / area / count through finishMeasure
    expect(SP).toMatch(/mode: "line", pts: \[measDraft\[0\], sp\], \.\.\.measureDefaultStyle\(settings\)/);
    expect(SP).toMatch(/const std = measureDefaultStyle\(settings\);/);
    ["polyline", "area", "count"].forEach((mode) => {
      expect(SP).toMatch(new RegExp(`mode: "${mode}", pts: measDraft, \\.\\.\\.std`));
    });
  });
  it("the properties panel edits the full style through the SHARED colour control", () => {
    expect(SP).toMatch(/colorCtl\(\(v\) => liveMeasure\(\{ stroke: v \}\)\)/);
    expect(SP).toMatch(/colorCtl\(\(v\) => liveMeasure\(\{ fill: v \}\)\)/);
    expect(SP).toMatch(/setSelMeasure\(\{ weight: n \}\)/);
    expect(SP).toMatch(/setSelMeasure\(\{ dash: e\.target\.value \}\)/);
    expect(SP).toMatch(/liveMeasure\(\{ fillOpacity: \+e\.target\.value \}\)/);
    // reuses the ONE shared line-style list, not a parallel one
    expect(SP).toMatch(/value=\{m\.dash \|\| MEASURE_LINE\.dash\}[\s\S]{0,220}\{DASH_OPTIONS\}/);
  });
  it("Standards carries a MEASUREMENTS section that applies retroactively", () => {
    expect(SP).toMatch(/data-std-sec="measure"/);
    expect(SP).toMatch(/title="Measurements"/);
    expect(SP).toMatch(/applyAllStandards\(beforeParcels, beforeEls, stdParcelValues\(\), Object\.keys\(TYPE\), \{ measures: beforeMeasures, measureValues: stdMeasureValues\(\) \}\)/);
    expect(SP).toMatch(/setMeasures\(res\.measures\)/);
    // "Save for all projects" promotes the measurement defaults to the account scope too
    expect(SP).toMatch(/MEASURE_STD_KEYS\.forEach\(\(k\) => \{ up = setStandardPref\(up, "measureStyle", k, measureStdValueUI\(k\) \?\? null\); \}\)/);
  });
  it("double-click a measurement still opens its Properties (parity with every other object)", () => {
    // NEW-2 — via the ONE shared action, which is what the root-level dblclick resolver calls too.
    expect(SP).toMatch(/if \(isDoubleTap\(e, m\.id, sel\?\.kind === "measure" && sel\.i === idx\)\) \{[\s\S]{0,200}featureDoubleAction\(\{ kind: "measure", i: idx \}, e\)/);
    expect(SP).toMatch(/setSel\(\{ kind: "measure", i: t\.i \}\);\s*\n\s*openInspector\(\);/);
  });
});

/* NEW-2 (2026-07-30) — the guard above named ONE function, and that is exactly why it did not
 * protect. It scrapes `startMoveMeasure` and nothing else, so it stayed green while #866 shipped a
 * pointer-enabled label chip — painted deliberately AFTER the transparent grab layer so its own
 * drag would not be swallowed — whose handler had no double-tap branch at all. Same click on the
 * same pixel, previously falling through to the shape and now landing on a dead end.
 *
 * So the guard is generalised from "this function has the gesture" to "EVERY interactive
 * measurement surface has the gesture". It DISCOVERS the surfaces from the render — any
 * `onPointerDown` bound inside the measurement block — instead of listing them, so adding a new
 * one without the gesture goes red on arrival rather than shipping and waiting to be reported.
 */
/** Extract `const NAME = (…) => { … }` from SitePlanner's component body by brace matching. */
function fnBody(name) {
  const at = SP.indexOf(`const ${name} = (`);
  if (at < 0) return null;
  const open = SP.indexOf("{", SP.indexOf("=>", at));
  let depth = 0;
  for (let i = open; i < SP.length; i++) {
    if (SP[i] === "{") depth++;
    else if (SP[i] === "}" && --depth === 0) return SP.slice(open, i + 1);
  }
  return null;
}
// NEW-2 — the measurement render is `renderMeasureNode` now (it paints in two bands), not an
// inline `measures.map(...)` in the JSX. Both suites below scan that body.
const MEASURE_RENDER_BODY = fnBody("renderMeasureNode");

describe("NEW-2: EVERY interactive measurement surface opens Properties on double-click", () => {
  // The measurement render block, sliced exactly as the chip-ordering assertion below slices it,
  // PLUS the hoisted `measureHandles` const. NEW-1 moved the control-point grips out of the render
  // block and into the one always-on-top handle layer (a grip drawn inside the content pass could
  // be buried under a label or a promoted reference and then could not be grabbed) — so the scan
  // has to cover both halves, or it would silently stop seeing the vertex grip it classifies.
  const HANDLE_LAYER = SP.slice(SP.indexOf("const measureHandles = (() => {"), SP.indexOf("/* ----------------------------- UI ----------------------------- */"));

  /** Extract `const NAME = (…) => { … }` from the component body by brace matching. */
  function bodyOf(name) {
    const at = SP.indexOf(`const ${name} = (`);
    if (at < 0) return null;
    const open = SP.indexOf("{", SP.indexOf("=>", at));
    let depth = 0;
    for (let i = open; i < SP.length; i++) {
      if (SP[i] === "{") depth++;
      else if (SP[i] === "}" && --depth === 0) return SP.slice(open, i + 1);
    }
    return null;
  }

  /* NEW-2 moved the measurement render out of the inline `measures.map(...)` and into
     `renderMeasureNode`, so a measurement can paint in EITHER band (behind the plan or above it).
     The scan follows the code: the render body is now that function's body. Everything this suite
     asserts is unchanged — WHERE the markup lives moved, WHAT it must contain did not. */
  const MEASURE_RENDER = MEASURE_RENDER_BODY;
  const block = MEASURE_RENDER + HANDLE_LAYER;

  it("the measurement render is a reusable node builder, drawn in BOTH bands (NEW-2)", () => {
    expect(MEASURE_RENDER, "renderMeasureNode not found — the measurement render moved again").toBeTruthy();
    // Two draw passes, one renderer: behind the elements and above them.
    expect(SP).toMatch(/\{measureBands\.below\.map\(\(\{ m, i \}\) => renderMeasureNode\(m, i\)\)\}/);
    expect(SP).toMatch(/\{measureBands\.above\.map\(\(\{ m, i \}\) => renderMeasureNode\(m, i\)\)\}/);
    // …and the below pass really is emitted before the element bands, the above pass after them.
    const below = SP.indexOf("{measureBands.below.map(");
    const above = SP.indexOf("{measureBands.above.map(");
    const elsAbove = SP.indexOf("{drawElsZ.above.map(");
    expect(below).toBeGreaterThan(-1);
    expect(below).toBeLessThan(elsAbove);
    expect(above).toBeGreaterThan(elsAbove);
    // The DEFAULT must not move: only an explicit `=== true` sends a measurement down, so every
    // plan saved before this shipped renders exactly where it always did.
    expect(SP).toMatch(/below: idx\.filter\(\(\{ m \}\) => m\.behindEls === true\)/);
    expect(SP).toMatch(/above: idx\.filter\(\(\{ m \}\) => m\.behindEls !== true\)/);
  });

  // Every handler the measurement render binds to a pointer press. Discovered, not listed.
  const pressed = [...new Set([...block.matchAll(/onPointerDown=\{(?:[^}]*?)\b(start\w+)\(e,/g)].map((m) => m[1]))];

  /* Which of those are WHOLE-OBJECT surfaces — the ones a double-click means "inspect this
   * measurement" on. The discriminator is structural, never a name list (a name list is what
   * failed): a handler that SELECTS A SUB-PART writes `setSelVtx({…})`, and a vertex grip is a
   * handle on an already-selected object rather than a way to reach the object itself. That is
   * a real app-wide invariant, not an excuse carved out for this test — NO vertex handler
   * anywhere in the planner reconstructs the double-tap (asserted below), so requiring it here
   * would be inventing a behaviour that exists on no other geometry.
   * A new whole-object surface is picked up automatically; a new vertex grip is excluded for the
   * same structural reason, with no edit to this file either way. */
  const isVertexGrip = (name) => /setSelVtx\(\{/.test(bodyOf(name) || "");
  const handlers = pressed.filter((n) => !isVertexGrip(n));

  it("finds the press handlers by scanning the render (so a NEW surface is covered automatically)", () => {
    // Both whole-object surfaces today: the geometry grab layer and the summary label chip. The
    // count is a floor, not an exact set — a third must be picked up, never quietly dropped.
    expect(handlers).toContain("startMoveMeasure");
    expect(handlers).toContain("startMeasChip");
    expect(handlers.length).toBeGreaterThanOrEqual(2);
    // …and the vertex grip really is being classified, not merely missing from the scan.
    expect(pressed).toContain("startMeasureVertex");
    expect(isVertexGrip("startMeasureVertex")).toBe(true);
  });

  it("no vertex grip anywhere reconstructs the double-tap — the exclusion tracks the whole app", () => {
    for (const grip of ["startMeasureVertex", "startMarkupVertex"]) {
      const body = bodyOf(grip);
      expect(body, `could not locate ${grip}`).toBeTruthy();
      expect(body, `${grip} now has a double-tap — the structural exclusion above needs revisiting`).not.toMatch(/isDoubleTap\(/);
    }
  });

  it.each(handlers)("%s reconstructs the double-tap and opens the inspector", (name) => {
    const body = bodyOf(name);
    expect(body, `could not locate ${name}`).toBeTruthy();
    expect(body, `${name} never calls isDoubleTap — the gesture is unarmed on that surface`).toMatch(/isDoubleTap\(e, m\.id/);
    /* B1188 — every surface opens through the ONE explicit inspector open. NEW-2 moved that open
       behind `featureDoubleAction`, which is the SHARED decision the root-level dblclick resolver
       uses too — the whole point being that a surface can no longer carry its own copy and drift.
       So the guard is now two-part: the surface routes to the one action (here), and the one action
       opens the inspector for a measurement (asserted once, below). */
    expect(body, `${name} does not route its double-tap through featureDoubleAction`).toMatch(/featureDoubleAction\(\{ kind: "measure", i/);
  });

  it.each(handlers)("%s opens Properties for a LOCKED measurement too (the surfaces must agree)", (name) => {
    const body = bodyOf(name);
    const dbl = body.indexOf("isDoubleTap");
    const lock = body.indexOf("if (m.locked)");
    expect(dbl).toBeGreaterThan(-1);
    // A lock guard is optional (a surface may not drag at all), but where it exists the double-tap
    // branch must precede it — otherwise a locked measurement can be selected but never inspected
    // from that surface, which is exactly the divergence NEW-2 was.
    if (lock > -1) expect(dbl, `${name} checks m.locked before its double-tap branch`).toBeLessThan(lock);
  });

  it("the ONE shared action opens the inspector for a measurement (NEW-2)", () => {
    const body = bodyOf("featureDoubleAction");
    expect(body, "could not locate featureDoubleAction").toBeTruthy();
    const branch = body.slice(body.indexOf('t.kind === "measure"'));
    expect(branch, "featureDoubleAction's measure branch no longer opens the inspector").toMatch(/openInspector\(\)/);
    expect(branch, "a measurement must select by INDEX, which is how sel stores it").toMatch(/setSel\(\{ kind: "measure", i: t\.i \}\)/);
  });

  it("the chip's double-tap keys on the bare id, so chip and shape pair with each other", () => {
    // `isDoubleTap(e, m.id, …)` on both surfaces is what lets press-on-shape + press-on-chip (in
    // either order) count as one double-click, rather than two orphaned single presses.
    const chip = bodyOf("startMeasChip");
    expect(chip).toMatch(/isDoubleTap\(e, m\.id, sel\?\.kind === "measure" && sel\.i === i\)/);
    // …and it returns before the drag arms, so a double-click never pushes a no-op undo frame.
    // NEW-1/NEW-2 (drag gate) — this is now structural rather than ordering: the handler pushes NO
    // undo frame at all, because the frame moved to the first real MOVEMENT for every drag in the
    // planner. So a double-click can't burn a frame, and neither can a plain click.
    expect(chip.replace(/\/\/[^\n]*/g, "")).not.toMatch(/pushHistory\(\)/);
    expect(chip.indexOf("isDoubleTap")).toBeLessThan(chip.indexOf("drag.current ="));
    expect(chip).toMatch(/\.\.\.startGate\(e\)/);
  });
});

describe("NEW-1: measurement styling (continued)", () => {
  it("the owner rule holds: NO × delete badge on a selected measurement", () => {
    expect(SP).toMatch(/no × delete badge on a measurement \(owner rule\)/);
  });
});

describe("NEW-2: the label reveal zoom is per-measurement, captured by click", () => {
  it("the render gates on measureLabelVisible, not the bare global floor", () => {
    // NEW-1 amends this call with `sheet: labelFrame.sheet` — an export lifts the gate entirely
    // (test/measureSheet.test.js owns that half). The canvas gate itself is unchanged.
    expect(SP).toMatch(/measureLabelVisible\(m, labelPpf, \{ settings, globalFloor: DIM_CALLOUT_MIN_PPF, selected: isSel, sheet: labelFrame\.sheet \}\)/);
  });
  it("both controls CAPTURE the live zoom — no raw zoom number is ever typed", () => {
    expect(SP).toMatch(/onClick=\{\(\) => setSelMeasure\(\{ labelPpf: view\.ppf \}\)\}>Set at current zoom</);
    expect(SP).toMatch(/onClick=\{\(\) => draftMeasureStd\(\{ labelPpf: view\.ppf \}\)\}>Set at current zoom</);
    expect(SP).not.toMatch(/label="Show label from \(ppf\)"/);
  });
  it("both controls offer a Reset to default", () => {
    expect((SP.match(/>Reset to default</g) || []).length).toBe(2);
    expect(SP).toMatch(/setSelMeasure\(\{ labelPpf: null \}\)/);
    expect(SP).toMatch(/draftMeasureStd\(\{ labelPpf: null \}\)/);
  });
  it("the readout is the plain-English band helper", () => {
    expect(SP).toMatch(/labelRevealNote\(m, settings, DIM_CALLOUT_MIN_PPF\)/);
  });
});

describe("NEW-3: the summary chip, the segment dimensions, and print parity", () => {
  it("the run-on one-liner is gone", () => {
    expect(SP).not.toMatch(/′ perim`/);
    expect(SP).not.toMatch(/\$\{f0\(polyArea\(fpts\)\)\} SF · \$\{f2\(polyArea\(fpts\) \/ SQFT_PER_ACRE\)\} AC/);
  });
  it("the panel reads the same formatters as the canvas (one number convention)", () => {
    expect(SP).toMatch(/rows\.push\(\["Perimeter", fmtFeet\(pathLen\(\[\.\.\.fpts, fpts\[0\]\]\)\)\]\)/);
    expect(SP).toMatch(/rows\.push\(\["Length", fmtFeet\(pathLen\(fpts\)\)\]\)/);
  });
  it("the chip is a real plate + hairline carrying the parcel chip's print contract", () => {
    expect(SP).toMatch(/data-print-chip="measure"/);
    expect(SP).toMatch(/<rect data-chip-bg[\s\S]{0,220}stroke=\{mcolor\}/);
    expect(SP).toMatch(/<text key=\{k\} data-chip-text/);
    expect(SP).toMatch(/"data-chip-sub": "1"/);
  });
  it("the export restyles EVERY chip through one selector, so measure and acre can't drift", () => {
    expect(EXPORT_SHEET).toMatch(/root\.querySelectorAll\("\[data-print-chip\]"\)/);
    expect(EXPORT_SHEET).not.toMatch(/querySelectorAll\('\[data-print-chip="acre"\]'\)/);
    expect(EXPORT_SHEET).toMatch(/data-chip-sub/);
  });
  it("the chip is laid out by the SHARED collision engine, not painted at the centroid", () => {
    expect(SP).toMatch(/const measureChipPlace = layoutLabels\(/);
    // and its boxes become obstacles for the element-label pass
    expect(SP).toMatch(/obstacles: \[\.\.\.parcelChipBoxes, \.\.\.measureChipBoxes\]/);
  });
  it("the chip paints AFTER the transparent grab layer, or the drag is swallowed", () => {
    // Found live: an area's hit path is a transparent FILLED polygon over the whole shape, so a
    // chip drawn before it in document order was unreachable — every press moved the measurement
    // instead of the label. Both branches must keep the chip last.
    const block = MEASURE_RENDER_BODY;
    const countChip = block.indexOf("{chipNode}");        // the count branch renders first
    const areaChip = block.lastIndexOf("{chipNode}");     // the line / polyline / area branch
    expect(countChip).toBeGreaterThan(-1);
    expect(areaChip).toBeGreaterThan(countChip);
    expect(countChip).toBeGreaterThan(block.indexOf("hit targets — one transparent circle"));
    expect(areaChip).toBeGreaterThan(block.indexOf("wide invisible hit path"));
  });
  it("a colour chip shows its own colour (no hardcoded background override)", () => {
    // ColorField paints the current colour as the chip background; a `background:` in the caller's
    // style override blanks it, which is how these panels shipped with colourless colour controls.
    expect(SP).not.toMatch(/const swatch = \{[^}]*background: "var\(--surface-raised\)"/);
  });
  it("the chip is draggable with a leader back to its anchor (the parcel labelOffset mechanic)", () => {
    expect(SP).toMatch(/const startMeasChip = \(e, i\) => \{/);
    expect(SP).toMatch(/d\.mode === "measChip"/);
    expect(SP).toMatch(/chip\.moved && <line x1=\{chip\.anchor\.x\}/);
  });
  it("per-edge segment lengths are drawn, gated SEPARATELY from the summary chip", () => {
    expect(SP).toMatch(/const segs = fpts\.length > 2 \|\| isArea \? measureSegments\(fpts, isArea\) : \[\]/);
    expect(SP).toMatch(/if \(!detailLabelVisible\(s\.ft, labelPpf\)\) return null/);
  });
  it("chip figures are tabular so digits never jitter between frames", () => {
    expect(SP).toMatch(/fontFamily=\{NUM_FONT\} fontVariantNumeric=\{TABULAR_NUMS\} pointerEvents="none"/);
  });
});
