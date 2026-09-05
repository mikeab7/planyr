/* cornerClearance.js — B966700-ish (help/report control positioning fix) — WHAT A FIXED
 * BOTTOM-RIGHT CONTROL MUST CLEAR, MEASURED, NEVER ASSUMED.
 *
 * The global help/report control (HelpReportControl.jsx) used to reserve a constant 292px
 * above the bottom edge on EVERY route, sized to clear the tallest thing that could ever
 * occupy that corner anywhere in the app — the Site Planner canvas's own narrow-width zoom
 * stack. Michael's report: the button rendered 63% of the way up a short screen on the map
 * root, a schedule route and a model route alike — none of which has that stack, or anything
 * else, in the corner — because the constant didn't know that.
 *
 * The fix is to read the real DOM instead of reserving for a worst case that is usually not
 * there. Two kinds of thing can occupy this corner:
 *   (1) A Leaflet map's own bottom-right control container (`.leaflet-bottom.leaflet-right`,
 *       Leaflet's own stable class — holds the attribution + the graphic scale on the map
 *       screen). No app code needs to mark this; it's Leaflet's own DOM.
 *   (2) Anything else that wants this control to clear it marks itself with
 *       `data-canvas-corner="<name>"` — the Site Planner canvas's own narrow-width zoom stack
 *       and its "✎ Tools" FAB, today. A future bottom-right occupant reads this contract; it
 *       does not need HelpReportControl to know its name.
 * `HelpReportControl` mounts in the app Shell, which must never statically import a lazy
 * workspace's module (see /CLAUDE.md "Lazy-loaded workspaces") — a shared DOM attribute is
 * the contract instead, the same shape `data-feature`/`data-chrome`/`data-handle-layer`
 * already use elsewhere in this app for exactly this kind of cross-cutting concern.
 *
 * `cornerClearanceFromBottom` answers: given a control fixed at `right` with the given
 * `width`, how far from the viewport's bottom edge must its OWN bottom edge sit to clear
 * every genuine occupant of that same horizontal column? Only a candidate that actually
 * OVERLAPS the control's column counts — this is what makes desktop free of the reservation
 * even though the Site Planner canvas's zoom stack exists in the DOM there too: on desktop
 * the docked tool rail insets that stack's pane away from the true viewport edge, so its
 * measured rect simply doesn't reach this column. No genuine occupant -> `base` (by default,
 * the same value as `right`, so the control rests in the true corner instead of floating up
 * for nothing).
 */

const GAP_PX = 10;

function isRendered(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  let cs;
  try { cs = window.getComputedStyle(el); } catch (_) { return true; }
  if (!cs) return true;
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  if (cs.opacity !== "" && Number(cs.opacity) === 0) return false;
  return true;
}

export function cornerClearanceFromBottom({ right, width, base = right } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined") return base;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const colLeft = vw - right - width;
  const colRight = vw - right;

  let candidates;
  try {
    candidates = [
      ...document.querySelectorAll(".leaflet-bottom.leaflet-right"),
      ...document.querySelectorAll("[data-canvas-corner]"),
    ];
  } catch (_) {
    return base;
  }

  let clearance = base;
  for (const el of candidates) {
    if (!isRendered(el)) continue;
    const r = el.getBoundingClientRect();
    const overlaps = r.right > colLeft && r.left < colRight;
    if (!overlaps) continue;
    const needed = (vh - r.top) + GAP_PX;
    if (needed > clearance) clearance = needed;
  }
  return clearance;
}
