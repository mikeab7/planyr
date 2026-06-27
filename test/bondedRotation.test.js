import { describe, it, expect } from "vitest";
import {
  quarterOffset, bondedChildRot, createSiteModel, SITE_MODEL_VERSION,
} from "../src/workspaces/site-planner/lib/siteModel.js";
import { dogEarGeom, dogEarSize, DOGEAR_D } from "../src/workspaces/site-planner/lib/dogEar.js";

const norm = (a) => ((a % 360) + 360) % 360;

describe("bonded-child rotation invariant (B363)", () => {
  it("quarterOffset rounds the child→host angle gap to the nearest quarter turn", () => {
    expect(quarterOffset(359.035, 0)).toBe(0);    // Jacintoport: ~1° drift → offset 0
    expect(quarterOffset(0.9, 0)).toBe(0);
    expect(quarterOffset(90.4, 0)).toBe(90);      // a side-parking +90 turn, slightly off
    expect(quarterOffset(269.6, 0)).toBe(270);
    expect(quarterOffset(91, 1)).toBe(90);        // host itself at an angle
  });

  it("bondedChildRot = host angle + the child's quarter-turn offset (drift removed)", () => {
    expect(bondedChildRot(359.035, 0)).toBe(0);   // the live bug: child ~1° off a 0° host → 0
    expect(bondedChildRot(89, 90)).toBe(90);      // child just under, host at 90 → matches host
    expect(bondedChildRot(90.4, 0)).toBe(90);     // a real +90 child keeps its quarter turn
    expect(norm(bondedChildRot(1.2, 37))).toBe(37); // arbitrary host angle, offset-0 child
  });

  it("REPAIR (Jacintoport): migrate re-anchors a drifted assembly to the host angle, both rot AND position", () => {
    // Host straightened to 0°, but its four bonded children were left at 359.035° AND positioned
    // as if the host were still at 359.035° (a path that didn't carry them). Build that state by
    // taking each child's correct-at-0° placement and rotating it by +359.035° about the host.
    const theta = 359.035, r = (theta * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    const placedFor = (cx, cy) => ({ cx: cx * cs - cy * sn, cy: cx * sn + cy * cs, rot: norm(theta) });
    const host = { id: "e8984", type: "building", cx: 0, cy: 0, w: 300, h: 638, rot: 0 };
    // correct-at-0° centres for a sidewalk (bottom), court (bottom, further out), two corner bumps
    const correct = {
      e8988: { cx: 0, cy: 322 },     // sidewalk on the bottom face
      e8985: { cx: 0, cy: 386.5 },   // truck court beyond it
      e8986: { cx: -122.5, cy: 349 },// bottom-left bump
      e8987: { cx: 122.5, cy: 349 }, // bottom-right bump
    };
    const els = [host, ...Object.entries(correct).map(([id, c]) => ({
      id, type: "building", attachedTo: "e8984", ...placedFor(c.cx, c.cy),
    }))];

    const fixed = createSiteModel({ els }).els;
    for (const [id, c] of Object.entries(correct)) {
      const child = fixed.find((e) => e.id === id);
      expect(norm(child.rot)).toBeCloseTo(0, 3);   // angle snapped to the host's 0°
      expect(child.cx).toBeCloseTo(c.cx, 2);        // and re-anchored to its correct-at-0° centre
      expect(child.cy).toBeCloseTo(c.cy, 2);
    }
  });

  it("leaves a correctly-bonded assembly UNTOUCHED (no needless churn) and is idempotent", () => {
    const host = { id: "h", type: "building", cx: 10, cy: 20, w: 100, h: 200, rot: 30 };
    const els = [
      host,
      { id: "c0", type: "building", attachedTo: "h", cx: 11, cy: 21, rot: 30 },   // offset 0
      { id: "c90", type: "parking", attachedTo: "h", cx: 12, cy: 22, rot: 120 },  // offset +90
    ];
    const once = createSiteModel({ els }).els;
    expect(once.find((e) => e.id === "c0").rot).toBe(30);
    expect(once.find((e) => e.id === "c90").rot).toBe(120);
    // unchanged children keep object identity through the normalizer
    expect(once.find((e) => e.id === "c90")).toBe(els[2]);
    // idempotent
    const twice = createSiteModel({ els: once }).els;
    expect(twice.find((e) => e.id === "c0").rot).toBe(30);
    expect(twice.find((e) => e.id === "c90").rot).toBe(120);
  });

  it("never touches points-based children (markups carry geometry in their points, no rot)", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 100, h: 100, rot: 0 };
    const poly = { id: "p", attachedTo: "h", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    const out = createSiteModel({ els: [host, poly] }).els;
    expect(out.find((e) => e.id === "p")).toBe(poly);
  });

  it("the schema version was bumped for the new fields", () => {
    expect(SITE_MODEL_VERSION).toBeGreaterThanOrEqual(7);
  });
});

