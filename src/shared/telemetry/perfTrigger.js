/* The SELF-CALIBRATING trigger for the performance recorder (NEW-1).
 *
 * ⛔ WHY IT IS SELF-RELATIVE, AND WHY THAT IS THE WHOLE DESIGN. The owner's own sentence is the
 * specification: *"if I reload, it's immediately pretty quick and then a minute later or two,
 * it's lagging just to go side to side."* That describes a machine comparing itself to itself,
 * a minute apart — not a machine compared to a millisecond constant. Two consequences:
 *
 *   1. THE BASELINE IS TAKEN FROM THE WINDOW HE HIMSELF CALLS FAST — the first stretch after a
 *      load, minus the boot, which nobody claims is fast (B1431 attributed four busy seconds
 *      there, and folding those into the baseline would set the bar so high nothing could clear
 *      it).
 *   2. AN ABSOLUTE THRESHOLD WOULD BE WRONG EVERYWHERE ELSE. His display runs at 50 Hz; a bar
 *      tuned to a 50 Hz frame budget fires constantly on a 144 Hz panel and never on a slow one.
 *      Self-relative survives the hardware it lands on.
 *
 * ⛔ AND WHY IT IS SUSTAINED, NOT A SINGLE SLOW FRAME. A garbage collection, a tab-switch, a
 * screenshot, an antivirus hiccup — every one of those produces one enormous frame and means
 * nothing. This programme has already burned rounds on signals that turned out to be a single
 * sample. So firing needs THREE conditions to hold at once over a two-second window of frames
 * the user is actually interacting through:
 *
 *   (a) LEVEL      mean frame delta over the window ≥ MULTIPLIER × the baseline median
 *   (b) SUSTAIN    at least SLOW_FRACTION of the window's frames are individually that slow
 *   (c) FLOOR      the window mean is at least FLOOR_MS, in absolute terms
 *
 * (b) is what a GC cannot satisfy: one 400 ms frame in a window of a hundred is one percent, not
 * sixty. (c) is what stops a very fast machine reporting a doubling that is still imperceptible —
 * twice as slow as eight milliseconds is still a frame nobody can see.
 *
 * THE NUMBERS, AND WHY THESE:
 *   MULTIPLIER 2.0     — the run-to-run noise floor measured on this codebase's own harness is
 *                        ±6.3% (B1121 §1). A doubling is an order of magnitude clear of that, and
 *                        it is also roughly where a smooth gesture starts to read as a dragging
 *                        one. Lower would trade false alarms for sensitivity we have no budget to
 *                        spend: three auto-captures per page load is the whole allowance.
 *   SUSTAIN_MS 2000    — long enough that no single stall of any cause can fill it, short enough
 *                        that a two-second drag that felt bad is still caught while it is
 *                        happening. Below about a second the GC immunity weakens; above about
 *                        four, a short gesture ends before the window ever fills.
 *   SLOW_FRACTION 0.5  — a majority of the frames, not an average dragged up by outliers.
 *   COVERAGE 0.75      — ⛔ THE WINDOW IS QUALIFIED BY THE TIME IT SPANS, NOT BY A FRAME COUNT, and
 *                        that distinction was a real defect caught by this file's own tests. A
 *                        fixed "at least 24 frames in two seconds" makes the trigger LESS able to
 *                        fire the worse the lag gets — past about 80 ms a frame there are never 24
 *                        of them in two seconds, so the sessions that most deserve a capture are
 *                        exactly the ones that cannot produce one. Two seconds of evidence is two
 *                        seconds of evidence whether it is 120 frames or 10.
 *   FLOOR_MS 33        — two frames of a 60 Hz budget: the point at which motion stops being
 *                        smooth to anybody, on any display.
 *   BASELINE 5 s → 50 s — skip the boot, then take the window he describes as quick.
 *
 * Everything here is PURE and allocation-free on the hot path: `feedFrame` is called once per
 * animation frame and does a bounded amount of arithmetic over preallocated typed arrays. The
 * one sort in the file runs ONCE per page, when the baseline seals.
 */

