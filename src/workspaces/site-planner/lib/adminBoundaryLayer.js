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
 * SVG <path> nodes re-laid-out on every pan frame — one bitmap is the right instrument.
 *
 * OUR OWN CANVAS, NOT LEAFLET'S RENDERER (NEW-1 amend, 2026-09-29). Leaflet's `L.canvas` keeps a
 * pan cheap but, on a zoom, CSS-scales its bitmap (measured: its canvas ran 1× → 2× over the 0.25 s
 * animation, then snapped back) — so the hairlines and their casing visibly fattened and re-thinned
 * on every zoom. This layer draws its own canvas and, during a zoom, re-projects every vertex each
 * frame between the start and end views (zoomTracker.js) — lines ride the ground and stay the same
 * width, like the city names. ~30k vertices is a few multiplies each; bounding boxes cull rings.
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
import { createZoomTracker, toUnit } from "./zoomTracker.js";

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

/* One controller per map. Holds the level groups and redraws them every move / zoom frame. */
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
  const pane = map.getPane(PANE);
  const canvas = L.DomUtil.create("canvas", "", pane);
  canvas.style.pointerEvents = "none";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  const groups = {};  // country · admin1 (coarse) · admin1Detail (fine, loaded on demand)
  let destroyed = false, detailRequested = false, raf = 0;

  /* A group is a list of rings in UNIT web-mercator, flat [x0,y0,x1,y1,…], with a bounding box —
   * projected once here, so a frame is two multiplies per vertex (zoomTracker.js). */
  const buildGroup = (lines) => (lines || []).map((ring) => {
    const u = new Float64Array(ring.length * 2);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ring.forEach((ll, i) => {
      const [x, y] = toUnit(map, ll);
      u[2 * i] = x; u[2 * i + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    });
    return { u, box: [x0, y0, x1, y1] };
  });

  const tracker = createZoomTracker(map, pane, { onStart: () => schedule(), onEnd: () => schedule() });

  const strokeGroup = (group, f, w, h, casing, line) => {
    for (const st of [casing, line]) {
      ctx.beginPath();
      for (const r of group) {
        const a = f.unit(r.box[0], r.box[1]), b = f.unit(r.box[2], r.box[3]);
        if (b.x < -20 || a.x > w + 20 || b.y < -20 || a.y > h + 20) continue; // ring bbox is off-screen
        const u = r.u;
        let p = f.unit(u[0], u[1]);
        ctx.moveTo(p.x, p.y);
        for (let i = 2; i < u.length; i += 2) { p = f.unit(u[i], u[i + 1]); ctx.lineTo(p.x, p.y); }
      }
      ctx.globalAlpha = st.opacity; ctx.strokeStyle = st.color; ctx.lineWidth = st.weight;
      ctx.stroke();
    }
  };

  /* Draw one frame. Which levels are on comes from the zoom being DRAWN (the end zoom during an
   * animation), so the gate answers to where the zoom is heading.
   *
   * The pane is stamped with what is currently drawn — `data-levels` (country / admin1) and
   * `data-detail` ("1" when the fine geometry is the one on screen) — the same trick the
   * flood panel uses with `data-surface`: it gives a headless check something OURS to assert
   * against instead of reaching into Leaflet. A mirror of what was drawn, never the source.
   * `pane.__at(latlng)` is this frame's projection, read by the mid-zoom check. */
  const draw = (ts) => {
    raf = 0;
    if (destroyed) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
      canvas.width = Math.round(size.x * dpr); canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.lineJoin = "round"; ctx.lineCap = "round";

    const f = tracker.frame(typeof ts === "number" ? ts : performance.now());
    const want = adminBoundaryLevels(f.zoom, ADMIN_BOUNDARY_MAX_ZOOM);
    if (want.detail && !detailRequested && groups.country) {
      detailRequested = true;
      loadRings(DETAIL_ASSET).then(
        (d) => { if (!destroyed) { groups.admin1Detail = buildGroup(d.admin1); schedule(); } },
        () => { detailRequested = false; }, // already reported; the next zoom step retries
      );
    }
    const detailReady = !!groups.admin1Detail;
    const show = {
      country: want.country,
      admin1: want.admin1 && !(want.detail && detailReady),
      admin1Detail: want.admin1 && want.detail && detailReady,
    };
    const style = admin1Style(f.zoom);
    const drawn = [];
    if (show.country && groups.country) { strokeGroup(groups.country, f, size.x, size.y, COUNTRY_STYLE.casing, COUNTRY_STYLE.line); drawn.push("country"); }
    if (show.admin1 && groups.admin1) { strokeGroup(groups.admin1, f, size.x, size.y, style.casing, style.line); drawn.push("admin1"); }
    if (show.admin1Detail) { strokeGroup(groups.admin1Detail, f, size.x, size.y, style.casing, style.line); drawn.push("admin1"); }
    ctx.globalAlpha = 1;
    pane.dataset.levels = drawn.join(" ");
    pane.dataset.detail = show.admin1Detail ? "1" : "0";
    pane.__at = f.at;
    if (f.animating) schedule();
  };
  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(draw); };
  const onMove = () => schedule();
  map.on("move zoom moveend zoomend resize", onMove);

  const controller = {
    sync: schedule,
    drawSync(ts) { if (raf) { cancelAnimationFrame(raf); raf = 0; } draw(ts); }, // headless checks: draw NOW, on the caller's frame
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      map.off("move zoom moveend zoomend resize", onMove);
      tracker.destroy();
      try { canvas.remove(); } catch (_) { /* map already torn down */ }
      attached.delete(map);
    },
  };
  attached.set(map, controller);
  pane.__adminBoundaries = controller; // test-only handle (ui-audit/verify-admin-boundaries.mjs); nothing in the app reads it

  loadRings().then(
    (decoded) => { if (!destroyed) { groups.country = buildGroup(decoded.country); groups.admin1 = buildGroup(decoded.admin1); schedule(); } },
    () => { attached.delete(map); }, // already reported; a later zoom-out re-attaches and retries
  );
  return controller;
}
