/* notesViewport — THE NOTE PAGE SITS ON AN UNBOUNDED, PANNABLE, ZOOMABLE WORKSPACE (NEW-1,
 * owner report 2026-09-21, verbatim: *"the canvas should act like bluebeam where I can zoom far
 * in and out, and move it to wherever via zoom."*)
 *
 * PURE. No DOM, no React. Every rule below — the zoom range, what a wheel notch means, where the
 * cursor anchor goes, how a fit is framed, what persists — is a unit test rather than something
 * you have to open a browser to find out.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ⛔ WHY THIS EXISTS AT ALL, AND IT IS NOT MAINLY ABOUT ZOOM. It is the coordinate system the
 * page-width feature needed and never had.
 *
 * The page's width had been reported buggy FOUR times (B1740688 content shift · B1775312 judder ·
 * B1801040 left-grip creep · this round). Every previous fix worked the same way: the sheet lived
 * in a SCROLLER, so its on-screen position was `gutter − scrollLeft`, and BOTH of those terms
 * move when the sheet's width changes. Holding the words still therefore required actively
 * COMPENSATING — writing `scrollLeft` by the measured layout shift, in a layout effect, every
 * frame of the drag.
 *
 * ⛔ AND A SCROLL IS A BOUNDED RESOURCE, WHICH IS THE WHOLE BUG FAMILY IN ONE SENTENCE.
 * `scrollLeft` can only move as far as `scrollWidth − clientWidth` allows; when the content is
 * narrower than the pane there is no overflow at all and the write is silently clamped. The
 * compensation under-delivers, the words slide by exactly what could not be spent, and nothing
 * notices — the effect compares CONTENT-space positions, never the achieved screen position. That
 * is B1801040 exactly, measured at +140px on a 440-wide page. Round 2 fought a DOUBLE
 * compensation; round 3 fought a compensation CLAMPED AT ZERO. Both are the same mechanism
 * failing in two directions, which is the tell NOTES-CARRY-FORWARD §5 family −1 names: *when a
 * fix's justification is the defect the previous fix caused, you are trading, not fixing.*
 *
 * ⛔ SO THE FIX IS TO DELETE THE MECHANISM, NOT TO TUNE IT. On a transform viewport the sheet is
 * absolutely positioned at a WORKSPACE coordinate and the view is `translate(−x, −y) scale(z)`.
 * Widening from the left is then two assignments that cannot interact with the view at all:
 *
 *     sheet.left  −= delta        (the boundary moves out)
 *     sheet.padLeft += delta      (the body's workspace position is therefore unchanged)
 *
 * The body's workspace X is `left + padLeft`, which is invariant by construction; the view's
 * `x`/`y`/`z` are not read, not written, and not involved. **There is nothing to compensate, so
 * there is nothing that can be clamped, double-applied, or lost.** The three shipped rounds'
 * defects are not fixed here so much as made unrepresentable.
 *
 * It also buys the thing the scroller could never give: the view is UNBOUNDED, so the page can be
 * pushed anywhere in any direction (Bluebeam's own behaviour, and what the owner asked for), and
 * there is always blank workspace to double-click into — which is what `matPadX`, `matSidePads`,
 * `matReachWidth` and `MAT_EXTRA_BOTTOM` all existed to manufacture inside a bounded scroller.
 * All four are gone.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ⛔ THE ONE COORDINATE RULE, STATED ONCE SO NOTHING RE-DERIVES IT:
 *
 *     screenX = workspaceX * z − view.x          (relative to the viewport's own top-left)
 *     workspaceX = (screenX + view.x) / z
 *
 * `view.x` is therefore the exact analogue of `scrollLeft` — same sign, same units (post-scale
 * screen pixels), same meaning — WITHOUT the `[0, scrollWidth − clientWidth]` clamp. That is
 * deliberate: it means every existing computation that reasoned in scroll terms keeps its
 * arithmetic unchanged, and the ONLY thing that disappears is the clamp, which is the defect.
 *
 * ⛔ AND THE VIEW IS NEVER A REACT RENDER. `view` lives in a ref and is written straight onto the
 * workspace layer's `transform`. A pan therefore recomputes NOTHING — no memo, no measurement, no
 * reconciliation — which is VIEW-INDEPENDENT-ONCE satisfied by construction rather than by a
 * memo key that a later edit can quietly poison.
 */