describe("dog-ear bump-out re-anchors to the host's CURRENT edge on load (NEW-6)", () => {
  // A host with a right-side dock; a right-corner bump flush to the right edge of THIS host.
  const flushBump = (id, sign, host, deExtra = {}) => {
    const de = { side: "right", sign, ...deExtra };
    return { id, type: "building", attachedTo: host.id, noFit: true, dock: "none", dogEar: de, ...dogEarGeom(host, de) };
  };

  it("self-heals the live Jacintoport record: bumps stuck 13.5′ inside a since-widened host", () => {
    // Building 1: host widened to 328.49 AFTER the bumps were placed flush to the old 301.5′ host,
    // so both bumps froze at cx 4.19 (inner edge −25.81, i.e. 13.5′ inside the current right edge).
    const host = { id: "e8984", type: "building", cx: -176.567, cy: 0, w: 328.49, h: 1159, rot: 0 };
    const mkBump = (id, sign) => ({
      id, type: "building", attachedTo: "e8984", noFit: true, dock: "none",
      dogEar: { side: "right", sign }, cx: 4.19, cy: sign * 552, w: 60, h: 55, rot: 0,
    });
    const els = [host, mkBump("e8986", 1), mkBump("e8987", -1)];

    const out = createSiteModel({ els }).els;
    const hostRight = host.cx + host.w / 2; // −12.322
    for (const sign of [1, -1]) {
      const b = out.find((e) => e.id === (sign === 1 ? "e8986" : "e8987"));
      // inner (left) edge re-lands EXACTLY on the host's current right edge → ZERO overlap (was 13.5′)
      expect(b.cx - b.w / 2).toBeCloseTo(hostRight, 4);
      // and it now protrudes OUTWARD past the edge instead of straddling it
      expect(b.cx + b.w / 2).toBeGreaterThan(hostRight);
      expect(b.cx).toBeCloseTo(17.678, 3); // the re-derived centre from the analysis
      expect(b.w).toBe(60);                 // projection unchanged (no resize, just re-anchor)
      expect(b.h).toBe(55);                 // along unchanged
      expect(b.cy).toBeCloseTo(sign * 552, 4); // host height unchanged → along the wall unmoved
    }
  });

  it("re-anchors any host widen to zero overlap, generally (place flush, then widen the host)", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 300, h: 600, rot: 0 };
    const bumps = [flushBump("bpos", 1, host), flushBump("bneg", -1, host)];
    const widened = { ...host, w: 360 }; // host grew 60′ after the bumps were placed
    const out = createSiteModel({ els: [widened, ...bumps] }).els;
    const right = widened.cx + widened.w / 2; // 180
    for (const id of ["bpos", "bneg"]) {
      const b = out.find((e) => e.id === id);
      expect(b.cx - b.w / 2).toBeCloseTo(right, 6); // flush, no penetration
      expect(b.w).toBe(DOGEAR_D);                   // default 60 projection preserved
    }
  });

  it("leaves an already-flush bump UNTOUCHED (idempotent, preserves object identity)", () => {
    const host = { id: "h", type: "building", cx: 10, cy: -5, w: 280, h: 540, rot: 0 };
    const els = [host, flushBump("b", 1, host), flushBump("b2", -1, host)];
    const out = createSiteModel({ els }).els;
    expect(out.find((e) => e.id === "b")).toBe(els[1]);   // same reference back → no churn
    expect(out.find((e) => e.id === "b2")).toBe(els[2]);
    // idempotent across a second pass
    const twice = createSiteModel({ els: out }).els;
    expect(twice.find((e) => e.id === "b")).toBe(out.find((e) => e.id === "b"));
  });

  it("preserves a user-resized bump's stored span (along/proj) across the widen", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 300, h: 600, rot: 0 };
    // resized to projection 80 × along 90 (box w=80,h=90 on the right wall) — captured on the tag
    const de = { side: "right", sign: 1, ...dogEarSize({ side: "right" }, 80, 90) }; // {along:90, proj:80}
    const placed = { id: "br", type: "building", attachedTo: "h", dogEar: de, ...dogEarGeom(host, de) };
    const widened = { ...host, w: 360 };
    const b = createSiteModel({ els: [widened, placed] }).els.find((e) => e.id === "br");
    expect(b.w).toBe(80);                         // projection preserved (NOT reset to default 60)
    expect(b.h).toBe(90);                         // along preserved (NOT reset to default 55)
    expect(b.cx - b.w / 2).toBeCloseTo(180, 6);   // flush to the new right edge
  });

  it("carries the host's rotation into the re-anchored bump", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 300, h: 600, rot: 30 };
    const bump = flushBump("b", 1, host);                  // flush + rot 30 for this host
    const wider = { ...host, w: 380 };
    const b = createSiteModel({ els: [wider, bump] }).els.find((e) => e.id === "b");
    expect(norm(b.rot)).toBeCloseTo(30, 6);
    // it stays flush to the (rotated) host's right face: same box dogEarGeom derives for the wider host
    const want = dogEarGeom(wider, bump.dogEar);
    expect(b.cx).toBeCloseTo(want.cx, 6);
    expect(b.cy).toBeCloseTo(want.cy, 6);
  });

  it("a malformed dog-ear side never throws (crash-safety: must not blank the planner on load)", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 300, h: 600, rot: 0 };
    const bad = { id: "x", type: "building", attachedTo: "h", dogEar: { side: "bogus", sign: 1 }, cx: 5, cy: 5, w: 60, h: 55, rot: 0 };
    expect(() => createSiteModel({ els: [host, bad] })).not.toThrow();
    // the bad record survives (it falls through to the rotation pass; not re-flushed off a bad side)
    expect(createSiteModel({ els: [host, bad] }).els.find((e) => e.id === "x")).toBeTruthy();
  });
});
