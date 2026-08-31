/* SitePlansSection — upload a site plan (a PDF/image, usually a broker flyer), pick which
 * page IS the site plan, and place it on the map (B848496). Rendered by MapFinder above the
 * Comps list, self-contained data owner (mirrors CompsPanel's own shape: fetch on mount, list
 * + form UI) for everything EXCEPT the placement itself.
 *
 * PLACEMENT (NEW-2 — the owner rejected the original 2-control-point wizard as friction, and
 * it also shipped a real defect, a plan placed upside down): a freshly picked page is uploaded
 * and inserted with a DEFAULT placement (`suggestPlacement`, provided by MapFinder from its
 * live map view — centered on the current view, sized to a fraction of it) and immediately
 * armed for editing on the map — no anchor step, no scale-check step. From then on, placing a
 * plan is drag / corner-scale / rotate directly on the map (MapFinder's
 * lib/overlayPlacementHandles.js), exactly mirroring the Site Planner's own on-canvas
 * reference-image tool. This module never touches that math — `commitPlacementRef` is how the
 * map reports a finished drag back here to persist.
 *
 * WHAT THIS DOES NOT DO: it never renders the plan itself — that's MapFinder's
 * useSitePlanOverlayLayers hook. It never builds a second PDF viewer — the uploaded file is
 * stored WHOLE via the existing Review/Library document pipeline (reviewStore.fileNewReview)
 * and stays openable there; this only rasterizes ONE page for the map overlay.
 *
 * `onStartPinOnOverlay(overlayId)` / `onStopPinOnOverlay()` — "the next click ON THIS RENDERED
 * PLAN creates a comp", which arrives back through the existing onPlaceComp / pendingAnchor
 * flow CompsPanel already has — no new comp-creation plumbing here.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Field, IconButton, MenuItem } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import AnchoredMenu from "../../ui/AnchoredMenu.jsx";
import {
  fetchAllOverlays, insertOverlay, updateOverlay, deleteOverlay,
} from "../lib/sitePlanOverlayStore.js";
import { overlayPlaced } from "../lib/sitePlanOverlays.js";
import { uploadOverlayRaster } from "../lib/overlayRasterStorage.js";
import { fileNewReview, loadReview, downloadFromDrive, stripFileExt } from "../../../workspaces/doc-review/lib/reviewStore.js";
import { listMyTeams, currentIdentity } from "../../../workspaces/site-planner/lib/teams.js";

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: FONT_SIZE.control, borderRadius: 6, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};
const metaText = { fontSize: FONT_SIZE.label, color: "var(--text-secondary)" };

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
const isAcceptedFile = (file) => file && (isPdf(file) || (file.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name || ""));

function MoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2 v20 M2 12 h20 M5 9 L2 12 L5 15 M19 9 L22 12 L19 15 M9 5 L12 2 L15 5 M9 19 L12 22 L15 19" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" /><path d="M12 2 v4 M12 18 v4 M2 12 h4 M18 12 h4" />
    </svg>
  );
}
function EyeIcon({ off }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="2" y1="2" x2="22" y2="22" />}
    </svg>
  );
}

/* The image-point picker was removed with the control-point wizard — a page preview is now
 * purely informational (no clicks collected). */
function PagePreview({ url }) {
  if (!url) return null;
  return <img src={url} alt="Page preview" style={{ maxWidth: "100%", maxHeight: 200, border: "1px solid var(--border-default)", borderRadius: 6, display: "block" }} />;
}

function emptyFlow() {
  return {
    step: "file", // file | page | saving | error
    file: null, fileBuffer: null, overlayId: null, // overlayId set only for "Change page"
    projectId: null, teamId: null, title: "", docDate: new Date().toISOString().slice(0, 10),
    pageCount: 1, page: 1, previewUrl: null,
    rasterBlob: null, rasterW: 0, rasterH: 0,
    error: null,
    dropPlacement: null, // {centerLat,centerLon} — where a dropped file landed on the map, if any
    queue: [], // remaining File objects still to place, after this one (multi-file drop)
    uploadProgress: null, // {sent,total} bytes, while the brochure itself is uploading
  };
}

