/* Model workspace — Excel's Alt key-tip sequences on the Univer grid (NEW-1, 2026-10-30).
 *
 * PORTED, not re-derived: the sequence table is `lib/keyTips.js` (`KEYTIP_TREE` + the pure `stepKeyTips` machine, shared with
 * the old grid and its Keyboard Shortcuts page) and the listener rules are the ones `ModelApp.jsx` proved in production:
 *   - the sequence arms on Alt DOWN and opens on the matching Alt KEYUP, only when no other key or mouse press happened
 *     between them — so Alt+Enter, Alt+click and Alt+= stay chords;
 *   - preventDefault on that Alt KEYUP is what stops Windows browsers focusing their own menu bar;
 *   - capture phase, so while a sequence is open NOTHING else (Univer's type-to-edit, a toolbar button) sees the letters;
 *   - Esc / Backspace back out ONE level, an unmatched key, a second Alt, a click or a window blur cancels.
 * Pure DOM — no Univer import — so the same controller is exercised by the unit tests with a fake `run`.
 *
 * What it draws (aria-hidden except the strip, pointer-less so a click still reaches the sheet and cancels):
 *   1. a small black badge on every Univer toolbar control that has a key-tip and is still reachable from the keys typed so far;
 *   2. a strip along the bottom of the grid listing the choices at this level, so EVERY path in the tree is discoverable,
 *      not only the ones that happen to have a toolbar button.
 */
import { START, beginKeyTips, stepKeyTips, choicesAt, allKeyTips } from "../keyTips.js";
import { RADIUS } from "../../../../shared/ui/radius.js";

/** Key-tip leaf → the Univer toolbar button that does the same thing (`data-u-command`), for the badges. */
export const TOOLBAR_COMMAND_OF = Object.freeze({
  bold: "sheet.command.set-range-bold", italic: "sheet.command.set-range-italic", underline: "sheet.command.set-range-underline",
  "wrap-text": "sheet.command.set-text-wrap", "fill-color-menu": "sheet.command.set-background-color", "font-color-menu": "sheet.command.set-range-text-color",
  "format-painter": "ui.operation.activate-format-painter", "percent-style": "sheet.command.numfmt.set.percent", "decimal-increase": "sheet.command.numfmt.add.decimal.command",
  "decimal-decrease": "sheet.command.numfmt.subtract.decimal.command", "currency-style": "sheet.command.numfmt.set.currency",
});

const css = (el, o) => Object.assign(el.style, o);

export function installKeyTips({ host, isReady, run, notice }) {
  let state = START;
  let armed = false;
  const strip = document.createElement("div");
  strip.setAttribute("role", "status"); strip.setAttribute("aria-live", "polite"); strip.setAttribute("data-testid", "excel-keys-keytip-panel");
  css(strip, {
    position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)", zIndex: 900, pointerEvents: "none", display: "none",
    maxWidth: "calc(100% - 32px)", padding: "6px 10px", flexWrap: "wrap", gap: "4px 14px", background: "var(--surface-raised)", color: "var(--text-primary)",
    border: "1px solid var(--border-strong)", borderRadius: RADIUS.md, fontSize: "13px", lineHeight: "1.4",
  });
  // NOT appended yet: Univer renders its own React root into `host` after the plugin installs and would sweep a child added now.
  let badges = [];
  const clearBadges = () => { badges.forEach((b) => b.remove()); badges = []; };

  const paint = () => {
    clearBadges();
    if (!state.active) { strip.style.display = "none"; return; }
    const choices = choicesAt(state.path);
    strip.replaceChildren();
    const head = document.createElement("strong"); head.textContent = ["Alt", ...state.path.split("")].filter(Boolean).join(" › "); strip.appendChild(head);
    if (choices.length === 0) { const s = document.createElement("span"); s.textContent = "Press Esc to cancel"; strip.appendChild(s); }
    for (const c of choices) {
      const s = document.createElement("span"); s.style.whiteSpace = "nowrap";
      const kbd = document.createElement("kbd"); kbd.textContent = c.key;
      css(kbd, { fontWeight: "700", fontFamily: "inherit", padding: "0 4px", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm });
      s.append(kbd, ` ${c.label}${c.leaf ? "" : " ›"}`); strip.appendChild(s);
    }
    if (!strip.isConnected) host.appendChild(strip);
    strip.style.display = "flex";
    for (const { path, run: leaf } of allKeyTips()) {
      const cmd = TOOLBAR_COMMAND_OF[leaf];
      if (!cmd || !path.startsWith(state.path) || path.length === state.path.length) continue;
      const btn = document.querySelector(`[data-u-command="${cmd}"]`);
      if (!btn) continue;
      const b = btn.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const tag = document.createElement("span");
      tag.setAttribute("aria-hidden", "true"); tag.setAttribute("data-testid", "excel-keys-keytip-badge"); tag.textContent = path.slice(state.path.length);
      css(tag, {
        position: "fixed", left: `${b.left + b.width / 2}px`, top: `${b.bottom - 2}px`, transform: "translateX(-50%)", zIndex: 1000, pointerEvents: "none",
        padding: "0 4px", borderRadius: RADIUS.sm, background: "var(--text-primary)", color: "var(--surface-page)", fontWeight: "700", fontSize: "11px", lineHeight: "16px", whiteSpace: "nowrap",
      });
      document.body.appendChild(tag); badges.push(tag);
    }
  };
  const set = (next) => { state = next; paint(); };

  // Which events belong to this grid: aimed at the page body or inside the grid host, and not typed into a text control
  // (the name box, the find panel, our own prompt). Univer's hidden cell-editor surface is contenteditable, so that is NOT
  // excluded here — `isReady()` (Univer's own focus flags: a sheet selected, no editor open) is what keeps a cell being
  // edited out of it.
  const scopeOk = (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('input, textarea, select, [role="dialog"]')) return false;
    return !t || t === document.body || host.contains(t);
  };

  const down = (e) => {
    if (e.key === "Alt") {
      if (e.repeat) { if (state.active || armed) e.preventDefault(); return; }
      if (state.active) { e.preventDefault(); e.stopPropagation(); set(START); armed = false; return; }
      armed = !e.ctrlKey && !e.metaKey && !e.shiftKey && scopeOk(e) && isReady();
      return;
    }
    armed = false;
    if (!state.active) return;
    e.preventDefault(); e.stopPropagation();
    const { state: next, run: leaf } = stepKeyTips(state, e.key);
    set(next);
    if (leaf) {
      Promise.resolve(run(leaf)).then((ok) => { if (ok === false && notice) notice("That command isn't available right now."); });
    }
  };
  const up = (e) => {
    if (e.key !== "Alt") return;
    if (armed && !state.active) {
      // preventDefault on the Alt KEYUP is what stops Windows browsers focusing their own menu bar
      e.preventDefault(); e.stopPropagation();
      set(beginKeyTips());
    } else if (state.active) e.preventDefault();
    armed = false;
  };
  const cancel = () => { armed = false; if (state.active) set(START); };
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  window.addEventListener("mousedown", cancel, true);
  window.addEventListener("blur", cancel);

  return {
    /** The live state (for tests / harnesses through the E2E handle). */
    get state() { return state; },
    dispose() {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("mousedown", cancel, true);
      window.removeEventListener("blur", cancel);
      clearBadges(); strip.remove(); state = START;
    },
  };
}
