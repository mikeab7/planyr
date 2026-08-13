/* B443536 — the character that OPENS a type-to-edit editor must survive the NEXT keystroke.
 *
 * MEASURED CAUSE (ui-audit/verify-owner-first-char.mjs, real browser, real key events):
 * the Owner cell's ContactPicker is seeded at mount with the single character that opened it,
 * uses it to filter the contact registry — and then ran `el.select()` unconditionally in its
 * mount effect. The seeded character was therefore SELECTED, so keystroke 2 replaced it:
 * typing `Scott` gave `cott`, and `cott` is what got COMMITTED to the task and auto-added to
 * the contact registry. Keystroke trace before the fix: ["S","c","co","cot","cott"].
 *
 * This is the CI-RUNNABLE HALF of the guard. The defect is a pure interaction — a caret
 * selection range after a mount effect — so no unit test can observe it; the browser harness
 * above is the real check and is mutation-proven (revert → 8 red · never-select → the
 * double-click REPLACE case goes red · drop the grid call-site prop → 8 red).
 * What this file stops is the REGRESSION SHAPE that CI *can* see: the branch disappearing,
 * or a new ContactPicker call site being wired with a seed char but no `seeded` flag.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

// The ContactPicker component body: from its declaration to the next top-level `function`.
const pickerSrc = (() => {
  const start = seq.indexOf("function ContactPicker(");
  expect(start, "ContactPicker must exist in the sequence module").toBeGreaterThan(-1);
  const next = seq.indexOf("\nfunction ", start + 10);
  return seq.slice(start, next > -1 ? next : start + 8000);
})();

describe("B443536 — ContactPicker caret placement is decided, not assumed", () => {
  it("takes a `seeded` prop, defaulting to false so click-to-edit still selects the old value", () => {
    const sig = pickerSrc.slice(0, pickerSrc.indexOf(")") + 1);
    expect(sig, "ContactPicker must accept a `seeded` prop").toMatch(/seeded\s*=\s*false/);
  });

  it("branches the mount effect on `seeded` — never an unconditional select()", () => {
    // The mount effect is the one with an empty dep array `, []);`.
    const eff = pickerSrc.match(/React\.useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/);
    expect(eff, "ContactPicker must have a mount effect that focuses the input").toBeTruthy();
    const body = eff[0];
    expect(body, "mount effect must focus the input").toMatch(/\.focus\(\)/);
    expect(body, "mount effect must branch on `seeded`").toMatch(/\bseeded\b/);
    // The seeded branch must place the CARET (collapsed range), not select.
    expect(body, "seeded → caret after the typed character").toMatch(/setSelectionRange\(/);
    // The un-seeded branch must still select-all, so typing over an existing owner REPLACES it.
    expect(body, "un-seeded → select the existing value so typing replaces it").toMatch(/\.select\(\)/);
    // …and select() must not be reachable unconditionally: it has to sit on the `else` side.
    expect(
      /else\s+el\.select\(\)/.test(body) || /if\s*\(!seeded\)[^\n]*\.select\(\)/.test(body),
      "select() must be the ELSE branch of the `seeded` test, never unconditional",
    ).toBe(true);
  });
});

describe("B443536 — every seeded ContactPicker call site declares itself", () => {
  // Each `<ContactPicker … />` JSX element in the file.
  const sites = [...seq.matchAll(/<ContactPicker\b[\s\S]*?\/>/g)].map(m => ({
    src: m[0],
    line: seq.slice(0, m.index).split("\n").length,
  }));

  it("finds the known call sites (grid cell + master table cell)", () => {
    expect(sites.length, "expected at least the grid and master-table Owner pickers").toBeGreaterThanOrEqual(2);
  });

  it("any call site whose `value` can be a typed seed char also passes `seeded`", () => {
    // A seed-capable site is one that feeds the picker a type-to-edit character.
    const SEED_SOURCES = /editStartChar|initChar/;
    const offenders = sites
      .filter(s => SEED_SOURCES.test(s.src))
      .filter(s => !/\bseeded=/.test(s.src))
      .map(s => `L${s.line}: ${s.src.replace(/\s+/g, " ").slice(0, 110)}`);
    expect(
      offenders,
      "these ContactPicker call sites seed a typed character but never tell the picker, " +
      "so the picker will select-all and the next keystroke will eat it (B443536)",
    ).toEqual([]);
  });

  it("the `seeded` flag tracks the SAME source the value does", () => {
    // seeded={x != null} must test the same expression the value ternary tests — a flag wired
    // to a different signal (or hardcoded true) reintroduces the bug on one of the two routes.
    for (const s of sites.filter(x => /\bseeded=/.test(x.src))) {
      const valueSrc = s.src.match(/value=\{([\s\S]*?)\}\s*\n/);
      const seededSrc = s.src.match(/seeded=\{([\s\S]*?)\}/);
      expect(seededSrc, `L${s.line}: seeded= must be an expression`).toBeTruthy();
      const token = /initChar/.test(seededSrc[1]) ? "initChar" : "editStartChar";
      expect(valueSrc?.[1], `L${s.line}: seeded and value must read the same seed source`).toContain(token);
      expect(seededSrc[1], `L${s.line}: seeded must be a null test, not a constant`).toMatch(/!=\s*null/);
    }
  });
});
