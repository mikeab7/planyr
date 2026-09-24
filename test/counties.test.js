import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  candidateCountiesForPoint, COUNTIES, COUNTIES_MAP, countyKeyForName, STATEWIDE_KEYS, countyIdentity, noParcelSourceNote,
  STATEWIDE_PARCEL_LAYER, statewideFallbackFor, countyForView, countyBboxIntersectsView,
  isIdentifyOnlyLayerUrl, isStatewideLayerUrl, sharedLayerUrlConflicts, detectField,
} from "../src/workspaces/site-planner/lib/counties.js";

// candidateCountiesForPoint routes a map click to the CAD service(s) that could
// own the clicked lot, WITHOUT a county pre-pick (B11). The statewide TxGIO layer
// (its own `txgio_statewide` key since B787 decoupled it from Chambers) paints parcel
// outlines across all of Texas, so it must also be queryable everywhere as a universal
// fallback — otherwise a click over a county whose own CAD is down/unconfigured sees an
// outline it can't select (the Fort Bend symptom, B130).
describe("candidateCountiesForPoint — click routing (B11/B130/B787)", () => {
  const STATEWIDE = Object.entries(COUNTIES_MAP).filter(([, c]) => c.statewide).map(([k]) => k);

  it("the statewide source is its own `txgio_statewide` key, not chambers (B787)", () => {
    // NEW-5: there is now ONE statewide source PER STATE (Texas's TxGIO layer and Colorado's
    // state OIT composite), so this is no longer a single-element list. Texas's stays first —
    // config order — and chambers is still a real CAD, never the statewide stand-in.
    expect(STATEWIDE[0]).toBe("txgio_statewide");
    expect(STATEWIDE).toContain("co_statewide");
    expect(STATEWIDE).not.toContain("chambers"); // chambers is now a real CAD (CCAD)
  });

  it("a Fort Bend point includes fortbend AND the statewide source (the B130 fix)", () => {
    // Sugar Land — squarely in Fort Bend, outside the narrow Chambers bbox.
    const cand = candidateCountiesForPoint(29.6197, -95.6349);
    expect(cand).toContain("fortbend");
    // txgio_statewide == the statewide TxGIO layer; before B130 it was NOT a candidate
    // here, so a click found nothing whenever FBCAD was down.
    expect(cand).toContain("txgio_statewide");
    expect(cand).not.toContain("chambers"); // Sugar Land isn't in the Chambers bbox
  });

  it("the statewide source is appended LAST so a county's own CAD answers first", () => {
    const cand = candidateCountiesForPoint(29.6197, -95.6349);
    // every non-statewide (real CAD bbox match) precedes every statewide key
    const lastBboxIdx = Math.max(...cand.filter((k) => !STATEWIDE.includes(k)).map((k) => cand.indexOf(k)));
    const firstStatewideIdx = Math.min(...STATEWIDE.map((k) => cand.indexOf(k)).filter((i) => i >= 0));
    expect(lastBboxIdx).toBeLessThan(firstStatewideIdx);
  });

  it("a Chambers point routes to the real CCAD key first, with the statewide source appended once", () => {
    // A point inside the Chambers bbox: chambers now matches by bbox (a real CAD), and
    // txgio_statewide is appended once as the trailing fallback — neither is duplicated.
    const cand = candidateCountiesForPoint(29.7, -94.66);
    expect(cand.filter((k) => k === "chambers")).toHaveLength(1);
    expect(cand.filter((k) => k === "txgio_statewide")).toHaveLength(1);
    expect(cand.indexOf("chambers")).toBeLessThan(cand.indexOf("txgio_statewide"));
  });

  it("a Harris point still routes to harris first, with statewide as the trailing fallback", () => {
    const cand = candidateCountiesForPoint(29.76, -95.37);
    expect(cand[0]).toBe("harris");
    expect(cand).toContain("txgio_statewide"); // fallback present, but harris answers first
  });

  it("a point outside every county bbox returns ALL counties, harris-first (jurisdiction default preserved)", () => {
    // Far West Texas — outside all configured county bboxes. The Layers-panel jurisdiction
    // resolver reads candidate[0], so this must stay harris-first (the documented
    // away-from-Houston default), while still including the statewide source so a click out
    // there still has coverage. txgio_statewide has NO bbox, so it can only ever arrive via
    // this "return all" branch or the trailing append — never as candidate[0].
    const cand = candidateCountiesForPoint(31.7619, -106.485); // El Paso, TX
    expect(cand[0]).toBe("harris");
    expect(cand).toContain("txgio_statewide");
    // NEW-5: the fallback is now scoped to the point's STATE rather than "every configured
    // county". For a Texas point the list is byte-identical to the pre-Colorado one (the Texas
    // keys are first and unchanged) — it simply no longer drags nine Colorado servers along.
    expect(cand).toEqual(Object.entries(COUNTIES_MAP).filter(([, c]) => c.state === "TX").map(([k]) => k));
    expect(cand.some((k) => k.startsWith("co_"))).toBe(false);
  });

  // NEW-5 — the Colorado half of the same contract, including the one that matters most:
  // a Colorado click must never be handed `harris` as candidate[0]. The Layers-panel
  // jurisdiction resolver reads that element, so inheriting Harris County there is exactly how
  // a Colorado site would end up priced against Texas drainage criteria.
  it("a Colorado point routes to Colorado counties, never harris-first", () => {
    const denver = candidateCountiesForPoint(39.7392, -104.9903);
    // Every candidate is Colorado, and Denver's own service is among them. The FIRST element is
    // not pinned to co_denver on purpose: bboxes are a coarse pre-filter and the Front Range
    // boxes genuinely overlap (Denver's own extent is unusually wide — the airport annexation
    // strip reaches deep into Adams), exactly as harris+fortbend overlap around Sugar Land in
    // Texas. The parcel service that returns a lot is the source of truth, and `countyAtPoint`
    // corrects the label afterwards. What must NEVER happen is a Texas key appearing here.
    expect(denver.every((k) => COUNTIES_MAP[k].state === "CO")).toBe(true);
    expect(denver).toContain("co_denver");
    expect(denver).toContain("co_statewide");
    expect(denver).not.toContain("harris");
    expect(denver).not.toContain("txgio_statewide");
  });

  it("a Colorado point outside every county bbox stays in Colorado", () => {
    const grandJunction = candidateCountiesForPoint(39.0639, -108.5506); // Mesa County — unconfigured
    expect(grandJunction[0]).not.toBe("harris");
    expect(grandJunction.every((k) => COUNTIES_MAP[k].state === "CO")).toBe(true);
    expect(grandJunction).toContain("co_statewide");
  });

  it("Colorado's statewide composite is appended last, like Texas's", () => {
    const cand = candidateCountiesForPoint(39.7392, -104.9903);
    const lastReal = Math.max(...cand.filter((k) => !COUNTIES_MAP[k].statewide).map((k) => cand.indexOf(k)));
    expect(lastReal).toBeLessThan(cand.indexOf("co_statewide"));
  });
});

/* NEW-1 (2026-09-08) — CLICK ROUTING REALLY REACHES THE TWO STATES THIS ITEM RESCUED.
 *
 * Wiring an entry into COUNTIES_MAP is not the same claim as "a click in that state can select a
 * lot from it", and this repo has been bitten before by proving the first and assuming the second.
 * California and Rhode Island had both been recorded as `no-free-source` with `Candidate: none
 * found` — both findings were wrong (docs/STATEWIDE-PARCELS.md), and both sources were found by
 * the official-ArcGIS-Online-organization pass NEW-2 makes systematic.
 *
 * ⛔ MOVED to test/countyStatewideDerivation.test.js (B1457152, 2026-09-10) — this described the
 * old "falls through to the every-key branch" behaviour as a deliberate, accepted coarseness. It
 * stopped being deliberate: with ~30 statewide sources now wired (and Michael's own 2026-09-10
 * instruction to wire the rest county-by-county), that "every key" branch is what fired 67+ parcel
 * queries for one Las Vegas click. The reachability assertions (a Fresno click can reach
 * `ca_statewide`, a Providence click can reach `ri_statewide`) now live alongside the fan-out
 * regression suite in the file that already warms the nationwide county-polygon asset
 * `candidateCountiesForPoint` needs to answer them narrowly — this file deliberately keeps that
 * asset cold (see the `countyIdentity` "reports pending" test below), so a test needing it lives
 * elsewhere rather than warm the singleton here for everyone after it. */

