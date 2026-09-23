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
 * NON-DESTRUCTIVE: this never touches pixels — it only produces a `{kind:'rect', x,y,w,h}` or
 * `{kind:'poly', pts:[[x,y],...]}` value in SOURCE IMAGE pixels (see lib/overlayCrop.js, whose
 * pure clamp/normalize functions this reuses verbatim) for the caller to persist as the `crop`
 * field. Re-opening this tool later against the same crop, or clearing it, always recovers the
 * whole original picture with no re-import.
 */
import { useEffect, useRef, useState } from "react";
import { Button, ToggleChip } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import {
  clampCropRect, normalizeCrop, isFullCrop,
  clampPolyPoints, normalizePolyCrop, isUsablePoly, cropKind,
  rectToPolyPoints, MIN_POLY_VERTICES,
} from "../../../workspaces/site-planner/lib/overlayCrop.js";

const HANDLE_SIZE = 12;
const EDGE_HIT = 14; // invisible hit strip along each edge, wider than the visible line
const VERTEX_R = 6; // poly vertex handle radius, display px
const CLOSE_HIT_PX = 10; // display-px tolerance for "click near the first vertex closes the polygon"

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
 * display box the image is scaled to fit inside (source pixels are never touched). */
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

  const [dragType, setDragType] = useState(null); // rect handle key while a gesture is live, else null
  const dragRef = useRef(null); // { type, startX, startY, startCrop } — screen px at grab
  const [draggingVertex, setDraggingVertex] = useState(null); // poly vertex index while dragging
  const vertexDragRef = useRef(null); // { idx, startX, startY, startPt }
  const rootRef = useRef(null);
  const boxRef = useRef(null); // the display-sized image box, for converting a click to image px

  const k = imgW > 0 ? Math.min(maxWidth / imgW, maxHeight / imgH, 1) : 1;
  const dispW = Math.max(1, Math.round(imgW * k)), dispH = Math.max(1, Math.round(imgH * k));

  // ---- rect handle dragging (unchanged from B1134754) ---------------------------------------
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
      const dx = (e.clientX - d.startX) / k, dy = (e.clientY - d.startY) / k;
      const raw = HANDLE_DELTA[d.type]({ dx, dy }, d.startCrop);
      setDraft(clampCropRect(raw, imgW, imgH));
    };
    const onUp = () => { dragRef.current = null; setDragType(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [dragType, k, imgW, imgH]);

  // ---- poly vertex dragging (NEW-1) -----------------------------------------------------------
  const beginVertexDrag = (idx) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    vertexDragRef.current = { idx, startX: e.clientX, startY: e.clientY, startPt: polyPts[idx] };
    setDraggingVertex(idx);
  };

  useEffect(() => {
    if (draggingVertex == null) return undefined;
    const onMove = (e) => {
      const d = vertexDragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / k, dy = (e.clientY - d.startY) / k;
      const nx = Math.min(Math.max(0, d.startPt[0] + dx), imgW);
      const ny = Math.min(Math.max(0, d.startPt[1] + dy), imgH);
      setPolyPts((pts) => pts.map((p, i) => (i === d.idx ? [nx, ny] : p)));
    };
    const onUp = () => { vertexDragRef.current = null; setDraggingVertex(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [draggingVertex, k, imgW, imgH]);

  // ---- poly drawing (click to place a vertex; NEW-1) ------------------------------------------
  // A native double-click fires click(detail:1) → click(detail:2) → dblclick — so "double-click
  // also closes" is handled right here via `e.detail`, never a separate onDoubleClick: the first
  // click of the pair already placed a vertex through the ordinary path below, and treating the
  // SECOND click as "close, don't add" is what stops a double-click from planting a duplicate
  // vertex on top of the one the first click just placed.
  const onDrawClick = (e) => {
    if (polyClosed) return;
    if (e.detail >= 2) {
      if (polyPts.length >= MIN_POLY_VERTICES) setPolyClosed(true);
      return;
    }
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const px = Math.min(Math.max(0, (e.clientX - r.left) / k), imgW);
    const py = Math.min(Math.max(0, (e.clientY - r.top) / k), imgH);
    if (polyPts.length >= MIN_POLY_VERTICES) {
      const first = polyPts[0];
      const distPx = Math.hypot((px - first[0]) * k, (py - first[1]) * k);
      if (distPx <= CLOSE_HIT_PX) { setPolyClosed(true); return; }
    }
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
    if (mode === "poly") { setPolyPts([]); setPolyClosed(false); }
    else setDraft(fullRect(imgW, imgH));
  };
  const canCommit = mode === "poly" ? (polyClosed && isUsablePoly(polyPts, imgW, imgH)) : true;
  const isReset = mode === "poly" ? polyPts.length === 0 : isFullCrop(draft, imgW, imgH);

  useEffect(() => {
    const onKey = (e) => {
      if (mode === "poly" && !polyClosed) {
        if (e.key === "Escape") { e.preventDefault(); setPolyPts([]); return; }
        if (e.key === "Backspace") { e.preventDefault(); setPolyPts((pts) => pts.slice(0, -1)); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          if (polyPts.length >= MIN_POLY_VERTICES) setPolyClosed(true);
          return;
        }
        return; // swallow other keys while genuinely mid-draw — never falls through to commit/cancel
      }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); commit(); }
    };
    const el = rootRef.current;
    el && el.addEventListener("keydown", onKey);
    return () => { el && el.removeEventListener("keydown", onKey); };
  }, [draft, mode, polyClosed, polyPts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Screen-space (display px) rect for the crop, for laying out the scrim/border/handles.
  const rx = draft.x * k, ry = draft.y * k, rw = draft.w * k, rh = draft.h * k;

  const scrim = (style) => <div style={{ position: "absolute", background: CROP_SCRIM, pointerEvents: "none", ...style }} />;
  const handleEl = (type, style, cursor) => (
    <div key={type} onPointerDown={beginDrag(type)} style={{
      position: "absolute", cursor, touchAction: "none", ...style,
    }} />
  );
  const polyPtsScreen = polyPts.map(([x, y]) => [x * k, y * k]);
  const polyPointsAttr = polyPtsScreen.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <div ref={rootRef} tabIndex={-1} style={{ outline: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <ToggleChip active={mode === "rect"} onClick={() => setMode("rect")}>Rectangle</ToggleChip>
        <ToggleChip active={mode === "poly"} onClick={() => setMode("poly")}>Polygon</ToggleChip>
        {mode === "poly" && !polyClosed && (
          <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>
            Click to place points · click the first point or press Enter to close
          </span>
        )}
      </div>

      <div ref={boxRef} style={{
        position: "relative", width: dispW, height: dispH, userSelect: "none",
        // NEW-1 (B1838704) — overflow VISIBLE, not hidden: a fresh crop starts at the full image,
        // so every grip sits ON the box edge, and "hidden" clipped each corner grip to a quarter and
        // each edge grip to a half — measured, the bottom-right grip's grabbable area was a few pixels
        // wide. Nothing else here draws outside the box (scrims, the rect and the poly SVG are all
        // bounded by it), so the grips are the only thing this lets out.
        border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, overflow: "visible", background: CROP_BG,
      }}>
        <img src={src} alt="" draggable={false} style={{ display: "block", width: dispW, height: dispH, pointerEvents: "none" }} />

        {mode === "rect" ? (
          <>
            {/* Scrim OUTSIDE the crop — four bands, so what's being discarded stays visible, just dimmed. */}
            {scrim({ left: 0, top: 0, width: dispW, height: ry })}
            {scrim({ left: 0, top: ry + rh, width: dispW, height: Math.max(0, dispH - ry - rh) })}
            {scrim({ left: 0, top: ry, width: rx, height: rh })}
            {scrim({ left: rx + rw, top: ry, width: Math.max(0, dispW - rx - rw), height: rh })}

            {/* The crop rect itself — border, rule-of-thirds while dragging, and the move surface. */}
            <div
              onPointerDown={beginDrag("move")}
              style={{
                position: "absolute", left: rx, top: ry, width: rw, height: rh,
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
          <svg width={dispW} height={dispH} style={{ position: "absolute", inset: 0 }}>
            <mask id="cropPolyMask">
              <rect x="0" y="0" width={dispW} height={dispH} fill="white" />
              {polyClosed && polyPtsScreen.length >= 3 && (
                <polygon points={polyPointsAttr} fill="black" fillRule="evenodd" />
              )}
            </mask>
            <rect x="0" y="0" width={dispW} height={dispH} fill={CROP_SCRIM} mask="url(#cropPolyMask)" style={{ pointerEvents: "none" }} />

            {polyPtsScreen.length > 0 && (
              polyClosed
                ? <polygon points={polyPointsAttr} fill="none" fillRule="evenodd" stroke={CROP_WHITE} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                : <polyline points={polyPointsAttr} fill="none" stroke={CROP_WHITE} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
            )}

            {/* click-catcher — only live while actively drawing; a closed polygon is edited via its own vertex handles below */}
            <rect x="0" y="0" width={dispW} height={dispH} fill="transparent"
              style={{ cursor: !polyClosed ? "crosshair" : "default", pointerEvents: polyClosed ? "none" : "auto" }}
              onClick={onDrawClick} />

            {!polyClosed && polyPtsScreen.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={i === 0 ? VERTEX_R : 3}
                fill={i === 0 ? "var(--accent)" : CROP_WHITE} stroke={CROP_WHITE} strokeWidth={1}
                style={{ pointerEvents: "none" }} />
            ))}
            {polyClosed && polyPtsScreen.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={VERTEX_R}
                fill={CROP_WHITE} stroke="var(--accent)" strokeWidth={1.5}
                style={{ cursor: "move", touchAction: "none" }}
                onPointerDown={beginVertexDrag(i)} />
            ))}
          </svg>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <button onClick={reset} disabled={isReset} style={{
          border: "none", background: "none", padding: 0, cursor: isReset ? "default" : "pointer",
          fontSize: FONT_SIZE.label, color: isReset ? "var(--text-secondary)" : "var(--accent)",
          opacity: isReset ? 0.5 : 1, textDecoration: "underline",
        }}>{mode === "poly" ? "Clear polygon" : "Reset to full page"}</button>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={commit} disabled={!canCommit}>Done</Button>
        </div>
      </div>
    </div>
  );
}
