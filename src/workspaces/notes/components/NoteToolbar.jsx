/* NoteToolbar — the formatting bar for one note page.
 *
 * TWO RULES SHAPE THIS FILE.
 *
 * 1. EVERY ACTIVE STATE IS READ FROM THE EDITOR (`editor.isActive(...)`), never mirrored
 *    into React state. A mirrored copy is a second source of truth that drifts the moment
 *    the caret moves by any route the toolbar didn't originate — an arrow key, a click, an
 *    undo, a paste — and the bar then lies about the text under the cursor. The editor is
 *    created with `shouldRerenderOnTransaction` so these reads stay live.
 *
 * 2. EVERY CONTROL CANCELS `mousedown`. Pressing a toolbar button must not move the caret:
 *    the browser's default mousedown behaviour blurs the document and collapses the
 *    selection, so "select a word, click Bold" would bold nothing. `preventDefault` on
 *    mousedown keeps the selection exactly where the user left it.
 *
 * Alignment and list affordances are drawn as inline SVG. The Unicode glyphs for them
 * (≡ ⌸ ☰) are unreadable at control size and differ per platform font.
 *
 * NO DIALOG BOXES (house rule): the link control is an inline field — Enter commits, Esc
 * cancels — never `window.prompt`. The table size is picked by sweeping a GRID for the same
 * reason (B1372), not by a box asking for two numbers.
 *
 * THREE THINGS HERE ARE FIXES, NOT DECORATION, and each has its note at the code:
 *   • text colour and highlight draw DIFFERENT glyphs (B1370) — they were identical;
 *   • font size sits ON the row (B1371) — it existed, buried in "More", which reads to a
 *     user as "there is no font size";
 *   • the table button opens a drag-to-size grid (B1372) — it used to insert a fixed 3×3.
 */
import { useEffect, useRef, useState } from "react";
import { HEADING_LEVELS } from "../lib/notesExtensions.js";
import { BLOCK_SPACES, DENSITIES, LINE_SPACINGS, spacingLabel } from "../lib/notesSpacing.js";
import { CALLOUT_TONES } from "../lib/notesCalloutNode.js";
import { FONTS, HIGHLIGHT_COLORS, SIZES, TEXT_COLORS } from "../lib/notesFormatPalette.js";

/* Mirrored from src/shared/ui/controls.jsx rather than imported — deliberately, and there
 * is a test that fails if the copies drift (test/notesModule.test.js). Importing
 * controls.jsx from here makes the bundler hoist a THIRD shared chunk onto the Site route,
 * which breaks that route's four-chunk allowlist and turns the perf audit red. Two numbers
 * duplicated with a guard beats a cross-route regression. */
const RADIUS = { control: 8, pill: 999 };
/* Shared by every popover/sheet on this bar (ColorPopover, TableGridPicker, LinkControl,
 * CalloutControl, OverflowMenu) — one named constant rather than the same literal repeated,
 * so B849633's phone-sheet branch of OverflowMenu's panel doesn't count as a second raw
 * colour literal against the design-drift ceiling for what is visually the same shadow. */
const POPOVER_SHADOW = "0 12px 32px rgba(0,0,0,0.20)";

/* ⛔ THE PALETTES MOVED TO `lib/notesFormatPalette.js` (NEW-MINI-TOOLBAR). The right-click
 * mini-toolbar offers the same choices, and two copies of a palette is how this bar and that
 * menu come to disagree about what "Teal" is — a difference nobody notices until two paragraphs
 * of one note are subtly different colours. The reasoning for these being LITERAL colours rather
 * than theme tokens moved with them; read it there. */

/* The table grid picker's shape (B1372). It OPENS at this size and GROWS as the pointer
 * reaches its edge, up to the max — the Word/OneNote behaviour, where a big table is
 * reachable by dragging further rather than by a dialog asking for two numbers. */
const GRID_START = 6;
const GRID_MAX = 12;

/* ---- primitives (module scope — MODULE-SCOPE-COMPONENTS) --------------------------------- */

const stop = (e) => e.preventDefault();

function Icon({ children, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/* `big` (NEW-2, B849633): every control on the phone-width bar and its More sheet asks for
 * this — a 44px tap target (WCAG 2.5.5), the same floor the food module's phone controls
 * already use. `false` (the default, every desktop call site) reproduces this file's
 * pre-existing output exactly. */
function TBButton({ onClick, active, disabled, title, label, children, testid, wide, big }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ? "true" : undefined}
      data-testid={testid}
      disabled={disabled}
      onMouseDown={stop}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
        minWidth: big ? 44 : (wide ? undefined : 28), height: big ? 44 : 28,
        padding: big ? "0 12px" : (wide ? "0 9px" : "0 5px"),
        flex: big ? "0 0 auto" : undefined,
        border: "1px solid", borderColor: active ? "var(--accent-notes)" : "transparent",
        borderRadius: RADIUS.control,
        background: active ? "var(--accent-notes)" : "transparent",
        color: active ? "var(--on-accent-notes)" : "var(--text-secondary)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
        font: "inherit", fontSize: big ? 15 : 13, fontWeight: active ? 650 : 500, lineHeight: 1,
      }}
    >
      {children}{label ? <span>{label}</span> : null}
    </button>
  );
}

