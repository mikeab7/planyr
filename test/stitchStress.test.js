/* Adversarial STRESS TEST for the Document-Review drawing stitch tool (B341).
 *
 * The stitcher's job — drop a multi-page PDF set, auto-group it, auto-stitch the seams, and
 * calibrate — is geometry that fails SILENTLY when it fails: a bad transform flings a sheet
 * off-canvas or, worse, butts two drawings together at the wrong size/place and the takeoff
 * reads a confident wrong number. So this suite doesn't test the happy path (that's
 * stitchGeom.test.js / autoStitch.test.js / sheetGroups.test.js); it deliberately tries to BREAK
 * the pure engines with the inputs a real-world PDF set throws at them:
 *   - non-finite / degenerate coordinates (a NaN that slips past a `< 1` length check),
 *   - contradictory match-line labels (both sheets claim the seam is on their "right"),
 *   - mismatched page sizes (a half-size detail page grouped with full plots),
 *   - cycles, duplicate sheet numbers, self-references, missing targets,
 *   - sheet-code edge cases that mis-chain across a major rollover,
 *   - junk / empty / huge reader inputs,
 *   - and a randomized fuzz that asserts the invariants hold over hundreds of random sets.
 *
 * The governing rule throughout (owner): a WRONG stitch is worse than an un-stitched one — when a
 * signal is unreliable the engine must leave the sheet UNPLACED for the manual-Align safety net,
 * never auto-guess. Each block below pins one break-strategy and the safe behavior it must show.
 */
import { describe, it, expect } from "vitest";
import {
  fwd, inv, solveM, sheetBBox,
  alignBaselinesDegenerate, sheetContains, measureOverUnaligned,
} from "../src/workspaces/doc-review/lib/stitchGeom.js";
import {
  detectedEndpointsFor, buildAdjacency, autoPlaceGroup, MAX_STITCH_SCALE,
} from "../src/workspaces/doc-review/lib/autoStitch.js";
import {
  parseSheetCode, consecutiveCodes, groupSheets,
} from "../src/shared/files/sheetGroups.js";
import {
  edgeOf, reconstructLines, parseMatchLines, detectTitleBlock, readSheetMeta,
} from "../src/shared/files/sheetMeta.js";

const DA = { x: 0, y: 0, w: 1900, h: 1584 };       // full-size landscape drawing area
const sheet = (id, sheetNumber, matchLines, drawingArea = DA) => ({ id, sheetNumber, matchLines, drawingArea });
const finiteM = (M) => M && ["A", "B", "e", "f"].every((k) => Number.isFinite(M[k]));

