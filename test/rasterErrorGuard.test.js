import { describe, it, expect } from "vitest";
import { guardRasterErrors, guardRasterOpacity } from "../src/workspaces/site-planner/lib/parcelOpacityGuard.js";

/* NEW-1 (2026-11-12) — "Cannot read properties of null (reading 'removeLayer')" after a raster layer's image fails.
 *
 * The fakes below are a faithful miniature of what matters: a Leaflet-style Evented (on / off(type) / off(type, fn) / fire,
 * listeners called with `ctx`), a map that fires `layeradd`, and a `_renderImage` that is esri-leaflet 3.0.19's
 * RasterLayer._renderImage reduced to its listener wiring — INCLUDING the unguarded `this._map.removeLayer(image)` in its error
 * handler, the line the real one throws on. The real thing is driven in a browser by e2e/raster-error-after-off. */
class Evented {
  constructor() { this._ev = {}; }
  on(t, fn, ctx) { (this._ev[t] ||= []).push({ fn, ctx }); return this; }
  once(t, fn, ctx) { const h = (e) => { this.off(t, fn, ctx); this.off(t, h); fn.call(ctx, e); }; return this.on(t, h); }
  off(t, fn, ctx) {
    if (!this._ev[t]) return this;
    this._ev[t] = fn ? this._ev[t].filter((l) => !(l.fn === fn && l.ctx === ctx)) : [];
    return this;
  }
  fire(t, data) { (this._ev[t] || []).slice().forEach((l) => l.fn.call(l.ctx || this, { type: t, target: this, ...data })); return this; }
}
const makeMap = () => {
  const m = new Evented(); m.layers = new Set();
  m.addLayer = (l) => { m.layers.add(l); l._map = m; m.fire("layeradd", { layer: l }); return m; };
  m.removeLayer = (l) => { m.layers.delete(l); l._map = null; return m; };
  return m;
};
function makeEsriLayer(map) {
  const layer = new Evented();
  layer._map = map; layer.options = { opacity: 1 };
  layer.images = [];
  layer._renderImage = function (url, bounds) {            // ← esri-leaflet 3.0.19, listener wiring only
    if (this._map) {
      const image = new Evented(); image._image = { src: url }; image._bounds = bounds;
      this._map.addLayer(image); this.images.push(image);
      let onOverlayLoad;
      const onOverlayError = function () { this._map.removeLayer(image); this.fire("error"); image.off("load", onOverlayLoad, this); };
      onOverlayLoad = function () { image.off("error", onOverlayError, this); if (this._map) this.fire("load"); };
      image.once("error", onOverlayError, this);
      image.once("load", onOverlayLoad, this);
    }
  };
  layer.onRemove = function () {};
  return layer;
}

describe("guardRasterErrors — the image error path never dereferences a null map", () => {
  it("CONTROL (known-bad): the stock handler DOES throw once the layer's map is gone — the guard-free fake reproduces the report", () => {
    const map = makeMap(); const layer = makeEsriLayer(map);
    layer._renderImage("u", null);
    layer._map = null; // row switched off / plan switched before the image answered
    expect(() => layer.images[0].fire("error")).toThrow(/removeLayer/);
  });

  it("the layer lost its map: error → no throw, the layer still fires 'error', the stranded image is taken off the map it is on", () => {
    const map = makeMap(); const layer = makeEsriLayer(map); guardRasterErrors(layer);
    let errors = 0; layer.on("error", () => errors++);
    layer._renderImage("u", null);
    const image = layer.images[0];
    layer._map = null;
    expect(() => image.fire("error")).not.toThrow();
    expect(errors).toBe(1);
    expect(map.layers.has(image)).toBe(false); // removed if still on a map
  });

  it("same behaviour while the layer still has its map: image removed, 'error' fired once, and a later load does nothing", () => {
    const map = makeMap(); const layer = makeEsriLayer(map); guardRasterErrors(layer);
    let errors = 0, loads = 0; layer.on("error", () => errors++); layer.on("load", () => loads++);
    layer._renderImage("u", null);
    const image = layer.images[0];
    image.fire("error");
    expect(errors).toBe(1);
    expect(map.layers.has(image)).toBe(false);
    image.fire("load"); image.fire("error");
    expect(loads).toBe(0); expect(errors).toBe(1); // the pending listeners were dropped
  });

  it("an image already torn off its map by someone else (_map null) is not removed twice", () => {
    const map = makeMap(); const layer = makeEsriLayer(map); guardRasterErrors(layer);
    layer._renderImage("u", null);
    const image = layer.images[0];
    map.removeLayer(image); layer._map = null;
    let removed = 0; map.removeLayer = () => { removed++; };
    expect(() => image.fire("error")).not.toThrow();
    expect(removed).toBe(0);
  });

  it("a successful load drops the error listener (nothing left to fire later) and keeps esri's load behaviour", () => {
    const map = makeMap(); const layer = makeEsriLayer(map); guardRasterErrors(layer);
    let loads = 0; layer.on("load", () => loads++);
    layer._renderImage("u", null);
    const image = layer.images[0];
    image.fire("load");
    expect(loads).toBe(1);
    expect(image._ev.error || []).toHaveLength(0);
  });

  it("each render's image gets its own guard; the layeradd listener never outlives the call", () => {
    const map = makeMap(); const layer = makeEsriLayer(map); guardRasterErrors(layer);
    layer._renderImage("a", null); layer._renderImage("b", null);
    expect(map._ev.layeradd || []).toHaveLength(0);
    layer._map = null;
    expect(() => layer.images.forEach((i) => i.fire("error"))).not.toThrow();
  });

  it("a render that adds nothing (no map / no url) is a quiet no-op", () => {
    const layer = makeEsriLayer(null); guardRasterErrors(layer);
    expect(() => layer._renderImage("u", null)).not.toThrow();
    const map = makeMap(); const l2 = makeEsriLayer(map); guardRasterErrors(l2);
    l2._renderImage = ((orig) => function () { /* esri returns early on an empty url */ }) (l2._renderImage);
    expect(() => l2._renderImage("", null)).not.toThrow();
  });

  it("ONE wrapper per layer: guardRasterOpacity after guardRasterErrors (and the reverse) does not stack a second _renderImage wrapper", () => {
    const map = makeMap(); const a = makeEsriLayer(map); guardRasterErrors(a); const w = a._renderImage;
    a.getPane = () => ({ querySelectorAll: () => [] }); a.on = Evented.prototype.on.bind(a);
    guardRasterOpacity(a);
    expect(a._renderImage).toBe(w);
    // the opacity guard's layer still gets the error protection (the parcel layer is built with guardRasterOpacity only)
    const b = makeEsriLayer(map); b.getPane = () => ({ querySelectorAll: () => [] });
    guardRasterOpacity(b);
    b._renderImage("u", null); b._map = null;
    expect(() => b.images[0].fire("error")).not.toThrow();
  });
});
