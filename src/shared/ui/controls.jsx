/* Shared control primitives (B657-5B) — ONE radius / padding / typography scale and ONE
 * documented "active-control accent" rule, so every React-shell tab's controls read as a
 * single design language while each module keeps its own accent.
 *
 * Token-driven + theme-safe: these components reference CSS theme tokens ONLY, never a raw
 * hex, so the contrast audit (ui-audit/contrast-audit.mjs) guards every color they paint.
 * MODULE SCOPE only (never define a component inside another component's render).
 *
 * Active-control accent rule: `accent` defaults to var(--accent) — the shared interactive
 * "drafting" accent used across the app. A host overrides it (with the matching on-accent
 * text token) where its module hue belongs — e.g. the Library passes
 * accent="var(--accent-library)" onAccent="var(--on-accent-library)". Module accents are
 * NOT flattened; there is exactly one rule ("active control fill = the surface's interactive
 * accent, --accent unless the host overrides").
 */
import { forwardRef, useState } from "react";
import { NO_AUTOFILL } from "./noAutofill.js";
// The single source of the control scale. Radius 8 is the median of the pre-convergence
// spread (6/7/8/9) and already the Site Planner chip/iconBtn value — the smallest net move.
/* ⛔ B427411 — THESE THREE AGREE WITH `shared/ui/radius.js` BY VALUE, AND THEY STAY LITERAL.
 *
 * This partial scale predates that file and is why the scale's numbers are 6/8/12/999 rather than
 * a rounder-looking 10/14: adopting what the tree already agreed on made the map-chrome pass a
 * consolidation instead of a restyle. `control === md`, `pill === pill`, `panel === lg`.
 *
 * ⛔ Do NOT "tidy" this into `{ control: RADIUS.md, … }`. It was tried and it breaks the build:
 * `test/notesModule.test.js` regex-parses the DIGITS out of this line and cross-checks them
 * against seven Notes components that hand-copy `{ control: 8, pill: 999 }` under a "mirrored
 * from shared/ui/controls" comment. An identifier where a number was leaves that contract with
 * nothing to read. Repointing those seven copies is the real fix and is a known follow-up on
 * B427411 — Notes is neither the map chrome nor the header, and re-styling a workspace nobody
 * reported is scope that block did not ask for. If you change a number here, change it there.
 *
 * ⛔ RENAMED FROM `RADIUS` TO `CONTROL_RADIUS` (NEW-1, design-token collision fix). This object
 * and `shared/ui/radius.js`'s own `RADIUS` (keys `pill`/`sm`/`md`/`lg`) were BOTH exported under
 * the identical name `RADIUS` from two different modules — which key set was valid depended
 * entirely on which module a file happened to import from, and a miss (`RADIUS.control` against
 * `radius.js`'s scale) silently evaluated to `undefined`, which React drops from a style object
 * and ships as a flat 0-radius corner (exactly what shipped on every ribbon button in the Model
 * module — fixed in `Ribbon.jsx` by importing `radius.js`'s `RADIUS.sm` instead). Renaming this
 * one export — not `radius.js`'s, which is the real general-purpose scale documented in that
 * file's own header — resolves the collision while keeping every value, every key, and this
 * file's own literal-duplicate contract (above) untouched. Every importer was updated in the same
 * commit; `test/notesModule.test.js`'s regex now reads `CONTROL_RADIUS`. */
export const CONTROL_RADIUS = { control: 8, pill: 999, panel: 12 };
export const PAD = { sm: "5px 10px", md: "7px 12px", lg: "9px 14px" };
// B915536's NEW-1 (2026-08-31) reduced FONT_SIZE to 5 named roles; this pair now tracks
// FONT_SIZE.label (compact/secondary controls: ToggleChip, Button size="sm") and
// FONT_SIZE.control (standard controls: Button default/lg, MenuItem) — a real, deliberate
// 1.5px gap rather than the old 1px one, so "compact" reads as genuinely smaller, not a rounding
// difference. Kept as a literal duplicate for the same reason RADIUS above is: see that block's
// header.
export const FONT = { sm: 10.5, md: 12 };
const REST_SHADOW = "0 1px 2px rgba(0,0,0,0.05)"; // neutral, token-independent — kills the stale colored ember shadows

