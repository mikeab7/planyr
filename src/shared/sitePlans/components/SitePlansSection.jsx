/* SitePlansSection — upload a site plan (a PDF/image, usually a broker flyer), pick which
 * page IS the site plan, anchor it on the real map, and pin comps to buildings on it
 * (B848848). Rendered by MapFinder above the Comps list, self-contained data owner (mirrors
 * CompsPanel's own shape: fetch on mount, list + form UI).
 *
 * WHAT THIS DOES NOT DO: it never renders the plan itself — that's MapFinder's
 * useSitePlanOverlayLayers hook, driving a real Leaflet layer with the geometry this module
 * computes. It never builds a second PDF viewer — the uploaded file is stored WHOLE via the
 * existing Review/Library document pipeline (reviewStore.fileNewReview) and stays openable
 * there; this only rasterizes ONE page for the map overlay.
 *
 * Two map-click mechanisms come from the host (MapFinder), reused rather than re-invented:
 *  - onRequestMapPoint(prompt) => Promise<{lat,lng}|null> — "click anywhere on the map",
 *    used for the 2 georeference control points and the independent scale-check.
 *  - onStartPinOnOverlay(overlayId) / onStopPinOnOverlay() — "the next click ON THIS
 *    RENDERED PLAN creates a comp", which arrives back through the existing onPlaceComp /
 *    pendingAnchor flow CompsPanel already has — no new comp-creation plumbing here.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Field } from "../../ui/controls.jsx";
import {
  fetchAllOverlays, insertOverlay, updateOverlay, deleteOverlay,
} from "../lib/sitePlanOverlayStore.js";
import { measureLatLonFeet } from "../lib/overlayGeoref.js";
import { uploadOverlayRaster, downloadOverlayRasterUrl } from "../lib/overlayRasterStorage.js";
import { fileNewReview, loadReview, downloadFromDrive, stripFileExt } from "../../../workspaces/doc-review/lib/reviewStore.js";
import { listMyTeams, currentIdentity } from "../../../workspaces/site-planner/lib/teams.js";

const inputStyle = {
  width: "100%", padding: "6px 8px", fontSize: 12.5, borderRadius: 6, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};
const linkBtnStyle = { border: "none", background: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: 0, textAlign: "left" };

function imageDataToPngBlob(imageData) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width; canvas.height = imageData.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);
    canvas.toBlob((blob) => { canvas.width = 0; canvas.height = 0; resolve(blob); }, "image/png");
  });
}

function imageFileDims(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

const isPdf = (file) => file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));

/* The image-point picker: shows the rasterized page (or an already-stored raster, for
 * re-anchor/change-page) scaled to fit, and collects up to 2 clicks, converting the
 * rendered-vs-natural scale back to true raster pixels. */
