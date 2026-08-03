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

/* Mirrored from src/shared/ui/controls.jsx rather than imported — deliberately, and there
 * is a test that fails if the copies drift (test/notesModule.test.js). Importing
 * controls.jsx from here makes the bundler hoist a THIRD shared chunk onto the Site route,
 * which breaks that route's four-chunk allowlist and turns the perf audit red. Two numbers
 * duplicated with a guard beats a cross-route regression. */
const RADIUS = { control: 8, pill: 999 };

/* ---- content colours -------------------------------------------------------------------
 * THE ONLY literal colours in the Notes module, and they are CONTENT, not chrome: a text
 * colour the user picks is a value that gets written into their document and must mean the
 * same thing on every device and in every export. Theme tokens would make a note's own text
 * change colour when the app theme flips, which is wrong. Everything else in this file — and
 * everything in Notes.jsx / NotesTree.jsx / NoteEditor.jsx — is a theme token. */
const TEXT_COLORS = [
  { name: "Default", value: null },
  { name: "Black", value: "#1B1E26" }, { name: "Gray", value: "#5B6270" },
  { name: "Red", value: "#C0392B" }, { name: "Orange", value: "#C2410C" },
  { name: "Green", value: "#15803D" }, { name: "Teal", value: "#0E7490" },
  { name: "Blue", value: "#1D4ED8" }, { name: "Purple", value: "#6D28D9" },
];
const HIGHLIGHT_COLORS = [
  { name: "None", value: null },
  { name: "Yellow", value: "#FEF08A" }, { name: "Green", value: "#BBF7D0" },
  { name: "Blue", value: "#BFDBFE" }, { name: "Pink", value: "#FBCFE8" },
  { name: "Orange", value: "#FED7AA" }, { name: "Purple", value: "#DDD6FE" },
];

const FONTS = [
  { label: "Default", value: null }, { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" }, { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Calibri", value: "Calibri, Candara, sans-serif" }, { label: "Courier New", value: "'Courier New', Courier, monospace" },
];
const SIZES = [null, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

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

function TBButton({ onClick, active, disabled, title, label, children, testid, wide }) {
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
        minWidth: wide ? undefined : 28, height: 28, padding: wide ? "0 9px" : "0 5px",
        border: "1px solid", borderColor: active ? "var(--accent-notes)" : "transparent",
        borderRadius: RADIUS.control,
        background: active ? "var(--accent-notes)" : "transparent",
        color: active ? "var(--on-accent-notes)" : "var(--text-secondary)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
        font: "inherit", fontSize: 13, fontWeight: active ? 650 : 500, lineHeight: 1,
      }}
    >
      {children}{label ? <span>{label}</span> : null}
    </button>
  );
}

