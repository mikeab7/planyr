/* flatLabel — a map LABEL must not be its own compositor layer (NEW-1, 2026-10-30, owner: "panning is jumpy with the water and sewer layers on").
 *
 * WHY. A permanent Leaflet tooltip positions itself with `translate3d(x, y, 0)` (Leaflet's `DomUtil.setPosition` under `Browser.any3d`). Chrome gives every element with
 * a 3D transform its OWN compositor layer. A dense utility layer prints a pipe size on every segment — measured live on planyr.io, Olive Branch at site-planning zoom, with
 * Water & Sewer on: 511 label tooltips = 511 compositor layers (84 layers with the layers off → 598 on), and a click-drag pan on that page stalled the main thread for
 * 100–137 ms against 33–65 ms with the layers off; hiding only the label panes brought the stall back to the baseline (ui-audit/measure-layer-pan-frames.mjs).
 * A 2D `translate(x, y)` puts the same pixel in the same place and promotes nothing: all the labels are painted into the one layer that holds the tooltip pane.
 *
 * HOW. Leaflet calls `Tooltip#_setPosition(pos)` on add, on every move of its anchor and on every zoom step, and it writes the 3D transform inside it. Rather than reach
 * into Leaflet's module-private `DomUtil` (the ESM build inlines it, so replacing `L.DomUtil.setPosition` would change nothing) we wrap the INSTANCE's `_setPosition` and
 * overwrite the one style property afterwards, from the position Leaflet itself recorded on the element (`_leaflet_pos`, which `L.DomUtil.getPosition` reads too).
 * Two style writes in one task before any style recalc cost nothing; no layout is read. Duck-typed on purpose: it is tested without a DOM or Leaflet. */

export const flatTransform = (pos) => `translate(${pos.x}px, ${pos.y}px)`;

/** Make one Leaflet tooltip position with a 2D transform from now on (and rewrite the transform it already has). Idempotent; a missing tooltip is a no-op. */
export function flattenTooltip(tip) {
  if (!tip || tip.__pfFlat || typeof tip._setPosition !== "function") return tip;
  const orig = tip._setPosition;
  const apply = () => {
    const el = tip._container, p = el && el._leaflet_pos;
    if (el && el.style && p && Number.isFinite(p.x) && Number.isFinite(p.y)) el.style.transform = flatTransform(p);
  };
  tip._setPosition = function (pos) { const r = orig.call(this, pos); apply(); return r; };
  tip.__pfFlat = true;
  apply();
  return tip;
}
