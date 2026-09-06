/* Model workspace — the Home-tab ribbon (Stage 2, B1007281 — owner brief, modeled on Excel's
 * own Home tab since that's the reference he named): Actions, Font, Colour, Alignment, Number,
 * Borders, Cells, Sort & Filter. Everything acts on the current selection RANGE, not just the
 * active cell — select B2:D40, hit currency, all of them change.
 *
 * ⛔ ICONOGRAPHY REWRITE (owner, verbatim, after the first ribbon shipped: "it reads as a debug
 * panel, not a product... every button is a different width, nothing is grouped, and most of
 * them are words where they should be icons. MATCH GOOGLE SHEETS' TOOLBAR — that is the
 * reference standard.") The controls this rewrite touches were already correct and already
 * shipped — this pass is PRESENTATION ONLY, no behavior change: every text-labelled action
 * button (Paint, Clear, Wrap, Merge, Freeze, Filter, Insert, Delete, the Borders "More") is now
 * a plain hand-drawn icon (this app's own inline-SVG convention — see AppHeader.jsx's
 * FullscreenButton/SettingsMenu/MODULE_ICONS — never a new icon-font/library dependency) with a
 * native `title` tooltip; every icon-only control also carries `aria-label` since it has no text
 * a screen reader could read. B/I/U/S and the "A" text-colour swatch are the one deliberate
 * exception — those letters ARE the convention (Excel, Sheets, and Word all use them), matching
 * the brief's own "B/I/U/S are fine because that IS the convention" line.
 *
 * ⛔ GROUPING REWRITE. The owner's own grouping, verbatim, is the display order below: Actions
 * (undo/redo + paint/clear — the four controls used on nearly every edit, including the two that
 * used to live in AppHeader's row-1 toolbar and now live here instead, matching Google Sheets'
 * own toolbar where Undo/Redo open the row) | Font face (family+size) | Font style (B/I/U/S) |
 * Colour (text+fill) | Alignment (incl. wrap/indent/merge) | Number | Borders | Cells
 * (insert/delete/freeze) | Sort & Filter — a real hairline divider with actual breathing room
 * between each (docs/DESIGN.md's divider rule: 1px `--chrome-divider`, 14px tall, real margin —
 * never the same 3px gap a same-group button pair uses), so the row reads as clustered controls
 * instead of thirty same-weight items in a line.
 *
 * ⛔ SINGLE OVERFLOW MENU. The first cut collapsed each hidden group into its OWN small trigger —
 * several ragged little icon buttons trailing the row, which read exactly as unfinished as the
 * text-button row it replaced. Every collapsed group now stacks inside ONE trailing "…" trigger's
 * one popover (MoreMenu below) — lib/ribbonLayout.js still decides which groups are in vs. out
 * (its own header explains the width/priority math), this file only decides how the overflow
 * itself is presented.
 *
 * ⛔ LAYOUT REQUIREMENT (owner, verbatim): "the ribbon must WRAP or COLLAPSE into overflow menus
 * at narrow widths… I measured 'More formatting' at ZERO pixels wide" — the ORIGINAL bug this
 * stage exists to fix. This component measures its OWN container width (ResizeObserver, never
 * window width) and hands it to lib/ribbonLayout.js's pure computeRibbonLayout. Verified live at
 * 729 / 1024 / full width, both themes (see the PR).
 *
 * Every control is a plain token-driven button/dropdown built from this app's own primitives
 * (AnchoredMenu, MenuItem) — no new overlay mechanism, matching docs/DESIGN.md's rule that a new
 * control extends the shared primitive set rather than being invented at the call site.
 *
 * ⛔ Does NOT import designTokens.js (SPACE/CONTROL_H) — SitePlanner.jsx (the Site route) already
 * imports it directly, so a second importer from this Model-only lazy chunk creates a NEW shared
 * chunk that leaks onto the Site route's bundle allowlist (measured, B1020608-FOLLOWUP: this
 * exact mistake shipped once in SheetView.jsx and broke `bundle.siteRouteAllowlist` in CI). Sizes
 * below are literal duplicates of CONTROL_H.md (26) / SPACE.md (8) — matches controls.jsx's own
 * documented literal-duplicate pattern (see that file's RADIUS/PAD/FONT header) for the same
 * reason. `radius.js`, by contrast, IS imported here — it's already pulled into the app's shared
 * entry chunk by Shell.jsx/AppHeader.jsx, so a Model-only importer adds nothing new to any route.
 */
