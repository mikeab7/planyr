import { describe, it, expect } from "vitest";
import { createTrailingWriter } from "../src/workspaces/site-planner/lib/trailingWrite.js";

describe("createTrailingWriter surfaces a failed commit (audit B2 item 3)", () => {
  it("flush() resolves { ok:false } and calls onError instead of looking like success", async () => {
    const seen = [];
    const w = createTrailingWriter(async () => { throw new Error("boom"); }, 400, undefined, (e, batch) => seen.push([e.message, batch]));
    w.push({ a: 1 });
    const r = await w.flush();
    expect(r.ok).toBe(false);
    expect(seen).toEqual([["boom", [{ a: 1 }]]]);
  });
  it("a later batch still runs after a failed one", async () => {
    let n = 0;
    const w = createTrailingWriter(async () => { n++; if (n === 1) throw new Error("x"); }, 400, undefined, () => {});
    w.push(1); await w.flush(); w.push(2);
    expect((await w.flush()).ok).toBe(true);
  });
});
