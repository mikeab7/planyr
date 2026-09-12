/* bootFraming — WHAT FRAMING DID THE CANVAS ACTUALLY PAINT, FRAME BY FRAME, DURING BOOT?
 *
 * ⛔ WHY THIS EXISTS AND WHY AN EVENT INSTRUMENT COULD NOT ANSWER IT (B1574432, 2026-09-11).
 * The owner filmed his iPhone at 60 fps loading planyr.io: the plan paints correctly (dimmed,
 * "Loading your sites…"), then for TWO FRAMES the canvas cuts to one building at extreme zoom,
 * then returns. The app's own view-change recorder (lib/viewChangeRecorder.js), armed on
 * production against that very plan, reported `counts: { changes: 0 }`.
 *
 * That zero is not a refutation — it is the instrument being structurally blind, in TWO ways that
 * this module is built not to repeat:
 *
 *   1. **IT IS PER-MOUNT.** The recorder is a `useRef` inside `SitePlanner`, and
 *      `window.__plannerViewChanges` is re-pointed by whichever mount ran its effect last. The
 *      planner is keyed `${activeSiteId}:${loadEpoch}` and `applyUser` bumps `loadEpoch` on every
 *      signed-in boot resume — so boot contains a REMOUNT, and a per-mount ring cannot span it.
 *      Everything here lives on `window`, is created before the app's first script runs, and
 *      survives any number of remounts.
 *   2. **IT RECORDS DISPATCHES, NOT PIXELS.** A `setView` is what the app ASKED for. The framing
 *      the owner SAW is whatever the SVG carried at a frame boundary. Those differ: a framing
 *      committed and replaced inside one frame is never painted (harmless), and a framing carried
 *      across a remount is painted without any `setView` running at all (the whole bug — a fresh
 *      mount's `useState` initial view is painted with nothing dispatched).
 *
 * ── WHAT IT RECORDS ─────────────────────────────────────────────────────────────────────────────
 * Two independent channels over the same three attributes (`data-view-ppf` / `-offx` / `-offy` on
 * `[data-testid="planner-canvas"]`, which ARE the committed framing — the SVG's own transform
 * inputs, not a proxy for them):
 *
 *   · PAINTED  — a `requestAnimationFrame` loop reading the live DOM once per frame. A value that
 *                appears here survived to a frame boundary, so the user saw it. This is the channel
 *                the invariant is asserted on.
 *   · COMMITTED — a `MutationObserver` on the document, catching every attribute write including
 *                ones replaced within a single frame. Reported, never asserted on: a framing the
 *                compositor never showed is not a flash.
 *
 * Each distinct framing carries the mount it belonged to (`data-planner-mount`, stamped by the app)
 * so "two framings" can be told from "two mounts, one framing each".
 *
 * ⚠ rAF DOES NOT RUN IN A BACKGROUND TAB (FOREGROUND-OR-VOID). The in-page recorder counts its own
 * frames and records `visibilityState` on every sample, and `bootFramingReport` REFUSES to return a
 * verdict from a run whose frame count is degenerate — a suspended rAF loop would otherwise report
 * "one framing, no flash" for a tab that painted nothing at all, which is the confirmation-shaped
 * false pass this repo has already paid for three times.
 */

