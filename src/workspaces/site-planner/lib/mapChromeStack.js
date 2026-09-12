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

/* ⛔ NEW-MAPCTRL-1 — THE COMPS TOGGLE, and the collision it re-created.
 *
 * The leasing-comps work added a "Comps" pill at `top:12, right:12, zIndex:1150` — the SAME
 * `topright` corner this file already documents as belonging to the Layers panel, at a z-index
 * that outranked even MAP_CHROME_Z.alert (1120). It was authored without reading this file, and
 * it reproduced the exact B554 defect class this file exists to prevent: the pill sat almost
 * exactly on top of the "Imagery & layers" button and buried the word IMAGERY.
 *
 * The fix is the rule this file already states: a newcomer to a claimed corner STACKS clear of
 * the thing that already owns it, it does not out-z-index it. COMPS_TOGGLE_CLEARANCE_PX is the
 * room the Comps pill (a 30px pill + an 8px gap, rounded up) needs above the Layers panel — the
 * Layers panel's own `top` grows by this amount wherever the Comps toggle can render, at BOTH
 * breakpoints, so the two can never overlap regardless of whether the Layers panel is collapsed
 * or open (the pill sits ABOVE it, so the panel's own height growing downward never reaches it). */
export const COMPS_TOGGLE_CLEARANCE_PX = 38;

/* ⛔ B950321 (NEW-2, map-overlay alignment audit) — THE ONE SHARED TOP EDGE + CHIP HEIGHT every
 * desktop floating map overlay reads, instead of each one hand-picking its own number.
 *
 * The owner: "look at the vertical alignment for the chips/pills on the map, they don't align."
 * Measured (not eyeballed — see the item for the harness): on a fresh desktop landing, the
 * Sites/Comps rail panel and the Imagery & layers panel both sat at `top: 10`, but the combined
 * search bar sat at `top: 14` — a real, if small, 4px offset a straight-line-across-the-top eye
 * test catches instantly. Collapsed, the Layers panel was already deliberately pinned to
 * `CONTROL_H.lg` (see `MAP_CORNER_CHIP_STYLE` in MapFinder.jsx, whose own header comment says
 * "Applied to BOTH chips' COLLAPSED presentation" — a claim that was only ever true for one of
 * them); the Sites panel's collapsed row had never been given the same treatment and rested at
 * whatever height its content happened to need (38px, not 30).
 *
 * `MAP_OVERLAY_TOP_PX` is now the ONE top offset every desktop floating overlay over the map
 * reads — the two corner panels AND the top-center search bar. `MAP_OVERLAY_CHIP_H_PX` is the
 * ONE resting height a simple corner-toggle chip collapses to (mirrors `CONTROL_H.lg` exactly —
 * re-exported here rather than re-imported at every call site, so a future corner chip reaches
 * for ONE name instead of two). A new floating overlay reads these; it does not invent its own
 * `top`.
 *
 * `MAP_OVERLAY_BAR_H_PX` is a DELIBERATELY DIFFERENT number, not a third attempt at the same one.
 * The search bar is not a toggle chip — it is a compound cluster (the Site/Comp switch, an
 * address combobox, one or two action buttons, `nestedIn(RADIUS.lg, 6)`-radius children) that
 * needs real room for a text field, and shrinking it to `MAP_OVERLAY_CHIP_H_PX` would cramp
 * every child inside it for no visual gain (a compound cluster and a single-label chip were never
 * going to read as the same shape, only the same TOP edge). Documented, not silently exempted:
 * see docs/UI-INVENTORY.md's "Known, deliberately-not-fixed findings". */
export const MAP_OVERLAY_TOP_PX = 10;
export const MAP_OVERLAY_CHIP_H_PX = 30; // == CONTROL_H.lg (src/shared/ui/designTokens.js)
export const MAP_OVERLAY_BAR_H_PX = 42;

