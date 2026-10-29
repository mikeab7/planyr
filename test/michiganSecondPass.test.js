/* NEW-1 (Michigan second pass, 2026-10-29) — the 15 counties still filed `none` were searched a second time (owner request: "run a second, deeper
 * search on every county still marked none"). Outcome: none newly wired; the first pass had mislabelled most of them as "BS&A Online only" because
 * that is all the State's tax-parcel directory links — the counties' OWN sites link a vendor map (FetchGIS, Colligo, Schneider Beacon) or nothing.
 *
 * RED-PROOF: on main c79bc2e every one of the 15 rows reads `none` (so 11 of the assertions below fail), and the doc/fixture rows carry no
 * second-pass record. This file pins the dispositions, that each one names the vendor/URL evidence behind it, that the person-facing sentence and
 * the request link are the right ones, and that the measurement-only relay hosts used to read the county sites did not stay in the allow-list. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { PARCEL_GAPS, parcelGapNotice, PARCEL_REQUEST_EMAIL } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { countyIdentity, COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/miCounties.json", import.meta.url), "utf8"));
const DOC = readFileSync(new URL("../docs/STATEWIDE-PARCELS.md", import.meta.url), "utf8");
const RELAY_SRC = readFileSync(new URL("../functions/gis-proxy/[[path]].js", import.meta.url), "utf8");
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

/* county → [table reason, a phrase the table note AND the fixture reason must carry, the vendor URL the county's own site links] */
const SECOND_PASS = {
  Alcona: ["none", "Schneider Beacon", "beacon.schneidercorp.com/Application.aspx?AppID=1164"],
  Alger: ["locked", "Colligo", "colligogis.com/desktop/#sqpf5DSkqDPbsKy7"],
  Alpena: ["none", "no parcel map", null],
  Chippewa: ["locked", "FetchGIS", "app.fetchgis.com/?currentMap=eup"],
  Clare: ["locked", "FetchGIS", "app.fetchgis.com/clare"],
  Crawford: ["locked", "Colligo", "colligogis.com/#S6wdeWC2y8VaRHj5"],
  Iosco: ["locked", "FetchGIS", "app.fetchgis.com/?currentMap=iosco"],
  Iron: ["locked", "Colligo", "colligogis.com/desktop/#QrqmP6RYbHZ3DuVn"],
  Luce: ["locked", "Colligo", "colligogis.com/desktop/#HU5daGUuXuRqc8Tx"],
  Menominee: ["locked", "Colligo", "colligogis.com/desktop/#ZmdxvcJUMXkUMiUH"],
  Ogemaw: ["locked", "FetchGIS", "app.fetchgis.com/ogemaw"],
  Oscoda: ["none", "Schneider Beacon", "beacon.schneidercorp.com/Application.aspx?App=OscodaCountyMI"],
  "Presque Isle": ["none", "Schneider Beacon", "beacon.schneidercorp.com/Application.aspx?App=PresqueIsleCountyMI"],
  Schoolcraft: ["locked", "FetchGIS", "app.fetchgis.com/?currentMap=cuppad"],
  Washtenaw: ["locked", "approved by Washtenaw County", "utility.arcgis.com/usrsvcs/servers/62c5"],
};
const keyOf = (n) => "mi_" + n.toLowerCase().replace(/[^a-z]/g, "");

