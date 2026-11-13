import { describe, it, expect, beforeEach } from "vitest";
import { createHistoryStack } from "../src/workspaces/site-planner/lib/history.js";
import {
  CARRY_LIMITS, hashString, carryKeyOf, graftOverlaySrc,
  stashMemory, takeMemory, clearMemory, memoryPlanCount,
  encodeCarry, decodeCarry, persistDisk, loadDisk,
} from "../src/workspaces/site-planner/lib/historyCarry.js";

/* NEW-1 (2026-11-13) — undo history that survives leaving a plan. The pure rules; the real remount boundary
 * is exercised by e2e/undo-survives-leaving-plan.spec.js. */

const keyOf = (s) => JSON.stringify({ e: s.els, o: (s.sheetOverlays || []).map((x) => `${x.id}:${x.src ? x.src.length : 0}`) });
const snap = (n, extra = {}) => ({ els: [{ id: "b1", cx: n }], parcels: [], markups: [], sheetOverlays: [], ...extra });

const fakeIo = () => {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); return true; }, del: async (k) => { m.delete(k); return true; } };
};

beforeEach(() => clearMemory());

describe("history.adopt / isEmpty", () => {
  it("seeds an empty stack, so the carried steps undo and redo like any others", () => {
    const h = createHistoryStack({ keyOf });
    expect(h.isEmpty()).toBe(true);
    expect(h.adopt([snap(0), snap(1)], [snap(9)])).toBe(true);
    expect(h.canRedo()).toBe(true);
    expect(h.undo(snap(2)).els[0].cx).toBe(1);
    expect(h.undo(snap(1)).els[0].cx).toBe(0);
  });
  it("refuses a stack someone already edited (never splices older steps UNDER newer ones)", () => {
    const h = createHistoryStack({ keyOf });
    h.push(snap(5));
    expect(h.adopt([snap(0)], [])).toBe(false);
    expect(h.snapshotStacks().past).toHaveLength(1);
  });
  it("respects the stack's own cap, dropping the oldest", () => {
    const h = createHistoryStack({ keyOf, limit: 3 });
    h.adopt([snap(0), snap(1), snap(2), snap(3), snap(4)]);
    expect(h.snapshotStacks().past.map((s) => s.els[0].cx)).toEqual([2, 3, 4]);
  });
});

describe("the in-memory vault (plan switches)", () => {
  it("is per account and per plan: plan B can only ever take plan B's frames", () => {
    stashMemory("u1", "planA", { past: [snap(1)], future: [], baseKey: "k" });
    expect(takeMemory("u1", "planB")).toBeNull();
    expect(takeMemory("u2", "planA")).toBeNull();
    expect(takeMemory("u1", "planA").past).toHaveLength(1);
    expect(takeMemory("u1", "planA")).toBeNull();            // taken once — the new mount re-stashes on leaving
  });
  it("keeps only the most recently used plans (oldest dropped first)", () => {
    for (let i = 0; i < CARRY_LIMITS.MEM_PLANS + 3; i++) stashMemory("u", `p${i}`, { past: [snap(i)], future: [], baseKey: "k" });
    expect(memoryPlanCount()).toBe(CARRY_LIMITS.MEM_PLANS);
    expect(takeMemory("u", "p0")).toBeNull();
    expect(takeMemory("u", `p${CARRY_LIMITS.MEM_PLANS + 2}`)).not.toBeNull();
  });
  it("stashing an empty history clears the plan's entry", () => {
    stashMemory("u", "p", { past: [snap(1)], future: [], baseKey: "k" });
    stashMemory("u", "p", { past: [], future: [], baseKey: "k" });
    expect(takeMemory("u", "p")).toBeNull();
  });
});

describe("the stale-history key", () => {
  it("is equal for the same plan and different once the plan changed", () => {
    expect(carryKeyOf(snap(1), keyOf)).toBe(carryKeyOf(snap(1), keyOf));
    expect(carryKeyOf(snap(1), keyOf)).not.toBe(carryKeyOf(snap(2), keyOf));
  });
  it("ignores an overlay's runtime raster so a reload does not make an identical plan look changed", () => {
    const a = snap(1, { sheetOverlays: [{ id: "o1", src: "blob:aaaaaaaa" }] });
    const b = snap(1, { sheetOverlays: [{ id: "o1" }] });
    expect(carryKeyOf(a, keyOf)).toBe(carryKeyOf(b, keyOf));
  });
  it("hashString separates near-identical long strings", () => {
    const base = "x".repeat(5000);
    expect(hashString(base)).not.toBe(hashString(base + "y"));
    expect(hashString(base)).toBe(hashString(base));
  });
});

