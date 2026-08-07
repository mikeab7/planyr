/* NEW-2 / NEW-3 — resolving WHAT was double-clicked, at the canvas root.
 *
 * The defect these pin: a click's target is the common ancestor of its down and up targets. Press 1
 * selects the feature, React re-renders it, so the node the browser was holding for press 2 is gone
 * and both `click#2` and `dblclick` collapse to the bare root `<svg>`. Every per-node
 * `onDoubleClick` in the planner was therefore unreachable in exactly the case it existed to cover.
 *
 * The two suites below are the pure halves of the fix: which feature a hit stack resolves to
 * (NEW-2), and whether a press on a dimension NUMBER was really aimed at the element's body
 * underneath it (NEW-3 — a road's width number is painted on the pavement, so it could not be
 * missed, and the inline width chip swallowed the gesture).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FEATURE_KINDS, parseFeatureKey, resolveDoubleClickTarget, pressIsOverElementBody,
  stackEntries, FEATURE_ATTR, HANDLE_ATTR, EL_DIM_ATTR,
} from "../src/workspaces/site-planner/lib/featureTarget.js";

const feat = (feature, extra = {}) => ({ feature, handle: false, dim: false, ...extra });
const plain = () => feat(null);

describe("parsing the render's identity stamp", () => {
  it("reads an id-keyed feature", () => {
    expect(parseFeatureKey("el:e17abc")).toEqual({ kind: "el", id: "e17abc" });
    expect(parseFeatureKey("markup:mk-1")).toEqual({ kind: "markup", id: "mk-1" });
    expect(parseFeatureKey("callout:c9")).toEqual({ kind: "callout", id: "c9" });
    expect(parseFeatureKey("parcel:p3")).toEqual({ kind: "parcel", id: "p3" });
  });

  it("reads a measurement by INDEX, because that is how the planner's selection stores one", () => {
    expect(parseFeatureKey("measure:0")).toEqual({ kind: "measure", i: 0 });
    expect(parseFeatureKey("measure:12")).toEqual({ kind: "measure", i: 12 });
  });

  it("refuses anything malformed rather than half-resolving it", () => {
    for (const bad of ["", "el", "el:", ":e1", "nope:x", "measure:-1", "measure:1.5", "measure:x", null, 7, undefined]) {
      expect(parseFeatureKey(bad), String(bad)).toBeNull();
    }
  });

  it("keeps a colon inside an id (ids are opaque)", () => {
    expect(parseFeatureKey("el:a:b")).toEqual({ kind: "el", id: "a:b" });
  });

  it("declares every kind the dispatcher can act on", () => {
    expect(FEATURE_KINDS).toEqual(["el", "markup", "callout", "parcel", "measure"]);
  });
});

describe("resolving the double-click target off the hit stack", () => {
  it("takes the TOP-MOST feature — the same order the browser used to pick the press target", () => {
    expect(resolveDoubleClickTarget([feat("markup:m1"), feat("el:e1")])).toEqual({ kind: "markup", id: "m1" });
  });

  it("skips untagged nodes above the feature (basemap host, GIS bands, decorations)", () => {
    expect(resolveDoubleClickTarget([plain(), plain(), feat("el:e1")])).toEqual({ kind: "el", id: "e1" });
  });

  it("resolves the chrome INSIDE a feature to that feature — a dimension number is still the element", () => {
    // The dim number and grab band live inside the element's own group, so they carry its stamp.
    expect(resolveDoubleClickTarget([feat("el:road7", { dim: true }), feat("el:road7")])).toEqual({ kind: "el", id: "road7" });
  });

  /* A HANDLE on top owns the press. A grip is a manipulation affordance; opening the thing beneath
   * it would both surprise and make a grip's own future double-click gesture unimplementable. */
  it("returns nothing when a handle is on top", () => {
    expect(resolveDoubleClickTarget([{ feature: null, handle: true }, feat("el:e1")])).toBeNull();
  });

  it("still resolves when the handle is BELOW the feature", () => {
    expect(resolveDoubleClickTarget([feat("el:e1"), { feature: null, handle: true }])).toEqual({ kind: "el", id: "e1" });
  });

  it("returns nothing on empty canvas, and survives junk", () => {
    expect(resolveDoubleClickTarget([])).toBeNull();
    expect(resolveDoubleClickTarget([plain(), plain()])).toBeNull();
    expect(resolveDoubleClickTarget(null)).toBeNull();
    expect(resolveDoubleClickTarget([null, undefined, feat("el:e1")])).toEqual({ kind: "el", id: "e1" });
    expect(resolveDoubleClickTarget([feat("garbage:1"), feat("el:e1")])).toEqual({ kind: "el", id: "e1" });
  });
});

