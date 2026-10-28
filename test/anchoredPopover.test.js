import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NEW-1 / B2465520 — a popover opened from a Schedule cell stays attached to that cell.
//
// Owner report (Schedule › Grid): open the traffic-light picker on a row, scroll the wheel — the picker stayed
// put while the rows moved away under it. Cause: the rect was read once, in the click handler, into a
// `position:fixed` portal. Fix: one shared hook (`useAnchoredPopover`) that re-reads the anchor every frame and
// closes the popover (no commit) the instant the anchor is no longer visible.
//
// The BEHAVIOUR (real wheel, real page, known-bad arm on origin/main) is proven in
// ui-audit/verify-schedule-anchored-popovers.mjs. This is the CI-runnable half: the pure verdict, run through the
// REAL source (sliced out of public/sequence/index.html, not a mirror), and a sweep that stops the old pattern
// coming back. Red-proof: against the pre-change source `anchorHidden` / `useAnchoredPopover` do not exist and
// every test here fails at extraction.
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

const sliceFrom = (signature, close) => {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`"${signature}" not found in public/sequence/index.html`);
  return src.slice(start, src.indexOf(close, start) + close.length);
};
const { anchorHidden } = new Function(`
  ${sliceFrom("const anchorHidden = (r, area, occluders) => {", "\n};")}
  return { anchorHidden };
`)();

const area = { left: 0, top: 100, right: 800, bottom: 600 };      // the grid's scroll box
const cell = (top, left = 300) => ({ top, bottom: top + 24, left, right: left + 60, width: 60, height: 24 });
const header = { left: 0, right: 800, top: 100, bottom: 130 };    // the sticky header row
const pinned = { left: 0, right: 250, top: 100, bottom: 600 };    // the pinned id/name columns

describe("anchorHidden — when a cell's popover must close", () => {
  it("a cell inside the grid is visible", () => {
    expect(anchorHidden(cell(300), area, [header, pinned])).toBe(false);
  });
  it("closes when the cell has scrolled out of any edge of the grid", () => {
    expect(anchorHidden(cell(60), area, [])).toBe(true);                                  // above the top
    expect(anchorHidden(cell(610), area, [])).toBe(true);                                 // below the bottom
    expect(anchorHidden(cell(300, -80), area, [])).toBe(true);                            // off the left
    expect(anchorHidden(cell(300, 820), area, [])).toBe(true);                            // off the right
  });
  it("stays open while the cell is only PARTLY out of the grid (an edge row, like a spreadsheet)", () => {
    expect(anchorHidden(cell(92), area, [])).toBe(false);
    expect(anchorHidden(cell(590), area, [])).toBe(false);
  });
  it("closes when the cell sits fully UNDER the sticky header — the picker must never draw over the header row", () => {
    expect(anchorHidden(cell(104), area, [header])).toBe(true);
    expect(anchorHidden(cell(120), area, [header])).toBe(false);                          // straddling the header's bottom edge: still partly visible
  });
  it("closes when the cell is fully behind a pinned column, but not a cell in the pinned column itself", () => {
    expect(anchorHidden(cell(300, 100), area, [pinned])).toBe(true);
    expect(anchorHidden(cell(300, 240), area, [pinned])).toBe(false);
    expect(anchorHidden(cell(300, 100), area, [])).toBe(false);                           // no occluder passed (the pinned cell's own column is excluded by the caller)
  });
  it("a cell with no layout at all (display:none, detached) is gone", () => {
    expect(anchorHidden({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }, area, [])).toBe(true);
  });
});

describe("the hook is the one mechanism, and nothing positions a fixed popup from a one-time rect any more", () => {
  const hook = sliceFrom("function useAnchoredPopover(", "\n}\n");
  it("re-reads the anchor every animation frame (no listener to miss) and hands off to the caller's close", () => {
    expect(hook).toMatch(/requestAnimationFrame\(tick\)/);
    expect(hook).toMatch(/goneRef\.current\(\)/);
    expect(hook, "no scroll/resize listener to race").not.toMatch(/addEventListener/);
  });
  it("measures once synchronously before paint so a popup never flashes at its old place", () => {
    expect(hook).toMatch(/useLayoutEffect/);
  });
  it("every grid/header/panel popover that was positioned from a click-time rect now uses the hook", () => {
    const users = src.match(/useAnchoredPopover\(/g) || [];
    // definition + HealthPicker, StatusPicker, ContactPicker, DepCell, ProjDropdown, HealthColHeader,
    // StatusHeaderDropdown, NotesColHeader, MBMultiPick, RuleColorPicker
    expect(users.length).toBeGreaterThanOrEqual(11);
  });
  it("sweep: no `getBoundingClientRect()` is followed by a setPos/setMenuPos (the click-time snapshot) outside the hook", () => {
    const lines = src.split("\n");
    const offenders = [];
    lines.forEach((ln, i) => {
      if (!/getBoundingClientRect\(\)/.test(ln) || /^\s*(\*|\/\/)/.test(ln)) return;
      const next = lines.slice(i, i + 4).join("\n");
      if (!/\bset(Menu)?Pos\(/.test(next)) return;
      // GroupOrderMenu (Master view) is the one sanctioned exception: it is opened from a click and CLOSES on any
      // scroll or resize (capture listeners right above it), so it can never be stranded.
      if (/right: Math\.max\(8, window\.innerWidth - r\.right\)/.test(next)) return;
      offenders.push(`line ${i + 1}: ${ln.trim().slice(0, 100)}`);
    });
    expect(offenders, "a popover placed from a one-time rect will float off its cell when the grid scrolls — use useAnchoredPopover").toEqual([]);
  });
  it("the grid's sticky header is marked so a cell scrolled under it closes its picker", () => {
    expect(src).toMatch(/<div data-grid-header="1" style=\{\{position:"sticky",top:0/);
    expect(src).toMatch(/<th key="__jump" data-grid-header="1"/);
  });
  it("the two context menus that open at a click point also close on window resize", () => {
    expect(sliceFrom("function ProjContextMenu(", "\n}\n")).toMatch(/addEventListener\("resize", onClose\)/);
    expect(sliceFrom("function TaskContextMenu(", "const vw = window.innerWidth")).toMatch(/addEventListener\("resize", onClose\)/);
  });
});
