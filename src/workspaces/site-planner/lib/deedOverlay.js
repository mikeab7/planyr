/* deedOverlay.js — turn a plotted deed (metes and bounds, kind "encumbrance") into a picture that rides the
 * ordinary OVERLAYS list, so it can be hidden, dimmed, locked, reordered and cropped like any other overlay.
 *
 * Pure geometry (Node-testable) + one canvas draw. Nothing here touches React or storage:
 *   • `deedOverlayPlan(members, ringOf)` → where the picture sits (feet) and the shapes to draw (pixels).
 *   • `drawDeedOverlay(ctx, plan)`        → paints those shapes onto a 2D canvas context.
 *   • `deedOverlayRecord(members)`        → the tiny snapshot an overlay keeps (`fromDeed`) so the conversion can be undone.
 *   • `restoredDeedMarkups(fromDeed, uid, group)` → fresh markups (new ids) from that snapshot.
 *
 * The overlay frame is the planner's own feet frame (x right, y down), the same as every other overlay: `x,y` is the
 * picture's top-left and `ftPerPx` its scale, so the converted deed lands exactly where the deed was. */

export const DEED_OVERLAY_MAX_PX = 2048;   // longest side of the picture
export const DEED_OVERLAY_PAD_PX = 12;     // breathing room so the outline is never clipped at the edge

const cssColor = (c, fallback) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback);

/* members: the deed's markups (boundary + its exceptions). ringOf(m) → the ring to draw (deedTrace(m).ring). */
export function deedOverlayPlan(members, ringOf = (m) => m.pts || [], maxPx = DEED_OVERLAY_MAX_PX) {
  const rings = (members || []).map((m) => ({ m, ring: (ringOf(m) || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) })).filter((r) => r.ring.length >= 3);
  if (!rings.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { ring } of rings) for (const p of ring) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const wFt = Math.max(1, maxX - minX), hFt = Math.max(1, maxY - minY);
  const inner = Math.max(64, maxPx - 2 * DEED_OVERLAY_PAD_PX);
  const pxPerFt = inner / Math.max(wFt, hFt);
  const ftPerPx = 1 / pxPerFt;
  const pad = DEED_OVERLAY_PAD_PX;
  const imgW = Math.ceil(wFt * pxPerFt) + 2 * pad, imgH = Math.ceil(hFt * pxPerFt) + 2 * pad;
  const shapes = rings.map(({ m, ring }) => ({
    pts: ring.map((p) => ({ x: (p.x - minX) * pxPerFt + pad, y: (p.y - minY) * pxPerFt + pad })),
    stroke: cssColor(m.stroke, "#7c3aed"),
    fill: cssColor(m.fill, cssColor(m.stroke, "#7c3aed")),
    fillOpacity: m.fillOpacity ?? 0.14,
    weightPx: Math.max(2, (m.weight ?? 2) * Math.max(1, imgW / 700)),
    dashed: !!m.dash && m.dash !== "solid",
    except: !!m.except,
  }));
  return {
    x: minX - pad * ftPerPx, y: minY - pad * ftPerPx,   // top-left of the picture, in feet
    ftPerPx, imgW, imgH, shapes,
    name: (members.find((m) => !m.except) || members[0])?.label || "Deed",
  };
}

export function drawDeedOverlay(ctx, plan) {
  ctx.clearRect(0, 0, plan.imgW, plan.imgH);
  ctx.lineJoin = "round";
  for (const s of plan.shapes) {
    ctx.beginPath();
    s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    if (s.fillOpacity > 0) { ctx.globalAlpha = s.fillOpacity; ctx.fillStyle = s.fill; ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = s.stroke; ctx.lineWidth = s.weightPx;
    ctx.setLineDash(s.dashed ? [s.weightPx * 3, s.weightPx * 2] : []);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/* The snapshot an overlay keeps so "Convert back to deed" can rebuild the real, editable deed (courses and all). */
export function deedOverlayRecord(members) {
  return { markups: JSON.parse(JSON.stringify(members || [])) };
}

/* Fresh markups from a snapshot: NEW ids and a NEW deedGroup, never the old ones — the old ids were tombstoned when the
 * deed became a picture, and a tombstoned id is refused on merge (it would vanish again on the next sync). */
export function restoredDeedMarkups(fromDeed, uid, groupId) {
  const src = (fromDeed && fromDeed.markups) || [];
  return src.map((m) => ({ ...m, id: uid(), deedGroup: m.deedGroup ? groupId : m.deedGroup, groupId: undefined, locked: false }));
}