describe("the 15 second-pass counties are filed by what the search found", () => {
  it("covers exactly the 15 counties the owner named", () => {
    expect(Object.keys(SECOND_PASS).sort()).toEqual(
      ["Alcona", "Alger", "Alpena", "Chippewa", "Clare", "Crawford", "Iosco", "Iron", "Luce", "Menominee", "Ogemaw", "Oscoda", "Presque Isle", "Schoolcraft", "Washtenaw"],
    );
  });

  it.each(Object.entries(SECOND_PASS))("%s → %s", (name, [reason]) => {
    expect(PARCEL_GAPS[keyOf(name)][0]).toBe(reason);
    expect(COUNTIES[keyOf(name)], "a gap must not also be wired").toBeUndefined();
  });

  it("11 are locked and 4 stay none; a `none` always says why (a vendor not yet measured, or no county map)", () => {
    const rows = Object.keys(SECOND_PASS).map((n) => PARCEL_GAPS[keyOf(n)]);
    expect(rows.filter((r) => r[0] === "locked")).toHaveLength(11);
    expect(rows.filter((r) => r[0] === "none")).toHaveLength(4);
    for (const r of rows.filter((x) => x[0] === "none")) expect((r[1] || "").length, "a bare none is not a second-pass result").toBeGreaterThan(30);
  });

  it("the Beacon `none` rows are NOT filed under the owner's measured-Schneider wording (they were not measured)", () => {
    for (const n of ["Alcona", "Oscoda", "Presque Isle"]) {
      const note = PARCEL_GAPS[keyOf(n)][1];
      expect(note).toMatch(/not measured/);
      expect(note.startsWith("Schneider map")).toBe(false);
    }
  });
});

describe("every row keeps its evidence in the research record", () => {
  it.each(Object.entries(SECOND_PASS))("%s: fixture reason + doc row name the vendor URL and the second pass", (name, [, phrase, url]) => {
    const g = FX.gaps[name];
    expect(g.reason, name).toMatch(/Re-searched 2026-10-19\/20 and again in the second pass 2026-10-29/);
    expect(g.reason, name).toContain(phrase);
    if (url) expect(g.reason, name).toContain(url);
    const row = DOC.split("\n").find((l) => l.startsWith(`| ${name} County | `) && /second pass 2026-10-29/i.test(l));
    expect(row, `${name} doc row carries the second-pass record`).toBeTruthy();
    if (url) expect(row).toContain(url);
  });

  it("the doc names the routes run, and the second-pass section totals match the table", () => {
    expect(DOC).toContain("### Second pass (2026-10-29)");
    for (const route of ["ArcGIS Online", "relay", "zoning / land-use / addressing", "wfs.schneidercorp.com", "MISS DIG"]) expect(DOC).toContain(route);
    const sec = DOC.slice(DOC.indexOf("### Second pass (2026-10-29)"), DOC.indexOf("Test: `test/michiganCounties.test.js`"));
    expect((sec.match(/\| locked \|/g) || []).length).toBe(11);
    expect((sec.match(/\| none \|/g) || []).length).toBe(4);
  });
});

describe("what a person sees when they click a second-pass county", () => {
  const point = (name) => {
    const c = FX.counties.find((x) => x.name === `${name} County`);
    return { lat: c.spread[0][0], lng: c.spread[0][1] };
  };
  it.each([["Chippewa", "locked"], ["Washtenaw", "locked"], ["Alpena", "none"]])("%s reads the %s sentence and carries the request link", (name, reason) => {
    const p = point(name);
    const n = parcelGapNotice(countyIdentity(p.lat, p.lng), p);
    expect(n.reason).toBe(reason);
    expect(n.message).toContain(`${name} County`);
    expect(n.href.startsWith(`mailto:${PARCEL_REQUEST_EMAIL}?subject=`)).toBe(true);
    expect(decodeURIComponent(n.href)).toContain(`Parcel data request: ${name} County, MI`);
  });
  it("a locked county does not read the generic 'hasn't found' line", () => {
    const p = point("Clare");
    expect(parcelGapNotice(countyIdentity(p.lat, p.lng), p).message).toMatch(/isn't open to the public/);
  });
});

describe("the measurement-only relay hosts did not stay", () => {
  it("no probe block is left in the allow-list, and none of the county sites or vendor hosts read this pass is relayed", () => {
    expect(RELAY_SRC).not.toMatch(/MI-PASS2-PROBE/);
    for (const h of ["gis.cuppad.org", "app.fetchgis.com", "colligogis.com", "www.missdig811.org", "gis.equatorstudios.com", "ironmi.com", "lucecountymi.com", "iosco.net", "presqueislecounty.org"]) {
      expect(ALLOWED_HOSTS.has(h), `${h} was a one-off measurement host, not a source`).toBe(false);
    }
  });
});
