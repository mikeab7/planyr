/* NEW-1 (owner decision 2026-10-08) — an unnamed lot stays unnamed: no name derived from street, owner or legal. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parcelDisplayInfo } from "../src/workspaces/site-planner/lib/siteModel.js";
import { buildParcelRows } from "../src/workspaces/site-planner/lib/parcelOps.js";

const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
const attrs = { OWNER_NAME: "ACME HOLDINGS", SITUS_ADDRESS: "12 Main St" };
describe("unnamed lots stay unnamed", () => {
  it("owner / address / legal never become the name; the row is flagged unnamed", () => {
    const parcels = [{ id: "a", points: pts, addr: "12 Main St", attrs }, { id: "b", points: pts, label: "Typed" }];
    const info = parcelDisplayInfo(parcels);
    expect(info.get("a").name).toBe("Parcel 1");
    expect(info.get("a").unnamed).toBe(true);
    expect(info.get("b").unnamed).toBe(false);
    const rows = buildParcelRows(parcels);
    expect(rows.find((r) => r.id === "a").unnamed).toBe(true);
    expect(rows.find((r) => r.id === "b").unnamed).toBe(false);
  });
  it("the page renders the grey Unnamed placeholder and an empty name field; the LIST reads an unnamed lot by its stable number (owner 2026-10-16)", () => {
    const panel = readFileSync("src/workspaces/site-planner/components/ParcelsPanel.jsx", "utf8");
    const page = readFileSync("src/workspaces/site-planner/components/ParcelPage.jsx", "utf8");
    // the list: never a row of identical "Unnamed" labels — the number (siteModel.parcelNumbers) is the handle; nothing is derived from address / owner / legal
    expect(panel.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/["'`]Unnamed["'`]/);
    expect(panel).toMatch(/label: row\.name, sub, muted: false/);
    expect(page).toMatch(/unnamed \? "Unnamed"/);
    expect(page).toMatch(/placeholder=""/);
  });
});
