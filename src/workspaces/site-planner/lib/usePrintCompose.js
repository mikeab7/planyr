/* @planner-extract — the print / compose flow of the Site Planner, as a TWO-PHASE hook (audit batch G2 step 2, B2671311, behaviour-identical move).
 *
 * WHY TWO PHASES: the print state (`printMode`, `printFrame`, `composeMode`, …) is READ at render time by code far above where its handlers can
 * live (the keyboard effect's deps, the frame overlay, `printAspect`, the export context), while the handlers need functions the planner declares much
 * later (`devExtent`, `printMetricPairs`, `p2fStatic`, …). One hook call therefore has no legal position, so:
 *   1. `usePrintState()` is called EARLY, where the old `useState` cells sat, and returns the cells + refs;
 *   2. `usePrintHandlers({ …state, …deps })` is called LATE, exactly where the old handler block sat, and carries the handlers AND the two effects
 *      that were interleaved with them (compose recompute, debounced live preview) in their ORIGINAL order, so hook order is unchanged.
 * `p2fStatic` is declared after the late call, so it arrives as a getter (`getP2fStatic`) and is read only at event time.
 * PDF-PARITY: the preview and the PDF still both go through `buildComposedSheet`; nothing here changes what is drawn. No import back from SitePlanner.jsx. */
import { useState, useRef, useEffect } from "react";
import { ALL_LAYERS } from "./layers.js";
import { getPrefsSnapshot } from "./userPrefs.js";
import { hasPrintableOverlay } from "./overlayPrint.js";
import { isBuilding } from "./siteModel.js";
import { scaleLabel, frameFootprintForScale, checkScaleFits } from "./printScale.js";
import { frameGripAnchor, orientationForAspect } from "./printFrameDrag.js";
export function usePrintState() {
  const [printMode, setPrintMode] = useState(false);     // print-frame placement mode
  const [printFrame, setPrintFrame] = useState(null);    // {cx, cy, wFt, hFt} feet — the crop to print
  const [printPaper, setPrintPaper] = useState("letter");   // "letter" | "tabloid"
  const [printOrient, setPrintOrient] = useState("landscape"); // "landscape" | "portrait"
  const [printOverlay, setPrintOverlay] = useState(true);   // include placed site-plan overlays in print/export (B131); re-defaulted to on-screen visibility on entering print mode
  const [printMapLayers, setPrintMapLayers] = useState(true); // include the live GIS map layers (floodplain, pipelines, …) in print/export (B739) — default on ("what I see prints")
  const [exportingPDF, setExportingPDF] = useState(false);  // NEW-1: PDF is being composed/rasterized (drives the "Preparing PDF…" indicator)
  // B765985 — the dedicated compose screen: entered after the on-canvas frame is picked.
  const [composeMode, setComposeMode] = useState(false);
  const [printScale, setPrintScale] = useState(null);     // explicit feet-per-inch (e.g. 40), or null = "Fit to frame" (today's behavior)
  const [fitWarning, setFitWarning] = useState(null);      // set when an explicit scale can't show the picked area on the chosen sheet — never silently rescaled
  // NEW-1 (B1783056) — the page itself takes the picked frame's own aspect (long edge at the
  // chosen paper size) instead of a fixed sheet shape. Mutually exclusive with an explicit
  // engineering scale (that mode already derives the frame FROM the sheet's plan box, which
  // would be circular against a page shaped by the frame) — each setter below stands the other down.
  const [printFitToFramePage, setPrintFitToFramePage] = useState(false);
  const [composePageOverride, setComposePageOverride] = useState(null); // { w, h, wIn, hIn } from pageSizeForFit, or null for a standard sheet
  const [composeBoxIn, setComposeBoxIn] = useState(null);  // { planW, planH, pageW, pageH } inches, resolved through the lazy export chunk
  const [composePreviewUrl, setComposePreviewUrl] = useState(null);
  const [composePreviewLoading, setComposePreviewLoading] = useState(false);
  const [composeDownloading, setComposeDownloading] = useState(false);
  const pickedFrameRef = useRef(null); // the frame as last picked/repositioned on canvas — the fit-check compares against THIS, never the scale-locked effective frame
  // NEW-1 (B1783056) — orientation AUTO-FLIPS to match the picked frame once, when compose is
  // entered (a default, not a lock); this latches true the moment the owner touches the
  // Landscape/Portrait control so that explicit choice sticks for the rest of THIS compose.
  const orientTouchedRef = useRef(false);
  const composePreviewUrlRef = useRef(null);
  const preCanvasDisplayRef = useRef(null); // showDims/showAreas as they were before entering print mode — restored when the whole print flow ends, so toggling them FOR A PRINT never leaves a lasting change on the editing view (Cancel's non-destructive contract, extended to a completed Download too)
  return { printMode, setPrintMode, printFrame, setPrintFrame, printPaper, setPrintPaper, printOrient, setPrintOrient, printOverlay, setPrintOverlay, printMapLayers, setPrintMapLayers, exportingPDF, setExportingPDF, composeMode, setComposeMode, printScale, setPrintScale, fitWarning, setFitWarning, printFitToFramePage, setPrintFitToFramePage, composePageOverride, setComposePageOverride, composeBoxIn, setComposeBoxIn, composePreviewUrl, setComposePreviewUrl, composePreviewLoading, setComposePreviewLoading, composeDownloading, setComposeDownloading, pickedFrameRef, orientTouchedRef, composePreviewUrlRef, preCanvasDisplayRef };
}

