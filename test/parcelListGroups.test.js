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
  it("the icon slot is one width for the whole list: padlock + eye + ⋯ always, one more seat once anything overlaps", () => {
    expect(slotWidth(false)).toBeLessThan(slotWidth(true));
    expect(slotWidth(true) - slotWidth(false)).toBe(18); // one icon seat
    expect(slotWidth()).toBe(slotWidth(false));
  });
  it("source guard: the padlock is rendered inside the icon slot, never in the name cell; rename is a menu item", () => {
    const src = readFileSync("src/workspaces/site-planner/components/ParcelsPanel.jsx", "utf8");
    const slotAt = src.indexOf("width: slotW"), lockAt = src.indexOf("parcel-row-lock-"), nameCellAt = src.indexOf("paddingLeft: row.depth");
    expect(lockAt).toBeGreaterThan(slotAt);
    expect(slotAt).toBeGreaterThan(nameCellAt);
    const menu = readFileSync("src/workspaces/site-planner/lib/parcelMenu.js", "utf8");
    expect(menu).toMatch(/id: "rename", label: "Rename"/);   // rename lives in the ONE parcel menu (lib/parcelMenu.js), above Zoom to
    expect(src).toMatch(/<ParcelContextMenu /);
    // the overlap marker is an icon in the slot — never a pill/text in the name block (it would add a line and push the name)
    const ovAt = src.indexOf("parcel-row-overlap-");
    expect(ovAt).toBeGreaterThan(slotAt);
    expect(src).not.toMatch(/>overlaps<\/span>/);
    expect(src).toMatch(/AC overlaps, counted once/);
    // FIXED COLUMNS: seats are rendered for the whole list (not per row) and the slot is left-aligned, so an icon never shifts when
    // a neighbour seat is empty (the 8 South Tract A report)
    expect(src).not.toMatch(/seatLock/);        // the padlock seat is ALWAYS there now (the table's lock column)
    expect(src).not.toMatch(/anyLocked/);
    expect(src).toMatch(/seatOverlap && <span/);
    expect(src).toMatch(/justifyContent: "flex-start", width: slotW/);
    expect(src).toMatch(/parcels-summary-line/);
  });
});


