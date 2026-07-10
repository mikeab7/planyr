/* DXF parse + render Web Worker (B747). The heavy work — `dxf-parser`'s tokenise/parse and
 * the recursive entity → SVG flatten — runs here so a large drawing never freezes the tab
 * (the standing "heavy CAD/PDF parsing off the main thread" rule).
 *
 * ⚠ IMPORT DISCIPLINE: this file may import ONLY `dxf-parser` and the pure DXF modules
 * (dxfRender → dxfGeom). Anything that transitively touches the DOM, React, or Leaflet
 * crashes at WORKER RUNTIME, not build time — test/dxfWorker.test.js pins the import list.
 *
 * Protocol:
 *   in:  { id, text }                     (the DXF file as a UTF-8 string)
 *   out: { id, ok:true, svg, imgW, imgH, ftPerPx, unitsKnown, unitsLabel, entityCount,
 *          unsupported, summary }
 *   or   { id, ok:false, reason, error }  (LOUD — the caller surfaces it, never a silent drop) */
import DxfParser from "dxf-parser";
import { renderDxfToSvg, unsupportedSummary } from "./dxfRender.js";

self.onmessage = (e) => {
  const { id, text } = e.data || {};
  try {
    const parsed = new DxfParser().parseSync(String(text || ""));
    const out = renderDxfToSvg(parsed);
    self.postMessage({ id, ...out, summary: out.ok ? unsupportedSummary(out.unsupported) : "" });
  } catch (err) {
    self.postMessage({ id, ok: false, reason: "parse-error", error: String((err && err.message) || err) });
  }
};