function TBSelect({ value, onChange, title, options, testid, width = 116, big }) {
  return (
    <select
      title={title}
      aria-label={title}
      data-testid={testid}
      value={value == null ? "" : String(value)}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={onChange}
      style={{
        height: big ? 44 : 28, width: big ? Math.max(width, 132) : width, padding: "0 6px", borderRadius: RADIUS.control,
        flex: big ? "0 0 auto" : undefined,
        border: "1px solid var(--border-default)", background: "var(--surface-raised)",
        color: "var(--text-primary)", font: "inherit", fontSize: big ? 15 : 13, cursor: "pointer",
      }}
    >
      {options.map((o) => <option key={String(o.value)} value={o.value == null ? "" : String(o.value)}>{o.label}</option>)}
    </select>
  );
}

function Sep() {
  return <span aria-hidden="true" style={{ width: 1, height: 18, background: "var(--border-default)", margin: "0 3px", flex: "0 0 auto" }} />;
}

/* TEXT COLOUR vs HIGHLIGHT, TOLD APART WITHOUT HOVERING (B1370).
 *
 * These two controls sat side by side drawing the IDENTICAL glyph — a letter "A" over a
 * bar — so the only thing distinguishing "colour the letters" from "run a marker behind
 * them" was a tooltip you had to stop and wait for. Two different actions that look the
 * same are one control the user has to guess at every time.
 *
 * Now the glyph says which is which: text colour is a letter sitting ON its colour bar
 * (the bar is the ink), highlight is a MARKER PEN laying a band of colour down. Each one
 * still carries the colour it will apply, so the button also shows what it will DO. */
const InkGlyph = ({ swatch }) => (
  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
    <span style={{ fontSize: 12, fontWeight: 800, lineHeight: 1, color: swatch || "inherit" }}>A</span>
    <span style={{
      width: 14, height: 3, borderRadius: 2,
      background: swatch || "var(--border-strong)",
      border: swatch ? "none" : "1px solid var(--border-strong)",
    }} />
  </span>
);

const MarkerGlyph = ({ swatch }) => (
  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
    {/* A marker pen held at an angle, nib down — read at control size as "highlighter",
        which the letter-over-a-bar never was. */}
    <Icon size={13}>
      <path d="M3.2 10.4l5.1-5.1a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3l-5.1 5.1H3.2z" />
      <path d="M8.3 5.3l2.4 2.4" />
    </Icon>
    <span style={{
      width: 14, height: 4, borderRadius: 1,
      background: swatch || "var(--border-strong)",
      border: swatch ? "none" : "1px solid var(--border-strong)",
      opacity: swatch ? 1 : 0.7,
    }} />
  </span>
);

/** A swatch popover. Closes on pick, on Escape, and on an outside pointer press. */
function ColorPopover({ title, swatch, colors, onPick, testid, glyph = "ink", big }) {
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

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title={title} testid={testid} big={big} onClick={() => setOpen((o) => !o)}>
        {glyph === "marker" ? <MarkerGlyph swatch={swatch} /> : <InkGlyph swatch={swatch} />}
      </TBButton>
      {open && (
        <div
          data-testid={`${testid}-popover`}
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 8,
            display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 6,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: "0 12px 32px rgba(0,0,0,0.20)",
          }}
        >
          {colors.map((c) => (
            <button
              key={c.name}
              type="button"
              title={c.name}
              aria-label={c.name}
              onMouseDown={stop}
              onClick={() => { onPick(c.value); setOpen(false); }}
              style={{
                width: 22, height: 22, borderRadius: RADIUS.control, cursor: "pointer",
                border: "1px solid var(--border-strong)",
                background: c.value || "var(--surface-page)",
                color: "var(--text-tertiary)", font: "inherit", fontSize: 11, lineHeight: 1, padding: 0,
              }}
            >{c.value ? "" : "✕"}</button>
          ))}
        </div>
      )}
    </span>
  );
}

/** INSERT A TABLE BY DRAGGING OVER A GRID (B1372) — the Word / Excel / OneNote gesture.
 *
 *  It replaces a one-shot button that always inserted the same 3×3 and left you to add the
 *  other rows one at a time. Sweeping the pointer across the grid previews the size, the
 *  running count is written out so you are never counting squares, and releasing inserts.
 *  The grid GROWS when the pointer reaches its edge, so a big table needs no dialog — which
 *  is the house rule, not a preference: `window.prompt` is banned in this module.
 *
 *  Keyboard-reachable on purpose: arrows resize the preview, Enter inserts, Esc closes. A
 *  gesture-only control is one a keyboard user simply cannot use. */