import { useLayoutEffect, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { MenuItem, menuPanelStyle } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { NUMBER_FORMATS, formatLabelFor } from "../lib/numberFormats.js";
import { computeRibbonLayout, RIBBON_GROUPS, MORE_BUTTON_WIDTH } from "../lib/ribbonLayout.js";
import {
  toggleBoldPatch, toggleItalicPatch, toggleUnderlinePatch, toggleStrikePatch,
  toggleWrapPatch, increaseIndentPatch, decreaseIndentPatch,
} from "../lib/commandRegistry.js";

const FONT_FAMILIES = [
  { id: "system-ui, sans-serif", label: "Default" },
  { id: "Arial, Helvetica, sans-serif", label: "Arial" },
  { id: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { id: "'Courier New', monospace", label: "Courier New" },
  { id: "Calibri, 'Segoe UI', sans-serif", label: "Calibri" },
  { id: "Verdana, sans-serif", label: "Verdana" },
];
const FONT_SIZES = [9, 10, 10.5, 11, 12, 12.5, 14, 16, 18, 20, 24];
const TEXT_PALETTE = ["#1a1a1a", "#c62828", "#2e7d32", "#1565c0", "#ef6c00", "#6a1b9a", "#00838f", "#5d4037", "#616161", "#ffffff"]; // design-exempt: content colours a user picks for their own cells, not app chrome — no theme token applies
const FILL_PALETTE = ["#fff9c4", "#ffe0b2", "#c8e6c9", "#bbdefb", "#e1bee7", "#ffcdd2", "#eeeeee", "#d7ccc8", "#b2ebf2", "transparent"]; // design-exempt: same — cell fill colours, not chrome
const VALIGN_OPTIONS = [{ id: "top", label: "Top" }, { id: "middle", label: "Middle" }, { id: "bottom", label: "Bottom" }];

const CTRL_H = 26; // literal match to CONTROL_H.md (src/shared/ui/designTokens.js) — see file header
const GROUP_GAP = 8; // literal match to SPACE.md — real breathing room between groups, never imported (see file header)

function ribbonBtnStyle(active, extra) {
  return {
    // B1087904 — was `RADIUS.control`, a token that doesn't exist on RADIUS (only
    // pill/sm/md/lg) — silently resolved to `undefined`, which React drops from the style
    // object, so every ribbon button rendered with a flat 0 border-radius regardless of theme.
    // `RADIUS.sm` is a control nested inside another rounded surface (the toolbar card below,
    // `ModelApp.jsx`'s `model-toolbar-card`, `RADIUS.lg` = 12) — the right FAMILY of value.
    //
    // ⛔ NEW-2 — IT IS NOT `nestedIn(12, …)` FOR THIS CARD'S ACTUAL PADDING, AND THAT IS STATED
    // HERE RATHER THAN LEFT IMPLIED. The card pads this row 5px vertically and 8px
    // horizontally (`Ribbon.jsx`'s own outer `padding: "5px 8px"`), asymmetric on purpose (a
    // dense toolbar row wants more side breathing room than top/bottom) — `nestedIn(12, 5)` = 7
    // on the vertical axis, `nestedIn(12, 8)` = 4 on the horizontal one, and there is no single
    // "correct" concentric radius for an inset that differs per axis (the nesting rule in
    // `radius.js`'s own header assumes one uniform gap). `RADIUS.sm` = 6 is a deliberately CHOSEN
    // approximation — the scale's next step down from the card's own `RADIUS.lg`, sitting between
    // the two axis-derived values — not a precise per-axis derivation, and a 1-2px move either way
    // is imperceptible at working zoom (PERCEPTUAL-PARITY) for a cosmetic difference this small.
    // Left alone rather than re-picked; see the item for the two considered alternatives (govern
    // by the tighter horizontal gap, or make the card's padding symmetric) if this is ever revisited.
    height: CTRL_H, minWidth: CTRL_H, padding: "0 6px", borderRadius: RADIUS.sm, boxSizing: "border-box",
    border: `1px solid ${active ? "var(--accent-model)" : "var(--border-default)"}`,
    background: active ? "var(--accent-model)" : "var(--surface-page)",
    color: active ? "var(--on-accent-model)" : "var(--text-primary)",
    font: "inherit", fontSize: 12, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3,
    ...extra,
  };
}

// docs/DESIGN.md's divider rule: 1px `--chrome-divider`, height = the row's own control height
// minus 12 (26 - 12 = 14 here), real margin on both sides — never the same tight gap a
// same-group control pair uses (that reads as "one more item in the list," not a boundary).
function Divider() {
  return <span aria-hidden="true" style={{ width: 1, height: 14, alignSelf: "center", margin: `0 ${GROUP_GAP}px`, background: "var(--chrome-divider)", flex: "none" }} />;
}

/** The one shared icon shape every ribbon icon renders through — this app's own hand-drawn
 *  inline-SVG convention (AppHeader.jsx's FullscreenButton/SettingsMenu/MODULE_ICONS), never a
 *  new icon-font or library dependency. 24×24 viewBox, rendered small and crisp. */
function Icon({ children, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: "block", flex: "none" }}>
      {children}
    </svg>
  );
}

