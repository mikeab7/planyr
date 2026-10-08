// Flat left-rail panels (owner NEW-1, "Option A") — the CI-runnable half of the contract. The
// behavioural half (render every tab at phone + desktop width, assert no empty header strip, one ×,
// no nested card, no gutter chips) is ui-audit/verify-flat-rail-panels.mjs; this fails the build if
// the source drifts back to the nested-card shape.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
const chrome = read("../src/shared/ui/PanelChrome.jsx");
const floating = read("../src/shared/ui/FloatingPanel.jsx");
const analysis = read("../src/workspaces/site-planner/components/SiteAnalysis.jsx");
const between = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));

describe("one header row per rail panel", () => {
  it("every rail tab has a panel title (a missing one rendered an empty × strip on Drainage)", () => {
    const ids = [...between("const leftTabs = [", "];").matchAll(/id: "(\w+)"/g)].map((m) => m[1]);
    const titles = between("const panelTitle = {", "};");
    for (const id of ids) expect(titles, `panelTitle.${id}`).toMatch(new RegExp(`\\b${id}:`));
  });
  it("PanelChrome carries icon + one-line subtitle + an action slot, in both hosts", () => {
    expect(chrome).toContain("subtitle");
    expect(chrome).toContain("data-panel-actions");
    expect(chrome).toMatch(/textOverflow: "ellipsis"/);
    expect(floating).toContain("actionsRef={actionsRef}");
    expect(src).toContain("panelHeaderSubtitle}"); // Parcels rework: the Parcels header drops the subtitle, every other panel keeps it
  });
  it("Yield and Drainage no longer draw a header of their own", () => {
    for (const fn of ["function YieldPanel(", "function DrainagePanel("]) {
      const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 400_000);
      const head = body.slice(0, body.indexOf("  return (") + 400);
      expect(head).not.toContain("openPanel");
    }
    expect(src).toContain("headerSlot && drainage && drainage.onCheck && createPortal(");
  });
});

describe("no card inside the panel", () => {
  it("the Section primitive draws no border/radius/background/shadow around its content", () => {
    const sec = between("function Section(", "function PropLabel");
    expect(sec).not.toMatch(/borderRadius:\s*12/);
    expect(sec).not.toContain("boxShadow");
    expect(sec).not.toContain("background: SURF_RAISED");
  });
  it("Yield / Drainage panels are not wrapped in a bordered card", () => {
    expect(src).toContain('data-testid="yield-panel" data-flat-panel="1"');
    expect(src).toContain('data-testid="drainage-panel" data-flat-panel="1"');
  });
  it("Analysis verdict rows are a thin left bar, not tinted cards (NEW-1 redesign)", () => {
    expect(analysis).toContain("data-check-row");
    // the verdict row carries severity as a left bar + figure colour only — never a fill or a card border
    const row = analysis.slice(analysis.indexOf("data-check-row"), analysis.indexOf("data-check-row") + 700);
    expect(row).toContain("borderLeft");
    expect(row).not.toMatch(/background:/);
    expect(row).not.toMatch(/borderRadius/);
  });
});

describe("status rows read label-left / value-right (no left-gutter chip)", () => {
  it("the verdict strip has no gutter pill column", () => {
    const strip = between('data-testid="yield-verdict-strip"', "yield-verdict-suffix");
    expect(strip).not.toContain('gridTemplateColumns: "40px 1fr"');
    expect(strip).toContain("data-verdict-label");
    expect(strip).toContain("data-verdict-value");
    // what the pill said is not lost: it rides the value end as a status word
    expect(strip).toContain("data-verdict-status");
  });
  it("the phone panel stops at the Tools edge tab so it can never cover the header ×", () => {
    expect(src).toContain("calc(100vw - ${54 + TOOLS_TAB_WIDTH_PX}px)");
  });
});

describe("populated-state groups found boxed by the live check (V1421552)", () => {
  it("Analysis's 'Who governs this site' group is divider-bounded, not a bordered card", () => {
    const g = analysis.slice(analysis.indexOf('data-section="governs"'), analysis.indexOf('data-section="governs"') + 400);
    expect(g).toContain("borderTop");
    expect(g).not.toMatch(/border: "1px solid/);
    expect(g).not.toContain("borderRadius");
  });
  it("Drainage's 'Assumptions: correct if needed' group is a flat divider group, not a card", () => {
    const i = src.indexOf('data-flat-group="assumptions"');
    expect(i).toBeGreaterThan(0);
    const g = src.slice(i, i + 260);
    expect(g).toContain("borderTop");
    expect(g).not.toContain("borderRadius");
    expect(g).not.toContain("background:");
  });
  it("Land's parcel-table rows are divider rows (accent rule when selected), not bordered cards", () => {
    const rows = read("../src/workspaces/site-planner/components/ParcelsPanel.jsx");
    const i = rows.indexOf('data-testid={`parcel-table-row-');
    expect(i).toBeGreaterThan(0);
    const g = rows.slice(i, i + 700);
    expect(g).toContain("borderBottom: LINE");
    expect(g).toContain("borderRadius: 0");
    expect(g).not.toContain("RADIUS.md");
  });
});
