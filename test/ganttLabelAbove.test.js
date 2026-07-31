import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expandFixture, visibleTasks, depthOf } from "../e2e/fixtures/schedules/expand.mjs";

// NEW-1 — ONE rule for every task name in the Gantt CHART: it renders ABOVE its bar. Never centred
// on it, never inside it, never beside it. `align` (Left / Center / Right) chooses only the
// horizontal ANCHOR — which end of the bar the caption hangs off.
//
// This AMENDS B393, which shipped the per-kind ladder this replaces: Center put the name on a white
// contrast "plate" ON the bar whenever the name fitted inside it; Left/Right put it inline beside
// the bar. B393's goal was "never painted on the bar FILL", and the plate was its answer to names
// being covered by the bar — a legible backing rather than a move off the bar. Owner, 2026-07-31:
// *"the task name is IN THE MIDDLE of the Gantt chart bar … I just want it ABOVE the bar just like
// every other bar."* The case the plate protected (a name wider than its bar) is now handled by the
// same above-the-bar caption every other row already used.
//
// ⛔ The functions under test live INSIDE public/sequence/index.html (an in-browser Babel app with
// no bundler — it cannot import from src/, and src/ cannot import from it). Rather than keep a
// faithful COPY the way test/schedulerEngine.test.js has to for the multi-function date engine,
// this single pure helper is EXTRACTED FROM THE SHIPPED FILE and evaluated, so the test can never
// drift from the code the owner actually runs.

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