/* SIZE — the ONE size decision for a chrome control (B982400, NEW-1). Every measured map/header
 * chip — the account pill, "Drop a pin", the collapsed "Imagery & layers" pill, the nav tabs'
 * OWN row height — is built the same way: a fixed height, horizontal-only padding, and a single
 * font size, picked independently at each call site. That is FOUR separate decisions per control,
 * which is why seven different (radius, height, padding, font) combinations coexisted in one
 * screen with nobody having chosen that on purpose. SIZE collapses it to ONE decision: `sm` or
 * `md`. Values are literal duplicates of `designTokens.js`'s CONTROL_H.md/lg and
 * FONT_SIZE.control — not an import, for the same reason CONTROL_RADIUS/PAD/FONT above are
 * literal duplicates (see that block's header): this file is in the shared entry chunk. Change
 * one, change both.
 *   sm  height 26 (CONTROL_H.md) — dense/toolbar/map chrome. The nav tabs are the one deliberate
 *       exception (their own `Tab` primitive below, not this bundle — see its header).
 *   md  height 30 (CONTROL_H.lg) — primary standalone actions: the account pill, a menu trigger,
 *       an icon button (IconButton's own default size, unchanged, already agrees with this).
 * NEW-2 (top-right toolbar cluster, Option B) — this is also now the ONE shared height every
 * bordered control in the app header's row-1/row-2 right-zone cluster uses (the sync-status icon,
 * the open-tabs badge, Full screen, Settings, and the account/"Sign in"/"Cloud off" trigger — see
 * AppHeader.jsx/CloudSyncBadge.jsx/PresenceChip.jsx/AccountControl.jsx). A fourth `lg` (32) step
 * was tried first and reverted: `md` (30) is already the value every one of those controls (and
 * several others already sharing their exact shape elsewhere on the same screen — the global
 * help/report FAB, the project-breadcrumb triggers) had independently converged on before this
 * item, so inventing a new number only fragmented an existing, wider convergence into two
 * near-identical shapes instead of unifying one — caught by `ui-audit/ui-inventory.mjs`'s
 * per-surface signature-budget CI gate on the Map landing page (26 vs. a 24 ceiling). Radius is
 * always `CONTROL_RADIUS.control` (8) for both steps — a chip built from this bundle is always a
 * STANDALONE control per docs/DESIGN.md's shape rule, never nested, so it never takes `sm`(6).
 */
export const SIZE = {
  sm: { height: 26, padding: "0 10px", fontSize: 12 },
  md: { height: 30, padding: "0 12px", fontSize: 12 },
};

/* LOUD-FAILURE for a locked primitive's geometry escape hatch (B982400). Silently DROPPING a
 * caller's `style`/`borderRadius`/`height`/`padding`/`fontSize` (which Tab/MenuTrigger do — see
 * their own destructuring) would itself be a silent failure: the caller believes the override
 * took effect. This is the dev-time half; `ui-audit/locked-primitive-audit.mjs` is the CI half
 * that fails the build on the same call sites before they ever run. */
function warnLockedOverride(name, props) {
  if (typeof import.meta === "undefined" || !import.meta.env || !import.meta.env.DEV) return;
  const banned = ["style", "borderRadius", "height", "padding", "fontSize"].filter((k) => props[k] !== undefined);
  if (banned.length) {
    console.error(`${name}: ${banned.join("/")} ${banned.length > 1 ? "are" : "is"} not allowed — its radius/height/padding/fontSize are a locked size bundle (docs/DESIGN.md's shape rule). The prop was silently ignored; wrap it in a layout element instead.`);
  }
}

