/* NEW-1 (B2348000, 2026-10-19) — every one of Kansas's 105 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap that says so
 * ("<County> — no parcel data wired here yet.") AND carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main 70a26e2 only Wyandotte was wired, so every other wired Kansas county fell through to "no-source" and the per-county assertions below go red;
 * dropping the ksRaw/ksMap spreads in counties.js turns them red again. The county list is the repo's own bundled county polygons (fixture header), never
 * hand-picked. Kansas has no complete free statewide parcel service (the state's ORKA layer holds four counties), so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { cityScopeAnswer } from "../src/workspaces/site-planner/lib/cityScopes.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { KS_ROWS } from "../src/workspaces/site-planner/lib/ksParcels.js";
import { KANSAS_VERIFICATION } from "../src/workspaces/site-planner/lib/ksProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";
import { PARCEL_GAPS } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { PARCEL_COPIES } from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { readParcelGapRows } from "../scripts/lib/parcelGapDoc.mjs";

const FX = JSON.parse(readFileSync(new URL("./fixtures/ksCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/ksSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => "ks_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const hand = new Set(["ks_wyandotte"]); // hand-written in counties.js since 2026-09, not in KS_ROWS
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("ks_"));
const inCityScope = (la, ln) => !!cityScopeAnswer(la, ln);

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("KS");
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is Kansas's 105 counties", () => {
    expect(FX.counties).toHaveLength(105);
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    const wired = new Set(wiredKeys);
    const gapNames = Object.keys(FX.gaps);
    expect(wired.size + gapNames.length).toBe(105);
    for (const c of FX.counties) {
      const isWired = wired.has(keyOf(c.name));
      const isGap = bare(c.name) in FX.gaps;
      expect(isWired !== isGap, c.name).toBe(true);
    }
  });
  it("every gap records WHY, after a re-search — a bare 'no source' is not a reason", () => {
    for (const [n, g] of Object.entries(FX.gaps)) {
      expect(g.kind, n).toMatch(/^(login-required|adapter-needed|no-api|none-found|host-down|token-gated|map-private|vendor-key)$/);
      expect(g.reason.length, n).toBeGreaterThan(80);
    }
  });
  it("the hand-written Wyandotte row is still there", () => {
    for (const k of hand) expect(COUNTIES[k], k).toBeTruthy();
  });
});

describe("every county in Kansas resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    if (inCityScope(c.lat, c.lng)) return;
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
      expect(COUNTIES_MAP[id.key].state).toBe("KS");
    }
  });
});

describe("the wired Kansas rows", () => {
  const ROW_KEYS = KS_ROWS.map(([k]) => "ks_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...ROW_KEYS, ...hand]));
    expect(new Set(wiredKeys).size).toBe(KS_ROWS.length + hand.size);
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
  it("the four counties served by the state's shared ORKA layer are each scoped to their own county code", () => {
    const orka = KS_ROWS.filter(([, , url]) => url.includes("KS_Parcels_ORKA_EB"));
    expect(orka.map(([k]) => k).sort()).toEqual(["cheyenne", "rawlins", "sherman", "thomas"]);
    const codes = orka.map(([, , , , , scope]) => scope);
    expect(new Set(codes).size, "each county has its own scope").toBe(4);
    for (const s of codes) expect(s).toMatch(/^CO_ABBR='[A-Z]{2}'$/);
  });
  it("no row carries a token or key in its URL", () => {
    for (const [k, , url] of KS_ROWS) expect(url, k).not.toMatch(/token|[?&]key=/i);
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , la, ln, bb] of KS_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["ks_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired Kansas row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of ROW_KEYS) {
      const v = KANSAS_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toMatch(/^2026-10-(19|29)$/); // 10-19 = the first pass (B2348000); 10-29 = the second pass (B2497840)
    }
  });
});

describe("a recorded real lot from each source reads back parcel id, address, acreage and (where the layer has one) owner", () => {
  it("the fixture covers every wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(KS_ROWS.map(([, n]) => n + " County").sort());
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
  });
});

describe("measured live (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    expect(s.measured.hits, `${name}: polygons with a parcel id at the 5 spread + 4 county-line points`).toBeGreaterThanOrEqual(5);
    expect(s.measured.edgeHits, `${name}: points beside the county line`).toBeGreaterThanOrEqual(1);
    const ext = s.measured.extent;
    expect(ext[0] >= -102.2 && ext[2] <= -94.4 && ext[1] >= 36.8 && ext[3] <= 40.1, `${name}: extent inside Kansas`).toBe(true);
  });
});

/* B2497840 (2026-10-29) — the second-pass search of the 46 "none" counties. RED-PROOF: on origin/main all three counties below are named gaps, the Kansas gap table says
 * `none` for 43 counties, and the doc rows carry no second-pass evidence, so every assertion here fails there. */
