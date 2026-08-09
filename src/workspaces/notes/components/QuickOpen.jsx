/* QuickOpen — jump to any note by name, from anywhere, without touching the rail (NEW-2).
 *
 * ⛔ WHY IT EXISTS BESIDE A SEARCH BOX THAT ALREADY WORKS. The rail's box does SUBSTRING
 * over titles and bodies, and it does it well — but it is a place you have to go, and it
 * matches only what you spell out in full. This is the other half: a keystroke from inside
 * the document, FUZZY over titles (`gpent` → Grand Port / Entitlements), falling through to
 * the SAME full-text index for body hits. Nothing is re-indexed; `quickOpenResults` in
 * lib/notesQuickOpen.js joins the two halves and the store supplies the second unchanged.
 *
 * ⛔ Ctrl/⌘+K, AND IT WAS FREE. AUDIT-FIRST: nothing in this repo bound it — not the
 * toolbar's link control (which is a button opening an inline field), not the editor's
 * keymap, not the shell. So there was no link insertion to break and no reason to reach for
 * Notion's Ctrl+P split. The shortcut is PRINTED on the rail's search box, because a
 * keyboard affordance nobody can discover is one that does not exist (B1371's lesson,
 * applied to a key instead of a button).
 *
 * ⛔ NOT A DIALOG in the sense the house rule forbids — it edits no value and confirms
 * nothing; it is a finder, the one thing a floating palette is right for. It closes on
 * Escape, on an outside press, and on choosing something.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { stepIndex } from "../lib/notesQuickOpen.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

export default function QuickOpen({ open, results = [], query, onQuery, onPick, onClose }) {
  const [index, setIndex] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // A new query is a new list; pointing at row four of the old one is meaningless.
  useEffect(() => { setIndex(0); }, [query, open]);

  /* ⛔ TWO EFFECTS, NOT ONE, AND THE SPLIT IS A BUG FIX (found by the headless harness).
   *
   * Focusing and SELECTING the field belongs to the moment the palette opens — and only to
   * that moment. Bundled in with the outside-press listener it also depended on `onClose`,
   * which the caller creates fresh on every render, so the effect re-ran on EVERY KEYSTROKE
   * and `.select()` selected the text back — making each character replace the last. The
   * field ended up holding one letter and the list answering a query nobody typed. */
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose?.(); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open, onClose]);

  useEffect(() => {
    const box = listRef.current;
    const row = box?.children?.[index];
    if (!box || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [index, results]);

  const rows = useMemo(() => results.slice(0, 18), [results]);

  if (!open) return null;

  const keys = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose?.(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => stepIndex(i, e.key === "ArrowDown" ? 1 : -1, rows.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = rows[Math.min(index, rows.length - 1)];
      if (pick) onPick?.(pick);
    }
  };

  return (
    <div
      data-testid="notes-quick-open-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh",
        background: "transparent", pointerEvents: "none",
      }}
    >
      <div
        ref={boxRef}
        data-testid="notes-quick-open"
        role="dialog"
        aria-label="Go to a note"
        onKeyDown={keys}
        style={{
          pointerEvents: "auto", width: "min(560px, calc(100vw - 32px))",
          maxHeight: "60vh", display: "flex", flexDirection: "column",
          borderRadius: RADIUS.control, border: "1px solid var(--border-strong)",
          background: "var(--surface-raised)", boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          data-testid="notes-quick-open-input"
          value={query}
          placeholder="Go to a note — type part of its name"
          aria-label="Go to a note"
          onChange={(e) => onQuery?.(e.target.value)}
          style={{
            flex: "none", border: "none", borderBottom: "1px solid var(--border-default)",
            background: "transparent", color: "var(--text-primary)", font: "inherit",
            fontSize: 15, fontWeight: 600, padding: "11px 14px", outline: "none",
          }}
        />

        <div ref={listRef} data-testid="notes-quick-open-list" style={{ overflowY: "auto", padding: "4px 0" }}>
          {rows.map((r, i) => (
            <button
              key={`${r.pageId}:${r.where}`}
              type="button"
              data-testid={`notes-quick-open-hit-${r.pageId}`}
              data-active={i === index ? "1" : undefined}
              data-where={r.where}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onPick?.(r)}
              style={{
                display: "flex", flexDirection: "column", gap: 1, width: "100%",
                padding: "6px 14px", border: "none", textAlign: "left", cursor: "pointer",
                background: i === index ? "var(--accent-notes)" : "transparent",
                color: i === index ? "var(--on-accent-notes)" : "var(--text-primary)",
                font: "inherit",
              }}
            >
              <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.pageTitle || "Untitled page"}
                </span>
                {/* The SAME badge the rail's search shows for a body hit, deliberately — one
                    vocabulary for "matched in the text", not two. */}
                {r.where === "body" ? (
                  <span style={{
                    flex: "0 0 auto", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em",
                    padding: "1px 6px", borderRadius: RADIUS.pill,
                    border: `1px solid ${i === index ? "var(--on-accent-notes)" : "var(--border-strong)"}`,
                    color: i === index ? "var(--on-accent-notes)" : "var(--text-tertiary)",
                  }}>IN TEXT</span>
                ) : null}
              </span>
              {(r.trail?.length || r.excerpt) ? (
                <span style={{
                  fontSize: 11.5, fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: i === index ? "var(--on-accent-notes)" : "var(--text-tertiary)",
                  opacity: i === index ? 0.85 : 1,
                }}>{r.excerpt || (r.trail || []).join(" › ")}</span>
              ) : null}
            </button>
          ))}

          {!rows.length ? (
            <p data-testid="notes-quick-open-empty" style={{ margin: 0, padding: "12px 14px", fontSize: 12.5, color: "var(--text-secondary)" }}>
              {query.trim() ? `Nothing matches “${query.trim()}”.` : "Start typing a note’s name."}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