// ---- The icon set. One named component per glyph, so a call site reads `<IconBold />`-plain —
// see each control's own `title`/`aria-label` for what it means; these are identification only.
function IconUndo() { return <Icon><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></Icon>; }
function IconRedo() { return <Icon><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></Icon>; }
function IconPaint() { return <Icon><rect x="3" y="4" width="14" height="6" rx="1" /><line x1="7" y1="10" x2="7" y2="15" /><rect x="5" y="15" width="4" height="5" rx="1" /></Icon>; }
function IconEraser() { return <Icon><rect x="6" y="9" width="12" height="7" rx="1.5" transform="rotate(-45 12 12.5)" /><line x1="3" y1="20" x2="21" y2="20" /></Icon>; }
// ROUND 2 (owner critique — self-review against the brief's 5 questions after Round 1's
// screenshots): the diamond-bucket, asterisk-freeze and arrow-in-box-merge glyphs were the
// weakest three of the set on close inspection — legible with a tooltip, but not the instant,
// literal read the rest of the icon set already had. Redrawn to read at a glance:
function IconBucket() { return <Icon><path d="M5 9h14l-1.3 9.5a2 2 0 0 1-2 1.5H8.3a2 2 0 0 1-2-1.5z" /><path d="M8 9a4 4 0 0 1 8 0" /></Icon>; } // a real bucket silhouette (rim, tapered body, arched handle) — was an abstract diamond
function IconValign() { return <Icon><rect x="6" y="3" width="12" height="5" rx="1" /><line x1="3" y1="12" x2="21" y2="12" /><rect x="6" y="16" width="12" height="5" rx="1" /></Icon>; }
function IconWrap() { return <Icon><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="17" y2="12" /><polyline points="21 12 21 16 13 16" /><polyline points="16 19 13 16 16 13" /></Icon>; }
function IconIndentInc() { return <Icon><line x1="3" y1="5" x2="21" y2="5" /><polyline points="3 10 7 12 3 14" /><line x1="11" y1="9" x2="21" y2="9" /><line x1="11" y1="15" x2="21" y2="15" /><line x1="3" y1="19" x2="21" y2="19" /></Icon>; }
function IconIndentDec() { return <Icon><line x1="3" y1="5" x2="21" y2="5" /><polyline points="7 10 3 12 7 14" /><line x1="11" y1="9" x2="21" y2="9" /><line x1="11" y1="15" x2="21" y2="15" /><line x1="3" y1="19" x2="21" y2="19" /></Icon>; }
function IconMerge() { return <Icon><rect x="2" y="6" width="20" height="12" rx="1" /><polyline points="11 9 9 12 11 15" /><polyline points="13 9 15 12 13 15" /></Icon>; } // two cells' shared edge collapsing to the centre — was an ambiguous diamond-in-a-box
function IconInsert() { return <Icon><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></Icon>; }
function IconDelete() { return <Icon><polyline points="4 7 20 7" /><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" /><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></Icon>; }
function IconFreeze() { return <Icon><rect x="3" y="3" width="18" height="18" rx="1" /><rect x="3" y="3" width="18" height="6" fill="currentColor" stroke="none" /><line x1="9" y1="9" x2="9" y2="21" /><line x1="15" y1="9" x2="15" y2="21" /></Icon>; } // a real frozen-top-row glyph (Excel/Sheets' own convention) — was a generic asterisk/snowflake that read as decoration, not "freeze"
// STAGE 3 (NEW-2) — three dots in the actual convention's own colours (blue input / black
// formula / green cross-sheet link — the SAME tokens SheetView.jsx paints cell text with), not
// a `currentColor` outline like the rest of this icon set: the glyph IS the feature it toggles,
// so showing its real effect reads at a glance in a way an abstract shape wouldn't.
function IconAutoColor() {
  return (
    <Icon>
      <circle cx="5" cy="12" r="3.4" fill="var(--info-text)" stroke="none" />
      <circle cx="12" cy="12" r="3.4" fill="var(--text-primary)" stroke="none" />
      <circle cx="19" cy="12" r="3.4" fill="var(--success-text)" stroke="none" />
    </Icon>
  );
}
// STAGE 3 (NEW-1) — Trace Precedents: several small nodes converging into one, the plainest
// literal read for "these feed this" in the icon set's hand-drawn convention. Trace Dependents
// (below) is its mirror — one node radiating out to several.
function IconTracePrecedents() {
  return (
    <Icon>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="18" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <line x1="7" y1="7" x2="15.5" y2="11" />
      <line x1="7" y1="17" x2="15.5" y2="13" />
    </Icon>
  );
}
function IconTraceDependents() {
  return (
    <Icon>
      <circle cx="6" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <line x1="8.5" y1="11" x2="17" y2="7" />
      <line x1="8.5" y1="13" x2="17" y2="17" />
    </Icon>
  );
}
function IconRemoveArrows() {
  return (
    <Icon>
      <line x1="4" y1="18" x2="16" y2="6" />
      <polyline points="10 6 16 6 16 12" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </Icon>
  );
}
// STAGE 3 (NEW-2) — a warning triangle, the same shape the per-cell corner flag
// (SheetView.jsx) draws, so the ribbon button and the marker it opens a list of read as ONE idea.
function IconInconsistency() {
  return (
    <Icon>
      <path d="M12 3 L22 20 L2 20 Z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}
function IconMore() {
  return (
    <Icon>
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** A button that opens an AnchoredMenu, showing a TEXT label + a trailing "▾" — used only where
 *  the control's whole point is to show the current VALUE (font family, font size, number
 *  format): the label isn't decoration, it's the readout. Clicking anything inside auto-closes. */
function DropdownButton({ label, title, width = 190, minWidth, children }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button" ref={anchorRef} title={title} aria-label={title} aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        style={ribbonBtnStyle(open, { minWidth: minWidth || CTRL_H, padding: "0 6px" })}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={width} panelStyle={menuPanelStyle}>
        <div onClick={() => setOpen(false)}>{children}</div>
      </AnchoredMenu>
    </span>
  );
}

/** The icon counterpart of DropdownButton — an icon + a small "▾", never a text label. Every
 *  control the owner's brief named explicitly (Merge, Freeze, Insert, Delete, the Borders
 *  "More") is built from this one shape, so they read as ONE family of trigger, not one-off
 *  buttons that happen to open menus. */
function IconDropdownButton({ icon, title, width = 190, children }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" ref={anchorRef} title={title} aria-label={title} aria-haspopup="true" onClick={() => setOpen((o) => !o)} style={ribbonBtnStyle(open, { gap: 2 })}>
        {icon}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={width} panelStyle={menuPanelStyle}>
        <div onClick={() => setOpen(false)}>{children}</div>
      </AnchoredMenu>
    </span>
  );
}

/** A small palette-grid colour picker (text colour / fill colour) — deliberately its own, small,
 *  self-contained popover rather than the shared ColorField (that component's `pick`/`onSwatch`
 *  contract is built around the markup module's own livePick-with-history session; the ribbon's
 *  colour choice is a single discrete commit, exactly what `onPick` here already is). Its own
 *  trigger shows either `label` (the "A" text-colour convention — Excel/Sheets/Word all use the
 *  bare letter, exempted from the icon rule the same way B/I/U/S is) or `icon` (the fill-colour
 *  paint-bucket) plus the current colour as a swatch bar underneath. "No fill" / default text
 *  colour is the trailing swatch in each palette (a transparent checkerboard) rather than a
 *  seventh colour. */
function ColorSwatchButton({ label, icon, title, value, palette, onPick, defaultSwatchLabel }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" ref={anchorRef} title={title} aria-label={title} aria-haspopup="true" onClick={() => setOpen((o) => !o)} style={ribbonBtnStyle(false, { flexDirection: "column", gap: 0, padding: "1px 4px", width: CTRL_H })}>
        {icon || <span style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1 }}>{label}</span>}
        <span aria-hidden="true" style={{ width: 15, height: 3, marginTop: 2, background: value || "var(--border-default)", border: value ? "none" : "1px solid var(--border-default)" }} />
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={148} panelStyle={menuPanelStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 4, padding: 6 }}>
          {palette.map((hex) => (
            <button
              key={hex} type="button" title={hex === "transparent" ? defaultSwatchLabel : hex} aria-label={hex === "transparent" ? defaultSwatchLabel : hex}
              onClick={() => { onPick(hex === "transparent" ? null : hex); setOpen(false); }}
              style={{
                width: 22, height: 22, borderRadius: RADIUS.sm, cursor: "pointer",
                border: value === hex || (hex === "transparent" && !value) ? "2px solid var(--accent-model)" : "1px solid var(--border-default)",
                background: hex === "transparent"
                  ? "repeating-linear-gradient(45deg, var(--surface-raised) 0 4px, var(--border-default) 4px 8px)"
                  : hex,
              }}
            />
          ))}
        </div>
      </AnchoredMenu>
    </span>
  );
}

