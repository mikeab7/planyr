/* Model workspace — the Home-tab ribbon (Stage 2, B1007281 — owner brief, modeled on Excel's
 * own Home tab since that's the reference he named): Clipboard, Font, Borders, Alignment,
 * Number, Cells, Sort & Filter. Everything acts on the current selection RANGE, never just the
 * active cell — select B2:D40, hit currency, all of them change.
 *
 * ⛔ LAYOUT REQUIREMENT (owner, verbatim): "the ribbon must WRAP or COLLAPSE into overflow menus
 * at narrow widths… I measured 'More formatting' at ZERO pixels wide" — that was the ORIGINAL
 * bug this stage exists to fix (the old single NumberFormatPicker in AppHeader's toolbar). This
 * component measures its OWN container width (ResizeObserver, never window width — a sidebar or
 * a narrower host would make window width lie) and hands it to lib/ribbonLayout.js's pure
 * computeRibbonLayout, which decides — deterministically, unit-tested without a browser — which
 * GROUPS stay inline and which collapse into their OWN small "…" popover, lowest-priority group
 * first. Verified live at 729 / 1024 / full width (see the PR).
 *
 * Every control is a plain token-driven button/dropdown built from this app's own primitives
 * (AnchoredMenu, MenuItem) — no new overlay mechanism, matching docs/DESIGN.md's rule that a new
 * control extends the shared primitive set rather than being invented at the call site.
 */
import { useLayoutEffect, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { MenuItem, menuPanelStyle } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { NUMBER_FORMATS, formatLabelFor } from "../lib/numberFormats.js";
import { computeRibbonLayout, RIBBON_GROUPS, MORE_BUTTON_WIDTH } from "../lib/ribbonLayout.js";

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

function ribbonBtnStyle(active, extra) {
  return {
    height: 26, minWidth: 26, padding: "0 6px", borderRadius: RADIUS.control, boxSizing: "border-box",
    border: `1px solid ${active ? "var(--accent-model)" : "var(--border-default)"}`,
    background: active ? "var(--accent-model)" : "var(--surface-page)",
    color: active ? "var(--on-accent-model)" : "var(--text-primary)",
    font: "inherit", fontSize: 12, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3,
    ...extra,
  };
}

function Divider() {
  return <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", margin: "3px 4px", background: "var(--border-default)", flex: "none" }} />;
}

/** A button that opens an AnchoredMenu — the one dropdown shape every menu-backed control below
 *  (font family/size, borders "More", valign, merge, number format, insert/delete, freeze) is
 *  built from. Clicking anything inside auto-closes it (every consumer here is a pick-one list). */
function DropdownButton({ label, title, width = 190, active, disabled, minWidth, children }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button" ref={anchorRef} title={title} disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={ribbonBtnStyle(active, { minWidth: minWidth || 26, padding: "0 6px", opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" })}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      <AnchoredMenu open={open && !disabled} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={width} panelStyle={menuPanelStyle}>
        <div onClick={() => setOpen(false)}>{children}</div>
      </AnchoredMenu>
    </span>
  );
}

/** A small palette-grid colour picker (text colour / fill colour) — deliberately its own, small,
 *  self-contained popover rather than the shared ColorField (that component's `pick`/`onSwatch`
 *  contract is built around the markup module's own livePick-with-history session; the ribbon's
 *  colour choice is a single discrete commit, exactly what `onPick` here already is). "No fill" /
 *  default text colour is the trailing swatch in each palette (a transparent checkerboard, or
 *  plain "A", rather than a seventh colour). */
