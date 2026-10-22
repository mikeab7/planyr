import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WideTileEngine, BACKOFF_MS } from "../src/workspaces/site-planner/lib/parcelWideEngine.js";

const T = (n) => ({ key: `wide:15/${n}/0`, x: n, y: 0, b: 15, stage: "wide" });
const tiles = (n) => Array.from({ length: n }, (_, i) => T(i));

/* A fetchTile whose answers the test controls: every call is recorded; `answer(i, result)` completes call i; abort is recorded. */
function rig(opts = {}) {
  const calls = [];
  const fetchTile = (job, cb) => { const c = { job, cb, aborted: false }; calls.push(c); return { abort() { c.aborted = true; } }; };
  const loaded = [], states = [];
  const engine = new WideTileEngine({ fetchTile, onTile: (k, e) => loaded.push([k, e]), onState: (s) => states.push(s), ...opts });
  return { engine, calls, loaded, states, answer: (i, r) => calls[i].cb(r) };
}
const OK = (n = 3) => ({ ok: true, features: Array.from({ length: n }, (_, i) => ({ id: i })), exceeded: false });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe("no requests while the view is moving (debounce)", () => {
  it("sends NOTHING until the view has been still for the debounce, however many times it changes", () => {
    const r = rig();
    for (let i = 0; i < 20; i++) { r.engine.setView({ tiles: tiles(2) }); vi.advanceTimersByTime(100); }
    expect(r.calls.length).toBe(0);
    vi.advanceTimersByTime(300);
    expect(r.calls.length).toBe(2);
  });
  it("only the LAST view's tiles are requested", () => {
    const r = rig();
    r.engine.setView({ tiles: [T(1), T(2)] });
    vi.advanceTimersByTime(100);
    r.engine.setView({ tiles: [T(7)] });
    vi.advanceTimersByTime(400);
    expect(r.calls.map((c) => c.job.tile.key)).toEqual(["wide:15/7/0"]);
  });
});

describe("cancel what left the view", () => {
  it("aborts an in-flight tile that is no longer wanted, and keeps the ones that still are", () => {
    const r = rig();
    r.engine.setView({ tiles: [T(1), T(2), T(3)] }); vi.advanceTimersByTime(300);
    expect(r.calls.length).toBe(3);
    r.engine.setView({ tiles: [T(3), T(4)] }); vi.advanceTimersByTime(300);
    expect(r.calls.filter((c) => c.aborted).map((c) => c.job.tile.key).sort()).toEqual(["wide:15/1/0", "wide:15/2/0"]);
    expect(r.calls.find((c) => c.job.tile.key === "wide:15/3/0").aborted).toBe(false);
    expect(r.engine.stats.aborted).toBe(2);
  });
  it("leaving the stage (setView(null)) cancels everything at once, with no debounce", () => {
    const r = rig();
    r.engine.setView({ tiles: tiles(3) }); vi.advanceTimersByTime(300);
    r.engine.setView(null);
    expect(r.calls.every((c) => c.aborted)).toBe(true);
  });
  it("a late answer for an aborted tile is ignored", () => {
    const r = rig();
    r.engine.setView({ tiles: [T(1)] }); vi.advanceTimersByTime(300);
    r.engine.setView(null);
    r.answer(0, OK());
    expect(r.loaded.length).toBe(0);
  });
});

describe("concurrency cap per host", () => {
  it("never has more than maxConcurrent requests in flight; the rest wait for a slot", () => {
    const r = rig({ maxConcurrent: 3 });
    r.engine.setView({ tiles: tiles(8) }); vi.advanceTimersByTime(300);
    expect(r.calls.length).toBe(3);
    r.answer(0, OK());
    expect(r.calls.length).toBe(4);
    r.answer(1, OK()); r.answer(2, OK());
    expect(r.calls.length).toBe(6);
    expect(r.engine.inflight.size).toBeLessThanOrEqual(3);
  });
});

describe("a pan re-uses tiles", () => {
  it("a loaded tile is never requested again", () => {
    const r = rig();
    r.engine.setView({ tiles: [T(1), T(2)] }); vi.advanceTimersByTime(300);
    r.answer(0, OK()); r.answer(1, OK());
    r.engine.setView({ tiles: [T(2), T(3)] }); vi.advanceTimersByTime(300);
    expect(r.calls.map((c) => c.job.tile.key)).toEqual(["wide:15/1/0", "wide:15/2/0", "wide:15/3/0"]);
  });
});

