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

import { formatAge } from "./gisCache.js";

export const ANCHOR_DRIFT_FT = 100;
// B860 — a remembered fetch older than this auto-revalidates once on open (SWR "refresh
// on open"). 24 h keeps flood/authority facts fresh-ish without refetching every reload;
// the caller's 20 s rate floor + one-attempt-per-key guard keep it a single background pull.
export const FETCH_TTL_MS = 24 * 3600 * 1000;
// B874 — envelope-containment slack (feet). The stored fetch envelope is a WHOLE-FOOT
// canonicalization (canonEnv) of the drawn geometry; the live bbox is raw feet. This slack
// absorbs the ≤1-ft rounding gap so unchanged geometry can NEVER spuriously read "outgrew the
// fetched envelope" — the ambient stuck-refresh bug. A real boundary growth moves many feet, so
// a 2-ft floor never masks true staleness.
export const ENV_TOL_FT = 2;

// B874 (recurrence, edit-path) — the HARD CEILING for a single refresh episode. PR #656 fixed the
// ambient on-load spinner but left the edit-triggered re-fetch unbounded: on a boundary change the
// spinner could show indefinitely with no success-settle and no timeout→terminal. The fetch itself
// races a 30 s timeout; this ceiling (> that, so a slow-but-completing pull isn't cut off) is the
// INDEPENDENT backstop the derived spinner state leans on, so no awaited promise — a black-holed
// fetch, a superseded early-return that stranded `busy`, or a rate-floored/hidden-tab auto attempt
// that never fired — can hold the "Refreshing…" state open forever. Both the busy branch and the
// "armed but not yet fired" branch are bounded by this. 45 s ≫ 30 s fetch timeout + 8 s FBCDD.
export const DRAIN_STUCK_MS = 45000;

/* B874 — pure watchdog predicate: has a refresh episode that began at `startedMs` exceeded the
 * hard ceiling as of `nowMs`? Used by BOTH the in-flight (busy) watchdog and the armed-but-unfired
 * bound so the "Refreshing…" spinner can never outlive one ceiling. `startedMs` of 0/null means no
 * episode is running (never stuck). Pure. */
