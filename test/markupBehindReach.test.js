/* NEW-2 — a markup sent behind a building must have a way back that does not depend on finding
 * uncovered geometry.
 *
 * THE MEASURED SYMPTOM (owner's account): after sending a markup behind the buildings, right-clicking
 * it anywhere it overlaps a building opens the BUILDING's menu. The markup is unreachable across the
 * whole overlap region — grabbable only on a sliver no element covers, and on a markup drawn to
 * cover the building, on nothing at all. The send-behind door was one-way from the user's seat.
 *
 * TWO MECHANISMS, both proved here: the pure stack reader that makes "what is underneath" an
 * answerable question, and source guards on the two places the answer is used — the selected-
 * annotation priority rule and the covering element's "Behind this" rows. The guards are here
 * because the wiring lives inside a 26,000-line component that cannot be imported in Node; the
 * BEHAVIOUR is proved in the browser by e2e/markup-behind-building.spec.js and the ui-audit harness.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { featureStack, featuresBeneath, stackHoldsFeature, stackEntries } from "../src/workspaces/site-planner/lib/featureTarget.js";

const SRC = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

// The stack the browser hands back over a markup that was sent behind a building: the building
// paints later, so it is first; the markup is still there, underneath, unchanged.
const overlap = () => [
  { feature: "el:b1", handle: false, dim: false },
  { feature: "el:b1", handle: false, dim: false },   // a feature contributes one entry per painted node
  { feature: "markup:mk1", handle: false, dim: false },
];

describe("featureStack — every feature under the point, not just the winner", () => {
  it("reads the whole stack, top-most first, deduped", () => {
    expect(featureStack(overlap()).map((f) => f.key)).toEqual(["el:b1", "markup:mk1"]);
  });

  it("featuresBeneath drops the one that won the press — what is left is what could not be reached", () => {
    expect(featuresBeneath(overlap()).map((f) => f.key)).toEqual(["markup:mk1"]);
    expect(featuresBeneath(overlap())[0].target).toEqual({ kind: "markup", id: "mk1" });
  });

  it("chrome is skipped, by the same rule the double-click resolver uses", () => {
    const withGrip = [{ feature: "el:b1", handle: true }, ...overlap()];
    expect(featureStack(withGrip).map((f) => f.key)).toEqual(["el:b1", "markup:mk1"]);
  });

  it("untagged decoration between the two does not hide what is below it", () => {
    const s = [{ feature: "el:b1" }, { feature: null }, { feature: "markup:mk1" }];
    expect(featuresBeneath(s).map((f) => f.key)).toEqual(["markup:mk1"]);
  });

  it("a malformed marker never resolves to a half-built target", () => {
    expect(featureStack([{ feature: "el:" }, { feature: "nope:1" }, { feature: "markup:mk1" }]).map((f) => f.key))
      .toEqual(["markup:mk1"]);
  });

  it("a measurement is addressed by INDEX, as its selection model requires", () => {
    expect(featuresBeneath([{ feature: "el:b1" }, { feature: "measure:3" }])[0].target).toEqual({ kind: "measure", i: 3 });
  });

  it("nothing underneath / empty / non-array is an empty answer, never a throw", () => {
    expect(featuresBeneath([{ feature: "el:b1" }])).toEqual([]);
    expect(featuresBeneath([])).toEqual([]);
    expect(featuresBeneath(null)).toEqual([]);
    expect(featureStack(undefined)).toEqual([]);
  });
});

describe("stackHoldsFeature — 'does the selected annotation paint here', which is the question", () => {
  it("finds a feature that is UNDER another one (it is not asking who is on top)", () => {
    expect(stackHoldsFeature(overlap(), "markup:mk1")).toBe(true);
  });

  it("is false when the annotation does not paint at this point", () => {
    expect(stackHoldsFeature(overlap(), "markup:other")).toBe(false);
  });

  it("is false for chrome-only presence, and for junk input", () => {
    expect(stackHoldsFeature([{ feature: "markup:mk1", handle: true }], "markup:mk1")).toBe(false);
    expect(stackHoldsFeature(overlap(), "")).toBe(false);
    expect(stackHoldsFeature(overlap(), null)).toBe(false);
  });

  it("works off a real flattened DOM stack shape (stackEntries' own output)", () => {
    const node = (feature) => ({ closest: (sel) => (sel.includes("data-feature") && feature ? { getAttribute: () => feature } : null) });
    const entries = stackEntries([node("el:b1"), node("markup:mk1")]);
    expect(stackHoldsFeature(entries, "markup:mk1")).toBe(true);
    expect(featuresBeneath(entries).map((f) => f.key)).toEqual(["markup:mk1"]);
  });
});

/* ⛔ SOURCE GUARDS. Each names the property, not the spelling of the fix — but each WAS red on the
 * pre-fix source, which is the only reason to keep a source guard at all. */
