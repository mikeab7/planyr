/* B385040 — AN UNDO THAT TOUCHED NO LAYER MUST NOT REBUILD THE MAP LAYERS.
 *
 * Owner, verbatim: *"the screen flashes on every ctrl z, that doesn't seem necessary."*
 *
 * `applySnapshot` ran the layer restore UNCONDITIONALLY on every undo and every redo, and
 * `applyOnOverrides` returned a BRAND-NEW outer object every call — it carefully preserved each
 * INNER layer state's identity and then threw that away by allocating the map around them. Three
 * effects in `SitePlanner.jsx` key off the `overlays` identity, one of which tears the entire
 * Leaflet overlay stack down (clearing its intervals and idle callbacks) and re-adds it. So an
 * undo of a plain geometry edit rebuilt every GIS layer on the map.
 *
 * The fix has two ends and this suite tests both, because either alone leaves a way back in:
 *   (a) the pure functions are IDENTITY-STABLE — no caller can trip this by being written
 *       carelessly, present or future;
 *   (b) `applySnapshot` compares signatures and skips the setState entirely, so React is not even
 *       asked on the overwhelmingly common no-layer-change undo.
 * Plus the half that must NOT regress: a REAL layer change still restores.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them so the module loads in the
// node test environment (the same list test/layerPrefs.test.js uses).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  applyOnOverrides, applyAboveOverrides, overlaysWithOverrides,
  overridesFromOverlays, overridesSig, aboveSig, aboveFromOverlays,
} from "../src/workspaces/site-planner/lib/layerPrefs.js";
import { ALL_LAYERS, defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import { configCanLift } from "../src/workspaces/site-planner/lib/mapStack.js";

const src = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
const someKey = Object.keys(defaultOverlayState())[0];
const liftKey = Object.keys(ALL_LAYERS).find((k) => configCanLift(ALL_LAYERS[k]));

describe("(a) the pure projections are IDENTITY-STABLE", () => {
  it("applyOnOverrides returns the INPUT object when no layer's on-state moves", () => {
    const cur = defaultOverlayState();
    const sig = overridesFromOverlays(cur);
    expect(applyOnOverrides(cur, sig)).toBe(cur);
    // …and again after a real toggle has been applied: re-applying the same map is still a no-op.
    const on = applyOnOverrides(cur, { [someKey]: true });
    expect(on).not.toBe(cur);
    expect(applyOnOverrides(on, { [someKey]: true })).toBe(on);
  });

  it("applyOnOverrides STILL returns a new object — and new inner state — when something moves", () => {
    const cur = defaultOverlayState();
    const next = applyOnOverrides(cur, { [someKey]: !cur[someKey].on });
    expect(next).not.toBe(cur);
    expect(next[someKey]).not.toBe(cur[someKey]);
    expect(next[someKey].on).toBe(!cur[someKey].on);
    // every untouched layer keeps its identity, which is what lets React skip them
    for (const k of Object.keys(cur)) if (k !== someKey) expect(next[k]).toBe(cur[k]);
  });

  it("applyOnOverrides preserves live opacity while flipping `on` (the reason it exists)", () => {
    const cur = defaultOverlayState();
    const fiddled = { ...cur, [someKey]: { ...cur[someKey], opacity: 0.37 } };
    const next = applyOnOverrides(fiddled, { [someKey]: !cur[someKey].on });
    expect(next[someKey].opacity).toBe(0.37);
  });

  it("applyAboveOverrides is identity-stable too — an undo spanning neither must move neither", () => {
    const cur = overlaysWithOverrides({}, {});
    expect(applyAboveOverrides(cur, aboveFromOverlays(cur))).toBe(cur);
    const lifted = applyAboveOverrides(cur, { [liftKey]: true });
    expect(lifted).not.toBe(cur);
    expect(applyAboveOverrides(lifted, { [liftKey]: true })).toBe(lifted);
  });

  it("the composition used by the restore is identity-stable end to end", () => {
    const cur = overlaysWithOverrides({ [someKey]: true }, { [liftKey]: true });
    const same = applyAboveOverrides(applyOnOverrides(cur, overridesFromOverlays(cur)), aboveFromOverlays(cur));
    expect(same).toBe(cur); // ⇒ React bails out of the setState ⇒ no effect re-runs ⇒ no layer rebuild
  });

  it("garbage / empty input still yields a usable map rather than throwing", () => {
    expect(applyOnOverrides(null, null)).toEqual({});
    expect(applyAboveOverrides(null, null)).toEqual({});
  });
});

describe("(b) applySnapshot skips the layer restore when the signature already matches", () => {
  const snap = (() => {
    const i = src.indexOf("const applySnapshot = (s) =>");
    return src.slice(i, i + src.slice(i).indexOf("\n  };"));
  })();

  it("guards the restore on overridesSig / aboveSig against the accounted-for signature", () => {
    expect(snap).toMatch(/const snapSig = overridesSig\(snapOverrides\)/);
    expect(snap).toMatch(/const snapAboveSig = aboveSig\(snapAbove\)/);
    expect(snap).toMatch(/if \(snapSig !== prevLayerSig\.current \|\| snapAboveSig !== prevAboveSig\.current\)/);
  });

  it("every layer writer is INSIDE that guard — none may run unconditionally", () => {
    const guarded = snap.slice(snap.indexOf("if (snapSig !== prevLayerSig.current"));
    for (const call of ["setOverlays(", "setLayerOverrides(", "setLayerAbove("]) {
      expect(snap.split(call).length - 1, `${call} appears more than once in applySnapshot`).toBe(1);
      expect(guarded).toContain(call);
    }
  });

  it("the signatures are the SAME cheap equality the persist effect already uses", () => {
    // A no-op restore must compare equal; a real toggle must not. (If these two ever stopped
    // agreeing, the guard would either never fire or would swallow a real layer undo.)
    const a = overridesFromOverlays(defaultOverlayState());
    expect(overridesSig(a)).toBe(overridesSig({ ...a }));
    expect(overridesSig({ [someKey]: true })).not.toBe(overridesSig({}));
    expect(aboveSig({ [liftKey]: true })).not.toBe(aboveSig({}));
  });
});

describe("the real case is untouched — a layer toggle still reverts on undo", () => {
  it("a snapshot describing a DIFFERENT visibility set changes the signature, so the guard opens", () => {
    const before = overlaysWithOverrides({}, {});
    const after = applyOnOverrides(before, { [someKey]: true });
    const sigBefore = overridesSig(overridesFromOverlays(before));
    const sigAfter = overridesSig(overridesFromOverlays(after));
    expect(sigAfter).not.toBe(sigBefore);
    // …and restoring the pre-toggle snapshot onto the live overlays really does turn it back off.
    const reverted = applyOnOverrides(after, overridesFromOverlays(before));
    expect(reverted).not.toBe(after);
    expect(!!reverted[someKey].on).toBe(!!before[someKey].on);
  });

  it("a lift undo reverts the band without disturbing visibility", () => {
    const on = overlaysWithOverrides({ [liftKey]: true }, {});
    const lifted = applyAboveOverrides(on, { [liftKey]: true });
    expect(lifted[liftKey].above).toBe(true);
    const reverted = applyAboveOverrides(lifted, {});
    expect(reverted[liftKey].above).toBe(false);
    expect(reverted[liftKey].on).toBe(true);
  });
});

describe("a still-valid selection survives the undo (B385040, the second half)", () => {
  const snap = (() => {
    const i = src.indexOf("const applySnapshot = (s) =>");
    return src.slice(i, i + src.slice(i).indexOf("\n  };"));
  })();

  it("filters both selection stores against the RESTORED collections rather than blanking them", () => {
    expect(snap).toMatch(/const snapHas = \(r\) =>/);
    expect(snap).toMatch(/setSel\(\(cur\) => \(snapHas\(cur\) \? cur : null\)\)/);
    expect(snap).toMatch(/\.filter\(snapHas\)/);
  });

  it("covers every selectable kind, so no kind is silently dropped on every undo", () => {
    const has = snap.slice(snap.indexOf("const snapHas"), snap.indexOf("setSel((cur)"));
    for (const kind of ["el", "parcel", "measure", "callout", "markup"]) {
      expect(has, `snapHas does not handle kind "${kind}"`).toContain(`"${kind}"`);
    }
  });

  it("still clears the pointers that a restore CAN invalidate (vertex / split / drill / menu)", () => {
    expect(snap).toMatch(/setDrillId\(null\); setSelVtx\(null\); setSplitPath\(\[\]\); setTypeMenu\(null\)/);
  });
});
