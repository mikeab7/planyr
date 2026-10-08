/* cornerClearance.js — B966700-ish (help/report control positioning fix) — WHAT A FIXED
 * BOTTOM-RIGHT CONTROL MUST CLEAR, MEASURED, NEVER ASSUMED.
 *
 * The global help/report control (HelpReportControl.jsx) used to reserve a constant 292px
 * above the bottom edge on EVERY route, sized to clear the tallest thing that could ever
 * occupy that corner anywhere in the app — the Site Planner canvas's own narrow-width zoom
 * stack. Michael's report: the button rendered 63% of the way up a short screen on the map
 * root, a schedule route and a model route alike — none of which has that stack, or anything
 * else, in the corner — because the constant didn't know that.
 *
 * The fix is to read the real DOM instead of reserving for a worst case that is usually not
 * there. Two kinds of thing can occupy this corner:
 *   (1) A Leaflet map's own bottom-right control container (`.leaflet-bottom.leaflet-right`,
 *       Leaflet's own stable class — holds the attribution + the graphic scale on the map
 *       screen). No app code needs to mark this; it's Leaflet's own DOM.
 *   (2) Anything else that wants this control to clear it marks itself with
 *       `data-canvas-corner="<name>"` — the Site Planner canvas's own narrow-width zoom stack
 *       and its "✎ Tools" FAB, today. A future bottom-right occupant reads this contract; it
 *       does not need HelpReportControl to know its name.
 * `HelpReportControl` mounts in the app Shell, which must never statically import a lazy
 * workspace's module (see /CLAUDE.md "Lazy-loaded workspaces") — a shared DOM attribute is
 * the contract instead, the same shape `data-feature`/`data-chrome`/`data-handle-layer`
 * already use elsewhere in this app for exactly this kind of cross-cutting concern.
 *
 * `cornerClearanceFromBottom` answers: given a control fixed at `right` with the given
 * `width`, how far from the viewport's bottom edge must its OWN bottom edge sit to clear
 * every genuine occupant of that same horizontal column? Only a candidate that actually
 * OVERLAPS the control's column counts — this is what makes desktop free of the reservation
 * even though the Site Planner canvas's zoom stack exists in the DOM there too: on desktop
 * the docked tool rail insets that stack's pane away from the true viewport edge, so its
 * measured rect simply doesn't reach this column. No genuine occupant -> `base` (by default,
 * the same value as `right`, so the control rests in the true corner instead of floating up
 * for nothing).
 *
 * ⛔ B1336528 (owner chat block "NEW-1", 2026-09-08) — THE SCHEDULE ROUTE'S GRID LIVES INSIDE A SAME-ORIGIN
 * IFRAME, AND THIS FUNCTION USED TO MEASURE ONLY THE PARENT DOCUMENT. Measured live on
 * production: on `/#/project/<id>/schedule` the control rendered at the bare `right:14,
 * bottom:14` corner — sitting directly on top of a grid row — because every occupant on that
 * route lives inside `<iframe src="/sequence/">` (`Scheduler.jsx`), a document this function
 * never queried. It is not that the math was wrong; there was nothing in the PARENT document
 * for it to find, so it fell back to the bare corner exactly as it should for a genuinely
 * chrome-free route — the bug is that the Schedule route only *looked* chrome-free from here.
 *
 * TWO ROUTES WERE AVAILABLE, and the general one was taken:
 *  (a) [CHOSEN] Descend into same-origin iframes and hit-test their own content, the same way
 *      the live diagnosis did (`iframe.contentDocument.elementsFromPoint` at the control's own
 *      corner point). This fixes the Schedule route AND every future embedded workspace with no
 *      further wiring — nothing inside the iframe has to adopt this shell's `data-canvas-corner`
 *      marker contract, which matters because `/sequence/` is a large, separately-maintained
 *      legacy page (~17,000 lines) this shell should not need to edit just to be measured
 *      correctly, and a marker-based approach would have to be re-applied to every future
 *      embedded surface by hand.
 *  (b) [NOT CHOSEN] Give the Schedule route its own docked anchor (the way `chromeDock.js` gives
 *      the map/canvas one), reserving a fixed band whenever that route is open. Smaller, but it
 *      is exactly the "reserve for a worst case that is usually not there" shape B966700 (the
 *      header above) already fixed once — a fixed reservation would still be wrong the moment
 *      the iframe shows a view with nothing at that corner (the embedded app's own Dashboard/
 *      Reports section, or a grid with too few rows to reach the bottom), and it teaches nothing
 *      about the next embedded surface.
 * (a) is the general fix and is why this bug existed at all — this function's job is "measure
 * the real DOM," and an iframe's DOM is still real DOM, just behind one more boundary.
 *
 * MECHANISM: for each same-origin `<iframe>` whose own box overlaps the control's column, hit-
 * test a point near the bottom-right corner of the control's own base-position footprint
 * (translating parent-viewport coordinates into the iframe's local coordinate space by
 * subtracting the iframe's own `getBoundingClientRect()` origin — `elementsFromPoint` inside a
 * frame is relative to THAT frame's viewport, not the parent's). The first (topmost/most specific) hit is treated
 * as a genuine occupant unless it's the iframe's own `<html>`/`<body>` root (empty background —
 * nothing to clear) or fails the same `isRendered` check every other candidate does. This is
 * CONTENT-AWARE rather than marker-based on purpose: it needed no change inside `/sequence/` at
 * all, so it works retroactively and for anything embedded there next.
 * A cross-origin iframe (none exist in this app today) is silently skipped — reading
 * `contentDocument` across origins returns `null`/throws depending on the engine, both handled.
 *
 * ⛔ SAFETY CAP: an iframe-derived "needed" is clamped to `MAX_IFRAME_NEEDED_PX`. A hit-tested
 * point can resolve to a large structural container (not a small corner-scoped chrome element)
 * when the embedded app simply hasn't painted anything more specific at that exact pixel — that
 * container's own top could sit far up the page, and an uncapped reading would reproduce the
 * exact "reserve a huge, usually-wrong distance" failure this whole mechanism exists to prevent,
 * just from a different cause. The cap is generous for genuine corner content (several times a
 * normal grid row) and nowhere near the old fixed 292px.
 *
 * ⛔ VERIFICATION NOTE: this repo's own interactive sandbox cannot load `/sequence/`'s real
 * content to observe this fix against the owner's actual grid — that page loads
 * `@supabase/supabase-js`/`@tabler/icons-webfont` synchronously from `cdn.jsdelivr.net`, and this
 * sandbox's headless Chromium cannot reach any external host (confirmed live: the CONNECT tunnel
 * to jsdelivr closes after ~6s; curl through the same proxy succeeds, browsers do not — a
 * pre-existing, previously-documented environment limit, not new to this fix). The mechanism is
 * proven two other ways instead: `test/cornerClearance.test.js` exercises the real translation/
 * hit-testing logic against a fake same-origin iframe (deterministic, part of `npm test`), and
 * `ui-audit/verify-help-report-control.mjs`'s PART J drives a REAL browser against a
 * self-contained synthetic same-origin iframe (a `srcdoc` document with no third-party
 * dependency), importing THIS EXACT module's source (read fresh off disk, via a `blob:` URL —
 * zero network either way) — proving the coordinate math and `elementsFromPoint` behavior hold
 * in a genuine browser. A live pass against the real Schedule route with real project data is
 * filed as `VERIFICATION.md`'s live-edge check.
 */

