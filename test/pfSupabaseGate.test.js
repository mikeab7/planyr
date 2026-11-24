/* Audit M2 — window.pfSupabase answers only when armed (?planyrDiag=1, planyr:diag session key, __PLANYR_E2E) or under automation. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pfSupabaseExposed } from "../src/shared/supabase/client.js";

const win = (over = {}) => ({ location: { search: "", hash: "" }, navigator: {}, ...over });
describe("pfSupabaseExposed", () => {
  it("is off for an ordinary production tab", () => { expect(pfSupabaseExposed(win())).toBe(false); });
  it("is on with ?planyrDiag=1", () => { expect(pfSupabaseExposed(win({ location: { search: "?planyrDiag=1", hash: "" } }))).toBe(true); });
  it("is on with the latched session key", () => { expect(pfSupabaseExposed(win({ sessionStorage: { getItem: (k) => (k === "planyr:diag" ? "1" : null) } }))).toBe(true); });
  it("is on under automation", () => { expect(pfSupabaseExposed(win({ navigator: { webdriver: true } }))).toBe(true); });
  it("is off with no window", () => { expect(pfSupabaseExposed(undefined)).toBe(false); });
});
describe("nothing in src/ reads it", () => {
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(n) ? [p] : []; });
  it("no production file reads window.pfSupabase", () => {
    const bad = walk("src").filter((f) => !f.endsWith("supabase/client.js")).filter((f) => /window\.pfSupabase(?!\s*\))/.test(readFileSync(f, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")));
    expect(bad).toEqual([]);
  });
});
