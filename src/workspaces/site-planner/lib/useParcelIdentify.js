/* @planner-extract — the "pick a county lot" (parcel identify) flow of the Site Planner, as a TWO-PHASE hook (audit batch G2 step 3, B2671311, behaviour-identical move).
 * 1. `useParcelIdentifyState()` is called EARLY, where the old `useState`/`useRef` cells sat (the identify result is read at render time far above the handlers);
 * 2. `useParcelIdentify({ …cells, …deps })` is called LATE, where the handler block ended: the per-county layer cache, the candidate routing (primary, line-band
 *    neighbours, breaker-skipped, statewide fallback), parcelGisKey / parcelsFromRings, the lot flash, quickAddAt, addByAddress and the outline-set effect.
 * The GIS routing itself still lives in lib/identifyWithFallback.js and the shared gisFetch (audit M3 routes those fetches); this file only hosts the React wiring.
 * No import back from SitePlanner.jsx. */
import { useState, useRef, useEffect } from "react";
import { feetToLatLng, humanizeError, largestRingLngLat, lngLatRingToFeet, outerRingsLngLat, resolveLayerUrl } from "./arcgis.js";
import { COUNTIES_MAP, STATEWIDE_KEYS, candidateCountiesForPoint, countyIdentity, displaySourcesForView, ensureCountyGeometryAt, isStatewideLayerUrl, lineNeighbourKeysForPoint, loadCountyPolygons, onParcelTablesLoaded, silentServerPhrase, stackRuleForCounty, statewideBackupScope, statewideKeysForState } from "./counties.js";
import { looksLikeParcelNumber } from "./parcelNumberShape.js";
import { geocodeAddress } from "./geocode.js";
import { identifyWithLineFallback } from "./identifyWithFallback.js";
import { PANE_PARCEL_PICK, PANE_PARCEL_PICK_LABEL } from "./mapStack.js";
import { wideViewReady } from "./parcelAreaFieldsLazy.js";
import { parcelAtPoint } from "./parcelAtPoint.js";
import { makeParcelDisplayLayer } from "./parcelDisplay.js";
import { fallbackCandidates, fallbackNoticeText, fallbackSpecsFor, stateLayerCoversCounty } from "./parcelFallbacks.js";
import { parcelGapNotice } from "./parcelGaps.js";
import { parcelKey as parcelKeyOf, storedParcelKey } from "./parcelIdentity.js";
import { createOutlineSet } from "./parcelOutlineSet.js";
import { situsFor } from "./parcelQuery.js";
import { stackNote } from "./parcelStack.js";
import { parcelDefaultStyle } from "./planStyle.js";
import { uid } from "./plannerConstants.js";
import { filterHealthyCandidates, isSourceOpen, recordSourceResult, suppressRedundantStatewide } from "./sourceHealth.js";
import L from "leaflet";
export function useParcelIdentifyState() {
  const [identifyRes, setIdentifyRes] = useState(null); // {busy} | {added,attrs,rings,ring,lng,lat,addr} | {removed,addr} | {already,addr} | {error}
  const [identAdded, setIdentAdded] = useState(0); // lots added this identify session (for the status row)
  const [outlinePhase, setOutlinePhase] = useState("none"); // NEW-1 (select-parcel first paint): what the lit-up outlines are doing — loading | drawn | empty | zoom | none (lib/parcelOutlineSet.js status())
  const [addrQuery, setAddrQuery] = useState(""); // B384: the "Add by address" text field in the ＋ Add parcel menu
  const [addrBusy, setAddrBusy] = useState(false); // geocode in flight
  const identifyTok = useRef(0);
  const ackRef = useRef(null); // NEW-1 — the click acknowledgement (ring at the cursor) of the identify in flight
  const [outlineRefused, setOutlineRefused] = useState(false); // NEW-1 (Add parcels): a county server REFUSED part of the larger-lots band — said, never a silent blank patch
  const lotFlashRef = useRef(null);             // NEW-1 (Add parcels): the clicked lot's outline, drawn the instant the click lands (before the county answers)
  const outlineLayersRef = useRef(null);        // the outline set (lib/parcelOutlineSet.js) while identify mode is on — also read by the E2E hook below
  const identifyAddedRef = useRef(new Map());   // gisKey -> [parcel ids] added THIS session, so a re-click toggles it off
  return { identifyRes, setIdentifyRes, identAdded, setIdentAdded, outlinePhase, setOutlinePhase, addrQuery, setAddrQuery, addrBusy, setAddrBusy, identifyTok, ackRef, outlineRefused, setOutlineRefused, lotFlashRef, outlineLayersRef, identifyAddedRef };
}