/* ───────────────────────── 1. non-finite / degenerate coordinates ───────────────────────── */
describe("STRESS · non-finite & degenerate baselines never reach solveM", () => {
  it("alignBaselinesDegenerate rejects NaN, Infinity, and missing points (not just short ones)", () => {
    const A1 = { x: 0, y: 0 }, A2 = { x: 100, y: 0 };
    // The original bug: `Math.hypot(NaN) < 1` is `NaN < 1` → false, so NaN used to pass the guard.
    expect(alignBaselinesDegenerate({ x: NaN, y: 0 }, { x: 100, y: 0 }, A1, A2)).toBe(true);
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, { x: 100, y: 0 }, A1, { x: Infinity, y: 0 })).toBe(true);
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, { x: 100, y: 0 }, A1, { x: -Infinity, y: 0 })).toBe(true);
    expect(alignBaselinesDegenerate(null, { x: 100, y: 0 }, A1, A2)).toBe(true);
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, undefined, A1, A2)).toBe(true);
    expect(alignBaselinesDegenerate({ x: 0, y: NaN }, { x: 100, y: 0 }, A1, A2)).toBe(true);
    // a healthy baseline still passes
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, { x: 100, y: 0 }, A1, A2)).toBe(false);
  });

  it("autoPlaceGroup leaves a sheet with a NaN drawing-area UNPLACED — no NaN matrix escapes", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }], { x: 0, y: 0, w: 1900, h: NaN });
    const { placements, placed, unplaced, ok } = autoPlaceGroup([a, b]);
    expect(ok).toBe(false);
    expect(placed).toContain("a");
    expect(unplaced).toContain("b");
    for (const M of placements.values()) expect(finiteM(M)).toBe(true); // nothing poisoned
  });

  it("inv() tolerates a collapsed transform (A=B=0) instead of dividing by zero", () => {
    expect(() => inv({ A: 0, B: 0, e: 5, f: 5 }, { x: 9, y: 9 })).not.toThrow();
    const p = inv({ A: 0, B: 0, e: 5, f: 5 }, { x: 9, y: 9 });
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

/* ───────────────────────── 2. contradictory match-line labels ───────────────────────── */
describe("STRESS · contradictory seam labels are dropped, not stitched wrong", () => {
  it("two sheets that BOTH claim the seam on their 'right' do not auto-stitch (→ manual Align)", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "right" }]); // impossible for a shared seam
    const adj = buildAdjacency([a, b]);
    expect(adj.get("a")).toEqual([]); // contradictory edge dropped
    expect(adj.get("b")).toEqual([]);
    const { ok, unplaced } = autoPlaceGroup([a, b]);
    expect(ok).toBe(false);
    expect(unplaced).toContain("b"); // left for the safety net rather than overlapped/mirrored
  });

  it("a CONSISTENT pair (right ↔ left) still links — the guard doesn't over-fire", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }]);
    const adj = buildAdjacency([a, b]);
    expect(adj.get("a")).toMatchObject([{ side: "right", otherSide: "left" }]);
    expect(autoPlaceGroup([a, b]).ok).toBe(true);
  });

  it("the geometric opposite wins even when B mislabels its own side as 'top'", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "top" }]); // also contradictory
    expect(buildAdjacency([a, b]).get("a")).toEqual([]);
    expect(autoPlaceGroup([a, b]).unplaced).toContain("b");
  });
});

/* ───────────────────────── 3. mismatched page sizes (silent rescale) ───────────────────────── */
describe("STRESS · a wrong-size sheet is left unplaced, not force-scaled to fit", () => {
  it("a half-height neighbor would need ~2× scale to butt the seam — rejected", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const half = { x: 0, y: 0, w: 950, h: 792 }; // half-size detail sheet
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }], half);
    const { ok, placed, unplaced } = autoPlaceGroup([a, b]);
    expect(ok).toBe(false);
    expect(placed).toEqual(["a"]);
    expect(unplaced).toEqual(["b"]);
  });

  it("a same-size neighbor places at ~1× scale (in-band) — happy path intact", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }]);
    const M = autoPlaceGroup([a, b]).placements.get("b");
    const s = Math.hypot(M.A, M.B);
    expect(s).toBeGreaterThanOrEqual(1 / MAX_STITCH_SCALE);
    expect(s).toBeLessThanOrEqual(MAX_STITCH_SCALE);
    expect(s).toBeCloseTo(1, 6);
  });

  it("MAX_STITCH_SCALE is a sane band (past plot rounding, short of half/double size)", () => {
    expect(MAX_STITCH_SCALE).toBeGreaterThan(1);
    expect(MAX_STITCH_SCALE).toBeLessThan(2);
  });
});