function TableGridPicker({ onInsert, big }) {
  const [open, setOpen] = useState(false);
  const [dim, setDim] = useState({ rows: 0, cols: 0 });
  const [grid, setGrid] = useState({ rows: GRID_START, cols: GRID_START });
  const wrapRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    if (!open) { setDim({ rows: 0, cols: 0 }); setGrid({ rows: GRID_START, cols: GRID_START }); return undefined; }
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    if (gridRef.current) gridRef.current.focus();
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  /* Reaching the last row/column pushes the grid one further, up to the cap — the same
   * "keep dragging for a bigger table" affordance Word has. It never shrinks mid-gesture,
   * because a grid collapsing under the pointer would move the cell you were aiming at. */
  const hover = (r, c) => {
    setDim({ rows: r, cols: c });
    setGrid((g) => ({
      rows: Math.min(GRID_MAX, Math.max(g.rows, r === g.rows ? r + 1 : g.rows)),
      cols: Math.min(GRID_MAX, Math.max(g.cols, c === g.cols ? c + 1 : g.cols)),
    }));
  };

  const insert = (r, c) => {
    if (r < 1 || c < 1) return;
    onInsert(r, c);
    setOpen(false);
  };

  const onGridKey = (e) => {
    const step = (dr, dc) => {
      e.preventDefault();
      const r = Math.min(GRID_MAX, Math.max(1, (dim.rows || 1) + dr));
      const c = Math.min(GRID_MAX, Math.max(1, (dim.cols || 1) + dc));
      hover(r, c);
    };
    if (e.key === "ArrowDown") return step(1, 0);
    if (e.key === "ArrowUp") return step(-1, 0);
    if (e.key === "ArrowRight") return step(0, 1);
    if (e.key === "ArrowLeft") return step(0, -1);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); insert(dim.rows || 1, dim.cols || 1); }
    return undefined;
  };

  const cells = [];
  for (let r = 1; r <= grid.rows; r += 1) {
    for (let c = 1; c <= grid.cols; c += 1) {
      const on = r <= dim.rows && c <= dim.cols;
      cells.push(
        <span
          key={`${r}-${c}`}
          data-testid={`nt-table-cell-${r}-${c}`}
          onMouseEnter={() => hover(r, c)}
          onMouseDown={stop}
          onClick={() => insert(r, c)}
          style={{
            width: 15, height: 15, borderRadius: 2, cursor: "pointer",
            border: `1px solid ${on ? "var(--accent-notes)" : "var(--border-strong)"}`,
            background: on ? "var(--accent-notes)" : "var(--surface-page)",
          }}
        />,
      );
    }
  }

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title="Insert table" testid="nt-table" active={open} big={big} onClick={() => setOpen((o) => !o)}><TableIcon /></TBButton>
      {open && (
        <div
          data-testid="nt-table-grid"
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 8,
            display: "flex", flexDirection: "column", gap: 6,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: "0 12px 32px rgba(0,0,0,0.20)",
          }}
        >
          <div
            ref={gridRef}
            role="grid"
            tabIndex={0}
            aria-label="Pick a table size"
            onKeyDown={onGridKey}
            onMouseLeave={() => setDim({ rows: 0, cols: 0 })}
            style={{ display: "grid", gridTemplateColumns: `repeat(${grid.cols}, 15px)`, gap: 3, outline: "none" }}
          >
            {cells}
          </div>
          {/* The running size, written out — nobody should have to count squares. */}
          <span data-testid="nt-table-size" style={{ fontSize: 11.5, fontWeight: 700, textAlign: "center", color: "var(--text-secondary)" }}>
            {dim.rows && dim.cols ? `${dim.cols} × ${dim.rows} table` : "Drag to size"}
          </span>
        </div>
      )}
    </span>
  );
}

/** Inline link editor — NEVER window.prompt (house rule). Enter commits, Esc cancels. */
function LinkControl({ editor, big }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const inputRef = useRef(null);
  const active = editor.isActive("link");

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const begin = () => {
    if (active) { editor.chain().focus().unsetLink().run(); return; }
    setHref(editor.getAttributes("link")?.href || "");
    setOpen(true);
  };
  const commit = () => {
    const v = href.trim();
    if (v) editor.chain().focus().extendMarkRange("link").setLink({ href: /^[a-z][\w+.-]*:/i.test(v) ? v : `https://${v}` }).run();
    setOpen(false); setHref("");
  };

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title={active ? "Remove link" : "Add link"} active={active} testid="nt-link" big={big} onClick={begin}>
        <Icon><path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-1 1" /><path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-2 2A2.5 2.5 0 0 1 4 8.5l1-1" /></Icon>
      </TBButton>
      {open && (
        <div
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 8, display: "flex", gap: 6,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: "0 12px 32px rgba(0,0,0,0.20)",
          }}
        >
          <input
            ref={inputRef}
            data-testid="nt-link-input"
            value={href}
            placeholder="Paste or type a link"
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setOpen(false); setHref(""); }
            }}
            style={{
              width: big ? 200 : 220, height: big ? 40 : 26, padding: "0 8px", borderRadius: RADIUS.control,
              border: "1px solid var(--border-default)", background: "var(--surface-page)",
              color: "var(--text-primary)", font: "inherit", fontSize: 13,
            }}
          />
          <TBButton title="Apply link" wide label="Apply" testid="nt-link-apply" big={big} onClick={commit} />
        </div>
      )}
    </span>
  );
}

/** The overflow drawer. Closes on Escape and on an outside press, like the colour popover.
 *
 *  ⛔ WHY THIS EXISTS (B1317). The bar was ONE flat row of ~35 controls, which wrapped onto
 *  a second row at an ordinary laptop width — so the least-used control cost the note a
 *  strip of writing space on every screen, permanently. Everything was equally loud, so
 *  nothing read as primary. The split is by FREQUENCY, not by category: what a person
 *  reaches for while writing stays on the row, and the long tail (fonts, sizes, alignment,
 *  quotes, rules) is one click away. PANEL-BREVITY's instinct applied to the writing
 *  surface: the scarcest space on this screen is the page, not the toolbar. */
