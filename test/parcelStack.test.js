/* NEW-1/2/3 (stacked rows, 2026-11-12) — one lot that a county layer returns as SEVERAL rows is ONE lot everywhere:
 *   NEW-1 Bartow GA   — a parcel x improvement join: PARCELID 0080-0202-001 is 170 identical-geometry rows (C003-0013-001: 12).
 *   NEW-2 Rutherford TN — ParcelID 126-050.14-000 is two rows, a 0.12-ac sliver beside the 74.60-ac lot.
 *   NEW-3 Chambers TX — co-owners (one shape, Accounts.Sequence 1/2/3), two overlapping shapes at one point, and an account's total acreage repeated on each of its shapes.
 * The fixtures below carry the shapes measured live (Bartow via the relay 2026-11-12; Chambers/Rutherford per the 2026-10-30 / 2026-11-01 sweep). The fake Bartow server answers like the real one — including its 400 on
 * returnDistinctValues + resultRecordCount — so a search that combines them fails here exactly as it would live.
 * RED-PROOF: on main the Gerdau id search returns ten rows, the address search ten copies, the lot key differs per row, the outline layer holds 170 ghosts and pickIdMatch takes the sliver. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { COUNTIES, COUNTIES_MAP, stackRuleForUrl, stackRuleForCounty } from "../src/workspaces/site-planner/lib/counties.js";
import { collapseStacked, pickAtPoint, stackNote, attrValue, featureRingArea, rekeyStackedOutlines, stackKeyOf } from "../src/workspaces/site-planner/lib/parcelStack.js";
import { lookupParcels } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { queryAtPoint } from "../src/workspaces/site-planner/lib/arcgis.js";
import { parcelKey } from "../src/workspaces/site-planner/lib/parcelIdentity.js";
import { pickIdMatch } from "../src/workspaces/site-planner/lib/tnParcelId.js";
import { countyRecord, shapeDeedAcres } from "../src/workspaces/site-planner/lib/appraisal.js";

const BARTOW = COUNTIES.ga_bartow.layerUrl;
// an esri-JSON rectangle, outer ring clockwise
const rect = (x, y, w, h) => [[[x, y], [x, y + h], [x + w, y + h], [x + w, y], [x, y]]];
const GERDAU = rect(-84.9, 34.2, 0.01, 0.01);
const row = (oid, parcelid, street, rings, extra = {}) => ({ attributes: { OBJECTID: oid, PARCELID: parcelid, STREET_NAM: street, ...extra }, geometry: { rings } });

/* the fake Bartow service: 170 + 12 + 3 copies of three lots, plus 20 single lots on OLD GRASSDALE RD */
const BARTOW_ROWS = (() => {
  const rows = [];
  let oid = 1;
  for (let i = 0; i < 170; i++) rows.push(row(oid++, "0080-0202-001", "OLD GRASSDALE", GERDAU, { FinishedArea: i * 10 }));
  for (let i = 0; i < 12; i++) rows.push(row(oid++, "C003-0013-001", "COOSA VALLEY", rect(-84.8, 34.3, 0.01, 0.01), { FinishedArea: i }));
  for (let i = 0; i < 3; i++) rows.push(row(oid++, "0096-1153-001", "OLD GRASSDALE", rect(-84.7, 34.25, 0.01, 0.01)));
  for (let i = 0; i < 20; i++) rows.push(row(oid++, `0100-00${String(i).padStart(2, "0")}-001`, "OLD GRASSDALE", rect(-84.6 + i * 0.02, 34.1, 0.01, 0.01)));
  return rows;
})();