describe("the second pass: Mitchell, Lincoln and Chase are wired; the other 43 'none' counties are re-filed with the measured reason", () => {
  const SECOND = ["mitchell", "lincoln", "chase"];
  it.each(SECOND)("%s is a wired county with a measured sample, not a gap", (slug) => {
    const key = "ks_" + slug;
    expect(COUNTIES[key], key).toBeTruthy();
    expect(KS_ROWS.some(([k]) => k === slug), key).toBe(true);
    expect(PARCEL_GAPS[key], `${key} must have left the gap table`).toBeUndefined();
    expect(FX.gaps[slug[0].toUpperCase() + slug.slice(1)], `${key} must have left the fixture gaps`).toBeUndefined();
    expect(KANSAS_VERIFICATION[key].verifiedOn).toBe("2026-10-29");
    expect(COUNTIES[key].layerUrl).toMatch(/^https:\/\/services\d*\.arcgis\.com\//);
  });
  it("Mitchell is the county's own layer; Lincoln and Chase are labelled copies with a date", () => {
    expect(KANSAS_VERIFICATION.ks_mitchell.publisher).toBe("own");
    for (const k of ["ks_lincoln", "ks_chase"]) {
      expect(KANSAS_VERIFICATION[k].publisher, k).toBe("third-party");
      expect(PARCEL_COPIES[k], `${k} needs its copy line`).toBeTruthy();
      expect(PARCEL_COPIES[k][1], `${k} carries the data date`).toMatch(/^2026-\d\d$/);
    }
  });
  it("Lincoln's layer also holds Ellsworth and Saline, so it is scoped to Lincoln's own county number (053)", () => {
    const row = KS_ROWS.find(([k]) => k === "lincoln");
    expect(row[5]).toBe("PID LIKE '053%'");
    expect(COUNTIES.ks_lincoln.scopeWhere).toBe("PID LIKE '053%'");
  });
  it("every remaining Kansas gap is `locked`: the state's ORKA parcel service answers Token Required (measured 2026-10-29), so none is an unsearched 'none'", () => {
    const ks = Object.entries(PARCEL_GAPS).filter(([k]) => k.startsWith("ks_"));
    expect(ks).toHaveLength(52);
    for (const [k, v] of ks) expect(v[0], k).toBe("locked");
    expect(PARCEL_GAPS.ks_kiowa[1]).toMatch(/set private by the county/);
    expect(PARCEL_GAPS.ks_pratt[1]).toMatch(/set private by the county/);
    expect(PARCEL_GAPS.ks_allen[1]).toMatch(/injects its own vendor key/);
  });
  it("the doc carries the second-pass evidence on every re-filed row and none of the wired three is still a gap row", () => {
    const doc = readFileSync(new URL("../docs/STATEWIDE-PARCELS.md", import.meta.url), "utf8");
    const rows = readParcelGapRows(doc).filter((r) => r.state === "KS");
    expect(rows).toHaveLength(52);
    const firstPassLocked = new Set(["Graham", "Hamilton", "Johnson", "Linn", "Miami", "Ness", "Rush", "Wilson", "Woodson"]);
    for (const r of rows) {
      expect(["Mitchell", "Lincoln", "Chase"], r.county).not.toContain(r.county);
      if (firstPassLocked.has(r.county)) continue;
      expect(r.kind, r.county).toBe("token-gated — locked");
      expect(r.text, r.county).toMatch(/Second pass 2026-10-29 \(B2497840\)/);
      expect(r.text, r.county).toMatch(/499 Token Required/);
    }
  });
});
