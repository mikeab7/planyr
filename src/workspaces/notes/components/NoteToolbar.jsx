/* NoteToolbar — the formatting bar for one note page.
 *
 * ⛔ REBUILT AS ONE ROW, TEXT CONTROLS ONLY (NEW-1..NEW-9, owner-approved mockup "Notes Toolbar
 * Redesign", 2026-09-24). The bar used to be a flat, frequency-grouped row with a trailing
 * "More" drawer holding everything that didn't fit (fonts, sizes, alignment, page geometry,
 * zoom, history, print, export). That drawer is GONE — every one of those either moved to the
 * module tab row (NEW-2: Find/Page setup/History/Export ▾, wired in Notes.jsx's `AppHeader`
 * `toolbarContent`), floats on the canvas (NEW-3: zoom), or is simply on the row now because the
 * row no longer wraps (font/size/style/spacing, all four now lead it, Word's own order). This
 * file is ONLY text-formatting controls, in the exact order the mockup specifies.
 *
 * TWO RULES CARRY OVER UNCHANGED FROM THE OLD BAR.
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
 * ⛔ NEW-7 — TOOLTIPS ARE A CUSTOM FLOATING LABEL, NOT THE NATIVE `title=` ATTRIBUTE. The
 * reported bug ("Attach a file" tooltip clipped along its bottom edge) is fixed at the ROOT —
 * `useHoverTooltip`/`Tip` below — rather than chased ancestor by ancestor: `position: fixed`,
 * computed from the trigger's own `getBoundingClientRect()` at the moment it opens, so it can
 * never be clipped by any scrolling/overflow ancestor and flips above the button on its own
 * when there isn't room below. `TBButton` and `FormatMenu`'s trigger both use it, which is
 * where nearly every control on this bar gets its tooltip from — a handful of call sites, not
 * forty.
 *
 * ⛔ NEW-6 — A TOOLBAR ACTION COMMITS AN ARMED BLOCK-PLACEMENT FIRST. Double-clicking blank
 * canvas arms a caret but creates nothing (NoteEditor.jsx's `pendingPlace` — see its own header,
 * "a press arms a caret, it does not create anything"); only a real keystroke or paste commits
 * it into a box. A toolbar click is neither, and because every button already cancels
 * `mousedown` (rule 2 above) the editor's DOM focus never blurs, so the arm survives — and
 * `chain().focus()` then resolves to whatever the document's LAST REAL selection was, not the
 * still-uncommitted point, silently formatting the wrong place while the arm sits there waiting
 * for the first keystroke. Measured live: double-click, press "Insert numbered list," type five
 * items — the list forms around a phantom trailing paragraph and the five typed items land as
 * plain, unlisted text in a brand-new box the button never touched. `onBeforeAction` (a thin
 * wrapper around `commitPendingPlace()`) is called in MOUSEDOWN CAPTURE on the bar's own root —
 * before any individual button's own `stop` runs — so an armed point becomes a real, empty,
 * focused box first, and the button's own command then lands exactly where the caret is drawn.
 * It is a no-op whenever nothing is armed (`commitPendingPlace` already guards that), so every
 * other click on this bar is unaffected.
 *
 * ⛔ NEW-9 — THE ROW NEVER WRAPS, AT ANY WIDTH. Measured rather than guessed: `compact` is
 * driven by a `ResizeObserver` on the bar's own rendered width against `COMPACT_BREAKPOINT_PX`,
 * not a hard-coded window/media query — the number that matters is how much room the EDITOR
 * PANE actually gives this row, not the browser window (a docked History/Outline panel eats
 * into it identically). Below the breakpoint: the three alignment buttons collapse into one
 * dropdown showing the current alignment, and Link/Table/Image/Attach fold into the "+" Insert
 * menu, leaving only "+" — never both at once and never a third stage; Bold/Italic/Underline,
 * the font/size chips and the list buttons are never touched by this. A PHONE is simply the
 * far end of the same measurement (its available width is always under the breakpoint), so
 * `narrow` no longer selects a different LAYOUT — only bigger tap targets (`big`, 44px WCAG
 * 2.5.5 floor) and the pinned "‹ Notes" back control. There is no second, bottom-sheet UI any
 * more; anything the compact fold still can't fit rides the bar's own `overflowX: auto`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HEADING_LEVELS } from "../lib/notesExtensions.js";
import {
  SPACE_AFTER_DEFAULT, SPACE_BEFORE_DEFAULT, SPACING_LINE_OPTIONS, SPACING_PRESETS, fontSizePx,
} from "../lib/notesSpacing.js";
import { CALLOUT_TONES } from "../lib/notesCalloutNode.js";
import { DEFAULT_SIZE, FONTS, HIGHLIGHT_COLORS, SIZE_MAX, SIZE_MIN, SIZES, TEXT_COLORS } from "../lib/notesFormatPalette.js";
import {
  MIXED, formatDisplayValue, selectionAlignments, selectionBlockShapes, selectionFontFamilies,
  selectionFontSizes, selectionLineHeights, selectionListKinds, selectionMarkAttrs,
  selectionMarkPresence, togglePressed,
} from "../lib/notesMixedSelection.js";
import { familyKey, firstFamily, fontDisplayLabel, matchFontOption } from "../lib/notesFontFamily.js";
import { defaultFontLabel, resolvedColor, resolvedColorsAgree } from "../lib/notesResolvedValue.js";

/* Mirrored from src/shared/ui/controls.jsx rather than imported — deliberately, and there
 * is a test that fails if the copies drift (test/notesModule.test.js). Importing
 * controls.jsx from here makes the bundler hoist a THIRD shared chunk onto the Site route,
 * which breaks that route's four-chunk allowlist and turns the perf audit red. Two numbers
 * duplicated with a guard beats a cross-route regression. */
const RADIUS = { control: 8, pill: 999 };
/* Shared by every popover/sheet on this bar (ColorPopover, TableGridPicker, LinkControl,
 * CalloutControl, SizeMenu, SpacingPopover, InsertFlyout) — one named constant rather than
 * the same literal repeated. */
const POPOVER_SHADOW = "0 12px 32px rgba(0,0,0,0.20)";
/* Min gap a clamped popover keeps from the window's own right edge (B1344627). */
const POPOVER_EDGE_MARGIN = 8;
/* NEW-9 — see this file's own top-of-file note. Measured against the row's actual content: at
 * this width every group in NEW-1's list fits on one line with room to spare; below it the two
 * fold steps buy back exactly the room the mockup's own narrow-window screenshots show. */
const COMPACT_BREAKPOINT_PX = 1000;

/* ⛔ NEW-4 — THE PALETTES MOVED TO `lib/notesFormatPalette.js` (NEW-MINI-TOOLBAR). The right-click
 * mini-toolbar offers the same choices, and two copies of a palette is how this bar and that
 * menu come to disagree about what "Teal" is — a difference nobody notices until two paragraphs
 * of one note are subtly different colours. The reasoning for these being LITERAL colours rather
 * than theme tokens moved with them; read it there. */
const DEFAULT_TEXT_SWATCH = "var(--text-primary)";
const DEFAULT_HIGHLIGHT_SWATCH = HIGHLIGHT_COLORS.find((c) => c.value)?.value || null;

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

