/* NEW-1 (2026-10-29) — a bare letter is a letter on every type-to-edit surface. Pure verdict + source
 * guards (vitest runs in node, no DOM); the behavioural half is e2e/spreadsheet-bare-letters.spec.js. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bareFullscreenAllowed, insideLettersAreText, LETTERS_ARE_TEXT_ATTR, LETTERS_ARE_TEXT_MODULES } from "../src/shared/keyboard/bareLetterGate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const base = { module: "site-planner", key: "f" };

describe("bareFullscreenAllowed", () => {
  it("toggles fullscreen only for a plain f / F with nothing claiming the key (known-good arm)", () => {
    expect(bareFullscreenAllowed(base)).toBe(true);
    expect(bareFullscreenAllowed({ ...base, key: "F" })).toBe(true);
  });
  it("ignores every other key and Alt+F", () => {
    expect(bareFullscreenAllowed({ ...base, key: "g" })).toBe(false);
    expect(bareFullscreenAllowed({ ...base, altKey: true })).toBe(false);
  });
  it("stands down when a surface already consumed the key (a grid that started an edit)", () => {
    expect(bareFullscreenAllowed({ ...base, defaultPrevented: true })).toBe(false);
  });
  it("stands down inside a data-letters-are-text surface and on the Spreadsheet module", () => {
    expect(bareFullscreenAllowed({ ...base, inLettersAreText: true })).toBe(false);
    expect(bareFullscreenAllowed({ ...base, module: "model" })).toBe(false);
    expect(LETTERS_ARE_TEXT_MODULES).toContain("model");
  });
  it("keeps the painted-document rule (B291538)", () => {
    expect(bareFullscreenAllowed({ ...base, writeableDocumentOnScreen: true })).toBe(false);
  });
});

describe("insideLettersAreText", () => {
  it("asks the element's closest marked ancestor, and tolerates non-elements", () => {
    const marked = { closest: (sel) => (sel === `[${LETTERS_ARE_TEXT_ATTR}]` ? {} : null) };
    expect(insideLettersAreText(marked)).toBe(true);
    expect(insideLettersAreText({ closest: () => null })).toBe(false);
    expect(insideLettersAreText(null)).toBe(false);
    expect(insideLettersAreText({})).toBe(false);
  });
});

describe("wiring (a gate nobody calls is not a gate)", () => {
  it("AppHeader's bare-f path goes through the gate, not a hand-rolled condition", () => {
    const h = read("src/shared/ui/AppHeader.jsx");
    expect(h).toContain("bareFullscreenAllowed({");
    expect(h).not.toMatch(/\(e\.key === "f" \|\| e\.key === "F"\) && !e\.altKey && !writeableDocumentOnScreen\(\)/);
  });
  it("every type-to-edit grid carries the opt-in", () => {
    expect(read("src/workspaces/model/components/SheetView.jsx")).toContain("data-letters-are-text");
    expect(read("src/shared/comps/components/CompEntryGrid.jsx")).toContain("data-letters-are-text");
  });
});