describe("wiring — the two ways back exist and are reachable from the element that covers it", () => {
  it("the element right-click checks a selected behind-plan annotation FIRST", () => {
    const at = SRC.indexOf("const onElContext");
    expect(at).toBeGreaterThan(0);
    const body = SRC.slice(at, at + 1600);
    expect(body).toMatch(/behindSelKey\(\)/);
    expect(body).toMatch(/stackHoldsFeature\(hitStackAt\(/);
    expect(body).toMatch(/featureContextAction\(/);
    // ...and it must run BEFORE the element claims the selection, or the way back is already lost.
    expect(body.indexOf("behindSelKey()")).toBeLessThan(body.indexOf('setSel({ kind: "el", id })'));
  });

  it("behindSelKey only fires for an annotation that is actually in the behind band", () => {
    const at = SRC.indexOf("const behindSelKey");
    expect(at).toBeGreaterThan(0);
    const body = SRC.slice(at, at + 700);
    for (const kind of ["markup", "callout", "measure"]) expect(body).toContain(kind);
    expect(body.match(/behindEls/g).length).toBeGreaterThanOrEqual(3);
  });

  it("the element menu captures what is underneath AT OPEN TIME, not at render", () => {
    // Asking again at render would hit the menu itself, which is painted over the point.
    expect(SRC).toMatch(/setTypeMenu\(\{ id, x: e\.clientX, y: e\.clientY, w, under: behindAnnotationsUnder\(/);
    expect(SRC).toContain("const behindAnnotationsUnder");
  });

  it("the 'Behind this' rows offer BOTH the reversal and a plain select", () => {
    expect(SRC).toContain("Behind this");
    expect(SRC).toMatch(/liftUnderToFront\(/);
    expect(SRC).toMatch(/selectUnder\(/);
    expect(SRC).toMatch(/data-testid=\{`under-lift-\$\{i\}`\}/);
    expect(SRC).toMatch(/data-testid=\{`under-select-\$\{i\}`\}/);
  });

  it("the reversal reuses the three band setters rather than a fifth copy of the flag flip", () => {
    const at = SRC.indexOf("const liftUnderToFront");
    const body = SRC.slice(at, at + 500);
    expect(body).toContain("setMarkupBand(");
    expect(body).toContain("setCalloutBand(");
    expect(body).toContain("setMeasureBand(");
  });

  it("the markup band toggle is a NAMED setter with more than one caller (it was inline in the menu)", () => {
    expect(SRC).toContain("const setMarkupBand");
    // Both callers: the markup's own menu row, and the covering element's reversal row.
    expect(SRC.match(/setMarkupBand\(/g).length).toBeGreaterThanOrEqual(2);
    // ...and it re-stacks, which the inline version never did.
    const at = SRC.indexOf("const setMarkupBand");
    expect(SRC.slice(at, at + 800)).toContain("nextZ(");
  });
});

describe("wiring — NEW-1's cross-band Arrange is what the annotation families actually run", () => {
  it("arrangeSel routes all three annotation families through arrangeAcrossBands", () => {
    const at = SRC.indexOf("const arrangeSel");
    const body = SRC.slice(at, at + 5200);
    expect(body).toMatch(/s\?\.kind === "markup" \|\| s\?\.kind === "callout" \|\| s\?\.kind === "measure"/);
    expect(body).toContain("arrangeAcrossBands(");
  });

  it("the menu greys from the BAND-AWARE flags", () => {
    const at = SRC.indexOf("const arrangePeers");
    expect(SRC.slice(at, at + 1800)).toContain("arrangeBandFlags(");
  });

  it("ELEMENTS deliberately keep the band-bounded rule B316864 settled", () => {
    const at = SRC.indexOf("const arrangeSel");
    const body = SRC.slice(at, at + 5200);
    // The element branch still resolves peers by zOrder band and still uses reorderByZ.
    expect(body).toMatch(/s\?\.kind === "el".*zOrder\(e\) === band/s);
    expect(body).toContain("reorderByZ(peers,");
    // ...and the annotation branch returns before it, so the two cannot be conflated.
    expect(body.indexOf("arrangeAcrossBands(")).toBeLessThan(body.indexOf("reorderByZ(peers,"));
  });
});
