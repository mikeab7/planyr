/* viewChangeRecorder — WHO MOVED THE VIEW, AND WHAT ARRIVED JUST BEFORE IT.
 *
 * ⛔ THE INSTRUMENT PROBLEM THIS EXISTS TO SOLVE, stated first because two earlier instruments were
 * INVALID and their null results were nearly reported as findings (STANDING RULE #2, clause 1 — when
 * the instrument and the owner disagree, the instrument is the thing on trial).
 *
 * The owner reports the planner zooming itself: on a cold start (B1448) and now, after the app has
 * SAT IDLE and he comes back and pinches. Two live attempts to observe it on his own browser both
 * measured nothing, and BOTH were measuring the wrong object:
 *
 *   · polling `.leaflet-control-scale-line` across a cold load — 20 mi on all 95 samples, INCLUDING
 *     during a deliberate trusted wheel-scroll;
 *   · polling the first `img.leaflet-tile`'s `z` path segment — z10 on all 110 samples, same story.
 *
 * Neither registered a zoom that was actually performed, and the reason is structural rather than
 * bad luck: **THE PLANNER'S ZOOM IS NOT LEAFLET'S ZOOM.** The user's view is an app-level transform
 * — `view = { ppf, offX, offY }` in `SitePlanner.jsx` — and the Leaflet basemap is a SLAVE that
 * MIRRORS it, moved for most gestures with `map.panBy` at a FIXED Leaflet zoom level and re-based to
 * a new level only when the drift passes three quarters of a level (see the anti-flash core, B933).
 * So a whole pinch can run, the drawing can scale on screen, and the scale bar and the tile `z` can
 * both hold their value the entire time. A DOM proxy derived from the basemap cannot see this at
 * all. Bind to the object that decides, which is `setView`.
 *
 * ── WHAT IT RECORDS ─────────────────────────────────────────────────────────────────────────────
 * Every `setView` call, with: the view before and after, the classification (zoom / pan / reframe),
 * the real call stack, the document's visibility at the moment, and — the whole point — **whether a
 * TRUSTED user gesture fired in the preceding window**, plus what that gesture was. Alongside it, on
 * ONE timeline: visibilitychange · pageshow/pagehide (and whether the load came out of the back/
 * forward cache) · freeze/resume · focus/blur · online/offline · the component's own mount · long
 * tasks · animation-frame gaps · resource loads settling · and any note the app hands it (a presence
 * change, a sync event, a raster arriving). Correlation is the deliverable: what arrives immediately
 * BEFORE a view change nobody asked for.
 *
 * ── WHY IT SHIPS IN PRODUCT CODE RATHER THAN LIVING IN A HARNESS ────────────────────────────────
 * The plan it has to be pointed at (Goose Creek, "Plan II — 220K, 440K, 700K GEOTECH") is behind a
 * signed-in session the sandbox cannot reach, and the trigger is his phone. An instrument built to
 * answer "why did it fail on his machine" has to be ARMABLE ON HIS MACHINE — B280403, FOREGROUND-OR-
 * VOID clause 5 — so it is gated the `diagArm.js` way: read at CALL time, armable with `?planyrDiag=1`
 * and no console. Unarmed it allocates nothing and does nothing.
 *
 * ⛔ READ-ONLY, and the boundary is not negotiable: it observes, it never mutates and never changes
 * a behaviour. Everything it reads is either an event it listened for or a `PerformanceObserver`
 * entry; it patches no global. (`window.fetch` was the obvious way to see in-flight requests settle
 * and is deliberately NOT patched — arming may never gate anything that mutates. `PerformanceObserver`
 * answers the same question by reading.)
 *
 * Pure + Node-testable (test/viewChangeRecorder.test.js): it takes its window and its clock rather
 * than reaching for them.
 */

/** Trusted user gestures that legitimately authorise a view change. `keydown` is here because the
 *  +/− and arrow keys move the view; a synthetic event is NOT (`isTrusted` is checked). */