function AlignGlyph({ align }) {
  const widths = ["100%", "65%", "85%"];
  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
  return (
    <span aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 2, width: 15 }}>
      {widths.map((w, i) => <span key={i} style={{ height: 2, width: w, background: "currentColor", alignSelf: justify }} />)}
    </span>
  );
}

// ---- Groups — each takes the SAME `ctx` bag (built once per Ribbon render) and returns the
// group's controls as a flex row; used both inline and inside the single overflow popover. ----

function ActionsGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <button type="button" data-testid="ribbon-undo" title="Undo (Ctrl+Z)" aria-label="Undo"
        onClick={ctx.onUndo} disabled={!ctx.canUndo} style={ribbonBtnStyle(false)}><IconUndo /></button>
      <button type="button" data-testid="ribbon-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo"
        onClick={ctx.onRedo} disabled={!ctx.canRedo} style={ribbonBtnStyle(false)}><IconRedo /></button>
      <button type="button" data-testid="ribbon-format-painter" title="Format Painter — copy this cell's look onto another" aria-label="Format Painter"
        onClick={ctx.onFormatPainterToggle} aria-pressed={ctx.painterArmed} style={ribbonBtnStyle(ctx.painterArmed)}><IconPaint /></button>
      <button type="button" data-testid="ribbon-clear-format" title="Clear Formatting" aria-label="Clear Formatting"
        onClick={ctx.onClearFormatting} style={ribbonBtnStyle(false)}><IconEraser /></button>
    </span>
  );
}

