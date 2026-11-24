// printFrameDrag.js (NEW-1, B1783056) — pure math for the PDF/PNG export frame's on-canvas grips.
//
// The frame used to be LOCKED to the sheet's own aspect ratio on every drag: `startPrintResize`
// captured one fixed opposite CORNER and the move handler always re-derived height from width
// times the sheet's plan-window aspect, so no drag — corner or otherwise — could ever produce a
// frame whose shape disagreed with the current paper/orientation. Michael wants the opposite:
// the frame decides the shape he publishes, and the sheet fits IT. That half already works —
// `exportSheet.js` nests the framed plan into the sheet's plan box with
// `preserveAspectRatio="xMidYMid meet"`, which fits (never stretches) ANY aspect, and
// `exportStyle.sheetFitScale` / `exportLabelScale.sheetLabelPpf` already reduce to ONE uniform
// scalar for the limiting dimension regardless of aspect — so the only real constraint was in
// this drag math, not in how a picked frame is later rendered onto paper.
//
// Eight grips: four corners (both axes move) and four mid-edges (exactly one axis moves). A
// corner is just an edge grip whose two components both happen to be non-zero, so ONE formula
// (`resizeFrame`) covers every grip — no per-grip-shape branching downstream.

// A floor so a degenerate zero/negative-size frame can never happen — a minimum SIZE, not a
// minimum ASPECT (the design point is explicit that no aspect floor exists any more).
export const MIN_FRAME_FT = 40;

// The eight grips a picked frame renders, in on-canvas cursor-style order. `sx`/`sy` (-1/0/1)
// name which axis(es) that grip drives, matching the sign convention `frameGripAnchor` and
// `resizeFrame` both read.
export const FRAME_GRIPS = [
  { sx: -1, sy: -1, cursor: "nwse-resize" },
  { sx: 1, sy: -1, cursor: "nesw-resize" },
  { sx: 1, sy: 1, cursor: "nwse-resize" },
  { sx: -1, sy: 1, cursor: "nesw-resize" },
  { sx: 0, sy: -1, cursor: "ns-resize" },
  { sx: 0, sy: 1, cursor: "ns-resize" },
  { sx: -1, sy: 0, cursor: "ew-resize" },
  { sx: 1, sy: 0, cursor: "ew-resize" },
];

// The point that must NOT move while a grip is dragged: the opposite CORNER for a corner grip,
// the opposite EDGE (at the frame's current center on the other axis) for an edge grip. One
// formula covers both, because a zero component already resolves to the frame's own center.
export function frameGripAnchor(frame, sx, sy) {
  return { x: frame.cx - sx * frame.wFt / 2, y: frame.cy - sy * frame.hFt / 2 };
}

// Resize the frame for one pointer position.
//   opp          — the anchor from frameGripAnchor, taken at drag start (never moves).
//   sx, sy       — the grip being dragged.
//   wFt0, hFt0   — the frame's size at drag start; the axis this grip does NOT drive keeps this
//                  size verbatim (an edge grip must never touch the axis it isn't on).
//   fp           — the pointer's current feet position.
//   aspect       — the sheet's plan-window aspect; consulted only when `snap` is true.
//   snap         — true reproduces the OLD locked-aspect drag (Shift held): the driven axis
//                  sizes from the pointer, the other axis is DERIVED from `aspect`, so a
//                  full-bleed plan window is still one modifier away. false (the default) is
//                  free: each driven axis is sized independently, with no aspect coupling.
export function resizeFrame({ opp, sx, sy, wFt0, hFt0, fp, aspect, snap = false }) {
  const activeX = sx !== 0, activeY = sy !== 0;
  let wFt, hFt;
  if (snap) {
    const a = aspect > 0 ? aspect : 1;
    if (activeX && activeY) {
      // Corner: whichever axis the pointer travelled further along (in the other axis's
      // aspect-scaled terms) wins — the exact formula the old corner-only drag used.
      wFt = Math.max(Math.abs(fp.x - opp.x), Math.abs(fp.y - opp.y) * a, MIN_FRAME_FT);
      hFt = wFt / a;
    } else if (activeX) {
      wFt = Math.max(Math.abs(fp.x - opp.x), MIN_FRAME_FT);
      hFt = wFt / a;
    } else if (activeY) {
      hFt = Math.max(Math.abs(fp.y - opp.y), MIN_FRAME_FT);
      wFt = hFt * a;
    } else {
      wFt = wFt0; hFt = hFt0; // no declared grip drives neither axis; defensive only
    }
  } else {
    wFt = activeX ? Math.max(Math.abs(fp.x - opp.x), MIN_FRAME_FT) : wFt0;
    hFt = activeY ? Math.max(Math.abs(fp.y - opp.y), MIN_FRAME_FT) : hFt0;
  }
  return { cx: opp.x + sx * wFt / 2, cy: opp.y + sy * hFt / 2, wFt, hFt };
}

// A frame's own natural orientation — "landscape" for wide-or-square, "portrait" for tall. Read
// ONCE when a frame is first handed to the compose screen (the standard-sheet orientation
// auto-flip default); never re-applied continuously, so an explicit user choice in that screen
// is never fought.
export function orientationForAspect(aspect) {
  return aspect >= 1 ? "landscape" : "portrait";
}
