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

// NEW-1 (name rank): the shared geometry block, evaluated straight out of the shipped file.
const GEOM_SRC = SRC.slice(SRC.indexOf("// <gantt-geom>"), SRC.indexOf("// </gantt-geom>"));
expect(GEOM_SRC.length, "the <gantt-geom> block is missing from public/sequence/index.html").toBeGreaterThan(500);
const G = new Function(`${GEOM_SRC}
return { GANTT_CAPTION_LH, ganttCaptionNeed, ganttCaptionHalf, fitCaptionFs, GANTT_PROFILES,
         ganttNameSize, ganttLeafGeom, ganttSummaryGeom, ganttMilestoneGeom };`)();
const { fitCaptionFs, GANTT_PROFILES, ganttNameSize, ganttLeafGeom, ganttSummaryGeom, ganttMilestoneGeom, ganttCaptionHalf } = G;

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
    expect(SRC).toContain("const PP=GANTT_PROFILES.print;");
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
    const NAME_SIZE = (lvl) => GANTT_PROFILES.screen.names[Math.min(lvl, 3)];
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// NEW-1 (2026-11-04) — a task NAME's size is its RANK: the higher in the hierarchy, the larger, at
// EVERY row height — the owner, Grand Port, Split view: "why is the top level task have smaller than
// the lower level task labels on the gantt chart". The text is the priority; the GLYPH (bracket /
// diamond) gives way. These are pure-geometry sweeps over every integer row height the app allows
// (settings.rowHeight 20…34) and over the fixed print row height, for every kind and depth.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const SCREEN_ROWS = Array.from({ length: 15 }, (_, i) => 20 + i);   // 20…34
const PRINT_ROWS = [18];                                             // buildGanttSVG's fixed ROW_H
const LEVELS = [0, 1, 2, 3];
const EPS = 1e-9;

// A "model" answers the only questions the rank rule asks, for ONE render path. `fs` is the size the
// renderer actually draws (the ranked size passed through the last-resort headroom cap); `top` is the
// y of the glyph's top edge the caption must clear; `bracket` is the bracket thickness triple.
const modelOf = (P) => {
  const glyph = (kind, rowH, level) => kind === "summary" ? ganttSummaryGeom(P, rowH, level)
    : kind === "milestone" ? ganttMilestoneGeom(P, rowH, level) : ganttLeafGeom(P, rowH);
  return {
    P,
    top: (kind, rowH, level) => glyph(kind, rowH, level).top,
    fs: (kind, rowH, level) => fitCaptionFs(ganttNameSize(P, level), glyph(kind, rowH, level).top),
    base: (level) => ganttNameSize(P, level),
    bracket: (rowH, level) => { const g = ganttSummaryGeom(P, rowH, level); return { span: g.span, leg: g.leg, total: g.span + g.leg }; },
    // the legible floor never exceeds a bracket's own nominal size (it only props a THINNED bracket up)
    minSpan: (rowH, lv) => Math.min(P.minSpan, P.span[lv]), minLeg: (rowH, lv) => Math.min(P.minLeg, P.leg[lv] * rowH),
  };
};

