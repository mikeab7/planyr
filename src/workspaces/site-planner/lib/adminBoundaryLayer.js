/* State / country outlines — the lazily-loaded half (NEW-1; band widened 2026-09-29).
 *
 * ⛔ NOTHING ON THE BOOT PATH MAY STATIC-IMPORT THIS FILE. It is reached only through
 * `adminBoundaryGate.js`'s dynamic import, which fires the first time the map crosses
 * below the zoom band. The Site route's JS budget had 1.1 KB of headroom when this
 * landed (ui-audit/perf-budgets.json), so a static edge here is a CI failure, not a
 * style preference. Same rule as `exportSheet.js` (B1042) and `terrainLayers.js` (B1095).
 *
 * The geometry is two public/ assets, not modules: `public/geo/admin-boundaries.json`
 * (Natural Earth 1:110m, `scripts/build-admin-boundaries.mjs`, countries + coarse states for
 * zoom <= 7) and `public/geo/admin1-detail.json` (Natural Earth 1:10m US states with coast
 * edges removed, `scripts/build-admin-detail.mjs`, fetched only at zoom >= 8). Being plain assets rather than JavaScript, it is charged against no bundle
 * budget at all, and it is requested only when this module runs — a user working at site
 * scale in Texas downloads none of it.
 *
 * CANVAS, NOT SVG. 346 rings over ~11,800 points would be 692 individually-transformed
 * SVG <path> nodes re-laid-out on every pan frame. Leaflet's canvas renderer draws the
 * whole set into one bitmap, which is the right instrument for many non-interactive
 * lines and keeps a continental pan cheap.
 *
 * SUBORDINATE BY CONSTRUCTION, three ways over:
 *   1. Its own pane at z-index 250 — above the imagery tiles (200), below the vector
 *      overlay pane (400) and every marker. Site geometry can never be occluded by it.
 *   2. `pointer-events: none` on the pane and non-interactive paths, so it cannot take a
 *      click from parcel-select, the right-click menu, or a site pin (the B98 rule).
 *   3. A white hairline over a soft dark casing — map-cartography styling that reads on
 *      both basemaps (dark aerial and light USGS topo) without matching the saturated
 *      status colours site geometry uses. Deliberately NOT app theme tokens, the same
 *      call `vectorOverlay.js` makes for its on-map lettering: this is lettering-weight
 *      furniture drawn over imagery, not app chrome.
 */
import L from "leaflet";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { ADMIN_BOUNDARY_MAX_ZOOM } from "./adminBoundaryGate.js";
import { adminBoundaryLevels, admin1Style, decodeAsset } from "./adminBoundaryData.js";

const ASSET = "geo/admin-boundaries.json";
const DETAIL_ASSET = "geo/admin1-detail.json";
const PANE = "adminboundaries";
const PANE_Z = 250;

/* Per level: casing first, then the line over it. Weights are hairlines by intent —
 * country a touch heavier than state so the hierarchy reads without either competing. The
 * state level's style is zoom-dependent (`admin1Style`): it gets quieter as it survives into
 * the closer zooms. */
const COUNTRY_STYLE = { casing: { color: "#000", weight: 3.0, opacity: 0.28 }, line: { color: "#fff", weight: 1.2, opacity: 0.55 } };

const rings = new Map(); // asset path → promise of decoded levels
function loadRings(asset = ASSET) {
  if (!rings.has(asset)) {
    const url = new URL(asset, document.baseURI).href;
    rings.set(asset, fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(decodeAsset)
      .catch((e) => {
        /* LOUD-FAILURE: the map still works, so this must not throw into the finder — but
         * a boundary layer that quietly never appears is exactly the silent no-op the house
         * rule bans. Report it, and clear the cache so a later zoom retries. */
        rings.delete(asset);
        try { reportClientEvent("admin-boundaries-unavailable", `Boundary outlines could not load (${asset}): ${e && e.message}`, { url }); } catch (_) { /* never let telemetry throw */ }
        throw e;
      }));
  }
  return rings.get(asset);
}