/* ───────────────────────── 4. graph pathologies ───────────────────────── */
describe("STRESS · cycles, duplicates, self-refs, missing targets", () => {
  it("a cyclic seam graph terminates, places each sheet once, all finite", () => {
    // C-5 ⇄ C-6 ⇄ C-7 and C-7 → C-5 (a closing edge) — must not loop or double-place.
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }, { target: "C-7", side: "right" }]);
    const c = sheet("c", "C-7", [{ target: "C-6", side: "left" }, { target: "C-5", side: "top" }]);
    const { placements, placed, unplaced } = autoPlaceGroup([a, b, c]);
    expect(placements.size).toBe(placed.length);
    expect(new Set(placed).size).toBe(placed.length);                 // no id placed twice
    expect([...placed, ...unplaced].sort()).toEqual(["a", "b", "c"]); // every sheet accounted for
    for (const M of placements.values()) expect(finiteM(M)).toBe(true);
  });

  it("duplicate sheet numbers don't throw and still partition every sheet", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b1 = sheet("b1", "C-6", [{ target: "C-5", side: "left" }]);
    const b2 = sheet("b2", "C-6", [{ target: "C-5", side: "left" }]); // same number as b1
    const { placed, unplaced } = autoPlaceGroup([a, b1, b2]);
    expect([...placed, ...unplaced].sort()).toEqual(["a", "b1", "b2"]);
  });

  it("a self-referencing match line is ignored", () => {
    const a = sheet("a", "C-5", [{ target: "C-5", side: "right" }]); // points at itself
    expect(buildAdjacency([a]).get("a")).toEqual([]);
    expect(autoPlaceGroup([a]).placed).toEqual(["a"]); // anchor only, no crash
  });

  it("a match line whose target sheet isn't in the set leaves the orphan unplaced", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const lonely = sheet("c", "C-9", [{ target: "C-99", side: "right" }]); // C-99 not present
    const { placed, unplaced } = autoPlaceGroup([a, lonely]);
    expect(placed).toContain("a");
    expect(unplaced).toContain("c");
  });

  it("a bare match line (no target/side) is not a usable seam", () => {
    const a = sheet("a", "C-5", [{ side: "" }, { target: "" }]);
    const b = sheet("b", "C-6", []);
    const { unplaced } = autoPlaceGroup([a, b]);
    expect(unplaced).toContain("b"); // nothing linked them
  });

  it("an empty set returns the empty result, not a crash", () => {
    expect(autoPlaceGroup([])).toMatchObject({ placed: [], unplaced: [], ok: false });
    expect(autoPlaceGroup()).toMatchObject({ placed: [], unplaced: [] });
  });

  it("placement is deterministic regardless of input order", () => {
    const a = sheet("a", "C-5", [{ target: "C-6", side: "right" }]);
    const b = sheet("b", "C-6", [{ target: "C-5", side: "left" }, { target: "C-7", side: "right" }]);
    const c = sheet("c", "C-7", [{ target: "C-6", side: "left" }]);
    const fwdOrder = autoPlaceGroup([a, b, c]);
    const revOrder = autoPlaceGroup([c, b, a]);
    for (const id of ["a", "b", "c"]) {
      expect(revOrder.placements.get(id)).toEqual(fwdOrder.placements.get(id));
    }
  });
});