export const GESTURE_EVENTS = ["wheel", "touchstart", "touchmove", "pointerdown", "gesturestart", "gesturechange", "keydown"];

/** How far back a view change may look for the gesture that authorised it. Deliberately generous:
 *  the brief's window, and wide enough to cover a frame-coalesced flush landing several frames after
 *  the touch that caused it, or a settle timer firing after the fingers lift. A window that is too
 *  TIGHT manufactures false "unrequested" rows, which is the expensive direction of error here. */
export const GESTURE_WINDOW_MS = 1500;

/* ⛔ AND THE WINDOW IS MEASURED AGAINST TIME THE MAIN THREAD WAS ACTUALLY AVAILABLE, NOT WALL CLOCK.
 * This is not a refinement; without it the instrument reports the bug it is hunting on a build that
 * does not have it. Caught on this rig's own first teeth run: at 20x CPU throttling, one wheel
 * gesture's frame-coalesced flush landed on the far side of a 912 ms long task, aged out of the
 * window, and was filed as an UNREQUESTED zoom — a clean, plausible, completely false violation.
 *
 * The app is not idle in that gap, it is BLOCKED, and a gesture whose own flush is still queued
 * behind a long task has not stopped being that gesture. So the elapsed time is discounted by the
 * long-task time in between: the window measures how long the app had a chance to act, which is the
 * quantity the question is actually about. Sibling of the reason `doubleTap` reads the event's own
 * `timeStamp` instead of `Date.now()` inside the handler (measured there: 307 ms of queueing against
 * a 350 ms budget) — the same mistake, one layer up. */

/** Ring sizes. Bounded because a diagnostic must never leak memory (the existing rule in
 *  SitePlanner.jsx's own view log). */
export const MAX_CHANGES = 400;
export const MAX_EVENTS = 1200;

const EPS = 1e-9;

/** What KIND of view change this was, from the two views alone. */
export function classifyChange(from, to) {
  if (!from || !to) return "unknown";
  const dz = Math.abs((to.ppf ?? 0) - (from.ppf ?? 0));
  const dx = Math.abs((to.offX ?? 0) - (from.offX ?? 0));
  const dy = Math.abs((to.offY ?? 0) - (from.offY ?? 0));
  if (dz <= EPS && dx <= EPS && dy <= EPS) return "noop";
  if (dz > EPS) return "zoom";
  return "pan";
}

/* The first frame in a stack that belongs to APPLICATION code rather than to this recorder or to the
 * React internals that dispatched it — i.e. who actually asked for the view change. Kept as a plain
 * string: the harness prints the whole stack anyway, and this is only the at-a-glance column. */
export function topAppFrame(stack) {
  if (typeof stack !== "string") return null;
  const lines = stack.split("\n").slice(1);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/viewChangeRecorder|\bsetView\b\s*\(?$/.test(line)) continue;
    if (/react-dom|react-jsx|scheduler|node_modules/.test(line)) continue;
    return line.replace(/^at\s+/, "");
  }
  return null;
}

