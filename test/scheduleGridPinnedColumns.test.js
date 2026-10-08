/* NEW-1/NEW-3 (Schedule grid holds at narrow widths) — the CI-RUNNABLE half.
 *
 * The behaviour is pixel geometry, proven in a real browser by `ui-audit/verify-grid-narrow-width.mjs`
 * (pinned ID/Task, pinned ●, the half-pane Task cap, header/body alignment, no page-level sideways
 * scroll — red on the pre-fix page, green after) and `ui-audit/verify-grid-help-clearance.mjs` (the shell's
 * Help "?" intersects no grid cell). Neither can run in this repo's CI, so this file pins the structural
 * facts those proofs rest on: a future edit that drops the pins, the cap, the corner reservation or the
 * keyboard-reveal accounting fails the build instead of only failing a script nobody remembered to run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

describe("Schedule grid — pinned columns (NEW-1)", () => {
  it("pins the leading ID/Task run left and the trailing ●/Status run right with sticky cells", () => {
    expect(seq).toMatch(/if \(c\.k === "id" \|\| c\.k === "name"\) pinL\.push\(c\.k\)/);
    expect(seq).toMatch(/if \(k === "health" \|\| k === "status"\) pinR\.unshift\(k\)/);
    expect(seq).toMatch(/position: "sticky", zIndex: z/);
  });
  it("caps the Task column at about half of THIS pane's own width, as a display width only", () => {
    expect(seq).toMatch(/const nameCap = \(leftOthers\) => Math\.max\(NAME_MIN_W, Math\.floor\(gridW \* 0\.5\) - leftOthers\)/);
    // the pane is measured by observing the grid's own box — never window.innerWidth
    expect(seq).toMatch(/new ResizeObserver\(measure\); ro\.observe\(el\)/);
    // the saved/resized widths keep feeding the Split divider snap; only the rendered width is capped
    expect(seq).toMatch(/onColWidths\(\{ order: colOrder, widths: colWidths \}\)/);
  });
  it("stops pinning on a pane too small to scroll under them", () => {
    expect(seq).toMatch(/pinLW \+ pinRW > gridW \* 0\.8\) \{ pinL = \[\]; pinR = \[\]; \}/);
  });
  it("every row kind paints pinned cells opaque (header, rows, review rows, empty rows) and tags the header cells", () => {
    expect((seq.match(/pinStyle\(c\.k,/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(seq).toMatch(/data-hdr-col=\{c\.k\}/);
    expect(seq).toMatch(/backgroundColor: "var\(--bg\)"/);
  });
  it("the keyboard reveal scrolls a cell out from under the pinned columns, in display widths", () => {
    expect(seq).toMatch(/visLeft  = el\.scrollLeft \+ pin\.lw, visRight = el\.scrollLeft \+ el\.clientWidth - pin\.rw/);
    expect(seq).toMatch(/\.\.\.pin\.w \}/);
  });
  it("the ⋯ columns button steps left of the pinned-right group instead of covering it", () => {
    expect(seq).toMatch(/top:4,right:14\+pinRW,zIndex:30/);
  });
  it("the Task name carries its full text as a tooltip", () => {
    expect(seq).toMatch(/<span title=\{task\.name \|\| undefined\} style=\{\{overflow:"hidden",textOverflow:"ellipsis"/);
  });
});

describe("Schedule grid — the Help button's corner (NEW-3)", () => {
  it("pads the END of each scroll surface by --fab-dock (taller under a coarse pointer), and never shortens the page (NEW-1)", () => {
    expect(seq).toMatch(/html\.in-iframe \{ --fab-dock: 48px; \}/);
    expect(seq).toMatch(/@media \(pointer: coarse\) \{ html\.in-iframe \{ --fab-dock: 64px; \} \}/);
    // the page itself fills the window — a shortened root/app box is the dead band the owner reported
    expect(seq).toMatch(/id="root" style="height:100vh"/);
    expect(seq).toMatch(/height:"100vh",display:"flex",flexDirection:"column"/);
    expect(seq).not.toMatch(/height:calc\(100vh - var\(--fab-dock/);
    expect(seq).not.toMatch(/height:"calc\(100vh - var\(--fab-dock/);
    // grid, Gantt and Task Report scrollers carry the clearance as scroll-end padding
    expect((seq.match(/paddingBottom:`?"?calc\(var\(--fab-dock|paddingBottom:"var\(--fab-dock/g) || []).length).toBeGreaterThanOrEqual(3);
    // and the shell is told not to lift the "?" for this page
    expect(seq).toContain('setAttribute("data-corner-free","1")');
  });
});
