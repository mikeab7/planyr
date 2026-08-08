/* Reading the SCENE off the DOM, shared by the two client performance instruments (NEW-1).
 *
 * Lifted out of `perfInstrument.js` unchanged so the always-on RECORDER can use it without
 * dragging the sampled instrument in behind it — perfInstrument enrols a quarter of page loads
 * and the recorder enrols all of them, so a static edge between them would download the sampled
 * one to every tab and quietly retire its own enrolment gate.
 *
 * DELIBERATELY read off the DOM rather than plumbed through from SitePlanner's state. Threading
 * six counters out of a 23,000-line component would mean six new props, six new subscriptions,
 * and a standing invitation for the instrument to hold a reference to the model — which is
 * exactly the class of bug it exists to find. The DOM already knows all of it, the selectors are
 * the ones the e2e harnesses use, and the whole read happens on a timer measured in seconds.
 *
 * Pure-ish (it takes a document) so the counting rules are unit-tested against a fixture rather
 * than only observed in a browser.
 */
export function readScene(doc) {
  const out = {};
  try {
    if (!doc) return out;
    const svg = doc.querySelector('[data-testid="planner-canvas"]');
    out.documentNodes = doc.getElementsByTagName("*").length;
    if (svg) {
      out.canvasNodes = svg.getElementsByTagName("*").length;
      out.elementsDrawn = svg.querySelectorAll("[data-el-id]").length;
    }
    out.tiles = doc.querySelectorAll("img.leaflet-tile").length;
    /* EXACT ids only. A `^=` prefix match counts a floating panel's chrome bar and its two icon
     * buttons as three more panels — measured, and it read 13 panels open for 4. */
    out.panelsOpen = (doc.querySelector('[data-testid="left-menu-panel"]') ? 1 : 0)
      + [...doc.querySelectorAll("[data-testid]")].filter((n) => /^floating-panel-[a-z]+$/.test(n.getAttribute("data-testid"))).length;
    out.layersOn = doc.querySelectorAll(".leaflet-layer").length;
  } catch (_) { /* a telemetry read must never break a render */ }
  return out;
}
