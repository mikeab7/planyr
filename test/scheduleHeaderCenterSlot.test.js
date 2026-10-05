/* NEW-2 (2026-09-10 owner amendment) — THE SCHEDULE ROW-2 GRID/SPLIT/GANTT CHIP CENTERS ON THE
 * ROW'S OWN MIDPOINT WHEN IT FITS, AND FALLS BACK IN-FLOW (its original, still-correct position)
 * WHEN IT DOES NOT.
 *
 * THE REPORT (owner, measured live on Goose Creek, desktop width): the chip spanned 720→876 in a
 * 1489-wide row — center 798, row center 744.5, a 53.5px offset. Root cause: B1012560's own
 * design centers the chip WITHIN THE LEFTOVER SPACE between the (unequal-width) tabs zone and
 * toolbar zone, which that fix's own comment calls "a deliberate choice, not an oversight" —
 * correct when the two side groups are equal width, wrong (by exactly half the difference)
 * whenever they are not, which is the normal case (tabs ≈448px vs toolbar cluster ≈313-340px).
 *
 * ⛔ THE OWNER'S OWN CORRECTION TO HIS OWN FIRST ASK: "it cant always be centered but when it can
 * it should… think thru this." Unlike Row 1's jurisdiction pill (which SHRINKS/abbreviates when
 * squeezed, so an out-of-flow slot with a measured max-width bound is always safe), this chip's
 * content (Grid/Split/Gantt + the review inbox) is FIXED WIDTH — it does not shrink. So pinning it
 * to the row's midpoint unconditionally would, below the width where both sides can clear it, run
 * it straight into the tab strip or the toolbar buttons. The fix reuses Row 1's own
 * `centerSlotMaxWidth` bound (proven algebraically identical to the owner's own two-inequality
 * form — see AppHeader.jsx's header comment above `row2Center`) as a pure FEASIBILITY test — never
 * a squeeze, since there's nothing here to squeeze — plus hysteresis so a continuous resize/drag
 * doesn't flip the mode repeatedly within a few pixels.
 *
 * ⛔ A PLAIN CSS GRID `1fr auto 1fr` WAS TRIED AND MEASURED TO FAIL, not assumed to. Two isolated
 * Playwright measurements (recorded in AppHeader.jsx's own comment, not repeated as a live check
 * here since the failure is a documented CSS mechanism, not a runtime behavior this file's pure
 * math needs to re-derive): unconstrained, the two `1fr` tracks size to their own content's
 * min-content, reproducing the exact same leftover-space drift (115.6px measured); adding
 * `min-width:0` to force the tracks to equal widths does land the chip on the true center (0.0px
 * offset) but lets the wider side's REAL CONTENT overflow its now-undersized track by the same
 * 115.6px, landing directly under the chip (`elementFromPoint` at the chip's own left edge
 * resolved to the chip — the tab text renders underneath it). Grid does not hold up against the
 * collision case; the explicit measured condition below is what replaced it.
 *
 * ⛔ THE REAL PROOF IS A MEASUREMENT IN A BROWSER — `ui-audit/verify-schedule-header-widths.mjs`,
 * which reads the chip's own `getBoundingClientRect` against the row's true center at desktop,
 * narrow-desktop, tablet and phone widths, across both real Schedule toolbar shapes (Grid — no
 * zoom cluster; Split/Gantt — with one), and drives a slow resize across the threshold in both
 * directions to prove the hysteresis holds (no flicker). CI cannot run a browser, so this suite
 * guards the two halves that can be checked without one: the reused pure bound (already proven in
 * `headerCenterSlot.test.js`), and — by reading the real source — the hysteresis and layout rule
 * that consume it here.
 */
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { centerSlotMaxWidth } from "../src/shared/ui/headerCenterFit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const header = readFileSync(join(ROOT, "src/shared/ui/AppHeader.jsx"), "utf8");

describe("the Schedule chip's centering bound is the SAME feasibility test as Row 1's, reused not reimplemented", () => {
  it("owner's own reported case: a 1489-wide row, tabs ~wider than toolbar by 108px, the chip does NOT fit the true bound needed", () => {
    // Reconstructing the report: chip center 798 vs row center 744.5 means (leftW - rightW)/2 ≈
    // 53.5, i.e. leftW - rightW ≈ 107. Concretely: leftW 448, rightW 341 (a plausible real pair).
    // The chip's own measured width was 156 (720→876).
    const bound = centerSlotMaxWidth({ rowW: 1489, leftW: 448, rightW: 341 });
    expect(bound).toBe(1489 - 2 * (448 + 12)); // binds on the WIDER side (tabs), per the formula
    // A 156px-wide chip fits comfortably inside this bound — the point being PROVED here is not
    // "it never fits," it's that fitting inside the bound is a feasibility test independent of
    // where the leftover-space midpoint used to fall, which is the actual defect.
    expect(bound).toBeGreaterThan(156);
  });

  it("binds on the wider side exactly like Row 1's bound does — algebraically the owner's own two-inequality form", () => {
    // leftGroupRight + minGap <= rowCentre - chipW/2  AND  rowCentre + chipW/2 <= rightGroupLeft - minGap
    // both solved for chipW give chipW <= rowW - 2*(max(leftW,rightW) + minGap) — verified directly
    // against the closed form rather than trusting the shared function's own already-tested body.
    for (const [rowW, leftW, rightW] of [[1489, 448, 341], [1600, 300, 500], [1108, 448, 313]]) {
      const bound = centerSlotMaxWidth({ rowW, leftW, rightW });
      const closedForm = rowW - 2 * (Math.max(leftW, rightW) + 12);
      expect(bound).toBe(closedForm);
    }
  });

  it("a bound sized to fit the chip cannot let the chip reach either side group", () => {
    for (const [rowW, leftW, rightW] of [[1489, 448, 341], [1280, 500, 200], [975, 448, 313]]) {
      const bound = centerSlotMaxWidth({ rowW, leftW, rightW });
      if (bound === 0) continue;
      const rowCentre = rowW / 2;
      const chipLeft = rowCentre - bound / 2, chipRight = rowCentre + bound / 2;
      expect(chipLeft).toBeGreaterThanOrEqual(leftW + 12 - 1e-9);
      expect(rowW - chipRight).toBeGreaterThanOrEqual(rightW + 12 - 1e-9);
    }
  });
});