// The checker. Returns a list of human-readable violations (empty = the rule holds).
const rankViolations = (m, rowHs) => {
  const out = [];
  for (const rowH of rowHs) {
    for (const kind of KINDS) {
      for (const lv of LEVELS) {
        const fs = m.fs(kind, rowH, lv), top = m.top(kind, rowH, lv);
        // 1) the name is drawn at its full ranked size — no row height may shrink it
        if (fs < m.base(lv) - EPS) out.push(`${kind} L${lv} @${rowH}: ${fs.toFixed(2)} < ranked ${m.base(lv)}`);
        // 2) the caption box never crosses the top of its own glyph
        if (placeGanttLabel({ kind, align: "center", bx: 100, bw: kind === "milestone" ? 0 : 80, rowTop: 0, barTopY: top,
          labelW: 40, chartL: 0, chartR: 1000, capHalf: ganttCaptionHalf(fs), rowH }).y + ganttCaptionHalf(fs) > top + 1e-6)
          out.push(`${kind} L${lv} @${rowH}: name bottom crosses glyph top ${top.toFixed(2)}`);
        // 3) rank: a level is never smaller than the level below it
        if (lv < 3 && m.fs(kind, rowH, lv + 1) > fs + EPS) out.push(`${kind} @${rowH}: L${lv + 1} (${m.fs(kind, rowH, lv + 1).toFixed(2)}) > L${lv} (${fs.toFixed(2)})`);
      }
      // 4) ...and (NEW-1 amendment, B2656160 ×2) the chain is STRICT over ALL four depths: L0 > L1 > L2 > L3. B2656160's first
      //    acceptance only demanded L0 > L1, so L1 and L2 both drew at 8.5 and only weight told them apart — the complaint.
      const chain = LEVELS.map((l) => m.fs(kind, rowH, l));
      if (!chain.every((v, i) => i === 0 || chain[i - 1] > v + EPS)) out.push(`TIE ${kind} @${rowH}: sizes by level ${chain.map((v) => v.toFixed(2)).join(" / ")} are not strictly decreasing`);
    }
    // 5) a milestone name is never smaller than a leaf name at the same level
    for (const lv of LEVELS) if (m.fs("milestone", rowH, lv) < m.fs("leaf", rowH, lv) - EPS)
      out.push(`@${rowH} L${lv}: milestone ${m.fs("milestone", rowH, lv).toFixed(2)} < leaf ${m.fs("leaf", rowH, lv).toFixed(2)}`);
    // 6) across kinds: the top level outranks the next level whatever the glyph
    const topMin = Math.min(...KINDS.map((k) => m.fs(k, rowH, 0))), nextMax = Math.max(...KINDS.map((k) => m.fs(k, rowH, 1)));
    if (!(topMin > nextMax)) out.push(`@${rowH}: a level-0 name (${topMin.toFixed(2)}) is not larger than every level-1 name (${nextMax.toFixed(2)})`);
    // 7) bracket rank survives, and it still reads as a bracket (span AND legs)
    for (const lv of LEVELS) {
      const b = m.bracket(rowH, lv);
      if (b.span < m.minSpan(rowH, lv) - EPS || b.leg < m.minLeg(rowH, lv) - EPS) out.push(`bracket L${lv} @${rowH}: span ${b.span.toFixed(2)} / leg ${b.leg.toFixed(2)} below the legible floor`);
      if (lv < 3) {
        const n = m.bracket(rowH, lv + 1);
        for (const f of ["span", "leg", "total"]) if (n[f] > b[f] + EPS) out.push(`bracket @${rowH}: L${lv + 1} ${f} ${n[f].toFixed(2)} > L${lv} ${b[f].toFixed(2)}`);
      }
    }
  }
  return out;
};

describe("NEW-1 — name size follows RANK at every row height (screen)", () => {
  it("holds for every integer row height 20…34, every kind, every depth", () => {
    expect(rankViolations(modelOf(GANTT_PROFILES.screen), SCREEN_ROWS)).toEqual([]);
  });
  it("level 0 is drawn at its FULL base size even at the shortest row (the owner's row height)", () => {
    const m = modelOf(GANTT_PROFILES.screen);
    for (const kind of KINDS) expect(m.fs(kind, 20, 0), kind).toBe(10);
  });
  it("above the default row height the bracket is exactly today's ramp (nothing was thinned)", () => {
    for (const rowH of [24, 28, 34]) for (const lv of LEVELS) {
      const g = ganttSummaryGeom(GANTT_PROFILES.screen, rowH, lv), P = GANTT_PROFILES.screen;
      expect(g.span).toBeCloseTo(P.span[lv], 9);
      expect(g.leg).toBeCloseTo(P.leg[lv] * rowH, 9);
    }
  });
  it("a milestone diamond sits on the leaf bar's baseline and only the biggest name makes it shrink", () => {
    const P = GANTT_PROFILES.screen;
    for (const rowH of SCREEN_ROWS) {
      expect(ganttMilestoneGeom(P, rowH, 1).bot).toBe(ganttLeafGeom(P, rowH).bot);
      // Levels 1-3 keep the full 6-px diamond — EXCEPT (NEW-1 amendment, B2656160 ×2): level 1's name grew 8.5 → 9.25, so at the
      // single shortest row (20) its diamond gives up under half a pixel of vertex distance to keep the name clear of it.
      // From row 21 up nothing changed; at no row does a diamond fall below the level-0 one or the legible floor.
      for (const lv of [1, 2, 3]) {
        const h = ganttMilestoneGeom(P, rowH, lv).half;
        if (rowH >= 21) expect(h, `L${lv} @${rowH}`).toBeCloseTo(3 * Math.SQRT2, 9);
        else expect(3 * Math.SQRT2 - h, `L${lv} @${rowH}`).toBeLessThan(0.5);
        expect(h, `L${lv} @${rowH}`).toBeGreaterThanOrEqual(ganttMilestoneGeom(P, rowH, 0).half);
        expect(h).toBeGreaterThanOrEqual(P.mileMin);
      }
    }
  });
});

describe("NEW-1 — the same rule on the PRINT geometry (PDF-PARITY)", () => {
  it("holds at the fixed print row height", () => {
    expect(rankViolations(modelOf(GANTT_PROFILES.print), PRINT_ROWS)).toEqual([]);
  });
  it("level 0 prints at its full base size, and the milestone name is not the 6.5 floor", () => {
    const m = modelOf(GANTT_PROFILES.print);
    for (const kind of KINDS) expect(m.fs(kind, 18, 0), kind).toBe(9);
    for (const lv of LEVELS) expect(m.fs("milestone", 18, lv)).toBe(m.base(lv));
  });
});

