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
 * B570 then folded it INTO the Parcel (was "Boundary") tool group, where it lives now.
 * NEW-1 re-shaped that group: the flyout is now built from `lib/parcelActions.js` rather than
 * hand-written JSX, and the rail button reads "Parcel tools" (the left panel took "Land") — so the
 * deed row's copy + handler live in the inventory and in the render site's `run` map. The
 * `boundary-menu-mb` testid it is clicked by (two ui-audit harnesses) is unchanged. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
const actions = read("../src/workspaces/site-planner/lib/parcelActions.js");

// The Deed/Title row's handler, in the flyout's id → handler map.
const deedRun = (src.match(/\n\s*deed:\s*\(\)\s*=>[^\n]*/) || [])[0];

describe("B570 — Deed / Title (metes & bounds) tool lives in the Parcel tools menu", () => {
  it("the Parcel tools menu has the Deed / Title entry and it opens the existing modal", () => {
    expect(actions).toMatch(/id: "deed"[^\n]*Deed \/ Title/);
    expect(deedRun).toBeTruthy();
    expect(deedRun).toMatch(/setTitleOpen\(true\)/);   // opens the reader/plotter
    expect(deedRun).toMatch(/setTitleErr\(""\)/);       // clears any stale error first
    expect(deedRun).toMatch(/setDeedErr\(""\)/);        // and stale deed state
  });

  it("renders the deed glyph (not a blank icon)", () => {
    expect(src).toMatch(/r\.id === "deed" && <ToolIcon id="deed"/);
    expect(src).toMatch(/\bdeed:\s*<>/); // the ICON_PATHS entry still exists
  });

  it("keeps the testid the ui-audit harnesses click it by", () => {
    expect(src).toMatch(/r\.id === "deed" \? "boundary-menu-mb"/);
  });

  it("is a launcher (opens the modal), not a tool mode", () => {
    expect(deedRun).not.toMatch(/selectTool/);
  });

  it("the rail group is labelled 'Parcel tools' and keeps Draw + Split", () => {
    expect(src).toMatch(/<ToolIcon id="parcel" \/> \{PARCEL_SURFACES\.rail\.name\}/);
    expect(actions).toMatch(/rail: \{ id: "rail", name: "Parcel tools"/);
    expect(actions).toMatch(/id: "draw"[^\n]*Draw new parcel/);
    expect(actions).toMatch(/id: "split"[^\n]*Split a parcel/);
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
