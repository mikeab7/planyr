/* DashboardCard — the one card shell every Dashboard card renders inside (B1213313, NEW-2).
 * Resting state is clean (just a title); Customize mode reveals a drag handle, a resize
 * toggle, and a remove control — the same three affordances for every card, never
 * reinvented per card.
 */
import { RADIUS } from "../../../shared/ui/radius.js";
import { IconButton } from "../../../shared/ui/controls.jsx";

export default function DashboardCard({
  title, wide, customizing, onToggleSize, onRemove,
  draggable, onDragStart, onDragOver, onDrop, onDragEnd, dragOver,
  children,
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        gridColumn: wide ? "span 2" : "span 1",
        background: "var(--surface-raised)",
        border: `1px solid ${dragOver ? "var(--accent)" : "var(--border-default)"}`,
        borderRadius: RADIUS.lg,
        padding: 14,
        display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {customizing && (
          <span aria-hidden="true" title="Drag to reorder" style={{ cursor: "grab", color: "var(--text-secondary)", fontSize: 13, lineHeight: 1 }}>⠿⠿</span>
        )}
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", flex: 1 }}>
          {title}
        </span>
        {customizing && (
          <>
            <IconButton size={22} onClick={onToggleSize} title={wide ? "Make this card smaller" : "Make this card wider"}>
              <span style={{ fontSize: 12 }}>{wide ? "⤡" : "⤢"}</span>
            </IconButton>
            <IconButton size={22} onClick={onRemove} title="Remove this card">
              <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
            </IconButton>
          </>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}
