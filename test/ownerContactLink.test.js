import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as E from "../ui-audit/stress/scheduler-engine.mjs";

/* B1953795 (S7) — the owner<->contact link is by NAME string. The picker and ensureContacts compared
 * lower-cased; the rename/delete cascade used case-SENSITIVE includes(). So a legacy task owner 'jon smith'
 * against contact 'Jon Smith': renaming the contact left the task on the old name AND ensureContacts then
 * respawned 'jon smith' as a duplicate contact. One normalizer (ownerKey) now serves all three.
 * The functions live in public/sequence/index.html (not importable); the mirror in
 * ui-audit/stress/scheduler-engine.mjs is exercised here and its text is asserted present in the source. */
const html = readFileSync("public/sequence/index.html", "utf8");

describe("ownerKey / ownerHas / renameOwnerIn / removeOwnerFrom", () => {
  it("RED-PROOF (main used case-sensitive includes): a legacy lower-case owner still matches the contact", () => {
    expect(E.ownerHas(["jon smith"], "Jon Smith")).toBe(true);
    expect(["jon smith"].includes("Jon Smith")).toBe(false); // what main's cascade did
  });
  it("rename cascades across casings and writes the NEW contact name", () => {
    expect(E.renameOwnerIn(["jon smith", "Priya Shah"], "Jon Smith", "Jonathan Smith")).toEqual(["Jonathan Smith", "Priya Shah"]);
  });
  it("rename onto a name already in the list collapses (no duplicate owner)", () => {
    expect(E.renameOwnerIn(["Jon Smith", "jonathan smith"], "Jon Smith", "Jonathan Smith")).toEqual(["Jonathan Smith"]);
  });
  it("names that do not match are left exactly as typed (display casing never rewritten)", () => {
    expect(E.renameOwnerIn(["priya SHAH"], "Jon Smith", "X")).toEqual(["priya SHAH"]);
  });
  it("delete removes every casing of the contact and nothing else", () => {
    expect(E.removeOwnerFrom(["JON SMITH", "Priya Shah"], "Jon Smith")).toEqual(["Priya Shah"]);
  });
  it("whitespace / null / non-array are safe", () => {
    expect(E.ownerKey("  Jon  ")).toBe("jon");
    expect(E.ownerKey(null)).toBe("");
    expect(E.renameOwnerIn(null, "a", "b")).toEqual([]);
    expect(E.ownerHas(undefined, "a")).toBe(false);
  });
});

describe("Scheduler source uses the ONE normalizer at every link site (no drift from the mirror)", () => {
  it("the four pure functions are present verbatim in index.html", () => {
    for (const fn of ["ownerKey", "ownerHas", "renameOwnerIn", "removeOwnerFrom"]) {
      const m = readFileSync("ui-audit/stress/scheduler-engine.mjs", "utf8").match(new RegExp(`export const ${fn} = [\\s\\S]*?;\\n`));
      expect(m, fn).toBeTruthy();
      expect(html.includes(m[0].replace("export const", "const")), fn).toBe(true);
    }
  });
  it("the cascade, picker and ensureContacts all compare through ownerKey — no raw case-sensitive owner compare remains", () => {
    expect(html).toContain("if (!ownerHas(list, oldName)) return t;");
    expect(html).toContain("renameOwnerIn(list, oldName, nm)");
    expect(html).toContain("removeOwnerFrom(list, goneName)");
    expect(html).toContain("existingNames.has(ownerKey(rp))");
    expect(html).not.toMatch(/list\.includes\((oldName|goneName)\)/);
    expect(html).not.toMatch(/c\.name\.toLowerCase\(\) === (trimmed|lower)/);
  });
});