/** One overlay's row — module scope (MODULE-SCOPE-COMPONENTS). */
function OverlayRow({
  o, expanded, onToggleExpand, isActive, onActivate, pinning, onStartPin, onStopPin,
  onSetOpacity, onToggleVisible, onRename, onConfirmChangePage, onDelete,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(o.docTitle || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingChangePage, setConfirmingChangePage] = useState(false);
  const menuBtnRef = useRef(null);

  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next && next !== o.docTitle) onRename(next);
    else setNameDraft(o.docTitle || "");
  };

  const placed = overlayPlaced(o);
  const sizeFt = placed ? `≈ ${Math.round(o.imgW * o.ftPerPx).toLocaleString()} × ${Math.round(o.imgH * o.ftPerPx).toLocaleString()} ft` : null;

  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", marginBottom: 8, background: isActive ? "var(--surface-raised)" : "transparent" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <button onClick={onToggleExpand} aria-label={expanded ? "Collapse" : "Expand"} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "2px 0 0", flex: "none" }}>
          <span style={{ fontSize: FONT_SIZE.micro, display: "inline-block", transform: expanded ? "none" : "rotate(-90deg)" }}>▾</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingName ? (
            <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameDraft(o.docTitle || ""); setEditingName(false); } }}
              style={{ ...inputStyle, fontSize: FONT_SIZE.control, fontWeight: 600, padding: "3px 6px" }} />
          ) : (
            <button onClick={() => setEditingName(true)} title="Rename" style={{
              border: "none", background: "none", padding: 0, textAlign: "left", cursor: "text", fontFamily: "inherit",
              fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{o.docTitle || "Untitled site plan"}</button>
          )}
          <div style={metaText} title={o.sourceFileName || undefined}>
            {o.sourceFileName ? `${o.sourceFileName} · ` : ""}{o.docDate || ""} · p.{o.page}
          </div>
        </div>
        <IconButton ref={menuBtnRef} size={24} onClick={() => setMenuOpen(true)} aria-label="More actions" title="More actions" style={{ flex: "none" }}>⋯</IconButton>
        <AnchoredMenu open={menuOpen} onClose={() => { setMenuOpen(false); setConfirmingDelete(false); }} anchorRef={menuBtnRef} placement="below-right" width={210}>
          {!confirmingDelete ? (
            <MenuItem onClick={() => setConfirmingDelete(true)} style={{ color: "var(--danger-text)" }}>Delete site plan…</MenuItem>
          ) : (
            <div style={{ padding: "6px 10px" }}>
              <div style={{ fontSize: FONT_SIZE.control, marginBottom: 8, color: "var(--text-primary)" }}>Delete “{o.docTitle || "this site plan"}”? Comps pinned to it keep their location but lose the link back.</div>
              <div style={{ display: "flex", gap: 6 }}>
                <Button size="sm" variant="danger" onClick={() => { setMenuOpen(false); setConfirmingDelete(false); onDelete(); }}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </AnchoredMenu>
      </div>

      {!placed && <div style={{ fontSize: FONT_SIZE.label, color: "var(--warn-text)", marginTop: 4 }}>Not placed yet.</div>}

      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-default)" }}>
          {sizeFt && <div style={{ ...metaText, marginBottom: 6 }}>{sizeFt}</div>}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <IconButton size={26} onClick={() => onToggleVisible()} active={false} aria-label={o.visible ? "Hide on map" : "Show on map"} title={o.visible ? "Hide on map" : "Show on map"}>
              <EyeIcon off={!o.visible} />
            </IconButton>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={metaText}>Opacity</span>
              <input type="range" min={0.2} max={1} step={0.05} value={o.opacity} onChange={(e) => onSetOpacity(Number(e.target.value))} style={{ flex: 1 }} />
              <span style={{ ...metaText, width: 32, textAlign: "right" }}>{Math.round(o.opacity * 100)}%</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Button size="sm" variant={isActive ? "primary" : "ghost"} onClick={() => onActivate()} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <MoveIcon />{isActive ? "Editing on map" : "Move / resize"}
            </Button>
            {pinning ? (
              <Button size="sm" variant="danger" onClick={onStopPin}>Cancel pin</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onStartPin} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PinIcon />Pin comp here</Button>
            )}
            {confirmingChangePage ? (
              <Button size="sm" variant="danger" onClick={() => { setConfirmingChangePage(false); onConfirmChangePage(); }}>Confirm — this clears its position</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmingChangePage(true)}>Change page…</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SitePlansSection({
  open, active = true, projects, onOverlaysChange,
  suggestPlacement, activeOverlayId, onActivateOverlay,
  onStartPinOnOverlay, onStopPinOnOverlay, pinningOverlayId,
  commitPlacementRef, dropIntakeRef, onRejectFile,
}) {
  const [overlays, setOverlays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [teams, setTeams] = useState([]);
  const [flow, setFlow] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const notifiedRef = useRef(onOverlaysChange);
  notifiedRef.current = onOverlaysChange;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

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

  // The map calls this on every finished drag (move / scale / rotate) — this module stays the
  // one place that persists an overlay, so its own list state can't drift from what the map
  // just committed. Optimistic locally, then written through.
  useEffect(() => {
    if (!commitPlacementRef) return undefined;
    commitPlacementRef.current = async (id, placement) => {
      const existing = overlaysRef.current.find((o) => o.id === id);
      if (!existing) return;
      const next = { ...existing, ...placement };
      setOverlays((list) => { const l = list.map((o) => (o.id === id ? next : o)); notifiedRef.current?.(l); return l; });
      await updateOverlay(id, next);
    };
    return () => { if (commitPlacementRef) commitPlacementRef.current = null; };
  }, [commitPlacementRef]);

  const setF = (patch) => setFlow((f) => (f ? { ...f, ...patch } : f));

  const rasterizePage = async (bytesOrFile, page) => {
    const { renderPdfPageToImageData } = await import("../../files/pdfRaster.js");
    const { imageData } = await renderPdfPageToImageData(bytesOrFile, page, { targetDpi: 150 });
    const blob = await imageDataToPngBlob(imageData);
    return { blob, w: imageData.width, h: imageData.height, url: URL.createObjectURL(blob) };
  };

  const startNewUpload = () => setFlow(emptyFlow());
  const cancelFlow = () => setFlow(null);

  // `extra` carries what a DROP already knows that a file-picker pick doesn't: where on the
  // map it landed (dropPlacement) and any sibling files still waiting their turn (queue) —
  // a multi-file drop places one plan at a time, through this same simple flow, advancing to
  // the next file automatically once the current one is placed (see confirmPage below).
  const pickFile = async (file, extra = {}) => {
    // A file-picker pick always has `flow` already open (startNewUpload ran first), but a
    // drag-and-drop pick calls this directly while `flow` is still null — `setF`'s null-guard
    // (below) would silently drop this very first patch, so this one write goes straight to
    // setFlow, unconditionally starting the flow rather than patching an already-open one.
    setFlow({ ...emptyFlow(), ...extra, file, error: null });
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

  // Drag-and-drop intake (NEW-2 second amendment): the map hands this whatever files landed on
  // it, plus where the FIRST one landed (dropPlacement). Unsupported files are rejected loudly
  // by name, never silently dropped from the list (LOUD-FAILURE); accepted files start the same
  // flow a file-picker pick starts, queued so several dropped files place one after another.
  useEffect(() => {
    if (!dropIntakeRef) return undefined;
    dropIntakeRef.current = (files, dropPlacement) => {
      const list = Array.from(files || []);
      const accepted = [], rejected = [];
      for (const f of list) (isAcceptedFile(f) ? accepted : rejected).push(f);
      for (const f of rejected) onRejectFile && onRejectFile(f.name || "that file", "only PDF or image files can become a site plan");
      if (!accepted.length) return;
      setExpandedId(null);
      pickFile(accepted[0], { dropPlacement: dropPlacement || null, queue: accepted.slice(1) });
    };
    return () => { if (dropIntakeRef) dropIntakeRef.current = null; };
  }, [dropIntakeRef]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const choosePage = async (n) => {
    if (n < 1 || n > flow.pageCount) return;
    setF({ page: n });
    try {
      const src = flow.fileBuffer || flow.file;
      const r = await rasterizePage(src, n);
      setF({ previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h });
    } catch (e) {
      setF({ error: (e && e.message) || "Couldn't render that page." });
    }
  };

  // Upload the whole brochure (if new), place the overlay with a default placement, and arm it
  // for editing immediately — no anchor step, no scale check. A dropped file's own drop point
  // (flow.dropPlacement) wins over the generic suggestPlacement fallback, which reads the live
  // map view (MapFinder) and centers on whatever the user is looking at.
  const confirmPage = async () => {
    const f = flow; // close over this render's flow — queue/dropPlacement/etc, before "saving" clears the step-specific fields nothing else needs
    setF({ step: "saving", uploadProgress: null });
    try {
      const placement = f.dropPlacement || (suggestPlacement ? suggestPlacement(f.rasterW, f.rasterH) : null);
      const onProgress = (sent, total) => setF({ uploadProgress: { sent, total } });
      let overlay;
      if (f.overlayId) {
        const existing = overlaysRef.current.find((o) => o.id === f.overlayId);
        const { data, error } = await updateOverlay(f.overlayId, {
          ...existing, page: f.page, imgW: f.rasterW, imgH: f.rasterH,
          ...(placement || {}), // Change page clears the old placement's fit — re-place fresh
        });
        if (error) throw error;
        overlay = data;
      } else {
        const projectName = (projects || []).find((p) => p.id === f.projectId)?.site || (projects || []).find((p) => p.id === f.projectId)?.name || "";
        const uploaded = await fileNewReview({
          projectId: f.projectId, project: projectName, discipline: "Site Plan",
          item: f.title, docDate: f.docDate, blob: f.file, fileName: (f.file && f.file.name) || "site-plan.pdf",
          onProgress,
        });
        if (!uploaded.ok) throw new Error(uploaded.error || "Couldn't upload the brochure.");
        const { data, error } = await insertOverlay({
          projectId: f.projectId, teamId: f.teamId,
          reviewId: uploaded.id, reviewUserId: currentUserId, page: f.page,
          docTitle: f.title, docDate: f.docDate, sourceFileName: (f.file && f.file.name) || "",
          imgW: f.rasterW, imgH: f.rasterH, opacity: 0.85, visible: true,
          ...(placement || {}),
        });
        if (error) throw error;
        overlay = data;
      }
      const up = await uploadOverlayRaster(overlay.id, f.rasterBlob);
      if (up) { const { data } = await updateOverlay(overlay.id, { ...overlay, rasterKey: up.key }); overlay = data || overlay; }
      await reload();
      setExpandedId(overlay.id);
      onActivateOverlay && onActivateOverlay(overlay.id);
      // A multi-file drop queues the rest — place them one after another through the same flow
      // rather than a second modal; each still gets its own title/date/page pick.
      if (f.queue && f.queue.length) pickFile(f.queue[0], { queue: f.queue.slice(1) });
      else setFlow(null);
    } catch (e) {
      setF({ error: (e && e.message) || "Couldn't save that site plan.", step: "error" });
    }
  };

  // ---- change page (re-fetch the WHOLE brochure's bytes, never re-uploaded) --------------
  const startChangePage = async (overlay) => {
    const f = emptyFlow();
    setFlow({ ...f, overlayId: overlay.id, step: "saving" });
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

  // ---- simple per-item controls -----------------------------------------------------------
  const patchAndReload = async (o, patch) => { await updateOverlay(o.id, { ...o, ...patch }); await reload(); };
  const rename = (o, docTitle) => patchAndReload(o, { docTitle });
  const setOpacity = (o, opacity) => patchAndReload(o, { opacity });
  const toggleVisible = (o) => patchAndReload(o, { visible: !o.visible });
  const remove = async (o) => { await deleteOverlay(o.id); if (activeOverlayId === o.id) onActivateOverlay && onActivateOverlay(null); await reload(); };

  return (
    <div style={{ borderBottom: "1px solid var(--border-default)", padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: overlays.length ? 8 : 0 }}>
        <span style={{ fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>Site plans</span>
        {!flow && <Button size="sm" variant="ghost" onClick={startNewUpload}>+ Upload site plan</Button>}
      </div>

      {!flow && overlays.length === 0 && !loading && (
        <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>
          Upload a broker flyer or park plan — drag it into position on the map and pin comps to specific buildings on it.
        </div>
      )}

      {!flow && overlays.map((o) => (
        <OverlayRow key={o.id} o={o}
          expanded={expandedId === o.id}
          onToggleExpand={() => setExpandedId((id) => (id === o.id ? null : o.id))}
          isActive={activeOverlayId === o.id}
          onActivate={() => { setExpandedId(o.id); onActivateOverlay && onActivateOverlay(o.id); }}
          pinning={pinningOverlayId === o.id}
          onStartPin={() => onStartPinOnOverlay?.(o.id)}
          onStopPin={() => onStopPinOnOverlay?.()}
          onSetOpacity={(v) => setOpacity(o, v)}
          onToggleVisible={() => toggleVisible(o)}
          onRename={(name) => rename(o, name)}
          onConfirmChangePage={() => startChangePage(o)}
          onDelete={() => remove(o)}
        />
      ))}

      {flow && (
        <div style={{ marginTop: 8, padding: 10, border: "1px solid var(--border-default)", borderRadius: 8, background: "var(--surface-raised)" }}>
          {flow.step === "file" && (
            <>
              <div style={{ fontSize: FONT_SIZE.control, marginBottom: 8 }}>Choose a PDF or image, or drag it onto the map. A multi-page brochure keeps every page — you'll pick which one to place next.</div>
              <input type="file" accept="application/pdf,image/*" onChange={(e) => e.target.files[0] && pickFile(e.target.files[0])} style={{ fontSize: FONT_SIZE.control }} />
              <div style={{ marginTop: 8 }}><Button size="sm" variant="ghost" onClick={cancelFlow}>Cancel</Button></div>
            </>
          )}

          {flow.step === "page" && (
            <>
              {flow.queue && flow.queue.length > 0 && (
                <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginBottom: 8 }}>
                  {flow.queue.length} more file{flow.queue.length === 1 ? "" : "s"} dropped, waiting to be placed after this one.
                </div>
              )}
              {!flow.overlayId && <>
                <Field label="Document title" stacked><input value={flow.title} onChange={(e) => setF({ title: e.target.value })} style={inputStyle} /></Field>
                <Field label="Document date" stacked required><input type="date" value={flow.docDate} onChange={(e) => setF({ docDate: e.target.value })} style={inputStyle} /></Field>
                {projects?.length > 0 && (
                  <Field label="Project (optional)" stacked>
                    <select value={flow.projectId || ""} onChange={(e) => setF({ projectId: e.target.value || null })} style={inputStyle}>
                      <option value="">No project</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.site || p.name}</option>)}
                    </select>
                  </Field>
                )}
                {teams?.length > 0 && (
                  <Field label="Share with team" stacked>
                    <select value={flow.teamId || ""} onChange={(e) => setF({ teamId: e.target.value || null })} style={inputStyle}>
                      <option value="">Just me</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                )}
              </>}
              {flow.pageCount > 1 && (
                <Field label={`Page (${flow.page} of ${flow.pageCount})`} stacked>
                  <span style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" variant="ghost" disabled={flow.page <= 1} onClick={() => choosePage(flow.page - 1)}>&larr;</Button>
                    <Button size="sm" variant="ghost" disabled={flow.page >= flow.pageCount} onClick={() => choosePage(flow.page + 1)}>&rarr;</Button>
                  </span>
                </Field>
              )}
              <PagePreview url={flow.previewUrl} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Button size="sm" onClick={confirmPage} disabled={!flow.overlayId && (!flow.title || !flow.docDate)}>{flow.overlayId ? "Use this page" : "Place on map"}</Button>
                <Button size="sm" variant="ghost" onClick={cancelFlow}>Cancel</Button>
              </div>
            </>
          )}

          {flow.step === "saving" && (
            <div>
              <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginBottom: flow.uploadProgress ? 6 : 0 }}>
                {flow.uploadProgress ? "Uploading the brochure…" : "Saving…"}
              </div>
              {flow.uploadProgress && flow.uploadProgress.total > 0 && (
                <>
                  <div style={{ height: 6, borderRadius: RADIUS.pill, background: "var(--border-default)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: RADIUS.pill, background: "var(--accent)",
                      width: `${Math.min(100, Math.round((flow.uploadProgress.sent / flow.uploadProgress.total) * 100))}%`,
                      transition: "width .15s linear",
                    }} />
                  </div>
                  <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: 3 }}>
                    {(flow.uploadProgress.sent / (1024 * 1024)).toFixed(1)} of {(flow.uploadProgress.total / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </>
              )}
            </div>
          )}

          {flow.step === "error" && (
            <>
              <div style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)", marginBottom: 8 }}>{flow.error}</div>
              <Button size="sm" variant="ghost" onClick={cancelFlow}>Close</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
