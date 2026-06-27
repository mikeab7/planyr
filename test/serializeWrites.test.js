import { describe, it, expect } from "vitest";
import { makeWriteSerializer } from "../src/shared/cloud/serializeWrites.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("makeWriteSerializer (B528/B529) — per-key write serialization", () => {
  it("runs same-key tasks strictly in submission order", async () => {
    const serialize = makeWriteSerializer();
    const order = [];
    const task = (n, delay) => () => tick(delay).then(() => { order.push(n); return n; });
    // Submit 1 (slow), 2 (fast), 3 (medium) on the SAME key: must complete 1→2→3 despite delays.
    const ps = [serialize("k", task(1, 30)), serialize("k", task(2, 1)), serialize("k", task(3, 10))];
    const results = await Promise.all(ps);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("does NOT block across different keys (independent chains)", async () => {
    const serialize = makeWriteSerializer();
    const order = [];
    // A slow task on key a must not delay a fast task on key b.
    const a = serialize("a", () => tick(40).then(() => order.push("a")));
    const b = serialize("b", () => tick(1).then(() => order.push("b")));
    await Promise.all([a, b]);
    expect(order).toEqual(["b", "a"]); // b finished first — keys are independent
  });

  it("returns each task's own resolved value", async () => {
    const serialize = makeWriteSerializer();
    const r1 = await serialize("k", async () => ({ ok: true, version: 7 }));
    expect(r1).toEqual({ ok: true, version: 7 });
  });

  it("isolates a rejecting task: the next same-key task still runs, and the rejection reaches its caller", async () => {
    const serialize = makeWriteSerializer();
    const ran = [];
    const bad = serialize("k", async () => { ran.push("bad"); throw new Error("boom"); });
    const good = serialize("k", async () => { ran.push("good"); return "ok"; });
    await expect(bad).rejects.toThrow("boom");      // the failing task's rejection propagates
    await expect(good).resolves.toBe("ok");         // and the chain survived it
    expect(ran).toEqual(["bad", "good"]);
  });

  it("FIX MODEL: serialized same-id writes don't false-conflict against a shared version (the B528/B529 bug)", async () => {
    // Model the optimistic-concurrency guard: the 'server' accepts a write only if the submitted
    // expected version still matches; on success it bumps. The client tracks the last version it synced.
    let stored = 0;          // server's current version
    let last = 0;            // client's last-synced version (threaded back on success)
    const serverWrite = async (expected) => {
      await tick(5);                                  // network latency
      if (stored !== expected) return { ok: false, conflict: true };
      stored += 1;
      return { ok: true, version: stored };
    };
    const serialize = makeWriteSerializer();
    const doWrite = () => serialize("site-1", async () => {
      const r = await serverWrite(last);             // reads `last` at EXECUTION time
      if (r.ok) last = r.version;                     // thread the new version back
      return r;
    });

    // Two near-simultaneous writes for the SAME id (debounce + flush). Serialized → both succeed.
    const [a, b] = await Promise.all([doWrite(), doWrite()]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);                          // would be {conflict:true} without serialization
    expect(stored).toBe(2);
    expect(last).toBe(2);

    // Sanity: WITHOUT serialization the same two writes DO collide (proves the test models the bug).
    stored = 0; last = 0;
    const naive = async () => { const r = await serverWrite(last); if (r.ok) last = r.version; return r; };
    const [na, nb] = await Promise.all([naive(), naive()]);
    expect(na.ok && nb.ok).toBe(false);              // one of them false-conflicts
  });

  it("a genuine stale version (advanced by ANOTHER writer) still conflicts — the guard is not weakened", async () => {
    let stored = 5;
    const serialize = makeWriteSerializer();
    // The client's tracked version is stale (a different device already moved the row to 6).
    const r = await serialize("x", async () => {
      const expected = 4;                            // stale on purpose
      await tick(1);
      return stored === expected ? { ok: true } : { ok: false, conflict: true };
    });
    expect(r).toEqual({ ok: false, conflict: true }); // serialization does NOT mask a real conflict
  });
});
