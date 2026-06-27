import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* B542 — the Deed / Title reader (Schedule B + metes-and-bounds) is a first-class
 * tool-rail launcher, not a menu item buried in the File ▾ (export) dropdown.
 *
 * SitePlanner.jsx is edited by many concurrent sessions, so this is a string-level
 * anti-drift guard (same shape as bugHuntGuards.test.js): it fails loudly if a merge
 * silently moves the launcher back into the export menu, drops the glyph, or — worst —
 * turns the launcher into a tool mode (which would corrupt `tool` and reset drafts).
 * It is a render-free check: no browser, no auth, no seeded site, runs in `npm test`. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

// The deed launcher <button>…</button>, captured from its testid to its own close tag
// (no nested <button>, so the first </button> is this element's).
const deedButton = (src.match(/data-testid="tool-deed"[\s\S]{0,700}?<\/button>/) || [])[0];

describe("B542 — Deed / Title launcher lives in the tool rail", () => {
  it("registers a rail launcher with data-testid='tool-deed'", () => {
    expect(deedButton).toBeTruthy();
  });

  it("opens the metes-and-bounds / Schedule B reader modal on click", () => {
    expect(deedButton).toMatch(/setTitleOpen\(true\)/); // opens the reader
    expect(deedButton).toMatch(/setTitleErr\(""\)/);     // clears any stale error first
    // On the phone overlay rail, dismiss the scrim so the z-index:3000 modal isn't
    // shown over a dimmed rail.
    expect(deedButton).toMatch(/setMobileTools\(false\)/);
  });

  it("renders the deed glyph (not a blank icon)", () => {
    expect(deedButton).toMatch(/<ToolIcon id="deed"\s*\/>/);
    expect(src).toMatch(/\bdeed:\s*<>/); // the ICON_PATHS entry exists
  });

  it("is a launcher, not a tool mode (never selectTool, never active-styled)", () => {
    expect(deedButton).not.toMatch(/selectTool/);
    expect(deedButton).not.toMatch(/tool === "deed"/);
  });
});

describe("B542 — the old export-menu launcher is gone (relocated, not duplicated)", () => {
  it("the File ▾ / export menu no longer carries the title-reader item", () => {
    expect(src).not.toMatch(/Title reader \/ metes/);
    expect(src).not.toMatch(/Read a deed\/title block to plot/);
  });

  it("opens the reader from exactly one place", () => {
    const opens = src.match(/setTitleOpen\(true\)/g) || [];
    expect(opens.length).toBe(1);
  });

  it("Export PNG and Download PDF remain in the export menu", () => {
    expect(src).toMatch(/Export PNG/);
    expect(src).toMatch(/Download PDF \/ pick frame/);
  });
});
