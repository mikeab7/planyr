/* Model workspace — the right-click context menu (Stage 1: cell / row-header / column-header).
 *
 * B1076480: this used to hand-roll a point anchor on top of AnchoredMenu (built for a real
 * ELEMENT anchor — a button, a chip) via a 1px virtual div, which produced two live bugs: no
 * `panelStyle` was ever passed (the menu rendered fully transparent — read straight through it
 * to the grid underneath) and `placement="below-right"`'s right-edge-alignment math, fed a 1px
 * anchor, always resolved to a large negative offset that hard-clamped to the far edge — the
 * menu opened pinned to the left of the screen regardless of where the click landed. Both were
 * findings from clicking the LIVE module, not from a resting-state screenshot.
 *
 * The actual right primitive for "anchored at a click point" already exists and is already used
 * everywhere else in the app (map pins, canvas elements, parcels, markups, the Library folder
 * tree, the project breadcrumb) — `shared/ui/ContextMenu.jsx` (B915). It measures the real menu
 * box and FLIPS up/left near a viewport edge instead of merely clamping, and its backdrop closes
 * on `onPointerDown` (fires for every mouse button) + an explicit `onContextMenu` handler, so a
 * right-click aimed at a DIFFERENT header while this menu is already open is never silently eaten
 * by a stale backdrop the way AnchoredMenu's left-click-only backdrop was. Route through it
 * instead of inventing a second point-anchor mechanism on top of AnchoredMenu.
 */
import ContextMenuPrimitive from "../../../shared/ui/ContextMenu.jsx";
import { MenuItem, menuPanelStyle } from "../../../shared/ui/controls.jsx";

/** items: [{ key, label, onClick, danger? } | "divider", …]. `point` is {x,y} in viewport
 *  coordinates (a right-click's clientX/clientY) or null to stay closed. */
export default function ContextMenu({ point, onClose, items }) {
  if (!point) return null;
  return (
    <ContextMenuPrimitive x={point.x} y={point.y} onClose={onClose} width={210} panelStyle={menuPanelStyle} ariaLabel="Context menu">
      {items.map((it, i) =>
        it === "divider" ? (
          <div key={`d${i}`} style={{ height: 1, margin: "4px 0", background: "var(--border-default)" }} />
        ) : (
          <MenuItem
            key={it.key}
            data-testid={it.testId}
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick(); }}
            style={{ color: it.danger ? "var(--danger)" : undefined, opacity: it.disabled ? 0.5 : 1, cursor: it.disabled ? "default" : "pointer" }}
          >
            {it.label}
          </MenuItem>
        ),
      )}
    </ContextMenuPrimitive>
  );
}
