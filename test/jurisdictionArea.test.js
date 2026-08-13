import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { identifyJurisdiction, formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import {
  areaShare, ringsAsPolygons, esriPolygons, pointInRing, pointInPolygons,
  unionAreaSqM, distanceToBoundaryM, southIsLargerY, SQM_PER_ACRE, shareConfidence,
} from "../src/workspaces/site-planner/lib/jurisdictionShare.js";
import { replayAreas, freshCache } from "../ui-audit/lib/shapeReplay.js";

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * NEW-1 / NEW-2 / NEW-3 — THE JURISDICTION ANSWER, MEASURED BY AREA, ON THE OWNER'S OWN GROUND.
 *
 * Every number below was measured live against the agencies' published boundaries on 2026-08-12
 * and recorded into `test/fixtures/jurisdictionAreas.json` by `ui-audit/record-jurisdiction-areas`.
 * ⛔ DO NOT "fix" a number here to make a change pass — they are the ground truth, and two of them
 * are the defects this item exists for:
 *
 *   GRAND PORT (`smqfy2r7pdec`, Chambers County) read "unincorporated Chambers County, no ETJ".
 *   It is neither: 100% inside Baytown's ETJ and 99% inside Baytown LIMITED-PURPOSE ANNEXATION
 *   polygon OID 1344 (`CL-20170711-007`).
 *
 *   GOOSE CREEK (`sms69x8rb2qk`, Harris County) is genuinely split, and the split is an AREA fact:
 *   its southern parcel is 96.7% inside Baytown's FULL-PURPOSE limits, the middle and northern
 *   parcels are 0%, and the site as drawn is ~32% city / 100% ETJ (the owner's own framing: the
 *   bottom third is in the City of Baytown, the upper two-thirds is Baytown ETJ).
 *
 * A CENTROID FIXTURE WOULD PASS ON GRAND PORT WHILE A BOUNDARY SAT INSIDE THE SITE, so there is
 * none: every assertion here is an area fraction or a measured distance.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const FIX = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test/fixtures/jurisdictionAreas.json"), "utf8"));
const site = (name) => FIX.sites.find((s) => s.site === name);

const ringsOf = (rec, { activeOnly = true } = {}) => rec.parcels
  .filter((p) => (activeOnly ? p.active !== "false" : true))
  .map((p) => p.pts.split(",").map((s) => {
    const [x, y] = s.trim().split(" ").map(Number);
    const [lat, lon] = feetToLatLngPair({ x, y }, rec.origin.lat, rec.origin.lon);
    return [lon, lat];
  }));
const parcelRing = (rec, id) => {
  const p = rec.parcels.find((q) => q.id === id);
  if (!p) throw new Error("no such parcel " + id);
  return p.pts.split(",").map((s) => {
    const [x, y] = s.trim().split(" ").map(Number);
    const [lat, lon] = feetToLatLngPair({ x, y }, rec.origin.lat, rec.origin.lon);
    return [lon, lat];
  });
};
const refOf = (rec) => [rec.origin.lon, rec.origin.lat];
const featuresOf = (rec, sourceId, pred = () => true) =>
  (rec.answers[sourceId].features || []).filter((f) => pred(f.attributes));
const polysOf = (rec, sourceId, pred) => featuresOf(rec, sourceId, pred).flatMap((f) => esriPolygons(f.geometry));
const cls = (a) => a.FEATURE || a.NAME || null;
const pct = (subject, clip, ref) => areaShare(subject, clip, ref).share * 100;

async function badgeFor(name, opts = {}) {
  const rec = site(name);
  const rings = ringsOf(rec);
  const j = await identifyJurisdiction(rec.origin.lon, rec.origin.lat, {
    rings, ring: rings[0], roles: ["county", "city", "etj"],
    parcelIds: rec.parcels.filter((p) => p.active !== "false").map((p) => p.id),
    cache: freshCache(), fetchJson: replayAreas(rec, opts),
  });
  return { j, b: formatJurisdictionBadge(j) };
}

describe("NEW-2 — the y-sign comes from the data, never from an assumption", () => {
  /* ⛔ Getting this backwards mirrors every site north-to-south and therefore flips every
   * jurisdiction answer on it, with no error anywhere. It is asserted through the app's OWN
   * projection, not restated as a comment. */
  it("the planner's feet frame is screen-down: a LARGER y is further SOUTH", () => {
    const rec = site("Goose Creek");
    const r = southIsLargerY((pt) => feetToLatLngPair(pt, rec.origin.lat, rec.origin.lon));
    expect(r.southIsLargerY).toBe(true);
    expect(r.latAtLargeY).toBeLessThan(r.latAtSmallY);
  });

  it("Goose Creek's SOUTHERN parcel is the one with the largest y, and it is the one in the city", () => {
    const rec = site("Goose Creek");
    const named = ["e1454746tcmstb", "e1454846quvgmx", "e1454844quvgmx"];
    const avgY = (id) => {
      const pts = rec.parcels.find((p) => p.id === id).pts.split(",").map((s) => s.trim().split(" ").map(Number));
      return pts.reduce((a, [, y]) => a + y, 0) / pts.length;
    };
    const avgLat = (id) => {
      const ring = parcelRing(rec, id);
      return ring.reduce((a, [, lat]) => a + lat, 0) / ring.length;
    };
    const byY = [...named].sort((a, b) => avgY(b) - avgY(a));
    const byLat = [...named].sort((a, b) => avgLat(a) - avgLat(b));
    expect(byY[0]).toBe("e1454746tcmstb");     // largest y
    expect(byLat[0]).toBe("e1454746tcmstb");   // lowest latitude — the same parcel, from the real projection
    expect(byY).toEqual(byLat);
  });
});

describe("NEW-2 — a share is an AREA fraction, and vertex sampling is a different quantity", () => {
  it("Goose Creek's southern parcel: 13 of 24 vertices, 96.7% by area", () => {
    const rec = site("Goose Creek");
    const ring = parcelRing(rec, "e1454746tcmstb");
    const full = polysOf(rec, "city_baytown", (a) => cls(a) === "CITY");
    const vertices = ring.filter((v) => pointInPolygons(v, full)).length;
    expect(vertices).toBe(13);
    expect(vertices / ring.length).toBeLessThan(0.6);
    expect(pct(ringsAsPolygons([ring]), full, refOf(rec))).toBeCloseTo(96.7, 1);
  });

  it("Grand Port's parcel: 32 of 46 vertices, 99.1% by area", () => {
    const rec = site("Grand Port");
    const ring = parcelRing(rec, "e1454605dvngtd");
    const limited = polysOf(rec, "city_baytown", (a) => cls(a) === "LIMITED ANNEXATION");
    const vertices = ring.filter((v) => pointInPolygons(v, limited)).length;
    expect(vertices).toBe(32);
    expect(pct(ringsAsPolygons([ring]), limited, refOf(rec))).toBeCloseTo(99.1, 1);
  });

  it("the whole-site share is measured on the DISSOLVED footprint — overlapping records measure once", () => {
    const rec = site("Goose Creek");
    const rings = ringsOf(rec);
    const ref = refOf(rec);
    const summed = rings.reduce((a, r) => a + unionAreaSqM(ringsAsPolygons([r]), ref), 0) / SQM_PER_ACRE;
    const dissolved = unionAreaSqM(ringsAsPolygons(rings), ref) / SQM_PER_ACRE;
    expect(rings.length).toBe(17);          // seventeen records…
    expect(summed).toBeCloseTo(717.3, 0);   // …totalling 717 acres…
    expect(dissolved).toBeCloseTo(296.4, 0); // …over 296 acres of ground.
  });
});

describe("NEW-2 — interior rings are holes, and land inside one is not in the city", () => {
  it("the city's main body has interior holes, and a point inside one is NOT in the city", () => {
    const rec = site("Goose Creek");
    // ⚠ The recorded polygons are clipped to a 3 km margin box (see the fixture's _clipCaveat), so
    // this reads the main body's holes WITHIN that box, not all 18. The un-clipped count is
    // asserted against the live service by ui-audit/verify-jurisdiction-portfolio.
    const main = polysOf(rec, "city_baytown", (a) => cls(a) === "CITY")
      .sort((x, y) => y.outer.length - x.outer.length)[0];
    expect(main.holes.length).toBeGreaterThan(0);
    const hole = main.holes[0];
    const c = hole.reduce((a, p) => [a[0] + p[0] / hole.length, a[1] + p[1] / hole.length], [0, 0]);
    // The point is inside the OUTER ring and outside the polygon. A containment test that reads
    // only the outer ring reports this land as in-city; it is not.
    expect(pointInRing(c, main.outer)).toBe(true);
    expect(pointInPolygons(c, [main])).toBe(false);
  });
});

describe("NEW-2 — a share may not be stated from generalised geometry", () => {
  it("exact geometry is always confident; a smear that could move the share by more than 2% is refused", () => {
    expect(shareConfidence(0, 5000, 400000).confident).toBe(true);
    // 30 m of generalisation along 1 km of boundary across a 100,000 m² tract = ±30% of the share.
    const refused = shareConfidence(30, 1000, 100000);
    expect(refused.confident).toBe(false);
    expect(refused.reason).toMatch(/generalised/);
    // …and a share the caller may not state comes back NULL, never as a number.
    const rec = site("Grand Port");
    const r = areaShare(ringsAsPolygons([parcelRing(rec, "e1454605dvngtd")]),
      polysOf(rec, "city_baytown", (a) => cls(a) === "LIMITED ANNEXATION"), refOf(rec), { toleranceM: 40 });
    expect(r.confident).toBe(false);
    expect(r.share).toBe(null);
    expect(r.rawShare).toBeGreaterThan(0.98);
  });
});

describe("NEW-1 — three jurisdiction classes in one layer, and only CITY is full purpose", () => {
  it("Baytown's own layer carries all three classes near these sites", () => {
    const rec = site("Grand Port");
    const seen = new Set(featuresOf(rec, "city_baytown").map((f) => cls(f.attributes)));
    expect(seen.has("CITY")).toBe(true);
    expect(seen.has("LIMITED ANNEXATION")).toBe(true);
    expect(seen.has("StripAnnex")).toBe(true);
  });

  it("⛔ Grand Port is inside a LIMITED-PURPOSE annexation and in NO city's full-purpose limits", () => {
    const rec = site("Grand Port");
    const ref = refOf(rec);
    const parcel = ringsAsPolygons([parcelRing(rec, "e1454605dvngtd")]);
    expect(pct(parcel, polysOf(rec, "city_baytown", (a) => cls(a) === "CITY"), ref)).toBe(0);
    expect(pct(parcel, polysOf(rec, "city"), ref)).toBe(0);   // TxGIO carries full-purpose only
    // …and 99% inside ONE named limited-purpose polygon, by its own annexation-file id.
    const oid1344 = polysOf(rec, "city_baytown", (a) => a.OBJECTID_1 === 1344);
    expect(featuresOf(rec, "city_baytown", (a) => a.OBJECTID_1 === 1344)[0].attributes.Unique_ID).toBe("CL-20170711-007");
    expect(pct(parcel, oid1344, ref)).toBeCloseTo(99.1, 1);
  });
});

describe("NEW-3 — the two sites, end to end, through the real identify and the real badge", () => {
  it("GRAND PORT reads Baytown ETJ + Baytown limited-purpose annexation + Chambers County", async () => {
    const { j, b } = await badgeFor("Grand Port");
    expect(b.text).toBe("City of Baytown ETJ · Baytown limited-purpose annexation (99% by area) · Chambers County");
    // ⛔ It is NOT in the city: the limited-purpose area may never make `unincorporated` false, or
    // the city's whole ordinance set — its floodplain rules included — is silently applied here.
    expect(j.cityContainment).toBe("none");
    expect(j.unincorporated).toBe(true);
    expect(j.city).toEqual([]);
    expect(j.etj).toEqual(["Baytown"]);
    expect(j.county).toEqual(["Chambers"]);
    expect(j.cityLimitedAreas.map((a) => [a.name, a.class])).toEqual([["Baytown", "limited"]]);
    expect(j.cityLimitedAreas[0].share).toBeCloseTo(0.991, 2);
    expect(j.cityLimitedAreas[0].uniqueIds).toContain("CL-20170711-007");
    expect(j.cityShareMethod).toBe("area");
  });

  it("GOOSE CREEK reads partly City of Baytown limits — FULL PURPOSE — with the rest in its ETJ", async () => {
    const { j, b } = await badgeFor("Goose Creek");
    expect(b.text).toBe("Part in City of Baytown limits (full purpose, 32% by area) · rest in its ETJ · Harris County");
    expect(b.shape).toBe("split");
    expect(j.cityContainment).toBe("partial");
    expect(j.citySome).toEqual(["Baytown"]);
    expect(j.cityShareMethod).toBe("area");
    /* ⛔ TWO PUBLISHERS OF ONE BOUNDARY, ABOUT A POINT APART, AND BOTH ARE KEPT. TxGIO's Baytown
     * polygon holds 31.95% of this site; Baytown's own holds 31.01%. The larger leads (never
     * under-state a city's reach) and the disagreement is recorded rather than resolved away — a
     * badge that silently picked one would be making a choice nobody could see. */
    const fullRow = j.cityAreas.rows.find((r) => r.class === "full");
    expect(fullRow.share).toBeCloseTo(0.3195, 3);
    expect(fullRow.sourceShares.city).toBeCloseTo(0.3195, 3);
    expect(fullRow.sourceShares.city_baytown).toBeCloseTo(0.3101, 3);
    expect(fullRow.sources.sort()).toEqual(["city", "city_baytown"]);
    expect(j.cityCoverage.siteAcres).toBeCloseTo(296.4, 0);
    // ⛔ THE NEGATIVE, and it is the half a fixture normally forgets: NO limited-purpose polygon
    // touches this site. The nearest is OID 1362 (`ANO307`), 577 m from the drawn site and 662 m
    // from the northern parcel — so this assertion fails on a smear far smaller than the gap.
    expect(j.cityLimitedAreas).toEqual([]);
    expect(b.text).not.toMatch(/limited-purpose/);
  });

  it("GOOSE CREEK, per parcel: 96.7% / 0% / 0% by area, and 100% ETJ throughout", async () => {
    const rec = site("Goose Creek");
    const ref = refOf(rec);
    const full = polysOf(rec, "city_baytown", (a) => cls(a) === "CITY");
    const etj = polysOf(rec, "etj_baytown");
    const expected = [
      ["e1454746tcmstb", 95.0, 96.7],   // southern — the bottom third, in the city
      ["e1454846quvgmx", 99.1, 0],      // middle
      ["e1454844quvgmx", 94.1, 0],      // northern
    ];
    for (const [id, acres, share] of expected) {
      const p = ringsAsPolygons([parcelRing(rec, id)]);
      expect(unionAreaSqM(p, ref) / SQM_PER_ACRE).toBeCloseTo(acres, 0);
      expect(pct(p, full, ref)).toBeCloseTo(share, 1);
      expect(pct(p, etj, ref)).toBeCloseTo(100, 1);
    }
  });

  it("the nearest LIMITED-PURPOSE polygon does not touch Goose Creek, and the gap is measured", () => {
    const rec = site("Goose Creek");
    const ref = refOf(rec);
    const limited = polysOf(rec, "city_baytown", (a) => cls(a) === "LIMITED ANNEXATION");
    expect(limited.length).toBeGreaterThan(0);          // it IS in the recording — the fixture can fail
    const nearest = polysOf(rec, "city_baytown", (a) => a.OBJECTID_1 === 1362);
    expect(featuresOf(rec, "city_baytown", (a) => a.OBJECTID_1 === 1362)[0].attributes.Unique_ID).toBe("ANO307");
    const site3 = ringsAsPolygons(ringsOf(rec));
    expect(pct(site3, limited, ref)).toBe(0);
    const d = distanceToBoundaryM(site3, nearest, ref);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(700);
    const north = ringsAsPolygons([parcelRing(rec, "e1454844quvgmx")]);
    expect(distanceToBoundaryM(north, nearest, ref)).toBeCloseTo(662, -1);
    /* ⚠ THE BRIEF'S "~37 m north of the northern parcel" IS A LATITUDE GAP, NOT A DISTANCE, and the
     * correction is recorded here rather than left to be rediscovered: OID 1362 begins at latitude
     * 29.820183 and the northern parcel's own northernmost vertex is ~45 m of latitude short of it —
     * but the polygon is offset in longitude too, so the real separation is 662 m. Both are asserted:
     * the latitude gap is what makes the site look adjacent on a north-up map, and the separation is
     * what makes the negative true. */
    const northLat = Math.max(...parcelRing(rec, "e1454844quvgmx").map(([, lat]) => lat));
    const limLat = Math.min(...nearest.flatMap((p) => p.outer.map(([, lat]) => lat)));
    expect((limLat - northLat) * 111132).toBeGreaterThan(25);
    expect((limLat - northLat) * 111132).toBeLessThan(70);
  });

  it("a city from the NEIGHBOURING COUNTY is a supported shape, not an edge case", async () => {
    // Baytown is a Harris County city; its limited-purpose annexation reaches into CHAMBERS, which
    // is where Grand Port sits. Nothing in the chain may require the city and the county to agree.
    const { j } = await badgeFor("Grand Port");
    expect(j.county).toEqual(["Chambers"]);
    expect(j.etj).toEqual(["Baytown"]);
    expect(j.cityLimitedAreas[0].name).toBe("Baytown");
  });
});

describe("NEW-2 — the instrument says which instrument it was, and refuses to invent a share", () => {
  it("a source that cannot be measured falls back to points and states NO share", async () => {
    const rec = site("Goose Creek");
    const rings = ringsOf(rec);
    const j = await identifyJurisdiction(rec.origin.lon, rec.origin.lat, {
      rings, ring: rings[0], roles: ["city"],
      cache: freshCache(),
      // A service that answers attributes but never geometry — the pre-2026-08-12 world.
      fetchJson: async (url) => {
        const inner = replayAreas(rec)(url);
        const r = await inner;
        return { features: r.features.map((f) => ({ attributes: f.attributes })) };
      },
    });
    expect(j.cityShareMethod).toBe("points");
    expect(j.cityAreas).toBeUndefined();
    const b = formatJurisdictionBadge(j);
    expect(b.text).not.toMatch(/by area/);
    expect(b.citySharePct).toBe(null);
  });

  it("one city source failing does not erase an answer another gave", async () => {
    const { j, b } = await badgeFor("Goose Creek", { fail: ["city_baytown"] });
    expect(j.cityContainment).not.toBe("unknown");
    expect(b.text).not.toMatch(/Couldn't check city limits/);
    expect((j.citySourceErrors || []).map((e) => e.id)).toEqual(["city_baytown"]);
  });
});

describe("NEW-3 — the floodplain administrator sees the limited-purpose area, and refuses it the floor", () => {
  it("Baytown is raised at Grand Port as a LIMITED candidate, never as the governing authority", async () => {
    const { assessAdministrator } = await import("../src/workspaces/site-planner/lib/floodAdministrator.js");
    const { DEFAULT_FLOODPLAIN_RULES: RULES } = await import("../src/workspaces/site-planner/lib/floodplainRules.js");
    const { j } = await badgeFor("Grand Port");
    const b = formatJurisdictionBadge(j);
    const a = assessAdministrator({
      signals: {
        county: "chambers",
        cityLabel: null,
        etjLabel: (b.etjLabels || [])[0] || null,
        limitedAreas: b.cityLimitedAreas,
        unresolvedRoles: b.unresolvedRoles,
      },
      rules: RULES,
    });
    const limited = a.candidates.filter((c) => c.kind === "limited");
    expect(limited.map((c) => c.label)).toEqual(["Baytown (limited-purpose annexation)"]);
    expect(limited[0].reason).toMatch(/confirmed with the city/);
    // ⛔ It may not govern — we do not know whether Baytown's ordinance reaches this land.
    expect(a.governing.kind).not.toBe("limited");
    expect(a.governing.key).toBe("chambers");
    // …and it IS a named hole in the comparison rather than a silence.
    expect(a.unmodelledCandidates.map((u) => u.key)).toContain("baytown");
    expect(a.unmodelledNote).toMatch(/Baytown/);
    expect(a.settled).toBe(false);
  });

  it("the Baytown rule record says the ordinance is UNREAD — it does not invent a freeboard", async () => {
    const { DEFAULT_FLOODPLAIN_RULES: RULES } = await import("../src/workspaces/site-planner/lib/floodplainRules.js");
    const r = RULES.baytown;
    expect(r).toBeTruthy();
    expect(r.ffeRule).toBe(null);
    expect(r.verified).toBe(false);
    expect(r.unreadable.reason).toBe("egress-blocked");
    expect(r.limitedPurposeScope).toBe("unknown");
    // ⛔ The one thing that must never appear here is a number nobody read.
    expect(JSON.stringify(r)).not.toMatch(/plusFt/);
  });
});
