/* The Excel keys the free Univer build lacks (NEW-1, 2026-10-30): the PURE half of the plugin in
 * src/workspaces/model/lib/univerExcelKeys/ — the key table, the date/time values, the Insert/Delete rules — and the wiring
 * facts a browser run cannot cheaply re-prove (every Alt leaf has an action, every old-grid chord is accounted for, the plugin is
 * reached only through the lazy UniverSheet chunk and makes no network call). The real keystrokes are driven by
 * ui-audit/verify-univer-parity.mjs (+ lib/univerExcelKeysChecks.mjs), red on a build without the plugin. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  CHORD_BINDINGS, META, bindingOf, chordMatches, chordCoverage, UNIVER_UNSUPPORTED_CHORDS, NUMFMT_FOR, dateSerial, timeFraction,
  structureKind, wholeLineRanges, INSERT_CHOICES, DELETE_CHOICES, SCOPE,
} from "../src/workspaces/model/lib/univerExcelKeys/bindings.js";
import { CHORDS, EDIT_MODE_CHORDS } from "../src/workspaces/model/lib/keymap.js";
import { allKeyTips } from "../src/workspaces/model/lib/keyTips.js";
import { ALL_SHORTCUT_ITEMS } from "../src/shared/keyboard/shortcutsData.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DIR = "src/workspaces/model/lib/univerExcelKeys";
const ev = (key, o = {}) => ({ key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...o });

describe("every chord the old grid owns is accounted for on the Univer grid — never silently missing", () => {
  it("each CHORDS id is native to Univer, built by the plugin, or a NAMED gap", () => {
    const cov = chordCoverage();
    expect(cov.filter((c) => c.how === "unaccounted")).toEqual([]);
    expect(cov.length).toBe(CHORDS.length);
  });
  it("the named gaps are exactly the ones this item leaves to other work, each with its reason", () => {
    expect(Object.keys(UNIVER_UNSUPPORTED_CHORDS).sort()).toEqual(["autosum", "repeat-last", "save-now", "sheet-add", "sheet-next", "sheet-prev"]);
    for (const why of Object.values(UNIVER_UNSUPPORTED_CHORDS)) expect(why.length).toBeGreaterThan(10);
  });
  it("every key the owner listed for this item is bound", () => {
    const want = ["number-format-dialog", "currency-style", "percent-style", "number-comma-style", "numfmt-general", "numfmt-date", "strikethrough",
      "select-row", "select-column", "hide-rows", "unhide-rows", "hide-columns", "insert-cells", "delete-cells", "insert-date", "insert-time",
      "copy-above-formula", "border-outline", "border-none"];
    const have = new Set(CHORD_BINDINGS.map((b) => b.chord));
    expect(want.filter((w) => !have.has(w))).toEqual([]);
  });
  it("the Keyboard Shortcuts page (derived from the same tables) lists each of them", () => {
    const ids = new Set(ALL_SHORTCUT_ITEMS.map((i) => i.id));
    for (const b of CHORD_BINDINGS) expect(ids.has(b.nav ? `sheet.nav.${b.nav}` : `sheet.chord.${b.chord}`), b.chord).toBe(true);
  });
});

describe("the binding table", () => {
  it("every chord id exists in the old grid's key tables (one source of truth for WHAT a key means)", () => {
    for (const b of CHORD_BINDINGS) {
      if (b.nav) continue;
      expect(CHORDS.some(([id]) => id === b.chord), b.chord).toBe(true);
    }
  });
  it("every binding's key code agrees with a real keystroke that the keymap predicate accepts", () => {
    // [chord, the event a real US keyboard sends, the keyCode it carries]
    const REAL = [
      ["strikethrough", ev("5"), 53], ["number-format-dialog", ev("1"), 49],
      ["currency-style", ev("$", { shiftKey: true }), 52], ["percent-style", ev("%", { shiftKey: true }), 53], ["number-comma-style", ev("!", { shiftKey: true }), 49],
      ["numfmt-general", ev("~", { shiftKey: true }), 192], ["numfmt-date", ev("#", { shiftKey: true }), 51],
      ["border-outline", ev("&", { shiftKey: true }), 55], ["border-none", ev("_", { shiftKey: true }), 189],
      ["insert-date", ev(";"), 186], ["insert-time", ev(":", { shiftKey: true }), 186],
      ["copy-above-formula", ev("'"), 222], ["copy-above-value", ev("\"", { shiftKey: true }), 222],
      ["insert-cells", ev("+", { shiftKey: true }), 187], ["insert-cells", ev("+"), 107], ["delete-cells", ev("-"), 189], ["delete-cells", ev("-"), 109],
      ["hide-rows", ev("9"), 57], ["unhide-rows", ev("(", { shiftKey: true }), 57], ["hide-columns", ev("0"), 48], ["unhide-columns", ev(")", { shiftKey: true }), 48],
      ["select-row", ev(" ", { ctrlKey: false, shiftKey: true }), 32], ["select-column", ev(" "), 32],
    ];
    for (const [chord, e, keyCode] of REAL) {
      expect(chordMatches(chord, e), `${chord} predicate`).toBe(true);
      const mods = (e.shiftKey ? META.SHIFT : 0) | (e.ctrlKey ? META.MOD : 0);
      const wanted = keyCode | mods;
      const bound = CHORD_BINDINGS.filter((b) => b.chord === chord).flatMap((b) => b.keys.map(bindingOf));
      expect(bound, `${chord} binding for keyCode ${keyCode}`).toContain(wanted);
    }
  });
  it("a chord only matches ITS keystroke (Ctrl+Shift+4 on a layout where it types '4' fires nothing)", () => {
    expect(chordMatches("currency-style", ev("4", { shiftKey: true }))).toBe(false);
    expect(chordMatches("hide-rows", ev("9", { shiftKey: true }))).toBe(false);
    expect(chordMatches("select-row", ev(" "))).toBe(false);
    expect(chordMatches("insert-date", ev(";", { shiftKey: true }))).toBe(false);
    expect(chordMatches("no-such-chord", ev("a"))).toBe(false);
  });
  it("no two bindings collide on one code + modifier set", () => {
    const seen = new Map();
    for (const b of CHORD_BINDINGS) for (const k of b.keys) {
      const n = bindingOf(k);
      expect(seen.has(n), `${b.chord} collides with ${seen.get(n)}`).toBe(false);
      seen.set(n, b.chord);
    }
  });
  it("only the four font-style chords fire inside the cell editor (Excel's rule, same as the old grid) — and here only Ctrl+5 is new", () => {
    const inline = CHORD_BINDINGS.filter((b) => b.scope === SCOPE.INLINE).map((b) => b.chord);
    expect(inline).toEqual(["strikethrough"]);
    for (const c of inline) expect(EDIT_MODE_CHORDS.has(c)).toBe(true);
  });
});

describe("number formats and Ctrl+; / Ctrl+Shift+; values", () => {
  it("are Excel's own patterns", () => {
    expect(NUMFMT_FOR).toEqual({ "currency-style": "$#,##0.00", "percent-style": "0%", "number-comma-style": "#,##0.00", "numfmt-date": "d-mmm-yy", "numfmt-general": "General" });
  });
  it("a date is an Excel serial for the LOCAL day (known values: 1900-03-01 = 61, 2026-10-30 = 46325)", () => {
    expect(dateSerial(new Date(1900, 2, 1))).toBe(61);
    expect(dateSerial(new Date(2026, 9, 30, 23, 59))).toBe(46325);
    expect(dateSerial(new Date(2026, 9, 30, 0, 0))).toBe(46325);          // the time of day never moves the date
  });
  it("a time is the fraction of the day, to the minute", () => {
    expect(timeFraction(new Date(2026, 9, 30, 12, 0, 45))).toBeCloseTo(0.5, 10);
    expect(timeFraction(new Date(2026, 9, 30, 18, 30))).toBeCloseTo(18.5 / 24, 10);
    expect(timeFraction(new Date(2026, 9, 30, 0, 0))).toBe(0);
  });
});

describe("Insert / Delete and the whole-line selections", () => {
  const R = (r1, r2, c1, c2) => ({ startRow: r1, endRow: r2, startColumn: c1, endColumn: c2 });
  it("a whole row or column skips the prompt; cells ask; several ranges are refused; the whole sheet is not a target", () => {
    expect(structureKind([R(2, 2, 0, 19)], 100, 20)).toBe("rows");
    expect(structureKind([R(0, 99, 3, 4)], 100, 20)).toBe("columns");
    expect(structureKind([R(2, 3, 1, 2)], 100, 20)).toBe("cells");
    expect(structureKind([R(0, 99, 0, 19)], 100, 20)).toBe("sheet");
    expect(structureKind([R(0, 0, 0, 0), R(2, 2, 2, 2)], 100, 20)).toBe("multi");
    expect(structureKind([], 100, 20)).toBe("none");
  });
  it("Excel's choices and their accelerator letters", () => {
    expect(INSERT_CHOICES.map((c) => c.label)).toEqual(["Shift cells right", "Shift cells down", "Entire row", "Entire column"]);
    expect(DELETE_CHOICES.map((c) => c.label)).toEqual(["Shift cells left", "Shift cells up", "Entire row", "Entire column"]);
    for (const set of [INSERT_CHOICES, DELETE_CHOICES]) expect(new Set(set.map((c) => c.key)).size).toBe(set.length);
  });
  it("Shift+Space / Ctrl+Space span every selected range, one whole line each", () => {
    expect(wholeLineRanges([R(2, 3, 1, 2), R(7, 7, 5, 5)], "row", 100, 20)).toEqual([R(2, 3, 0, 19), R(7, 7, 0, 19)]);
    expect(wholeLineRanges([R(2, 3, 1, 2)], "column", 100, 20)).toEqual([R(0, 99, 1, 2)]);
  });
});

describe("the Alt key-tips reach an action for EVERY leaf of the shared table", () => {
  const actions = read(`${DIR}/actions.js`);
  const keyOf = (id) => new RegExp(`(^|[\\s,{])"?${id}"?\\s*:`, "m");
  it("each leaf id in lib/keyTips.js has an entry in the plugin's action table", () => {
    const missing = allKeyTips().map((t) => t.run).filter((id) => !keyOf(id).test(actions));
    expect(missing).toEqual([]);
  });
  it("each chord's action id has an entry too", () => {
    expect(CHORD_BINDINGS.map((b) => b.action).filter((id) => !keyOf(id).test(actions))).toEqual([]);
  });
});

describe("wiring facts", () => {
  it("UniverSheet.jsx installs the plugin once and disposes it with the grid; nothing else imports it", () => {
    const sheet = read("src/workspaces/model/components/UniverSheet.jsx");
    expect(sheet).toMatch(/import \{ installExcelKeys \} from "\.\.\/lib\/univerExcelKeys\/index\.js"/);
    expect(sheet).toMatch(/L\.excelKeys = installExcelKeys\(/);
    expect(sheet).toMatch(/L\.excelKeys && L\.excelKeys\.dispose\(\)/);
    const importers = [];
    const walk = (d) => { for (const e of readdirSync(new URL(`../${d}`, import.meta.url), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name) && /univerExcelKeys\//.test(read(p)) && !p.includes("univerExcelKeys/")) importers.push(p); } };
    walk("src");
    expect(importers).toEqual(["src/workspaces/model/components/UniverSheet.jsx"]);
  });
  it("is built on Univer's command + shortcut services, from the pinned preset packages only (no new dependency, no Pro, no host)", () => {
    const index = read(`${DIR}/index.js`);
    expect(index).toMatch(/ICommandService/); expect(index).toMatch(/IShortcutService/);
    expect(index).toMatch(/registerCommand\(/); expect(index).toMatch(/registerShortcut\(/);
    for (const f of readdirSync(new URL(`../${DIR}`, import.meta.url))) {
      const src = read(`${DIR}/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/univer\.ai|univer\.work|licenseKey|univerjs-pro|fetch\(|XMLHttpRequest|collaboration/i);
      for (const m of src.matchAll(/from\s+["'](@univerjs\/[^"']+)["']/g)) expect(["@univerjs/presets", "@univerjs/preset-sheets-core"], `${f} imports ${m[1]}`).toContain(m[1]);
    }
    const pkg = JSON.parse(read("package.json")); const all = { ...pkg.dependencies, ...pkg.devDependencies };
    // (the four engine packages — core, engine-formula, sheets, sheets-formula — are the headless evaluator's direct imports,
    //  lib/univerEval.js, NEW-1 B2585376; they were always installed through the presets, now declared; none is imported by this plugin)
    expect(Object.keys(all).filter((k) => k.startsWith("@univerjs")).sort()).toEqual(["@univerjs/core", "@univerjs/engine-formula", "@univerjs/preset-sheets-core", "@univerjs/preset-sheets-filter", "@univerjs/preset-sheets-find-replace", "@univerjs/preset-sheets-sort", "@univerjs/presets", "@univerjs/sheets", "@univerjs/sheets-formula"]);
  });
  it("only the pure files are Univer-free (so this test can import them)", () => {
    for (const f of ["bindings.js", "dialogs.js", "keyTipsController.js"]) expect(read(`${DIR}/${f}`), f).not.toMatch(/from\s+["']@univerjs\//);
  });
  it("the Alt listener cancels the keyup that opens a sequence (Windows browsers would otherwise focus their menu bar)", () => {
    const src = read(`${DIR}/keyTipsController.js`);
    expect(src).toMatch(/up = \(e\) => \{[\s\S]*?e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*set\(beginKeyTips\(\)\)/);
  });
});
