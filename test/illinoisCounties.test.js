/* NEW-1 (B2372624, 2026-10-20) — every one of Illinois' 102 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap that says so
 * ("<County> — no parcel data wired here yet.") AND carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main 654ca32 only Cook, DuPage, Will and Kane were wired, so 62 of these counties fell through to "no-source" and the per-county assertions below go red;
 * `git stash`-ing the ilRaw/ilMap spreads in counties.js turns 62 of them red again. The county list is the repo's own bundled county polygons (fixture header), never hand-picked.
 * Illinois has no free statewide parcel service (the ISGS statewide database answers Token Required), so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, countyKeyForName } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { cityScopeAnswer } from "../src/workspaces/site-planner/lib/cityScopes.js";
import { countyRecord, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { IL_ROWS } from "../src/workspaces/site-planner/lib/ilParcels.js";
import { ILLINOIS_VERIFICATION } from "../src/workspaces/site-planner/lib/ilProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/ilCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/ilSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => "il_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const hand = new Set(FX.hand.map(keyOf)); // il_cook / il_dupage / il_will / il_kane — hand-written in counties.js since 2026-09, not in IL_ROWS
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("il_"));
const inCityScope = (la, ln) => !!cityScopeAnswer(la, ln);
const GAP_KIND = /^(none-found|relay-tls|token-required|adapter-needed|partial-copy)$/;

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("IL");
    if (inCityScope(la, ln)) return; // inside a city scope the city source legitimately answers first
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is Illinois' 102 counties", () => {
    expect(FX.counties).toHaveLength(102);
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    const wired = new Set(wiredKeys);
    const gapNames = Object.keys(FX.gaps);
    expect(wired.size + gapNames.length).toBe(102);
    for (const c of FX.counties) {
      const isWired = wired.has(keyOf(c.name));
      const isGap = bare(c.name) in FX.gaps;
      expect(isWired !== isGap, c.name).toBe(true);
    }
  });
  it("every gap records WHY, after a re-search — a bare 'no source' is not a reason", () => {
    for (const [n, g] of Object.entries(FX.gaps)) {
      expect(g.kind, n).toMatch(GAP_KIND);
      expect(g.reason.length, n).toBeGreaterThan(80);
    }
  });
  it("the four hand-written rows are still there", () => {
    for (const k of hand) expect(COUNTIES[k], k).toBeTruthy();
  });
});

describe("every county in Illinois resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    if (inCityScope(c.lat, c.lng)) return; // a centre inside a city scope is answered by the city (tested in cityScopes.test.js)
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
      expect(COUNTIES_MAP[id.key].state).toBe("IL");
    }
  });
});

describe("keys that share a spelling stay apart", () => {
  it("St. Clair, De Witt, DeKalb, LaSalle and Rock Island key from their own names", () => {
    expect(countyKeyForName("St. Clair County", "IL")).toBe("il_stclair");
    expect(countyKeyForName("De Witt County", "IL")).toBe("il_dewitt");
    expect(countyKeyForName("DeKalb County", "IL")).toBe("il_dekalb");
    expect(countyKeyForName("LaSalle County", "IL")).toBe("il_lasalle");
    expect(countyKeyForName("Rock Island County", "IL")).toBe("il_rockisland");
  });
  it("the Illinois Jefferson/Marion/Washington/Union… rows are not another state's", () => {
    for (const k of ["il_jefferson", "il_marion", "il_washington", "il_union", "il_jackson", "il_clay", "il_henry"]) {
      expect(COUNTIES[k].state, k).toBe("IL");
      expect(COUNTIES_MAP[k].state, k).toBe("IL");
    }
    expect(countyIdentity(38.3, -88.9).key).toBe("il_jefferson"); // Mount Vernon, IL — not Jefferson, AL / KY / OH
  });
});

describe("the wired Illinois rows", () => {
  const ROW_KEYS = IL_ROWS.map(([k]) => "il_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...ROW_KEYS, ...hand]));
    expect(IL_ROWS).toHaveLength(62);
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no row carries a token or key in its URL (Planyr sends and reads none)", () => {
    for (const k of ROW_KEYS) expect(COUNTIES[k].layerUrl, k).not.toMatch(/token|[?&]key=/i);
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , la, ln, bb] of IL_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["il_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired Illinois row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of ROW_KEYS) {
      const v = ILLINOIS_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toBe("2026-10-20");
    }
  });
});

describe("a recorded real lot from each source reads back parcel id, address, acreage and (where the layer has one) owner", () => {
  const NO_OWNER = new Set(["Boone County", "Greene County", "Macon County", "Washington County"]);
  it("the fixture covers every wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(IL_ROWS.map(([, n]) => n + " County").sort());
  });
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = keyOf(name);
    const row = COUNTIES[key];
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    expect(row.layerUrl, key).toBe(s.url);
    expect(s.attrs[s.idField], `${name}: the recorded row carries the pinned id column`).toBeTruthy();
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    // the stored account (what the card/list stamps at identify time) is the county's DECLARED column, never a row number or a map-sheet fragment
    expect(idAttrFor(key, s.attrs), `${name}: stamped id`).toBe(String(s.attrs[s.idField]));
    if (!NO_OWNER.has(name)) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
    }
  });
  it("Boone (assessment linework), Greene, Macon and Washington honestly carry no owner", () => {
    for (const n of NO_OWNER) expect(ownerName(SAMPLES[n].attrs), n).toBeNull();
  });
  it("the Devnet / Tyler owner spellings resolve (owner1_nam, TSC_Owner1, PrimaryName, Owner1Name, Primary_Owner, OWN_FULL)", () => {
    expect(ownerName({ owner1_nam: "YOUNG FARMS INC" })).toBe("YOUNG FARMS INC");
    expect(ownerName({ TSC_Owner1: "BOSWELL LINDA" })).toBe("BOSWELL LINDA");
    expect(ownerName({ PrimaryName: "ZIMMERMAN DD MR" })).toBe("ZIMMERMAN DD MR");
    expect(ownerName({ Owner1Name: "Matson Merrill" })).toBe("Matson Merrill");
    expect(ownerName({ Primary_Owner: "GENTRY LARS" })).toBe("GENTRY LARS");
    expect(ownerName({ OWN_FULL: "EDWARD L NIEMEIER " })).toBe("EDWARD L NIEMEIER");
  });
});

describe("measured on the live relay (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const m = s.measured;
    expect(m.hits, `${name}: interior points that returned a lot with a parcel id`).toBeGreaterThanOrEqual(3);
    expect(m.edgeHits, `${name}: points beside the county line`).toBeGreaterThanOrEqual(1);
    // the stronger instrument: a uniform grid over the county polygon, not five hand-spread points
    const g = m.grid;
    expect(g.of, `${name}: grid size`).toBeGreaterThanOrEqual(24);
    expect(g.exact + g.near + g.miss, `${name}: grid adds up`).toBe(g.of);
    expect((g.exact + g.near) / g.of, `${name}: share of the county's area that answers`).toBeGreaterThanOrEqual(0.9);
    const ext = m.extent;
    if (ext) expect(ext[0] >= -91.6 && ext[2] <= -87.4 && ext[1] >= 36.9 && ext[3] <= 42.6, `${name}: extent inside Illinois`).toBe(true);
  });
  it.each(Object.entries(SAMPLES))("%s — the city-hole check: a point query at each of its two largest places finds a lot", (name, s) => {
    expect(s.measured.largestCities.length, name).toBe(2);
    for (const c of s.measured.largestCities) expect(c, `${name}: ${c}`).toMatch(/:(exact|near)$/);
  });
});