/** The in-page recorder, as source text for `addInitScript`. Runs before any app script. */
export const BOOT_FRAMING_INIT = `(() => {
  try {
    var W = window;
    if (W.__bootFraming) return;
    var t0 = (W.performance && W.performance.now) ? W.performance.now() : Date.now();
    var painted = [], committed = [], frames = 0, hiddenFrames = 0, stopped = false;
    var SEL = '[data-testid="planner-canvas"]';
    /* ⛔ AN ATTRIBUTE IS NOT A PAINT. The canvas carries a framing whenever it exists, including
       while it is deliberately not being painted (the app hides the stack until a framing has been
       computed — see SitePlanner.jsx B1574432). Counting the attribute alone would report a
       "painted framing" for a canvas the compositor never drew, which is the confirmation-shaped
       false reading this whole rig exists to avoid. So paint-visibility is part of the key, and a
       run that was not visible is dropped by \`realRuns\` rather than scored.
       NOTE: this resolves style once per frame, so this rig must not be used for frame-TIME work. */
    var vis = function (el) {
      try {
        if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true });
        return el.style.visibility !== 'hidden';
      } catch (e) { return true; }
    };
    var key = function (el) {
      if (!el) return null;
      var p = el.getAttribute('data-view-ppf'), x = el.getAttribute('data-view-offx'), y = el.getAttribute('data-view-offy');
      if (p == null || x == null || y == null) return null;
      return { ppf: +p, offX: +x, offY: +y, mount: el.getAttribute('data-planner-mount') || null, visible: vis(el) };
    };
    /* The MOUNT is part of the signature. Boot contains a remount, and two mounts that happen to
       land on the same framing are still two framings — merging them would hide exactly the case
       the owner filmed (a fresh mount painting its own default). */
    var sig = function (k) { return k ? (k.visible ? '' : 'unpainted:') + (k.mount || '?') + '|' + k.ppf + '|' + k.offX + '|' + k.offY : 'none'; };
    var push = function (list, k, t) {
      var last = list.length ? list[list.length - 1] : null;
      if (last && last.sig === sig(k)) { last.until = t; last.samples++; return; }
      list.push({ sig: sig(k), ppf: k ? k.ppf : null, offX: k ? k.offX : null, offY: k ? k.offY : null,
                  mount: k ? k.mount : null, canvasVisible: k ? !!k.visible : false, at: t, until: t, samples: 1,
                  visibility: (typeof document !== 'undefined' ? document.visibilityState : null) });
    };
    var now = function () { return ((W.performance && W.performance.now) ? W.performance.now() : Date.now()) - t0; };
    var tick = function () {
      if (stopped) return;
      frames++;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') hiddenFrames++;
      push(painted, key(document.querySelector(SEL)), now());
      W.requestAnimationFrame(tick);
    };
    W.requestAnimationFrame(tick);
    try {
      var mo = new MutationObserver(function (recs) {
        var t = now();
        for (var i = 0; i < recs.length; i++) {
          var r = recs[i];
          if (r.type === 'attributes' && r.target && r.target.matches && r.target.matches(SEL)) push(committed, key(r.target), t);
          else if (r.type === 'childList') {
            for (var j = 0; j < r.addedNodes.length; j++) {
              var n = r.addedNodes[j];
              if (n.nodeType !== 1) continue;
              var c = n.matches && n.matches(SEL) ? n : (n.querySelector ? n.querySelector(SEL) : null);
              if (c) push(committed, key(c), t);
            }
          }
        }
      });
      mo.observe(document, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['data-view-ppf', 'data-view-offx', 'data-view-offy', 'data-planner-mount'] });
    } catch (e) { /* an instrument never breaks the page */ }
    W.__bootFraming = function () {
      return { painted: painted.slice(), committed: committed.slice(), frames: frames,
               hiddenFrames: hiddenFrames, elapsedMs: now() };
    };
    W.__bootFramingStop = function () { stopped = true; return W.__bootFraming(); };
    W.__bootFramingReset = function () { painted.length = 0; committed.length = 0; frames = 0; hiddenFrames = 0; };
  } catch (e) { /* never break the page */ }
})();`;

/** Drop the leading "nothing painted yet" runs — before the canvas exists there is no framing. */
export function realRuns(runs = []) {
  return runs.filter((r) => r && r.sig !== "none" && Number.isFinite(r.ppf) && r.canvasVisible !== false);
}

/** The framings the canvas HELD but never painted — reported so a run can say "it was hidden",
 *  never silently counted as a pass. */
export function unpaintedRuns(runs = []) {
  return runs.filter((r) => r && r.sig !== "none" && Number.isFinite(r.ppf) && r.canvasVisible === false);
}

/** The DISTINCT framings in a channel, in first-seen order, each with how long it was held. */
export function distinctFramings(runs = []) {
  const out = [];
  for (const r of realRuns(runs)) {
    const prev = out.length ? out[out.length - 1] : null;
    if (prev && prev.sig === r.sig) { prev.until = r.until; prev.samples += r.samples; continue; }
    out.push({ ...r, heldMs: +(r.until - r.at).toFixed(1) });
  }
  return out.map((r) => ({ ...r, heldMs: +(r.until - r.at).toFixed(1) }));
}

