/* NoteEditorBars — the find bar, zoom pill, page-setup popover and find-and-replace bar, moved verbatim out of NoteEditor.jsx (audit batch L1; module scope, MODULE-SCOPE-COMPONENTS). */
import { EDITOR_CSS } from "./noteEditorCss.js";
import { useEffect, useRef, useState } from "react";
import { isCoarsePointerDevice } from "../lib/notesBlankPaper.js";
import { zoomLabel } from "../lib/notesViewport.js";
import { pageHeightLabel } from "../lib/notesPageHeight.js";
import { PAGE_WIDTH_PRESETS } from "../lib/notesPageWidth.js";
import { RADIUS } from "../lib/notesControls.js";

export function EditorStyles() {
  return <style dangerouslySetInnerHTML={{ __html: EDITOR_CSS }} />;
}

/** The find bar — where the phrase you searched for actually is, and how to step through
 *  it. Shown only while a term is live, so it costs a page with no search nothing. */
export function FindBar({ term, count, index, onStep, onClear }) {
  if (!term) return null;
  return (
    <div
      data-testid="note-find-bar"
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "5px 14px",
        borderBottom: "1px solid var(--border-default)", background: "var(--surface-page)",
        color: "var(--text-secondary)", fontSize: 12, fontWeight: 600,
      }}
    >
      <span data-testid="note-find-count" style={{ flex: 1, minWidth: 0 }}>
        {count ? `“${term}” — ${index + 1} of ${count}` : `“${term}” is not on this page`}
      </span>
      <button type="button" data-testid="note-find-prev" title="Previous match" disabled={!count}
        onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(-1)}
        style={{ height: 22, minWidth: 26, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, cursor: count ? "pointer" : "default", opacity: count ? 1 : 0.45 }}
      >‹</button>
      <button type="button" data-testid="note-find-next" title="Next match" disabled={!count}
        onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(1)}
        style={{ height: 22, minWidth: 26, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, cursor: count ? "pointer" : "default", opacity: count ? 1 : 0.45 }}
      >›</button>
      <button type="button" data-testid="note-find-clear" title="Clear the search (Esc)"
        onMouseDown={(e) => e.preventDefault()} onClick={onClear}
        style={{ height: 22, padding: "0 9px", borderRadius: RADIUS.pill, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
      >Clear</button>
    </div>
  );
}

/* Shared by the three NEW floating/docked panels below — the same shadow the toolbar's own
 * popovers use (NoteToolbar.jsx's `POPOVER_SHADOW`), so a control that floats over the canvas
 * reads as the same kind of surface as one that floats off the toolbar. */
const FLOAT_SHADOW = "0 12px 32px rgba(0,0,0,0.20)";

/** ⛔ NEW-3 — THE ZOOM PILL. Bottom-right of the canvas, floating, [−] [level ▾] [+]. Replaces
 *  the toolbar chip that used to hide itself at 100% (PANEL-BREVITY doesn't apply to a
 *  permanent floating control the way it did to a toolbar slot — see this file's own call
 *  site). The percentage opens a short menu of named levels plus "Fit width", mirroring what
 *  every other drawing surface in this app already offers. */
