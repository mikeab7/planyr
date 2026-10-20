/* NEW-1 (Michigan, 2026-10-20) — every one of Michigan's 83 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap that says so
 * ("<County> — no parcel data wired here yet.") AND carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main 70a26e2 only Oakland and Macomb (hand-written) plus the Detroit city scope were wired, so 52 of these counties fell through to "no-source" and the per-county
 * assertions below go red; `git stash`-ing the miRaw/miMap spreads in counties.js turns 52 of them red again. The county list is the repo's own bundled county polygons (fixture
 * header, scripts/gen-mi-county-fixture.mjs), never hand-picked. Michigan has no free statewide parcel service, so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, countyKeyForName } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord, ownerName, ownerKey } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { MI_ROWS } from "../src/workspaces/site-planner/lib/miParcels.js";
import { MICHIGAN_VERIFICATION } from "../src/workspaces/site-planner/lib/miProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/miCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/miSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => "mi_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const hand = new Set(["mi_oakland", "mi_macomb"]); // hand-written in counties.js since 2026-09, not in MI_ROWS
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("mi_") && k !== "mi_detroit");

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("MI");
    if (id.key === "mi_detroit") return; // inside Detroit the city source legitimately answers first
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is Michigan's 83 counties", () => {
    expect(FX.counties).toHaveLength(83);
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    const wired = new Set(wiredKeys);
    const gapNames = Object.keys(FX.gaps);
    expect(wired.size + gapNames.length).toBe(83);
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
      expect(g.reason, n).toMatch(/Re-searched 2026-10-19\/20/);
    }
  });
  it("the hand-written Oakland and Macomb rows and the Detroit city scope are still there", () => {
    for (const k of [...hand, "mi_detroit"]) expect(COUNTIES[k], k).toBeTruthy();
  });
});

describe("every county in Michigan resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.spread[0][0], c.spread[0][1]);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    if (id.key === "mi_detroit") return; // Wayne County's centre-most point can sit in Detroit; the city scope answers there (covered in counties.test.js)
    expect(id.name).toBe(c.name);
    if (bare(c.name) in FX.gaps) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toBe(`${c.name} — no parcel data wired here yet.`);
    } else {
      expect(id.status).toBe("ok");
      expect(id.key).toBe(keyOf(c.name));
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("MI");
    }
  });
});

describe("the multi-word counties key by their squished name", () => {
  it("St. Clair, St. Joseph, Grand Traverse and Van Buren resolve to mi_<squished>", () => {
    expect(countyKeyForName("St. Clair County", "MI")).toBe("mi_stclair");
    expect(countyKeyForName("St. Joseph County", "MI")).toBe("mi_stjoseph");
    expect(countyKeyForName("Grand Traverse County", "MI")).toBe("mi_grandtraverse");
    expect(countyKeyForName("Van Buren County", "MI")).toBe("mi_vanburen");
  });
  it("a Michigan county never answers for a same-named county elsewhere (Wayne, Monroe, Jackson, Lake, Clinton, Washington…)", () => {
    for (const n of ["wayne", "monroe", "jackson", "lake", "clinton", "branch", "eaton", "cass"]) {
      const row = COUNTIES["mi_" + n];
      expect(row.state, n).toBe("MI");
      expect(countyKeyForName(n[0].toUpperCase() + n.slice(1) + " County", "OH"), n + " in OH must not resolve to the Michigan row").not.toBe("mi_" + n);
    }
  });
});

describe("the wired Michigan rows", () => {
  const ROW_KEYS = MI_ROWS.map(([k]) => "mi_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...ROW_KEYS, ...hand]));
    expect(MI_ROWS).toHaveLength(52);
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} -> ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("the relay allow-list carries no Michigan discovery-only host (documentation pages, vendor probes) — only hosts a wired county rides", () => {
    for (const h of ["www.michigan.gov", "www.emcog.org", "wuppdr.org", "app.fetchgis.com", "fetchgis.com", "colligogis.com", "www.baycountymi.gov", "shiawassee.net", "stclaircounty.org"]) {
      expect(ALLOWED_HOSTS.has(h), h).toBe(false);
    }
  });
  it("no layer URL carries a token or key", () => {
    for (const k of ROW_KEYS) expect(COUNTIES[k].layerUrl, k).not.toMatch(/token|key=/i);
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , la, ln, bb] of MI_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["mi_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired Michigan row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of ROW_KEYS) {
      const v = MICHIGAN_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toBe("2026-10-20");
    }
  });
  it("Wayne's 2018 vintage is disclosed on its provenance record", () => {
    expect(MICHIGAN_VERIFICATION.mi_wayne.verifiedNote).toMatch(/2018/);
  });
});

describe("a recorded real lot from each source reads back parcel id, address, acreage and (where the layer has one) owner", () => {
  it("the fixture covers every newly wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(MI_ROWS.map(([, n]) => n + " County").sort());
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
    const hasOwner = MI_ROWS.find(([k]) => "mi_" + k === key)[5] === 1;
    if (hasOwner) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
    } else {
      expect(ownerName(s.attrs), `${name}: an owner-less layer must not invent one`).toBeNull();
    }
  });
  it("the BS&A-export owner spellings resolve (ONERNAME1, BSAEXPORT_ONERNAME1, OWNNM1, parcelmaster_ownername1, Owner_Merg, ParcelMast)", () => {
    for (const k of ["ONERNAME1", "BSAEXPORT_ONERNAME1", "OWNNM1", "parcelmaster_ownername1", "Owner_Merg", "ParcelMast"]) {
      expect(ownerKey({ [k]: "SMITH JOHN & MARY", PIN: "1" }), k).toBe(k);
    }
  });
});

describe("measured on the live relay (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    expect(s.measured.hits, `${name}: polygons with a parcel id at 5 spread + 4 county-line points`).toBeGreaterThanOrEqual(5);
    expect(s.measured.edgeHits, `${name}: points beside the county line`).toBeGreaterThanOrEqual(1);
    const ext = s.measured.extent;
    expect(ext, `${name}: a recorded layer extent`).toBeTruthy();
    expect(ext[0] >= -90.6 && ext[2] <= -82.0 && ext[1] >= 41.6 && ext[3] <= 48.4, `${name}: extent inside Michigan`).toBe(true);
  });
});
