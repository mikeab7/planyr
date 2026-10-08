/* NEW-1 — "layer hidden at this zoom" toast: the PURE crossing logic.
 *
 * A layer that is turned ON but cannot draw at the current zoom reads as broken (owner: turn on
 * Topo zoomed out and nothing happens, no explanation). The Layers panel row already says so
 * (layerZoomGate.js); this is the transient, on-the-map companion — one toast per CROSSING.
 *
 * ⛔ Found generically from the layer config (`layerMinZoom` + an optional `cfg.maxZoom`), never as
 * a topo special case. A layer with no gate (FEMA raster etc.) can never appear here.
 *
 * THE RULE, as a function of two inputs only — the set of layer ids already ANNOUNCED as hidden
 * (`announced`) and what is hidden NOW:
 *   • a layer newly hidden (on turn-on while out of range, on initial load out of range, or on an
 *     in→out crossing) fires ONE combined toast naming every layer hidden right now;
 *   • while it stays hidden nothing fires again (it is in `announced`);
 *   • it leaves `announced` the moment it draws again or is turned off, which re-arms it.
 * No timers, no clocks, no view terms beyond the zoom number — the caller debounces gestures.
 *
 * Imports exactly one leaf (layerZoomGate.js) — boot-bundle discipline (B1095).
 */
import { layerMinZoom, GATE_CLEARANCE } from "./layerZoomGate.js";

/* The highest zoom at which a layer still paints, or null. No registry row declares one today
 * (every gate in this app is "appear once you zoom IN"); the pattern is wired so the first one that
 * does gets the "Zoom out" toast for free. */
export function layerMaxZoom(cfg) {
  return cfg && typeof cfg.maxZoom === "number" ? cfg.maxZoom : null;
}

/* Why (if at all) this layer is not drawing at `zoom`. `below` = zoomed out past its minimum
 * (fix: zoom in); `above` = zoomed in past its maximum (fix: zoom out). `target` is the zoom a
 * fix should land on, a hair inside the range (GATE_CLEARANCE — the gates are strict). */
export function hiddenAtZoom(cfg, zoom) {
  if (!cfg || typeof zoom !== "number" || !isFinite(zoom)) return null;
  const min = layerMinZoom(cfg);
  if (typeof min === "number" && zoom < min) return { side: "below", target: min + GATE_CLEARANCE };
  const max = layerMaxZoom(cfg);
  if (typeof max === "number" && zoom > max) return { side: "above", target: max - GATE_CLEARANCE };
  return null;
}

/* `layers` = [{ id, cfg, on }]. Returns what is hidden now, in input order. */
export function hiddenNow(layers, zoom) {
  const out = [];
  for (const l of layers || []) {
    if (!l || !l.on) continue;
    const h = hiddenAtZoom(l.cfg, zoom);
    if (h) out.push({ id: l.id, label: (l.cfg && l.cfg.label) || l.id, ...h });
  }
  return out;
}

/* "A is hidden at this zoom" / "A and B are …" / "A, B and C are …". Developer vocabulary, no
 * explanation of what the layer is. Duplicate labels (merge-group members) collapse to one. */
export function hiddenMessage(labels) {
  const l = [...new Set(labels)];
  if (!l.length) return "";
  if (l.length === 1) return `${l[0]} is hidden at this zoom`;
  return `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]} are hidden at this zoom`;
}

/* The one decision. `announced` is a Set of ids (or null on first call = nothing announced yet, so
 * a layer already on and out of range at load fires). Returns the next announced set and, when
 * something is newly hidden, the toast to show.
 *
 * Toast action: all hidden below range → "Zoom in" to the zoom where EVERY one draws (the highest
 * minimum); all above → "Zoom out" to the lowest maximum. A mix has no single zoom that fixes it,
 * so it carries no action rather than a wrong one. */
export function nextHiddenToast(announced, layers, zoom) {
  const hidden = hiddenNow(layers, zoom);
  const nowIds = new Set(hidden.map((h) => h.id));
  const prev = announced || new Set();
  const next = new Set();
  for (const id of nowIds) next.add(id); // anything gone from `nowIds` is re-armed by omission
  const fresh = hidden.some((h) => !prev.has(h.id));
  if (!fresh) return { announced: next, toast: null };
  const below = hidden.filter((h) => h.side === "below");
  const above = hidden.filter((h) => h.side === "above");
  let action = null;
  if (below.length && !above.length) action = { label: "Zoom in", target: Math.max(...below.map((h) => h.target)) };
  else if (above.length && !below.length) action = { label: "Zoom out", target: Math.min(...above.map((h) => h.target)) };
  return {
    announced: next,
    toast: { text: hiddenMessage(hidden.map((h) => h.label)), action, ids: [...nowIds] },
  };
}
