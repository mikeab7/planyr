/* NoteSlashMenu — the list that appears when you type `/` (NEW-1).
 *
 * It renders and it does nothing else. WHEN it is open, WHAT is in it and WHICH row is
 * highlighted are all decided in lib/notesSlashMenu.js, by a plugin reading the document —
 * so this component has no state of its own to get out of step with the editor, and the
 * whole of the trigger rule ("never mid-word") is unit-testable with no browser.
 *
 * ⛔ IT IS NOT A DIALOG (house rule). No overlay, nothing modal, no focus steal: the caret
 * stays in the document the entire time, which is what lets typing keep filtering the list.
 * Every press is cancelled on `mousedown` for the same reason every toolbar control is.
 *
 * ⛔ AND THE KEYBOARD OWNS IT. ↑ ↓ Enter Esc are claimed by the plugin, above the default
 * keymap; this surface is the mouse's way in, not the only way in.
 */
import { useEffect, useRef } from "react";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

export default function NoteSlashMenu({ open, items = [], index = 0, at, onPick, onHover }) {
  const listRef = useRef(null);

  /* Keep the highlighted row in view when the arrows walk past the bottom of the list.
   * Scoped to the list's own scroller — never `scrollIntoView` on the page, which would
   * drag the document out from under the caret. */
  useEffect(() => {
    const box = listRef.current;
    const row = box?.children?.[index];
    if (!box || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [index, open]);

  if (!open || !at || !items.length) return null;

  return (
    <div
      data-testid="note-slash-menu"
      role="listbox"
      aria-label="Insert a block"
      style={{
        position: "absolute", left: Math.max(6, at.x), top: at.y + 6, zIndex: 45,
        width: 268, maxHeight: 268, overflow: "hidden",
        borderRadius: RADIUS.control, border: "1px solid var(--border-default)",
        background: "var(--surface-raised)", boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
        display: "flex", flexDirection: "column",
      }}
    >
      <div ref={listRef} style={{ overflowY: "auto", padding: "4px 0" }}>
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            role="option"
            aria-selected={i === index}
            data-testid={`note-slash-${it.id}`}
            data-active={i === index ? "1" : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover?.(i)}
            onClick={() => onPick?.(it.id)}
            style={{
              display: "flex", alignItems: "baseline", gap: 8, width: "100%",
              padding: "5px 11px", border: "none", textAlign: "left", cursor: "pointer",
              background: i === index ? "var(--accent-notes)" : "transparent",
              color: i === index ? "var(--on-accent-notes)" : "var(--text-primary)",
              font: "inherit", fontSize: 13, fontWeight: 600,
            }}
          >
            <span style={{ flex: "0 0 auto" }}>{it.label}</span>
            <span style={{
              flex: 1, minWidth: 0, textAlign: "right", fontSize: 11, fontWeight: 600,
              color: i === index ? "var(--on-accent-notes)" : "var(--text-tertiary)",
              opacity: i === index ? 0.85 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{it.hint}</span>
          </button>
        ))}
      </div>
      {/* One line, and it is the way OUT — the thing nobody guesses about a menu that
          opened itself while they were typing (PANEL-BREVITY: one line, not a legend). */}
      <div style={{
        flex: "none", padding: "4px 11px", borderTop: "1px solid var(--border-default)",
        color: "var(--text-tertiary)", fontSize: 10.5, fontWeight: 650, letterSpacing: "0.03em",
      }}>
        ↑↓ choose · Enter insert · Esc keep the “/”
      </div>
    </div>
  );
}