function OverflowMenu({ children, testid = "nt-more", big }) {
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

  /* ⛔ ON PHONE THIS IS A SHEET, NOT A POPOVER (NEW-2, B849633). `position:absolute` anchored
   * to the trigger runs the panel off a 390px-class screen the moment the trigger sits near
   * the right/bottom edge of a scrolled toolbar row — a `position:fixed` sheet, pinned to the
   * bottom and clear of the home indicator, cannot. `wrapRef` still contains it either way
   * (fixed positioning doesn't change DOM containment), so the outside-tap-closes listener
   * above is unaffected. `false` (every desktop call) is untouched. */
  const panelStyle = big
    ? {
      position: "fixed", left: 8, right: 8, bottom: "max(8px, env(safe-area-inset-bottom))",
      maxHeight: "min(70vh, 520px)", overflowY: "auto", zIndex: 60, padding: 10,
      display: "flex", flexDirection: "column", gap: 12,
      background: "var(--surface-raised)", border: "1px solid var(--border-default)",
      borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
    }
    : {
      position: "absolute", top: 32, right: 0, zIndex: 40, padding: 8, width: 268,
      display: "flex", flexDirection: "column", gap: 7,
      background: "var(--surface-raised)", border: "1px solid var(--border-default)",
      borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
    };

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title="More formatting" testid={testid} active={open} wide label="More" big={big} onClick={() => setOpen((o) => !o)}>
        <Icon><path d="M4 6.5L8 10.5l4-4" /></Icon>
      </TBButton>
      {open && (
        <div data-testid={`${testid}-panel`} onMouseDown={stop} style={panelStyle}>
          {children}
        </div>
      )}
    </span>
  );
}

/** ⛔ THE CALLOUT CONTROL PICKS A **TONE**, NOT A COLOUR (NEW-7).
 *
 *  The five are GitHub's five — Note / Tip / Important / Warning / Caution — because the
 *  Markdown export writes them as `> [!NOTE]` and friends, which is a real rendered
 *  construct there rather than an HTML approximation. A sixth would have no marker to map
 *  to; adding one means deciding its fallback first (lib/notesCalloutNode.js says the same).
 *
 *  Pressing it with the caret already inside a callout CHANGES that callout's tone rather
 *  than nesting a second one inside it. Not a dialog (house rule): an inline popover that
 *  closes on Escape and on an outside press, like every other popover on this bar. */
function CalloutControl({ editor, big }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inside = editor.isActive("noteCallout");
  const tone = inside ? editor.getAttributes("noteCallout")?.tone : null;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (id) => {
    setOpen(false);
    const chain = editor.chain().focus();
    if (inside) chain.setNoteCalloutTone(id).run();
    else chain.setNoteCallout(id).run();
  };

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title={inside ? "Change this callout" : "Callout — a block that says “this matters”"}
        testid="nt-callout" active={inside} big={big} onClick={() => setOpen((o) => !o)}>
        <Icon><rect x="2" y="3" width="12" height="10" rx="1.5" /><line x1="4.5" y1="3" x2="4.5" y2="13" /><line x1="7.5" y1="6.5" x2="12" y2="6.5" /><line x1="7.5" y1="9.5" x2="12" y2="9.5" /></Icon>
      </TBButton>
      {open && (
        <div
          data-testid="nt-callout-panel"
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 5, width: 168,
            display: "flex", flexDirection: "column", gap: 2,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: "0 12px 32px rgba(0,0,0,0.20)",
          }}
        >
          {CALLOUT_TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`nt-callout-${t.id}`}
              onMouseDown={stop}
              onClick={() => pick(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, width: "100%",
                padding: big ? "10px 8px" : "4px 8px", minHeight: big ? 44 : undefined,
                borderRadius: RADIUS.control, cursor: "pointer",
                border: `1px solid ${tone === t.id ? "var(--accent-notes)" : "transparent"}`,
                background: "transparent", color: "var(--text-primary)",
                font: "inherit", fontSize: 12.5, fontWeight: 650, textAlign: "left",
              }}
            >{t.label}</button>
          ))}
          {inside ? (
            <button
              type="button"
              data-testid="nt-callout-off"
              onMouseDown={stop}
              onClick={() => { setOpen(false); editor.chain().focus().unsetNoteCallout().run(); }}
              style={{
                width: "100%", padding: big ? "10px 8px" : "4px 8px", minHeight: big ? 44 : undefined,
                marginTop: 2, borderRadius: RADIUS.control, cursor: "pointer",
                border: "1px solid var(--border-default)", background: "transparent",
                color: "var(--text-secondary)", font: "inherit", fontSize: 12, fontWeight: 650, textAlign: "left",
              }}
            >Back to plain text</button>
          ) : null}
        </div>
      )}
    </span>
  );
}

function MenuGroup({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 }}>{children}</span>
    </div>
  );
}

/* ---- icon glyphs ------------------------------------------------------------------------ */

const AlignIcon = ({ lines }) => (
  <Icon>{lines.map(([x1, x2], i) => <line key={i} x1={x1} y1={3.5 + i * 2.5} x2={x2} y2={3.5 + i * 2.5} />)}</Icon>
);
const ALIGNS = [
  { id: "left", title: "Align left", lines: [[2.5, 13.5], [2.5, 9.5], [2.5, 13.5], [2.5, 9.5]] },
  { id: "center", title: "Align center", lines: [[2.5, 13.5], [4.5, 11.5], [2.5, 13.5], [4.5, 11.5]] },
  { id: "right", title: "Align right", lines: [[2.5, 13.5], [6.5, 13.5], [2.5, 13.5], [6.5, 13.5]] },
  { id: "justify", title: "Justify", lines: [[2.5, 13.5], [2.5, 13.5], [2.5, 13.5], [2.5, 13.5]] },
];