describe("disk encoding", () => {
  const frames = () => {
    const els = [{ id: "b1", cx: 1 }], big = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, pts: [0, 1, 2, 3, 4, 5] }));
    return [
      { els: [{ id: "b1", cx: 0 }], markups: big, sheetOverlays: [{ id: "o1", src: "data:image/png;base64,AAAA" }], origin: null },
      { els, markups: big, sheetOverlays: [{ id: "o1", src: "data:image/png;base64,AAAA" }], origin: null },
      { els: [{ id: "b1", cx: 2 }], markups: big, sheetOverlays: [{ id: "o1", src: "data:image/png;base64,AAAA" }], origin: { lat: 1, lon: 2 } },
    ];
  };
  it("round-trips the frames and NEVER writes an overlay raster", () => {
    const text = encodeCarry({ past: frames(), baseKey: "bk" });
    expect(text).not.toContain("base64");
    const d = decodeCarry(text);
    expect(d.baseKey).toBe("bk");
    expect(d.past.map((f) => f.els[0].cx)).toEqual([0, 1, 2]);
    expect(d.past[2].origin).toEqual({ lat: 1, lon: 2 });
    expect(d.past[0].sheetOverlays[0]).toEqual({ id: "o1" });
  });
  it("writes a collection shared by several steps ONCE", () => {
    const f = frames();
    const text = encodeCarry({ past: f, baseKey: "bk" });
    const marker = '"m49"';
    expect(text.split(marker).length - 1).toBe(1);
  });
  it("keeps the NEWEST steps when the byte cap bites, and writes nothing if even one step is over", () => {
    // distinct collections per step (nothing shared), so each older step costs about as much as the newest
    const f = [0, 1, 2].map((i) => ({ els: [{ id: "b1", cx: i }], markups: Array.from({ length: 50 }, (_, j) => ({ id: `m${i}-${j}`, pts: [0, 1, 2, 3, 4, 5] })) }));
    const one = encodeCarry({ past: f.slice(2), baseKey: "bk" }).length;
    const text = encodeCarry({ past: f, baseKey: "bk", maxChars: one + 200 });
    const d = decodeCarry(text);
    expect(d.past.map((x) => x.els[0].cx)).toEqual([2]);
    expect(encodeCarry({ past: f, baseKey: "bk", maxChars: 10 })).toBeNull();
  });
  it("keeps at most DISK_STEPS steps", () => {
    const past = Array.from({ length: 40 }, (_, i) => snap(i));
    expect(decodeCarry(encodeCarry({ past, baseKey: "k" })).past).toHaveLength(CARRY_LIMITS.DISK_STEPS);
  });
  it("treats garbage as no history, never an error", () => {
    expect(decodeCarry("not json")).toBeNull();
    expect(decodeCarry(JSON.stringify({ v: 2 }))).toBeNull();
    expect(decodeCarry(JSON.stringify({ v: 1, pool: [], frames: [{ els: 3 }], baseKey: "k" }))).toBeNull();
    expect(decodeCarry(null)).toBeNull();
  });
});

describe("the disk tail (IndexedDB) round trip", () => {
  it("saves per plan, reads back, and a plan with no steps clears its entry", async () => {
    const io = fakeIo();
    expect(await persistDisk(io, "u", "A", { past: [snap(1), snap(2)], baseKey: "bk" })).toBe(true);
    expect((await loadDisk(io, "u", "A")).past).toHaveLength(2);
    expect(await loadDisk(io, "u", "B")).toBeNull();                 // another plan's key is never read
    expect(await loadDisk(io, "v", "A")).toBeNull();                 // nor another account's
    await persistDisk(io, "u", "A", { past: [], baseKey: "bk" });
    expect(await loadDisk(io, "u", "A")).toBeNull();
  });
  it("keeps only the most recently saved plans on disk", async () => {
    const io = fakeIo();
    for (let i = 0; i < CARRY_LIMITS.DISK_PLANS + 2; i++) await persistDisk(io, "u", `p${i}`, { past: [snap(i)], baseKey: "k", now: 1000 + i });
    expect(await loadDisk(io, "u", "p0", 2000)).toBeNull();
    expect(await loadDisk(io, "u", `p${CARRY_LIMITS.DISK_PLANS + 1}`, 2000)).not.toBeNull();
  });
  it("a tail older than the age cap is not used", async () => {
    const io = fakeIo();
    await persistDisk(io, "u", "A", { past: [snap(1)], baseKey: "k", now: 1000 });
    expect(await loadDisk(io, "u", "A", 1000 + CARRY_LIMITS.DISK_MAX_AGE_MS + 1)).toBeNull();
    expect(await loadDisk(io, "u", "A", 2000)).not.toBeNull();
  });
  it("a failed or throwing store is silent: no throw, just no history", async () => {
    const dead = { get: async () => { throw new Error("quota"); }, put: async () => { throw new Error("full"); }, del: async () => { throw new Error("x"); } };
    expect(await persistDisk(dead, "u", "A", { past: [snap(1)], baseKey: "k" })).toBe(false);
    expect(await loadDisk(dead, "u", "A")).toBeNull();
    const refuses = { get: async () => null, put: async () => false, del: async () => true };
    expect(await persistDisk(refuses, "u", "A", { past: [snap(1)], baseKey: "k" })).toBe(false);
  });
});

describe("graftOverlaySrc", () => {
  it("puts the live raster back on a carried frame that has none, by overlay id", () => {
    const frame = snap(1, { sheetOverlays: [{ id: "o1" }, { id: "gone" }] });
    const out = graftOverlaySrc(frame, [{ id: "o1", src: "blob:live" }]);
    expect(out.sheetOverlays[0].src).toBe("blob:live");
    expect(out.sheetOverlays[1].src).toBeUndefined();
  });
  it("returns the SAME frame when there is nothing to graft", () => {
    const frame = snap(1, { sheetOverlays: [{ id: "o1", src: "blob:own" }] });
    expect(graftOverlaySrc(frame, [{ id: "o1", src: "blob:live" }])).toBe(frame);
    const none = snap(1);
    expect(graftOverlaySrc(none, [])).toBe(none);
  });
});
