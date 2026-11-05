/* NEW-1 (B2497472, 2026-10-29) — the SECOND, deeper search of Oklahoma's 61 "none" counties wired ALL of them.
 *
 * RED-PROOF: on main every county below is a `PARCEL_GAPS` row ("none") with no `COUNTIES` entry, so the first blocks fail on the `ok_*`
 * lookup and the gap table, and Garfield still points at its 2015 copy.
 * 52 counties ride the State of Oklahoma's statewide parcel mosaic through `/okparcels` (the adapter is tested in okParcelsAdapter.test.js);
 * 9 ride ArcGIS Online copies (and Kay, the county assessor's own org, and the Garfield swap). Every layer was measured live: polygons with a
 * parcel id at 9 interior + 4 county-line points, and a negative control at a point in the Gulf that returned nothing — the recorded lots are
 * in test/fixtures/oklahomaSamples.json.
 * TRAPS pinned so they cannot return: a TABLE with parcel fields but no geometry (the Lawton EOC "owner" table answered a point query for every
 * county — 9 of 9 everywhere — because a non-spatial table ignores the geometry filter), and a layer whose extent merely covers a county. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { PARCEL_GAPS } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { PARCEL_COPIES, parcelCopyNotice } from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { OK_ROWS } from "../src/workspaces/site-planner/lib/okParcels.js";
import { OKLAHOMA_VERIFICATION } from "../src/workspaces/site-planner/lib/okProvenance.js";
import { queryAtPoint, getLayerInfo } from "../src/workspaces/site-planner/lib/arcgis.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { onRequest as okParcels } from "../functions/okparcels/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/oklahomaCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/oklahomaSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const STATE_URL = "/okparcels/FeatureServer/0";
/* slug -> [county name as the fixture spells it, the layer's own spelling of the county in its `county` column] */
const STATEWIDE = {
  alfalfa: ["Alfalfa", "Alfalfa"], atoka: ["Atoka", "Atoka"], beaver: ["Beaver", "Beaver"], blaine: ["Blaine", "Blaine"], bryan: ["Bryan", "Bryan"], caddo: ["Caddo", "Caddo"],
  carter: ["Carter", "Carter"], cherokee: ["Cherokee", "Cherokee"], choctaw: ["Choctaw", "Choctaw"], cimarron: ["Cimarron", "Cimarron"], coal: ["Coal", "Coal"], cotton: ["Cotton", "Cotton"],
  craig: ["Craig", "Craig"], custer: ["Custer", "Custer"], dewey: ["Dewey", "Dewey"], ellis: ["Ellis", "Ellis"], garvin: ["Garvin", "Garvin"], grady: ["Grady", "Grady"], grant: ["Grant", "Grant"],
  greer: ["Greer", "Greer"], harmon: ["Harmon", "Harmon"], harper: ["Harper", "Harper"], haskell: ["Haskell", "Haskell"], jackson: ["Jackson", "Jackson"], jefferson: ["Jefferson", "Jefferson"],
  johnston: ["Johnston", "Johnston"], kingfisher: ["Kingfisher", "Kingfisher"], kiowa: ["Kiowa", "Kiowa"], latimer: ["Latimer", "Latimer"], leflore: ["Le Flore", "LeFlore"],
  lincoln: ["Lincoln", "Lincoln"], love: ["Love", "Love"], major: ["Major", "Major"], marshall: ["Marshall", "Marshall"], mayes: ["Mayes", "Mayes"], mccurtain: ["McCurtain", "McCurtain"],
  mcintosh: ["McIntosh", "McIntosh"], murray: ["Murray", "Murray"], noble: ["Noble", "Noble"], nowata: ["Nowata", "Nowata"], okmulgee: ["Okmulgee", "Okmulgee"], pawnee: ["Pawnee", "Pawnee"],
  pontotoc: ["Pontotoc", "Pontotoc"], pottawatomie: ["Pottawatomie", "Pottawatomie"], pushmataha: ["Pushmataha", "Pushmataha"], rogermills: ["Roger Mills", "Roger Mills"],
  sequoyah: ["Sequoyah", "Sequoyah"], stephens: ["Stephens", "Stephens"], texas: ["Texas", "Texas"], tillman: ["Tillman", "Tillman"], washita: ["Washita", "Washita"], woods: ["Woods", "Woods"],
};
/* slug -> layer URL fragment (ArcGIS Online / relay copies, kept because they are current AND carry an owner column) */
const COPIES = {
  adair: "Adair_WFL1/FeatureServer/0", delaware: "yRdXE3105FhxUFH6/arcgis/rest/services/parcel/FeatureServer/0", hughes: "Hughes_Okfuskee_Seminole_Parcel_Data_Updated/FeatureServer/0",
  okfuskee: "Hughes_Okfuskee_Seminole_Parcel_Data_Updated/FeatureServer/0", seminole: "Hughes_Okfuskee_Seminole_Parcel_Data_Updated/FeatureServer/0", logan: "Parcel/FeatureServer/0",
  woodward: "PZDYj8nlIDAHxNx4/arcgis/rest/services/New2026Parcel/FeatureServer/0", osage: "/gis-proxy/map11.incog.org/arcgis11wa/rest/services/Parcels_OsageCo/MapServer/0",
  garfield: "LIvKKeLD11lMmJuJ/arcgis/rest/services/Polymorphic_Layers/FeatureServer/16",
};
const KAY = "services6.arcgis.com/1096yitfwoXld7mE/arcgis/rest/services/Basemap1/FeatureServer/0";
const bySlug = (s) => FX.counties.find((c) => c.name === STATEWIDE[s][0] + " County");

