/* Model workspace — "Excel keys on Univer": ONE Planyr plugin that fills the keyboard gaps of the free Univer build
 * (NEW-1, 2026-10-30; cutover plan step 2 in docs/SPREADSHEET-UNIVER-SPIKE.md). Registered from `UniverSheet.jsx`.
 *
 * Built ON Univer's own services, pinned to the versions in package.json:
 *   - `ICommandService`  — every action is a real Univer command (`planyr.excel.<id>`), run through the same service the
 *                          toolbar uses, so it is undoable, observed by the host's save hook and visible to the facade;
 *   - `IShortcutService` — every chord is a registered shortcut item (binding = key code + modifier bits, plus an
 *                          `eventPreconditions` that confirms the CHARACTER the key produced with lib/keymap.js — the old
 *                          grid's own predicates — and `preconditions` that read Univer's focus flags).
 * Where Univer already has the command (hide rows, number format, borders, merge, freeze, sort, filter, autofit, clear, align…)
 * the key calls it; the plugin builds only what has no Univer equivalent: the Alt key-tip state machine and its badges, copy
 * from the cell above, today's date / the time as a real date value, Shift+Space / Ctrl+Space, and Excel's shift-cells prompt.
 *
 * NEVER while a cell editor, the formula bar or the name box has focus (Univer's focus flags say so) — except the four
 * font-style chords, which Excel also applies inside the editor (Ctrl+5 joins Ctrl+B/I/U, as `EDIT_MODE_CHORDS` says).
 *
 * Imports Univer: reachable ONLY from UniverSheet.jsx (pinned by test/modelUniverSwitch). The pure half is ./bindings.js. */
import {
  CommandType, ICommandService, IContextService, FOCUSING_SHEET, FOCUSING_UNIVER_EDITOR, EDITOR_ACTIVATED, FOCUSING_FX_BAR_EDITOR, FOCUSING_COMMON_DRAWINGS,
} from "@univerjs/presets";
import { IShortcutService } from "@univerjs/preset-sheets-core";
import { CHORD_BINDINGS, SCOPE, bindingOf, chordMatches } from "./bindings.js";
import { createActions } from "./actions.js";
import { installKeyTips } from "./keyTipsController.js";
import { MULTI_SELECTION_MESSAGE } from "../../../../shared/selection/rangeSelection.js";

/** Univer's formula-hint list (the "PI / PMT / …" suggestions under a cell being edited) is a fixed-position <ul> inside a <section>. */
const HINT_LIST = 'section[class*="univer-fixed"] ul[class*="univer-list-none"]';
const hintListOpen = () => { for (const ul of document.querySelectorAll(HINT_LIST)) { const r = ul.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && ul.querySelector("li")) return true; } return false; };
const ENTER_KEYCODE = 13;

export const COMMAND_PREFIX = "planyr.excel.";

const sheetFocused = (c) => !!(c.getContextValue(FOCUSING_SHEET) && c.getContextValue(FOCUSING_UNIVER_EDITOR) && !c.getContextValue(FOCUSING_COMMON_DRAWINGS));
/** A sheet is selected and NO editor (the cell editor, the formula bar) is open. */
const sheetReady = (c) => sheetFocused(c) && !c.getContextValue(EDITOR_ACTIVATED) && !c.getContextValue(FOCUSING_FX_BAR_EDITOR);
const typingInPlainField = (e) => e.target instanceof Element && !!e.target.closest("input, textarea, select");

