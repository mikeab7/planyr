/* PURE raster REGISTRATION for revision compare (B464). Aligns rev B (new) onto rev A (old, the
 * reference) so the diff engine sees two rasters in ONE coordinate frame. No canvas/DOM/React —
 * operates on Uint8Array binaries (1 = ink), so it is Node-unit-testable.
 *
 * Layered + fail-safe (a WRONG auto-align is worse than asking for 2 clicks — same doctrine as
 * matchLineRefine):
 *   1. coarse TRANSLATION via row/col ink-profile cross-correlation (reuses matchLineFit.slideRefine);
 *   2. ink-bounding-box correspondence → TRANSLATION + uniform SCALE (reuses overlayAlign.solveSimilarityLSQ);
 *   3. score every candidate by ink AGREEMENT and keep the best; low agreement ⇒ confidence:'low'
 *      so the UI nudges the user to the manual 2-point fallback (manualRegister, which — via the same
 *      solver — also recovers ROTATION, the one thing the bbox path can't).
 *
 * Registering on the DRAWING-AREA interior only (caller passes a `mask` from readSheetMeta) keeps a
 * reflowed title block from poisoning the fit.
 *
 * Reuse discipline: the similarity math is overlayAlign.solveSimilarityLSQ (the canonical, tested
 * Procrustes solver) — this module is orchestration, not a second aligner.
 */
import { slideRefine } from "./matchLineFit.js";
import { solveSimilarityLSQ } from "../../workspaces/site-planner/lib/overlayAlign.js";

const clampMask = (mask, W, H) => {
  if (!mask) return { x: 0, y: 0, w: W, h: H };
  const x = Math.max(0, Math.min(W - 1, mask.x | 0));
  const y = Math.max(0, Math.min(H - 1, mask.y | 0));
  return { x, y, w: Math.max(1, Math.min(W - x, mask.w | 0)), h: Math.max(1, Math.min(H - y, mask.h | 0)) };
};

/* Masked ink profiles: colProf[i] = ink in column (m.x+i) over the masked rows; rowProf[j] likewise. */
function maskedProfiles(bin, W, m) {
  const colProf = new Float64Array(m.w), rowProf = new Float64Array(m.h);
  for (let j = 0; j < m.h; j++) {
    const base = (m.y + j) * W + m.x;
    let rsum = 0;
    for (let i = 0; i < m.w; i++) { if (bin[base + i]) { colProf[i]++; rsum++; } }
    rowProf[j] = rsum;
  }
  return { colProf, rowProf };
}

/** Coarse B→A translation (px) from ink-profile cross-correlation. Robust to title-block content;
 *  recovers pure shift only. `{dx, dy}` such that an A point ≈ a B point + (dx, dy). */
export function coarseOffset(binA, binB, W, H, mask) {
  const m = clampMask(mask, W, H);
  const pa = maskedProfiles(binA, W, m), pb = maskedProfiles(binB, W, m);
  const range = Math.max(8, Math.floor(Math.min(m.w, m.h) * 0.5));
  return { dx: slideRefine(pa.colProf, pb.colProf, range), dy: slideRefine(pa.rowProf, pb.rowProf, range) };
}

