import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* B1953795 — the Dashboard consumes src/shared/schedule/healthEngine.js; the embedded Scheduler
 * (public/sequence/index.html, compiled in the browser, cannot import from src/) holds the SAME
 * text between its @shared-engine markers. This is the machine check that keeps them one
 * definition: any edit to one without the other fails here. Fix: edit index.html, then run
 * `node scripts/sync-health-engine.mjs`. */
const html = readFileSync("public/sequence/index.html", "utf8");
const mod = readFileSync("src/shared/schedule/healthEngine.js", "utf8");
const BEGIN = "/* @shared-engine:begin";
const END = "/* @shared-engine:end */";

describe("healthEngine.js ↔ public/sequence/index.html (one rule engine, two homes)", () => {
  it("the marked block exists exactly once in the Scheduler", () => {
    expect(html.split(BEGIN).length).toBe(2);
    expect(html.split(END).length).toBe(2);
  });
  it("the module contains the Scheduler's block VERBATIM", () => {
    const block = html.slice(html.indexOf(BEGIN), html.indexOf(END) + END.length);
    expect(block.length).toBeGreaterThan(5000);
    expect(mod.includes(block)).toBe(true);
  });
  it("the Scheduler's computeDisplayHealth ends on the same completion answer as the module", () => {
    expect(html).toContain('return isCompleteTask(task) ? "green" : task.health;');
    expect(mod).toContain('return isCompleteTask(task) ? "green" : task.health;');
  });
});
