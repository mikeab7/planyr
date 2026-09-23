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
import { useEffect, useId, useRef, useState } from "react";
import { Button, ToggleChip } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import {
  clampCropRect, normalizeCrop, isFullCrop,
  clampPolyPoints, normalizePolyCrop, isUsablePoly, cropKind,
  rectToPolyPoints, MIN_POLY_VERTICES, MAX_POLY_VERTICES,
  constrainOctant, nearestOnSegment,
} from "../../../workspaces/site-planner/lib/overlayCrop.js";
import { worldToScreen, screenToWorld, zoomAround, panBy, fitView } from "../../viewport/viewportTransform.js";
import { wheelZoomFactor } from "../../viewport/viewAnchor.js";

const HANDLE_SIZE = 12;
const EDGE_HIT = 14; // invisible hit strip along each edge, wider than the visible line
const VERTEX_R = 6; // poly vertex handle radius, display px
const CLOSE_HIT_PX = 10; // display-px tolerance for "click near the first vertex closes the polygon"

// Zoom bounds for the shared viewport engine. K_MAX is generous on purpose — NEW-2's whole point
// is "get in close enough to put a point exactly where you mean" on a full-size real sheet, so a
// wheel zoom needs real headroom past 100%. FIT_MAX (1) is the separate, tighter ceiling the Fit
// button itself uses — Fit never blows a small image up past its native size.
const K_MIN = 0.02;
const K_MAX = 16;
const POLY_UNDO_CAP = 100; // this is an in-session recovery aid, not a persisted history

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
const CROP_HANDLE_RADIUS = 2; // design-exempt: matches overlayPlacementHandles.js's map-side corner-square rx (11px handle, 2px round) — below the RADIUS scale's floor by design, a grip not a surface

/** `src` — the image URL to crop (full resolution). `imgW`/`imgH` — its natural pixel size.
 * `crop` — the current crop value (or null/undefined = full image; either `{kind:'rect',...}`,
 * a legacy no-`kind` rect, or `{kind:'poly', pts}`). `onCommit(crop|null)` — called with a
 * normalized, kind-tagged crop, or null if the result covers the whole image again.
 * `onCancel()` — called on Escape/Cancel, no argument. `maxWidth`/`maxHeight` — the on-screen
 * crop VIEWPORT size (NEW-2: this is now a fixed viewing window the image pans/zooms inside,
 * not a shrink-to-fit box — the caller should hand it as much real screen space as it has). */
