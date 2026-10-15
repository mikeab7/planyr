/* ImageCropTool — the ONE reusable non-destructive crop UI (B1134754 NEW-21; polygon mode added
 * NEW-1, B1783328), used both BEFORE placement (the upload flow's page-picker step) and AFTER
 * placement (an already-placed overlay's "Crop…" action) — "trimming the flyer down first, then
 * placing, is the natural workflow" (task spec), so both call sites share this one component
 * rather than two.
 *
 * The owner's own ask: "really just crop, like a basic cropping tool" — the STANDARD model
 * (Photoshop / Lightroom / any competent web cropper): an 8-handle rectangle (4 corners + 4 edge
 * midpoints), the area OUTSIDE dimmed with a scrim (never hidden outright — what's being
 * discarded stays visible while you work), rule-of-thirds guides while actively dragging, drag
 * INSIDE the rect to reposition it, Enter/Done commits, Escape/Cancel restores, and an explicit
 * Reset to full page. Aspect ratio is FREE (a site plan crop is whatever shape the artwork is —
 * no presets).
 *
 * NEW-1 (owner, verbatim: "I want to be able to crop via poly line too, main goal is to use it
 * for overlays") adds a second mode: click vertex by vertex, close on the first vertex or Enter
 * (a double-click also closes — detected via the native click's own `detail === 2`, so it never
 * plants a duplicate vertex), Escape cancels an in-progress draw (Backspace drops the last
 * vertex), and a closed polygon's vertices are individually draggable and stay editable on a
 * later visit. Both shapes are held in INDEPENDENT state for the life of one tool session, so
 * toggling Rectangle ⇄ Polygon never destroys the other one's last value — see overlayCrop.js's
 * `cropKind`/`rectToPolyPoints`/`polyPointsToRect` header for the full discriminated-union shape.
 *
 * ⛔ 2026-09-23 hardening (owner live-use report on the Goose Creek master site plan: "it only
 * gives me four control points to mess with, this defeats the whole purpose of the polygon" +
 * "I can't zoom in to get the little piece that I want" + "this is just a shitty workflow"). Two
 * gaps closed:
 * (a) A closed polygon used to be editable ONLY by dragging its existing vertices — there was no
 *     way to ADD one, so switching Rectangle→Polygon handed you the rectangle's four corners and
 *     nothing else, which is a rectangle wearing a polygon's clothes. Now: click an edge to
 *     insert a vertex there (and drag it into place in the same gesture); select a vertex (click
 *     it) and press Delete/Backspace to remove it, floored at MIN_POLY_VERTICES; Shift while
 *     placing or dragging snaps that edge to horizontal/vertical/45°; a small in-tool undo stack
 *     (Ctrl/Cmd+Z) steps back the last placement/drag/insert/delete before anything is committed
 *     to the overlay record. `MAX_POLY_VERTICES` (overlayCrop.js) is a generous 200-point ceiling
 *     — a guard against a runaway click session, not a constraint on a real hand-traced boundary.
 * (b) There was no zoom or pan — the whole sheet was always squeezed to fit the dialog, so
 *     placing a point on a specific corner of a real full-size drawing was guesswork. The tool
 *     now drives the SAME shared pan/zoom engine (`viewport/viewportTransform.js` +
 *     `viewport/viewAnchor.js`'s `wheelZoomFactor`) every other canvas in this app uses: the
 *     scroll wheel zooms about the pointer, Space+drag or a middle-button drag pans, and Fit/100%
 *     buttons are one click away. The crop SHAPE is always stored in image pixels and never reads
 *     the view — `view` only decides where those pixels currently render on screen, so panning or
 *     zooming can never move a stored point relative to the picture (proven in
 *     `test/imageCropViewport.test.js`, which drives the pure projection functions directly).
 *
 * NON-DESTRUCTIVE: this never touches pixels — it only produces a `{kind:'rect', x,y,w,h}` or
 * `{kind:'poly', pts:[[x,y],...]}` value in SOURCE IMAGE pixels (see lib/overlayCrop.js, whose
 * pure clamp/normalize functions this reuses verbatim) for the caller to persist as the `crop`
 * field. Re-opening this tool later against the same crop, or clearing it, always recovers the
 * whole original picture with no re-import.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button, SegmentedControl, MenuItem, menuPanelStyle, FloatingToolbar, FloatingToolButton, FloatingToolDivider } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import {
  clampCropRect, normalizeCrop, isFullCrop,
  clampPolyPoints, normalizePolyCrop, isUsablePoly, cropKind,
  rectToPolyPoints, MIN_POLY_VERTICES, MAX_POLY_VERTICES,
  constrainOctant, nearestOnSegment, savedRectOf, savedPtsOf, isFullImagePoly,
  addPointAtNearestEdge, deletePointAt, canDeletePoint,
} from "../../overlay/overlayCrop.js";
import {
  emptyHistory, pushHistory, undoHistory, redoHistory, canUndo, canRedo,
} from "../../../workspaces/site-planner/lib/cropHistory.js";
import { worldToScreen, screenToWorld, zoomAround, panBy, fitView } from "../../viewport/viewportTransform.js";
import { wheelZoomFactor } from "../../viewport/viewAnchor.js";
import { armCropWatchdog } from "../lib/cropDiag.js";

const HANDLE_SIZE = 12;
const EDGE_LONG = 24; // the four mid-edge grips share ONE footprint: EDGE_LONG along the edge ...
const EDGE_THICK = HANDLE_SIZE; // ... by the same thickness as a corner grip, so no side is a thinner target
const EDGE_HIT = 14; // invisible hit strip along each POLYGON edge, wider than the visible line
const VERTEX_R = 6; // poly vertex handle radius, display px
const CLOSE_HIT_PX = 10; // display-px tolerance for "click near the first vertex closes the polygon"

// Zoom bounds for the shared viewport engine. K_MAX is generous on purpose — NEW-2's whole point
// is "get in close enough to put a point exactly where you mean" on a full-size real sheet, so a
// wheel zoom needs real headroom past 100%. FIT_MAX (1) is the separate, tighter ceiling the Fit
// button itself uses — Fit never blows a small image up past its native size.
const K_MIN = 0.02;
const K_MAX = 16;
// Fit fills the space it is given, so a small image is enlarged to it (zoom is only a view; the
// stored crop is in image px). K_MAX still bounds a wheel/slider zoom.
const FIT_MAX = 8;
// Fit leaves this much room round the picture: the canvas is full-bleed in the dialog now (NEW-1, 2026-10-15), so a grip
// sitting on the picture's own edge would otherwise be half outside the clipped dialog and lose half its grab area.
const FIT_PAD = 16;
// Fit also keeps the picture (and so every grip on its edge) ABOVE the floating toolbar: the pill's height + its offset from
// the bottom + a small gap. Without it the pill sat on the bottom-centre edge grip at Fit (owner, live, 2026-10-15). Pan / zoom
// by hand may still put things under the pill — that is fine; only the framed view is promised clear.
const FIT_BOTTOM_RESERVE = { fill: 72, compact: 56 };
const KEY_PAN_PX = 80; // one arrow-key press; Shift = four steps
const ZOOM_STEP = 1.25; // the +/- buttons and keys

// Which edges each handle type moves, expressed as which of {x,y,w,h} a screen-px delta feeds.
const HANDLE_DELTA = {
  tl: (d, c) => ({ x: c.x + d.dx, y: c.y + d.dy, w: c.w - d.dx, h: c.h - d.dy }),
  tr: (d, c) => ({ x: c.x, y: c.y + d.dy, w: c.w + d.dx, h: c.h - d.dy }),
  bl: (d, c) => ({ x: c.x + d.dx, y: c.y, w: c.w - d.dx, h: c.h + d.dy }),
  br: (d, c) => ({ x: c.x, y: c.y, w: c.w + d.dx, h: c.h + d.dy }),
  t: (d, c) => ({ x: c.x, y: c.y + d.dy, w: c.w, h: c.h - d.dy }),
  b: (d, c) => ({ x: c.x, y: c.y, w: c.w, h: c.h + d.dy }),
  l: (d, c) => ({ x: c.x + d.dx, y: c.y, w: c.w - d.dx, h: c.h }),
  r: (d, c) => ({ x: c.x, y: c.y, w: c.w + d.dx, h: c.h }),
  move: (d, c) => ({ x: c.x + d.dx, y: c.y + d.dy, w: c.w, h: c.h }),
};
const HANDLE_CURSOR = {
  tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize",
  t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize", move: "move",
};

const fullRect = (imgW, imgH) => ({ x: 0, y: 0, w: imgW, h: imgH });
const clampToImage = (v, max) => Math.min(Math.max(0, v), max);

// Small inline icons for the header switch and the floating toolbar (module scope — MODULE-SCOPE-COMPONENTS).
const ICON_PROPS = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
const RectIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" {...ICON_PROPS}><rect x="4" y="6" width="16" height="12" rx="1" /></svg>;
const PolyIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" {...ICON_PROPS}><path d="M12 3 21 9.5 17.5 20h-11L3 9.5Z" /></svg>;
const UndoIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" {...ICON_PROPS}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>;
const RedoIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" {...ICON_PROPS}><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>;
const ResetIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" {...ICON_PROPS}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
const HandIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" {...ICON_PROPS}><path d="M18 11V6a2 2 0 0 0-4 0v5" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" /></svg>;
const MinusIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" {...ICON_PROPS}><path d="M5 12h14" /></svg>;
const PlusIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" {...ICON_PROPS}><path d="M5 12h14M12 5v14" /></svg>;
const FitIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" {...ICON_PROPS}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
const SegLabel = ({ icon, children }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>{icon}{children}</span>;
const MODE_OPTIONS = [
  { key: "rect", label: <SegLabel icon={<RectIcon />}>Rectangle</SegLabel>, testid: "crop-mode-rect" },
  { key: "poly", label: <SegLabel icon={<PolyIcon />}>Polygon</SegLabel>, testid: "crop-mode-poly" },
];
// The selected segment is a dark neutral, never the accent (same convention as the Overlays panel's Draws toggle).
const MODE_SEG_STYLE = { display: "inline-flex", alignItems: "center", padding: "0 14px" };

// This tool's chrome (scrim / handles / rule-of-thirds) is DELIBERATELY fixed dark-on-photo,
// independent of the app's light/dark theme — the same convention every competent photo
// cropper uses (Lightroom, Photoshop): it has to read consistently over an arbitrary uploaded
// picture, not over the app's own surfaces, so no theme token applies. Mirrors
// overlayPlacementHandles.js's own ACCENT/ON_ACCENT "SVG attrs can't use var()" reasoning, one
// step further (this is plain DOM, but the same "editing chrome over a photo" case).
const CROP_SCRIM = "rgba(0,0,0,0.55)"; // design-exempt: fixed photo-editor chrome — see comment above
const CROP_BG = "#111"; // design-exempt: fixed photo-editor chrome — see comment above
const CROP_WHITE = "#fff"; // design-exempt: fixed photo-editor chrome — see comment above
const CROP_RECT_SHADOW = "0 0 0 1px rgba(0,0,0,0.6)"; // design-exempt: fixed photo-editor chrome — see comment above
const CROP_GRID_LINE = "rgba(255,255,255,0.6)"; // design-exempt: fixed photo-editor chrome — see comment above
const CROP_PILL_BG = "rgba(24,26,32,0.95)"; // design-exempt: fixed photo-editor chrome — same dark pill as the floating toolbar (controls.jsx)
const CROP_PILL_TEXT = "#E8EAED"; // design-exempt: fixed photo-editor chrome — same dark pill as the floating toolbar (controls.jsx)
const CROP_HANDLE_RADIUS = 2; // design-exempt: matches overlayPlacementHandles.js's map-side corner-square rx (11px handle, 2px round) — below the RADIUS scale's floor by design, a grip not a surface

/** `src` — the image URL to crop (full resolution). `imgW`/`imgH` — its natural pixel size.
 * `crop` — the current crop value (or null/undefined = full image; either `{kind:'rect',...}`,
 * a legacy no-`kind` rect, or `{kind:'poly', pts}`). `onCommit(crop|null)` — called with a
 * normalized, kind-tagged crop, or null if the result covers the whole image again.
 * `onCancel()` — called on Escape/Cancel, no argument. `maxWidth`/`maxHeight` — the on-screen
 * crop VIEWPORT size (NEW-2: this is now a fixed viewing window the image pans/zooms inside,
 * not a shrink-to-fit box — the caller should hand it as much real screen space as it has).
 * `fill` (NEW-5) — instead of the fixed maxWidth/maxHeight box, the viewport takes whatever room
 * its parent leaves (the parent must give this component a definite height), measured live, and Fit
 * re-runs on resize until the user has zoomed or panned by hand.
 *
 * NEW-1 (2026-10-15, owner-approved mockup) — the chrome is ONE header row (Crop + file name · Rectangle|Polygon
 * switch · Cancel / Done) and ONE floating dark pill over the drawing (Undo · Redo · Reset | Pan | − 19% + Fit);
 * there is no footer. `fileName` is the header's second label. The small pre-placement box (`!fill`, ~420 wide)
 * cannot hold the whole header, so THAT variant alone keeps the shape switch on top and Cancel / Done at the bottom.
 * The old "Trim by feet" strip and the zoom slider are gone. */