/* ───────────────────────── 5. sheet-code grouping edge cases ───────────────────────── */
describe("STRESS · sheet-code parsing & contiguity", () => {
  it("does NOT chain across a major rollover (C-1.99 → C-2.00)", () => {
    const a = parseSheetCode("C-1.99"), b = parseSheetCode("C-2.00");
    expect(consecutiveCodes(a, b)).toBe(false);
  });
  it("chains sub-sheets within one major (C-2.01 → C-2.02) and plain majors (C-5 → C-6)", () => {
    expect(consecutiveCodes(parseSheetCode("C-2.01"), parseSheetCode("C-2.02"))).toBe(true);
    expect(consecutiveCodes(parseSheetCode("C5"), parseSheetCode("C6"))).toBe(true);
  });
  it("never chains mixed levels or different prefixes", () => {
    expect(consecutiveCodes(parseSheetCode("C5"), parseSheetCode("C-5.01"))).toBe(false);
    expect(consecutiveCodes(parseSheetCode("C5"), parseSheetCode("A6"))).toBe(false);
    expect(consecutiveCodes(parseSheetCode("C5"), parseSheetCode("C8"))).toBe(false); // gap
  });
  it("parseSheetCode survives junk without throwing", () => {
    for (const j of [null, undefined, "", "   ", "---", "...", "🙂", "SHEET", { x: 1 }, 12345, "C".repeat(500)]) {
      expect(() => parseSheetCode(j)).not.toThrow();
    }
    expect(parseSheetCode("")).toBeNull();
    expect(parseSheetCode("---")).toBeNull();
  });

  it("groupSheets splits a set at the major rollover instead of force-merging it", () => {
    const page = (sheetNumber) => ({ sheetNumber, item: "Grading Plan", discipline: "Civil" });
    const groups = groupSheets([page("C-1.98"), page("C-1.99"), page("C-2.00"), page("C-2.01")]);
    // C-1.98–C-1.99 is one run; C-2.00–C-2.01 is another — two logical sheets, not one.
    expect(groups.length).toBe(2);
    expect(groups.every((g) => g.pages.length === 2)).toBe(true);
  });

  it("groupSheets collapses a clean contiguous run into one group", () => {
    const page = (sheetNumber) => ({ sheetNumber, item: "Grading Plan", discipline: "Civil" });
    const groups = groupSheets(["C-5", "C-6", "C-7", "C-8", "C-9"].map(page));
    expect(groups.length).toBe(1);
    expect(groups[0].kind).toBe("group");
    expect(groups[0].pages.length).toBe(5);
  });

  it("an unreadable sheet number stays standalone (never force-merged)", () => {
    const groups = groupSheets([
      { sheetNumber: "C-5", item: "Grading Plan" },
      { sheetNumber: "", item: "Grading Plan" },     // can't read the number
      { sheetNumber: "C-6", item: "Grading Plan" },
    ]);
    expect(groups.length).toBe(3);
  });
});

/* ───────────────────────── 6. reader robustness (sheetMeta) ───────────────────────── */
describe("STRESS · the positional reader degrades, never throws", () => {
  it("edgeOf always returns a valid side, even at the dead center / zero dims", () => {
    for (const [cx, cy, w, h] of [[50, 50, 100, 100], [0, 0, 0, 0], [-5, -5, 100, 100], [NaN, NaN, 100, 100]]) {
      const e = edgeOf(cx, cy, w, h);
      expect(["left", "right", "top", "bottom"]).toContain(e.side);
      expect(["vertical", "horizontal"]).toContain(e.orientation);
    }
  });
  it("reconstructLines / parseMatchLines / detectTitleBlock no-op on empty or null input", () => {
    expect(reconstructLines([])).toEqual([]);
    expect(reconstructLines(null)).toEqual([]);
    expect(reconstructLines([{ str: "   " }])).toEqual([]); // whitespace-only → dropped
    expect(parseMatchLines([], {})).toEqual([]);
    expect(detectTitleBlock([], { width: 0, height: 0 })).toBeNull();
    expect(detectTitleBlock(null, {})).toBeNull();
  });
  it("readSheetMeta on an empty / textless page returns the honest no-text record", () => {
    const m = readSheetMeta({});
    expect(m.hasText).toBe(false);
    expect(m.confidence).toBe(0);
    expect(m.matchLines).toEqual([]);
    expect(m.drawingArea).toMatchObject({ x: 0, y: 0 });
  });
  it("readSheetMeta survives a large fuzz of random positioned items without throwing", () => {
    const rnd = mulberry32(7);
    for (let t = 0; t < 60; t++) {
      const n = Math.floor(rnd() * 120);
      const items = Array.from({ length: n }, () => ({
        str: rnd() < 0.1 ? "MATCH LINE SEE SHEET C-" + Math.floor(rnd() * 20) : randStr(rnd),
        x: rnd() * 2000, y: rnd() * 1600, w: rnd() * 80, h: rnd() * 14,
      }));
      const page = { items, width: rnd() < 0.05 ? 0 : 2000, height: rnd() < 0.05 ? 0 : 1600 };
      expect(() => readSheetMeta(page)).not.toThrow();
      const m = readSheetMeta(page);
      expect(Array.isArray(m.matchLines)).toBe(true);
    }
  });
});