describe("NEW-1 — the checker has teeth: main's OLD formulas fail it (red-proof)", () => {
  // A frozen copy of the pre-fix geometry (fitCaptionFs 1.3, name fitted to the bracket, diamond at
  // ROW_H-10.5). If this ever stops being RED the sweep above has gone blind.
  const old = {
    P: GANTT_PROFILES.screen, minSpan: () => 0, minLeg: () => 0,
    base: (lv) => [9.5, 8.5, 8.5, 8][lv],   // main's pre-NEW-1 sizes, frozen on purpose
    top: (kind, rowH, lv) => {
      if (kind === "summary") return rowH - 2 - [0.16, 0.12, 0.09, 0.07][lv] * rowH - [6, 5, 4, 4][lv];
      if (kind === "milestone") return rowH - 10.5;
      return rowH - rowH * 0.25 - 1;
    },
    fs(kind, rowH, lv) { return Math.max(6.5, Math.min(this.base(lv), this.top(kind, rowH, lv) / 1.3)); },
    bracket: (rowH, lv) => { const span = [6, 5, 4, 4][lv], leg = [0.16, 0.12, 0.09, 0.07][lv] * rowH; return { span, leg, total: span + leg }; },
  };
  it("reports the inverted ranks the owner saw at the shortest row", () => {
    const v = rankViolations(old, [20]);
    expect(v.length).toBeGreaterThan(5);
    expect(v.join("\n")).toMatch(/summary @20: L1 \(8\.15\) > L0 \(6\.77\)/);
    expect(v.join("\n")).toMatch(/milestone/);
  });
  it("is clean on the old geometry only at a tall row", () => {
    expect(rankViolations(old, [34]).filter((x) => /summary @34|bracket/.test(x) && !/^TIE/.test(x))).toEqual([]);
  });
});

describe("NEW-1 — one geometry source: the arrow anchors read the same helpers as the renderer", () => {
  it("bracket / diamond literals live ONLY in the shared profile block", () => {
    expect(SRC.split("[6,5,4,4]").length - 1).toBe(1);              // the screen ramp is declared once (the profile), nowhere inline
    expect(SRC.split("[0.14,0.10,0.08,0.06]").length - 1).toBe(1);
  });
  it("screen glyphEdges and the renderer both call the shared helpers", () => {
    const i = SRC.indexOf("const glyphEdges = (t, idx)");
    const body = SRC.slice(i, SRC.indexOf("\n  };", i));
    for (const fn of ["ganttSummaryGeom", "ganttMilestoneGeom", "ganttLeafGeom"]) {
      expect(body, fn).toContain(fn);
      expect(SRC.split(`${fn}(GANTT_PROFILES.screen`).length - 1, fn).toBeGreaterThanOrEqual(2);   // glyphEdges + the bar renderer
    }
  });
  it("print bands are thin wrappers over the shared helpers", () => {
    for (const fn of ["ganttSummaryGeom(PP", "ganttMilestoneGeom(PP", "ganttLeafGeom(PP"]) expect(SRC).toContain(fn);
  });
});

describe("NEW-1 amendment (B2656160 ×2) — every level strictly larger than the one below, and the step is VISIBLE", () => {
  it("screen.names is strictly decreasing, as declared", () => {
    const n = GANTT_PROFILES.screen.names;
    for (let i = 0; i < 3; i++) expect(n[i], `L${i} vs L${i + 1}`).toBeGreaterThan(n[i + 1]);
  });
  it("print.names stays strictly decreasing", () => {
    const n = GANTT_PROFILES.print.names;
    for (let i = 0; i < 3; i++) expect(n[i], `L${i} vs L${i + 1}`).toBeGreaterThan(n[i + 1]);
  });
  it("each step is at least half a point (visible at normal zoom, not just measurable)", () => {
    const n = GANTT_PROFILES.screen.names;
    for (let i = 0; i < 3; i++) expect(n[i] - n[i + 1], `L${i}→L${i + 1}`).toBeGreaterThanOrEqual(0.5);
  });
  it("RED-PROOF: the pre-amendment screen sizes (9.5 / 8.5 / 8.5 / 8) fail the strict chain", () => {
    const old = { ...modelOf(GANTT_PROFILES.screen), base: (lv) => [9.5, 8.5, 8.5, 8][lv],
      fs: (kind, rowH, lv) => [9.5, 8.5, 8.5, 8][lv] };
    const v = rankViolations(old, [24]);
    expect(v.join("\n")).toMatch(/TIE .*not strictly decreasing/);
  });
});