export const TRIGGER_DEFAULTS = {
  baselineSkipMs: 5_000,      // ignore the boot window entirely
  baselineWindowMs: 45_000,   // …then calibrate over the next 45 s of interaction
  baselineMinFrames: 200,     // …but never seal on less than this many real frames
  baselineMaxFrames: 600,     // cap the sample (and the preallocated store)
  sustainMs: 2_000,
  sustainMinFrames: 8,        // an absolute floor, so a couple of frames can never qualify
  sustainCoverage: 0.75,      // …and the window must SPAN this fraction of sustainMs
  multiplier: 2.0,
  slowFraction: 0.5,
  floorMs: 33,
  cooldownMs: 120_000,
  maxAuto: 3,
  maxFrameMs: 1_500,          // beyond this it is not a frame — a debugger, a throttle, a sleep
  windowCap: 600,             // preallocated sustain-window capacity (≈10 s at 60 Hz)
};

/* Create the trigger state. All storage is allocated here and never again. */
export function createTrigger(overrides) {
  const cfg = { ...TRIGGER_DEFAULTS, ...(overrides || {}) };
  return {
    cfg,
    /* baseline */
    baseSamples: new Float64Array(cfg.baselineMaxFrames),
    baseN: 0,
    baseline: null,           // median frame delta once sealed, ms
    baselineSealedAt: null,   // ms since start
    baselineLate: false,      // sealed after the nominal window closed (he never interacted)
    /* sustain window — a circular buffer of the last `windowCap` frames, plus running sums */
    winT: new Float64Array(cfg.windowCap),
    winDt: new Float64Array(cfg.windowCap),
    winHead: 0, winTail: 0, winN: 0,
    winSum: 0, winSlow: 0,
    /* firing */
    fires: 0,
    lastFireAt: -Infinity,
    lastVerdict: null,
  };
}

/* The hot path. `t` is ms since the recorder started; `dt` the delta from the previous frame of
 * the same active run. Returns TRUE exactly on the frame a capture should be taken — the caller
 * does the expensive part, this only decides.
 *
 * Callers must not pass the first frame after an idle gap: its delta measures the gap, not the
 * app. perfRecorder.js drops it at the source. `maxFrameMs` is a second net under that. */
export function feedFrame(s, t, dt) {
  const cfg = s.cfg;
  if (!(dt > 0) || dt > cfg.maxFrameMs) return false;

  /* ── Baseline collection ─────────────────────────────────────────────────────────────── */
  if (s.baseline === null) {
    if (t >= cfg.baselineSkipMs) {
      if (s.baseN < cfg.baselineMaxFrames) s.baseSamples[s.baseN++] = dt;
      const windowClosed = t >= cfg.baselineSkipMs + cfg.baselineWindowMs;
      const enough = s.baseN >= cfg.baselineMinFrames;
      if ((windowClosed && enough) || s.baseN >= cfg.baselineMaxFrames) sealBaseline(s, t);
    }
    return false;   // never fire before there is something to compare against
  }

  /* ── Sustain window ──────────────────────────────────────────────────────────────────── */
  const slowBar = s.baseline * cfg.multiplier;
  pushWindow(s, t, dt, slowBar);
  evictWindow(s, t - cfg.sustainMs, slowBar);

  if (s.winN < cfg.sustainMinFrames) return false;
  if (windowSpan(s) < cfg.sustainMs * cfg.sustainCoverage) return false;
  if (s.fires >= cfg.maxAuto) return false;
  if (t - s.lastFireAt < cfg.cooldownMs) return false;

  const mean = s.winSum / s.winN;
  const frac = s.winSlow / s.winN;
  if (mean < slowBar) return false;
  if (frac < cfg.slowFraction) return false;
  if (mean < cfg.floorMs) return false;

  fire(s, t, mean, frac);
  return true;
}

/* The FIRE branch, split out of `feedFrame` for one reason: it is the only part of the trigger
 * that allocates, and it runs at most `maxAuto` times per page while `feedFrame` runs sixty times
 * a second. Keeping it separate is what lets `test/perfRecorder.test.js` assert — structurally, on
 * the source — that the PER-FRAME path contains no allocating expression at all. Move any of this
 * back inline and that guard goes red, which is exactly the point. */
function fire(s, t, mean, frac) {
  const cfg = s.cfg;
  s.fires++;
  s.lastFireAt = t;
  s.lastVerdict = {
    baselineMs: round1(s.baseline),
    windowMeanMs: round1(mean),
    windowFrames: s.winN,
    windowSpanMs: Math.round(windowSpan(s)),
    slowFraction: Math.round(frac * 100) / 100,
    ratio: round1(mean / s.baseline),
    sustainMs: cfg.sustainMs,
    multiplier: cfg.multiplier,
    floorMs: cfg.floorMs,
  };
  /* Clear the window so the next fire has to earn a fresh two seconds of evidence rather than
   * inheriting this one's. (The cooldown already prevents an immediate refire; this makes the
   * verdict of the NEXT capture independent of this one.) */
  s.winHead = s.winTail = s.winN = 0; s.winSum = 0; s.winSlow = 0;
  return true;
}