function TBSelect({ value, onChange, title, options, testid, width = 116 }) {
  return (
    <select
      title={title}
      aria-label={title}
      data-testid={testid}
      value={value == null ? "" : String(value)}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={onChange}
      style={{
        height: 28, width, padding: "0 6px", borderRadius: RADIUS.control,
        border: "1px solid var(--border-default)", background: "var(--surface-raised)",
        color: "var(--text-primary)", font: "inherit", fontSize: 13, cursor: "pointer",
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
function ColorPopover({ title, swatch, colors, onPick, testid, glyph = "ink" }) {
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
      <TBButton title={title} testid={testid} onClick={() => setOpen((o) => !o)}>
        {glyph === "marker" ? <MarkerGlyph swatch={swatch} /> : <InkGlyph swatch={swatch} />}
      </TBButton>
      {open && (
        <div
          data-testid={`${testid}-popover`}
          onMouseDown={stop}
          style={{
            position: "absolute", top: 32, left: 0, zIndex: 40, padding: 8,
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
function TableGridPicker({ onInsert }) {
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
      <TBButton title="Insert table" testid="nt-table" active={open} onClick={() => setOpen((o) => !o)}><TableIcon /></TBButton>
      {open && (
        <div
          data-testid="nt-table-grid"
          onMouseDown={stop}
          style={{
            position: "absolute", top: 32, left: 0, zIndex: 40, padding: 8,
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
function LinkControl({ editor }) {
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
      <TBButton title={active ? "Remove link" : "Add link"} active={active} testid="nt-link" onClick={begin}>
        <Icon><path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-1 1" /><path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-2 2A2.5 2.5 0 0 1 4 8.5l1-1" /></Icon>
      </TBButton>
      {open && (
        <div
          onMouseDown={stop}
          style={{
            position: "absolute", top: 32, left: 0, zIndex: 40, padding: 8, display: "flex", gap: 6,
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
              width: 220, height: 26, padding: "0 8px", borderRadius: RADIUS.control,
              border: "1px solid var(--border-default)", background: "var(--surface-page)",
              color: "var(--text-primary)", font: "inherit", fontSize: 13,
            }}
          />
          <TBButton title="Apply link" wide label="Apply" testid="nt-link-apply" onClick={commit} />
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
function OverflowMenu({ children, testid = "nt-more" }) {
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
      <TBButton title="More formatting" testid={testid} active={open} wide label="More" onClick={() => setOpen((o) => !o)}>
        <Icon><path d="M4 6.5L8 10.5l4-4" /></Icon>
      </TBButton>
      {open && (
        <div
          data-testid={`${testid}-panel`}
          onMouseDown={stop}
          style={{
            position: "absolute", top: 32, right: 0, zIndex: 40, padding: 8, width: 268,
            display: "flex", flexDirection: "column", gap: 7,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: "0 12px 32px rgba(0,0,0,0.20)",
          }}
        >
          {children}
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

export default function NoteToolbar({ editor, onExport, onPrint }) {
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
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2,
    padding: "5px 8px", borderBottom: "1px solid var(--border-default)",
    background: "var(--surface-raised)", position: "sticky", top: 0, zIndex: 20,
  };

  return (
    <div style={barStyle} data-testid="note-toolbar" role="toolbar" aria-label="Formatting">
      <TBButton title="Undo" testid="nt-undo" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        <Icon><path d="M3 7h6.5a3 3 0 0 1 0 6H6" /><path d="M5.5 4.5L3 7l2.5 2.5" /></Icon>
      </TBButton>
      <TBButton title="Redo" testid="nt-redo" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        <Icon><path d="M13 7H6.5a3 3 0 0 0 0 6H10" /><path d="M10.5 4.5L13 7l-2.5 2.5" /></Icon>
      </TBButton>

      <Sep />

      <TBSelect title="Block style" testid="nt-block" width={104}
        value={blockValue ? `h${blockValue}` : "p"} onChange={setBlock} options={HEADING_OPTIONS} />

      {/* FONT SIZE LIVES ON THE ROW (B1371). It was built with the module and worked, but it
          was inside "More" — and a control nobody can find is one that does not exist: the
          owner's report was simply "it doesn't seem like there's an option to change font
          size". Changing size is a while-writing action, which is exactly what B1317 says
          belongs on the row. Moved, not added: it is gone from the overflow drawer, so the
          control count is unchanged. */}
      <TBSelect title="Font size" testid="nt-size" width={72}
        value={currentSize ? String(parseInt(currentSize, 10)) : null}
        options={SIZES.map((s) => ({ label: s == null ? "Size" : String(s), value: s }))}
        onChange={(e) => (e.target.value ? chain().setFontSize(`${e.target.value}px`).run() : chain().unsetFontSize().run())} />

      <Sep />

      <TBButton title="Bold" testid="nt-bold" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>B</span>
      </TBButton>
      <TBButton title="Italic" testid="nt-italic" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif", fontSize: 13 }}>I</span>
      </TBButton>
      <TBButton title="Underline" testid="nt-underline" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}>
        <span style={{ textDecoration: "underline", fontSize: 13 }}>U</span>
      </TBButton>
      <TBButton title="Strikethrough" testid="nt-strike" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}>
        <span style={{ textDecoration: "line-through", fontSize: 13 }}>S</span>
      </TBButton>

      <ColorPopover title="Text colour" testid="nt-color" glyph="ink" swatch={currentColor} colors={TEXT_COLORS}
        onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())} />
      <ColorPopover title="Highlight colour" testid="nt-highlight" glyph="marker" swatch={currentHl} colors={HIGHLIGHT_COLORS}
        onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())} />

      <Sep />

      <TBButton title="Bulleted list" testid="nt-bullet" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><BulletIcon /></TBButton>
      <TBButton title="Numbered list" testid="nt-ordered" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><OrderedIcon /></TBButton>
      <TBButton title="Checklist" testid="nt-task" active={editor.isActive("taskList")} onClick={() => chain().toggleTaskList().run()}><TaskIcon /></TBButton>

      <Sep />

      <LinkControl editor={editor} />
      <TableGridPicker onInsert={(rows, cols) => chain().insertTable({ rows, cols, withHeaderRow: true }).run()} />
      <TBButton title="Insert a picture" testid="nt-image" onClick={() => fileRef.current?.click()}><ImageIcon /></TBButton>
      {/* The picker is the deliberate alternative to paste/drop, not a replacement: it is
          how a picture gets in on a device where dragging a file is awkward. */}
      <input
        ref={fileRef}
        data-testid="nt-image-input"
        type="file"
        accept="image/*"
        multiple
        onChange={pickImages}
        style={{ display: "none" }}
      />
      {/* SKETCH MODE. It sits beside the picture rather than in "More" because it is the
          same kind of act — putting a non-text thing on the page — and because a control
          nobody can find is one that does not exist (B1371). */}
      <TBButton title="Insert a sketch — type an outline, get boxes and arrows"
        testid="nt-sketch" onClick={() => editor.commands.insertNoteSketch()}><SketchIcon /></TBButton>

      <Sep />

      <OverflowMenu>
        <MenuGroup label="Type">
          <TBSelect title="Font" testid="nt-font" width={124} value={currentFont}
            options={FONTS.map((f) => ({ label: f.label, value: f.value }))}
            onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())} />
          <TBButton title="Inline code" testid="nt-code" active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}>
            <Icon><path d="M6 4.5L3 8l3 3.5" /><path d="M10 4.5L13 8l-3 3.5" /></Icon>
          </TBButton>
          <TBButton title="Clear formatting" testid="nt-clear" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
            <Icon><path d="M4 12.5h8" /><path d="M6.5 3.5h5" /><path d="M9 3.5L7 10" /><line x1="2.5" y1="2.5" x2="13.5" y2="13.5" /></Icon>
          </TBButton>
        </MenuGroup>

        <MenuGroup label="Alignment & indent">
          {ALIGNS.map((a) => (
            <TBButton key={a.id} title={a.title} testid={`nt-align-${a.id}`}
              active={editor.isActive({ textAlign: a.id })}
              onClick={() => chain().setTextAlign(a.id).run()}>
              <AlignIcon lines={a.lines} />
            </TBButton>
          ))}
          <TBButton title="Decrease indent" testid="nt-outdent" onClick={outdent}><IndentIcon out /></TBButton>
          <TBButton title="Increase indent" testid="nt-indent" onClick={indent}><IndentIcon /></TBButton>
        </MenuGroup>

        <MenuGroup label="Blocks">
          <TBButton title="Quote" testid="nt-quote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
            <Icon><path d="M6 4.5C4 5 3 6.5 3 9v2.5h3.5V8H5c0-1.5.4-2.4 1-3z" fill="currentColor" stroke="none" /><path d="M13 4.5c-2 .5-3 2-3 4.5v2.5h3.5V8H12c0-1.5.4-2.4 1-3z" fill="currentColor" stroke="none" /></Icon>
          </TBButton>
          <TBButton title="Code block" testid="nt-codeblock" active={editor.isActive("codeBlock")} onClick={() => chain().toggleCodeBlock().run()}>
            <Icon><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M6 6.5L4.5 8L6 9.5" /><path d="M10 6.5L11.5 8L10 9.5" /></Icon>
          </TBButton>
          <TBButton title="Divider" testid="nt-hr" onClick={() => chain().setHorizontalRule().run()}>
            <Icon><line x1="2" y1="8" x2="14" y2="8" /></Icon>
          </TBButton>
        </MenuGroup>
      </OverflowMenu>

      <TBButton title="Print this page, or save it as a PDF" testid="nt-print" wide label="Print" onClick={onPrint}>
        <PrintIcon />
      </TBButton>
      <TBButton title="Export this page to Markdown" testid="nt-export" wide label="Markdown" onClick={onExport}>
        <Icon><path d="M8 2.5v8" /><path d="M5 7.5L8 10.5l3-3" /><path d="M2.5 12.5h11" /></Icon>
      </TBButton>

      {/* TABLE GROUP — rendered only when the caret is genuinely inside a table. Table
          controls that are always visible but inert most of the time train people to
          ignore the row they live on. */}
      {inTable && (
        <>
          <Sep />
          <span data-testid="nt-table-group" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: "2px 6px", borderRadius: RADIUS.pill, background: "var(--surface-page)", border: "1px solid var(--border-default)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent-notes-text)", marginRight: 4 }}>Table</span>
            <TBButton title="Insert row above" testid="nt-row-before" wide label="Row ↑" onClick={() => chain().addRowBefore().run()} />
            <TBButton title="Insert row below" testid="nt-row-after" wide label="Row ↓" onClick={() => chain().addRowAfter().run()} />
            <TBButton title="Delete row" testid="nt-row-del" wide label="Row ✕" onClick={() => chain().deleteRow().run()} />
            <TBButton title="Insert column left" testid="nt-col-before" wide label="Col ←" onClick={() => chain().addColumnBefore().run()} />
            <TBButton title="Insert column right" testid="nt-col-after" wide label="Col →" onClick={() => chain().addColumnAfter().run()} />
            <TBButton title="Delete column" testid="nt-col-del" wide label="Col ✕" onClick={() => chain().deleteColumn().run()} />
            <TBButton title="Merge or split cells" testid="nt-merge" wide label="Merge/split" onClick={() => chain().mergeOrSplit().run()} />
            <TBButton title="Toggle header row" testid="nt-header-row" wide label="Header" onClick={() => chain().toggleHeaderRow().run()} />
            <TBButton title="Delete table" testid="nt-table-del" wide label="Delete table" onClick={() => chain().deleteTable().run()} />
          </span>
        </>
      )}
    </div>
  );
}
