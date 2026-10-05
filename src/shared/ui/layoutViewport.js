/* layoutViewport — the height of the LAYOUT viewport (the box `position: fixed` resolves against),
 * measured, never assumed.
 *
 * ⛔ Never read it from `window.innerHeight` alone (B2046224 ×2/×3). On iOS WebKit innerHeight is the
 * UNOBSCURED rect and can shrink with the keyboard — and production telemetry from the owner's own
 * iPhone (iOS 18.7, client_errors 2026-10-04 21:12 UTC, #/food) shows it does NOT always: there,
 * innerHeight stood more than 120 above visualViewport.height with the keyboard up. A number that
 * moves either way cannot be the layout height. A zero-cost hidden `position:fixed; top:0; bottom:0`
 * probe IS the fixed containing block, so its own height is the answer; innerHeight is only the
 * fallback where there is no DOM (tests, SSR). */
let probe = null;
export function layoutViewportHeight(win = typeof window !== "undefined" ? window : null) {
  const doc = win?.document;
  if (!doc?.body || typeof doc.createElement !== "function") return win?.innerHeight ?? 0;
  if (!probe || !probe.isConnected || probe.ownerDocument !== doc) {
    probe = doc.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.dataset.layoutViewportProbe = "";
    probe.style.cssText = "position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none;";
    doc.body.appendChild(probe);
  }
  return probe.offsetHeight || win.innerHeight || 0;
}
