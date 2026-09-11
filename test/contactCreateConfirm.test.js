/* NEW-1 — creating a contact from the Owner field must be a DELIBERATE, ONE-STEP action.
 *
 * The field used to auto-add any unrecognised text as a contact, silently, so a typo became a
 * person indistinguishable from a real one. The registry has genuinely held
 * `Can give up trailer parlking` and a bare email address by this route — that protection is KEPT
 * in full (nothing is ever auto-created on blur/click-away).
 *
 * NEW-5 changed the SHAPE of the ask: the original design required TWO confirmations for the
 * keyboard path (Enter raised a second "Add contact?" popup requiring a second Enter/click) while
 * the MOUSE path (clicking the dropdown's "+ Add" row) was already one action — an inconsistency,
 * not caution, and the owner named it exactly: "one click on an explicit row is deliberate enough;
 * a second confirmation on top of that is friction." Both input methods now route through the SAME
 * `attemptCreate`, and it creates immediately UNLESS the proposed name trips one of two narrow,
 * NEW-2 guards (a comma in the name; a name that is a prefix of an existing contact) — those two
 * cases still ask, because they are the ones most likely to be a mistake, not a decision.
 *
 * This is the CI-RUNNABLE HALF. The behaviour itself is an interaction — a chip, a caret, a
 * declined commit — so the real check is `ui-audit/verify-contact-confirm.mjs` (real browser,
 * mutation-proven). What this file defends is the structure CI *can* see, and in particular the
 * two ways this feature dies quietly:
 *   1. the guard is removed and `attemptCreate` goes back to creating ANY text, comma included, and
 *   2. the one-step design regresses back to a mandatory second confirmation for every name.
 *
 * It also pins the ONE architectural fact the design rests on — see `ensureContacts` below.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

const pickerSrc = (() => {
  const start = seq.indexOf("function ContactPicker(");
  expect(start, "ContactPicker must exist").toBeGreaterThan(-1);
  const next = seq.indexOf("\nfunction ", start + 10);
  return seq.slice(start, next > -1 ? next : start + 16000);
})();

const bodyOf = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") { depth++; started = true; }
    else if (src[j] === "}") { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
};

describe("NEW-1 — owner is an ordered LIST of chips", () => {
  it("ContactPicker holds chip state, seeded from the `owners` prop", () => {
    expect(pickerSrc).toMatch(/const \[chips, setChips\] = React\.useState\(initialOwners\)/);
  });
  it("addChip is the one place a name enters the list — dedupe + cap enforced there", () => {
    const b = bodyOf(pickerSrc, "addChip");
    expect(b, "addChip must exist").toBeTruthy();
    expect(b, "an already-present owner is a quiet no-op, never a duplicate").toMatch(/chipSet\.has\(n\.toLowerCase\(\)\)/);
    expect(b, "the cap is enforced here, with a message, never a silent drop").toMatch(/atCap.*setWarn/);
  });
  it("Backspace on an EMPTY input removes the last chip", () => {
    expect(pickerSrc).toMatch(/e\.key === 'Backspace' && !query && chips\.length/);
  });
  it("comma commits the current chip without ever becoming part of a name", () => {
    // The comma KEY is intercepted before it can reach `query` via onChange — so a name can only
    // ever contain a comma via some OTHER route (e.g. a paste), which is what attemptCreate guards.
    expect(pickerSrc).toMatch(/if \(e\.key === ','\) \{/);
  });
  it("reordering is a plain HTML5 drag on each chip (the same pattern this file already uses for columns)", () => {
    expect(pickerSrc).toMatch(/data-owner-chip draggable/);
    expect(pickerSrc).toMatch(/reorderChips\(dragIdx, i\)/);
  });
});

describe("NEW-5 — creating a new contact is now ONE deliberate action, not two", () => {
  it("attemptCreate is the single path for BOTH the keyboard and the dropdown click", () => {
    // Enter (no highlight, no ghost, no exact match) reaches attemptCreate directly.
    const enterBody = bodyOf(pickerSrc, "onKeyDown");
    expect(enterBody, "onKeyDown must exist").toBeTruthy();
    expect(enterBody, "Enter falls through to attemptCreate for a genuinely new name").toMatch(/attemptCreate\(trimmed\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*\}/);
    // The dropdown's own "+ Add" row calls the SAME function — not a second, different path.
    expect(pickerSrc, "the dropdown row must route through attemptCreate too").toMatch(/data-owner-add-new[\s\S]{0,120}attemptCreate\(trimmed\)/);
  });
  it("attemptCreate creates immediately when neither guard fires — no separate confirm step", () => {
    const b = bodyOf(pickerSrc, "attemptCreate");
    expect(b, "attemptCreate must exist").toBeTruthy();
    expect(b, "the fallthrough is a direct create, not a second ask").toMatch(/addChip\(name, \{ name, email: "" \}\);\s*\n\s*\}/);
  });
  it("the old two-popup design (a separate pendingNew confirm modal) is gone", () => {
    expect(pickerSrc).not.toMatch(/pendingNew/);
    expect(pickerSrc).not.toMatch(/data-contact-confirm/);
  });
});

describe("NEW-2 — the two guards on the one remaining create action", () => {
  it("a comma in the proposed name refuses to create it", () => {
    const b = bodyOf(pickerSrc, "attemptCreate");
    expect(b, "a comma is checked before anything is created").toMatch(/name\.includes\(","\)/);
    expect(b, "the comma path sets a warning and returns without creating").toMatch(/kind: "comma"[\s\S]{0,220}\breturn;/);
  });
  it("a name that is a PREFIX of an existing contact warns once, then lets a second confirm through", () => {
    const b = bodyOf(pickerSrc, "attemptCreate");
    expect(b, "an existing longer name starting with the typed text is detected").toMatch(/c\.name\.toLowerCase\(\)\.startsWith\(name\.toLowerCase\(\)\)/);
    expect(b, "the SAME warned name is allowed through on a second attempt").toMatch(/lastPrefixWarnedFor\.current !== name\.toLowerCase\(\)/);
  });
});

describe("NEW-1 — the protection this redesign keeps in full: nothing is auto-created on blur", () => {
  it("finishEditing discards an unrecognised leftover rather than creating it", () => {
    const b = bodyOf(pickerSrc, "finishEditing");
    expect(b, "finishEditing must exist").toBeTruthy();
    expect(b, "a leftover that matches nothing is never turned into a new contact here")
      .not.toMatch(/newContactsRef\.current\.push/);
    expect(b, "an EXACT match is still kept rather than dropped").toMatch(/existing && !chipSet\.has/);
  });
  it("clicking away calls finishEditing, never a direct create", () => {
    const i = pickerSrc.indexOf("function onDocMouseDown");
    expect(i, "the outside-click handler must exist").toBeGreaterThan(-1);
    const b = pickerSrc.slice(i, pickerSrc.indexOf("}", pickerSrc.indexOf("finishEditing();", i)) + 1);
    expect(b, "clicking away must finish (commit chips), not create a contact directly").toMatch(/finishEditing\(\)/);
    expect(b, "clicking away must not call attemptCreate/addChip directly").not.toMatch(/attemptCreate\(|addChip\(/);
  });
  it("Escape cancels the whole edit (discarding this session's chip changes) once no warning is showing", () => {
    const b = bodyOf(pickerSrc, "onKeyDown");
    expect(b, "Escape dismisses an active warning first, without closing").toMatch(/if \(warn\) \{ setWarn\(null\)/);
    expect(b, "Escape with no warning cancels the edit").toMatch(/cancelEditing\(\);/);
  });
});

describe("NEW-4 — the popup tracks its cell every frame, not on a scroll/resize listener", () => {
  it("position is recomputed in a requestAnimationFrame loop while the picker is open", () => {
    expect(pickerSrc).toMatch(/requestAnimationFrame\(tick\)/);
    expect(pickerSrc, "no listener-based repositioning is left to race the scroll").not.toMatch(/addEventListener\('scroll'/);
  });
  it("the loop closes the editor when the cell scrolls outside its own scroll container", () => {
    expect(pickerSrc).toMatch(/data-scroll-bounds/);
    expect(pickerSrc).toMatch(/r\.bottom < b\.top \|\| r\.top > b\.bottom \|\| r\.right < b\.left \|\| r\.left > b\.right/);
  });
  it("both grid views declare their own scroll-bounds container", () => {
    expect(seq).toMatch(/data-grid-scroll="1" data-scroll-bounds/);
    expect(seq).toMatch(/ref=\{tableWrapRef\} data-scroll-bounds/);
  });
});

describe("NEW-1 — the fact the design rests on", () => {
  /* WHY a leftover unrecognised name is never committed on close. `ensureContacts` runs on EVERY
   * load and re-derives a contact for any owner name missing from the registry. So committing an
   * owner without its contact would not avoid the creation — it would defer it to the next reload,
   * where nobody is asked. If this ever stops being true, blur/close could relax; until then the
   * two are one decision, and this test is here so a future reader knows that was deliberate. */
  it("ensureContacts still re-derives a contact for every owner in every task's list on load", () => {
    const i = seq.indexOf("const ensureContacts =");
    expect(i, "ensureContacts must exist").toBeGreaterThan(-1);
    const b = seq.slice(i, i + 1200);
    expect(b, "it reads every task's owner LIST via ownerListOf").toMatch(/ownerListOf\(t\)\.forEach/);
    expect(b, "and pushes any name the registry lacks").toMatch(/existing\.push\(/);
  });
});
