/* clickDiag — B1066370 (reopened): a real press on Edit / Delete / "Place on map" reportedly did
 * nothing on the first click and worked on the second, on three different controls, in three
 * different modules, with the owner's own confound (a driver's scrollIntoView-plus-delay)
 * explicitly eliminated on the third. Every isolated reproduction attempted from this sandbox —
 * a real-click test against the unmocked `CompDetail` component, and a real-click test against
 * the live, unmocked `SitePlansSection` upload flow — found the click firing correctly on the
 * first press. Two disabled/layout-shift hypotheses were also measured and refuted (the button
 * never moves after it first renders; the "Place on map" title auto-fills from the picked file's
 * name in the SAME state update that reveals the button, so there is no disabled→enabled race).
 *
 * STANDING RULE #2 in /CLAUDE.md gives three admissible dispositions for an owner-reported symptom
 * that a null cannot close: reproduce-and-fix, ask-and-take-his-answer, or INSTRUMENT IT SO IT
 * CAPTURES ITSELF WHEN HE HITS IT. This is the third — the mechanism could not be found by reading
 * or by reproducing outside his actual signed-in session, so the next occurrence reports itself.
 *
 * MECHANISM: a capture-phase listener on `document` records every press (pointerdown/mousedown) on
 * an interactive `<button>`/`[role=button]` — its label, rect and disabled state — and starts a
 * short timer. If no matching `click` lands on that SAME element before the timer expires, the
 * press is a SUSPECT: the click event that should exist did not. The report captures what changed
 * about the element in the meantime (still in the DOM? moved? something else now covers its own
 * center point?), which is exactly the fact needed to tell "the click handler never fired" apart
 * from "a re-render replaced the node" apart from "something else is now on top of it".
 *
 * ⛔ ALWAYS-ON, NOT ARMED — deliberately different from `site-planner/lib/diagArm.js`'s pattern.
 * That module gates a diagnostic that would otherwise print noise; this one is SILENT BY
 * CONSTRUCTION (a real click always clears its own timer, so an ordinary session reports nothing)
 * and the whole point is not to depend on the owner remembering a URL param before the one session
 * that happens to reproduce it. Reports go out through the existing `client_errors` channel
 * (`reportClientEvent`, the same B468/NEW-5 shape already used for "diagnosable without a live
 * session") rather than a `window`-only log, because nobody would be at the console when this
 * actually fires.
 *
 * Read-only: writes nothing to app state, changes no behaviour, never throws into the app.
 */

const CLICK_GRACE_MS = 900; // generous — a real click never takes this long to follow a press
const MAX_TRACKED = 5; // bound a burst of presses so this can never leak unbounded timers

export function labelFor(el) {
  if (!el) return "";
  const raw = (el.getAttribute && el.getAttribute("aria-label")) || (el.textContent || "");
  return String(raw).trim().replace(/\s+/g, " ").slice(0, 60);
}

/** PURE — given the entry recorded at press time and what was observed when the grace period
 * expired with no click, build the report's (kind, message, extra) triple. Node-testable. */
export function describeSuspect(entry, observation) {
  const { label, disabled, rect } = entry;
  const { stillInDom, rectNow, coveredBy } = observation;
  const moved = stillInDom && rectNow
    ? (Math.round(rectNow.x) !== Math.round(rect.x) || Math.round(rectNow.y) !== Math.round(rect.y))
    : null;
  return {
    kind: "click-swallowed",
    message: `press on "${label}" had no matching click within ${CLICK_GRACE_MS}ms`,
    extra: {
      label, disabledAtPress: !!disabled, stillInDom: !!stillInDom, moved,
      rectAtPress: rect, rectNow: rectNow || null, coveredBy: coveredBy || null,
    },
  };
}

function closestButton(el) {
  return el && typeof el.closest === "function" ? el.closest('button, [role="button"]') : null;
}

function roundRect(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** Install the capture-phase listeners. Idempotent (a second call on the same `win` is a no-op).
 * Returns an uninstall function. `reporter` defaults to the real telemetry sink but is injectable
 * for the DOM-driven verification harness. */
export function installClickDiag(win = typeof window === "undefined" ? undefined : window, reporter) {
  if (!win || !win.document) return () => {};
  if (win.__PLANYR_CLICK_DIAG_INSTALLED) return () => {};
  win.__PLANYR_CLICK_DIAG_INSTALLED = true;
  const doc = win.document;
  const pending = new Map(); // button element -> { label, disabled, rect, timer }

  const report = (kind, message, extra) => {
    try {
      if (reporter) { reporter(kind, message, extra); return; }
      import("../telemetry/clientErrors.js").then((m) => m.reportClientEvent(kind, message, extra)).catch(() => {});
    } catch (_) { /* telemetry must never throw into the app */ }
  };

  const onDown = (e) => {
    try {
      const btn = closestButton(e.target);
      if (!btn || pending.has(btn) || pending.size >= MAX_TRACKED) return;
      const rect = roundRect(btn.getBoundingClientRect());
      const entry = { label: labelFor(btn), disabled: !!btn.disabled, rect };
      entry.timer = win.setTimeout(() => {
        pending.delete(btn);
        try {
          const stillInDom = doc.contains(btn);
          const rectNow = stillInDom ? roundRect(btn.getBoundingClientRect()) : null;
          let coveredBy = null;
          if (stillInDom) {
            const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
            const atPoint = doc.elementFromPoint ? doc.elementFromPoint(cx, cy) : null;
            if (atPoint && atPoint !== btn && !btn.contains(atPoint)) {
              coveredBy = atPoint.tagName + (atPoint.className ? "." + String(atPoint.className).split(" ")[0] : "");
            }
          }
          const { kind, message, extra } = describeSuspect(entry, { stillInDom, rectNow, coveredBy });
          report(kind, message, { ...extra, url: win.location ? win.location.hash : "" });
        } catch (_) { /* never throw out of a timer */ }
      }, CLICK_GRACE_MS);
      pending.set(btn, entry);
    } catch (_) { /* never throw into the app */ }
  };

  const onClick = (e) => {
    try {
      const btn = closestButton(e.target);
      const entry = btn && pending.get(btn);
      if (!entry) return;
      win.clearTimeout(entry.timer);
      pending.delete(btn);
    } catch (_) { /* never throw into the app */ }
  };

  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("mousedown", onDown, true); // belt-and-suspenders across pointer/mouse-only paths
  doc.addEventListener("click", onClick, true);

  return () => {
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("mousedown", onDown, true);
    doc.removeEventListener("click", onClick, true);
    for (const entry of pending.values()) win.clearTimeout(entry.timer);
    pending.clear();
    win.__PLANYR_CLICK_DIAG_INSTALLED = false;
  };
}
