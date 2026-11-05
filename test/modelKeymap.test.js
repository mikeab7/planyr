/* lib/keymap.js — Excel for Windows' keystrokes as DATA: every chord resolves to a registry command, edit mode is limited to
 * the four font-style chords, and the native clipboard chords are NOT in the table (they are events). */
import { describe, it, expect } from "vitest";
import { CHORDS, EDIT_MODE_CHORDS, chordCommand, navAction } from "../src/workspaces/model/lib/keymap.js";
import { COMMANDS } from "../src/workspaces/model/lib/commandRegistry.js";

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, code: "", ...mods });
const ctrl = (key, extra = {}) => ev(key, { ctrlKey: true, ...extra });

describe("chordCommand — the Excel chords", () => {
  const cases = [
    [ctrl("b"), "bold"], [ctrl("B", { shiftKey: false }), "bold"], [ev("b", { metaKey: true }), "bold"],
    [ctrl("i"), "italic"], [ctrl("u"), "underline"], [ctrl("5"), "strikethrough"], [ctrl("1"), "number-format-dialog"],
    [ctrl("$", { shiftKey: true }), "currency-style"], [ctrl("%", { shiftKey: true }), "percent-style"],
    [ctrl("!", { shiftKey: true }), "number-comma-style"], [ctrl("~", { shiftKey: true }), "numfmt-general"],
    [ctrl("#", { shiftKey: true }), "numfmt-date"], [ctrl("&", { shiftKey: true }), "border-outline"], [ctrl("_", { shiftKey: true }), "border-none"],
    [ctrl("r"), "fill-right"], [ctrl(";"), "insert-date"], [ctrl(":", { shiftKey: true }), "insert-time"],
    [ctrl("'"), "copy-above-formula"], [ctrl('"', { shiftKey: true }), "copy-above-value"],
    [ev("=", { altKey: true }), "autosum"], [ev("F4"), "repeat-last"],
    [ctrl("+", { shiftKey: true }), "insert-cells"], [ctrl("+"), "insert-cells"], [ctrl("-"), "delete-cells"],
    [ctrl("9"), "hide-rows"], [ctrl("(", { shiftKey: true }), "unhide-rows"], [ctrl("0"), "hide-columns"], [ctrl(")", { shiftKey: true }), "unhide-columns"],
    [ev("F11", { shiftKey: true }), "sheet-add"], [ctrl("PageUp"), "sheet-prev"], [ctrl("PageDown"), "sheet-next"], [ctrl("s"), "save-now"],
  ];
  for (const [e, id] of cases) it(`${JSON.stringify({ k: e.key, c: e.ctrlKey || e.metaKey, s: e.shiftKey, a: e.altKey })} -> ${id}`, () => expect(chordCommand(e)).toBe(id));

  it("every chord's command id is a real registry command (a key can never name nothing)", () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    for (const [id] of CHORDS) expect(ids.has(id), id).toBe(true);
  });
  it("every combo is unique and no two chords match the same event", () => {
    expect(new Set(CHORDS.map(([, combo]) => combo)).size).toBe(CHORDS.length);
    const all = [ctrl("b"), ctrl("="), ctrl("+", { shiftKey: true })];
    for (const e of all) expect(CHORDS.filter(([, , m]) => m(e)).length).toBeLessThanOrEqual(1);
  });
  it("Ctrl+C / Ctrl+X / Ctrl+V are deliberately NOT chords — they are native clipboard events", () => {
    for (const k of ["c", "x", "v"]) expect(chordCommand(ctrl(k))).toBeNull();
  });
  it("Ctrl+K (palette), Ctrl+Z, Ctrl+F stay out of this table (ModelApp owns them)", () => {
    for (const k of ["k", "z", "f", "g", "h", "y"]) expect(chordCommand(ctrl(k))).toBeNull();
  });
  it("plain keys, plain Alt and Shift-only chords do nothing", () => {
    expect(chordCommand(ev("b"))).toBeNull();
    expect(chordCommand(ev("="))).toBeNull();
    expect(chordCommand(ev("F4", { ctrlKey: true }))).toBeNull();
  });
  it("matches the produced character only — a digit-row key with another character does not fire", () => {
    expect(chordCommand(ctrl("4", { shiftKey: true, code: "Digit4" }))).toBeNull(); // a layout where Shift+4 types '4'
  });
});

describe("edit mode: only the font-style chords fire inside the cell editor", () => {
  it("Ctrl+B / I / U / 5 format the cell while editing", () => {
    for (const [k, id] of [["b", "bold"], ["i", "italic"], ["u", "underline"], ["5", "strikethrough"]]) expect(chordCommand(ctrl(k), { editing: true })).toBe(id);
  });
  it("every other chord is left to the text box", () => {
    for (const e of [ctrl(";"), ctrl("r"), ev("F4"), ev("=", { altKey: true }), ctrl("9"), ctrl("1"), ctrl("s")]) expect(chordCommand(e, { editing: true })).toBeNull();
  });
});

describe("navAction — selection and movement keys", () => {
  it("Ctrl+A, Shift+Space, Ctrl+Space", () => {
    expect(navAction(ctrl("a"))).toEqual({ type: "select-all" });
    expect(navAction(ev(" ", { shiftKey: true, code: "Space" }))).toEqual({ type: "select-row" });
    expect(navAction(ev(" ", { ctrlKey: true, code: "Space" }))).toEqual({ type: "select-column" });
    expect(navAction(ev(" ", { code: "Space" }))).toBeNull();
  });
  it("Home family", () => {
    expect(navAction(ev("Home"))).toEqual({ type: "row-start" });
    expect(navAction(ev("Home", { shiftKey: true }))).toEqual({ type: "extend-to-row-start" });
    expect(navAction(ctrl("Home", { shiftKey: true }))).toEqual({ type: "extend-to-start" });
    expect(navAction(ctrl("Home"))).toBeNull(); // Ctrl+Home keeps its existing A1 handler
    expect(navAction(ctrl("End", { shiftKey: true }))).toEqual({ type: "extend-to-used-end" });
  });
  it("PgUp / PgDn and Alt+PgUp / Alt+PgDn", () => {
    expect(navAction(ev("PageDown"))).toEqual({ type: "page-down", dir: 1, shift: false });
    expect(navAction(ev("PageUp", { shiftKey: true }))).toEqual({ type: "page-down", dir: -1, shift: true });
    expect(navAction(ev("PageDown", { altKey: true }))).toEqual({ type: "page-across", dir: 1, shift: false });
    expect(navAction(ctrl("PageDown"))).toBeNull(); // Ctrl+PgDn is the sheet-tab chord
  });
});