/**
 * The verdict. `ok` is the invariant the owner stated: the canvas commits ONE framing per load —
 * whatever framing is first PAINTED is the framing that stays.
 *
 * ⛔ VACUITY IS A FAILURE, NOT A PASS. A run that never painted the canvas, or whose rAF loop was
 * suspended (a background tab), has not observed the property and says so instead of scoring.
 */
export function bootFramingReport(raw, { minFrames = 30 } = {}) {
  const painted = distinctFramings(raw?.painted);
  const committed = distinctFramings(raw?.committed);
  const unpainted = unpaintedRuns(raw?.painted || []);
  const frames = raw?.frames || 0;
  const hiddenFrames = raw?.hiddenFrames || 0;
  /* ⛔ THE VACUITY TEST IS ABOUT THE *VISIBLE* FRAMES, and that distinction is load-bearing. An arm
   * that deliberately boots HIDDEN spends its first seconds with rAF suspended; counting those as
   * contamination would mark the one arm that tests the hardest case as unscoreable. What matters
   * is whether enough frames were sampled while the tab really was visible to see a flash if one
   * happened — a flash lasts a handful of frames, so a couple of dozen is the floor. */
  const visibleFrames = frames - hiddenFrames;
  const vacuity = [];
  if (visibleFrames < minFrames) vacuity.push(`only ${visibleFrames} of ${frames} animation frames were sampled with the tab visible, in ${Math.round(raw?.elapsedMs || 0)} ms — too few to have seen a flash; this run observed nothing (FOREGROUND-OR-VOID)`);
  if (!painted.length) vacuity.push("the planner canvas never painted a framing — nothing was measured");
  /* ⛔ A GUARD THAT ROTS GREEN, CAUGHT BY ITS OWN TEETH PROOF. The first version of this verdict was
   * "every mount painted exactly one framing". Run against a build with no `data-planner-mount`
   * stamp (the very build the rig was written to fail) it saw ZERO mounts, so there were zero
   * offenders, so it printed ✅ — over a run whose own listing showed the default framing painted
   * twice. An unattributable framing is not a passing framing: if the stamp is missing the rig
   * cannot answer its own question and must say so. */
  if (painted.some((r) => !r.mount)) vacuity.push(`${painted.filter((r) => !r.mount).length} of ${painted.length} painted framings carry no \`data-planner-mount\` — this build does not stamp the canvas, so framings cannot be attributed to a mount and no verdict is possible`);
  const mounts = [...new Set(painted.map((p) => p.mount).filter(Boolean))];
  /* ⛔ THE INVARIANT IS PER MOUNT, NOT PER RUN. "One framing per load" is really "whatever framing
   * a mounted planner first paints is the one it keeps" — and a signed-in boot mounts the planner
   * TWICE (`SitePlannerApp` keys it `${activeSiteId}:${loadEpoch}`, and `applyUser` bumps
   * `loadEpoch` when the cloud pull settles). Two mounts painting one framing each is correct; one
   * mount painting two is the bug, whichever mount it is. */
  const framingsPerMount = mounts.map((m) => ({ mount: m, framings: painted.filter((p) => p.mount === m).length }));
  const offenders = framingsPerMount.filter((m) => m.framings !== 1);
  return {
    ok: vacuity.length === 0 && painted.length > 0 && offenders.length === 0,
    framingsPerMount,
    offenders,
    vacuous: vacuity.length > 0,
    vacuity,
    frames,
    hiddenFrames,
    visibleFrames,
    paintedFramings: painted.length,
    committedFramings: committed.length,
    mounts: mounts.length,
    painted,
    committed,
    unpainted: unpainted.map((r) => ({ ppf: r.ppf, offX: r.offX, offY: r.offY, at: r.at, samples: r.samples })),
  };
}

/** One line per distinct painted framing, for a harness's report. */
export function framingLines(list = []) {
  return list.map((r, i) => `  ${i + 1}. ppf=${r.ppf} off=(${r.offX}, ${r.offY})  first painted t=${Math.round(r.at)}ms  held ${Math.round(r.heldMs)}ms over ${r.samples} frame(s)  mount=${r.mount || "?"}`);
}