/** Create a recorder. `now` and `max*` are injected so this is testable without a browser. */
export function createViewChangeRecorder({ now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()), maxChanges = MAX_CHANGES, maxEvents = MAX_EVENTS } = {}) {
  const changes = [];
  const events = [];
  let lastGesture = null;   // { t, type }
  let seq = 0;
  /* Long tasks, as [start, duration] — only kept while they might still matter to attribution. */
  let blocks = [];

  const pushEvent = (kind, detail) => {
    events.push({ seq: seq++, t: Math.round(now()), kind, detail: detail ?? null });
    if (events.length > maxEvents) events.shift();
  };

  /* A gesture only counts if the browser says it is real. A synthetic `KeyboardEvent`/`WheelEvent`
     dispatched by a harness has `isTrusted === false`, and treating one as authorisation would let a
     probe launder its own writes into "the user did it" — the same class of self-deception
     SYNTHETIC-KEYS-DONT-EDIT is about. A harness that wants to authorise a change drives a REAL
     gesture (CDP input), exactly as that rule already requires. */
  const noteGesture = (type, trusted) => {
    if (!trusted) { pushEvent("gesture:untrusted", type); return; }
    lastGesture = { t: Math.round(now()), type };
    pushEvent("gesture", type);
  };

  /* ⛔ REACT MAY RUN AN UPDATER TWICE. A functional `setState` updater is re-invoked when React
     re-renders the same pending update, so a single user notch can reach this function more than
     once with an IDENTICAL (stack, from, to). Counting those as separate view changes would inflate
     every rate this instrument reports — an over-count reads exactly like the bug being hunted,
     which is the most expensive possible error here. Deduped on the triple inside a short window,
     never on time alone: two genuinely distinct notches differ in `from`. */
  const DEDUPE_MS = 60;
  let lastKey = null, lastKeyT = -Infinity;

  /* Record a stretch in which the main thread was unavailable. Fed from the PerformanceObserver in
     `attachTimeline`; the pure core takes it as data so it is testable without a browser. */
  const noteBlocked = (start, duration) => {
    if (!(duration > 0)) return;
    blocks.push([start, duration]);
    if (blocks.length > 200) blocks = blocks.slice(-100);
  };

  /** Milliseconds the main thread was blocked between `from` and `to`. */
  const blockedBetween = (from, to) => {
    let ms = 0;
    for (const [s, d] of blocks) {
      const a = Math.max(s, from), b = Math.min(s + d, to);
      if (b > a) ms += b - a;
    }
    return ms;
  };

  const recordChange = ({ from, to, stack, visibility }) => {
    const t = Math.round(now());
    const key = `${stack}|${from && from.ppf}|${from && from.offX}|${from && from.offY}|${to && to.ppf}|${to && to.offX}|${to && to.offY}`;
    if (key === lastKey && t - lastKeyT <= DEDUPE_MS) return null;
    lastKey = key; lastKeyT = t;
    const blocked = lastGesture ? blockedBetween(lastGesture.t, t) : 0;
    const availableMs = lastGesture ? (t - lastGesture.t) - blocked : Infinity;
    const g = lastGesture && availableMs <= GESTURE_WINDOW_MS ? lastGesture : null;
    const row = {
      seq: seq++,
      t,
      kind: classifyChange(from, to),
      from: from ? { ppf: from.ppf, offX: from.offX, offY: from.offY } : null,
      to: to ? { ppf: to.ppf, offX: to.offX, offY: to.offY } : null,
      /* THE COLUMN THE WHOLE HUNT TURNS ON. */
      unrequested: !g,
      gesture: g ? { type: g.type, agoMs: t - g.t, blockedMs: Math.round(blocked) } : null,
      /* Always reported, even when the change is filed as unrequested, so a reader can see whether a
         verdict was a near miss against the window rather than a clear one. */
      sinceGestureMs: lastGesture ? t - lastGesture.t : null,
      blockedSinceGestureMs: lastGesture ? Math.round(blocked) : null,
      visibility: visibility ?? null,
      site: topAppFrame(stack),
      stack: stack ?? null,
      /* Everything on the timeline in the second before this change — the correlation window. */
      precededBy: events.filter((e) => t - e.t >= 0 && t - e.t <= GESTURE_WINDOW_MS).slice(-12).map((e) => ({ kind: e.kind, detail: e.detail, agoMs: t - e.t })),
    };
    changes.push(row);
    if (changes.length > maxChanges) changes.shift();
    return row;
  };

  const snapshot = () => ({
    changes: changes.slice(),
    events: events.slice(),
    unrequested: changes.filter((c) => c.unrequested && c.kind !== "noop"),
    counts: {
      changes: changes.length,
      unrequested: changes.filter((c) => c.unrequested && c.kind !== "noop").length,
      unrequestedZooms: changes.filter((c) => c.unrequested && c.kind === "zoom").length,
    },
  });

  const reset = () => { changes.length = 0; events.length = 0; lastGesture = null; blocks = []; };

  return { noteGesture, noteEvent: pushEvent, noteBlocked, recordChange, snapshot, reset };
}