function fakeBartow() {
  const calls = [];
  const matches = (where) => {
    let m = where.match(/UPPER\((\w+)\) LIKE UPPER\('%(.*)%'\)/);
    if (m) return BARTOW_ROWS.filter((r) => String(r.attributes[m[1]]).toUpperCase().includes(m[2].toUpperCase()));
    m = where.match(/^(\w+) = '(.*)'$/);
    if (m) return BARTOW_ROWS.filter((r) => r.attributes[m[1]] === m[2].replace(/''/g, "'"));
    return BARTOW_ROWS;
  };
  vi.stubGlobal("fetch", vi.fn(async (u) => {
    const url = new URL(u);
    calls.push(url);
    const p = url.searchParams;
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (!url.pathname.endsWith("/query")) {
      return ok({ type: "Feature Layer", name: "Tax Parcels", geometryType: "esriGeometryPolygon", objectIdField: "OBJECTID", fields: [
        { name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "PARCELID", type: "esriFieldTypeString" }, { name: "STREET_NAM", type: "esriFieldTypeString" }] });
    }
    const hit = matches(p.get("where") || "1=1");
    if (p.get("geometry")) return ok({ features: BARTOW_ROWS.filter((r) => r.attributes.PARCELID === "0080-0202-001") }); // a click on Gerdau: every stacked row
    if (p.get("returnDistinctValues") === "true") {
      if (p.get("resultRecordCount")) return ok({ error: { code: 400, message: "Unable to complete operation." } }); // measured live: distinct + a record cap = 400
      const seen = []; hit.forEach((r) => { if (!seen.includes(r.attributes.PARCELID)) seen.push(r.attributes.PARCELID); });
      return ok({ features: seen.map((v) => ({ attributes: { PARCELID: v } })) });
    }
    const n = Number(p.get("resultRecordCount") || 1000);
    return ok({ features: hit.slice(0, n) });
  }));
  return calls;
}

describe("declarations", () => {
  it("only Bartow, Chambers and Rutherford declare a stack rule, each keyed by its lot field", () => {
    const declared = Object.keys(COUNTIES_MAP).filter((k) => COUNTIES_MAP[k].dedupeBy).sort();
    expect(declared).toEqual(["chambers", "ga_bartow", "tn_rutherford"]);
    expect(stackRuleForUrl(BARTOW).by).toBe("PARCELID");
    expect(stackRuleForUrl(BARTOW + "/").distinct).toBe(true);
    expect(stackRuleForCounty("chambers").by).toBe("ChambersCADWeb.DBO.TaxParcels.OBJECTID");
    expect(stackRuleForCounty("chambers").order).toBe("Sequence");
    expect(stackRuleForCounty("tn_rutherford").prefer).toBe("largest");
    expect(stackRuleForCounty("harris")).toBeNull();
  });
});

describe("NEW-1 Bartow — 170 rows are one lot", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("an id search for Gerdau lists the lot ONCE (not ten copies)", async () => {
    fakeBartow();
    const r = await lookupParcels({ county: "ga_bartow", lookupUrl: BARTOW, mode: "id", value: "0080-0202-001" });
    expect(r.feats).toHaveLength(1);
    expect(r.feats[0].attributes.PARCELID).toBe("0080-0202-001");
    expect(r.feats[0].geometry.rings).toBeTruthy();
  });
  it("an address search is not crowded out by copies: every lot appears once, up to the window", async () => {
    fakeBartow();
    const r = await lookupParcels({ county: "ga_bartow", lookupUrl: BARTOW, mode: "address", value: "OLD GRASSDALE" });
    const ids = r.feats.map((f) => f.attributes.PARCELID);
    expect(new Set(ids).size).toBe(ids.length); // no lot twice
    expect(ids).toHaveLength(10); // the window now counts LOTS (23 match; the old ten rows were three lots' copies)
    expect(ids).toContain("0080-0202-001");
    expect(ids).toContain("0096-1153-001");
  });
  it("never sends returnDistinctValues together with a record cap (the live server answers 400)", async () => {
    const calls = fakeBartow();
    await lookupParcels({ county: "ga_bartow", lookupUrl: BARTOW, mode: "address", value: "OLD GRASSDALE" });
    const distinct = calls.filter((u) => u.searchParams.get("returnDistinctValues") === "true");
    expect(distinct.length).toBe(1);
    expect(distinct[0].searchParams.get("resultRecordCount")).toBeNull();
  });
  it("a click over Gerdau returns the one lot", async () => {
    fakeBartow();
    const f = await queryAtPoint(BARTOW, -84.895, 34.205);
    expect(f.attributes.PARCELID).toBe("0080-0202-001");
    expect(f.stack.rows).toBe(170); // recorded, but identical copies of a join are not news — no note
    expect(stackNote(f)).toBeNull();
  });
  it("collapses the live 170-row shape to one row and 12 to one", () => {
    expect(collapseStacked(BARTOW_ROWS.slice(0, 170), stackRuleForUrl(BARTOW))).toHaveLength(1);
    expect(collapseStacked(BARTOW_ROWS.slice(170, 182), stackRuleForUrl(BARTOW))).toHaveLength(1);
    expect(collapseStacked(BARTOW_ROWS, stackRuleForUrl(BARTOW))).toHaveLength(2 + 1 + 20);
  });
  it("two picks of the same lot are ONE lot key, with and without the rule (the rule is what changes it)", () => {
    const rule = stackRuleForCounty("ga_bartow");
    const a = parcelKey(BARTOW_ROWS[0].attributes, GERDAU, { stack: rule });
    const b = parcelKey(BARTOW_ROWS[1].attributes, GERDAU, { stack: rule });
    expect(a).toBe(b);
    expect(a).toBe("pid:0080-0202-001");
    expect(parcelKey(BARTOW_ROWS[0].attributes, GERDAU)).not.toBe(parcelKey(BARTOW_ROWS[1].attributes, GERDAU)); // today's OBJECTID keys: two copies
    expect(parcelKey(BARTOW_ROWS[0].attributes, GERDAU, { stack: rule, namespace: "ga_bartow" })).toBe("ga_bartow:pid:0080-0202-001");
  });
  it("the outline layer holds ONE ghost for the 170 rows (they share an id; a batch keeps the first)", () => {
    const rule = stackRuleForUrl(BARTOW);
    const feats = BARTOW_ROWS.slice(0, 170).map((r, i) => ({ id: r.attributes.OBJECTID, properties: { OBJECTID: r.attributes.OBJECTID, PARCELID: r.attributes.PARCELID }, geometry: { type: "Polygon", coordinates: [] } }));
    const out = rekeyStackedOutlines(feats, rule);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s:0080-0202-001");
    // a feature without the field keeps the server's id
    const keep = rekeyStackedOutlines([{ id: 7, properties: { OBJECTID: 7 } }], rule);
    expect(keep[0].id).toBe(7);
  });
});

