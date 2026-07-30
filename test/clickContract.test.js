/* THE CLICK CONTRACT — source guard (NEW-1).
 *
 * Owner report 2026-07-30: "not sure why but single clicks open up the left menu on ponds, fix that,
 * and check other elements, measurements, parcels, buildings, etc." — followed by the second half:
 * "I click on the pond, it automatically pops the menu open… And then if I click-click and drag
 * anywhere on screen, the menu disappears."
 *
 * Both symptoms were ONE defect: the left rail inspector's open/closed state was DERIVED from the
 * selection (a `propsFor` marker that had to keep matching `sel`). So a path that set the marker
 * opened the panel on a plain click, and any deselect — a drag on empty canvas — closed it again.
 *
 * This suite pins the fix at the SOURCE level, which is where the invariant actually lives: there is
 * no selection-derived open marker left, and the panel's visibility is a function of state a user
 * action owns. The LIVE half (a real click / double-click / drag per element type) is
 * `e2e/click-contract.spec.js`, which drives the same shared table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLICK_CONTRACT, E2E_DRIVEN, contractFor } from "../e2e/clickContract.table.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");

/* Pull a `const NAME = [ ... ];` array-of-strings registry straight out of the planner source, so the
 * completeness check below reads the SHIPPED list of types rather than a copy that can drift. */
function stringArrayConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  if (!m) throw new Error(`registry ${name} not found in SitePlanner.jsx`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("the click contract is DECLARED for every selectable type", () => {
  it("every drawable element type has a row in the shared contract table", () => {
    for (const type of stringArrayConst(SP, "DRAW_TYPES")) {
      expect(contractFor(type), `DRAW_TYPES has "${type}" but e2e/clickContract.table.js does not declare it`).toBeTruthy();
    }
  });

  it("every markup tool has a row in the shared contract table", () => {
    for (const type of stringArrayConst(SP, "MARKUP_TOOLS")) {
      expect(contractFor(type), `MARKUP_TOOLS has "${type}" but e2e/clickContract.table.js does not declare it`).toBeTruthy();
    }
  });

  it("the non-drawn selectable kinds (easement / measurement / callout / text / parcel) are declared too", () => {
    for (const type of ["easement", "measure", "callout", "text", "parcel"]) {
      expect(contractFor(type), `"${type}" is selectable but undeclared`).toBeTruthy();
    }
  });

  it("every row declares WHICH surface its double-click opens, and single-click is never one of them", () => {
    for (const c of CLICK_CONTRACT) {
      expect(["inspector", "parcel-panel"], `${c.type}: unknown opens="${c.opens}"`).toContain(c.opens);
      expect(typeof c.label).toBe("string");
    }
    // no duplicate rows — one contract per type
    expect(new Set(CLICK_CONTRACT.map((c) => c.type)).size).toBe(CLICK_CONTRACT.length);
  });

  it("the e2e drive set only names types the table declares", () => {
    for (const type of E2E_DRIVEN) expect(contractFor(type), `E2E_DRIVEN names undeclared "${type}"`).toBeTruthy();
  });
});

describe("the panel's open/closed state is OWNER-owned, never derived from the selection", () => {
  it("the selection-derived open marker (propsFor / propsMatches) is GONE", () => {
    // Its whole failure mode: a marker that had to keep matching `sel` meant selecting opened the
    // panel and deselecting closed it. Neither identifier may come back.
    expect(SP).not.toMatch(/\bsetPropsFor\(/);
    expect(SP).not.toMatch(/\bpropsMatches\b/);
    expect(SP).not.toMatch(/useState\(null\); *\/\/ *propsFor/);
  });

  it("companionOpen is a function of the dock / the phone overlay ONLY — it does not read the selection", () => {
    const m = SP.match(/const companionOpen = ([^;]+);/);
    expect(m, "companionOpen not found").toBeTruthy();
    expect(m[1]).toBe('narrow ? narrowProps : leftPanel === "properties"');
    // Belt and braces: the derivation must not mention any selection state.
    expect(m[1]).not.toMatch(/\bsel\b|companionSel|multi/);
  });

  it("there is exactly ONE explicit open (openInspector) and ONE explicit close (closeInspector)", () => {
    expect(SP).toMatch(/const openInspector = \(\) => \{/);
    expect(SP).toMatch(/const closeInspector = \(\) => \{/);
    // openInspector is the only place the inspector takes the dock.
    expect(SP.match(/setLeftPanel\("properties"\)/g) || []).toHaveLength(1);
    expect(SP).toMatch(/const openInspector = \(\) => \{[\s\S]{0,500}setLeftPanel\("properties"\);/);
  });

  it("no EFFECT opens or closes a left panel off a selection change", () => {
    // The two removed offenders, pinned by their exact shapes so neither can be reintroduced:
    //  (a) parcel selection auto-docking the Parcel panel
    expect(SP).not.toMatch(/if \(sel\?\.kind === "parcel"\) setLeftPanel\("parcel"\)/);
    //  (b) the phone companion following the selection's lifetime
    expect(SP).not.toMatch(/if \(!companionSel\) setNarrowProps\(false\)/);
    // and no effect may key a setLeftPanel off `sel` at all
    expect(SP).not.toMatch(/useEffect\(\(\) => \{[^}]{0,200}setLeftPanel\([\s\S]{0,120}\}, \[sel/);
  });

  it("a deselect lands on the 'Nothing selected' state INSIDE the still-open panel, not on a close", () => {
    // Both render branches are gated on (companionOpen || propsTab) — the open state — with
    // companionSel only choosing WHICH body shows. That is what keeps the panel up through a drag.
    expect(SP).toMatch(/\{\(companionOpen \|\| propsTab\) && companionSel && \(/);
    expect(SP).toMatch(/\{\(companionOpen \|\| propsTab\) && !companionSel && \(/);
    // …and both carry the same testid, so "the inspector is open" is one observable fact.
    expect(SP.match(/<div data-testid="property-panel"/g) || []).toHaveLength(2);
  });

  it("the rail tabs expose data-rail-tab so the live guard can read which panel holds the dock", () => {
    expect(SP).toMatch(/data-rail-tab=\{tb\.id\}/);
  });
});

describe("per-type click wiring (the pond regression, and the types the owner asked us to check)", () => {
  it("POND: a plain click only selects — B875's reveal-on-select is gone", () => {
    expect(SP).not.toMatch(/const revealPondSel =/);
    expect(SP).not.toMatch(/if \(revealPondSel\) revealPondInspector\(id\)/);
    // the locked-pond branch is a plain select too
    expect(SP).toMatch(/if \(el\.locked\) \{ setSel\(\{ kind: "el", id \}\); return; \} \/\/ locked: select only/);
  });

  it("POND: the double-click (canvas AND map label) still reaches the inspector with B875's flash", () => {
    expect(SP).toMatch(/if \(el\.type === "pond"\) revealPondInspector\(id\); else openInspector\(\);/);
    // the map label honours the same contract: double-tap reveals, a single press only selects
    expect(SP).toMatch(/if \(isDoubleTap\(e, `\$\{d\.el\.id\}:label`, wasSel\)\) \{ revealPondInspector\(d\.el\.id\); return; \}/);
    expect(SP).toMatch(/setSel\(\{ kind: "el", id: d\.el\.id \}\); *\/\/ single click: select only/);
  });

  it("PARCEL: single click selects; a double-click opens the Parcel panel", () => {
    expect(SP).toMatch(/if \(isDoubleTap\(e, `parcel:\$\{id\}`, sel\?\.kind === "parcel" && sel\.id === id\)\) \{[\s\S]{0,240}openParcelPanel\(\);/);
    expect(SP).toMatch(/const openParcelPanel = \(\) => \{/);
  });

  it("ELEMENT / MARKUP / MEASUREMENT / CALLOUT double-clicks all route through the ONE explicit open", () => {
    // element (startMoveEl reconstructed double-tap) + the raw-dblclick fallbacks
    expect(SP).toMatch(/const onElDouble = \(e, id\) => \{[\s\S]*?openInspector\(\);/);
    expect(SP).toMatch(/const onMarkupDouble = \(e, id\) => \{[\s\S]*?openInspector\(\);/);
    // markup + measurement double-taps
    expect(SP).toMatch(/isDoubleTap\(e, id, sel\?\.kind === "markup" && sel\.id === id\)\) \{[\s\S]{0,120}openInspector\(\)/);
    expect(SP).toMatch(/isDoubleTap\(e, m\.id, sel\?\.kind === "measure" && sel\.i === idx\)\) \{[\s\S]{0,200}openInspector\(\)/);
    // callout: interior edits text, border opens the inspector (B948 preserved)
    expect(SP).toMatch(/if \(zone === "interior"\) beginEditCallout\(id\);\s*\n\s*else openInspector\(\);/);
  });
});