function FontFaceGroup({ ctx }) {
  const s = ctx.activeStyle;
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <DropdownButton label={FONT_FAMILIES.find((f) => f.id === s.fontFamily)?.label || "Default"} title="Font family" width={160} minWidth={72}>
        {FONT_FAMILIES.map((f) => (
          <MenuItem key={f.id} active={s.fontFamily === f.id} style={{ fontFamily: f.id }} onClick={() => ctx.onSetCellStyle({ fontFamily: f.id === FONT_FAMILIES[0].id ? null : f.id })}>{f.label}</MenuItem>
        ))}
      </DropdownButton>
      <DropdownButton label={String(s.fontSize || 12.5)} title="Font size" width={80} minWidth={40}>
        {FONT_SIZES.map((sz) => (
          <MenuItem key={sz} active={s.fontSize === sz} onClick={() => ctx.onSetCellStyle({ fontSize: sz === 12.5 ? null : sz })}>{sz}</MenuItem>
        ))}
      </DropdownButton>
    </span>
  );
}

function FontStyleGroup({ ctx }) {
  const s = ctx.activeStyle;
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <button type="button" data-testid="ribbon-bold" title="Bold" aria-label="Bold" aria-pressed={!!s.bold} onClick={() => ctx.onSetCellStyle(toggleBoldPatch(s))} style={ribbonBtnStyle(!!s.bold, { fontWeight: 800 })}>B</button>
      <button type="button" data-testid="ribbon-italic" title="Italic" aria-label="Italic" aria-pressed={!!s.italic} onClick={() => ctx.onSetCellStyle(toggleItalicPatch(s))} style={ribbonBtnStyle(!!s.italic, { fontStyle: "italic" })}>I</button>
      <button type="button" data-testid="ribbon-underline" title="Underline" aria-label="Underline" aria-pressed={!!s.underline} onClick={() => ctx.onSetCellStyle(toggleUnderlinePatch(s))} style={ribbonBtnStyle(!!s.underline, { textDecoration: "underline" })}>U</button>
      <button type="button" data-testid="ribbon-strike" title="Strikethrough" aria-label="Strikethrough" aria-pressed={!!s.strike} onClick={() => ctx.onSetCellStyle(toggleStrikePatch(s))} style={ribbonBtnStyle(!!s.strike, { textDecoration: "line-through" })}>S</button>
    </span>
  );
}

function ColorGroup({ ctx }) {
  const s = ctx.activeStyle;
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <ColorSwatchButton label="A" title="Text colour" value={s.color} palette={TEXT_PALETTE} defaultSwatchLabel="Default text colour" onPick={(hex) => ctx.onSetCellStyle({ color: hex })} />
      <ColorSwatchButton icon={<IconBucket />} title="Fill colour" value={s.fill} palette={FILL_PALETTE} defaultSwatchLabel="No fill" onPick={(hex) => ctx.onSetCellStyle({ fill: hex })} />
      {/* STAGE 3 (NEW-2) — the input/formula/cross-sheet-link colour convention toggle, ON by
          default. A manual font colour (the "A" swatch above) always wins over this regardless
          of the toggle's state — SheetView.jsx's own render decides that precedence. */}
      <button
        type="button" data-testid="ribbon-autocolor" title="Colour cells by kind — blue input, black formula, green cross-sheet link"
        aria-label="Toggle automatic cell colouring" aria-pressed={ctx.autoColor}
        onClick={ctx.onAutoColorToggle} style={ribbonBtnStyle(ctx.autoColor)}
      ><IconAutoColor /></button>
    </span>
  );
}

