/* The canvas clipboard's HOLDER — deliberately ABOVE every React remount boundary (NEW-1).
 *
 * WHY THIS MODULE EXISTS. `planClipboard.js` already covers every drawn kind (`CLIP_KINDS` =
 * el · markup · measure · callout · parcel), mixed multi-selections, bonded assemblies and
 * relative geometry. None of that was the bug the owner hit: he could not copy a polygon from
 * one plan of a site to another. The payload lived in `const clip = useRef(null)` INSIDE
 * `SitePlanner`, and `SitePlannerApp` mounts that component with
 * `key={`${activeSiteId}:${loadEpoch}`}` — every plan of a site is its own record with its own
 * id, so switching plans changes the key, React REMOUNTS `SitePlanner`, and the ref (and with
 * it the copy) is destroyed. `overlayClip` died the same way, and so did every other per-mount
 * ref, which is why the same copy also could not survive a `loadEpoch` bump.
 *
 * So the fix is about LIFETIME, not coverage. The payload now lives here, at module scope:
 *   · module scope is above EVERY remount boundary in the app at once — the plan-switch key,
 *     the `loadEpoch` bump, a workspace switch, a project switch, an error-boundary reset —
 *     rather than above the one we happened to find. Hoisting into `SitePlannerApp` state
 *     would have fixed the plan switch and left the others to be rediscovered one at a time.
 *   · reads are plain function calls with NO subscription, exactly like the `useRef` reads they
 *     replace, so nothing about React's render behaviour changes (the context menu reads the
 *     clipboard while rendering, as it always did).
 *   · lifetime is the browser TAB (a page reload starts empty). That is deliberate: the payload
 *     holds live geometry, not a serialisable document, and persisting it would mean carrying a
 *     stale snapshot of elements that may since have been edited or deleted.
 *
 * WHAT A PAYLOAD CARRIES BEYOND THE ITEMS. `siteId` (which plan it was copied FROM, so a paste
 * knows whether it is crossing a plan boundary) and `origin` (that plan's map anchor, so the
 * paste can re-project — see `resolveClipFrame` in planClipboard.js). Both are needed at PASTE
 * time and are unknowable then, because the source plan is no longer mounted.
 *
 * Pure: no React, no DOM. Unit tests: test/planClipboardStore.test.js.
 */

// Two independent slots, mirroring the two Ctrl+V paths the planner has always had: drawn
// objects (planClipboard) and an imported reference drawing (the B461 overlay copy). They are
// kept side by side HERE rather than in two modules so the next person to touch one sees the
// other — the two paths diverging is exactly how a fix to one of them gets lost.
let canvasClip = null;   // { items, counts, siteId, origin } | null
let overlayClip = null;  // { overlay, siteId, origin } | null

/** The drawn-object clipboard. `null` clears it. */
export function setCanvasClip(payload) {
  canvasClip = payload && payload.items && payload.items.length ? payload : null;
  return canvasClip;
}
export const getCanvasClip = () => canvasClip;
export const hasCanvasClip = () => !!(canvasClip && canvasClip.items && canvasClip.items.length);

/** The imported-reference (site-plan overlay) clipboard. `null` clears it. */
export function setOverlayClip(payload) {
  overlayClip = payload && payload.overlay ? payload : null;
  return overlayClip;
}
export const getOverlayClip = () => overlayClip;
export const hasOverlayClip = () => !!(overlayClip && overlayClip.overlay);

/** Anything at all to paste — what the context menu's Paste row is enabled on. */
export const hasAnyClip = () => hasCanvasClip() || hasOverlayClip();

/** Test/teardown only. Never call this from a UI path: a copy outliving a plan switch IS the feature. */
export function clearClipboard() {
  canvasClip = null;
  overlayClip = null;
}
