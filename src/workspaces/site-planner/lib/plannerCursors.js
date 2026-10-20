/* Site Planner cursor vocabulary (owner-approved convention, 2026-10-20) — ONE place, pure, so the
 * canvas, the Map view and the panels all answer "what does the pointer look like here?" the same way.
 *
 *   idle → default · clickable → pointer · movable body → move · empty pannable surface → grab /
 *   grabbing while panning · any armed draw/place/pick mode → crosshair OVER EVERYTHING · vertex grip
 *   → move · resize grip → the directional arrow FOLLOWING the object's on-screen rotation · rotate
 *   grip → one rotate cursor · disabled → default (never pointer, never not-allowed) · info → help ·
 *   busy → progress · text being edited → text.
 *
 * Nothing here touches React or the DOM except `pinDragCursor` (a root-level override while a drag is
 * live). Guards: repo-root test/ **plannerCursors** + ui-audit **verify-planner-cursors**. */

/** Local copy of the shared rotate cursor (the "shared" session owns src/shared/ui's; this is the
 *  identical shape so the two can be swapped for one import). The fallback keeps a usable cursor. */
export const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M19 12a7 7 0 1 1-2.2-5.1' fill='none' stroke='%23ffffff' stroke-width='4.5' stroke-linecap='round'/%3E%3Cpath d='M19 4v4.5h-4.5' fill='none' stroke='%23ffffff' stroke-width='4.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M19 12a7 7 0 1 1-2.2-5.1' fill='none' stroke='%231f2937' stroke-width='2' stroke-linecap='round'/%3E%3Cpath d='M19 4v4.5h-4.5' fill='none' stroke='%231f2937' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") 12 12, move";

/** Directional resize cursor for an on-screen direction vector (y points DOWN, as on screen). */
export function resizeCursorForVector(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return "nwse-resize";
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
}

/** A resize grip's cursor from the GRIP'S OWN AXES: `sx`,`sy` are its local signs (−1/0/1) and `rotDeg`
 *  the object's on-screen rotation. A corner is the diagonal of the local frame, so a 6:1 warehouse's
 *  corners read nwse/nesw (the centre→corner angle gave ew-resize on every corner), and a rotated
 *  object's grips turn with it. */
export function gripCursor(sx, sy, rotDeg = 0) {
  const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return resizeCursorForVector(sx * c - sy * s, sx * s + sy * c);
}

/** Which drag modes (the `drag.current.mode` strings in SitePlanner.jsx) show which cursor for the whole
 *  gesture. `null` = defer to the cursor the user saw at press (a resize grip's arrow). */
const DRAG_KIND = {
  pan: "grabbing",
  marquee: "crosshair", draw: "crosshair", mkDraw: "crosshair", mkCloudGesture: "crosshair",
  move: "move", groupMove: "move", mkMove: "move", measureMove: "move", moveSheetOverlay: "move",
  callout: "move", printMove: "move", dimMove: "move", easeLabelMove: "move", measChip: "move", acChip: "move",
  vertex: "move", roadVtx: "move", roadEnd: "move", mkVertex: "move", measureVertex: "move",
  elVertex: "move", grLimitVertex: "move", easeVertex: "move",
  rotate: ROTATE_CURSOR, mkRotate: ROTATE_CURSOR, ovRotate: ROTATE_CURSOR, calloutRotate: ROTATE_CURSOR,
  easeLabelRot: ROTATE_CURSOR,
  resize: null, mkResize: null, edgeResize: null, printResize: null, ovScale: null, calloutResize: null, calloutResizeH: null,
};

/** The cursor a live drag shows for its whole gesture. `pressCursor` = what the pressed grip showed. */
export function dragCursorFor(mode, pressCursor) {
  if (!Object.prototype.hasOwnProperty.call(DRAG_KIND, mode)) return null;
  const k = DRAG_KIND[mode];
  if (k) return k;
  return /-resize$/.test(pressCursor || "") ? pressCursor : "nwse-resize";
}

/** The SVG canvas root's idle cursor. ONE function (was a nested ternary): an armed mode owns the cursor
 *  over everything; select/pan owns grab. `addCursor` is the +add cursor for identify mode. */
export function canvasRootCursor(s) {
  if (s.spacePan) return s.panning ? "grabbing" : "grab";
  if (s.identifyMode) return s.addCursor;
  if (s.armedMode || s.editingCorners) return "crosshair";
  if (s.tool === "select" || s.printMode) return s.panning ? "grabbing" : "grab";
  return "crosshair";
}

/** Cursor for something that is only ever CLICKED in select, and is replaced by crosshair when any mode is
 *  armed (tool !== select, corner edit, or one of the pick modes). `locked` things never show move. */
export function bodyCursor({ armed, locked, movable = true, clickable = true }) {
  if (armed) return "crosshair";
  if (locked || !movable) return clickable ? "pointer" : "default";
  return "move";
}

/** A button-like control's cursor: disabled is default (never pointer / not-allowed), busy is progress. */
export function controlCursor({ disabled = false, busy = false } = {}) {
  if (busy) return "progress";
  return disabled ? "default" : "pointer";
}

