/* ImageCropTool — the ONE reusable non-destructive crop UI (B1134754 NEW-21), used both BEFORE
 * placement (the upload flow's page-picker step) and AFTER placement (an already-placed
 * overlay's "Crop…" action) — "trimming the flyer down to the plan first, then placing, is the
 * natural workflow" (task spec), so both call sites share this one component rather than two.
 *
 * The owner's own ask: "really just crop, like a basic cropping tool" — the STANDARD model
 * (Photoshop / Lightroom / any competent web cropper): an 8-handle rectangle (4 corners + 4 edge
 * midpoints), the area OUTSIDE dimmed with a scrim (never hidden outright — what's being
 * discarded stays visible while you work), rule-of-thirds guides while actively dragging, drag
 * INSIDE the rect to reposition it, Enter/Done commits, Escape/Cancel restores, and an explicit
 * Reset to full page. Aspect ratio is FREE (a site plan crop is whatever shape the artwork is —
 * no presets).
 *
 * NON-DESTRUCTIVE: this never touches pixels — it only produces a `{x,y,w,h}` rect in SOURCE
 * IMAGE pixels (see lib/overlayCrop.js, whose pure clamp/normalize functions this reuses
 * verbatim) for the caller to persist as the `crop` field. Re-opening this tool later against
 * the same crop, or clearing it, always recovers the whole original picture with no re-import.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import { clampCropRect, normalizeCrop, isFullCrop } from "../../../workspaces/site-planner/lib/overlayCrop.js";

const HANDLE_SIZE = 12;
const EDGE_HIT = 14; // invisible hit strip along each edge, wider than the visible line

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
 * `crop` — the current crop rect (or null/undefined = full image). `onCommit(crop|null)` —
 * called with a normalized crop rect, or null if the result covers the whole image again.
 * `onCancel()` — called on Escape/Cancel, no argument. `maxWidth`/`maxHeight` — the on-screen
 * display box the image is scaled to fit inside (source pixels are never touched). */
export default function ImageCropTool({ src, imgW, imgH, crop, onCommit, onCancel, maxWidth = 720, maxHeight = 520 }) {
  const [draft, setDraft] = useState(() => (crop ? clampCropRect(crop, imgW, imgH) : fullRect(imgW, imgH)));
  const [dragType, setDragType] = useState(null); // handle key while a gesture is live, else null
  const dragRef = useRef(null); // { type, startX, startY, startCrop } — screen px at grab
  const rootRef = useRef(null);

  const k = imgW > 0 ? Math.min(maxWidth / imgW, maxHeight / imgH, 1) : 1;
  const dispW = Math.max(1, Math.round(imgW * k)), dispH = Math.max(1, Math.round(imgH * k));

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

  const commit = () => onCommit(normalizeCrop(draft, imgW, imgH));
  const reset = () => setDraft(fullRect(imgW, imgH));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); commit(); }
    };
    const el = rootRef.current;
    el && el.addEventListener("keydown", onKey);
    return () => { el && el.removeEventListener("keydown", onKey); };
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Screen-space (display px) rect for the crop, for laying out the scrim/border/handles.
  const rx = draft.x * k, ry = draft.y * k, rw = draft.w * k, rh = draft.h * k;

  const scrim = (style) => <div style={{ position: "absolute", background: CROP_SCRIM, pointerEvents: "none", ...style }} />;
  const handleEl = (type, style, cursor) => (
    <div key={type} onPointerDown={beginDrag(type)} style={{
      position: "absolute", cursor, touchAction: "none", ...style,
    }} />
  );

  return (
    <div ref={rootRef} tabIndex={-1} style={{ outline: "none" }}>
      <div style={{
        position: "relative", width: dispW, height: dispH, userSelect: "none",
        border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, overflow: "hidden", background: CROP_BG,
      }}>
        <img src={src} alt="" draggable={false} style={{ display: "block", width: dispW, height: dispH, pointerEvents: "none" }} />

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
            width: horiz ? EDGE_HIT : EDGE_HIT / 3, height: horiz ? EDGE_HIT / 3 : EDGE_HIT,
          }, HANDLE_CURSOR[type]);
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <button onClick={reset} disabled={isFullCrop(draft, imgW, imgH)} style={{
          border: "none", background: "none", padding: 0, cursor: isFullCrop(draft, imgW, imgH) ? "default" : "pointer",
          fontSize: FONT_SIZE.label, color: isFullCrop(draft, imgW, imgH) ? "var(--text-secondary)" : "var(--accent)",
          opacity: isFullCrop(draft, imgW, imgH) ? 0.5 : 1, textDecoration: "underline",
        }}>Reset to full page</button>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={commit}>Done</Button>
        </div>
      </div>
    </div>
  );
}
