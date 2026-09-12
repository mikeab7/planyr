import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { cityScopeAnswer } from "../src/workspaces/site-planner/lib/cityScopes.js";
import {
  COUNTIES, COUNTIES_MAP, countyIdentity, countyForView, candidateCountiesForPoint, noParcelSourceNote,
} from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";

/* B1583296 — Detroit is a CITY-scoped parcel source, wired without renaming it Wayne County
 * (which was correctly rejected — docs/STATEWIDE-PARCELS.md). This suite warms the REAL committed
 * nationwide county-polygon asset (like test/countyStatewideDerivation.test.js), which is exactly
 * what exposes the failure mode this item exists to prevent: once the asset is resident, a Wayne
 * County point resolves a real county name ("Wayne", "MI") for which no source is configured, and
 * `candidateCountiesForPoint`'s blind per-state fallback would otherwise hand out mi_detroit (or
 * any other Michigan entry) to a point far outside its own bbox. Isolated in its own file for the
 * same reason countyStatewideDerivation.test.js is: vitest gives each test file its own module
 * registry, so warming this singleton here cannot bleed into counties.test.js's cold-start
 * contract. */
let payload;
beforeAll(async () => {
  payload = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
  await setCountyPolygons(payload);
});

const DOWNTOWN_DETROIT = [42.3314, -83.0458];
const LIVONIA = [42.3684, -83.3527];   // real Wayne County city, outside Detroit's limits
const TAYLOR = [42.2409, -83.2696];    // real Wayne County city, outside Detroit's limits

describe("cityScopeAnswer — pure geometry (B1583296)", () => {
  it("hits downtown Detroit", () => {
    const ans = cityScopeAnswer(...DOWNTOWN_DETROIT);
    expect(ans).toEqual({ key: "mi_detroit", name: "Detroit", state: "MI", nearEdge: false });
  });

  it("misses Livonia and Taylor — real Wayne County cities outside Detroit's own limits", () => {
    expect(cityScopeAnswer(...LIVONIA)).toBeNull();
    expect(cityScopeAnswer(...TAYLOR)).toBeNull();
  });

  it("misses a point inside the Hamtramck/Highland Park hole — those are independent cities, not Detroit", () => {
    // Roughly the middle of the enclosed hole ring (~42.40, -83.09).
    expect(cityScopeAnswer(42.402, -83.09)).toBeNull();
  });

  it("returns null for non-finite input rather than throwing", () => {
    expect(cityScopeAnswer(NaN, -83.0458)).toBeNull();
    expect(cityScopeAnswer(undefined, undefined)).toBeNull();
  });

  it("is synchronous — no asset to warm, unlike the nationwide county geometry", () => {
    // Calling it before any county-polygon fetch/warm still answers immediately.
    const ans = cityScopeAnswer(...DOWNTOWN_DETROIT);
    expect(ans).not.toBeNull();
  });
});

describe("Detroit wired as a CITY, not as Wayne County (B1583296)", () => {
  it("mi_detroit is a real, distinct entry — never registered as wayne/mi_wayne", () => {
    expect(COUNTIES_MAP.mi_detroit).toBeTruthy();
    expect(COUNTIES.mi_detroit.layerUrl).toMatch(/Detroit_MP_Parcel_Authoritative/);
    expect(COUNTIES_MAP.wayne).toBeUndefined();
    expect(COUNTIES_MAP.mi_wayne).toBeUndefined();
  });

  it("mi_detroit is flagged cityScoped so it never rides the blind per-state fallback", () => {
    expect(COUNTIES_MAP.mi_detroit.cityScoped).toBe(true);
  });

  it("downtown Detroit resolves to mi_detroit via countyIdentity, countyForView and candidateCountiesForPoint", () => {
    expect(countyIdentity(...DOWNTOWN_DETROIT)).toEqual({
      status: "ok", key: "mi_detroit", name: "Detroit", state: "MI", nearEdge: false,
    });
    expect(countyForView(...DOWNTOWN_DETROIT)).toBe("mi_detroit");
    expect(candidateCountiesForPoint(...DOWNTOWN_DETROIT)).toEqual(["mi_detroit"]);
  });

  it("Livonia and Taylor report NO SOURCE — never a query against the Detroit-only layer", () => {
    for (const pt of [LIVONIA, TAYLOR]) {
      const id = countyIdentity(...pt);
      expect(id.status).toBe("no-source");
      expect(id.state).toBe("MI");
      expect(id.key).toBeNull();

      // The whole point of the item: neither point may ever be handed mi_detroit as a candidate
      // to query, at any stage of candidateCountiesForPoint's resolution (bbox match, confident
      // geometry, or the blind per-state fallback).
      expect(candidateCountiesForPoint(...pt)).not.toContain("mi_detroit");
    }
  });

  it("countyForView never names mi_detroit for a point outside Detroit's own limits", () => {
    expect(countyForView(...LIVONIA)).not.toBe("mi_detroit");
    expect(countyForView(...TAYLOR)).not.toBe("mi_detroit");
  });
});

