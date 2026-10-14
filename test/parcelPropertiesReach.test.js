import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parcelAtPoint } from "../src/workspaces/site-planner/lib/parcelAtPoint.js";
import { PARCEL_ACTIONS } from "../src/workspaces/site-planner/lib/parcelActions.js";

/* NEW-1 (2026-10-14) — "I don't have a way to edit my parcels' properties right now … If I double-click the
 * parcel it doesn't really do anything. Same from the Parcels menu." The browser half is the e2e spec
 * parcel-properties-reachable (red on the pre-fix build, all four tests). This is the CI-runnable half: the
 * pure "which lot is under this point" rule, plus source guards that every entry point goes through the ONE
 * `openParcelPage` — the defect was entry points calling a helper that opened the LIST instead. */

const sq = (id, x, y, w, h, extra = {}) => ({ id, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], ...extra });

describe("parcelAtPoint — the lot a double-click on empty land is about", () => {
  const big = sq("big", 0, 0, 1000, 1000);
  const small = sq("small", 100, 100, 200, 200);
  const away = sq("away", 2000, 0, 100, 100);

  it("answers the lot containing the point", () => {
    expect(parcelAtPoint([big, away], { x: 500, y: 500 })).toBe("big");
    expect(parcelAtPoint([big, away], { x: 2050, y: 50 })).toBe("away");
  });
  it("the SMALLEST containing lot wins (a lot drawn inside another, a split child over its parent)", () => {
    expect(parcelAtPoint([big, small], { x: 150, y: 150 })).toBe("small");
    expect(parcelAtPoint([small, big], { x: 150, y: 150 })).toBe("small");   // order-independent
    expect(parcelAtPoint([big, small], { x: 800, y: 800 })).toBe("big");
  });
  it("outside every lot → null (empty canvas stays empty)", () => {
    expect(parcelAtPoint([big, small], { x: -5, y: 500 })).toBe(null);
    expect(parcelAtPoint([], { x: 1, y: 1 })).toBe(null);
  });
  it("skips ids it is told to (superseded split parents, hidden lots)", () => {
    expect(parcelAtPoint([big, small], { x: 150, y: 150 }, { skip: new Set(["small"]) })).toBe("big");
  });
  it("ignores malformed input instead of throwing", () => {
    expect(parcelAtPoint([{ id: "x", points: [{ x: 0, y: 0 }] }, null], { x: 0, y: 0 })).toBe(null);
    expect(parcelAtPoint(null, { x: 0, y: 0 })).toBe(null);
    expect(parcelAtPoint([big], { x: NaN, y: 0 })).toBe(null);
  });
  it("works on a concave lot (the notch is outside)", () => {
    const L = { id: "L", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }] };
    expect(parcelAtPoint([L], { x: 20, y: 80 })).toBe("L");
    expect(parcelAtPoint([L], { x: 80, y: 80 })).toBe(null);
  });
});

describe("every entry point opens the parcel's PAGE (source guards)", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("one openParcelPage, and the list-only helper the entry points used is gone", () => {
    expect(src).toMatch(/const openParcelPage = \(id\) =>/);
    expect(src).not.toMatch(/openParcelPanel\s*\(/);
    const body = src.slice(src.indexOf("const openParcelPage = (id) =>"), src.indexOf("const openParcelPage = (id) =>") + 600);
    expect(body).toMatch(/setParcelPageId\(id\)/);
    expect(body).toMatch(/setLeftPanel\("parcel"\)/);
  });
  it("the double-click decision for a parcel opens its page", () => {
    const i = src.indexOf("const featureDoubleAction = (t, e) =>");
    const branch = src.slice(src.indexOf('if (t.kind === "parcel")', i), src.indexOf('if (t.kind === "parcel")', i) + 300);
    expect(branch).toMatch(/openParcelPage\(t\.id\)/);
  });
  it("a double-click with no feature under it falls back to the lot under the point", () => {
    const i = src.indexOf("const onBgDouble = (e) =>");
    expect(src.slice(i, i + 1600)).toMatch(/featureDoubleAction\(t \|\| interiorParcelTarget\(/);
  });
  it("the list row, the Parcel tools row and the right-click menu all go through it", () => {
    expect(src).toMatch(/onOpenPage: \(id\) => \{ openParcelPage\(id\); \}/);
    expect(src).toMatch(/setbacks: \(\) => \{ if \(selPc\) openParcelPage\(selPc\.id\);/);
    expect(src).toMatch(/data-testid="parcel-menu-properties"[^\n]*openParcelPage\(id\)/);
  });
  it("the Parcel tools row says what it opens", () => {
    const row = PARCEL_ACTIONS.find((a) => a.id === "setbacks");
    expect(row.label).toBe("Properties");
    expect(row.group).toBe("this");
  });
});
