/* @planner-extract — AUDIT BATCH G4: the planner's `window.__planner*` diagnostic / E2E hooks (view changes, layers, hit target, foreign overlays, grading readout, export sheet, road network, …) that used to be thirteen separate effects inside the SitePlanner component. Moved verbatim into ONE hook that receives the values they read; every hook stays read-only and gated exactly as before (`isDiagArmed` / `__PLANYR_E2E`). Behaviour-identical; see test/helpers/plannerSource.js. */
import { useEffect } from "react";
import { installPlannerPerf } from "./plannerPerf.js";
import { isDiagArmed, latchDiagArm } from "./diagArm.js";
import { attachTimeline } from "./viewChangeRecorder.js";
import { liveRefOpacities, liveRefFeatureCount } from "./layers.js";
import { rectEdges } from "./roadGeometry.js";
import { isCenterlineRoad } from "./siteGeometry.js";
import { readoutDashFacts } from "./readoutDash.js";
import { propertyLineRings, driveDiagnose } from "./driveGrade.js";

export function usePlannerDiagnostics(p) {
  const { PAL, dblResolveRef, dblWhyRef, drag, driveJunctions, duplicateOverlay, els, exportCtx, foreignOverlays, grFitDoorRef, grOn, gradeDriveRef, gradeReadoutRef, gsStatsRef, identifyResRef, lastGridRef, layerIdentityEpoch, loadExportSheet, outlineLayersRef, overlayRefs, overlays, overlaysDrawn, plannerPerfRef, probeRef, refreshSiblings, removeOverlay, roadNet, setOverlayCrop, setOverlayPage, setView, showForeignOverlay, siteId, size, stateRef, teeJunctions, view, viewIdentityEpoch, viewRecRef } = p;
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const rec = viewRecRef.current;
    const hook = () => (rec && isDiagArmed(window) ? rec.snapshot() : null);
    window.__plannerViewChanges = hook;
    const detach = rec ? attachTimeline(window, rec) : null;
    if (rec) rec.noteEvent("planner:mount");
    return () => {
      if (window.__plannerViewChanges === hook) window.__plannerViewChanges = null;
      if (rec) rec.noteEvent("planner:unmount");
      if (detach) detach();
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || !window.__PLANYR_E2E) return;
    const hook = {
      get: () => ({ ...view, w: size.w, h: size.h, identityEpoch: viewIdentityEpoch.current }),
      centerOn: (fx, fy, ppf) => setView(() => ({ ppf, offX: size.w / 2 - fx * ppf, offY: size.h / 2 - fy * ppf })),
      // read-only probes (NEW-2): the registration shift actually applied, the cursor's own
      // feet/lat-lng answer, and the committed measure geometry a placed point lands in.
      registration: () => ({ ...probeRef.current.regShift }),
      cursor: () => (probeRef.current.cursorLL
        ? { ft: { ...probeRef.current.cursorFt }, lat: probeRef.current.cursorLL.lat, lng: probeRef.current.cursorLL.lng }
        : null),
      measures: () => JSON.parse(JSON.stringify(probeRef.current.measures || [])),
    };
    window.__plannerView = hook;
    /* NEW-3 — NULL IT ON UNMOUNT. These hooks close over the live render (`setView`, `probeRef`,
       `exportCtx()` → `svgRef`/`wrapRef`), so a hook left on `window` after the component unmounts
       keeps that whole tree — and its detached SVG — reachable from a GC root. The neighbouring
       `window.__geoMap` hook (:2612) has always done this; these four did not. It is dev-gated
       code, but it is dev-gated code that EVERY performance harness here arms, so a measurement
       taken through it was measuring the instrument as much as the product (B1439). */
    return () => { if (window.__plannerView === hook) window.__plannerView = null; };
  }, [view, size.w, size.h, setView]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.__PLANYR_E2E) return;
    layerIdentityEpoch.current += 1;
    const epoch = layerIdentityEpoch.current;
    const hook = () => ({
      ids: Object.keys(overlays || {}),
      on: Object.keys(overlays || {}).filter((k) => overlays[k] && overlays[k].on),
      // NEW-1 (Imagery & Layers) — what the map is actually told to draw (Hide Layers / hidden-here applied) and what has a LIVE layer right now.
      drawn: Object.keys(overlaysDrawn || {}).filter((k) => overlaysDrawn[k] && overlaysDrawn[k].on),
      live: Object.keys(overlayRefs.current || {}).filter((k) => overlayRefs.current[k] && overlayRefs.current[k] !== "pending"),
      // What each live layer is really drawn at (NEW-2: "set 60% on an off layer" is asserted on the map's own layer, not the saved number).
      opacities: Object.fromEntries(Object.keys(overlayRefs.current || {}).map((k) => [k, liveRefOpacities(overlayRefs.current[k])])),
      // B2528688 — features each live vector layer has painted (null for a raster): the harness's "it drew real features" observable.
      features: Object.fromEntries(Object.keys(overlayRefs.current || {}).map((k) => [k, liveRefFeatureCount(overlayRefs.current[k])])),
      identityEpoch: epoch,
      /* B2472945 — what a live vector layer has PAINTED at a point (its own `identifyAt`, the same hit-test the canvas click uses over the
       * same GeoJSON the map draws). The drawn ETJ layer's "is anything shaded here?" has no other observable: the DOM holds Leaflet
       * paths, not ground truth. Read-only, E2E-gated, null for a layer that is off or has no identify. */
      identify: (id, at) => { const g = overlayRefs.current && overlayRefs.current[id]; return g && g !== "pending" && typeof g.identifyAt === "function" ? g.identifyAt(at) : null; },
    });
    window.__plannerLayers = hook;
    return () => { if (window.__plannerLayers === hook) window.__plannerLayers = null; };
  }, [overlays, overlaysDrawn]);
  /* ⛔ NEW-1 (B280403) — INSTALLED UNCONDITIONALLY, ANSWERED ONLY WHEN ARMED, AND THE GATE IS READ AT
   * CALL TIME. These two are the DIAGNOSTIC hooks, and they were gated the way every other probe
   * here is: on `window.__PLANYR_E2E`, read once at mount by an effect with `[]` deps. That made
   * them unreachable in the one place the defects they exist for actually live — the owner's
   * signed-in production tab — because arming the flag there did nothing until `SitePlanner`
   * remounted. The session that needed them got in by setting the flag and then switching plans and
   * back, which is folklore that requires knowing this dependency array.
   * Now: the functions always exist and return `null` until `isDiagArmed()` says otherwise, so
   * arming can never require a remount. `?planyrDiag=1` arms a tab with no console at all (it
   * latches into sessionStorage so an in-app plan switch keeps it); `window.__PLANYR_E2E = true`
   * still works, so every existing harness is untouched. READ-ONLY: they answer questions, they
   * change nothing — see lib/diagArm.js for why that boundary is the whole safety argument. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    latchDiagArm(window);
    const hook = (x, y) => (isDiagArmed(window) && dblResolveRef.current ? dblResolveRef.current(x, y) : null);
    const why = (x, y) => (isDiagArmed(window) && dblWhyRef.current ? dblWhyRef.current(x, y) : null);
    window.__plannerHitTarget = hook;
    window.__plannerHitWhy = why;
    return () => {
      if (window.__plannerHitTarget === hook) window.__plannerHitTarget = null;
      if (window.__plannerHitWhy === why) window.__plannerHitWhy = null;
    };
  }, []);
  // E2E/self-audit hook (same `window.__PLANYR_E2E` gate as the others; read-only answers + the same two
  // actions the panel row calls — it is a driver for the live acceptance, not a second code path).
  useEffect(() => {
    if (typeof window === "undefined" || !window.__PLANYR_E2E) return;
    const hook = {
      siteId: () => siteId,
      rows: () => foreignOverlays.rows.map((r) => ({ key: r.key, planName: r.planName, name: r.overlay.name, page: r.overlay.page || 1 })),
      status: () => ({ status: foreignOverlays.status, error: foreignOverlays.error }),
      refresh: () => refreshSiblings(),
      show: (key) => showForeignOverlay(foreignOverlays.rows.find((r) => r.key === key)),
      remove: (id) => removeOverlay(id),
      crop: (id, crop) => setOverlayCrop(id, crop), // the exact write the Crop… dialog commits through
      duplicate: (id) => duplicateOverlay(id),
      setPage: (id, page) => setOverlayPage(id, page),
      own: () => stateRef.current.sheetOverlays.map((o) => ({ id: o.id, name: o.name, page: o.page || 1, x: o.x, y: o.y, crop: o.crop || null, sharedFrom: o.sharedFrom || null, storageKey: o.storageKey || null, idbKey: o.idbKey || null, hasSrc: !!o.src })),
    };
    window.__plannerForeign = hook;
    return () => { if (window.__plannerForeign === hook) window.__plannerForeign = null; };
  });
  useEffect(() => {
    if (typeof window === "undefined" || !grOn) return undefined;
    const hook = () => {
      if (!(window.__PLANYR_E2E || isDiagArmed(window))) return null;
      const L = gradeReadoutRef.current || {}, st = gsStatsRef.current || {};
      const kept = lastGridRef.current, grid = (L.gradeSurface && L.gradeSurface.grid) || (L.grOn ? kept : null);
      const f = grid && L.cursor ? readoutDashFacts(grid, L.cursor, L.cursorProp, !(L.gradeSurface && L.gradeSurface.grid)) : null;
      const now = Date.now();
      return {
        enabled: !!L.gsEnabled, grOn: !!L.grOn, hasBuilt: !!(L.gradeSurface && L.gradeSurface.grid), hasKept: !!kept,
        buildSeq: st.buildSeq || 0, lastBuildMs: st.lastBuildMs ?? null, lastBuildOutcome: st.lastBuildOutcome || null,
        isDragging: !!drag.current, sigChangesLast10s: (st.sigChanges || []).filter((t) => now - t <= 10000).length,
        cursor: L.cursor ? { x: Math.round(L.cursor.x * 10) / 10, y: Math.round(L.cursor.y * 10) / 10 } : null,
        cursorStatus: L.cursorProp ? L.cursorProp.status : null, cursorReason: L.cursorProp ? L.cursorProp.reason || (L.cursorProp.undisturbed ? "undisturbed" : null) : null,
        cursorFt: L.cursorProp && Number.isFinite(L.cursorProp.ft) ? Math.round(L.cursorProp.ft * 10) / 10 : null,
        inLimit: f ? f.inLimit : null, limitMode: f ? f.mode : null, limitRegionCount: f ? f.limitRegionCount : 0, limitBbox: f ? f.limitBbox : null,
        cursorBbox: L.cursor ? [L.cursor.x, L.cursor.y, L.cursor.x, L.cursor.y].map((v) => Math.round(v * 10) / 10) : null,
      };
    };
    window.__plannerGradeReadout = hook;
    return () => { if (window.__plannerGradeReadout === hook) window.__plannerGradeReadout = null; };
  }, [grOn]);
  useEffect(() => {
    if (typeof window === "undefined" || !grOn) return undefined;
    const hook = () => {
      if (!(window.__PLANYR_E2E || isDiagArmed(window))) return null;
      const L = gradeDriveRef.current || {};
      const surf = L.gradeSurface || null, planes = surf && surf.planes ? surf.planes : new Map(), why = surf && surf.driveWhy ? surf.driveWhy : new Map();
      const line = propertyLineRings(L.grDriveParcels || []);
      const roads = (L.els || []).filter(isCenterlineRoad).map((e) => {
        const tie = L.grDriveTies && L.grDriveTies.get(e.id);
        const pl = planes.get(e.id);
        return {
          id: e.id, travelW: e.travelW ?? null, points: e.pts.length, ends: [e.pts[0], e.pts[e.pts.length - 1]].map((q) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 })),
          diagnose: driveDiagnose(e.pts, line), tied: !!tie, inGraded: !!(L.gsEls || []).find((g) => g.id === e.id && g.type === "drive"),
          plane: pl && pl.drive ? { zTie: Math.round(pl.drive.zTie * 10) / 10, zEnd: Math.round(pl.drive.zEnd * 10) / 10, lengthFt: Math.round(pl.drive.lengthFt), gradePct: Math.round(pl.drive.gradePct * 10) / 10, tooSteep: !!pl.drive.tooSteep, target: pl.drive.targetId, servedBy: pl.drive.servedBy || null, nearestElementFt: pl.drive.nearestFt != null ? Math.round(pl.drive.nearestFt) : null } : null,
          notAPlaneBecause: why.get(e.id) || null,
        };
      });
      const out = surf && surf.grid && surf.grid.outside ? surf.grid.outside : null;
      return {
        grOn: !!L.grOn, hasSurface: !!surf, build: surf ? surf.surfaceKey && String(surf.surfaceKey).length : null, roads,
        pastLine: out ? { cells: out.count, beyondParcel: out.beyondParcel ?? null, perElement: Object.entries(out.perEl || {}).map(([id, p]) => ({ id, type: ((L.gsEls || []).find((g) => g.id === id) || {}).type || null, cells: p.count, maxPastFt: Math.round(p.maxPastFt * 10) / 10, at: { x: Math.round(p.centroid.x), y: Math.round(p.centroid.y) } })) } : null,
      };
    };
    window.__plannerGradeDrive = hook;
    return () => { if (window.__plannerGradeDrive === hook) window.__plannerGradeDrive = null; };
  }, [grOn]);
  useEffect(() => {
    if (typeof window === "undefined" || !grOn) return undefined;
    const hook = installPlannerPerf(window, { extra: () => { const P = plannerPerfRef.current || {}; return { ppf: Number.isFinite(P.ppf) ? Math.round(P.ppf * 1000) / 1000 : null, gradingPlanOn: !!P.gsEnabled, lastGradeBuildMs: P.buildMs }; } });
    return () => { if (window.__plannerPerf === hook) window.__plannerPerf = null; };
  }, [grOn]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.__PLANYR_E2E) return undefined;
    const hook = { source: (...a) => grFitDoorRef.current.source(...a), apply: (...a) => grFitDoorRef.current.apply(...a) };
    window.__plannerFit = hook;
    return () => { if (window.__plannerFit === hook) window.__plannerFit = null; };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const hook = () => (window.__PLANYR_E2E ? identifyResRef.current : null);
    window.__plannerIdentifyResult = hook;
    return () => { if (window.__plannerIdentifyResult === hook) window.__plannerIdentifyResult = null; };
  }, []);
  /* B2024624 — read-only diagnostic: which outline sources the click-a-lot mode has mounted. Gated at CALL
   * time (diagArm.js), writes nothing; the acceptance for "no nationwide fan-out" reads this. */
  useEffect(() => {
    const hook = () => (isDiagArmed(window) && outlineLayersRef.current ? { mounted: outlineLayersRef.current.mounted(), ...outlineLayersRef.current.status() } : null);
    window.__plannerParcelOutlines = hook;
    return () => { if (window.__plannerParcelOutlines === hook) window.__plannerParcelOutlines = null; };
  }, []);
  // E2E/self-audit hook (same `window.__PLANYR_E2E` gate as above; never runs in production) — lets the
  // headless regression assert the DISSOLVED geometry (region count, holes, curb-return radii) directly
  // instead of inferring it from pixels.
  useEffect(() => {
    if (typeof window === "undefined" || !window.__PLANYR_E2E) return;
    const hook = () => ({
      regions: roadNet.regions.map((r) => ({ ids: r.ids, outer: r.region.outer, holes: r.region.holes })),
      tees: teeJunctions.map((t) => ({ sideId: t.sideId, throughId: t.throughId, R: t.geom.R, wedges: t.geom.wedges.length, returns: t.geom.returns.map((a) => a.length), cornerR: t.geom.gaps.map((g) => g.R), arcs: t.geom.gaps.map((g) => (g.a === 2 || g.b === 2) && g.R > 0 ? g.arc.map((p) => ({ x: p.x, y: p.y })) : null) })),
      /* NEW-1/NEW-2 (2026-10-15) — what the junction-paint acceptance reads: where each road's decoration may paint (`deco`, rings in world feet) and the
         trimmed face-of-curb stripes (`stripes`), against the dissolved `regions` above. */
      roads: (els || []).filter((e) => isCenterlineRoad(e) && !e.attachedTo).map((e) => ({ id: e.id, pts: e.pts.map((p) => ({ x: p.x, y: p.y })) })),   // AFTER the load-time cleanup — what the geometry is really built from
      deco: [...(roadNet.decoDomains || [])].map(([id, rings]) => ({ id, rings })),
      /* NEW-1 (road → parking) — what each car field does about the roads around it: the stalls a drive took (`removed` = "band:column" cells, `count` = what the Yield
         reads) and the openings in its outline (`mouths`, world feet). Read-only; same E2E gate. */
      stallClips: [...(roadNet.stallClips || [])].map(([id, c]) => ({ id, base: c.base, count: c.count, removed: c.removed.map((r) => `${r.band}:${r.k}`) })),
      mouths: [...(roadNet.mouths || [])].map(([id, m]) => ({ id, mouths: m.map((x) => ({ a: { x: x.a.x, y: x.a.y }, b: { x: x.b.x, y: x.b.y } })) })),
      stripes: [...(roadNet.stripes || [])].map(([id, lines]) => ({ id, lines })),
      // B<NEW-1> (2026-09-18) — the fillet's own CORNERS and TANGENT ARCS ride along too, so a live
      // harness can measure whether a curb return SURVIVED the dissolve rather than only that one was
      // requested. Six rounds of this item shipped green because every check read the requested arc
      // (`returns`, below, which is always complete) and none read the finished boundary against it;
      // the corner is what makes that comparison possible (a complete return of radius R across a
      // wedge angle phi stands exactly R/sin(phi/2) - R off its own corner). Read-only, same
      // `window.__PLANYR_E2E` gate as everything else in this hook, never in production.
      drives: driveJunctions.map((d) => ({
        sideId: d.sideId, targetId: d.targetId, kind: d.kind, R: d.geom.R, wedges: d.geom.wedges.length, cornerR: (d.geom.returns || []).map(() => d.geom.R),
        corners: d.geom.corners, throughTangents: d.geom.throughTangents, sideTangents: d.geom.sideTangents,
        returns: d.geom.returns.map((a) => a.map((p) => ({ x: p.x, y: p.y }))),
      })),
      // NEW-4 — the drive target's own PAVED ring, in world feet, for a flood-fill acceptance check
      // (ui-audit/verify-road-junction-paving.mjs): "is (pad ∪ every dissolved road region) free of
      // an enclosed unpaved cell" needs the pad's real geometry, not just the road network's.
      pads: driveJunctions.map((d) => {
        const T = (els || []).find((e) => e.id === d.targetId);
        if (!T) return null;
        if (Array.isArray(T.points) && T.points.length >= 3) return { targetId: T.id, ring: T.points };
        if (typeof T.cx === "number" && T.w > 0 && T.h > 0) {
          return { targetId: T.id, ring: rectEdges(T.cx, T.cy, T.w, T.h, T.rot || 0).map((e) => e.a) };
        }
        return null;
      }).filter(Boolean),
    });
    window.__plannerRoadNet = hook;
    return () => { if (window.__plannerRoadNet === hook) window.__plannerRoadNet = null; }; // NEW-3 — see the note on __plannerView
  }, [roadNet, teeJunctions, driveJunctions, els]);
  /* NEW-1 — E2E/self-audit hook for the EXPORT SHEET (same `window.__PLANYR_E2E` gate; never runs in
     production). The measurement/export defect is invisible to any source reading — it only exists in
     the CLONE the sheet is built from — so the guard spec has to inspect the real built sheet. No dep
     array on purpose: `exportCtx()` closes over the current render, and the hook must never hand the
     sheet a stale one. */
  useEffect(() => {
    if (typeof window === "undefined" || !window.__PLANYR_E2E) return;
    const hook = async (frame = null) => {
      const { createExportSheet } = await loadExportSheet();
      const built = createExportSheet(exportCtx())
        .buildExportSvg(frame, true, PAL.paper, null, null, false, null, "letter", "landscape");
      return built && built.clone ? built.clone.outerHTML : null;
    };
    window.__plannerExportSvg = hook;
    /* NEW-1 (print ignores send-to-back) — the REAL editable-PDF composition (the default "Flatten markups" OFF
       path): which annotations became native PDF annotations (they paint ABOVE the page) and which stayed in the
       page picture. Read-only; same gate. */
    const composedHook = async (o = {}) => {
      const { createExportSheet } = await loadExportSheet();
      // `o` (E2E only): { paper, orient, buildingsTable, annotate, scaleBar, scaleText } — the sheet shape under test; defaults are the editable-PDF Letter sheet
      const c = await createExportSheet(exportCtx()).buildComposedSheet(o.paper || "letter", o.orient || "landscape", true, true, o.scaleText || "", "", true, o.page || null, o.buildingsTable !== false, o.annotate !== false, o.scaleBar !== false);
      if (!c) return null;
      return {
        sheetSvg: c.sheetSvg,
        annotRects: (c.annotationSet?.annots || []).map((a) => ({ nm: a.nm, family: a.family, subtype: a.subtype, rect: a.rect })),
        liftedIds: (c.annotationSet?.annots || []).length,
        keptInPage: c.annotationsKeptInPage || 0,
        pins: c.annotationPins || [],
        annots: (c.annotationSet?.annots || []).map((a) => ({ subtype: a.subtype, nm: a.nm, subj: a.subj, contents: a.contents, family: a.family, kind: a.kind })),
        degraded: c.annotationSet?.degraded || [],
        hasViewport: !!c.annotationSet?.viewport, // the PDF's embedded measurement scale (/VP + /Measure) — independent of the drawn scale bar
      };
    };
    window.__plannerExportComposed = composedHook;
    /* NEW-1 (2026-10-20) — the feet → clone-unit map the export used, as an affine (origin, +x foot, +y foot), so a test
       fixture captured from __plannerExportSvg can be replayed through the extractor in node. Read-only; same gate. */
    const f2pHook = () => { const c = exportCtx(); return [c.f2p({ x: 0, y: 0 }), c.f2p({ x: 1, y: 0 }), c.f2p({ x: 0, y: 1 })]; };
    window.__plannerExportF2p = f2pHook;
    return () => { if (window.__plannerExportSvg === hook) window.__plannerExportSvg = null; if (window.__plannerExportComposed === composedHook) window.__plannerExportComposed = null; if (window.__plannerExportF2p === f2pHook) window.__plannerExportF2p = null; }; // NEW-3 — see the note on __plannerView
  });
}
