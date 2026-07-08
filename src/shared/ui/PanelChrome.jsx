/**
 * PanelChrome — the shared title bar for a Site Planner left-rail panel (NEW-1 / NEW-2).
 *
 * One header for BOTH hosts so the two affordances are a single component:
 *   • NEW-1 detach — a picture-in-picture icon (docked) pops the panel out to a floating card;
 *     a dock icon (floating) returns it to the left column. Double-clicking the bar toggles it.
 *   • NEW-2 collapse — an explicit ✕ close, so a panel can be closed from its own header (not
 *     only by re-clicking its rail icon).
 *
 * When `onDragStart` is supplied (floating host) the whole bar becomes the drag handle.
 *
 * Props:
 *  - title       : string / node — the single panel-level title (the inner Section titles that
 *                  duplicated it are dropped so the title shows exactly once).
 *  - floating    : boolean — true in the floating card, false in the docked column.
 *  - canFloat    : boolean — false below the docked-only breakpoint; hides the detach icon.
 *  - onDetach    : () => void — dock → float (shown docked when canFloat).
 *  - onDock      : () => void — float → dock (shown floating).
 *  - onClose     : () => void — close the panel entirely.
 *  - onToggle    : () => void — double-click the bar: docked→detach, floating→dock.
 *  - onDragStart : (PointerEvent) => void — pointerdown on the bar starts a drag (floating only).
 *  - data-testid : string
 */

// Picture-in-picture "detach" glyph: an outer frame with a small filled inset window.
const DetachIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">
    <rect x="1.6" y="2.6" width="12.8" height="9.5" rx="1.6" />
    <rect x="8" y="6.8" width="5.6" height="4.6" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

// "Dock" glyph: a frame with a left column divider — the panel returning to the rail column.
const DockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6" />
    <line x1="6" y1="2.6" x2="6" y2="13.4" />
  </svg>
);

function IconBtn({ title, onClick, children, "data-testid": testId, "aria-label": ariaLabel }) {
  return (
    <button
      type="button" className="gbtn" title={title} aria-label={ariaLabel} data-testid={testId}
      // A control click must not read as a bar double-click (toggle) or start a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      style={{
        border: "none", background: "transparent", color: "var(--text-secondary)",
        cursor: "pointer", fontSize: 13, fontFamily: "inherit", lineHeight: 1,
        padding: "3px 5px", display: "grid", placeItems: "center", borderRadius: 6,
      }}>
      {children}
    </button>
  );
}

export default function PanelChrome({ title, floating, canFloat, onDetach, onDock, onClose, onToggle, onDragStart, "data-testid": testId }) {
  return (
    <div
      data-testid={testId}
      onPointerDown={onDragStart}
      onDoubleClick={onToggle}
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 4,
        padding: "8px 8px 8px 12px", borderBottom: "1px solid var(--planner-border)",
        userSelect: "none", cursor: onDragStart ? "grab" : "default",
      }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </span>
      {floating ? (
        <IconBtn title="Dock to the left rail" aria-label="Dock panel" onClick={onDock} data-testid={testId ? `${testId}-dock` : undefined}>
          <DockIcon />
        </IconBtn>
      ) : (canFloat && (
        <IconBtn title="Detach to a floating window" aria-label="Detach panel" onClick={onDetach} data-testid={testId ? `${testId}-detach` : undefined}>
          <DetachIcon />
        </IconBtn>
      ))}
      <IconBtn title="Close" aria-label="Close panel" onClick={onClose} data-testid={testId ? `${testId}-close` : undefined}>✕</IconBtn>
    </div>
  );
}