/* ⛔ B1310209 (NEW-2, owner decision 2026-09-07) — THE SITE-PLAN "ADJUST" PANEL'S CORNER, and the
 * clearance that follows from it.
 *
 * The owner chose the fourth floating-map-panel instance (a small docked panel of editing
 * controls, opened by the plan card's "Adjust" button) on the explicit condition that it DOCKS
 * to a map corner rather than hovering loose — the same discipline this file already enforces
 * for the Comps rail (topleft), the Layers panel (topright) and the Leaflet zoom stack
 * (bottomleft, see B427408 above). Of the four corners, topleft and topright are already
 * claimed; bottomleft is the zoom/locate stack. **bottomright is the only corner left**, and it
 * already holds one thing: Leaflet's own graphic scale control (`L.control.scale(...)`,
 * MapFinder.jsx).
 *
 * MEASURED, not assumed (a fresh build + a real Chromium render of the map, 1191×465 viewport —
 * the owner's own reported window size): the scale control's row sits 39.98px above the true
 * viewport/map bottom edge (top edge at y=425.02 against a 465px-tall map). Rounded up for
 * safety margin (font/DPI variance across browsers) to **40**, plus the same ~4px breathing gap
 * this file already leaves other neighbours (COMPS_TOGGLE_CLEARANCE_PX's own margin above the
 * Layers panel) → **44**.
 *
 * The panel is anchored from the BOTTOM (`bottom: SCALE_BAR_CLEARANCE_PX, right: 10`), not the
 * top — it grows UPWARD as its content grows (opacity/rotation/lock/share/action rows), the same
 * "anchor the edge that's fixed, let the free edge float" idiom the bottom-left banner slot uses
 * (NEW-MAPCTRL-3, `ZOOM_CONTROL_CLEARANCE_PX`'s own call site). This is what keeps it clear of the
 * scale bar at every content height without a second measurement. */
export const SCALE_BAR_CLEARANCE_PX = 44;

/* ⛔ B1338272 (iPhone landscape control overlap) — A BOTTOM-ANCHORED STACK'S "CLEAR THE
 * FURNITURE" OFFSET IS A CONSTANT; THE CANVAS IT SITS IN IS NOT.
 *
 * The Site canvas's own zoom stack (bottom-right) reads a fixed clearance from the map's bottom
 * edge (see `zoomBottom` at its call site) sized to clear the scale bar underneath it. The
 * top-right View + Layers row reads a fixed offset from the TOP edge. Both are correct in
 * isolation — each was tuned against a canvas tall enough that its own opposite edge is nowhere
 * near. Landscape phones break that assumption: the canvas can be under 300px tall, so the
 * bottom stack's fixed clearance pushes its OWN top edge up past the top row's bottom edge —
 * measured live on the smallest current iPhone in landscape (a 568×320 device, 263px of canvas
 * height once the header/toolbar are subtracted): the top row occupies roughly y11–43, the
 * unconstrained zoom stack occupies y11–101, a dead-on 100% overlap of the "Zoom in" button
 * under the "Layers" button.
 *
 * `TOP_RIGHT_ROW_RESERVE_PX` is the room that row needs (its own top offset + its measured
 * collapsed height, rounded up for safety margin the way `SCALE_BAR_CLEARANCE_PX` already is,
 * plus an 8px breathing gap). The call site clamps the stack's bottom offset against the
 * canvas's own REAL height so the two can never occupy the same band, at any height — never a
 * nudge tuned to one device. Nudging the stack (or the row) by a fixed amount would fix this one
 * screen and reproduce the same collision at the next size down. */
export const TOP_RIGHT_ROW_RESERVE_PX = 52;