describe("NEW-3 — was the press aimed at the element's body, or only at its dimension number?", () => {
  it("YES when the element's own body paints under the point, beneath its dim chrome (the road case)", () => {
    // A centerline road's width number is anchored to the centreline MIDPOINT — it sits ON the
    // pavement, so a double-click aimed at the road cannot miss it.
    expect(pressIsOverElementBody([feat("el:road7", { dim: true }), feat("el:road7")], "road7")).toBe(true);
  });

  it("NO when only the dimension chrome is there — a number dragged out into clear space", () => {
    // A road's dimension drags FREELY, so the number can genuinely be the only thing under the
    // pointer. That is the case where the inline width editor is still what the user meant.
    expect(pressIsOverElementBody([feat("el:road7", { dim: true })], "road7")).toBe(false);
    expect(pressIsOverElementBody([feat("el:road7", { dim: true }), plain()], "road7")).toBe(false);
  });

  it("NO when a DIFFERENT feature is painted between the number and the body", () => {
    // The number overhangs a neighbour: the press belongs to that neighbour, not to this element's
    // body, and forwarding it to this element would be a worse guess than declining.
    expect(pressIsOverElementBody([feat("el:road7", { dim: true }), feat("el:bldg1"), feat("el:road7")], "road7")).toBe(false);
    expect(pressIsOverElementBody([feat("markup:m1"), feat("el:road7")], "road7")).toBe(false);
  });

  it("looks PAST a handle rather than declining on it (the number can sit under a grip)", () => {
    expect(pressIsOverElementBody([{ feature: null, handle: true }, feat("el:road7")], "road7")).toBe(true);
  });

  it("is false for an empty stack, a missing id, or junk", () => {
    expect(pressIsOverElementBody([], "road7")).toBe(false);
    expect(pressIsOverElementBody([feat("el:road7")], null)).toBe(false);
    expect(pressIsOverElementBody(null, "road7")).toBe(false);
    expect(pressIsOverElementBody([plain(), plain()], "road7")).toBe(false);
  });
});

describe("flattening a live DOM stack", () => {
  /* A minimal stand-in for the DOM contract these helpers depend on: `closest(selector)`. */
  const node = (chain) => ({
    closest: (sel) => {
      const attr = sel.replace(/[[\]]/g, "");
      const hit = chain.find((a) => Object.prototype.hasOwnProperty.call(a, attr));
      return hit ? { getAttribute: (k) => hit[k] } : null;
    },
  });

  it("reads the nearest data-feature ancestor and flags the handle layer", () => {
    const stack = [
      node([{ [HANDLE_ATTR]: "1" }]),
      node([{ [FEATURE_ATTR]: "el:e1" }]),
      node([]),
    ];
    expect(stackEntries(stack)).toEqual([
      { feature: null, handle: true, dim: false },
      { feature: "el:e1", handle: false, dim: false },
      { feature: null, handle: false, dim: false },
    ]);
  });

  it("the one flattener also flags the dimension chrome", () => {
    const stack = [node([{ [FEATURE_ATTR]: "el:r1" }, { [EL_DIM_ATTR]: "1" }]), node([{ [FEATURE_ATTR]: "el:r1" }])];
    expect(stackEntries(stack)).toEqual([
      { feature: "el:r1", handle: false, dim: true },
      { feature: "el:r1", handle: false, dim: false },
    ]);
  });

  it("survives a non-element entry in the stack", () => {
    expect(stackEntries([null, {}, undefined])).toEqual([]);
    expect(stackEntries(null)).toEqual([]);
  });
});

describe("source guard — the render must keep stamping what the resolver reads", () => {
  const SP = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("the handle layer still carries the attribute the resolver checks", () => {
    expect(SP).toMatch(new RegExp(`${HANDLE_ATTR}="1"`));
  });

  it("the dimension chrome carries its marker on BOTH dim renders (centerline road and rect element)", () => {
    expect(SP.match(new RegExp(`<g key="dim" ${EL_DIM_ATTR}="1"`, "g")) || []).toHaveLength(2);
  });

  it("the root dblclick handler is wired to the canvas svg", () => {
    expect(SP).toMatch(/onDoubleClick=\{onBgDouble\}/);
  });
});