export function useParcelIdentify({ PAL, ackRef, addrBusy, addrQuery, ensureBasemapOn, geoMapRef, identifyAddedRef, identifyMode, identifyTok, lotFlashRef, lotNoInsetRef, lotNoObstaclesRef, origin, outlineLayersRef, pushHistory, setAddParcelMenu, setAddrBusy, setAddrQuery, setIdentAdded, setIdentifyRes, setJurInfo, setOutlinePhase, setOutlineRefused, setParcels, setSel, settings, stateRef, tombstone }) {
  // NEW-1 (parcel routing, owner report 2026-08-22 — Jordan/Colorado) — `resolveCountyLayer` used to
  // resolve ONCE against `siteCounty`, the county recorded when the site was CREATED, and cache that
  // single URL for the life of the planner session, falling back to Harris County TX when the key
  // didn't resolve. Panning across a county line (or opening a Colorado site whose key ever missed)
  // meant every outline + click kept querying the wrong — sometimes a THOUSAND-MILE-wrong — service.
  // The Map view never had this bug: it routes each point through `candidateCountiesForPoint`, re-asked
  // fresh every time. This does the same: a per-county URL cache (shared by the outlines AND the click
  // query, so what you SEE is what you can ADD — the B137 rule), resolved on demand and never pinned to
  // one frozen county, and with NO Harris/any-county fallback — an unconfigured area returns no
  // candidates rather than a wrong-but-plausible one.
  const countyLayerUrlsRef = useRef({});         // county key -> resolved queryable layer URL (session cache)
  const countyLayerUrlsInflightRef = useRef({}); // county key -> in-flight resolve Promise (de-dupe concurrent callers)
  const resolveOneCountyLayer = (key) => {
    if (countyLayerUrlsRef.current[key]) return Promise.resolve(countyLayerUrlsRef.current[key]);
    if (countyLayerUrlsInflightRef.current[key]) return countyLayerUrlsInflightRef.current[key];
    const cm = COUNTIES_MAP[key];
    if (!cm) return Promise.resolve(null);
    const p = resolveLayerUrl(cm.layerUrl || cm.mapServer)
      .then((url) => { countyLayerUrlsRef.current[key] = url; return url; })
      .catch(() => null)
      .finally(() => { delete countyLayerUrlsInflightRef.current[key]; });
    countyLayerUrlsInflightRef.current[key] = p;
    return p;
  };
  // The queryable candidates for a real point, routed exactly like the Map view
  // (`candidateCountiesForPoint`) instead of the site's frozen county — re-resolved on every call.
  // Breaker-open sources are dropped (the always-kept statewide fallback excepted), so a click never
  // re-hammers a host we just saw fail.
  const candidatesAtPoint = async (lat, lng) => {
    const keys = candidateCountiesForPoint(lat, lng);
    const urls = await Promise.all(keys.map((k) => resolveOneCountyLayer(k)));
    const all = keys
      .map((county, i) => ({ county, url: urls[i], statewide: STATEWIDE_KEYS.includes(county) }))
      .filter((c) => c.url);
    const realPrimaries = all.filter((c) => !c.statewide);
    const healthy = filterHealthyCandidates(all, STATEWIDE_KEYS);
    // NEW-2 (B1639697) — a single healthy real CAD needs no statewide co-query; see
    // suppressRedundantStatewide's own header (sourceHealth.js) for why this is safe against the
    // outage-resilience behavior the parallel race otherwise exists for.
    const candidates = suppressRedundantStatewide(healthy, realPrimaries, STATEWIDE_KEYS);
    return { candidates, realPrimaries };
  };
  /* NEW-1 (Memphis line band, B2289168 ×3) — the sources of every county whose line passes near the point, asked only after
     the routed county found no lot (lib/identifyWithFallback.js); same list the Map's click uses. */
  const neighbourCandidatesAt = async (lat, lng) => {
    const keys = lineNeighbourKeysForPoint(lat, lng);
    const urls = await Promise.all(keys.map((k) => resolveOneCountyLayer(k)));
    const list = keys.map((county, i) => ({ county, url: urls[i], statewide: STATEWIDE_KEYS.includes(county) })).filter((c) => c.url);
    return filterHealthyCandidates(list, STATEWIDE_KEYS);
  };
  // NEW-1 (Memphis line band) — breaker-skipped sources for this point, asked once, last (lib/identifyWithFallback.js).
  const skippedCandidatesAt = async (lat, lng) => {
    const keys = [...new Set([...candidateCountiesForPoint(lat, lng), ...lineNeighbourKeysForPoint(lat, lng)])].filter((k) => isSourceOpen(k));
    const urls = await Promise.all(keys.map((k) => resolveOneCountyLayer(k)));
    return keys.map((county, i) => ({ county, url: urls[i], statewide: STATEWIDE_KEYS.includes(county) })).filter((c) => c.url);
  };
  // Stable per-lot key (lib/parcelIdentity.js — the ONE resolver, shared with the Map view): the CAD
  // OBJECTID (incl. table-prefixed joined-layer ids), else a hash of the whole ring set — never one vertex.
  const parcelGisKey = (attrs, rings, county) => parcelKeyOf(attrs, rings, { fallback: () => `geo:${uid()}`, stack: county ? stackRuleForCounty(county) : null }); // NEW-1 — a layer that stacks rows on a lot (Bartow) keys the LOT (counties.js dedupeBy)
  // rings (4326) → planner parcels in the site frame, each carrying its gisKey + attrs.
  // Every outer part of a multipart parcel ("TRS 3 & 5") becomes its own parcel (B36c),
  // locked by default like every county-pulled lot (B99).
  const parcelsFromRings = (rings, addr, attrs, county) => {
    const key = parcelGisKey(attrs, rings, county);
    return rings
      .map((r) => ({ id: uid(), points: lngLatRingToFeet(r, origin.lon, origin.lat), addr: addr || null, attrs: attrs || null, gisKey: key, ...parcelDefaultStyle(settings) })) // B929
      .filter((pc) => pc.points.length >= 3);
  };
  // A click in identify mode ADDS the lot under the cursor straight to the plan (no
  // preview-then-confirm) — click more lots to add more; re-click a lot you just added
  // to toggle it off. The info card then shows that lot's appraisal + the jurisdiction
  // lookup. The SINGLE add path (shared `parcelsFromRings`) every parcel-add reuses.
  /* NEW-1 (Add parcels, 2026-11-16 — Goose Creek: "I tried to click lots … no outline showed up"). The outline of the lot a click lands on is
   * drawn the same frame, from the lot lines the map already holds (the outline set's `featureAt`), in the plan's own parcel colour and in the
   * Parcels-in-front pane (so it is above everything). The county's point query is still the authority (B137): the flash is removed the moment
   * it answers — by the real parcel, or by the honest "no lot". Skipped over a lot the plan already has (that one is outlined already, and a
   * re-click removes it — a flash there would promise the opposite). */
  const clearLotFlash = () => { const f = lotFlashRef.current; lotFlashRef.current = null; if (f) { try { f.remove(); } catch (_) { /* map gone */ } } };
  const flashLotAt = (fp) => {
    clearLotFlash();
    const set = outlineLayersRef.current, m = geoMapRef.current;
    if (!set || !m || !origin || !fp) return;
    if (parcelAtPoint(stateRef.current.parcels || [], fp)) return;
    const [lat, lng] = feetToLatLng(fp, origin.lat, origin.lon);
    const feat = set.featureAt(lat, lng);
    const geom = feat && feat.geometry;
    if (!geom || !geom.coordinates) return;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    const latlngs = polys.map((rings) => rings.map((r) => r.map(([x, y]) => [y, x])));
    if (!latlngs.length) return;
    try {
      lotFlashRef.current = L.polygon(latlngs, { pane: m.getPane(PANE_PARCEL_PICK) ? PANE_PARCEL_PICK : "overlayPane", interactive: false, color: PAL.parcel, weight: 2.5, opacity: 1, fillColor: PAL.parcel, fillOpacity: 0.16, className: "lot-click-flash" }).addTo(m);
    } catch (_) { lotFlashRef.current = null; }
  };
  const quickAddAt = async (fp, ack = null) => {
    if (!origin) { ack?.cancel(); setIdentifyRes({ error: "This plan isn't georeferenced — bring the parcel in from the map." }); return; }
    const tok = ++identifyTok.current; // a later click supersedes this one (B53)
    /* NEW-1 — the ring belongs to THIS click: a newer click (or Add-by-address) supersedes it, and
     * every way out below settles it, so it can never outlive its answer. `setRes` is the one exit. */
    ackRef.current?.cancel(); ackRef.current = ack;
    let settled = false;
    const setRes = (r) => {
      settled = true;
      if (tok === identifyTok.current) clearLotFlash(); // the real parcel (or the honest "no lot") takes over from the instant outline
      if (tok === identifyTok.current) {
        if (r && r.error) ack?.empty(r.noLot ? "No lot here" : "Couldn't get that lot"); else ack?.done();
      }
      setIdentifyRes(r);
    };
    /* NEW-1 — the county request goes out BEFORE the busy-state render. Setting state first made React
     * render this whole component (a ~150 ms long task on a real plan) ahead of the fetch, so the query
     * started ~190 ms late. The busy text now paints in a following task — and only if no answer beat it. */
    setTimeout(() => { if (!settled && tok === identifyTok.current) { setJurInfo(null); setIdentifyRes({ busy: true }); } }, 0);
    try {
      const [lat, lng] = feetToLatLng(fp, origin.lat, origin.lon);
      await ensureCountyGeometryAt(lat, lng); // NEW-1 (Memphis radius ×2) — name the county even on an early click
      // NEW-1 (parcel routing) — candidates for THIS point, not the site's frozen county.
      const { candidates } = await candidatesAtPoint(lat, lng);
      if (tok !== identifyTok.current) return;
      const nearSources = await neighbourCandidatesAt(lat, lng); // NEW-1 (Memphis line band) — a county across a nearby line
      if (tok !== identifyTok.current) return;
      if (!candidates.length && !nearSources.length && !(await skippedCandidatesAt(lat, lng)).length) {
        const gap = parcelGapNotice(countyIdentity(lat, lng), { lat, lng });
        setRes({ error: gap ? `${gap.message} You can still trace the lot from the aerial.` : "Parcel services are still loading — give it a second and click again.", ...(gap ? { request: gap.href } : {}) });
        return;
      }
      const res = await identifyWithLineFallback({
        primary: candidates, lng, lat, neighbours: () => nearSources, skipped: () => skippedCandidatesAt(lat, lng),
        fallbacks: async ({ silent }) => filterHealthyCandidates(await fallbackCandidates(fallbackSpecsFor({ failed: silent, lat, lng }), resolveOneCountyLayer), STATEWIDE_KEYS), // NEW-2 — the county did not answer: its state's layer (where it holds the county), then a town layer
        onSettled: (sources) => sources.forEach((s) => recordSourceResult(s.county, s.ok, Date.now(), { ms: s.ms })),
      });
      if (tok !== identifyTok.current) return; // superseded by a newer click
      if (!res.hits.length) {
        // NEW-2 — say the TRUE reason instead of blaming the user's aim: a healthy source
        // genuinely found no lot here, this county has no parcel source wired at all, or every
        // source that could have answered this point was unreachable this click.
        const gap = parcelGapNotice(countyIdentity(lat, lng), { lat, lng });
        // NEW-1 (Memphis line band) — a county with no source only asked a NEIGHBOUR; its silence is not this county's outage.
        if (res.responded === 0 && !(gap && !candidates.length)) { setRes({ error: `${silentServerPhrase(res.silent)} isn't responding right now — try again in a moment.` }); return; }
        setRes({ error: gap ? `${gap.message} You can still trace the lot from the aerial.` : "No parcel right there — click directly on a lot (zoom in if the outlines aren't showing).", noLot: true, ...(gap ? { request: gap.href } : {}) });
        return;
      }
      const hit = res.hits[0]; // first county whose service answered owns the lot
      const feat = hit.feature;
      const rings = outerRingsLngLat(feat); // every part of a multipart parcel
      if (!rings.length) { setRes({ error: "That record has no polygon shape — try an adjacent lot." }); return; }
      const attrs = feat.attributes || {};
      const addr = situsFor(hit.county, attrs); // NEW-2 — the SITUS, never the owner's mailing address (shared ladder); a county that declares split situs columns is composed (addrParts)
      const key = parcelGisKey(attrs, rings, hit.county);
      // Re-click a lot added THIS session → toggle it back off.
      if (identifyAddedRef.current.has(key)) {
        const ids = identifyAddedRef.current.get(key);
        identifyAddedRef.current.delete(key);
        pushHistory();
        setParcels((a) => a.filter((p) => !ids.includes(p.id)));
        tombstone(ids); // NEW-1 — the toggled-off identify lot(s) stay gone across a merge + a multipart lot's ≥2 drop doesn't trip the thin-clobber guard
        setSel(null); setIdentAdded(identifyAddedRef.current.size);
        setRes({ removed: true, addr });
        return;
      }
      // Already in the plan from before → select + inform, never add a duplicate.
      const dupe = (stateRef.current.parcels || []).filter((p) => storedParcelKey(p) === key || p.gisKey === key); // recomputed from attrs — legacy geo: gisKeys still match; a lot keyed by its stack field (pid:) matches its own stored gisKey
      if (dupe.length) {
        setSel({ kind: "parcel", id: dupe[dupe.length - 1].id });
        setRes({ already: true, addr });
        return;
      }
      const pcs = parcelsFromRings(rings, addr, attrs, hit.county);
      if (!pcs.length) { setRes({ error: "That record has no usable polygon — try an adjacent lot." }); return; }
      pushHistory();
      setParcels((a) => [...a, ...pcs]);
      identifyAddedRef.current.set(key, pcs.map((p) => p.id));
      setIdentAdded(identifyAddedRef.current.size);
      setSel({ kind: "parcel", id: pcs[pcs.length - 1].id });
      // `ring` (largest part) drives the jurisdiction/road tests; keep attrs for the card.
      setRes({ added: true, attrs, rings, ring: largestRingLngLat(feat), lng, lat, addr, county: hit.county, stackNote: stackNote(feat), ...(hit.fallback ? { fromFallback: fallbackNoticeText({ failedKey: hit.fallback.failed, label: hit.fallback.label }) } : {}) });
    } catch (e) { if (tok === identifyTok.current) setRes({ error: humanizeError(e) }); }
  };
  // B384 — "Add by address": geocode a typed address (biased to the plan's origin), project the
  // hit into the site's feet frame, and run the SAME identify-and-add path (quickAddAt) the click
  // flow uses. One pipeline (shared lib/geocode + the existing quickAddAt) — never a fork (B383).
  const addByAddress = async () => {
    const q = addrQuery.trim();
    if (!q || addrBusy) return;
    if (!origin) { setIdentifyRes({ error: "This plan isn't georeferenced — bring a parcel in from the map first." }); return; }
    setAddParcelMenu(false);
    ensureBasemapOn(); setJurInfo(null);
    setAddrBusy(true); setIdentifyRes({ busy: true, geo: true });
    try {
      /* NEW-1 (Meriwether GA, 2026-11-24) — a typed parcel NUMBER ("023 012", "069A 009") is looked up in the county the plan sits in (lib/viewParcelId.js, the same front door as the Map's search)
       * and the lot added; a miss says where it looked, a server that did not answer says so. Anything that is not a number goes to the geocoder as before. */
      if (looksLikeParcelNumber(q)) {
        const { resolveViewParcelId, viewParcelIdMessage } = await import("./viewParcelId.js");
        const vr = await resolveViewParcelId(q, { lat: origin.lat, lng: origin.lon });
        if (vr.status === "found") {
          const [fp] = lngLatRingToFeet([[vr.point.lng, vr.point.lat]], origin.lon, origin.lat);
          setAddrQuery("");
          await quickAddAt(fp);
          return;
        }
        if (vr.status === "notfound" || vr.status === "unavailable") { setIdentifyRes({ error: viewParcelIdMessage(vr, q) }); return; }
      }
      const hit = await geocodeAddress(q, { lat: origin.lat, lng: origin.lon });
      if (hit && hit.error) { setIdentifyRes({ error: hit.error }); return; } // B540: service unreachable ≠ not found
      if (!hit) { setIdentifyRes({ error: `Couldn't find "${q}" — try a fuller street address.` }); return; }
      const [fp] = lngLatRingToFeet([[hit.lon, hit.lat]], origin.lon, origin.lat);
      setAddrQuery("");
      await quickAddAt(fp); // identifies the lot at the geocoded point and adds it (or reports no lot there)
    } finally { setAddrBusy(false); }
  };
  // Light up the county parcel outlines on the basemap while identify mode is armed
  // (B383) — the SAME parcel-outline layers the map's Select-parcels tool uses
  // (makeParcelDisplayLayer: magenta vector lines for a queryable CAD, a server /export
  // image for the query-disabled statewide source). Turn the aerial on so there's
  // context to see them over; pull the layers + reset the session toggle-set when
  // identify mode ends.
  // NEW-1 (parcel routing) — every configured county lights up, not only the site's frozen
  // `siteCounty`: this is the same set `candidatesAtPoint` will ever route a click to, so
  // panning out of the site's original county still shows lots there (and a click there still
  // selects them) instead of going dark, exactly like the Map view already does.
  useEffect(() => {
    if (!origin) return;
    if (!identifyMode) { identifyAddedRef.current = new Map(); setIdentAdded(0); setOutlinePhase("none"); setOutlineRefused(false); return; }
    ensureBasemapOn(); // make sure the aerial is on so the lit outlines have context
    /* B2024624 — ONE source per AREA, following the VIEW (lib/parcelOutlineSet.js). This used
     * to mount every county source in the country (36+ full-viewport images) and the statewide
     * composite sat under the county's own layer, flashing gold whenever the county image reloaded. */
    const set = createOutlineSet({
      getMap: () => geoMapRef.current,
      boundsOf: (m) => { const b = m.getBounds(); return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }; },
      resolveUrl: (key) => resolveOneCountyLayer(key),
      // NEW-1 (2026-10-04) — Planyr draws the county lot numbers; they must clear this plan's own parcel chips.
      /* NEW-1 — the county lots on offer mount in the Parcels-in-front panes (a host INSIDE the plan SVG, under the plan's own
       * parcels), so a building / overlay / markup / GIS layer can never cover a lot you are picking. LOUD-FAILURE: if the host
       * is not there the lots would silently draw UNDER the plan again, so say so and fall back to the old pane. */
      makeLayer: (url) => {
        const m = geoMapRef.current;
        const hosted = !!(m && m.getPane(PANE_PARCEL_PICK) && m.getPane(PANE_PARCEL_PICK_LABEL));
        if (!hosted) console.error("[planyr] the Parcels-in-front panes are missing — county lots would draw under the plan");
        return makeParcelDisplayLayer(url, {
          getObstacles: () => lotNoObstaclesRef.current(), getInset: () => lotNoInsetRef.current,
          wide: true, // NEW-1 (click-a-lot) — the larger lots from two zoom steps further out, exactly like the Map's picker (parcelWideLayer.js); a source with no verified size column keeps its own floor
          ...(hosted ? { pane: PANE_PARCEL_PICK, labelPane: PANE_PARCEL_PICK_LABEL } : null),
        });
      },
      sourcesForView: displaySourcesForView,
      statewideKeysForState,
      stateOf: (k) => COUNTIES_MAP[k] && COUNTIES_MAP[k].state,
      isStatewideUrl: isStatewideLayerUrl,
      scopeFor: statewideBackupScope, // a failed county's statewide backup draws only that county, not the whole view
      coversCounty: stateLayerCoversCounty, // NEW-2 — a state layer that declares the failed county missing is never pulled in for it
      onChange: () => { const st = set.status(); setOutlinePhase(st.phase); setOutlineRefused(!!st.refused); },
    });
    outlineLayersRef.current = set;
    setOutlinePhase("loading"); // the tool is armed: outlines are on their way until the set says otherwise
    let map = null, poll = null, tries = 0;
    const onMoved = () => set.sync();
    let gone = false;
    // The aerial may only be mounting now (basemap was off) — wait for the map, then follow its view.
    const attach = () => {
      poll = null;
      const m = geoMapRef.current;
      if (!m) { if (++tries < 40) poll = setTimeout(attach, 250); else setOutlinePhase("none"); return; }
      map = m; m.on("moveend", onMoved); set.sync();
    };
    /* NEW-1 (Add parcels) — the larger-lots module + the verified size-column table load BEFORE the first layer is built (`makeParcelLayer` reads
     * them once, at build): a layer built first would never get its band. A failed load is reported by the loader and leaves today's floor. */
    const ready = Promise.resolve(wideViewReady()).catch(() => null);
    ready.then(() => { if (!gone) attach(); });
    // Until the county geometry is resident the view answer is bbox-overlap (over-inclusive); re-ask once it lands so a neighbour's layer is released.
    Promise.all([ready, Promise.resolve(loadCountyPolygons()).catch(() => null)]).then(() => { if (!gone) set.sync(); });
    // Batch K stage 2 — and again when a state's county table lands (the view answer is `pending` until the rows of the state it is over are in).
    const offTables = onParcelTablesLoaded(() => { if (!gone) set.sync(); });
    return () => {
      gone = true;
      offTables();
      clearLotFlash();
      if (poll) clearTimeout(poll);
      if (map) map.off("moveend", onMoved);
      set.dispose();
      outlineLayersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifyMode, origin]);
  return { countyLayerUrlsRef, countyLayerUrlsInflightRef, resolveOneCountyLayer, candidatesAtPoint, neighbourCandidatesAt, skippedCandidatesAt, parcelGisKey, parcelsFromRings, clearLotFlash, flashLotAt, quickAddAt, addByAddress };
}