// The statewide TxGIO layer is the universal fallback when a county's own CAD server
// is down. statewideFallbackFor returns that layer scoped to the requested county, so
// an ID/address search can't leak into another county (B244).
describe("statewideFallbackFor — county-scoped TxGIO backup (B244/B787)", () => {
  it("exposes the statewide key(s) and the all-Texas layer URL", () => {
    expect(STATEWIDE_KEYS[0]).toBe("txgio_statewide"); // B787: its own key, not chambers
    expect(STATEWIDE_KEYS).toContain("co_statewide");  // NEW-5: one statewide source per state
    expect(STATEWIDE_PARCEL_LAYER).toMatch(/stratmap_land_parcels/);
  });

  it("Fort Bend → the TxGIO layer scoped to FORT BEND", () => {
    const fb = statewideFallbackFor("fortbend");
    expect(fb.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(fb.scopeWhere).toBe("county='FORT BEND'");
    expect(fb.idField).toBe("prop_id");
    expect(fb.addrField).toBe("situs_addr");
  });

  it("Harris → the TxGIO layer scoped to HARRIS", () => {
    expect(statewideFallbackFor("harris").scopeWhere).toBe("county='HARRIS'");
  });

  it("Chambers → the TxGIO layer scoped to CHAMBERS (B787: CCAD primary now HAS a backup)", () => {
    const ch = statewideFallbackFor("chambers");
    expect(ch).not.toBeNull();
    expect(ch.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(ch.scopeWhere).toBe("county='CHAMBERS'");
  });

  it("Waller → null (its PRIMARY is already TxGIO; no separate backup)", () => {
    expect(statewideFallbackFor("waller")).toBeNull();
  });

  it("an unknown county → null", () => {
    expect(statewideFallbackFor("nowhere")).toBeNull();
  });
});

describe("isIdentifyOnlyLayerUrl (B1657600) — a URL's /query capability, not its county key", () => {
  it("the TxGIO statewide layer is identify-only (its /query has been disabled since B627)", () => {
    expect(isIdentifyOnlyLayerUrl(STATEWIDE_PARCEL_LAYER)).toBe(true);
  });
  it("Waller inherits it — parked on the SAME url as txgio_statewide", () => {
    expect(COUNTIES_MAP.waller.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(isIdentifyOnlyLayerUrl(COUNTIES_MAP.waller.layerUrl)).toBe(true);
  });
  it("a real county CAD (Harris) is NOT identify-only", () => {
    expect(isIdentifyOnlyLayerUrl(COUNTIES_MAP.harris.layerUrl)).toBe(false);
  });
  it("Colorado's statewide composite is NOT identify-only — statewide and query-disabled are different axes", () => {
    expect(isStatewideLayerUrl(COUNTIES_MAP.co_statewide.layerUrl)).toBe(true);
    expect(isIdentifyOnlyLayerUrl(COUNTIES_MAP.co_statewide.layerUrl)).toBe(false);
  });
  it("tolerates a trailing slash, like isStatewideLayerUrl", () => {
    expect(isIdentifyOnlyLayerUrl(STATEWIDE_PARCEL_LAYER + "/")).toBe(true);
  });
});

describe("countyKeyForName (B792) — display name → configured routing key, never a guess", () => {
  it("maps the TxDOT boundary names onto configured keys", () => {
    expect(countyKeyForName("Fort Bend")).toBe("fortbend");
    expect(countyKeyForName("Harris")).toBe("harris");
    expect(countyKeyForName("Waller County")).toBe("waller"); // 'County' suffix stripped
    expect(countyKeyForName("CHAMBERS")).toBe("chambers");
  });
  it("maps the five B209503 Houston-metro counties too", () => {
    expect(countyKeyForName("Montgomery")).toBe("montgomery");
    expect(countyKeyForName("Brazoria")).toBe("brazoria");
    expect(countyKeyForName("Galveston")).toBe("galveston");
    expect(countyKeyForName("Liberty County")).toBe("liberty");
  });
  it("Austin COUNTY resolves to austintx, never to a key the city could reach (B209503)", () => {
    // Austin County is Bellville / Sealy on I-10 west — not the City of Austin. The key is
    // deliberately NOT the slug, so the far more common string "Austin" (a city, an ETJ, a TxDOT
    // district) cannot resolve into a county row that gets persisted in a saved plan.
    expect(countyKeyForName("Austin County")).toBe("austintx");
    expect(countyKeyForName("Austin")).toBe("austintx");
    expect(COUNTIES_MAP.austin).toBeUndefined();
  });
  it("unconfigured counties and the statewide pseudo-key → null (can never corrupt the stored row)", () => {
    expect(countyKeyForName("Walker")).toBeNull();      // real county, no configured CAD entry
    expect(countyKeyForName("Wharton")).toBeNull();     // ditto — a heal must keep the stored key
    expect(countyKeyForName("txgio_statewide")).toBeNull(); // statewide pseudo-key is excluded
    expect(countyKeyForName("")).toBeNull();
    expect(countyKeyForName(null)).toBeNull();
  });
});

/* NEW-1 — the JURISDICTION shown for a map POSITION. Separate from click routing on purpose:
 * `candidateCountiesForPoint(...)[0]` is harris-first BY CONTRACT for any point outside every
 * county bbox (the tests above depend on that order), and reading it as a jurisdiction is what
 * made the Layers panel claim Harris County while the map sat over Denver — the same
 * hardcoded-Houston class of bug as the landing view this shipped with. */
describe("countyForView — the Layers-panel jurisdiction for a map position", () => {
  it("a real bbox hit wins, exactly like click routing", () => {
    expect(countyForView(29.76, -95.37)).toBe("harris");
    expect(countyForView(29.6197, -95.6349)).toBe("fortbend");
  });

  it("a Colorado view resolves to a COLORADO county, never to Harris", () => {
    expect(countyForView(39.74, -104.99)).toBe("co_denver");   // Denver, in-bbox
    expect(countyForView(40.42, -104.71)).toBe("co_weld");     // Weld County — the owner's outlier
  });

  it("a Colorado point outside every county bbox stays in Colorado (nearest, not harris)", () => {
    // Grand Junction — west slope, outside all nine configured county boxes.
    const k = countyForView(39.06, -108.55);
    expect(COUNTIES_MAP[k].state).toBe("CO");
    expect(k).not.toBe("harris");
  });

  it("a Texas point outside every county bbox stays in Texas", () => {
    expect(COUNTIES_MAP[countyForView(31.9686, -102.0779)].state).toBe("TX"); // Midland
  });

  it("never returns a statewide parcel SOURCE as a jurisdiction", () => {
    [[29.76, -95.37], [39.74, -104.99], [39.06, -108.55], [36.9, -95.85], [33.45, -112.07]]
      .forEach(([lat, lng]) => expect(STATEWIDE_KEYS).not.toContain(countyForView(lat, lng)));
  });

  it("always answers with a real configured county, even for junk input", () => {
    expect(COUNTIES_MAP[countyForView(NaN, -95.37)]).toBeTruthy();
    expect(COUNTIES_MAP[countyForView(undefined, undefined)]).toBeTruthy();
  });

  it("leaves click routing untouched (candidate[0] is still harris-first when away)", () => {
    expect(candidateCountiesForPoint(31.9686, -102.0779)[0]).toBe("harris");
  });
});

/* B1339920 — Maricopa (Phoenix) was wired to NOTHING, so every Phoenix-area click fell into
 * `az_pinal`'s bbox (Pinal's own measured data extent overlaps the southern edge of Maricopa
 * County) and queried a service that genuinely has no Phoenix parcels — measured live: zero
 * features. `az_maricopa` is now its own entry; these are the exact points the dispatch measured,
 * so a regression here is caught before it ever reaches a live click again. */
describe("Maricopa/Pinal AZ routing (B1339920) — Phoenix must never fall into Pinal's bbox", () => {
  const PHOENIX = [33.4484, -112.0740];
  const MESA = [33.4152, -111.8315];
  const SURPRISE = [33.6292, -112.3680];
  const BUCKEYE = [33.3703, -112.5838];
  const CASA_GRANDE = [32.8795, -111.7574];
  const APACHE_JUNCTION = [33.4151, -111.5496];

  it("az_maricopa is wired to the county's own gis.maricopa.gov service, not Pinal's", () => {
    expect(COUNTIES_MAP.az_maricopa).toBeTruthy();
    expect(COUNTIES_MAP.az_maricopa.layerUrl).toMatch(/^https:\/\/gis\.maricopa\.gov\//);
    expect(COUNTIES_MAP.az_maricopa.layerUrl).not.toBe(COUNTIES_MAP.az_pinal.layerUrl);
  });

  it("every Maricopa-metro point candidateCountiesForPoint measured live now includes az_maricopa", () => {
    for (const [lat, lng] of [PHOENIX, MESA, SURPRISE, BUCKEYE]) {
      expect(candidateCountiesForPoint(lat, lng)).toContain("az_maricopa");
    }
  });

  it("Buckeye and Surprise (outside Pinal's bbox entirely) route to az_maricopa only, no wasted query", () => {
    expect(candidateCountiesForPoint(...SURPRISE)).not.toContain("az_pinal");
    expect(candidateCountiesForPoint(...BUCKEYE)).not.toContain("az_pinal");
  });

  it("Pinal's own verified points (Casa Grande, Apache Junction) still route to az_pinal — unchanged", () => {
    expect(candidateCountiesForPoint(...CASA_GRANDE)).toContain("az_pinal");
    expect(candidateCountiesForPoint(...APACHE_JUNCTION)).toContain("az_pinal");
  });

  it("countyForView names Maricopa for Phoenix, never Pinal (the jurisdiction the header pill shows)", () => {
    expect(countyForView(...PHOENIX)).toBe("az_maricopa");
  });

  it("countyForView still names Pinal for its own verified points — this fix must not regress them", () => {
    expect(countyForView(...CASA_GRANDE)).toBe("az_pinal");
    expect(countyForView(...APACHE_JUNCTION)).toBe("az_pinal");
  });
});

/* B209502 — NAMING A GAP HONESTLY. `countyIdentity` / `noParcelSourceNote` are the second half of the
 * bbox fix: a click in one of the ~245 Texas counties with no configured CAD must NAME that county
 * and say there is no parcel data, never inherit a neighbour's. These guard the pure half AND the
 * wiring — the exports existed for a while with no call site, which is the B1120 failure mode
 * (merged, green, and doing nothing), so the source guard below is deliberate. */
describe("countyIdentity / noParcelSourceNote (B209502)", () => {
  it("reports `pending` before the geometry is resident — never a guess", () => {
    // The unit environment never loads the asset, so this is the cold-start contract.
    const id = countyIdentity(29.55, -95.29);
    expect(id.status).toBe("pending");
    expect(noParcelSourceNote(id)).toBeNull();
  });

  it("says nothing for a resolved county that HAS a parcel source", () => {
    expect(noParcelSourceNote({ status: "ok", key: "harris", name: "Harris", state: "TX" })).toBeNull();
  });

  it("names the county — with the right suffix per state — when nothing is wired there", () => {
    expect(noParcelSourceNote({ status: "no-source", key: null, name: "Walker", state: "TX" }))
      .toBe("Walker County — no parcel data wired here yet.");
    // Colorado rows read as bare county names in this app's copy, so no "County" suffix.
    expect(noParcelSourceNote({ status: "no-source", key: null, name: "Mesa", state: "CO" }))
      .toBe("Mesa — no parcel data wired here yet.");
  });

  // B1361425 — every state OTHER than Texas now carries geometry from the nationwide Esri source,
  // whose names already include their own correct designation ("Orleans Parish", "Denali Borough",
  // "Fairfax city") — appending " County" universally (the pre-B1361425 rule: "every state but
  // Colorado gets County") would misname a parish as a county. The suffix is TX-only now, not
  // "every state but CO"; this proves the fix directly against the specific defect it closes.
  it("never double-suffixes a name that already carries its own designation (a parish, a borough, an independent city)", () => {
    expect(noParcelSourceNote({ status: "no-source", key: null, name: "Orleans Parish", state: "LA" }))
      .toBe("Orleans Parish — no parcel data wired here yet.");
    expect(noParcelSourceNote({ status: "no-source", key: null, name: "Denali Borough", state: "AK" }))
      .toBe("Denali Borough — no parcel data wired here yet.");
    expect(noParcelSourceNote({ status: "no-source", key: null, name: "Fairfax city", state: "VA" }))
      .toBe("Fairfax city — no parcel data wired here yet.");
  });

  it("is actually WIRED into the click path (B1120 — an unused export ships nothing)", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/import \{[^}]*countyIdentity[^}]*\} from "\.\/lib\/counties\.js"/s);
    expect(src).toMatch(/noParcelSourceNote\(countyIdentity\(/);
  });
});

// NEW-1 (2026-09-02) — Harris is wired to a real source; every other county keeps the exact
// pre-existing graceful degrade (TAX_RATE_SOURCES.<county> === null → "not connected").
describe("resolveTaxRates — Harris wired, everyone else unchanged (NEW-1)", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.doUnmock("../src/workspaces/site-planner/lib/harrisTaxRates.js"); vi.clearAllMocks(); });

  it("fortbend/chambers still report the honest not-connected note, byte-identical to before", async () => {
    const { resolveTaxRates } = await import("../src/workspaces/site-planner/lib/counties.js");
    const r1 = await resolveTaxRates("fortbend", { some_field: "x" });
    expect(r1).toEqual({ units: [], rates: null, total: null, connected: false, note: "Rate source not connected for fortbend." });
    const r2 = await resolveTaxRates("chambers", null);
    expect(r2.connected).toBe(false);
    expect(r2.note).toBe("Rate source not connected for chambers.");
  });

  it("harris with no lng/lat degrades honestly rather than guessing a location", async () => {
    const { resolveTaxRates } = await import("../src/workspaces/site-planner/lib/counties.js");
    const r = await resolveTaxRates("harris", { OWNER_NAME: "X" });
    expect(r.connected).toBe(false);
    expect(r.note).toMatch(/Location unavailable/);
  });

  it("harris with lng/lat delegates to resolveHarrisTaxRates and returns its result verbatim", async () => {
    vi.doMock("../src/workspaces/site-planner/lib/harrisTaxRates.js", () => ({
      resolveHarrisTaxRates: vi.fn(async ({ lng, lat }) => ({
        units: [{ name: "Harris County", value: "0.38096 / $100" }],
        rates: null, total: 0.38096, connected: true, taxYear: 2025, versionDate: "01/28/2026",
        source: "Texas Comptroller of Public Accounts — Rates and Levies", note: "stub", lng, lat,
      })),
    }));
    const { resolveTaxRates } = await import("../src/workspaces/site-planner/lib/counties.js");
    const r = await resolveTaxRates("harris", {}, { lng: -95.78, lat: 29.99 });
    expect(r.connected).toBe(true);
    expect(r.taxYear).toBe(2025);
    expect(r.total).toBeCloseTo(0.38096, 5);
    expect(r.lng).toBe(-95.78); // proves the real lng/lat were threaded through, not swallowed
  });

  it("a thrown fetch failure from the harris resolver degrades to connected:false with the reason, never an uncaught rejection", async () => {
    vi.doMock("../src/workspaces/site-planner/lib/harrisTaxRates.js", () => ({
      resolveHarrisTaxRates: vi.fn(async () => { throw new Error("Comptroller upstream unreachable"); }),
    }));
    const { resolveTaxRates } = await import("../src/workspaces/site-planner/lib/counties.js");
    const r = await resolveTaxRates("harris", {}, { lng: -95.78, lat: 29.99 });
    expect(r.connected).toBe(false);
    expect(r.note).toMatch(/Comptroller upstream unreachable/);
  });
});

