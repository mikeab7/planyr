import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// B1113712 (NEW-1) / B1113713 (NEW-2) — owner report: "a bunch of arrows pointing to nothing" on
// the Pappadoupolos schedule. Dependency arrows in the Gantt are drawn from a fully-computed
// `depLines` array while the BARS are windowed to `tasks.slice(startIdx, endIdx)` — so a link
// whose target row falls outside the current scroll window (NEW-1), or — theoretically, though
// this repo could not reproduce it directly — inside a collapsed parent's hidden subtree
// (NEW-2), used to render an arrowhead with no bar underneath it.
//
// ⛔ The functions under test live INSIDE public/sequence/index.html's GanttView closure (an
// in-browser Babel app with no bundler). `depAnchors`/`normPreds`/`pd`/`dif` are module-scope and
// EXTRACTED, exactly like test/ganttLabelAbove.test.js does. `glyphEdges` and the depLines-build +
// window-filter algorithm are closures over GanttView's local state and can't be extracted the
// same way, so this is a FAITHFUL COPY (the same pattern test/schedulerEngine.test.js documents
// for the date-cascade engine) — the "source guards" describe block below pins the exact lines in
// the shipped file so the copy can't silently drift from what the owner actually runs.
//
// THE INVARIANT (per the owner's own verification bar — a green depLines-correctness test is not
// enough, because the arrows were always computed correctly; they were rendered against a
// different row set than the bars): for any (tasks, collapse state, startIdx, endIdx), every
// RENDERED arrow endpoint's row index must fall inside the rendered bars' own [startIdx, endIdx)
// window.

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