export function usePrintHandlers({ composeMode, composePageOverride, composePreviewUrlRef, devExtent, drag, els, exportPDF, loadExportSheet, orientTouchedRef, overlays, p2f, pickedFrameRef, preCanvasDisplayRef, printFitToFramePage, printFrame, printMapLayers, printMetricPairs, printOrient, printOverlay, printPaper, printScale, printStormwaterBars, setComposeBoxIn, setComposeDownloading, setComposeMode, setComposePageOverride, setComposePreviewLoading, setComposePreviewUrl, setExportMenu, setFitWarning, setPrintFitToFramePage, setPrintFrame, setPrintMode, setPrintOrient, setPrintOverlay, setPrintScale, setSel, setSettings, settings, sheetOverlays, showAerial, size, startGate, svgRef, withExportSheet, getP2fStatic }) {
  // p2fStatic is declared AFTER this hook's call site in SitePlanner (const, so reading it here would throw a TDZ error): a getter defers the read to event time.
  const p2fStatic = (px, py) => getP2fStatic()(px, py);
  /* ------------ print-frame placement ------------ */
  // The on-canvas crop matches the PRINTED PLAN BOX (B200), not the raw paper: the plan
  // box is the sheet minus the title block and the metrics band. So the frame the owner
  // draws is exactly what fills the printed plan area (WYSIWYG), computed from the same
  // layout the print routine uses.
  // B1042 — the layout that yields this aspect now lives in the lazy export chunk, but the
  // frame-resize DRAG reads the aspect on every pointermove, which can never await. So the
  // value is RESOLVED once per (paper · orientation · content) key and cached in a ref;
  // `printAspect()` stays a synchronous read. `refreshPrintAspect()` is awaited before print
  // mode is ever entered, so the ref is always populated before a frame exists to drag —
  // the fallback below is a last-resort guard, not a path the UI takes.
  const printAspectRef = useRef(null);
  const printAspect = () => printAspectRef.current || (11 / 8.5); // letter-landscape paper, guard only
  const refreshPrintAspect = async () => {
    const { sheetPlanAspect } = await loadExportSheet();
    printAspectRef.current = sheetPlanAspect({
      paper: printPaper, orient: printOrient,
      metricsPairs: printMetricPairs(), stormwaterBars: printStormwaterBars().length,
      includeMetrics: settings.printMetricsBand !== false,
    });
    return printAspectRef.current;
  };
  // A frame of the given aspect, centred at cx,cy, that contains a w×h area.
  const fitFrame = (cx, cy, w, h, aspect) => { const wFt = Math.max(w, h * aspect, 40); return { cx, cy, wFt, hFt: wFt / aspect }; };
  const enterPrintMode = async () => {
    const aspect = await refreshPrintAspect(); // resolves the lazy chunk before any frame exists
    const dev = devExtent();
    let base;
    if (dev) base = { cx: dev.cx, cy: dev.cy, w: dev.w + 80, h: dev.h + 80 };
    else { const a = p2fStatic(0, 0), b = p2fStatic(size.w, size.h); base = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: Math.abs(b.x - a.x) * 0.8, h: Math.abs(b.y - a.y) * 0.8 }; }
    setPrintFrame(fitFrame(base.cx, base.cy, base.w, base.h, aspect));
    setPrintOverlay(hasPrintableOverlay(sheetOverlays)); // default "Print overlay" to match on-screen visibility (WYSIWYG)
    preCanvasDisplayRef.current = { showDims: settings.showDims !== false, showAreas: settings.showAreas !== false };
    setPrintMode(true); setComposeMode(false); setExportMenu(false); setSel(null);
    import("./components/PrintCompose.jsx").catch(() => {}); // warm the compose chunk while the frame is being positioned — Continue shouldn't wait on a cold fetch
  };
  const overlayPrintable = hasPrintableOverlay(sheetOverlays); // gates the "Print overlay" checkbox — no dead control when nothing's loaded
  // B739 — is any RASTER GIS layer (floodplain, pipelines, wetlands, utilities, relief) turned on?
  // Gates the "Print map layers" checkbox so there's no dead control when no such layer is live.
  const mapLayersPrintable = Object.keys(ALL_LAYERS).some((id) => overlays?.[id]?.on); // B739 raster + B745 vector — any live layer prints
  const buildingsTablePrintable = els.some(isBuilding); // B1934529 — no dead "Buildings table" control on a plan with nothing to list
  const startPrintMove = (e) => {
    e.stopPropagation();
    const fp = p2f(e.clientX, e.clientY);
    drag.current = { mode: "printMove", fx: fp.x, fy: fp.y, cx: printFrame.cx, cy: printFrame.cy, ...startGate(e, { hist: false }) };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startPrintResize = (e, sx, sy) => {
    e.stopPropagation();
    // NEW-1 (B1783056) — `wFt0`/`hFt0` (the frame's size at drag start) are what an edge grip's
    // untouched axis holds onto for the whole gesture; frameGripAnchor/resizeFrame are the same
    // generic pair a corner grip uses, so there's one drag formula for all eight grips.
    drag.current = { mode: "printResize", sx, sy, opp: frameGripAnchor(printFrame, sx, sy), wFt0: printFrame.wFt, hFt0: printFrame.hFt, ...startGate(e, { hist: false }) };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  /* B765985 — THE COMPOSE SCREEN. Picking the frame (above) is unchanged; everything else —
   * paper, orientation, an explicit engineering scale, the title block, what's on the sheet —
   * now lives on a dedicated full-screen surface entered via "Continue". `pickedFrameRef`
   * holds the frame as last positioned on canvas; an explicit scale locks the EFFECTIVE frame
   * to a stated ratio (plan-box inches × ft-per-inch) around that same center, and if the
   * picked area doesn't fit at that ratio we say so — never silently rescale (`checkScaleFits`). */
  const recomputeCompose = async () => {
    const { sheetLayoutBoxesIn, pageSizeForFit } = await loadExportSheet();
    const pf = pickedFrameRef.current;
    // NEW-1 (B1783056) — Fit-to-frame page: the page itself is shaped to the PICKED frame's
    // own aspect (long edge at the chosen paper size), computed ONCE here so every downstream
    // consumer (this compose box, the live preview, the final PDF) reads the identical page.
    const pageOverride = printFitToFramePage && pf ? pageSizeForFit(printPaper, pf.wFt / pf.hFt) : null;
    setComposePageOverride(pageOverride);
    const box = sheetLayoutBoxesIn({
      paper: printPaper, orient: printOrient,
      metricsPairs: printMetricPairs(), stormwaterBars: printStormwaterBars().length,
      titleBlockExtra: !!printScale,
      includeMetrics: settings.printMetricsBand !== false,
      page: pageOverride,
    });
    setComposeBoxIn(box);
    // Keep the Shift-snap aspect current for whenever the owner returns to the canvas (◂
    // Reposition) — a paper/orientation change made here must be what a shift-held drag out
    // there snaps to, never a stale value from when print mode was first entered. Skipped for a
    // fit-to-frame page (its aspect is circularly the frame's own — nothing meaningful to snap to).
    if (!pageOverride) printAspectRef.current = box.planW / box.planH;
    if (!pf) return;
    if (printScale) {
      const effective = frameFootprintForScale(printScale, { w: box.planW, h: box.planH });
      setPrintFrame({ cx: pf.cx, cy: pf.cy, wFt: effective.wFt, hFt: effective.hFt });
      setFitWarning(checkScaleFits(printScale, pf, effective).message || null);
    } else {
      // NEW-1 — the frame KEEPS the exact shape the owner picked; the sheet's plan window fits
      // IT (exportSheet.js nests the plan with preserveAspectRatio="meet", which already fits
      // any aspect), never the other way around. Re-fitting the frame's aspect to the plan box
      // here — what this branch used to do on every paper/orientation change — is the exact bug
      // this item fixes: it silently undid a free-form drag the moment the sheet changed.
      setPrintFrame(pf);
      setFitWarning(null);
    }
  };
  useEffect(() => {
    if (!composeMode) return;
    recomputeCompose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeMode, printPaper, printOrient, printScale, printFitToFramePage, settings.printMetricsBand]);
  // The live sheet preview — debounced, and built through the SAME `buildComposedSheet` the
  // final PDF rasterizes (PDF-PARITY by construction, not by inspection). Re-runs on every
  // knob the sheet's CONTENTS depend on; paper/orient/scale changes reach here indirectly
  // through the printFrame update the effect above already made.
  const composeKey = composeMode && printFrame
    ? [printPaper, printOrient, printFrame.cx, printFrame.cy, printFrame.wFt, printFrame.hFt,
      settings.showDims !== false, settings.showAreas !== false, showAerial, printOverlay, printMapLayers, settings.printPreparedBy || "", settings.printMetricsBand !== false,
      settings.printBuildingsTable !== false, settings.printScaleBar !== false,
      composePageOverride ? `${composePageOverride.w}x${composePageOverride.h}` : ""].join("|")
    : null;
  useEffect(() => {
    if (!composeKey) return;
    let cancelled = false;
    setComposePreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const scaleText = printScale ? scaleLabel(printScale) : "";
        const preparedBy = (settings.printPreparedBy || "").trim();
        const composed = await withExportSheet((x) => x.buildComposedSheet(printPaper, printOrient, printOverlay, printMapLayers, scaleText, preparedBy, settings.printMetricsBand !== false, composePageOverride, settings.printBuildingsTable !== false, false, settings.printScaleBar !== false));
        if (cancelled) return;
        if (!composed) { setComposePreviewUrl(null); return; }
        const url = URL.createObjectURL(new Blob([composed.sheetSvg], { type: "image/svg+xml" }));
        if (composePreviewUrlRef.current) URL.revokeObjectURL(composePreviewUrlRef.current);
        composePreviewUrlRef.current = url;
        setComposePreviewUrl(url);
      } catch (_) { /* a preview hiccup is non-fatal — Download PDF re-runs the same pipeline and surfaces a real error if it still fails */ }
      finally { if (!cancelled) setComposePreviewLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a ref is stable; the cleanup reads its LATEST value on unmount, which is the point
  useEffect(() => () => { if (composePreviewUrlRef.current) URL.revokeObjectURL(composePreviewUrlRef.current); }, []);
  // "Today" for the compose screen's title-block readout, in the same YYYY.MM.DD shape the
  // printed sheet uses (`printSheet.js`'s `formatDateStamp`, which stays in the lazy chunk —
  // this is a tiny standalone copy so the compose panel can show the date before that chunk loads).
  const composeTodayStamp = () => {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };
  // NEW-1 (B1783056) — orientation auto-flip: default the sheet to whichever orientation
  // matches the picked frame (less wasted paper), but only as a DEFAULT — never re-applied
  // once the owner has touched the Landscape/Portrait control this compose (orientTouchedRef).
  const enterCompose = () => {
    pickedFrameRef.current = printFrame;
    orientTouchedRef.current = false;
    if (printFrame) {
      const wanted = orientationForAspect(printFrame.wFt / printFrame.hFt);
      if (wanted !== printOrient) setPrintOrient(wanted);
    }
    setComposeMode(true);
  };
  const setPrintOrientTouched = (o) => { orientTouchedRef.current = true; setPrintOrient(o); };
  const setPrintFitToFramePageTouched = (v) => { setPrintFitToFramePage(v); if (v) setPrintScale(null); };
  const setPrintScaleTouched = (v) => { setPrintScale(v); if (v) setPrintFitToFramePage(false); };
  const exitToReposition = () => setComposeMode(false); // non-destructive: printFrame/paper/scale/toggles are all untouched
  const cancelPrint = () => {
    setComposeMode(false); setPrintMode(false); setPrintFrame(null); setFitWarning(null);
    pickedFrameRef.current = null;
    if (composePreviewUrlRef.current) { URL.revokeObjectURL(composePreviewUrlRef.current); composePreviewUrlRef.current = null; }
    setComposePreviewUrl(null);
    // Dimensions/area-label toggles are shared with the live View menu (WYSIWYG, no duplicate
    // filtering path) — but a print session must still be non-destructive to the editing view,
    // so whatever the compose screen changed is put back the moment the whole flow ends,
    // whether that's a Cancel or a completed Download.
    const pre = preCanvasDisplayRef.current;
    if (pre) {
      setSettings((s) => (s.showDims === pre.showDims && s.showAreas === pre.showAreas) ? s : { ...s, showDims: pre.showDims, showAreas: pre.showAreas });
      preCanvasDisplayRef.current = null;
    }
  };
  // Read at CALL time off the one shared prefs snapshot (never a mount-time copy of it).
  const flattenMarkupsPref = () => getPrefsSnapshot().exportPrefs?.flattenMarkups === true;
  const doPrint = async () => {
    setComposeDownloading(true);
    try {
      const scaleText = printScale ? scaleLabel(printScale) : "";
      const preparedBy = (settings.printPreparedBy || "").trim();
      // NEW-1 — "Flatten markups" is a per-USER choice (account prefs), default OFF = editable annotations.
      await exportPDF(printPaper, printOrient, printOverlay, printMapLayers, scaleText, preparedBy, settings.printMetricsBand !== false, composePageOverride, settings.printBuildingsTable !== false, flattenMarkupsPref(), settings.printScaleBar !== false);
      cancelPrint();
    } finally { setComposeDownloading(false); }
  };
  return { printAspectRef, printAspect, refreshPrintAspect, fitFrame, enterPrintMode, overlayPrintable, mapLayersPrintable, buildingsTablePrintable, startPrintMove, startPrintResize, recomputeCompose, composeKey, composeTodayStamp, enterCompose, setPrintOrientTouched, setPrintFitToFramePageTouched, setPrintScaleTouched, exitToReposition, cancelPrint, flattenMarkupsPref, doPrint };
}
