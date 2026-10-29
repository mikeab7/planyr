/* NEW-1 (Iowa second pass, B2499376, 2026-10-29) — the 21 Iowa counties that were "none" after the first pass now resolve to a source.
 *
 * WHAT THE SECOND PASS FOUND (docs/STATEWIDE-PARCELS.md "Iowa second pass"):
 *   · four COUNTY-published layers the first pass missed — Carroll (the county GIS account's ParcelPoly1, edited 2025-09), Monroe (Monroe_Features layer 43, edited 2026-07; found through a
 *     CadastralAnnotation TILES service of the same account), Van Buren (the vbcogis account's 'Master' FeatureServer, layer 17, edited 2026-07) and Jackson (a 2019 layer the first pass refused on a
 *     2020 currency floor the owner's 2026-10-28 copy rule replaced);
 *   · for the other 17, the only public polygon source is the Iowa HSEMD statewide compilation (University of Iowa copy on ArcGIS Online), frozen at 2 November 2017 — wired as a labelled COPY.
 *
 * RED-PROOF: on main (a1ed51b) all 21 are PARCEL_GAPS `none` rows with no wired source, so every assertion below that names one fails; restoring `parcelGaps.js` from main turns the
 * "no gap row" and "resolves to a source" blocks red, and removing the `iaCopyRaw()` / `iaCopyMap()` spreads from counties.js turns the copy blocks red. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, pointOrderByForUrl, sharedLayerUrlConflicts } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { PARCEL_GAPS } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { PARCEL_COPIES, parcelCopyNotice } from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { IA_COPY_ROWS, IA_ROWS, IA_STATE_COPY_URL } from "../src/workspaces/site-planner/lib/iaParcels.js";
import { IOWA_VERIFICATION } from "../src/workspaces/site-planner/lib/iaProvenance.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor, buildParcelWhere } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { queryAtPoint } from "../src/workspaces/site-planner/lib/arcgis.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/iaCounties.json", import.meta.url), "utf8"));
const OWN = JSON.parse(readFileSync(new URL("./fixtures/iaSamples.json", import.meta.url), "utf8")).rows;
const COPY = JSON.parse(readFileSync(new URL("./fixtures/iaCopySamples.json", import.meta.url), "utf8")).rows;
const ALL21 = ["Appanoose", "Calhoun", "Carroll", "Cherokee", "Clarke", "Des Moines", "Greene", "Hancock", "Henry", "Howard", "Ida", "Jackson", "Lucas", "Madison", "Monroe", "O'Brien", "Palo Alto", "Plymouth", "Tama", "Van Buren", "Washington"];
const keyOf = (n) => "ia_" + n.toLowerCase().replace(/[^a-z]/g, "");
const COPY_NAMES = IA_COPY_ROWS.map(([, n]) => n);
const OWN_NAMES = ["Carroll", "Jackson", "Monroe", "Van Buren"];

import { beforeAll } from "vitest";
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

describe("all 21 counties resolve to a source, and none is left a gap row", () => {
  it("the copy rows and the four county layers partition the 21", () => {
    expect([...COPY_NAMES, ...OWN_NAMES].sort()).toEqual([...ALL21].sort());
  });
  it.each(ALL21)("%s → a wired Iowa source, no PARCEL_GAPS row", (n) => {
    const c = FX.counties.find((x) => x.name === n + " County");
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe(keyOf(n));
    expect(PARCEL_GAPS[keyOf(n)], "a wired county has no gap row").toBeUndefined();
    expect(COUNTIES_MAP[keyOf(n)].state).toBe("IA");
    expect(FX.gaps[n], "the fixture no longer lists it as a gap").toBeUndefined();
  });
});

describe("the 17 COPY rows ride the 2017 statewide compilation, each scoped to its own county", () => {
  it("one shared layer, distinct COUNTYNAME scopes (the sanctioned Idaho / Mississippi shape), no double-add conflict", () => {
    const scopes = IA_COPY_ROWS.map(([k]) => COUNTIES[keyOf(k)].scopeWhere);
    expect(new Set(scopes).size).toBe(IA_COPY_ROWS.length);
    for (const [k] of IA_COPY_ROWS) expect(COUNTIES_MAP["ia_" + k].layerUrl).toBe(IA_STATE_COPY_URL);
    expect(sharedLayerUrlConflicts().filter((c) => c.keys.some((x) => x.startsWith("ia_")))).toEqual([]);
  });
  it("O'Brien's scope doubles the quote and matches the layer's own spelling \"O' BRIEN\"", () => {
    expect(COUNTIES.ia_obrien.scopeWhere).toBe("COUNTYNAME='O'' BRIEN'");
    expect(COUNTIES.ia_desmoines.scopeWhere).toBe("COUNTYNAME='DES MOINES'");
    const where = buildParcelWhere({ meta: { fields: [{ name: "PARCELNUMB", type: "esriFieldTypeString" }, { name: "COUNTYNAME", type: "esriFieldTypeString" }] }, mode: "id", value: "0005313300", idField: "PARCELNUMB", scopeWhere: COUNTIES.ia_obrien.scopeWhere });
    expect(where).toContain("COUNTYNAME='O'' BRIEN'");
  });
  it("the layer is dense: a copy row declares a display floor so a town cell never blows the 2,000-record cap", () => {
    for (const [k] of IA_COPY_ROWS) expect(COUNTIES_MAP["ia_" + k].displayMinZoom, k).toBeGreaterThanOrEqual(16);
  });
  it("every copy county is labelled: a copy of the county's data, as of November 2017, with the request link", () => {
    for (const [k, n] of IA_COPY_ROWS) {
      const notice = parcelCopyNotice("ia_" + k, { lat: 42, lng: -94 });
      expect(notice, k).toBeTruthy();
      expect(notice.line, k).toContain(`Copy of ${n} County parcel data published by the Iowa Homeland Security & Emergency Management statewide compilation`);
      expect(notice.line, k).toContain("as of November 2017");
      expect(notice.line, k).toContain("not the county’s own");
      expect(notice.href, k).toMatch(/^mailto:michael@planyr\.io/);
      expect(PARCEL_COPIES["ia_" + k][1], k).toBe("2017-11");
    }
  });
  it("each has a provenance record that says it is a 9-year-old copy (never presented as the county's own)", () => {
    for (const [k] of IA_COPY_ROWS) {
      const v = IOWA_VERIFICATION["ia_" + k];
      expect(v.publisher, k).toBe("third-party");
      expect(v.verifiedNote, k).toMatch(/2 November 2017/);
      expect(v.verifiedNote, k).toMatch(/NOT the county's own/);
      expect(v.verifiedOn, k).toBe("2026-10-29");
    }
  });
  it.each(Object.entries(COPY))("%s — a recorded real lot reads back its parcel number and deed holder", (name, s) => {
    const key = keyOf(name.replace(/ County$/, ""));
    expect(COUNTIES[key].idField).toBe("PARCELNUMB");
    expect(s.attrs.COUNTYNAME, `${name}: the recorded lot is in this county`).toBe(name.replace(/ County$/, "").toUpperCase().replace("O'BRIEN", "O' BRIEN"));
    const rec = countyRecord(s.attrs, { idField: "PARCELNUMB" });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    expect(rec.owner, `${name}: owner (DEEDHOLDER)`).toBeTruthy();
    expect(idAttrFor(key, s.attrs), `${name}: stamped id`).toBe(String(s.attrs.PARCELNUMB));
    expect(s.measured.hits, `${name}: spread points`).toBeGreaterThanOrEqual(4);
    expect(s.measured.edgeHits, `${name}: county-line points`).toBeGreaterThanOrEqual(3);
    expect(s.measured.count, `${name}: lots in the county's filter`).toBeGreaterThan(10000);
    const e = s.measured.extent;
    expect(e[0] >= -96.7 && e[2] <= -90.1 && e[1] >= 40.3 && e[3] <= 43.6, `${name}: extent inside Iowa`).toBe(true);
  });
  it("the 17 covers every county the layer was measured for (the fixture is the spread-point record, not a hand pick)", () => {
    expect(Object.keys(COPY).sort()).toEqual(COPY_NAMES.map((n) => n + " County").sort());
  });
});

describe("the four COUNTY layers", () => {
  it.each(OWN_NAMES)("%s — a wired county layer with a recorded real lot", (n) => {
    const key = keyOf(n);
    const s = OWN[n + " County"];
    expect(COUNTIES[key].layerUrl).toBe(s.url);
    expect(COUNTIES[key].layerUrl).not.toBe(IA_STATE_COPY_URL);
    expect(COUNTIES[key].scopeWhere).toBeUndefined();
    const rec = countyRecord(s.attrs, { idField: s.idField, addrField: s.addrField });
    expect(rec.account).toBeTruthy();
    expect(rec.owner, `${n}: owner`).toBeTruthy();
    expect(s.measured.hits).toBeGreaterThanOrEqual(4);
    expect(s.measured.edgeHits).toBeGreaterThanOrEqual(3);
    expect(IOWA_VERIFICATION[key].verifiedOn).toBe("2026-10-29");
  });
  it("Carroll, Monroe and Van Buren are the county's own (no copy line); Jackson is a labelled 2019 copy from an unverified account", () => {
    expect(parcelCopyNotice("ia_carroll")).toBeNull();
    expect(parcelCopyNotice("ia_monroe")).toBeNull();
    expect(parcelCopyNotice("ia_vanburen")).toBeNull();
    expect(IOWA_VERIFICATION.ia_vanburen.publisher).toBe("own");
    expect(IOWA_VERIFICATION.ia_carroll.publisher).toBe("own");
    expect(IOWA_VERIFICATION.ia_monroe.publisher).toBe("own");
    const j = parcelCopyNotice("ia_jackson", { lat: 42.2, lng: -90.6 });
    expect(j.line).toContain("Copy of Jackson County parcel data");
    expect(j.line).toContain("as of July 2019");
    expect(j.line).toContain("may not be the county’s own");
  });
  it("the first pass's currency floor no longer excludes Jackson's 2019 layer (owner copy rule 2026-10-28)", () => {
    expect(OWN["Jackson County"].lastEdit).toBeLessThan(Date.UTC(2020, 0, 1));
    expect(IA_ROWS.some(([k]) => k === "jackson")).toBe(true);
  });
});

describe("Monroe stacks two rows on every lot, so the click asks for the newest first", () => {
  afterEach(() => vi.unstubAllGlobals());
  const MON = COUNTIES.ia_monroe.layerUrl;
  const stub = () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (u) => { calls.push(new URL(u)); return { ok: true, status: 200, json: async () => ({ features: [{ attributes: { PIN: "711712200001" } }] }) }; }));
    return calls;
  };
  it("is declared on Monroe's layer only", () => {
    expect(pointOrderByForUrl(MON)).toBe("OBJECTID DESC");
    expect(pointOrderByForUrl(MON + "/")).toBe("OBJECTID DESC");
    for (const k of Object.keys(COUNTIES).filter((x) => x.startsWith("ia_") && x !== "ia_monroe")) expect(pointOrderByForUrl(COUNTIES[k].layerUrl), k).toBeNull();
  });
  it("a click on Monroe sends orderByFields; a click on Carroll does not", async () => {
    const calls = stub();
    await queryAtPoint(MON, -92.95, 41.03);
    expect(calls[0].searchParams.get("orderByFields")).toBe("OBJECTID DESC");
    const calls2 = stub();
    await queryAtPoint(COUNTIES.ia_carroll.layerUrl, -94.87, 42.06);
    expect(calls2[0].searchParams.get("orderByFields")).toBeNull();
  });
  it("the recorded Monroe lot is the NEWEST row (current owner), not the old export", () => {
    const a = OWN["Monroe County"].attrs;
    expect(a.OBJECTID).toBeGreaterThanOrEqual(16600);
    expect(a.PRIMARY_NAME1).toBeTruthy();
  });
});