const GAP_PX = 10;
const MAX_IFRAME_NEEDED_PX = 160;

function isRendered(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  let cs;
  try { cs = window.getComputedStyle(el); } catch (_) { return true; }
  if (!cs) return true;
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  if (cs.opacity !== "" && Number(cs.opacity) === 0) return false;
  return true;
}

// NEW-1 — hitting the iframe's own document root means the sampled point is empty background
// (nothing painted there more specifically) — not a genuine occupant.
function isDocumentRoot(el) {
  if (!el) return true;
  const tag = el.tagName;
  return tag === "HTML" || tag === "BODY";
}

// NEW-1 — the clearance a single same-origin iframe's content implies at the sampled point near
// the control's own base-position footprint, or `null` if nothing genuine is there. `cx`/`cy` are
// in the PARENT document's viewport coordinates; translated into the frame's own local space
// before hit-testing (an iframe's `elementsFromPoint` is relative to its own viewport, not the
// parent's).
function iframeOccupantNeeded(frame, cx, cy, vh) {
  if (!isRendered(frame)) return null;
  const fr = frame.getBoundingClientRect();
  const px = cx - fr.left;
  const py = cy - fr.top;
  if (px < 0 || py < 0 || px > fr.right - fr.left || py > fr.bottom - fr.top) return null;
  let doc;
  try { doc = frame.contentDocument; } catch (_) { return null; } // cross-origin — inaccessible by design
  if (!doc || typeof doc.elementsFromPoint !== "function") return null;
  // NEW-1 (schedule empty band) — an embedded page that carries its own scroll-end clearance for this control
  // (the Schedule iframe pads the end of every scroll surface by the button's dock height) marks its root
  // `data-corner-free`: nothing of its content is permanently under the corner, so never lift the control for it.
  if (doc.documentElement && doc.documentElement.hasAttribute("data-corner-free")) return null;
  let hits;
  try { hits = doc.elementsFromPoint(px, py); } catch (_) { return null; }
  const hit = hits && hits[0];
  if (isDocumentRoot(hit) || !isRendered(hit)) return null;
  const r = hit.getBoundingClientRect(); // relative to the iframe's own viewport
  const needed = (vh - (fr.top + r.top)) + GAP_PX;
  return Math.min(needed, MAX_IFRAME_NEEDED_PX);
}

