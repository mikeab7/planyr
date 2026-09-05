/* NoteOutline — the current note's headings, as a way to move around it (NEW-6).
 *
 * ⛔ ABSENT, NOT EMPTY. A note with no headings renders NOTHING here — no header, no
 * placeholder, no empty box. A permanent "no headings yet" panel on every short note is
 * exactly the accumulation PANEL-BREVITY forbids, and it would put furniture on the screen
 * for the majority case (most notes are short and have no headings at all).
 *
 * ⛔ IT DOES NOT MOVE THE DOCUMENT'S LEFT EDGE (VIEWPORT-STABLE). The pane sits to the
 * RIGHT of the sheet and the sheet is left-aligned (B1369), so showing or hiding it cannot
 * shift the text sideways — there is no delta to compensate for, by construction rather
 * than by measurement. Collapsing it leaves a narrow rail with the toggle on it, so the way
 * back is where the way out was.
 *
 * ⛔ ON A PHONE IT NEVER JOINS THE ROW AT ALL (B1203505). The docked rail above sits BESIDE
 * the sheet and spends real width doing it — even collapsed, it is a rail, not nothing. The
 * row that holds the sheet + this pane has no `overflow` of its own, so on a real phone the
 * sheet's own floor (`note-sheet`'s `minWidth: 260`) plus anything this pane spent left no
 * room to give, and the shortfall pushed the sheet's LEFT edge — the actual words — off the
 * left of the screen (reproduced live: "No Density F[ield]" cut to "lo Density F"). Below
 * the shared phone breakpoint (`narrow`, the same one the toolbar and the phone drill-in
 * use — see NoteEditor.jsx's `useNarrow` note on why this is not a third breakpoint) this
 * renders a floating toggle instead: `position: fixed`, so it costs the row zero width by
 * construction, and the panel it opens is fixed too, drawn OVER the document rather than
 * beside it. Selecting a heading closes it, so the jump is not left to a document you can't
 * see under it.
 *
 * Everything derived — which rows exist, which is active, which are hidden under a folded
 * one — comes from lib/notesOutline.js, pure and unit-tested. This file renders.
 */
import { useMemo } from "react";
import { outlineHasChildren, visibleOutline } from "../lib/notesOutline.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
const FONT = { micro: 10, control: 12 }; // mirrored from shared/ui/designTokens.js FONT_SIZE — see NoteToolbar

