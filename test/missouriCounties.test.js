/* NEW-1 (B2317680, 2026-10-19) — every one of Missouri's 115 assessing units (114 counties + the independent City of St. Louis) resolves to a REAL outcome: a connected parcel
 * source, or an explicit, named gap that says so ("<County> — no parcel data wired here yet.") AND carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main a8d440d only Platte and Clay were wired (plus the Kansas City / Independence city scopes), so 71 of these counties fell through to "no-source" and the
 * per-county assertions below go red; `git stash`-ing the moRaw/moMap spreads in counties.js turns 71 of them red again. The county list is the repo's own bundled county polygons
 * (fixture header), never hand-picked. Missouri has no free statewide parcel service, so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, countyKeyForName } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { cityScopeAnswer } from "../src/workspaces/site-planner/lib/cityScopes.js";
import { countyRecord, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { MO_ROWS } from "../src/workspaces/site-planner/lib/moParcels.js";
import { MISSOURI_VERIFICATION } from "../src/workspaces/site-planner/lib/moProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/moCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/moSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => (n === "St. Louis city" ? "mo_stlouiscity" : "mo_" + bare(n).toLowerCase().replace(/[^a-z]/g, ""));
const CITY_SCOPE_KEYS = new Set(["mo_kansascity", "mo_independence"]);
const hand = new Set(["mo_clay", "mo_platte"]); // hand-written in counties.js since 2026-09, not in MO_ROWS
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("mo_") && !CITY_SCOPE_KEYS.has(k));
const inCityScope = (la, ln) => !!cityScopeAnswer(la, ln);

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("MO");
    if (id.key === "mo_kansascity" || id.key === "mo_independence") return; // inside a city scope the city source legitimately answers first
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is Missouri's 114 counties plus the independent City of St. Louis", () => {
    expect(FX.counties).toHaveLength(115);
    expect(FX.counties.filter((c) => c.name === "St. Louis city")).toHaveLength(1);
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    const wired = new Set(wiredKeys);
    const gapNames = Object.keys(FX.gaps);
    expect(wired.size + gapNames.length).toBe(115);
    for (const c of FX.counties) {
      const isWired = wired.has(keyOf(c.name));
      const isGap = bare(c.name) in FX.gaps;
      expect(isWired !== isGap, c.name).toBe(true);
    }
  });
  it("every gap records WHY, after a re-search — a bare 'no source' is not a reason", () => {
    for (const [n, g] of Object.entries(FX.gaps)) {
      expect(g.kind, n).toMatch(/^(owner-decision|login-required|adapter-needed|no-api|none-found)$/);
      expect(g.reason.length, n).toBeGreaterThan(80);
    }
  });
  it("the hand-written Platte and Clay rows are still there", () => {
    for (const k of hand) expect(COUNTIES[k], k).toBeTruthy();
  });
});

describe("every county in Missouri resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    if (inCityScope(c.lat, c.lng)) return; // a centre inside Kansas City / Independence is answered by the city scope (tested in counties.test.js)
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    if (bare(c.name) in FX.gaps) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toContain(c.name);
    } else {
      expect(id.status).toBe("ok");
      expect(id.key).toBe(keyOf(c.name));
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("MO");
    }
  });
});

describe("St. Louis city and St. Louis County are two sources, not one key", () => {
  it("the independent city keys apart from the county", () => {
    expect(countyKeyForName("St. Louis city", "MO")).toBe("mo_stlouiscity");
    expect(countyKeyForName("St. Louis County", "MO")).toBe("mo_stlouis");
    expect(COUNTIES.mo_stlouiscity.layerUrl).not.toBe(COUNTIES.mo_stlouis.layerUrl);
    expect(COUNTIES.mo_stlouiscity.layerUrl).toContain("maps6.stlouis-mo.gov");
    expect(COUNTIES.mo_stlouis.layerUrl).toContain("maps.stlouisco.com");
  });
  it("a downtown St. Louis point resolves to the city and a Clayton point to the county", () => {
    expect(countyIdentity(38.627, -90.199).key).toBe("mo_stlouiscity");
    expect(countyIdentity(38.6426, -90.3375).key).toBe("mo_stlouis");
  });
});

describe("the wired Missouri rows", () => {
  const ROW_KEYS = MO_ROWS.map(([k]) => "mo_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...ROW_KEYS, ...hand]));
    expect(MO_ROWS).toHaveLength(71);
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("an Integrity GIS county reaches only its own public Geocortex site, as a guest (no key is carried in any URL)", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (!u.includes("integritygis.com")) continue;
      expect(u, k).toMatch(/^\/gis-proxy\/[a-z]+gis\.integritygis\.com\/Geocortex\/Essentials\/REST\/sites\/[A-Za-z_]+\/map\/mapservices\/\d+\/rest\/services\/x\/MapServer\/\d+$/);
      expect(u, k).not.toMatch(/token|key=/i);
    }
  });
  it("the three counties the owner ruled out on 2026-10-16 stay unwired", () => {
    for (const n of ["butler", "dunklin", "ripley"]) expect(COUNTIES["mo_" + n], n).toBeUndefined();
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , la, ln, bb] of MO_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["mo_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired Missouri row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of ROW_KEYS) {
      const v = MISSOURI_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toBe("2026-10-19");
    }
  });
});

describe("a recorded real lot from each source reads back parcel id, address, acreage and (where the layer has one) owner", () => {
  it("the fixture covers every wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(MO_ROWS.map(([, n]) => (n === "City of St. Louis" ? "St. Louis city" : n + " County")).sort());
  });
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = keyOf(name);
    const row = COUNTIES[key];
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    expect(s.attrs[s.idField], `${name}: the recorded row carries the pinned id column`).toBeTruthy();
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    // the stored account (what the card/list stamps at identify time) is the county's DECLARED column, never a row number or a map-sheet fragment
    expect(idAttrFor(key, s.attrs), `${name}: stamped id`).toBe(String(s.attrs[s.idField]));
    const hasOwner = !/^(Jackson|Boone) County$/.test(name);
    if (hasOwner) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
    }
  });
  it("Jackson (parcel fabric) and Boone (basemap linework) honestly carry no owner", () => {
    for (const n of ["Jackson County", "Boone County"]) expect(ownerName(SAMPLES[n].attrs), n).toBeNull();
  });
  it("a county's declared parcel number replaces a map-sheet FRAGMENT the generic resolver caught (Henry PARCEL_NUM '11', Cole PARCELNUM '55', Livingston '05.00')", () => {
    for (const [n, frag] of [["Henry County", "11"], ["Cole County", "55"], ["Livingston County", "05.00"]]) {
      const s = SAMPLES[n];
      const rec = countyRecord(s.attrs, { idField: s.idField });
      expect(rec.account, n).toBe(String(s.attrs[s.idField]));
      expect(rec.account.length, n).toBeGreaterThan(frag.length);
    }
  });
});

describe("measured on the live relay (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    expect(s.measured.hits, `${name}: polygons with a parcel id at 9 spread + county-line points`).toBeGreaterThanOrEqual(5);
    expect(s.measured.edgeHits, `${name}: points beside the county line`).toBeGreaterThanOrEqual(1);
    const ext = s.measured.extent;
    if (ext && name !== "McDonald County") { // McDonald's declared extent is corrupt (one stray feature); documented in moProvenance.js
      expect(ext[0] >= -95.8 && ext[2] <= -89.0 && ext[1] >= 35.9 && ext[3] <= 40.7, `${name}: extent inside Missouri`).toBe(true);
    }
  });
});
