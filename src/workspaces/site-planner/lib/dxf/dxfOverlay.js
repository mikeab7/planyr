/* DXF overlay glue (B747) — the main-thread half of the pipeline. Runs the parse/render in
 * the DXF worker (heavy work off the UI thread) and rasterizes the returned SVG string to a
 * transparent PNG here (SVG→canvas needs the DOM, so it can't live in the worker). The result
 * feeds the existing {src, imgW, imgH} site-plan overlay shape (overlayPdf.openOverlayFile),
 * inheriting every move/scale/rotate/opacity handle + print/export path unchanged.
 *
 * This module is loaded LAZILY (overlayPdf.js dynamic-imports it only on a .dxf drop), and the
 * `?worker` import makes `dxf-parser` its own chunk instantiated only on first use, so the CAD
 * parser never rides the initial planner bundle. */
import DxfWorker from "./dxfWorker.js?worker";

let worker = null, seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new DxfWorker();
  worker.onmessage = (e) => {
    const d = e.data || {};
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    p.resolve(d);
  };
  worker.onerror = (e) => {
    // A crashed worker stays crashed — reject everything in flight, drop the handle so the
    // next call rebuilds it (mirrors terrainLayers). LOUD: callers surface the rejection.
    const err = new Error(`DXF worker crashed${e && e.message ? `: ${e.message}` : ""}`);
    pending.forEach((p) => p.reject(err));
    pending.clear();
    try { worker.terminate(); } catch (_) {}
    worker = null;
  };
  return worker;
}

/* Parse + render a DXF string in the worker → the render metadata (svg + dims + true-units
 * ftPerPx + unsupported tally). Rejects on a worker crash / parse error / timeout (never a
 * silent no-op). */
export function parseDxfText(text, { timeoutMs = 60000 } = {}) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error("DXF parse timed out")); }
    }, timeoutMs);
    pending.set(id, {
      resolve: (d) => { clearTimeout(timer); resolve(d); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    w.postMessage({ id, text });
  });
}

/* Rasterize an SVG string to a transparent PNG data URL at (w × h) px. Main-thread DOM work;
 * the SVG is self-contained (no external refs) so the canvas is never tainted. */
export function rasterizeSvg(svg, w, h) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
      reject(new Error("SVG rasterization unavailable")); return;
    }
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w));
        canvas.height = Math.max(1, Math.round(h));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL("image/png");
        URL.revokeObjectURL(url);
        resolve(out);
      } catch (err) { URL.revokeObjectURL(url); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not rasterize the DXF drawing")); };
    img.src = url;
  });
}

const decodeText = (bytes) =>
  typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8").decode(bytes) : String.fromCharCode.apply(null, new Uint8Array(bytes));

/* Open a dropped .dxf File → the overlay-shaped raster + true-units scale. Throws with a
 * human message on an empty / unparseable / geometry-less drawing (surfaced by the caller). */
export async function openDxfFile(file) {
  const text = await file.text();
  // Header sniff (B747): a DXF starts with a `0 / SECTION` group pair (MIME is unreliable, so
  // this catches a mislabeled drop with a clear message instead of a confusing parse error).
  if (!/\bSECTION\b/.test(text.slice(0, 8192)) && !/\bENTITIES\b/.test(text.slice(0, 8192)))
    throw new Error("That file doesn't look like a DXF drawing.");
  const meta = await parseDxfText(text);
  if (!meta.ok) {
    if (meta.reason === "no-geometry")
      throw new Error("That DXF has no drawable geometry (only unsupported entity types).");
    throw new Error(meta.error || "That DXF couldn't be read.");
  }
  const src = await rasterizeSvg(meta.svg, meta.imgW, meta.imgH);
  return {
    src, imgW: meta.imgW, imgH: meta.imgH, page: 1, pageCount: 1, pdf: null,
    kind: "dxf", ftPerPx: meta.ftPerPx, unitsAssumed: !meta.unitsKnown, unitsLabel: meta.unitsLabel,
    unsupported: meta.unsupported, unsupportedSummary: meta.summary, entityCount: meta.entityCount,
    detectedScale: null, sheet: null,
  };
}

/* Rebuild an overlay's raster from stored DXF bytes (cross-device / post-eviction reload).
 * Re-renders at the SAME imgW/imgH the record was placed with so the on-map size is exact
 * (placement is anchored to imgW·ftPerPx). Returns { src, imgW, imgH } or null. */
export async function rasterizeStoredDxf(bytes, { width, height } = {}) {
  try {
    const meta = await parseDxfText(decodeText(bytes));
    if (!meta.ok) return null;
    const w = width || meta.imgW, h = height || meta.imgH;
    const src = await rasterizeSvg(meta.svg, w, h);
    return { src, imgW: w, imgH: h };
  } catch (_) { return null; }
}