/** ⛔ THE RANGE IS WIDE ON PURPOSE, AND BOTH ENDS WERE CHOSEN AGAINST A STATED PICTURE rather
 *  than copied from the old text-size control (which ran 50%–300%, because it was answering a
 *  different question — it scaled the writing while the page kept the pane's width, so text
 *  RE-WRAPPED; that module is deleted and this replaces it).
 *
 *  10% — a 580pt page renders about as wide as a business card, so a whole page plus the
 *  workspace around it is visible at once and you can see where everything is. Further out than
 *  that and the page is a speck with nothing to aim at.
 *  800% — a 15px body glyph renders at about 120px tall, which is past the point of reading and
 *  into inspecting a single letter. Bluebeam itself goes further; a text document has nothing
 *  to look at down there. */
export const VIEW_ZOOM_MIN = 0.1;
export const VIEW_ZOOM_MAX = 8;
export const VIEW_ZOOM_DEFAULT = 1;

/** The ladder Ctrl+= / Ctrl+− walks. Ratios people recognise from every other document tool
 *  rather than a smooth slider: a level you can name is a level you can get back to. The middle
 *  of it is the old control's ladder verbatim, so the steps anybody is used to are unchanged;
 *  only the two ends are new. */
export const VIEW_ZOOM_STEPS = [
  0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.8, 0.9,
  1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8,
];

/** How much clear workspace a "fit the page" framing leaves around the sheet, as a fraction of
 *  the smaller viewport dimension — a fraction rather than a constant so the margin looks the
 *  same on a phone and on a 2K panel. */
const FIT_MARGIN_FRACTION = 0.04;

export const clampViewZoom = (z) => {
  const n = typeof z === "number" ? z : parseFloat(z);
  if (!Number.isFinite(n) || n <= 0) return VIEW_ZOOM_DEFAULT;
  return Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, n));
};

const num = (v, d = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

/** A view, normalised. Anything unreadable lands on the identity view rather than on NaN — a
 *  corrupt stored value must open a readable page, never a blank one. */
export function normalizeView(v) {
  return { x: num(v?.x, 0), y: num(v?.y, 0), z: clampViewZoom(v?.z) };
}

/** The workspace point under a viewport-relative position. */
export function toWorkspace(view, { x, y }) {
  const v = normalizeView(view);
  return { x: (num(x) + v.x) / v.z, y: (num(y) + v.y) / v.z };
}

/** Where a workspace point lands inside the viewport. */
export function toViewport(view, { x, y }) {
  const v = normalizeView(view);
  return { x: num(x) * v.z - v.x, y: num(y) * v.z - v.y };
}

/** ⛔ ZOOM IS ANCHORED AT THE CURSOR — the point under the pointer stays under the pointer
 *  through every step. This is the site planner's own rule (B1449/PR #952) rather than a second
 *  implementation of it: solve for the view that keeps one workspace point at one viewport
 *  position, which is arithmetic, not a guess.
 *
 *  @param view    the view now
 *  @param at      the anchor, in VIEWPORT coordinates (pointer position minus the viewport's own
 *                 top-left). Omit to anchor at the viewport's origin.
 *  @param nextZoom the level being moved to (clamped here, so a caller cannot step out of range).
 */
export function zoomAbout(view, at, nextZoom) {
  const v = normalizeView(view);
  const z = clampViewZoom(nextZoom);
  const ax = num(at?.x);
  const ay = num(at?.y);
  const w = toWorkspace(v, { x: ax, y: ay });
  return { x: w.x * z - ax, y: w.y * z - ay, z };
}

/** What a wheel notch means. Proportional rather than a fixed step, so a trackpad's many small
 *  deltas feel continuous and a mouse's one big detent still moves a useful amount — the same
 *  curve the previous control used and the same reasoning the planner's own wheel zoom uses. */
export function zoomForWheel(current, deltaY, { deltaMode = 0 } = {}) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampViewZoom(current);
  // A "line" or "page" delta is a different unit entirely; normalise it to pixels first.
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return clampViewZoom(clampViewZoom(current) * Math.exp(-px / 400));
}

