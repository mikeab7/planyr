/* cropDiag — self-capturing diagnostics for the crop dialog (NEW-2, 2026-10-15).
 *
 * THE REPORT: the owner placed a fresh overlay, opened Crop, and "it was buggy to the point where I couldn't click
 * anything once it was open". It has not reproduced since (see the item): so, per STANDING RULE #2, the disposition is
 * to INSTRUMENT it — his next hit must capture itself in `client_errors` instead of costing another round of guessing.
 * Read-only: nothing here changes what the dialog does, and nothing here ever throws into it.
 *
 * Four rows, all `event:<kind>` via reportClientEvent (privacy: numbers and element descriptors only — never a file
 * name, a URL or any drawing content):
 *   · crop-dialog-open      — every open: image size, whether the picture had decoded, the first view, the viewport.
 *                             Carries `bad:[…]` when the open state is one that cannot work (unknown size → NaN view,
 *                             zero-size viewport, picture not decoded a second later).
 *   · crop-pointer-blocked  — presses that landed on something OUTSIDE the crop modal while it was open (an overlay
 *                             sitting above it, eating them). The descriptor names what was hit.
 *   · crop-pointer-dead     — three presses in a row on the tool's own buttons that produced neither a click nor any
 *                             change of the tool's state (the tool is mounted and receiving pointers, nothing answers).
 *   · crop-stall / crop-render-storm — the page's frame loop stopped for seconds while the dialog was open, or the tool
 *                             re-rendered in a tight loop (the "frozen" dialog that is really a busy main thread).
 * Pure verdicts (`openVerdict`, `describeTarget`, `isDeadRun`) are unit-tested; `armCropWatchdog` is the thin wiring. */

export const DEAD_RUN = 3;           // consecutive unanswered button presses = "pointer-dead"
export const RESPONSE_MS = 600;      // how long a press has to produce a click or a state change
export const STALL_MS = 2500;        // a frame-loop gap this long (visible tab) is a stall
export const STORM_RENDERS = 150;    // renders inside one second = a render loop
export const BLOCKED_MAX = 3;        // report at most this many blocked-press rows per dialog

const fin = (n) => typeof n === "number" && Number.isFinite(n);

/** What is wrong with the state the dialog opened in? [] = nothing. */
export function openVerdict({ imgW, imgH, view, viewW, viewH, srcReady } = {}) {
  const bad = [];
  if (!(imgW > 0) || !(imgH > 0)) bad.push("image-size-unknown");
  if (!view || !fin(view.scale) || !fin(view.tx) || !fin(view.ty)) bad.push("view-not-finite");
  else if (!(view.scale > 0)) bad.push("view-scale-zero");
  if (!(viewW > 1) || !(viewH > 1)) bad.push("viewport-empty");
  if (srcReady === false) bad.push("image-not-decoded");
  return bad;
}

/** A short, content-free description of the element a press landed on. */
export function describeTarget(el) {
  if (!el || !el.tagName) return "none";
  const tag = String(el.tagName).toLowerCase();
  const tid = el.getAttribute && el.getAttribute("data-testid");
  const role = el.getAttribute && el.getAttribute("role");
  const cls = el.getAttribute && el.getAttribute("class");
  let z = "";
  try { z = (typeof getComputedStyle === "function" && getComputedStyle(el).zIndex) || ""; } catch { z = ""; }
  return [tag, tid && `#${tid}`, role && `[${role}]`, cls && `.${String(cls).split(/\s+/)[0]}`, z && z !== "auto" && `z${z}`].filter(Boolean).join("").slice(0, 80);
}

/** True when the last `DEAD_RUN` presses were all unanswered. `answers` is a list of booleans, oldest first. */
export function isDeadRun(answers) {
  if (!Array.isArray(answers) || answers.length < DEAD_RUN) return false;
  return answers.slice(-DEAD_RUN).every((a) => a === false);
}

let reporter = null;
function report(kind, message, extra) {
  try {
    if (!reporter) reporter = import("../../telemetry/clientErrors.js");
    reporter.then((m) => m.reportClientEvent(kind, message, extra)).catch(() => {});
  } catch { /* telemetry must never throw into the dialog */ }
}

/** Arm the watchdog on a mounted crop tool. `get()` returns the live snapshot
 *  `{ imgW, imgH, view, viewW, viewH, imgEl, rev, renders, mode, fill }` (rev bumps on any tool state change, renders
 *  counts renders). Returns a disposer. `env` is injectable for tests. */