function ColorSwatchButton({ label, title, value, palette, onPick, defaultSwatchLabel }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" ref={anchorRef} title={title} onClick={() => setOpen((o) => !o)} style={ribbonBtnStyle(false, { flexDirection: "column", gap: 0, padding: "1px 4px", width: 26 })}>
        <span style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1 }}>{label}</span>
        <span aria-hidden="true" style={{ width: 15, height: 3, marginTop: 2, background: value || "var(--border-default)", border: value ? "none" : "1px solid var(--border-default)" }} />
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={148} panelStyle={menuPanelStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 4, padding: 6 }}>
          {palette.map((hex) => (
            <button
              key={hex} type="button" title={hex === "transparent" ? defaultSwatchLabel : hex}
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

function edgeCSS(token) {
  if (!token) return "1px solid transparent";
  return token === "double" ? "3px double currentColor" : "2px solid currentColor";
}
/** A tiny CSS-only preview of which edges a border button/menu-item applies — no icon font or
 *  SVG dependency needed for four rectangle edges. */
function BorderGlyph({ top, right, bottom, left }) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: 15, height: 11, boxSizing: "border-box", flex: "none",
      borderTop: edgeCSS(top), borderRight: edgeCSS(right), borderBottom: edgeCSS(bottom), borderLeft: edgeCSS(left),
    }} />
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
// group's controls as a flex row; used both inline and inside a collapsed group's own popover. --

function ClipboardGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <button type="button" data-testid="ribbon-format-painter" title="Format Painter — copy this cell's look onto another"
        onClick={ctx.onFormatPainterToggle} aria-pressed={ctx.painterArmed}
        style={ribbonBtnStyle(ctx.painterArmed, { minWidth: 40, fontWeight: 700 })}>Paint</button>
      <button type="button" data-testid="ribbon-clear-format" title="Clear Formatting" onClick={ctx.onClearFormatting}
        style={ribbonBtnStyle(false, { minWidth: 40 })}>Clear</button>
    </span>
  );
}

function FontGroup({ ctx }) {
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
      <button type="button" data-testid="ribbon-bold" title="Bold" aria-pressed={!!s.bold} onClick={() => ctx.onSetCellStyle({ bold: s.bold ? null : true })} style={ribbonBtnStyle(!!s.bold, { fontWeight: 800 })}>B</button>
      <button type="button" data-testid="ribbon-italic" title="Italic" aria-pressed={!!s.italic} onClick={() => ctx.onSetCellStyle({ italic: s.italic ? null : true })} style={ribbonBtnStyle(!!s.italic, { fontStyle: "italic" })}>I</button>
      <button type="button" data-testid="ribbon-underline" title="Underline" aria-pressed={!!s.underline} onClick={() => ctx.onSetCellStyle({ underline: s.underline ? null : true })} style={ribbonBtnStyle(!!s.underline, { textDecoration: "underline" })}>U</button>
      <button type="button" data-testid="ribbon-strike" title="Strikethrough" aria-pressed={!!s.strike} onClick={() => ctx.onSetCellStyle({ strike: s.strike ? null : true })} style={ribbonBtnStyle(!!s.strike, { textDecoration: "line-through" })}>S</button>
      <ColorSwatchButton label="A" title="Text colour" value={s.color} palette={TEXT_PALETTE} defaultSwatchLabel="Default text colour" onPick={(hex) => ctx.onSetCellStyle({ color: hex })} />
      <ColorSwatchButton label="Fill" title="Fill colour" value={s.fill} palette={FILL_PALETTE} defaultSwatchLabel="No fill" onPick={(hex) => ctx.onSetCellStyle({ fill: hex })} />
    </span>
  );
}

function BordersGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {/* First-class buttons — a subtotal row's TOP border and a total row's DOUBLE BOTTOM
          border, one click each, never buried inside the "More" list below. */}
      <button type="button" data-testid="ribbon-border-top" title="Top Border (subtotal row)" onClick={() => ctx.onApplyBorder({ edges: ["top"], style: "thin", mode: "outline" })} style={ribbonBtnStyle(false)}><BorderGlyph top="thin" /></button>
      <button type="button" data-testid="ribbon-border-bottom-double" title="Bottom Border, double (total row)" onClick={() => ctx.onApplyBorder({ edges: ["bottom"], style: "double", mode: "outline" })} style={ribbonBtnStyle(false)}><BorderGlyph bottom="double" /></button>
      <DropdownButton label="More" title="More border options" width={190} minWidth={54}>
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["top", "right", "bottom", "left"], style: "thin", mode: "outline" })}><BorderGlyph top="thin" right="thin" bottom="thin" left="thin" /> <span style={{ marginLeft: 6 }}>Outline</span></MenuItem>
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["top", "right", "bottom", "left"], style: "thin", mode: "all" })}><BorderGlyph top="thin" right="thin" bottom="thin" left="thin" /> <span style={{ marginLeft: 6 }}>All borders</span></MenuItem>
        <div style={{ height: 1, margin: "4px 0", background: "var(--border-default)" }} />
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["top"], style: "thin", mode: "outline" })}>Top edge</MenuItem>
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["right"], style: "thin", mode: "outline" })}>Right edge</MenuItem>
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["bottom"], style: "thin", mode: "outline" })}>Bottom edge</MenuItem>
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["left"], style: "thin", mode: "outline" })}>Left edge</MenuItem>
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["bottom"], style: "double", mode: "outline" })}>Bottom edge, double</MenuItem>
        <div style={{ height: 1, margin: "4px 0", background: "var(--border-default)" }} />
        <MenuItem onClick={() => ctx.onApplyBorder({ edges: ["top", "right", "bottom", "left"], style: null, mode: "all" })}>No border</MenuItem>
      </DropdownButton>
    </span>
  );
}

const VALIGN_OPTIONS = [{ id: "top", label: "Top" }, { id: "middle", label: "Middle" }, { id: "bottom", label: "Bottom" }];

function AlignmentGroup({ ctx }) {
  const s = ctx.activeStyle;
  // This app's own existing default (every cell, always) is vertically CENTERED — "Middle" is
  // the implicit/default option (valign: null), never "Bottom" (Excel's own default, but
  // adopting it here would silently reflow every already-typed cell in the whole app).
  const valignLabel = VALIGN_OPTIONS.find((v) => v.id === s.valign)?.label || "Middle";
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <button type="button" data-testid="ribbon-align-left" title="Align left" aria-pressed={s.align === "left"} onClick={() => ctx.onSetCellStyle({ align: "left" })} style={ribbonBtnStyle(s.align === "left")}><AlignGlyph align="left" /></button>
      <button type="button" data-testid="ribbon-align-center" title="Align center" aria-pressed={s.align === "center"} onClick={() => ctx.onSetCellStyle({ align: "center" })} style={ribbonBtnStyle(s.align === "center")}><AlignGlyph align="center" /></button>
      <button type="button" data-testid="ribbon-align-right" title="Align right" aria-pressed={s.align === "right"} onClick={() => ctx.onSetCellStyle({ align: "right" })} style={ribbonBtnStyle(s.align === "right")}><AlignGlyph align="right" /></button>
      <DropdownButton label={valignLabel} title="Vertical alignment" width={110} minWidth={54}>
        {VALIGN_OPTIONS.map((v) => <MenuItem key={v.id} active={(s.valign || "middle") === v.id} onClick={() => ctx.onSetCellStyle({ valign: v.id === "middle" ? null : v.id })}>{v.label}</MenuItem>)}
      </DropdownButton>
      <button type="button" data-testid="ribbon-wrap" title="Wrap text" aria-pressed={!!s.wrap} onClick={() => ctx.onSetCellStyle({ wrap: s.wrap ? null : true })} style={ribbonBtnStyle(!!s.wrap, { fontSize: 10, fontWeight: 700 })}>Wrap</button>
      <button type="button" data-testid="ribbon-indent-dec" title="Decrease indent" onClick={() => ctx.onSetCellStyle({ indent: Math.max(0, (s.indent || 0) - 1) || null })} style={ribbonBtnStyle(false)}>⇤</button>
      <button type="button" data-testid="ribbon-indent-inc" title="Increase indent" onClick={() => ctx.onSetCellStyle({ indent: (s.indent || 0) + 1 })} style={ribbonBtnStyle(false)}>⇥</button>
      <DropdownButton label="Merge" title="Merge cells" width={170} minWidth={54}>
        <MenuItem onClick={ctx.onMergeToggle}>{ctx.mergedHere ? "Unmerge Cells" : "Merge Cells"}</MenuItem>
      </DropdownButton>
    </span>
  );
}

function NumberGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <DropdownButton label={formatLabelFor(ctx.activeFormat)} title="Number format" width={210} minWidth={90}>
        {NUMBER_FORMATS.map((f) => (
          <MenuItem key={f.id} active={(f.token || null) === (ctx.activeFormat || null)} onClick={() => ctx.onApplyFormat(f.token)}>{f.label}</MenuItem>
        ))}
      </DropdownButton>
      <button type="button" data-testid="ribbon-pct" title="Percent style" onClick={() => ctx.onApplyFormat("0.0%")} style={ribbonBtnStyle(false)}>%</button>
      <button type="button" data-testid="ribbon-currency" title="Currency style" onClick={() => ctx.onApplyFormat("$#,##0.00")} style={ribbonBtnStyle(false)}>$</button>
      <button type="button" data-testid="ribbon-comma" title="Thousands separator" onClick={() => ctx.onNumberFormatOp("toggleThousands")} style={ribbonBtnStyle(false)}>,</button>
      <button type="button" data-testid="ribbon-dec-inc" title="Increase decimal" onClick={() => ctx.onNumberFormatOp("increaseDecimals")} style={ribbonBtnStyle(false, { fontSize: 10.5 })}>.0→</button>
      <button type="button" data-testid="ribbon-dec-dec" title="Decrease decimal" onClick={() => ctx.onNumberFormatOp("decreaseDecimals")} style={ribbonBtnStyle(false, { fontSize: 10.5 })}>→.0</button>
    </span>
  );
}

function CellsGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <DropdownButton label="Insert" title="Insert rows or columns" width={160} minWidth={54}>
        <MenuItem onClick={ctx.onInsertRow}>Row above</MenuItem>
        <MenuItem onClick={ctx.onInsertColumn}>Column left</MenuItem>
      </DropdownButton>
      <DropdownButton label="Delete" title="Delete rows or columns" width={140} minWidth={54}>
        <MenuItem onClick={ctx.onDeleteRow}>Row</MenuItem>
        <MenuItem onClick={ctx.onDeleteColumn}>Column</MenuItem>
      </DropdownButton>
      <DropdownButton label="Freeze" title="Freeze panes" width={170} minWidth={54}>
        <MenuItem onClick={ctx.onSetFreezeTopRow}>Freeze top row</MenuItem>
        <MenuItem onClick={ctx.onSetFreezeFirstColumn}>Freeze first column</MenuItem>
        <MenuItem onClick={ctx.onSetFreezeAtSelection}>Freeze panes (at selection)</MenuItem>
        {(ctx.freezeRows > 0 || ctx.freezeCols > 0) && <MenuItem onClick={ctx.onUnfreeze}>Unfreeze panes</MenuItem>}
      </DropdownButton>
    </span>
  );
}

function SortFilterGroup({ ctx }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <button type="button" data-testid="ribbon-sort-asc" title="Sort A to Z" onClick={() => ctx.onSort("asc")} style={ribbonBtnStyle(false, { fontSize: 10.5, minWidth: 34 })}>A→Z</button>
      <button type="button" data-testid="ribbon-sort-desc" title="Sort Z to A" onClick={() => ctx.onSort("desc")} style={ribbonBtnStyle(false, { fontSize: 10.5, minWidth: 34 })}>Z→A</button>
      <button type="button" data-testid="ribbon-filter" title="Toggle AutoFilter" aria-pressed={ctx.filterOn} onClick={ctx.onFilterToggle} style={ribbonBtnStyle(ctx.filterOn, { minWidth: 44, fontSize: 10.5 })}>Filter</button>
    </span>
  );
}