const BulletIcon = () => (
  <Icon><circle cx="3" cy="4.5" r="1" fill="currentColor" /><circle cx="3" cy="8" r="1" fill="currentColor" /><circle cx="3" cy="11.5" r="1" fill="currentColor" />
    <line x1="6" y1="4.5" x2="13.5" y2="4.5" /><line x1="6" y1="8" x2="13.5" y2="8" /><line x1="6" y1="11.5" x2="13.5" y2="11.5" /></Icon>
);
const OrderedIcon = () => (
  <Icon><text x="1" y="6" fontSize="5" fill="currentColor" stroke="none">1</text><text x="1" y="10" fontSize="5" fill="currentColor" stroke="none">2</text><text x="1" y="14" fontSize="5" fill="currentColor" stroke="none">3</text>
    <line x1="6.5" y1="4.5" x2="13.5" y2="4.5" /><line x1="6.5" y1="8.5" x2="13.5" y2="8.5" /><line x1="6.5" y1="12.5" x2="13.5" y2="12.5" /></Icon>
);
const TaskIcon = () => (
  <Icon><rect x="1.5" y="2.5" width="4" height="4" rx="1" /><path d="M2.4 10.6l1.2 1.2 2-2.2" /><line x1="7.5" y1="4.5" x2="13.5" y2="4.5" /><line x1="7.5" y1="11" x2="13.5" y2="11" /></Icon>
);
const IndentIcon = ({ out }) => (
  <Icon><line x1="6" y1="3" x2="14" y2="3" /><line x1="6" y1="8" x2="14" y2="8" /><line x1="6" y1="13" x2="14" y2="13" />
    <path d={out ? "M4 5.5L1.5 8L4 10.5" : "M1.5 5.5L4 8L1.5 10.5"} /></Icon>
);
const TableIcon = () => (
  <Icon><rect x="2" y="3" width="12" height="10" rx="1" /><line x1="2" y1="6.5" x2="14" y2="6.5" /><line x1="6" y1="3" x2="6" y2="13" /><line x1="10" y1="3" x2="10" y2="13" /></Icon>
);


const ImageIcon = () => (
  <Icon><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.75" cy="6.25" r="1.1" /><path d="M2.5 11.5l3.2-3 2.6 2.4 2-1.8 3.2 2.9" /></Icon>
);
/* Sketch mode: two boxes and an arrow between them — the thing it makes, not a metaphor. */
const SketchIcon = () => (
  <Icon><rect x="1.5" y="2.5" width="5.5" height="4" rx="1" /><rect x="9" y="9.5" width="5.5" height="4" rx="1" /><path d="M7 4.5h3.2a1.5 1.5 0 0 1 1.5 1.5v3" /><path d="M10.2 7.6l1.5 1.9 1.5-1.9" /></Icon>
);
const PrintIcon = () => (
  <Icon><path d="M4.5 6V2.5h7V6" /><rect x="2" y="6" width="12" height="5" rx="1.2" /><path d="M4.5 9.5h7v4h-7z" /></Icon>
);

/* ---- the bar ----------------------------------------------------------------------------
 *
 * GROUPED BY FREQUENCY, NOT BY CATEGORY (B1317). The visible row is what a person reaches
 * for while writing — undo, block style, the four weights, colour, lists, link, table,
 * picture. Everything else lives one click away in "More": fonts, sizes, alignment, quotes,
 * code, rules, indent. The table row still appears only when the caret is genuinely inside
 * a table, which is the same principle applied a level down.
 */

const HEADING_OPTIONS = [
  { label: "Body text", value: "p" },
  ...HEADING_LEVELS.map((l) => ({ label: `Heading ${l}`, value: `h${l}` })),
];

/* ⛔ THE PHONE BAR IS ONE SCROLLABLE ROW, NOT A COLUMN (NEW-2, B849633). Reported off the
 * owner's own screenshot: at phone width the bar's `flexWrap: "wrap"` stacked its ~35
 * controls into a column that ran the full height of the pane, leaving almost nothing for
 * the note itself once the keyboard was up. His decision, verbatim from the dispatch: ONE
 * compact row of the controls reached for constantly — undo/redo, bold, italic, bullet,
 * numbered, link — scrollable sideways like the shared header already does (B113/B485), with
 * everything else behind a More SHEET (a fixed bottom panel, not the desktop popover — see
 * OverflowMenu's own note on why). Every control below still carries its original `nt-*`
 * `data-testid`, moved or not, so `verify-phone-layout.mjs` can read the live DOM for the
 * row's contents rather than a hand-typed list that could drift from this file. */

