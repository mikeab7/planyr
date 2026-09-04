import { describe, it, expect, vi } from "vitest";
import { createWriteSerializer } from "../src/shared/cloud/writeSerializer.js";

// The scenario that produced NEW-18's false "someone else changed this" conflict: two async
// writes for the SAME key fire before the first has settled. Without serialization, both would
// read the same "expected version" and race the real server-side CAS check; with it, the second
// call's body must not even START until the first's has fully resolved.
describe("createWriteSerializer", () => {
  it("runs same-key calls one at a time, in order", async () => {
    const q = createWriteSerializer();
    const order = [];
    const started = [];
    const p1 = q.run("id-1", async () => {
      started.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
      return "a";
    });
    // Fired immediately after p1, before it settles — must NOT start yet.
    const p2 = q.run("id-1", async () => {
      started.push(2);
      order.push(2);
      return "b";
    });
    await Promise.resolve(); // let any already-eligible microtasks flush
    expect(started).toEqual([1]); // call 2's body hasn't run yet — still queued behind call 1
    expect(await p1).toBe("a");
    expect(await p2).toBe("b");
    expect(order).toEqual([1, 2]);
  });

  it("runs different keys concurrently, never blocking one key on another", async () => {
    const q = createWriteSerializer();
    const started = [];
    const p1 = q.run("id-1", async () => {
      started.push("id-1");
      await new Promise((r) => setTimeout(r, 20));
      return 1;
    });
    const p2 = q.run("id-2", async () => {
      started.push("id-2");
      return 2;
    });
    // id-2 must start immediately even though id-1's call is still pending.
    await Promise.resolve();
    expect(started).toContain("id-2");
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
  });

  it("a rejected call never wedges later calls for the same key", async () => {
    const q = createWriteSerializer();
    const fail = q.run("id-1", async () => { throw new Error("boom"); });
    await expect(fail).rejects.toThrow("boom");
    const ok = await q.run("id-1", async () => "recovered");
    expect(ok).toBe("recovered");
  });

  it("preserves call order across many rapid same-key writes (the drag-commit shape)", async () => {
    const q = createWriteSerializer();
    const seen = [];
    const calls = [1, 2, 3, 4, 5].map((n) =>
      q.run("overlay-1", async () => { seen.push(n); return n; })
    );
    const results = await Promise.all(calls);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it("a fn is called with no arguments and its return value flows through", async () => {
    const q = createWriteSerializer();
    const fn = vi.fn().mockResolvedValue(42);
    const result = await q.run("k", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe(42);
  });
});