export function fetchWatchdogFired(startedMs, nowMs, ceilingMs = DRAIN_STUCK_MS) {
  if (!startedMs || !Number.isFinite(startedMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - startedMs > ceilingMs;
}

/* B874 — the ONE canonical fetched-envelope. Rounds OUTWARD (floor the mins, ceil the maxs) so
 * the STORED envelope always CONTAINS the geometry it was measured from. The writer persists
 * this; the reader compares its raw live bbox against it (with ENV_TOL_FT slack). The old writer
 * used Math.round, which rounds a min UP or a max DOWN — shrinking the stored env below the real
 * geometry, so `envelopeContains` failed on a FRESH load with zero edits → `need` stayed true
 * forever → the "Refreshing flood data…" spinner stuck ambiently. Outward rounding removes that
 * root cause; writer and reader now agree by construction. Pure. */
export function canonEnv(env) {
  if (!env) return null;
  const { mnX, mnY, mxX, mxY } = env;
  if (![mnX, mnY, mxX, mxY].every((v) => Number.isFinite(v))) return null;
  return { mnX: Math.floor(mnX), mnY: Math.floor(mnY), mxX: Math.ceil(mxX), mxY: Math.ceil(mxY) };
}

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
  if (fetchRec.env && !envelopeContains(fetchRec.env, bboxNow, ENV_TOL_FT)) return true; // B874 — slack absorbs the whole-foot canonicalization gap
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
    if (fetchRec.env && !envelopeContains(fetchRec.env, bboxNow, ENV_TOL_FT)) { // B874 — same slack the flag uses, so they never disagree
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

/* ---------------------------------------------------------------------------------------------
 * NEW-4 — THE CHECK IS MANUAL, AND ITS FRESHNESS IS A LIGHT (owner decision, restated 2026-08-06:
 * "i thought we talked about doing this only manually … seems like it only needs it once after
 * relevant elements are moved, and so maybe we just only do it manually, leave it green while
 * elements are in the same spot, once they're moved turn it red so we know to recheck").
 *
 * He had decided this before and it was not carried through: B860 kept an automatic LOAD-kind pass
 * and B1349 then measured it landing in the middle of the first few seconds after opening a plan.
 * The pass now runs ONLY when he asks for it, and the app's job is to say whether the answer on
 * screen is still about the drawing on screen.
 *
 * ⛔ THE STALENESS KEY IS DELIBERATELY LOOSE, and that is the owner's own reading. It is the SAME
 * signature the fetch has always been keyed on — active parcels, the site area, the georeference,
 * and the fill/pond envelope (`drainElsSig`, i.e. FM_FILL_TYPES + ponds) — so moving a car park,
 * renaming the plan or nudging a road does NOT turn the light red. Only the things that genuinely
 * change the answer do. A light that cries wolf on every edit is a light he would learn to ignore,
 * which is worse than no light.
 *
 * Four states, never three, because "never checked" and "checked and still valid" are different
 * facts and collapsing them is how a blank reads as an all-clear:
 *   "unchecked" — nothing has ever run for this plan. NOT a pass and NOT a failure.
 *   "fresh"     — a check exists and the elements that feed it are where they were. GREEN.
 *   "stale"     — a check exists and one of them moved, or the drawing outgrew what was
 *                 fetched. RED, with the reason.
 *   "checking"  — a run is in flight.
 * Pure. */
export const FRESHNESS_REASONS = {
  "moved": "elements that affect this have moved since the last check",
  "env-exit": "the drawing now reaches outside the area that was checked",
  "anchor-moved": "the fill has moved away from where it was checked",
  "ground-moved": "the parcel has moved away from where it was checked",
};

export function factsFreshness({ hasSessionCtx = false, lastCheck = null, sigNow = "", busy = false, bboxNow = null, anchorNow = null, groundNow = null } = {}) {
  if (busy) return { state: "checking", reason: null, note: null };
  // "Checked" means a live run this session OR a remembered one — the same ONE truth the header's
  // floodChecked uses, so the light and the numbers can never disagree about whether facts exist.
  if (!hasSessionCtx && !lastCheck) return { state: "unchecked", reason: null, note: null };
  // A remembered check whose signature no longer matches is stale for the plainest possible
  // reason: the parcels/fill/ponds it was computed against are not the ones on the canvas.
  if (lastCheck && lastCheck.sig && sigNow && lastCheck.sig !== sigNow) {
    return { state: "stale", reason: "moved", note: FRESHNESS_REASONS.moved };
  }
  // And the geometric half — the drawing grew past the fetched envelope, or a sampled point
  // drifted. Reuses `fetchStaleForEdit` rather than re-deriving it, so the light can never
  // disagree with the fetch-staleness flag the readout already carries.
  const fetchRec = lastCheck && lastCheck.fetch;
  if (fetchRec && bboxNow && fetchStaleForEdit(fetchRec, { bboxNow, anchorNow, groundNow })) {
    const reason = fetchRec.env && !envelopeContains(fetchRec.env, bboxNow, ENV_TOL_FT) ? "env-exit"
      : (anchorDriftFt(fetchRec.anchorPt, anchorNow) ?? 0) > ANCHOR_DRIFT_FT ? "anchor-moved"
      : "ground-moved";
    return { state: "stale", reason, note: FRESHNESS_REASONS[reason] };
  }
  return { state: "fresh", reason: null, note: null };
}

/* ⛔ B881668 — the Yield panel's ONE freshness LINE, extracted so "does the right state
 * produce the right sentence" is provable without a browser. Byte-identical to the inline
 * render ternary it replaces (SitePlanner.jsx's Yield-panel header). Four cases, checked in
 * order: an in-flight re-check always wins ("checking…"); no check has ever run ("not
 * checked" — never a bare "Flood data"); a STALE remembered check keeps its run date rather
 * than dropping it ("stale — checked <age>"); a fresh one shows its age, or "checked" when
 * the age is unknown. Owner ask (chat NEW-5): prove this selects correctly for all three
 * states a user can see (not checked / checked with a date / stale after an edit). */
export function floodStatusLine({ refreshing = false, floodChecked = false, freshnessState = null, floodAgeMs = null } = {}) {
  if (refreshing) return "Flood data: checking…";
  if (!floodChecked) return "Flood data: not checked";
  if (freshnessState === "stale") {
    return floodAgeMs != null ? `Flood data: stale — checked ${formatAge(floodAgeMs)}` : "Flood data: stale";
  }
  return floodAgeMs != null ? `Flood data ${formatAge(floodAgeMs)}` : "Flood data: checked";
}

/* ⛔ B881668 — the freshness DOT's color TOKEN — never a CSS value, which stays a theme
 * concern the caller resolves (SitePlanner.jsx's `Y.warnText` / `var(--success-text)`). A
 * stale check is a WARNING (something moved since the last run), never an ERROR — owner,
 * B849713: "a yellow stale indicator when he has run the check and has since changed
 * elements on the plan." This is the one place that decision is made; the caller only maps
 * "warn" → its warning color and everything else → its success color. */
export function floodDotColorToken(freshnessState) {
  return freshnessState === "stale" ? "warn" : "success";
}