function AlignmentGroup({ ctx }) {
  const s = ctx.activeStyle;
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <button type="button" data-testid="ribbon-align-left" title="Align left" aria-label="Align left" aria-pressed={s.align === "left"} onClick={() => ctx.onSetCellStyle({ align: "left" })} style={ribbonBtnStyle(s.align === "left")}><AlignGlyph align="left" /></button>
      <button type="button" data-testid="ribbon-align-center" title="Align center" aria-label="Align center" aria-pressed={s.align === "center"} onClick={() => ctx.onSetCellStyle({ align: "center" })} style={ribbonBtnStyle(s.align === "center")}><AlignGlyph align="center" /></button>
      <button type="button" data-testid="ribbon-align-right" title="Align right" aria-label="Align right" aria-pressed={s.align === "right"} onClick={() => ctx.onSetCellStyle({ align: "right" })} style={ribbonBtnStyle(s.align === "right")}><AlignGlyph align="right" /></button>
      {/* This app's own existing default (every cell, always) is vertically CENTERED — "Middle"
          is the implicit/default option (valign: null), never "Bottom" (Excel's own default, but
          adopting it here would silently reflow every already-typed cell in the whole app). */}
      <IconDropdownButton icon={<IconValign />} title="Vertical alignment" width={110}>
        {VALIGN_OPTIONS.map((v) => <MenuItem key={v.id} active={(s.valign || "middle") === v.id} onClick={() => ctx.onSetCellStyle({ valign: v.id === "middle" ? null : v.id })}>{v.label}</MenuItem>)}
      </IconDropdownButton>
      <button type="button" data-testid="ribbon-wrap" title="Wrap text" aria-label="Wrap text" aria-pressed={!!s.wrap} onClick={() => ctx.onSetCellStyle(toggleWrapPatch(s))} style={ribbonBtnStyle(!!s.wrap)}><IconWrap /></button>
      <button type="button" data-testid="ribbon-indent-dec" title="Decrease indent" aria-label="Decrease indent" onClick={() => ctx.onSetCellStyle(decreaseIndentPatch(s))} style={ribbonBtnStyle(false)}><IconIndentDec /></button>
      <button type="button" data-testid="ribbon-indent-inc" title="Increase indent" aria-label="Increase indent" onClick={() => ctx.onSetCellStyle(increaseIndentPatch(s))} style={ribbonBtnStyle(false)}><IconIndentInc /></button>
      <IconDropdownButton icon={<IconMerge />} title="Merge cells" width={170}>
        <MenuItem onClick={ctx.onMergeToggle}>{ctx.mergedHere ? "Unmerge Cells" : "Merge Cells"}</MenuItem>
      </IconDropdownButton>
    </span>
  );
}

function NumberGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <DropdownButton label={formatLabelFor(ctx.activeFormat)} title="Number format" width={210} minWidth={86}>
        {NUMBER_FORMATS.map((f) => (
          <MenuItem key={f.id} active={(f.token || null) === (ctx.activeFormat || null)} onClick={() => ctx.onApplyFormat(f.token)}>{f.label}</MenuItem>
        ))}
      </DropdownButton>
      <button type="button" data-testid="ribbon-pct" title="Percent style" aria-label="Percent style" onClick={() => ctx.onApplyFormat("0.0%")} style={ribbonBtnStyle(false)}>%</button>
      <button type="button" data-testid="ribbon-currency" title="Currency style" aria-label="Currency style" onClick={() => ctx.onApplyFormat("$#,##0.00")} style={ribbonBtnStyle(false)}>$</button>
      <button type="button" data-testid="ribbon-comma" title="Thousands separator" aria-label="Thousands separator" onClick={() => ctx.onNumberFormatOp("toggleThousands")} style={ribbonBtnStyle(false)}>,</button>
      <button type="button" data-testid="ribbon-dec-inc" title="Increase decimal" aria-label="Increase decimal" onClick={() => ctx.onNumberFormatOp("increaseDecimals")} style={ribbonBtnStyle(false, { fontSize: 10.5 })}>.0→</button>
      <button type="button" data-testid="ribbon-dec-dec" title="Decrease decimal" aria-label="Decrease decimal" onClick={() => ctx.onNumberFormatOp("decreaseDecimals")} style={ribbonBtnStyle(false, { fontSize: 10.5 })}>→.0</button>
    </span>
  );
}

function CellsGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <IconDropdownButton icon={<IconInsert />} title="Insert rows or columns" width={160}>
        <MenuItem onClick={ctx.onInsertRow}>Row above</MenuItem>
        <MenuItem onClick={ctx.onInsertColumn}>Column left</MenuItem>
      </IconDropdownButton>
      <IconDropdownButton icon={<IconDelete />} title="Delete rows or columns" width={140}>
        <MenuItem onClick={ctx.onDeleteRow}>Row</MenuItem>
        <MenuItem onClick={ctx.onDeleteColumn}>Column</MenuItem>
      </IconDropdownButton>
      <IconDropdownButton icon={<IconFreeze />} title="Freeze panes" width={190}>
        <MenuItem onClick={ctx.onSetFreezeTopRow}>Freeze top row</MenuItem>
        <MenuItem onClick={ctx.onSetFreezeFirstColumn}>Freeze first column</MenuItem>
        <MenuItem onClick={ctx.onSetFreezeAtSelection}>Freeze panes (at selection)</MenuItem>
        {(ctx.freezeRows > 0 || ctx.freezeCols > 0) && <MenuItem onClick={ctx.onUnfreeze}>Unfreeze panes</MenuItem>}
      </IconDropdownButton>
    </span>
  );
}