export default function NoteOutline({
  entries = [], activeIndex = -1, collapsed, open = true, onToggleOpen, onGo, onToggleRow, narrow = false,
}) {
  const shown = useMemo(() => visibleOutline(entries, collapsed), [entries, collapsed]);
  if (!entries.length) return null;

  // On a phone the panel is drawn OVER the document, so leaving it open after a jump would
  // cover the very heading it just scrolled to. The docked desktop rail never covers
  // anything, so it never closes itself on a click.
  const goAndMaybeClose = (e) => {
    onGo?.(e);
    if (narrow) onToggleOpen?.();
  };

  const rows = shown.map((e) => {
    const folds = outlineHasChildren(entries, e.index);
    const shut = (collapsed instanceof Set ? collapsed : new Set(collapsed || [])).has(e.id);
    const on = e.index === activeIndex;
    return (
      <div key={e.id} style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
        <button
          type="button"
          data-testid={`note-outline-fold-${e.index}`}
          aria-label={shut ? `Expand ${e.text}` : `Collapse ${e.text}`}
          aria-expanded={folds ? !shut : undefined}
          disabled={!folds}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onToggleRow?.(e.id)}
          style={{
            flex: "0 0 auto", width: 14, border: "none", background: "transparent",
            color: "var(--text-tertiary)", font: "inherit", fontSize: 9, lineHeight: 1,
            cursor: folds ? "pointer" : "default", opacity: folds ? 1 : 0, padding: 0,
          }}
        >{shut ? "▶" : "▼"}</button>
        <button
          type="button"
          data-testid={`note-outline-row-${e.index}`}
          data-active={on ? "1" : undefined}
          title={e.text}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => goAndMaybeClose(e)}
          style={{
            flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
            padding: "3px 7px", marginBottom: 1,
            paddingLeft: 7 + (e.level - 1) * 10,
            borderRadius: RADIUS.control,
            border: "1px solid transparent",
            background: on ? "var(--accent-notes)" : "transparent",
            color: on ? "var(--on-accent-notes)" : (e.empty ? "var(--text-tertiary)" : "var(--text-secondary)"),
            font: "inherit", fontSize: e.level <= 2 ? 12.5 : 12,
            fontWeight: e.level === 1 ? 700 : 600,
            fontStyle: e.empty ? "italic" : "normal",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >{e.text}</button>
      </div>
    );
  });

  if (narrow) {
    if (!open) {
      return (
        <button
          type="button"
          data-testid="note-outline-open"
          /* The global help/report control (`HelpReportControl.jsx`) reads this attribute to
             clear whatever else occupies the bottom-right corner (`cornerClearanceFromBottom`,
             B966700) — this is the ONE contract a fixed corner control marks itself with, so
             it does not need to know this button's name and this button does not need to know
             its own bottom offset is ever shared. Without it the two FABs would sit on top of
             each other, exactly at `right:12,bottom:16`, and the corner check caught it. */
          data-canvas-corner="notes-outline"
          title="Show the outline"
          aria-label="Show the outline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleOpen}
          style={{
            position: "fixed", right: 12, bottom: 16, zIndex: 55,
            width: 44, height: 44, borderRadius: RADIUS.control,
            border: "1px solid var(--border-default)", background: "var(--surface-raised)",
            color: "var(--text-secondary)", font: "inherit", fontSize: FONT.control, cursor: "pointer",
          }}
        >☰</button>
      );
    }
    return (
      <>
        {/* A plain click-catcher, not a dimmed scrim (matches QuickOpen's own backdrop) —
            tapping anywhere outside the panel closes it, same as the ✕ inside it.
            ⛔ ABOVE `AppHeader.jsx` (`position: relative; zIndex: 60`) — the drawer runs from
            the very top of the viewport, so anything under 60 renders BEHIND the header
            instead of over it (caught driving a real click: the header's own tab button
            intercepted a tap meant for a heading row underneath it). */}
        <div
          data-testid="note-outline-scrim"
          aria-hidden="true"
          onClick={onToggleOpen}
          style={{ position: "fixed", inset: 0, zIndex: 65, background: "transparent" }}
        />
        <nav
          data-testid="note-outline"
          aria-label="Outline"
          style={{
            position: "fixed", top: 0, bottom: 0, right: 0, zIndex: 66,
            width: "min(78vw, 280px)", overflowY: "auto",
            borderLeft: "1px solid var(--border-default)", background: "var(--surface-raised)",
            padding: "10px 6px 24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px 6px" }}>
            <span style={{ flex: 1, fontSize: FONT.micro, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
              Outline
            </span>
            <button
              type="button"
              data-testid="note-outline-close"
              title="Hide the outline"
              aria-label="Hide the outline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleOpen}
              style={{
                width: 20, height: 20, borderRadius: RADIUS.control, border: "1px solid transparent",
                background: "transparent", color: "var(--text-tertiary)", font: "inherit", fontSize: FONT.control, lineHeight: 1, cursor: "pointer",
              }}
            >✕</button>
          </div>
          {rows}
        </nav>
      </>
    );
  }

  if (!open) {
    return (
      <div style={{ flex: "none", borderLeft: "1px solid var(--border-default)", background: "var(--surface-raised)", padding: "8px 4px" }}>
        <button
          type="button"
          data-testid="note-outline-open"
          title="Show the outline"
          aria-label="Show the outline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleOpen}
          style={{
            width: 24, height: 24, borderRadius: RADIUS.control, border: "1px solid var(--border-default)",
            background: "transparent", color: "var(--text-tertiary)", font: "inherit", fontSize: 12, cursor: "pointer",
          }}
        >☰</button>
      </div>
    );
  }

  return (
    <nav
      data-testid="note-outline"
      aria-label="Outline"
      style={{
        /* ⛔ SHRINKS BEFORE THE PAGE DOES (B421492) — navigation yields to the document. */
        flex: "0 1 auto", width: 208, minWidth: 104, overflowY: "auto",
        borderLeft: "1px solid var(--border-default)", background: "var(--surface-raised)",
        padding: "10px 6px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px 6px" }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          Outline
        </span>
        <button
          type="button"
          data-testid="note-outline-close"
          title="Hide the outline"
          aria-label="Hide the outline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleOpen}
          style={{
            width: 20, height: 20, borderRadius: RADIUS.control, border: "1px solid transparent",
            background: "transparent", color: "var(--text-tertiary)", font: "inherit", fontSize: 12, lineHeight: 1, cursor: "pointer",
          }}
        >✕</button>
      </div>
      {rows}
    </nav>
  );
}
