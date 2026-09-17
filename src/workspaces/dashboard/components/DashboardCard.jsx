/* DashboardCard — the one card shell every Dashboard card renders inside (B1213313, NEW-1
 * arrangeable-grid rework). Resting state is clean (just a title); Customize mode reveals a drag
 * handle (the title row only — not the card body, so a card with a scrollable list stays
 * scrollable) and a remove control. The resize affordance (drag the bottom-right corner) is
 * react-grid-layout's own doing, painted on the grid-item wrapper this card fills — see
 * Dashboard.jsx's own note on why that wrapper (a plain `<div>`, not this component) is the
 * element react-grid-layout positions and clones a resize handle onto.
 *
 * `showDragHandle` is separate from `customizing`: on a narrow/single-column layout (Dashboard.jsx
 * renders a plain stack there, no react-grid-layout at all — "don't let a phone drag-resize a
 * grid it cannot see") Customize mode still needs to work for remove/add/reset, but there is no
 * drag gesture to offer, so the grip glyph and grab cursor are left off.
 *
 * `headerMeta` (NEW-COMPS-CARD) — an optional quiet right-aligned line in the header row, beside
 * the title (the Comps card's "latest of N"). Every other card leaves it unset, so their header
 * row is byte-identical to before this was added — this is an extension point, not a per-card
 * special case.
 *
 * `customizeControls` (NEW-1, 2026-09-17) — an optional node rendered in the header, only while
 * `customizing` is true, before the remove control. Same extension-point shape as `headerMeta`:
 * every card that doesn't pass it renders exactly as before. Its first use is the Jump-back-in
 * card's row-count stepper (DashboardCards.jsx's `JumpBackInCountControl`) — a per-card setting
 * that, like remove/add, only needs to be reachable in Customize mode, not sitting in the
 * resting view (PANEL-BREVITY).
 *
 * `sizeToContent` (B1426608) — a card whose content is a short list (rows of
 * text, no chart/map/thumbnail grid) shrinks to its own content height instead of stretching to
 * fill the grid tile react-grid-layout reserved for it, so one quiet row doesn't sit above a
 * couple hundred pixels of bare white. `maxHeight: "100%"` still caps it at the tile's reserved
 * height, so a card with MORE rows than fit still scrolls internally exactly as before — this
 * never changes the grid's own row-span math (Dashboard.jsx's `layout` state, and what gets
 * saved to the account, are untouched; only this card's own rendered pixel height changes).
 * Cards that need every pixel of their tile (a real map, a thumbnail grid that measures its own
 * box to lay itself out) leave this off and keep the original fill behavior.
 *
 * `cardKey` (NEW-1, 2026-09-17) — the card's own CARD_DEFS key, stamped as `data-card-key` on the
 * root so a headless check (or a future dev tool) can find a specific card without matching on
 * its title text.
 */
import { RADIUS } from "../../../shared/ui/radius.js";
import { IconButton } from "../../../shared/ui/controls.jsx";

export default function DashboardCard({ title, headerMeta, headerRight, customizing, showDragHandle = true, sizeToContent = false, customizeControls, onRemove, children, cardKey }) {
  return (
    <div
      data-card-key={cardKey}
      style={{
        height: sizeToContent ? "auto" : "100%",
        maxHeight: "100%",
        boxSizing: "border-box",
        background: "var(--surface-raised)",
        border: "1px solid var(--border-default)",
        borderRadius: RADIUS.lg,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <span
          className={showDragHandle ? "dashboard-card-drag-handle" : undefined}
          style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: customizing && showDragHandle ? "grab" : "default" }}
        >
          {customizing && showDragHandle && (
            <span aria-hidden="true" title="Drag to reorder" style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1, flex: "none" }}>⠿⠿</span>
          )}
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
        </span>
        {(headerMeta || headerRight) && (
          <span style={{
            fontSize: 10.5, color: "var(--text-secondary)", flex: "none",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            ...(headerRight ? { fontWeight: 600 } : null),
          }}>
            {headerRight || headerMeta}
          </span>
        )}
        {customizing && customizeControls}
        {customizing && (
          <IconButton size={22} onClick={onRemove} title="Remove this card">
            <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
          </IconButton>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}
