/* THE ELEMENT CAPABILITY CONTRACT — source guard (NEW-1).
 *
 * Owner report 2026-08-09: "investigate the element tools and make sure they all share the same
 * attributes as it makes sense, bc rn sometimes a certain markup won't have the same properties as
 * other markups for no good reason, or like the same right menu options."
 *
 * The durable half of the answer. Closing today's specific gaps without a declaration check just
 * resets the clock — so this suite fails the build when a selectable type ships without stating,
 * capability by capability, what it does and does not do. Same shape and same reason as the click
 * contract's guard (B1188, test/clickContract.test.js).
 *
 * The LIVE half — a real right-click on one of every kind, read off the running app — is
 * `ui-audit/audit-element-parity.mjs`, which drives this same table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ELEMENT_CAPABILITIES, PROP_CAPS, ACTION_CAPS, capabilityFor, verdict, FAMILIES, CANONICAL_LOCK_VERB,
} from "../e2e/elementCapabilities.table.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");

/* Strip comments before asserting about CODE — this file documents the wording it removed, and a
 * naive substring check would trip on its own documentation. (Same helper as clickContract.test.js;
 * deliberately does not touch trailing `//`, which needs a real tokeniser to tell from a URL.) */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const SP_CODE = stripComments(SP);

function stringArrayConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  if (!m) throw new Error(`registry ${name} not found in SitePlanner.jsx`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("every selectable type DECLARES its capabilities", () => {
  it("every drawable element type has a row", () => {
    for (const type of stringArrayConst(SP, "DRAW_TYPES")) {
      expect(capabilityFor(type), `DRAW_TYPES has "${type}" but e2e/elementCapabilities.table.js does not declare it`).toBeTruthy();
    }
  });

  it("every markup tool has a row", () => {
    for (const type of stringArrayConst(SP, "MARKUP_TOOLS")) {
      expect(capabilityFor(type), `MARKUP_TOOLS has "${type}" but e2e/elementCapabilities.table.js does not declare it`).toBeTruthy();
    }
  });

  it("the non-drawn selectable kinds are declared too", () => {
    for (const type of ["easement", "measure", "callout", "text", "parcel"]) {
      expect(capabilityFor(type), `"${type}" is selectable but has no capability row`).toBeTruthy();
    }
  });

  /* ⛔ THE MECHANISM. There is no way to leave a cell blank: every capability in the vocabulary
   * must carry a verdict, and the two non-"yes" verdicts each require a written reason. That is
   * what makes adding a type cost a decision rather than a copy-paste. */
  it("every row answers EVERY capability, with a reason whenever the answer is not yes", () => {
    for (const row of ELEMENT_CAPABILITIES) {
      for (const [group, caps] of [["props", PROP_CAPS], ["actions", ACTION_CAPS]]) {
        expect(row[group], `${row.type}: missing the "${group}" block`).toBeTruthy();
        for (const cap of caps) {
          const v = verdict(row[group][cap]);
          expect(v, `${row.type}.${group}.${cap} is undeclared or malformed — it must be "yes", { na: "<why this type genuinely lacks the concept>" }, or { open: "<question for the owner>" }`).toBeTruthy();
        }
        // No stray keys: a typo'd capability name would otherwise read as a declared cell.
        for (const key of Object.keys(row[group])) {
          expect(caps, `${row.type}.${group} declares unknown capability "${key}"`).toContain(key);
        }
      }
      expect(FAMILIES, `${row.type}: unknown family "${row.family}"`).toContain(row.family);
      expect(typeof row.label, `${row.type}: missing label`).toBe("string");
    }
  });

  /* A one-word "no" is what produced the drift in the first place. A reason has to be long enough
   * to be argued with — that is the whole review surface this table exists to create. */
  it("every na/open reason is a real sentence, not a shrug", () => {
    for (const row of ELEMENT_CAPABILITIES) {
      for (const group of ["props", "actions"]) {
        for (const [cap, cell] of Object.entries(row[group])) {
          const v = verdict(cell);
          if (v === "yes") continue;
          const text = v === "na" ? cell.na : cell.open;
          const short = /^see [a-z]+$/i.test(text.trim());   // an explicit cross-reference is fine
          expect(short || text.trim().length >= 30, `${row.type}.${group}.${cap}: reason is too thin to review — "${text}"`).toBe(true);
        }
      }
    }
  });
});

describe("the parity the owner reported is CLOSED, and stays closed", () => {
  /* Every family that shares one menu must agree on the ACTIONS that menu offers. A per-kind
   * difference inside a shared menu is not a capability difference — it is the drift. */
  it("within a family, every member offers the same set of context-menu actions", () => {
    for (const family of FAMILIES) {
      const rows = ELEMENT_CAPABILITIES.filter((r) => r.family === family);
      if (rows.length < 2) continue;
      const sig = (r) => ACTION_CAPS.map((c) => `${c}:${verdict(r.actions[c])}`).join("|");
      const first = sig(rows[0]);
      for (const r of rows.slice(1)) {
        expect(sig(r), `${r.type} and ${rows[0].type} share the "${family}" right-click menu but declare different actions — that is the drift, not a capability difference`).toBe(first);
      }
    }
  });

  /* NEW-2's core closure, declared rather than merely coded: everything that can be drawn on the
   * canvas can be ordered. A future type that declares arrangeEnds: na must say why in a way a
   * reviewer will challenge — "it is fiddly" will not survive this file's reason check. */
  it("every drawn family can be ordered — only the parcel is exempt, and it says why", () => {
    for (const row of ELEMENT_CAPABILITIES) {
      if (row.family === "parcel") continue;
      expect(verdict(row.actions.arrangeEnds), `${row.type}: Bring to Front / Send to Back must be available on anything the user drew`).toBe("yes");
      expect(verdict(row.actions.arrangeSteps), `${row.type}: Bring Forward / Send Backward must match its own Bring to Front / Send to Back — offering two of the four modes is exactly the drift this table exists to stop`).toBe("yes");
    }
  });
});

describe("the SHIPPED menus match the declaration", () => {
  /* ⛔ ONE NAME PER CONCEPT. The element menu said "Pin" while every other family said "Lock" for
   * the identical field (`locked`). A user cannot be expected to know those are one idea, and a
   * table that declared `lock: yes` for both would have called that parity. So assert the WORD. */
  it("no menu reintroduces a synonym for Lock", () => {
    /* Written against the shape it actually shipped in — a ternary inside the button's children
     * (`{t.locked ? "Unpin" : "Pin"}`), which a `>Pin<` element-text pattern does not see. A guard
     * whose pattern cannot match the defect it names is a guard that rots green. */
    const synonyms = [/"Unpin"/, /"Pin"/, /text:\s*"Pin"/, />\s*Pin\s*</];
    for (const re of synonyms) {
      expect(SP_CODE, `SitePlanner.jsx reintroduces a synonym for ${CANONICAL_LOCK_VERB} (${re}) — the canonical user-facing verb is ${CANONICAL_LOCK_VERB}/Un${CANONICAL_LOCK_VERB.toLowerCase()}`).not.toMatch(re);
    }
  });

  /* The four Arrange modes are one control, not four independent ones — the measurement menu shipped
   * TWO of them, in different capitalisation from the markup menu's four, while the SAME keyboard
   * chords drove all four. So the guard is not "each menu names four rows" (which would pass on four
   * hand-rolled copies, i.e. on the thing that drifted); it is that there is ONE builder and every
   * family calls it. `arrangeGroup` is that builder. */
  it("there is ONE shared Arrange group, and it names all four modes", () => {
    for (const mode of ["Bring to Front", "Bring Forward", "Send Backward", "Send to Back"]) {
      expect(SP_CODE, `the shared Arrange group must offer "${mode}"`).toContain(mode);
    }
    for (const kind of ["markup", "measure", "callout"]) {
      expect(SP_CODE, `the ${kind} right-click menu must build its Arrange rows from the shared arrangeGroup(), not its own copy`)
        .toMatch(new RegExp(`arrangeGroup\\(\\{\\s*kind:\\s*"${kind}"`));
    }
    /* The element menu keeps its own `arrRow` because it lives in a different menu component with
     * its own header style — so assert it renders all four modes there. B845584 gave each row a
     * 14px icon (the first argument, a JSX element) ahead of the label/mode pair the pre-fix rule
     * checked; the mode is now the THIRD argument, not the second. */
    for (const mode of ["front", "forward", "backward", "back"]) {
      expect(SP_CODE, `the element menu's Arrange group must render the "${mode}" mode`).toMatch(new RegExp(`arrRow\\(<[^,]+,\\s*"[^"]+",\\s*"${mode}"`));
    }
  });

  /* NEW-2: the Arrange group must not VANISH when the object is alone on its layer — that silence,
   * on the single pond / single paving pad of a real plan, is what "doesn't work at all" looked
   * like. The pre-fix element menu gated the whole group behind `af.count > 1`. */
  it("the element menu's Arrange group is not hidden when the element is alone in its band", () => {
    expect(SP_CODE.match(/\{af && af\.count > 1 && \(/), "`{af && af.count > 1 && (` hides the whole Arrange group instead of greying its rows").toBeFalsy();
  });

  /* NEW-2: callouts were the one drawn kind outside the stacking model entirely — rendered from
   * the raw `callouts` array, so no ordering op could reach them. Pin the sorted, banded render. */
  it("callouts render in z order and in two bands, not in raw array order", () => {
    expect(SP_CODE, "the callout pass must render the z-sorted bands (calloutBands), not `callouts.map` — raw array order is what made a text box unorderable by any means").toMatch(/calloutBands\.below/);
    expect(SP_CODE, "the above-plan callout band must render too").toMatch(/calloutBands\.above/);
    expect(SP_CODE.match(/\{callouts\.map\(/), "`{callouts.map(` in the render body is the pre-fix raw-order pass").toBeFalsy();
  });
});