/** ⛔ WHAT A WHEEL EVENT MEANS OVER THE NOTES CANVAS (NEW-1, owner 2026-09-29, verbatim: *"mouse
 *  scroll up or down should correspond to zoom like it does on the site plan view but for the
 *  notebook module"*).
 *
 *  THE SITE PLAN'S RULE, which this matches rather than reinvents (`SitePlanner.jsx`'s `onWheel`):
 *  a PLAIN wheel zooms about the cursor, wheel up = in, wheel down = out, no modifier needed, and a
 *  scrollable overlay panel (`[data-wheelscroll]`) is exempt and scrolls itself. The feel differs in
 *  one respect on purpose: the site plan takes ×1.12 per notch, Notes keeps its existing
 *  proportional curve (`zoomForWheel`, e^(−Δ/400)) — a mouse detent (Δ≈100) is ×1.28, a trackpad's
 *  small deltas stay continuous — so Ctrl+wheel, pinch and plain wheel are ONE curve, not two.
 *
 *  Because a plain wheel no longer scrolls, moving around a long note needs an explicit way:
 *   · Shift+wheel PANS — vertically for an ordinary wheel (macOS reports Shift+wheel as deltaX with
 *     deltaY 0, so the non-zero one is taken), the site plan has no such modifier so this is added;
 *   · a wheel event that is mostly SIDEWAYS (a trackpad's horizontal swipe, a tilt wheel) pans
 *     horizontally — nobody swiping sideways means "zoom";
 *   · drag/middle-drag/space-drag, the scrollbar-free keys and the pill are unchanged.
 *  Ctrl/⌘+wheel and a trackpad pinch (which arrives as Ctrl+wheel) still zoom exactly as before.
 *
 *  `ownsWheel` is the caller's DOM answer to "is the pointer over something that scrolls itself in
 *  the direction this event would scroll" (a wide table, a code block, an open menu list). It wins
 *  over everything except Ctrl/⌘, which is a zoom request and whose browser default (page zoom) is
 *  suppressed regardless.
 *
 *  @returns {{kind:"zoom", deltaY:number}|{kind:"pan", dx:number, dy:number}|{kind:"native"}}
 */
export function wheelIntent({ deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false, metaKey = false,
  shiftKey = false, ownsWheel = false } = {}) {
  if (ctrlKey || metaKey) return { kind: "zoom", deltaY };
  if (ownsWheel) return { kind: "native" };
  /* A line/page delta is a different unit; normalise before spending it as pixels. */
  const k = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  if (shiftKey) return { kind: "pan", dx: 0, dy: (deltaY || deltaX) * k };
  if (Math.abs(deltaX) > Math.abs(deltaY)) return { kind: "pan", dx: deltaX * k, dy: 0 };
  return { kind: "zoom", deltaY };
}

/** Which axis the browser would scroll a scrollable element on for this event — what the caller
 *  asks the DOM about. Shift+wheel is horizontal natively; otherwise the dominant delta wins. */
export function wheelNativeAxis({ deltaX = 0, deltaY = 0, shiftKey = false } = {}) {
  if (shiftKey) return "x";
  return Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
}

/** The next rung up or down. Snaps onto the ladder from anywhere, so a level reached by a wheel
 *  (which lands between rungs) still steps to a recognisable number. */
