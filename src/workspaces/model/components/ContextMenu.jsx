/* Model workspace — the right-click context menu (Stage 1: cell / row-header / column-header).
 *
 * A context menu has no persistent trigger ELEMENT the way every other AnchoredMenu consumer
 * does (a button, a chip) — its "anchor" is wherever the mouse was when the user right-clicked.
 * Rather than inventing a second overlay primitive, this reuses the shared AnchoredMenu (portal,
 * viewport clamping, Escape/click-away, route-change close — see its own header) against a
 * zero-sized VIRTUAL anchor div moved to the click point, exactly the standard technique for
 * adapting an anchor-based popover to a point-based one. Never build a second menu primitive at
 * the call site (docs/DESIGN.md) — this is the one extension point for "anchored at a point."
 */
import { useRef } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { MenuItem } from "../../../shared/ui/controls.jsx";

/** items: [{ key, label, onClick, danger? } | "divider", …]. `point` is {x,y} in viewport
 *  coordinates (a right-click's clientX/clientY) or null to stay closed. */
export default function ContextMenu({ point, onClose, items }) {
  const anchorRef = useRef(null);
  const open = !!point;

  // The virtual anchor's position is set DECLARATIVELY from `point`, in the SAME render/commit
  // as everything else — never via an effect that mutates the DOM afterward. AnchoredMenu reads
  // this anchor's position in its OWN `useLayoutEffect`, and React runs every layout effect in
  // a commit before any passive `useEffect` — an effect here that moved the anchor via
  // `ref.current.style.left = …` would still be sitting at its stale (0,0) default the moment
  // AnchoredMenu measured it, so the menu placed itself off-screen and never became visible.
  //
  // ⛔ 1×1px, NEVER 0×0 — measured live: placeMenu() (anchoredMenuPlacement.js) treats an
  // anchor whose rect is EXACTLY width===0 && height===0 as "unmeasurable" (its own guard for a
  // collapsed `display:none` anchor, B734) and returns null forever, which left this menu
  // permanently invisible (AnchoredMenu never marks a menu visible until it has a placed
  // position) — a real bug this caught, not a hypothetical. A 1px square reads as "a genuine
  // point" to that guard while being visually indistinguishable from a true zero-size anchor.
  return (
    <>
      <div ref={anchorRef} style={{ position: "fixed", left: point?.x ?? 0, top: point?.y ?? 0, width: 1, height: 1, pointerEvents: "none" }} />
      <AnchoredMenu open={open} onClose={onClose} anchorRef={anchorRef} placement="below-right" width={210} gap={2}>
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
      </AnchoredMenu>
    </>
  );
}