export default function ImageCropTool({ src, imgW, imgH, crop, onCommit, onCancel, maxWidth = 720, maxHeight = 520, fill = false, fileName = "" }) {
  const initialKind = crop ? cropKind(crop) : "rect";
  const [mode, setMode] = useState(initialKind);

  // NEW-5 (owner 2026-10-11) — the crop IS the shape of the active mode, nothing else. An overlay saved by
  // an older build with BOTH a polygon and a hidden rectangle renders only its active `kind` (that is what
  // `clipPathValueForCrop` / `cropClipShapeScreen` have always done), so reading just the active shape here
  // shows exactly what is on the map, and the next Done drops the unused one for good.
  const initialRectRef = useRef(initialKind === "rect" ? savedRectOf(crop) : null);
  const initialPtsRef = useRef(initialKind === "poly" ? savedPtsOf(crop) : null);

  // Rect draft — the saved rectangle, else the full image.
  const [draft, setDraft] = useState(() => (
    initialRectRef.current ? clampCropRect(initialRectRef.current, imgW, imgH) : fullRect(imgW, imgH)
  ));

  // Poly draft — a saved polygon when there is one; a genuinely uncropped (or rect-cropped) overlay opens
  // Polygon straight into an empty, open draw so the first click places vertex 1 rather than a closed
  // full-frame quad that swallows clicks.
  const [polyPts, setPolyPts] = useState(() => {
    if (initialPtsRef.current) return clampPolyPoints(initialPtsRef.current, imgW, imgH) || [];
    return [];
  });
  const [polyClosed, setPolyClosed] = useState(!!initialPtsRef.current);
  const [selectedVertex, setSelectedVertex] = useState(null); // index, closed mode only

  const [dragType, setDragType] = useState(null); // rect handle key while a gesture is live, else null
  const dragRef = useRef(null); // { type, startX, startY, startCrop } — screen px at grab
  const [draggingVertex, setDraggingVertex] = useState(null); // poly vertex index while dragging
  const vertexDragRef = useRef(null); // { idx, startX, startY, startPt }
  // NEW-4 — ONE undo/redo history for BOTH shapes (cropHistory.js). A snapshot is the whole tool
  // state a step can change, tagged with the mode it was made in so undo also returns you to it.
  const [hist, setHist] = useState(emptyHistory);
  const rootRef = useRef(null);
  const boxRef = useRef(null); // the fixed-size viewport box, for converting a client point to image px

  const [measured, setMeasured] = useState(null); // fill mode: the viewport box's real size
  const VIEW_W = Math.max(1, Math.round(fill && measured ? measured.w : maxWidth));
  const VIEW_H = Math.max(1, Math.round(fill && measured ? measured.h : maxHeight));

  // ---- pan/zoom viewport (NEW-2) — the SAME { scale, tx, ty } model every canvas in this app
  // drives. `view` only ever decides where an image-px point currently renders on screen; the
  // crop shapes above are stored in image px and never read it, which is what makes panning and
  // zooming unable to move a crop relative to the picture (VIEW-INDEPENDENT-ONCE in spirit — the
  // shape's own geometry has no view term).
  const [view, setView] = useState(() => fitView(imgW, imgH, VIEW_W, VIEW_H - (fill ? FIT_BOTTOM_RESERVE.fill : FIT_BOTTOM_RESERVE.compact), { pad: FIT_PAD, min: K_MIN, max: FIT_MAX, mode: "page" }));
  const userMovedRef = useRef(false); // true once the user zooms/pans by hand; Fit resets it
  const [handTool, setHandTool] = useState(false); // NEW-3: the on-screen Pan tool (left-drag pans)
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef(null); // { startX, startY, startView }
  const panClickGuardRef = useRef(false); // a pan's pointer-up still fires a `click` on the click-catcher — swallow that one

  const toScreen = (x, y) => worldToScreen(view, { x, y });
  const toImage = (x, y) => screenToWorld(view, { x, y });

  const maskId = useId();
  const rectMaskId = `cropRectMask-${maskId}`;
  const polyMaskId = `cropPolyMask-${maskId}`;

  // ---- rect handle dragging (unchanged from B1134754, screen deltas just read the live scale) --
  const beginDrag = (type) => (e) => {
    if (e.button != null && e.button !== 0) return; // right-press opens the menu (poly) / does nothing — never starts a drag
    e.preventDefault();
    e.stopPropagation();
    // The undo frame is pushed on the first real movement, not the press: a plain click on a handle
    // must not leave a do-nothing step behind now that Undo is a visible button.
    dragRef.current = { type, startX: e.clientX, startY: e.clientY, startCrop: draft, snap: snapNow(), pushed: false };
    setDragType(type);
  };

  useEffect(() => {
    if (!dragType) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / view.scale, dy = (e.clientY - d.startY) / view.scale;
      if (!d.pushed && (dx !== 0 || dy !== 0)) { d.pushed = true; setHist((h) => pushHistory(h, d.snap)); }
      const raw = HANDLE_DELTA[d.type]({ dx, dy }, d.startCrop);
      setDraft(clampCropRect(raw, imgW, imgH));
    };
    const onUp = () => { dragRef.current = null; setDragType(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [dragType, view.scale, imgW, imgH]);

  // ---- undo / redo (NEW-1 hardening, extended to both shapes + redo in NEW-4) — a snapshot is
  // pushed BEFORE each mutating gesture (placement, insert, drag-start, delete, clear, reset).
  const snapNow = () => ({ mode, draft, pts: polyPts, closed: polyClosed });
  const pushUndo = () => setHist((h) => pushHistory(h, snapNow()));
  const pushPolyUndo = pushUndo; // name kept for the polygon gestures below
  const applySnap = (sn) => {
    setMode(sn.mode);
    setDraft(sn.draft);
    setPolyPts(sn.pts);
    setPolyClosed(sn.closed);
    setSelectedVertex(null);
  };
  const undo = () => {
    const r = undoHistory(hist, snapNow());
    if (!r) return;
    setHist(r.history);
    applySnap(r.snap);
  };
  const redo = () => {
    const r = redoHistory(hist, snapNow());
    if (!r) return;
    setHist(r.history);
    applySnap(r.snap);
  };

  // ---- poly vertex dragging (NEW-1; Shift constrains to 0/45/90° from the drag's own start) ----
  const beginVertexDrag = (idx) => (e) => {
    if (e.button != null && e.button !== 0) return; // NEW-4: a right-press must not start a drag
    e.preventDefault();
    e.stopPropagation();
    vertexDragRef.current = { idx, startX: e.clientX, startY: e.clientY, startPt: polyPts[idx], snap: snapNow(), pushed: false };
    setDraggingVertex(idx);
    setSelectedVertex(idx);
  };

  useEffect(() => {
    if (draggingVertex == null) return undefined;
    const onMove = (e) => {
      const d = vertexDragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / view.scale, dy = (e.clientY - d.startY) / view.scale;
      if (!d.pushed && (dx !== 0 || dy !== 0)) { d.pushed = true; setHist((h) => pushHistory(h, d.snap)); }
      let nx = d.startPt[0] + dx, ny = d.startPt[1] + dy;
      if (e.shiftKey) [nx, ny] = constrainOctant(d.startPt, [nx, ny]);
      nx = clampToImage(nx, imgW);
      ny = clampToImage(ny, imgH);
      setPolyPts((pts) => pts.map((p, i) => (i === d.idx ? [nx, ny] : p)));
    };
    const onUp = () => { vertexDragRef.current = null; setDraggingVertex(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [draggingVertex, view.scale, imgW, imgH]);

  // ---- insert a vertex on an existing edge (NEW-1) — press near an edge and it both inserts AND
  // starts dragging the new point in the same gesture, so "insert, then place it" is one motion.
  const beginEdgeInsert = (i) => (e) => {
    if (e.button != null && e.button !== 0) return; // NEW-4: a right-press must not insert a point (the menu does, on request)
    e.preventDefault();
    e.stopPropagation();
    if (polyPts.length >= MAX_POLY_VERTICES) return;
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const { x: ix, y: iy } = toImage(e.clientX - r.left, e.clientY - r.top);
    const a = polyPts[i], b = polyPts[(i + 1) % polyPts.length];
    const near = nearestOnSegment([ix, iy], a, b);
    const pt = [clampToImage(near.x, imgW), clampToImage(near.y, imgH)];
    pushPolyUndo();
    setPolyPts((pts) => { const next = pts.slice(); next.splice(i + 1, 0, pt); return next; });
    vertexDragRef.current = { idx: i + 1, startX: e.clientX, startY: e.clientY, startPt: pt, pushed: true }; // the insert pushed its own frame above
    setDraggingVertex(i + 1);
    setSelectedVertex(i + 1);
  };

  // ---- right-click point editing (NEW-4, Polygon mode, closed ring) ----------------------------
  // Right-click a point → "Delete point" (disabled, not hidden, at the 3-point floor); right-click
  // anywhere else → "Add control point" EXACTLY where you clicked, spliced into the nearest edge. Both go
  // through the same undo stack as every other gesture. The browser's own menu is suppressed on the canvas.
  const [menu, setMenu] = useState(null); // { kind: "vertex"|"canvas", x, y (client), idx?, pt? }
  const menuRef = useRef(null);
  const clientToImagePt = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    const p = toImage(e.clientX - r.left, e.clientY - r.top);
    return [clampToImage(p.x, imgW), clampToImage(p.y, imgH)];
  };
  const onVertexContext = (idx) => (e) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedVertex(idx);
    setMenu({ kind: "vertex", idx, x: e.clientX, y: e.clientY });
  };
  const onCanvasContext = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!polyClosed || !boxRef.current) { setMenu(null); return; }
    setMenu({ kind: "canvas", pt: clientToImagePt(e), x: e.clientX, y: e.clientY });
  };
  const menuAddPoint = () => {
    if (!menu || menu.kind !== "canvas") return;
    const next = addPointAtNearestEdge(polyPts, menu.pt);
    if (next !== polyPts) { pushPolyUndo(); setPolyPts(next); }
    setMenu(null);
  };
  const menuDeletePoint = () => {
    if (!menu || menu.kind !== "vertex" || !canDeletePoint(polyPts)) return;
    pushPolyUndo();
    setPolyPts(deletePointAt(polyPts, menu.idx));
    setSelectedVertex(null);
    setMenu(null);
  };
  useEffect(() => { setMenu(null); }, [mode, polyClosed]);
  useEffect(() => {
    if (!menu) return undefined;
    const away = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) setMenu(null); };
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("blur", close); window.removeEventListener("resize", close); };
  }, [menu]);
  useEffect(() => { if (menu && menuRef.current) { const b = menuRef.current.querySelector("button:not([disabled])"); if (b) b.focus(); } }, [menu]);

  // ---- poly drawing (click to place a vertex; NEW-1) ------------------------------------------
  // A native double-click fires click(detail:1) → click(detail:2) → dblclick — so "double-click
  // also closes" is handled right here via `e.detail`, never a separate onDoubleClick: the first
  // click of the pair already placed a vertex through the ordinary path below, and treating the
  // SECOND click as "close, don't add" is what stops a double-click from planting a duplicate
  // vertex on top of the one the first click just placed.
  const onDrawClick = (e) => {
    // A pan (Pan tool, Space+drag) must never plant a point where the mouse comes up.
    if (panClickGuardRef.current || handTool || spaceDown) return;
    if (polyClosed) { setSelectedVertex(null); return; }
    if (e.detail >= 2) {
      if (polyPts.length >= MIN_POLY_VERTICES) setPolyClosed(true);
      return;
    }
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (polyPts.length >= MIN_POLY_VERTICES) {
      const first = toScreen(polyPts[0][0], polyPts[0][1]);
      const distPx = Math.hypot(sx - first.x, sy - first.y);
      if (distPx <= CLOSE_HIT_PX) { setPolyClosed(true); return; }
    }
    if (polyPts.length >= MAX_POLY_VERTICES) return;
    const raw = toImage(sx, sy);
    let px = clampToImage(raw.x, imgW), py = clampToImage(raw.y, imgH);
    if (e.shiftKey && polyPts.length > 0) {
      const last = polyPts[polyPts.length - 1];
      [px, py] = constrainOctant(last, [px, py]);
      px = clampToImage(px, imgW);
      py = clampToImage(py, imgH);
    }
    pushPolyUndo();
    setPolyPts((pts) => [...pts, [px, py]]);
  };

  // Done saves the ACTIVE mode's shape and nothing else (NEW-5). A full-page rectangle / full-page ring
  // is "no crop", which collapses to null.
  const commit = () => {
    if (mode === "poly") {
      const pts = isFullImagePoly(polyPts, imgW, imgH) ? null : normalizePolyCrop(polyPts, imgW, imgH);
      onCommit(pts ? { kind: "poly", pts } : null);
    } else {
      const rect = normalizeCrop(draft, imgW, imgH);
      onCommit(rect ? { kind: "rect", ...rect } : null);
    }
  };
  // "Reset to full page" — the ONE reset: removes whatever crop is set (both modes go back to the whole
  // page), so Done then saves "no crop". Polygon becomes the closed full-page quad, never an emptied draw.
  const resetAll = () => {
    pushUndo();
    setDraft(fullRect(imgW, imgH));
    setPolyPts(rectToPolyPoints(fullRect(imgW, imgH)));
    setPolyClosed(true);
    setSelectedVertex(null);
  };
  // NEW-1 (B2103xxx-class, owner 2026-10-05): three points already describe a shape, so an OPEN draft is
  // savable — Done closes the ring itself. The explicit closes (first point / Enter / double-click) stay.
  const canCommit = mode === "poly" ? isUsablePoly(polyPts, imgW, imgH) : true;
  const nothingToReset = isFullCrop(draft, imgW, imgH) && (polyPts.length === 0 || (polyClosed && isFullImagePoly(polyPts, imgW, imgH)));
  const doneWhy = mode === "poly" && !canCommit
    ? (polyPts.length < MIN_POLY_VERTICES
      ? `Place at least ${MIN_POLY_VERTICES} points to save`
      : "This polygon is too small to crop to")
    : "";

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;

      // An open right-click menu owns Escape: it closes the menu, never the dialog.
      if (menu && k === "Escape") { e.preventDefault(); e.stopPropagation(); setMenu(null); return; }

      // NEW-4 — undo / redo, in BOTH modes: Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y (Cmd on a Mac).
      if (mod && (k === "z" || k === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && (k === "y" || k === "Y")) { e.preventDefault(); redo(); return; }

      // NEW-3 — arrow keys pan, +/- zoom (about the middle of the viewport).
      if (!inField && !mod) {
        const step = KEY_PAN_PX * (e.shiftKey ? 4 : 1);
        const dir = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[k];
        if (dir) { e.preventDefault(); userMovedRef.current = true; setView((v) => panBy(v, dir[0], dir[1])); return; }
        if (k === "+" || k === "=") { e.preventDefault(); zoomBy(ZOOM_STEP); return; }
        if (k === "-" || k === "_") { e.preventDefault(); zoomBy(1 / ZOOM_STEP); return; }
      }
      // Enter on a focused toolbar button is that button's own click, never also "Done".
      // ...except while a polygon is drafting: Enter closes it wherever focus sits (B2066225), and the
      // preventDefault below also stops it re-firing the focused button.
      if (k === "Enter" && tag === "BUTTON" && !(mode === "poly" && !polyClosed)) return;

      if (mode !== "poly") {
        if (k === "Escape") { e.preventDefault(); onCancel(); }
        else if (k === "Enter") { e.preventDefault(); commit(); }
        return;
      }

      if (!polyClosed) {
        if (e.key === "Escape") { e.preventDefault(); pushPolyUndo(); setPolyPts([]); return; }
        if (e.key === "Backspace") {
          e.preventDefault();
          if (polyPts.length) { pushPolyUndo(); setPolyPts((pts) => pts.slice(0, -1)); }
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (polyPts.length >= MIN_POLY_VERTICES) setPolyClosed(true);
          return;
        }
        return; // swallow other keys while genuinely mid-draw — never falls through to commit/cancel
      }

      // closed — a selected vertex takes Delete/Backspace (floored at MIN_POLY_VERTICES) and a
      // first Escape just deselects, so escaping a delete-in-progress doesn't also close the dialog
      if (selectedVertex != null && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        if (polyPts.length > MIN_POLY_VERTICES) {
          pushPolyUndo();
          setPolyPts((pts) => pts.filter((_, idx) => idx !== selectedVertex));
        }
        setSelectedVertex(null);
        return;
      }
      if (selectedVertex != null && e.key === "Escape") { e.preventDefault(); setSelectedVertex(null); return; }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); commit(); }
    };
    const el = rootRef.current;
    el && el.addEventListener("keydown", onKey);
    return () => { el && el.removeEventListener("keydown", onKey); };
  }, [draft, mode, polyClosed, polyPts, selectedVertex, hist, menu]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard focus must stay inside the tool: a toolbar button that disables itself after being
  // pressed (Undo/Redo at the end of their history) drops focus to <body>, and then Ctrl+Z, the
  // arrow keys and Enter would silently stop reaching this tool's key handler.
  useEffect(() => {
    const a = document.activeElement;
    if (!a || a === document.body) rootRef.current && rootRef.current.focus();
  }, [hist, mode, handTool]);

  // ---- wheel zoom, about the pointer (NEW-2) — a native, non-passive listener so preventDefault
  // reliably stops the page from scrolling under the dialog; the same wheelZoomFactor every other
  // canvas in this app uses, so a mouse notch and a trackpad nudge feel the same here too.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = wheelZoomFactor(e);
      if (factor === 1) return;
      const r = box.getBoundingClientRect();
      const ax = e.clientX - r.left, ay = e.clientY - r.top;
      userMovedRef.current = true;
      setView((v) => zoomAround(v, factor, ax, ay, K_MIN, K_MAX));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  // ---- Space held = temporary hand-pan (NEW-2), mirroring the main canvas's own convention -----
  useEffect(() => {
    const isEditable = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onKeyDown = (e) => {
      if (e.code !== "Space" || e.repeat || isEditable()) return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const onKeyUp = (e) => { if (e.code === "Space") setSpaceDown(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  const beginPan = (e) => {
    panRef.current = { startX: e.clientX, startY: e.clientY, startView: view };
    panClickGuardRef.current = true;
    setIsPanning(true);
  };
  useEffect(() => {
    if (!isPanning) return undefined;
    const onMove = (e) => {
      const p = panRef.current;
      if (!p) return;
      userMovedRef.current = true;
      setView(panBy(p.startView, e.clientX - p.startX, e.clientY - p.startY));
    };
    // The browser fires the drag's `click` right after pointer-up (same task), so the guard drops on the next one.
    const onUp = () => { panRef.current = null; setIsPanning(false); setTimeout(() => { panClickGuardRef.current = false; }, 0); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [isPanning]);
  // Middle-button OR Space+left always pans, whatever mode/tool is active — checked in the
  // CAPTURE phase on the viewport itself so it runs before a handle's/vertex's own onPointerDown
  // (which stop propagation), the same "pan wins" rule the main canvas's `shouldPan` encodes.
  const onViewportPointerDownCapture = (e) => {
    if (e.button === 1 || (e.button === 0 && (spaceDown || handTool))) {
      e.preventDefault();
      e.stopPropagation();
      beginPan(e);
    }
  };
  const fitNow = () => fitView(imgW, imgH, VIEW_W, VIEW_H - (fill ? FIT_BOTTOM_RESERVE.fill : FIT_BOTTOM_RESERVE.compact), { pad: FIT_PAD, min: K_MIN, max: FIT_MAX, mode: "page" });
  const doFit = () => { userMovedRef.current = false; setView(fitNow()); };
  const do100 = () => { userMovedRef.current = true; setView((v) => zoomAround(v, 1 / v.scale, VIEW_W / 2, VIEW_H / 2, K_MIN, K_MAX)); };
  const zoomBy = (f) => { userMovedRef.current = true; setView((v) => zoomAround(v, f, VIEW_W / 2, VIEW_H / 2, K_MIN, K_MAX)); };

  // NEW-5 — fill mode: measure the room the parent leaves and keep the picture fitted to it until
  // the user takes over the view by hand.
  useLayoutEffect(() => {
    if (!fill) return undefined;
    const box = boxRef.current;
    if (!box) return undefined;
    const read = () => {
      const r = box.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setMeasured((m) => (m && Math.abs(m.w - r.width) < 1 && Math.abs(m.h - r.height) < 1 ? m : { w: r.width, h: r.height }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, [fill]);
  useLayoutEffect(() => {
    if (fill && measured && !userMovedRef.current) setView(fitNow());
  }, [fill, measured, imgW, imgH]); // eslint-disable-line react-hooks/exhaustive-deps

  // Screen-space rect for the crop, laying out the scrim/border/handles — derived fresh from
  // `view` every render, so pan/zoom can never leave the crop rendered out of step with the image.
  const rTL = toScreen(draft.x, draft.y), rBR = toScreen(draft.x + draft.w, draft.y + draft.h);
  const rx = rTL.x, ry = rTL.y, rw = rBR.x - rTL.x, rh = rBR.y - rTL.y;

  const handleEl = (type, style, cursor) => (
    <div key={type} data-testid={`crop-handle-${type}`} onPointerDown={beginDrag(type)} style={{
      position: "absolute", cursor, touchAction: "none", pointerEvents: "auto", ...style,
    }} />
  );
  const polyPtsScreen = polyPts.map(([x, y]) => { const s = toScreen(x, y); return [s.x, s.y]; });
  const polyPointsAttr = polyPtsScreen.map(([x, y]) => `${x},${y}`).join(" ");
  const zoomPct = Math.round(view.scale * 100);

  // NEW-2 (2026-10-15) — self-capturing diagnostics (cropDiag.js): the owner's "couldn't click anything" freeze has not
  // reproduced, so the dialog reports its own open state and watches for dead / blocked pointers and stalls.
  const imgElRef = useRef(null);
  const diagRef = useRef({});
  diagRef.current = { imgW, imgH, view, viewW: VIEW_W, viewH: VIEW_H, fill, mode, renders: (diagRef.current.renders || 0) + 1, rev: diagRef.current.rev || 0 };
  useEffect(() => { diagRef.current.rev = (diagRef.current.rev || 0) + 1; }, [mode, draft, polyPts, polyClosed, selectedVertex, view, hist, handTool, menu, dragType, draggingVertex]);
  useEffect(() => armCropWatchdog({ root: rootRef.current, get: () => ({ ...diagRef.current, imgEl: imgElRef.current }) }), []);

  const modeSwitch = (
    <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} data-testid="crop-mode"
      accent="var(--text-primary)" onAccent="var(--surface-raised)" aria-label="Crop shape" segmentStyle={MODE_SEG_STYLE} />
  );
  const cancelBtn = <Button size="md" variant="ghost" onClick={onCancel} data-testid="crop-cancel">Cancel</Button>;
  const doneBtn = <Button size="md" onClick={commit} disabled={!canCommit} title={doneWhy || undefined} data-testid="crop-done">Done</Button>;
  const doneWhyEl = doneWhy ? <span data-testid="crop-done-why" style={{ fontSize: FONT_SIZE.label, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{doneWhy}</span> : null;
  const hintText = mode !== "poly" ? "" : (!polyClosed
    ? "Click to place points · Click the first point or press Enter to close"
    : "Click an edge to add a point · Drag a point to move it · Delete removes the selected point");

  return (
    <div ref={rootRef} tabIndex={-1} style={{ outline: "none", ...(fill ? { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } : {}) }}>
      {fill ? (
        // ONE header row replaces the old title line, toolbar row and footer: name left, shape switch centre,
        // Cancel / Done right. The side columns are minmax(0, 1fr) so a long file name truncates instead of
        // pushing the switch off-centre.
        <div data-testid="crop-header" style={{
          flex: "none", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: 16,
          padding: "10px 16px", borderBottom: "1px solid var(--border-default)",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <h1 style={{ margin: 0, flex: "none", fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--text-primary)" }}>Crop</h1>
            {fileName && <span title={fileName} data-testid="crop-file-name" style={{ minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fileName}</span>}
          </div>
          {modeSwitch}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
            {doneWhyEl}{cancelBtn}{doneBtn}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 6 }}>{modeSwitch}</div>
      )}

      <div style={{ position: "relative", ...(fill ? { flex: 1, minHeight: 0, width: "100%" } : { width: VIEW_W, height: VIEW_H }) }}>
      <div ref={boxRef} onPointerDownCapture={onViewportPointerDownCapture} onContextMenu={(e) => e.preventDefault()} data-testid="crop-canvas" style={{
        position: "absolute", inset: 0, userSelect: "none",
        ...(fill ? {} : { border: "1px solid var(--border-default)", borderRadius: RADIUS.sm }), background: CROP_BG, boxSizing: "border-box",
        cursor: (spaceDown || handTool) ? (isPanning ? "grabbing" : "grab") : "default", touchAction: "none",
      }}>
        {/* image layer — clipped to the viewport so a pan/zoom can never spill the picture past
            the dialog's own edge; NOT the layer scrims/handles render in (see below) */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          <img ref={imgElRef} src={src} alt="" draggable={false} style={{
            position: "absolute", left: 0, top: 0, width: imgW, height: imgH, transformOrigin: "0 0",
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          }} />
        </div>

        {/* chrome layer — deliberately NOT clipped (unlike B1134754's original single fit-sized
            box, a handle sitting exactly at the crop's own edge must never lose half its grab area) */}
        <div style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {mode === "rect" ? (
            <>
              <svg width={VIEW_W} height={VIEW_H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <mask id={rectMaskId}>
                  <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="white" />
                  <rect x={rx} y={ry} width={Math.max(0, rw)} height={Math.max(0, rh)} fill="black" />
                </mask>
                <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={CROP_SCRIM} mask={`url(#${rectMaskId})`} />
              </svg>

              {/* The crop rect itself — border, rule-of-thirds while dragging, and the move surface. */}
              <div
                onPointerDown={beginDrag("move")}
                style={{
                  position: "absolute", left: rx, top: ry, width: rw, height: rh, pointerEvents: "auto",
                  border: `1.5px solid ${CROP_WHITE}`, boxShadow: CROP_RECT_SHADOW, cursor: "move", touchAction: "none",
                }}
              >
                {dragType && (
                  <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                    <line x1="33.33%" y1="0" x2="33.33%" y2="100%" stroke={CROP_GRID_LINE} strokeWidth="1" />
                    <line x1="66.67%" y1="0" x2="66.67%" y2="100%" stroke={CROP_GRID_LINE} strokeWidth="1" />
                    <line x1="0" y1="33.33%" x2="100%" y2="33.33%" stroke={CROP_GRID_LINE} strokeWidth="1" />
                    <line x1="0" y1="66.67%" x2="100%" y2="66.67%" stroke={CROP_GRID_LINE} strokeWidth="1" />
                  </svg>
                )}
              </div>

              {/* 4 corner handles */}
              {[["tl", rx, ry], ["tr", rx + rw, ry], ["bl", rx, ry + rh], ["br", rx + rw, ry + rh]].map(([type, cx, cy]) =>
                handleEl(type, {
                  left: cx - HANDLE_SIZE / 2, top: cy - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE,
                  background: CROP_WHITE, border: "1.5px solid var(--accent)", borderRadius: CROP_HANDLE_RADIUS,
                }, HANDLE_CURSOR[type])
              )}
              {/* 4 edge-midpoint handles — one shared footprint (NEW-6): EDGE_LONG along the edge by the
                  corner grips' own thickness, visible like the corners, so no side is a thinner target */}
              {[["t", rx + rw / 2, ry], ["b", rx + rw / 2, ry + rh], ["l", rx, ry + rh / 2], ["r", rx + rw, ry + rh / 2]].map(([type, cx, cy]) => {
                const horiz = type === "t" || type === "b";
                const w = horiz ? EDGE_LONG : EDGE_THICK, h = horiz ? EDGE_THICK : EDGE_LONG;
                return handleEl(type, {
                  left: cx - w / 2, top: cy - h / 2, width: w, height: h,
                  background: CROP_WHITE, border: "1.5px solid var(--accent)", borderRadius: CROP_HANDLE_RADIUS,
                }, HANDLE_CURSOR[type]);
              })}
            </>
          ) : (
            <svg width={VIEW_W} height={VIEW_H} style={{ position: "absolute", inset: 0 }}>
              <mask id={polyMaskId}>
                <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="white" />
                {/* NEW-2 (2026-09-23) — the hole is punched from the CURRENT points even before the
                    ring is closed, so what's kept vs. dropped is visible live while drawing, not
                    only after the shape closes. */}
                {polyPtsScreen.length >= 3 && (
                  <polygon points={polyPointsAttr} fill="black" fillRule="evenodd" />
                )}
              </mask>
              <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={CROP_SCRIM} mask={`url(#${polyMaskId})`} style={{ pointerEvents: "none" }} />

              {polyPtsScreen.length > 0 && (
                polyClosed
                  ? <polygon points={polyPointsAttr} fill="none" fillRule="evenodd" stroke={CROP_WHITE} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                  : <>
                      <polyline points={polyPointsAttr} fill="none" stroke={CROP_WHITE} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                      {polyPtsScreen.length >= 3 && (
                        <line
                          x1={polyPtsScreen[polyPtsScreen.length - 1][0]} y1={polyPtsScreen[polyPtsScreen.length - 1][1]}
                          x2={polyPtsScreen[0][0]} y2={polyPtsScreen[0][1]}
                          stroke={CROP_WHITE} strokeWidth={1} strokeDasharray="4 4" opacity={0.7}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                    </>
              )}

              {/* click-catcher — places a vertex while drawing; deselects the selected vertex once closed */}
              <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="transparent"
                style={{ cursor: !polyClosed ? "crosshair" : "default", pointerEvents: "auto" }}
                onClick={onDrawClick} onContextMenu={onCanvasContext} />

              {/* edge hit-targets — insert a vertex; rendered BEFORE the vertex circles so a vertex
                  always wins the hit test at an endpoint (CHROME-NEVER-EATS-A-PRESS: later paints on top) */}
              {polyClosed && polyPtsScreen.map(([x, y], i) => {
                const [nx, ny] = polyPtsScreen[(i + 1) % polyPtsScreen.length];
                return (
                  <line key={`edge-${i}`} x1={x} y1={y} x2={nx} y2={ny}
                    stroke="transparent" strokeWidth={EDGE_HIT}
                    style={{ cursor: "copy", touchAction: "none", pointerEvents: "auto" }}
                    onPointerDown={beginEdgeInsert(i)} onContextMenu={onCanvasContext} data-testid={`crop-poly-edge-${i}`} />
                );
              })}

              {!polyClosed && polyPtsScreen.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={i === 0 ? VERTEX_R : 3}
                  fill={i === 0 ? "var(--accent)" : CROP_WHITE} stroke={CROP_WHITE} strokeWidth={1}
                  style={{ pointerEvents: "none" }} />
              ))}
              {polyClosed && polyPtsScreen.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={VERTEX_R}
                  fill={selectedVertex === i ? "var(--accent)" : CROP_WHITE}
                  stroke="var(--accent)" strokeWidth={selectedVertex === i ? 2.5 : 1.5}
                  style={{ cursor: "move", touchAction: "none", pointerEvents: "auto" }}
                  onPointerDown={beginVertexDrag(i)} onContextMenu={onVertexContext(i)} data-testid={`crop-poly-vertex-${i}`} />
              ))}
            </svg>
          )}
        </div>

      </div>

      {/* The polygon hint — a small dark pill at the TOP-LEFT of the drawing; chrome that never takes a press. */}
      {hintText && (
        <div data-testid="crop-poly-hint" style={{
          position: "absolute", left: 12, top: 12, maxWidth: "calc(100% - 24px)", padding: "6px 12px", borderRadius: RADIUS.md,
          background: CROP_PILL_BG, color: CROP_PILL_TEXT, fontSize: FONT_SIZE.label, pointerEvents: "none",
        }}>{hintText}</div>
      )}

      {/* The floating view toolbar — bottom-centre over the drawing. A sibling of the canvas box (not a child), so
          the box's capture-phase pan handler can never swallow a press on these buttons. */}
      <FloatingToolbar aria-label="View and history" data-testid="crop-toolbar" style={{ position: "absolute", left: "50%", bottom: fill ? 16 : 8, transform: "translateX(-50%)", zIndex: 2 }}>
        <FloatingToolButton compact={!fill} onClick={undo} disabled={!canUndo(hist)} data-testid="crop-undo" title="Undo (Ctrl+Z)" aria-label="Undo"><UndoIcon /></FloatingToolButton>
        <FloatingToolButton compact={!fill} onClick={redo} disabled={!canRedo(hist)} data-testid="crop-redo" title="Redo (Ctrl+Shift+Z or Ctrl+Y)" aria-label="Redo"><RedoIcon /></FloatingToolButton>
        <FloatingToolButton compact={!fill} onClick={resetAll} disabled={nothingToReset} data-testid="crop-reset" title="Back to the whole sheet" aria-label="Reset — back to the whole sheet">
          <ResetIcon />{fill && "Reset"}
        </FloatingToolButton>
        <FloatingToolDivider />
        <FloatingToolButton compact={!fill} active={handTool} onClick={() => setHandTool((v) => !v)} data-testid="crop-pan-tool" aria-label="Pan"
          title="Pan — drag the picture to move it (or hold Space, or use the arrow keys). Scroll to zoom."><HandIcon /></FloatingToolButton>
        <FloatingToolDivider />
        <FloatingToolButton compact={!fill} onClick={() => zoomBy(1 / ZOOM_STEP)} data-testid="crop-zoom-out" aria-label="Zoom out" title="Zoom out (−)"><MinusIcon /></FloatingToolButton>
        <FloatingToolButton compact={!fill} onClick={do100} data-testid="crop-zoom-100" aria-label={`Zoom ${zoomPct}% — press for 100%`} title="Current zoom — press to jump to 100%"
          style={{ minWidth: 52 }}>{zoomPct}%</FloatingToolButton>
        <FloatingToolButton compact={!fill} onClick={() => zoomBy(ZOOM_STEP)} data-testid="crop-zoom-in" aria-label="Zoom in" title="Zoom in (+)"><PlusIcon /></FloatingToolButton>
        <FloatingToolButton compact={!fill} onClick={doFit} data-testid="crop-zoom-fit" aria-label="Fit sheet" title="Fit the whole sheet"><FitIcon /></FloatingToolButton>
      </FloatingToolbar>
      </div>

      {!fill && (
        // The small pre-placement box can't hold Cancel / Done in a header, so for THIS variant they stay at the bottom.
        <div data-testid="crop-footer" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 6, gap: 8 }}>
          {doneWhyEl}{cancelBtn}{doneBtn}
        </div>
      )}

      {menu && (
        <div ref={menuRef} role="menu" data-testid="crop-context-menu" onContextMenu={(e) => e.preventDefault()}
          style={{ ...menuPanelStyle, position: "fixed", zIndex: 10, minWidth: 168,
            left: Math.max(4, Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 180)),
            top: Math.max(4, Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 56)) }}>
          {menu.kind === "vertex" ? (
            <MenuItem role="menuitem" data-testid="crop-menu-delete-point" disabled={!canDeletePoint(polyPts)} aria-disabled={!canDeletePoint(polyPts)}
              title={canDeletePoint(polyPts) ? undefined : `A polygon needs at least ${MIN_POLY_VERTICES} points`} onClick={menuDeletePoint}>Delete point</MenuItem>
          ) : (
            <MenuItem role="menuitem" data-testid="crop-menu-add-point" disabled={polyPts.length >= MAX_POLY_VERTICES} onClick={menuAddPoint}>Add control point</MenuItem>
          )}
        </div>
      )}
    </div>
  );
}
