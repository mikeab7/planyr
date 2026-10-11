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
    expect(src).not.toMatch(/parcels-active-head/);
  });
});
