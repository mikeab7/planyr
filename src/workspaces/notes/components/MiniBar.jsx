/* MiniBar — the horizontal formatting mini-toolbar of the right-click menu, moved verbatim out of NoteEditor.jsx (audit batch L1; module scope, MODULE-SCOPE-COMPONENTS). */
import { useState } from "react";
import { HIGHLIGHT_COLORS, SIZES, TEXT_COLORS } from "../lib/notesFormatPalette.js";
import { boldTruth, selectionInHeaderCells } from "../lib/notesTableFill.js";
import { RADIUS } from "../lib/notesControls.js";

/** ⛔ THE FORMATTING LIVES ON A HORIZONTAL MINI-TOOLBAR, NOT IN THE VERTICAL LIST
 *  (NEW-MINI-TOOLBAR, owner instruction 2026-08-17).
 *
 *  HIS WORDS: *"there's too many things — bold, italic, underline, strike, bullets, numbering.
 *  That should be in the Microsoft Word format or OneNote format where you right click something
 *  and there's one menu that's the typical menu with cut, copy, paste, whatever. And then there's
 *  another menu that kind of goes horizontal that has text size, text colour, bold italic
 *  underline strikethrough, all that good stuff."*
 *
 *  That is Office's floating mini-toolbar, exactly: a compact strip of ICONS above a short
 *  vertical menu of COMMANDS. The split is not cosmetic — it took the vertical list from fourteen
 *  rows to six, which is most of why `Delete this box` was disappearing behind his taskbar.
 *
 *  ⛔ NO SHORTCUT LABELS ON THE STRIP. Every one of these keys still works; they simply stop
 *  being printed twice, which is what let the list grow past the screen in the first place. The
 *  accessible name carries the shortcut instead, so the keyboard route is announced rather than
 *  drawn. */
const MINI_GLYPHS = {
  bold: <text x="8" y="12" textAnchor="middle" fontSize="12" fontWeight="800" fill="currentColor" stroke="none">B</text>,
  italic: <text x="8" y="12" textAnchor="middle" fontSize="12" fontStyle="italic" fontWeight="600" fill="currentColor" stroke="none">I</text>,
  underline: <><text x="8" y="11" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">U</text><path d="M4 13.6h8" /></>,
  strike: <><text x="8" y="12" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">S</text><path d="M3.4 8h9.2" /></>,
  bullets: <><circle cx="3.6" cy="4.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="3.6" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="3.6" cy="11.5" r="1.1" fill="currentColor" stroke="none" /><path d="M6.6 4.5h6.6M6.6 8h6.6M6.6 11.5h6.6" /></>,
  numbering: <><text x="3" y="6" fontSize="5.5" fill="currentColor" stroke="none">1</text><text x="3" y="10" fontSize="5.5" fill="currentColor" stroke="none">2</text><text x="3" y="14" fontSize="5.5" fill="currentColor" stroke="none">3</text><path d="M7 4.5h6.4M7 8.6h6.4M7 12.7h6.4" /></>,
  indent: <><path d="M6.4 4h7M6.4 8h7M6.4 12h7" /><path d="M2.4 5.6 4.6 8l-2.2 2.4z" fill="currentColor" stroke="none" /></>,
  outdent: <><path d="M6.4 4h7M6.4 8h7M6.4 12h7" /><path d="M4.6 5.6 2.4 8l2.2 2.4z" fill="currentColor" stroke="none" /></>,
};