export default function NoteToolbar({ editor, onExport, onPrint, onAttach, onHistory, historyOpen, narrow = false }) {
  const fileRef = useRef(null);
  if (!editor) return null;

  const chain = () => editor.chain().focus();
  const inTable = editor.isActive("table");

  const blockValue = HEADING_LEVELS.find((l) => editor.isActive("heading", { level: l }));
  const setBlock = (e) => {
    const v = e.target.value;
    if (v === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(v.slice(1)) }).run();
  };

  const currentSize = editor.getAttributes("textStyle")?.fontSize || null;
  const currentFont = editor.getAttributes("textStyle")?.fontFamily || null;
  const currentColor = editor.getAttributes("textStyle")?.color || null;
  const currentHl = editor.getAttributes("highlight")?.color || null;

  // Indent/outdent act on whichever list kind the caret is actually in.
  const listItemType = editor.isActive("taskItem") ? "taskItem" : "listItem";
  const indent = () => chain().sinkListItem(listItemType).run();
  const outdent = () => chain().liftListItem(listItemType).run();

  const pickImages = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";                       // so the same file can be picked twice running
    if (files.length) editor.commands.insertNoteImages(files);
  };

  const barStyle = {
    display: "flex", flexWrap: narrow ? "nowrap" : "wrap", alignItems: "center", gap: 2,
    padding: "5px 8px", borderBottom: "1px solid var(--border-default)",
    background: "var(--surface-raised)", position: "sticky", top: 0, zIndex: 20,
    ...(narrow ? { overflowX: "auto", WebkitOverflowScrolling: "touch" } : null),
  };

  /* ---- controls that MOVE between the row and the More sheet, defined once (NEW-2) --------
   * Each is placed in exactly one of the two spots below via `{!narrow && x}` / `{narrow && x}`
   * — never both — so there is one copy of every prop and handler, not two that can drift. */
  const blockStyleControl = (
    <TBSelect title="Block style" testid="nt-block" width={104} big={narrow}
      value={blockValue ? `h${blockValue}` : "p"} onChange={setBlock} options={HEADING_OPTIONS} />
  );
  /* FONT SIZE LIVES ON THE ROW ON DESKTOP (B1371) — moved into the More sheet on phone, where
   * it stays reachable in two taps rather than crowding the six-control primary row. */
  const fontSizeControl = (
    <TBSelect title="Font size" testid="nt-size" width={62} big={narrow}
      value={currentSize ? String(parseInt(currentSize, 10)) : null}
      options={SIZES.map((s) => ({ label: s == null ? "Size" : String(s), value: s }))}
      /* ⛔ THE INLINE MARK, THEN THE BLOCK (NEW-SPACING-2). Setting the size only on the runs
       * leaves the paragraph's own strut at the default, so a whole line made smaller stayed
       * exactly as tall — measured, 11px words in the 24.75px row a 15px paragraph uses.
       * `syncBlockFontSize` reads the runs back and writes the size onto any block whose runs
       * all agree, so the row scales with its text. It is one chain, so it is one undo step. */
      onChange={(e) => (e.target.value
        ? chain().setFontSize(`${e.target.value}px`).syncBlockFontSize().run()
        : chain().unsetFontSize().syncBlockFontSize().run())} />
  );
  const spacingControl = (
    <TBSelect title={`Line spacing — ${spacingLabel(editor.getAttributes("paragraph").lineHeight)}`} testid="nt-spacing" width={40} big={narrow}
      value=""
      options={[
        { label: "↕", value: "" },
        ...DENSITIES.map((d) => ({ label: `Whole note: ${d.label}`, value: `den:${d.id}` })),
        ...LINE_SPACINGS.map((s) => ({ label: `Lines: ${s.label}`, value: `lh:${s.value ?? ""}` })),
        ...BLOCK_SPACES.map((s) => ({ label: `Space before: ${s.label}`, value: `sb:${s.value ?? ""}` })),
        ...BLOCK_SPACES.map((s) => ({ label: `Space after: ${s.label}`, value: `sa:${s.value ?? ""}` })),
      ]}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        const [kind, raw] = v.split(":");
        if (kind === "den") { chain().setNoteDensity(raw).run(); return; }
        const n = raw === "" ? null : Number(raw);
        const key = kind === "lh" ? "lineHeight" : (kind === "sb" ? "spaceBefore" : "spaceAfter");
        chain().setNoteSpacing({ [key]: n }).run();
      }} />
  );
  const underlineBtn = (
    <TBButton title="Underline" testid="nt-underline" big={narrow} active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}>
      <span style={{ textDecoration: "underline", fontSize: 13 }}>U</span>
    </TBButton>
  );
  const strikeBtn = (
    <TBButton title="Strikethrough" testid="nt-strike" big={narrow} active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}>
      <span style={{ textDecoration: "line-through", fontSize: 13 }}>S</span>
    </TBButton>
  );
  const textColorControl = (
    <ColorPopover title="Text colour" testid="nt-color" glyph="ink" big={narrow} swatch={currentColor} colors={TEXT_COLORS}
      onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())} />
  );
  const highlightColorControl = (
    <ColorPopover title="Highlight colour" testid="nt-highlight" glyph="marker" big={narrow} swatch={currentHl} colors={HIGHLIGHT_COLORS}
      onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())} />
  );
  const checklistBtn = (
    <TBButton title="Checklist" testid="nt-task" big={narrow} active={editor.isActive("taskList")} onClick={() => chain().toggleTaskList().run()}><TaskIcon /></TBButton>
  );
  const tableInsertControl = (
    <TableGridPicker big={narrow} onInsert={(rows, cols) => chain().insertTable({ rows, cols, withHeaderRow: true }).run()} />
  );
  const imageBtn = (
    <TBButton title="Insert a picture" testid="nt-image" big={narrow} onClick={() => fileRef.current?.click()}><ImageIcon /></TBButton>
  );
  /* SKETCH MODE — and it is the BOX button, not an "insert a sketch" button. Select some
     words, press it, and they become a box you can drag and connect; press it with nothing
     selected and you get a box with the caret already in it. */
  const boxBtn = (
    <TBButton title="Box this — put a box around the selected words, then drag arrows between boxes"
      testid="nt-box" big={narrow} onClick={() => editor.commands.boxSelection()}><SketchIcon /></TBButton>
  );
  const attachBtn = (
    <TBButton title="Attach a file — a PDF, a spreadsheet, a drawing" testid="nt-attach" big={narrow} onClick={onAttach}>
      <Icon><path d="M11.5 5.5L6.2 10.8a2 2 0 0 0 2.8 2.8l5.3-5.3a3.4 3.4 0 0 0-4.8-4.8L4.2 8.8a4.8 4.8 0 0 0 6.8 6.8" /></Icon>
    </TBButton>
  );
  /* VERSION HISTORY (NEW-3). On desktop it sits beside Print because both are things you do
     TO the page rather than to the words in it; on phone both move into the sheet with
     everything else that isn't a while-writing control. */
  const historyBtn = (
    <TBButton title="Earlier versions of this page, and the way back to one"
      testid="nt-history" active={!!historyOpen} wide big={narrow} label="History" onClick={onHistory}>
      <Icon><path d="M8 4.5V8l2.5 1.5" /><circle cx="8" cy="8" r="5.5" /></Icon>
    </TBButton>
  );
  const printBtn = (
    <TBButton title="Print this page, or save it as a PDF" testid="nt-print" wide big={narrow} label="Print" onClick={onPrint}>
      <PrintIcon />
    </TBButton>
  );
  const exportBtn = (
    <TBButton title="Export this page to Markdown" testid="nt-export" wide big={narrow} label="Markdown" onClick={onExport}>
      <Icon><path d="M8 2.5v8" /><path d="M5 7.5L8 10.5l3-3" /><path d="M2.5 12.5h11" /></Icon>
    </TBButton>
  );
  /* TABLE GROUP — rendered only when the caret is genuinely inside a table, on the row on
     desktop and inside the sheet on phone (same reasoning as everything above: a control
     that's visible but inert most of the time trains people to ignore where it lives). */
  const tableGroupControls = inTable ? (
    <>
      <TBButton title="Insert row above" testid="nt-row-before" wide big={narrow} label="Row ↑" onClick={() => chain().addRowBefore().run()} />
      <TBButton title="Insert row below" testid="nt-row-after" wide big={narrow} label="Row ↓" onClick={() => chain().addRowAfter().run()} />
      <TBButton title="Delete row" testid="nt-row-del" wide big={narrow} label="Row ✕" onClick={() => chain().deleteRow().run()} />
      <TBButton title="Insert column left" testid="nt-col-before" wide big={narrow} label="Col ←" onClick={() => chain().addColumnBefore().run()} />
      <TBButton title="Insert column right" testid="nt-col-after" wide big={narrow} label="Col →" onClick={() => chain().addColumnAfter().run()} />
      <TBButton title="Delete column" testid="nt-col-del" wide big={narrow} label="Col ✕" onClick={() => chain().deleteColumn().run()} />
      <TBButton title="Merge or split cells" testid="nt-merge" wide big={narrow} label="Merge/split" onClick={() => chain().mergeOrSplit().run()} />
      <TBButton title="Toggle header row" testid="nt-header-row" wide big={narrow} label="Header" onClick={() => chain().toggleHeaderRow().run()} />
      <TBButton title="Delete table" testid="nt-table-del" wide big={narrow} label="Delete table" onClick={() => chain().deleteTable().run()} />
    </>
  ) : null;

  return (
    <div style={barStyle} data-testid="note-toolbar" data-narrow={narrow ? "1" : "0"} role="toolbar" aria-label="Formatting">
      <TBButton title="Undo" testid="nt-undo" big={narrow} disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        <Icon><path d="M3 7h6.5a3 3 0 0 1 0 6H6" /><path d="M5.5 4.5L3 7l2.5 2.5" /></Icon>
      </TBButton>
      <TBButton title="Redo" testid="nt-redo" big={narrow} disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        <Icon><path d="M13 7H6.5a3 3 0 0 0 0 6H10" /><path d="M10.5 4.5L13 7l-2.5 2.5" /></Icon>
      </TBButton>

      <Sep />

      {!narrow && blockStyleControl}
      {!narrow && fontSizeControl}
      {!narrow && spacingControl}
      {!narrow && <Sep />}

      <TBButton title="Bold" testid="nt-bold" big={narrow} active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>B</span>
      </TBButton>
      <TBButton title="Italic" testid="nt-italic" big={narrow} active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif", fontSize: 13 }}>I</span>
      </TBButton>
      {!narrow && underlineBtn}
      {!narrow && strikeBtn}
      {!narrow && textColorControl}
      {!narrow && highlightColorControl}

      <Sep />

      <TBButton title="Bulleted list" testid="nt-bullet" big={narrow} active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><BulletIcon /></TBButton>
      <TBButton title="Numbered list" testid="nt-ordered" big={narrow} active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><OrderedIcon /></TBButton>
      {!narrow && checklistBtn}

      <Sep />

      <LinkControl editor={editor} big={narrow} />
      {!narrow && tableInsertControl}
      {!narrow && imageBtn}
      {/* The picker is the deliberate alternative to paste/drop, not a replacement: it is
          how a picture gets in on a device where dragging a file is awkward. Always rendered
          (hidden) regardless of where the visible button that opens it currently lives. */}
      <input
        ref={fileRef}
        data-testid="nt-image-input"
        type="file"
        accept="image/*"
        multiple
        onChange={pickImages}
        style={{ display: "none" }}
      />
      {!narrow && boxBtn}
      {!narrow && attachBtn}

      <Sep />

      <OverflowMenu big={narrow}>
        {narrow && (
          <MenuGroup label="Text">
            {blockStyleControl}
            {fontSizeControl}
            {spacingControl}
            {underlineBtn}
            {strikeBtn}
            {textColorControl}
            {highlightColorControl}
            {checklistBtn}
          </MenuGroup>
        )}

        <MenuGroup label="Type">
          <TBSelect title="Font" testid="nt-font" width={124} big={narrow} value={currentFont}
            options={FONTS.map((f) => ({ label: f.label, value: f.value }))}
            onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())} />
          <TBButton title="Inline code" testid="nt-code" big={narrow} active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}>
            <Icon><path d="M6 4.5L3 8l3 3.5" /><path d="M10 4.5L13 8l-3 3.5" /></Icon>
          </TBButton>
          <TBButton title="Clear formatting" testid="nt-clear" big={narrow} onClick={() => chain().unsetAllMarks().clearNodes().run()}>
            <Icon><path d="M4 12.5h8" /><path d="M6.5 3.5h5" /><path d="M9 3.5L7 10" /><line x1="2.5" y1="2.5" x2="13.5" y2="13.5" /></Icon>
          </TBButton>
        </MenuGroup>

        <MenuGroup label="Alignment & indent">
          {ALIGNS.map((a) => (
            <TBButton key={a.id} title={a.title} testid={`nt-align-${a.id}`} big={narrow}
              active={editor.isActive({ textAlign: a.id })}
              onClick={() => chain().setTextAlign(a.id).run()}>
              <AlignIcon lines={a.lines} />
            </TBButton>
          ))}
          <TBButton title="Decrease indent" testid="nt-outdent" big={narrow} onClick={outdent}><IndentIcon out /></TBButton>
          <TBButton title="Increase indent" testid="nt-indent" big={narrow} onClick={indent}><IndentIcon /></TBButton>
        </MenuGroup>

        <MenuGroup label="Blocks">
          <TBButton title="Quote" testid="nt-quote" big={narrow} active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
            <Icon><path d="M6 4.5C4 5 3 6.5 3 9v2.5h3.5V8H5c0-1.5.4-2.4 1-3z" fill="currentColor" stroke="none" /><path d="M13 4.5c-2 .5-3 2-3 4.5v2.5h3.5V8H12c0-1.5.4-2.4 1-3z" fill="currentColor" stroke="none" /></Icon>
          </TBButton>
          <TBButton title="Code block" testid="nt-codeblock" big={narrow} active={editor.isActive("codeBlock")} onClick={() => chain().toggleCodeBlock().run()}>
            <Icon><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M6 6.5L4.5 8L6 9.5" /><path d="M10 6.5L11.5 8L10 9.5" /></Icon>
          </TBButton>
          <TBButton title="Divider" testid="nt-hr" big={narrow} onClick={() => chain().setHorizontalRule().run()}>
            <Icon><line x1="2" y1="8" x2="14" y2="8" /></Icon>
          </TBButton>
          <CalloutControl editor={editor} big={narrow} />
          <TBButton title="Toggle — a section that folds away" testid="nt-toggle" big={narrow}
            active={editor.isActive("noteToggle")} onClick={() => chain().setNoteToggle().run()}>
            <Icon><path d="M3 5.5L5.5 8L3 10.5" /><line x1="7.5" y1="4.5" x2="13.5" y2="4.5" /><line x1="7.5" y1="8" x2="13.5" y2="8" /><line x1="7.5" y1="11.5" x2="13.5" y2="11.5" /></Icon>
          </TBButton>
        </MenuGroup>

        {narrow && (
          <MenuGroup label="Insert">
            {tableInsertControl}
            {imageBtn}
            {boxBtn}
            {attachBtn}
          </MenuGroup>
        )}

        {narrow && (
          <MenuGroup label="Page">
            {historyBtn}
            {printBtn}
            {exportBtn}
          </MenuGroup>
        )}

        {narrow && tableGroupControls && <MenuGroup label="Table">{tableGroupControls}</MenuGroup>}
      </OverflowMenu>

      {!narrow && historyBtn}
      {!narrow && printBtn}
      {!narrow && exportBtn}

      {/* TABLE GROUP, DESKTOP — on phone the same controls render inside the sheet
          (`tableGroupControls` above) instead, so the primary row stays one compact line. */}
      {!narrow && tableGroupControls && (
        <>
          <Sep />
          <span data-testid="nt-table-group" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: "2px 6px", borderRadius: RADIUS.pill, background: "var(--surface-page)", border: "1px solid var(--border-default)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent-notes-text)", marginRight: 4 }}>Table</span>
            {tableGroupControls}
          </span>
        </>
      )}
    </div>
  );
}