// B1332016 continuation (2026-09-08) — Hawaii/Maryland/Nebraska/New Hampshire were measured live
// from the owner's own browser (docs/STATEWIDE-PARCELS.md), not this sandbox, and wired following
// the EXACT existing `<state>_statewide` shape: no bbox, `statewide: true`, no idField/addrField
// hints (the app's own live field auto-detect handles absence — the hint fields are only ever a
// fallback for when detection comes up empty, per counties.js's own module header).
describe("B1332016 continuation — HI/MD/NE/NH statewide composites", () => {
  const NEW_STATES = [
    ["hi_statewide", "HI"],
    ["md_statewide", "MD"],
    ["ne_statewide", "NE"],
    ["nh_statewide", "NH"],
  ];

  it.each(NEW_STATES)("%s is wired as a real statewide composite for %s", (key, state) => {
    const entry = COUNTIES_MAP[key];
    expect(entry, key).toBeTruthy();
    expect(entry.state).toBe(state);
    expect(entry.statewide).toBe(true);
    expect(entry.bbox).toBeUndefined(); // must never win a click by extent — appended fallback only
    expect(entry.mapServer).toBeNull();
    expect(typeof entry.layerUrl).toBe("string");
    expect(entry.layerUrl.length).toBeGreaterThan(0);
    // No hand-typed idField/addrField — absent fields (MD owner name; NH/HI owner+value) must
    // read as absent via live detection, never as a fabricated hint pointing at nothing.
    expect(entry.idField).toBeUndefined();
    expect(entry.addrField).toBeUndefined();
  });

  it("Hawaii is wired to layer 25 ('Statewide TMKs'), never layer 0 (a group layer) or a per-county layer", () => {
    expect(COUNTIES_MAP.hi_statewide.layerUrl).toMatch(/\/ParcelsZoning\/MapServer\/25$/);
  });

  it("New Hampshire is wired to layer 1 ('Parcels', polygon), never layer 0 ('Parcel Points', point geometry)", () => {
    expect(COUNTIES_MAP.nh_statewide.layerUrl).toMatch(/\/ParcelMosaic\/MapServer\/1$/);
  });

  it("each new state is queryable everywhere in its state as the trailing fallback (same contract as every other statewide key)", () => {
    for (const [key] of NEW_STATES) {
      expect(STATEWIDE_KEYS).toContain(key);
    }
  });

  it("Mississippi is deliberately NOT wired — it ships as two half-state services and wiring only one would silently present half the state as the whole", () => {
    expect(COUNTIES_MAP.ms_statewide).toBeUndefined();
    expect(COUNTIES_MAP.ms_east_statewide).toBeUndefined();
    expect(COUNTIES_MAP.ms_west_statewide).toBeUndefined();
  });
});

// countyBboxIntersectsView — the plausibility check behind the Texarkana/Chambers fix. Reported
// live: panned to Texarkana (Bowie County, far NE Texas) and the map named "Chambers County's live
// parcel server" as unavailable — Chambers being a Gulf Coast county ~300 miles away. The banner
// itself is `MapFinder`'s job (it can't be reached from a pure module); this is the pure predicate
// its guard is built on, so the geometry claim is provable without a browser.
describe("countyBboxIntersectsView (the Texarkana/Chambers fix)", () => {
  // A generous viewport around Texarkana, TX (≈33.44, -94.05) — plausible at any reasonable zoom.
  const texarkanaView = { south: 33.0, west: -94.6, north: 33.9, east: -93.5 };
  // A generous viewport around Chambers County's own center (≈29.7, -94.66).
  const chambersView = { south: 29.3, west: -95.0, north: 30.1, east: -94.3 };

  it("Chambers County's bbox does NOT reach a Texarkana viewport — the reported case", () => {
    expect(countyBboxIntersectsView("chambers", texarkanaView)).toBe(false);
  });

  it("Chambers County's bbox DOES reach a viewport actually over Chambers County", () => {
    expect(countyBboxIntersectsView("chambers", chambersView)).toBe(true);
  });

  it("a viewport straddling a county's bbox edge still counts as reaching it", () => {
    const c = COUNTIES_MAP.harris.bbox; // [minLat, minLng, maxLat, maxLng]
    const straddling = { south: c[0] - 1, west: c[1] - 1, north: c[0] + 0.01, east: c[1] + 0.01 };
    expect(countyBboxIntersectsView("harris", straddling)).toBe(true);
  });

  it("a viewport just past a county's bbox on every side does not reach it", () => {
    const c = COUNTIES_MAP.harris.bbox;
    const justPast = { south: c[2] + 1, west: c[3] + 1, north: c[2] + 2, east: c[3] + 2 };
    expect(countyBboxIntersectsView("harris", justPast)).toBe(false);
  });

  it("an unconfigured or bbox-less key (a statewide composite) always stays plausible — never silence a real notice on a resolution gap", () => {
    expect(countyBboxIntersectsView("txgio_statewide", texarkanaView)).toBe(true);
    expect(countyBboxIntersectsView("not_a_real_key", texarkanaView)).toBe(true);
  });

  it("no bounds given (map not ready) stays plausible rather than suppress", () => {
    expect(countyBboxIntersectsView("chambers", null)).toBe(true);
  });
});

/* ⛔ B1574257 — THE DESIGNATION STRIP IS ONLY SAFE WHILE IT COLLAPSES NOTHING.
 *
 * `countyKeyForName` drops a county-equivalent designation ("County", "Parish", "Borough",
 * "Census Area", "Municipality") before slugging a display name into a routing key. That is what
 * makes a Louisiana parish reachable at all — but a designation strip is exactly the kind of change
 * that can silently make two DIFFERENT places in one state answer to the SAME key, which is the
 * wrong-county class this repo has already paid for twice (Pearland, Casa Grande).
 *
 * So the widening was measured, not reasoned about, and the measurement is pinned here against the
 * REAL committed asset rather than a fixture: across all 3,144 rows, widening the strip adds ZERO
 * new same-state collapses. The six that remain are pre-existing, predate this change, are produced
 * by the older `\bcity\b` strip, and are all independent-city/county pairs — none of which is a
 * configured county today. Baselined at their exact count so a future widening (adding "Township",
 * say) goes RED here instead of quietly resolving a click to the wrong place. */
