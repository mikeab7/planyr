/* NEW-1 (Missouri second pass, 2026-10-29) — the owner asked for a second, deeper search of every Missouri county still marked "none" in parcelGaps.js.
 * This pins what that search turned up, so nobody has to re-find it and nobody can quietly un-wire it.
 *
 * RED-PROOF: on main (c79bc2e) Franklin, Cass, Clinton and Hickory are `none` rows in PARCEL_GAPS, absent from COUNTIES, and the doc has no second-pass
 * section — every assertion about them below fails there. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { PARCEL_GAPS, parcelGapNotice } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { parcelCopyNotice } from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyIdentity } from "../src/workspaces/site-planner/lib/counties.js";
import { MISSOURI_VERIFICATION } from "../src/workspaces/site-planner/lib/moProvenance.js";
import { GC_MAPS } from "../src/shared/gis/giscloudAdapter.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/moCounties.json", import.meta.url), "utf8"));
const DOC = readFileSync(new URL("../docs/STATEWIDE-PARCELS.md", import.meta.url), "utf8");
beforeAll(async () => { await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"))); });

const WIRED = ["franklin", "cass", "clinton", "hickory"];
const STILL_NONE = ["carroll", "clark", "crawford", "dent", "howell", "knox", "lewis", "mercer", "monroe", "ozark", "pike", "randolph", "reynolds", "schuyler", "scotland", "shannon", "shelby", "stoddard", "texas"];

describe("the four counties the second pass wired", () => {
  it("are wired, and are no longer named gaps", () => {
    for (const c of WIRED) {
      expect(COUNTIES["mo_" + c], c).toBeTruthy();
      expect(PARCEL_GAPS["mo_" + c], c).toBeUndefined();
      const [la, ln] = COUNTIES_MAP["mo_" + c].center;
      expect(countyIdentity(la, ln).status, c).not.toBe("no-source");
      expect(noParcelSourceNote(countyIdentity(la, ln)), c).toBeFalsy();
    }
  });
  it("Franklin is the county's own file on the county's own ArcGIS Online org (rows with owner and situs address), read direct — no relay", () => {
    const f = COUNTIES.mo_franklin;
    expect(f.layerUrl).toBe("https://services7.arcgis.com/HM4C7tGF5KT34U6h/arcgis/rest/services/FRANKLIN_CO_LAND_LAYERS/FeatureServer/37");
    expect(f.idField).toBe("PID_NUMBER__MAP_"); expect(f.addrField).toBe("SITUS_ADDRESS");
    expect(MISSOURI_VERIFICATION.mo_franklin.publisher).toBe("own");
    expect(MISSOURI_VERIFICATION.mo_franklin.verifiedNote).toMatch(/7 of 8 interior test points/);
  });
  it("Cass is a COPY — MARC's regional compilation — and the parcel card says so, with the data date", () => {
    expect(COUNTIES.mo_cass.layerUrl).toBe("/gis-proxy/gis2.marc2.org/arcgis/rest/services/LandUseDevelopment/DevelopmentByDecade/MapServer/10");
    expect(ALLOWED_HOSTS.has("gis2.marc2.org")).toBe(true);
    expect(MISSOURI_VERIFICATION.mo_cass.publisher).toBe("third-party");
    const n = parcelCopyNotice("mo_cass", { lat: 38.65, lng: -94.35 });
    expect(n.publisher).toBe("Mid-America Regional Council"); expect(n.asOf).toBe("2025-09");
    expect(n.line).toMatch(/Mid-America Regional Council/); expect(n.line).toMatch(/Sep(tember)? 2025|2025-09/); expect(n.href).toMatch(/^mailto:michael@planyr\.io/);
  });
  it("Clinton and Hickory ride the GIS Cloud adapter, each pinned to its own measured id column; Hickory offers no address search (its address columns are the owner's mailing address)", () => {
    expect(COUNTIES.mo_clinton.layerUrl).toBe("/gc/clinton/FeatureServer/0"); expect(COUNTIES.mo_clinton.idField).toBe(GC_MAPS.clinton.id); expect(COUNTIES.mo_clinton.addrField).toBe("siteaddres");
    expect(COUNTIES.mo_hickory.layerUrl).toBe("/gc/hickory/FeatureServer/0"); expect(COUNTIES.mo_hickory.idField).toBe(GC_MAPS.hickory.id); expect(COUNTIES.mo_hickory.addrField).toBeUndefined();
    for (const c of ["clinton", "hickory"]) { expect(MISSOURI_VERIFICATION["mo_" + c].publisher).toBe("own"); expect(MISSOURI_VERIFICATION["mo_" + c].verifiedOn).toBe("2026-10-29"); }
  });
  it("a click in each county resolves to its own row", () => {
    for (const [c, la, ln] of [["franklin", 38.41, -91.07], ["cass", 38.66, -94.35], ["clinton", 39.57, -94.45], ["hickory", 37.94, -93.32]]) {
      const id = countyIdentity(la, ln);
      expect(id.key, c).toBe("mo_" + c);
      expect(COUNTIES_MAP["mo_" + c].bbox, c).toBeTruthy();
    }
  });
});

describe("the nineteen that stay gaps are still named, with a reason a person reads", () => {
  it("each is a `none` row carrying its second-pass note, and still reads the request link", () => {
    for (const c of STILL_NONE) {
      const e = PARCEL_GAPS["mo_" + c];
      expect(e, c).toBeTruthy(); expect(e[0], c).toBe("none"); expect(String(e[1] || "").length, c).toBeGreaterThan(20);
      expect(COUNTIES["mo_" + c], c).toBeUndefined();
      const f = FX.counties.find((x) => x.name === c[0].toUpperCase() + c.slice(1) + " County");
      const id = countyIdentity(f.lat, f.lng);
      expect(id.status, c).toBe("no-source");
      const n = parcelGapNotice(id, { lat: f.lat, lng: f.lng });
      expect(n.reason, c).toBe("none"); expect(n.href, c).toMatch(/^mailto:michael@planyr\.io/);
    }
  });
  it("the owner-decided and login-gated Missouri rows are untouched", () => {
    for (const k of ["mo_newmadrid", "mo_pemiscot"]) expect(PARCEL_GAPS[k][0]).toBe("none");
    for (const k of ["mo_butler", "mo_dunklin", "mo_ripley", "mo_caldwell", "mo_pettis"]) expect(PARCEL_GAPS[k][0]).toBe("locked");
  });
});

describe("the research record", () => {
  it("has a second-pass section naming the routes run and each wired county's measurement", () => {
    const sec = DOC.slice(DOC.indexOf("### Missouri second pass (2026-10-29)"), DOC.indexOf("## South Carolina counties"));
    expect(sec.length).toBeGreaterThan(3000);
    for (const w of ["Franklin", "Cass", "Clinton", "Hickory", "MARC", "GIS Cloud", "Schneider", "Clark County, **Nevada**", "OWNER'S MAILING address"]) expect(sec, w).toContain(w);
  });
  it("every one of the 19 remaining gap rows records the second pass", () => {
    const gaps = DOC.slice(DOC.indexOf("### Missouri gaps"), DOC.indexOf("### Missouri second pass"));
    const names = { carroll: "Carroll", clark: "Clark", crawford: "Crawford", dent: "Dent", howell: "Howell", knox: "Knox", lewis: "Lewis", mercer: "Mercer", monroe: "Monroe", ozark: "Ozark", pike: "Pike", randolph: "Randolph", reynolds: "Reynolds", schuyler: "Schuyler", scotland: "Scotland", shannon: "Shannon", shelby: "Shelby", stoddard: "Stoddard", texas: "Texas" };
    for (const [k, n] of Object.entries(names)) {
      const row = gaps.split("\n").find((l) => l.startsWith(`| ${n} |`));
      expect(row, k).toBeTruthy(); expect(row, k).toContain("Second pass 2026-10-29");
    }
  });
});