const extract = (name) => {
  const start = SRC.indexOf(`const ${name} = `);
  expect(start, `${name} not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n};", start);
  const arrow = SRC.indexOf("\n", SRC.indexOf("=>", start));
  // A one-liner (fitCaptionFs) ends at its own line; a block body ends at the first "\n};".
  const body = end > -1 && end < arrow ? SRC.slice(start, end + 3) : (end > -1 ? SRC.slice(start, end + 3) : "");
  return body;
};

const oneLiner = (name) => {
  const start = SRC.indexOf(`const ${name} = `);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf("\n", start));
};

const placeGanttLabel = new Function(`${extract("placeGanttLabel")}\nreturn placeGanttLabel;`)();
const fitCaptionFs = new Function(`${oneLiner("fitCaptionFs")}\nreturn fitCaptionFs;`)();

const ALIGNS = ["left", "center", "right"];
const KINDS = ["leaf", "summary", "milestone"];

// A caption's own vertical box, from the returned centre y and the caller's half-height.
const capBox = (place, capHalf) => ({ top: place.y - capHalf, bottom: place.y + capHalf });
const xBox = (place, labelW) => {
  const x0 = place.anchor === "start" ? place.x : place.anchor === "middle" ? place.x - labelW / 2 : place.x - labelW;
  return { x0, x1: x0 + labelW };
};

describe("placeGanttLabel — the one rule: every name is ABOVE its bar", () => {
  // The battery deliberately includes the exact shape that used to plate: a leaf whose bar is far
  // WIDER than its own label.
  const CASES = [];
  for (const kind of KINDS) {
    for (const align of ALIGNS) {
      for (const bw of [0, 6, 24, 90, 400, 4000]) {
        for (const labelW of [8, 40, 140, 900]) {
          for (const bx of [0, 12, 300, 980, 1600]) {
            CASES.push({ kind, align, bx, bw: kind === "milestone" ? 0 : bw, labelW });
          }
        }
      }
    }
  }
  const ROW_H = 24, capHalf = 6;
  const barTopOf = (kind) => (kind === "summary" ? 12 : kind === "milestone" ? ROW_H - 10.5 : ROW_H - 7);

  it("never returns a falsy placement — a fit failure can never blank a label (B1188)", () => {
    for (const c of CASES) {
      const p = placeGanttLabel({ ...c, rowTop: 0, barTopY: barTopOf(c.kind), chartL: 0, chartR: 1000, capHalf, rowH: ROW_H });
      expect(p, JSON.stringify(c)).toBeTruthy();
      expect(Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify(c)).toBe(true);
    }
  });

  it('mode is ALWAYS "above" — there is no "plate", "before" or "after" branch left', () => {
    const modes = new Set(CASES.map((c) =>
      placeGanttLabel({ ...c, rowTop: 0, barTopY: barTopOf(c.kind), chartL: 0, chartR: 1000, capHalf, rowH: ROW_H }).mode));
    expect([...modes]).toEqual(["above"]);
  });

  it("the caption's box clears the top of its own glyph, for every kind and alignment", () => {
    for (const c of CASES) {
      const barTopY = barTopOf(c.kind);
      const p = placeGanttLabel({ ...c, rowTop: 0, barTopY, chartL: 0, chartR: 1000, capHalf, rowH: ROW_H });
      expect(capBox(p, capHalf).bottom, `${c.kind}/${c.align} bw=${c.bw}`).toBeLessThanOrEqual(barTopY);
    }
  });

  it("a leaf whose bar is much WIDER than its name still goes above (the exact case that plated)", () => {
    const p = placeGanttLabel({ kind: "leaf", align: "center", bx: 100, bw: 600, rowTop: 0, barTopY: 17,
      labelW: 60, chartL: 0, chartR: 1000, capHalf, rowH: ROW_H });
    expect(p.mode).toBe("above");
    expect(p.anchor).toBe("middle");
    expect(p.x).toBe(400);                      // anchored on the bar's midpoint…
    expect(p.y + capHalf).toBeLessThanOrEqual(17); // …but seated in the clear air above it
  });

  it("align is the HORIZONTAL anchor only: left→bar start, center→midpoint, right→bar end", () => {
    const base = { kind: "leaf", bx: 200, bw: 300, rowTop: 0, barTopY: 17, labelW: 40, chartL: 0, chartR: 2000, capHalf, rowH: ROW_H };
    const L = placeGanttLabel({ ...base, align: "left" });
    const C = placeGanttLabel({ ...base, align: "center" });
    const R = placeGanttLabel({ ...base, align: "right" });
    expect([L.anchor, C.anchor, R.anchor]).toEqual(["start", "middle", "end"]);
    expect([L.x, C.x, R.x]).toEqual([200, 350, 500]);
    // …and all three sit at the same height. Alignment never changes WHETHER it is above.
    expect(new Set([L.y, C.y, R.y]).size).toBe(1);
  });

  it("a caption too wide for the chart SLIDES to fit — it is never dropped and never re-seated on the bar", () => {
    const p = placeGanttLabel({ kind: "leaf", align: "right", bx: 980, bw: 15, rowTop: 0, barTopY: 17,
      labelW: 300, chartL: 0, chartR: 1000, capHalf, rowH: ROW_H });
    expect(p.mode).toBe("above");
    const b = xBox(p, 300);
    expect(b.x0).toBeGreaterThanOrEqual(-0.01);
    expect(b.x1).toBeLessThanOrEqual(1000.01);
  });

  it("the caption stays inside its own row band, so no two rows can collide (B629)", () => {
    for (const c of CASES) {
      const p = placeGanttLabel({ ...c, rowTop: 240, barTopY: 240 + barTopOf(c.kind), chartL: 0, chartR: 1000, capHalf, rowH: ROW_H });
      expect(p.y - capHalf).toBeGreaterThanOrEqual(240 - 0.001);
      expect(p.y + capHalf).toBeLessThanOrEqual(240 + ROW_H + 0.001);
    }
  });
});

describe("fitCaptionFs — a caption shrinks to its headroom rather than sit on its glyph", () => {
  it("is a no-op when there is room, and shrinks when there is not", () => {
    expect(fitCaptionFs(9.5, 40)).toBe(9.5);
    expect(fitCaptionFs(9.5, 9)).toBeLessThan(9.5);
  });
  it("is floored so a caption never becomes illegible", () => {
    expect(fitCaptionFs(9.5, 1)).toBe(6.5);
    expect(fitCaptionFs(9.5, 0)).toBe(6.5);
  });
});

describe("source guards — the on-bar plate is gone from BOTH render paths", () => {
  it("placeGanttLabel emits no plate/before/after mode", () => {
    const body = extract("placeGanttLabel");
    for (const dead of ['mode: "plate"', 'mode: "before"', 'mode: "after"']) expect(body).not.toContain(dead);
    expect(body).toContain('mode: "above"');
  });
  it("the on-screen GanttName paints no contrast backing behind a name", () => {
    const i = SRC.indexOf("const GanttName = ");
    const body = SRC.slice(i, SRC.indexOf("\n  };", i));
    expect(body).not.toMatch(/background\s*:/);
    expect(body).toContain("data-gantt-mode");
  });
  it("the print emitName paints no plate rect", () => {
    const i = SRC.indexOf("const emitName=");
    const body = SRC.slice(i, SRC.indexOf("\n  };", i));
    expect(body).not.toMatch(/opacity="0\.85"/);
  });
  it("the print path bottom-aligns EVERY glyph on one baseline, and the arrow router reads the same bands", () => {
    expect(SRC).toContain("const GLYPH_BASE=ROW_H-2;");
    for (const band of ["leafBand", "mileBand", "summaryBand"]) {
      // defined once, then read by the bar renderer, the name placement AND glyphEdges
      expect(SRC.split(`${band}(`).length - 1).toBeGreaterThanOrEqual(3);
    }
  });
});

// The real program the owner reported on. These are pure-data assertions about the fixture, so the
// repro can't silently rot into a synthetic one.
describe("the Grand Port fixture is the owner's real schedule", () => {
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../e2e/fixtures/schedules/grand-port.fixture.json", import.meta.url)), "utf8"));
  const proj = expandFixture(fx);
  it("carries the real 213-task program with the owner's own centre alignment", () => {
    expect(proj.name).toBe("Grand Port");
    expect(proj.tasks.length).toBe(213);
    expect(proj.labelAlign).toBe("center");
    expect(visibleTasks(proj.tasks).length).toBe(168);
  });
  it("contains leaf rows whose bar at 33% zoom is wider than their own name — the rows that plated", () => {
    const PPD = 2;                                    // 33% on the app's ppd/6 scale
    const NAME_SIZE = (lvl) => [9.5, 8.5, 8.5, 8][Math.min(lvl, 3)];
    const estLabelWidth = (s, fs) => Math.max(1, String(s).length) * fs * 0.6 + 4;
    const isParent = (t) => proj.tasks.some((x) => x.parentId === t.id);
    const wide = visibleTasks(proj.tasks).filter((t) => {
      if (isParent(t) || t.duration === 0) return false;
      const days = (Date.parse(t.end) - Date.parse(t.start)) / 86400000;
      const bw = Math.max(6, days * PPD);
      return estLabelWidth(t.name, NAME_SIZE(depthOf(proj.tasks, t.id))) <= bw - 4;
    }).map((t) => t.name);
    // Exactly the rows the live harness caught rendering on the bar before the fix.
    expect(wide).toContain("TIA Review #1");
    expect(wide).toContain("AHJ Review #2");
    expect(wide).toContain("Underground Terms & Conditions");
    expect(wide.length).toBeGreaterThanOrEqual(6);
  });
});
