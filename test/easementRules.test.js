import { describe, it, expect } from "vitest";
import { defaultJurForCounty, DEFAULT_EASEMENT_RULES } from "../src/workspaces/site-planner/lib/easementRules.js";

// ⛔ B877440 — a county with no easement-width record on file must resolve to `null` ("no
// criteria on file"), never the silent "generic" placeholder (20 ft, the same width City of
// Houston carries) — that silent substitution is exactly what let a Tarrant/Dallas/Amarillo plan
// render a fabricated Houston-derived number as though it were real. "generic" stays reachable
// ONLY via an explicit pick from the jurisdiction selector, which still resolves correctly.
describe("easementRules.defaultJurForCounty — no silent Houston default", () => {
  it("maps the two modeled counties to their real jurisdiction keys", () => {
    expect(defaultJurForCounty("harris")).toBe("coh");
    expect(defaultJurForCounty("Fort Bend")).toBe("fortbend");
  });
  it("returns null (never 'generic') for a county with no easement record", () => {
    expect(defaultJurForCounty("chambers")).toBe(null);
    expect(defaultJurForCounty("waller")).toBe(null);
    expect(defaultJurForCounty("tarrant")).toBe(null);
    expect(defaultJurForCounty("dallas")).toBe(null);
    expect(defaultJurForCounty("potter")).toBe(null); // Amarillo
  });
  it("returns null for an unresolved/blank county — never a hardcoded Harris/Houston fallback", () => {
    expect(defaultJurForCounty(null)).toBe(null);
    expect(defaultJurForCounty(undefined)).toBe(null);
    expect(defaultJurForCounty("")).toBe(null);
  });
  it("'generic' is still a real, selectable row (an explicit user pick keeps working)", () => {
    expect(DEFAULT_EASEMENT_RULES.generic).toBeTruthy();
    expect(DEFAULT_EASEMENT_RULES.generic.waterWidth).toBe(20);
  });
});
