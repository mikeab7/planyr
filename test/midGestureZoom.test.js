/* B1449 — the mid-gesture zoom harness's verdict layer.
 *
 * ⛔ WHY A GUARD'S GUARD IS WORTH THE LINES. `ui-audit/verify-midgesture-zoom.mjs` is the ONLY
 * thing in this repo that can observe whether a mid-gesture zoom is correct — at rest a correct
 * build and a broken one are byte-identical. So the harness reporting a wrong verdict is a silent
 * loss of the only observation there is, and its logic has to be checked somewhere a browser is not
 * required. That is this file.
 *
 * It also pins the SHAPE of the failures rather than only their presence, because the first live
 * run proved both directions of that mattering: a naive `data-el-id` map compared two different
 * DOM nodes and reported a 5.6 px failure against a build that was exact to four decimals, and a
 * runaway mutant squared its own output to 6e37 and "failed" by having nothing left on screen —
 * the right verdict for the wrong reason, which is not a proof of anything.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  scaleAbout, nodeVerdict, observedScale, diagnose, armVerdict, runVerdict,
  EDGE_TOL_PX, MIN_NODE_PX,
} from "../ui-audit/lib/midGestureZoom.mjs";

const A = { x: 400, y: 300 };
const rects = [
  { id: "a", rest: { x: 100, y: 120, w: 240, h: 90 } },
  { id: "b", rest: { x: 700, y: 500, w: 60, h: 60 } },
  { id: "c", rest: { x: 380, y: 290, w: 30, h: 400 } },
];
const perfect = (k) => rects.map((r) => ({ ...r, mid: scaleAbout(r.rest, k, A) }));
const ARMED = { viewPpf: 0.5, renderPpf: 0.35, k: 0.5 / 0.35 };

describe("scaleAbout is the model the whole harness rests on", () => {
  it("holds the anchor point fixed", () => {
    const dot = { x: A.x, y: A.y, w: 0, h: 0 };
    expect(scaleAbout(dot, 3, A)).toEqual({ x: A.x, y: A.y, w: 0, h: 0 });
  });
  it("is the identity at k = 1", () => {
    expect(scaleAbout(rects[0].rest, 1, A)).toEqual(rects[0].rest);
  });
  it("composes: scaling by k then j equals scaling by k·j", () => {
    const once = scaleAbout(rects[0].rest, 1.12 * 1.12, A);
    const twice = scaleAbout(scaleAbout(rects[0].rest, 1.12, A), 1.12, A);
    for (const key of ["x", "y", "w", "h"]) expect(twice[key]).toBeCloseTo(once[key], 9);
  });
});

describe("a CORRECT anchored zoom passes", () => {
  it("green at every k an ordinary gesture reaches", () => {
    for (const k of [1.12, 1.12 ** 3, 2, 1 / 1.12, 0.5]) {
      const v = runVerdict({ nodes: perfect(k), k, anchor: A, arm: { ...ARMED, k } });
      expect(v.ok, `k=${k}: ${v.problems.join(" | ")}`).toBe(true);
      expect(v.mechanism).toBe("ok");
      expect(v.failedCount).toBe(0);
    }
  });
  it("tolerates the sub-pixel float noise Chromium reports through a transformed matrix", () => {
    const k = 1.4;
    const nodes = perfect(k).map((n, i) => ({ ...n, mid: { ...n.mid, x: n.mid.x + (i % 2 ? 0.4 : -0.4) } }));
    expect(runVerdict({ nodes, k, anchor: A, arm: { ...ARMED, k } }).ok).toBe(true);
  });
});

describe("the three failure mechanisms are told apart, not merged", () => {
  const k = 1.4049;
  it("DOUBLE-SCALED — the bug B1449 named, and the one the mutant reproduces", () => {
    const nodes = rects.map((r) => ({ ...r, mid: scaleAbout(r.rest, k * k, A) }));
    const v = runVerdict({ nodes, k, anchor: A, arm: { ...ARMED, k } });
    expect(v.ok).toBe(false);
    expect(v.mechanism).toBe("double-scaled");
    expect(v.failedCount).toBe(3);
  });
  it("UNSCALED — geometry moved but never scaled", () => {
    const nodes = rects.map((r) => ({ ...r, mid: { ...r.rest, x: r.rest.x + 40 } }));
    expect(runVerdict({ nodes, k, anchor: A, arm: { ...ARMED, k } }).mechanism).toBe("unscaled");
  });
  it("DRIFT — right scale, wrong place (a translate the transform did not account for)", () => {
    const nodes = perfect(k).map((n) => ({ ...n, mid: { ...n.mid, x: n.mid.x + 25 } }));
    const v = runVerdict({ nodes, k, anchor: A, arm: { ...ARMED, k } });
    expect(v.ok).toBe(false);
    // the SCALE is right, so the diagnosis stays "ok" while the placement check fails — the report
    // must not claim a scale mechanism it has no evidence for.
    expect(v.mechanism).toBe("ok");
    expect(v.failedCount).toBe(3);
  });
});

describe("⛔ A RUN THAT OBSERVED NOTHING IS A FAILURE, NEVER A PASS", () => {
  it("an anchor that never armed is red even though every rect agrees", () => {
    // This is the vacuous pass: k = 1, nothing moved, every geometry check trivially holds.
    const nodes = rects.map((r) => ({ ...r, mid: { ...r.rest } }));
    const v = runVerdict({ nodes, k: 1, anchor: A, arm: { viewPpf: 0.5, renderPpf: 0.5, k: 1 } });
    expect(v.ok).toBe(false);
    expect(v.armed).toBe(false);
    expect(v.problems.join(" ")).toMatch(/no zoom anchor armed/);
    expect(v.problems.join(" ")).toMatch(/group scale is 1/);
  });

  it("no measurable node is red — an empty sample may never read green", () => {
    const tiny = [{ id: "t", rest: { x: 0, y: 0, w: MIN_NODE_PX - 1, h: MIN_NODE_PX - 1 }, mid: { x: 0, y: 0, w: 1, h: 1 } }];
    const v = runVerdict({ nodes: tiny, k: 1.4, anchor: A, arm: { ...ARMED, k: 1.4 } });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/observed nothing/);
  });

  it("a canvas that reported no ppf at all is red", () => {
    expect(armVerdict({}).armed).toBe(false);
    expect(armVerdict({ viewPpf: 0, renderPpf: 0, k: 0 }).problems.length).toBeGreaterThan(0);
  });
});

describe("settle parity — dropping the anchor may not MOVE anything (VIEWPORT-STABLE)", () => {
  const k = 1.4;
  it("green when the re-baked frame lands on the anchored one", () => {
    const nodes = perfect(k);
    const settle = nodes.map((n) => ({ id: n.id, mid: n.mid, settled: { ...n.mid } }));
    expect(runVerdict({ nodes, k, anchor: A, arm: { ...ARMED, k }, settle }).ok).toBe(true);
  });
  it("red on a jump — the exact failure a settle that re-projects differently would produce", () => {
    const nodes = perfect(k);
    const settle = nodes.map((n) => ({ id: n.id, mid: n.mid, settled: { ...n.mid, y: n.mid.y + 4 } }));
    const v = runVerdict({ nodes, k, anchor: A, arm: { ...ARMED, k }, settle });
    expect(v.ok).toBe(false);
    expect(v.settleJumped).toBe(3);
    expect(v.problems.join(" ")).toMatch(/JUMPED when the gesture settled/);
  });
});

describe("the numbers are reported, not just the verdict", () => {
  it("observedScale is the honest measured ratio", () => {
    expect(observedScale({ w: 100, h: 50 }, { w: 140, h: 70 })).toBeCloseTo(1.4, 10);
    expect(observedScale({ w: 2, h: 2 }, { w: 3, h: 3 })).toBe(null);   // too small to divide
  });
  it("nodeVerdict reports the per-edge error, so a report can name what moved", () => {
    const r = nodeVerdict({ x: 0, y: 0, w: 100, h: 100 }, { x: 5, y: 0, w: 100, h: 100 }, 1, A);
    expect(r.err.x).toBe(5);
    expect(r.worst).toBe(5);
    expect(r.ok).toBe(false);
    expect(nodeVerdict({ x: 0, y: 0, w: 100, h: 100 }, { x: EDGE_TOL_PX, y: 0, w: 100, h: 100 }, 1, A).ok).toBe(true);
  });
  it("diagnose says `unknown` rather than guessing when it has no usable sample", () => {
    expect(diagnose(1.4, [null, undefined, NaN]).mechanism).toBe("unknown");
  });
});

describe("SOURCE GUARD — the harness keeps the two properties its first live run had to be taught", () => {
  const h = readFileSync(fileURLToPath(new URL("../ui-audit/verify-midgesture-zoom.mjs", import.meta.url)), "utf8");

  it("selects the element's OWN group, not any node carrying the id", () => {
    // `data-el-id` is also on the rect outline-cut node, which renders conditionally — comparing
    // one snapshot's group against the other's outline-cut is what produced a phantom failure.
    expect(h).toContain('[data-el-id][data-feature^="el:"]');
    expect(h).toContain("if (seen.has(id)) continue;");
  });

  it("the double-scale mutant remembers its own write, so it squares ONCE", () => {
    expect(h).toContain("const mine = new WeakMap();");
    expect(h).toContain("if (mine.get(g) === t) return;");
  });

  it("the selftest fails if a mutant PASSES, and if the diagnosis is wrong", () => {
    expect(h).toMatch(/MUTANT passed/);
    expect(h).toMatch(/rather than "double-scaled"/);
  });

  it("a mid-gesture read that ran long is INCONCLUSIVE, never green", () => {
    expect(h).toContain("CAPTURE_BUDGET_MS");
    expect(h).toMatch(/INCONCLUSIVE rather than green/);
  });
});
