import { describe, it, expect } from "vitest";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { dogEarGeom } from "../src/workspaces/site-planner/lib/dogEar.js";

// B487 — load-time re-anchor for corner bump-outs ("dog-ears").
// Cowork's 2026-06-26 signed-in audit found a real Jacintoport site (smqdxst8pf3g) with dog-ear
// children orphaned 13.5 ft inside the host's current right edge — the host was widened via a code
// path that missed the runtime refitChildren, so the dog-ears stayed at the pre-resize cx. Fix:
// createSiteModel now snaps every dog-ear child to dogEarGeom(host, dogEar) on load; idempotent, so
// the persisted record self-heals without touching correctly-anchored records.

const HOST = { id: "e8984", type: "building", cx: 0, cy: 0, w: 328.5, h: 300, rot: 0 };
// Exact stored numbers from Jacintoport (post host-widen 301.5 → 328.5): cx 4.2 → left edge −25.8,
// i.e. 13.5 ft INSIDE the current right edge (−12.3). Correct cx for this dog-ear on the current
// host is dogEarGeom(HOST, {side:"right",sign:-1}).cx.
const DRIFTED = { id: "e8986", type: "building", attachedTo: "e8984",
  dogEar: { side: "right", sign: -1 }, cx: 4.2, cy: 100, w: 60, h: 55, rot: 0 };

describe("B487 — dog-ear children re-anchor to the host's current edge on load", () => {
  it("snaps a drifted dog-ear to dogEarGeom(host, dogEar) — Jacintoport orphan-bumpout", () => {
    const m = createSiteModel({ id: "s", els: [HOST, DRIFTED] });
    const fixed = m.els.find((e) => e.id === "e8986");
    const want = dogEarGeom(HOST, DRIFTED.dogEar);
    expect(fixed.cx).toBeCloseTo(want.cx, 6);           // now flush against the current right edge
    expect(fixed.cy).toBeCloseTo(want.cy, 6);
    expect(fixed.w).toBeCloseTo(want.w, 6);
    expect(fixed.h).toBeCloseTo(want.h, 6);
    // Sanity: the fixed cx is NOT the drifted 4.2 anymore (would have been 13.5 ft inside the host).
    expect(Math.abs(fixed.cx - 4.2)).toBeGreaterThan(1);
  });

  it("leaves a correctly-anchored dog-ear untouched (idempotent — no version churn)", () => {
    // z present (v12 shape) so ensureZ no-ops → this isolates the dog-ear re-anchor's identity
    // preservation from the one-time z migration (which necessarily rebuilds objects to add z).
    const goodHost = { ...HOST, z: 0 };
    const good = { ...DRIFTED, ...dogEarGeom(HOST, DRIFTED.dogEar), z: 1024 };
    const m = createSiteModel({ id: "s", els: [goodHost, good] });
    const fixed = m.els.find((e) => e.id === "e8986");
    // Object identity is preserved when nothing changes → cheap re-load.
    expect(fixed).toBe(good);
  });

  /* NEW-3 (2026-08-03) — this case used to place the pad 35 ft off its own wall and assert that the
   * heal never touched it. That was only ever true because the pad carried NO role tag, and "an
   * untagged bonded pad is invisible to every wall pass" is precisely the state that cost Goose
   * Creek two sidewalks: three untagged Explode pieces sat on a wall that every lookup reported as
   * empty, so one "−" click fell through to the sidewalk rung. The pad now gets its role back.
   * So the case is restated at a FIXED POINT — the pad sits exactly where the bottom wall puts it —
   * which still proves the DOG-EAR pass leaves a non-dogEar child's geometry alone, and additionally
   * proves the re-tag is geometry-neutral. */
  it("does not move a non-dogEar bonded pad — and gives it back the wall role it was missing", () => {
    // Bottom wall, no strip: derived centre is host.h/2 + depth/2 = 150 + 15 = 165, run/centre kept.
    const pad = { id: "tc", type: "paving", attachedTo: "e8984", cx: 100, cy: 165, w: 50, h: 30, rot: 0 };
    const m = createSiteModel({ id: "s", els: [HOST, pad] });
    const kept = m.els.find((e) => e.id === "tc");
    expect(kept.cx).toBeCloseTo(100, 6);
    expect(kept.cy).toBeCloseTo(165, 6);
    expect(kept.w).toBeCloseTo(50, 6);
    expect(kept.h).toBeCloseTo(30, 6);
    expect(kept.sideParkSide).toBe("bottom");                       // the identity it never had
    expect(kept.sideParkFit).toEqual({ run: 50, alongShift: 100 }); // its hand-set span, recorded
  });

  it("skips a dog-ear whose host is missing (no crash, kept as-is)", () => {
    const orphan = { ...DRIFTED, attachedTo: "nonesuch" };
    const m = createSiteModel({ id: "s", els: [orphan] });
    const kept = m.els[0];
    expect(kept.cx).toBe(4.2); // untouched
  });

  it("re-anchors on a rotated host too (uses the corrected host frame)", () => {
    const rotHost = { ...HOST, rot: 90 };
    const drifted = { ...DRIFTED, cx: 4.2, cy: 100 };
    const m = createSiteModel({ id: "s", els: [rotHost, drifted] });
    const fixed = m.els.find((e) => e.id === "e8986");
    const want = dogEarGeom(rotHost, drifted.dogEar);
    expect(fixed.cx).toBeCloseTo(want.cx, 6);
    expect(fixed.cy).toBeCloseTo(want.cy, 6);
    expect(fixed.rot).toBeCloseTo(want.rot, 6);
  });
});