describe("B1574257 — the county-designation strip introduces no new key collisions", () => {
  const roster = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")).counties;

  // The slug half of `countyKeyForName`, before and after the widening. Kept literal on purpose:
  // importing the real one would make this test agree with the code by construction.
  const slug = (name, designations) => String(name).toLowerCase()
    .replace(designations, "").replace(/\b(city|and|of)\b/g, "").replace(/[^a-z]/g, "");
  const NARROW = /\bcounty\b/g;                                              // pre-B1574257
  const WIDE = /\b(county|parish|borough|census area|municipality)\b/g;      // shipped

  const collisionsUnder = (designations) => {
    const seen = new Map(), out = [];
    for (const r of roster) {
      const k = `${r.state}_${slug(r.name, designations)}`;
      if (seen.has(k)) out.push(`${k}: ${seen.get(k)} + ${r.name}`);
      else seen.set(k, r.name);
    }
    return out.sort();
  };

  it("the asset is the real one, with the whole country in it (vacuity guard)", () => {
    expect(roster.length).toBeGreaterThan(3000);
    expect(roster.filter((r) => r.state === "LA").length).toBe(64); // Louisiana's 64 parishes
  });

  it("widening the strip adds NOTHING to the collision set", () => {
    expect(collisionsUnder(WIDE)).toEqual(collisionsUnder(NARROW));
  });

  it("the pre-existing collisions are exactly the six independent-city/county pairs, and none is configured", () => {
    const pre = collisionsUnder(NARROW);
    expect(pre).toHaveLength(6);
    expect(pre.join(" | ")).toMatch(/MD_baltimore.*MO_stlouis.*VA_fairfax.*VA_franklin.*VA_richmond.*VA_roanoke/);
    for (const key of ["md_baltimore", "mo_stlouis", "va_fairfax", "va_franklin", "va_richmond", "va_roanoke"]) {
      expect(COUNTIES_MAP[key], key).toBeUndefined();
    }
  });

  it("no designation strips a name to nothing — an empty slug would key every such row alike", () => {
    expect(roster.filter((r) => !slug(r.name, WIDE))).toEqual([]);
  });
});

/* NEW-1 (2026-09-23) — 11 more Georgia counties, wired after re-deriving every endpoint from this
 * sandbox rather than trusting the dispatch's own URLs (two of which were a wrong-state source —
 * see counties.js's own NEW-1 comment block and docs/STATEWIDE-PARCELS.md's dated section). */
