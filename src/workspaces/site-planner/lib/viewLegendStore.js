/* A tiny store for LEGENDS THAT DEPEND ON THE VIEW (B2507063): the Zoning dropdown lists the zone codes visible right now, which only the layer knows.
 * The layer publishes `{ [layerId]: [{ label, color }] }` here on load / pan / zoom; the Layers panel subscribes (useSyncExternalStore). The snapshot object is
 * replaced only when an entry actually changes, so a pan that shows the same zones re-renders nothing. */
import { useSyncExternalStore } from "react";

let snap = {};
const subs = new Set();
const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x.label === b[i].label && x.color === b[i].color));

export function setViewLegend(id, entries) {
  const next = Array.isArray(entries) ? entries : [];
  if (same(snap[id], next) || (snap[id] === undefined && next.length === 0)) return;
  snap = { ...snap, [id]: next };
  subs.forEach((f) => { try { f(); } catch (_) { /* a bad subscriber never blocks the rest */ } });
}
export const clearViewLegend = (id) => setViewLegend(id, []);
export const getViewLegends = () => snap;
export const subscribeViewLegends = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export const useViewLegends = () => useSyncExternalStore(subscribeViewLegends, getViewLegends, getViewLegends);
export const _resetViewLegends = () => { snap = {}; };