// STAGE 3 (NEW-1/NEW-2, owner brief 2026-09-03) — Trace Precedents/Dependents/Remove Arrows +
// the Inconsistencies list toggle. The trace buttons are TOGGLE-AND-STEP, matching Excel's own
// behaviour: clicking the SAME button again on the SAME selected cell extends the trace one
// level further (lib/traceAudit.js's `beginOrStepTrace` decides that from `ctx.traceMode`/
// `ctx.traceLevel` vs. the click — this component only routes the click, it holds no state of
// its own). The small "L2"/"L2+" readout next to the buttons is the ONLY visible trace status —
// PANEL-BREVITY: a full sentence status line was considered and dropped in favour of a `title`
// tooltip carrying the same detail (level, "no further precedents", a truncation note) on demand.
//
// ⛔ NEW-1 (command palette + reduced Home ribbon) — EXPORTED and no longer part of this
// component's own inline/overflow rendering (removed from ribbonLayout.js's RIBBON_GROUPS): the
// module's own differentiators were getting lost IN the overflow this ribbon collapses into, so
// they now have a permanent, always-visible home instead — ModelApp.jsx renders this SAME
// component (same buttons, same `ctx`, same testids) in AppHeader's row-1 toolbar, next to File.
export function AuditGroup({ ctx }) {
  const traceActive = !!ctx.traceMode;
  const traceDetail = () => {
    const bits = [`level ${ctx.traceLevel}`];
    if (ctx.traceNoFurther) bits.push(ctx.traceMode === "precedents" ? "no further precedents" : "no further dependents");
    if (ctx.traceTruncated) bits.push(`showing ${ctx.traceCellCount} cells — narrow the selection to see the rest`);
    return `(${bits.join(", ")}) — click again to go one level further`;
  };
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <button
        type="button" data-testid="ribbon-trace-precedents"
        title={`Trace Precedents — show which cells feed the selected one${ctx.traceMode === "precedents" ? ` ${traceDetail()}` : ""}`}
        aria-label="Trace Precedents" aria-pressed={ctx.traceMode === "precedents"}
        onClick={ctx.onTracePrecedents} style={ribbonBtnStyle(ctx.traceMode === "precedents")}
      ><IconTracePrecedents /></button>
      <button
        type="button" data-testid="ribbon-trace-dependents"
        title={`Trace Dependents — show which cells the selected one feeds${ctx.traceMode === "dependents" ? ` ${traceDetail()}` : ""}`}
        aria-label="Trace Dependents" aria-pressed={ctx.traceMode === "dependents"}
        onClick={ctx.onTraceDependents} style={ribbonBtnStyle(ctx.traceMode === "dependents")}
      ><IconTraceDependents /></button>
      <button
        type="button" data-testid="ribbon-trace-clear" title="Remove Arrows" aria-label="Remove Arrows"
        onClick={ctx.onClearTrace} disabled={!traceActive} style={ribbonBtnStyle(false)}
      ><IconRemoveArrows /></button>
      {traceActive && (
        <span
          aria-hidden="true" title={`${ctx.traceMode === "precedents" ? "Trace Precedents" : "Trace Dependents"} ${traceDetail()}`}
          style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", padding: "0 2px" }}
        >L{ctx.traceLevel}{ctx.traceTruncated ? "+" : ""}</span>
      )}
      <button
        type="button" data-testid="ribbon-inconsistencies"
        title={ctx.inconsistencyCount === 0 ? "Inconsistent formulas — none flagged" : `Inconsistent formulas — ${ctx.inconsistencyCount} flagged`}
        aria-label="Inconsistent formulas" aria-pressed={ctx.inconsistencyPanelOpen}
        onClick={ctx.onToggleInconsistencyPanel} style={{ ...ribbonBtnStyle(ctx.inconsistencyPanelOpen), position: "relative" }}
      >
        <IconInconsistency />
        {ctx.inconsistencyCount > 0 && (
          <span aria-hidden="true" style={{
            position: "absolute", top: -3, right: -3, minWidth: 14, height: 14, padding: "0 2px", borderRadius: RADIUS.pill,
            background: "var(--warn-bg)", border: "1px solid var(--warn-border)", color: "var(--warn-text)",
            fontSize: 10, fontWeight: 800, lineHeight: "12px", textAlign: "center", fontVariantNumeric: "tabular-nums", // FONT_SIZE.micro literal — designTokens.js note above

          }}>{ctx.inconsistencyCount > 99 ? "99+" : ctx.inconsistencyCount}</span>
        )}
      </button>
    </span>
  );
}