export function ZoomPill({ pct, onZoomOut, onZoomIn, onPick, onReset, onFitWidth }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const big = isCoarsePointerDevice();            // NEW-6d — a finger-sized target on a phone/tablet
  const btnStyle = {
    width: big ? 44 : 26, height: big ? 44 : 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
    font: "inherit", fontSize: 14, fontWeight: 700, borderRadius: RADIUS.control,
  };
  const LEVELS = [0.5, 0.75, 1, 1.25, 1.5];
  return (
    <span
      ref={wrapRef}
      data-testid="note-zoom-pill"
      /* ⛔ NEW-3 — THE HELP/REPORT FAB SHARES THIS CORNER (`shared/ui/cornerClearance.js`,
         B966700-ish). That control reads `[data-canvas-corner]` and moves ITSELF up to clear
         whatever it finds there — `NoteOutline.jsx`'s own floating toggle already does exactly
         this in this same module ("without it the two FABs would sit on top of each other").
         Omitting this mark is what let the FAB intercept clicks on this pill in the first
         live check. */
      data-canvas-corner="notes-zoom"
      style={{
        position: "absolute", right: 18, bottom: 16, zIndex: 30,
        display: "inline-flex", alignItems: "center", gap: 1, padding: 3,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.pill, boxShadow: FLOAT_SHADOW,
      }}
    >
      <button type="button" data-testid="note-zoom-out" aria-label="Zoom out" onClick={onZoomOut} style={btnStyle}>−</button>
      <button
        type="button"
        data-testid="note-zoom-level"
        aria-label="Zoom level"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...btnStyle, width: "auto", padding: "0 8px", fontSize: 12, fontWeight: 700 }}
      >{zoomLabel(pct)}</button>
      <button type="button" data-testid="note-zoom-in" aria-label="Zoom in" onClick={onZoomIn} style={btnStyle}>+</button>
      {open && (
        <div
          role="menu"
          data-testid="note-zoom-menu"
          style={{
            position: "absolute", right: 0, bottom: big ? 52 : 34, zIndex: 31, padding: 4, minWidth: 120,
            display: "flex", flexDirection: "column", gap: 1,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: FLOAT_SHADOW,
          }}
        >
          {LEVELS.map((z) => (
            <button key={z} type="button" data-testid={`note-zoom-opt-${Math.round(z * 100)}`}
              onClick={() => { setOpen(false); if (z === 1) onReset(); else onPick(z); }}
              style={{ textAlign: "left", padding: "6px 8px", borderRadius: RADIUS.control, border: "none", background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 550, cursor: "pointer" }}
            >{Math.round(z * 100)}%</button>
          ))}
          <button type="button" data-testid="note-zoom-opt-fit-width"
            onClick={() => { setOpen(false); onFitWidth(); }}
            style={{ textAlign: "left", padding: "6px 8px", borderRadius: RADIUS.control, border: "none", background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 550, cursor: "pointer" }}
          >Fit width</button>
        </div>
      )}
    </span>
  );
}

/** ⛔ NEW-2 — PAGE SETUP. The width/height controls the OLD toolbar carried as two separate
 *  "W"/"H" chips, now a single popover reached from the module tab row. Floats over the
 *  canvas (this component's caller is the mat's own relative wrapper), not anchored to the
 *  header button that opened it — the same reasoning the History panel already relies on
 *  (a docked/floating panel, never popover-anchored to a trigger in a different DOM subtree). */