export default function ImageCropTool({ src, imgW, imgH, crop, onCommit, onCancel, maxWidth = 720, maxHeight = 520 }) {
  const initialKind = crop ? cropKind(crop) : "rect";
  const [mode, setMode] = useState(initialKind);

  // Rect draft — seeded from `crop` when it's a rect (legacy or explicit), else the full image.
  const [draft, setDraft] = useState(() => (initialKind === "rect" && crop ? clampCropRect(crop, imgW, imgH) : fullRect(imgW, imgH)));

  // Poly draft — seeded from `crop` when it's a poly; otherwise from the RECT's own four corners
  // (whatever rect is on hand, or the full image), pre-closed, so switching to Polygon for the
  // first time on a plain rect crop hands you an editable quad instead of an empty draw.
  const [polyPts, setPolyPts] = useState(() => {
    if (initialKind === "poly" && crop) return clampPolyPoints(crop.pts, imgW, imgH) || [];
    const seedRect = initialKind === "rect" && crop ? clampCropRect(crop, imgW, imgH) : fullRect(imgW, imgH);
    return rectToPolyPoints(seedRect) || [];
  });
  const [polyClosed, setPolyClosed] = useState(true); // false only while actively placing vertices
  const [selectedVertex, setSelectedVertex] = useState(null); // index, closed mode only

  const [dragType, setDragType] = useState(null); // rect handle key while a gesture is live, else null
  const dragRef = useRef(null); // { type, startX, startY, startCrop } — screen px at grab
  const [draggingVertex, setDraggingVertex] = useState(null); // poly vertex index while dragging
  const vertexDragRef = useRef(null); // { idx, startX, startY, startPt }
  const polyUndoRef = useRef([]); // stack of { pts, closed } snapshots, pushed before each mutation
  const rootRef = useRef(null);
  const boxRef = useRef(null); // the fixed-size viewport box, for converting a client point to image px

  const VIEW_W = Math.max(1, Math.round(maxWidth));
  const VIEW_H = Math.max(1, Math.round(maxHeight));

  // ---- pan/zoom viewport (NEW-2) — the SAME { scale, tx, ty } model every canvas in this app
  // drives. `view` only ever decides where an image-px point currently renders on screen; the
  // crop shapes above are stored in image px and never read it, which is what makes panning and
  // zooming unable to move a crop relative to the picture (VIEW-INDEPENDENT-ONCE in spirit — the
  // shape's own geometry has no view term).
  const [view, setView] = useState(() => fitView(imgW, imgH, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" }));
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef(null); // { startX, startY, startView }

  const toScreen = (x, y) => worldToScreen(view, { x, y });
  const toImage = (x, y) => screenToWorld(view, { x, y });

  const maskId = useId();
  const rectMaskId = `cropRectMask-${maskId}`;
  const polyMaskId = `cropPolyMask-${maskId}`;

  // ---- rect handle dragging (unchanged from B1134754, screen deltas just read the live scale) --
  const beginDrag = (type) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type, startX: e.clientX, startY: e.clientY, startCrop: draft };
    setDragType(type);
  };

  useEffect(() => {
    if (!dragType) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / view.scale, dy = (e.clientY - d.startY) / view.scale;
      const raw = HANDLE_DELTA[d.type]({ dx, dy }, d.startCrop);
      setDraft(clampCropRect(raw, imgW, imgH));
    };
    const onUp = () => { dragRef.current = null; setDragType(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [dragType, view.scale, imgW, imgH]);

  // ---- poly undo (NEW-1 hardening) — a small in-session stack, pushed before each mutating
  // gesture (placement, insert, drag-start, delete, clear). Never touches the rect side.
  const pushPolyUndo = () => {
    const stack = polyUndoRef.current;
    stack.push({ pts: polyPts, closed: polyClosed });
    if (stack.length > POLY_UNDO_CAP) stack.shift();
  };
  const undoPoly = () => {
    const stack = polyUndoRef.current;
    if (!stack.length) return;
    const prev = stack.pop();
    setPolyPts(prev.pts);
    setPolyClosed(prev.closed);
    setSelectedVertex(null);
  };

  // ---- poly vertex dragging (NEW-1; Shift constrains to 0/45/90° from the drag's own start) ----
  const beginVertexDrag = (idx) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    pushPolyUndo();
    vertexDragRef.current = { idx, startX: e.clientX, startY: e.clientY, startPt: polyPts[idx] };
    setDraggingVertex(idx);
    setSelectedVertex(idx);
  };

  useEffect(() => {
    if (draggingVertex == null) return undefined;
    const onMove = (e) => {
      const d = vertexDragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / view.scale, dy = (e.clientY - d.startY) / view.scale;
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
    vertexDragRef.current = { idx: i + 1, startX: e.clientX, startY: e.clientY, startPt: pt };
    setDraggingVertex(i + 1);
    setSelectedVertex(i + 1);
  };

  // ---- poly drawing (click to place a vertex; NEW-1) ------------------------------------------
  // A native double-click fires click(detail:1) → click(detail:2) → dblclick — so "double-click
  // also closes" is handled right here via `e.detail`, never a separate onDoubleClick: the first
  // click of the pair already placed a vertex through the ordinary path below, and treating the
  // SECOND click as "close, don't add" is what stops a double-click from planting a duplicate
  // vertex on top of the one the first click just placed.
  const onDrawClick = (e) => {
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

  const commit = () => {
    if (mode === "poly") {
      const pts = normalizePolyCrop(polyPts, imgW, imgH);
      onCommit(pts ? { kind: "poly", pts } : null);
    } else {
      const rect = normalizeCrop(draft, imgW, imgH);
      onCommit(rect ? { kind: "rect", ...rect } : null);
    }
  };
  const reset = () => {
    if (mode === "poly") { pushPolyUndo(); setPolyPts([]); setPolyClosed(false); setSelectedVertex(null); }
    else setDraft(fullRect(imgW, imgH));
  };
  const canCommit = mode === "poly" ? (polyClosed && isUsablePoly(polyPts, imgW, imgH)) : true;
  const isReset = mode === "poly" ? polyPts.length === 0 : isFullCrop(draft, imgW, imgH);

  useEffect(() => {
    const onKey = (e) => {
      if (mode !== "poly") {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        else if (e.key === "Enter") { e.preventDefault(); commit(); }
        return;
      }

      const isUndo = (e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !e.shiftKey;
      if (isUndo) { e.preventDefault(); undoPoly(); return; }

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
  }, [draft, mode, polyClosed, polyPts, selectedVertex]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setIsPanning(true);
  };
  useEffect(() => {
    if (!isPanning) return undefined;
    const onMove = (e) => {
      const p = panRef.current;
      if (!p) return;
      setView(panBy(p.startView, e.clientX - p.startX, e.clientY - p.startY));
    };
    const onUp = () => { panRef.current = null; setIsPanning(false); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [isPanning]);
  // Middle-button OR Space+left always pans, whatever mode/tool is active — checked in the
  // CAPTURE phase on the viewport itself so it runs before a handle's/vertex's own onPointerDown
  // (which stop propagation), the same "pan wins" rule the main canvas's `shouldPan` encodes.
  const onViewportPointerDownCapture = (e) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      e.stopPropagation();
      beginPan(e);
    }
  };
  const doFit = () => setView(fitView(imgW, imgH, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" }));
  const do100 = () => setView((v) => zoomAround(v, 1 / v.scale, VIEW_W / 2, VIEW_H / 2, K_MIN, K_MAX));

  // Screen-space rect for the crop, laying out the scrim/border/handles — derived fresh from
  // `view` every render, so pan/zoom can never leave the crop rendered out of step with the image.
  const rTL = toScreen(draft.x, draft.y), rBR = toScreen(draft.x + draft.w, draft.y + draft.h);
  const rx = rTL.x, ry = rTL.y, rw = rBR.x - rTL.x, rh = rBR.y - rTL.y;

  const handleEl = (type, style, cursor) => (
    <div key={type} onPointerDown={beginDrag(type)} style={{
      position: "absolute", cursor, touchAction: "none", pointerEvents: "auto", ...style,
    }} />
  );
  const polyPtsScreen = polyPts.map(([x, y]) => { const s = toScreen(x, y); return [s.x, s.y]; });
  const polyPointsAttr = polyPtsScreen.map(([x, y]) => `${x},${y}`).join(" ");
  const zoomPct = Math.round(view.scale * 100);

  return (
    <div ref={rootRef} tabIndex={-1} style={{ outline: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <ToggleChip active={mode === "rect"} onClick={() => setMode("rect")}>Rectangle</ToggleChip>
        <ToggleChip active={mode === "poly"} onClick={() => setMode("poly")}>Polygon</ToggleChip>
        {mode === "poly" && (
          <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>
            {!polyClosed
              ? "Click to place points (Shift: snap to 0/45/90°) · click the first point or press Enter to close"
              : "Click an edge to add a point · drag a point to move it · select a point and press Delete to remove it"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={doFit} data-testid="crop-zoom-fit">Fit</Button>
        <Button size="sm" variant="ghost" onClick={do100} data-testid="crop-zoom-100">100%</Button>
        <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", minWidth: 36, textAlign: "right" }} data-testid="crop-zoom-pct">
          {zoomPct}%
        </span>
      </div>

      <div ref={boxRef} onPointerDownCapture={onViewportPointerDownCapture} style={{
        position: "relative", width: VIEW_W, height: VIEW_H, userSelect: "none",
        border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, background: CROP_BG,
        cursor: spaceDown ? (isPanning ? "grabbing" : "grab") : "default", touchAction: "none",
      }}>
        {/* image layer — clipped to the viewport so a pan/zoom can never spill the picture past
            the dialog's own edge; NOT the layer scrims/handles render in (see below) */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          <img src={src} alt="" draggable={false} style={{
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
              {/* 4 edge-midpoint handles */}
              {[["t", rx + rw / 2, ry], ["b", rx + rw / 2, ry + rh], ["l", rx, ry + rh / 2], ["r", rx + rw, ry + rh / 2]].map(([type, cx, cy]) => {
                const horiz = type === "t" || type === "b";
                return handleEl(type, {
                  left: cx - (horiz ? EDGE_HIT : EDGE_HIT / 3) / 2, top: cy - (horiz ? EDGE_HIT / 3 : EDGE_HIT) / 2,
                  width: horiz ? EDGE_HIT : EDGE_HIT / 3, height: horiz ? EDGE_HIT : EDGE_HIT,
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
                onClick={onDrawClick} />

              {/* edge hit-targets — insert a vertex; rendered BEFORE the vertex circles so a vertex
                  always wins the hit test at an endpoint (CHROME-NEVER-EATS-A-PRESS: later paints on top) */}
              {polyClosed && polyPtsScreen.map(([x, y], i) => {
                const [nx, ny] = polyPtsScreen[(i + 1) % polyPtsScreen.length];
                return (
                  <line key={`edge-${i}`} x1={x} y1={y} x2={nx} y2={ny}
                    stroke="transparent" strokeWidth={EDGE_HIT}
                    style={{ cursor: "copy", touchAction: "none", pointerEvents: "auto" }}
                    onPointerDown={beginEdgeInsert(i)} data-testid={`crop-poly-edge-${i}`} />
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
                  onPointerDown={beginVertexDrag(i)} data-testid={`crop-poly-vertex-${i}`} />
              ))}
            </svg>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={reset} disabled={isReset} style={{
            border: "none", background: "none", padding: 0, cursor: isReset ? "default" : "pointer",
            fontSize: FONT_SIZE.label, color: isReset ? "var(--text-secondary)" : "var(--accent)",
            opacity: isReset ? 0.5 : 1, textDecoration: "underline",
          }}>{mode === "poly" ? "Clear polygon" : "Reset to full page"}</button>
          <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>
            Scroll to zoom · Space+drag or middle-drag to pan
          </span>
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={commit} disabled={!canCommit}>Done</Button>
        </div>
      </div>
    </div>
  );
}