export function armCropWatchdog({ root, get, env = {} }) {
  const win = env.window || (typeof window !== "undefined" ? window : null);
  const doc = env.document || (typeof document !== "undefined" ? document : null);
  const send = env.report || report;
  const setT = env.setTimeout || setTimeout, clearT = env.clearTimeout || clearTimeout;
  const setI = env.setInterval || setInterval, clearI = env.clearInterval || clearInterval;
  if (!win || !doc || !root) return () => {};
  const timers = []; let disposed = false;
  const later = (fn, ms) => { const t = setT(() => { if (!disposed) fn(); }, ms); timers.push(t); return t; };

  const snap = () => { try { return get() || {}; } catch { return {}; } };
  const openState = () => {
    const s = snap(); const img = s.imgEl;
    return {
      imgW: s.imgW, imgH: s.imgH, scale: s.view && s.view.scale, tx: s.view && s.view.tx, ty: s.view && s.view.ty,
      viewW: s.viewW, viewH: s.viewH, fill: !!s.fill, mode: s.mode,
      natW: img ? img.naturalWidth : null, natH: img ? img.naturalHeight : null, srcReady: img ? !!(img.complete && img.naturalWidth > 0) : null,
      vis: doc.visibilityState, win: [win.innerWidth, win.innerHeight],
    };
  };
  const o0 = openState();
  const bad0 = openVerdict({ ...o0, view: { scale: o0.scale, tx: o0.tx, ty: o0.ty } });
  send("crop-dialog-open", bad0.length ? `crop dialog opened in a bad state: ${bad0.join(",")}` : "crop dialog opened", { ...o0, bad: bad0 });
  // The picture may still be decoding at open — look again a second later, and say so only if it is STILL not there.
  later(() => {
    const o = openState();
    if (o.srcReady === false) send("crop-dialog-open", "crop dialog picture still not decoded 1s after open", { ...o, bad: ["image-not-decoded"], late: true });
  }, 1000);

  // ---- presses -----------------------------------------------------------------------------------------------
  let blocked = 0; const answers = []; let deadSent = false;
  const modalOf = (t) => (t && t.closest ? t.closest("[data-crop-modal]") : null);
  const onDown = (e) => {
    const t = e.target;
    const inTool = root.contains(t);
    if (!inTool && !modalOf(t) && blocked < BLOCKED_MAX) {
      blocked += 1;
      send("crop-pointer-blocked", "a press landed outside the open crop dialog", { hit: describeTarget(t), n: blocked, ...openState() });
    }
    const btn = inTool && t.closest ? t.closest("button") : null;
    if (!btn) return;
    const rev0 = snap().rev; let answered = false;
    const onClick = () => { answered = true; };
    root.addEventListener("click", onClick, true);
    later(() => {
      root.removeEventListener("click", onClick, true);
      if (snap().rev !== rev0) answered = true;
      answers.push(answered);
      if (!deadSent && isDeadRun(answers)) { deadSent = true; send("crop-pointer-dead", `${DEAD_RUN} button presses in a row got no answer`, { hit: describeTarget(btn), ...openState() }); }
    }, RESPONSE_MS);
  };
  win.addEventListener("pointerdown", onDown, true);

  // ---- stall + render storm ------------------------------------------------------------------------------------
  let last = (env.now || Date.now)(); let lastRenders = snap().renders || 0; let stallSent = false, stormSent = false;
  const tick = setI(() => {
    if (disposed) return;
    const now = (env.now || Date.now)(); const gap = now - last; last = now;
    const s = snap(); const r = s.renders || 0; const dr = r - lastRenders; lastRenders = r;
    if (doc.visibilityState === "visible" && gap - 1000 > STALL_MS && !stallSent) { stallSent = true; send("crop-stall", "the page stopped responding while the crop dialog was open", { gapMs: Math.round(gap), ...openState() }); }
    if (dr > STORM_RENDERS && !stormSent) { stormSent = true; send("crop-render-storm", "the crop tool re-rendered in a tight loop", { rendersPerSec: dr, ...openState() }); }
  }, 1000);
  timers.push(tick);

  return () => {
    disposed = true; win.removeEventListener("pointerdown", onDown, true);
    clearI(tick); timers.forEach((t) => { clearT(t); });
  };
}
