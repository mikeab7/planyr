/* NEW-3 — THE ONE PLACE MAP-OVERLAY STACKING IS DECIDED.
 *
 * The owner's report: on the map, "the zoom +/- and fullscreen controls, and the scale bar, DRAW
 * ON TOP OF THE PANEL. They clip the 'N ON' count on the FLOOD & DRAINAGE header and cover the
 * FEMA opacity slider row and the 'Show above plan' control underneath it."
 *
 * The cause was not one bad number, it was the absence of a shared one. Every floating thing
 * over a map picked its own z-index at its own call site, months apart:
 *   • the planner's Layers + View column: 6
 *   • the planner's canvas furniture (north arrow, scale bar): 7   ← paints OVER the panel
 *   • the planner's zoom stack: 6, but LATER in document order      ← also paints over it
 *   • the map finder's panels: 1000, tying with Leaflet's own `.leaflet-top` / `.leaflet-bottom`
 *     control containers, which are 1000 and later in the DOM      ← also over it
 * A tie in z-index is resolved by document order, which is why this reads as random: whether a
 * control covers a panel depends on which happened to be authored last.
 *
 * So: three named bands, ordered by what the user is DOING.
 *   MAP_FURNITURE — passive, read-only annotation that belongs to the map (scale bar, north
 *                   arrow, the calibration badge). It may sit under anything interactive.
 *   MAP_CONTROL   — the map's own interactive chrome (Leaflet zoom, the planner zoom stack).
 *   FLOATING_PANEL— a panel the user has deliberately OPENED. It wins, because it is the thing
 *                   being read and operated; a passive scale bar covering a slider is never the
 *                   right outcome, and there is no case where the reverse is.
 *
 * ⛔ The rule generalises deliberately: this covers the View popover and every other floating
 * panel, not just the Layers panel the owner happened to hit. A new floating surface reads a
 * band from here; it does not invent a number.
 *
 * Below Leaflet's own 1000-tier we would be under the map's controls no matter what we chose, so
 * the panel band sits above it. Modals/toasts/menus (2500+) are a different concern entirely and
 * are untouched.
 *
 * Pure constants — no React, no Leaflet, no DOM.
 */

/* Leaflet fixes its control containers at z-index 1000 (`.leaflet-top`, `.leaflet-bottom`), and
 * we cannot outrank that from inside the map, so every band here is expressed relative to it. */
export const LEAFLET_CONTROL_Z = 1000;

export const MAP_CHROME_Z = {
  /* Passive map annotation. Below the controls AND below any open panel. */
  furniture: 400,
  /* The map's own interactive controls (zoom in/out, the planner's zoom stack). */
  control: 600,
  /* A panel the user opened — Layers, View, and any future floating surface. Above Leaflet's
   * own control tier, which is the only way a panel on a Leaflet surface can stop being
   * covered by the zoom buttons and the scale bar. */
  panel: LEAFLET_CONTROL_Z + 60,
  /* A transient status pill / banner that must beat even an open panel (a save failure, a
   * calibration prompt). Deliberately just above the panel, not up in the modal tier. */
  alert: LEAFLET_CONTROL_Z + 120,
};

/* NEW-3 — HOW TALL A FLOATING PANEL MAY BE.
 *
 * "A 28-layer list showing four rows at a time is not usable." The planner capped its panel at
 * 62vh and the finder's layer list at a flat 260px — a number chosen when the list was short.
 * Both are wrong for the same reason: the constraint is not a fraction of the viewport, it is
 * the room actually left between the panel's top edge and whatever sits at the bottom of the
 * map (the scale bar, the north arrow, a mobile toolbar).
 *
 *   topPx    — where the panel's top edge sits, from the top of the map surface
 *   bottomPx — clearance to leave under it, for the bottom furniture
 *   minPx    — never collapse below this, even on a very short window; a panel too short to
 *              show a group header plus a couple of rows is worse than one that overlaps.
 * Returns a CSS max-height string. Pure. */
export function panelMaxHeight({ topPx = 10, bottomPx = 96, minPx = 220 } = {}) {
  return `max(${minPx}px, calc(100% - ${topPx + bottomPx}px))`;
}

/* ⛔ B427408 — WHICH CORNER OF THE MAP OWNS WHAT, and the clearance that follows from it.
 *
 * The owner could not press the map's `+` button at all. The Leaflet zoom control was at
 * `topleft` on desktop, which is the SAME corner the Your-sites panel occupies (`top: 10,
 * left: 10`) — so the panel covered it, and only the bottom sliver of `−` showed underneath.
 * The fix moved the control to the one corner nothing else claims. This constant is what stops
 * the next thing that wants a corner from re-creating the collision by accident.
 *
 *   topleft      Your-sites panel (desktop) · the full-width search bar (phone)
 *   topright     Layers panel
 *   bottomright  scale bar
 *   bottomleft   THE ZOOM CONTROL — at every breakpoint, with no responsive branch
 *
 * The no-branch part is deliberate: the defect existed because the phone path was fixed and the
 * desktop path was left behind, and a position that does not depend on the breakpoint cannot
 * drift apart again.
 *
 * ⛔ Do NOT resolve a future collision here with z-index. Raising the control above a panel only
 * moves the problem — the buttons then sit on top of that panel's content and eat presses meant
 * for it. Give the newcomer a corner, or stack it clear using the clearance below.
 *
 * ZOOM_CONTROL_CLEARANCE_PX is the room a bottom-LEFT floating element must leave beneath itself
 * so it never covers the control stack: Leaflet's zoom in/out buttons PLUS the "locate me" button
 * (NEW — the mobile pinch/locate/telemetry lap; a separate `leaflet-bar` stacked directly below
 * zoom's, Leaflet's own default 10px margin between them) — three ~30px buttons, their borders,
 * and the container's own 10px margin, rounded up. The transient map banners (the offline/fallback
 * offers and the "drop a file" hint) sit on this rather than on a hand-picked number each. */
export const ZOOM_CONTROL_CLEARANCE_PX = 128;