/* ═══ NEW-7 — THE SHARED TOOLTIP, used by TBButton and FormatMenu's own trigger (between them,
 * nearly every control on this bar). `position: fixed`, positioned from the trigger's own
 * `getBoundingClientRect()` the instant it opens — never inherited from an ancestor's layout,
 * so no ancestor's `overflow` can ever clip it, which is the actual fix for the reported bug
 * (a clipping ancestor was suspected, never confirmed — this makes the question moot). Flips
 * above the trigger when there isn't `TIP_HEIGHT_GUESS` of room below; the guess only decides
 * WHICH side to render on; the label itself sizes to its own content either way. ═══ */
const TIP_GAP = 8;
const TIP_HEIGHT_GUESS = 40;

function useHoverTooltip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const above = r.bottom + TIP_GAP + TIP_HEIGHT_GUESS > window.innerHeight;
    setTip({
      left: Math.min(Math.max(r.left + r.width / 2, 60), window.innerWidth - 60),
      y: above ? window.innerHeight - r.top + TIP_GAP : r.bottom + TIP_GAP,
      above,
    });
  };
  const hide = () => setTip(null);
  return { ref, tip, show, hide };
}

function Tip({ tip, text }) {
  if (!tip || !text) return null;
  return (
    <span
      role="tooltip"
      aria-hidden="true"
      style={{
        position: "fixed", left: tip.left, transform: "translateX(-50%)",
        [tip.above ? "bottom" : "top"]: tip.y,
        zIndex: 300, maxWidth: 240, padding: "5px 9px", borderRadius: RADIUS.control,
        background: "var(--text-primary)", color: "var(--surface-page)",
        fontSize: 12, fontWeight: 600, lineHeight: 1.35, textAlign: "center",
        boxShadow: POPOVER_SHADOW, pointerEvents: "none", whiteSpace: "normal",
      }}
    >
      {text}
      <span style={{
        position: "absolute", left: "50%", width: 7, height: 7, marginLeft: -3.5,
        background: "var(--text-primary)", transform: "rotate(45deg)",
        [tip.above ? "bottom" : "top"]: -3.5,
      }} />
    </span>
  );
}

/* ⛔ ONE SHARED CLAMP HOOK, NOT EIGHT COPIES (B1344627's own mechanism, carried over from the
 * pre-redesign bar). Every popover on this row (FormatMenu, ColorPopover, TableGridPicker,
 * LinkControl, CalloutControl, SizeMenu, SpacingPopover, InsertMenu) opens `left: 0` against
 * its OWN trigger, which is flush against the viewport's right edge wherever the trigger sits
 * near the end of the row — the Insert Table picker's own report was 18 of its 36 size cells
 * sitting past `innerWidth`. Measured LIVE (`ResizeObserver` on the popover itself, not a
 * one-shot measurement at open time — the table grid's own width GROWS while dragging, so a
 * stale reading would already be wrong before a drag reached a wider column count) and nudged
 * left by exactly the overflow. This is the SOURCE of the toolbar's `useState` count staying
 * sane: one hook, called from eight places, is one line in the count this file's own test
 * (`test/notesModule.test.js`) takes, not eight. */
function usePopoverClampLeft(open) {
  const popRef = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) { setShift(0); return undefined; }
    const measure = () => {
      const pop = popRef.current;
      const wrap = pop?.parentElement;
      if (!pop || !wrap) return;
      const wrapLeft = wrap.getBoundingClientRect().left;
      const need = Math.max(0, wrapLeft + pop.offsetWidth - (window.innerWidth - POPOVER_EDGE_MARGIN));
      setShift(need);
    };
    measure();
    const pop = popRef.current;
    const ro = pop && typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro && pop) ro.observe(pop);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [open]);
  return { popRef, clampStyle: shift ? { left: -shift } : undefined };
}

/* `big` (B849633): every control on a narrow (phone-width) bar asks for this — a 44px tap
 * target (WCAG 2.5.5). `false` (the default, every desktop call site) reproduces the
 * pre-existing output exactly.
 *
 * ⛔ A TOGGLE HAS THREE STATES, AND `undefined` WAS BEING USED FOR ONE OF THEM. `pressed` is
 * the honest three-state answer ("true" / "false" / "mixed" — see lib/notesMixedSelection.js's
 * `togglePressed`) and it drives BOTH the accessible state and the paint. `active` stays for
 * the handful of buttons that are not toggles at all and merely want the accent treatment; a
 * button that is neither still emits no `aria-pressed`, which is correct — Undo is not a
 * toggle. The MIXED paint is an accent OUTLINE with no fill, so "some of this is bold" cannot
 * be misread as either "all of it is" or "none of it is". */
function TBButton({ onClick, active, pressed, disabled, title, label, children, testid, wide, big }) {
  const mixed = pressed === "mixed";
  const on = pressed === "true" || (pressed === undefined && !!active);
  const tt = useHoverTooltip();
  const name = mixed ? `${title} — mixed` : title;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={tt.ref}
        type="button"
        aria-label={name}
        aria-pressed={pressed !== undefined ? pressed : (active ? "true" : undefined)}
        data-testid={testid}
        disabled={disabled}
        onMouseDown={stop}
        onMouseEnter={tt.show}
        onMouseLeave={tt.hide}
        onFocus={tt.show}
        onBlur={tt.hide}
        onClick={onClick}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
          minWidth: big ? 44 : (wide ? undefined : 28), height: big ? 44 : 28,
          padding: big ? "0 12px" : (wide ? "0 9px" : "0 5px"),
          flex: big ? "0 0 auto" : undefined,
          border: "1px solid", borderColor: (on || mixed) ? "var(--accent-notes)" : "transparent",
          borderRadius: RADIUS.control,
          background: on ? "var(--accent-notes)" : "transparent",
          color: on ? "var(--on-accent-notes)" : (mixed ? "var(--accent-notes-text)" : "var(--text-secondary)"),
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "default" : "pointer",
          font: "inherit", fontSize: big ? 15 : 13, fontWeight: (on || mixed) ? 650 : 500, lineHeight: 1,
        }}
      >
        {children}{label ? <span>{label}</span> : null}
      </button>
      {!disabled && tt.tip ? <Tip tip={tt.tip} text={name} /> : null}
    </span>
  );
}

/** A LISTBOX POPOVER, not a native `<select>` — the fix for B1139216's "dead click" (a native
 *  `<select>`'s `change` event does not fire when the option picked is already the one
 *  selected). A `<button onClick>` fires on every press, full stop — the only shape this
 *  repo's own harnesses can drive and prove headless too (a native select's real popup cannot
 *  be opened and clicked in headless Chromium).
 *
 *  `iconTrigger` (NEW-1): the paragraph-style control is an ICON dropdown (a pilcrow, no word
 *  on the bar at all) rather than the wide "STYLE Body text" chip the old bar used — when set,
 *  the trigger renders just the icon + a small chevron, sized like `TBButton`, and `displayLabel`
 *  no longer needs to fit inside a visible box (the popover's own rows still show full text). */
