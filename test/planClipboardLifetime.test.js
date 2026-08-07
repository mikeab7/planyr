/* NEW-1 — the clipboard's LIFETIME and the coordinate decision that comes with it.
 *
 * The owner could not copy a polygon between two plans of one site. `planClipboard.js` already
 * covered every drawn kind, so nothing about COVERAGE was wrong; the payload was held in a ref
 * inside `SitePlanner`, which `SitePlannerApp` mounts keyed on the plan id, so a plan switch
 * remounted the component and destroyed the copy.
 *
 * Two halves are proven here, both pure:
 *   · planClipboardStore.js — the payload survives anything that is not a page load, because it
 *     is not owned by a component at all.
 *   · resolveClipFrame — WHERE a copy lands when the two plans are anchored differently, and the
 *     two cases it must refuse rather than guess at.
 * The WIRING half (that a real plan switch really does keep the copy, and that each kind really
 * pastes into the sibling plan) is e2e/clipboard-survives-plan-switch.spec.js — a unit test on
 * this module cannot see a mount boundary, which is the whole reason the bug shipped.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  setCanvasClip, getCanvasClip, hasCanvasClip,
  setOverlayClip, getOverlayClip, hasOverlayClip,
  hasAnyClip, clearClipboard,
} from "../src/workspaces/site-planner/lib/planClipboardStore.js";
import { resolveClipFrame, clipPlacement, CLIP_FRAME_MAX_SMEAR_FT } from "../src/workspaces/site-planner/lib/planClipboard.js";
import { lngLatToFeet, feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";

const payload = (n = 1) => ({
  items: Array.from({ length: n }, (_, i) => ({ kind: "markup", obj: { id: `m${i}`, pts: [{ x: 0, y: 0 }] } })),
  counts: { markup: n },
  siteId: "planA",
  origin: { lat: 29.78, lon: -95.75 },
});

describe("planClipboardStore — the payload outlives the component that made it", () => {
  beforeEach(() => clearClipboard());

  it("holds a copy across any number of reads (the remount case, in miniature)", () => {
    setCanvasClip(payload(2));
    // A remount is, from this module's point of view, simply nobody calling `set` again. The
    // payload is still here — which is exactly what the ref could not do.
    expect(hasCanvasClip()).toBe(true);
    expect(getCanvasClip().items).toHaveLength(2);
    expect(getCanvasClip().siteId).toBe("planA");
  });

  it("keeps the source plan id and origin, because paste cannot re-derive them", () => {
    setCanvasClip(payload());
    expect(getCanvasClip().origin).toEqual({ lat: 29.78, lon: -95.75 });
  });

  it("an empty payload clears rather than arming a paste that would do nothing", () => {
    setCanvasClip(payload());
    setCanvasClip({ items: [], counts: {}, siteId: "planB", origin: null });
    expect(hasCanvasClip()).toBe(false);
    expect(getCanvasClip()).toBe(null);
    setCanvasClip(payload());
    setCanvasClip(null);
    expect(hasCanvasClip()).toBe(false);
  });

  it("the overlay clipboard is a SEPARATE slot with the same lifetime", () => {
    setCanvasClip(payload());
    setOverlayClip({ overlay: { id: "o1", name: "Survey.pdf" }, siteId: "planA", origin: null });
    expect(hasOverlayClip()).toBe(true);
    expect(getOverlayClip().overlay.name).toBe("Survey.pdf");
    // Copying a drawn object must not wipe a copied reference drawing, or vice versa.
    setCanvasClip(payload(3));
    expect(hasOverlayClip()).toBe(true);
    expect(hasCanvasClip()).toBe(true);
  });

  it("hasAnyClip is what the Paste menu row is enabled on", () => {
    expect(hasAnyClip()).toBe(false);
    setOverlayClip({ overlay: { id: "o1" }, siteId: "planA", origin: null });
    expect(hasAnyClip()).toBe(true);
    clearClipboard();
    expect(hasAnyClip()).toBe(false);
    setCanvasClip(payload());
    expect(hasAnyClip()).toBe(true);
  });

  it("an overlay payload with no overlay clears rather than arming a broken paste", () => {
    setOverlayClip({ overlay: { id: "o1" }, siteId: "planA", origin: null });
    setOverlayClip({ overlay: null, siteId: "planB", origin: null });
    expect(hasOverlayClip()).toBe(false);
  });
});

describe("resolveClipFrame — where a copy lands when the two plans are anchored differently", () => {
  const houston = { lat: 29.7801, lon: -95.7512 };

  it("identical origins are a clean no-op (the New plan (same parcel) case)", () => {
    const f = resolveClipFrame(houston, { ...houston }, { ref: { x: 500, y: -200 }, extentFt: 800 });
    expect(f).toMatchObject({ ok: true, dx: 0, dy: 0, same: true });
  });

  it("two plans with NO map origin are two abstract feet frames — nothing to reconcile", () => {
    expect(resolveClipFrame(null, null, { extentFt: 800 })).toMatchObject({ ok: true, dx: 0, dy: 0, same: true });
  });

  it("a nearby different origin re-projects to the SAME GROUND POSITION", () => {
    // Two anchors ~1,100 ft apart — the shape of a site whose plans were created separately.
    const other = { lat: 29.7831, lon: -95.7482 };
    const ref = { x: 420, y: -260 };
    const f = resolveClipFrame(houston, other, { ref, extentFt: 900 });
    expect(f.ok).toBe(true);
    expect(f.same).toBe(false);

    // The ground truth: take the point out of plan A's frame and into plan B's the long way.
    const [lat, lon] = feetToLatLngPair(ref, houston.lat, houston.lon);
    const want = lngLatToFeet(lon, lat, other.lon, other.lat);
    expect(ref.x + f.dx).toBeCloseTo(want.x, 6);
    expect(ref.y + f.dy).toBeCloseTo(want.y, 6);
    // …and it is a real move, not an accidental zero.
    expect(Math.hypot(f.dx, f.dy)).toBeGreaterThan(100);
  });

  it("size is NOT rescaled — a copied building keeps its real-world dimensions", () => {
    // The frames differ by a uniform scale we deliberately drop; what is left is a pure
    // translation, so every point of the set moves by the SAME delta and nothing is stretched.
    const other = { lat: 29.7901, lon: -95.7412 };
    const opts = { extentFt: 900 };
    const a = resolveClipFrame(houston, other, { ...opts, ref: { x: 0, y: 0 } });
    expect(a.ok).toBe(true);
    // A different ref point re-centres the translation, but the answer is still ONE delta applied
    // to everything — the pasted geometry is congruent with the copied geometry either way.
    const b = resolveClipFrame(houston, other, { ...opts, ref: { x: 900, y: 900 } });
    expect(b.ok).toBe(true);
    expect(Math.abs(b.dx - a.dx)).toBeLessThan(CLIP_FRAME_MAX_SMEAR_FT);
    expect(Math.abs(b.dy - a.dy)).toBeLessThan(CLIP_FRAME_MAX_SMEAR_FT);
  });

  it("REFUSES, by name, when only one of the two plans is on the map", () => {
    const a = resolveClipFrame(houston, null, { extentFt: 500 });
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("no-origin");
    expect(a.message).toMatch(/cursor/i);
    const b = resolveClipFrame(null, houston, { extentFt: 500 });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("no-origin");
    // The two directions say DIFFERENT things — which plan is the one not on the map matters.
    expect(b.message).not.toBe(a.message);
  });

  it("REFUSES when the two plans are far enough apart that a translation is a lie", () => {
    const dallas = { lat: 32.7767, lon: -96.797 };
    const f = resolveClipFrame(houston, dallas, { ref: { x: 0, y: 0 }, extentFt: 2000 });
    expect(f.ok).toBe(false);
    expect(f.reason).toBe("frame-too-far");
    expect(f.smearFt).toBeGreaterThan(CLIP_FRAME_MAX_SMEAR_FT);
    expect(f.message).toMatch(/cursor/i);
  });

  it("the refusal is about the SET's size, not just the distance — a small copy still crosses", () => {
    const dallas = { lat: 32.7767, lon: -96.797 };
    // Same two cities; a 10 ft object smears by far less than a 2,000 ft one.
    const small = resolveClipFrame(houston, dallas, { ref: { x: 0, y: 0 }, extentFt: 10 });
    expect(small.ok).toBe(true);
    expect(small.smearFt).toBeLessThanOrEqual(CLIP_FRAME_MAX_SMEAR_FT);
  });

  it("two concepts of one parcel are never refused, however big the copied set", () => {
    // A whole 2,500 ft site copied between plans anchored 1,000 ft apart: comfortably inside.
    const f = resolveClipFrame(houston, { lat: 29.7828, lon: -95.7512 }, { ref: { x: 0, y: 0 }, extentFt: 2500 });
    expect(f.ok).toBe(true);
    expect(f.smearFt).toBeLessThan(CLIP_FRAME_MAX_SMEAR_FT);
  });

  it("a malformed origin is treated as no origin, never as lat/lon zero", () => {
    expect(resolveClipFrame({ lat: NaN, lon: -95.7 }, houston, { extentFt: 100 }).reason).toBe("no-origin");
    expect(resolveClipFrame({ lon: -95.7 }, houston, { extentFt: 100 }).reason).toBe("no-origin");
    expect(resolveClipFrame(houston, { lat: 29.7, lon: null }, { extentFt: 100 }).reason).toBe("no-origin");
  });
});

describe("clipPlacement — the ONE placement decision both Ctrl+V paths use", () => {
  const bbox = { x0: 0, y0: 0, x1: 100, y1: 60 };          // centre (50, 30)
  const okFrame = { ok: true, dx: 12, dy: -7 };
  const refused = { ok: false, reason: "no-origin", why: "no map", message: "no map — aim it" };

  it("a same-plan paste lands at the cursor, exactly as it always did (B417)", () => {
    expect(clipPlacement({ crossPlan: false, frame: null, bbox, cursor: { x: 200, y: 100 }, nudge: 20 }))
      .toEqual({ mode: "cursor", dx: 150, dy: 70 });
  });

  it("a same-plan paste with no cursor yet still nudges — paste is never a silent no-op", () => {
    expect(clipPlacement({ crossPlan: false, frame: null, bbox, cursor: null, nudge: 20 }))
      .toEqual({ mode: "nudge", dx: 20, dy: 20 });
  });

  it("a cross-plan paste lands IN PLACE and ignores the cursor entirely", () => {
    // This is what makes the per-mount pointer ref irrelevant: a fresh mount has no pointer
    // history, and a cross-plan paste never asks for one.
    expect(clipPlacement({ crossPlan: true, frame: okFrame, bbox, cursor: { x: 999, y: 999 }, nudge: 20 }))
      .toEqual({ mode: "in-place", dx: 12, dy: -7 });
    expect(clipPlacement({ crossPlan: true, frame: okFrame, bbox, cursor: null, nudge: 20 }))
      .toEqual({ mode: "in-place", dx: 12, dy: -7 });
  });

  it("a cross-plan paste the frames cannot place falls back to the cursor, not to a guess", () => {
    expect(clipPlacement({ crossPlan: true, frame: refused, bbox, cursor: { x: 200, y: 100 }, nudge: 20 }))
      .toEqual({ mode: "cursor", dx: 150, dy: 70 });
  });

  it("…and REFUSES when there is no frame relation AND nowhere aimed", () => {
    const p = clipPlacement({ crossPlan: true, frame: refused, bbox, cursor: null, nudge: 20 });
    expect(p.mode).toBe("refuse");
    expect(p.message).toBe(refused.message);
    // The nudge is never used across a plan boundary — that is the silent-wrong-place outcome.
    expect(p.dx).toBeUndefined();
  });

  it("a non-finite cursor is no cursor at all", () => {
    expect(clipPlacement({ crossPlan: false, frame: null, bbox, cursor: { x: NaN, y: 0 }, nudge: 20 }).mode).toBe("nudge");
  });
});

/* The defect was WHERE the payload is held, so the source guard is part of the fix, not decoration:
 * a `useRef` clipboard reads as perfectly ordinary React and would come back on the next edit. */
describe("source guard — the payload is not owned by the component again", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

  it("SitePlanner declares no clipboard ref of its own", () => {
    expect(src).not.toMatch(/const\s+clip\s*=\s*useRef/);
    expect(src).not.toMatch(/const\s+overlayClip\s*=\s*useRef/);
    expect(src).not.toMatch(/\bclip\.current\b/);
    expect(src).not.toMatch(/\boverlayClip\.current\b/);
  });

  it("both Ctrl+V paths read the SAME store — leaving one behind is how they diverge", () => {
    expect(src).toMatch(/from\s+"\.\/lib\/planClipboardStore\.js"/);
    for (const fn of ["setCanvasClip", "getCanvasClip", "hasCanvasClip", "setOverlayClip", "getOverlayClip", "hasOverlayClip"]) {
      expect(src).toContain(fn);
    }
  });

  it("every copy stamps its source plan, so paste can tell it is crossing a plan boundary", () => {
    expect(src).toMatch(/clipProvenance\s*=\s*\(\)\s*=>\s*\(\{\s*siteId/);
    expect(src).toMatch(/resolveClipFrame/);
  });
});
