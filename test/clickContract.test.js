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
import { CLICK_CONTRACT, E2E_DRIVEN, contractFor, REVIEW_CLICK_CONTRACT, REVIEW_NON_MARKUP_TOOLS, reviewContractFor } from "../e2e/clickContract.table.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");
const DR = read("../src/workspaces/doc-review/DocReview.jsx");

/* A source guard must assert about CODE, not about prose. These files document the shapes they
 * removed — quoting `setPropsForId(...)` in a comment is exactly how a reader learns what not to
 * reintroduce — so a naive "this string must not appear" check trips on its own documentation.
 * Strip block comments and whole-line `//` comments first. Deliberately does NOT touch trailing
 * `//` comments, which would need a real tokeniser to tell from a `https://` inside a string. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}
const DR_CODE = stripComments(DR);

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
    expect(SP).toMatch(/if \(el\.type === "pond"\) revealPondInspector\(t\.id\); else openInspector\(\);/);
    /* The map label honours the same contract: double-tap reveals, a single press only selects.
       NEW-1 re-keyed it from a private `${id}:label` onto the pond's OWN id. `isDoubleTap` keeps
       ONE tap record, so a private key on chrome that sits over its own object is a POISON: press 1
       on the basin and press 2 on the overhanging label matched nothing either way AND wiped the
       record, so a third press had nothing to pair with. One key per feature is the rule now — the
       ACTION still branches on which surface took the press. */
    expect(SP).toMatch(/if \(isDoubleTap\(e, d\.el\.id, wasSel\)\) \{ featureDoubleAction\(\{ kind: "el", id: d\.el\.id \}, e\); return; \}/);
    expect(SP, "a pond label must not go back to a private double-tap key").not.toMatch(/isDoubleTap\(e, `\$\{d\.el\.id\}:label`/);
    expect(SP).toMatch(/setSel\(\{ kind: "el", id: d\.el\.id \}\); *\/\/ single click: select only/);
  });

  it("PARCEL: single click selects; a double-click opens the Parcel panel", () => {
    expect(SP).toMatch(/if \(isDoubleTap\(e, `parcel:\$\{id\}`, sel\?\.kind === "parcel" && sel\.id === id\)\) \{[\s\S]{0,240}featureDoubleAction\(\{ kind: "parcel", id \}, e\);/);
    expect(SP).toMatch(/const openParcelPanel = \(\) => \{/);
    expect(SP).toMatch(/t\.kind === "parcel"[\s\S]{0,400}openParcelPanel\(\);/);
  });

  /* ⛔ NEW-2 — THE CONTRACT HAS ONE IMPLEMENTATION NOW, AND THAT IS THE POINT OF THIS CASE.
   *
   * The gesture reaches the app by two independent routes — the double-tap reconstructed from two
   * pointerdowns (pointer capture suppresses the native dblclick) and the browser's own `dblclick`,
   * which retargets to the canvas root — and each route used to carry its OWN copy of "what a
   * double-click does". Two copies drift silently: `onElDouble` opened Properties for a LOCKED
   * element while `startMoveEl` refused to, and nothing could notice, because the native route was
   * unreachable. So the guard no longer checks for `openInspector()` at each call site (which is
   * what permitted the drift); it checks that every site DELEGATES, and that the one delegate holds
   * one decision per family. */
  it("ELEMENT / MARKUP / MEASUREMENT / CALLOUT double-clicks all route through the ONE shared action", () => {
    const act = SP.slice(SP.indexOf("const featureDoubleAction = (t, e) => {"));
    expect(act.length, "featureDoubleAction is gone — the contract has no implementation").toBeGreaterThan(0);

    // Every double-click ROUTE delegates: the two reconstructed element paths, the markup path, both
    // measurement surfaces, the parcel path, and the two raw-dispatch natives.
    for (const re of [
      /const onElDouble = \(e, id\) => \{[\s\S]{0,120}featureDoubleAction\(\{ kind: "el", id \}, e\)/,
      /const onMarkupDouble = \(e, id\) => \{[\s\S]{0,120}featureDoubleAction\(\{ kind: "markup", id \}, e\)/,
      /isDoubleTap\(e, id, sel\?\.kind === "markup" && sel\.id === id\)\) \{[\s\S]{0,160}featureDoubleAction\(\{ kind: "markup", id \}, e\)/,
      /isDoubleTap\(e, m\.id, sel\?\.kind === "measure" && sel\.i === idx\)\) \{[\s\S]{0,200}featureDoubleAction\(\{ kind: "measure", i: idx \}, e\)/,
      /isDoubleTap\(e, m\.id, sel\?\.kind === "measure" && sel\.i === i\)\) \{[\s\S]{0,200}featureDoubleAction\(\{ kind: "measure", i \}, e\)/,
    ]) expect(SP, `a double-click route stopped delegating to featureDoubleAction: ${re}`).toMatch(re);

    // …and the delegate makes one decision per family.
    expect(act).toMatch(/if \(el\.groupId\) \{ setMulti\(\[\]\); setDrillId\(t\.id\); setSel\(\{ kind: "el", id: t\.id \}\); return true; \}/); // B261 drill-in
    expect(act, "the locked carve-out must be a decision, not an accident").toMatch(/if \(el\.locked\) return true;/);
    expect(act).toMatch(/if \(m\.locked\) return true;/);
    expect(act).toMatch(/calloutDblAction\(e, t\.id\)/);
    expect(act).toMatch(/setSel\(\{ kind: "measure", i: t\.i \}\)[\s\S]{0,80}openInspector\(\);/);

    // callout: interior edits text, border opens the inspector (B948 preserved)
    expect(SP).toMatch(/if \(zone === "interior"\) beginEditCallout\(id\);\s*\n\s*else openInspector\(\);/);
  });

  /* ⛔ NEW-2 — THE NATIVE `dblclick` NEVER REACHES THE FEATURE'S OWN NODE, so the contract is
   * resolved at the canvas ROOT by hit-testing the point. Measured on the owner's machine: press 1
   * selects, React re-renders the feature, and press 2's click/dblclick collapse to the bare `<svg>`
   * because a click's target is the common ancestor of its down and up targets. This pins the root
   * handler and the render-side identity it depends on; the LIVE half (which asserts the dblclick's
   * own TARGET really is the svg) is e2e/dblclick-properties.spec.js. */
  it("the double-click is resolved at the canvas ROOT, off the live hit stack", () => {
    expect(SP).toMatch(/const onBgDouble = \(e\) => \{[\s\S]{0,400}featureDoubleAction\(resolveDoubleClickTarget\(hitStackAt\(e\.clientX, e\.clientY\)\), e\);/);
    expect(SP, "a double-click mid-draw must still finish the shape, exactly like Enter").toMatch(/const onBgDouble = \(e\) => \{\s*\n\s*if \(finishActiveDrawing\(\)\) return;/);
    expect(SP, "the root resolver must use the browser's own hit-test, never a second geometric one").toMatch(/document\.elementsFromPoint\(x, y\)/);
    // Every family the resolver can name must actually be stamped on the render, or a double-click
    // there resolves to nothing at all.
    for (const [kind, stamp] of [
      ["el", /data-feature=\{`el:\$\{el\.id\}`\}/],
      ["markup", /data-feature=\{`markup:\$\{m\.id\}`\}/],
      ["callout", /data-feature=\{`callout:\$\{c\.id\}`\}/],
      ["parcel", /data-feature=\{`parcel:\$\{pc\.id\}`\}/],
      ["measure", /"data-feature": `measure:\$\{i\}`/],
    ]) expect(SP, `${kind} carries no data-feature stamp — the root dblclick cannot resolve it`).toMatch(stamp);
  });

  /* ⛔ NEW-3 — A DIMENSION NUMBER THAT SITS ON ITS OWN BODY MUST NOT SWALLOW THE GESTURE. A
   * centerline road's width number is anchored to the centreline midpoint, so a double-click aimed
   * at the road could not miss it and the inline width chip opened instead of Properties. Fixed once
   * in the SHARED dispatch, not special-cased for road. */
  it("a dimension number over its element's body forwards the double-click to the body", () => {
    expect(SP).toMatch(/if \(pressIsOverElementBody\(hitStackAt\(e\.clientX, e\.clientY, elementStackEntries\), id\)\) featureDoubleAction\(\{ kind: "el", id \}, e\);\s*\n\s*else editElDim\(el, e\);/);
    expect(SP, "the dimension chrome must be markable, or the body test cannot look past it").toMatch(/<g key="dim" data-el-dim="1"/);
    expect(SP, "road must not be special-cased in the dispatch").not.toMatch(/el\.type === "road"[^\n]{0,80}editElDim/);
  });
});

/* ---------------------------------------------------------------------------------------------
 * B1190 — THE SAME CONTRACT IN DOCUMENT REVIEW.
 *
 * Review carried the identical defect in a different file: a `propsForId` marker that had to keep
 * matching `sel`, plus an effect that cleared it on every selection change — so a deselect closed
 * the Properties section the user had deliberately opened. The fix mirrors B1188 (an owner-owned
 * `propsOpen` flag, selection choosing the BODY only, a "Nothing selected" state instead of a
 * vanish), and this half of the guard makes it un-regressable at the source.
 *
 * It also extends the COMPLETENESS check the item asked for: Review's own TOOLS registry is read
 * out of the shipped source, so a new drawable tool cannot land without declaring its click
 * behaviour in the shared table.
 */
describe("B1190 — Document Review declares the click contract for every markup tool", () => {
  /* Pull the `{ id: "...", label: "...", hint: … }` rows out of Review's own TOOLS registry, so the
   * completeness check reads the SHIPPED list rather than a copy that can drift. */
  function reviewToolIds() {
    const m = DR.match(/const TOOLS = \[([\s\S]*?)\n\];/);
    if (!m) throw new Error("TOOLS registry not found in DocReview.jsx");
    return [...m[1].matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((x) => x[1]);
  }

  it("every Review tool is either declared in the contract table or listed as a non-markup mode", () => {
    for (const id of reviewToolIds()) {
      const declared = !!reviewContractFor(id) || REVIEW_NON_MARKUP_TOOLS.includes(id);
      expect(declared, `DocReview TOOLS has "${id}" but e2e/clickContract.table.js declares neither a click contract nor a non-markup mode for it`).toBe(true);
    }
  });

  it("the table names no tool Review does not ship, and has no duplicate rows", () => {
    const ids = new Set(reviewToolIds());
    for (const c of REVIEW_CLICK_CONTRACT) expect(ids.has(c.tool), `table declares "${c.tool}", which is not in DocReview's TOOLS`).toBe(true);
    for (const t of REVIEW_NON_MARKUP_TOOLS) expect(ids.has(t), `non-markup list names "${t}", which is not in DocReview's TOOLS`).toBe(true);
    expect(new Set(REVIEW_CLICK_CONTRACT.map((c) => c.tool)).size).toBe(REVIEW_CLICK_CONTRACT.length);
    for (const c of REVIEW_CLICK_CONTRACT) expect(c.opens).toBe("inspector");
  });
});

describe("B1190 — Review's Properties section is OWNER-owned, never derived from the selection", () => {
  it("the selection-derived open marker (propsForId) is GONE", () => {
    // The marker AND its clearing effect are the defect. Neither may come back.
    expect(DR_CODE).not.toMatch(/\bsetPropsForId\(/);
    expect(DR_CODE).not.toMatch(/\bpropsForId\b/);
  });

  it("no EFFECT closes the section off a selection change", () => {
    // The exact removed shape, pinned so it cannot be reintroduced verbatim…
    expect(DR_CODE).not.toMatch(/setPropsForId\(\(cur\) => \(cur && cur === sel \? cur : null\)\)/);
    // …and, more generally, no effect keyed on `sel` may write the open state at all.
    expect(DR_CODE).not.toMatch(/useEffect\(\(\) => \{[^}]{0,200}setPropsOpen\([\s\S]{0,120}\}, \[sel/);
  });

  it("open and close are ONE explicit pair, and the render gate reads the open flag", () => {
    expect(DR).toMatch(/const openMarkupProps = \(\) => setPropsOpen\(true\);/);
    expect(DR).toMatch(/const closeMarkupProps = \(\) => setPropsOpen\(false\);/);
    // Visibility is the open flag × what is selected — never `sel` deciding on its own.
    expect(DR).toMatch(/const showSelProps = propsOpen && !!selM;/);
  });

  it("a deselect lands on a 'Nothing selected' state INSIDE the still-open section, not on a close", () => {
    // This is the branch that used to be a vanish: open + nothing selected still renders.
    expect(DR).toMatch(/const emptyState = propsOpen && !selM && !armed;/);
    expect(DR).toMatch(/if \(!showSelProps && !armed && !emptyState\) return null;/);
    expect(DR).toMatch(/data-testid="props-nothing-selected"/);
  });

  it("there is an explicit CLOSE affordance, so an owner-owned open state is not a one-way door", () => {
    expect(DR).toMatch(/aria-label="Close properties"/);
    expect(DR).toMatch(/onClick=\{closeMarkupProps\}/);
    // Escape closes the section BEFORE it clears the selection — the same order as the planner.
    expect(DR).toMatch(/if \(propsOpen\) \{ setPropsOpen\(false\); return; \}/);
  });

  it("every double-click / fresh-draw path routes through the ONE explicit open", () => {
    // Exactly ONE `setPropsOpen(true)` in the whole file: the body of openMarkupProps. Every
    // other open path has to go through it, which is what keeps "what opens this" answerable.
    expect(DR_CODE.match(/setPropsOpen\(true\)/g) || []).toHaveLength(1);
    expect((DR_CODE.match(/openMarkupProps\(\)/g) || []).length).toBeGreaterThanOrEqual(5);
  });
});