/* Seal the baseline as the MEDIAN of the collected frames. Median, not mean: a collection pause
 * during the calibration window would inflate a mean and quietly raise the bar for the rest of
 * the session — the failure mode where the instrument stops being able to see the problem. */
function sealBaseline(s, t) {
  const n = s.baseN;
  if (!n) return;
  const copy = s.baseSamples.slice(0, n);   // TypedArray#sort is numeric by default
  copy.sort();
  s.baseline = n % 2 ? copy[(n - 1) >> 1] : (copy[n / 2 - 1] + copy[n / 2]) / 2;
  s.baselineSealedAt = t;
  /* LATE means: he was not interacting enough during the window he calls fast, so the
   * calibration is taken from later than intended. A capture says so instead of presenting a
   * late baseline as if it were the post-load one. */
  s.baselineLate = t > s.cfg.baselineSkipMs + s.cfg.baselineWindowMs + 1000;
  if (!(s.baseline > 0)) s.baseline = null;   // degenerate sample: keep collecting
}

/* Force the baseline to seal with whatever has been collected — used when the nominal window has
 * closed but the user simply had not interacted enough for it to seal on its own. Recorded as
 * `baselineLate` so a capture says so rather than pretending the calibration was clean. */
export function sealBaselineLate(s, t) {
  if (s.baseline !== null || s.baseN < 20) return false;
  sealBaseline(s, t);
  s.baselineLate = true;
  return s.baseline !== null;
}

function pushWindow(s, t, dt, slowBar) {
  const cap = s.cfg.windowCap;
  if (s.winN === cap) {           // full: drop the oldest to make room
    s.winSum -= s.winDt[s.winTail];
    if (s.winDt[s.winTail] >= slowBar) s.winSlow--;
    s.winTail = s.winTail + 1 === cap ? 0 : s.winTail + 1;
    s.winN--;
  }
  s.winT[s.winHead] = t;
  s.winDt[s.winHead] = dt;
  s.winHead = s.winHead + 1 === cap ? 0 : s.winHead + 1;
  s.winN++;
  s.winSum += dt;
  if (dt >= slowBar) s.winSlow++;
}

function evictWindow(s, olderThan, slowBar) {
  const cap = s.cfg.windowCap;
  while (s.winN > 0 && s.winT[s.winTail] < olderThan) {
    const d = s.winDt[s.winTail];
    s.winSum -= d;
    if (d >= slowBar) s.winSlow--;
    s.winTail = s.winTail + 1 === cap ? 0 : s.winTail + 1;
    s.winN--;
  }
  /* Floating-point drift over hours of adds and subtracts: re-derive from scratch when the
   * window empties, which costs nothing and cannot drift. */
  if (s.winN === 0) { s.winSum = 0; s.winSlow = 0; }
}

/* How much TIME the sustain window covers — newest kept frame minus oldest. This, not the frame
 * count, is what makes "two seconds of evidence" mean the same thing on a smooth machine and on a
 * badly lagging one. */
function windowSpan(s) {
  if (s.winN < 2) return 0;
  const cap = s.cfg.windowCap;
  const newest = (s.winHead - 1 + cap) % cap;
  return s.winT[newest] - s.winT[s.winTail];
}

const round1 = (v) => Math.round(v * 10) / 10;

/* What the trigger currently knows — for the capture payload and for a live console read. Pure
 * read, no state change. */
export function triggerState(s) {
  return {
    baselineMs: s.baseline == null ? null : round1(s.baseline),
    baselineFrames: s.baseN,
    baselineSealedAtMs: s.baselineSealedAt == null ? null : Math.round(s.baselineSealedAt),
    baselineLate: !!s.baselineLate,
    windowFrames: s.winN,
    windowSpanMs: Math.round(windowSpan(s)),
    windowMeanMs: s.winN ? round1(s.winSum / s.winN) : null,
    slowFraction: s.winN ? Math.round((s.winSlow / s.winN) * 100) / 100 : null,
    fires: s.fires,
    multiplier: s.cfg.multiplier,
    sustainMs: s.cfg.sustainMs,
    floorMs: s.cfg.floorMs,
  };
}