/* One controller per map. Holds the two level groups and swaps them in/out on zoom. */
const attached = new WeakMap();

export function attachAdminBoundaries(map) {
  if (!map) return null;
  const existing = attached.get(map);
  if (existing) return existing;

  if (!map.getPane(PANE)) {
    const pane = map.createPane(PANE);
    pane.style.zIndex = String(PANE_Z);
    pane.style.pointerEvents = "none";
  }
  const renderer = L.canvas({ pane: PANE, padding: 0.5 });
  const groups = {};  // country · admin1 (coarse) · admin1Detail (fine, loaded on demand)
  let destroyed = false, detailRequested = false;

  const buildGroup = (lines, style) => {
    const group = L.layerGroup();
    const polys = [];
    for (const ring of lines || []) {
      const casing = L.polyline(ring, { ...style.casing, renderer, pane: PANE, interactive: false, lineJoin: "round" }).addTo(group);
      const line = L.polyline(ring, { ...style.line, renderer, pane: PANE, interactive: false, lineJoin: "round" }).addTo(group);
      polys.push([casing, line]);
    }
    group._pairs = polys;
    return group;
  };
  const build = (decoded) => {
    groups.country = buildGroup(decoded.country, COUNTRY_STYLE);
    groups.admin1 = buildGroup(decoded.admin1, admin1Style(map.getZoom()));
  };
  const restyle = (group, style) => {
    for (const [c, l] of group._pairs || []) { c.setStyle(style.casing); l.setStyle(style.line); }
  };

  /* Add/remove whole level groups to match the gate. Leaflet skips drawing a layer that
   * is not on the map, so an out-of-band level costs nothing per frame.
   *
   * The pane is stamped with what is currently drawn — `data-levels` (country / admin1) and
   * `data-detail` ("1" when the fine geometry is the one on screen) — the same trick the
   * flood panel uses with `data-surface`: it gives a headless check something OURS to assert
   * against instead of reaching into Leaflet. A mirror of what was drawn, never the source. */
  const sync = () => {
    if (destroyed) return;
    const z = map.getZoom();
    const want = adminBoundaryLevels(z, ADMIN_BOUNDARY_MAX_ZOOM);
    if (want.detail && !detailRequested) {
      detailRequested = true;
      loadRings(DETAIL_ASSET).then(
        (d) => { if (!destroyed) { groups.admin1Detail = buildGroup(d.admin1, admin1Style(map.getZoom())); sync(); } },
        () => { detailRequested = false; }, // already reported; the next zoom step retries
      );
    }
    const detailReady = !!groups.admin1Detail;
    const show = {
      country: want.country,
      admin1: want.admin1 && !(want.detail && detailReady),
      admin1Detail: want.admin1 && want.detail && detailReady,
    };
    const drawn = [];
    for (const key of Object.keys(groups)) {
      const on = map.hasLayer(groups[key]);
      if (show[key] && !on) groups[key].addTo(map);
      else if (!show[key] && on) map.removeLayer(groups[key]);
      if (show[key]) drawn.push(key === "admin1Detail" ? "admin1" : key);
    }
    if (groups.admin1 && show.admin1) restyle(groups.admin1, admin1Style(z));
    if (groups.admin1Detail && show.admin1Detail) restyle(groups.admin1Detail, admin1Style(z));
    const pane = map.getPane(PANE);
    if (pane) { pane.dataset.levels = drawn.join(" "); pane.dataset.detail = show.admin1Detail ? "1" : "0"; }
  };

  const controller = {
    sync,
    destroy() {
      destroyed = true;
      map.off("zoomend", sync);
      for (const g of Object.values(groups)) { try { map.removeLayer(g); } catch (_) { /* map already torn down */ } }
      attached.delete(map);
    },
  };
  attached.set(map, controller);

  loadRings().then(
    (decoded) => { if (!destroyed) { build(decoded); map.on("zoomend", sync); sync(); } },
    () => { attached.delete(map); }, // already reported; a later zoom-out re-attaches and retries
  );
  return controller;
}