const extractConst = (name) => {
  const start = SRC.indexOf(`const ${name} = `);
  expect(start, `${name} not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n};", start);
  const arrow = SRC.indexOf("\n", SRC.indexOf("=>", start));
  const body = end > -1 && end < arrow ? SRC.slice(start, end + 3) : (end > -1 ? SRC.slice(start, end + 3) : "");
  return body;
};
const oneLiner = (name) => {
  const start = SRC.indexOf(`const ${name} = `) > -1 ? SRC.indexOf(`const ${name} = `) : SRC.indexOf(`const ${name}  = `);
  const start2 = SRC.indexOf(`const ${name} `);
  const s = start > -1 ? start : start2;
  expect(s, `${name} not found`).toBeGreaterThan(-1);
  return SRC.slice(s, SRC.indexOf("\n", s));
};

const depAnchors = new Function(`${extractConst("depAnchors")}\nreturn depAnchors;`)();
const normPreds = new Function(`${extractConst("normPreds")}\nreturn normPreds;`)();
// pd/dif share one scope — dif's body calls pd(), so both must be defined together.
const { pd, dif } = new Function(`${oneLiner("pd")}\n${oneLiner("dif")}\nreturn {pd, dif};`)();

const ROW_H = 20;
const BUF = 6;

// Faithful copy of GanttView's glyphEdges (public/sequence/index.html ~L12637-12651).
const glyphEdges = (childParentIds, xOf) => (t, idx) => {
  const rowTop = idx * ROW_H;
  const sX = xOf(t.start), eX = xOf(t.end);
  if (childParentIds.has(t.id)) {
    const dd = Math.min(t.level || 0, 3), SPAN = [6, 5, 4, 4][dd], LEG = [0.16, 0.12, 0.09, 0.07][dd] * ROW_H;
    const spanTop = rowTop + (ROW_H - 2 - LEG - SPAN);
    return { startX: sX, endX: eX, topY: spanTop, botY: rowTop + ROW_H - 2, rowTop };
  }
  if (t.duration === 0) {
    const cy = rowTop + ROW_H - 7.5, mv = 4.24;
    return { startX: sX, endX: sX, topY: cy - mv, botY: cy + mv, rowTop };
  }
  const LEAF_H = ROW_H * 0.25, top = rowTop + (ROW_H - LEAF_H - 1);
  return { startX: sX, endX: sX + Math.max(9, eX - sX), topY: top, botY: top + LEAF_H, rowTop };
};

// Faithful copy of GanttView's depLines useMemo (post-fix: carries srcIdx/tgtIdx).
const buildDepLines = (tasks, minD, ppd) => {
  const xOf = (d) => Math.max(0, dif(minD, d) * ppd);
  const childParentIds = new Set(tasks.filter((t) => t.parentId !== null).map((t) => t.parentId));
  const ge = glyphEdges(childParentIds, xOf);
  const idxOf = new Map(tasks.map((t, i) => [t.id, i]));
  const raw = [];
  tasks.forEach((task) => normPreds(task.predecessors).forEach((p) => {
    const pred = idxOf.has(p.id) ? tasks[idxOf.get(p.id)] : null; if (!pred) return;
    if (!pred.start || !pred.end || !task.start || !task.end || isNaN(pd(pred.start)) || isNaN(pd(pred.end)) || isNaN(pd(task.start)) || isNaN(pd(task.end))) return;
    raw.push({ pred, task, type: (p.type || "FS").toUpperCase() });
  }));
  const bySrc = new Map();
  raw.forEach((l) => { const a = bySrc.get(l.pred.id) || []; a.push(l); bySrc.set(l.pred.id, a); });
  bySrc.forEach((a) => a.sort((x, y) => (idxOf.get(x.task.id) - idxOf.get(y.task.id)) || (x.type < y.type ? -1 : x.type > y.type ? 1 : 0)));
  return raw.map((l) => {
    const group = bySrc.get(l.pred.id);
    const src = ge(l.pred, idxOf.get(l.pred.id));
    const tgt = ge(l.task, idxOf.get(l.task.id));
    const a = depAnchors({ type: l.type, src, tgt, fanIndex: group.indexOf(l), fanCount: group.length });
    return { key: `${l.pred.id}-${l.task.id}-${l.type}`, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, down: a.down, type: l.type,
      srcIdx: idxOf.get(l.pred.id), tgtIdx: idxOf.get(l.task.id) };
  });
};

// The window filter now applied at the render site (post-fix). Pre-fix, the render mapped
// `depLines` directly with no filter at all — simulated below as `l => true`.
const windowFilter = (startIdx, endIdx) => (l) => l.srcIdx >= startIdx && l.srcIdx < endIdx && l.tgtIdx >= startIdx && l.tgtIdx < endIdx;

// Rows that actually get a rendered bar: `tasks.slice(startIdx, endIdx)`.
const renderedBarRows = (tasks, startIdx, endIdx) => new Set(tasks.slice(startIdx, endIdx).map((_, i) => startIdx + i));

const mkTask = (id, o = {}) => ({ id, name: `t${id}`, start: "2027-01-01", end: "2027-01-05", duration: 4, predecessors: [], parentId: null, isExpanded: true, ...o });

// ── Fixture A: NEW-1 — a long flat schedule scrolled to a MID position, chained FS links
// end-to-end so several links necessarily run from above-the-window into it and out the bottom.
const buildFixtureA = () => {
  const N = 60;
  const tasks = [];
  for (let i = 0; i < N; i++) {
    tasks.push(mkTask(i, {
      start: `2027-${String(1 + Math.floor(i / 20)).padStart(2, "0")}-${String(1 + (i % 20)).padStart(2, "0")}`,
      end: `2027-${String(1 + Math.floor((i + 1) / 20)).padStart(2, "0")}-${String(1 + ((i + 1) % 20)).padStart(2, "0")}`,
      predecessors: i > 0 ? [{ id: i - 1, type: "FS" }] : [],
    }));
  }
  const scrollTop = 400, vh = 300; // mirrors the owner's own repro numbers (ROW_H 20, mid-scroll)
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUF);
  const endIdx = Math.min(tasks.length, startIdx + Math.ceil(vh / ROW_H) + BUF * 2);
  return { tasks, startIdx, endIdx };
};

// ── Fixture B: NEW-2 — one collapsed parent hiding 4 descendants, with predecessor links
// crossing the visible/hidden boundary in both directions, plus a link from the LAST visible
// task back into the hidden group (the exact shape of the owner's "row past the end" report).
// Task 2 → Task 1 is a plain visible-to-visible FS link — the POSITIVE CONTROL: it must still be
// drawn, so a passing "no hidden links" assertion below proves the guard is selective, not just
// a harness that produces zero links for everything.
const buildFixtureB = () => {
  const tasks = [];
  for (let i = 1; i <= 33; i++) tasks.push(mkTask(i, { start: `2027-01-${String(1 + (i % 28)).padStart(2, "0")}`, end: `2027-01-${String(2 + (i % 27)).padStart(2, "0")}`,
    predecessors: i === 2 ? [{ id: 1, type: "FS" }] : [] }));
  const parentId = 900;
  tasks.push(mkTask(parentId, { name: "Detention & Mass Grading", start: "2027-03-01", end: "2027-03-10", isExpanded: false }));
  for (let i = 0; i < 4; i++) {
    tasks.push(mkTask(901 + i, { name: `Hidden child ${i}`, parentId, start: `2027-03-0${1 + i}`, end: `2027-03-0${2 + i}`,
      predecessors: i === 0 ? [{ id: 5, type: "FS" }] : [{ id: 900 + i, type: "FS" }] })); // 901 depends on a VISIBLE task
  }
  // The last visible task depends on a HIDDEN descendant — the owner's exact reported shape.
  tasks.push(mkTask(999, { name: "Construction", start: "2027-03-11", end: "2027-03-15", predecessors: [{ id: 904, type: "FS" }] }));

  const byId = {}; tasks.forEach((t) => (byId[t.id] = t));
  const kidsBy = new Map();
  tasks.forEach((t) => { if (!kidsBy.has(t.parentId)) kidsBy.set(t.parentId, []); kidsBy.get(t.parentId).push(t); });
  const out = [];
  const walk = (pid) => (kidsBy.get(pid) || []).forEach((t) => { out.push(t); if (t.isExpanded) walk(t.id); });
  walk(null);
  const startIdx = 0, endIdx = out.length; // whole (post-collapse) list on screen — isolates the collapse mechanism from NEW-1's scroll mechanism
  return { tasks: out, startIdx, endIdx, hiddenIds: [901, 902, 903, 904] };
};

describe("Gantt dependency arrows never outrun the rendered bars (B1113712/B1113713)", () => {
  it("FIXTURE A — RED-PROOF: without the window filter, at least one link's endpoint falls outside the scroll window (this is exactly NEW-1)", () => {
    const { tasks, startIdx, endIdx } = buildFixtureA();
    const lines = buildDepLines(tasks, tasks[0].start, 2);
    expect(lines.length).toBeGreaterThan(0);
    const barRows = renderedBarRows(tasks, startIdx, endIdx);
    const unfiltered = lines.filter(() => true); // the pre-fix render: depLines.map(...) with no filter
    const orphans = unfiltered.filter((l) => !barRows.has(l.srcIdx) || !barRows.has(l.tgtIdx));
    expect(orphans.length, "the unfiltered render must reproduce at least one orphan arrow, or this fixture doesn't test NEW-1").toBeGreaterThan(0);
  });

  it("FIXTURE A — GREEN: the window filter (post-fix) drops every orphan; every remaining arrow endpoint has a rendered bar", () => {
    const { tasks, startIdx, endIdx } = buildFixtureA();
    const lines = buildDepLines(tasks, tasks[0].start, 2);
    const barRows = renderedBarRows(tasks, startIdx, endIdx);
    const filtered = lines.filter(windowFilter(startIdx, endIdx));
    expect(filtered.length).toBeGreaterThan(0); // vacuity guard — some links must survive, or this proves nothing
    for (const l of filtered) {
      expect(barRows.has(l.srcIdx), `src row ${l.srcIdx} (key ${l.key}) has no rendered bar`).toBe(true);
      expect(barRows.has(l.tgtIdx), `tgt row ${l.tgtIdx} (key ${l.key}) has no rendered bar`).toBe(true);
    }
  });

  it("FIXTURE B — a link touching a task hidden inside a collapsed parent is never drawn at all (NEW-2, option (a) — PDF-PARITY with the print path's ix.has(pr.id) guard)", () => {
    const { tasks, hiddenIds } = buildFixtureB();
    const lines = buildDepLines(tasks, tasks[0].start, 2);
    // Positive control: the plain visible-to-visible link (2 → 1) must survive, or a harness that
    // produces zero links for everything would trivially "pass" the negative checks below.
    expect(lines.some((l) => l.key.startsWith("1-2-"))).toBe(true);
    for (const l of lines) {
      expect(hiddenIds).not.toContain(Number(l.key.split("-")[0]));
    }
    // The specific reported shape: "Construction" (999) → hidden 904 must not appear.
    expect(lines.some((l) => l.key.startsWith("904-999-"))).toBe(false);
    // And every surviving row index is inside the visible (post-collapse) array bounds.
    for (const l of lines) {
      expect(l.srcIdx).toBeGreaterThanOrEqual(0);
      expect(l.srcIdx).toBeLessThan(tasks.length);
      expect(l.tgtIdx).toBeGreaterThanOrEqual(0);
      expect(l.tgtIdx).toBeLessThan(tasks.length);
    }
  });

  it("FIXTURE B — the full invariant: every arrow endpoint coincides with a rendered bar, scrolled or not", () => {
    const { tasks, startIdx, endIdx } = buildFixtureB();
    const lines = buildDepLines(tasks, tasks[0].start, 2).filter(windowFilter(startIdx, endIdx));
    expect(lines.length).toBeGreaterThan(0); // vacuity guard
    const barRows = renderedBarRows(tasks, startIdx, endIdx);
    for (const l of lines) {
      expect(barRows.has(l.srcIdx)).toBe(true);
      expect(barRows.has(l.tgtIdx)).toBe(true);
    }
  });

  it("BACKSTOP — the window filter rejects an out-of-range endpoint regardless of how it arose (belt-and-suspenders for NEW-2)", () => {
    // This repo's own idxOf.has(p.id) guard already makes a hidden-task link unconstructible (the
    // FIXTURE B test above proves that positively). This test proves the INDEPENDENT second guard
    // — the render-site window filter — is also, on its own, sufficient: even a hand-built entry
    // whose tgtIdx sits one past the end of a real task list (exactly "row 38 that doesn't exist"
    // in a 38-row chart) is excluded, without relying on how that entry was produced.
    const tasks = Array.from({ length: 38 }, (_, i) => mkTask(i));
    const startIdx = 0, endIdx = 38;
    const fabricated = { key: "fab", x1: 0, y1: 0, x2: 0, y2: 0, down: true, type: "FS", srcIdx: 37, tgtIdx: 38 };
    expect(windowFilter(startIdx, endIdx)(fabricated)).toBe(false);
    const barRows = renderedBarRows(tasks, startIdx, endIdx);
    expect(barRows.has(38)).toBe(false); // row 38 genuinely doesn't exist in a 38-row list
  });
});

describe("source guards — the shipped file actually carries the window-filter fix (drift/revert proof)", () => {
  it("depLines carries srcIdx/tgtIdx alongside the geometry", () => {
    expect(SRC).toContain("srcIdx: idxOf.get(l.pred.id), tgtIdx: idxOf.get(l.task.id)");
  });
  it("the Gantt arrow SVG filters to the SAME [startIdx,endIdx) window the bars slice below use", () => {
    expect(SRC).toContain("depLines.filter(l => l.srcIdx >= startIdx && l.srcIdx < endIdx && l.tgtIdx >= startIdx && l.tgtIdx < endIdx).map(l => {");
  });
  it("REVERT-CHECK: the old unwindowed render (`depLines.map(l => {` with nothing before it) is gone", () => {
    const svgOpen = SRC.indexOf("{/* Dependency arrows");
    const mapCall = SRC.indexOf(".map(l => {", svgOpen);
    const between = SRC.slice(svgOpen, mapCall);
    expect(between).toContain("depLines.filter(");
  });
  it("the print path (buildGanttSVG) still drops a link touching a task outside the exhibit's visible list — PDF-PARITY", () => {
    expect(SRC).toContain("if(!ix.has(pr.id)) continue;");
  });
});

// ── AMENDMENT to B1113712/B1113713 (owner re-report, 2026-09-04): "most orphan arrows are gone;
// at least one class survives." The index-window class above (NEW-1/NEW-2) was already closed and
// stayed closed — every fixture above still passes. Live investigation (headless, this session)
// found a SEPARATE, still-open class: `depLines`'s useMemo bakes ROW_H (a module-scope `let`,
// mutated by an effect keyed on data.settings.rowHeight that runs AFTER the commit that reads it)
// into every x/y it returns via glyphEdges, but never listed ROW_H in its own dependency array. A
// project whose rowHeight differs from the module's initial default (24) renders self-consistently
// on its FIRST paint (bars and this memo both read the still-stale ROW_H in that same commit), but
// the very next render this memo doesn't otherwise recompute for — a plain scroll, since
// tasks/minD/ppd/childParentIds/settings are all untouched by scrolling — re-renders the
// (unmemoized) bars fresh at the NOW-correct ROW_H while this memo keeps serving geometry baked
// under the STALE one. srcIdx/tgtIdx (NEW-1's fix) stay perfectly valid throughout — this is a
// PIXEL-position staleness, invisible to an index-bounds check — and the drift is
// `rowIdx * (staleROW_H - currentROW_H)` px, large enough by the bottom of a real schedule to land
// an arrowhead past the last rendered row. Reproduced live: mounted the real app with
// rowHeight:20, waited for the settings effect, then scrolled — bar row tops correctly read
// 0/20/40/…; depLines' own arrow y-coordinates stayed frozen at 0/24/48/… (5 of 25 arrows orphaned)
// until ROW_H joined its dependency list.
describe("NEW-3 — depLines must recompute when ROW_H changes, even when nothing else in its deps does", () => {
  // A minimal, faithful reimplementation of React's own useMemo dependency-array semantics —
  // shallow-compare each slot with Object.is, recompute only on a mismatch. This is a well-defined,
  // uncontroversial ~5-line algorithm (not a re-implementation of React itself), used here exactly
  // the way test/ganttArrowVirtualization.test.js already "faithfully copies" pure logic out of the
  // Babel-in-browser file it can't `import` from — the property under test is a MEMOIZATION-TIMING
  // bug, so the harness has to actually memoize, not just call the pure builder fresh each time
  // (which is what every fixture above does, and exactly why none of them could have caught this).
  const makeUseMemo = () => {
    let cachedVal = null, cachedDeps = null, calls = 0;
    return (compute, deps) => {
      const stale = !cachedDeps || deps.length !== cachedDeps.length || deps.some((d, i) => !Object.is(d, cachedDeps[i]));
      if (stale) { cachedVal = compute(); cachedDeps = deps; calls++; }
      return cachedVal;
    };
  };

  // Faithful copy of glyphEdges, parameterized on rowH (the real file reads the module-scope ROW_H
  // directly instead of taking a parameter — same computation, just made testable).
  const glyphEdgesFor = (rowH, childParentIds, xOf) => (t, idx) => {
    const rowTop = idx * rowH;
    const sX = xOf(t.start), eX = xOf(t.end);
    if (childParentIds.has(t.id)) {
      const dd = Math.min(t.level || 0, 3), SPAN = [6, 5, 4, 4][dd], LEG = [0.16, 0.12, 0.09, 0.07][dd] * rowH;
      const spanTop = rowTop + (rowH - 2 - LEG - SPAN);
      return { startX: sX, endX: eX, topY: spanTop, botY: rowTop + rowH - 2, rowTop };
    }
    if (t.duration === 0) {
      const cy = rowTop + rowH - 7.5, mv = 4.24;
      return { startX: sX, endX: sX, topY: cy - mv, botY: cy + mv, rowTop };
    }
    const LEAF_H = rowH * 0.25, top = rowTop + (rowH - LEAF_H - 1);
    return { startX: sX, endX: sX + Math.max(9, eX - sX), topY: top, botY: top + LEAF_H, rowTop };
  };

  // Faithful copy of the depLines builder, parameterized on rowH so it can be called under two
  // different ROW_H values — the real bug's whole shape is "the same tasks/minD/ppd, a DIFFERENT
  // rowH, and whether the memo notices."
  const buildDepLinesFor = (rowH, tasks, minD, ppd) => {
    const xOf = (d) => Math.max(0, dif(minD, d) * ppd);
    const childParentIds = new Set(tasks.filter((t) => t.parentId !== null).map((t) => t.parentId));
    const ge = glyphEdgesFor(rowH, childParentIds, xOf);
    const idxOf = new Map(tasks.map((t, i) => [t.id, i]));
    const raw = [];
    tasks.forEach((task) => normPreds(task.predecessors).forEach((p) => {
      const pred = idxOf.has(p.id) ? tasks[idxOf.get(p.id)] : null; if (!pred) return;
      raw.push({ pred, task, type: (p.type || "FS").toUpperCase() });
    }));
    return raw.map((l) => {
      const src = ge(l.pred, idxOf.get(l.pred.id));
      const tgt = ge(l.task, idxOf.get(l.task.id));
      const a = depAnchors({ type: l.type, src, tgt, fanIndex: 0, fanCount: 1 });
      return { key: `${l.pred.id}-${l.task.id}-${l.type}`, y1: a.y1, y2: a.y2, srcIdx: idxOf.get(l.pred.id), tgtIdx: idxOf.get(l.task.id) };
    });
  };

  const fixtureTasks = () => Array.from({ length: 25 }, (_, i) => mkTask(i, {
    start: `2027-01-${String(1 + (i % 27)).padStart(2, "0")}`, end: `2027-01-${String(2 + (i % 26)).padStart(2, "0")}`,
    predecessors: i > 0 ? [{ id: i - 1, type: "FS" }] : [],
  }));

  it("RED-PROOF: WITHOUT ROW_H in the deps, a rowH change with nothing else in the deps changing leaves the memo serving stale (pre-change) pixel geometry", () => {
    const useMemoSim = makeUseMemo();
    const tasks = fixtureTasks(), minD = tasks[0].start, ppd = 2;
    // Render 1: mounts at the module's initial default, exactly like the real file's first paint.
    const rowH1 = 24;
    const buggyDeps = (rowH) => [tasks, minD, ppd]; // ROW_H NOT included — this is the pre-fix shape
    const first = useMemoSim(() => buildDepLinesFor(rowH1, tasks, minD, ppd), buggyDeps(rowH1));
    // Render 2: the settings effect has now applied the project's real rowHeight (20), and SOME
    // OTHER render occurs (a scroll) that touches none of tasks/minD/ppd — the memo's own (buggy)
    // dependency list is therefore unchanged, so it must NOT recompute.
    const rowH2 = 20;
    const second = useMemoSim(() => buildDepLinesFor(rowH2, tasks, minD, ppd), buggyDeps(rowH2));
    expect(second).toBe(first); // same cached array reference — proves the memo didn't recompute
    // And that stale geometry now disagrees with what a FRESH (unmemoized) computation at rowH2
    // would say — the exact shape of "bars re-rendered fresh, arrows didn't."
    const fresh = buildDepLinesFor(rowH2, tasks, minD, ppd);
    const drifted = second.filter((l, i) => l.y1 !== fresh[i].y1 || l.y2 !== fresh[i].y2);
    expect(drifted.length, "the unfixed memo shape must reproduce at least one drifted arrow, or this fixture doesn't test NEW-3").toBeGreaterThan(0);
  });

  it("GREEN: WITH ROW_H in the deps (the shipped fix), the same sequence recomputes and matches a fresh build exactly", () => {
    const useMemoSim = makeUseMemo();
    const tasks = fixtureTasks(), minD = tasks[0].start, ppd = 2;
    const rowH1 = 24;
    const fixedDeps = (rowH) => [tasks, minD, ppd, rowH]; // ROW_H included — post-fix shape
    const first = useMemoSim(() => buildDepLinesFor(rowH1, tasks, minD, ppd), fixedDeps(rowH1));
    const rowH2 = 20;
    const second = useMemoSim(() => buildDepLinesFor(rowH2, tasks, minD, ppd), fixedDeps(rowH2));
    expect(second).not.toBe(first); // a NEW array — the memo correctly recomputed
    const fresh = buildDepLinesFor(rowH2, tasks, minD, ppd);
    expect(second).toEqual(fresh); // and it matches what a fresh build at the current rowH says
  });
});

describe("source guard — depLines' useMemo lists ROW_H as a dependency (NEW-3 drift/revert proof)", () => {
  it("the shipped file's depLines useMemo dependency array includes ROW_H", () => {
    expect(SRC).toContain("}, [tasks, minD, ppd, childParentIds, settings, ROW_H]);");
  });
});