/** One icon button on the strip. */
function MiniButton({ id, title, active, disabled, onRun, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={`note-menu-${id}`}
      title={title}
      aria-label={title}
      aria-pressed={active ? "true" : undefined}
      disabled={disabled}
      /* ⛔ THE SELECTION SURVIVES THE PRESS, or the command acts on nothing and does so SILENTLY. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, padding: 0, flex: "0 0 auto",
        border: "1px solid transparent", borderRadius: RADIUS.control,
        background: active ? "color-mix(in srgb, var(--accent-notes) 16%, transparent)" : "transparent",
        color: active ? "var(--accent-notes)" : "var(--text-primary)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

const miniIcon = (id) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
    {MINI_GLYPHS[id]}
  </svg>
);

/** A colour swatch button that opens its palette inline, so the strip stays one row high. */
function MiniColor({ id, title, colors, current, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", flex: "0 0 auto" }}>
      <MiniButton id={id} title={title} active={open} onRun={() => setOpen((v) => !v)}>
        <span style={{ display: "grid", placeItems: "center", width: 16, height: 16 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1 }}>{id === "color" ? "A" : "▨"}</span>
          <span style={{ width: 13, height: 3, borderRadius: 1, background: current || "var(--border-strong)", marginTop: 1 }} />
        </span>
      </MiniButton>
      {open ? (
        <div
          role="menu"
          data-testid={`note-menu-${id}-swatches`}
          style={{
            position: "absolute", top: 30, left: 0, zIndex: 2, padding: 5,
            display: "grid", gridTemplateColumns: "repeat(5, 18px)", gap: 4,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: "0 10px 26px rgba(0,0,0,0.2)",
          }}
        >
          {colors.map((c) => (
            <button
              key={c.name}
              type="button"
              role="menuitem"
              title={c.name}
              aria-label={c.name}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(c.value); setOpen(false); }}
              style={{
                width: 18, height: 18, padding: 0, cursor: "pointer",
                border: "1px solid var(--border-default)", borderRadius: 4,
                background: c.value || "transparent",
                color: "var(--text-tertiary)", fontSize: 10, lineHeight: 1,
              }}
            >{c.value ? "" : "✕"}</button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** ⛔ THE STRIP ITSELF. Font size first, then the character formats, then the list formats —
 *  Word's order, which is the order his hand already knows. */
export function MiniBar({ editor }) {
  const chain = () => editor.chain().focus();
  const size = editor.getAttributes("textStyle")?.fontSize || "";
  /* A header cell's text is bold by style — the B must never read off on it (NEW-1, 2026-10-28). */
  const headerCells = selectionInHeaderCells(editor.state);
  const boldInHeader = headerCells === "all";
  const boldLit = boldTruth(editor.isActive("bold") ? "true" : "false", headerCells) !== "false";
  const items = [
    { id: "bold", title: boldInHeader ? "Bold (header row: use Header row to change)" : "Bold (Ctrl+B)", active: boldLit, run: () => { if (!boldInHeader) chain().toggleBold().run(); } },
    { id: "italic", title: "Italic (Ctrl+I)", active: editor.isActive("italic"), run: () => chain().toggleItalic().run() },
    { id: "underline", title: "Underline (Ctrl+U)", active: editor.isActive("underline"), run: () => chain().toggleUnderline().run() },
    { id: "strike", title: "Strikethrough", active: editor.isActive("strike"), run: () => chain().toggleStrike().run() },
  ];
  const lists = [
    { id: "bullets", title: "Bullets", active: editor.isActive("bulletList"), run: () => chain().toggleBulletList().run() },
    { id: "numbering", title: "Numbering", active: editor.isActive("orderedList"), run: () => chain().toggleOrderedList().run() },
    { id: "indent", title: "Increase indent (Tab)", run: () => chain().sinkListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run() || chain().indentListItem().run() },
    { id: "outdent", title: "Decrease indent (Shift+Tab)", run: () => chain().outdentListItem().run() || chain().liftListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run() },
  ];
  const divider = <span style={{ width: 1, alignSelf: "stretch", margin: "3px 2px", background: "var(--border-default)", flex: "0 0 auto" }} />;
  return (
    <div
      role="menu"
      aria-label="Formatting"
      data-testid="note-menu-mini"
      style={{
        display: "flex", alignItems: "center", gap: 1, padding: "3px 5px", marginBottom: 4,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.control, boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
      }}
    >
      <select
        data-testid="note-menu-size"
        title="Text size"
        aria-label="Text size"
        value={size}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) chain().unsetFontSize?.().run();
          else chain().setFontSize(v).run();
        }}
        style={{
          height: 24, maxWidth: 62, border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
          background: "var(--surface-base)", color: "var(--text-primary)", font: "inherit", fontSize: 12,
          padding: "0 2px", flex: "0 0 auto", cursor: "pointer",
        }}
      >
        {SIZES.map((n) => <option key={String(n)} value={n == null ? "" : `${n}px`}>{n == null ? "Size" : n}</option>)}
      </select>
      {divider}
      {items.map((it) => <MiniButton key={it.id} {...it} onRun={it.run}>{miniIcon(it.id)}</MiniButton>)}
      <MiniColor
        id="color" title="Text colour" colors={TEXT_COLORS}
        current={editor.getAttributes("textStyle")?.color || null}
        onPick={(v) => (v ? chain().setColor(v).run() : chain().unsetColor().run())}
      />
      <MiniColor
        id="highlight" title="Highlight" colors={HIGHLIGHT_COLORS}
        current={editor.getAttributes("highlight")?.color || null}
        onPick={(v) => (v ? chain().setHighlight({ color: v }).run() : chain().unsetHighlight().run())}
      />
      {divider}
      {lists.map((it) => <MiniButton key={it.id} {...it} onRun={it.run}>{miniIcon(it.id)}</MiniButton>)}
    </div>
  );
}