/* Button — variant primary | ghost | danger; size sm | md | lg. `active` renders a ghost as
 * filled (a pressed toggle). `accent`/`onAccent` set the filled color (default: the global
 * interactive accent). Ref-forwarding (NEW-1, map-view conversion) so a caller can anchor a menu
 * off it directly, like IconButton/MenuTrigger already do — a split "primary action + its own
 * menu caret" pairing (e.g. MapFinder's "Select parcels ▾") needs the caret half's own ref. */
export const Button = forwardRef(function Button({ variant = "primary", size = "md", active = false, accent = "var(--accent)", onAccent = "var(--on-accent)", disabled = false, style, children, ...rest }, ref) {
  const filled = variant === "primary" || active;
  const base = {
    padding: PAD[size] || PAD.md,
    fontSize: size === "sm" ? FONT.sm : FONT.md,
    borderRadius: CONTROL_RADIUS.control,
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    fontWeight: 600,
    boxShadow: REST_SHADOW,
    opacity: disabled ? 0.5 : 1,
  };
  let skin;
  if (variant === "danger" && !active) {
    skin = { border: "1px solid var(--danger-text)", background: "var(--surface-raised)", color: "var(--danger-text)" };
  } else if (!filled) {
    skin = { border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)" };
  } else {
    skin = { border: `1px solid ${accent}`, background: accent, color: onAccent };
  }
  return <button ref={ref} disabled={disabled} style={{ ...base, ...skin, ...style }} {...rest}>{children}</button>;
});

/* ToggleChip — a pill toggle (the FileBrowser / TeamPanel chip anatomy, unified). */
export function ToggleChip({ active = false, accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }) {
  return (
    <button style={{
      padding: "6px 11px", fontSize: FONT.sm, borderRadius: CONTROL_RADIUS.pill, cursor: rest.disabled ? "default" : "pointer", fontFamily: "inherit", fontWeight: active ? 650 : 500,
      border: `1px solid ${active ? accent : "var(--border-default)"}`,
      background: active ? accent : "var(--surface-raised)",
      color: active ? onAccent : "var(--text-primary)",
      boxShadow: REST_SHADOW, ...style,
    }} {...rest}>{children}</button>
  );
}

/* SegmentedControl — ONE shape for "pick one of N" (NEW-1, food controls, 2026-10-04). Before this
 * there was no shared primitive: /food built two by hand (Map | List with a square-cornered shell and
 * a filled-to-the-edge segment; Site Plan | Hybrid with a pill shell, dark-on-orange text) and they
 * disagreed on shape AND on the active text colour, on the same screen. The shell is `md` — the
 * family of every Button / field it sits beside (docs/DESIGN.md's sibling clause: converge onto the
 * neighbours' family rather than put a pill flush against `md` controls) — and each segment is
 * NESTED in it, concentric by `nestedIn(md, gap)` = `sm`, so a gap of 2 (1px border + 1px padding)
 * keeps the filled segment visibly inside the shell instead of flush against it. This is also the
 * shape the Site Plan's own aerial-source segmented control (LayerPanel's `Off | Aerial | USGS`) already
 * uses — a rounded-rectangle shell, never a capsule.
 * Height is SIZE.md (30, CONTROL_H.lg) — the app's standalone-control height — so a segmented control
 * sits level with a Button beside it. `accent`/`onAccent` follow the module like every other
 * primitive here (/food passes its own pair; the text on a solid module fill is always that module's
 * `--on-accent-*`, never a bare colour). Options: { key, label, title?, testid? }. */
