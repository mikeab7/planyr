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
import { useState } from "react";

// The single source of the control scale. Radius 8 is the median of the pre-convergence
// spread (6/7/8/9) and already the Site Planner chip/iconBtn value — the smallest net move.
export const RADIUS = { control: 8, pill: 999, panel: 12 };
export const PAD = { sm: "5px 10px", md: "7px 12px", lg: "9px 14px" };
export const FONT = { sm: 11.5, md: 12.5 };
const REST_SHADOW = "0 1px 2px rgba(0,0,0,0.05)"; // neutral, token-independent — kills the stale colored ember shadows

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

/* IconButton — the square icon slot (the Site Planner iconBtn, token-only). */
export function IconButton({ size = 30, active = false, accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }) {
  return (
    <button style={{
      width: size, height: size, padding: 0, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
      borderRadius: RADIUS.control, cursor: "pointer", boxShadow: REST_SHADOW,
      border: `1px solid ${active ? accent : "var(--border-default)"}`,
      background: active ? accent : "var(--surface-raised)",
      color: active ? onAccent : "var(--text-primary)", ...style,
    }} {...rest}>{children}</button>
  );
}

/* Field — a label + control row (lifted verbatim from the Site Planner inspector; token-clean). */
export function Field({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>{children}
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
        {accent && <span style={{ width: 6, height: 6, borderRadius: 99, background: accent, flex: "none" }} />}
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", flex: 1 }}>{title}</span>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s ease", width: 9 }}>▶</span>
      </div>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

/* Menu primitives — a token-only flyout panel + item (the Site Planner menuPanel/menuItem). */
export const menuPanelStyle = { background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.panel, boxShadow: "0 16px 44px rgba(0,0,0,0.22), 0 3px 10px rgba(0,0,0,0.1)", padding: 6 };
export function MenuItem({ active = false, style, children, ...rest }) {
  return (
    <button style={{
      display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: FONT.md, borderRadius: 7, cursor: "pointer",
      border: "none", background: active ? "var(--hover-menu)" : "transparent", color: "var(--text-primary)", fontFamily: "inherit", fontWeight: active ? 650 : 500, ...style,
    }} {...rest}>{children}</button>
  );
}