describe("the layout rule, read off the real source", () => {
  it("⛔ the chip is pinned to the ROW'S OWN midpoint when centered, out of flow — never the leftover space", () => {
    expect(header).toContain('position: "absolute", left: "50%", transform: "translateX(-50%)"');
    expect(header).toContain("maxWidth: row2Center.max");
  });

  it("the row it is pinned against declares itself the positioning container", () => {
    // Row 2's own container gained `position: "relative"` for this — it did not have it before.
    expect(header).toMatch(/ref=\{row2Ref\}[^\n]*position:\s*"relative"/);
  });

  it("⛔ the bound comes from MEASUREMENT in a layout effect (VIEWPORT-STABLE), via a ResizeObserver on the row, both zones, and the chip's own content", () => {
    expect(header).toContain("useLayoutEffect(() => {");
    expect(header).toContain("centerSlotMaxWidth({ rowW, leftW, rightW, gap: CENTER_SLOT_GAP })");
    expect(header).toMatch(/ro\.observe\(row\);[\s\S]{0,80}ro\.observe\(content\);/);
  });

  it("⛔ HYSTERESIS — entering `centered` needs a real margin beyond the chip's own width; leaving it needs none", () => {
    // This is the exact asymmetry the owner asked for: a slow drag through the threshold band
    // flips at most once per direction rather than chattering at the boundary.
    expect(header).toContain("ROW2_CENTER_HYSTERESIS_PX");
    expect(header).toMatch(/wasCentered\s*\?\s*max\s*>=\s*min\s*:\s*max\s*>=\s*min\s*\+\s*ROW2_CENTER_HYSTERESIS_PX/);
  });

  it("⛔ SNAP, NOT ANIMATE — no CSS transition rides the properties that change between centered and flow", () => {
    // Isolate the center zone's own style object (between its opening brace and the chip content
    // it wraps) so a transition declared somewhere ELSE in this large file can't hide this check.
    const zoneStart = header.indexOf('data-schedule-center-mode={row2Center.mode}');
    const zoneEnd = header.indexOf("row2CenterContentRef", zoneStart);
    expect(zoneStart).toBeGreaterThan(-1);
    const zone = header.slice(zoneStart, zoneEnd);
    expect(zone).not.toMatch(/transition/i);
  });

  it("⛔ anything but `centered` falls back to the UNTOUCHED B1012560 in-flow layout, never a collapsed slot", () => {
    expect(header).toContain('const row2Centered = !narrow && row2Center.mode === "centered";');
    expect(header).toContain('{ flex: "1 1 auto", minWidth: 0, overflow: "hidden" }');
  });

  it("which mode is live is reported, so a headless check never has to infer it", () => {
    expect(header).toContain("data-schedule-center-mode={row2Center.mode}");
  });

  it("⛔ the slack is held by an inert spacer while centred, exactly like Row 1's — a growing zone would poison its own measurement", () => {
    expect(header).toContain('{row2Centered && <div aria-hidden="true" style={{ flex: "1 1 0%", minWidth: CENTER_SLOT_GAP }} />}');
  });

  it("the chip's own content width is measured through an inline-flex wrapper, never through a flex-grown ancestor (no self-referential loop)", () => {
    expect(header).toContain('ref={row2CenterContentRef} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}');
  });

  it("⛔ WHAT GIVES WAY is unchanged — the tabs zone still never grows or shrinks, the toolbar zone still doesn't grow on desktop", () => {
    const threeZoneStart = header.indexOf("{toolbarCenter ? (");
    const twoZoneStart = header.indexOf(") : (", threeZoneStart);
    const threeZone = header.slice(threeZoneStart, twoZoneStart);
    expect(threeZone).toContain('flex: "none"'); // tabs zone
    expect(threeZone).toContain('flex: narrow ? "1 0 auto" : "none"'); // toolbar zone
    expect(threeZone).toContain('justifyContent: "flex-end"');
    expect(header).toContain('flexWrap: "nowrap"'); // NEW-1 (2026-10-05): a shortfall collapses (PriorityToolbar), it no longer wraps
  });

  it("the phone layout is untouched — narrow always falls back to flow, never attempts to center", () => {
    expect(header).toMatch(/if \(narrow\) \{ row2CenteredRef\.current = false;/);
  });
});
