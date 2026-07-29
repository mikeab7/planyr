/* exportSheet — the whole PDF / PNG / KMZ export path, the aerial tile Stitcher, and the
 * GIS-overlay capture, lifted out of SitePlanner.jsx and loaded ON DEMAND (B1042).
 *
 * Plain-English: none of this runs until you actually ask for an export — you open the
 * print frame, or hit Download PDF / PNG / Google Earth. Keeping it inside the planner
 * meant every single page load paid to download and parse it, even loads that never
 * printed anything. Now the browser fetches it the moment you reach for it (and we warm
 * it as soon as the Export menu opens, so the click still feels instant).
 *
 * WHY A FACTORY OVER A ctx BAG, not a pile of loose arguments: every one of these
 * routines reads deep planner state — the live <svg>, the feet↔pixel transform, the
 * palette, the layer refs, the drainage screen. SitePlanner rebuilds `ctx` fresh on each
 * call (see `exportCtx()` there), so these functions always see current state; nothing is
 * captured across renders. The full contract is destructured at the top of
 * createExportSheet, so a missing key is a lint/`undefined` error, never a silent wrong
 * export.
 *
 * PDF-PARITY is the standing rule for everything in here: what the sheet draws must match
 * what the screen draws. The metric/stormwater band builders that feed the sheet
 * (printMetricPairs / printStormwaterBars) deliberately STAY in SitePlanner.jsx — they
 * read the same live derivations the on-screen Yield readout does, and are passed in.
 *
 * LOUD-FAILURE: an aerial or GIS layer that can't be fetched is DROPPED and REPORTED
 * (flashWarn), never silently omitted; a failed build alerts rather than downloading a
 * blank sheet.
 */
import L from "leaflet";
import { flushSync } from "react-dom";
import { BASEMAPS } from "./basemaps.js";
import { ALL_LAYERS, gisProxyEnabled } from "./layers.js";
import { overlayExportRequest } from "./layerRequest.js";
import {
  lngLatRingToFeet, feetToLatLng, aerialPlacement, overlayExportPlacement,
  feetExtentToBbox, aerialTileGrid, pickAerialTileZoom,
} from "./arcgis.js";
import { siteToFeatures, buildKmz, kmzFilename, KMZ_MIME } from "./kmzExport.js";
import { buildSheetFurnitureSvg } from "./sheetFurniture.js";
import { printSheetLayout, buildPrintSheetSvg, sheetFileName, formatDateStamp } from "./printSheet.js";
import { printStrokeWidth, sheetFitScale } from "./exportStyle.js";
import { jpegToPdf } from "./imagePdf.js";
import { buildOverlayVectorFragment, esriLineFeatures, esriPolygonFeatures, contourFeatures, arrowGlyphFeatures, swapLatLng } from "./overlayVectorSvg.js";
import { labelAnchors, placeLabels } from "./boundaryLabels.js";
import { VECTOR_SOURCES, styleFor } from "./vectorLayers.js";
import { gisCache } from "./gisCache.js";
import { gridRequest } from "./demGrid.js";

/* The printed PLAN BOX aspect for a given paper/orientation — the crop the owner drags on
 * canvas matches the printed plan area, not the raw paper (B200). Lives here because it is
 * the only other consumer of printSheetLayout; SitePlanner awaits it when entering print
 * mode and when paper/orientation changes. */
export function sheetPlanAspect({ paper, orient, buildingCount, metricsPairs, stormwaterBars }) {
  const layout = printSheetLayout({ paper, orient, buildingCount, metricsPairs, stormwaterBars });
  return layout.plan.w / layout.plan.h;
}