export function stepZoom(current, direction) {
  const z = clampViewZoom(current);
  if (direction > 0) return VIEW_ZOOM_STEPS.find((s) => s > z + 1e-6) ?? VIEW_ZOOM_MAX;
  return [...VIEW_ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? VIEW_ZOOM_MIN;
}

/** What a keystroke means, or `null` when it is not one of ours and must be left alone.
 *  ⛔ Ctrl+0 RETURNS TO 100%, NOT TO "WHERE YOU STARTED" — reset means one known place, the same
 *  one every time, in every application anybody has ever used. Ctrl+9 fits the page, which is the
 *  other thing a drawing tool always has. */
export function zoomKeyIntent({ key, ctrlKey, metaKey, altKey } = {}) {
  if (!(ctrlKey || metaKey) || altKey) return null;
  if (key === "0") return { kind: "reset" };
  if (key === "9") return { kind: "fit" };
  if (key === "=" || key === "+" || key === "Add") return { kind: "step", direction: +1 };
  if (key === "-" || key === "_" || key === "Subtract") return { kind: "step", direction: -1 };
  return null;
}

/** Pan by a pointer delta. UNBOUNDED in both axes — that is the feature, and it is the single
 *  difference from the scroller this replaces. Dragging the canvas right moves the view left, so
 *  the content tracks the hand one-to-one. */
export function panBy(view, { dx = 0, dy = 0 } = {}) {
  const v = normalizeView(view);
  return { x: v.x - num(dx), y: v.y - num(dy), z: v.z };
}

/** ⛔ THE FRAMING THAT PUTS A PAGE ON SCREEN AT A GIVEN ZOOM. Used for the first open (at 100%),
 *  for Ctrl+0, and as the shared half of `fitView` — so "reset" and "fit" can never disagree
 *  about where the middle of the viewport is.
 *
 *  The page is placed with its TOP edge a margin below the viewport's top rather than centred
 *  vertically: a document is read from the top, and centring a page taller than the viewport
 *  would open it showing the middle of it. Horizontally it is centred, which is where a page
 *  belongs on a wide screen. */
export function frameView({ viewport, page, zoom = VIEW_ZOOM_DEFAULT, align = "center" }) {
  const z = clampViewZoom(zoom);
  const vw = Math.max(1, num(viewport?.width));
  const vh = Math.max(1, num(viewport?.height));
  const px = num(page?.x);
  const py = num(page?.y);
  const pw = Math.max(1, num(page?.width));
  const ph = Math.max(1, num(page?.height));
  const margin = Math.round(Math.min(vw, vh) * FIT_MARGIN_FRACTION);
  /* ⛔ THE MARGIN IS AN IDEAL, NOT A FLOOR, AND THE DIFFERENCE IS A MEASURED DEFECT. Written as
   * `Math.max(margin, slack / 2)` it forced a gap the viewport did not have: a 1216px page in a
   * 1232px pane has 16px of slack, so a 33px margin pushed the page 17px off the right-hand edge —
   * a page framed by "fit it on screen" that did not fit on screen. When there is room to spare
   * the page is centred (which is at least the margin wide on each side by construction); when
   * there is not, the margin is simply what is available. It only becomes a real offset again
   * once the page is genuinely WIDER than the viewport, where there is no centring to do and the
   * right answer is to start a little in from the edge. */
  const slackX = vw - pw * z;
  const slackY = vh - ph * z;
  const x = px * z - (slackX >= 0 ? slackX / 2 : margin);
  /* Vertically a page taller than the viewport is anchored near its TOP rather than centred: a
   * document is read from the top, and centring a long page would open it showing its middle. */
  /* ⛔ `align: "top"` IS THE OPENING FRAMING (NEW-4, iPhone review 2026-09-29: pages opened with the
   * sheet's top HALFWAY down the canvas — 253 px on a 1280x800 window, 330 px on a 390x664 phone). The
   * first layout pass measures the sheet SHORT (213 px; the full-height pin lands ~140 ms later), and
   * centring a short page vertically puts it mid-screen against a number that is about to change —
   * and if two passes agree on the short height before the pin lands, the framing latches there for
   * good. Anchoring the TOP near the top is independent of the page's eventual height: it can grow
   * downward all it likes and the top edge is already where a document is read from. `"center"`
   * stays the default because "Fit" genuinely wants the whole page centred. */
  const y = align === "top" ? py * z - margin : py * z - (slackY >= margin * 2 ? slackY / 2 : margin);
  return { x, y, z };
}

/** ⛔ ZOOM TO FIT THE WHOLE PAGE. Picks the larger zoom that still shows the page's full width
 *  AND full height inside the viewport, then frames it with `frameView` so the result agrees with
 *  every other framing in this module. A page that is already small enough is NOT blown up past
 *  100% — "fit" means "show me all of it", not "fill the glass", and magnifying a short note to
 *  400% because it happens to be short is not what anybody means by the button. */
export function fitView({ viewport, page }) {
  const vw = Math.max(1, num(viewport?.width));
  const vh = Math.max(1, num(viewport?.height));
  const pw = Math.max(1, num(page?.width));
  const ph = Math.max(1, num(page?.height));
  const margin = Math.round(Math.min(vw, vh) * FIT_MARGIN_FRACTION);
  const z = clampViewZoom(Math.min(
    (vw - margin * 2) / pw,
    (vh - margin * 2) / ph,
    VIEW_ZOOM_DEFAULT,
  ));
  return frameView({ viewport, page, zoom: z });
}

/** "125%" — how the level is said out loud, once, so the control and any test agree. */
export const zoomLabel = (z) => `${Math.round(clampViewZoom(z) * 100)}%`;

/* ---- WHERE THE VIEW LIVES -----------------------------------------------------------------
 *
 * ⛔ PER PAGE, NOT PER APP — and that is a change from the level this replaces, which was one
 * number for the whole workspace. On a canvas you can pan, the view is a place you left off in
 * a particular document: coming back to a page you were reading zoomed in at its bottom-right
 * corner and being dropped at the top-left of a different page's framing is the wrong answer.
 * Scoped like every other notes key so two accounts on one machine do not inherit each other's.
 */
export const VIEW_KEY_BASE = "planyr:notes:view:v1";
export const viewKey = (scope, pageId) => `${VIEW_KEY_BASE}:${scope || "local"}:${pageId || "none"}`;

/** Serialise for storage — rounded, because a stored view is a place, not a measurement, and
 *  sub-pixel residue in a persisted number is noise that makes two saves differ for nothing. */
export function serializeView(view) {
  const v = normalizeView(view);
  return { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z * 1000) / 1000 };
}