describe("NEW-2 Rutherford — duplicate ParcelIDs: the id search takes the lot, not the sliver", () => {
  const sliver = { attributes: { OBJECTID_1: 115188, ParcelID: "126-050.14-000", CALCACRES: 0.12 }, geometry: { rings: rect(-86.5, 35.8, 0.0003, 0.0003) } };
  const lot = { attributes: { OBJECTID_1: 115190, ParcelID: "126-050.14-000", CALCACRES: 74.6 }, geometry: { rings: rect(-86.5, 35.8, 0.02, 0.02) } };
  const attrOf = (f) => f.attributes.ParcelID;
  it("pickIdMatch prefers the largest ring among exact-id rows, whatever order the server lists them", () => {
    expect(pickIdMatch([sliver, lot], "126-050.14-000", attrOf)).toBe(lot);
    expect(pickIdMatch([lot, sliver], "126-050.14-000", attrOf)).toBe(lot);
  });
  it("collapseStacked keeps the 74.6-ac ring and says the id has 2 records", () => {
    const out = collapseStacked([sliver, lot], stackRuleForCounty("tn_rutherford"));
    expect(out).toHaveLength(1);
    expect(out[0].attributes.CALCACRES).toBe(74.6);
    expect(stackNote(out[0])).toBe("2 records share this ID — showing the largest.");
  });
  it("two different ids are never merged", () => {
    const other = { attributes: { ParcelID: "113-020.03-000" }, geometry: { rings: rect(-86.4, 35.8, 0.01, 0.01) } };
    expect(collapseStacked([sliver, other], stackRuleForCounty("tn_rutherford"))).toHaveLength(2);
  });
});