function ImagePointPicker({ previewUrl, rasterW, rasterH, points, onPoint }) {
  const imgRef = useRef(null);
  const onClick = (e) => {
    if (points.length >= 2 || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const sx = rasterW / r.width, sy = rasterH / r.height;
    onPoint({ x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy });
  };
  return (
    <div style={{ position: "relative", border: "1px solid var(--border-default)", borderRadius: 6, overflow: "hidden", maxHeight: 260 }}>
      <img ref={imgRef} src={previewUrl} alt="Site plan page" onClick={onClick}
        style={{ display: "block", width: "100%", height: "auto", cursor: points.length < 2 ? "crosshair" : "default" }} />
      {points.map((p, i) => (
        <div key={i} aria-hidden="true" style={{
          position: "absolute", width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%",
          background: "var(--accent)", border: "2px solid white", pointerEvents: "none",
          left: `${(p.x / rasterW) * 100}%`, top: `${(p.y / rasterH) * 100}%`,
        }} />
      ))}
    </div>
  );
}

function emptyFlow(overlayId = null) {
  return {
    overlayId, // set only for re-anchor/change-page on an EXISTING overlay
    step: "file", // file | page | image-points | map-points | scale-check | saving | error
    file: null, fileBuffer: null, // fileBuffer used for change-page (re-fetched bytes, no live File)
    projectId: null, teamId: null, title: "", docDate: new Date().toISOString().slice(0, 10),
    pageCount: 1, page: 1, previewUrl: null,
    rasterBlob: null, rasterUrl: null, rasterW: 0, rasterH: 0,
    imagePoints: [],
    error: null,
  };
}

export default function SitePlansSection({
  open, active = true, projects, onOverlaysChange,
  onRequestMapPoint, onStartPinOnOverlay, onStopPinOnOverlay, pinningOverlayId,
}) {
  const [overlays, setOverlays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [teams, setTeams] = useState([]);
  const [flow, setFlow] = useState(null);
  const [confirmingChangePage, setConfirmingChangePage] = useState(null); // overlay id armed for a 2nd click
  const notifiedRef = useRef(onOverlaysChange);
  notifiedRef.current = onOverlaysChange;

  useEffect(() => {
    if (!open) return;
    currentIdentity().then(({ uid }) => setCurrentUserId(uid));
    listMyTeams().then(setTeams).catch(() => setTeams([]));
  }, [open]);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await fetchAllOverlays();
    setLoading(false);
    if (!error) { setOverlays(data); notifiedRef.current?.(data); }
  };
  useEffect(() => { if (open) reload(); }, [open]);

  if (!open) return null;

  const setF = (patch) => setFlow((f) => ({ ...f, ...patch }));

  // ---- upload / page-pick -----------------------------------------------------------------
  const startNewUpload = () => setFlow(emptyFlow());
  const cancelFlow = () => { onStopPinOnOverlay?.(); setFlow(null); };

  const rasterizePage = async (bytesOrFile, page) => {
    const { renderPdfPageToImageData } = await import("../../files/pdfRaster.js");
    const { imageData } = await renderPdfPageToImageData(bytesOrFile, page, { targetDpi: 150 });
    const blob = await imageDataToPngBlob(imageData);
    return { blob, w: imageData.width, h: imageData.height, url: URL.createObjectURL(blob) };
  };

  const pickFile = async (file) => {
    setF({ file, error: null });
    try {
      if (isPdf(file)) {
        const { pdfPageCount } = await import("../../files/pdfRaster.js");
        const pageCount = await pdfPageCount(file);
        const r = await rasterizePage(file, 1);
        setF({ pageCount, page: 1, previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h,
          title: stripFileExt(file.name || "Site plan"), step: "page" });
      } else {
        const { w, h } = await imageFileDims(file);
        const url = URL.createObjectURL(file);
        setF({ pageCount: 1, page: 1, previewUrl: url, rasterBlob: file, rasterW: w, rasterH: h,
          title: stripFileExt(file.name || "Site plan"), step: "page" });
      }
    } catch (e) {
      setF({ error: (e && e.message) || "Couldn't read that file.", step: "error" });
    }
  };

  const choosePage = async (n) => {
    if (!flow.file || !isPdf(flow.file) || n < 1 || n > flow.pageCount) return;
    setF({ page: n });
    try {
      const r = await rasterizePage(flow.file, n);
      setF({ previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h });
    } catch (e) {
      setF({ error: (e && e.message) || "Couldn't render that page." });
    }
  };

  const confirmPage = () => setF({ step: "image-points", imagePoints: [] });

  const addImagePoint = (pt) => {
    const pts = [...flow.imagePoints, pt];
    setF({ imagePoints: pts });
    if (pts.length === 2) setF({ step: "map-points" });
  };

  // ---- map control points -> save (upload the whole brochure, then the overlay row) ------
  const runMapPointsThenSave = async () => {
    const mapPts = [];
    for (let i = 0; i < 2; i++) {
      const p = await onRequestMapPoint(`Click the matching point on the map for control point ${i + 1} of 2`);
      if (!p) { cancelFlow(); return; } // user cancelled mid-flow
      mapPts.push(p);
    }
    const controlPoints = flow.imagePoints.map((ip, i) => ({ px: ip.x, py: ip.y, lat: mapPts[i].lat, lon: mapPts[i].lng }));
    setF({ step: "saving" });
    try {
      let overlay;
      if (flow.overlayId) {
        // re-anchor / change-page on an existing overlay
        const existing = overlays.find((o) => o.id === flow.overlayId);
        const { data, error } = await updateOverlay(flow.overlayId, {
          ...existing, controlPoints, imgW: flow.rasterW, imgH: flow.rasterH,
          scaleCheckFt: null, scaleCheckNote: null, // invalidated — a new check is owed
        });
        if (error) throw error;
        overlay = data;
      } else {
        const projectName = (projects || []).find((p) => p.id === flow.projectId)?.site || (projects || []).find((p) => p.id === flow.projectId)?.name || "";
        const uploaded = await fileNewReview({
          projectId: flow.projectId, project: projectName, discipline: "Site Plan",
          item: flow.title, docDate: flow.docDate, blob: flow.file, fileName: (flow.file && flow.file.name) || "site-plan.pdf",
        });
        if (!uploaded.ok) throw new Error(uploaded.error || "Couldn't upload the brochure.");
        const { data, error } = await insertOverlay({
          projectId: flow.projectId, teamId: flow.teamId,
          reviewId: uploaded.id, reviewUserId: currentUserId, page: flow.page,
          docTitle: flow.title, docDate: flow.docDate,
          imgW: flow.rasterW, imgH: flow.rasterH, controlPoints, opacity: 0.85, visible: true,
        });
        if (error) throw error;
        overlay = data;
      }
      // raster upload needs the real overlay id, so it happens after insert/update
      const up = await uploadOverlayRaster(overlay.id, flow.rasterBlob);
      if (up) { const { data } = await updateOverlay(overlay.id, { ...overlay, rasterKey: up.key }); overlay = data || overlay; }
      await reload();
      setF({ step: "scale-check", overlayId: overlay.id });
    } catch (e) {
      setF({ error: (e && e.message) || "Couldn't save that site plan.", step: "error" });
    }
  };

  const runScaleCheck = async () => {
    const a = await onRequestMapPoint("Click the first point of a distance you can check (e.g. a stated building width)");
    if (!a) { setFlow(null); await reload(); return; }
    const b = await onRequestMapPoint("Click the second point");
    if (!b) { setFlow(null); await reload(); return; }
    const ft = measureLatLonFeet({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
    setF({ step: "scale-check-note", scaleCheckFt: ft });
  };

  const saveScaleCheck = async (note) => {
    const overlay = overlays.find((o) => o.id === flow.overlayId) || { id: flow.overlayId };
    await updateOverlay(flow.overlayId, { ...overlay, scaleCheckFt: flow.scaleCheckFt, scaleCheckNote: note || null });
    await reload();
    setFlow(null);
  };

  // ---- re-anchor an existing (already-uploaded) overlay -----------------------------------
  const startReanchor = async (overlay) => {
    const f = emptyFlow(overlay.id);
    setFlow({ ...f, step: "saving" });
    const url = overlay.rasterKey ? await downloadOverlayRasterUrl(overlay.rasterKey) : null;
    if (!url) { setF({ error: "The stored image for this plan is missing — try Change page instead.", step: "error" }); return; }
    setF({ previewUrl: url, rasterW: overlay.imgW, rasterH: overlay.imgH, rasterBlob: null, step: "image-points", imagePoints: [] });
  };

  // ---- change page (re-fetch the WHOLE brochure's bytes, never re-uploaded) --------------
  const startChangePage = async (overlay) => {
    setConfirmingChangePage(null);
    const f = emptyFlow(overlay.id);
    setFlow({ ...f, step: "saving" });
    try {
      const rec = await loadReview(overlay.reviewId);
      const driveKey = rec?.sources?.[0]?.driveKey;
      if (!driveKey) throw new Error("Couldn't find the original document to re-read.");
      const bytes = await downloadFromDrive(driveKey);
      if (!bytes) throw new Error("Couldn't re-download the brochure.");
      const { pdfPageCount } = await import("../../files/pdfRaster.js");
      const pageCount = await pdfPageCount(bytes);
      const r = await rasterizePage(bytes, 1);
      setF({ fileBuffer: bytes, pageCount, page: 1, previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h, step: "page" });
    } catch (e) {
      setF({ error: (e && e.message) || "Couldn't reopen that brochure.", step: "error" });
    }
  };
  const choosePageFromBuffer = async (n) => {
    if (!flow.fileBuffer || n < 1 || n > flow.pageCount) return;
    setF({ page: n });
    try {
      const r = await rasterizePage(flow.fileBuffer, n);
      setF({ previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h });
    } catch (e) {
      setF({ error: (e && e.message) || "Couldn't render that page." });
    }
  };

  // ---- simple per-item controls -----------------------------------------------------------
  const setOpacity = async (o, opacity) => { await updateOverlay(o.id, { ...o, opacity }); await reload(); };
  const toggleVisible = async (o) => { await updateOverlay(o.id, { ...o, visible: !o.visible }); await reload(); };
  const remove = async (o) => { await deleteOverlay(o.id); await reload(); };

  const anchored = (o) => o.controlPoints && o.controlPoints.length >= 2;

  return (
    <div style={{ borderBottom: "1px solid var(--border-default)", padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: overlays.length ? 8 : 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>Site plans</span>
        {!flow && <Button size="sm" variant="ghost" onClick={startNewUpload}>+ Upload site plan</Button>}
      </div>

      {!flow && overlays.length === 0 && !loading && (
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
          Upload a broker flyer or park plan to place it on the map and pin comps to specific buildings on it.
        </div>
      )}

      {!flow && overlays.map((o) => (
        <div key={o.id} style={{ padding: "6px 0", borderTop: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{o.docTitle || "Site plan"}</span>
            <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{o.docDate || ""} · p.{o.page}</span>
          </div>
          {!anchored(o) ? (
            <div style={{ fontSize: 11, color: "var(--warn-text)", marginTop: 2 }}>Not anchored yet.</div>
          ) : (
            <>
              {o.scaleCheckFt != null && (
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                  Scale check: {o.scaleCheckFt.toFixed(1)} ft{o.scaleCheckNote ? ` — ${o.scaleCheckNote}` : ""}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <label style={{ fontSize: 10.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={o.visible} onChange={() => toggleVisible(o)} /> Visible
                </label>
                <input type="range" min={0.2} max={1} step={0.05} value={o.opacity}
                  onChange={(e) => setOpacity(o, Number(e.target.value))} style={{ width: 70 }} title="Opacity" />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                {pinningOverlayId === o.id ? (
                  <button style={{ ...linkBtnStyle, color: "var(--danger-text)" }} onClick={() => onStopPinOnOverlay?.()}>Cancel pin — click the plan on the map</button>
                ) : (
                  <button style={linkBtnStyle} onClick={() => onStartPinOnOverlay?.(o.id)}>Pin comp to this plan</button>
                )}
                <button style={linkBtnStyle} onClick={() => startReanchor(o)}>Re-anchor</button>
                {confirmingChangePage === o.id ? (
                  <button style={{ ...linkBtnStyle, color: "var(--danger-text)" }} onClick={() => startChangePage(o)}>Confirm — this clears its position, re-anchor after</button>
                ) : (
                  <button style={linkBtnStyle} onClick={() => setConfirmingChangePage(o.id)}>Change page</button>
                )}
                <button style={{ ...linkBtnStyle, color: "var(--danger-text)" }} onClick={() => remove(o)}>Delete</button>
              </div>
            </>
          )}
        </div>
      ))}

      {flow && (
        <div style={{ marginTop: 8, padding: 10, border: "1px solid var(--border-default)", borderRadius: 8, background: "var(--surface-raised)" }}>
          {flow.step === "file" && (
            <>
              <div style={{ fontSize: 12, marginBottom: 8 }}>Choose a PDF or image. A multi-page brochure keeps every page — you'll pick which one to place on the map next.</div>
              <input type="file" accept="application/pdf,image/*" onChange={(e) => e.target.files[0] && pickFile(e.target.files[0])} style={{ fontSize: 12 }} />
              <div style={{ marginTop: 8 }}><Button size="sm" variant="ghost" onClick={cancelFlow}>Cancel</Button></div>
            </>
          )}

          {flow.step === "page" && (
            <>
              <Field label="Document title"><input value={flow.title} onChange={(e) => setF({ title: e.target.value })} style={inputStyle} /></Field>
              <Field label="Document date"><input type="date" value={flow.docDate} onChange={(e) => setF({ docDate: e.target.value })} style={{ ...inputStyle, width: 160 }} /></Field>
              {projects?.length > 0 && (
                <Field label="Project (optional)">
                  <select value={flow.projectId || ""} onChange={(e) => setF({ projectId: e.target.value || null })} style={{ ...inputStyle, width: 180 }}>
                    <option value="">No project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.site || p.name}</option>)}
                  </select>
                </Field>
              )}
              {teams?.length > 0 && (
                <Field label="Share with team">
                  <select value={flow.teamId || ""} onChange={(e) => setF({ teamId: e.target.value || null })} style={{ ...inputStyle, width: 180 }}>
                    <option value="">Just me</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              )}
              {flow.pageCount > 1 && (
                <Field label={`Page (${flow.page} of ${flow.pageCount})`}>
                  <span style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" variant="ghost" disabled={flow.page <= 1} onClick={() => (flow.fileBuffer ? choosePageFromBuffer(flow.page - 1) : choosePage(flow.page - 1))}>&larr;</Button>
                    <Button size="sm" variant="ghost" disabled={flow.page >= flow.pageCount} onClick={() => (flow.fileBuffer ? choosePageFromBuffer(flow.page + 1) : choosePage(flow.page + 1))}>&rarr;</Button>
                  </span>
                </Field>
              )}
              {flow.previewUrl && <img src={flow.previewUrl} alt="Page preview" style={{ maxWidth: "100%", maxHeight: 220, border: "1px solid var(--border-default)", borderRadius: 6 }} />}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Button size="sm" onClick={confirmPage} disabled={!flow.title || !flow.docDate}>Use this page</Button>
                <Button size="sm" variant="ghost" onClick={cancelFlow}>Cancel</Button>
              </div>
            </>
          )}

          {flow.step === "image-points" && (
            <>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                Click {2 - flow.imagePoints.length} more point{flow.imagePoints.length === 1 ? "" : "s"} on the plan that you can also find on the real map (a building corner, a road intersection).
              </div>
              <ImagePointPicker previewUrl={flow.previewUrl} rasterW={flow.rasterW} rasterH={flow.rasterH} points={flow.imagePoints} onPoint={addImagePoint} />
              <div style={{ marginTop: 8 }}><Button size="sm" variant="ghost" onClick={cancelFlow}>Cancel</Button></div>
            </>
          )}

          {flow.step === "map-points" && (
            <>
              <div style={{ fontSize: 12, marginBottom: 8 }}>Now click the two matching points on the real map, in the same order.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" onClick={runMapPointsThenSave}>Start clicking the map</Button>
                <Button size="sm" variant="ghost" onClick={cancelFlow}>Cancel</Button>
              </div>
            </>
          )}

          {flow.step === "saving" && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Saving…</div>}

          {flow.step === "scale-check" && (
            <>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                Placed. As a sanity check, measure a distance on the map you can compare against something you know (a stated building width, a lot dimension).
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" onClick={runScaleCheck}>Measure a distance</Button>
                <Button size="sm" variant="ghost" onClick={() => setFlow(null)}>Skip for now</Button>
              </div>
            </>
          )}

          {flow.step === "scale-check-note" && (
            <ScaleCheckNote ft={flow.scaleCheckFt} onSave={saveScaleCheck} onSkip={() => setFlow(null)} />
          )}

          {flow.step === "error" && (
            <>
              <div style={{ fontSize: 12, color: "var(--danger-text)", marginBottom: 8 }}>{flow.error}</div>
              <Button size="sm" variant="ghost" onClick={cancelFlow}>Close</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScaleCheckNote({ ft, onSave, onSkip }) {
  const [note, setNote] = useState("");
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{ft.toFixed(1)} ft</div>
      <Field label="Compared against (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the 200 ft building width shown on the flyer" style={inputStyle} /></Field>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button size="sm" onClick={() => onSave(note)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>Skip</Button>
      </div>
    </>
  );
}
