/* Dense-Gantt regression against the versioned fixture (B278/B280 harness — PDF/export parity
 * (engine half) + timing/race LIVE-VERIFY classes, deterministic in the sandbox). Runs the importable
 * scheduler engine mirror over the ~119-task synthetic program and asserts: it never throws/hangs on
 * the hostile edge rows, the parent rollup dates + export filename match the golden, and loadPipeline
 * ingests it losslessly. The on-screen-vs-print buildGanttSVG glyph parity at ~33% zoom is the browser
 * half (e2e/gantt-density.spec.js) — buildGanttSVG lives only in the in-browser Babel app. */
import { describe, it, expect } from "vitest";
import { loadFixture, loadGolden } from "../e2e/fixtures/index.js";
import * as E from "../ui-audit/stress/scheduler-engine.mjs";

const fx = loadFixture("schedules/dense-project.fixture.json");
const golden = loadGolden("schedules/dense-project.golden.json");
const tasks = fx.project.tasks;

describe("dense-Gantt fixture", () => {
  it("has the expected density (task/leaf/phase/milestone/dep counts) per the golden", () => {
    expect(tasks.length).toBe(golden.taskCount);
    expect(tasks.filter((t) => t.parentId != null).length).toBe(golden.leafCount);
    expect(tasks.filter((t) => t.parentId == null).length).toBe(golden.phaseCount);
    expect(tasks.reduce((n, t) => n + (t.predecessors ? t.predecessors.length : 0), 0)).toBe(golden.predLinkCount);
  });

  it("cascade + rollup never throw/hang on the hostile edge rows, and match the golden dates", () => {
    const t0 = performance.now();
    let recomputed;
    expect(() => { recomputed = E.rollupParentDates(E.cascadeDates(tasks)); }).not.toThrow();
    expect(performance.now() - t0).toBeLessThan(3000); // no multi-second freeze (addBD cap / cycle-break)
    const byId = new Map(recomputed.map((t) => [t.id, t]));
    const rollup = tasks.filter((t) => t.parentId == null).map((p) => {
      const t = byId.get(p.id) || {};
      return { id: p.id, name: p.name, start: t.start || "", end: t.end || "" };
    });
    expect(rollup).toEqual(golden.phaseRollup);
  });

  it("the export filename is deterministic (PDF/export parity anchor)", () => {
    expect(E.scheduleExportName([{ name: fx.project.name, tasks }], new Date("2026-07-04T12:00:00Z"))).toBe(golden.exportName);
  });

  it("loadPipeline ingests the dense dataset without throwing (lossless intake)", () => {
    let out;
    expect(() => { out = E.loadPipeline({ projects: [fx.project], settings: fx.settings }); }).not.toThrow();
    expect(out).toBeTruthy();
  });
});
