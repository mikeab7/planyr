import { describe, it, expect, beforeEach } from "vitest";
import { registerFlush, flushAll, _flushers } from "../src/app/flushRegistry.js";
import { reloadFresh } from "../src/app/chunkReload.js";

// B452 — a forced reload must give every live workspace one last synchronous chance to
// flush (local save + keepalive cloud push) before the navigation strands the last edits.
describe("flushRegistry (B452)", () => {
  beforeEach(() => _flushers.clear());

  it("runs every registered flusher on flushAll, in registration order", () => {
    const calls = [];
    registerFlush(() => calls.push("a"));
    registerFlush(() => calls.push("b"));
    flushAll();
    expect(calls).toEqual(["a", "b"]);
  });

  it("unregister stops a flusher from firing", () => {
    const calls = [];
    const off = registerFlush(() => calls.push("a"));
    off();
    flushAll();
    expect(calls).toEqual([]);
  });

  it("a throwing flusher never blocks the others (or the reload)", () => {
    const calls = [];
    registerFlush(() => { throw new Error("boom"); });
    registerFlush(() => calls.push("ran-anyway"));
    expect(() => flushAll()).not.toThrow();
    expect(calls).toEqual(["ran-anyway"]);
  });

  it("ignores a non-function registration and returns a safe unregister", () => {
    expect(() => registerFlush(null)()).not.toThrow();
    expect(_flushers.size).toBe(0);
  });

  it("reloadFresh flushes BEFORE it navigates away", () => {
    const order = [];
    registerFlush(() => order.push("flush"));
    const win = { location: { href: "https://planyr.io/", replace: () => order.push("navigate"), reload: () => order.push("navigate") } };
    reloadFresh(win);
    expect(order).toEqual(["flush", "navigate"]);
  });
});
