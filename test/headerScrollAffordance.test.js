/* NEW-2 (B1343201) — neither phone header strip showed that it scrolls: both are cut mid-word at
 * the right edge with no indication more exists. B917073 already shipped an edge FADE
 * (`useScrollEdges`/`edgeFadeMask`, on both rows) — but a fade is not tappable, and on a mouse a
 * scrollbar-less `overflow-x:auto` row has no obvious way to move at all. This item adds the
 * missing half: a chevron that (a) renders ONLY on a side that genuinely has more content,
 * (b) tracks scroll/resize/content changes via the SAME edge state the fade already reads (so the
 * two can never disagree), and (c) actually pages the strip on tap/click.
 *
 * ⛔ THE REAL PROOF IS A HIT TEST IN A BROWSER — `ui-audit/verify-header-touch-targets.mjs` drives
 * a genuinely overflowing header at phone width and asserts a chevron is present, clickable, and
 * advances the row's scrollLeft; and that it disappears once that edge is reached. This suite
 * guards what CAN be checked without a browser: that the chevron reads the SAME edge state as the
 * fade (source guard) and that it never renders unconditionally (would be permanent furniture on
 * a strip that already fits, which the brief explicitly rules out).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const header = readFileSync(join(ROOT, "src/shared/ui/AppHeader.jsx"), "utf8");

describe("ScrollChevron reads the SAME edge state the fade already computes", () => {
  it("Row 1's chevrons are gated on row1Edges — the identical booleans behind row1Mask", () => {
    expect(header).toContain('{narrow && row1Edges.left && <ScrollChevron side="left" onClick={() => pageScrollRow(rowRef, -1)} />}');
    expect(header).toContain('{narrow && row1Edges.right && <ScrollChevron side="right" onClick={() => pageScrollRow(rowRef, 1)} />}');
  });

  it("Row 2's chevrons are ONE shared fragment, rendered in BOTH the 3-zone and 2-zone layouts", () => {
    // Row 2 renders one of two mutually-exclusive branches (toolbarCenter present or not); rather
    // than duplicate the chevron JSX in each (as Row 1's own, single-branch case does), it is
    // computed once as `row2Chevrons` and referenced from both — so both branches stay covered
    // with no risk of drifting apart, at a fraction of the source cost of a second copy.
    expect(header).toContain('row2Edges.left && <ScrollChevron side="left" onClick={() => pageScrollRow(row2Ref, -1)} />');
    expect(header).toContain('row2Edges.right && <ScrollChevron side="right" onClick={() => pageScrollRow(row2Ref, 1)} />');
    const usages = header.split("{row2Chevrons}").length - 1;
    expect(usages).toBe(2);
  });

  it("⛔ never renders on a strip that already fits — no unconditional chevron, no permanent furniture", () => {
    expect(header).not.toMatch(/<ScrollChevron[^>]*\/>\s*(?!\s*\}?\s*\{narrow)/m);
    // Every ScrollChevron DEFINITION site (Row 1 inline, and Row 2's one shared fragment) is
    // guarded by `narrow &&` and an edge boolean — never bare.
    const calls = [...header.matchAll(/\{?narrow && row[12]Edges\.(left|right) && <ScrollChevron/g)];
    expect(calls.length).toBe(4); // row1 (2) + row2Chevrons' own definition (2)
  });

  it("a tap actually pages the row — a real scrollBy, not a decorative click handler", () => {
    expect(header).toContain("function pageScrollRow(ref, dir) {");
    expect(header).toMatch(/el\.scrollBy\(\{ left: dir \* el\.clientWidth \* 0\.72, behavior: "smooth" \}\)/);
  });

  it("MODULE-SCOPE-COMPONENTS — ScrollChevron is defined at module scope, not inside AppHeader's render body", () => {
    const appHeaderBody = header.slice(header.indexOf("export default function AppHeader"));
    expect(appHeaderBody).not.toContain("function ScrollChevron(");
    expect(header.indexOf("function ScrollChevron(")).toBeLessThan(header.indexOf("export default function AppHeader"));
  });

  it("the chevron itself is a real, focusable, labeled control (built on the shared IconButton, so NEW-1's tap-target floor applies to it too)", () => {
    const fn = header.slice(header.indexOf("function ScrollChevron("), header.indexOf("const pageScrollRow") === -1 ? header.indexOf("// A \"page\" is") : header.indexOf("const pageScrollRow"));
    expect(fn).toContain("<IconButton");
    expect(fn).toMatch(/aria-label=\{side === "left" \? "Scroll left" : "Scroll right"\}/);
  });
});

describe("B917073's edge fade is untouched — this item is additive, not a rewrite", () => {
  it("useScrollEdges / edgeFadeMask still exist and still drive both rows' masks", () => {
    expect(header).toContain("function useScrollEdges(ref, active, watchRefs) {");
    expect(header).toContain("function edgeFadeMask({ left, right }) {");
    expect(header).toContain("WebkitMaskImage: row1Mask, maskImage: row1Mask");
    expect(header).toContain("WebkitMaskImage: row2Mask, maskImage: row2Mask");
  });
});

describe("⛔ a chevron/fade that outlives its own overflow — found live by the harness, not reasoned about", () => {
  it("Row 1 also watches the LEFT ZONE for resize, not just the row's own (viewport-clipped) box", () => {
    // Measured live (verify-header-touch-targets.mjs): `overflow-x:auto` means the row's own
    // ResizeObserver entry never fires when a CHILD shrinks (the middle crumb compacting) —
    // only the row's clipped clientWidth would trigger it, and that doesn't change. leftZoneRef
    // is content-sized on narrow (`flex:"0 0 auto"`), so IT shrinks when its child does.
    expect(header).toContain("const row1Edges = useScrollEdges(rowRef, narrow, [leftZoneRef]);");
  });
});
