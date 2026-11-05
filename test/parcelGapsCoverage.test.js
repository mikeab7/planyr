/* B2486192 — an unsearched county can never silently fall to the default again. Owner, 2026-10-29: "if they weren't searched,
 * then search the counties." South Dakota's 49 researched gaps once sat in NEITHER the table NOR any list, so every one of them
 * read the generic "hasn't found" line and nothing in the build noticed.
 *
 * This test ignores the research doc entirely (test/parcelGapsDoc.test.js owns that agreement) and asks the live registry the
 * question the admin coverage map asks: which counties in public/geo/county-polygons.json does Planyr NOT wire? Each must have a
 * `PARCEL_GAPS` row (a decision, even `none`) or be named in `NEVER_RESEARCHED` (an admitted hole). Same join as
 * src/workspaces/admin/lib/parcelCoverage.js `buildCoverage`. */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import {
  COUNTIES, COUNTIES_MAP, countyKeyForName, statewideKeysForState, isStatewideLayerUrl,
} from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { CITY_SCOPE_COUNTIES } from "../src/workspaces/site-planner/lib/cityScopes.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import { buildCoverage } from "../src/workspaces/admin/lib/parcelCoverage.js";
import { PARCEL_GAPS, NEVER_RESEARCHED, gapKey } from "../src/workspaces/site-planner/lib/parcelGaps.js";

const payload = JSON.parse(fs.readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));

/* The unresearched set: unwired counties with neither a table row nor a NEVER_RESEARCHED entry. Pure, so the red-proof can feed it. */
function unresearchedCounties(unwired, table, never) {
  const nev = new Set(never);
  return unwired.map((r) => gapKey(r.name, r.state)).filter((k) => k && !table[k] && !nev.has(k));
}

let unwired;
beforeAll(async () => {
  await setCountyPolygons(payload);
  const cov = buildCoverage(payload.counties, {
    countiesMap: COUNTIES_MAP, counties: COUNTIES, keyForName: countyKeyForName, statewideKeysForState,
    isStatewideUrl: isStatewideLayerUrl, verification: COUNTY_VERIFICATION, cityScopes: CITY_SCOPE_COUNTIES,
  });
  unwired = cov.rows.filter((r) => !r.wired);
});

describe("every unwired county has a recorded reason or is admitted never-researched (B2486192)", () => {
  it("the join is not vacuous — hundreds of counties are unwired, and South Dakota's are among them", () => {
    expect(unwired.length).toBeGreaterThan(300);
    expect(unwired.filter((r) => r.state === "SD").length).toBe(14); // 49 until the 2026-10-29 second pass wired 35 (District III's server had moved)
  });

  it("no unwired county falls to the default without a row (or a NEVER_RESEARCHED entry)", () => {
    expect(unresearchedCounties(unwired, PARCEL_GAPS, NEVER_RESEARCHED)).toEqual([]);
  });

  it("red-proof: a county in neither place IS reported, and listing it as never-researched clears it", () => {
    const fake = [{ name: "Harding County", state: "SD" }, { name: "Atlantis County", state: "SD" }];
    expect(unresearchedCounties(fake, PARCEL_GAPS, [])).toEqual(["sd_atlantis"]);
    expect(unresearchedCounties(fake, PARCEL_GAPS, ["sd_atlantis"])).toEqual([]);
    expect(unresearchedCounties(fake, {}, [])).toEqual(["sd_harding", "sd_atlantis"]);
  });

  it("NEVER_RESEARCHED overlaps nothing in the table and names only real unwired counties", () => {
    const unwiredKeys = new Set(unwired.map((r) => gapKey(r.name, r.state)));
    expect(NEVER_RESEARCHED.filter((k) => PARCEL_GAPS[k] || !unwiredKeys.has(k))).toEqual([]);
  });
});
