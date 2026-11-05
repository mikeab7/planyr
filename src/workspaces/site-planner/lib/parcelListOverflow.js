/* parcelListOverflow.js — READ-ONLY: what, if anything, makes the Parcels panel's scrolling body wider than its box.
 *
 * WHY (B2243424 ×3/×4): the owner's real-data check read the panel body at scrollWidth 403 vs clientWidth 400 on two
 * successive builds, and no fixture, panel width, scrollbar mode or pixel ratio in the repo's rig reproduces it. An owner-reported
 * symptom is never closed on a null (STANDING RULE #2), so the app can name the culprit on HIS machine: armed with
 * `?planyrDiag=1`, `window.__parcelListOverflow()` returns the scroller, its two widths and every descendant whose right edge
 * passes the scroller's, by name and overshoot. Writes nothing; changes no behaviour.
 */
const label = (e) => `${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? `[${e.getAttribute("data-testid")}]` : ""}${typeof e.className === "string" && e.className ? "." + e.className.split(/\s+/)[0] : ""}`;

export function scrollerOf(el) {
  let n = el && el.parentElement;
  while (n && !/(auto|scroll)/.test(getComputedStyle(n).overflowX + getComputedStyle(n).overflowY)) n = n.parentElement;
  return n || (el && el.ownerDocument.scrollingElement) || null;
}

export function measureListOverflow(panel) {
  if (!panel) return null;
  const body = scrollerOf(panel);
  if (!body) return null;
  const lim = body.getBoundingClientRect().left + body.clientLeft + body.clientWidth;
  const offenders = [...body.querySelectorAll("*")]
    .filter((e) => getComputedStyle(e).position !== "fixed" && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > lim + 0.5)
    .map((e) => ({ el: label(e), over: +(e.getBoundingClientRect().right - lim).toFixed(2), width: +e.getBoundingClientRect().width.toFixed(2), parent: e.parentElement ? label(e.parentElement) : null }))
    .slice(0, 12);
  return { scroller: label(body), scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, dpr: window.devicePixelRatio, offenders };
}