describe("NEW-3 Chambers — co-owners, an overlapping second lot, and the account total", () => {
  const P = "ChambersCADWeb.DBO.";
  const co = (seq, interest, owner) => ({ attributes: { [`${P}TaxParcels.OBJECTID`]: 3693789, [`${P}Accounts.Sequence`]: seq, [`${P}Accounts.Interest`]: interest, [`${P}Accounts.Owner_Name`]: owner, [`${P}TaxParcels.Parcel_Id`]: 5000 }, geometry: { rings: rect(-94.892, 29.841, 0.01, 0.01) } });
  const rule = stackRuleForCounty("chambers");
  it("three owner rows of one shape (listed 3,1,2) are one lot whose primary owner is Sequence 1", () => {
    const f = pickAtPoint([co(3, 0.3, "C"), co(1, 0.525, "A"), co(2, 0.175, "B")], rule, -94.887, 29.846, () => true);
    expect(f.attributes[`${P}Accounts.Owner_Name`]).toBe("A");
    expect(f.stack.rows).toBe(3);
    expect(stackNote(f)).toBe("3 owners are on record for this lot — showing the first.");
  });
  it("two different shapes at one point: one shows, the other is NAMED, not dropped", () => {
    const a = { attributes: { [`${P}TaxParcels.OBJECTID`]: 3699783, [`${P}TaxParcels.Parcel_Id`]: 8039, [`${P}Accounts.Sequence`]: 1 }, geometry: { rings: rect(-94.829, 29.764, 0.02, 0.02) } };
    const b = { attributes: { [`${P}TaxParcels.OBJECTID`]: 3699782, [`${P}TaxParcels.Parcel_Id`]: 8040, [`${P}Accounts.Sequence`]: 1 }, geometry: { rings: rect(-94.829, 29.764, 0.02, 0.02) } };
    const f = pickAtPoint([a, b], rule, -94.82, 29.77, () => true);
    expect(f.attributes[`${P}TaxParcels.Parcel_Id`]).toBe(8039);
    expect(f.stack.others).toEqual([{ label: "8040" }]);
    expect(stackNote(f)).toBe("Another lot overlaps this spot (8040).");
  });
  it("a single plain row is returned untouched, with no note", () => {
    const only = co(1, 1, "A");
    expect(pickAtPoint([only], rule, 0, 0, () => true)).toBe(only);
    expect(stackNote(only)).toBeNull();
  });
  it("the lot key already keeps the SHAPE table's OBJECTID, so co-owner rows and re-clicks are one lot", () => {
    expect(parcelKey(co(1, 1, "A").attributes, [], { stack: rule })).toBe("pid:3693789");
    expect(parcelKey(co(2, 1, "B").attributes, [], { stack: rule })).toBe("pid:3693789");
  });
  it("an account's total repeated on each of its two shapes is not the polygon's acreage (Parcel_Id 3939: 112.834 ac on ~56)", () => {
    const attrs = { [`${P}TaxParcels.OBJECTID`]: 1, [`${P}Accounts.Acres`]: 112.834 };
    expect(shapeDeedAcres(attrs, 56.4)).toEqual({ acres: null, basis: "none" });
    expect(countyRecord(attrs, { ringAcres: 56.4 }).deedAcres).toBeNull();
    // the shape's own stated area wins when it agrees with the ring; the account figure stays when it agrees
    expect(shapeDeedAcres({ ...attrs, [`${P}TaxParcels.StatedArea`]: 56.1 }, 56.4)).toEqual({ acres: 56.1, basis: "shape" });
    expect(countyRecord(attrs, { ringAcres: 112.5 }).deedAcres).toBe(112.834);
    // not a joined account layer, or no ring → no opinion
    expect(shapeDeedAcres({ GIS_ACRES: 3 }, 50)).toBeNull();
    expect(countyRecord({ ACRES: 112.834 }, { ringAcres: 56.4 }).deedAcres).toBe(112.834);
  });
});

describe("the pure helpers", () => {
  it("attrValue reads exact, case-insensitive and table-prefixed keys, never a different prefixed table", () => {
    expect(attrValue({ PARCELID: "a" }, "PARCELID")).toBe("a");
    expect(attrValue({ parcelid: "a" }, "PARCELID")).toBe("a");
    expect(attrValue({ "X.DBO.Accounts.Sequence": 2 }, "Sequence")).toBe(2);
    expect(attrValue({ "X.DBO.Accounts.OBJECTID": 2 }, "X.DBO.TaxParcels.OBJECTID")).toBeUndefined();
  });
  it("rows with no key are never merged", () => {
    const rule = { by: "PARCELID" };
    expect(collapseStacked([{ attributes: {} }, { attributes: {} }], rule)).toHaveLength(2);
    expect(stackKeyOf({ PARCELID: " a " }, rule)).toBe("a");
  });
  it("ring area ranks a lot above its sliver", () => {
    expect(featureRingArea({ geometry: { rings: rect(0, 0, 2, 2) } })).toBeGreaterThan(featureRingArea({ geometry: { rings: rect(0, 0, 0.1, 0.1) } }));
  });
});
