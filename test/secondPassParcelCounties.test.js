/* B2504800 (NEW-1, owner request 2026-10-29) — the second, deeper search of the 35 "none" parcel counties in GA / LA / SD / KY / WA / OR / ID.
 * RED-PROOF: on main (c79bc2e) none of the counties below is wired (a click says "no parcel data wired here yet"), every one of them has a PARCEL_GAPS row, the District III
 * counties are filed `unreachable`/`paywall`, and the two allow-list hosts are absent — so every assertion here is red until this change lands.
 * Each wired county was MEASURED live (docs/STATEWIDE-PARCELS.md, the per-state second-pass rows); this file pins the OUTCOMES, not the measurements. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { PARCEL_GAPS, parcelGapNotice } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { PARCEL_COPIES } from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

// county key → a point inside it that the row's layer answered at (recorded from the live measurement, 2026-10-29)
const WIRED = {
  ga_early: [31.3, -84.866], ga_catoosa: [34.876, -85.118], ga_berrien: [31.28564, -83.37314], ga_carroll: [33.48093, -85.261], ga_macon: [32.37143, -84.19014], ga_long: [31.56, -81.62],
  la_iberia: [29.94664, -91.67471], la_vermilion: [29.979, -92.28614], la_bienville: [32.33943, -93.241],
  wa_columbia: [46.35286, -118.14814], wa_garfield: [46.49893, -117.7725], wa_okanogan: [48.39286, -120.00321], wa_pacific: [46.31943, -123.996],
  or_wallowa: [45.5, -117.2], or_sherman: [45.4, -120.7],
  sd_yankton: [42.98, -97.4], sd_lake: [44.0, -97.1], sd_meade: [44.5, -102.6],
};
const DISTRICT_III = ["aurora", "bennett", "bonhomme", "brule", "buffalo", "butte", "campbell", "charlesmix", "davison", "day", "douglas", "faulk", "gregory", "haakon", "hanson", "hughes",
  "hutchinson", "jackson", "jerauld", "jones", "lyman", "marshall", "mcpherson", "mellette", "potter", "sanborn", "stanley", "sully", "todd", "tripp", "turner", "ziebach"].map((s) => "sd_" + s);

describe("B2504800 — the newly wired counties are wired, and no longer in the gap table", () => {
  it.each(Object.entries(WIRED))("%s has a layer, a map entry, and no PARCEL_GAPS row", (k) => {
    expect(COUNTIES[k], k).toBeTruthy();
    expect(COUNTIES[k].layerUrl, k).toBeTruthy();
    expect(COUNTIES_MAP[k], k).toBeTruthy();
    expect(PARCEL_GAPS[k], k).toBeUndefined();
  });
  it.each(Object.entries(WIRED))("%s — a point inside the county resolves to ITS row", (k, [la, ln]) => {
    const id = countyIdentity(la, ln);
    expect(id.status, `${k} @ ${la},${ln}`).toBe("ok");
    expect(id.key).toBe(k);
  });
});

describe("B2504800 — Planning District III: 32 South Dakota counties on the NEW REST root", () => {
  it.each(DISTRICT_III)("%s reads gis.districtiii.org/server/rest/services through the relay, never the dead /arcgis path", (k) => {
    expect(COUNTIES[k], k).toBeTruthy();
    expect(COUNTIES[k].layerUrl).toMatch(/^\/gis-proxy\/gis\.districtiii\.org\/server\/rest\/services\/[A-Z_0-9]+\/MapServer\/\d+$/);
    expect(PARCEL_GAPS[k], k).toBeUndefined();
  });
  it("Todd and Tripp share one layer and are separated by their own county scope", () => {
    expect(COUNTIES.sd_todd.layerUrl).toBe(COUNTIES.sd_tripp.layerUrl);
    expect(COUNTIES.sd_todd.scopeWhere).toMatch(/TODD COUNTY/);
    expect(COUNTIES.sd_tripp.scopeWhere).toMatch(/TRIPP COUNTY/);
  });
  it("tribal-trust placeholders are excluded where they are material", () => {
    for (const k of ["sd_bennett", "sd_day", "sd_mellette", "sd_ziebach", "sd_hughes", "sd_jackson"]) expect(COUNTIES[k].scopeWhere, k).toMatch(/TRIBAL/);
  });
  it("Yankton reads the county OEM's own layer scoped to real parcels, not the city-only layer", () => {
    expect(COUNTIES.sd_yankton.layerUrl).toMatch(/Iz7mflZV1DVFSE2G/);
    expect(COUNTIES.sd_yankton.scopeWhere).toMatch(/FEATURE_TY/);
  });
});

describe("B2504800 — copies are labelled (owner constraint #40)", () => {
  it.each(["ga_early", "ga_berrien", "ga_carroll", "ga_macon", "ga_long", "la_vermilion", "la_bienville", "or_wallowa", "or_sherman", "sd_lake", "sd_meade"])("%s has its copy line", (k) => {
    expect(PARCEL_COPIES[k], k).toBeTruthy();
  });
  it("an older copy says how old (Macon 2018, Wallowa 2018, Bienville's 2021 edit)", () => {
    expect(PARCEL_COPIES.ga_macon[1]).toBe("2018-12");
    expect(PARCEL_COPIES.or_wallowa[1]).toBe("2018");
    expect(PARCEL_COPIES.la_bienville[1]).toBe("2021-05");
  });
});

describe("B2504800 — the counties that stay gaps carry a sharper reason (never the bare sentence)", () => {
  const REFILED = { la_franklin: "locked", la_madison: "locked", la_tensas: "locked", id_clark: "locked", id_custer: "locked", sd_harding: "paywall", sd_union: "paywall",
    ky_magoffin: "locked", ky_menifee: "locked", ky_martin: "paywall", ky_robertson: "paywall", ky_wolfe: "paywall", ga_jones: "unreachable" };
  it.each(Object.entries(REFILED))("%s is filed %s", (k, reason) => {
    expect(PARCEL_GAPS[k][0], k).toBe(reason);
    expect(PARCEL_GAPS[k][1], `${k} carries its evidence`).toBeTruthy();
  });
  it.each(["ga_habersham", "ga_rabun", "la_sthelena", "sd_walworth", "sd_oglalalakota", "sd_hyde"])("%s stays `none` and still offers the request link", (k) => {
    expect(PARCEL_GAPS[k][0]).toBe("none");
  });
  it("a gap county's notice still carries the email-Michael request", () => {
    const id = countyIdentity(45.42, -100.1); // Selby, Walworth County SD
    expect(id.status).toBe("no-source");
    const n = parcelGapNotice(id, [45.42, -100.1]);
    expect(n.reason).toBe("none");
    expect(n.href).toMatch(/^mailto:michael@planyr\.io/);
  });
});

describe("B2504800 follow-up — Long County GA, found on the host that was allow-listed only to be measured", () => {
  it("portal.segrass.org is on the relay allow-list (Long's layer rides it) and the dead Habersham host is gone", () => {
    expect(ALLOWED_HOSTS.has("portal.segrass.org")).toBe(true);
    expect(ALLOWED_HOSTS.has("arcgis4.roktech.net")).toBe(false);
  });
  it("Long reads the Coastal Regional Commission's Property_Data layer 0 (the old Long_Parcels service answers 404)", () => {
    expect(COUNTIES.ga_long.layerUrl).toBe("/gis-proxy/portal.segrass.org/crcarcgis/rest/services/Long/Property_Data/MapServer/0");
    expect(COUNTIES.ga_long.idField).toBe("PARCEL_NO");
    expect(PARCEL_COPIES.ga_long).toEqual(["Coastal Regional Commission of Georgia", "2026-10"]);
  });
});
