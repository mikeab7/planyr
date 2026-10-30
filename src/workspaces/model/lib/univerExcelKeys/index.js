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

  const tips = installKeyTips({ host, isReady: () => sheetReady(context), run: runAction, notice });

  return {
    runAction, registered, keyTips: tips,
    dispose() {
      tips.dispose();
      disposables.forEach((d) => { try { d && d.dispose && d.dispose(); } catch (_) { /* already gone with the unit */ } });
    },
  };
}
