/* B1807200 AMENDMENT (NEW-2, 2026-09-23) — Row 1 / Row 2 header row clearance.
 *
 * Owner report, on the LIVE site after B1807200's box-treatment round shipped: "all the chips are
 * too big for the header. They touch the header." Measured headless: both header rows were
 * `height: 30` holding a 30×30 (border-box) control centered via `alignItems:"center"` — zero
 * clearance top and bottom, in both themes, on both rows. Owner approved a mockup ("Option B —
 * revised") specifying a 40px row height around the unchanged 30×30 controls (5px clearance).
 *
 * This is a SOURCE GUARD, not a live-DOM check (that lives in
 * ui-audit/verify-toolbar-cluster-optionb.mjs, which measures the real rendered clearance) — it
 * pins the ONE shared constant so a future edit can't silently shrink a row back toward the
 * control's own size, or grow the two rows apart from each other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("../src/shared/ui/AppHeader.jsx", import.meta.url)),
  "utf8",
);

describe("B1807200 amendment — header row clearance", () => {
  it("declares ONE shared HEADER_ROW_H constant at the owner-approved 40", () => {
    expect(SRC).toMatch(/const HEADER_ROW_H = 40;/);
  });

  it("Row 1's row div uses HEADER_ROW_H, not a hardcoded 30", () => {
    const idx = SRC.indexOf('ref={rowRef} className={narrow ? "no-hscrollbar" : undefined} style={{ height:');
    expect(idx).toBeGreaterThan(-1);
    const line = SRC.slice(idx, SRC.indexOf("\n", idx));
    expect(line).toMatch(/height:\s*HEADER_ROW_H/);
    expect(line).not.toMatch(/height:\s*30\b/);
  });

  it("both Row 2 layout branches (with and without the center slot) use HEADER_ROW_H", () => {
    const matches = [...SRC.matchAll(/ref=\{row2Ref\}[\s\S]{0,100}?style=\{\{\s*(min)?[Hh]eight:\s*([A-Za-z0-9_]+)/g)];
    expect(matches.length).toBe(2);
    for (const m of matches) expect(m[2]).toBe("HEADER_ROW_H");
  });

  it("a control's own 30×30 size is untouched (this item converges the ROW, never the control)", () => {
    // dIcon/dGhost (SitePlanner.jsx) and CloudSyncBadge/PresenceChip (shared/ui) all still declare
    // 30, not a value derived from HEADER_ROW_H — the two are deliberately independent constants.
    const planner = readFileSync(
      fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)),
      "utf8",
    );
    expect(planner).toMatch(/const dIcon = \{ \.\.\.dGhost, width: 30, height: 30,/);
  });
});