function FormatMenu({ title, testid, value, mixed, options, onPick, big, width = 116, displayLabel, prefix, iconTrigger, disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);
  const tt = useHoverTooltip();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const current = mixed ? null : options.find((o) => o.value === value);
  const label = mixed ? "" : (displayLabel != null ? displayLabel : (current ? current.label : ""));
  const name = mixed ? `${title} — mixed` : title;

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={tt.ref}
        type="button"
        aria-label={name}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testid}
        disabled={disabled}
        onMouseDown={stop}
        onMouseEnter={tt.show}
        onMouseLeave={tt.hide}
        onFocus={tt.show}
        onBlur={tt.hide}
        onClick={() => setOpen((o) => !o)}
        style={iconTrigger ? {
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 1,
          minWidth: big ? 44 : 28, height: big ? 44 : 28, padding: big ? "0 8px" : "0 3px",
          flex: big ? "0 0 auto" : undefined,
          border: "1px solid transparent", borderRadius: RADIUS.control,
          background: "transparent", color: "var(--text-secondary)",
          opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer",
        } : {
          display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 4,
          height: big ? 44 : 28, width: big ? Math.max(width, 132) : width, padding: "0 6px 0 8px",
          flex: big ? "0 0 auto" : undefined,
          border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
          background: "var(--surface-raised)", color: "var(--text-primary)",
          opacity: disabled ? 0.4 : 1,
          font: "inherit", fontSize: big ? 15 : 13, cursor: disabled ? "default" : "pointer",
        }}
      >
        {iconTrigger ? (
          <>{iconTrigger}<Icon size={9}><path d="M4 6.5L8 10.5l4-4" /></Icon></>
        ) : (
          <>
            {/* `prefix` is a standing caption that names WHAT KIND of thing the box holds, so two
                adjacent dropdowns cannot be mistaken for each other. It is not a value and never
                changes with the selection. */}
            {prefix ? (
              <span aria-hidden="true" style={{
                flex: "0 0 auto", fontSize: big ? 11 : 9.5, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "var(--text-tertiary)", marginRight: 4,
              }}>{prefix}</span>
            ) : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", flex: "1 1 auto" }}>{label}</span>
            <Icon size={11}><path d="M4 6.5L8 10.5l4-4" /></Icon>
          </>
        )}
      </button>
      {!disabled && tt.tip && !open ? <Tip tip={tt.tip} text={name} /> : null}
      {open && (
        <div
          ref={popRef}
          data-testid={`${testid}-menu`}
          role="listbox"
          aria-label={title}
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 4,
            minWidth: big ? 160 : width, maxHeight: 280, overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 1,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
          }}
        >
          {options.map((o) => {
            const selected = !mixed && o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`${testid}-opt-${o.value == null ? "default" : o.value}`}
                onMouseDown={stop}
                onClick={() => { onPick(o.value); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
                  padding: big ? "10px 10px" : "5px 8px", minHeight: big ? 44 : undefined,
                  borderRadius: RADIUS.control, cursor: "pointer", border: "none",
                  background: selected ? "var(--accent-notes)" : "transparent",
                  color: selected ? "var(--on-accent-notes)" : "var(--text-primary)",
                  font: "inherit", fontSize: big ? 15 : 12.5, fontWeight: selected ? 650 : 500,
                }}
              >{o.label}</button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function Sep() {
  return <span aria-hidden="true" style={{ width: 1, height: 18, background: "var(--border-default)", margin: "0 3px", flex: "0 0 auto" }} />;
}

/* TEXT COLOUR vs HIGHLIGHT, TOLD APART WITHOUT HOVERING (B1370). Text colour is a letter
 * sitting ON its colour bar (the bar is the ink), highlight is a MARKER PEN laying a band of
 * colour down. Each one still carries the colour it will apply. */
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
    <Icon size={15}>
      <g transform="rotate(35 8 8)">
        <rect x="6" y="1.3" width="4" height="6.2" rx="0.9" />
        <line x1="6" y1="7.5" x2="10" y2="7.5" />
        <path d="M6.3 7.5L9.7 7.5L8.7 11.6L7.3 11.6Z" fill="currentColor" stroke="none" />
      </g>
    </Icon>
    <span style={{
      width: 14, height: 4, borderRadius: 1,
      background: swatch || "var(--border-strong)",
      border: swatch ? "none" : "1px solid var(--border-strong)",
      opacity: swatch ? 1 : 0.7,
    }} />
  </span>
);

/** A swatch popover. Closes on pick, on Escape, and on an outside pointer press. NEW-1: the
 *  trigger now carries its own tiny chevron beside the glyph ("icon + tiny chevron, opens
 *  palette"), which it did not before — the glyph alone did not say "this opens something". */
function ColorPopover({ title, swatch, colors, onPick, testid, glyph = "ink", big, mixed, disabled }) {
  const name = mixed ? `${title} — mixed` : title;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);
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
      <TBButton title={name} testid={testid} big={big} pressed={undefined} disabled={disabled}
        onClick={() => setOpen((o) => !o)}>
        {glyph === "marker" ? <MarkerGlyph swatch={mixed ? null : swatch} /> : <InkGlyph swatch={mixed ? null : swatch} />}
        <Icon size={8}><path d="M4 6.5L8 10.5l4-4" /></Icon>
      </TBButton>
      {open && (
        <div
          ref={popRef}
          data-testid={`${testid}-popover`}
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 8,
            display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 6,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
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
                color: "var(--text-tertiary)", font: "inherit", fontSize: 10.5, lineHeight: 1, padding: 0,
              }}
            >{c.value ? "" : "✕"}</button>
          ))}
        </div>
      )}
    </span>
  );
}