/* ---- pinning the drag cursor at the document root ---------------------------------------------- */
const PIN_ID = "planyr-drag-cursor-pin";
let pinned = null;

/** Force `cursor` over the whole page until `unpinDragCursor` (so the cursor survives the pointer leaving
 *  the grip). Idempotent; a second pin with the same value is a no-op. */
export function pinDragCursor(cursor, doc = typeof document !== "undefined" ? document : null) {
  if (!doc || !cursor || typeof doc.getElementById !== "function") return;
  if (pinned === cursor && doc.getElementById(PIN_ID)) return;
  let el = doc.getElementById(PIN_ID);
  if (!el) { el = doc.createElement("style"); el.id = PIN_ID; (doc.head || doc.documentElement).appendChild(el); }
  el.textContent = `:root:root, :root:root * { cursor: ${cursor} !important; }`;
  pinned = cursor;
}
export function unpinDragCursor(doc = typeof document !== "undefined" ? document : null) {
  pinned = null;
  if (!doc || typeof doc.getElementById !== "function") return;
  const el = doc.getElementById(PIN_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
export const dragCursorPinned = () => pinned;

/** The lot's own cursor (its boundary hit-band and setback band). A lot's drag PANS the map outside Edit parcels (by design, owner
 *  rule NEW-5 of the Parcels rework), so the cursor says grab there — never move; inside Edit parcels an unlocked lot's drag moves
 *  it (move), a locked one still pans (grab), and over the edge where a click inserts a corner it says "add a point". Remove mode
 *  uses the remove (−) cursor; every other tool is an armed mode (crosshair). */
export function parcelBodyCursor({ tool, parcelMode, editingCorners, locked, addPoint, removeCursor = "pointer", addCursor = "crosshair" }) {
  if (tool === "parcel" && parcelMode === "remove") return removeCursor;
  if (tool !== "select") return "crosshair";
  if (editingCorners) return addPoint ? addCursor : (locked ? "grab" : "move");
  return "grab";
}

/** Run `fn` as a separate task, after the current event's handlers (a MessageChannel yield — never a timer, which a hidden tab clamps). */
export function deferTask(fn) {
  try {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); fn(); };
    ch.port2.postMessage(0);
  } catch (_) { Promise.resolve().then(fn); }
}

/** The ONE stylesheet behind the mode-owned cursors. An armed mode marks the canvas root `data-cursor-mode`; this rule then wins over
 *  every inline per-object cursor beneath it (a stylesheet `!important` beats an inline non-important), so crosshair really is "over
 *  EVERYTHING it can be clicked on" and a new object type cannot forget to ask. The second block makes every disabled control inside
 *  the planner default-cursor regardless of the inline `cursor: "pointer"` its style object carries. Idempotent. */
export function plannerCursorCss({ add = "crosshair", remove = "crosshair" } = {}) {
  const mode = (m, c) => `svg[data-cursor-mode="${m}"], svg[data-cursor-mode="${m}"] * { cursor: ${c} !important; }`;
  return [
    mode("armed", "crosshair"), mode("identify", add), mode("remove", remove), mode("pan", "grab"),
    `svg[data-cursor-mode] textarea, svg[data-cursor-mode] input { cursor: text !important; }`,
    // Map view: a surface that OWNS its cursor (select-parcels, pin drop, calibration, panning) makes every Leaflet feature under it
    // inherit that cursor, instead of Leaflet's `.leaflet-interactive { cursor: pointer }` winning on each feature. Popups and controls
    // keep their own. `.pf-hover-only` = a layer that only shows a tooltip (nothing to click) must not advertise pointer.
    `.leaflet-container[data-cursor-owned] *:not(.leaflet-popup *):not(.leaflet-control *) { cursor: inherit !important; }`,
    `.pf-hover-only { cursor: inherit !important; }`,
    `input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled), select:not(:disabled) { cursor: pointer; }`,
    `button:disabled, select:disabled, input:disabled, [aria-disabled="true"] { cursor: default !important; }`,
  ].join("\n");
}
export function installPlannerCursorStyle(opts, doc = typeof document !== "undefined" ? document : null) {
  if (!doc || typeof doc.getElementById !== "function") return;
  const ID = "planyr-planner-cursor-rules";
  if (doc.getElementById(ID)) return;
  const el = doc.createElement("style");
  el.id = ID;
  el.textContent = plannerCursorCss(opts);
  (doc.head || doc.documentElement).appendChild(el);
}

/** Set (or clear, with a falsy cursor) the cursor a Leaflet map container OWNS. While owned, every feature beneath inherits it
 *  (see `plannerCursorCss`). The one writer for the Map view — never assign `container.style.cursor` directly. */
export function setMapCursor(container, cursor) {
  if (!container) return;
  container.style.cursor = cursor || "";
  if (cursor) container.setAttribute("data-cursor-owned", "");
  else container.removeAttribute("data-cursor-owned");
}
