/* Site Analysis — hover / open a verdict row to HIGHLIGHT its layer (NEW-1, 2026-10-05). Pure.
 *
 * Replaces every old "Activate layer" chip. The planner draws from a DERIVED copy of the overlay state
 * (`focusOverlays`) and the REAL state is never touched — so a hover can't be saved into the plan's layer
 * overrides, can't push an undo frame, and can't leave a layer switched on behind the user. Focus shows the
 * row's layer at full strength (even if it was off) and dims every other layer that is on.
 */
export const FOCUS_DIM = 0.25; // what a non-focused layer's opacity is multiplied by while a row is focused

/* `overlays`: { [layerId]: { on, opacity, … } }; `focus`: a layer id | null; `registry`: ALL_LAYERS (for each
 * layer's default opacity). Returns `overlays` ITSELF when there is nothing to do, so the identity-keyed
 * overlay sync effect doesn't re-run for no reason. */
export function focusOverlays(overlays, focus, registry = {}) {
  if (!focus || !registry[focus]) return overlays;
  const out = {};
  for (const [id, o] of Object.entries(overlays || {})) {
    if (id === focus) continue;
    out[id] = o && o.on ? { ...o, opacity: (o.opacity ?? registry[id]?.opacity ?? 0.7) * FOCUS_DIM } : o;
  }
  const cur = (overlays || {})[focus] || {};
  out[focus] = { ...cur, on: true, opacity: 1 };
  return out;
}