describe("back off on a busy county server", () => {
  it("a 429/503 holds ALL requests for the back-off, retries after it, and says the server is busy", () => {
    const r = rig();
    r.engine.setView({ tiles: tiles(4) }); vi.advanceTimersByTime(300);
    expect(r.calls.length).toBe(3);
    r.answer(0, { ok: false, status: 503, transient: true });
    expect(r.states.at(-1).busy).toBe(true);
    r.answer(1, OK()); // an answer in flight still lands, but no NEW request starts during the back-off
    expect(r.calls.length).toBe(3);
    vi.advanceTimersByTime(BACKOFF_MS[0] - 10);
    expect(r.calls.length).toBe(3);
    vi.advanceTimersByTime(20);
    expect(r.calls.length).toBeGreaterThan(3); // the failed tile / the waiting tile go out again
  });
  it("the back-off grows 2 s → 4 s → 8 s while it keeps failing, and a success clears it", () => {
    const r = rig({ maxConcurrent: 1 });
    r.engine.setView({ tiles: [T(1)] }); vi.advanceTimersByTime(300);
    const stamps = [];
    for (let i = 0; i < 3; i++) {
      r.answer(i, { ok: false, status: 429, transient: true });
      stamps.push(r.engine.blockedUntil - Date.now());
      vi.advanceTimersByTime(BACKOFF_MS[i] + 5);
    }
    expect(stamps).toEqual(BACKOFF_MS.slice(0, 3));
    r.answer(3, OK());
    expect(r.engine.failures).toBe(0);
    expect(r.states.at(-1).busy).toBe(false);
  });
  it("several requests that were in flight together all failing is ONE event: the back-off stays at 2 s, it does not jump to 8 s", () => {
    const r = rig();
    r.engine.setView({ tiles: tiles(3) }); vi.advanceTimersByTime(300);
    r.answer(0, { ok: false, status: 503, transient: true }); r.answer(1, { ok: false, status: 503, transient: true }); r.answer(2, { ok: false, status: 503, transient: true });
    expect(r.engine.blockedUntil - Date.now()).toBe(BACKOFF_MS[0]);
    expect(r.engine.failures).toBe(1);
  });
  it("after maxAttempts a tile is parked (not retried forever) and stays 'busy' until the view next changes", () => {
    const r = rig({ maxConcurrent: 1, maxAttempts: 2 });
    r.engine.setView({ tiles: [T(1)] }); vi.advanceTimersByTime(300);
    r.answer(0, { ok: false, status: 503, transient: true });
    vi.advanceTimersByTime(3000);
    r.answer(1, { ok: false, status: 503, transient: true });
    vi.advanceTimersByTime(60_000);
    expect(r.calls.length).toBe(2);
    expect(r.states.at(-1).busy).toBe(true);
    r.engine.setView({ tiles: [T(1)] }); vi.advanceTimersByTime(300);
    vi.advanceTimersByTime(20_000);
    expect(r.calls.length).toBeGreaterThan(2);
  });
  it("a refusal that is not transient (a 400, an ArcGIS error) is reported once and NOT retried", () => {
    const r = rig();
    r.engine.setView({ tiles: [T(1)] }); vi.advanceTimersByTime(300);
    r.answer(0, { ok: false, status: 400, transient: false, message: "Failed to execute query." });
    vi.advanceTimersByTime(120_000);
    expect(r.calls.length).toBe(1);
    expect(r.states.at(-1).error).toBe("Failed to execute query.");
  });
});

describe("a tile that hit the server's record cap asks again with a tighter size cutoff", () => {
  it("tier 0 → 1 → 2, then stops and marks the tile capped; each partial answer is drawn meanwhile", () => {
    const r = rig();
    r.engine.setView({ tiles: [T(1)] }); vi.advanceTimersByTime(300);
    r.answer(0, { ...OK(2000), exceeded: true });
    expect(r.loaded.length).toBe(1);
    expect(r.calls[1].job.tier).toBe(1);
    r.answer(1, { ...OK(1500), exceeded: true });
    expect(r.calls[2].job.tier).toBe(2);
    r.answer(2, { ...OK(1800), exceeded: true });
    expect(r.calls.length).toBe(3);
    expect(r.engine.loaded.get("wide:15/1/0").capped).toBe(true);
  });
  it("a tile that fits is never re-asked", () => {
    const r = rig();
    r.engine.setView({ tiles: [T(1)] }); vi.advanceTimersByTime(300);
    r.answer(0, OK());
    vi.advanceTimersByTime(10_000);
    expect(r.calls.length).toBe(1);
  });
});

describe("memory", () => {
  it("evicts the oldest tiles that are no longer in view past maxTiles", () => {
    const r = rig({ maxTiles: 3, maxConcurrent: 10 });
    r.engine.setView({ tiles: tiles(3) }); vi.advanceTimersByTime(300);
    r.calls.forEach((c, i) => r.answer(i, OK()));
    r.engine.setView({ tiles: [T(10), T(11)] }); vi.advanceTimersByTime(300);
    r.calls.slice(3).forEach((c, i) => r.answer(i + 3, OK()));
    expect(r.engine.loaded.size).toBeLessThanOrEqual(3);
    expect(r.loaded.some(([, e]) => e === null)).toBe(true);
  });
});

describe("default timers", () => {
  it("work when called as methods in a browser-like global (a bare setTimeout stored on `this` throws 'Illegal invocation')", () => {
    const orig = globalThis.setTimeout;
    globalThis.setTimeout = function (fn, ms) { if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation"); return orig(fn, ms); };
    try {
      const e = new WideTileEngine({ fetchTile: () => ({ abort() {} }) });
      expect(() => e.setView({ tiles: [T(1)] })).not.toThrow();
      e.stop();
    } finally { globalThis.setTimeout = orig; }
  });
});
