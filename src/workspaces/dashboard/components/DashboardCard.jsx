/* DashboardCard.jsx — the one card shell every Dashboard card renders inside (B1196305, NEW-2).
 * Customize mode reveals a drag handle, a width stepper, Move-left/Move-right buttons and a
 * remove control — none of which the card body itself knows anything about. Move-left/right call
 * the SAME `onMove` prop Dashboard.jsx wires to `moveCardBy` (dashboardLayout.js), which is the
 * identical function drag-and-drop's drop handler calls — one reorder path, not two.
 */
import { RADIUS } from "../../../shared/ui/radius.js";
import { IconButton } from "../../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

const WIDTH_STEP_LABEL = { sm: "S", md: "M", lg: "L" };

export default function DashboardCard({
  title, width, customizing, canRemove, draggable, onDragStart, onDragOver, onDrop, onDragEnd,
  isDragOver, onMoveLeft, onMoveRight, onCycleWidth, onRemove, children,
}) {
  return (
    <div
      data-testid="dashboard-card"
      data-card-title={title}
      draggable={customizing}
      onDragStart={customizing ? onDragStart : undefined}
      onDragOver={customizing ? onDragOver : undefined}
      onDrop={customizing ? onDrop : undefined}
      onDragEnd={customizing ? onDragEnd : undefined}
      style={{
        display: "flex", flexDirection: "column", minWidth: 0,
        background: "var(--surface-raised)", border: `1px solid ${isDragOver ? "var(--accent)" : "var(--border-default)"}`,
        borderRadius: RADIUS.lg, overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border-default)" }}>
        {customizing && (
          <span aria-hidden="true" title="Drag to reorder" style={{ cursor: "grab", color: "var(--text-tertiary)", fontSize: FONT_SIZE.emphasis, flex: "none", lineHeight: 1 }}>⠿</span>
        )}
        <span style={{ fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)", flex: 1, minWidth: 0 }}>
          {title}
        </span>
        {customizing && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
            <IconButton size={22} title="Move left" aria-label={`Move ${title} left`} onClick={onMoveLeft}>‹</IconButton>
            <IconButton size={22} title="Move right" aria-label={`Move ${title} right`} onClick={onMoveRight}>›</IconButton>
            <IconButton size={22} title={`Width: ${width === "sm" ? "Narrow" : width === "lg" ? "Wide" : "Medium"} — click to change`}
              aria-label={`Change ${title} width`} onClick={onCycleWidth}>{WIDTH_STEP_LABEL[width] || "M"}</IconButton>
            <IconButton size={22} title={canRemove ? "Remove card" : "The last card can't be removed"}
              aria-label={`Remove ${title}`} disabled={!canRemove} onClick={onRemove}>✕</IconButton>
          </div>
        )}
      </div>
      <div style={{ padding: 12, flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
