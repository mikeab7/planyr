/* NEW-4 — county ROUTING KEYS normalise on every read and every write.
 *
 * The production repro this pins: 38 rows of `public.sites` stored `"harris"` and 2 stored
 * `"Harris"`. Every county-scoped lookup in the app is a raw object key, so those two rows
 * resolved to NOTHING — silently, because a missing key is `undefined` and every call site has a
 * `|| fallback` that made the miss look like a deliberate answer.
 *
 * The brief's acceptance test is the last describe block: "a mixed-case county key still resolves
 * its source set". It is asserted against the REAL config maps, not a fixture, because the bug was
 * never in the normaliser — it was in the maps not using one. */
import { describe, it, expect } from "vitest";
import { normCountyKey, countyLookup, sameCounty, byCountyKey, countyKeySet } from "../src/shared/gis/countyKeys.js";
import { COUNTIES, COUNTIES_MAP, JURISDICTION_LAYERS, SNAPSHOT_COUNTIES, statewideFallbackFor, stateForCountyKey } from "../src/workspaces/site-planner/lib/counties.js";
import { defaultJurForCounty } from "../src/workspaces/site-planner/lib/easementRules.js";
import { defaultFloodJurForCounty } from "../src/workspaces/site-planner/lib/floodplainRules.js";
import { floodArchiveName, floodArchiveUrl, hasFloodTiles } from "../src/shared/gis/floodTiles.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { siteRowFor } from "../src/workspaces/site-planner/lib/cloudSync.js";

describe("normCountyKey", () => {
  it("lower-cases and trims", () => {
    expect(normCountyKey("Harris")).toBe("harris");
    expect(normCountyKey("  HARRIS  ")).toBe("harris");
  });
  it("keeps the Colorado state prefix intact", () => {
    // The trap: floodGroup.countyKey strips non-letters and would turn this into "colarimer",
    // a key that exists nowhere. These are two different vocabularies — see countyKeys.js.
    expect(normCountyKey("CO_Larimer")).toBe("co_larimer");
    expect(normCountyKey(" co_larimer ")).toBe("co_larimer");
  });
  it("runs a two-word county together, because that is how this app keys them", () => {
    // `fort_bend` is a key that exists NOWHERE — turning the space into an underscore would
    // reintroduce the exact silent miss this module closes.
    expect(normCountyKey("Fort Bend")).toBe("fortbend");
    expect(normCountyKey("San Jacinto")).toBe("sanjacinto");
  });
  it("collapses repeated and edge underscores", () => {
    expect(normCountyKey("_co__larimer_")).toBe("co_larimer");
  });
  it("returns null for nothing, so 'no county' is distinguishable from 'unknown county'", () => {
    for (const v of [null, undefined, "", "   ", "___"]) expect(normCountyKey(v)).toBeNull();
  });
  it("is idempotent", () => {
    for (const v of ["Harris", "co_larimer", " Fort_Bend "]) {
      expect(normCountyKey(normCountyKey(v))).toBe(normCountyKey(v));
    }
  });
});

describe("countyLookup / sameCounty", () => {
  const map = { harris: "coh", co_larimer: "larimer" };
  it("resolves a mixed-case key", () => expect(countyLookup(map, "Harris")).toBe("coh"));
  it("returns the fallback for an unknown key", () => expect(countyLookup(map, "Bexar", "x")).toBe("x"));
  it("returns the fallback for a null key", () => expect(countyLookup(map, null, "x")).toBe("x"));
  it("never reaches inherited properties", () => expect(countyLookup(map, "toString")).toBeUndefined());
  it("sameCounty ignores spelling", () => {
    expect(sameCounty("Harris", "harris")).toBe(true);
    expect(sameCounty("harris", "waller")).toBe(false);
    expect(sameCounty(null, null)).toBe(false); // "no county" is not the same county as "no county"
  });
});

