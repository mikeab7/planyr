/* The shared combine / split / restore (lib/parcelOps.js) — the one implementation the Parcels
 * panel AND the map toolbar both call. `mergeRings` is injected, so these tests drive the real
 * planner with a tiny rectangle-union stand-in for the boundary-detection function (which belongs to
 * a different change and is NOT restated here). */
import { describe, it, expect } from "vitest";
import { planCombine, planSplit, planRestoreCombined, planRestoreSplit, nextTractName, includedAcres, buildParcelRows, deedAcresSummed } from "../src/workspaces/site-planner/lib/parcelOps.js";
import { parcelNetSqft, SQFT_PER_ACRE } from "../src/workspaces/site-planner/lib/parcelArea.js";

const rect = (x, y, w, h) => [{ x, y, w: 0 }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map(({ x: px, y: py }) => ({ x: px, y: py }));
const bbox = (r) => ({ x0: Math.min(...r.map((p) => p.x)), x1: Math.max(...r.map((p) => p.x)), y0: Math.min(...r.map((p) => p.y)), y1: Math.max(...r.map((p) => p.y)) });
// Stand-in union for axis-aligned rectangles that share a full edge (null = not touching).
const mergeRings = (a, b) => {
  const A = bbox(a), B = bbox(b);
  const sameY = A.y0 === B.y0 && A.y1 === B.y1 && (A.x1 === B.x0 || B.x1 === A.x0);
  const sameX = A.x0 === B.x0 && A.x1 === B.x1 && (A.y1 === B.y0 || B.y1 === A.y0);
  if (!sameY && !sameX) return null;
  const x0 = Math.min(A.x0, B.x0), x1 = Math.max(A.x1, B.x1), y0 = Math.min(A.y0, B.y0), y1 = Math.max(A.y1, B.y1);
  return rect(x0, y0, x1 - x0, y1 - y0);
};
let n = 0;
const newId = () => `id${++n}`;
const mk = (id, x, y, w = 100, h = 100, extra = {}) => ({ id, points: rect(x, y, w, h), locked: true, ...extra });
// A 4-wide strip of parcels, side by side.
const strip = () => [mk("a", 0, 0), mk("b", 100, 0), mk("c", 200, 0), mk("d", 300, 0)];
const total = (ps) => includedAcres(ps);
const C = (ps, ids) => planCombine(ps, ids, { mergeRings, newId });
const S = (ps, path, o = {}) => planSplit(ps, path, { newId, ...o });

describe("combine", () => {
  it("makes ONE auto-named tract, keeps the site total, and holds the originals", () => {
    const ps = strip();
    const before = total(ps);
    const r = C(ps, ["a", "b", "c"]);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("Tract A");
    expect(r.tract.label).toBe("Tract A");
    expect(r.parcels.map((p) => p.id)).toEqual([r.tract.id, "d"]);       // originals are NOT live parcels
    expect(r.removeIds.sort()).toEqual(["a", "b", "c"]);
    expect(r.tract.combined.from.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(Math.abs(total(r.parcels) - before)).toBeLessThan(1e-9);
    expect(parcelNetSqft(r.tract) / SQFT_PER_ACRE).toBeCloseTo(300 * 100 / SQFT_PER_ACRE, 9);
  });
  it("names the next tract Tract B, and carries past Z", () => {
    const first = C(strip(), ["a", "b"]);
    expect(nextTractName(first.parcels)).toBe("Tract B");
    const many = Array.from({ length: 26 }, (_, i) => ({ id: `t${i}`, points: rect(0, 0, 1, 1), label: `Tract ${String.fromCharCode(65 + i)}` }));
    expect(nextTractName(many)).toBe("Tract AA");
  });
  it("never reuses a name a Restore would bring back (names inside snapshots count)", () => {
    const first = C(strip(), ["a", "b"]);                                 // Tract A, holds a + b
    const second = C(first.parcels, [first.tract.id, "c"]);                // Tract B, holds Tract A inside
    expect(second.name).toBe("Tract B");
    const third = C(second.parcels, [second.tract.id, "d"]);
    expect(third.name).toBe("Tract C");
  });
  it("refuses, with a plain reason, parcels that do not touch", () => {
    const r = C(strip(), ["a", "c"]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("not-touching");
    expect(r.message).toMatch(/don't all touch/);
  });
  it("refuses fewer than two, and an excluded (eye-off) parcel — by name", () => {
    expect(C(strip(), ["a"]).ok).toBe(false);
    const ps = strip().map((p) => (p.id === "b" ? { ...p, active: false, attrs: { owner: "Gordon Smith" } } : p));
    const r = C(ps, ["a", "b"]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("excluded");
  });
  it("a locked parcel may be combined (lock only protects the boundary on the map); the tract inherits lock only if all were", () => {
    const ps = strip().map((p) => (p.id === "b" ? { ...p, locked: false } : p));
    expect(C(ps, ["a", "b"]).tract.locked).toBe(false);
    expect(C(ps, ["c", "d"]).tract.locked).toBe(true);
  });
  it("carries save-and-except holes so the net acreage (and the site total) cannot move", () => {
    const hole = { pts: rect(10, 10, 20, 20), label: "hole" };
    const ps = [mk("a", 0, 0, 100, 100, { exceptions: [hole] }), mk("b", 100, 0)];
    const before = total(ps);
    const r = C(ps, ["a", "b"]);
    expect(r.tract.exceptions).toHaveLength(1);
    expect(Math.abs(total(r.parcels) - before)).toBeLessThan(1e-9);
  });
});

describe("restore a combine", () => {
  it("puts every original back exactly (outline, include, lock) with fresh ids, total unchanged", () => {
    const ps = strip().map((p) => (p.id === "b" ? { ...p, locked: false, label: "Gordon", acct: "123", statedAcres: 5 } : p));
    const before = total(ps);
    const c = C(ps, ["a", "b", "c"]);
    const r = planRestoreCombined(c.parcels, c.tract.id, { newId });
    expect(r.ok).toBe(true);
    expect(r.parcels).toHaveLength(4);
    const byLabel = r.parcels.find((p) => p.label === "Gordon");
    expect(byLabel.locked).toBe(false);
    expect(byLabel.acct).toBe("123");
    expect(byLabel.snapName).toBeUndefined();
    expect(r.restored.every((p) => !["a", "b", "c"].includes(p.id))).toBe(true); // old ids stay tombstoned
    expect(Math.abs(total(r.parcels) - before)).toBeLessThan(1e-9);
  });
  it("still restores after the tract itself was reshaped or renamed", () => {
    const c = C(strip(), ["a", "b"]);
    const edited = c.parcels.map((p) => (p.id === c.tract.id ? { ...p, label: "Renamed", points: rect(0, 0, 150, 100) } : p));
    expect(planRestoreCombined(edited, c.tract.id, { newId }).ok).toBe(true);
  });
  it("refuses a parcel that was never combined", () => {
    expect(planRestoreCombined(strip(), "a", { newId }).ok).toBe(false);
  });
});

describe("split", () => {
  const cutDown = [{ x: 50, y: -10 }, { x: 50, y: 110 }];
  it("splits into auto-named pieces that add up to the original, no prompt", () => {
    const ps = [mk("k", 0, 0, 100, 100, { label: "Kilgore P." })];
    const before = total(ps);
    const r = S(ps, cutDown);
    expect(r.ok).toBe(true);
    expect(r.made.map((m) => m.splitName)).toEqual(["Kilgore P. · A", "Kilgore P. · B"]);
    expect(r.parcels.map((p) => p.id)).toEqual(r.made.map((m) => m.id));
    expect(r.removeIds).toEqual(["k"]);
    expect(Math.abs(total(r.parcels) - before)).toBeLessThan(1e-9);
  });
  it("pieces inherit the original's include state — splitting an excluded parcel never changes the total", () => {
    const ps = [mk("x", 0, 0), mk("k", 100, 0, 100, 100, { active: false })];
    const before = total(ps);
    const r = S(ps, [{ x: 150, y: -10 }, { x: 150, y: 110 }], { targetId: "k" });
    expect(r.made.every((m) => m.active === false)).toBe(true);
    expect(Math.abs(total(r.parcels) - before)).toBeLessThan(1e-9);
  });
  it("aims at the target parcel only; the bare tool tries the selected one first", () => {
    const ps = strip();
    const miss = S(ps, cutDown, { targetId: "b" });                         // the cut is over parcel a, not b
    expect(miss.ok).toBe(false);
    expect(S(ps, cutDown, { selId: "a" }).parent.id).toBe("a");
    expect(S(ps, cutDown).parent.id).toBe("a");
  });
  it("rejects a line that does not cross edge to edge, in plain words, and changes nothing", () => {
    const r = S(strip(), [{ x: 20, y: 20 }, { x: 40, y: 40 }]);
    expect(r.ok).toBe(false);
    expect(typeof r.message).toBe("string");
    expect(r.message.length).toBeGreaterThan(10);
  });
  it("splits a locked parcel (same rule as combine); pieces inherit the lock", () => {
    const r = S([mk("k", 0, 0, 100, 100, { locked: true })], cutDown);
    expect(r.ok).toBe(true);
    expect(r.made.every((m) => m.locked === true)).toBe(true);
  });
  it("keeps a save-and-except hole whole on its piece, and REFUSES a cut through it", () => {
    const hole = { pts: rect(10, 10, 20, 20) };
    const ps = [mk("k", 0, 0, 100, 100, { exceptions: [hole] })];
    const before = total(ps);
    const ok = S(ps, [{ x: 60, y: -10 }, { x: 60, y: 110 }]);
    expect(ok.ok).toBe(true);
    expect(ok.made.filter((m) => m.exceptions).length).toBe(1);
    expect(Math.abs(total(ok.parcels) - before)).toBeLessThan(1e-9);
    const bad = S(ps, [{ x: 20, y: -10 }, { x: 20, y: 110 }]);
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("cuts-exception");
  });
  it("floating-point drift: 40 split/restore and combine/restore cycles leave the total exact", () => {
    let ps = [mk("k", 0, 0, 137.31, 91.77), mk("m", 137.31, 0, 50.2, 91.77)];
    const before = total(ps);
    for (let i = 0; i < 40; i++) {
      const sp = S(ps, [{ x: 40.123, y: -10 }, { x: 40.123, y: 200 }], { targetId: ps[0].id });
      expect(sp.ok).toBe(true);
      ps = planRestoreSplit(sp.parcels, sp.made[0].id, { newId }).parcels;
      const cb = C(ps, ps.map((p) => p.id));
      if (cb.ok) ps = planRestoreCombined(cb.parcels, cb.tract.id, { newId }).parcels;
    }
    expect(Math.abs(total(ps) - before)).toBeLessThan(1e-9);
  });
});

describe("restore a split", () => {
  const cutDown = [{ x: 50, y: -10 }, { x: 50, y: 110 }];
  it("brings the original back exactly, from either piece", () => {
    const ps = [mk("k", 0, 0, 100, 100, { label: "Kilgore", acct: "9", locked: false })];
    const sp = S(ps, cutDown);
    const r = planRestoreSplit(sp.parcels, sp.made[1].id, { newId });
    expect(r.ok).toBe(true);
    expect(r.parcels).toHaveLength(1);
    expect(r.restored.label).toBe("Kilgore");
    expect(r.restored.locked).toBe(false);
    expect(r.restored.splitFrom).toBeUndefined();
  });
  it("refuses — loudly — once a piece has been split again, combined or removed", () => {
    const sp = S([mk("k", 0, 0, 100, 100)], cutDown);
    const removed = sp.parcels.filter((p) => p.id !== sp.made[0].id);
    const r = planRestoreSplit(removed, sp.made[1].id, { newId });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("pieces-changed");
  });
  it("chain: combine → split the tract → restore the split → restore the combine", () => {
    const ps = strip();
    const before = total(ps);
    const c = C(ps, ["a", "b"]);
    const sp = S(c.parcels, [{ x: 100, y: -10 }, { x: 100, y: 110 }], { targetId: c.tract.id });
    expect(sp.ok).toBe(true);
    expect(sp.made[0].splitName).toBe("Tract A · A");
    const r1 = planRestoreSplit(sp.parcels, sp.made[0].id, { newId });
    const tract2 = r1.restored;
    expect(tract2.combined.from).toHaveLength(2);                           // the tract's history survived the split
    const r2 = planRestoreCombined(r1.parcels, tract2.id, { newId });
    expect(r2.ok).toBe(true);
    expect(Math.abs(total(r2.parcels) - before)).toBeLessThan(1e-9);
  });
});

describe("migration + display model", () => {
  it("a saved plan is read exactly as before: no flag = included, active:false = excluded; total identical", () => {
    const saved = [mk("a", 0, 0), mk("b", 100, 0, 100, 100, { active: false }), mk("c", 200, 0, 100, 100, { active: true })];
    const rows = buildParcelRows(saved);
    expect(rows.map((r) => r.included)).toEqual([true, false, true]);
    expect(includedAcres(saved)).toBeCloseTo(200 * 100 / SQFT_PER_ACRE, 9);
  });
  it("rows carry what the table needs; long and duplicate names and empty APN survive", () => {
    const long = "A".repeat(300);
    const rows = buildParcelRows([mk("a", 0, 0, 1, 1, { label: long }), mk("b", 5, 0, 1, 1, { label: "Dup" }), mk("c", 9, 0, 1, 1, { label: "Dup" })]);
    expect(rows[0].name).toBe(long);
    expect(rows[1].apn).toBeNull();
    expect(rows.map((r) => r.acres >= 0).every(Boolean)).toBe(true);
  });
  it("deed acres summed is blank (null) unless every original states one", () => {
    const c = C([mk("a", 0, 0, 100, 100, { statedAcres: 2 }), mk("b", 100, 0, 100, 100, { statedAcres: 3 })], ["a", "b"]);
    expect(deedAcresSummed(c.tract)).toBe(5);
    const d = C([mk("a", 0, 0), mk("b", 100, 0, 100, 100, { statedAcres: 3 })], ["a", "b"]);
    expect(deedAcresSummed(d.tract)).toBeNull();
  });
});