describe("NEW-1 (2026-09-23) — 11 more Georgia counties are registered and shaped correctly", () => {
  const GA_NEW_KEYS = [
    "ga_dekalb", "ga_clarke", "ga_columbia", "ga_lowndes", "ga_jackson",
    "ga_bibb", "ga_dougherty", "ga_rockdale", "ga_paulding", "ga_bulloch", "ga_camden",
  ];

  it("registers each county in both the search and map registries, state GA, with a real https URL", () => {
    for (const k of GA_NEW_KEYS) {
      expect(COUNTIES[k], k).toBeTruthy();
      expect(COUNTIES_MAP[k], k).toBeTruthy();
      expect(COUNTIES[k].state, k).toBe("GA");
      expect(COUNTIES_MAP[k].state, k).toBe("GA");
      expect(COUNTIES[k].layerUrl, k).toMatch(/^https:\/\//);
      expect(COUNTIES_MAP[k].layerUrl, k).toBe(COUNTIES[k].layerUrl);
    }
  });

  it("gives every county a plausible Georgia bbox/center (never a 0,0 placeholder or a bbox outside the state)", () => {
    // Georgia's own generous bbox: lat 30.3-35.0, lng -85.6 to -80.8 (the same floor the dispatch's
    // own validation rule named).
    for (const k of GA_NEW_KEYS) {
      const c = COUNTIES_MAP[k];
      const [south, west, north, east] = c.bbox;
      expect(south, k).toBeGreaterThan(29.5);
      expect(north, k).toBeLessThan(35.5);
      expect(west, k).toBeGreaterThan(-86.0);
      expect(east, k).toBeLessThan(-80.0);
      expect(c.center[0], k).toBeGreaterThan(south);
      expect(c.center[0], k).toBeLessThan(north);
      expect(c.center[1], k).toBeGreaterThan(west);
      expect(c.center[1], k).toBeLessThan(east);
    }
  });

  it("countyKeyForName resolves each county's real display name to its key, scoped to GA", () => {
    expect(countyKeyForName("DeKalb", "GA")).toBe("ga_dekalb");
    expect(countyKeyForName("Clarke County", "GA")).toBe("ga_clarke");
    expect(countyKeyForName("Columbia", "GA")).toBe("ga_columbia");
    expect(countyKeyForName("Lowndes County", "GA")).toBe("ga_lowndes");
    expect(countyKeyForName("Jackson", "GA")).toBe("ga_jackson");
    expect(countyKeyForName("Bibb", "GA")).toBe("ga_bibb");
    expect(countyKeyForName("Dougherty County", "GA")).toBe("ga_dougherty");
    expect(countyKeyForName("Rockdale", "GA")).toBe("ga_rockdale");
    expect(countyKeyForName("Paulding", "GA")).toBe("ga_paulding");
    expect(countyKeyForName("Bulloch County", "GA")).toBe("ga_bulloch");
    expect(countyKeyForName("Camden", "GA")).toBe("ga_camden");
  });

  it("a point inside each county routes to it via candidateCountiesForPoint", () => {
    const POINTS = {
      ga_dekalb: [33.7712, -84.2966],       // Decatur
      ga_clarke: [33.9519, -83.3576],       // Athens
      ga_columbia: [33.5440, -82.2247],     // Evans
      ga_lowndes: [30.8327, -83.2785],      // Valdosta
      ga_jackson: [34.1187, -83.5719],      // Jefferson, GA
      ga_bibb: [32.8407, -83.6324],         // Macon
      ga_dougherty: [31.5785, -84.1557],    // Albany
      ga_rockdale: [33.6698, -84.0177],     // Conyers
      ga_paulding: [33.9282, -84.8752],     // Dallas, GA
      ga_bulloch: [32.4488, -81.7832],      // Statesboro
      ga_camden: [30.8027, -81.6104],       // Kingsland
    };
    for (const [k, [lat, lng]] of Object.entries(POINTS)) {
      expect(candidateCountiesForPoint(lat, lng), k).toContain(k);
    }
  });

  it("adds no shared-URL conflict — each new county's layer is queried and health-checked once", () => {
    expect(sharedLayerUrlConflicts()).toEqual([]);
  });

  it("⛔ the two dispatch wrong-source traps stay closed: no ga_walton key, and ga_paulding never resolves to the Ohio Hub host", () => {
    expect(COUNTIES_MAP.ga_walton).toBeUndefined();
    expect(COUNTIES_MAP.ga_paulding.layerUrl).not.toMatch(/pcaud/i);
    expect(COUNTIES_MAP.ga_paulding.layerUrl).not.toMatch(/WaltonCountyPropeties/i);
  });

  it("never returns a Georgia county for a point in another state (Athens GA vs. a same-named location elsewhere)", () => {
    // A point solidly in downtown Houston, TX must never pick up a Georgia key.
    const houston = candidateCountiesForPoint(29.76, -95.37);
    for (const k of GA_NEW_KEYS) expect(houston, k).not.toContain(k);
  });
});

/* NEW-1 (2026-09-24) — Tift County, GA, the first county wired through the same-origin
 * /gis-proxy/ pass-through (functions/gis-proxy/[[path]].js) rather than a direct https:// URL,
 * proving out CORS-blocked county hosts can be reached at all. See countiesProvenance.js for the
 * measured facts (19,194 parcels, no ACAO header from www.sgrcmaps.com) and
 * docs/STATEWIDE-PARCELS.md's "GIS pass-through" section for the mechanism. */
describe("NEW-1 (2026-09-24) — ga_tift is wired through the GIS pass-through, not a direct URL", () => {
  it("registers in both registries, state GA, with a root-relative /gis-proxy/ layerUrl (not https)", () => {
    expect(COUNTIES.ga_tift).toBeTruthy();
    expect(COUNTIES_MAP.ga_tift).toBeTruthy();
    expect(COUNTIES.ga_tift.state).toBe("GA");
    expect(COUNTIES_MAP.ga_tift.state).toBe("GA");
    expect(COUNTIES.ga_tift.layerUrl).toMatch(/^\/gis-proxy\/www\.sgrcmaps\.com\//);
    expect(COUNTIES.ga_tift.layerUrl).not.toMatch(/^https?:\/\//);
    expect(COUNTIES_MAP.ga_tift.layerUrl).toBe(COUNTIES.ga_tift.layerUrl);
  });

  it("the proxy path names the real upstream host + the county's own layer path", () => {
    expect(COUNTIES.ga_tift.layerUrl).toBe(
      "/gis-proxy/www.sgrcmaps.com/alma/rest/services/Tift/Tift_Parcels/MapServer/0"
    );
  });

  it("idField/addrField are the real measured field names (ParcelNum/Situs), not a guess — confirmed live through the deployed proxy against this PR's own preview build", () => {
    expect(COUNTIES.ga_tift.idField).toBe("ParcelNum");
    expect(COUNTIES.ga_tift.addrField).toBe("Situs");
  });

  it("gives Tift County a bbox/center derived from public/geo/county-polygons.json (never a placeholder), and it contains Tifton", () => {
    const c = COUNTIES_MAP.ga_tift;
    const [south, west, north, east] = c.bbox;
    // Georgia's own generous bbox floor, same convention as the sibling GA-county suite above.
    expect(south).toBeGreaterThan(29.5);
    expect(north).toBeLessThan(35.5);
    expect(west).toBeGreaterThan(-86.0);
    expect(east).toBeLessThan(-80.0);
    // Tifton, GA (the county seat) sits inside the county's own bbox.
    const TIFTON = [31.4504, -83.5085];
    expect(TIFTON[0]).toBeGreaterThan(south);
    expect(TIFTON[0]).toBeLessThan(north);
    expect(TIFTON[1]).toBeGreaterThan(west);
    expect(TIFTON[1]).toBeLessThan(east);
    expect(c.center[0]).toBeGreaterThan(south);
    expect(c.center[0]).toBeLessThan(north);
  });

  it("countyKeyForName resolves 'Tift County' scoped to GA", () => {
    expect(countyKeyForName("Tift County", "GA")).toBe("ga_tift");
    expect(countyKeyForName("Tift", "GA")).toBe("ga_tift");
  });

  it("a point at Tifton routes to ga_tift via candidateCountiesForPoint", () => {
    expect(candidateCountiesForPoint(31.4504, -83.5085)).toContain("ga_tift");
  });

  it("never resolves for a point outside Georgia (no Texas/Houston cross-over)", () => {
    expect(candidateCountiesForPoint(29.76, -95.37)).not.toContain("ga_tift"); // downtown Houston, TX
    const houstonCounty = countyForView(29.76, -95.37);
    expect(houstonCounty).not.toBe("ga_tift");
  });

  it("adds no shared-URL conflict with any other county's layer", () => {
    expect(sharedLayerUrlConflicts()).toEqual([]);
  });
});

/* NEW-2 (2026-09-23) — 11 MORE Georgia counties, measured on Michael's own signed-in Chrome
 * (this sandbox's egress policy blocks every one of these county-owned hosts) — amends B1870704/
 * NEW-1 above. Also fixes two field-mapping defects (Jackson/Bibb id search, Rockdale address
 * search) via `pinIdField`/`pinAddrField` — covered end to end in test/parcelQuery.test.js;
 * this file only pins that the county rows themselves carry the pin. */
describe("NEW-2 (2026-09-23) — 11 more Georgia counties (B1873776, amends B1870704)", () => {
  const GA_SECOND_PASS_KEYS = [
    "ga_forsyth", "ga_henry", "ga_clayton", "ga_cherokee", "ga_coweta", "ga_glynn",
    "ga_screven", "ga_bryan", "ga_liberty", "ga_bartow", "ga_cobb",
  ];

  it("registers each county in both the search and map registries, state GA, with a real https URL", () => {
    for (const k of GA_SECOND_PASS_KEYS) {
      expect(COUNTIES[k], k).toBeTruthy();
      expect(COUNTIES_MAP[k], k).toBeTruthy();
      expect(COUNTIES[k].state, k).toBe("GA");
      expect(COUNTIES_MAP[k].state, k).toBe("GA");
      expect(COUNTIES[k].layerUrl, k).toMatch(/^https:\/\//);
      expect(COUNTIES_MAP[k].layerUrl, k).toBe(COUNTIES[k].layerUrl);
    }
  });

  it("gives every county a plausible Georgia bbox/center (never a 0,0 placeholder or a bbox outside the state)", () => {
    for (const k of GA_SECOND_PASS_KEYS) {
      const c = COUNTIES_MAP[k];
      const [south, west, north, east] = c.bbox;
      expect(south, k).toBeGreaterThan(29.5);
      expect(north, k).toBeLessThan(35.5);
      expect(west, k).toBeGreaterThan(-86.0);
      expect(east, k).toBeLessThan(-80.0);
      expect(c.center[0], k).toBeGreaterThan(south);
      expect(c.center[0], k).toBeLessThan(north);
      expect(c.center[1], k).toBeGreaterThan(west);
      expect(c.center[1], k).toBeLessThan(east);
    }
  });

  it("Georgia now has 60 county keys in both registries (25 pre-existing (first + second pass) + ga_tift (B1874880) + 34 third pass, this batch)", () => {
    const gaInCounties = Object.entries(COUNTIES).filter(([, c]) => c.state === "GA").map(([k]) => k);
    const gaInMap = Object.entries(COUNTIES_MAP).filter(([, c]) => c.state === "GA").map(([k]) => k);
    expect(gaInCounties).toHaveLength(60);
    expect(gaInMap).toHaveLength(60);
  });

  it("countyKeyForName resolves each county's real display name to its key, scoped to GA", () => {
    expect(countyKeyForName("Forsyth", "GA")).toBe("ga_forsyth");
    expect(countyKeyForName("Henry County", "GA")).toBe("ga_henry");
    expect(countyKeyForName("Clayton", "GA")).toBe("ga_clayton");
    expect(countyKeyForName("Cherokee County", "GA")).toBe("ga_cherokee");
    expect(countyKeyForName("Coweta", "GA")).toBe("ga_coweta");
    expect(countyKeyForName("Glynn County", "GA")).toBe("ga_glynn");
    expect(countyKeyForName("Screven", "GA")).toBe("ga_screven");
    expect(countyKeyForName("Bryan County", "GA")).toBe("ga_bryan");
    expect(countyKeyForName("Liberty", "GA")).toBe("ga_liberty");
    expect(countyKeyForName("Bartow County", "GA")).toBe("ga_bartow");
    expect(countyKeyForName("Cobb", "GA")).toBe("ga_cobb");
  });

  it("routes each county seat to its own key via candidateCountiesForPoint", () => {
    const SEATS = {
      ga_forsyth: [34.2073, -84.1402],   // Cumming
      ga_henry: [33.4473, -84.1469],     // McDonough
      ga_clayton: [33.5212, -84.3552],   // Jonesboro
      ga_cherokee: [34.2367, -84.4919],  // Canton
      ga_coweta: [33.3809, -84.7997],    // Newnan
      ga_glynn: [31.1495, -81.4912],     // Brunswick
      ga_screven: [32.7529, -81.6365],   // Sylvania
      ga_bryan: [31.9342, -81.3084],     // Richmond Hill
      ga_liberty: [31.8468, -81.5960],   // Hinesville
      ga_bartow: [34.1651, -84.7999],    // Cartersville
      ga_cobb: [33.9526, -84.5499],      // Marietta
    };
    for (const [k, [lat, lng]] of Object.entries(SEATS)) {
      expect(candidateCountiesForPoint(lat, lng), k).toContain(k);
    }
  });

  // B1873776 — the Cherokee/Cobb bboxes overlap (a normal axis-aligned-rectangle artifact of two
  // real, non-overlapping county polygons whose shared line isn't a straight east-west edge), so a
  // point in the overlap band must still resolve to the RIGHT one of the two, not just "one of the
  // candidates". countyForView's nearest-center tie-break (the polygon geometry asset isn't warmed
  // in this unit-test process, so this exercises exactly the fallback path a cold click would use)
  // is what decides it — never config order.
  it("a Woodstock point resolves to Cherokee, not the overlapping Cobb rectangle", () => {
    expect(countyForView(34.1015, -84.5195)).toBe("ga_cherokee"); // Woodstock, GA
  });

  it("a point toward Cobb's own northern edge (inside the Cherokee bbox overlap band) resolves to Cobb", () => {
    expect(countyForView(34.085, -84.56)).toBe("ga_cobb");
  });

  it("adds no shared-URL conflict — each new county's layer is queried and health-checked once", () => {
    expect(sharedLayerUrlConflicts()).toEqual([]);
  });

  it("Long and Walton stay unwired (no usable public parcel source, per this session's own record)", () => {
    expect(COUNTIES_MAP.ga_long).toBeUndefined();
    expect(COUNTIES_MAP.ga_walton).toBeUndefined();
  });

  it("a same-named Texas county (Liberty) still resolves to Texas, never to the new Georgia Liberty", () => {
    const [lat, lng] = [30.19, -94.80]; // Liberty County, TX's own configured center
    const cand = candidateCountiesForPoint(lat, lng);
    expect(cand).toContain("liberty");
    expect(cand).not.toContain("ga_liberty");
    expect(countyForView(lat, lng)).toBe("liberty");
  });

  it("never returns a Georgia county for a point in another state", () => {
    const houston = candidateCountiesForPoint(29.76, -95.37);
    for (const k of GA_SECOND_PASS_KEYS) expect(houston, k).not.toContain(k);
  });
});

/* NEW-1 (2026-09-24, third pass) — 34 more Georgia counties, amending B1870704 a second time
 * (the first amendment is the "NEW-1 (2026-09-23)" block above — ga_dekalb..ga_camden). These
 * were MEASURED from Michael's own signed-in Chrome, not re-derived from this sandbox (every
 * host here is egress-blocked) — see counties.js's own NEW-1 (2026-09-24) header. */
describe("NEW-1 (2026-09-24, third pass) — 34 more Georgia counties are registered and shaped correctly", () => {
  const GA_THIRD_PASS_KEYS = [
    "ga_richmond", "ga_whitfield", "ga_hall", "ga_effingham", "ga_fayette", "ga_spalding",
    "ga_newton", "ga_barrow", "ga_oconee", "ga_butts", "ga_monroe", "ga_troup",
    "ga_peach", "ga_muscogee", "ga_morgan", "ga_baldwin", "ga_brantley", "ga_charlton",
    "ga_clay", "ga_cook", "ga_crawford", "ga_crisp", "ga_dade", "ga_dooly",
    "ga_echols", "ga_emanuel", "ga_evans", "ga_greene", "ga_lanier", "ga_meriwether",
    "ga_sumter", "ga_turner", "ga_twiggs", "ga_ware",
  ];

  it("registers each county in both the search and map registries, state GA, with a real https URL", () => {
    for (const k of GA_THIRD_PASS_KEYS) {
      expect(COUNTIES[k], k).toBeTruthy();
      expect(COUNTIES_MAP[k], k).toBeTruthy();
      expect(COUNTIES[k].state, k).toBe("GA");
      expect(COUNTIES_MAP[k].state, k).toBe("GA");
      expect(COUNTIES[k].layerUrl, k).toMatch(/^https:\/\//);
      expect(COUNTIES_MAP[k].layerUrl, k).toBe(COUNTIES[k].layerUrl);
    }
  });

  it("gives every county a plausible Georgia bbox/center (never a 0,0 placeholder or a bbox outside the state)", () => {
    for (const k of GA_THIRD_PASS_KEYS) {
      const c = COUNTIES_MAP[k];
      const [south, west, north, east] = c.bbox;
      expect(south, k).toBeGreaterThan(29.5);
      expect(north, k).toBeLessThan(35.5);
      expect(west, k).toBeGreaterThan(-86.0);
      expect(east, k).toBeLessThan(-80.0);
      expect(c.center[0], k).toBeGreaterThan(south);
      expect(c.center[0], k).toBeLessThan(north);
      expect(c.center[1], k).toBeGreaterThan(west);
      expect(c.center[1], k).toBeLessThan(east);
    }
  });

  it("countyKeyForName resolves each county's real display name to its key, scoped to GA", () => {
    expect(countyKeyForName("Richmond", "GA")).toBe("ga_richmond");
    expect(countyKeyForName("Whitfield", "GA")).toBe("ga_whitfield");
    expect(countyKeyForName("Hall", "GA")).toBe("ga_hall");
    expect(countyKeyForName("Effingham", "GA")).toBe("ga_effingham");
    expect(countyKeyForName("Fayette", "GA")).toBe("ga_fayette");
    expect(countyKeyForName("Spalding", "GA")).toBe("ga_spalding");
    expect(countyKeyForName("Newton", "GA")).toBe("ga_newton");
    expect(countyKeyForName("Barrow", "GA")).toBe("ga_barrow");
    expect(countyKeyForName("Oconee", "GA")).toBe("ga_oconee");
    expect(countyKeyForName("Butts", "GA")).toBe("ga_butts");
    expect(countyKeyForName("Monroe", "GA")).toBe("ga_monroe");
    expect(countyKeyForName("Troup", "GA")).toBe("ga_troup");
    expect(countyKeyForName("Peach", "GA")).toBe("ga_peach");
    expect(countyKeyForName("Muscogee", "GA")).toBe("ga_muscogee");
    expect(countyKeyForName("Morgan", "GA")).toBe("ga_morgan");
    expect(countyKeyForName("Baldwin", "GA")).toBe("ga_baldwin");
    expect(countyKeyForName("Brantley", "GA")).toBe("ga_brantley");
    expect(countyKeyForName("Charlton", "GA")).toBe("ga_charlton");
    expect(countyKeyForName("Clay", "GA")).toBe("ga_clay");
    expect(countyKeyForName("Cook", "GA")).toBe("ga_cook");
    expect(countyKeyForName("Crawford", "GA")).toBe("ga_crawford");
    expect(countyKeyForName("Crisp", "GA")).toBe("ga_crisp");
    expect(countyKeyForName("Dade", "GA")).toBe("ga_dade");
    expect(countyKeyForName("Dooly", "GA")).toBe("ga_dooly");
    expect(countyKeyForName("Echols", "GA")).toBe("ga_echols");
    expect(countyKeyForName("Emanuel", "GA")).toBe("ga_emanuel");
    expect(countyKeyForName("Evans", "GA")).toBe("ga_evans");
    expect(countyKeyForName("Greene", "GA")).toBe("ga_greene");
    expect(countyKeyForName("Lanier", "GA")).toBe("ga_lanier");
    expect(countyKeyForName("Meriwether", "GA")).toBe("ga_meriwether");
    expect(countyKeyForName("Sumter", "GA")).toBe("ga_sumter");
    expect(countyKeyForName("Turner", "GA")).toBe("ga_turner");
    expect(countyKeyForName("Twiggs", "GA")).toBe("ga_twiggs");
    expect(countyKeyForName("Ware", "GA")).toBe("ga_ware");
  });

  it("resolves Georgia's hyphenated consolidated-government names to their real county key", () => {
    expect(countyKeyForName("Augusta-Richmond", "GA")).toBe("ga_richmond");
    expect(countyKeyForName("Athens-Clarke", "GA")).toBe("ga_clarke");
    expect(countyKeyForName("Athens-Clarke County", "GA")).toBe("ga_clarke");
  });

  it("a point at each county seat routes to it via candidateCountiesForPoint", () => {
    const SEATS = {
      ga_richmond: [33.4735, -82.0105],       // Augusta
      ga_whitfield: [34.7698, -84.9702],       // Dalton
      ga_hall: [34.2979, -83.8241],       // Gainesville
      ga_effingham: [32.3735, -81.3099],       // Springfield
      ga_fayette: [33.4487, -84.455],       // Fayetteville
      ga_spalding: [33.2465, -84.2641],       // Griffin
      ga_newton: [33.5966, -83.8602],       // Covington
      ga_barrow: [33.9926, -83.7201],       // Winder
      ga_oconee: [33.8607, -83.4102],       // Watkinsville
      ga_butts: [33.2946, -83.9694],       // Jackson, GA
      ga_monroe: [33.0357, -83.9313],       // Forsyth, GA
      ga_troup: [33.0362, -85.0322],       // LaGrange
      ga_peach: [32.5531, -83.8894],       // Fort Valley
      ga_muscogee: [32.461, -84.9877],       // Columbus
      ga_morgan: [33.597, -83.4685],       // Madison
      ga_baldwin: [33.0801, -83.2321],       // Milledgeville
      ga_brantley: [31.2035, -81.9848],       // Nahunta
      ga_charlton: [30.836, -82.0068],       // Folkston
      ga_clay: [31.6099, -85.053],       // Fort Gaines
      ga_cook: [31.1455, -83.4238],       // Adel
      ga_crawford: [32.7357, -83.9944],       // Knoxville
      ga_crisp: [31.9635, -83.7826],       // Cordele
      ga_dade: [34.8, -85.5],       // Trenton
      ga_dooly: [32.0918, -83.7955],       // Vienna
      ga_echols: [30.7016, -82.9979],       // Statenville
      ga_emanuel: [32.5954, -82.3335],       // Swainsboro
      ga_evans: [32.1613, -81.9057],       // Claxton
      ga_greene: [33.5754, -83.1832],       // Greensboro
      ga_lanier: [31.0421, -83.0738],       // Lakeland
      ga_meriwether: [33.021, -84.7144],       // Greenville, GA
      ga_sumter: [32.0723, -84.2327],       // Americus
      ga_turner: [31.7099, -83.6535],       // Ashburn
      ga_twiggs: [32.6979, -83.3474],       // Jeffersonville
      ga_ware: [31.2136, -82.354],       // Waycross
    };
    for (const [k, [lat, lng]] of Object.entries(SEATS)) {
      expect(candidateCountiesForPoint(lat, lng), k).toContain(k);
    }
  });

  it("resolves the right county where two bboxes overlap (Peachtree City/Fayette, Griffin/Spalding-Butts, Winder/Barrow-Jackson-Gwinnett, Watkinsville/Oconee-Clarke)", () => {
    expect(candidateCountiesForPoint(33.3968, -84.5964)).toContain("ga_fayette"); // Peachtree City
    expect(candidateCountiesForPoint(33.2465, -84.2641)).toContain("ga_spalding"); // Griffin, not ga_butts
    expect(candidateCountiesForPoint(33.9926, -83.7201)).toContain("ga_barrow"); // Winder, not ga_jackson/ga_gwinnett
    expect(candidateCountiesForPoint(33.8607, -83.4102)).toContain("ga_oconee"); // Watkinsville, not ga_clarke
  });

  it("adds no shared-URL conflict (Barrow and Oconee deliberately share one FeatureServer at different layer ids, which is fine)", () => {
    expect(sharedLayerUrlConflicts()).toEqual([]);
  });

  it("no Texas cross-over — a same-named place in Texas must still resolve to Texas, never a Georgia key", () => {
    const TX_POINTS = {
      "Edna (Jackson, TX)": [28.9781, -96.6455],
      "Newton, TX": [30.8493, -93.7461],
      "Crockett (Houston, TX)": [31.3174, -95.4561],
      "Morgan, TX": [32.0201, -97.6339],
      "Huntsville (Walker, TX)": [30.7235, -95.5508],
    };
    for (const [label, [lat, lng]] of Object.entries(TX_POINTS)) {
      const cand = candidateCountiesForPoint(lat, lng);
      expect(cand, label).toContain("txgio_statewide");
      for (const k of GA_THIRD_PASS_KEYS) expect(cand, `${label} vs ${k}`).not.toContain(k);
    }
  });
});

/* NEW-1 (2026-09-24) — 17 Florida counties (Jacksonville + Polk/Lakeland markets, ~30mi radius of
 * each), all sharing ONE FDOR statewide layer (FL_STATEWIDE_LAYER in counties.js) via `scopeWhere`
 * on `CO_NO` — the Idaho shared-layer shape, not the per-county-CAD Georgia shape. Every CO_NO
 * value and every returned parcel below was independently confirmed with a LIVE point query
 * against the real service from this sandbox 2026-09-24 (services9.arcgis.com is reachable here,
 * unlike most county-own hosts this repo wires) — see countiesProvenance.js for the full record.
 *
 * ⛔ RECURRENCE (2026-09-24, B1885600 ×2) — Fernandina Beach's real coordinates used to be kept OUT
 * of this suite (Yulee, FL stood in for the seat/bbox and state-line tests) because the offline
 * nationwide county-polygon asset — built at the time from a GENERALIZED nationwide layer — clipped
 * Nassau County's own ring short of Amelia Island. That gap was live-measured to break real click
 * routing on the deployed build (b9722c7): no parcel query fired at all for a real Fernandina Beach
 * address. `build-county-polygons.mjs` now has FL's own dedicated FDEP shoreline source (the TX/CO
 * treatment), so Fernandina Beach's real coordinates are now the primary routing/bbox point for
 * fl_nassau below, and the "gap" test that used to document the clip is replaced with its inverse. */
describe("NEW-1 (2026-09-24) — 17 Florida counties are registered and shaped correctly (B1885600)", () => {
  const FL_KEYS = [
    "fl_duval", "fl_nassau", "fl_clay", "fl_stjohns", "fl_baker", "fl_polk", "fl_hillsborough",
    "fl_pasco", "fl_hernando", "fl_sumter", "fl_lake", "fl_orange", "fl_osceola", "fl_highlands",
    "fl_hardee", "fl_manatee", "fl_desoto",
  ];
  const FL_CO_NO = {
    fl_duval: 26, fl_nassau: 55, fl_clay: 20, fl_stjohns: 65, fl_baker: 12, fl_polk: 63,
    fl_hillsborough: 39, fl_pasco: 61, fl_hernando: 37, fl_sumter: 70, fl_lake: 45, fl_orange: 58,
    fl_osceola: 59, fl_highlands: 38, fl_hardee: 35, fl_manatee: 51, fl_desoto: 24,
  };
  // The routing/bbox test point for each county — its real seat. fl_nassau now uses Fernandina
  // Beach itself (was Yulee, before the FDEP-source fix made the county's own seat resolve).
  const SEATS = {
    fl_duval: [30.3255, -81.6579],       // Jacksonville
    fl_nassau: [30.6697, -81.4626],      // Fernandina Beach (Nassau County's own seat)
    fl_clay: [29.9911, -81.6787],        // Green Cove Springs
    fl_stjohns: [29.8947, -81.3145],     // St. Augustine
    fl_baker: [30.2827, -82.1265],       // Macclenny
    fl_polk: [27.8964, -81.8431],        // Bartow, FL (a city — not Bartow County, GA)
    fl_hillsborough: [27.9506, -82.4572],// Tampa
    fl_pasco: [28.3625, -82.1968],       // Dade City
    fl_hernando: [28.5553, -82.3879],    // Brooksville
    fl_sumter: [28.6650, -82.1101],      // Bushnell
    fl_lake: [28.8039, -81.7248],        // Tavares
    fl_orange: [28.5383, -81.3792],      // Orlando
    fl_osceola: [28.2920, -81.4076],     // Kissimmee
    fl_highlands: [27.4956, -81.4409],   // Sebring
    fl_hardee: [27.5372, -81.8095],      // Wauchula
    fl_manatee: [27.4989, -82.5748],     // Bradenton
    fl_desoto: [27.2153, -81.8592],      // Arcadia
  };

  it("registers each county in both the search and map registries, state FL, sharing the ONE FDOR layer", () => {
    for (const k of FL_KEYS) {
      expect(COUNTIES[k], k).toBeTruthy();
      expect(COUNTIES_MAP[k], k).toBeTruthy();
      expect(COUNTIES[k].state, k).toBe("FL");
      expect(COUNTIES_MAP[k].state, k).toBe("FL");
      expect(COUNTIES[k].layerUrl, k).toMatch(/^https:\/\//);
      expect(COUNTIES[k].layerUrl, k).toBe(COUNTIES.fl_duval.layerUrl); // ONE shared statewide layer
      expect(COUNTIES_MAP[k].layerUrl, k).toBe(COUNTIES[k].layerUrl);
    }
  });

  it("every row carries its own distinct, correct CO_NO scopeWhere — never a bare shared URL", () => {
    for (const k of FL_KEYS) {
      expect(COUNTIES[k].scopeWhere, k).toBe(`CO_NO = ${FL_CO_NO[k]}`);
    }
    const scopes = FL_KEYS.map((k) => COUNTIES[k].scopeWhere);
    expect(new Set(scopes).size, "every FL scopeWhere must be distinct").toBe(FL_KEYS.length);
  });

  it("every row pins idField (PARCEL_ID) and addrField (PHY_ADDR1) rather than trusting bare detection", () => {
    for (const k of FL_KEYS) {
      expect(COUNTIES[k].idField, k).toBe("PARCEL_ID");
      expect(COUNTIES[k].pinIdField, k).toBe(true);
      expect(COUNTIES[k].addrField, k).toBe("PHY_ADDR1");
      expect(COUNTIES[k].pinAddrField, k).toBe(true);
    }
  });

  it("gives every county a plausible Florida bbox/center (never a 0,0 placeholder or a bbox outside the state)", () => {
    // Florida's own generous bbox floor.
    for (const k of FL_KEYS) {
      const c = COUNTIES_MAP[k];
      const [south, west, north, east] = c.bbox;
      expect(south, k).toBeGreaterThan(24.3);
      expect(north, k).toBeLessThan(31.1);
      expect(west, k).toBeGreaterThan(-87.7);
      expect(east, k).toBeLessThan(-79.9);
      expect(c.center[0], k).toBeGreaterThan(south);
      expect(c.center[0], k).toBeLessThan(north);
      expect(c.center[1], k).toBeGreaterThan(west);
      expect(c.center[1], k).toBeLessThan(east);
    }
  });

  it("each bbox contains its own routing/seat point", () => {
    for (const k of FL_KEYS) {
      const [lat, lng] = SEATS[k];
      const [south, west, north, east] = COUNTIES_MAP[k].bbox;
      expect(lat, k).toBeGreaterThan(south);
      expect(lat, k).toBeLessThan(north);
      expect(lng, k).toBeGreaterThan(west);
      expect(lng, k).toBeLessThan(east);
    }
  });

  it("⛔ recurrence fix (B1885600 ×2): Fernandina Beach's own coordinates now fall INSIDE fl_nassau's computed bbox — this used to be a documented gap (the generalized-boundary clip) and is the exact live routing failure this fix closes", () => {
    const FERNANDINA_BEACH = [30.6697, -81.4626];
    const [south, west, north, east] = COUNTIES_MAP.fl_nassau.bbox;
    const inside = FERNANDINA_BEACH[0] > south && FERNANDINA_BEACH[0] < north
      && FERNANDINA_BEACH[1] > west && FERNANDINA_BEACH[1] < east;
    expect(inside, "Fernandina Beach must resolve inside fl_nassau's bbox now that FL rides its own dedicated FDEP source").toBe(true);
  });

  it("⛔ B1885600 (×2 recurrence) — barrier-island / coastal seats across the wired counties are real CLICK-ROUTING candidates against the rebuilt FDEP-sourced bbox, not just their inland seats (candidateCountiesForPoint is the click-routing contract; countyForView's nearest-CENTER fallback is a different, geometry-free approximation not exercised by this fix — see the sibling state-line test above for why bbox overlap near a border is by design)", () => {
    const FERNANDINA_BEACH = [30.67, -81.46];
    const ANNA_MARIA = [27.5301, -82.7407]; // Anna Maria city hall — the narrow barrier island itself
    const PONTE_VEDRA_BEACH = [30.24, -81.39];
    const JACKSONVILLE_BEACH = [30.29, -81.39];
    expect(candidateCountiesForPoint(...FERNANDINA_BEACH)).toContain("fl_nassau");
    expect(candidateCountiesForPoint(...ANNA_MARIA)).toContain("fl_manatee");
    expect(candidateCountiesForPoint(...PONTE_VEDRA_BEACH)).toContain("fl_stjohns");
    expect(candidateCountiesForPoint(...JACKSONVILLE_BEACH)).toContain("fl_duval");
  });

  it("⛔ B1885600 (×2 recurrence) — St. Marys, GA (the seat/state-line control) still returns ga_camden, unaffected by the Florida-side source swap", () => {
    const ST_MARYS_GA = [30.73, -81.55];
    expect(candidateCountiesForPoint(...ST_MARYS_GA)).toContain("ga_camden");
    expect(countyForView(...ST_MARYS_GA)).toBe("ga_camden");
  });

  it("countyKeyForName resolves each county's real display name to its key, scoped to FL — incl. the multi-word 'St. Johns' case", () => {
    expect(countyKeyForName("Duval", "FL")).toBe("fl_duval");
    expect(countyKeyForName("Nassau County", "FL")).toBe("fl_nassau");
    expect(countyKeyForName("Clay", "FL")).toBe("fl_clay");
    expect(countyKeyForName("St. Johns County", "FL")).toBe("fl_stjohns");
    expect(countyKeyForName("St. Johns", "FL")).toBe("fl_stjohns");
    // "Saint Johns" (spelled out) is NOT aliased — the nationwide county-polygon asset that feeds
    // real display names always spells it "St. Johns County" (confirmed against the committed
    // asset), so this never actually reaches countyKeyForName from a real caller. Documented here
    // rather than silently assumed to work.
    expect(countyKeyForName("Saint Johns", "FL")).toBeNull();
    expect(countyKeyForName("Baker", "FL")).toBe("fl_baker");
    expect(countyKeyForName("Polk", "FL")).toBe("fl_polk");
    expect(countyKeyForName("Hillsborough County", "FL")).toBe("fl_hillsborough");
    expect(countyKeyForName("Pasco", "FL")).toBe("fl_pasco");
    expect(countyKeyForName("Hernando", "FL")).toBe("fl_hernando");
    expect(countyKeyForName("Sumter", "FL")).toBe("fl_sumter");
    expect(countyKeyForName("Lake", "FL")).toBe("fl_lake");
    expect(countyKeyForName("Orange", "FL")).toBe("fl_orange");
    expect(countyKeyForName("Osceola", "FL")).toBe("fl_osceola");
    expect(countyKeyForName("Highlands", "FL")).toBe("fl_highlands");
    expect(countyKeyForName("Hardee", "FL")).toBe("fl_hardee");
    expect(countyKeyForName("Manatee", "FL")).toBe("fl_manatee");
    expect(countyKeyForName("DeSoto County", "FL")).toBe("fl_desoto");
  });

  it("a point at each county's routing point routes to it via candidateCountiesForPoint", () => {
    for (const [k, [lat, lng]] of Object.entries(SEATS)) {
      expect(candidateCountiesForPoint(lat, lng), k).toContain(k);
    }
  });

  it("state line — Yulee (Nassau, FL) and St. Marys/Kingsland (Camden, GA) each DECIDE to the right state's county via countyForView (candidateCountiesForPoint may legitimately list both as bbox-overlap candidates near a border — that's by design, same as the GA/TX overlap cases above)", () => {
    const YULEE = [30.6322, -81.5854];
    const ST_MARYS = [30.7305, -81.5495];
    const KINGSLAND = [30.8021, -81.6898];
    expect(candidateCountiesForPoint(...YULEE)).toContain("fl_nassau");
    expect(candidateCountiesForPoint(...YULEE)).not.toContain("ga_camden");
    expect(candidateCountiesForPoint(...YULEE)).not.toContain("ga_charlton");
    expect(candidateCountiesForPoint(...ST_MARYS)).toContain("ga_camden");
    expect(candidateCountiesForPoint(...KINGSLAND)).toContain("ga_camden");
    expect(countyForView(...YULEE)).toBe("fl_nassau");
    expect(countyForView(...ST_MARYS)).toBe("ga_camden");
    expect(countyForView(...KINGSLAND)).toBe("ga_camden");
  });

  it("Baker/Nassau, FL vs. Charlton, GA never cross (both touch the state line) — Folkston, GA DECIDES ga_charlton, never a Florida key", () => {
    // ⛔ B1885600 (×2 recurrence) — fl_nassau's padded bbox now legitimately reaches this point
    // (Folkston sits 30.836°N, and Nassau's own FDEP-sourced ring genuinely extends to 30.83°N
    // along the St. Marys River before the standard 0.02° border pad — a real, more accurate
    // extent than the old generalized source's 30.81°N, not a padding regression). That is exactly
    // the "candidateCountiesForPoint may legitimately list both as bbox-overlap candidates near a
    // border" contract the sibling state-line test above documents — the DECIDING answer is
    // countyForView, asserted below, never bbox membership alone.
    const FOLKSTON_GA = [30.836, -82.0068]; // ga_charlton seat
    const cand = candidateCountiesForPoint(...FOLKSTON_GA);
    expect(cand).toContain("ga_charlton");
    expect(cand).not.toContain("fl_baker");
    expect(countyForView(...FOLKSTON_GA)).toBe("ga_charlton");
  });

  it("Bartow, FL (Polk County's seat, a CITY) never resolves to Bartow County, GA, and vice versa", () => {
    const BARTOW_FL = [27.8964, -81.8431];
    const BARTOW_COUNTY_GA_SEAT = [34.2455, -84.8427]; // Cartersville, the real Bartow County GA seat
    const candFl = candidateCountiesForPoint(...BARTOW_FL);
    expect(candFl).toContain("fl_polk");
    expect(candFl).not.toContain("ga_bartow");
    const candGa = candidateCountiesForPoint(...BARTOW_COUNTY_GA_SEAT);
    expect(candGa).toContain("ga_bartow");
    expect(candGa).not.toContain("fl_polk");
    expect(countyForView(...BARTOW_COUNTY_GA_SEAT)).toBe("ga_bartow");
  });

  it("no Texas cross-over — Polk, Lake, Orange and Clay all exist as Texas counties too, and a Texas point must never pick up the Florida key", () => {
    const TX_POINTS = {
      "Livingston (Polk, TX)": [30.7108, -94.9327],
      "Lake, TX (unincorporated bbox center)": [29.55, -94.85],
      "Orange, TX": [30.0930, -93.7366],
      "Henderson (Rusk, TX; near Clay-adjacent naming)": [32.1532, -94.7996],
      "Jacksboro (Jack, TX — near-miss for 'Jacksonville')": [33.2187, -98.1595],
      "Jacksonville, TX (Cherokee County — the same city name as fl_duval's own seat)": [31.9646, -95.2702],
    };
    for (const [label, [lat, lng]] of Object.entries(TX_POINTS)) {
      const cand = candidateCountiesForPoint(lat, lng);
      for (const k of FL_KEYS) expect(cand, `${label} vs ${k}`).not.toContain(k);
    }
  });

  it("regression — a lot in Atlanta (Fulton, GA) and one in Houston (Harris, TX) are unaffected", () => {
    const ATLANTA = [33.7490, -84.3880];
    const HOUSTON = [29.76, -95.37];
    const candAtl = candidateCountiesForPoint(...ATLANTA);
    expect(candAtl).toContain("ga_fulton");
    for (const k of FL_KEYS) expect(candAtl, `Atlanta vs ${k}`).not.toContain(k);
    const candHou = candidateCountiesForPoint(...HOUSTON);
    expect(candHou).toContain("harris");
    for (const k of FL_KEYS) expect(candHou, `Houston vs ${k}`).not.toContain(k);
  });

  it("adds no shared-URL conflict — the FDOR layer is exempt as Florida's statewide composite (fl_statewide), so 17 rows sharing it is by design, not a defect", () => {
    expect(sharedLayerUrlConflicts()).toEqual([]);
  });

  it("fl_statewide itself stays the honest all-Florida fallback: statewide:true, no bbox, same URL as every scoped county row", () => {
    expect(COUNTIES_MAP.fl_statewide.statewide).toBe(true);
    expect(COUNTIES_MAP.fl_statewide.layerUrl).toBe(COUNTIES.fl_duval.layerUrl);
  });
});

/* ⛔ B1875248 recurrence (2026-09-24) — the parcel card showed the WinGAP layer's own row number
 * (FID/OBJECTID/OBJECTID_1) instead of the county's real parcel number, because `detectField`'s
 * plain alternation never ranked candidates against each other: whichever id-shaped column came
 * first in field order won, and a layer's row-identity column usually comes first. These field
 * lists are the ones actually measured on the affected counties (see B1875248's repro); every one
 * must resolve to the real parcel/account column, never the row-index column. */
describe("detectField('id') ranking (B1875248) — never OBJECTID/FID over a real parcel column", () => {
  const fieldsOf = (names) => names.map((name) => ({ name }));

  it("Effingham: PARCEL_NO beats FID/OBJECTID_1 and the shorter PIN/PIN400/WPIN columns", () => {
    expect(detectField(fieldsOf(["FID", "OBJECTID_1", "PARCEL_NO", "PIN", "PIN400", "WPIN", "L_PARCEL"]), "id"))
      .toBe("PARCEL_NO");
  });

  it("Barrow: Parcel_no beats FID and its own truncated duplicates (parcel_n_1, parcel_no2)", () => {
    expect(detectField(fieldsOf(["FID", "Parcel_no", "parcel_n_1", "parcel_no2"]), "id")).toBe("Parcel_no");
  });

  it("Cook: Parcel_No beats FID AND beats the bare, too-generic 'Parcel' column", () => {
    expect(detectField(fieldsOf(["FID", "Parcel", "Parcel_No"]), "id")).toBe("Parcel_No");
  });

  it("Twiggs: PARCELID beats OBJECTID and the bare 'PARCEL' column", () => {
    expect(detectField(fieldsOf(["OBJECTID", "PARCELID", "PARCEL"]), "id")).toBe("PARCELID");
  });

  it("Hall: PIN beats OBJECTID (and isn't fooled by ADDR_ID's trailing 'ID')", () => {
    expect(detectField(fieldsOf(["OBJECTID", "PIN", "ADDR_ID"]), "id")).toBe("PIN");
  });

  it("still falls back to the layer's own row id when nothing else is id-shaped, so a search never dies outright (ga_baldwin/ga_tift)", () => {
    expect(detectField(fieldsOf(["OBJECTID", "Shape_Area", "Shape_Length"]), "id")).toBe("OBJECTID");
    expect(detectField(fieldsOf(["FID", "Shape_Area"]), "id")).toBe("FID");
  });

  it("returns null when the layer has nothing id-shaped at all, not even a row id", () => {
    expect(detectField(fieldsOf(["Shape_Area", "Shape_Length"]), "id")).toBeNull();
  });

  it("keeps the pre-existing B1873776 behavior: a short PIN still wins over a real full id when both are equally 'strong' and PIN comes first (pinIdField is what fixes that, not ranking)", () => {
    expect(detectField(fieldsOf(["PIN", "PARCEL_NO"]), "id")).toBe("PIN");
  });
});

describe("NEW-1 (2026-09-24, third-pass ID pin) — every third-pass row with an idField also pins it (B1875248)", () => {
  const GA_THIRD_PASS_PINNED_KEYS = [
    "ga_hall", "ga_effingham", "ga_fayette", "ga_spalding", "ga_newton", "ga_barrow", "ga_oconee",
    "ga_butts", "ga_monroe", "ga_troup", "ga_peach", "ga_muscogee", "ga_morgan", "ga_brantley",
    "ga_charlton", "ga_clay", "ga_cook", "ga_crawford", "ga_crisp", "ga_dade", "ga_dooly",
    "ga_echols", "ga_emanuel", "ga_evans", "ga_greene", "ga_lanier", "ga_meriwether", "ga_sumter",
    "ga_turner", "ga_twiggs", "ga_ware", "ga_whitfield",
  ];

  it("pins idField: true on every measured third-pass row", () => {
    for (const k of GA_THIRD_PASS_PINNED_KEYS) {
      expect(COUNTIES[k].idField, k).toBeTruthy();
      expect(COUNTIES[k].pinIdField, k).toBe(true);
    }
  });

  it("ga_baldwin has no measured column and is left unpinned — hardened detection covers it instead", () => {
    expect(COUNTIES.ga_baldwin.idField).toBeUndefined();
    expect(COUNTIES.ga_baldwin.pinIdField).toBeFalsy();
  });

  it("the pinned field name is the one actually reported in B1875248's live repro", () => {
    expect(COUNTIES.ga_effingham.idField).toBe("PARCEL_NO");
    expect(COUNTIES.ga_barrow.idField).toBe("Parcel_no");
    expect(COUNTIES.ga_cook.idField).toBe("Parcel_No");
    expect(COUNTIES.ga_hall.idField).toBe("PIN");
  });
});