export function installExcelKeys({ univerAPI, injector, host, onNotice }) {
  const commands = injector.get(ICommandService);
  const shortcuts = injector.get(IShortcutService);
  const context = injector.get(IContextService);
  const notice = (text) => { if (onNotice) onNotice(text); };
  const { runAction, ids } = createActions({ api: univerAPI, injector, host, notice });

  const disposables = [];
  for (const id of ids) {
    disposables.push(commands.registerCommand({ id: COMMAND_PREFIX + id, type: CommandType.COMMAND, handler: async () => { await runAction(id); return true; } }));
  }
  const registered = [];
  for (const b of CHORD_BINDINGS) {
    for (const key of b.keys) {
      const item = {
        id: COMMAND_PREFIX + b.action, description: `Excel ${b.chord}`, group: "planyr.excel", priority: 10, binding: bindingOf(key),
        preconditions: b.scope === SCOPE.INLINE ? sheetFocused : sheetReady,
        eventPreconditions: (e) => !typingInPlainField(e) && chordMatches(b.chord, e),
      };
      disposables.push(shortcuts.registerShortcut(item));
      registered.push({ chord: b.chord, action: b.action, binding: item.binding, scope: b.scope });
    }
  }

  // ENTER COMMITS A FORMULA, EVEN WITH THE HINT LIST OPEN (Excel). Univer's hint list binds Enter (priority 1000) to "accept the suggestion", so a
  // formula ending in a name or a bare function (`=Site.Acres`, `=A1*TaxRate`, `=PI`) was left open in the editor, and a SECOND Enter could replace what
  // was typed with a different suggestion (measured: `=Plan.Building2.SF` became `=Plan.Building1.SF`). In Excel the list is for Tab; Enter commits
  // what you typed. A shortcut ABOVE the hint's priority, live only while that list is on screen: commit the edit (Univer's own commit steps down a row, as Enter does).
  const ENTER_COMMIT = COMMAND_PREFIX + "enter-commit";
  disposables.push(commands.registerCommand({
    id: ENTER_COMMIT, type: CommandType.COMMAND,
    handler: async () => {
      try {
        const wb = univerAPI.getActiveWorkbook();
        await (wb && wb.endEditingAsync(true));
      } catch (err) {
        console.error("Enter could not commit the formula", err);
        notice("That formula could not be committed — press the ✓ in the formula bar.");
      }
      return true;
    },
  }));
  disposables.push(shortcuts.registerShortcut({ id: ENTER_COMMIT, description: "Excel Enter commits a formula", group: "planyr.excel", priority: 2000, binding: ENTER_KEYCODE, preconditions: () => hintListOpen() }));

  // COPY / CUT ON SEVERAL RANGES IS REFUSED OUT LOUD (Excel: "That command cannot be used on multiple selections"; owner constraint — never a silent
  // no-op). Univer copied just ONE of the ranges and said nothing. Ctrl+C / Ctrl+X above Univer's own binding, live only with 2+ ranges selected.
  const REFUSE_MULTI = COMMAND_PREFIX + "refuse-multi-selection";
  const multiRanges = () => { try { const wb = univerAPI.getActiveWorkbook(); const ws = wb && wb.getActiveSheet(); return !!ws && ws.getSelection().getActiveRangeList().length > 1; } catch (_) { return false; } };
  disposables.push(commands.registerCommand({ id: REFUSE_MULTI, type: CommandType.COMMAND, handler: async () => { notice(MULTI_SELECTION_MESSAGE); return true; } }));
  for (const code of [67, 88]) {                                  // C, X
    disposables.push(shortcuts.registerShortcut({
      id: REFUSE_MULTI, description: "Excel refuses copy / cut on several ranges", group: "planyr.excel", priority: 2000, binding: bindingOf({ code, mod: true }),
      preconditions: (c) => sheetReady(c) && multiRanges(),
    }));
  }

  // …and the same refusal when the copy / cut arrives as the browser's own clipboard EVENT (the menu, the context menu, a platform where Univer does not
  // take the key): without this a multi-range copy still went through silently on the real page.
  const onCopyCut = (e) => {
    if (typingInPlainField(e) || !sheetReady(context) || !multiRanges()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    notice(MULTI_SELECTION_MESSAGE);
  };
  document.addEventListener("copy", onCopyCut, true);
  document.addEventListener("cut", onCopyCut, true);

  // AN EMPTY OR UNREADABLE PASTE SAYS SO (owner constraint: never a silent no-op). Univer ignores a paste whose clipboard holds nothing it can read;
  // from a person's side the key simply did nothing. Capture phase, before Univer's own handler, and only for a paste aimed at the sheet itself.
  const onPaste = (e) => {
    if (typingInPlainField(e) || !sheetReady(context)) return;
    const dt = e.clipboardData;
    const types = dt ? Array.from(dt.types || []) : [];
    const readable = types.includes("text/plain") || types.includes("text/html") || (dt && dt.files && dt.files.length > 0);
    const hasText = readable && ((dt.getData("text/plain") || dt.getData("text/html") || "").length > 0 || (dt.files && dt.files.length > 0));
    if (!hasText) notice("There's nothing to paste — the clipboard is empty, or holds something Planyr can't read.");
  };
  document.addEventListener("paste", onPaste, true);

  const tips = installKeyTips({ host, isReady: () => sheetReady(context), run: runAction, notice });

  return {
    runAction, registered, keyTips: tips,
    dispose() {
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("copy", onCopyCut, true);
      document.removeEventListener("cut", onCopyCut, true);
      tips.dispose();
      disposables.forEach((d) => { try { d && d.dispose && d.dispose(); } catch (_) { /* already gone with the unit */ } });
    },
  };
}