/** INSERT A TABLE BY DRAGGING OVER A GRID (B1372) — the Word / Excel / OneNote gesture. */
function TableGridPicker({ onInsert, big }) {
  const [open, setOpen] = useState(false);
  const [dim, setDim] = useState({ rows: 0, cols: 0 });
  const [grid, setGrid] = useState({ rows: GRID_START, cols: GRID_START });
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);

  useEffect(() => {
    if (!open) { setDim({ rows: 0, cols: 0 }); setGrid({ rows: GRID_START, cols: GRID_START }); return undefined; }
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    if (gridRef.current) gridRef.current.focus();
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

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
          ref={popRef}
          data-testid="nt-table-grid"
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 8,
            display: "flex", flexDirection: "column", gap: 6,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
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
          <span data-testid="nt-table-size" style={{ fontSize: 12, fontWeight: 700, textAlign: "center", color: "var(--text-secondary)" }}>
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
  const wrapRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);

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
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title={active ? "Remove link" : "Add link"} active={active} testid="nt-link" big={big} onClick={begin}>
        <Icon><path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-1 1" /><path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-2 2A2.5 2.5 0 0 1 4 8.5l1-1" /></Icon>
      </TBButton>
      {open && (
        <div
          ref={popRef}
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 8, display: "flex", gap: 6,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
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

/** ⛔ THE CALLOUT CONTROL PICKS A TONE, NOT A COLOUR. The five are GitHub's five — Note / Tip /
 *  Important / Warning / Caution — because the Markdown export writes them as `> [!NOTE]` and
 *  friends. Pressing it with the caret already inside a callout CHANGES that callout's tone
 *  rather than nesting a second one inside it. */
function CalloutControl({ editor, big }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);
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
          ref={popRef}
          data-testid="nt-callout-panel"
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 5, width: 168,
            display: "flex", flexDirection: "column", gap: 2,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
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
                font: "inherit", fontSize: 12, fontWeight: 650, textAlign: "left",
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

/* ---- icon glyphs ------------------------------------------------------------------------ */

const AlignIcon = ({ lines }) => (
  <Icon>{lines.map(([x1, x2], i) => <line key={i} x1={x1} y1={3.5 + i * 2.5} x2={x2} y2={3.5 + i * 2.5} />)}</Icon>
);
const ALIGNS = [
  { id: "left", title: "Align left", lines: [[2.5, 13.5], [2.5, 9.5], [2.5, 13.5], [2.5, 9.5]] },
  { id: "center", title: "Align center", lines: [[2.5, 13.5], [4.5, 11.5], [2.5, 13.5], [4.5, 11.5]] },
  { id: "right", title: "Align right", lines: [[2.5, 13.5], [6.5, 13.5], [2.5, 13.5], [6.5, 13.5]] },
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
const SpacingIcon = () => (
  <Icon><line x1="3" y1="3.5" x2="13" y2="3.5" /><line x1="3" y1="8" x2="13" y2="8" /><line x1="3" y1="12.5" x2="13" y2="12.5" /></Icon>
);
const TableIcon = () => (
  <Icon><rect x="2" y="3" width="12" height="10" rx="1" /><line x1="2" y1="6.5" x2="14" y2="6.5" /><line x1="6" y1="3" x2="6" y2="13" /><line x1="10" y1="3" x2="10" y2="13" /></Icon>
);
const ImageIcon = () => (
  <Icon><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.75" cy="6.25" r="1.1" /><path d="M2.5 11.5l3.2-3 2.6 2.4 2-1.8 3.2 2.9" /></Icon>
);
/* Connect two boxes: two boxes and an arrow between them — the thing it makes, not a metaphor. */
const ArrowConnectIcon = () => (
  <Icon><rect x="0.5" y="5.2" width="5.4" height="5.6" rx="1.2" /><rect x="10.1" y="5.2" width="5.4" height="5.6" rx="1.2" /><path d="M6.3 8H9.5M7.5 6.1L9.5 8L7.5 9.9" /></Icon>
);
const PlusIcon = () => (<Icon><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></Icon>);
const PilcrowIcon = () => (<Icon><path d="M6.5 3h5.5" /><path d="M12 3v10" /><path d="M8.5 3a2.75 2.75 0 0 0 0 5.5H9.5" /><path d="M8.5 8.5V13" /></Icon>);

const SupText = () => <span style={{ fontSize: 12, fontWeight: 700 }}>X<span style={{ fontSize: 10, verticalAlign: "super" }}>2</span></span>;
const SubText = () => <span style={{ fontSize: 12, fontWeight: 700 }}>X<span style={{ fontSize: 10, verticalAlign: "sub" }}>2</span></span>;

/* ---- NEW-4: the size control — a typed stepper (4–400) plus a preset ladder ------------- */

function SizeMenu({ testid, value, mixed, displayLabel, onPick, big }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const wrapRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);

  useEffect(() => { if (open) setText(value != null ? String(value) : ""); }, [open, value]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  /* ⛔ VALIDATE ON BLUR/ENTER, CLAMP, REJECT NON-NUMBERS (NEW-4). A non-numeric value simply
   * reverts to the last real one — never applies NaN, never leaves the field silently wrong. */
  const commitTyped = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n)) onPick(Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)));
    setText(value != null ? String(value) : "");
  };
  const step = (delta) => {
    const base = Number.isFinite(Number(text)) ? Number(text) : (value ?? DEFAULT_SIZE);
    const n = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(base) + delta));
    setText(String(n));
    onPick(n);
  };

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label="Font size"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testid}
        onMouseDown={stop}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 4,
          height: big ? 44 : 28, width: big ? 76 : 56, padding: "0 4px 0 8px",
          flex: big ? "0 0 auto" : undefined,
          border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
          background: "var(--surface-raised)", color: "var(--text-primary)",
          font: "inherit", fontSize: big ? 15 : 13, cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", flex: "1 1 auto" }}>
          {mixed ? "" : displayLabel}
        </span>
        <Icon size={11}><path d="M4 6.5L8 10.5l4-4" /></Icon>
      </button>
      {open && (
        <div
          ref={popRef}
          data-testid={`${testid}-menu`}
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 8, width: 176,
            display: "flex", flexDirection: "column", gap: 8,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" aria-label="Decrease size" onMouseDown={stop} onClick={() => step(-1)}
              style={{ width: 26, height: 26, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontWeight: 700 }}>−</button>
            <input
              data-testid={`${testid}-input`}
              value={text}
              inputMode="numeric"
              onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={commitTyped}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitTyped(); }
                if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
              }}
              style={{
                flex: 1, minWidth: 0, height: 26, textAlign: "center", borderRadius: RADIUS.control,
                border: "1px solid var(--border-default)", background: "var(--surface-page)",
                color: "var(--text-primary)", font: "inherit", fontSize: 13,
              }}
            />
            <button type="button" aria-label="Increase size" onMouseDown={stop} onClick={() => step(1)}
              style={{ width: 26, height: 26, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontWeight: 700 }}>+</button>
          </div>
          <span style={{ fontSize: 10.5, color: "var(--text-tertiary)", textAlign: "center" }}>Type any size from {SIZE_MIN} to {SIZE_MAX}</span>
          <div style={{ height: 1, background: "var(--border-default)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 220, overflowY: "auto" }}>
            {SIZES.map((s) => {
              const selected = !mixed && s === value;
              return (
                <button
                  key={s}
                  type="button"
                  data-testid={`${testid}-opt-${s}`}
                  onMouseDown={stop}
                  onClick={() => { onPick(s); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                    padding: "5px 8px", borderRadius: RADIUS.control, cursor: "pointer", border: "none",
                    background: selected ? "var(--accent-notes)" : "transparent",
                    color: selected ? "var(--on-accent-notes)" : "var(--text-primary)",
                    font: "inherit", fontSize: 12, fontWeight: selected ? 650 : 500,
                  }}
                >
                  <span>{s}</span>
                  {s === DEFAULT_SIZE ? (
                    <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.75 }}>Default</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

/* ---- NEW-4: the spacing popover — line spacing, before/after steppers, presets ---------- */

function Stepper({ testid, value, onChange, big }) {
  const set = (n) => onChange(Math.max(0, Math.min(400, n)));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button type="button" aria-label="Decrease" onMouseDown={stop} onClick={() => set(value - 2)}
        style={{ width: 22, height: 22, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontWeight: 700 }}>−</button>
      <input
        data-testid={testid}
        value={value}
        inputMode="numeric"
        onChange={(e) => { const n = Number(e.target.value.replace(/[^0-9]/g, "")); set(Number.isFinite(n) ? n : 0); }}
        style={{ width: 40, height: 22, textAlign: "center", borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", font: "inherit", fontSize: 12 }}
      />
      <button type="button" aria-label="Increase" onMouseDown={stop} onClick={() => set(value + 2)}
        style={{ width: 22, height: 22, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontWeight: 700 }}>+</button>
    </span>
  );
}

function SpacingPopover({ lineHeight, spaceBefore, spaceAfter, onPick, onApplyWholePage, onReset, big, disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const before = spaceBefore ?? SPACE_BEFORE_DEFAULT;
  const after = spaceAfter ?? SPACE_AFTER_DEFAULT;
  const lh = lineHeight ?? SPACING_LINE_OPTIONS.find((o) => o.name === "Default")?.value;

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title="Line and paragraph spacing" testid="nt-spacing" active={open} big={big} disabled={disabled}
        onClick={() => setOpen((o) => !o)}>
        <SpacingIcon /><Icon size={8}><path d="M4 6.5L8 10.5l4-4" /></Icon>
      </TBButton>
      {open && (
        <div
          ref={popRef}
          data-testid="nt-spacing-panel"
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 10, width: 236,
            display: "flex", flexDirection: "column", gap: 10,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 5 }}>Line spacing</div>
            <div style={{ display: "flex", gap: 3 }}>
              {SPACING_LINE_OPTIONS.map((o) => {
                const selected = lh === o.value;
                return (
                  <button
                    key={o.id}
                    type="button"
                    data-testid={`nt-spacing-line-${o.id}`}
                    title={o.name}
                    onMouseDown={stop}
                    onClick={() => onPick({ lineHeight: o.value })}
                    style={{
                      flex: 1, padding: "5px 2px", borderRadius: RADIUS.control, cursor: "pointer",
                      border: `1px solid ${selected ? "var(--accent-notes)" : "var(--border-default)"}`,
                      background: selected ? "var(--accent-notes)" : "var(--surface-page)",
                      color: selected ? "var(--on-accent-notes)" : "var(--text-primary)",
                      font: "inherit", fontSize: 12, fontWeight: 650,
                    }}
                  >{o.value.toFixed(o.value % 1 ? 2 : 1)}</button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 5 }}>Space between paragraphs</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>Before</span>
                <Stepper testid="nt-spacing-before" value={before} big={big} onChange={(n) => onPick({ spaceBefore: n || null })} />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>After</span>
                <Stepper testid="nt-spacing-after" value={after} big={big} onChange={(n) => onPick({ spaceAfter: n || null })} />
              </span>
            </div>
          </div>
          <div style={{ height: 1, background: "var(--border-default)" }} />
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 5 }}>Presets</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {SPACING_PRESETS.map((p) => {
                const selected = lh === p.lineHeight && after === p.spaceAfter;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`nt-spacing-preset-${p.id}`}
                    onMouseDown={stop}
                    onClick={() => onPick({ lineHeight: p.lineHeight, spaceAfter: p.spaceAfter })}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                      padding: "6px 8px", borderRadius: RADIUS.control, cursor: "pointer",
                      border: `1px solid ${selected ? "var(--accent-notes)" : "transparent"}`,
                      background: selected ? "var(--accent-notes)" : "transparent",
                      color: selected ? "var(--on-accent-notes)" : "var(--text-primary)",
                      font: "inherit", fontSize: 12, fontWeight: 650, textAlign: "left",
                    }}
                  >
                    <span>{selected ? "✓ " : ""}{p.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.8 }}>{p.lineHeight.toFixed(p.lineHeight % 1 ? 2 : 1)} · {p.spaceAfter} after</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 2 }}>
            <button type="button" data-testid="nt-spacing-whole-page" onMouseDown={stop} onClick={onApplyWholePage}
              style={{ border: "none", background: "none", padding: 0, font: "inherit", fontSize: 12, fontWeight: 650, color: "var(--accent-notes-text)", cursor: "pointer", textDecoration: "underline" }}>
              Apply to whole page
            </button>
            <button type="button" data-testid="nt-spacing-reset" onMouseDown={stop} onClick={onReset}
              style={{ border: "none", background: "none", padding: 0, font: "inherit", fontSize: 12, fontWeight: 650, color: "var(--text-tertiary)", cursor: "pointer", textDecoration: "underline" }}>
              Reset
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/* ---- NEW-9: the compact folds — one alignment dropdown, one "+" insert flyout ----------- */

function AlignMenu({ value, mixed, onPick, big, disabled }) {
  const current = ALIGNS.find((a) => a.id === value) || ALIGNS[0];
  return (
    <FormatMenu
      title="Alignment" testid="nt-align-menu" big={big} width={120} disabled={disabled}
      value={mixed ? "" : value} mixed={mixed}
      iconTrigger={<AlignIcon lines={current.lines} />}
      options={ALIGNS.map((a) => ({
        label: <span style={{ display: "flex", alignItems: "center", gap: 6 }}><AlignIcon lines={a.lines} />{a.title}</span>,
        value: a.id,
      }))}
      onPick={onPick}
    />
  );
}

/* ---- the bar ------------------------------------------------------------------------------ */

const HEADING_OPTIONS = [
  { label: "Body text", value: "p" },
  ...HEADING_LEVELS.map((l) => ({ label: `Heading ${l}`, value: `h${l}` })),
];
const TITLE_OPTIONS = [{ label: "Title", value: "title" }];

export default function NoteToolbar({
  editor, onAttach, narrow = false, onBack,
  /* ⛔ NEW-6 — see this file's own top-of-file note. */
  onBeforeAction,
  /* ⛔ NEW-5 — whether DOM focus is currently in the page title `<input>` (a sibling of this
     editor, outside its document — NoteEditor.jsx owns the focus tracking and hands the bar
     just the one boolean it needs) and the title's own default size when nothing is set yet. */
  titleActive = false, titleDefaultSize = null,
  arrowMode = false, onToggleArrow,
}) {
  const fileRef = useRef(null);
  const rootRef = useRef(null);

  /* ⛔ NEW-9 — measured against the bar's own rendered width, never the window.
   *
   * ⛔ `editor` IS A REAL DEPENDENCY, NOT AN OVERSIGHT — this component returns `null` (below)
   * on every render until Tiptap's `useEditor` resolves, so on a component's very FIRST mount
   * `rootRef.current` is still null the instant this effect body runs. An empty `[]` deps array
   * means the effect NEVER RUNS AGAIN once that first, do-nothing pass is done — the ResizeObserver
   * is never attached at all, and `compact` sits permanently at its `false` default no matter how
   * narrow the bar actually renders. Measured live: 756px of real rendered width, a 1000px
   * breakpoint, `data-compact` stuck at "0". Re-running this effect once `editor` flips from
   * null to a real instance (the same render that first returns real DOM instead of `null`)
   * is what lets it find the node at all. */
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const check = () => setCompact(el.offsetWidth < COMPACT_BREAKPOINT_PX);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor]);

  /* ⛔ WHAT AN UNSTYLED RUN IS ACTUALLY RENDERED IN. "Default" is not a font, and a run with no
   * font mark is drawn in the note's own typeface, which only the BROWSER knows — read off the
   * real element at the caret rather than hard-coded. IN A LAYOUT EFFECT, AND ONLY ON A REAL
   * CHANGE: reading `getComputedStyle` during render would measure DOM the current transaction
   * has not committed yet (FOREGROUND-OR-VOID's trap in miniature). */
  const [resolvedDefaults, setResolvedDefaults] = useState({ family: null, ink: null, size: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let family = null;
    let ink = null;
    let size = null;
    try {
      const { node, offset } = editor.view.domAtPos(editor.state.selection.from);
      const el = node.nodeType === 1 ? (node.childNodes[offset] || node) : node.parentElement;
      const target = el && el.nodeType === 1 ? el : (el && el.parentElement);
      if (target) {
        const cs = getComputedStyle(target);
        family = firstFamily(cs.fontFamily);
        size = Math.round(parseFloat(cs.fontSize)) || null;
        ink = getComputedStyle(editor.view.dom).color || null;
      }
    } catch { /* a torn-down view, or a position the DOM has not caught up to — keep the last read */ }
    if (family || ink || size) {
      setResolvedDefaults((prev) => {
        const next = { family: family || prev.family, ink: ink || prev.ink, size: size || prev.size };
        return (next.family === prev.family && next.ink === prev.ink && next.size === prev.size) ? prev : next;
      });
    }
  });

  if (!editor) return null;

  const defaultFamily = resolvedDefaults.family;
  const defaultSize = resolvedDefaults.size;
  const DEFAULT_TEXT_INK = resolvedDefaults.ink;

  const chain = () => editor.chain().focus();
  const inTable = !titleActive && editor.isActive("table");

  const { selection } = editor.state;
  const doc = editor.state.doc;
  const { from, to, empty: selEmpty } = selection;
  const rangeOf = (read) => (selEmpty ? [] : read());

  const titleStyle = doc.attrs?.titleStyle || {};
  const setTitleStyle = (patch) => editor.commands.setNoteTitleStyle(patch);

  /* ═══ BLOCK STYLE — "Title" while the title has focus, otherwise the ordinary Body/Heading
   * picker (NEW-5). ═══ */
  const blockCaretValue = HEADING_LEVELS.find((l) => editor.isActive("heading", { level: l }));
  const blockDisplay = titleActive ? "title" : formatDisplayValue({
    selectionEmpty: selection.empty,
    caretValue: blockCaretValue ? `h${blockCaretValue}` : "p",
    rangeValues: selection.empty ? [] : selectionBlockShapes(doc, selection.from, selection.to),
  });
  const blockMixed = blockDisplay === MIXED;
  const setBlock = (v) => {
    if (titleActive) return;
    if (v === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(v.slice(1)) }).run();
  };

  /* ═══ SIZE — the title's own `titleStyle.fontSize` while focus is there, else the ordinary
   * (mixed-selection-aware) editor read (NEW-4/NEW-5). ═══ */
  const sizeDisplay = titleActive ? (titleStyle.fontSize ?? null) : formatDisplayValue({
    selectionEmpty: selection.empty,
    caretValue: fontSizePx(editor.getAttributes("textStyle")?.fontSize || null),
    rangeValues: selection.empty ? [] : selectionFontSizes(doc, selection.from, selection.to).map(fontSizePx),
  });
  const sizeMixed = !titleActive && sizeDisplay === MIXED;
  const currentSizeNum = titleActive
    ? (titleStyle.fontSize != null ? Math.round(titleStyle.fontSize) : (titleDefaultSize ?? null))
    : (!sizeMixed && sizeDisplay ? Math.round(sizeDisplay) : null);
  const sizeFallback = titleActive ? titleDefaultSize : defaultSize;
  const sizeLabel = sizeMixed ? "" : (currentSizeNum != null ? String(currentSizeNum) : String(sizeFallback ?? DEFAULT_SIZE));
  const pickSize = (n) => {
    if (titleActive) { setTitleStyle({ fontSize: n }); return; }
    if (n == null) { chain().unsetFontSize().syncBlockFontSize().run(); return; }
    chain().setFontSize(`${n}px`).syncBlockFontSize().run();
  };

  /* ═══ LINE SPACING (NEW-4) ═══ */
  const spacingCaretValue = selection.$from.parent.attrs?.lineHeight ?? null;
  const spacingDisplay = formatDisplayValue({
    selectionEmpty: selection.empty,
    caretValue: spacingCaretValue,
    rangeValues: selection.empty ? [] : selectionLineHeights(doc, selection.from, selection.to),
  });
  const spacingResolved = spacingDisplay === MIXED ? null : spacingDisplay;
  const spaceBeforeCaret = selection.$from.parent.attrs?.spaceBefore ?? null;
  const spaceAfterCaret = selection.$from.parent.attrs?.spaceAfter ?? null;
  const pickSpacing = (patch) => chain().setNoteSpacing(patch).run();
  const applySpacingWholePage = () => chain().setNoteSpacingWholeDoc({ lineHeight: spacingResolved, spaceAfter: spaceAfterCaret }).run();
  const resetSpacing = () => chain().setNoteSpacing({ lineHeight: null, spaceBefore: null, spaceAfter: null }).run();

  /* ═══ EVERY CONTROL REPORTS THE SELECTION, OR REPORTS NOTHING ═══ */
  const caretFamily = editor.getAttributes("textStyle")?.fontFamily || null;
  const rawFamilies = selEmpty ? [caretFamily] : selectionFontFamilies(doc, from, to);
  const familyDisplay = formatDisplayValue({
    selectionEmpty: selEmpty,
    caretValue: familyKey(caretFamily),
    rangeValues: rangeOf(() => rawFamilies.map(familyKey)),
  });
  const fontMixed = familyDisplay === MIXED;
  const currentFont = fontMixed ? null : (rawFamilies.find((f) => familyKey(f) === familyDisplay) ?? null);
  const currentFontOption = matchFontOption(currentFont, FONTS);
  const paletteOptions = FONTS.map((f) => (f.value == null
    ? { ...f, label: defaultFontLabel(defaultFamily) }
    : f));
  const fontOptions = currentFont && !currentFontOption
    ? [...paletteOptions, { label: fontDisplayLabel(currentFont, FONTS), value: currentFont }]
    : paletteOptions;
  const fontLabel = fontMixed ? "" : (currentFont ? fontDisplayLabel(currentFont, FONTS) : defaultFontLabel(defaultFamily));

  const currentColorRaw = titleActive ? (titleStyle.color || null) : resolvedColor(editor.getAttributes("textStyle")?.color);
  const colorDisplay = titleActive ? currentColorRaw : formatDisplayValue({
    selectionEmpty: selEmpty,
    caretValue: currentColorRaw ?? resolvedColor(DEFAULT_TEXT_INK),
    rangeValues: rangeOf(() => resolvedColorsAgree(
      selectionMarkAttrs(doc, from, to, "textStyle", "color"), DEFAULT_TEXT_INK)),
  });
  const colorMixed = !titleActive && colorDisplay === MIXED;
  const rawColor = titleActive ? (titleStyle.color || null) : (editor.getAttributes("textStyle")?.color || null);
  const currentColor = colorMixed || !resolvedColor(rawColor) ? null : rawColor;

  const hlDisplay = titleActive ? (titleStyle.highlight || null) : formatDisplayValue({
    selectionEmpty: selEmpty,
    caretValue: resolvedColor(editor.getAttributes("highlight")?.color),
    rangeValues: rangeOf(() => resolvedColorsAgree(
      selectionMarkAttrs(doc, from, to, "highlight", "color"))),
  });
  const hlMixed = !titleActive && hlDisplay === MIXED;
  const rawHl = titleActive ? (titleStyle.highlight || null) : (editor.getAttributes("highlight")?.color || null);
  const currentHl = hlMixed || !resolvedColor(rawHl) ? null : rawHl;

  const markPressed = (name) => togglePressed({
    selectionEmpty: selEmpty,
    caretValue: editor.isActive(name),
    rangeValues: rangeOf(() => selectionMarkPresence(doc, from, to, name)),
  });
  const boldPressed = markPressed("bold");
  const italicPressed = markPressed("italic");
  const underlinePressed = markPressed("underline");
  const strikePressed = markPressed("strike");
  const supPressed = titleActive ? (titleStyle.sup ? "true" : "false") : markPressed("superscript");
  const subPressed = titleActive ? (titleStyle.sub ? "true" : "false") : markPressed("subscript");

  const listKinds = rangeOf(() => selectionListKinds(doc, from, to));
  const listPressed = (kind) => togglePressed({
    selectionEmpty: selEmpty,
    caretValue: editor.isActive(kind),
    rangeValues: listKinds.map((k) => k === kind),
  });
  const alignValues = rangeOf(() => selectionAlignments(doc, from, to));
  const alignDisplay = formatDisplayValue({
    selectionEmpty: selEmpty,
    caretValue: ALIGNS.map((a) => a.id).find((id) => id !== "left" && editor.isActive({ textAlign: id })) ?? null,
    rangeValues: alignValues,
  });
  const alignMixed = alignDisplay === MIXED;
  const alignPressed = (id) => (alignMixed ? "mixed" : String((alignDisplay ?? "left") === id));

  const listItemType = editor.isActive("taskItem") ? "taskItem" : "listItem";
  const indent = () => chain().sinkListItem(listItemType).run() || chain().indentListItem().run();
  const outdent = () => chain().outdentListItem().run() || chain().liftListItem(listItemType).run();

  const pickImages = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) editor.commands.insertNoteImages(files);
  };

  const barStyle = {
    display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 2,
    padding: "5px 8px", borderBottom: "1px solid var(--border-default)",
    background: "var(--surface-raised)", position: "sticky", top: 0, zIndex: 20,
    overflowX: "auto", WebkitOverflowScrolling: "touch",
  };

  const disabledWrap = (node) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, opacity: titleActive ? 0.35 : 1, pointerEvents: titleActive ? "none" : "auto" }}>
      {node}
    </span>
  );

  const backControl = narrow && onBack ? (
    <span
      data-testid="notes-toolbar-back-pinned"
      style={{
        position: "sticky", left: 0, zIndex: 2, flex: "0 0 auto",
        display: "inline-flex", alignItems: "center", background: "var(--surface-raised)",
      }}
    >
      <button
        type="button"
        data-testid="notes-mobile-back"
        onClick={onBack}
        aria-label="Back to the notes list"
        style={{
          flex: "0 0 auto", minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", gap: 4,
          border: "none", background: "transparent", color: "var(--accent-notes-text)",
          font: "inherit", fontSize: 14, fontWeight: 650, cursor: "pointer", padding: "0 10px 0 4px",
        }}
      >‹ Notes</button>
      <Sep />
    </span>
  ) : null;

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
    <div
      ref={rootRef}
      style={barStyle}
      data-testid="note-toolbar"
      data-narrow={narrow ? "1" : "0"}
      data-compact={compact ? "1" : "0"}
      role="toolbar"
      aria-label="Formatting"
      /* ⛔ NEW-6 — see this file's own top-of-file note. Capture, so it runs before any
         individual button's own `stop` (mousedown preventDefault). */
      onMouseDownCapture={() => onBeforeAction?.()}
    >
      {backControl}

      <TBButton title="Undo" testid="nt-undo" big={narrow} disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        <Icon><path d="M3 7h6.5a3 3 0 0 1 0 6H6" /><path d="M5.5 4.5L3 7l2.5 2.5" /></Icon>
      </TBButton>
      <TBButton title="Redo" testid="nt-redo" big={narrow} disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        <Icon><path d="M13 7H6.5a3 3 0 0 0 0 6H10" /><path d="M10.5 4.5L13 7l-2.5 2.5" /></Icon>
      </TBButton>

      <Sep />

      <FormatMenu title="Paragraph style" testid="nt-block" big={narrow}
        value={blockDisplay} mixed={blockMixed}
        iconTrigger={<PilcrowIcon />}
        onPick={setBlock} options={titleActive ? TITLE_OPTIONS : HEADING_OPTIONS} />

      <FormatMenu title="Font" testid="nt-font" width={92} big={narrow} disabled={titleActive}
        value={currentFontOption ? currentFontOption.value : currentFont}
        mixed={fontMixed}
        displayLabel={fontLabel}
        options={fontOptions.map((f) => ({ label: f.label, value: f.value }))}
        onPick={(v) => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run())} />

      <SizeMenu testid="nt-size" big={narrow}
        value={currentSizeNum} mixed={sizeMixed} displayLabel={sizeLabel}
        onPick={pickSize} />

      <Sep />

      <TBButton title="Bold" testid="nt-bold" big={narrow} disabled={titleActive} pressed={boldPressed} onClick={() => chain().toggleBold().run()}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>B</span>
      </TBButton>
      <TBButton title="Italic" testid="nt-italic" big={narrow} disabled={titleActive} pressed={italicPressed} onClick={() => chain().toggleItalic().run()}>
        <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif", fontSize: 13 }}>I</span>
      </TBButton>
      <TBButton title="Underline" testid="nt-underline" big={narrow} disabled={titleActive} pressed={underlinePressed} onClick={() => chain().toggleUnderline().run()}>
        <span style={{ textDecoration: "underline", fontSize: 13 }}>U</span>
      </TBButton>
      <TBButton title="Strikethrough" testid="nt-strike" big={narrow} disabled={titleActive} pressed={strikePressed} onClick={() => chain().toggleStrike().run()}>
        <span style={{ textDecoration: "line-through", fontSize: 13 }}>S</span>
      </TBButton>
      <TBButton title="Superscript" testid="nt-sup" big={narrow} pressed={supPressed}
        onClick={() => (titleActive ? setTitleStyle({ sup: !titleStyle.sup, sub: false }) : chain().toggleSuperscript().run())}>
        <SupText />
      </TBButton>
      <TBButton title="Subscript" testid="nt-sub" big={narrow} pressed={subPressed}
        onClick={() => (titleActive ? setTitleStyle({ sub: !titleStyle.sub, sup: false }) : chain().toggleSubscript().run())}>
        <SubText />
      </TBButton>

      <ColorPopover title="Text colour" testid="nt-color" glyph="ink" big={narrow} mixed={colorMixed}
        swatch={currentColor || DEFAULT_TEXT_SWATCH} colors={TEXT_COLORS}
        onPick={(c) => (titleActive ? setTitleStyle({ color: c }) : (c ? chain().setColor(c).run() : chain().unsetColor().run()))} />
      <ColorPopover title="Highlight colour" testid="nt-highlight" glyph="marker" big={narrow} mixed={hlMixed}
        swatch={currentHl || DEFAULT_HIGHLIGHT_SWATCH} colors={HIGHLIGHT_COLORS}
        onPick={(c) => (titleActive ? setTitleStyle({ highlight: c }) : (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run()))} />

      <Sep />

      {compact ? (
        disabledWrap(<AlignMenu value={alignDisplay ?? "left"} mixed={alignMixed} big={narrow}
          onPick={(id) => chain().setTextAlign(id).run()} />)
      ) : disabledWrap(
        <>
          {ALIGNS.map((a) => (
            <TBButton key={a.id} title={a.title} testid={`nt-align-${a.id}`} big={narrow}
              pressed={alignPressed(a.id)}
              onClick={() => chain().setTextAlign(a.id).run()}>
              <AlignIcon lines={a.lines} />
            </TBButton>
          ))}
        </>,
      )}

      <Sep />

      {disabledWrap(
        <>
          <TBButton title="Bulleted list" testid="nt-bullet" big={narrow} pressed={listPressed("bulletList")} onClick={() => chain().toggleBulletList().run()}><BulletIcon /></TBButton>
          <TBButton title="Numbered list" testid="nt-ordered" big={narrow} pressed={listPressed("orderedList")} onClick={() => chain().toggleOrderedList().run()}><OrderedIcon /></TBButton>
          <TBButton title="Checklist" testid="nt-task" big={narrow} pressed={listPressed("taskList")} onClick={() => chain().toggleTaskList().run()}><TaskIcon /></TBButton>
          <TBButton title="Decrease indent" testid="nt-outdent" big={narrow} onClick={outdent}><IndentIcon out /></TBButton>
          <TBButton title="Increase indent" testid="nt-indent" big={narrow} onClick={indent}><IndentIcon /></TBButton>
          <SpacingPopover big={narrow} lineHeight={spacingResolved} spaceBefore={spaceBeforeCaret} spaceAfter={spaceAfterCaret}
            onPick={pickSpacing} onApplyWholePage={applySpacingWholePage} onReset={resetSpacing} />
        </>,
      )}

      <Sep />

      {!compact && !titleActive && (
        <>
          <LinkControl editor={editor} big={narrow} />
          <TableGridPicker big={narrow} onInsert={(rows, cols) => chain().insertTable({ rows, cols, withHeaderRow: true }).run()} />
          <TBButton title="Insert a picture" testid="nt-image" big={narrow} onClick={() => fileRef.current?.click()}><ImageIcon /></TBButton>
          <TBButton title="Attach a file — a PDF, a spreadsheet, a drawing" testid="nt-attach" big={narrow} onClick={onAttach}>
            <Icon><path d="M11.5 5.5L6.2 10.8a2 2 0 0 0 2.8 2.8l5.3-5.3a3.4 3.4 0 0 0-4.8-4.8L4.2 8.8a4.8 4.8 0 0 0 6.8 6.8" /></Icon>
          </TBButton>
        </>
      )}
      {!titleActive && (
        <InsertMenu editor={editor} big={narrow} compact={compact} fileRef={fileRef} onAttach={onAttach}
          onInsertTable={(rows, cols) => chain().insertTable({ rows, cols, withHeaderRow: true }).run()} />
      )}
      {disabledWrap(
        <TBButton title="Connect two boxes with an arrow — click this, then click the box it starts from, then the box it points to"
          testid="nt-arrow" active={arrowMode} big={narrow} onClick={onToggleArrow}><ArrowConnectIcon /></TBButton>,
      )}

      {/* The picker is the deliberate alternative to paste/drop, not a replacement — it is how
          a picture gets in on a device where dragging a file is awkward. */}
      <input
        ref={fileRef}
        data-testid="nt-image-input"
        type="file"
        accept="image/*"
        multiple
        onChange={pickImages}
        style={{ display: "none" }}
      />

      {tableGroupControls && (
        <>
          <Sep />
          <span data-testid="nt-table-group" style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 2, padding: "2px 6px", borderRadius: RADIUS.pill, background: "var(--surface-page)", border: "1px solid var(--border-default)" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent-notes-text)", marginRight: 4 }}>Table</span>
            {tableGroupControls}
          </span>
        </>
      )}
    </div>
  );
}

