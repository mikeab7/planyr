import { describe, it, expect } from "vitest";
import {
  quarterOffset, bondedChildRot, createSiteModel, SITE_MODEL_VERSION,
} from "../src/workspaces/site-planner/lib/siteModel.js";

const norm = (a) => ((a % 360) + 360) % 360;

describe("bonded-child rotation invariant (B358)", () => {
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
