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
 *
 * ⛔ B233153 amends the FIRST of those. A handle on top no longer blanks the answer — it is skipped,
 * because a grip is chrome belonging to the selected feature and never a feature in its own right.
 * The case that forced it: on the owner's Bain plan, press 1 on a detention pond selects it, which
 * MOUNTS that pond's vertex hit squares, and one lands exactly on the point just pressed — so press
 * 2 hit a handle the first press had created and the gesture resolved to nothing. Six seeded pond
 * variants all passed, because the variable is not the shape: it is VERTEX COUNT against handle size
 * at the probe point, and a four-vertex fixture ring keeps its handles at the corners.
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

  /* ⛔ B233153 — A HANDLE IS TRANSPARENT TO IDENTIFICATION, and this REPLACES the rule that shipped
   * first ("a handle on top owns the press → null"). Captured live on the owner's Bain plan: press 1
   * on a detention pond selects it, which MOUNTS the pond's own 18×18 vertex hit squares, and one of
   * them lands exactly on the point just pressed. Press 2 then hits the handle, the native dblclick
   * retargets to the root, and the old rule answered "nothing was double-clicked" — silently, every
   * time, on a pond whose surveyed ring has dozens of vertices. The first press summoned the thing
   * that blocked the second. */
  it("looks PAST a handle on top — a grip is chrome belonging to the feature, not a feature", () => {
    expect(resolveDoubleClickTarget([{ feature: null, handle: true }, feat("el:e1")])).toEqual({ kind: "el", id: "e1" });
  });

  it("B233153 — the owner's capture: the pond's OWN vertex handle over the pond's own fill", () => {
    // The exact stack `elementsFromPoint` returns at his probe point once press 1 has selected it:
    // the transparent hit square (inside the handle layer, itself inside no feature) over the water.
    expect(resolveDoubleClickTarget([
      { feature: null, handle: true, dim: false },     // rect[data-testid="vtx-handle"]
      { feature: null, handle: true, dim: false },     // g[data-handle-layer="1"]
      feat("el:e1454853gyzzln"),                       // path[fill=url(#grad-water)] — the pond
    ])).toEqual({ kind: "el", id: "e1454853gyzzln" });
  });

  it("looks past a whole STACK of handles — a dense ring overlaps several hit squares", () => {
    const h = { feature: null, handle: true, dim: false };
    expect(resolveDoubleClickTarget([h, h, h, h, feat("parcel:p1")])).toEqual({ kind: "parcel", id: "p1" });
  });

  it("resolves to nothing when handles are ALL there is — a grip out in clear space opens nothing", () => {
    expect(resolveDoubleClickTarget([{ feature: null, handle: true }])).toBeNull();
    expect(resolveDoubleClickTarget([{ feature: null, handle: true }, plain()])).toBeNull();
  });

  it("still resolves when the handle is BELOW the feature", () => {
    expect(resolveDoubleClickTarget([feat("el:e1"), { feature: null, handle: true }])).toEqual({ kind: "el", id: "e1" });
  });

  it("a handle never masks a feature painted between it and the one below", () => {
    // Top-most-first still decides WHICH feature; transparency only removes the handle from the race.
    expect(resolveDoubleClickTarget([{ feature: null, handle: true }, feat("markup:m1"), feat("el:e1")]))
      .toEqual({ kind: "markup", id: "m1" });
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

  /* ⛔ B233153 — the two-press invariant needs to ask the APP what a double-click at a point would
   * address, mid-gesture. Re-implementing the rule in page script would test the harness's own copy
   * of it (the "a second hit-test is free to disagree" trap), so the resolution is exposed through
   * one E2E-gated, read-only hook and the harnesses drive that. If the hook goes, the invariant
   * silently stops measuring the product — so it is pinned here. */
  it("the double-click resolution is exposed to the harnesses through the E2E hook", () => {
    expect(SP).toMatch(/window\.__plannerHitTarget = hook/);
    expect(SP).toMatch(/dblResolveRef\.current = \(x, y\) => resolveDoubleClickTarget\(hitStackAt\(x, y\)\)/);
  });

  it("the hook is gated and nulled on unmount, like every other planner probe", () => {
    const at = SP.indexOf("window.__plannerHitTarget = hook");
    const block = SP.slice(Math.max(0, at - 400), at + 200);
    expect(block).toMatch(/window\.__PLANYR_E2E/);
    expect(SP).toMatch(/if \(window\.__plannerHitTarget === hook\) window\.__plannerHitTarget = null/);
  });

  /* The grips must keep taking their OWN presses — the fix is about identification, never delivery.
   * A vertex hit square with `pointerEvents="none"` would be undraggable, which is the regression
   * a careless reading of B233153 ("make the handle layer transparent") would produce. */
  it("the vertex hit square still receives its own press (dragging is untouched)", () => {
    expect(SP).toMatch(/data-testid="vtx-handle"[\s\S]{0,200}onPointerDown=\{onDown\}/);
  });
});