describe("every former Oklahoma gap is wired", () => {
  it("77 of 77: the table holds no Oklahoma row and every county resolves to a source", () => {
    expect(Object.keys(PARCEL_GAPS).filter((k) => k.startsWith("ok_"))).toEqual([]);
    expect(FX.counties).toHaveLength(77);
    for (const c of FX.counties) {
      const id = countyIdentity(c.lat, c.lng);
      expect(id.status, c.name).toBe("ok");
      expect(id.key, c.name).toBe("ok_" + c.name.replace(/ County$/, "").toLowerCase().replace(/[^a-z]/g, ""));
    }
  });
});

describe("52 counties ride the state's statewide parcel layer through /okparcels, each scoped to exactly itself", () => {
  const slugs = Object.keys(STATEWIDE);
  it("there are 52, and each row is the adapter URL + a county scope + a closer outline floor", () => {
    expect(slugs).toHaveLength(52);
    for (const s of slugs) {
      const row = COUNTIES["ok_" + s];
      expect(row, s).toBeTruthy();
      expect(row.layerUrl, s).toBe(STATE_URL);
      expect(row.scopeWhere, s).toBe(`county='${STATEWIDE[s][1]}'`);
      expect(row.idField, s).toBe("parcelid");
      expect(row.displayMinZoom, s).toBe(16);
      expect(COUNTIES_MAP["ok_" + s].scopeWhere, s).toBe(row.scopeWhere);
      expect(COUNTIES_MAP["ok_" + s].layerUrl, s).toBe(STATE_URL);
    }
  });
  it("no two rows share both layer and scope, and the 52 scopes are 52 different counties", () => {
    expect(new Set(slugs.map((s) => COUNTIES["ok_" + s].scopeWhere)).size).toBe(52);
  });
  it("a point inside each county resolves to that county's source", () => {
    for (const s of slugs) {
      const c = bySlug(s);
      const id = countyIdentity(c.lat, c.lng);
      expect(id.status, s).toBe("ok"); expect(id.key, s).toBe("ok_" + s);
    }
  });
  it("the layer's own spelling is used where it differs from ours (Le Flore → LeFlore)", () => {
    expect(COUNTIES.ok_leflore.scopeWhere).toBe("county='LeFlore'");
    expect(COUNTIES.ok_rogermills.scopeWhere).toBe("county='Roger Mills'");
  });
  it("the state layer is OFFICIAL: provenance 'statewide', so the parcel card shows no copy line", () => {
    for (const s of slugs) {
      expect(OKLAHOMA_VERIFICATION["ok_" + s].publisher, s).toBe("statewide");
      expect(PARCEL_COPIES["ok_" + s], s).toBeUndefined();
      expect(OKLAHOMA_VERIFICATION["ok_" + s].verifiedNote, s).toMatch(/Gulf/);
    }
  });
  it("every recorded lot is a real polygon hit carrying the layer's own county, a parcel id and an owner", () => {
    for (const s of slugs) {
      const smp = SAMPLES[STATEWIDE[s][0]];
      expect(smp, s).toBeTruthy();
      expect(smp.idField, s).toBe("parcelid");
      expect(smp.attrs.parcelid, s).toBeTruthy();
      expect(String(smp.attrs.county).replace(/[^a-z]/gi, "").toLowerCase(), s).toBe(STATEWIDE[s][1].replace(/[^a-z]/gi, "").toLowerCase());
      expect(smp.expectOwner, s).toBe(true);
      expect(smp.measured.hits, s).toBeGreaterThanOrEqual(7);
      expect(smp.measured.edgeHits, s).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the ArcGIS Online copies that stay are current and carry an owner", () => {
  it.each(Object.entries(COPIES))("ok_%s", (s, frag) => {
    const row = COUNTIES["ok_" + s];
    expect(row.layerUrl).toContain(frag);
    expect(row.layerUrl).not.toBe(STATE_URL);
  });
  it("Hughes / Okfuskee / Seminole share one layer, scoped by COUNTY_NAM", () => {
    expect(["hughes", "okfuskee", "seminole"].map((s) => COUNTIES["ok_" + s].scopeWhere)).toEqual(["COUNTY_NAM='Hughes'", "COUNTY_NAM='Okfuskee'", "COUNTY_NAM='Seminole'"]);
  });
  it("Kay's layer is the county assessor's own org — no copy line", () => {
    expect(COUNTIES.ok_kay.layerUrl).toContain(KAY);
    expect(PARCEL_COPIES.ok_kay).toBeUndefined();
    expect(OKLAHOMA_VERIFICATION.ok_kay.publisher).toBe("own");
  });
  it("a copy says who published it and the date of the data", () => {
    expect(parcelCopyNotice("ok_woodward").line).toContain("City of Woodward, as of March 2026");
    expect(parcelCopyNotice("ok_adair").line).toContain("Oklahoma Department of Commerce, as of December 2024");
    expect(parcelCopyNotice("ok_osage").line).toContain("INCOG");
  });
  it("an account Planyr cannot tie to the county says so and never claims to be the county's", () => {
    expect(parcelCopyNotice("ok_logan").line).toMatch(/couldn’t tie to the county.*may not be the county’s own/);
  });
  it("Garfield now rides the City of Enid layer (edited 2026-10), not the county's 2015 copy", () => {
    expect(PARCEL_COPIES.ok_garfield[0]).toBe("City of Enid");
    expect(SAMPLES.Garfield.attrs.account).toBeTruthy();
  });
});

describe("the SHIPPED click path reaches a state-layer county end to end (the real client code → the real Function → a recorded upstream answer)", () => {
  const PT = JSON.parse(readFileSync(new URL("./fixtures/okStatewideGfiPoint.json", import.meta.url), "utf8"));
  const withStub = async (fn) => {
    const real = globalThis.fetch;
    globalThis.fetch = async (u, o) => {
      const url = new URL(String(u));
      if (url.pathname.startsWith("/okparcels/")) {
        const res = await okParcels({ request: new Request(url.toString(), o), params: { path: url.pathname.replace(/^\/okparcels\//, "").split("/") } });
        return res;
      }
      if (url.host === "okmaps.org") return new Response(JSON.stringify(PT), { status: 200 });
      throw new Error("unexpected fetch " + url);
    };
    try { return await fn(); } finally { globalThis.fetch = real; }
  };
  const layer = "https://planyr.io" + COUNTIES.ok_mayes.layerUrl;
  it("queryAtPoint on a Mayes lot returns its polygon + attributes, and countyRecord reads the account and owner", async () => {
    const f = await withStub(() => queryAtPoint(layer, -95.1623, 36.51));
    expect(f.attributes.parcelid).toBe("490010509");
    expect(f.geometry.rings.length).toBeGreaterThan(0);
    const rec = countyRecord(f.attributes, { idField: COUNTIES.ok_mayes.idField });
    expect(rec.account).toBe("1035667"); // the county's own account number (the generic resolver prefers it; parcelid 490010509 stays in the attributes)
    expect(rec.owner).toMatch(/GILMORE/);
  });
  it("a click that lands between lots is null (no feature), not an error", async () => {
    expect(await withStub(() => queryAtPoint(layer, -95.19, 36.51))).toBeNull();
  });
  it("the layer metadata is served without touching the state server, and names the id column the row pins", async () => {
    const info = await withStub(() => getLayerInfo(layer));
    expect(info.fields.map((x) => x.name)).toContain(COUNTIES.ok_mayes.idField);
  });
});
