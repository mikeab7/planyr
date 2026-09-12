import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  candidateCountiesForPoint, COUNTIES_MAP, countyKeyForName, STATEWIDE_KEYS, countyIdentity, noParcelSourceNote,
  STATEWIDE_PARCEL_LAYER, statewideFallbackFor, countyForView, countyBboxIntersectsView,
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