/* Install the timeline listeners on a real window. Returns a detach function. Everything here is a
 * passive listener or a PerformanceObserver — nothing is patched, nothing is written. */
export function attachTimeline(win, rec) {
  if (!win || !rec) return () => {};
  const off = [];
  const on = (target, type, fn, opts) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, opts);
    off.push(() => { try { target.removeEventListener(type, fn, opts); } catch (_) { /* torn down */ } });
  };

  for (const type of GESTURE_EVENTS) {
    on(win, type, (e) => rec.noteGesture(type, !!(e && e.isTrusted)), { capture: true, passive: true });
  }

  const doc = win.document;
  on(doc, "visibilitychange", () => rec.noteEvent("visibilitychange", doc.visibilityState));
  on(win, "pageshow", (e) => rec.noteEvent("pageshow", e && e.persisted ? "bfcache-restore" : "fresh"));
  on(win, "pagehide", (e) => rec.noteEvent("pagehide", e && e.persisted ? "into-bfcache" : "discarded"));
  on(doc, "freeze", () => rec.noteEvent("freeze"));
  on(doc, "resume", () => rec.noteEvent("resume"));
  on(win, "focus", () => rec.noteEvent("focus"));
  on(win, "blur", () => rec.noteEvent("blur"));
  on(win, "online", () => rec.noteEvent("online"));
  on(win, "offline", () => rec.noteEvent("offline"));

  /* Resource loads settling — the "a late overlay/tile/fetch resolved right before the view moved"
     candidate, read rather than intercepted. */
  const observers = [];
  const observe = (type, fn, extra) => {
    try {
      const o = new win.PerformanceObserver((list) => { for (const e of list.getEntries()) fn(e); });
      o.observe({ type, buffered: true, ...extra });
      observers.push(o);
    } catch (_) { /* entry type unsupported in this browser — the rest of the timeline still stands */ }
  };
  observe("resource", (e) => {
    // Tiles are high-volume and uninteresting one at a time; everything else is named.
    const url = String(e.name || "");
    if (/\/\d+\/\d+\/\d+(\.(png|jpg|jpeg|webp))?(\?|$)/.test(url)) return;
    rec.noteEvent("resource", `${e.initiatorType} ${url.slice(-90)} +${Math.round(e.duration)}ms`);
  });
  observe("longtask", (e) => { rec.noteEvent("longtask", `${Math.round(e.duration)}ms`); rec.noteBlocked(e.startTime, e.duration); });

  /* ⛔ THE ANIMATION-FRAME GAP, and it is here because of FOREGROUND-OR-VOID: a suspended frame loop
     is exactly what an idle/backgrounded page has, and a view change landing on the far side of a
     multi-second gap is the signature of work that was QUEUED before the page went away and ran when
     it came back. Nothing else on this timeline can show that. */
  let raf = 0, last = 0;
  const GAP_MS = 400;
  const tick = (t) => {
    if (last && t - last > GAP_MS) rec.noteEvent("frame-gap", `${Math.round(t - last)}ms`);
    last = t;
    raf = win.requestAnimationFrame(tick);
  };
  try { raf = win.requestAnimationFrame(tick); } catch (_) { /* no rAF — the rest still records */ }

  return () => {
    for (const f of off) f();
    for (const o of observers) { try { o.disconnect(); } catch (_) { /* already gone */ } }
    try { win.cancelAnimationFrame(raf); } catch (_) { /* already gone */ }
  };
}