export function PageSetupPopover({ editor, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  if (!editor || editor.isDestroyed) return null;
  const pageWidth = editor.state.doc.attrs?.pageWidth ?? null;
  const pageHeight = editor.state.doc.attrs?.pageHeight ?? null;
  const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: RADIUS.control, cursor: "pointer", border: "none", font: "inherit", fontSize: 12, fontWeight: 550, textAlign: "left", width: "100%" };
  return (
    <div
      ref={ref}
      data-testid="note-page-setup"
      role="dialog"
      aria-label="Page setup"
      style={{
        position: "absolute", top: 12, right: 18, zIndex: 30, width: 220, padding: 10,
        display: "flex", flexDirection: "column", gap: 10,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.control, boxShadow: FLOAT_SHADOW,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Page setup</span>
        <button type="button" data-testid="note-page-setup-close" aria-label="Close" onClick={onClose}
          style={{ border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 3 }}>Width</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {[{ label: "Fit to content", value: "fit" }, ...PAGE_WIDTH_PRESETS.map((p) => ({ label: p.label, value: String(p.px) }))].map((o) => {
            const selected = (pageWidth == null ? "fit" : String(pageWidth)) === o.value;
            return (
              <button key={o.value} type="button" data-testid={`note-page-width-${o.value}`}
                onClick={() => {
                  if (o.value === "fit") editor.commands.setNotePageWidth(null);
                  else if (o.value === "full") editor.commands.setNotePageWidth("full");
                  else editor.commands.setNotePageWidth(Number(o.value));
                }}
                style={{ ...rowStyle, background: selected ? "var(--accent-notes)" : "transparent", color: selected ? "var(--on-accent-notes)" : "var(--text-primary)" }}
              >{o.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 3 }}>Height</div>
        <button type="button" data-testid="note-page-height-reset" disabled={pageHeight == null}
          onClick={() => editor.commands.setNotePageHeight(null)}
          style={{ ...rowStyle, opacity: pageHeight == null ? 0.5 : 1, background: "transparent", color: "var(--text-primary)", cursor: pageHeight == null ? "default" : "pointer" }}
        >{pageHeightLabel(pageHeight)}{pageHeight != null ? " — reset to Fit to content" : ""}</button>
      </div>
    </div>
  );
}

/** ⛔ NEW-2 — FIND AND REPLACE (Ctrl+H). A real replace, not just the sidebar's find-and-jump:
 *  `replaceNoteSearch`/`replaceAllNoteSearch` (lib/notesSearchHighlight.js) commit into the
 *  document, so both are real, undoable edits — Ctrl+Z reverses a Replace All exactly like any
 *  other typed change. Floats over the canvas; closing it clears the search term too, so a
 *  stray highlight doesn't linger once someone shuts this down. */
export function FindReplaceBar({ editor, find, onClose }) {
  const [term, setTerm] = useState(find?.term || "");
  const [replacement, setReplacement] = useState("");
  const findRef = useRef(null);
  /* ⛔ COUNT/INDEX COME FROM THE PARENT'S `find` STATE, NEVER RE-DERIVED HERE. `find` is
   * already kept live by the real source of truth — the `NoteSearchHighlight` extension's own
   * `onMatches` callback (`onSearchMatches` in this file's `noteExtensions(...)` call) — so a
   * second read of plugin state here would be a second copy of the same fact, the exact trap
   * rule 1 at this file's own top warns against for every other toolbar-shaped control. */
  const count = find?.count || 0;
  const index = find?.index || 0;

  useEffect(() => { findRef.current?.focus(); }, []);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setNoteSearch(term);
  }, [editor, term]);
  useEffect(() => () => { if (editor && !editor.isDestroyed) editor.commands.setNoteSearch(""); }, [editor]);

  const step = (d) => editor?.commands.stepNoteSearch(d);
  const replaceOne = () => editor?.commands.replaceNoteSearch(replacement);
  const replaceAll = () => editor?.commands.replaceAllNoteSearch(replacement);

  const inputStyle = {
    height: 26, padding: "0 8px", borderRadius: RADIUS.control, border: "1px solid var(--border-default)",
    background: "var(--surface-page)", color: "var(--text-primary)", font: "inherit", fontSize: 12, width: 150,
  };
  const btnStyle = { height: 26, padding: "0 9px", borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, fontWeight: 700 };
  /* The stylesheet owns the disabled arrow (index.css `button:disabled`); an enabled button still has to ask for the
   * pointer, so it comes from here, only while enabled. */
  const btnFor = (enabled) => ({ ...btnStyle, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.45 });

  return (
    <div
      data-testid="note-find-replace-bar"
      role="dialog"
      aria-label="Find and replace"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      style={{
        flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "6px 14px",
        borderBottom: "1px solid var(--border-default)", background: "var(--surface-page)",
      }}
    >
      <input ref={findRef} data-testid="note-find-input" value={term} placeholder="Find"
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }}
        style={inputStyle} />
      <span data-testid="note-find-replace-count" style={{ fontSize: 12, color: "var(--text-tertiary)", minWidth: 60 }}>
        {term ? (count ? `${index + 1} of ${count}` : "No matches") : ""}
      </span>
      <button type="button" data-testid="note-find-replace-prev" title="Previous match" disabled={!count} onClick={() => step(-1)} style={btnFor(!!count)}>‹</button>
      <button type="button" data-testid="note-find-replace-next" title="Next match" disabled={!count} onClick={() => step(1)} style={btnFor(!!count)}>›</button>
      <input data-testid="note-replace-input" value={replacement} placeholder="Replace"
        onChange={(e) => setReplacement(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } }}
        style={inputStyle} />
      <button type="button" data-testid="note-replace-one" disabled={!count} onClick={replaceOne} style={btnFor(!!count)}>Replace</button>
      <button type="button" data-testid="note-replace-all" disabled={!count} onClick={replaceAll} style={btnFor(!!count)}>Replace all</button>
      <button type="button" data-testid="note-find-replace-close" aria-label="Close find and replace" onClick={onClose}
        style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
    </div>
  );
}
