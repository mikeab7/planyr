/* cursors — the ONE home for the app's cursor vocabulary (owner convention 2026-10-20, docs/DESIGN.md
 * "Cursor convention"). Two exports other surfaces share:
 *   ROTATE_CURSOR  — the single custom rotate cursor every rotate grip uses (an SVG data-URI with a
 *                    `grab` fallback so a browser that rejects the URI still shows a hand).
 *   pinDragCursor  — pins a cursor at the document root for the LIFE of a drag, so the cursor does not
 *                    flip back to whatever the pointer happens to be over once it leaves the grip.
 *                    Cleared on every exit path: pointerup, pointercancel, Escape, window blur.
 */

const ROTATE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M19 12a7 7 0 1 1-2.05-4.95' stroke='white' stroke-width='4'/><path d='M19 4v4h-4' stroke='white' stroke-width='4'/>" +
  "<path d='M19 12a7 7 0 1 1-2.05-4.95' stroke='black' stroke-width='2'/><path d='M19 4v4h-4' stroke='black' stroke-width='2'/>" +
  "</g></svg>";

export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 12 12, grab`;

let pinned = null; // { el, release }

/** Pin `cursor` over the whole page until the returned release() runs (idempotent). A second call
 *  while one is live replaces it. Safe to call outside a browser (returns a no-op). */
export function pinDragCursor(cursor) {
  if (typeof document === "undefined") return () => {};
  if (pinned) pinned.release();
  const el = document.createElement("style");
  el.setAttribute("data-pinned-cursor", cursor);
  el.textContent = `html, html * { cursor: ${cursor} !important; }`;
  document.head.appendChild(el);
  const done = (e) => { if (e && e.type === "keydown" && e.key !== "Escape") return; release(); };
  const release = () => {
    if (!pinned || pinned.el !== el) return;
    pinned = null;
    el.remove();
    window.removeEventListener("pointerup", done, true);
    window.removeEventListener("pointercancel", done, true);
    window.removeEventListener("keydown", done, true);
    window.removeEventListener("blur", done);
  };
  pinned = { el, release };
  window.addEventListener("pointerup", done, true);
  window.addEventListener("pointercancel", done, true);
  window.addEventListener("keydown", done, true);
  window.addEventListener("blur", done);
  return release;
}