/* ⛔ NEW-1 (phone-chrome-parity pass, 2026-09-12) — ON NARROW, THE ZOOM STACK SHARES ITS EDGE
 * WITH THE TOOLS EDGE TAB TOO, NOT JUST THE VIEW/LAYERS ROW EVERY SCREEN HAS.
 *
 * Moving the phone "✎ Tools" FAB to an edge tab at `top: 53, height: 84` (mirroring the desktop
 * right rail it stands in for) put a SECOND occupant on the same right edge the zoom stack
 * already shares with the View/Layers row above it — and on a genuinely short canvas (a
 * landscape phone; measured on the exact B1338272 263px-canvas repro) the zoom stack's own
 * un-clamped position sits squarely inside the tab's own band: measured 32×26px real overlap.
 * `TOP_RIGHT_ROW_RESERVE_PX` alone only ever asked the stack to clear the row's ~41px; it has no
 * way to know a second, taller occupant now sits below that row on narrow screens.
 *
 * `TOOLS_TAB_RESERVE_PX` is that tab's own footprint from the pane top — its `top` + height +
 * the SAME 8px breathing gap `TOP_RIGHT_ROW_RESERVE_PX` already budgets — so `zoomStackBottomPx`
 * can be asked (via its `topReserve` parameter) to clear the tab instead of the bare row when the
 * tab is actually on screen. Desktop is untouched: the tab never renders there, so the call site
 * passes the default `TOP_RIGHT_ROW_RESERVE_PX` unchanged. */
export const TOOLS_TAB_RESERVE_PX = 53 + 84 + 8; // tab's own top + height + gap = 145

/* The bottom-right zoom stack's actual `bottom` CSS offset, clamped against the canvas's own
 * REAL height so the stack's top edge can never climb into `TOP_RIGHT_ROW_RESERVE_PX`'s band.
 *
 *   desired  — the offset a comfortably tall canvas uses (tuned to clear the scale bar/FABs)
 *   paneH    — the canvas's TRUE, unclamped height (never a height floored for coordinate math —
 *              see `size.rawH` at the call site; a floored height silently makes this a no-op)
 *   stackH   — the stack's own rendered height (its button height × button count)
 *   floor    — never return less than this, so the stack cannot be pushed low enough to march
 *              into the bottom furniture's own reserve instead of the row above it
 *
 * On any canvas tall enough that `paneH - stackH - topReserve >= desired` (every desktop size,
 * and most phones), this returns `desired` UNCHANGED — the clamp only ever activates on a canvas
 * short enough to need it. `topReserve` defaults to `TOP_RIGHT_ROW_RESERVE_PX` (the View/Layers
 * row every screen shares); a narrow caller passes `TOOLS_TAB_RESERVE_PX` instead once the Tools
 * edge tab is also on screen (NEW-1) — the SAME clamp shape, a different thing to clear. Pure. */
export function zoomStackBottomPx({ desired, paneH, stackH, floor, topReserve = TOP_RIGHT_ROW_RESERVE_PX }) {
  return Math.max(floor, Math.min(desired, paneH - stackH - topReserve));
}

/* ⛔ NEW-1 (regression from B1310209, this item) — A CLEARANCE CONSTANT ASSUMES THE OTHER PANEL IS
 * PASSIVE FURNITURE (a scale bar, a zoom stack) THAT NEVER GROWS TALL. Two PANELS in the same
 * column can each independently size themselves to "the room between my edge and the nearest
 * furniture," and both answers can be honest and still overlap, because neither panel knows the
 * OTHER one is also claiming room in that column.
 *
 * That's what happened here: Layers (`topright`) sizes to `panelMaxHeight({ topPx: 10, bottomPx:
 * 76 })`; the site-plan Adjust panel (`bottomright`) sizes to `panelMaxHeight({ topPx: 70,
 * bottomPx: SCALE_BAR_CLEARANCE_PX })`. Both are real, both are correctly computed, and on a
 * short window (measured: 1600×465 and 1191×465, the owner's own real window sizes) both resolve
 * to nearly the full map height — so they collide across their entire shared width. There is no
 * fifth corner to move either one to, and no clearance number closes this: at 465px tall there is
 * provably not enough room for two independently-sized full-height right-edge panels at once.
 *
 * The fix is NOT a bigger clearance constant. It's MapFinder.jsx's `sitePlanAdjustOpen` effect:
 * Layers force-collapses to its header chip the moment Adjust opens (and its "Imagery & layers"
 * toggle refuses to reopen it while Adjust is open), then restores itself the instant Adjust
 * closes if the user had it open. Read that effect's own header before adding a fifth docked
 * panel or reworking either of these two — a NEW panel that can grow tall in a claimed corner
 * needs the SAME yield relationship with whatever else can be tall in that corner, not a new
 * clearance constant assumed to be enough. */