const GROUP_RENDER = { clipboard: ClipboardGroup, font: FontGroup, borders: BordersGroup, alignment: AlignmentGroup, number: NumberGroup, cells: CellsGroup, sortfilter: SortFilterGroup };
// A short glyph for a collapsed group's own trigger button — never text, so it stays legible at
// the tiny width a collapsed group gets.
const GROUP_ICON = { clipboard: "Clip", font: "Aa", borders: "▦", alignment: "≡", number: "#", cells: "⊞", sortfilter: "⇅" };

/** One collapsed group's own small trigger + popover — its FULL content (the same GROUP_RENDER
 *  component used inline) rendered stacked inside, with a label heading so it reads standalone. */
function CollapsedGroup({ groupKey, ctx }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const meta = RIBBON_GROUPS.find((g) => g.key === groupKey);
  const Content = GROUP_RENDER[groupKey];
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" ref={anchorRef} title={meta?.label} aria-label={meta?.label} onClick={() => setOpen((o) => !o)} style={ribbonBtnStyle(open, { fontSize: 13 })}>
        {GROUP_ICON[groupKey] || "…"}
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={280} panelStyle={{ ...menuPanelStyle, padding: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 6 }}>{meta?.label}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}><Content ctx={ctx} /></div>
      </AnchoredMenu>
    </span>
  );
}

export default function Ribbon({
  activeFormat, activeStyle, mergedHere, freezeRows, freezeCols, painterArmed, filterOn,
  onSetCellStyle, onApplyBorder, onApplyFormat, onNumberFormatOp, onClearFormatting,
  onFormatPainterToggle, onMergeToggle,
  onInsertRow, onInsertColumn, onDeleteRow, onDeleteColumn,
  onSetFreezeTopRow, onSetFreezeFirstColumn, onSetFreezeAtSelection, onUnfreeze,
  onSort, onFilterToggle,
}) {
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

  const ctx = {
    activeFormat, activeStyle: activeStyle || {}, mergedHere, freezeRows, freezeCols, painterArmed, filterOn,
    onSetCellStyle, onApplyBorder, onApplyFormat, onNumberFormatOp, onClearFormatting,
    onFormatPainterToggle, onMergeToggle,
    onInsertRow, onInsertColumn, onDeleteRow, onDeleteColumn,
    onSetFreezeTopRow, onSetFreezeFirstColumn, onSetFreezeAtSelection, onUnfreeze,
    onSort, onFilterToggle,
  };

  const { visibleKeys, overflowKeys } = computeRibbonLayout(containerWidth, RIBBON_GROUPS, MORE_BUTTON_WIDTH);

  return (
    <div
      ref={outerRef}
      data-testid="model-ribbon"
      style={{
        display: "flex", alignItems: "center", flexWrap: "nowrap", overflow: "hidden",
        gap: 0, padding: "4px 8px", minHeight: 34,
        background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)",
      }}
    >
      {/* Stage 2 visual pass — real hover states on every ribbon trigger button, with zero
          per-button changes: scoped to this container so it never leaks onto unrelated chrome,
          and skips a PRESSED (aria-pressed) button's own hover so an active toggle darkens
          rather than losing its accent fill. Portaled dropdown/popover CONTENT (AnchoredMenu's
          own `.menu` class) already gets a hover state for free from index.css's existing
          `.menu button:hover` rule — this only needs to cover the trigger row itself. */}
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
          <span style={{ display: "inline-flex", gap: 3 }}>
            {overflowKeys.map((key) => <CollapsedGroup key={key} groupKey={key} ctx={ctx} />)}
          </span>
        </span>
      )}
    </div>
  );
}
