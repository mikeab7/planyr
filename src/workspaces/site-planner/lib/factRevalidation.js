/* B832 (pond-roles branch, chat NEW-12) — drainage facts auto-revalidate: the pure
 * decision layer for WHEN the facts fetch (flood zones, WSE rasters, 3DEP, authority)
 * must re-run without the user pressing ↻.
 *
 * The ledgers already recompute live per edit off cached facts — what goes stale is
 * the FETCH. Three kinds of need:
 *   kind "load" — no in-session check yet, and the remembered snapshot is missing,
 *                 stale (sig mismatch), geometry-incomplete (the B804/B829-class
 *                 records absent), or (B860) aged past its TTL → refresh once on open.
 *   kind "edit" — a check exists (live or remembered), but the drawn geometry has
 *                 OUTGROWN what was fetched: the raw feet envelope exits the stored
 *                 fetch envelope, or a point-sampled anchor (the fill-centroid the
 *                 derived-BFE/FBCDD samples used; the parcel-centroid ground line)
 *                 drifted > ~100 ft. Pure element moves INSIDE the envelope are never
 *                 a fetch — the numbers already recompute live.
 *
 * B860 (chat NEW-1) amendment — the split the readout leans on: this module decides
 * only the FETCH (network) half. The RECOMPUTE half (detention/mitigation/pond/
 * buildability math over already-held geometry + inputs) is NOT a fetch — it runs live
 * per render off the cached context, so a pure in-envelope edit returns need:false here
 * and the numbers are current WITHOUT a re-fetch. `fetchStaleForEdit` exposes that same
 * "the fetched envelope no longer covers the drawn geometry" decision so the UI can flag
 * the (narrow) flood-fetch staleness without the old "all numbers are old" banner.
 *
 * The caller (SitePlanner) owns debounce, rate-limit, the one-attempt-per-key
 * failure guard, and the actual fetch; this module only decides and keys. Pure. */

export const ANCHOR_DRIFT_FT = 100;
// B860 — a remembered fetch older than this auto-revalidates once on open (SWR "refresh
// on open"). 24 h keeps flood/authority facts fresh-ish without refetching every reload;
// the caller's 20 s rate floor + one-attempt-per-key guard keep it a single background pull.
export const FETCH_TTL_MS = 24 * 3600 * 1000;

/* Axis-aligned feet envelope of a point set. Null when under 3 points. */
export function envelopeOf(pts = []) {
  if (!pts.length) return null;
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x;
    if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y;
  }
  return Number.isFinite(mnX) ? { mnX, mnY, mxX, mxY } : null;
}

export function envelopeContains(env, bbox, tolFt = 0) {
  if (!env || !bbox) return false;
  return bbox.mnX >= env.mnX - tolFt && bbox.mnY >= env.mnY - tolFt
    && bbox.mxX <= env.mxX + tolFt && bbox.mxY <= env.mxY + tolFt;
}

export function anchorDriftFt(a, b) {
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* Pure predicate (B860): does the drawn geometry no longer fit inside the fetched
 * envelope (or has a point-sample anchor drifted past the threshold)? This is the ONLY
 * real "flood fetch is stale" condition — a pure in-envelope edit is false here, so the
 * readout can drop the misleading "numbers reflect the old boundary" banner and show a
 * narrow "flood data refreshing for the new area" note instead. Shares the exact math
 * `revalidationNeed`'s edit-kind uses, so the flag and the auto-refetch can never disagree. */
export function fetchStaleForEdit(fetchRec, { bboxNow = null, anchorNow = null, groundNow = null } = {}) {
  if (!fetchRec || !bboxNow) return false;
  if (fetchRec.env && !envelopeContains(fetchRec.env, bboxNow)) return true;
  const aDrift = anchorDriftFt(fetchRec.anchorPt, anchorNow);
  if (aDrift != null && aDrift > ANCHOR_DRIFT_FT) return true;
  const gDrift = anchorDriftFt(fetchRec.groundPt, groundNow);
  if (gDrift != null && gDrift > ANCHOR_DRIFT_FT) return true;
  return false;
}

/* The decision. Inputs:
 *   hasSessionCtx — a live check happened this session (drainReadCtx truthy)
 *   lastCheck     — settings.drainage.lastCheck (or null); its .fetch record (B832)
 *                   carries { env, anchorPt, groundPt, mode } from check time; its
 *                   .checkedAt (B860) is the fetch timestamp for the TTL check
 *   sigNow        — drainSigNow
 *   bboxNow       — raw feet envelope of active parcels + fill/pond elements
 *   anchorNow     — the CURRENT representative fill point (same rule the check uses)
 *   groundNow     — the CURRENT largest-parcel centroid
 *   incomplete    — restored view missing its slim records (mitigation/detSplit)
 *   nowMs / ttlMs — B860: TTL-aged refresh-on-open (defaults off unless nowMs given)
 * Returns { need, kind: "load"|"edit"|null, reason, key } — key identifies THIS
 * revalidation target so a failed attempt is not retried until the target changes. */
export function revalidationNeed({ hasSessionCtx = false, lastCheck = null, sigNow = "", bboxNow = null, anchorNow = null, groundNow = null, incomplete = false, nowMs = null, ttlMs = FETCH_TTL_MS } = {}) {
  const rk = (env) => (env ? [env.mnX, env.mnY, env.mxX, env.mxY].map((v) => Math.round(v / 10)).join(",") : "none");
  const none = { need: false, kind: null, reason: null, key: "" };
  if (!hasSessionCtx) {
    if (!lastCheck) return { need: true, kind: "load", reason: "no-check", key: `load:no-check:${sigNow}` };
    if (lastCheck.sig !== sigNow) return { need: true, kind: "load", reason: "stale-sig", key: `load:stale:${sigNow}` };
    if (incomplete) return { need: true, kind: "load", reason: "incomplete", key: `load:incomplete:${sigNow}` };
    // B860 — SWR refresh-on-open: a remembered snapshot older than the TTL background-
    // refreshes once. Keyed to the TTL bucket so it fires a single attempt, not per render.
    if (nowMs != null && ttlMs && lastCheck.checkedAt && nowMs - lastCheck.checkedAt > ttlMs) {
      return { need: true, kind: "load", reason: "ttl-aged", key: `load:ttl:${sigNow}:${Math.floor(nowMs / ttlMs)}` };
    }
  }
  // Edit-kind: only when a check (live or remembered) exists to extend.
  const fetchRec = lastCheck && lastCheck.fetch;
  if ((hasSessionCtx || lastCheck) && fetchRec && bboxNow) {
    if (fetchRec.env && !envelopeContains(fetchRec.env, bboxNow)) {
      return { need: true, kind: "edit", reason: "env-exit", key: `edit:env:${rk(bboxNow)}` };
    }
    const aDrift = anchorDriftFt(fetchRec.anchorPt, anchorNow);
    if (aDrift != null && aDrift > ANCHOR_DRIFT_FT) {
      return { need: true, kind: "edit", reason: "anchor-moved", key: `edit:anchor:${Math.round((anchorNow.x + anchorNow.y) / 25)}` };
    }
    const gDrift = anchorDriftFt(fetchRec.groundPt, groundNow);
    if (gDrift != null && gDrift > ANCHOR_DRIFT_FT) {
      return { need: true, kind: "edit", reason: "ground-moved", key: `edit:ground:${Math.round((groundNow.x + groundNow.y) / 25)}` };
    }
  }
  return none;
}
