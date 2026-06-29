import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* Deed / Title (metes & bounds) tool placement — render-free anti-drift guard
 * (same shape as bugHuntGuards.test.js). SitePlanner.jsx is edited by many
 * concurrent sessions, so this fails loudly if a merge moves the tool back into the
 * File ▾ export menu, drops its glyph, duplicates it, or turns the launcher into a
 * tool mode (which would corrupt `tool`). No browser / auth / seeded site needed.
 *
 * History: B543 first lifted it out of the File menu into a standalone rail launcher;
 * B567 then folded it INTO the Parcel (was "Boundary") tool group, where it lives now. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

// The Deed/Title entry now lives in the Parcel ▾ menu, keyed by this testid.
const deedBtn = (src.match(/data-testid="boundary-menu-mb"[\s\S]{0,500}?<\/button>/) || [])[0];

describe("B567 — Deed / Title (metes & bounds) tool lives in the Parcel menu", () => {
  it("the Parcel menu has the Deed / Title entry and it opens the existing modal", () => {
    expect(deedBtn).toBeTruthy();
    expect(deedBtn).toMatch(/Deed \/ Title/);
    expect(deedBtn).toMatch(/setTitleOpen\(true\)/);   // opens the reader/plotter
    expect(deedBtn).toMatch(/setTitleErr\(""\)/);       // clears any stale error first
    expect(deedBtn).toMatch(/setDeedErr\(""\)/);        // and stale deed state
  });

  it("renders the deed glyph (not a blank icon)", () => {
    expect(deedBtn).toMatch(/<ToolIcon id="deed"/);
    expect(src).toMatch(/\bdeed:\s*<>/); // the ICON_PATHS entry still exists
  });

  it("is a launcher (opens the modal), not a tool mode", () => {
    expect(deedBtn).not.toMatch(/selectTool/);
  });

  it("the parcel group is labelled 'Parcel' (renamed from 'Boundary') and keeps Draw + Split", () => {
    // the rail group button reads "Parcel ▾"
    expect(src).toMatch(/<ToolIcon id="parcel" \/> Parcel /);
    expect(src).toMatch(/Draw new parcel/);
    expect(src).toMatch(/Split a parcel/);
  });

  it("the old standalone rail launcher is gone (folded into the menu)", () => {
    expect(src).not.toMatch(/data-testid="tool-deed"/);
  });

  it("opens the reader from exactly one place (no duplicate launcher)", () => {
    const opens = src.match(/setTitleOpen\(true\)/g) || [];
    expect(opens.length).toBe(1);
  });
});

describe("the old File ▾ export-menu launcher stays gone", () => {
  it("the export menu no longer carries the title-reader item", () => {
    expect(src).not.toMatch(/Title reader \/ metes/);
    expect(src).not.toMatch(/Read a deed\/title block to plot/);
  });
  it("Export PNG and Download PDF remain in the export menu", () => {
    expect(src).toMatch(/Export PNG/);
    expect(src).toMatch(/Download PDF \/ pick frame/);
  });
});
