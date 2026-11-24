/* DocMenu — the document right-click menu (rows, table section, placement), moved verbatim out of NoteEditor.jsx (audit batch L1; module scope, MODULE-SCOPE-COMPONENTS). */
import { MiniBar } from "./MiniBar.jsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PASTE_MODES } from "../lib/notesPastePlain.js";
import { PASTE_MODE_META } from "../lib/notesPasteModes.js";
import { PasteGlyph } from "./PasteIcons.jsx";
import { TABLE_FILLS, currentFill, headerRowsState } from "../lib/notesTableFill.js";
import { placeAtPoint } from "../../../shared/ui/anchoredMenuPlacement.js";
import { RADIUS } from "../lib/notesControls.js";

/** One separator row. A named constant so the table below reads as a menu rather than as a list
 *  with holes in it. */
const SEP = { sep: true };

function MenuRow({ item, onClose }) {
  const [openSub, setOpenSub] = useState(false);
  if (item.sep) {
    return <div style={{ height: 1, background: "var(--border-default)", margin: "4px 0" }} />;
  }
  /* ⛔ THE PASTE MODES ARE A SUBMENU, NOT THREE TOP-LEVEL ROWS — his instruction, and the reason
   * is the same one behind the whole split: three rows for one command is three quarters of the
   * space `Delete this box` needed to stay on screen. */
  if (item.sub) {
    return (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setOpenSub(true)}
        onMouseLeave={() => setOpenSub(false)}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSub ? "true" : "false"}
          data-testid={`note-menu-${item.id}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpenSub((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "5px 12px",
            border: "none", background: "transparent", color: "var(--text-primary)",
            font: "inherit", fontSize: 13, fontWeight: 500, textAlign: "left", cursor: "pointer",
          }}
        >
          <span style={{ flex: 1 }}>{item.label}</span>
          <span style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>▸</span>
        </button>
        {openSub ? (
          <div
            role="menu"
            data-testid={`note-menu-${item.id}-sub`}
            className="planyr-paste-ctx"
            style={{
              position: "absolute", left: "100%", top: -4, minWidth: 208, padding: "5px 0", zIndex: 1,
              background: "var(--surface-raised)", border: "1px solid var(--border-default)",
              borderRadius: RADIUS.control, boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
            }}
          >
            {item.sub.map((s) => <MenuRow key={s.id} item={s} onClose={onClose} />)}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={`note-menu-${item.id}`}
      aria-pressed={item.active ? "true" : undefined}
      /* ⛔ THE SELECTION SURVIVES THE PRESS, or every command here acts on nothing. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { item.run(); onClose(); }}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        width: "100%", padding: "5px 12px", border: "none", background: "transparent",
        color: item.danger ? "var(--danger-text)" : "var(--text-primary)",
        font: "inherit", fontSize: 13, fontWeight: item.active ? 700 : 500,
        textAlign: "left", cursor: "pointer",
      }}
    >
      {item.chip !== undefined ? (
        <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, border: "1px solid var(--border-strong)", flex: "0 0 auto", background: item.chip || "var(--surface-page)", color: "var(--text-tertiary)", fontSize: 10, lineHeight: "12px", textAlign: "center" }}>{item.chip ? "" : "✕"}</span>
      ) : null}
      {item.icon ? <span aria-hidden="true" className="planyr-paste-ctx" style={{ width: 20, height: 20, display: "grid", placeItems: "center", flex: "0 0 auto" }}>{item.icon}</span> : null}
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.accel ? <span style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>{item.accel}</span> : null}
    </button>
  );
}

/** ⛔ WHERE THE MENU GOES, MEASURED RATHER THAN GUESSED (NEW-MENU-OFFSCREEN).
 *
 *  HIS REPORT: *"you can't see everything on the menu because the delete part is hidden behind my
 *  start menu or task bar."* The old rule was `top: Math.min(at.y, window.innerHeight - 420)` — a
 *  HARD-CODED 420px guess at the menu's own height. Two things wrong with it, and the second is
 *  why it failed him: a menu taller than the guess still runs off the bottom, and the guess was
 *  never re-checked against what actually rendered.
 *
 *  ⛔ SO IT IS MEASURED, AFTER MOUNT, IN A LAYOUT EFFECT — before paint, so the menu is never seen
 *  in the wrong place and then corrected. The rule is Office's: prefer below-and-right of the
 *  pointer; FLIP above if the assembly does not fit below; then clamp into the viewport with a
 *  margin so it can never sit under an edge either way.
 *
 *  ⛔ `visualViewport` IS PREFERRED OVER `innerHeight`, deliberately: on a maximised window it
 *  already excludes the taskbar, which is the exact case he is hitting. It also follows a pinch
 *  zoom and an on-screen keyboard, neither of which `innerHeight` knows about. */
/* The math moved to shared/ui/anchoredMenuPlacement.js `placeAtPoint` (audit I8) — this alias keeps the
 * Notes name and test seam. */
export const placeMenu = placeAtPoint;

/** The table section of the right-click menu: "Header row" (shown as on/off) and "Fill ▸" with No fill first. */
function tableMenuItems(editor) {
  const state = editor.state;
  const fillNow = currentFill(state);
  return [
    SEP,
    { id: "header-row", label: "Header row", active: headerRowsState(state) === "true", run: () => editor.chain().focus().toggleHeaderRows().run() },
    {
      id: "fill",
      label: "Fill",
      sub: TABLE_FILLS.map((f) => ({
        id: f.value ? `fill-${f.name.toLowerCase()}` : "fill-none",
        label: f.name,
        chip: f.value || "",
        active: f.value ? fillNow === f.value.toLowerCase() : false,
        run: () => editor.chain().focus().setCellFill(f.value).run(),
      })),
    },
  ];
}

export function DocMenu({ at, editor, onPlainPaste, onClose, onDeleteBox, onClipboardNote, onConvertTable, pressGuardRef }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  /* ⛔ GATED ON `at`. Registered unconditionally, this effect put a CAPTURE-phase Escape
   * listener on the document that called preventDefault — while the menu was CLOSED. That
   * silently ate every Escape in the note, which killed the Escape-then-Tab keyboard escape
   * hatch (B1392) stone dead. The headless run caught it; a hook that fires while its own
   * component renders nothing is the shape to watch for. */
  useEffect(() => {
    if (!at) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [at, onClose]);

  /* ⛔ MEASURED BEFORE PAINT (NEW-MENU-OFFSCREEN). The assembly — mini-toolbar AND list — is
   * measured as one thing, because measuring only the list is how `Delete this box` ended up
   * behind his taskbar: the strip above it is part of what has to fit. A layout effect runs
   * before the browser paints, so the menu is never seen in the wrong place and then corrected. */
  useLayoutEffect(() => {
    if (!at || !ref.current) { setBox(null); return; }
    const r = ref.current.getBoundingClientRect();
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    setBox(placeMenu({
      x: at.x, y: at.y, w: r.width, h: r.height,
      viewW: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1200),
      viewH: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 800),
    }));
  }, [at]);

  /* ⛔ A TOUCH-OPENED MENU LEAVES FOCUS WHERE IT WAS (B2078592). Moving focus to the first row is keyboard
   * navigation's courtesy on desktop; on a phone it blurs the editor, which DROPS THE SOFT KEYBOARD the
   * moment you press-and-hold inside the box you are typing in. A finger needs no focus ring on a row
   * (rows already swallow mousedown so the selection survives), so a menu a finger opened keeps the
   * editor focused — keyboard up if it was up, down if it was down. Desktop right-click is unchanged. */
  const touchMenu = !!at?.touch;
  useEffect(() => { if (box && !touchMenu) ref.current?.querySelector("button")?.focus(); }, [box, touchMenu]);

  if (!at || !editor || editor.isDestroyed) return null;

  /* ⛔ CUT AND COPY GO THROUGH THE BROWSER'S OWN EDITING COMMAND, deliberately. The async
   * Clipboard API needs a permission this app has no way to ask for from a menu click, and a
   * refused permission is a SILENT no-op. `execCommand` acts on the live selection and REPORTS
   * whether it worked, so a refusal can be said out loud (LOUD-FAILURE) rather than looking like
   * the menu item is broken. */
  const clip = (kind) => {
    let ok = false;
    try { ok = document.execCommand(kind); } catch (_) { ok = false; }
    if (!ok) onClipboardNote?.(`Your browser would not let the menu ${kind} — Ctrl+${kind === "cut" ? "X" : "C"} always works.`);
  };

  /* ⛔ SIX ROWS, NOT FOURTEEN. Everything that formats moved to the strip above; what is left is
   * what Word leaves: the clipboard, the link, and the one destructive action, last and
   * separated so a slip cannot reach it. */
  const items = [
    { id: "cut", label: "Cut", accel: "Ctrl+X", run: () => clip("cut") },
    { id: "copy", label: "Copy", accel: "Ctrl+C", run: () => clip("copy") },
    {
      id: "paste",
      label: "Paste",
      sub: PASTE_MODES.map((mode) => ({
        id: mode === "text" ? "paste-plain" : `paste-${mode}`,
        label: PASTE_MODE_META[mode].label,
        icon: <PasteGlyph mode={mode} size={20} />,
        accel: mode === "text" ? "Ctrl+Shift+V" : PASTE_MODE_META[mode].key,
        run: () => onPlainPaste(mode),
      })),
    },
    SEP,
    { id: "link", label: editor.isActive("link") ? "Remove link" : "Link…", accel: "Ctrl+K",
      run: () => (editor.isActive("link")
        ? editor.chain().focus().unsetLink().run()
        : editor.chain().focus().extendMarkRange("link").run()) },
    /* NEW-2 — pulls a table's rows out as plain lines (a sibling list item apiece, when the
       table is the only thing in its list item). Its own row, not lumped with `link`, because
       it restructures the document rather than formatting a selection. */
    ...(onConvertTable ? [SEP, { id: "convert-table-text", label: "Convert table to text", run: onConvertTable }] : []),
    /* NEW-1/NEW-2 (2026-10-28) — the table's Header row and Fill, where a right-click lands. The SAME two
       commands the toolbar's Table group runs (`toggleHeaderRows` / `setCellFill`): the cell selection if
       there is one, else the caret cell's whole row. */
    ...(at?.inTable ? tableMenuItems(editor) : []),
    ...(onDeleteBox ? [SEP, { id: "delete-box", label: "Delete this box", accel: "Del", danger: true, run: onDeleteBox }] : []),
  ];

  return (
    <div
      ref={ref}
      data-testid="note-doc-menu"
      data-menu-kind={onDeleteBox ? "box" : "document"}
      data-menu-flipped={box?.flipped ? "1" : undefined}
      /* ⛔ THE LONG-PRESS THAT OPENED A TOUCH MENU IS STILL ON THE GLASS (B2078592). Lifting the finger
       * synthesises a mousedown + click at the press point — which is now ON the menu. Unguarded, the
       * mousedown on the menu's own (non-button) area moved focus off the editor and DROPPED THE KEYBOARD
       * (measured on a real held touch in Chromium), and the click could land on whichever row sits
       * under the finger. For a short window after the press the menu swallows both. Touch menus only. */
      onMouseDownCapture={(e) => {
        if (!at?.touch) return;
        if (pressGuardRef && performance.now() < pressGuardRef.current) { e.stopPropagation(); e.preventDefault(); return; }
        if (!(e.target instanceof Element) || !e.target.closest("button")) e.preventDefault();   // padding/separator: never steal focus
      }}
      onClickCapture={(e) => { if (at?.touch && pressGuardRef && performance.now() < pressGuardRef.current) { e.stopPropagation(); e.preventDefault(); } }}
      style={{
        position: "fixed",
        left: box ? box.left : at.x,
        top: box ? box.top : at.y,
        /* Hidden for the one frame between mount and measurement, so it cannot be seen at the
         * unmeasured position — the flicker that a post-paint effect would produce. */
        visibility: box ? "visible" : "hidden",
        zIndex: 60, display: "flex", flexDirection: "column", alignItems: "flex-start",
        cursor: "default",          // chrome: the arrow, whatever surface (the mat's hand, a box's move) it floats over
      }}
    >
      <MiniBar editor={editor} />
      <div
        role="menu"
        data-testid="note-doc-menu-list"
        style={{
          minWidth: 224, padding: "5px 0", width: "100%",
          background: "var(--surface-raised)", border: "1px solid var(--border-default)",
          borderRadius: RADIUS.control, boxShadow: "0 14px 36px rgba(0,0,0,0.22)",
        }}
      >
        {items.map((item, i) => <MenuRow key={item.sep ? `sep${i}` : item.id} item={item} onClose={onClose} />)}
      </div>
    </div>
  );
}