export function createExportSheet(ctx) {
  const {
    // --- drawn model + geometry -------------------------------------------------
    parcels, els, measures, callouts, markups, settings, underlay, sheetOverlays,
    DEV_TYPES, devExtent, elCorners, f2p, view, size, origin,
    // --- live DOM / Leaflet handles ---------------------------------------------
    svgRef, stateRef, overlayRefs, geoMapRef,
    // --- map + layer state ------------------------------------------------------
    basemapOn, basemapSrc, overlays, layerStatus,
    // --- presentation -----------------------------------------------------------
    PAL, f0,
    // --- sheet content (built in SitePlanner so screen + sheet share one source) --
    siteName, siteLabel, planLabel, printFrame, buildingRows,
    printMetricPairs, printStormwaterBars, drainage,
    // --- render-pass + feedback controls ----------------------------------------
    cullActive, setExportPass, setExportingPDF, flashWarn,
  } = ctx;
  const fileSlug = () => (siteName || "site-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site-plan";
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ parcels, els, measures, callouts, markups, settings, underlay }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileSlug()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // Export the drawn site to a Google Earth .kmz (B684). Reprojects every foot vertex to WGS84
  // lat/long via the SAME feetToLatLng the map render uses (KML must be lon,lat — so we flip the
  // [lat,lng] pair). `extrude` lifts building massing to its clear height for Earth's 3D view.
  // LOUD-FAILURE: siteToFeatures throws if any vertex reprojects to NaN — caught → warn + abort,
  // never a partial file. A plan not yet placed on the map has no geo anchor → can't export.
  const exportKmz = (extrude = false) => {
    if (!origin) { flashWarn("Place this plan on the map first (open it from a map location), then export to Google Earth.", 6000); return; }
    try {
      const project = (pt) => { const [la, ln] = feetToLatLng(pt, origin.lat, origin.lon); return [ln, la]; };
      const features = siteToFeatures({ parcels, els, measures, settings }, project, { extrudeBuildings: extrude, includeDimensions: false });
      if (!features.length) { flashWarn("Nothing to export yet — draw a boundary or a building first.", 5000); return; }
      const blob = new Blob([buildKmz(siteName || "Site plan", features)], { type: KMZ_MIME });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = kmzFilename(siteName || fileSlug());
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      flashWarn(`⚠ Couldn't build the Google Earth file: ${e.message || "unexpected error"}.`, 8000);
    }
  };

  /* ------------ export (PNG / print-to-PDF) ------------ */
  // Snapshot the live SVG cropped to the site, with editor chrome (grid,
  // handles, scale bar) stripped via data-export="skip" tags.
  // Bounding box (feet) of the development — the placed elements, not bare parcels.
  // The feet extent an export will crop to (B735) — ONE source of truth so the synthesized
  // aerial (exportAerialForFrame) can never disagree with the viewBox buildExportSvg renders.
  // With an explicit print crop → that frame; otherwise the development bounds, else the bare
  // parcel/element bounds, else the underlay bounds (matching what the sheet actually shows),
  // padded. Returns {minX,minY,maxX,maxY} in feet, or null when there's genuinely nothing to frame.
  const exportFeetExtent = (frame) => {
    if (frame) {
      return { minX: frame.cx - frame.wFt / 2, minY: frame.cy - frame.hFt / 2, maxX: frame.cx + frame.wFt / 2, maxY: frame.cy + frame.hFt / 2 };
    }
    let pts = [];
    const dev = devExtent();
    if (dev) pts = [{ x: dev.cx - dev.w / 2, y: dev.cy - dev.h / 2 }, { x: dev.cx + dev.w / 2, y: dev.cy + dev.h / 2 }];
    else { parcels.forEach((p) => pts.push(...p.points)); els.forEach((e) => (e.points ? pts.push(...e.points) : pts.push(...elCorners(e)))); }
    if (!pts.length && underlay) {
      const sy = underlay.ftPerPxY || underlay.ftPerPx;
      pts = [{ x: underlay.x, y: underlay.y }, { x: underlay.x + underlay.imgW * underlay.ftPerPx, y: underlay.y + underlay.imgH * sy }];
    }
    if (!pts.length) return null;
    const PAD = 60; // ft of margin around the site
    return {
      minX: Math.min(...pts.map((p) => p.x)) - PAD, maxX: Math.max(...pts.map((p) => p.x)) + PAD,
      minY: Math.min(...pts.map((p) => p.y)) - PAD, maxY: Math.max(...pts.map((p) => p.y)) + PAD,
    };
  };
  /* NEW-5's hard constraint, enforced in ONE place. Screen rendering culls to the viewport;
     an export must not. `buildExportSvg` clones the LIVE `<svg>`, so before it reads the DOM
     it flips the cull off and flushes a synchronous full render, then restores culling after
     the clone. flushSync is the whole point — a normal setState would land a frame later,
     i.e. after the clone, and the PDF would quietly print only what was on screen. If the
     flush can't run (an export triggered from inside a render/lifecycle), we fall back to
     rendering uncrossed rather than silently exporting a partial drawing. */
  const withFullRender = (fn) => {
    if (!cullActive) return fn();
    let flushed = false;
    try { flushSync(() => setExportPass(true)); flushed = true; } catch (_) { /* fall through */ }
    try { return fn(); }
    finally { if (flushed) { try { flushSync(() => setExportPass(false)); } catch (_) { setExportPass(false); } } }
  };

  const buildExportSvg = (...args) => withFullRender(() => buildExportSvgRaw(...args));

  const buildExportSvgRaw = (frame, includeOverlay = true, paper = PAL.paper, exportAerial = null, exportOverlays = null, includeMapLayers = true, exportVectorOverlays = null) => {
    if (!svgRef.current) return null;
    const fe = exportFeetExtent(frame);
    if (!fe) return null;
    const a = f2p({ x: fe.minX, y: fe.minY }), b = f2p({ x: fe.maxX, y: fe.maxY });
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const clone = svgRef.current.cloneNode(true);
    clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
    clone.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet"); // scale to fill the box, centered
    clone.setAttribute("width", Math.round(w));
    clone.setAttribute("height", Math.round(h));
    clone.removeAttribute("style");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", x); bg.setAttribute("y", y); bg.setAttribute("width", w); bg.setAttribute("height", h);
    bg.setAttribute("fill", paper); // PDF export passes white (screen cream wastes ink); PNG keeps the screen page colour
    clone.insertBefore(bg, clone.firstChild);
    // Always include the aerial (even if it's hidden on screen), placed beneath everything
    // but the paper, so prints/exports keep the satellite. Two sources (B735): when the LIVE
    // basemap is on, the on-screen aerial is a Leaflet tile <div> the SVG clone can't capture
    // (it's a sibling of the exported <svg>, tagged data-export="skip"), so the caller passes
    // `exportAerial` — a frame-exact snapshot synthesized from the SAME source's `export`
    // endpoint. Otherwise fall back to the persisted `underlay` (a dropped screenshot or a
    // from-map capture). Both place the image in the SAME feet frame as the parcels via f2p,
    // so it aligns exactly; the live <image> is tagged data-export-aerial so inlineImages can
    // raise a LOUD warning (never a silent white PDF) if the remote fetch is dropped.
    //
    // Fallback layering: when the live synth is used AND a RELIABLE local underlay exists (a
    // dropped screenshot — its src is a self-contained data: URL that inlineImages never drops),
    // draw that underlay UNDERNEATH the live aerial. If the live fetch is dropped, the underlay
    // still shows real imagery instead of white; if it succeeds it fully covers the underlay.
    const aerials = [];
    if (exportAerial) {
      if (underlay && typeof underlay.src === "string" && underlay.src.startsWith("data:")) aerials.push({ a: underlay, tag: false }); // reliable fallback, bottom
      aerials.push({ a: exportAerial, tag: true }); // live view, on top (the LOUD-FAILURE marker)
    } else if (underlay) {
      aerials.push({ a: underlay, tag: true });
    }
    let anchor = bg; // running insertion point; each new backdrop image goes right after the previous → bottom→top paint order
    if (aerials.length) {
      clone.querySelectorAll('image:not([data-overlay-image]):not([data-export-overlay])').forEach((n) => n.remove()); // drop any live aerial copy — keep placed site-plan overlays + our GIS overlay images
      for (const { a, tag } of aerials) {
        const tl = f2p({ x: a.x, y: a.y });
        const sy = a.ftPerPxY || a.ftPerPx;
        const im = document.createElementNS("http://www.w3.org/2000/svg", "image");
        im.setAttribute("href", a.src);
        im.setAttributeNS("http://www.w3.org/1999/xlink", "href", a.src);
        im.setAttribute("x", tl.x); im.setAttribute("y", tl.y);
        im.setAttribute("width", a.imgW * a.ftPerPx * view.ppf);
        im.setAttribute("height", a.imgH * sy * view.ppf);
        im.setAttribute("preserveAspectRatio", "none");
        im.setAttribute("opacity", a.opacity ?? 1);
        if (tag) {
          im.setAttribute("data-export-aerial", "1"); // LOUD-FAILURE marker: a dropped fetch here must warn, not silently blank the PDF
          // B840: alternate-source (Esri↔USGS) /export URL — inlineImages retries this before dropping
          // the aerial when the primary source's dynamic render times out. Absent when the src is a
          // stitched data: URL (B839 fast path succeeded → no fetch, no fallback needed).
          if (a.fallbackSrc) im.setAttribute("data-fallback-href", a.fallbackSrc);
        }
        clone.insertBefore(im, anchor.nextSibling);
        anchor = im;
      }
    }
    // GIS overlay LAYERS (FEMA floodplain, pipelines, wetlands, utilities, ground relief) — B739.
    // Composited ABOVE the aerial and BELOW the drawn geometry + site-plan overlays, matching the
    // on-screen stacking (aerial tiles < GIS-overlay pane < SVG). Same feet frame + pixel grid as
    // the aerial (overlayExportPlacement shares aerialGeom), each at its layer opacity, in the
    // array's bottom→top order. Tagged data-export-overlay so inlineImages warns loudly (never
    // silently) if a layer's fetch is dropped; data-fallback-href = the direct-agency URL to retry
    // before dropping (when the same-origin proxy isn't serving).
    if (includeMapLayers && exportOverlays && exportOverlays.length) {
      for (const o of exportOverlays) {
        const tl = f2p({ x: o.x, y: o.y });
        const sy = o.ftPerPxY || o.ftPerPx;
        const im = document.createElementNS("http://www.w3.org/2000/svg", "image");
        im.setAttribute("href", o.src);
        im.setAttributeNS("http://www.w3.org/1999/xlink", "href", o.src);
        im.setAttribute("x", tl.x); im.setAttribute("y", tl.y);
        im.setAttribute("width", o.imgW * o.ftPerPx * view.ppf);
        im.setAttribute("height", o.imgH * sy * view.ppf);
        im.setAttribute("preserveAspectRatio", "none");
        im.setAttribute("opacity", o.opacity ?? 1);
        im.setAttribute("data-export-overlay", "1"); // LOUD-FAILURE marker
        im.setAttribute("data-layer-id", o.id);
        if (o.label) im.setAttribute("data-layer-label", o.label);
        if (o.fallbackSrc) im.setAttribute("data-fallback-href", o.fallbackSrc);
        clone.insertBefore(im, anchor.nextSibling);
        anchor = im;
      }
    }
    // GIS VECTOR/client layers (B745): transmission, road-authority, county/city/ETJ boundaries,
    // contours, drainage arrows, OSM/Mapillary points. No server image — each layer's lat/lon
    // geometry (gathered live in exportVectorOverlaysForFrame) is reprojected into the SAME feet
    // frame via lngLatRingToFeet → f2p and redrawn as styled SVG, composited at the SAME z-anchor
    // as the raster overlays (above them, below the drawn geometry). Colors/weights ride from the
    // live layer (PDF-PARITY); stroke weights ride the export thinning pass like every plan line.
    if (includeMapLayers && exportVectorOverlays && exportVectorOverlays.length) {
      const projectLngLat = (ll) => f2p(lngLatRingToFeet([ll], origin.lon, origin.lat)[0]); // the ONE projection seam
      for (const v of exportVectorOverlays) {
        const { svg, skipped } = buildOverlayVectorFragment(v.features, projectLngLat, { opacity: v.opacity, labels: v.labels });
        if (skipped) console.warn(`[export] ${v.label || v.id}: ${skipped} vector feature(s) skipped (non-finite projection)`);
        if (!svg) continue;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("data-export-vector", "1");
        g.setAttribute("data-layer-id", v.id);
        if (v.label) g.setAttribute("data-layer-label", v.label);
        g.innerHTML = svg; // inline SVG fragment — same innerHTML idiom as the sheet furniture below
        clone.insertBefore(g, anchor.nextSibling);
        anchor = g;
      }
    }
    // Site-plan overlays (B72) obey the print dialog's "Print overlay" toggle (B131):
    // off → drop every placed overlay raster (its editor chrome + any unsynced
    // placeholder already left via data-export="skip"); on → the cloned <image>s keep
    // their exact on-screen transform — feet→pixel position, scale, rotation, opacity,
    // and the rasterized page — composited above the aerial backdrop in the same z-order.
    if (!includeOverlay) clone.querySelectorAll('[data-overlay-image]').forEach((n) => n.remove());
    // Sheet furniture for the export — a measurement-grade graphic scale bar
    // (bottom-right) and a north arrow (top-left), both on a translucent
    // legibility plate. Sized in OUTPUT units and anchored to the export FRAME
    // (lib/sheetFurniture.js) so they sit fully inside a safe-area inset, never
    // clip, and print at a fixed physical size on the page — unlike the screen
    // overlays (data-export="skip", already removed above) which are sized for the
    // live viewport. ftPerUnit = feet per viewBox user unit (one foot == view.ppf
    // user units). The planner canvas is north-up, so the arrow points straight up.
    // NEW-1 no-occlude: bounding boxes (in viewBox px) of the plan's development
    // content, padded for the red dimension labels that sit just outside each edge,
    // so furniture is placed in the emptiest corner and can never land on a building.
    const dimPad = Math.min(w, h) * 0.02;
    const obstacles = [];
    els.forEach((e) => {
      if (!DEV_TYPES.includes(e.type)) return;
      const ring = e.points || elCorners(e);
      if (!ring || !ring.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      ring.forEach((p) => { const q = f2p(p); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
      obstacles.push({ x: x0 - dimPad, y: y0 - dimPad, w: (x1 - x0) + 2 * dimPad, h: (y1 - y0) + 2 * dimPad });
    });
    const furn = document.createElementNS("http://www.w3.org/2000/svg", "g");
    furn.setAttribute("font-family", "Inter, system-ui, sans-serif");
    furn.setAttribute("data-furniture", "1"); // skip the export stroke-thinning pass — sized with its own hairlines
    furn.innerHTML = buildSheetFurnitureSvg({ x, y, w, h, ftPerUnit: 1 / view.ppf, fmtFeet: f0, pal: PAL, obstacles });
    clone.appendChild(furn);
    return { clone, w, h };
  };
  // Export-time presentation pass (NEW-2 / NEW-3, 2026-06-29). Operates on the CLONE
  // only — the live canvas is never touched. `sheetScale` = centi-inches of paper per
  // one viewBox unit (the sheet-fit factor), so strokes can be retargeted to a real
  // physical drafting weight that no longer depends on the zoom at print time:
  //   • NEW-2 — every plan stroke (object lines, surface edges, parking/dock striping,
  //     dimension lines + their label halos) is thinned to a crisp point weight,
  //     preserving the hierarchy; the furniture group is skipped (its own hairlines).
  //   • NEW-3 — the dark "X ac" acreage pill becomes haloed exhibit text (no UI pill),
  //     dock aprons lighten, and the building drop-shadow filter is dropped (a soft
  //     blur shadow reads as screen chrome on a printed exhibit).
  const restyleExportClone = (root, sheetScale) => {
    if (!root) return;
    // NEW-3: acreage chips → exhibit annotation (dark ink + white halo, no pill).
    root.querySelectorAll('[data-print-chip="acre"]').forEach((g) => {
      g.querySelectorAll("[data-chip-bg]").forEach((bg) => bg.remove());
      g.querySelectorAll("[data-chip-text]").forEach((t) => {
        t.setAttribute("fill", PAL.ink);
        t.setAttribute("stroke", "#ffffff");
        t.setAttribute("stroke-width", "3"); // normalized by the stroke-thinning pass below
        t.setAttribute("paint-order", "stroke");
        if (t.style) { t.style.fill = ""; t.style.fontWeight = "600"; }
      });
    });
    // NEW-3 secondary: lighten dock aprons so building faces don't read busy.
    root.querySelectorAll("[data-dock-apron]").forEach((r) => r.setAttribute("fill-opacity", "0.55"));
    // NEW-3 secondary: drop the building drop-shadow on paper (crisp poché, not a blur).
    root.querySelectorAll('[filter="url(#bldgShadow)"]').forEach((g) => g.removeAttribute("filter"));
    // NEW-2: retarget every stroke to a physical drafting weight (skip the furniture).
    if (sheetScale > 0) {
      root.querySelectorAll("*").forEach((node) => {
        if (typeof node.closest === "function" && node.closest("[data-furniture]")) return;
        const cur = node.getAttribute && node.getAttribute("stroke-width");
        if (cur != null && cur !== "") {
          const nw = printStrokeWidth(parseFloat(cur), sheetScale);
          if (Number.isFinite(nw)) node.setAttribute("stroke-width", String(Number(nw.toFixed(3))));
        }
        // Inline-style stroke widths (rare here, but the chip/label paths use style).
        if (node.style && node.style.strokeWidth) {
          const nw = printStrokeWidth(parseFloat(node.style.strokeWidth), sheetScale);
          if (Number.isFinite(nw)) node.style.strokeWidth = `${Number(nw.toFixed(3))}px`;
        }
        // Keep dashes proportional to the now-thinner strokes. Filter out any token
        // that doesn't parse (a stray/trailing separator) so we never emit "NaN".
        const da = node.getAttribute && node.getAttribute("stroke-dasharray");
        if (da && /[\d.]/.test(da) && cur != null && cur !== "") {
          const f = parseFloat(cur) > 0 ? printStrokeWidth(parseFloat(cur), sheetScale) / parseFloat(cur) : 1;
          if (Number.isFinite(f) && f > 0) {
            const scaled = da.trim().split(/[\s,]+/).map((n) => parseFloat(n) * f).filter((v) => Number.isFinite(v)).map((v) => Number(v.toFixed(2)));
            if (scaled.length) node.setAttribute("stroke-dasharray", scaled.join(" "));
          }
        }
      });
    }
  };
  // Rasterizing/printing an SVG can't fetch remote resources, so inline every
  // <image> (the aerial) as a data URL first. Drops any that are CORS-blocked.
  // A single slow/hung image fetch used to stall print prep on "Preparing print…" for
  // up to a minute (B202): the fetches ran one-by-one with no timeout, so any image
  // that hung through the TLS-inspection proxy blocked the whole prep. Now each fetch
  // is time-boxed (AbortController) and they all run in parallel, so worst-case prep is
  // ~INLINE_TIMEOUT_MS, not unbounded. On timeout/CORS/non-200 we drop the image (PNG)
  // or keep its remote href (print can still load it natively).
  const INLINE_TIMEOUT_MS = 8000;
  // The aerial (data-export-aerial) gets its OWN, much longer budget than the small tile/overlay
  // fetches (B840). Its src can be a slow dynamic /export render (Esri's World_Imagery/export took
  // >8s on the owner's normal large frame — AbortError @ 8015ms — so the shared 8s cap dropped it
  // and the sheet printed white). A per-image budget + one retry rescues the common case without
  // slowing the many small fetches. B839's tile-stitch makes this the rare fallback, not the norm.
  const AERIAL_INLINE_TIMEOUT_MS = 22000;
  // Fetch one URL and return it as a data: URL, time-boxed by its own AbortController so a hung
  // request can't stall the whole (parallel) inline pass. Retries once on an aborted (timed-out)
  // attempt. Throws on timeout/CORS/non-200 after the last attempt.
  const fetchAsDataUrl = async (url, { timeout = INLINE_TIMEOUT_MS, retries = 0 } = {}) => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const blob = await fetch(url, { mode: "cors", signal: ctrl.signal }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); });
        return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
    }
    throw lastErr;
  };
  // Returns { aerialDropped, overlaysDropped } (B735/B739, LOUD-FAILURE): the aerial <image>
  // (data-export-aerial) or any GIS overlay <image> (data-export-overlay) that couldn't be
  // fetched/inlined is dropped and reported, so the caller warns the user instead of silently
  // handing them a sheet missing the satellite or a floodplain/pipeline layer they turned on.
  // A GIS overlay first tries its (same-origin proxy) href, then retries the direct-agency URL
  // (data-fallback-href) before dropping — mirroring the live layer's proxy→direct fail-open.
  const inlineImages = async (root, dropOnFail = true) => {
    const XL = "http://www.w3.org/1999/xlink";
    const imgs = [...root.querySelectorAll("image")];
    let aerialDropped = false;
    const overlaysDropped = [];
    await Promise.all(imgs.map(async (img) => {
      let href = img.getAttribute("href") || img.getAttributeNS(XL, "href");
      // B749 — a placed overlay may be showing a TRANSIENT hi-res object URL (blob:) while zoomed in;
      // that URL is session-local and could be revoked mid-export → a silently dropped overlay. Swap it
      // for the overlay's PERSISTED base raster (a data: URL) so the export always has valid, inline-able
      // bytes (LOUD-FAILURE / PDF-PARITY — the export uses the same picture, never nothing).
      if (href && href.startsWith("blob:") && img.hasAttribute("data-overlay-id")) {
        const ov = stateRef.current.sheetOverlays.find((o) => o.id === img.getAttribute("data-overlay-id"));
        if (ov && ov.src) { img.setAttribute("href", ov.src); img.removeAttributeNS(XL, "href"); href = ov.src; }
      }
      if (!href || href.startsWith("data:")) return;
      const isAerial = img.hasAttribute("data-export-aerial");
      const isOverlay = img.hasAttribute("data-export-overlay");
      const fallback = img.getAttribute("data-fallback-href");
      // B840: the aerial gets a longer budget + one retry; on failure it, like an overlay, retries
      // its data-fallback-href — for the aerial that's the ALTERNATE source (Esri↔USGS), which
      // renders the same frame far faster (USGS /export was ~4s where Esri timed out), so a slow
      // primary source is rescued silently instead of dropping to a background-less sheet.
      const opts = isAerial ? { timeout: AERIAL_INLINE_TIMEOUT_MS, retries: 1 } : {};
      try {
        let dataUrl;
        try { dataUrl = await fetchAsDataUrl(href, opts); }
        catch (e) { if ((isOverlay || isAerial) && fallback) dataUrl = await fetchAsDataUrl(fallback, opts); else throw e; }
        img.setAttribute("href", dataUrl); img.removeAttributeNS(XL, "href");
      } catch (_) {
        if (dropOnFail) {
          img.remove();
          if (isAerial) aerialDropped = true;
          else if (isOverlay) overlaysDropped.push(img.getAttribute("data-layer-label") || img.getAttribute("data-layer-id") || "a map layer");
        }
      }
    }));
    return { aerialDropped, overlaysDropped };
  };
  // Per-tile budget for the B839 stitch. Tiles are small, static, CDN/browser-cached (many already
  // warm from the live map), so this is generous; a tile that misses it fails the strict stitch and
  // we fall back to the dynamic /export path (B840). Tries each tile twice.
  const AERIAL_TILE_TIMEOUT_MS = 8000;
  // Load ONE tile as a canvas-clean <img> (crossOrigin — Esri/USGS send Access-Control-Allow-Origin:*
  // so drawing it never taints the canvas), time-boxed, retried once. Rejects on error/timeout.
  const fetchTileImage = (url) => new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => { img.onload = img.onerror = null; img.src = ""; onFail(); }, AERIAL_TILE_TIMEOUT_MS);
      const onFail = () => { clearTimeout(timer); if (++tries <= 1) attempt(); else reject(new Error("tile load failed")); };
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = onFail;
      img.src = url;
    };
    attempt();
  });
  // B839 — stitch the source's cached XYZ tiles into a frame-exact data: URL covering `bbox`. Picks a
  // print-crisp zoom (≤ the source's native ceiling), fetches every covering tile in parallel, crops
  // to the exact bbox pixel box, and returns a JPEG data URL. STRICT: if any tile can't be loaded we
  // return null (clean output — the caller then tries the alternate source, then the dynamic /export
  // fallback), rather than stitching a gappy sheet. Returns null on any DOM/canvas error too.
  const stitchAerialDataUrl = async (bm, bbox) => {
    try {
      const z = pickAerialTileZoom(bbox, { maxNative: bm.maxNative, maxPx: 3072 });
      const grid = aerialTileGrid(bbox, z);
      if (!grid.tiles.length) return null;
      const loaded = await Promise.all(grid.tiles.map(async (t) => {
        const url = bm.tiles.replace("{z}", z).replace("{y}", t.y).replace("{x}", t.x);
        try { return { t, img: await fetchTileImage(url) }; } catch (_) { return { t, img: null }; }
      }));
      if (loaded.some((r) => !r.img)) return null; // any missing tile → fall back (never a gappy exhibit)
      const canvas = document.createElement("canvas");
      canvas.width = grid.canvasW; canvas.height = grid.canvasH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      for (const { t, img } of loaded) ctx.drawImage(img, Math.round(t.dx), Math.round(t.dy), 256, 256);
      return canvas.toDataURL("image/jpeg", 0.92);
    } catch (_) { return null; }
  };
  // Synthesize a frame-exact aerial for the export (B735). The live basemap is a Leaflet tile <div>
  // the exported SVG can't capture, so when it's on we build ONE image covering exactly the printed
  // area, placed in the same feet frame as the parcels (aerialPlacement reverses feetExtentToBbox
  // exactly) so it aligns pixel-for-pixel. Two ways to source those pixels:
  //   • B839 FAST PATH — stitch the active source's cached XYZ tiles into a data: URL (the same fast,
  //     pre-rendered tiles the live map shows; no slow dynamic render, no inline timeout). Try the
  //     active source, then the alternate.
  //   • FALLBACK — if stitching fails, return the dynamic /export placement (remote src) + the
  //     alternate source as data-fallback-href, rescued by B840's longer inline budget + one retry.
  // A source that's genuinely unreachable still ends in a dropped aerial + a loud warning (never a
  // silent white sheet — LOUD-FAILURE). Returns null when there's no live basemap to capture (then
  // buildExportSvg falls back to any dropped/from-map underlay). Async (B839 tile fetches).
  const exportAerialForFrame = async (frame) => {
    if (!origin || !basemapOn) return null;
    const bm = BASEMAPS[basemapSrc] || BASEMAPS.esri;
    // Use the SAME extent buildExportSvg crops to (dev → parcels → underlay), so a parcels-only
    // site (deed imported, no massing yet) over the live basemap still gets its aerial — the old
    // dev-only guard returned null there and silently exported white (B735 review, all 4 lenses).
    const ext = exportFeetExtent(frame);
    if (!ext) return null;
    // ⚠ ARG-ORDER LANDMINE: feetExtentToBbox takes (ext, LAT, LON) but aerialPlacement takes
    // (bbox, LON, LAT) — latitude and longitude are swapped between the two. Keep them exactly
    // as written; flipping either pair silently offsets the aerial by thousands of feet.
    const bbox = feetExtentToBbox(ext, origin.lat, origin.lon);
    // maxPx 2400 (> the underlay's 1800) keeps the print-DPI raster crisp; ArcGIS export
    // caps at 4096, so this stays well inside the limit for any single sheet.
    const placement = aerialPlacement(bbox, origin.lon, origin.lat, { exportBase: bm.export, maxPx: 2400 });
    const altKey = basemapSrc === "usgs" ? "esri" : "usgs";
    const altBm = BASEMAPS[altKey];
    // B839 fast path: stitch cached tiles (active source, then alternate) into a data: URL.
    const stitched = (await stitchAerialDataUrl(bm, bbox)) || (altBm ? await stitchAerialDataUrl(altBm, bbox) : null);
    if (stitched) return { ...placement, src: stitched, opacity: 1, fromMap: true };
    // Fallback: dynamic /export URL + the alternate source as the inline retry (B840).
    const altSrc = altBm ? aerialPlacement(bbox, origin.lon, origin.lat, { exportBase: altBm.export, maxPx: 2400 }).src : null;
    return { ...placement, opacity: 1, fromMap: true, fallbackSrc: altSrc };
  };
  // Synthesize frame-exact images for the LIVE GIS overlay layers (FEMA floodplain, TxRRC
  // pipelines, wetlands, utilities, ground relief …) so they print, same as the aerial (B739).
  // They render only on the Leaflet backdrop <div> (data-export="skip"), so the SVG clone can't
  // capture them; instead, for each ENABLED raster layer we request one transparent /export PNG
  // covering exactly the print frame and composite it above the aerial in buildExportSvg. Returns
  // an array ORDERED bottom→top to match the on-screen paint order (all overlays share one Leaflet
  // pane, painted in ALL_LAYERS registry order — the LayerPanel's group order is display-only).
  // Vector/line layers (esriFeature/vector/contours/flowdir/overpass/mapillary) aren't server
  // images and are handled separately (Phase 2 — Class B). Uses the SAME feetExtentToBbox arg-order
  // landmine as the aerial: (ext, LAT, LON).
  const exportOverlaysForFrame = (frame) => {
    if (!origin) return [];
    const ext = exportFeetExtent(frame);
    if (!ext) return [];
    const bbox = feetExtentToBbox(ext, origin.lat, origin.lon);
    const proxy = gisProxyEnabled();
    const out = [];
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      const st = overlays?.[id];
      if (!st || !st.on) continue; // respect the toggle
      let rasterCfg = cfg;
      const isRaster = !cfg.kind || cfg.kind === "dynamic" || cfg.kind === "esriImage";
      if (!isRaster) {
        // B751: a pipeline vectorLine layer CURRENTLY showing its far-out raster → composite that
        // raster here (the vector branch/Class B skips it in image mode). In vector mode it's a
        // Class B layer, so skip it here. All other vector/client layers → Class B.
        if (cfg.kind === "vectorLine" && cfg.imageFallback) {
          const ref = overlayRefs.current?.[id];
          const mode = ref && typeof ref.getExportMode === "function" ? ref.getExportMode() : null;
          if (mode !== "image") continue;
          rasterCfg = { kind: "dynamic", url: cfg.imageFallback.url, layers: cfg.imageFallback.layers };
        } else continue;
      }
      if (layerStatus?.[id]?.state === "failed") continue; // confirmed-dead host — requesting it would only drop+warn
      const req = overlayExportRequest(rasterCfg, { proxy });
      const geomOpts = { layersParam: req.layersParam, renderingRule: req.renderingRule, maxPx: 2400 };
      const p = overlayExportPlacement(bbox, origin.lon, origin.lat, { exportBase: `${req.url}/${req.endpoint}`, ...geomOpts });
      // Proxy→direct CORS fallback for the export inliner (mirrors the live layer's fail-open):
      // the same-origin proxy image is always canvas-clean, but if it isn't serving (e.g. a
      // preview deploy) the inliner retries the direct-agency URL before dropping the layer.
      const pDirect = proxy && req.direct !== req.url
        ? overlayExportPlacement(bbox, origin.lon, origin.lat, { exportBase: `${req.direct}/${req.endpoint}`, ...geomOpts })
        : null;
      out.push({ ...p, id, label: cfg.label, opacity: st.opacity ?? cfg.opacity ?? 0.8, fallbackSrc: pDirect ? pDirect.src : null });
    }
    return out; // ordered bottom→top
  };
  // B745 — a Leaflet path style ({color,weight,opacity,dashArray}) → our normalized style. Base
  // opacity stays 1 here (per-layer opacity is applied once, via the pure emitter's opts.opacity).
  const leafStyle = (s) => ({ stroke: s && s.color, strokeWidth: s && s.weight, strokeOpacity: s && s.opacity != null ? s.opacity : 1, dash: s && s.dashArray });
  const projLLtoPx = ([lng, lat]) => f2p(lngLatRingToFeet([[lng, lat]], origin.lon, origin.lat)[0]);
  // Read one live VECTOR/client layer off overlayRefs and normalize it to { features, labels }
  // (coords [lon,lat]) for the export. Sync-only — captures exactly what's painted; anything not
  // loaded / out of frame / not cached yields empty (the caller logs + skips). PDF-PARITY: colors,
  // weights, dashes, radii and the terrain palette come verbatim from the live layer / registry.
  const normalizeVectorLayer = (id, cfg, ref) => {
    const kind = cfg.kind;
    if (kind === "esriFeature") { // transmission (hifld_tx), road-authority: line features
      if (typeof ref.eachFeature !== "function") return { features: [] };
      const features = [];
      ref.eachFeature((l) => {
        const gj = l && l.feature;
        if (!gj || !gj.geometry) return;
        const style = leafStyle(cfg.styleFn ? cfg.styleFn(gj.properties, 1) : { color: cfg.color, weight: cfg.weight, opacity: 1 });
        features.push(...esriLineFeatures(gj.geometry, style));
      });
      return { features };
    }
    if (kind === "vectorLine") { // B751 pipelines: commodity-colored line features (vector mode only)
      if (typeof ref.getExportMode === "function" && ref.getExportMode() !== "vector") return { features: [] }; // image mode → Class A raster handles it
      const layers = typeof ref.getLayers === "function" ? ref.getLayers() : [];
      const geo = layers.find((l) => typeof l.toGeoJSON === "function" && typeof l.eachFeature !== "function");
      const fc = geo ? geo.toGeoJSON() : null;
      if (!fc || !fc.features || !fc.features.length) return { features: [] };
      const src = VECTOR_SOURCES[id];
      const features = [];
      for (const f of fc.features) {
        const style = leafStyle(styleFor(src, f.properties)); // SAME commodity symbology as the live layer (PDF-PARITY)
        features.push(...esriLineFeatures(f.geometry, style));
      }
      return { features };
    }
    if (kind === "pipelineCorridor") { // B752 easement bands: commodity-tinted translucent polygons
      const features = [];
      const pushPoly = (l) => {
        if (typeof l.getLatLngs !== "function") return;
        const raw = l.getLatLngs();
        const ring = Array.isArray(raw[0]) ? raw[0] : raw; // L.polygon nests one level
        const coords = ring.map((p) => [p.lng, p.lat]);
        if (coords.length < 3) return;
        const color = (l.options && l.options.fillColor) || "#9a9992";
        // Hand the emitter the DESIGN base opacity (0.18); it multiplies by st.opacity, matching
        // the on-screen 0.18×opacity fill (the OSM-layer un-bake pattern).
        features.push({ kind: "polygon", coords: [coords], style: { stroke: color, strokeWidth: 0.5, strokeOpacity: 1, fill: color, fillOpacity: 0.18 } });
      };
      const walk = (grp) => { if (typeof grp.eachLayer === "function") grp.eachLayer((l) => { if (typeof l.getLatLngs === "function") pushPoly(l); else walk(l); }); };
      walk(ref);
      return { features };
    }
    if (kind === "vector") { // county/city/ETJ boundaries: outline polygons + collision-placed names
      const layers = typeof ref.getLayers === "function" ? ref.getLayers() : [];
      const geo = layers.find((l) => typeof l.toGeoJSON === "function" && typeof l.eachFeature !== "function");
      let fc = geo ? geo.toGeoJSON() : null;
      if ((!fc || !fc.features) && typeof ref.eachFeature === "function") { const fs = []; ref.eachFeature((l) => l.feature && fs.push(l.feature)); fc = { type: "FeatureCollection", features: fs }; }
      if (!fc || !fc.features || !fc.features.length) return { features: [] };
      const style = { stroke: cfg.color || "#374151", strokeWidth: cfg.weight || 2, strokeOpacity: 1, fill: "none" };
      const features = [];
      for (const f of fc.features) features.push(...esriPolygonFeatures(f.geometry, style));
      let labels = [];
      const src = VECTOR_SOURCES[id];
      if (src && src.labelField) {
        const anchors = labelAnchors(fc, { labelField: src.labelField, titleCase: !!src.titleCaseLabel });
        const placed = placeLabels(anchors, { project: (lng, lat) => projLLtoPx([lng, lat]), viewW: size.w, viewH: size.h });
        const tmpl = src.nameTemplate || "{name}";
        labels = placed.map((p) => ({ x: p.box.x, y: p.box.y, text: tmpl.replace("{name}", p.name), uppercase: id === "jur_county" }));
      }
      return { features, labels };
    }
    if (kind === "overpass") { // OSM power/hydrants: lines/polygons/points, styled off l.options
      const features = [];
      ref.eachLayer((l) => {
        const o = l.options || {}, base = o.opacity || 1;
        if (typeof l.getLatLngs === "function") {
          const raw = l.getLatLngs();
          const ring = Array.isArray(raw[0]) ? raw[0] : raw; // polygon nests one level deeper
          const coords = ring.map((p) => [p.lng, p.lat]);
          if (l instanceof L.Polygon) features.push({ kind: "polygon", coords: [coords], style: { stroke: o.color, strokeWidth: o.weight, strokeOpacity: 1, fill: o.fillColor || o.color, fillOpacity: (o.fillOpacity ?? 0) / base } });
          else features.push({ kind: "line", coords, style: { stroke: o.color, strokeWidth: o.weight, strokeOpacity: 1, dash: o.dashArray } });
        } else if (typeof l.getLatLng === "function") {
          const c = l.getLatLng();
          features.push({ kind: "point", coords: [c.lng, c.lat], style: { stroke: o.color, strokeWidth: o.weight, strokeOpacity: 1, fill: o.fillColor || o.color, fillOpacity: (o.fillOpacity ?? 1) / base, radius: o.radius } });
        }
      });
      return { features };
    }
    if (kind === "mapillary") { // detection points
      const features = [];
      ref.eachLayer((l) => {
        if (typeof l.getLatLng !== "function") return;
        const o = l.options || {}, c = l.getLatLng(), base = o.opacity || 1;
        features.push({ kind: "point", coords: [c.lng, c.lat], style: { stroke: o.color, strokeWidth: o.weight, strokeOpacity: 1, fill: o.fillColor || o.color, fillOpacity: (o.fillOpacity ?? 1) / base, radius: o.radius } });
      });
      return { features };
    }
    if (kind === "contours" || kind === "flowdir") { // terrain — read the cached artifact for the current view (what's painted)
      const map = geoMapRef.current;
      if (!map) return { features: [] };
      const b = map.getBounds();
      const req = gridRequest({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, map.getZoom());
      const hit = gisCache.read(`terrain:${req.key}`);
      if (!hit || !hit.data) { console.warn(`[export] terrain "${cfg.label || id}" not cached for this view — skipped`); return { features: [] }; }
      if (kind === "contours") {
        const { features, labels } = contourFeatures(hit.data.contours);
        const placedLabels = labels.map((lb) => { const q = projLLtoPx([lb.lng, lb.lat]); return { x: q.x, y: q.y, text: lb.text }; });
        return { features, labels: placedLabels };
      }
      const features = [];
      for (const a of hit.data.arrows || []) features.push(...arrowGlyphFeatures(a, projLLtoPx(swapLatLng(a.ll))));
      return { features };
    }
    return { features: [] };
  };
  // B745 — capture the VECTOR/client-drawn overlay layers (transmission, boundaries, contours,
  // drainage arrows, OSM/Mapillary) for the export. buildExportSvg reprojects lat/lon → feet → SVG;
  // this only enumerates active non-raster layers + normalizes their live geometry. Sync-only; a
  // layer that's on but has nothing to draw (not loaded / out of frame / not cached) is skipped +
  // logged — never a silent partial, never a blocking re-query.
  const exportVectorOverlaysForFrame = () => {
    if (!origin) return [];
    const out = [];
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      const st = overlays?.[id];
      if (!st || !st.on) continue;
      const isRaster = !cfg.kind || cfg.kind === "dynamic" || cfg.kind === "esriImage";
      if (isRaster) continue; // Class A handled by exportOverlaysForFrame
      if (layerStatus?.[id]?.state === "failed") continue;
      const ref = overlayRefs.current?.[id];
      if (!ref || ref === "pending" || typeof ref !== "object") continue; // not loaded yet
      let norm;
      try { norm = normalizeVectorLayer(id, cfg, ref); }
      catch (e) { console.warn(`[export] vector layer "${cfg.label || id}" extraction failed`, e); continue; }
      const features = (norm && norm.features) || [];
      const labels = (norm && norm.labels) || [];
      if (!features.length && !labels.length) continue; // on but nothing in view → honest omission
      out.push({ id, label: cfg.label, features, labels, opacity: st.opacity ?? cfg.opacity ?? 0.9 });
    }
    return out; // ALL_LAYERS registry order == on-screen paint order
  };
  // B739 LOUD-FAILURE — one batched banner naming the GIS layers whose imagery couldn't be
  // fetched (so the export dropped them), kept separate from the aerial warning so the user can
  // tell which failed. No-op when nothing dropped.
  const warnDroppedOverlays = (dropped, fmt) => {
    if (!dropped || !dropped.length) return;
    const many = dropped.length > 1;
    flashWarn(`⚠ Couldn't load ${dropped.length} map layer${many ? "s" : ""} (${dropped.join(", ")}), so the ${fmt} was exported without ${many ? "them" : "it"}. Your plan and measurements are all included.`, 8000);
  };

  const exportPNG = async () => {
    const exportAerial = await exportAerialForFrame(printFrame); // B735/B839 — capture the live basemap (stitched cached tiles, or the dynamic /export fallback)
    const exportOverlays = exportOverlaysForFrame(printFrame); // B739 — capture the live GIS raster layers (floodplain, pipelines, …)
    const exportVectorOverlays = exportVectorOverlaysForFrame(); // B745 — capture the live GIS vector layers (boundaries, transmission, contours, …)
    const built = buildExportSvg(printFrame, true, PAL.paper, exportAerial, exportOverlays, true, exportVectorOverlays); // use the print crop if one's set, else dev extent
    if (!built) { alert("Nothing to export yet — add a parcel or some elements first."); return; }
    const { clone, w, h } = built;
    const { aerialDropped, overlaysDropped } = await inlineImages(clone); // embed the aerial + GIS layers so the raster includes them (warned loudly on the success path below — B735/B739)
    // Thin line work + restyle labels to the SAME physical weights the PDF uses, by
    // scaling against a notional letter-landscape plan box (PNG has no paper of its own),
    // so a downloaded PNG looks as crisp/professional as the PDF (NEW-2 / NEW-3).
    const lp = printSheetLayout({ paper: "letter", orient: "landscape", buildingCount: buildingRows().length, metricsPairs: printMetricPairs(), stormwaterBars: printStormwaterBars().length });
    restyleExportClone(clone, sheetFitScale(w, h, lp.plan.w, lp.plan.h));
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((res, rej) => { image.onload = res; image.onerror = () => rej(new Error("image load failed")); image.src = url; });
      const scale = Math.max(1, Math.min(3, 3500 / Math.max(w, h))); // crisp but bounded
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((png) => {
        if (!png) { alert("Couldn't render the PNG (the framed area may be too large). Try a tighter print frame, or use Download PDF."); return; }
        const aEl = document.createElement("a");
        aEl.href = URL.createObjectURL(png);
        aEl.download = `${sheetFileName({ project: siteLabel, plan: planLabel })}.png`; // B201
        aEl.click();
        URL.revokeObjectURL(aEl.href);
        // B735 LOUD-FAILURE: the PNG downloaded but without the aerial — say so (⚠ = red banner).
        // B841: don't blame the connection — the usual cause is the imagery source being slow to
        // render, not the user's network. Point them at a retry and the backdrop-source switch.
        if (aerialDropped) flashWarn("⚠ The satellite imagery took too long to load, so the PNG was exported without it. Try again, or switch the backdrop source (Aerial ⇄ USGS). Your plan and measurements are all included.", 8000);
        warnDroppedOverlays(overlaysDropped, "PNG"); // B739 — same for any GIS layer that couldn't be fetched
      }, "image/png");
    } catch (_) {
      // image.onerror, a CORS-tainted canvas (the aerial basemap), or drawImage failing
      // used to reject silently (unhandled) with no download — now surfaced (B50).
      alert("PNG export failed — the aerial basemap can taint the canvas (cross-origin). Turn the basemap off and retry, or use Download PDF.");
    } finally { URL.revokeObjectURL(url); }
  };
  // Resolution / quality knobs for the rasterized PDF. 300 DPI keeps text crisp and the
  // aerial photo-grade at print size; the pixel cap guards memory on big sheets (Tabloid
  // @300 ≈ 16.8M px, under the cap; only larger custom sizes would scale down).
  const PDF_DPI = 300, PDF_MAX_PX = 22e6, PDF_JPEG_Q = 0.92;
  // exportPDF (NEW-1) — REPLACES the old browser-print path (window.open + window.print
  // on a blank window). That path handed our composed sheet to the BROWSER's print
  // dialog, which stamps on chrome we can't strip (a date/time header, the about:blank
  // URL, a page number) and bleeds the on-screen cream page colour onto paper. Here we
  // keep the exact same single-SVG sheet composition (B200/B197) but DELIVER it as a real
  // PDF we build ourselves: rasterize the sheet at high DPI, JPEG-encode it, wrap it with
  // jpegToPdf, and download it. Generating the PDF ourselves is what removes the injected
  // chrome; the page size is declared explicitly (no Letter-on-Tabloid float); paper is
  // forced white (the cream is a screen-only page colour).
  // B712 (PDF-PARITY): ONE builder for the printed metrics band so the sheet and the
  // on-screen Yield readout can't drift. Detention/mitigation pairs join only when
  // the drainage screen has run — and an unpriceable mitigation prints UNKNOWN,
  // never a silent omission.

  const exportPDF = async (paper = "letter", orient = "landscape", includeOverlay = true, includeMapLayers = true) => {
    const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
    const t0 = now();
    const mark = (label) => { try { console.debug(`[pdf] ${label}: ${Math.round(now() - t0)}ms`); } catch (_) {} };
    const exportAerial = await exportAerialForFrame(printFrame); // B735/B839 — capture the live basemap (a Leaflet <div> the SVG can't clone) as a frame-exact image: stitched cached tiles, or the dynamic /export fallback
    const exportOverlays = exportOverlaysForFrame(printFrame); // B739 — capture the live GIS raster layers (floodplain, pipelines, …) for the print frame
    const exportVectorOverlays = exportVectorOverlaysForFrame(); // B745 — capture the live GIS vector layers (boundaries, transmission, contours, …)
    const built = buildExportSvg(printFrame, includeOverlay, "#ffffff", exportAerial, exportOverlays, includeMapLayers, exportVectorOverlays); // force WHITE paper for print/PDF
    if (!built) { alert("Nothing to export yet — add a parcel or some elements first."); return; }
    setExportingPDF(true);
    try {
      // Embed the aerial + GIS overlays (and any placed overlay) as data URLs; DROP any we can't
      // fetch so a cross-origin image can't taint the canvas and abort the whole export (B202). A
      // dropped AERIAL or GIS layer is surfaced loudly on the success path below (B735/B739) — never
      // a silent omission. The warning waits until the file actually downloads, so a later
      // render/encode failure (which throws to the outer catch) can't leave a contradictory toast.
      const { aerialDropped, overlaysDropped } = await inlineImages(built.clone, true);
      mark("inline images");
      // Compose the WHOLE sheet as ONE SVG (B200): nest the plan as an inner <svg> sized to
      // the layout's plan box (it keeps its own viewBox); the title block, buildings table
      // (B197) and metrics live in the SAME outer SVG coordinate system.
      const rows = buildingRows();
      const metricPairs = printMetricPairs();
      const swBars = printStormwaterBars();
      const layout = printSheetLayout({ paper, orient, buildingCount: rows.length, metricsPairs: metricPairs, stormwaterBars: swBars.length });
      // NEW-2 / NEW-3: thin line work + restyle labels to physical print weights, using
      // the real sheet-fit factor (centi-inches of paper per viewBox unit) so the result
      // is identical regardless of the zoom the user was at when they hit print.
      restyleExportClone(built.clone, sheetFitScale(built.w, built.h, layout.plan.w, layout.plan.h));
      const plan = built.clone; // a full <svg viewBox=…> — nest it, keeping its viewBox
      plan.setAttribute("x", layout.plan.x); plan.setAttribute("y", layout.plan.y);
      plan.setAttribute("width", layout.plan.w); plan.setAttribute("height", layout.plan.h);
      plan.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const planSvg = new XMLSerializer().serializeToString(plan);
      const sheetSvg = buildPrintSheetSvg({
        layout, planSvg,
        title: siteLabel, sub: planLabel,
        date: formatDateStamp(),
        metrics: metricPairs,
        stormwater: swBars,
        note: drainage && drainage.mitigation && drainage.mitigation.intersectAcres > 0
          ? "Concept site plan — planning-level estimates, not a survey. Detention & floodplain-mitigation volumes are screening figures — confirm with your engineer and the reviewing authority."
          : "Concept site plan — planning-level estimates, not a survey.",
        buildings: rows.map((r) => ({ name: r.name, sf: r.sf, clearHeight: r.clearHeight.value, slab: r.slab.value })),
        pal: { ...PAL, paper: "#ffffff" }, // white sheet — the cream PAL.paper is a screen-only page colour
      });
      // Rasterize the composed sheet at high DPI. The browser renders the SVG exactly as it
      // appears on screen (fills, filters, the inlined aerial), so the PDF is pixel-faithful.
      const { page } = layout;
      let pxW = Math.round(page.wIn * PDF_DPI), pxH = Math.round(page.hIn * PDF_DPI);
      if (pxW * pxH > PDF_MAX_PX) { const k = Math.sqrt(PDF_MAX_PX / (pxW * pxH)); pxW = Math.round(pxW * k); pxH = Math.round(pxH * k); }
      const url = URL.createObjectURL(new Blob([sheetSvg], { type: "image/svg+xml" }));
      try {
        const image = new Image();
        await new Promise((res, rej) => { image.onload = res; image.onerror = () => rej(new Error("sheet render failed")); image.src = url; });
        const canvas = document.createElement("canvas");
        canvas.width = pxW; canvas.height = pxH;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, pxW, pxH); // JPEG has no alpha — paint white, not black
        ctx.drawImage(image, 0, 0, pxW, pxH);
        mark("rasterized");
        const jpegBlob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", PDF_JPEG_Q));
        const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
        const fileName = sheetFileName({ project: siteLabel, plan: planLabel }); // B201 — date · project · plan
        const pdf = jpegToPdf({ jpeg, pixelW: pxW, pixelH: pxH, widthIn: page.wIn, heightIn: page.hIn, title: fileName });
        const aEl = document.createElement("a");
        aEl.href = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
        aEl.download = `${fileName}.pdf`;
        aEl.click();
        mark("downloaded");
        URL.revokeObjectURL(aEl.href); // B544: revoke now (matches the PNG path L5112) — the 8s timer leaked a blob URL per export on rapid re-export / navigation
        // B735 LOUD-FAILURE: the file DID download, but without the aerial — say so (⚠ = red banner, not the success green).
        // B841: don't blame the connection — the usual cause is the imagery source being slow to
        // render, not the user's network. Point them at a retry and the backdrop-source switch.
        if (aerialDropped) flashWarn("⚠ The satellite imagery took too long to load, so the PDF was exported without it. Try again, or switch the backdrop source (Aerial ⇄ USGS). Your plan and measurements are all included.", 8000);
        warnDroppedOverlays(overlaysDropped, "PDF"); // B739 — same for any GIS layer that couldn't be fetched
      } finally { URL.revokeObjectURL(url); }
    } catch (_) {
      // A CORS-tainted canvas (the aerial basemap) is the usual culprit; surfaced, not silent (B50).
      alert("Couldn't build the PDF — the aerial basemap can block it (cross-origin). Turn the basemap off and retry.");
    } finally { setExportingPDF(false); }
  };
  return {
    exportJSON, exportKmz, exportPNG, exportPDF,
    buildExportSvg, exportAerialForFrame, exportOverlaysForFrame, exportVectorOverlaysForFrame,
    inlineImages, restyleExportClone, exportFeetExtent,
  };
}