/* ───────────────────────── 7. randomized fuzz — invariants over hundreds of sets ───────────────────────── */
describe("STRESS · autoPlaceGroup fuzz: invariants hold for random seam graphs", () => {
  it("never throws, never emits a non-finite matrix, always partitions every sheet exactly once", () => {
    const rnd = mulberry32(42);
    const SIDES = ["left", "right", "top", "bottom"];
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rnd() * 8);
      const sheets = Array.from({ length: n }, (_, i) => {
        const matchLines = [];
        const links = Math.floor(rnd() * 3);
        for (let k = 0; k < links; k++) {
          matchLines.push({ target: "C-" + (1 + Math.floor(rnd() * (n + 2))), side: SIDES[Math.floor(rnd() * 4)] });
        }
        // occasionally hand it a degenerate / odd drawing area
        const da = rnd() < 0.15
          ? { x: 0, y: 0, w: rnd() < 0.5 ? 0 : rnd() * 4000, h: rnd() < 0.5 ? NaN : rnd() * 3000 }
          : DA;
        return { id: "s" + i, sheetNumber: "C-" + (1 + i), matchLines, drawingArea: da };
      });
      let res;
      expect(() => { res = autoPlaceGroup(sheets); }).not.toThrow();
      // partition: every sheet is in placed XOR unplaced, exactly once
      const all = sheets.map((s) => s.id).sort();
      expect([...res.placed, ...res.unplaced].sort()).toEqual(all);
      expect(new Set([...res.placed, ...res.unplaced]).size).toBe(n);
      // ok ⇔ nothing unplaced
      expect(res.ok).toBe(res.unplaced.length === 0);
      // every emitted transform is finite and in the allowed scale band
      for (const M of res.placements.values()) {
        expect(finiteM(M)).toBe(true);
        const s = Math.hypot(M.A, M.B);
        expect(s).toBeGreaterThanOrEqual(1 / MAX_STITCH_SCALE - 1e-9);
        expect(s).toBeLessThanOrEqual(MAX_STITCH_SCALE + 1e-9);
      }
      // every placed sheet's world bbox is finite (won't NaN-poison the composite fit)
      for (const s of sheets) {
        if (!res.placements.has(s.id)) continue;
        const bb = sheetBBox({ baseW: 1900, baseH: 1584, M: res.placements.get(s.id) });
        for (const v of Object.values(bb)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

/* ───────────────────────── 8. measurement-over-unaligned guard under stress ───────────────────────── */
describe("STRESS · measure-over-unaligned guard", () => {
  it("flags a point over ANY unaligned sheet and ignores aligned ones / empty input", () => {
    const aligned = { M: { A: 1, B: 0, e: 0, f: 0 }, baseW: 200, baseH: 100, aligned: true };
    const fresh = { M: { A: 1, B: 0, e: 1000, f: 0 }, baseW: 200, baseH: 100, aligned: false };
    expect(measureOverUnaligned([aligned, fresh], [{ x: 1050, y: 50 }])).toBe(true);
    expect(measureOverUnaligned([aligned, fresh], [{ x: 50, y: 50 }])).toBe(false);
    expect(measureOverUnaligned([], [{ x: 0, y: 0 }])).toBe(false);
    expect(measureOverUnaligned([aligned], [])).toBe(false);
    expect(sheetContains(fresh, { x: 1100, y: 50 })).toBe(true);
  });
});

/* small deterministic PRNG + helpers so the fuzz is reproducible */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randStr(rnd) {
  const len = 1 + Math.floor(rnd() * 10);
  const cs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.";
  let s = "";
  for (let i = 0; i < len; i++) s += cs[Math.floor(rnd() * cs.length)];
  return s;
}
