/* The ONE parcel menu, drawn once (NEW-1, 2026-10-22). The panel row's ⋯, a right-click on a panel row and a right-click on the
 * parcel on the map all render THIS, from `lib/parcelMenu.js`'s item list — so the items, their order and their look cannot drift
 * between the three. Opens at a point (the cursor, or under the ⋯) through the shared ContextMenu primitive (portal, flips near
 * the screen edge, closes on Escape / outside press). Module scope (MODULE-SCOPE-COMPONENTS). */
import ContextMenu from "../../../shared/ui/ContextMenu.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { parcelMenuItems } from "../lib/parcelMenu.js";

const PANEL = {
  padding: SPACE.xs, border: "1px solid var(--border-default)", borderRadius: RADIUS.md, background: "var(--surface-raised)",
  boxShadow: "var(--shadow-popover, 0 4px 14px var(--border-strong))",
};

export default function ParcelContextMenu({ x, y, pc, renameable, mergeCount, onPick, onClose, testId = "parcel-menu", zIndex = 1998 }) {
  const items = parcelMenuItems(pc, { renameable, mergeCount });
  return (
    <ContextMenu x={x} y={y} onClose={onClose} width={208} zIndex={zIndex} className="menu" panelStyle={PANEL} testId={testId} ariaLabel="Parcel actions">
      {items.map((it) => it.id === "divider"
        ? <div key="divider" role="separator" style={{ borderTop: "1px solid var(--border-default)", margin: `${SPACE.xs}px 0` }} />
        : (
          <button key={it.id} type="button" role="menuitem" data-testid={`${testId}-${it.id}`} onClick={() => onPick(it.id)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: `${SPACE.sm}px ${SPACE.lg}px`, border: "none", borderRadius: RADIUS.sm, background: "transparent", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, color: it.danger ? "var(--danger-text)" : "var(--text-primary)", cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: SPACE.lg }}>
              <span>{it.label}</span>
              {it.hint && <span style={{ fontSize: FONT_SIZE.label, fontWeight: 400, color: "var(--text-secondary)" }}>{it.hint}</span>}
            </span>
            {it.sub && <span style={{ display: "block", fontSize: FONT_SIZE.label, fontWeight: 400, color: "var(--text-secondary)" }}>{it.sub}</span>}
          </button>
        ))}
    </ContextMenu>
  );
}