export function cornerClearanceFromBottom({ right, width, base = right } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined") return base;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const colLeft = vw - right - width;
  const colRight = vw - right;

  let candidates;
  try {
    candidates = [
      ...document.querySelectorAll(".leaflet-bottom.leaflet-right"),
      ...document.querySelectorAll("[data-canvas-corner]"),
    ];
  } catch (_) {
    return base;
  }

  let clearance = base;
  for (const el of candidates) {
    if (!isRendered(el)) continue;
    const r = el.getBoundingClientRect();
    const overlaps = r.right > colLeft && r.left < colRight;
    if (!overlaps) continue;
    const needed = (vh - r.top) + GAP_PX;
    if (needed > clearance) clearance = needed;
  }

  // NEW-1 — same-origin iframes (the Schedule route's embedded `/sequence/` app, and any future
  // embedded workspace) render their own content in a document this loop never sees. Sample a
  // point safely inside the control's own base-position footprint, translated into each
  // overlapping iframe's local coordinates, and treat whatever's genuinely painted there the same
  // way a marker-based candidate is treated above. See this file's header for the full mechanism
  // + the safety cap.
  //
  // ⛔ Deliberately NOT the footprint's geometric centre: this function is never told the
  // control's HEIGHT (every caller today happens to pass a square control, but nothing here
  // should assume that), and a centre point computed from `width` alone can land above a
  // bottom-anchored occupant that only reaches partway up a taller control's box — measured live:
  // a 30px control over a 24px grid row missed the row entirely at its geometric centre while
  // genuinely overlapping it lower down. Sampling near the footprint's own bottom-right corner
  // instead needs no height assumption (the bottom edge, `vh - base`, is always exact) and is the
  // pixel most likely to be covered by any bottom-right-anchored occupant in the first place.
  try {
    const cx = colRight - (GAP_PX / 2);
    const cy = (vh - base) - (GAP_PX / 2);
    for (const frame of document.querySelectorAll("iframe")) {
      const fr = frame.getBoundingClientRect ? frame.getBoundingClientRect() : null;
      if (!fr || !(fr.right > colLeft && fr.left < colRight)) continue;
      const needed = iframeOccupantNeeded(frame, cx, cy, vh);
      if (needed != null && needed > clearance) clearance = needed;
    }
  } catch (_) { /* best-effort — never throws into the app */ }

  return clearance;
}