/** ⛔ THE ONE "+" INSERT MENU (NEW-1/NEW-9). Its content is TWO layers, always both present:
 *  Divider/Quote/Code block/Toggle/Callout — the block-level constructs that have no other
 *  toolbar home in this redesign — PLUS, ONLY while `compact` (NEW-9's fold), Link/Table/
 *  Image/Attach on top of them, since those four already have their own dedicated buttons on
 *  the row the rest of the time. One trigger either way — "leaving only +" is the acceptance
 *  test's own wording, and two separate plus-icon buttons would fail it just as surely as a
 *  second row would.
 *
 *  Named-in-brief: "Divider, Page break, Callout, Quote, Code block, Date, Mention, Table of
 *  contents — include only the ones the editor already supports." This editor supports
 *  Divider/Callout/Quote/Code block — Page break, Date, Mention and Table of contents do not
 *  exist anywhere in this schema (AUDIT-FIRST: checked `lib/notesSlashMenu.js`'s own command
 *  list, the one place every insertable construct is already enumerated) and are not invented
 *  here. Toggle rides along too — a real, already-supported construct with no other home. */
function InsertMenu({ editor, big, compact, fileRef, onAttach, onInsertTable }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { popRef, clampStyle } = usePopoverClampLeft(open);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const chain = () => editor.chain().focus();

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <TBButton title="Insert" testid="nt-insert-plus" active={open} big={big} onClick={() => setOpen((o) => !o)}><PlusIcon /></TBButton>
      {open && (
        <div
          ref={popRef}
          data-testid="nt-insert-panel"
          onMouseDown={stop}
          style={{
            position: "absolute", top: big ? 48 : 32, left: 0, zIndex: 40, padding: 4, width: 196,
            display: "flex", flexDirection: "column", gap: 1,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: POPOVER_SHADOW,
            ...clampStyle,
          }}
        >
          {compact ? (
            <>
              <span style={{ padding: "2px 2px" }}><LinkControl editor={editor} big={big} /></span>
              <span style={{ padding: "2px 2px" }}><TableGridPicker big={big} onInsert={onInsertTable} /></span>
              <button type="button" data-testid="nt-insert-image" onMouseDown={stop}
                onClick={() => { setOpen(false); fileRef.current?.click(); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: RADIUS.control, border: "none", background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 550 }}>
                <ImageIcon /> Picture
              </button>
              <button type="button" data-testid="nt-insert-attach" onMouseDown={stop}
                onClick={() => { setOpen(false); onAttach?.(); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: RADIUS.control, border: "none", background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 550 }}>
                <Icon><path d="M11.5 5.5L6.2 10.8a2 2 0 0 0 2.8 2.8l5.3-5.3a3.4 3.4 0 0 0-4.8-4.8L4.2 8.8a4.8 4.8 0 0 0 6.8 6.8" /></Icon> Attach file
              </button>
              <div style={{ height: 1, margin: "3px 2px", background: "var(--border-default)" }} />
            </>
          ) : null}
          {[
            { id: "hr", label: "Divider", run: () => chain().setHorizontalRule().run() },
            { id: "quote", label: "Quote", run: () => chain().toggleBlockquote().run() },
            { id: "codeblock", label: "Code block", run: () => chain().toggleCodeBlock().run() },
            { id: "toggle", label: "Toggle", run: () => chain().setNoteToggle().run() },
          ].map((row) => (
            <button key={row.id} type="button" data-testid={`nt-insert-${row.id}`} onMouseDown={stop}
              onClick={() => { setOpen(false); row.run(); }}
              style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", padding: "7px 8px", borderRadius: RADIUS.control, cursor: "pointer", border: "none", background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 550 }}>
              {row.label}
            </button>
          ))}
          <div style={{ padding: "2px 2px" }}>
            <CalloutControl editor={editor} big={big} />
          </div>
        </div>
      )}
    </span>
  );
}
