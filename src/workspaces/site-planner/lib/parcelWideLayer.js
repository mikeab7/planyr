/* lib/parcelWideLayer.js — NEW-1 (Select parcels: lot outlines from further zoomed out, without hammering county servers).
 *
 * The Leaflet half of the wide view. `attachWideOutlines(layer, …)` hangs a second, much cheaper way of drawing onto a county's
 * outline layer (`makeParcelLayer`): from `floor-2` up to `floor` (today's cutoff) it draws only the LARGER lots —
 *   mid  (floor-1 … floor)    lots ≥ MID_MIN_ACRES, a parcel-ID label on each lot ≥ LABEL_MIN_ACRES
 *   wide (floor-2 … floor-1)  lots ≥ WIDE_MIN_ACRES, simplified lines, no labels
 * and nothing about the close stage changes (esri-leaflet's own featureLayer still owns every zoom ≥ floor).
 *
 * HOW IT KEEPS THE COUNTY SERVER QUIET (the whole point; the rules live in parcelWideEngine.js and parcelWideRequest.js):
 * the size cutoff is a `where` on the source's verified geometric area column and the geometry is generalised, so the county never
 * sends a house lot; requests are for FIXED tiles keyed to a zoom bucket and go through Planyr's /api/gis-cache relay, so each tile is
 * fetched from the county once for every user; nothing is requested while the view is moving, a tile that leaves the view is aborted,
 * concurrency is capped, and a 429/503 backs the host off (the layer fires `widestate` so the map's hint says so instead of going blank).
 * A county whose saved copy (Drive snapshot) is already in memory serves the tiles from that copy — no request at all.
 *
 * B137 holds: a click still resolves through MapFinder's live point query, never through what is drawn here. The drawn lots are inert
 * ghosts in their OWN index/tile layer — they are not in `layer._layers`, so the close stage's hit-test, hover and prune are untouched. */
import L from "leaflet";
import { bestMeasurer } from "../../../shared/markup/textWrap.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { WideTileEngine } from "./parcelWideEngine.js";
import { areaFieldForUrl, wideStageForZoom, bucketForStage, tilesForBounds, buildWideTileQuery, wideTileRequest, relayFallbackWanted, geoJsonAcres, LABEL_MIN_ACRES, wideFloorFor, areaCutoff, tileEnvelope } from "./parcelWideRequest.js";
import { fetchEsriFeatures } from "./parcelQueryTransport.js";
import { IngestQueue, INGEST_BUDGET_MS } from "./parcelIngest.js";
import { outlineFieldsFor } from "./parcelDisplayZoom.js";
import { resolveLotNumberField } from "./parcelLotNumbers.js";
import { paintLotNumbers } from "./parcelLotLabelLayer.js";
import { getSnapshot, snapshotFeaturesInView } from "./parcelSnapshot.js";
import { CARRY_MS, carryReady, ghostShouldDetach } from "./parcelHandoff.js";

const HANDOFF_MS = 1500; // the wide lines stay under the close stage's first draw for at most this long
const LABEL_DEBOUNCE_MS = 120;