/** Read one back, refusing anything that is not a real view. Returns `null` when there is
 *  nothing usable stored, so the caller can tell "never opened" from "opened at the identity
 *  view" — the first wants a fresh framing, the second does not. */
export function parseView(raw) {
  if (raw == null) return null;
  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  if (!Number.isFinite(num(obj.x, NaN)) || !Number.isFinite(num(obj.y, NaN))) return null;
  return normalizeView(obj);
}

<<<<<<< HEAD
/* ---- touch: one-finger pan, pinch-with-midpoint, light inertia (NEW-2) ---------------------
 *
 * The mat is `touch-action: none`, so a finger drag produces pointer events and NOTHING ELSE: no
 * native scroll and — the part that made the page feel dead — no compat mouse events either, which
 * is the only path the blank-paper pan (`beginBlankGesture`) ever listened on. These are the pure
 * decisions behind the pointer-driven replacement; the wiring is `NoteEditor.jsx`'s touch effect.
 * Everything here is in VIEWPORT-relative pixels and goes through the one view ref. */

/** A fingertip is not a mouse pointer: a tap wobbles by several pixels, so the distance before a
 *  touch becomes a pan is ~2.5x the mouse's 4. Below it the gesture is still a tap. */
export const TOUCH_PAN_SLOP = 10;

