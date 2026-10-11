/* Parcels list layout C (NEW-2): grouping by source, the row label rules, and the calm summary. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { groupRows, groupKeyOf, rowText } from "../src/workspaces/site-planner/components/ParcelsPanel.jsx";
import { buildParcelRows } from "../src/workspaces/site-planner/lib/parcelOps.js";

const sq = (x, id, extra = {}) => ({ id, points: [{ x, y: 0 }, { x: x + 100, y: 0 }, { x: x + 100, y: 100 }, { x, y: 100 }], ...extra });
const county = (x, id, extra = {}) => sq(x, id, { source: "county", gisKey: id, acct: "0421" + id, ...extra });
const rows = (parcels) => buildParcelRows(parcels, { cadName: "Harris CAD" });

describe("parcel list layout C", () => {
  it("groups in County → Combined → Drawn → Other order and drops empty groups", () => {
    const r = rows([
      { ...sq(0, "m"), label: "Mystery" }, sq(300, "d", { source: "drawn", label: "Parcel 1" }), county(600, "c1"),
      { ...sq(900, "t", { label: "Tract A" }), combined: { from: [county(0, "a"), county(0, "b")] } },
    ]);
    const g = groupRows(r);
    expect(g.map((x) => x.key)).toEqual(["county", "combined", "drawn", "other"]);
    expect(g.map((x) => x.count)).toEqual([1, 1, 1, 1]);
    expect(groupRows(rows([county(0, "c1")])).map((x) => x.key)).toEqual(["county"]);
  });
  it("a deed outline lives with Drawn; a split piece stays with the lot it was cut from", () => {
    const r = rows([sq(0, "dd", { source: "deed", label: "Deed" })]);
    expect(groupKeyOf(r[0])).toBe("drawn");
  });
  it("group acres count ACTIVE parcels only", () => {
    const r = rows([county(0, "a"), county(300, "b", { active: false })]);
    const [g] = groupRows(r);
    expect(g.activeAcres).toBeCloseTo(r[0].acres, 6);
    expect(g.count).toBe(2);
  });
  it("row text: unnamed county lot = 'Acct …' with no second line; named county lot = source line; drawn = none", () => {
    const r = Object.fromEntries(rows([county(0, "u"), county(300, "n", { label: "SCHIEL" }), sq(600, "w", { source: "drawn", label: "Parcel 2" })]).map((x) => [x.id, x]));
    expect(rowText(r.u)).toMatchObject({ label: "Acct 0421u", sub: "" });
    expect(rowText(r.n)).toMatchObject({ label: "SCHIEL", sub: "Harris CAD · 0421n" });
    expect(rowText(r.w)).toMatchObject({ label: "Parcel 2", sub: "" });
  });
  it("the list is never truncated and the summary is one calm line (source guard)", () => {
    const src = readFileSync("src/workspaces/site-planner/components/ParcelsPanel.jsx", "utf8");
    expect(src).not.toMatch(/textOverflow:\s*"ellipsis"/);
    expect(src).not.toMatch(/font-display/);
    expect(src).toMatch(/AC in site/);
    expect(src).not.toMatch(/marginLeft: row\.depth/); // a split piece's indent must not shift the acres column
    expect(src).toMatch(/paddingLeft: row\.depth/);
    expect(src).not.toMatch(/parcels-active-head/);
  });
});

import { overlapAcres, overlapNamesOf, slotWidth } from "../src/workspaces/site-planner/components/ParcelsPanel.jsx";
import { overlappingParcelPairs } from "../src/workspaces/site-planner/lib/polyClip.js";

describe("parcel list — overlap disclosure (owner real-data check 2026-10-11)", () => {
  const box = (id, x, y, extra = {}) => ({ id, points: [{ x, y }, { x: x + 400, y }, { x: x + 400, y: y + 400 }, { x, y: y + 400 }], source: "drawn", label: id, ...extra });
  it("rows carry who they overlap; the gap between the rows and the dissolved site total is the disclosed overlap", () => {
    const parcels = [box("A", 0, 0), box("B", 200, 200), box("C", 5000, 0)];
    const rows = buildParcelRows(parcels, { overlapPairs: overlappingParcelPairs(parcels) });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("A").overlaps.map((o) => o.id)).toEqual(["B"]);
    expect(byId.get("B").overlaps.map((o) => o.id)).toEqual(["A"]);
    expect(byId.get("C").overlaps).toEqual([]);
    expect(overlapNamesOf(byId.get("A"), byId)).toMatch(/^B \(\d+\.\d\d ac\)$/);
    const additive = rows.reduce((t, r) => t + r.acres, 0);
    const overlapSq = 200 * 200; // the shared corner
    expect(overlapAcres(rows, additive - overlapSq / 43560)).toBeCloseTo(overlapSq / 43560, 4);
  });
  it("no overlap, no disclosure — a few hundredths of dust never shows", () => {
    const rows = buildParcelRows([box("A", 0, 0), box("C", 5000, 0)], { overlapPairs: [] });
    expect(overlapAcres(rows, rows.reduce((t, r) => t + r.acres, 0))).toBe(0);
    expect(overlapAcres(rows, rows.reduce((t, r) => t + r.acres, 0) - 0.01)).toBe(0);
  });
  it("the icon slot is one width for the whole list: two icons, three once anything is locked", () => {
    expect(slotWidth(false)).toBeLessThan(slotWidth(true));
    // one seat per marker kind, the same width each: padlock seat === overlap seat
    expect(slotWidth(true, false) - slotWidth(false, false)).toBe(slotWidth(false, true) - slotWidth(false, false));
    expect(slotWidth(true, true)).toBeGreaterThan(slotWidth(true, false));
  });
  it("source guard: the padlock is rendered inside the icon slot, never in the name cell; rename is a menu item", () => {
    const src = readFileSync("src/workspaces/site-planner/components/ParcelsPanel.jsx", "utf8");
    const slotAt = src.indexOf("width: slotW"), lockAt = src.indexOf("parcel-row-lock-"), nameCellAt = src.indexOf("paddingLeft: row.depth");
    expect(lockAt).toBeGreaterThan(slotAt);
    expect(slotAt).toBeGreaterThan(nameCellAt);
    expect(src).toMatch(/item\("Rename"/);
    // the overlap marker is an icon in the slot — never a pill/text in the name block (it would add a line and push the name)
    const ovAt = src.indexOf("parcel-row-overlap-");
    expect(ovAt).toBeGreaterThan(slotAt);
    expect(src).not.toMatch(/>overlaps<\/span>/);
    expect(src).toMatch(/AC overlaps, counted once/);
    expect(src).toMatch(/parcels-summary-line/);
  });
});