// nestedIn(8, 2) — the concentric inner radius for a segment inside the md shell (= RADIUS.sm, 6).
const SEGMENT_RADIUS = 6;
export function SegmentedControl({ options, value, onChange, accent = "var(--accent)", onAccent = "var(--on-accent)", style, segmentStyle, ...rest }) {
  return (
    <div role="group" style={{
      display: "inline-flex", flex: "none", boxSizing: "border-box", height: SIZE.md.height, padding: 1,
      border: "1px solid var(--border-default)", borderRadius: CONTROL_RADIUS.control, background: "var(--surface-raised)", boxShadow: REST_SHADOW, ...style,
    }} {...rest}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={on} title={o.title} data-testid={o.testid} disabled={!!o.disabled}
            style={{
              border: "none", cursor: o.disabled ? "default" : "pointer", opacity: o.disabled ? 0.5 : 1, fontFamily: "inherit", fontSize: FONT.md, fontWeight: on ? 700 : 600,
              height: "100%", padding: "0 12px", borderRadius: SEGMENT_RADIUS,
              background: on ? accent : "transparent", color: on ? onAccent : "var(--text-primary)", ...segmentStyle,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* FloatingToolbar / FloatingToolButton / FloatingToolDivider — the DARK variant (NEW-1, 2026-10-15, owner-approved crop
 * mockup): a small pill of tools that floats OVER a photo or drawing (the crop dialog's undo / reset / pan / zoom row).
 * Like the crop tool's scrim and handles, its skin is deliberately fixed dark and does NOT follow the app theme — it
 * has to read over an arbitrary uploaded picture, not over the app's own surfaces, so no theme token applies. The
 * caller positions it (absolute, bottom-centre); these only own the look. A button is icon-only (aria-label required
 * at the call site) or icon + word; `active` is a pressed toggle; a disabled button dims its icon colour. */
const FT_BG = "rgba(24,26,32,0.95)"; // design-exempt: fixed over-the-drawing chrome — see header
const FT_BORDER = "1px solid rgba(255,255,255,0.10)"; // design-exempt: fixed over-the-drawing chrome — see header
const FT_SHADOW = "0 4px 16px rgba(0,0,0,0.4)"; // design-exempt: fixed over-the-drawing chrome — see header
const FT_TEXT = "#E8EAED"; // design-exempt: fixed over-the-drawing chrome — see header
const FT_TEXT_OFF = "#6B7079"; // design-exempt: fixed over-the-drawing chrome — dimmed icon colour for a disabled tool
const FT_ON = "rgba(255,255,255,0.18)"; // design-exempt: fixed over-the-drawing chrome — a pressed toggle
const FT_RULE = "rgba(255,255,255,0.16)"; // design-exempt: fixed over-the-drawing chrome — divider hairline
export const FloatingToolbar = forwardRef(function FloatingToolbar({ style, children, ...rest }, ref) {
  return (
    <div ref={ref} role="toolbar" style={{
      display: "flex", alignItems: "center", gap: 2, padding: 4, background: FT_BG, border: FT_BORDER,
      borderRadius: 10, boxShadow: FT_SHADOW, ...style, // design-exempt: 10 = the pill's own shell, one step over the 8 control radius it holds (nested 7)
    }} {...rest}>{children}</div>
  );
});
export const FloatingToolButton = forwardRef(function FloatingToolButton({ active = false, disabled = false, compact = false, style, children, ...rest }, ref) {
  const h = compact ? 30 : 34;
  return (
    <button ref={ref} type="button" disabled={disabled} aria-pressed={active ? true : undefined} style={{
      minWidth: h, height: h, padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flex: "none",
      border: "none", borderRadius: 7, background: active ? FT_ON : "transparent", color: disabled ? FT_TEXT_OFF : FT_TEXT, // design-exempt: 7 = concentric inner radius of the pill shell
      fontFamily: "inherit", fontSize: FONT.md, fontWeight: 500, fontVariantNumeric: "tabular-nums", cursor: disabled ? "default" : "pointer", ...style,
    }} {...rest}>{children}</button>
  );
});
export function FloatingToolDivider() {
  return <span aria-hidden="true" style={{ width: 1, height: 20, background: FT_RULE, margin: "0 6px", flex: "none" }} />;
}

/* IconButton — the square icon slot (the Site Planner iconBtn, token-only). Ref-forwarding so
 * it can anchor an AnchoredMenu directly, like any other trigger element. */
export const IconButton = forwardRef(function IconButton({ size = 30, active = false, accent = "var(--accent)", onAccent = "var(--on-accent)", style, className, children, ...rest }, ref) {
  return (
    // NEW-1 (B1343200) — `tap-target` (index.css) floors this control's tap area at 44x44 CSS px
    // regardless of `size`, without growing its visible box. See that class's own header.
    <button ref={ref} className={className ? `tap-target ${className}` : "tap-target"} style={{
      width: size, height: size, padding: 0, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
      borderRadius: CONTROL_RADIUS.control, cursor: rest.disabled ? "default" : "pointer", boxShadow: REST_SHADOW,
      border: `1px solid ${active ? accent : "var(--border-default)"}`,
      background: active ? accent : "var(--surface-raised)",
      color: active ? onAccent : "var(--text-primary)", ...style,
    }} {...rest}>{children}</button>
  );
});

/* Field — a label + control row (lifted verbatim from the Site Planner inspector; token-clean).
 * `stacked` — label ABOVE the control instead of beside it, so the control gets the panel's
 * full width. Use in any narrow host (a rail panel) where the default label-left row leaves a
 * field squeezed into half the available width. `required` appends a small inline marker to
 * the label — the one convention for a required field, so a form never invents its own.
 *
 * `tight` (NEW-12, B1123424) — a THIRD row style, for read-only label/value pairs (a detail
 * view, never a form): the label sits at its own natural width (never stretched, never
 * wrapped — `flex:"0 0 auto"` + `whiteSpace:"nowrap"`) immediately followed by the value in
 * the remaining space, with a small fixed gap between them. The default (`space-between`)
 * row pushes the value to the far right edge, which reads fine for a wide value but strands a
 * short one ("Term" / "126 mo") at opposite ends of an otherwise-empty shelf — `tight` is the
 * fix for that specific complaint, additive only: every existing non-tight Field call renders
 * byte-identically. */
export function Field({ label, children, stacked = false, required = false, tight = false }) {
  const labelNode = (
    <span style={{
      fontSize: stacked ? 11 : 12, fontWeight: stacked ? 600 : 400, color: "var(--text-secondary)",
      ...(tight ? { flex: "0 0 auto", whiteSpace: "nowrap" } : null),
    }}>
      {label}{required && <span style={{ color: "var(--danger-text)" }}> *</span>}
    </span>
  );
  if (stacked) {
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ marginBottom: 4 }}>{labelNode}</div>
        {children}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", justifyContent: tight ? "flex-start" : "space-between", alignItems: tight ? "baseline" : "center", gap: 10, marginBottom: 8 }}>
      {labelNode}
      {tight ? <span style={{ flex: "1 1 auto", minWidth: 0 }}>{children}</span> : children}
    </div>
  );
}

/* RangeFields — a labelled Min–Max pair of numeric inputs (NEW-1, Records filters, 2026-10-19): the one
 * shape for "between A and B" so a filter panel never hand-builds two boxes and a dash. Either end may be
 * blank (an open range). Values are STRINGS held by the caller; input is digits and one decimal point only,
 * and a resting value is shown with thousands separators ("100,000") while a focused one is raw, so a
 * typed digit never has its caret jumped by a live reformat. `single` renders just the Min box (a "at least"
 * filter) with `unit` after it. Browser autofill is opted out on both boxes. Module scope. */
function groupDigits(v) {
  if (v === "" || v == null) return "";
  const [i, f] = String(v).split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f != null ? `.${f}` : ""}`;
}
function RangeBox({ value, onChange, placeholder, label, unit, grouped = true }) {
  const [focused, setFocused] = useState(false);
  return (
    <span style={{ flex: "1 1 0", minWidth: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        {...NO_AUTOFILL} type="text" inputMode="decimal" aria-label={label} placeholder={placeholder}
        value={focused || !grouped ? (value ?? "") : groupDigits(value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, "").replace(/^(\d*\.\d*)\./, "$1"))}
        style={{
          flex: "1 1 auto", minWidth: 0, boxSizing: "border-box", height: SIZE.sm.height, padding: "0 8px", fontSize: FONT.md,
          border: "1px solid var(--border-default)", borderRadius: CONTROL_RADIUS.control, background: "var(--surface-raised)",
          color: "var(--text-primary)", fontFamily: "inherit", textAlign: "right",
        }}
      />
      {unit ? <span style={{ flex: "none", fontSize: FONT.sm, color: "var(--text-secondary)" }}>{unit}</span> : null}
    </span>
  );
}
export function RangeFields({ label, min, max, onChange, unit, single = false, grouped = true, minPlaceholder = "Min", maxPlaceholder = "Max" }) {
  return (
    <Field label={label} stacked>
      <span role="group" aria-label={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <RangeBox value={min} onChange={(v) => onChange({ min: v, max })} placeholder={single ? "Min" : minPlaceholder} label={`${label} ${single ? "minimum" : "min"}`} unit={single ? unit : null} grouped={grouped} />
        {single ? null : (
          <>
            <span aria-hidden="true" style={{ flex: "none", color: "var(--text-secondary)" }}>–</span>
            <RangeBox value={max} onChange={(v) => onChange({ min, max: v })} placeholder={maxPlaceholder} label={`${label} max`} unit={unit} grouped={grouped} />
          </>
        )}
      </span>
    </Field>
  );
}

/* Section — a collapsible titled group (lifted from the Site Planner inspector; the one
 * behavioral fix folded in: the border is now var(--border-default), not the light-only
 * #ece6d9 cream that never themed to dark). */
export function Section({ title, children, collapsed, accent }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div style={{ marginBottom: 9, background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: CONTROL_RADIUS.panel, boxShadow: REST_SHADOW, overflow: "hidden" }}>
      <div onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} aria-expanded={open} aria-label={title}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "10px 12px", userSelect: "none" }}>
        {accent && <span style={{ width: 6, height: 6, borderRadius: CONTROL_RADIUS.pill, background: accent, flex: "none" }} />}
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", flex: 1 }}>{title}</span>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s ease", width: 9 }}>▶</span>
      </div>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

/* Tab — a top-level workspace/nav tab (B982400, NEW-1). Deliberately its own primitive, NOT a
 * `Chip`/SIZE consumer: a tab's 0px-radius, full-row-height, underline-indicator shape is a
 * different family from every standalone chip on purpose (docs/DESIGN.md's shape rule already
 * reserves `pill` for containers and `md` for standalone chips — a tab is neither, it's a flush
 * segment of the row it lives in). Forcing it onto Chip would either give the nav row a radius it
 * was never meant to have or make Chip pretend to support a shape it doesn't. `height:"100%"` so
 * it fills whatever row hosts it (26px today) rather than carrying its own literal.
 * `fill` (the active underline + text) and `textColor` are separate props because the app already
 * distinguishes a tab's underline color from its text color per module (AppHeader.jsx's
 * ACCENT_FILL/ACCENT_TEXT) — collapsing them into one `accent` would lose that.
 * NEW-1: does not accept `style`, `borderRadius`, `height`, `padding` or `fontSize` — a caller
 * that wants a different look needs a different primitive, not an override. Layout spacing
 * (margin, order) belongs on a wrapping element. */
export function Tab({
  active = false, hover = false, fill = "var(--accent)", textColor = "var(--accent)",
  idleColor = "var(--text-secondary)", icon, children, className,
  style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize,
  ...rest
}) {
  warnLockedOverride("Tab", { style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize });
  return (
    <button
      aria-current={active ? "page" : undefined}
      // NEW-1 (B1343200) — `tap-target` floors this control's tap area at 44x44 CSS px without
      // growing the row's own height (which is exactly the "chunky" the brief rules out). See
      // index.css's own header for the mechanism.
      className={className ? `tap-target ${className}` : "tap-target"}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        height: "100%", padding: "0 9px",
        border: "none", borderBottom: `2px solid ${active ? fill : "transparent"}`,
        background: "transparent",
        color: active || hover ? textColor : idleColor,
        fontFamily: "inherit", fontSize: FONT.md,
        fontWeight: active ? 600 : 500,
        cursor: rest.disabled ? "default" : "pointer", whiteSpace: "nowrap",
        transition: "color 0.15s, border-color 0.15s",
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/* MenuTrigger — a size-locked chrome chip that opens a menu/popover/modal (B982400, NEW-1): the
 * account pill, "Sign in", the "Cloud off" explainer, "Select a project" — anything that is a
 * single control opening something ELSE, as opposed to `Button` (a dialog/panel action, its own
 * rest-shadow + weight) or `ToggleChip` (a filter/selection pill). `size` selects the ONE locked
 * (radius, height, padding, fontSize) bundle from `SIZE` above — never authored independently.
 * `leading` is an icon/avatar slot; `caret` (default true) draws the trailing ▾ — set false for a
 * trigger that opens something other than a dropdown menu (e.g. a popover with no menu shape).
 * `textColor` (default `--chrome-text`) is a scoped, non-geometric semantic override — e.g. a
 * "Cloud off" trigger reading as a deliberately MUTED state — never a general style escape hatch:
 * it sets one CSS color property, nothing a caller could use to relitigate the locked geometry.
 * NEW-1: does not accept `style`, `borderRadius`, `height`, `padding` or `fontSize` — if a caller
 * needs a different geometry, that is a signal to add a size step here, never to override one
 * call site. Layout spacing (margin, flex) belongs on a wrapping element.
 * NEW-2 (top-right toolbar cluster, Option B) — `children` is now OPTIONAL. A caller with nothing
 * to say beside its `leading` icon (the collapsed account avatar-only trigger) omits `children`
 * entirely; the middle text span is skipped rather than rendered empty, so the row's `gap` doesn't
 * insert a phantom double-space between `leading` and the caret. Every existing caller passes real
 * text and is unaffected. */
export const MenuTrigger = forwardRef(function MenuTrigger({
  size = "md", open, caret = true, leading, textColor = "var(--chrome-text)", children, className,
  style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize,
  ...rest
}, ref) {
  warnLockedOverride("MenuTrigger", { style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize });
  const s = SIZE[size] || SIZE.md;
  return (
    <button
      ref={ref}
      // NEW-1 (B1343200) — see IconButton's own note above; same 44x44 tap-area floor.
      className={className ? `tap-target ${className}` : "tap-target"}
      {...(open !== undefined ? { "aria-haspopup": "menu", "aria-expanded": open } : {})}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        height: s.height, padding: s.padding, maxWidth: 220,
        borderRadius: CONTROL_RADIUS.control, border: "1px solid var(--chrome-divider)",
        background: "var(--chrome-bg-elev)", color: textColor,
        cursor: rest.disabled ? "default" : "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: s.fontSize,
        whiteSpace: "nowrap",
      }}
      {...rest}
    >
      {leading}
      {children != null && children !== "" && (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>{children}</span>
      )}
      {caret && <span aria-hidden="true" style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>}
    </button>
  );
});

/* Switch — an on/off toggle that applies the moment it is flipped (a setting, not a pending choice).
 * `role="switch"` + `aria-checked`; the caller labels it (`aria-label` / `aria-labelledby`). Compact
 * (28×16) so it sits at the right of a menu row; flat track in the accent when ON, the field-border
 * grey when OFF; the knob is `--on-accent` on, `--text-secondary` off (never a faded grey). */
export const Switch = forwardRef(function Switch({ checked = false, accent = "var(--accent)", onAccent = "var(--on-accent)", disabled = false, decorative = false, style, ...rest }, ref) {
  const box = {
    position: "relative", display: "inline-block", width: 28, height: 16, flex: "none", padding: 0, borderRadius: CONTROL_RADIUS.pill, boxSizing: "border-box",
    border: `1px solid ${checked ? accent : "var(--border-strong, var(--border-default))"}`, background: checked ? accent : "var(--hover-ghost)",
    ...(disabled ? { opacity: 0.5 } : {}),
  };
  const knob = <span aria-hidden="true" style={{ position: "absolute", top: 2, left: checked ? 14 : 2, width: 10, height: 10, borderRadius: CONTROL_RADIUS.pill, background: checked ? onAccent : "var(--text-secondary)", transition: "left .12s" }} />;
  // `decorative`: the switch is only the PICTURE of a state whose real control is the enclosing row
  // (a `role="switch"` button) — a button inside a button is invalid, so it renders a plain span.
  if (decorative) return <span ref={ref} aria-hidden="true" style={{ ...box, ...style }} {...rest}>{knob}</span>;
  return (
    <button ref={ref} type="button" role="switch" aria-checked={!!checked} disabled={disabled} style={{ ...box, cursor: disabled ? "default" : "pointer", ...style }} {...rest}>{knob}</button>
  );
});

/* Menu primitives — a token-only flyout panel + item (the Site Planner menuPanel/menuItem). */
export const menuPanelStyle = { background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: CONTROL_RADIUS.panel, boxShadow: "0 16px 44px rgba(0,0,0,0.22), 0 3px 10px rgba(0,0,0,0.1)", padding: 6 };
// NEW-2 (B849585) — `disabled` gets a real, unmistakable treatment (opacity, matching Button's/
// IconButton's own `disabled → opacity: 0.5`), not just a `cursor` change: a disabled row that
// only differs from an enabled one by cursor is invisible until you try to click it.
export function MenuItem({ active = false, disabled = false, style, children, ...rest }) {
  return (
    <button disabled={disabled} style={{
      display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: FONT.md, borderRadius: CONTROL_RADIUS.control,
      border: "none", background: active ? "var(--hover-menu)" : "transparent", color: "var(--text-primary)", fontFamily: "inherit", fontWeight: active ? 650 : 500,
      cursor: disabled ? "default" : "pointer", ...(disabled ? { opacity: 0.5 } : {}), ...style,
    }} {...rest}>{children}</button>
  );
}

/* CURSOR VOCABULARY (lives in controls.jsx, not its own module: a separate file became its own Site-route chunk and tripped the chunk allowlist) — the ONE home for the app's cursor vocabulary (owner convention 2026-10-20, docs/DESIGN.md
 * "Cursor convention"). Two exports other surfaces share:
 *   ROTATE_CURSOR  — the single custom rotate cursor every rotate grip uses (an SVG data-URI with a
 *                    `grab` fallback so a browser that rejects the URI still shows a hand).
 *   pinDragCursor  — pins a cursor at the document root for the LIFE of a drag, so the cursor does not
 *                    flip back to whatever the pointer happens to be over once it leaves the grip.
 *                    Cleared on every exit path: pointerup, pointercancel, Escape, window blur.
 */

const ROTATE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M19 12a7 7 0 1 1-2.05-4.95' stroke='white' stroke-width='4'/><path d='M19 4v4h-4' stroke='white' stroke-width='4'/>" +
  "<path d='M19 12a7 7 0 1 1-2.05-4.95' stroke='black' stroke-width='2'/><path d='M19 4v4h-4' stroke='black' stroke-width='2'/>" +
  "</g></svg>";

export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 12 12, grab`;

let pinned = null; // { el, release }

/** Pin `cursor` over the whole page until the returned release() runs (idempotent). A second call
 *  while one is live replaces it. Safe to call outside a browser (returns a no-op). */
export function pinDragCursor(cursor) {
  if (typeof document === "undefined") return () => {};
  if (pinned) pinned.release();
  const el = document.createElement("style");
  el.setAttribute("data-pinned-cursor", cursor);
  el.textContent = `html, html * { cursor: ${cursor} !important; }`;
  document.head.appendChild(el);
  const done = (e) => { if (e && e.type === "keydown" && e.key !== "Escape") return; release(); };
  const release = () => {
    if (!pinned || pinned.el !== el) return;
    pinned = null;
    el.remove();
    window.removeEventListener("pointerup", done, true);
    window.removeEventListener("pointercancel", done, true);
    window.removeEventListener("keydown", done, true);
    window.removeEventListener("blur", done);
  };
  pinned = { el, release };
  window.addEventListener("pointerup", done, true);
  window.addEventListener("pointercancel", done, true);
  window.addEventListener("keydown", done, true);
  window.addEventListener("blur", done);
  return release;
}
