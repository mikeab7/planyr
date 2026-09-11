import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  COUNTIES, COUNTIES_MAP, countyIdentity, countyKeyForName, noParcelSourceNote,
  candidateCountiesForPoint, STATEWIDE_KEYS, STATEWIDE_PARCEL_LAYER,
} from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";

/* B853712 — THE STATEWIDE-DERIVED TIER: all 254 Texas counties get a real parcel source (the
 * universal TxGIO statewide layer, exactly the shape Waller already uses) DERIVED at runtime from
 * the same `county-polygons.json` asset the geometry resolver already fetches — never 254
 * hand-typed literal rows. This suite runs against the REAL committed asset (not a fixture), which
 * is itself the honest test: if the asset's shape ever drifts, this is what would catch it, not a
 * synthetic stand-in that agrees with the code by construction.
 *
 * Isolated in its own file (rather than added to counties.test.js) because it deliberately WARMS
 * the county-polygons module singleton via `setCountyPolygons` — counties.test.js's own "reports
 * pending before the geometry is resident" test depends on that singleton staying cold, and vitest
 * gives each test FILE its own module registry, so the two suites can't interfere with each other. */

let payload;
beforeAll(async () => {
  payload = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
  await setCountyPolygons(payload);
});

describe("statewide derivation — a Texas county with no dialed-in row (B853712)", () => {
  // The 19 counties within 50 miles of downtown Dallas, plus a spread sample well outside that
  // radius (Panhandle / border / Piney Woods / Gulf coast) — proving the derivation is a property
  // of the mechanism, not something that only happens to work for the counties it was written for.
  const DFW_19 = [
    ["dallas", "Dallas", 32.693167, -96.766833],
    ["collin", "Collin", 33.249556, -96.505278],
    ["denton", "Denton", 33.301778, -97.046722],
    ["kaufman", "Kaufman", 32.469639, -96.4469],
    ["rockwall", "Rockwall", 32.9235, -96.371],
    ["tarrant", "Tarrant", 32.840875, -97.272312],
    ["ellis", "Ellis", 32.423037, -96.486407],
    ["johnson", "Johnson", 32.199984, -97.512859],
    ["hunt", "Hunt", 32.917808, -95.967205],
    ["henderson", "Henderson", 32.218865, -95.985276],
    ["wise", "Wise", 33.257083, -97.56575],
    ["hill", "Hill", 31.973128, -97.355061],
    ["navarro", "Navarro", 32.196171, -96.212512],
    ["vanzandt", "Van Zandt", 32.68039, -95.710936],
    ["grayson", "Grayson", 33.818807, -96.674836],
    ["parker", "Parker", 32.828, -97.801429],
    ["cooke", "Cooke", 33.6357, -97.1336],
    ["fannin", "Fannin", 33.805524, -96.096716],
    ["rains", "Rains", 32.788747, -95.819877],
  ];
  const SPREAD_SAMPLE = [
    ["hartley", "Hartley", 35.85, -102.55],   // Panhandle
    ["webb", "Webb", 27.55, -99.49],          // Border (Laredo)
    ["nacogdoches", "Nacogdoches", 31.60, -94.66], // Piney Woods
    ["calhoun", "Calhoun", 28.45, -96.60],    // Gulf coast
  ];

  it.each(DFW_19)("%s (%s) resolves to a real parcel source via geometry", (key, name, lat, lng) => {
    const id = countyIdentity(lat, lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe(key);
    expect(id.name).toBe(name);
    expect(id.state).toBe("TX");
    expect(noParcelSourceNote(id)).toBeNull(); // never the "no parcel data wired here yet" message
  });

  it.each(SPREAD_SAMPLE)("%s (%s), a county nowhere near Dallas, also derives", (key, name, lat, lng) => {
    const id = countyIdentity(lat, lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe(key);
    expect(noParcelSourceNote(id)).toBeNull();
  });

  it("a derived county's COUNTIES_MAP row rides the universal TxGIO layer, flagged as derived", () => {
    const m = COUNTIES_MAP.dallas;
    expect(m.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(m.state).toBe("TX");
    expect(m.statewideDerived).toBe(true);
    expect(m.bbox).toHaveLength(4);
    const [minLat, minLng, maxLat, maxLng] = m.bbox;
    expect(minLat).toBeLessThan(maxLat);
    expect(minLng).toBeLessThan(maxLng);
  });

  it("a derived county's COUNTIES row carries a scopeWhere naming ITS OWN county, not another's", () => {
    const c = COUNTIES.dallas;
    expect(c.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(c.scopeWhere).toBe("county='DALLAS'");
    expect(c.idField).toBe("prop_id");
    expect(c.addrField).toBe("situs_addr");
    expect(c.statewideDerived).toBe(true);
  });

  it("Van Zandt's scopeWhere carries the space TxGIO's own `county` column uses", () => {
    // Routing KEYS strip whitespace ("vanzandt"); the county's real name, used in the where-clause
    // and the display label, keeps it.
    expect(COUNTIES.vanzandt.scopeWhere).toBe("county='VAN ZANDT'");
    expect(COUNTIES.vanzandt.label).toBe("Van Zandt County");
  });

  it("countyKeyForName resolves a derived county's real name to its derived key", () => {
    expect(countyKeyForName("Dallas", "TX")).toBe("dallas");
    expect(countyKeyForName("Van Zandt", "TX")).toBe("vanzandt");
    expect(countyKeyForName("Hartley", "TX")).toBe("hartley");
  });
});

describe("the dialed-in tier is never shadowed by the derived tier (owner instruction, B853712)", () => {
  const DIALED_IN = ["harris", "fortbend", "chambers", "waller", "montgomery", "brazoria", "galveston", "liberty", "austintx"];

  it.each(DIALED_IN)("%s keeps its own literal row — never marked statewideDerived", (key) => {
    expect(COUNTIES_MAP[key].statewideDerived).toBeUndefined();
    expect(COUNTIES[key].statewideDerived).toBeUndefined();
  });

  it("Harris's own HCAD endpoint wins over the statewide layer — the derivation never overwrites it", () => {
    expect(COUNTIES_MAP.harris.layerUrl).not.toBe(STATEWIDE_PARCEL_LAYER);
    expect(COUNTIES_MAP.harris.layerUrl).toMatch(/gis\.hctx\.net/);
  });

  it("a promoted county's geometry resolution returns its DIALED-IN key, not a re-derived one", () => {
    const id = countyIdentity(29.76, -95.37); // inside Harris
    expect(id.status).toBe("ok");
    expect(id.key).toBe("harris");
  });

  it("Austin COUNTY's real name aliases to the existing `austintx` key, never a colliding `austin` key", () => {
    expect(countyKeyForName("Austin", "TX")).toBe("austintx");
    expect(COUNTIES_MAP.austin).toBeUndefined(); // the derivation must not mint a shadow key here
    expect(COUNTIES_MAP.austintx.statewideDerived).toBeUndefined();
  });
});

describe("the derivation changes nothing about enumeration or the statewide pseudo-keys", () => {
  it("STATEWIDE_KEYS is still a hand-curated, bounded list of pseudo-keys — derived counties are real counties, not fallback keys", () => {
    // NEW-1 (2026-09-08, docs/STATEWIDE-PARCELS.md) added 19 more hand-curated statewide
    // composites alongside the original two; a same-day follow-up pass (B1332016, measured live
    // from the owner's own browser — this sandbox can't reach any of these hosts) added HI/MD/NE/NH,
    // raising 21 to 25 — still every one dialed in by a probed URL, never a per-county DERIVATION
    // the way the 254 Texas counties above are. NEW-1 (2026-09-08) then added CALIFORNIA and RHODE
    // ISLAND, raising 27 to 29: both had been recorded as `no-free-source` / `Candidate: none
    // found`, and both were found by the ArcGIS-Online-organization pass this repo had only ever
    // run for New York (see counties.js's `ca_statewide` comment, and NEW-2 which makes that pass
    // systematic). B1344720 (2026-09-10) added DC/ME/NV, raising 29 to 32 — all three were
    // likewise corrected FALSE prior findings (shape-mismatch/shape-mismatch/no-free-source), each
    // recorded as a genuine single-layer statewide source in counties.js's own comments. The
    // invariant this test guards is "still small and literal", not "still exactly two" (or
    // twenty-one, or twenty-nine).
    expect(STATEWIDE_KEYS).toEqual([
      "txgio_statewide", "co_statewide",
      "ak_statewide", "ar_statewide", "ca_statewide", "ct_statewide", "dc_statewide", "de_statewide", "fl_statewide",
      "hi_statewide", "in_statewide", "ma_statewide", "me_statewide", "md_statewide", "mn_statewide", "mt_statewide", "nc_statewide",
      "nd_statewide", "ne_statewide", "nh_statewide", "nj_statewide", "nv_statewide", "ny_statewide", "oh_statewide",
      "ri_statewide", "tn_statewide",
      "ut_statewide", "va_statewide", "vt_statewide", "wi_statewide", "wv_statewide", "wy_statewide",
    ]);
  });

  it("Object.keys(COUNTIES_MAP) still enumerates only the literal, dialed-in rows", () => {
    const keys = Object.keys(COUNTIES_MAP);
    expect(keys).not.toContain("dallas");
    // ~18 dialed-in TX+CO rows + 32 statewide pseudo-keys + 13 Idaho counties (B1344721) + 19
    // other-state counties (B1344722) + 9 Tier-1 counties (B1551617), not 254 or 3,143.
    expect(keys.length).toBeLessThan(100);
  });

  it("candidateCountiesForPoint still answers via the existing txgio_statewide fallback for a derived county — unchanged, not doubled", () => {
    const cand = candidateCountiesForPoint(32.693167, -96.766833); // Dallas
    expect(cand).toContain("txgio_statewide");
    // The derived key itself is never inserted into the candidate list — it would just re-query the
    // identical TxGIO endpoint under a second name. Click routing already reaches Dallas parcels
    // through the unscoped statewide entry (proven live in ui-audit/verify-dallas-metro-parcels.mjs).
    expect(cand).not.toContain("dallas");
  });
});

describe("a point genuinely outside every state + DC still reports honestly", () => {
  // B1361425 — New York City used to be the example here, back when county-polygons.json
  // covered only Texas and Colorado. It no longer proves this: the file now carries real
  // geometry for every US county (the nationwide Esri source), so NYC correctly resolves to
  // `no-source` — "this is New York County, NY, and Planyr has no parcel service configured
  // there" — which is the MORE honest answer, not a regression (that IS what B209502's whole
  // "naming a gap honestly" contract is for). `outside` now means genuinely outside every US
  // county — international waters, mid-ocean, another country.
  it("New York City resolves to `no-source`, naming the real county with no parcel source — not a blanket `outside`", () => {
    const id = countyIdentity(40.7128, -74.006);
    expect(id.status).toBe("no-source");
    expect(id.name).toBe("New York County");
    expect(id.state).toBe("NY");
  });

  it("a point mid-Atlantic, hundreds of miles from any coastline, still resolves to `outside`", () => {
    expect(countyIdentity(35.0, -50.0).status).toBe("outside");
  });

  it("Toronto, Canada resolves to `outside`, never a guessed US derivation", () => {
    expect(countyIdentity(43.6532, -79.3832).status).toBe("outside");
  });
});

/* ⛔ B1457152 (2026-09-10) — CLICK ROUTING NO LONGER QUERIES THE WHOLE COUNTRY FOR ONE POINT.
 *
 * Measured live on planyr.io: a single click on a Las Vegas point fired 67+ `/query` requests —
 * Harris County TX, Fort Bend TX, the Texas statewide layer (twice), Brazoria/Liberty/Austin/
 * Galveston TX, Larimer CO, Alaska, Arkansas (503), California, Connecticut, and on — because
 * `candidateCountiesForPoint`'s last-resort fallback (no bbox match, and `stateForPoint`'s TX/CO-only
 * envelope came up empty for Nevada) used to return EVERY configured source in the country. Nevada's
 * own source (`nv_statewide`) WAS in that list and answered 200 — the sources were never the
 * problem, the dispatcher in front of them was.
 *
 * The fix (this file's `beforeAll` already warms the SAME nationwide county-polygon asset the fix
 * itself reads) is `resolvedState` in counties.js: it asks `resolveCounty` — the real, nationwide
 * geometry, not the two-rectangle TX/CO envelope — for the point's state, so a purely-statewide
 * state with no per-county bbox of its own (Nevada, DC, California, Rhode Island, every other
 * `_statewide`-only entry) narrows to exactly its own configured source(s) instead of being
 * indistinguishable from "no state resolved at all". A test here that regresses to querying more
 * than a small, fixed number of sources for ONE point is exactly the bug this item closes — see
 * MAX_CANDIDATES_PER_POINT below. */
describe("B1457152 — candidateCountiesForPoint never fans out to every configured source", () => {
  // Normally one source, occasionally two (a county CAD + a statewide backup, or two overlapping
  // county bboxes — Sugar Land's harris+fortbend). A handful of headroom above that for a state
  // that later grows a couple of real county entries alongside its statewide composite — NEVER
  // anywhere near "every wired state at once" (~70+ as of this item).
  const MAX_CANDIDATES_PER_POINT = 6;

  it("REGRESSION FIXTURE — the exact Las Vegas point from the live repro resolves to nv_statewide ALONE", () => {
    // -115.157, 36.1167 as measured live (lng, lat) → (lat, lng) for this function.
    const cand = candidateCountiesForPoint(36.1167, -115.157);
    expect(cand).toEqual(["nv_statewide"]);
    expect(cand.length).toBeLessThanOrEqual(MAX_CANDIDATES_PER_POINT);
  });

  it.each([
    ["Las Vegas, NV", 36.1167, -115.157],
    ["Fresno, CA", 36.74, -119.79],
    ["Providence, RI", 41.824, -71.412],
    ["Washington, DC", 38.9072, -77.0369],
    ["Portland, ME", 43.6591, -70.2568],
  ])("%s never issues more than %i parcel-source candidates, and every one is that point's own state", (label, lat, lng) => {
    const cand = candidateCountiesForPoint(lat, lng);
    expect(cand.length).toBeGreaterThan(0);
    expect(cand.length).toBeLessThanOrEqual(MAX_CANDIDATES_PER_POINT);
    const states = new Set(cand.map((k) => COUNTIES_MAP[k].state));
    expect(states.size).toBe(1); // never a mix of two states' sources for one point
  });

  it("a purely-statewide state resolves to EXACTLY its own composite — no Texas, no Colorado, no Arkansas", () => {
    const cand = candidateCountiesForPoint(36.1167, -115.157); // Las Vegas
    expect(cand).toContain("nv_statewide");
    expect(cand.some((k) => COUNTIES_MAP[k].state === "TX")).toBe(false);
    expect(cand.some((k) => COUNTIES_MAP[k].state === "CO")).toBe(false);
    expect(cand).not.toContain("ar_statewide"); // measured live returning a 503 for this exact click
    expect(cand).not.toContain("ak_statewide");
    expect(cand).not.toContain("ca_statewide");
    expect(cand).not.toContain("ct_statewide");
  });

  it("a Texas click still carries none of the other ~30 states' sources (unchanged behaviour)", () => {
    const cand = candidateCountiesForPoint(29.76, -95.37); // Harris County
    expect(cand).toContain("harris");
    expect(cand).toContain("txgio_statewide");
    expect(cand.every((k) => COUNTIES_MAP[k].state === "TX")).toBe(true);
  });

  it("a state with NO wired source at all resolves to NO candidates — never every candidate", () => {
    // Pierre, SD — a real, geometry-resolvable county in a state with ZERO configured parcel
    // sources (no statewide composite, no individual county). This is the case the old fallback
    // got backwards: "we don't know a source" became "try all of them" instead of the honest "we
    // have none to try".
    // ⛔ B1551617 — this used to use Albuquerque/Bernalillo County, NM as the example; Bernalillo
    // is now wired (nm_bernalillo) and every OTHER New Mexico point still correctly resolves to it
    // too, as the state's one-and-only "coverage" candidate (the same fallback Idaho's
    // non-participating counties already rely on) — so the case moved to one of the only two
    // states (SD, WA) with no wired source at all, rather than deleting the case the fallback rule
    // is actually about.
    const cand = candidateCountiesForPoint(44.3683, -100.3510);
    expect(cand).toEqual([]);
  });

  it("a point genuinely outside every covered state/asset still returns NO candidates, not everyone's", () => {
    expect(candidateCountiesForPoint(35.0, -50.0)).toEqual([]); // mid-Atlantic
  });
});

/* ⛔ B1551618 (2026-09-11) — THE FAN-OUT ASSERTION, EXTENDED TO COUNT *ALL* GIS LOOKUPS FOR A POINT,
 * NOT ONLY PARCEL QUERIES. Item 5 of the dispatch brief, verbatim: "extend the fan-out assertion to
 * count ALL GIS lookups for a point, not only parcel queries - the existing assertion passed while
 * this was happening."
 *
 * "This" is a real, live, measured defect the B1457152 suite above could not see: PR #1622 fixed
 * `candidateCountiesForPoint` (the PARCEL routing) so a Las Vegas click issues exactly one parcel
 * query, to Nevada. But a Las Vegas click ALSO triggers the JURISDICTION identify (the header badge,
 * `identifyJurisdiction(..., { roles: ["county","city","etj"] })` — see SitePlanner.jsx), and its
 * `countySourcesForPoint` unconditionally returned the Texas TxDOT county-boundary source for ANY
 * point outside Colorado — Las Vegas included — while `citySourcesForPoint`'s un-bboxed statewide
 * TxGIO row did the identical thing for the city role. Measured live on planyr.io 2026-09-11: a
 * Las Vegas parcel lookup fired one correct NV parcel query and ALSO one query to
 * services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0.
 * Every B1457152 test above is still green on that exact defect, because none of them look past
 * `candidateCountiesForPoint` — this suite closes that gap by counting the hosts every ROLE's own
 * per-point source resolver would fire, union'd with the parcel candidates, for the same points. */
import {
  countySourcesForPoint, citySourcesForPoint, etjSourcesForPoint, JURISDICTION_SOURCES,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

function allGisHostsQueriedFor(lat, lng) {
  const parcelHosts = candidateCountiesForPoint(lat, lng).map((k) => hostOf(COUNTIES_MAP[k].layerUrl || COUNTIES_MAP[k].serviceUrl));
  const jurisdictionSources = [
    ...countySourcesForPoint(lat, lng), ...citySourcesForPoint(lat, lng), ...etjSourcesForPoint(lat, lng),
  ];
  const jurisdictionHosts = jurisdictionSources.filter(Boolean).map((s) => hostOf(s.url));
  return new Set([...parcelHosts, ...jurisdictionHosts].filter(Boolean));
}
function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}
const TX_HOSTS = new Set([hostOf(GIS_SOURCES.county.serviceUrl), hostOf(GIS_SOURCES.city.serviceUrl)]);
const CO_HOST = hostOf(GIS_SOURCES.countyCo.serviceUrl);

describe("B1551618 — the COMPLETE GIS lookup fan-out (parcel + county + city + etj), not just parcel", () => {
  it.each([
    ["Las Vegas, NV", 36.1167, -115.157],
    ["Providence, RI", 41.824, -71.412],
    ["Washington, DC", 38.9072, -77.0369],
    ["Portland, ME", 43.6591, -70.2568],
  ])("%s issues NO query to a Texas- or Colorado-specific GIS host, across every role", (label, lat, lng) => {
    const hosts = allGisHostsQueriedFor(lat, lng);
    for (const h of TX_HOSTS) expect(hosts.has(h), `${label}: unexpectedly queried Texas host ${h}`).toBe(false);
    expect(hosts.has(CO_HOST), `${label}: unexpectedly queried Colorado host ${CO_HOST}`).toBe(false);
  });

  it("REGRESSION FIXTURE — replays the exact reported defect: Las Vegas queries NV parcels and nothing Texan", () => {
    const hosts = allGisHostsQueriedFor(36.1167, -115.157);
    expect(hosts.has(hostOf(GIS_SOURCES.county.serviceUrl)), "Texas_County_Boundaries").toBe(false);
    expect(hosts.has(hostOf(GIS_SOURCES.city.serviceUrl)), "TxGIO statewide city limits").toBe(false);
    // The parcel query itself is untouched (B1457152's own claim) — this only adds the jurisdiction
    // roles it didn't look at.
    expect(candidateCountiesForPoint(36.1167, -115.157)).toEqual(["nv_statewide"]);
  });

  it("a real Texas point still queries the Texas jurisdiction sources (unchanged behaviour)", () => {
    const hosts = allGisHostsQueriedFor(29.76, -95.37); // Harris County
    expect(hosts.has(hostOf(GIS_SOURCES.county.serviceUrl))).toBe(true);
    expect(hosts.has(hostOf(GIS_SOURCES.city.serviceUrl))).toBe(true);
  });

  it("a real Colorado point still queries Colorado's own county source (unchanged behaviour)", () => {
    const srcs = countySourcesForPoint(39.7392, -104.9903); // Denver
    expect(srcs[0]).toBe(JURISDICTION_SOURCES.countyCo);
  });
});
