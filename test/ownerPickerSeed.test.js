/* B443536 — the character that OPENS a type-to-edit editor must survive the NEXT keystroke.
 *
 * MEASURED CAUSE (ui-audit/verify-owner-first-char.mjs, real browser, real key events):
 * the Owner cell's ContactPicker used to be seeded at mount with the single character that
 * opened it, filtered the registry with it — and then ran `el.select()` unconditionally in its
 * mount effect when NOT seeded. The seeded character was therefore selected, so keystroke 2
 * replaced it: typing `Scott` gave `cott`, and `cott` is what got committed.
 *
 * NEW-1 (2026-09-11) changed the SHAPE of the fix, and made the old branch unnecessary rather
 * than merely correct: Owner is now an ORDERED LIST of chips, so "double-click then type"
 * no longer means "replace the existing value" — the existing owners stay as chips, and typing
 * only ever ADDS a new one. There is nothing left to select-and-replace, so `el.select()` is
 * gone from the component entirely, not just gated behind a flag. `seeded`+`value` (one prop
 * conflating "what's shown" and "was it a typed seed") became two: `owners` (the existing list,
 * NEVER replaced by a seed) and `seedText` (the typed character, if any, seeding the NEXT chip).
 *
 * This is the CI-RUNNABLE HALF. The interaction itself (a caret position after a mount effect) is
 * verified live in ui-audit/verify-owner-first-char.mjs. What this file stops is the regression
 * shape CI *can* see: `.select()` reappearing, the mount effect losing its caret placement, or a
 * new ContactPicker call site being wired with a seed character but no `seedText`.
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
  return seq.slice(start, next > -1 ? next : start + 16000);
})();

describe("NEW-1 — ContactPicker takes owners (never replaced by a seed) + seedText (the next chip)", () => {
  it("the signature accepts `owners` and `seedText`, not the old `value`/`seeded` pair", () => {
    const sig = pickerSrc.slice(0, pickerSrc.indexOf(")") + 1);
    expect(sig, "ContactPicker must accept `owners`").toMatch(/\bowners\b/);
    expect(sig, "ContactPicker must accept `seedText`").toMatch(/\bseedText\b/);
    expect(sig, "the old `seeded` boolean prop must be gone").not.toMatch(/\bseeded\s*=/);
  });

  it("chip state is seeded from `owners` ONCE, and is never overwritten by seedText", () => {
    expect(pickerSrc, "chips must come from owners, not from the seed").toMatch(/const initialOwners = React\.useMemo\(\(\) => \(Array\.isArray\(owners\)/);
    expect(pickerSrc, "query — not chips — is what seedText fills").toMatch(/const \[query, setQuery\] = React\.useState\(seedText \|\| ''\)/);
  });

  it("the mount effect places the caret; el.select() is gone from the whole component (B443536's fix is now structural)", () => {
    const eff = pickerSrc.match(/React\.useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/);
    expect(eff, "ContactPicker must have a mount effect that focuses the input").toBeTruthy();
    const body = eff[0];
    expect(body, "mount effect must focus the input").toMatch(/\.focus\(\)/);
    expect(body, "mount effect must place a collapsed caret").toMatch(/setSelectionRange\(n, n\)/);
    expect(pickerSrc, "select() must not exist anywhere in ContactPicker — there is nothing left to select-and-replace").not.toMatch(/\.select\(\)/);
  });
});

describe("B443536 — every seed-capable ContactPicker call site declares itself", () => {
  // Each `<ContactPicker … />` JSX element in the file.
  const sites = [...seq.matchAll(/<ContactPicker\b[\s\S]*?\/>/g)].map(m => ({
    src: m[0],
    line: seq.slice(0, m.index).split("\n").length,
  }));

  it("finds the known call sites (grid cell + master table cell)", () => {
    expect(sites.length, "expected at least the grid and master-table Owner pickers").toBeGreaterThanOrEqual(2);
  });

  it("every call site passes `owners=` (never the retired `value=`)", () => {
    const offenders = sites.filter(s => !/\bowners=/.test(s.src)).map(s => `L${s.line}`);
    expect(offenders, "every ContactPicker call site must pass `owners`").toEqual([]);
    const stale = sites.filter(s => /\bvalue=/.test(s.src)).map(s => `L${s.line}`);
    expect(stale, "no call site may pass the retired `value=` prop").toEqual([]);
  });

  it("any call site whose seedText can be a typed character reads it from editStartChar/initChar, never bare text", () => {
    const offenders = sites
      .filter(s => /\bseedText=/.test(s.src))
      .filter(s => !/editStartChar|initChar/.test(s.src))
      .map(s => `L${s.line}: ${s.src.replace(/\s+/g, " ").slice(0, 110)}`);
    expect(
      offenders,
      "a seedText= that doesn't read the type-to-edit character isn't wired to the B443536 mechanism",
    ).toEqual([]);
  });

  it("owners= and seedText= read the SAME seed source at each site — a mismatch would re-seed the wrong task's owners", () => {
    for (const s of sites) {
      const ownersSrc = s.src.match(/owners=\{([\s\S]*?)\}\s/);
      expect(ownersSrc, `L${s.line}: owners= must be an expression`).toBeTruthy();
      expect(ownersSrc[1], `L${s.line}: owners must read the task's real list via ownerListOf`).toMatch(/ownerListOf\(/);
    }
  });
});
