/* NEW-1 — creating a contact from the Owner field must be ASKED, never assumed.
 *
 * The field used to auto-add any unrecognised text as a contact, silently, so a typo became a
 * person indistinguishable from a real one. The registry has genuinely held
 * `Can give up trailer parlking` and a bare email address by this route.
 *
 * This is the CI-RUNNABLE HALF. The behaviour itself is an interaction — a prompt, a caret, a
 * declined commit — so the real check is `ui-audit/verify-contact-confirm.mjs` (21 assertions in a
 * real browser, mutation-proven). What this file defends is the structure CI *can* see, and in
 * particular the two ways this feature dies quietly:
 *   1. the ask is removed and `commitTyped` goes back to creating directly, and
 *   2. it starts asking on paths that must never ask (an exact match, a pick from the list),
 *      which is the version that gets switched off within a day.
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
  return seq.slice(start, next > -1 ? next : start + 12000);
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

describe("NEW-1 — the ask exists and nothing is written before it is answered", () => {
  it("ContactPicker holds the pending-confirmation state", () => {
    expect(pickerSrc, "a `pendingNew` state is what defers the write").toMatch(/const \[pendingNew, setPendingNew\]/);
  });

  it("commitTyped ASKS for unrecognised text instead of creating it", () => {
    const b = bodyOf(pickerSrc, "commitTyped");
    expect(b, "commitTyped must exist").toBeTruthy();
    expect(b, "unrecognised text must raise the question").toMatch(/setPendingNew\(/);
    // The silent-create call must NOT be reachable from commitTyped any more.
    expect(b, "commitTyped must not create a contact directly — that is the bug this replaces")
      .not.toMatch(/onCommit\([^)]*\{\s*name:/);
    expect(b, "commitTyped must not shortcut through createTyped").not.toMatch(/createTyped\(/);
  });

  it("an EXACT match and an empty field commit straight through, without asking", () => {
    const b = bodyOf(pickerSrc, "commitTyped");
    // Both early-returns must sit BEFORE the setPendingNew call, or they would be unreachable.
    const iEmpty = b.indexOf("if (!trimmed)");
    const iExact = b.indexOf("if (existing)");
    const iAsk = b.indexOf("setPendingNew(");
    expect(iEmpty, "empty field must commit '' without asking").toBeGreaterThan(-1);
    expect(iExact, "an exact registry match must commit without asking").toBeGreaterThan(-1);
    expect(iEmpty, "the empty-field path must come before the ask").toBeLessThan(iAsk);
    expect(iExact, "the exact-match path must come before the ask").toBeLessThan(iAsk);
  });

  it("declining NEVER touches the typed text (the truncation class this field already shipped)", () => {
    const b = bodyOf(pickerSrc, "declineNew");
    expect(b, "declineNew must exist").toBeTruthy();
    expect(b, "declining must dismiss the question").toMatch(/setPendingNew\(null\)/);
    expect(b, "declining must restore focus so editing continues").toMatch(/\.focus\(\)/);
    expect(b, "declining must place the caret, not select — a selection would let the next key eat the text")
      .toMatch(/setSelectionRange\(/);
    expect(b, "declining must NOT rewrite the query — the text has to come back whole")
      .not.toMatch(/setQuery\(/);
    expect(b, "declining must NOT commit anything").not.toMatch(/onCommit\(/);
  });

  it("picking from the filtered list commits the CONTACT's name and never asks", () => {
    const b = bodyOf(pickerSrc, "selectItem");
    expect(b, "selectItem must exist").toBeTruthy();
    expect(b, "a real suggestion commits that contact's own name").toMatch(/onCommit\(suggestions\[i\]\.name\)/);
  });

  it("blur/click-away routes through the ask rather than committing silently", () => {
    const i = pickerSrc.indexOf("function onDocMouseDown");
    expect(i, "the outside-click handler must exist").toBeGreaterThan(-1);
    const b = pickerSrc.slice(i, pickerSrc.indexOf("}", pickerSrc.indexOf("commitTyped();", i)) + 1);
    expect(b, "clicking away must go through commitTyped, which now asks").toMatch(/commitTyped\(\)/);
    expect(b, "clicking away must not create a contact directly").not.toMatch(/createTyped\(\)/);
    expect(b, "an already-open question must not be re-raised by a stray click").toMatch(/if \(pendingNew\) return/);
  });

  it("the question owns Enter and Escape while it is up, so the choice is deliberate", () => {
    const b = bodyOf(pickerSrc, "onKeyDown");
    expect(b, "onKeyDown must exist").toBeTruthy();
    const guard = b.slice(b.indexOf("if (pendingNew)"));
    expect(b.indexOf("if (pendingNew)"), "the pending branch must be first").toBeGreaterThan(-1);
    expect(guard, "Enter confirms").toMatch(/Enter[\s\S]{0,120}createTyped\(\)/);
    expect(guard, "Escape declines back to the text").toMatch(/Escape[\s\S]{0,120}declineNew\(\)/);
  });

  it("the prompt is one plain sentence — no heading, no paragraph (PANEL-BREVITY)", () => {
    const i = pickerSrc.indexOf("data-contact-confirm");
    expect(i, "the confirm UI must exist and be addressable by a test").toBeGreaterThan(-1);
    const block = pickerSrc.slice(i, i + 1600);
    expect(block, "it must name the person in the question").toMatch(/No match — add "/);
    expect(block, "saying no must be a real button, not just a key").toMatch(/data-contact-confirm-no/);
    expect(block, "saying yes must be a real button").toMatch(/data-contact-confirm-yes/);
    expect(block, "no heading element — this is a field answering back, not a dialog").not.toMatch(/<h[1-4]/);
    /* Measure the VISIBLE copy, not the source (a source slice counts '?' in ternaries — the first
       version of this assertion did exactly that and failed on its own code). Reconstruct what the
       user reads: the fixed words of the sentence plus the two button labels. */
    const copy = [
      (block.match(/No match — add "[\s\S]*?as a new contact\?/) || [""])[0].replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, ""),
      (block.match(/>([^<>{}]{2,24})<\/button>/g) || []).map(s => s.replace(/[><]|\/button/g, "")).join(" · "),
    ].join(" ");
    expect(copy, "the sentence must survive the strip").toContain("as a new contact?");
    expect((copy.match(/\?/g) || []).length, "exactly one question is asked").toBe(1);
    expect(copy.length, `prompt copy is ${copy.length} chars: "${copy}" — keep it one short sentence + two short buttons`)
      .toBeLessThan(90);
  });
});

describe("NEW-1 — the fact the design rests on", () => {
  /* WHY declining must not commit the owner either. `ensureContacts` runs on EVERY load and
   * re-derives a contact for any task owner name missing from the registry. So committing an owner
   * without its contact would not avoid the creation — it would defer it to the next reload, where
   * nobody is asked. If this ever stops being true, the decline path can be relaxed; until then the
   * two are one decision, and this test is here so a future reader knows that was deliberate. */
  it("ensureContacts still re-derives contacts from task owners on load", () => {
    const i = seq.indexOf("const ensureContacts =");
    expect(i, "ensureContacts must exist").toBeGreaterThan(-1);
    const b = seq.slice(i, i + 1200);
    expect(b, "it reads task owners").toMatch(/responsibleParty/);
    expect(b, "and pushes any name the registry lacks").toMatch(/existing\.push\(/);
  });
});
