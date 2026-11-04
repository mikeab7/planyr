/* regradeProgress — NEW-1 (owner 2026-11-04, "don't change anything on the map, just do a banner centered at the bottom"):
 * the "Regrading…" banner's brains. A tiny module-scope store that the grade rebuild pipeline REPORTS INTO, and a pure state
 * machine that decides when the banner is on screen. Owner-only by construction: only the grading layer's off-render build
 * (useGradeSurface with offRender, GradingController) ever calls in, so with grading off (or for any other account) the store
 * stays empty and the banner is never shown.
 *
 * THE JOBS (a "rebuild" is the surface build plus the pictures traced off it):
 *   surface   — the proposed-surface lattice, a generator driven by runChunked on the main thread (lib/useGradeSurface.js).
 *   contours  — the contour lattice (chunked, main thread) then the trace in the terrain worker.
 *   band      — the slope band's outline, traced in the terrain worker.
 * A job reports `{ frac }` from the REAL work: the chunked generators yield their own column fraction (a number in [0,1]),
 * which runChunked hands to `progress()`. A step that cannot report (the worker traces) reports `null` = indeterminate; the
 * bar then animates in CSS instead of pretending. NEVER a fake timer.
 *
 * THE BAR: Σ weight·fraction over the jobs this rebuild EXPECTS (a finished job counts 1, one not yet started 0, a running
 * indeterminate step 0) — and it never goes backwards within a rebuild (a stage that begins later cannot pull the bar back).
 * It reads `indeterminate` only while every running step is indeterminate.
 *
 * THE BANNER (pure `bannerStep`): a rebuild whose jobs have been running < SHOW_AFTER_MS never mounts it (no flash); once
 * shown it stays at least MIN_VISIBLE_MS, then fades for FADE_MS. The gap between two stages of ONE rebuild (the surface
 * lands, the contour effect starts a frame later) is bridged by SETTLE_MS, so the banner does not blink between stages.
 *
 * COST: no rAF, no interval. Progress is delivered to subscribers at most every PROGRESS_THROTTLE_MS (~10 a second); the
 * only timers are the one-shot settle/wake timeouts. Guards: repo-root `test/` **regradeBanner**. */

export const SHOW_AFTER_MS = 300;
export const MIN_VISIBLE_MS = 400;
export const FADE_MS = 250;
export const SETTLE_MS = 150;
export const PROGRESS_THROTTLE_MS = 100;
/* How much of the bar each stage owns when it is expected: the surface is most of the work. */
/* `ffe` = the floor search (auto finished-floor), many surface builds, so its step is indeterminate. */
export const STAGE_WEIGHTS = { surface: 3, contours: 2, band: 1, ffe: 2 };

/* ── the pure banner machine ─────────────────────────────────────────────────────────────────────────────────────────── */
/* state: { phase: "idle" | "pending" | "shown" | "leaving", since, shownAt, until }
 * in:    { active: a job is running now, open: a rebuild is in progress (running, or inside the settle gap), now }
 * `pending` = a rebuild has begun but has not yet run SHOW_AFTER_MS of actual work. */
export const IDLE = Object.freeze({ phase: "idle", since: 0, shownAt: 0, until: 0 });
export function bannerStep(state, { active, open, now }) {
  const s = state || IDLE;
  switch (s.phase) {
    case "pending":
      if (!open) return IDLE;                                       // finished (or gave up) before the threshold: never shown
      if (active && now - s.since >= SHOW_AFTER_MS) return { phase: "shown", since: s.since, shownAt: now, until: 0 };
      return s;
    case "shown":
      if (!open && now - s.shownAt >= MIN_VISIBLE_MS) return { phase: "leaving", since: s.since, shownAt: s.shownAt, until: now + FADE_MS };
      return s;
    case "leaving":
      if (open && active) return { phase: "shown", since: s.since, shownAt: now, until: 0 };   // a new rebuild while fading: back on at once
      if (now >= s.until) return open ? { phase: "pending", since: now, shownAt: 0, until: 0 } : IDLE;
      return s;
    default:
      return open ? { phase: "pending", since: now, shownAt: 0, until: 0 } : IDLE;
  }
}
/* ms until the machine next needs a look with no store event (null = nothing scheduled). */
export function bannerWake(state, { active, open, now }) {
  const s = state || IDLE;
  if (s.phase === "pending") return active ? Math.max(0, s.since + SHOW_AFTER_MS - now) : null;
  if (s.phase === "shown") return open ? null : Math.max(0, s.shownAt + MIN_VISIBLE_MS - now);
  if (s.phase === "leaving") return Math.max(0, s.until - now);
  return null;
}

/* ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
const realNow = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
let clock = realNow;
const nowMs = () => clock();
export function __setClockForTest(fn) { clock = typeof fn === "function" ? fn : realNow; }
function fresh() {
  return { jobs: new Map(), done: new Set(), expected: new Set(["surface"]), floor: 0, token: 0, settleTimer: null, sessionOpen: false, subs: new Set(), lastNotify: 0, trailing: null, version: 0 };
}
let S = fresh();

const activeJobs = () => [...S.jobs.entries()].filter(([, j]) => j.running);
export function isActive() { return activeJobs().length > 0; }
export function isOpen() { return S.sessionOpen; }

/* Pure over the store's data: the bar. `{ frac: 0..1, indeterminate }`. */
export function computeProgress(data) {
  const exp = [...data.expected];
  for (const [k] of data.jobs) if (!exp.includes(k)) exp.push(k);
  for (const k of data.done) if (!exp.includes(k)) exp.push(k);
  let tot = 0, got = 0;
  for (const k of exp) {
    const w = STAGE_WEIGHTS[k] || 1;
    tot += w;
    if (data.done.has(k)) got += w;
    else { const j = data.jobs.get(k); if (j && j.running && Number.isFinite(j.frac)) got += w * Math.max(0, Math.min(1, j.frac)); }
  }
  const running = [...data.jobs.values()].filter((j) => j.running);
  const indeterminate = running.length > 0 && running.every((j) => !Number.isFinite(j.frac));
  return { raw: tot > 0 ? got / tot : 0, indeterminate };
}
export function getProgress() {
  const p = computeProgress(S);
  S.floor = Math.max(S.floor, p.raw);       // never backwards within one rebuild
  return { frac: Math.min(1, S.floor), indeterminate: p.indeterminate };
}
export function getVersion() { return S.version; }