describe("parcel list — a real table (owner 2026-10-16)", () => {
  const src = readFileSync("src/workspaces/site-planner/components/ParcelsPanel.jsx", "utf8");
  it("one column-heading row sits above the list: Acres, a lock icon, an eye icon (and the overlap icon only while a column exists)", () => {
    expect(src).toMatch(/function ColumnHeader/);
    expect(src.match(/<ColumnHeader/g)).toHaveLength(1);        // once, above the first group — never per group
    expect(src).toMatch(/parcels-col-acres/);
    expect(src).toMatch(/seat\("parcels-col-lock"/);
    expect(src).toMatch(/seat\("parcels-col-eye"/);
    expect(src).toMatch(/anyOverlap && seat\("parcels-col-overlap"/);
    expect(src).toMatch(/>Acres</);
  });
  it("every row shows its padlock (closed / open), its eye (open / struck) AND its ⋯ all the time — none waits for hover (NEW-1, 2026-10-22)", () => {
    const row = src.slice(src.indexOf("function ParcelRow"), src.indexOf("function ColumnHeader"));
    expect(row).toMatch(/row\.locked \? <LockGlyph size=\{13\} \/> : <UnlockGlyph size=\{13\} \/>/);
    expect(row).toMatch(/row\.included \? <EyeIcon \/> : <EyeOffIcon \/>/);
    const lockBtn = row.slice(row.indexOf("parcel-row-lock-"), row.indexOf("parcel-row-eye-"));
    expect(lockBtn).not.toMatch(/land-row-hover/);
    const eyeBtn = row.slice(row.indexOf("parcel-row-eye-"), row.indexOf("<RowMenu"));
    expect(eyeBtn).not.toMatch(/land-row-hover/);
    expect(src).not.toMatch(/land-row-hover/);                    // the hover-only class is gone — ⋯ has its own seat like the lock and the eye
    const menu = src.slice(src.indexOf("function RowMenu"), src.indexOf("function ParcelRow"));
    const moreBtn = menu.slice(menu.indexOf("parcel-row-more-") - 300, menu.indexOf("<MoreIcon"));
    expect(menu).toMatch(/parcel-row-more-/);
    expect(moreBtn).not.toMatch(/opacity|className/);
  });
  it("the summary figure is the same weight as the words around it", () => {
    const at = src.indexOf('data-testid="parcels-site-acres"');
    const tag = src.slice(at, src.indexOf(">", at + 40));
    expect(tag).not.toMatch(/fontWeight/);
  });
  it("an unnamed drawn / other lot reads by its number, never 'Unnamed'; a county lot keeps 'Acct …'", () => {
    const r = rows([sq(0, "d1", { source: "drawn" }), sq(300, "d2", { source: "drawn" }), county(600, "c1"), sq(900, "o1")]);
    const labels = r.map((x) => rowText(x).label);
    expect(labels).toEqual(["Parcel 1", "Parcel 2", "Acct 0421c1", "Parcel 4"]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("Unnamed");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/["'`]Unnamed["'`]/);   // no string literal left (comments may still name it)
  });
});

import { parcelNumbers, stampParcelNumbers, parcelDisplayInfo, createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";

describe("parcel numbers are stable (owner 2026-10-16: 'not renumbered when one is deleted')", () => {
  const unnamed = (n) => Array.from({ length: n }, (_, i) => sq(i * 300, `p${i + 1}`, { source: "drawn" }));
  it("an unstamped plan reads 1..n in list order — exactly what the positional rule showed, so no plan changes", () => {
    const n = parcelNumbers(unnamed(4));
    expect([...n.values()]).toEqual([1, 2, 3, 4]);
    expect(parcelDisplayInfo(unnamed(4)).get("p3").name).toBe("Parcel 3");
  });
  it("stamping freezes them: deleting Parcel 2 leaves Parcel 3 and 4 where they were", () => {
    const stamped = stampParcelNumbers(unnamed(4));
    const afterDelete = stamped.filter((p) => p.id !== "p2");
    const info = parcelDisplayInfo(afterDelete);
    expect(info.get("p3").name).toBe("Parcel 3");
    expect(info.get("p4").name).toBe("Parcel 4");
    // …whereas an UNSTAMPED plan would have closed the gap — the bug this fixes
    expect(parcelDisplayInfo(unnamed(4).filter((p) => p.id !== "p2")).get("p3").name).toBe("Parcel 2");
  });
  it("a new lot takes the next number above the highest held, never a freed one in the middle", () => {
    const stamped = stampParcelNumbers(unnamed(3)).filter((p) => p.id !== "p2");
    const grown = stampParcelNumbers([...stamped, sq(2000, "p9", { source: "drawn" })]);
    expect(grown.find((p) => p.id === "p9").parcelNo).toBe(4);
  });
  it("a pasted copy that carries its source's number is renumbered, never shown twice", () => {
    const stamped = stampParcelNumbers(unnamed(2));
    const pasted = [...stamped, { ...stamped[0], id: "copy", parcelNo: 1 }];
    const n = parcelNumbers(pasted);
    expect(n.get("p1")).toBe(1);
    expect(n.get("copy")).toBe(3);
  });
  it("is identity-preserving once stamped (no churn, no loop) and children never take a root number", () => {
    const stamped = stampParcelNumbers(unnamed(2));
    expect(stampParcelNumbers(stamped)).toBe(stamped);
    const withKid = [...stamped, sq(900, "kid", { parentId: "p1" })];
    expect(parcelNumbers(withKid).has("kid")).toBe(false);
    expect(stampParcelNumbers(withKid).find((p) => p.id === "kid").parcelNo).toBeUndefined();
  });
  it("a stored plan arrives stamped (createSiteModel's read normalizer)", () => {
    const m = createSiteModel({ parcels: unnamed(3) });
    expect(m.parcels.map((p) => p.parcelNo)).toEqual([1, 2, 3]);
  });
});