/* ⛔ B1597232 — THE WAYNE→OAKLAND REGRESSION FIXTURE, at the EXACT points measured live from the
 * owner's own browser on the build after the Detroit wiring merged (2026-09-12, just after
 * midnight Central). Same wrong-county class as Casa Grande→Maricopa; opposite branch of it.
 *
 * WHY THE SUITE ABOVE DID NOT CATCH IT, which is the part worth keeping: it asserted
 * `not.toContain("mi_detroit")` — the failure it was written to prevent — and mi_detroit really
 * was absent. `mi_oakland` was there instead, and "does not contain the ONE key I was thinking
 * about" is not the same assertion as "contains nothing that could answer for this point." These
 * fixtures pin the WHOLE list, for both points, so no third Michigan source can slip into it
 * either. (The general rule behind them, and the cases in other states that must keep their
 * answers, are in countyStatewideDerivation.test.js.)
 *
 * Oakland's southern line is 8 Mile Road, ~42.44°N. Taylor is ~15 miles south of it and Livonia
 * ~3; neither is a boundary-precision case, and the resolver reports both as confidently inside
 * Wayne. The two arrived by DIFFERENT paths — Taylor matched no county bbox at all, Livonia fell
 * inside Oakland's padded one — so both are pinned, not just the tidier one. */
describe("a Wayne County point never reaches Oakland County's service (B1597232)", () => {
  // Exactly as measured, transposed from the reported (lng, lat) to this function's (lat, lng).
  const GODDARD_RD_TAYLOR = [42.224770, -83.263421];   // 23555 Goddard Rd, Taylor, MI
  const CIVIC_CENTER_LIVONIA = [42.396293, -83.368074]; // 33000 Civic Center Dr, Livonia, MI
  const WOODWARD_DETROIT = [42.328905, -83.045471];     // 1 Woodward Ave — the working control

  it.each([
    ["23555 Goddard Rd, Taylor (matched no county bbox)", GODDARD_RD_TAYLOR],
    ["33000 Civic Center Dr, Livonia (fell inside Oakland's padded bbox)", CIVIC_CENTER_LIVONIA],
  ])("%s queries NOTHING — not Oakland, not Detroit, not anything", (_label, pt) => {
    expect(candidateCountiesForPoint(...pt)).toEqual([]);
  });

  it.each([
    ["Taylor", GODDARD_RD_TAYLOR],
    ["Livonia", CIVIC_CENTER_LIVONIA],
  ])("%s is reported as a NAMED gap, so the empty list reads as a fact and not as a stall", (_label, pt) => {
    const id = countyIdentity(...pt);
    expect(id.status).toBe("no-source");
    expect(id.name).toBe("Wayne County");
    expect(id.state).toBe("MI");
    // Confidently inside Wayne — not a near-edge point where a wired neighbour may legitimately
    // own the lot, which is the one case that still keeps the old multi-candidate behaviour.
    expect(id.nearEdge).toBe(false);
    expect(noParcelSourceNote(id)).toBe("Wayne County — no parcel data wired here yet.");
  });

  it("THE CONTROL — 1 Woodward Ave still resolves to the Detroit city source ALONE", () => {
    // Verified live the same night: exactly one query, to Detroit_MP_Parcel_Authoritative, which
    // returned a 0.60 AC lot. The Wayne fix must leave this path byte-identical.
    expect(candidateCountiesForPoint(...WOODWARD_DETROIT)).toEqual(["mi_detroit"]);
    expect(countyIdentity(...WOODWARD_DETROIT).key).toBe("mi_detroit");
  });

  it("THE OTHER CONTROL — a real Oakland County point still reaches Oakland's service", () => {
    // The defect was never in Oakland's own wiring (its service is fine and correctly wired for
    // Oakland); it was which points reached it. Pontiac, MI — squarely inside Oakland.
    expect(candidateCountiesForPoint(42.6389, -83.2910)).toEqual(["mi_oakland"]);
  });
});
