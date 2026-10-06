/* NEW-2 (B2163345) — the MAP/COMPS surface (Leaflet placement handles): chrome hugs the crop, and scale / rotate
 * pivot about the visible centre. A fake map with a plain linear lat/lon→pixel projection stands in for Leaflet's. */
import { describe, it, expect, vi } from "vitest";

/* The suite runs in a plain Node environment (no DOM library, by design) — so Leaflet and the handful of DOM
 * calls the handles make are stubbed minimally. The geometry under test is the real module's. */
vi.mock("leaflet", () => {
  const L = { latLng: (lat, lng) => (typeof lat === "object" ? { lat: lat.lat, lng: lat.lng ?? lat.lon } : { lat, lng }), DomEvent: { stop() {} } };
  return { default: L };
});
class FakeEl {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.style = {}; this.parentNode = null; this.textContent = ""; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; } append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatchEvent(e) { (this.listeners[e.type] || []).forEach((f) => f(e)); return true; }
  getBBox() { return { x: 0, y: 0, width: 10, height: 10 }; }
  querySelectorAll(tag) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.tag === tag) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
}
const winTarget = new FakeEl("window");
globalThis.document = { createElementNS: (_n, tag) => new FakeEl(tag) };
globalThis.window = { addEventListener: (t, f) => winTarget.addEventListener(t, f), removeEventListener: (t, f) => { winTarget.listeners[t] = (winTarget.listeners[t] || []).filter((x) => x !== f); } };

const { default: L } = await import("leaflet");
import { createPlacementHandles } from "../src/workspaces/site-planner/lib/overlayPlacementHandles.js";
import { imagePointToLatLon, visibleCenterPx } from "../src/shared/overlay/overlayPlacement.js";

const K = 200000; // px per degree — an arbitrary linear "map"
const lat0 = 29.78, lon0 = -95.82;
const proj = (ll) => ({ x: (ll.lng - lon0) * K, y: -(ll.lat - lat0) * K });
function fakeMap() {
  const panes = {};
  return {
    getPane: (n) => panes[n], createPane: (n) => (panes[n] = Object.assign(new FakeEl("div"), {})),
    latLngToLayerPoint: (ll) => proj(ll), latLngToContainerPoint: (ll) => proj(ll),
    mouseEventToContainerPoint: (e) => ({ x: e.cx, y: e.cy }), mouseEventToLatLng: (e) => L.latLng(lat0 - e.cy / K, lon0 + e.cx / K),
    dragging: { enabled: () => false, disable() {}, enable() {} }, touchZoom: { enabled: () => false, disable() {}, enable() {} },
    on() {}, off() {},
    _panes: panes,
  };
}
const overlay = (crop, rotationDeg = 0) => ({ id: "o1", centerLat: lat0, centerLon: lon0, ftPerPx: 1, rotationDeg, imgW: 1000, imgH: 800, crop });
const RECT = { kind: "rect", x: 600, y: 100, w: 200, h: 150 };

function arm(o) {
  const map = fakeMap(); const h = createPlacementHandles(map);
  const commits = [];
  h.show(o, o.imgW, o.imgH, { onLive() {}, onCommit: (p) => commits.push(p) });
  const svg = map._panes.sitePlanHandlesPane.querySelector("svg");
  return { map, h, svg, commits };
}
const polyPts = (el) => el.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
const fire = (el, type, cx, cy) => { const e = { type, cx, cy, key: "" }; (el === window ? winTarget : el).dispatchEvent(e); };

describe("map placement handles — visible extent", () => {
  it("the outline hugs the crop; uncropped it is the whole image", () => {
    for (const [crop, want] of [[RECT, [600, 100, 800, 250]], [undefined, [0, 0, 1000, 800]]]) {
      const o = overlay(crop);
      const { svg } = arm(o);
      const ring = polyPts(svg.querySelectorAll("polygon")[1]); // [moveHit, boundary, rotHandle]
      const tl = proj(L.latLng(...Object.values(imagePointToLatLon(o, 1000, 800, want[0], want[1])).slice(0, 2)));
      const br = proj(L.latLng(...Object.values(imagePointToLatLon(o, 1000, 800, want[2], want[3])).slice(0, 2)));
      expect(ring[0][0]).toBeCloseTo(tl.x, 3); expect(ring[0][1]).toBeCloseTo(tl.y, 3);
      expect(ring[2][0]).toBeCloseTo(br.x, 3); expect(ring[2][1]).toBeCloseTo(br.y, 3);
    }
  });

  for (const rot of [0, 40]) {
    it(`corner drag scales the whole overlay about the VISIBLE centre (rotation ${rot})`, () => {
      const o = overlay(RECT, rot);
      const c = visibleCenterPx(o);
      const v0 = imagePointToLatLon(o, 1000, 800, c.x, c.y);
      const { svg, commits } = arm(o);
      const corner = svg.querySelectorAll("rect")[2]; // the 4 corner squares in order [tl,tr,br,bl]
      const cp = proj(L.latLng(v0.lat, v0.lon));
      const grab = { x: cp.x + 30, y: cp.y + 20 };
      fire(corner, "pointerdown", grab.x, grab.y);
      fire(window, "pointermove", cp.x + 60, cp.y + 40); // twice as far from the pivot
      fire(window, "pointerup", cp.x + 60, cp.y + 40);
      expect(commits).toHaveLength(1);
      const p = commits[0];
      expect(p.ftPerPx).toBeCloseTo(2, 6);
      expect(p.crop).toBe(RECT);
      const v1 = imagePointToLatLon(p, 1000, 800, c.x, c.y);
      expect(v1.lat).toBeCloseTo(v0.lat, 9); expect(v1.lon).toBeCloseTo(v0.lon, 9);
    });
    it(`rotate drag spins about the VISIBLE centre (rotation ${rot})`, () => {
      const o = overlay(RECT, rot);
      const c = visibleCenterPx(o);
      const v0 = imagePointToLatLon(o, 1000, 800, c.x, c.y);
      const { svg, commits } = arm(o);
      const diamond = svg.querySelectorAll("polygon")[2];
      const cp = proj(L.latLng(v0.lat, v0.lon));
      fire(diamond, "pointerdown", cp.x, cp.y - 100);
      fire(window, "pointermove", cp.x + 100, cp.y); // a quarter turn clockwise
      fire(window, "pointerup", cp.x + 100, cp.y);
      const p = commits[0];
      expect(p.rotationDeg).toBeCloseTo((rot + 90) % 360, 6);
      expect(p.ftPerPx).toBe(1);
      const v1 = imagePointToLatLon(p, 1000, 800, c.x, c.y);
      expect(v1.lat).toBeCloseTo(v0.lat, 9); expect(v1.lon).toBeCloseTo(v0.lon, 9);
    });
  }
});
