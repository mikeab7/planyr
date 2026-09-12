/* NEW-4 (B1343203) — the pure decision behind the phone-narrow breadcrumb's middle-crumb collapse.
 * See `src/shared/ui/breadcrumbFit.js`'s own header for the report this answers and the rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { crumbNeedsCompact, CRUMB_SEP_W } from "../src/shared/ui/breadcrumbFit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("crumbNeedsCompact — the pure rule", () => {
  it("never compacts when there is no measured budget (desktop, or not yet measured)", () => {
    expect(crumbNeedsCompact({ availableWidth: null, dashboardWidth: 1000, projectWidth: 1000, planWidth: 1000, hasPlan: true })).toBe(false);
  });

  it("never compacts a 2-crumb trail — with no plan crumb, the project crumb IS the last one", () => {
    expect(crumbNeedsCompact({ availableWidth: 50, dashboardWidth: 60, projectWidth: 200, planWidth: 0, hasPlan: false })).toBe(false);
  });

  it("stays full when the whole trail already fits", () => {
    const args = { availableWidth: 400, dashboardWidth: 70, projectWidth: 150, planWidth: 120, hasPlan: true };
    // 70 + 14*2 + 150 + 120 = 368 <= 400
    expect(crumbNeedsCompact(args)).toBe(false);
  });

  it("⛔ the reported case — Goose Creek: Map + a real project name + a real plan name genuinely overflow a phone width", () => {
    // Approximate real crumb widths on the owner's report (his crumb chip caps at 240, floors at
    // 92 — see CRUMB_MIN_W in ProjectBreadcrumb.jsx) against an iPhone-width budget.
    const args = { availableWidth: 340, dashboardWidth: 70, projectWidth: 200, planWidth: 200, hasPlan: true };
    // 70 + 28 + 200 + 200 = 498 > 340
    expect(crumbNeedsCompact(args)).toBe(true);
  });

  it("compacts right at the boundary — strictly greater, not greater-or-equal", () => {
    const base = { dashboardWidth: 100, projectWidth: 100, planWidth: 100, hasPlan: true };
    const exact = 100 + CRUMB_SEP_W * 2 + 100 + 100;
    expect(crumbNeedsCompact({ ...base, availableWidth: exact })).toBe(false);
    expect(crumbNeedsCompact({ ...base, availableWidth: exact - 1 })).toBe(true);
  });

  it("treats missing widths as zero rather than throwing", () => {
    expect(crumbNeedsCompact({ availableWidth: 10, hasPlan: true })).toBe(true);
    expect(crumbNeedsCompact({ availableWidth: 1000, hasPlan: true })).toBe(false);
  });
});

describe("the wiring, read off the real source", () => {
  const crumb = read("src/shared/ui/ProjectBreadcrumb.jsx");
  const header = read("src/shared/ui/AppHeader.jsx");

  it("⛔ only the MIDDLE crumb ever compacts — Dashboard and the trailing planSlot are never candidates", () => {
    // Dashboard crumb's own button carries no compact branch at all.
    const dashBtnBlock = crumb.slice(crumb.indexOf("Dashboard crumb (B192)"), crumb.indexOf("Project crumb (B191)"));
    expect(dashBtnBlock).not.toMatch(/crumbCompact/);
    // The trailing crumb wraps the REAL planSlot node (no duplicate render — a plan switcher owns
    // its own open/close state and anchor ref).
    expect(crumb).toContain("<span ref={planSlotRef}");
    expect(crumb).not.toMatch(/planSlot\s*&&\s*planSlot/); // never rendered twice
  });

  it("the compact affordance still opens the SAME switcher — never a dead-end glyph", () => {
    const projectBtnBlock = crumb.slice(crumb.indexOf('data-testid="project-crumb"'), crumb.indexOf("NEW-4 (B1343203) — an always-mounted"));
    expect(projectBtnBlock).toContain('onClick={() => setOpen((o) => !o)}');
    // NEW-3's own rule (a text ellipsis is at the mercy of the platform font) applies here too —
    // a real drawn SVG icon, never a "…"/"⋯" character rendered as the crumb's own content.
    expect(projectBtnBlock).toContain("<CollapsedCrumbIcon />");
    const rendered = projectBtnBlock.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rendered).not.toMatch(/[⋯…]/);
  });

  it("AppHeader hands ProjectBreadcrumb its own row ref, never a guessed constant for the budget", () => {
    expect(header).toContain("narrow={narrow}");
    expect(header).toContain("rowRef={rowRef}");
  });

  it("the breadcrumb measures its OWN left edge against the row's right edge for the budget", () => {
    expect(crumb).toContain("row.getBoundingClientRect().right - wrap.getBoundingClientRect().left");
  });

  it("the budget never compacts off the phone breakpoint or with no row ref wired", () => {
    expect(crumb).toContain('if (!narrow || !planSlot || !rowRef) { setCrumbCompact((c) => (c ? false : c)); return undefined; }');
  });

  it("⛔ a child effect reading an ANCESTOR's ref cannot trust it on the very first call — found live, not reasoned about", () => {
    // `rowRef` is AppHeader's own ref, attached to an element that CONTAINS this component.
    // React attaches refs bottom-up in the same traversal as layout effects, so a descendant's
    // layout effect (this one) fires before an ancestor's own ref exists — this component's
    // FIRST measure() call can read `rowRef.current === null`. Live-harness proof this was a
    // real, not theoretical, bug: without the rAF retry below, the reported case (Goose Creek /
    // Phase II - Revision at 375px) never compacted at all, permanently, on first load.
    expect(crumb).toContain("if (!row) return;");
    expect(crumb).toContain("const raf = requestAnimationFrame(measure);");
    // …and once the row genuinely exists, it is ALSO handed to the ResizeObserver — a live
    // resize/rotation after mount (no reload) must still re-decide compaction, not just a fresh
    // mount at a given size.
    expect(crumb).toContain("if (hasRO && ro && !rowObserved) { ro.observe(row); rowObserved = true; }");
  });
});
