/* B1449 — the anchored render, and the two claims it stands on.
 *
 * CLAIM 1 (exactness): geometry emitted at the ANCHOR view and carried by ONE group transform
 * lands EXACTLY where a direct render at the LIVE view would have put it. If that is not exact,
 * a zoom gesture drifts and the drawing snaps when it settles — the "jump" VIEWPORT-STABLE bans.
 *
 * CLAIM 2 (no regression to the pan): at k === 1 the emitted attribute is byte-for-byte B1440's
 * pure translate. The owner calls the pan "great" after B1440; the zoom work must not touch it.
 *
 * Plus the wheel factor, whose whole point is that it is now PROPORTIONAL to how hard you scrolled
 * while leaving a real mouse detent numerically untouched.
 *
 * ⛔ MUTATION-CHECKED. Each block below names the mutation it catches, because a guard nobody has
 * seen fail is a guard that rots green (DANGEROUS-MEANS-UNOBSERVABLE / VIEW-INDEPENDENT-ONCE §6).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  anchorTransform, anchorTransformAttr, anchorHolds, anchoredEqualsDirect,
  ANCHOR_MAX_K, ZOOM_PER_NOTCH, WHEEL_MAX_NOTCHES,
  wheelNotches, wheelZoomFactor,
} from "../src/shared/viewport/viewAnchor.js";

const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

// A deliberately awkward spread: fractional ppf, negative offsets, a big zoom range.
const VIEWS = [
  { ppf: 0.35, offX: 60, offY: 60 },
  { ppf: 0.02, offX: -1240.5, offY: 331.25 },
  { ppf: 8, offX: 0, offY: 0 },
  { ppf: 1.234567, offX: -0.5, offY: 1e5 },
  { ppf: 0.4732, offX: 913.77, offY: -4021.09 },
];
const PTS = [0, 1, -1, 0.5, 1234.5678, -98765.4321, 1e6];

describe("CLAIM 1 — the anchored render is EXACT, not approximate", () => {
  it("puts every point exactly where a direct render at the live view would", () => {
    for (const anchor of VIEWS) {
      for (const view of VIEWS) {
        for (const p of PTS) {
          for (const axis of ["x", "y"]) {
            const { anchored, direct } = anchoredEqualsDirect(view, anchor, p, axis);
            // Float multiplication is not associative, so demand equality to within a
            // vanishing relative epsilon rather than bit-identity — but the epsilon has to be
            // small enough that a REAL error (a double-scale, a dropped term) cannot hide in it.
            const tol = Math.max(1e-9, Math.abs(direct) * 1e-12);
            expect(Math.abs(anchored - direct)).toBeLessThanOrEqual(tol);
          }
        }
      }
    }
  });

  it("MUTATION — a double-scaled transform (k applied twice) fails the same check", () => {
    const anchor = { ppf: 0.35, offX: 60, offY: 60 };
    const view = { ppf: 0.35 * 1.12, offX: 40, offY: 20 };
    const t = anchorTransform(view, anchor);
    const emitted = 1000 * anchor.ppf + anchor.offX;
    const correct = t.k * emitted + t.tx;
    const doubled = t.k * t.k * emitted + t.tx;   // the bug the mid-gesture harness exists to catch
    const direct = 1000 * view.ppf + view.offX;
    expect(Math.abs(correct - direct)).toBeLessThan(1e-9);
    expect(Math.abs(doubled - direct)).toBeGreaterThan(1);
  });

  it("refuses a degenerate anchor rather than emitting NaN", () => {
    expect(anchorTransform({ ppf: 1, offX: 0, offY: 0 }, null)).toBe(null);
    expect(anchorTransform({ ppf: 1, offX: 0, offY: 0 }, { ppf: 0, offX: 0, offY: 0 })).toBe(null);
    expect(anchorTransform(null, { ppf: 1, offX: 0, offY: 0 })).toBe(null);
  });
});

describe("CLAIM 2 — at k === 1 this IS B1440's pan path, byte for byte", () => {
  it("emits a bare translate for a pure pan", () => {
    const anchor = { ppf: 0.35, offX: 60, offY: 60 };
    const view = { ppf: 0.35, offX: 60 + 137, offY: 60 - 42 };
    expect(anchorTransformAttr(anchorTransform(view, anchor))).toBe("translate(137 -42)");
  });

  it("emits NO attribute at all when the anchor and the view coincide (rest + export)", () => {
    const v = { ppf: 0.35, offX: 60, offY: 60 };
    expect(anchorTransformAttr(anchorTransform(v, v))).toBe(undefined);
    expect(anchorTransformAttr(null)).toBe(undefined);
  });

  it("adds the scale term ONLY when the zoom actually differs", () => {
    const anchor = { ppf: 0.5, offX: 100, offY: 200 };
    const view = { ppf: 1, offX: 100, offY: 200 };
    const attr = anchorTransformAttr(anchorTransform(view, anchor));
    expect(attr).toContain("scale(2)");
    expect(attr).toBe("translate(-100 -200) scale(2)");
    // and it round-trips: the emitted anchor-space point lands at the live-space point
    const emitted = 300 * anchor.ppf + anchor.offX;   // 250
    expect(2 * emitted + -100).toBe(300 * view.ppf + view.offX);
  });

  it("never emits -0 (a churny attribute string React would keep rewriting)", () => {
    const anchor = { ppf: 1, offX: 0, offY: 0 };
    const view = { ppf: 1, offX: -1e-9, offY: 0 };
    expect(anchorTransformAttr(anchorTransform(view, anchor))).toBe(undefined);
  });
});

describe("the drift cap", () => {
  it("holds through an ordinary gesture and lets go past the cap", () => {
    const a = { ppf: 1, offX: 0, offY: 0 };
    expect(anchorHolds({ ppf: 1.12 ** 3, offX: 0, offY: 0 }, a)).toBe(true);
    expect(anchorHolds({ ppf: 1 / 1.12 ** 3, offX: 0, offY: 0 }, a)).toBe(true);
    expect(anchorHolds({ ppf: ANCHOR_MAX_K, offX: 0, offY: 0 }, a)).toBe(true);
    expect(anchorHolds({ ppf: ANCHOR_MAX_K * 1.01, offX: 0, offY: 0 }, a)).toBe(false);
    expect(anchorHolds({ ppf: 1 / (ANCHOR_MAX_K * 1.01), offX: 0, offY: 0 }, a)).toBe(false);
  });

  it("is symmetric in and out, so a sweep out and back re-bakes the same number of times", () => {
    const a = { ppf: 1, offX: 0, offY: 0 };
    for (let n = 1; n < 20; n++) {
      const inK = anchorHolds({ ppf: 1.12 ** n, offX: 0, offY: 0 }, a);
      const outK = anchorHolds({ ppf: 1.12 ** -n, offX: 0, offY: 0 }, a);
      expect(inK).toBe(outK);
    }
  });

  it("refuses a nonsense anchor", () => {
    expect(anchorHolds({ ppf: 1, offX: 0, offY: 0 }, { ppf: 1, offX: NaN, offY: 0 })).toBe(false);
    expect(anchorHolds({ ppf: NaN, offX: 0, offY: 0 }, { ppf: 1, offX: 0, offY: 0 })).toBe(false);
    expect(anchorHolds(null, null)).toBe(false);
  });
});

describe("the wheel factor is proportional — and a mouse detent is numerically untouched", () => {
  it("reproduces the pre-B1449 mouse notch EXACTLY (Object.is, not toBeCloseTo)", () => {
    expect(Object.is(wheelZoomFactor({ deltaY: -100, deltaMode: 0 }), 1.12)).toBe(true);
    expect(Object.is(wheelZoomFactor({ deltaY: 100, deltaMode: 0 }), 1 / 1.12)).toBe(true);
    // Firefox sends one detent as 3 LINES; same factor, so the two browsers agree.
    expect(Object.is(wheelZoomFactor({ deltaY: -3, deltaMode: 1 }), 1.12)).toBe(true);
    expect(Object.is(wheelZoomFactor({ deltaY: 3, deltaMode: 1 }), 1 / 1.12)).toBe(true);
  });

  it("MUTATION — the OLD rule (sign only) is what this replaces: a trackpad nudge is now tiny", () => {
    const oldRule = (dy) => (dy < 0 ? 1.12 : 1 / 1.12);
    const trackpad = { deltaY: -4, deltaMode: 0 };
    expect(oldRule(trackpad.deltaY)).toBe(1.12);              // a 12% jump for a 4px nudge
    const now = wheelZoomFactor(trackpad);
    expect(now).toBeGreaterThan(1);
    expect(now).toBeLessThan(1.006);                          // ~0.45%, i.e. continuous
  });

  it("composes: N small events zoom the same total as one N-sized event", () => {
    const one = wheelZoomFactor({ deltaY: -50, deltaMode: 0 });
    let many = 1;
    for (let i = 0; i < 10; i++) many *= wheelZoomFactor({ deltaY: -5, deltaMode: 0 });
    expect(many).toBeCloseTo(one, 12);
  });

  it("is monotonic in the delta and symmetric about zero", () => {
    let prev = 0;
    for (let d = -300; d <= 300; d += 7) {
      const f = wheelZoomFactor({ deltaY: d, deltaMode: 0 });
      if (d > -300) expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
      expect(wheelZoomFactor({ deltaY: d }) * wheelZoomFactor({ deltaY: -d })).toBeCloseTo(1, 12);
    }
    expect(wheelZoomFactor({ deltaY: 0 })).toBe(1);
  });

  it("clamps a runaway burst so one event can never teleport the view", () => {
    expect(wheelNotches({ deltaY: -100000, deltaMode: 0 })).toBe(WHEEL_MAX_NOTCHES);
    expect(wheelNotches({ deltaY: 100000, deltaMode: 0 })).toBe(-WHEEL_MAX_NOTCHES);
    expect(wheelZoomFactor({ deltaY: -100000 })).toBe(ZOOM_PER_NOTCH ** WHEEL_MAX_NOTCHES);
    // page mode is the other teleport risk
    expect(wheelNotches({ deltaY: -2, deltaMode: 2 })).toBe(WHEEL_MAX_NOTCHES);
  });

  it("survives garbage input without poisoning the view", () => {
    expect(wheelZoomFactor({})).toBe(1);
    expect(wheelZoomFactor({ deltaY: NaN })).toBe(1);
    // A non-finite delta zooms NOTHING rather than clamping to a full three notches: an infinite
    // delta is a broken event, and the safe reading of a broken event is "no gesture".
    expect(wheelZoomFactor({ deltaY: Infinity })).toBe(1);
    expect(wheelZoomFactor({ deltaY: -Infinity })).toBe(1);
  });
});

describe("SOURCE GUARD — the planner actually uses this, and keeps the two frames apart", () => {
  const planner = src("../src/workspaces/site-planner/SitePlanner.jsx");

  it("imports the anchored transform rather than open-coding it", () => {
    expect(planner).toMatch(/from "\.\.\/\.\.\/shared\/viewport\/viewAnchor\.js"/);
    expect(planner).toMatch(/anchorTransformAttr/);
  });

  it("the wheel handler no longer branches on the SIGN of deltaY alone", () => {
    expect(planner).not.toMatch(/e\.deltaY\s*<\s*0\s*\?\s*1\.12/);
    expect(planner).toMatch(/wheelZoomFactor\(/);
  });

  it("`renderView` carries the anchor's ppf, not the live one", () => {
    // The whole increment: before B1449 this read `{ ppf: view.ppf, ... }` unconditionally, which
    // is exactly the state in which a zoom cannot be anchored.
    expect(planner).toMatch(/const\s+renderView\s*=\s*useMemo\(\(\)\s*=>\s*\(\{\s*ppf:\s*rvPpf/);
  });

  it("the label tier reasons at the RENDER ppf, so labels cannot be sized at one zoom while the geometry sits at another", () => {
    expect(planner).toMatch(/makeLabelFrame\(rppf,/);
  });
});
