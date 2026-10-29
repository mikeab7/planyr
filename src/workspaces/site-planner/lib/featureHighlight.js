/* THE ONE CLICK HIGHLIGHT (B2507061 amendment, owner 2026-10-29: "Each hovered polygon gets a red outline that never clears … Expected: hovering does nothing at all").
 *
 * Hovering highlights NOTHING, on any layer. A feature is outlined only when it is CLICKED, only ONE feature at a time across every layer and both surfaces, and the
 * outline clears when another feature is clicked, the card is closed, or the user clicks empty map. This module owns that rule: a `token` is one feature's outline
 * (`on` applies it, `off` restores the exact style the feature had before), and `setHighlight` is the only way to turn one on — it turns the previous one OFF first, so
 * two outlines can never coexist. Pure of React; it only calls `setStyle` on the Leaflet path it is handed. */
import { CLICK_HIGHLIGHT_COLOR, CLICK_HIGHLIGHT_WEIGHT } from "./boundaryStyle.js";

let current = null;

const STYLE_KEYS = ["color", "weight", "opacity", "fillColor", "fillOpacity", "dashArray", "lineCap", "lineJoin"];

/* A token for one Leaflet path/marker (`child`). The prior style is captured when `on` runs, so `off` puts back exactly what was there (not a guessed default — the
 * bug this replaces restored a hard-coded red). Returns null for anything that cannot be styled. */
export function makeHighlight(child) {
  if (!child || typeof child.setStyle !== "function") return null;
  let before = null, active = false;
  return {
    child,
    get active() { return active; },
    on() {
      if (active) return;
      const o = child.options || {};
      before = {};
      for (const k of STYLE_KEYS) if (k in o) before[k] = o[k];
      active = true;
      try { child.setStyle({ color: CLICK_HIGHLIGHT_COLOR, weight: Math.max(CLICK_HIGHLIGHT_WEIGHT, (o.weight || 0) + 1.5), opacity: 1, dashArray: null }); } catch (_) { /* a gone layer */ }
      try { if (child.bringToFront) child.bringToFront(); } catch (_) { /* not on a map */ }
    },
    off() {
      if (!active) return;
      active = false;
      try { child.setStyle(before || {}); } catch (_) { /* a gone layer */ }
      before = null;
    },
  };
}

/* Turn `token` on and every other highlight off. At most one token is ever active. */
export function setHighlight(token) {
  if (current && current !== token) { try { current.off(); } catch (_) { /* already gone */ } }
  current = token || null;
  if (token) token.on();
}

/* Turn `token` off (a card closed). A no-op when a newer highlight has already replaced it. */
export function releaseHighlight(token) {
  if (!token) return;
  try { token.off(); } catch (_) { /* already gone */ }
  if (current === token) current = null;
}

export const clearHighlight = () => releaseHighlight(current);
export const highlightedCount = () => (current && current.active ? 1 : 0);

/* The Leaflet child of `group` (an esri featureLayer or a geoJSON / layerGroup) that draws `feature`, by identity. */
export function childFor(group, feature) {
  if (!group || !feature) return null;
  let found = null;
  const visit = (l) => { if (!found && l && l.feature === feature) found = l; };
  try {
    if (typeof group.eachFeature === "function") group.eachFeature(visit);
    else if (typeof group.eachLayer === "function") group.eachLayer(visit);
  } catch (_) { /* a layer mid-rebuild */ }
  return found;
}

export const _resetHighlightForTests = () => { current = null; };
