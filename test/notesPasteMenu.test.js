/* notesPasteMenu — THE UNIT HALF OF THE PASTE-OPTIONS MENU FIX (NEW-1 + NEW-2, owner report 2026-11-10).
 *
 * The behaviour itself (a lone Ctrl tap opens the menu and moves focus into it; the arrows / letters / mouse pick an option; what each
 * option keeps from a browser, Word and Excel clipboard) is driven in a real browser by ui-audit/verify-notes-paste-menu.mjs and the
 * clipboard bank (ui-audit/verify-notes-paste-bank.mjs) — both required steps of the `build` check. This file is what keeps them honest from
 * inside `npm test`, which has no browser:
 *   · the option JUDGE can fail — a Merge that kept a font, a Keep Text Only that kept a bold, a Keep Source that differs, are all rejected;
 *   · the two pure readers the fix added behave (`highlightOf`, the `fonts` switch of `marksByClass`);
 *   · the wiring that made the bug is gone and stays gone — Control must NOT open the menu on its keydown (that made every Ctrl chord pop it),
 *     the menu must take focus when it opens, and the hand-off back to the caret must exist (source guards, the repo's pattern for a React
 *     effect that has no DOM here);
 *   · both harnesses are in the build's gate list. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkPasteOption } from "../ui-audit/lib/pasteBank.mjs";
import { highlightOf, marksByClass } from "../src/workspaces/notes/lib/notesOfficeStyle.js";
import { DEFAULT_INK } from "../src/workspaces/notes/lib/notesPasteInherit.js";

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const run = (text, marks = []) => ({ type: "text", text, ...(marks.length ? { marks } : {}) });
const style = (attrs) => ({ type: "textStyle", attrs: { color: null, fontFamily: null, fontSize: null, ...attrs } });
const doc = (...runs) => ({ type: "doc", content: [{ type: "paragraph", content: runs }] });

const source = doc(
  run("red serif ", [style({ color: "rgb(204, 0, 0)", fontFamily: "Georgia, serif", fontSize: "16px" })]),
  run("bold", [style({ fontFamily: "Georgia, serif", fontSize: "16px" }), { type: "bold" }]),
  run(" lit", [style({ fontFamily: "Georgia, serif" }), { type: "highlight", attrs: { color: "#ffff00" } }]),
  run(" link", [{ type: "link", attrs: { href: "https://example.com" } }]),
);
const merged = doc(run("red serif "), run("bold", [{ type: "bold" }]), run(" lit"), run(" link", [{ type: "link", attrs: { href: "https://example.com" } }]));
const plain = doc(run("red serif bold lit link"));

describe("the option judge can fail", () => {
  it("accepts each option done right", () => {
    expect(checkPasteOption("source", source, JSON.parse(JSON.stringify(source)))).toEqual([]);
    expect(checkPasteOption("merge", source, merged)).toEqual([]);
    expect(checkPasteOption("text", source, plain)).toEqual([]);
  });
  it("rejects Keep Source that is not the paste, Merge that kept a font / colour / highlight or lost a bold, and Keep Text Only that kept a mark", () => {
    expect(checkPasteOption("source", source, merged).length).toBeGreaterThan(0);
    expect(checkPasteOption("merge", source, source).join("\n")).toMatch(/source (color|fontFamily|fontSize|highlight)/);
    expect(checkPasteOption("merge", source, plain).join("\n")).toMatch(/bold|link/);
    expect(checkPasteOption("text", source, merged).join("\n")).toMatch(/left a mark/);
    expect(checkPasteOption("text", source, doc(run("something else"))).join("\n")).toMatch(/words changed/);
  });
  it("Values and Source Formatting must keep the bold and colour; Values must keep nothing", () => {
    expect(checkPasteOption("valuesFormat", source, source)).toEqual([]);
    expect(checkPasteOption("valuesFormat", source, plain).length).toBeGreaterThan(0);
    expect(checkPasteOption("values", source, plain)).toEqual([]);
    expect(checkPasteOption("values", source, source).length).toBeGreaterThan(0);
  });
});

describe("the pure readers the fix added", () => {
  it("highlightOf reads Word's highlighter and a browser's background, and nothing that is 'no background'", () => {
    expect(highlightOf("background:yellow;mso-highlight:yellow")).toBe("yellow");
    expect(highlightOf("background: rgb(255, 255, 0);")).toBe("rgb(255, 255, 0)");
    expect(highlightOf("background-color:#FFFF00")).toBe("#FFFF00");
    for (const none of ["background:white", "background:transparent", "mso-highlight:auto", "color:red", "background-color: rgba(0, 0, 0, 0)", ""]) {
      expect(highlightOf(none), none).toBeNull();
    }
  });
  it("marksByClass reads font-family / font-size only when asked — the Excel mark rules are unchanged", () => {
    const css = ".xl65 {font-weight:700;color:black;font-size:11.0pt;font-family:Calibri, sans-serif}  p.MsoNormal {font-size:11.0pt;font-family:\"Calibri\",sans-serif}";
    expect(marksByClass(css).xl65).toEqual({ bold: true, color: null });
    expect(marksByClass(css).MsoNormal).toBeUndefined();
    expect(marksByClass(css, { fonts: true }).MsoNormal).toEqual({ fontSize: "11.0pt", fontFamily: "\"Calibri\",sans-serif" });
    expect(marksByClass(css, { fonts: true }).xl65.fontFamily).toBe("Calibri, sans-serif");
  });
  it("the default ink is never turned into a colour mark", () => {
    for (const ink of ["black", "#000", "#000000", "rgb(0, 0, 0)", "windowtext", "inherit"]) expect(DEFAULT_INK.test(ink), ink).toBe(true);
    for (const real of ["red", "#c00000", "rgb(204, 0, 0)"]) expect(DEFAULT_INK.test(real), real).toBe(false);
  });
});

describe("the wiring that made the bug stays gone", () => {
  const editor = read("src/workspaces/notes/components/NoteEditor.jsx");
  const keyEffect = editor.slice(editor.indexOf("A LONE CTRL TAP OPENS THE FLYOUT"), editor.indexOf("Ctrl/Cmd+Shift+V, and the right-click menu's item"));
  it("Control on its own opens the menu on the KEY UP, never the keydown (a keydown made Ctrl+V / Ctrl+C / Ctrl+Z all pop it)", () => {
    expect(keyEffect.length).toBeGreaterThan(500);
    expect(keyEffect).toContain('document.addEventListener("keyup", onKeyUp, true)');
    const keydown = keyEffect.slice(keyEffect.indexOf("const onKey = "), keyEffect.indexOf("const onKeyUp"));
    expect(keydown).not.toMatch(/openPasteMenu|setPasteExpanded\(true\)/);
    expect(keydown).toContain("ctrlArmedRef.current = true");
    expect(keydown).toMatch(/disarm\(\)/);                       // any other key makes it a chord
  });
  it("a press, a Ctrl+wheel and a lost window disarm it too", () => {
    expect(keyEffect).toContain('"pointerdown", disarm');
    expect(keyEffect).toMatch(/onWheel[\s\S]*ctrlKey[\s\S]*disarm/);
    expect(keyEffect).toContain('window.addEventListener("blur", disarm)');
  });
  it("Escape while the menu is open is the MENU's — consumed, caret handed back — not also the box's", () => {
    const esc = keyEffect.slice(keyEffect.indexOf('e.key === "Escape"'), keyEffect.indexOf('e.key === "Escape"') + 260);
    expect(esc).toMatch(/preventDefault[\s\S]*stopPropagation[\s\S]*closePasteMenu\(true\)/);
  });
  it("opening the menu hands it focus, and a pick / Escape hands the caret back", () => {
    expect(editor).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!expanded \|\| !focusIn/);
    expect(editor).toMatch(/closePasteMenu\(true\);\s*if \(!offer \|\| !editor \|\| editor\.isDestroyed\) return;/);   // applyPasteMode
    expect(editor).toContain("editor.view.focus()");
  });
  it("the editor blur timer does not settle the box while focus is in the menu (that resize would retire the very offer)", () => {
    expect(editor).toMatch(/!editor\.view\.hasFocus\(\) && !pasteMenuHasFocus\(\)/);
  });
  it("a press on the menu is stopped natively before the canvas's own listeners — pointerdown, mousedown, wheel, dblclick, contextmenu", () => {
    for (const t of ["pointerdown", "mousedown", "wheel", "dblclick", "contextmenu"]) expect(editor).toContain(`"${t}"`);
    expect(editor).toMatch(/const types = \["pointerdown", "pointerup", "mousedown"/);
  });
});

describe("both browser harnesses are required build steps, and the new fixtures are in the bank", () => {
  const gates = read(".github/ci-gates.yml");
  it("listed in the gate list", () => {
    expect(gates).toContain("ui-audit/verify-notes-paste-menu.mjs");
    expect(gates).toContain("ui-audit/verify-notes-paste-bank.mjs");
  });
  it("the real-Chrome and Word-class fixtures are registered", () => {
    const bank = JSON.parse(read("test/fixtures/clipboard-bank/bank.json"));
    expect(Object.keys(bank.entries)).toEqual(expect.arrayContaining(["browser-block-styles", "word-class-font"]));
    for (const id of ["browser-block-styles", "word-class-font"]) expect(bank.entries[id].expect.runs.length, id).toBeGreaterThan(4);
  });
});
