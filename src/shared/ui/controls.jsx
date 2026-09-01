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
 * reported is scope that block did not ask for. If you change a number here, change it there. */
export const RADIUS = { control: 8, pill: 999, panel: 12 };
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
 * FONT_SIZE.control — not an import, for the same reason RADIUS/PAD/FONT above are literal
 * duplicates (see that block's header): this file is in the shared entry chunk. Change one,
 * change both.
 *   sm  height 26 (CONTROL_H.md) — dense/toolbar/map chrome. The nav tabs are the one deliberate
 *       exception (their own `Tab` primitive below, not this bundle — see its header).
 *   md  height 30 (CONTROL_H.lg) — primary standalone actions: the account pill, a menu trigger,
 *       an icon button (IconButton's own default size, unchanged, already agrees with this).
 * Radius is always `RADIUS.control` (8) for both steps — a chip built from this bundle is always
 * a STANDALONE control per docs/DESIGN.md's shape rule, never nested, so it never takes `sm`(6).
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
 * interactive accent). */
export function Button({ variant = "primary", size = "md", active = false, accent = "var(--accent)", onAccent = "var(--on-accent)", disabled = false, style, children, ...rest }) {
  const filled = variant === "primary" || active;
  const base = {
    padding: PAD[size] || PAD.md,
    fontSize: size === "sm" ? FONT.sm : FONT.md,
    borderRadius: RADIUS.control,
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
  return <button disabled={disabled} style={{ ...base, ...skin, ...style }} {...rest}>{children}</button>;
}

/* ToggleChip — a pill toggle (the FileBrowser / TeamPanel chip anatomy, unified). */
export function ToggleChip({ active = false, accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }) {
  return (
    <button style={{
      padding: "6px 11px", fontSize: FONT.sm, borderRadius: RADIUS.pill, cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 650 : 500,
      border: `1px solid ${active ? accent : "var(--border-default)"}`,
      background: active ? accent : "var(--surface-raised)",
      color: active ? onAccent : "var(--text-primary)",
      boxShadow: REST_SHADOW, ...style,
    }} {...rest}>{children}</button>
  );
}

/* IconButton — the square icon slot (the Site Planner iconBtn, token-only). Ref-forwarding so
 * it can anchor an AnchoredMenu directly, like any other trigger element. */
export const IconButton = forwardRef(function IconButton({ size = 30, active = false, accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }, ref) {
  return (
    <button ref={ref} style={{
      width: size, height: size, padding: 0, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
      borderRadius: RADIUS.control, cursor: "pointer", boxShadow: REST_SHADOW,
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
 * the label — the one convention for a required field, so a form never invents its own. */
export function Field({ label, children, stacked = false, required = false }) {
  const labelNode = (
    <span style={{ fontSize: stacked ? 11 : 12, fontWeight: stacked ? 600 : 400, color: "var(--text-secondary)" }}>
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
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
      {labelNode}{children}
    </div>
  );
}

/* Section — a collapsible titled group (lifted from the Site Planner inspector; the one
 * behavioral fix folded in: the border is now var(--border-default), not the light-only
 * #ece6d9 cream that never themed to dark). */
export function Section({ title, children, collapsed, accent }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div style={{ marginBottom: 9, background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.panel, boxShadow: REST_SHADOW, overflow: "hidden" }}>
      <div onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} aria-expanded={open} aria-label={title}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "10px 12px", userSelect: "none" }}>
        {accent && <span style={{ width: 6, height: 6, borderRadius: RADIUS.pill, background: accent, flex: "none" }} />}
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
  idleColor = "var(--text-secondary)", icon, children,
  style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize,
  ...rest
}) {
  warnLockedOverride("Tab", { style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize });
  return (
    <button
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        height: "100%", padding: "0 9px",
        border: "none", borderBottom: `2px solid ${active ? fill : "transparent"}`,
        background: "transparent",
        color: active || hover ? textColor : idleColor,
        fontFamily: "inherit", fontSize: FONT.md,
        fontWeight: active ? 600 : 500,
        cursor: "pointer", whiteSpace: "nowrap",
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
 * call site. Layout spacing (margin, flex) belongs on a wrapping element. */
export const MenuTrigger = forwardRef(function MenuTrigger({
  size = "md", open, caret = true, leading, textColor = "var(--chrome-text)", children,
  style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize,
  ...rest
}, ref) {
  warnLockedOverride("MenuTrigger", { style: _style, borderRadius: _borderRadius, height: _height, padding: _padding, fontSize: _fontSize });
  const s = SIZE[size] || SIZE.md;
  return (
    <button
      ref={ref}
      {...(open !== undefined ? { "aria-haspopup": "menu", "aria-expanded": open } : {})}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        height: s.height, padding: s.padding, maxWidth: 220,
        borderRadius: RADIUS.control, border: "1px solid var(--chrome-divider)",
        background: "var(--chrome-bg-elev)", color: textColor,
        cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: s.fontSize,
        whiteSpace: "nowrap",
      }}
      {...rest}
    >
      {leading}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>{children}</span>
      {caret && <span aria-hidden="true" style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>}
    </button>
  );
});

/* Menu primitives — a token-only flyout panel + item (the Site Planner menuPanel/menuItem). */
export const menuPanelStyle = { background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.panel, boxShadow: "0 16px 44px rgba(0,0,0,0.22), 0 3px 10px rgba(0,0,0,0.1)", padding: 6 };
export function MenuItem({ active = false, style, children, ...rest }) {
  return (
    <button style={{
      display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: FONT.md, borderRadius: RADIUS.control, cursor: "pointer",
      border: "none", background: active ? "var(--hover-menu)" : "transparent", color: "var(--text-primary)", fontFamily: "inherit", fontWeight: active ? 650 : 500, ...style,
    }} {...rest}>{children}</button>
  );
}
