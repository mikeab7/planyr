/* Shared vertical tool rail (B330) — a Bluebeam-style icon rail. Presentational + generic:
 * the host passes a flat `items` list and an accent colour; the rail owns the dark chrome,
 * the active-tool highlight, scrolling, and layout. Used by the Document Review ("Markup")
 * workspace now; available for the Site Planner to adopt later (it currently inlines its own
 * rail). One rail component, so the two modules can't drift apart.
 *
 * items: an array of
 *   { kind:'tool', id, label, title, icon, active?, disabled?, onClick }  — an icon button
 *   { kind:'header', label }                                              — a small section caption
 *   { kind:'divider' }                                                    — a hairline
 *   { kind:'spacer' }                                                     — pushes what follows to the bottom
 *   { kind:'node', render }                                               — arbitrary content (e.g. a % readout)
 */
import { Fragment } from "react";

// B526: theme tokens, not a permanently-dark slab — a fixed dark rail between light chrome in
// light mode is the eye-strain case B318 forbids. (Active-button text stays near-black: it sits
// on the light amber module accent, where near-black reads well in both themes.)
const CHROME = "var(--surface-raised)", INK = "var(--text-primary)", MUTED = "var(--text-secondary)";

export function RailButton({ icon, label, title, active, accent, onClick, onDoubleClick, disabled, "data-testid": testId }) {
  return (
    <button type="button" title={title} onClick={onClick} onDoubleClick={onDoubleClick} disabled={disabled} aria-pressed={!!active} data-testid={testId}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: "100%",
        padding: "6px 1px", borderRadius: 9, cursor: disabled ? "default" : "pointer",
        border: "1px solid transparent", fontFamily: "inherit", fontSize: 9, lineHeight: 1.05,
        fontWeight: active ? 700 : 500, textAlign: "center", whiteSpace: "normal",
        background: active ? accent : "transparent",
        color: active ? "var(--on-accent-review)" : (disabled ? MUTED : INK),
        opacity: disabled ? 0.5 : 1, boxShadow: active ? "0 2px 8px rgba(0,0,0,0.28)" : "none",
      }}>
      <span style={{ display: "grid", placeItems: "center", height: 17 }}>{icon}</span>
      {label && <span>{label}</span>}
    </button>
  );
}

function renderItem(it, i, accent) {
  if (!it) return null;
  if (it.kind === "divider") return <div key={i} style={{ height: 1, background: "var(--border-default)", margin: "4px 4px" }} />;
  if (it.kind === "spacer") return <div key={i} style={{ flex: 1, minHeight: 6 }} />;
  if (it.kind === "header") return <div key={i} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED, textAlign: "center", padding: "3px 0 1px" }}>{it.label}</div>;
  if (it.kind === "node") return <Fragment key={i}>{it.render}</Fragment>;
  return <RailButton key={it.id || i} icon={it.icon} label={it.label} title={it.title} active={it.active} disabled={it.disabled} onClick={it.onClick} onDoubleClick={it.onDoubleClick} accent={accent} data-testid={it.id ? `tool-${it.id}` : undefined} />;
}

/* `footer` (NEW-7) — items that must stay REACHABLE whatever the viewport height.
 *
 * The rail is one `overflow-y: auto` column, and the tool list alone is taller than the rail's box
 * at every realistic window size — measured on this app: 1,294 px of content in a 536–796 px rail
 * across 1440×900, 1280×720 and 1512×640. Anything after a `spacer` was therefore pinned to the
 * bottom of the SCROLL CONTENT, i.e. several hundred pixels below the fold, in a narrow column with
 * no scrollbar affordance. The owner's report was exact: "there is no visible zoom control anywhere
 * in that mode." Footer items live OUTSIDE the scrolling area, so they are on screen by
 * construction rather than by luck. */
export default function ToolRail({ items = [], footer = [], accent = "var(--accent-review)", width = 64, style, "data-testid": testId }) {
  return (
    <div data-testid={testId} style={{ flex: "none", width, background: CHROME, borderLeft: "1px solid var(--border-default)", display: "flex", flexDirection: "column", minHeight: 0, ...style }}>
      <div data-testid={testId ? `${testId}-scroll` : undefined}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2, padding: "6px 5px" }}>
        {items.map((it, i) => renderItem(it, i, accent))}
      </div>
      {footer.length > 0 && (
        <div data-testid={testId ? `${testId}-footer` : undefined}
          style={{ flex: "none", borderTop: "1px solid var(--border-default)", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2, padding: "5px 5px 6px" }}>
          {footer.map((it, i) => renderItem(it, i, accent))}
        </div>
      )}
    </div>
  );
}
