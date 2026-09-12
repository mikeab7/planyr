/* ⛔ B1574432 — ONE FRAMING PER LOAD, and the verdict that says so must not be able to pass on a
 * run that observed nothing.
 *
 * The owner filmed a cold load of planyr.io on his iPhone at 60 fps: the plan paints correctly,
 * then for about two video frames the canvas cuts to one building at extreme zoom, then returns.
 * Measured with ui-audit/verify-boot-framing.mjs on a real plan, before the fix: the canvas painted
 * `ppf 0.35, off (60, 60)` — the component's hardcoded `useState` default, computed from no model
 * and no container — for six animation frames, then replaced it with the real framing. On a
 * signed-in boot that happens TWICE, because `SitePlannerApp` keys the planner
 * `${activeSiteId}:${loadEpoch}` and `applyUser` bumps `loadEpoch` when the cloud pull settles; the
 * second time it lands on top of an already-painted plan, which is what he filmed.
 *
 * ⛔ THE FALSE GREEN THIS FILE EXISTS TO PIN, because the rig produced it and its own teeth proof
 * caught it. The first verdict was "every mount painted exactly one framing". Run against a build
 * with no `data-planner-mount` stamp — the very build it was written to fail — it saw ZERO mounts,
 * so zero offenders, so it printed ✅ over a listing that showed the default framing painted twice.
 * A framing that cannot be attributed is not a framing that passes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { realRuns, unpaintedRuns, distinctFramings, bootFramingReport } from "../ui-audit/lib/bootFraming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const run = (o) => ({ sig: `${o.mount || "?"}|${o.ppf}|${o.offX || 0}|${o.offY || 0}`, ppf: o.ppf, offX: o.offX ?? 0, offY: o.offY ?? 0, mount: ("mount" in o ? o.mount : "m1"), canvasVisible: o.canvasVisible !== false, at: o.at ?? 0, until: o.until ?? (o.at ?? 0) + 16, samples: o.samples ?? 1 });
const raw = (painted, extra = {}) => ({ painted, committed: [], frames: 200, hiddenFrames: 0, elapsedMs: 3400, ...extra });

describe("what counts as a painted framing", () => {
  it("drops the leading 'no canvas yet' runs — before the canvas exists there is no framing", () => {
    expect(realRuns([{ sig: "none", ppf: null }, run({ ppf: 0.08 })])).toHaveLength(1);
  });

  it("⛔ drops a framing the canvas HELD while deliberately unpainted — an attribute is not a paint", () => {
    const held = run({ ppf: 0.35, canvasVisible: false });
    expect(realRuns([held, run({ ppf: 0.08 })])).toHaveLength(1);
    expect(unpaintedRuns([held, run({ ppf: 0.08 })])).toHaveLength(1);
  });

  it("counts two mounts on the SAME framing as two framings — a remount is not a merge", () => {
    const a = run({ ppf: 0.08, mount: "mA", at: 0 });
    const b = run({ ppf: 0.08, mount: "mB", at: 900 });
    expect(distinctFramings([a, b])).toHaveLength(2);
  });
});

describe("the verdict", () => {
  it("passes a boot that painted exactly one framing", () => {
    const r = bootFramingReport(raw([run({ ppf: 0.083, at: 700 })]));
    expect(r.ok).toBe(true);
    expect(r.vacuous).toBe(false);
    expect(r.paintedFramings).toBe(1);
  });

  it("FAILS the measured pre-fix boot: the default framing painted, then thrown away", () => {
    const r = bootFramingReport(raw([
      run({ ppf: 0.35, offX: 60, offY: 60, at: 671, until: 753, samples: 6 }),
      run({ ppf: 0.0831, offX: 283.9, offY: 340.2, at: 801, until: 5036, samples: 257 }),
    ]));
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([{ mount: "m1", framings: 2 }]);
  });

  it("passes two mounts painting ONE framing each — that is a correct signed-in boot", () => {
    const r = bootFramingReport(raw([
      run({ ppf: 0.083, mount: "mA", at: 690, until: 3040, samples: 142 }),
      run({ ppf: 0.083, mount: "mB", at: 3190, until: 6030, samples: 172 }),
    ]));
    expect(r.ok).toBe(true);
    expect(r.mounts).toBe(2);
  });

  it("FAILS a remount that painted its own default first — the owner's filmed case", () => {
    const r = bootFramingReport(raw([
      run({ ppf: 0.083, mount: "mA", at: 690, samples: 137 }),
      run({ ppf: 0.35, offX: 60, offY: 60, mount: "mB", at: 3166, samples: 8 }),
      run({ ppf: 0.083, mount: "mB", at: 3300, samples: 166 }),
    ]));
    expect(r.ok).toBe(false);
    expect(r.offenders.map((o) => o.mount)).toEqual(["mB"]);
  });

  it("⛔ REFUSES to score a run whose framings carry no mount id — the false green its teeth proof caught", () => {
    const r = bootFramingReport(raw([
      run({ ppf: 0.35, mount: null, at: 671, samples: 6 }),
      run({ ppf: 0.0831, mount: null, at: 801, samples: 257 }),
    ]));
    expect(r.ok).toBe(false);
    expect(r.vacuous).toBe(true);
    expect(r.vacuity.join(" ")).toMatch(/data-planner-mount/);
  });

  it("⛔ REFUSES a run with too few VISIBLE frames to have seen a flash (FOREGROUND-OR-VOID)", () => {
    const r = bootFramingReport(raw([run({ ppf: 0.083 })], { frames: 9, hiddenFrames: 0 }));
    expect(r.ok).toBe(false);
    expect(r.vacuous).toBe(true);
    expect(r.vacuity.join(" ")).toMatch(/FOREGROUND-OR-VOID/);
  });

  it("does NOT call an arm vacuous just for starting hidden — visible frames are what it needs", () => {
    const r = bootFramingReport(raw([run({ ppf: 0.083 })], { frames: 175, hiddenFrames: 21 }));
    expect(r.visibleFrames).toBe(154);
    expect(r.ok).toBe(true);
  });

  it("refuses a run where the canvas never painted anything at all", () => {
    const r = bootFramingReport(raw([]));
    expect(r.ok).toBe(false);
    expect(r.vacuous).toBe(true);
  });
});

/* The rig reads three things off the real component. If any of them is renamed or removed the rig
 * silently stops being able to answer, which is exactly how a guard rots green — so pin them here,
 * where a rename fails the build instead. */
describe("the app still carries what the rig reads", () => {
  const src = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "SitePlanner.jsx"), "utf8");

  it("stamps a per-mount identity on the canvas", () => {
    expect(src).toMatch(/data-planner-mount=\{mountIdRef\.current\}/);
  });

  it("commits the first framing in a LAYOUT effect — before paint, not on a timer", () => {
    const i = src.indexOf("const [framingCommitted, setFramingCommitted]");
    expect(i).toBeGreaterThan(-1);
    const after = src.slice(i, i + 2600);
    expect(after).toMatch(/useLayoutEffect\(\(\) => \{\s*\n\s*if \(framingCommitted\) return;/);
    // framed from a freshly READ box, never from the placeholder `size` state
    expect(after).toMatch(/getBoundingClientRect\(\)/);
    expect(after).toMatch(/fit\(\{ w, h \}\)/);
  });

  it("paints nothing until a framing is committed — the canvas and both map hosts are gated", () => {
    const gates = src.match(/visibility: framingCommitted \? undefined : "hidden"/g) || [];
    expect(gates.length).toBe(3);
  });
});
