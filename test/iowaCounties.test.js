/* NEW-1 (Iowa, 2026-10-19) — every one of Iowa's 99 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap that says so ("<County> — no parcel data wired here yet.")
 * AND carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main (70a26e2) only Polk was wired, so 55 of these counties fell through to "no-source" and the per-county assertions below go red; `git stash`-ing the iaRaw/iaMap
 * spreads in counties.js turns them red again. The county list is the repo's own bundled county polygons (fixture header), never hand-picked. Iowa has no CURRENT free statewide
 * parcel service (the HSEMD layer is frozen at November 2017), so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { IA_ROWS } from "../src/workspaces/site-planner/lib/iaParcels.js";
import { IOWA_VERIFICATION } from "../src/workspaces/site-planner/lib/iaProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/iaCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/iaSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => "ia_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const hand = new Set(["ia_polk"]); // hand-written in counties.js since 2026-09-11, not in IA_ROWS
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("ia_"));

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("IA");
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is Iowa's 99 counties", () => {
    expect(FX.counties).toHaveLength(99);
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    const wired = new Set(wiredKeys);
    const gapNames = Object.keys(FX.gaps);
    expect(wired.size + gapNames.length).toBe(99);
    for (const c of FX.counties) {
      const isWired = wired.has(keyOf(c.name));
      const isGap = bare(c.name) in FX.gaps;
      expect(isWired !== isGap, c.name).toBe(true);
    }
  });
  it("every gap records WHY, after a re-search — a bare 'no source' is not a reason", () => {
    for (const [n, g] of Object.entries(FX.gaps)) {
      expect(g.kind, n).toMatch(/^(beacon-only|adapter-needed|no-source-found|host-unreachable|stale-only|login-required|city-only|vendor-viewer-only)$/);
      expect(g.reason.length, n).toBeGreaterThan(80);
    }
  });
  it("the hand-written Polk row is still there", () => {
    for (const k of hand) expect(COUNTIES[k], k).toBeTruthy();
  });
});

describe("every county in Iowa resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
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
      expect(COUNTIES_MAP[id.key].state).toBe("IA");
    }
  });
});

describe("the wired Iowa rows", () => {
  const ROW_KEYS = IA_ROWS.map(([k]) => "ia_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...ROW_KEYS, ...hand]));
    expect(IA_ROWS).toHaveLength(55);
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("a Schneider-feed county reads only the county's own public map service, as a guest (no key is carried in any URL)", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (!u.includes("schneidercorp.com")) continue;
      expect(u, k).toMatch(/^\/gis-proxy\/wfs\.schneidercorp\.com\/arcgis\/rest\/services\/[A-Za-z]+CountyIA_(WFS|AGS)\/MapServer\/\d+$/);
      expect(u, k).not.toMatch(/token|key=/i);
    }
  });
  it("the 2017 statewide layer and the Iowa_Parcels_Demo subset are not used by any row", () => {
    for (const k of ROW_KEYS) expect(COUNTIES[k].layerUrl, k).not.toMatch(/Iowa_Parcels_(2017|Demo)|Parcels_20171102/);
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , la, ln, bb] of IA_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["ia_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired Iowa row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of ROW_KEYS) {
      const v = IOWA_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toBe("2026-10-19");
    }
  });
  it("no row rests on a layer last edited before 2020 (the currency floor)", () => {
    for (const [name, s] of Object.entries(SAMPLES)) if (s.lastEdit) expect(s.lastEdit, name).toBeGreaterThanOrEqual(Date.UTC(2020, 0, 1));
  });
});

describe("a recorded real lot from each source reads back parcel id, address, acreage and (where the layer has one) owner", () => {
  it("the fixture covers every wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(IA_ROWS.map(([, n]) => n + " County").sort());
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
    const hasOwner = IA_ROWS.find(([k]) => "ia_" + k === key)[5] === 1;
    if (hasOwner) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
    }
  });
});

describe("measured live (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    expect(s.measured.hits, `${name}: polygons with a parcel id at 5 spread points`).toBeGreaterThanOrEqual(3);
    expect(s.measured.edgeHits, `${name}: points beside the county line`).toBeGreaterThanOrEqual(1);
    const ext = s.measured.extent;
    expect(ext && ext[0] >= -96.7 && ext[2] <= -90.1 && ext[1] >= 40.3 && ext[3] <= 43.6, `${name}: extent inside Iowa`).toBe(true);
  });
});
