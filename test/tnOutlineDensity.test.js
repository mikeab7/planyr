/* NEW-1/NEW-2 (Tennessee 95-county sweep, 2026-10-22) — the Select-parcels OUTLINE layer asks one request per 512-px cell and does not page, so a cell holding more lots than the
 * server's record cap is silently drawn short (`exceededTransferLimit`, nothing said). The sweep measured every cell of each wired Tennessee source (test/fixtures/tnOutlineDensity.json):
 * Shelby had 18 zoom-16 cells over its 1,000 cap (busiest 1,411) and Hamilton one (1,066) — both drew truncated outlines in town. Their floor is now 17.
 * RED-PROOF: on ff7be38 both floors were 16 and this suite fails for exactly those two sources. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { displayMinZoomOf } from "../src/workspaces/site-planner/lib/counties.js";

const D = JSON.parse(readFileSync(new URL("./fixtures/tnOutlineDensity.json", import.meta.url), "utf8"));
describe("a source's outline floor keeps its busiest cell under the server's record cap", () => {
  for (const [key, s] of Object.entries(D.sources)) {
    it(`${key}: busiest cell at the floor is under ${s.cap}`, () => {
      const floor = Math.max(16, displayMinZoomOf(key));
      const n = s.busiest[String(floor)];
      expect(n, `${key} has no measurement at its floor ${floor}`).toBeTypeOf("number");
      expect(n).toBeLessThan(s.cap);
    });
  }
  it("Shelby and Hamilton draw from zoom 17 (their zoom-16 cells exceed the cap)", () => {
    expect(displayMinZoomOf("tn_shelby")).toBe(17);
    expect(displayMinZoomOf("tn_hamilton")).toBe(17);
    expect(D.sources.tn_shelby.busiest["16"]).toBeGreaterThan(D.sources.tn_shelby.cap);
    expect(D.sources.tn_hamilton.busiest["16"]).toBeGreaterThan(D.sources.tn_hamilton.cap);
  });
});