const GROUP_RENDER = {
  actions: ActionsGroup, fontface: FontFaceGroup, fontstyle: FontStyleGroup, color: ColorGroup,
  alignment: AlignmentGroup, number: NumberGroup, cells: CellsGroup,
};

/** The SINGLE overflow trigger — replaces the first cut's one-trigger-per-collapsed-group
 *  popovers (several ragged little icon buttons trailing the row). Every collapsed group's own
 *  content (the SAME GROUP_RENDER component used inline) stacks inside this ONE popover, each
 *  under its own small uppercase heading, so a narrow window still reaches everything from one
 *  predictable place instead of hunting across several tiny triggers. */
function MoreMenu({ overflowKeys, ctx }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  if (overflowKeys.length === 0) return null;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" ref={anchorRef} data-testid="ribbon-more" title="More formatting options" aria-label="More formatting options" onClick={() => setOpen((o) => !o)} style={ribbonBtnStyle(open)}>
        <IconMore />
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={300} panelStyle={{ ...menuPanelStyle, padding: 10, maxHeight: "min(70vh, 520px)", overflowY: "auto" }}>
        {/* ⛔ MEASURED LIVE (Stage 3, formula-auditing): picking a PLAIN action from this popover
            (Undo, Bold, Trace Precedents, …) used to leave the popover floating open afterward —
            harmless for a font/color/number-format pick, where staying open is what lets you
            then choose from the picker it just opened, but wrong for a one-shot action, and
            genuinely disruptive for Trace Precedents specifically: the whole point is to see the
            arrows just drawn on the grid, and this popover (z-index above the grid) can sit right
            over them. `aria-haspopup="true"` marks the three trigger shapes that open a NESTED
            picker (DropdownButton/IconDropdownButton/ColorSwatchButton) — only those keep this
            popover open; everything else closes it, matching Excel/Sheets' own overflow-menu
            convention (pick a one-shot action from "…", it closes). */}
        <div onClick={(e) => { if (e.target.closest("button")?.getAttribute("aria-haspopup") !== "true") setOpen(false); }}>
          {overflowKeys.map((key, i) => {
            const meta = RIBBON_GROUPS.find((g) => g.key === key);
            const Content = GROUP_RENDER[key];
            return (
              <div key={key} style={i > 0 ? { marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-default)" } : undefined}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 6 }}>{meta?.label}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}><Content ctx={ctx} /></div>
              </div>
            );
          })}
        </div>
      </AnchoredMenu>
    </span>
  );
}

// ⛔ NEW-1 (command palette) — Ribbon now takes ONE `ctx` prop instead of ~35 individual ones.
// ModelApp.jsx builds this bag ONCE and hands the SAME object to this component, to the
// permanent audit toolbar (AppHeader row 1, `AuditGroup` above) and to `CommandPalette` — so a
// palette command and the equivalent ribbon button call the literal same `ctx.onXxx` function,
// never two independently-wired copies that could drift apart. See lib/commandRegistry.js's own
// header for the rest of that argument.
export default function Ribbon({ ctx }) {
  const outerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { visibleKeys, overflowKeys } = computeRibbonLayout(containerWidth, RIBBON_GROUPS, MORE_BUTTON_WIDTH);

  return (
    <div
      ref={outerRef}
      data-testid="model-ribbon"
      style={{
        display: "flex", alignItems: "center", flexWrap: "nowrap", overflow: "hidden",
        gap: 0, padding: "5px 8px", minHeight: 36,
        background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)",
      }}
    >
      {/* Real hover/active/disabled/focus states, on top of the app's own global button rules
          (index.css's shared brightness-dip hover + disabled + focus-visible ring, which every
          plain <button> here already gets for free): a chrome-tinted background wash on hover
          for a non-pressed control, and a brightness lift on hover for one already pressed (so a
          toggled-ON control darkens rather than losing its accent fill). Scoped to this
          container so it never leaks onto unrelated chrome. */}
      <style>{`
        [data-testid="model-ribbon"] button:hover:not(:disabled):not([aria-pressed="true"]) { background: var(--hover-chrome); }
        [data-testid="model-ribbon"] button[aria-pressed="true"]:hover:not(:disabled) { filter: brightness(1.08); }
      `}</style>
      {visibleKeys.map((key, i) => {
        const Content = GROUP_RENDER[key];
        return (
          <span key={key} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 && <Divider />}
            <Content ctx={ctx} />
          </span>
        );
      })}
      {overflowKeys.length > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          {visibleKeys.length > 0 && <Divider />}
          <MoreMenu overflowKeys={overflowKeys} ctx={ctx} />
        </span>
      )}
    </div>
  );
}