describe("byCountyKey", () => {
  const wrapped = byCountyKey({ harris: 1, co_larimer: 2 });
  it("answers a mixed-case key", () => expect(wrapped.Harris).toBe(1));
  it("answers an exact key unchanged", () => expect(wrapped.harris).toBe(1));
  it("is undefined for an unknown county", () => expect(wrapped.bexar).toBeUndefined());
  it("keeps `in` consistent with `get`", () => {
    expect("Harris" in wrapped).toBe(true);
    expect("bexar" in wrapped).toBe(false);
  });
  it("does not change enumeration", () => {
    expect(Object.keys(wrapped)).toEqual(["harris", "co_larimer"]);
    expect(Object.entries(wrapped).length).toBe(2);
  });
  it("does not invent an entry for a non-county property", () => {
    expect(wrapped.hasOwnProperty).toBe(Object.prototype.hasOwnProperty);
  });
});

describe("countyKeySet", () => {
  const s = countyKeySet(["chambers", "waller"]);
  it("answers a mixed-case member", () => expect(s.has("Waller")).toBe(true));
  it("stays honest about a non-member", () => expect(s.has("Harris")).toBe(false));
});

/* ---------------------------------------------------------------------------
 * THE ACCEPTANCE TEST — a mixed-case county key resolves the same source set as the
 * canonical spelling, everywhere a county is a key.
 * ------------------------------------------------------------------------- */
describe("a mixed-case county key still resolves its source set", () => {
  const PAIRS = [["Harris", "harris"], ["  harris ", "harris"], ["CO_Larimer", "co_larimer"]];

  for (const [messy, clean] of PAIRS) {
    it(`COUNTIES / COUNTIES_MAP resolve ${JSON.stringify(messy)}`, () => {
      expect(COUNTIES[messy]).toBe(COUNTIES[clean]);
      expect(COUNTIES_MAP[messy]).toBe(COUNTIES_MAP[clean]);
      expect(COUNTIES_MAP[messy]).toBeTruthy();
    });
    it(`statewideFallbackFor resolves ${JSON.stringify(messy)}`, () => {
      expect(statewideFallbackFor(messy)).toEqual(statewideFallbackFor(clean));
    });
    it(`stateForCountyKey resolves ${JSON.stringify(messy)}`, () => {
      expect(stateForCountyKey(messy)).toBe(stateForCountyKey(clean));
      expect(stateForCountyKey(messy)).toBeTruthy();
    });
  }

  it("the easement jurisdiction no longer falls through to generic on 'Harris'", () => {
    // This is the exact silent miss: pre-fix, `defaultJurForCounty("Harris")` returned "generic".
    expect(defaultJurForCounty("Harris")).toBe("coh");
    expect(defaultJurForCounty("Harris")).toBe(defaultJurForCounty("harris"));
  });

  it("the floodplain jurisdiction resolves either spelling", () => {
    expect(defaultFloodJurForCounty("Harris")).toBe("harris");
    expect(defaultFloodJurForCounty(" Fort Bend ")).toBe("fortbend");
  });

  it("JURISDICTION_LAYERS resolves either spelling", () => {
    expect(JURISDICTION_LAYERS.Harris).toBe(JURISDICTION_LAYERS.harris);
  });

  it("the snapshot counties resolve either spelling", () => {
    expect(SNAPSHOT_COUNTIES.has("Waller")).toBe(true);
  });

  it("the baked flood archive resolves either spelling — the newest county-keyed consumer", () => {
    expect(floodArchiveName("Harris")).toBe("flood-tx-harris.pmtiles");
    expect(floodArchiveUrl("CO_Larimer")).toBe("/flood/flood-co-larimer.pmtiles");
    expect(hasFloodTiles("Harris")).toBe(true);
  });
});

describe("the write side normalises too, so no new mixed-case row is created", () => {
  it("createSiteModel normalises the model's county", () => {
    expect(createSiteModel({ id: "a", county: "Harris" }).county).toBe("harris");
    expect(createSiteModel({ id: "a", county: "  CO_Larimer " }).county).toBe("co_larimer");
  });
  it("createSiteModel keeps 'no county' as null rather than an empty string", () => {
    expect(createSiteModel({ id: "a" }).county).toBeNull();
    expect(createSiteModel({ id: "a", county: "  " }).county).toBeNull();
  });
  it("the cloud row's county column is normalised", () => {
    expect(siteRowFor({ id: "a", county: "Harris", updatedAt: 1 }).county).toBe("harris");
    expect(siteRowFor({ id: "a", county: null, updatedAt: 1 }).county).toBeNull();
  });
});