/** Tight ink bounding box within the mask → {x,y,w,h} or null when there is no ink. */
export function inkBBox(bin, W, H, mask) {
  const m = clampMask(mask, W, H);
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let j = 0; j < m.h; j++) {
    const yy = m.y + j, base = yy * W + m.x;
    for (let i = 0; i < m.w; i++) if (bin[base + i]) { const xx = m.x + i; if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Candidate anchor features for matching — currently the ink-bbox corners + centroid (a sparse,
 *  stable set good enough for translation + uniform scale; rotation goes through manualRegister). */
export function detectAnchors(bin, W, H, mask, max = 8) {
  const bb = inkBBox(bin, W, H, mask);
  if (!bb) return [];
  const pts = [
    { x: bb.x, y: bb.y }, { x: bb.x + bb.w - 1, y: bb.y },
    { x: bb.x + bb.w - 1, y: bb.y + bb.h - 1 }, { x: bb.x, y: bb.y + bb.h - 1 },
    { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 },
  ];
  return pts.slice(0, max);
}

/* Build a B→A transform (+ its inverse, for resampling A-pixels from B) from point pairs, reusing the
 * canonical solver both directions. Returns { scale, rotDeg, residual, apply, inv } or null. */
function transformFromPairs(pairs) {
  const f = solveSimilarityLSQ(pairs);
  if (!f) return null;
  const r = solveSimilarityLSQ(pairs.map((p) => ({ from: p.to, to: p.from })));
  return { scale: f.scale, rotDeg: f.rotDeg, residual: f.residual, apply: f.apply, inv: r ? r.apply : null };
}

const translationPairs = (dx, dy) => [
  { from: { x: 0, y: 0 }, to: { x: dx, y: dy } },
  { from: { x: 1000, y: 0 }, to: { x: 1000 + dx, y: dy } },
  { from: { x: 0, y: 1000 }, to: { x: dx, y: 1000 + dy } },
];

/* Ink-overlap agreement in [0,1]: fraction of sampled A-ink that has B-ink within `tol` after the
 * transform, averaged with the symmetric B→A check. The honest confidence signal. */
function agreement(binA, binB, W, H, t, m, { tol = 2, stride = 3 } = {}) {
  if (!t || !t.inv || !t.apply) return 0;
  const near = (bin, px, py) => {
    const x0 = Math.round(px), y0 = Math.round(py);
    for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol; dx <= tol; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (bin[y * W + x]) return true;
    }
    return false;
  };
  let sa = 0, ma = 0, sb = 0, mb = 0;
  for (let j = 0; j < m.h; j += stride) for (let i = 0; i < m.w; i += stride) {
    const xa = m.x + i, ya = m.y + j, ia = ya * W + xa;
    if (binA[ia]) { sa++; const b = t.inv({ x: xa, y: ya }); if (near(binB, b.x, b.y)) ma++; }
    if (binB[ia]) { sb++; const a = t.apply({ x: xa, y: ya }); if (near(binA, a.x, a.y)) mb++; }
  }
  const ra = sa ? ma / sa : 0, rb = sb ? mb / sb : 0;
  if (!sa && !sb) return 0;
  return (ra + rb) / 2;
}

/** Register B onto A. Returns { scale, rotDeg, apply, inv, agreement, confidence, method } or null
 *  (no ink). `apply` maps a B point → A space; `inv` maps an A point → B space (use for resampling).
 *  confidence: 'high' (accept) | 'low' (show, but nudge manual 2-point — rotation/skew or a poor fit). */
export function registerRasters(binA, binB, W, H, opts = {}) {
  const m = clampMask(opts.mask, W, H);
  const bbA = inkBBox(binA, W, H, m), bbB = inkBBox(binB, W, H, m);
  if (!bbA || !bbB) return null; // nothing to align
  const minAgree = opts.minAgreement != null ? opts.minAgreement : 0.6;
  const score = (t, method) => (t ? { ...t, agreement: agreement(binA, binB, W, H, t, m, opts), method } : null);

  const candidates = [];
  // 1) coarse translation
  const { dx, dy } = coarseOffset(binA, binB, W, H, m);
  candidates.push(score(transformFromPairs(translationPairs(dx, dy)), "translation"));
  // 2) ink-bbox correspondence (translation + uniform scale) — opposite corners as the 2 pairs
  candidates.push(score(transformFromPairs([
    { from: { x: bbB.x, y: bbB.y }, to: { x: bbA.x, y: bbA.y } },
    { from: { x: bbB.x + bbB.w, y: bbB.y + bbB.h }, to: { x: bbA.x + bbA.w, y: bbA.y + bbA.h } },
  ]), "bbox"));

  let best = null;
  for (const c of candidates) if (c && (!best || c.agreement > best.agreement)) best = c;
  if (!best) return null;
  best.confidence = best.agreement >= minAgree ? "high" : "low";
  return best;
}

/** Manual 2-point register: user clicked the SAME two reference marks on A and B. Recovers the full
 *  similarity (translation + rotation + uniform scale) via the canonical solver. confidence:'manual'. */
export function manualRegister(p1A, p2A, p1B, p2B) {
  const t = transformFromPairs([{ from: p1B, to: p1A }, { from: p2B, to: p2A }]);
  if (!t) return null;
  return { ...t, agreement: null, confidence: "manual", method: "manual" };
}
