/* B1012560 — Schedule header: the Row-2 3-zone layout (tabs | center group | toolbar, rendered
 * only when a workspace passes `toolbarCenter` — today, only the Scheduler) used to give the
 * LEFT (tabs) and RIGHT (toolbar) zones identical `flex: 1` (basis 0%), splitting the row's
 * space exactly in half between two groups whose real content needs are unequal (~448px of tabs
 * vs ~313px of toolbar cluster on Schedule). This produced TWO symptoms from one cause:
 *   (1) NARROW — below the width where an equal split gave the tabs zone less than its own
 *       content needed, the tab strip silently overflowed (measured break point 1108px).
 *   (2) WIDE — the center (Grid/Split/Gantt) group sat a CONSTANT ~135px off-center at every
 *       width from 1280 to 2560, because equal side BOXES don't center a middle item between
 *       two side groups whose VISIBLE CONTENT widths differ.
 * The fix: the tabs and toolbar zones are content-sized and never grow (`flex:"none"`); the
 * center zone is the ONLY zone that grows, so it alone absorbs the leftover width and splits it
 * evenly either side of its own centered content.
 *
 * ⛔ THE REAL PROOF IS A REAL BROWSER, and it lives in the ui-audit harness
 * `verify-schedule-header-widths.mjs` (mounts the real AppHeader with realistic Schedule-shaped
 * content, drives it at both narrow widths — 900/960/1024/1108 — and wide widths — 1440/1600/
 * 1920/2560 — and asserts both that every module tab resolves to itself AND that the two gaps
 * either side of the center group are equal within a small tolerance). CI cannot run a browser,
 * so this suite guards the one thing it CAN check without one: reading the real source, no zone
 * may regain a content-independent, competing `flex-grow`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const header = readFileSync(join(ROOT, "src/shared/ui/AppHeader.jsx"), "utf8");

// Isolate the 3-zone (toolbarCenter-present) branch of Row 2 so a match in the 2-zone branch
// below it (which legitimately has its own `flex: narrow ? "1 0 auto" : 1` toolbar zone) can't
// accidentally satisfy these assertions.
const threeZoneStart = header.indexOf("{toolbarCenter ? (");
const twoZoneStart = header.indexOf(") : (", threeZoneStart);
if (threeZoneStart < 0 || twoZoneStart < 0) throw new Error("Row 2's toolbarCenter branch moved or was removed — update this test's slice markers.");
const threeZone = header.slice(threeZoneStart, twoZoneStart);

describe("Schedule header Row 2 — exactly ONE zone grows, so leftover width can't be split unevenly", () => {
  it("⛔ the tabs zone never again shares a content-independent flex:1 with any other zone", () => {
    expect(threeZone).not.toMatch(/flex:\s*narrow\s*\?\s*"0 0 auto"\s*:\s*1[,\s]/);
  });

  it("⛔ the toolbar (right) zone never again grows on desktop — that was symptom 2 (off-center)", () => {
    // Pre-fix (equal split): `flex: narrow ? "1 0 auto" : 1`. An intermediate, still-wrong
    // fix tried `flex: "1 0 auto"` unconditionally (fixes the narrow clip, but the toolbar's
    // own growth eats a share of the leftover width that belongs to centering the group beside
    // it, producing a growing — not even constant — off-center gap at wide widths). Neither
    // shape may return on the desktop branch.
    expect(threeZone).not.toMatch(/flex:\s*narrow\s*\?\s*"1 0 auto"\s*:\s*1[,\s]/);
    expect(threeZone).not.toMatch(/flex:\s*"1 0 auto",\s*display/);
  });

  it("the tabs (left) zone is content-sized and never grows or shrinks — primary navigation loses space last", () => {
    expect(threeZone).toContain('flex: "none"');
  });

  it("the toolbar (right) zone is content-sized on desktop, never grows — narrow (phone) is untouched", () => {
    expect(threeZone).toContain('flex: narrow ? "1 0 auto" : "none"');
  });

  it("the center group is the ONLY flexible zone — it alone absorbs the leftover width", () => {
    expect(threeZone).toContain('flex: narrow ? "0 0 auto" : "1 1 auto"');
    // Exactly one `flex-grow: 1` shape (the center's) may appear on the desktop branch —
    // counting occurrences of a bare `1 1 auto`/`: 1,` pattern would be fragile, so this is
    // asserted structurally by the two negative checks above instead: tabs and toolbar are
    // both pinned to "none" on desktop, leaving the center as the sole grower by elimination.
  });

  it("the row justifies content to the end, so a toolbar wrapped onto its own second line still sits flush right", () => {
    expect(threeZone).toContain('justifyContent: "flex-end"');
  });

  it("the row still wraps (flexWrap) rather than clipping when content genuinely can't fit", () => {
    expect(header).toContain('flexWrap: narrow ? "nowrap" : "wrap"');
  });
});

describe("the 2-zone layout (every module without a center slot) was never affected", () => {
  const twoZone = header.slice(twoZoneStart);
  it("its tabs zone is content-sized (flex:\"none\") — the shape B1012560 makes Schedule match", () => {
    expect(twoZone).toContain('flex: "none"');
  });
});