export function attachWideOutlines(layer, { url, GhostClass, TilesClass, IndexClass, lotHint, getObstacles, getInset, pane, labelPane, snapshotCounty } = {}) {
  const area = areaFieldForUrl(url);
  if (!area || !layer) return null;
  const floor = Number(layer.options && layer.options.minZoom);
  if (!Number.isFinite(floor)) return null;

  let map = null, engine = null, tilesLayer = null, index = null, group = null, labelJob = null, labelTimer = null, handoff = null;
  let stage = "far";
  /* HAND-OFF (parcelHandoff.js): what was drawn stays drawn until its replacement is. `carryKeys` = attached tiles of the PREVIOUS wide/mid stage,
   * `carriedGhosts` = the close stage's lots when the view left its range; both go once the current view's tiles are drawn, or after CARRY_MS. */
  let wantNow = null; // tile keys the current wide/mid view needs (null while the view is in another stage)
  const carryKeys = new Set();
  const carriedGhosts = new Set();
  let carryTimer = null;
  let relayBroken = false;
  let meta = null, metaWait = null, fields = null, lotField = null;
  let reported = false;
  const measure = bestMeasurer({ weight: 600 });
  const byId = new Map(); // lot id -> { g, keys:Set<tileKey> }
  const attachedFeatures = new Map(); // tileKey -> features this layer has put (or queued) on the map for that tile
  let info = { stage: "far", busy: false, error: null, loading: 0 };

  const fire = () => { try { layer.fire("widestate", info); } catch (_) { /* nobody listening */ } };
  const setInfo = (patch) => {
    const next = { ...info, ...patch };
    if (next.stage === info.stage && next.busy === info.busy && next.error === info.error && next.loading === info.loading) return;
    info = next; fire();
  };

  /* ── metadata (one read, shared) ─────────────────────────────────────────────────────────────── */
  const getMeta = (cb) => {
    if (meta) { cb(meta); return; }
    if (metaWait) { metaWait.push(cb); return; }
    metaWait = [cb];
    const done = (m) => {
      const w = metaWait; metaWait = null;
      if (m) {
        meta = m;
        const idField = outlineFieldsFor(m, ["OBJECTID"])[0];
        lotField = lotHint ? resolveLotNumberField(m.fields, lotHint) : null;
        fields = [idField, ...(lotField && lotField !== idField ? [lotField] : [])];
      }
      w.forEach((c) => c(m));
    };
    try { layer.metadata((err, m) => done(!err && m && Array.isArray(m.fields) ? m : null)); } catch (_) { done(null); }
  };

  /* ── where a tile's lots come from ───────────────────────────────────────────────────────────── */
  const fromSnapshot = (tile, tier, cb) => {
    const env = tileEnvelope(tile);
    const lat = (env[1] + env[3]) / 2;
    const minAc = areaCutoff({ stage: tile.stage, tier, unit: "ac", lat }); // the same cutoff in acres
    snapshotFeaturesInView(snapshotCounty, { w: env[0], s: env[1], e: env[2], n: env[3] }).then((feats) => {
      const out = [];
      for (const f of feats || []) {
        if (!f || !f.geometry) continue;
        if (geoJsonAcres(f.geometry) < minAc) continue;
        out.push({ type: "Feature", id: `s${f.__k != null ? f.__k : out.length}`, geometry: f.geometry, properties: f.properties || {} });
      }
      cb({ ok: true, features: out, exceeded: false });
    }, () => cb({ ok: false, transient: true, message: "saved copy unreadable" }));
  };

  const fetchTile = ({ tile, tier }, cb) => {
    let cancelled = false, handle = null;
    if (snapshotCounty && getSnapshot(snapshotCounty)) { fromSnapshot(tile, tier, (r) => { if (!cancelled) cb(r); }); return { abort() { cancelled = true; } }; }
    getMeta((m) => {
      if (cancelled) return;
      if (!m) { cb({ ok: false, transient: true, message: "the parcel layer's field list is unavailable" }); return; }
      const send = (relay) => {
        const { params } = buildWideTileQuery({ tile, stage: tile.stage, area, fields, tier });
        const req = wideTileRequest(url, params, { relay });
        handle = fetchEsriFeatures({ url: req.url, body: req.body }, (res) => {
          if (cancelled) return;
          // the relay is a convenience, never a dependency: where it does not answer (a dev server, a refused host) fall back to the county directly
          // …including a relay that answers 200 with something that is not an ArcGIS answer (an SPA fallback page on a dev server) — but NOT a 429/503 whose body is a plain-text or HTML refusal: that is a busy county, not a broken relay
          if (relayFallbackWanted(req.via, res)) { relayBroken = true; send(false); return; }
          cb(res);
        });
      };
      send(!relayBroken);
    });
    return { abort() { cancelled = true; if (handle) handle.abort(); } };
  };

  /* ── drawing (inert ghosts in the wide layer's own index) ────────────────────────────────────── */
  const queue = new IngestQueue({
    process: ({ f, key }) => {
      if (!attachedFeatures.has(key) || !index) return;
      let rec = byId.get(f.id);
      if (!rec) {
        if (!f.geometry) return;
        const g = new GhostClass(f, index, (bbox) => { if (tilesLayer) tilesLayer.markDirty(bbox); });
        g.feature = f;
        rec = { g, keys: new Set() };
        byId.set(f.id, rec);
        g.attach();
      }
      rec.keys.add(key);
    },
    alive: (key) => attachedFeatures.has(key),
  });
  let pumpRaf = null;
  const pump = () => {
    pumpRaf = null;
    if (!map) return;
    queue.drain(INGEST_BUDGET_MS);
    if (queue.pending) pumpRaf = L.Util.requestAnimFrame(pump); else { checkCarry(); scheduleLabels(); }
  };
  const kick = () => {
    if (typeof document !== "undefined" && document.hidden) { queue.drain(Infinity); checkCarry(); scheduleLabels(); return; }
    if (pumpRaf == null) pumpRaf = L.Util.requestAnimFrame(pump);
  };
  const attachTile = (key, features) => {
    attachedFeatures.set(key, features);
    queue.push(features.map((f) => ({ f, key })), key);
    kick();
  };
  const detachTile = (key) => {
    const features = attachedFeatures.get(key);
    if (!features) return;
    attachedFeatures.delete(key);
    for (const f of features) {
      const rec = byId.get(f.id);
      if (!rec) continue;
      rec.keys.delete(key);
      if (!rec.keys.size) { rec.g.detach(); byId.delete(f.id); }
    }
  };
  /* The tiles that should be on the map right now: loaded, and of the stage the view is in. */
  const syncDrawn = () => {
    const want = new Map();
    if (engine && (stage === "wide" || stage === "mid")) for (const [key, e] of engine.loaded) if (e.tile.stage === stage) want.set(key, e);
    for (const key of [...attachedFeatures.keys()]) {
      const e = want.get(key);
      if (!e && carryKeys.has(key)) continue; // the previous stage's lines, held until this stage is drawn
      if (!e || attachedFeatures.get(key) !== e.features) detachTile(key);
    }
    for (const [key, e] of want) if (!attachedFeatures.has(key)) attachTile(key, e.features);
  };

  /* ── hand-off between stages ─────────────────────────────────────────────────────────────────── */
  const releaseCarry = () => {
    if (carryTimer) { clearTimeout(carryTimer); carryTimer = null; }
    const had = carryKeys.size || carriedGhosts.size;
    carryKeys.clear();
    for (const g of carriedGhosts) {
      const id = g.feature && g.feature.id;
      const held = !!(layer._layers && id != null && layer._layers[id] === g);
      if (ghostShouldDetach({ heldByLayer: held, visibleZoom: !!(layer._visibleZoom && layer._visibleZoom()) })) g.detach();
    }
    carriedGhosts.clear();
    if (had) syncDrawn();
  };
  const startCarryTimer = () => { if (carryTimer) clearTimeout(carryTimer); carryTimer = setTimeout(releaseCarry, CARRY_MS); };
  function checkCarry() {
    if (!carryKeys.size && !carriedGhosts.size) return;
    if (carryReady({ wantNow, hasLoaded: (k) => !!(engine && engine.loaded.has(k)), hasAttached: (k) => attachedFeatures.has(k), ingestPending: queue.pending })) releaseCarry();
  }

  /* ── labels (mid stage only: parcel IDs on the larger lots) ──────────────────────────────────── */
  const acresOf = (g) => (g._acres !== undefined ? g._acres : (g._acres = geoJsonAcres(g.feature.geometry)));
  const clearLabels = () => { if (labelJob) { labelJob.cancel(); labelJob = null; } if (group) group.clearLayers(); };
  const relayoutLabels = () => {
    labelTimer = null;
    if (labelJob) { labelJob.cancel(); labelJob = null; }
    if (!map || !group) return;
    if (stage !== "mid" || !lotField) { group.clearLayers(); return; }
    labelJob = paintLotNumbers({
      map, group, field: lotField, floor: 0, measure, getObstacles, getInset, pane: labelPane,
      forEachFeature: (cb) => { byId.forEach((rec) => { if (acresOf(rec.g) >= LABEL_MIN_ACRES) cb(rec.g.feature, rec.g.bbox); }); },
    });
  };
  const scheduleLabels = () => { if (labelTimer) clearTimeout(labelTimer); labelTimer = setTimeout(relayoutLabels, LABEL_DEBOUNCE_MS); };

  /* ── the view ────────────────────────────────────────────────────────────────────────────────── */
  const ensureTilesLayer = () => {
    if (tilesLayer || !map) return;
    index = new IndexClass();
    tilesLayer = new TilesClass(index, { pane: pane || "overlayPane", zIndex: 0, minZoom: wideFloorFor(floor), maxZoom: 24, tileSize: 512, keepBuffer: 1 });
    tilesLayer._busy = () => queue.pending > 0;
    tilesLayer.addTo(map);
  };
  /* The close layer fires `load` when its lots are queued-in; its tile canvases repaint a frame or more later (budgeted), so letting go of the wide lines ON `load`
   * left one blank frame. Let go two animation frames after it. */
  let soonRaf = null;
  const releaseSoon = () => {
    layer.off("load", releaseSoon);
    if (soonRaf != null) return;
    soonRaf = L.Util.requestAnimFrame(() => { soonRaf = L.Util.requestAnimFrame(() => { soonRaf = null; releaseWide(); }); });
  };
  const releaseWide = () => {
    if (handoff) { clearTimeout(handoff); handoff = null; }
    if (soonRaf != null) { L.Util.cancelAnimFrame(soonRaf); soonRaf = null; }
    layer.off("load", releaseSoon);
    for (const key of [...attachedFeatures.keys()]) detachTile(key);
    queue.clear();
    releaseCarry();
    if (tilesLayer) { try { tilesLayer.remove(); } catch (_) { /* detached */ } tilesLayer = null; index = null; }
    clearLabels();
  };
  const sync = () => {
    if (!map || !engine) return;
    const z = map.getZoom();
    const next = wideStageForZoom(z, floor, true);
    const prev = stage;
    stage = next;
    if (next === "wide" || next === "mid") {
      if (handoff) { clearTimeout(handoff); handoff = null; layer.off("load", releaseSoon); }
      if (soonRaf != null) { L.Util.cancelAnimFrame(soonRaf); soonRaf = null; } // back in the wide/mid view before the hand-off finished: nothing to let go of
      ensureTilesLayer();
      const b = map.getBounds();
      const bucket = bucketForStage(next, floor);
      const tiles = tilesForBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, bucket).map((t) => ({ ...t, stage: next, key: `${next}:${t.key}` }));
      wantNow = tiles.map((t) => t.key);
      if (next !== prev && (prev === "wide" || prev === "mid")) {
        // the other stage's lines stay under this one until its tiles are drawn — a stage change must never blank the map for the length of a county round trip
        for (const key of attachedFeatures.keys()) if (!key.startsWith(`${next}:`)) carryKeys.add(key);
        if (carryKeys.size) startCarryTimer();
      }
      syncDrawn();
      engine.setView({ tiles });
      if (next !== prev) scheduleLabels();
      setInfo({ stage: next });
      checkCarry();
    } else {
      engine.setView(null);
      wantNow = null;
      if (next === "close") {
        // keep the larger-lot lines under the close stage until it has drawn (or briefly), then let go — no blank flash at the cutoff
        if ((prev === "wide" || prev === "mid" || carriedGhosts.size) && !handoff) { layer.on("load", releaseSoon); handoff = setTimeout(releaseWide, HANDOFF_MS); }
      } else releaseWide();
      clearLabels();
      setInfo({ stage: next, busy: false, error: null, loading: 0 });
    }
  };

  /* ── lifecycle ───────────────────────────────────────────────────────────────────────────────── */
  layer.on("add", () => {
    map = layer._map;
    if (!map) return;
    group = L.layerGroup().addTo(map);
    engine = new WideTileEngine({
      fetchTile,
      onTile: (key, entry) => {
        if (!entry) { detachTile(key); return; }
        if (entry.tile.stage !== stage) return;
        if (attachedFeatures.has(key)) detachTile(key); // a tighter re-ask replaced the partial answer
        attachTile(key, entry.features);
      },
      onState: (s) => {
        setInfo({ busy: s.busy, error: s.error, loading: s.loading });
        if ((s.busy || s.error) && !reported) {
          reported = true; // LOUD-FAILURE: once per source per session, never a silent blank patch
          reportClientEvent("parcel-wide-tile-failed", s.error ? `wide-view parcel tiles refused: ${s.error}` : "wide-view parcel tiles are backing off (the county server is busy)", { url, busy: !!s.busy });
        }
      },
    });
    map.on("moveend zoomend", sync);
    sync();
  });
  layer.on("remove", () => {
    if (map) map.off("moveend zoomend", sync);
    if (engine) { engine.stop(); engine = null; }
    if (pumpRaf != null) { L.Util.cancelAnimFrame(pumpRaf); pumpRaf = null; }
    if (labelTimer) { clearTimeout(labelTimer); labelTimer = null; }
    releaseWide();
    if (group && map) { try { map.removeLayer(group); } catch (_) { /* detached */ } }
    group = null; map = null; stage = "far"; meta = null; metaWait = null;
    info = { stage: "far", busy: false, error: null, loading: 0 };
  });

  return {
    floor, wideFloor: wideFloorFor(floor), area,
    /** The close stage lost its range (a zoom out): these lots stay drawn until the wide/mid stage has drawn its own, or CARRY_MS. */
    carry(ghosts) {
      if (!map || !engine || !ghosts || !ghosts.length) return false;
      for (const g of ghosts) carriedGhosts.add(g);
      startCarryTimer();
      checkCarry();
      return true;
    },
    carrying: () => carryKeys.size + carriedGhosts.size,
    info: () => info,
    stats: () => (engine ? { ...engine.stats, loaded: engine.loaded.size, held: byId.size } : null),
  };
}