/** Has a touch travelled far enough to stop being a tap? */
export function touchTravelled(from, at, slop = TOUCH_PAN_SLOP) {
  return Math.hypot(num(at?.x) - num(from?.x), num(at?.y) - num(from?.y)) > slop;
}

/** The view a one-finger drag asks for: the content follows the finger one-to-one. */
export function panView(startView, from, at) {
  const v = normalizeView(startView);
  return { x: v.x - (num(at?.x) - num(from?.x)), y: v.y - (num(at?.y) - num(from?.y)), z: v.z };
}

/** Pinch that ZOOMS and PANS: the workspace point that was under the fingers' starting midpoint
 *  stays under their CURRENT midpoint, at the zoom the spread asks for. (The old handler zoomed
 *  about the current midpoint only, so the page never followed a two-finger drag.) */
export function pinchView(start, now) {
  const v = normalizeView(start?.view);
  const ratio = num(start?.dist) > 0 ? num(now?.dist) / num(start.dist) : 1;
  const z = clampViewZoom(v.z * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
  const w = toWorkspace(v, start?.mid || { x: 0, y: 0 });
  return { x: w.x * z - num(now?.mid?.x), y: w.y * z - num(now?.mid?.y), z };
}

/** Release velocity in px per 16 ms frame, from the last ~100 ms of `{ t, x, y }` samples.
 *  Zero when the finger stopped before lifting — a held finger must not fling. */
export function releaseVelocity(samples, now, windowMs = 100) {
  const recent = (samples || []).filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return { x: 0, y: 0 };
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = b.t - a.t;
  if (dt <= 0 || now - b.t > 50) return { x: 0, y: 0 };
  return { x: ((b.x - a.x) / dt) * 16, y: ((b.y - a.y) / dt) * 16 };
}

/** One frame of inertia: the content keeps going in the direction the finger was moving. `delta`
 *  is how far the CONTENT moves this frame; `done` when it has slowed to nothing. */
export function inertiaStep(vel, { friction = 0.92, floor = 0.4 } = {}) {
  const speed = Math.hypot(num(vel?.x), num(vel?.y));
  if (speed < floor) return { delta: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, done: true };
  return { delta: { x: vel.x, y: vel.y }, vel: { x: vel.x * friction, y: vel.y * friction }, done: false };
=======
/* ---- THE OPENING ZOOM (NEW-4) --------------------------------------------------------------
 *
 * Desktop opens at 100%. A PHONE opens at FIT WIDTH — the whole page width on screen, both edges
 * (the old 100% framing counted the 8 px outside margin and the 8 px view offset on the LEFT only,
 * so a page as wide as the screen had its right edge and rounded corner clipped). Fit width never
 * magnifies past `PHONE_OPEN_ZOOM_MAX`: a page narrower than the screen (a pinned narrow page) is
 * shown a little larger, which is what makes the 11 px body text readable without ever changing the
 * stored font size; a page wider than the screen is shrunk until it fits. */
export const PHONE_VIEWPORT_MAX = 640;
export const PHONE_PAGE_GUTTER = 8;
export const PHONE_OPEN_ZOOM_MAX = 1.25;

export function openingZoom({ viewport, page } = {}) {
  const vw = Math.max(1, num(viewport?.width));
  if (vw > PHONE_VIEWPORT_MAX) return VIEW_ZOOM_DEFAULT;
  const pw = Math.max(1, num(page?.width));
  return clampViewZoom(Math.min((vw - PHONE_PAGE_GUTTER * 2) / pw, PHONE_OPEN_ZOOM_MAX));
>>>>>>> origin/main
}