function notifyNow() {
  S.lastNotify = nowMs(); S.version++;
  if (S.trailing) { clearTimeout(S.trailing); S.trailing = null; }
  for (const f of [...S.subs]) { try { f(); } catch (_) { /* a listener never breaks the build */ } }
}
function notifyThrottled() {
  const dt = nowMs() - S.lastNotify;
  if (dt >= PROGRESS_THROTTLE_MS) { notifyNow(); return; }
  if (!S.trailing) S.trailing = setTimeout(() => { S.trailing = null; notifyNow(); }, PROGRESS_THROTTLE_MS - dt);
}
export function subscribe(fn) { S.subs.add(fn); return () => { S.subs.delete(fn); }; }

function endSessionIfIdle() {
  if (isActive()) return;
  S.sessionOpen = false; S.jobs.clear(); S.done.clear(); S.floor = 0;   // `expected` is the controller's standing declaration — it survives
  S.settleTimer = null;
  notifyNow();
}
function armSettle() {
  if (S.settleTimer) clearTimeout(S.settleTimer);
  S.settleTimer = setTimeout(endSessionIfIdle, SETTLE_MS);
}

/* Which stages this rebuild will run (the controller says whether the contour / band pictures are on). Cheap and idempotent. */
export function expectStages({ contours = false, band = false } = {}) {
  const next = new Set(["surface"]); if (contours) next.add("contours"); if (band) next.add("band");
  if (next.size === S.expected.size && [...next].every((k) => S.expected.has(k))) return;
  S.expected = next;
  if (S.sessionOpen) notifyThrottled();
}

/* A job starts. Returns a token; only the newest token of a job may end it (a superseded run's late finish is a no-op). */
export function begin(job) {
  const token = ++S.token;
  if (S.settleTimer) { clearTimeout(S.settleTimer); S.settleTimer = null; }
  S.done.delete(job);
  S.jobs.set(job, { running: true, frac: 0, token });
  const opened = !S.sessionOpen;
  S.sessionOpen = true;
  if (opened) notifyNow(); else notifyThrottled();
  return token;
}
/* Real progress from the work itself (a fraction 0..1), or null = this step cannot say (indeterminate). */
export function progress(job, token, frac) {
  const j = S.jobs.get(job);
  if (!j || j.token !== token || !j.running) return;
  const next = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : null;
  if (next === j.frac) return;
  j.frac = next;
  notifyThrottled();
}
/* The job finished (`ok` = its result landed) or was abandoned. */
export function end(job, token, { ok = true } = {}) {
  const j = S.jobs.get(job);
  if (!j || j.token !== token) return;
  j.running = false;
  if (ok) S.done.add(job);
  S.jobs.delete(job);
  if (!isActive()) armSettle();
  notifyThrottled();
}
/* A job that will not run again for this rebuild (inputs changed away from needing it): stop counting it. */
export function cancel(job, token) { end(job, token, { ok: false }); }

/* ── the driver: store → machine → a view, with ONE wake timer. The React hook is a thin wrapper over this (components/RegradeBanner.jsx);
 *    it lives here so the show / no-flash / progress-rising rules are tested without a DOM. `onView({ phase, frac, indeterminate })`
 *    is called only when something changed. ── */
export function createBannerDriver({ onView, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
  let state = IDLE, timer = null, last = null;
  const tick = () => {
    if (timer != null) { clearTimer(timer); timer = null; }
    const inp = { active: isActive(), open: isOpen(), now: nowMs() };
    state = bannerStep(state, inp);
    const p = getProgress();
    // The work is DONE (no rebuild open) while the banner is still up — held for its minimum time, or fading: the bar reads full. Without
    // this the session reset (floor → 0) dropped a shown bar to empty for the rest of its stay (caught live by verify-regrade-banner).
    const frac = state.phase === "leaving" || (state.phase === "shown" && !inp.open) ? 1 : p.frac;
    if (!last || last.phase !== state.phase || last.frac !== frac || last.indeterminate !== p.indeterminate) {
      last = { phase: state.phase, frac, indeterminate: p.indeterminate };
      if (onView) onView(last);
    }
    const w = bannerWake(state, inp);
    if (w != null) timer = setTimer(tick, w + 1);
  };
  const un = subscribe(tick);
  tick();
  return { tick, stop() { un(); if (timer != null) { clearTimer(timer); timer = null; } } };
}

export function __resetForTest() { if (S.settleTimer) clearTimeout(S.settleTimer); if (S.trailing) clearTimeout(S.trailing); S = fresh(); }
export function __snapshotForTest() { return { sessionOpen: S.sessionOpen, jobs: [...S.jobs.entries()].map(([k, j]) => [k, { ...j }]), done: [...S.done], expected: [...S.expected], floor: S.floor }; }
