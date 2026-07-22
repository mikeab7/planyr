// v3 UI SPEC Part B — the pond inspector's top-to-bottom structure and the copy deletions,
// guarded by source scan (the repo's vitest config is DOM-free). Order is checked by the
// position of stable render markers in SitePlanner.jsx.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i;
};
// The pond inspector render body, delimited by its opening arrow and the appearance group.
const pondStart = at('{selEl.type === "pond" && (() => {');
const pondEnd = at('sectionId="pond-appearance"');
const pondBody = src.slice(pondStart, pondEnd);

describe("B1/B2 — header + status card sit above the Dimensions rows", () => {
  it("header (water area) → status card → design-change card → Dimensions render in order", () => {
    const order = [
      "ac water area",
      "statusCards.length > 0",
      "<DesignChangeSummaryCard",
      "{g_atAGlance}",
      "{g_chipRow}",
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("the header carries the geometry-help ⓘ and a Delete button, not the word 'selected'", () => {
    expect(src).toContain('title={selEl.type === "pond" ? TYPE[selEl.type].label');
    expect(pondBody).toContain("Drag the body to move. Drag a corner dot to reshape");
  });
});

describe("B5 — the four collapsed groups in fixed order with the v3 titles", () => {
  it("groups render sizing → outlet → flood → appearance", () => {
    const order = [
      'sectionId="pond-sizing"',
      'sectionId="pond-outlet"',
      'sectionId="pond-flood"',
      'sectionId="pond-appearance"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("titles are exactly the v3 strings (Flood & datum loses 'notes')", () => {
    expect(src).toContain('title="Sizing & criteria"');
    expect(src).toContain('title="Outlet & storms"');
    expect(src).toContain('title="Flood & datum"');
    expect(src).toContain('title="Appearance"');
    expect(src).not.toContain('title="Flood & datum notes"');
  });
});

describe("B3 — Dimensions rows carry the v3 labels (not the old ones)", () => {
  it("has Water area / Land take / Depth / Rim / Holds / Purpose", () => {
    for (const label of ['g_glanceRow("Water area"', 'g_glanceRow("Depth"', 'g_glanceRow("Rim"', 'g_glanceRow("Holds"']) {
      expect(pondBody, label).toContain(label);
    }
    expect(pondBody).toContain("Land take ");
    expect(pondBody).toContain("Purpose ");
  });

  it("the old at-a-glance labels are gone", () => {
    expect(pondBody).not.toContain('g_glanceRow("Water footprint"');
    expect(pondBody).not.toContain('g_glanceRow("Total depth"');
    expect(pondBody).not.toContain('"Rim (top of bank)"');
    expect(pondBody).not.toContain("usable above flood");
  });
});

describe("B2 — the provided/required pair renders once, in the status card (G1)", () => {
  it("the 'ac-ft required' pair lives in the status card, never in the Dimensions rows", () => {
    // The status card is the ONE place the pair is stated.
    expect(pondBody).toContain("ac-ft required");
    const glanceStart = pondBody.indexOf("const g_atAGlance =");
    const glanceEnd = pondBody.indexOf("const g_sizingSummary");
    const glance = pondBody.slice(glanceStart, glanceEnd);
    expect(glance.includes("required")).toBe(false);
    expect(glance.includes("ac-ft required")).toBe(false);
    // no "P of R ac-ft" provided/required pair in the dimensions rows
    expect(/of (the )?\$\{[^}]*\} ac-ft/.test(glance)).toBe(false);
  });
});

describe("G2/G8 — no em dash in the new visible copy; 'Optimize pond' not 'Design pond' on the button", () => {
  it("the status-card body + header + dimensions copy carry no em dash", () => {
    for (const s of [
      "The basin sits below the flood level",
      "Drag the body to move. Drag a corner dot to reshape",
      "incl. berm ring",
    ]) {
      const i = pondBody.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      // the sentence it belongs to (up to the next quote) must have no em dash
      const chunk = pondBody.slice(i, i + 160);
      expect(chunk.includes("—"), s).toBe(false);
    }
  });

  it("the status card's action button reads ⚡ Optimize pond", () => {
    expect(pondBody).toContain("⚡ Optimize pond");
  });
});

// ── v3 post-ship audit — PR-A ───────────────────────────────────────────────────────
const sizingGroup = pondBody.slice(pondBody.indexOf('sectionId="pond-sizing"'), pondBody.indexOf('sectionId="pond-outlet"'));
const outletGroup = pondBody.slice(pondBody.indexOf('sectionId="pond-outlet"'), pondBody.indexOf('sectionId="pond-flood"'));

describe("A3 — the rate-based sizing block moves to ONE row in Outlet & storms", () => {
  it("Outlet & storms carries the 'Outlet sizing check (rate control)' row + its two-questions ⓘ", () => {
    expect(outletGroup).toContain("Outlet sizing check (rate control)");
    expect(outletGroup).toContain("different question from the site's volumetric detention requirement");
    expect(outletGroup).toContain("both must hold.");
  });
  it("Sizing & criteria keeps the inputs but loses the required/provided/shortfall card", () => {
    expect(sizingGroup).toContain("Sizing inputs (screening)");
    // the deleted rows + heading
    expect(sizingGroup.includes("Required detention (screening)")).toBe(false);
    expect(sizingGroup.includes("Provided (this pond")).toBe(false);
    expect(sizingGroup.includes("-yr rate-based")).toBe(false);
    expect(sizingGroup.includes("earns no detention credit")).toBe(false);
    // the words Required / Provided / Shortfall are gone as visible labels
    expect(sizingGroup.includes("Shortfall")).toBe(false);
    expect(sizingGroup.includes("Surplus")).toBe(false);
    // the orphaned Outfall/Pump inputs (only fed the deleted pumped credit) are gone
    expect(sizingGroup.includes('setDet({ outfallMode:')).toBe(false);
  });
});

describe("A4 — the sizing-assistant zero-detention line + 'no targets' line are deleted; heading spaced", () => {
  it("the inundated 'usable detention is ZERO … raise the TOB first' line is not rendered", () => {
    expect(sizingGroup.includes('"assist-inund"')).toBe(false);
    expect(sizingGroup.includes("→ ${a.label}.")).toBe(false);
  });
  it("the bare 'no targets' fallback line is deleted", () => {
    expect(sizingGroup.includes('"no targets"')).toBe(false);
    expect(sizingGroup.includes('detTxt || ')).toBe(false);
  });
  it("the assistant heading has a space before '· est. WSE'", () => {
    expect(sizingGroup).toContain('{" · est. WSE"}');
    expect(sizingGroup.includes(">· est. WSE<")).toBe(false);
  });
});
