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
import { createPortal } from "react-dom";
import { Button, Field, IconButton, MenuItem, ToggleChip } from "../../ui/controls.jsx";
import AnchoredMenu from "../../ui/AnchoredMenu.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import { MAP_CHROME_Z, panelMaxHeight, SCALE_BAR_CLEARANCE_PX } from "../../../workspaces/site-planner/lib/mapChromeStack.js";
import {
  fetchAllOverlays, insertOverlay, updateOverlay, deleteOverlay,
  fetchOverlayCompPoints, commitOverlayPlacementWithComps,
  fetchDeletedOverlays, restoreOverlay, permanentlyDeleteOverlay,
} from "../lib/sitePlanOverlayStore.js";
import { overlayPlaced } from "../lib/sitePlanOverlays.js";
import { imagePointToLatLon } from "../lib/overlayGeoref.js";
import { friendlySaveError } from "../lib/overlayErrors.js";
import { uploadOverlayRaster, downloadOverlayRasterUrl } from "../lib/overlayRasterStorage.js";
import ImageCropTool from "./ImageCropTool.jsx";
import { hasCrop } from "../../../workspaces/site-planner/lib/overlayCrop.js";
import {
  OVERLAY_RASTER_BASE_DPI, OVERLAY_RASTER_MAX_LONG_EDGE_PX, OVERLAY_RASTER_JPEG_QUALITY,
  OVERLAY_THUMB_MAX_LONG_EDGE_PX, OVERLAY_THUMB_JPEG_QUALITY, cappedRasterDims,
} from "../lib/overlayRasterSize.js";
import { fileNewReview, loadReview, downloadFromDrive, stripFileExt } from "../../../workspaces/doc-review/lib/reviewStore.js";
import { listMyTeams, currentIdentity } from "../../../workspaces/site-planner/lib/teams.js";
import { loadSiteSummaries } from "../../../workspaces/site-planner/lib/siteListLight.js";
import { PALETTES } from "../../theme/palette.js";
import { createWriteSerializer } from "../../cloud/writeSerializer.js";

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: FONT_SIZE.control, borderRadius: 6, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};
const metaText = { fontSize: FONT_SIZE.label, color: "var(--text-secondary)" };
// NEW-3 (B1263074) — the ONE height/alignment for the row's four action controls (Move/resize,
// Crop, Pin comp here, Change page). A Button or ToggleChip's rendered height otherwise depends
// on what happens to be inside it (an inline icon raises the line-box height above plain text),
// which is how these landed at three different heights (24/26/28px) with none of them aligned.
const ACTION_BTN_STYLE = { height: 26, boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 };

// The overlay raster is a MAP BACKGROUND (see this file's own header — the original brochure
// stays untouched in Review/Library), so it's stored as a resolution-capped JPEG rather than a
// lossless PNG (B972225 NEW-5 — measured on the owner's real Airtex flyer: rasterizing the page
// costs ~700-1300ms, re-encoding it costs tens of ms either way, so the codec choice is nearly
// free — the real saving from resolution capping only shows up on a page bigger than a normal
// flyer sheet; see overlayRasterSize.js's header for the full numbers).
// B972512-HARDENING item 12 — four clear, distinct messages for the ways a picked PDF can fail
// to become a site plan, none of them a crash: an empty (0-byte) file, a password-protected
// PDF, a corrupt/invalid PDF, and anything else pdf.js can't make sense of (a malformed page,
// an unsupported feature). pdf.js throws typed exceptions with a stable `.name`
// (PasswordException / InvalidPDFException / UnknownErrorException / ResponseException —
// verified against the installed pdfjs-dist source, not assumed) — this is the one place that
// translates them, so both the initial pick (pickFile) and a "Change page" reopen
// (reopenSourceForChangePage) give the same clear wording instead of pdf.js's raw exception text.
function friendlyPdfError(e, file) {
  if (file && file.size === 0) return "That file is empty (0 bytes) — check the export and try again.";
  const name = e && e.name;
  if (name === "PasswordException") return "That PDF is password-protected — remove the password (or re-export without one) and try again.";
  if (name === "InvalidPDFException") return "That doesn't look like a valid PDF — it may be corrupted. Try re-exporting or re-downloading it.";
  if (name === "UnknownErrorException" || name === "ResponseException") return "Couldn't read that PDF — it may be corrupted or use a feature this app doesn't support.";
  return null; // not a recognized pdf.js failure — let the caller fall back to its own message
}

function imageDataToBlob(imageData, format = "image/jpeg", quality = OVERLAY_RASTER_JPEG_QUALITY) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width; canvas.height = imageData.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);
    canvas.toBlob((blob) => { canvas.width = 0; canvas.height = 0; resolve(blob); }, format, quality);
  });
}

// A small inline thumbnail for the Site plans list row — built from the SAME already-decoded
// pixels as the main raster (no second PDF render / image decode), so it costs one cheap canvas
// downscale + a tiny JPEG encode, never a second expensive rasterize.
function imageDataToThumbDataUrl(imageData) {
  const { w, h } = cappedRasterDims(imageData.width, imageData.height, OVERLAY_THUMB_MAX_LONG_EDGE_PX);
  const src = document.createElement("canvas");
  src.width = imageData.width; src.height = imageData.height;
  src.getContext("2d").putImageData(imageData, 0, 0);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d");
  octx.drawImage(src, 0, 0, w, h);
  src.width = 0; src.height = 0;
  const url = out.toDataURL("image/jpeg", OVERLAY_THUMB_JPEG_QUALITY);
  out.width = 0; out.height = 0;
  return url;
}

function imageFileDims(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight, img }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// A plain image drop (not a PDF) gets the SAME resolution cap + JPEG re-encode as a rasterized
// PDF page — previously this path used the uploaded file's own bytes untouched, so a big
// screenshot or an exported TIFF rode straight onto the map at full size (B972225 NEW-5).
async function capImageFile(file) {
  const { w, h, img } = await imageFileDims(file);
  const { w: cw, h: ch } = cappedRasterDims(w, h, OVERLAY_RASTER_MAX_LONG_EDGE_PX);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  // A canvas 2D context can't read CSS var() tokens (KEY DECISIONS — the SVG/canvas JS mirror
  // exists for exactly this), and this fill is the physical PAGE background, not app chrome, so
  // it's a fixed white rather than theme-reactive — reusing the palette's own white constant
  // instead of a new raw hex literal (matches overlayPlacementHandles.js's precedent).
  ctx.fillStyle = PALETTES.light.onAccent; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  const imageData = ctx.getImageData(0, 0, cw, ch);
  const blob = await imageDataToBlob(imageData, "image/jpeg", OVERLAY_RASTER_JPEG_QUALITY);
  const thumbDataUrl = imageDataToThumbDataUrl(imageData);
  canvas.width = 0; canvas.height = 0;
  return { blob, w: cw, h: ch, thumbDataUrl, url: URL.createObjectURL(blob) };
}

const isPdf = (file) => file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));

// B972512-HARDENING item 10 — TIFF and HEIC/HEIF are accepted by neither PDF.js nor a plain
// <img>/canvas decode in any mainstream browser (Chrome/Firefox have no native TIFF or HEIC
// decoder at all; Safari's partial HEIC support isn't something to rely on here) — the OLD gate
// let both THROUGH (the extension regex explicitly matched "tiff?", and a HEIC file's own MIME
// type, image/heic or image/heif, matches the broad "image/" prefix check), so a broker's HEIC
// photo or a surveyor's TIFF scan silently failed partway through `capImageFile`'s image decode
// instead of being told, by name, that it isn't supported. WebP decodes fine everywhere this app
// ships and stays accepted.
function unsupportedImageReason(file) {
  if (!file) return null;
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/i.test(name)) {
    return "HEIC/HEIF photos aren't supported yet — export it as PDF, PNG, or JPEG first, then try again.";
  }
  if (type.includes("tiff") || /\.tiff?$/i.test(name)) {
    return "TIFF images aren't supported yet — export it as PDF, PNG, or JPEG first, then try again.";
  }
  return null;
}
const isAcceptedFile = (file) => file && !unsupportedImageReason(file) &&
  (isPdf(file) || (file.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || ""));

function MoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2 v20 M2 12 h20 M5 9 L2 12 L5 15 M19 9 L22 12 L19 15 M9 5 L12 2 L15 5 M9 19 L12 22 L15 19" />
    </svg>
  );
}
function CropIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2 v14 a2 2 0 0 0 2 2 h14" /><path d="M18 22 V8 a2 2 0 0 0-2-2 H2" />
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
function LockIcon({ locked }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {locked ? <path d="M8 11 V7 a4 4 0 0 1 8 0 v4" /> : <path d="M8 11 V7 a4 4 0 0 1 7-2.5" />}
    </svg>
  );
}
// NEW-5 (owner chat, 2026-09-08) — the resting card's one action button becomes this menu's
// trigger; drawn (not the `⋯` text glyph) for the same reason ProjectBreadcrumb's own per-row
// kebab is (a text ellipsis is at the mercy of the platform font, sitting beside real SVG icons).
function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
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
    projectId: null, title: "", docDate: new Date().toISOString().slice(0, 10),
    pageCount: 1, page: 1, previewUrl: null,
    rasterBlob: null, rasterW: 0, rasterH: 0, thumbDataUrl: null,
    error: null,
    dropPlacement: null, // {lat,lng} — where a dropped file landed on the map, if any (a center override only — never a full placement on its own, see confirmPage)
    queue: [], // remaining File objects still to place, after this one (multi-file drop)
    uploadProgress: null, // {sent,total} bytes, while the brochure itself is uploading
    crop: null, // {x,y,w,h} in source-image px — set via "Crop…" in the page-picker step (NEW-21)
    cropping: false, // the crop tool is open ON TOP of the page-picker step
  };
}

/** One overlay's RESTING card (B1310208, NEW-1, owner decision 2026-09-07: "at rest the plan card
 * shows what it IS and nothing you operate"). Thumbnail, name, date/page and status lines only —
 * every editing control (visibility, lock, opacity, rotation, share, move/resize, crop) lives in
 * the docked SitePlanAdjustPanel below; the occasional, deliberate ones (Adjust, Change page, Pin
 * comp here, Delete site plan) live in this row's own three-dot menu.
 * ⛔ NEW-5 (owner chat, 2026-09-08) — SUPERSEDES B1310210's "why do we even have the three dots"
 * removal, and this is a deliberate correction, not a revert of that item: what the owner objected
 * to on 2026-09-07 was that the menu rendered with NO background at all (fixed at the root by
 * B1263075, `AnchoredMenu`'s own default-opaque-surface fix) — not the menu existing. With that
 * fixed, he asked for the labelled "Adjust" button itself to become the icon, so the resting card
 * reads even quieter: a name, a thumbnail, and one small control rather than one labelled button.
 * Module scope (MODULE-SCOPE-COMPONENTS). */
function OverlayRow({
  o, adjustOpen, onOpenAdjust, onRename, rasterFailed, duplicateCount, zoomBelowGate, onZoomToOverlay,
  pinning, onStartPin, onStopPin, onConfirmChangePage, onDelete,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(o.docTitle || "");
  const [menuOpen, setMenuOpen] = useState(false);
  // "list" | "confirmChangePage" | "confirmDelete" — the menu swaps its OWN content for a
  // confirm step rather than closing (the ProjectBreadcrumb per-row kebab's own pattern), so
  // Change page / Delete keep a real "are you sure" without a second, separate control.
  const [menuView, setMenuView] = useState("list");
  const menuAnchorRef = useRef(null);
  const closeMenu = () => { setMenuOpen(false); setMenuView("list"); };

  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next && next !== o.docTitle) onRename(next);
    else setNameDraft(o.docTitle || "");
  };

  const placed = overlayPlaced(o);

  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", marginBottom: 8, background: adjustOpen ? "var(--surface-raised)" : "transparent" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {o.thumbDataUrl ? (
          <img src={o.thumbDataUrl} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", flex: "none" }} />
        ) : (
          <div aria-hidden="true" style={{ width: 32, height: 32, borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-raised)", flex: "none" }} />
        )}
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
          {/* NEW-9(d) (owner report, build 9c35724: "the filename is printed twice") — a fresh
              upload seeds `docTitle` from the filename minus its extension (`stripFileExt`,
              above), so on every UNRENAMED plan — the common case right after upload — this
              subtitle used to repeat the exact same name a second time, with the extension put
              back on. The filename is only worth a second line once it says something the title
              doesn't (the owner renamed the plan to something else) — otherwise this row prints
              the date/page only, once. */}
          <div style={metaText} title={o.sourceFileName || undefined}>
            {o.sourceFileName && stripFileExt(o.sourceFileName) !== (o.docTitle || "") ? `${o.sourceFileName} · ` : ""}{o.docDate || ""} · p.{o.page}
          </div>
        </div>
        {/* NEW-5 — the ONE control that leaves the resting card: Adjust opens the docked
            manipulation panel; Change page / Pin comp here / Delete site plan are occasional,
            deliberate edits that don't need their own always-visible buttons. */}
        <div style={{ position: "relative", flex: "none" }}>
          <IconButton ref={menuAnchorRef} size={26} active={adjustOpen || menuOpen}
            onClick={() => setMenuOpen((v) => !v)} aria-label="More actions" title="More actions">
            <KebabIcon />
          </IconButton>
          <AnchoredMenu open={menuOpen} onClose={closeMenu} anchorRef={menuAnchorRef} placement="below-right" width={210}>
            {menuView === "list" && (
              <>
                <MenuItem onClick={() => { closeMenu(); onOpenAdjust(); }}>Adjust</MenuItem>
                <MenuItem onClick={() => setMenuView("confirmChangePage")}>Change page…</MenuItem>
                {placed && (pinning ? (
                  <MenuItem onClick={() => { closeMenu(); onStopPin(); }} style={{ display: "flex", alignItems: "center", gap: 6 }}><PinIcon />Cancel pin</MenuItem>
                ) : (
                  <MenuItem onClick={() => { closeMenu(); onStartPin(); }} style={{ display: "flex", alignItems: "center", gap: 6 }}><PinIcon />Pin comp here</MenuItem>
                ))}
                <MenuItem onClick={() => setMenuView("confirmDelete")} style={{ color: "var(--danger-text)" }}>Delete site plan…</MenuItem>
              </>
            )}
            {menuView === "confirmChangePage" && (
              <div style={{ padding: "5px 7px" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 9 }}>
                  Changing the page clears this plan's position on the map.
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <Button size="sm" variant="ghost" onClick={() => setMenuView("list")}>Cancel</Button>
                  <Button size="sm" variant="danger" onClick={() => { closeMenu(); onConfirmChangePage(); }}>Change page</Button>
                </div>
              </div>
            )}
            {menuView === "confirmDelete" && (
              <div style={{ padding: "5px 7px" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 9 }}>
                  Delete “{o.docTitle || "this site plan"}”? Comps pinned to it keep their location but lose the link back.
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <Button size="sm" variant="ghost" onClick={() => setMenuView("list")}>Cancel</Button>
                  <Button size="sm" variant="danger" onClick={() => { closeMenu(); onDelete(); }}>Delete</Button>
                </div>
              </div>
            )}
          </AnchoredMenu>
        </div>
      </div>

      {!placed && <div style={{ fontSize: FONT_SIZE.label, color: "var(--warn-text)", marginTop: 4 }}>Not placed yet.</div>}
      {/* B972512-HARDENING item 15 — no DB constraint stops the same document+page from being
          overlaid twice (deliberately: the schema allows several distinct overlay pages off one
          brochure, so a hard uniqueness rule would also block a legitimate reuse). Surfaced
          instead, on every row sharing the duplicate, so it's obvious and each copy is one click
          from Adjust's "Delete site plan…" to remove. */}
      {duplicateCount > 1 && (
        <div style={{ fontSize: FONT_SIZE.label, color: "var(--warn-text)", marginTop: 4 }}>
          Page {o.page} of this document is overlaid {duplicateCount} times — one of these may be a duplicate.
        </div>
      )}
      {placed && rasterFailed && (
        <div style={{ fontSize: FONT_SIZE.label, color: "var(--warn-text)", marginTop: 4 }}>
          Image didn't load — you may not have access, or the file is missing. Reload to try again.
        </div>
      )}
      {/* B972512-HARDENING item 16 — a row that was interrupted (closed tab, lost connection)
          between being placed and its image finishing upload has no rasterKey at all (distinct
          from rasterFailed, which is a download failure of a key that DOES exist) — legible and
          recoverable via the same "Change page…" control (now in Adjust) rather than an
          unexplained blank plan. */}
      {placed && !rasterFailed && !o.rasterKey && (
        <div style={{ fontSize: FONT_SIZE.label, color: "var(--warn-text)", marginTop: 4 }}>
          This plan doesn't have an image yet — open Adjust and try “Change page…”.
        </div>
      )}
      {/* B850432/NEW-1 — a site plan is gated off the map below a real building-scale zoom (a
          site plan is meaningless zoomed out to a metro or country view), and that gate used to
          be completely silent — the row above reads opacity/eye-toggle state exactly as if the
          plan were on screen, with nothing telling you it isn't. Mirrors the Layers-panel
          zoom-gate convention (layerZoomGate.js): say so, and offer the one click that fixes it. */}
      {placed && o.visible && zoomBelowGate && (
        <div style={{ fontSize: FONT_SIZE.label, color: "var(--warn-text)", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>Zoomed out too far to see this on the map.</span>
          <Button size="sm" variant="ghost" onClick={() => onZoomToOverlay(o)}>Zoom in</Button>
        </div>
      )}
    </div>
  );
}

/** The docked "Adjust" panel (B1310209, NEW-2, owner decision 2026-09-07 — "if it's like a small
 * panel, then that's fine by me"). Opened by OverlayRow's three-dot menu and portaled straight
 * onto the map (docked bottom-right, MAP_CHROME_Z.panel — mapChromeStack.js's own header has the
 * corner reasoning and the measured scale-bar clearance). Same surface/border/radius/shadow as the
 * Layers panel, so it reads as the fourth instance of the app's existing floating-map-panel
 * system, not a new one — it DOCKS, it never hovers or drags.
 * ⛔ NEW-5 (owner chat, 2026-09-08) — this panel now holds ONLY the controls you manipulate WHILE
 * adjusting a plan already on the map: visibility, lock, opacity, rotation, share, move/resize,
 * crop. Change page / Pin comp here / Delete site plan moved OUT, to OverlayRow's own three-dot
 * menu — those are occasional, deliberate actions, not something dragged or watched while
 * positioning the plan, and having them here made the panel do two different jobs at once.
 * NEW-4 — opacity (dragged constantly, judged on the map) is its own prominent, full-width block;
 * rotation (set once, and read-only while locked per B1154369) is a visibly quieter, compact one
 * right below it — the two no longer compete for the same weight.
 * ⛔ Found live during B1310209's own headless verification: the global help/report FAB
 * (`app/HelpReportControl.jsx`) is ALSO fixed bottom-right and measures the real DOM to decide
 * its own clearance (`shared/ui/cornerClearance.js`) — but it only clears Leaflet's own
 * `.leaflet-bottom.leaflet-right` container and anything carrying `data-canvas-corner`. A new
 * bottom-right occupant that doesn't declare itself is invisible to that math, and this panel's
 * footer sat right where the FAB was measured to land. Declaring
 * `data-canvas-corner="site-plan-adjust"` is the whole fix — no coordinate math of our own,
 * the FAB reads our rendered box and floats clear of it, per that module's own contract. */
function SitePlanAdjustPanel({
  o, isActive, onActivate, onDeactivate,
  onSetOpacity, onOpacityCommit, onSetRotation, onToggleVisible, onToggleLocked, onStartCrop,
  teams, onShareTeam, isOwner, onClose,
}) {
  // B1134753 NEW-20 — "rotation needs a way to type an exact value." `null` = not editing (show
  // the live stored value); a string while the field has focus, so a half-typed "12." isn't
  // clobbered by the next map-driven re-render mid-keystroke.
  const [rotDraft, setRotDraft] = useState(null);
  const rotCancelingRef = useRef(false); // Escape sets this so the resulting blur doesn't ALSO commit

  const commitRotation = () => {
    if (rotCancelingRef.current) { rotCancelingRef.current = false; setRotDraft(null); return; }
    const v = parseFloat(rotDraft);
    setRotDraft(null);
    if (Number.isFinite(v)) onSetRotation(((v % 360) + 360) % 360);
  };

  const placed = overlayPlaced(o);
  const sizeFt = placed ? `≈ ${Math.round(o.imgW * o.ftPerPx).toLocaleString()} × ${Math.round(o.imgH * o.ftPerPx).toLocaleString()} ft` : null;

  return (
    <div data-testid="site-plan-adjust-panel" data-canvas-corner="site-plan-adjust" style={{
      position: "absolute", bottom: SCALE_BAR_CLEARANCE_PX, right: 10, zIndex: MAP_CHROME_Z.panel,
      width: 258, maxHeight: panelMaxHeight({ topPx: 70, bottomPx: SCALE_BAR_CLEARANCE_PX, minPx: 160 }),
      display: "flex", flexDirection: "column",
      background: "var(--surface-overlay)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)", overflow: "hidden", // design-exempt: matches the Layers panel's own boxShadow verbatim (MapFinder.jsx) — no shadow-color token exists repo-wide yet
    }}>
      <div style={{ flex: "none", padding: "7px 10px 5px", fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--text-primary)", borderBottom: "1px solid var(--border-default)" }}>
        Adjust site plan
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "8px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <IconButton size={26} onClick={() => onToggleVisible()} active={false} aria-label={o.visible ? "Hide on map" : "Show on map"} title={o.visible ? "Hide on map" : "Show on map"}>
            <EyeIcon off={!o.visible} />
          </IconButton>
          {/* B972512-HARDENING item 17 — owner-only, matching site_plan_overlays' own UPDATE
              policy (and sites' identical share_locked precedent). A non-owner sees the SAME
              icon, greyed and inert with a title explaining why — never a control that looks
              clickable but silently does nothing. */}
          <IconButton size={26} onClick={isOwner ? () => onToggleLocked() : undefined} active={false}
            disabled={!isOwner}
            aria-label={o.locked ? "Unlock" : "Lock"}
            title={isOwner ? (o.locked ? "Unlock — allow moving/resizing" : "Lock — prevent moving/resizing") : "Only the person who uploaded this can lock or unlock it"}
            style={!isOwner ? { opacity: 0.4, cursor: "default" } : undefined}>
            <LockIcon locked={o.locked} />
          </IconButton>
          <span style={metaText}>{o.visible ? "Visible" : "Hidden"}{o.locked ? " · locked" : ""}</span>
        </div>

        {/* NEW-4 — the prominent, full-width block: opacity is dragged constantly and its result
            is judged on the map, so it gets the room. */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)" }}>Opacity</span>
            <span style={{ ...metaText, fontWeight: 600 }}>{Math.round(o.opacity * 100)}%</span>
          </div>
          {/* NEW-8 — dragging used to write to Supabase and refetch the whole overlay list on
              every `onChange` tick. `onSetOpacity` is now local-only + debounced (see the
              parent's `setOpacityLive`); `onOpacityCommit` flushes the pending value the instant
              the drag ends instead of waiting out the debounce window. */}
          <input type="range" min={0.2} max={1} step={0.05} value={o.opacity}
            onChange={(e) => onSetOpacity(Number(e.target.value))}
            onMouseUp={onOpacityCommit} onTouchEnd={onOpacityCommit} onKeyUp={onOpacityCommit}
            style={{ width: "100%" }} />
        </div>

        {/* NEW-4 — the quieter, compact block right below it: rotation is set once, so it reads
            smaller and lighter than Opacity above rather than sharing its weight. Read-only while
            locked (B1154369 — do NOT undo: this already presents as "0° · locked — unlock to
            rotate", which shipped and is right). */}
        {placed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={metaText}>Rotation</span>
            {o.locked ? (
              <span style={metaText}>{Math.round((o.rotationDeg || 0) * 10) / 10}° · locked — unlock to rotate</span>
            ) : (
              <>
                <input type="number" step={0.1}
                  value={rotDraft != null ? rotDraft : Math.round((o.rotationDeg || 0) * 10) / 10}
                  onChange={(e) => setRotDraft(e.target.value)}
                  onFocus={() => setRotDraft(String(Math.round((o.rotationDeg || 0) * 10) / 10))}
                  onBlur={commitRotation}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.currentTarget.blur(); }
                    if (e.key === "Escape") { rotCancelingRef.current = true; e.currentTarget.blur(); }
                  }}
                  style={{ ...inputStyle, width: 56, fontSize: FONT_SIZE.label, padding: "3px 5px" }} />
                <span style={metaText}>°</span>
              </>
            )}
          </div>
        )}

        {/* B972512-HARDENING item 8 — sharing is a deliberate, POST-placement action, gated on
            `placed` so a half-set-up plan (still at its auto-suggested default position) can
            never appear on a teammate's map before its owner has actually positioned it. */}
        {placed && teams?.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={metaText}>Share with</span>
            <select value={o.teamId || ""} onChange={(e) => onShareTeam(e.target.value || null)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">Just me</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {/* NEW-5 — Move/resize and Crop are the two things you manipulate on the map itself
            while this panel is open; one shared height (ACTION_BTN_STYLE, NEW-3/B1263074). */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 6, borderTop: "1px solid var(--border-default)" }}>
          {/* Move/resize's own label now doubles as its exit — clicking it again while active
              stops editing, which is what the old overflow menu's "Stop editing" row did. */}
          <Button size="sm" variant={isActive ? "primary" : "ghost"} disabled={placed && o.locked}
            onClick={() => (isActive ? onDeactivate() : onActivate())} style={ACTION_BTN_STYLE}
            title={placed && o.locked ? "Locked — unlock to move or resize" : (sizeFt || undefined)}>
            <MoveIcon />{isActive ? "Editing on map" : placed ? "Move / resize" : "Place on map"}
          </Button>
          {/* NEW-1 (B1783328) — the lock never gated this control (B1154369 only closed the map
              handles + the rotation field), so a locked overlay's crop was still editable. Same
              disabled/title pattern as the Move/resize button above. */}
          <ToggleChip active={hasCrop(o)} disabled={!o.rasterKey || (placed && o.locked)}
            onClick={onStartCrop} style={{ ...ACTION_BTN_STYLE, opacity: !o.rasterKey || (placed && o.locked) ? 0.5 : 1, cursor: !o.rasterKey || (placed && o.locked) ? "not-allowed" : "pointer" }}
            title={placed && o.locked ? "Locked — unlock to crop" : !o.rasterKey ? "This plan doesn't have an image yet" : hasCrop(o) ? "Already cropped — edit or reset it" : undefined}>
            <CropIcon />{hasCrop(o) ? "Edit crop" : "Crop…"}
          </ToggleChip>
        </div>
      </div>

      {/* NEW-5 — Delete moved to OverlayRow's own three-dot menu (an occasional, deliberate
          action, not something manipulated while adjusting), so the footer is Done alone now. */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "7px 10px", borderTop: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

export default function SitePlansSection({
  open, active = true, projects, onOverlaysChange,
  suggestPlacement, activeOverlayId, onActivateOverlay,
  onStopPinOnOverlay, pinningOverlayId,
  commitPlacementRef, dropIntakeRef, onRejectFile, onCompPositionsChanged, rasterFailedIds,
  zoomBelowGate, onZoomToOverlay,
  // B1167712-B1167714 (NEW-1/2/3, owner decision 2026-09-07 — "we really shouldn't even show
  // site plans... they should just be attached to comps") — this no longer renders a standalone
  // list. `focusedProjectId`/`focusedCompId` name the comp currently open in the Comps rail (see
  // MapFinder's `focusedComp`, bubbled up from CompsPanel); with nothing focused this component
  // renders nothing (except an in-flight upload/crop flow, which is never site-scoped).
  // `onStartPinExistingComp(compId, overlayId)` replaces `onStartPinOnOverlay` here — pinning is
  // always re-pinning the ALREADY-OPEN comp now, never creating a new one (that flow still exists,
  // unchanged, via this card's own "Pin comp here" — the map toolbar's "Place comp → on a site
  // plan" menu was removed by NEW-1, 2026-09-08). `startUploadRef` lets the
  // Comps list's own "+ Site plan" button (no comp open yet — order (a), upload-first) trigger the
  // same upload flow this component owns.
  focusedProjectId = null, focusedCompId = null, onStartPinExistingComp, startUploadRef,
  // B1310209 (NEW-2) — a ref to the map's own relatively-positioned host element (the box the
  // Comps rail and the Layers panel are already children of in MapFinder.jsx), so the docked
  // Adjust panel can portal straight onto the map instead of rendering wherever this component
  // happens to sit in the tree (deep inside the rail's own scroll region).
  mapHostRef,
  // NEW-1 (this item) — tells MapFinder whether the docked Adjust panel is on screen right now,
  // so it can collapse the Imagery & layers panel (same bottom-right column on a short viewport)
  // rather than let the two overlap. See the effect below.
  onAdjustOpenChange,
}) {
  const [overlays, setOverlays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState([]);
  const [panelError, setPanelError] = useState(null);
  const [flow, setFlow] = useState(null);
  // B1310208/B1310209 (NEW-1/NEW-2, owner decision 2026-09-07) — only ONE overlay ever renders
  // here at a time (`focusedOverlay`, below — the standalone multi-row list is gone per
  // B1167712), so "is the Adjust panel open" is a plain boolean rather than an id-keyed map.
  const [adjustOpen, setAdjustOpen] = useState(false);
  // B972512-HARDENING item 6 — "Recently deleted": deleting a site plan is now RECOVERABLE
  // (soft delete) rather than permanent, matching sites/doc_reviews' own trash pattern. Fetched
  // lazily, only once the disclosure is opened — empty in the common case, costs nothing until
  // someone actually wants it. Declared here (before this component's `if (!open) return null`
  // below) — every hook must run unconditionally on every render.
  const [trash, setTrash] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
  // B1134754 NEW-21 — same rule as `trash` above: declared before the `if (!open) return null`
  // below, so this hook still runs unconditionally on every render even while the panel is closed.
  const [cropTarget, setCropTarget] = useState(null); // { overlay, src } while the crop tool is open

  // B849840/NEW-1 — arming an overlay for editing via ANY path must reveal the same controls
  // (opacity slider, rotation field, the "Editing on map" state) with no second step. Before
  // this, only this panel's OWN "Move / resize" button opened the Adjust panel (it calls
  // setAdjustOpen itself, see onActivate below) — clicking the plan directly on the map
  // (MapFinder's onSelect → selectOverlay → activeOverlayId) armed the SAME map handles but
  // never touched this component's local panel state, so the panel stayed closed and looked
  // like the click had done nothing.
  useEffect(() => { if (activeOverlayId) setAdjustOpen(true); }, [activeOverlayId]);
  // B1310208 — switching to a different comp (a different plan) must never leave the PREVIOUS
  // plan's Adjust panel standing open over the map with nothing in the rail pointing at it.
  useEffect(() => { setAdjustOpen(false); }, [focusedProjectId]);
  // NEW-1 (this item, regression from B1310209) — `open` gates whether this component's own JSX
  // return is `null` (below), which the DOM-rendered Adjust panel follows; reporting `open &&
  // adjustOpen` rather than the bare flag keeps MapFinder from believing the panel is still on
  // screen after this section itself goes inactive (its hooks still run every render even past
  // that early return, so a bare `adjustOpen` could go stale true).
  useEffect(() => { onAdjustOpenChange?.(open && adjustOpen); }, [open, adjustOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // This whole component only mounts while its rail tab is open (MapFinder's own
  // `sitesPanelOpen && panelTab === "comp"` gate) — an unmount skips the effect above's cleanup
  // path entirely (there isn't one), so without this a plan left "Editing on map" when the user
  // switches away to Sites/Layers would leave MapFinder believing the Adjust panel is still open
  // and the Layers panel stuck collapsed for no visible reason.
  useEffect(() => () => onAdjustOpenChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const notifiedRef = useRef(onOverlaysChange);
  notifiedRef.current = onOverlaysChange;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const compsChangedRef = useRef(onCompPositionsChanged);
  compsChangedRef.current = onCompPositionsChanged;
  // NEW-18 — "someone else changed this site plan" was firing for a single user editing alone.
  // Root cause: the version-guard's `expected` came from `overlaysRef.current`/a prop, both of
  // which lag a just-issued write by at least one React render — so a second rapid save (another
  // drag release, a fast double-click on "Editing on map") read the SAME stale expected-version
  // its own predecessor already used, and the loser was reported as a foreign edit and dropped.
  // `overlayVersionsRef` is the true last-known-good version per overlay id, updated synchronously
  // (never through React state) the instant a write settles; `serialized` queues writes PER
  // OVERLAY so a second one never even STARTS reading that cache until the first has fully
  // resolved (including its own cache update) — the two together close the race at its source.
  const overlayVersionsRef = useRef({});
  const noteVersion = (id, v) => { if (id != null && Number.isFinite(v)) overlayVersionsRef.current[id] = v; };
  const writeSerializerRef = useRef(null);
  if (!writeSerializerRef.current) writeSerializerRef.current = createWriteSerializer();
  const serialized = (id, fn) => writeSerializerRef.current.run(id, fn);
  // NEW-8 — declared here, above the `if (!open) return null` early return below (rules of
  // hooks), even though only setOpacityLive/flushOpacityWrite (declared further down) use it.
  const opacityDebounceRef = useRef({});
  useEffect(() => () => { for (const entry of Object.values(opacityDebounceRef.current)) clearTimeout(entry.timer); }, []);

  useEffect(() => {
    if (!open) return;
    listMyTeams().then(setTeams).catch(() => setTeams([]));
  }, [open]);

  // Item 17 needs to know "am I the owner" to tell a real lock control from a dead one.
  const [currentUserId, setCurrentUserId] = useState(null);
  useEffect(() => {
    if (!open) return;
    currentIdentity().then(({ uid }) => setCurrentUserId(uid)).catch(() => setCurrentUserId(null));
  }, [open]);

  // B1167712 (NEW-1, owner correction 2026-09-07) — "a site plan attaches to a site the same way
  // a comp does" STARTS from the comp path but does not reuse it verbatim: a comp is matched by
  // location against a fixed 0.5mi radius calibrated for a POINT, and a plan is a DRAWING THAT
  // COVERS AREA — shared/sitePlans/lib/overlaySiteMatch.js's own header has the full reasoning
  // and the owner's own Airtex numbers. `resolveOrCreateTrackedSiteForOverlay` (storage.js, right
  // beside the comp version) runs that plan-specific rule and mints a tracked site exactly the
  // same way when nothing matches. Dynamic import — same reason CompsPanel's own call site uses
  // one: keeps the site-planner's full model/geometry/cloud-sync graph off this chunk until a
  // resolve is actually attempted. ⛔ NEVER STICKS SILENTLY: `siteLinkDeclined` (set only by the
  // owner's own "Site" control below, never by this function) permanently opts an overlay OUT —
  // "once he has separated them, they stay separated."
  const resolveAttemptedRef = useRef(new Set());
  const resolveOverlaySite = async (o) => {
    if (o.projectId || o.siteLinkDeclined || !overlayPlaced(o)) return null;
    const { resolveOrCreateTrackedSiteForOverlay } = await import("../../../workspaces/site-planner/lib/storage.js");
    const resolved = await resolveOrCreateTrackedSiteForOverlay(o);
    return (resolved && resolved.groupId) || null;
  };

  const reload = async () => {
    setLoading(true);
    const { data, error } = await fetchAllOverlays();
    setLoading(false);
    if (!error) {
      setOverlays(data);
      for (const o of data) noteVersion(o.id, o.version);
      notifiedRef.current?.(data);
      // "Both already exist independently. They join by location on the next resolve; the owner
      // never does anything" — a placed overlay with no site yet gets ONE resolve attempt per
      // overlay per session here, on every load/refresh, so a comp/site that shows up later still
      // closes the loop with no action from Michael. Fire-and-forget: `patchAndReload` (below)
      // does its own version-guarded write + reload once a match (or a freshly-minted tracked
      // site) comes back.
      for (const o of data) {
        if (o.projectId || o.siteLinkDeclined || !overlayPlaced(o) || resolveAttemptedRef.current.has(o.id)) continue;
        resolveAttemptedRef.current.add(o.id);
        resolveOverlaySite(o).then((groupId) => { if (groupId) patchAndReload(o, { projectId: groupId }); });
      }
    }
    return error ? null : data; // callers that need the FRESH rows (not a re-render's timing) read this
  };
  useEffect(() => { if (open) reload(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The map calls this on every finished drag (move / scale / rotate) — this module stays the
  // one place that persists an overlay, so its own list state can't drift from what the map
  // just committed. Optimistic locally, then written through. This is also the ONE
  // placement-commit path the typed-rotation field (setRotation, below) reuses — rotation is a
  // PLACEMENT field (it moves any pinned comp's derived position), so it must go through the
  // SAME atomic commit + version guard a drag does, never the plain patchAndReload path
  // opacity/visible/locked use, which never touches pinned comps.
  //
  // NEW-18 — queued per overlay id via `serialized` (the write-queue module above), so a second
  // finished-drag/rotation commit for the SAME overlay never starts reading the expected version
  // until the first has fully settled — this is what closes the false "someone else changed
  // this site plan" conflict for a single user's own rapid successive gestures (measured on the
  // owner's real row: version 18 after four minutes of ordinary corner/rotate nudging — far more
  // commits than four minutes of deliberate releases should produce).
  //
  // B972512-HARDENING item 1: a placement change silently left every comp pinned to this overlay
  // at its OLD lat/lon — the map position is DERIVED (site_plan_point run through the placement
  // transform, see overlayGeoref.js), so it goes stale the instant the plan moves. Fixed by
  // recomputing every referencing comp's position here, in the SAME commit as the placement
  // write: fetch each comp's plan-space point (fetchOverlayCompPoints — works across owners,
  // since a teammate's comp is otherwise invisible to this user's normal RLS-scoped reads),
  // recompute its lat/lon under the NEW placement, and write both the overlay and every comp
  // position through commitOverlayPlacementWithComps, a single-transaction RPC (comps.update is
  // owner-only RLS, so a plain client-side update would silently no-op on a teammate's pin).
  const commitPlacement = (id, placement) => serialized(id, async () => {
    const existing = overlaysRef.current.find((o) => o.id === id);
    if (!existing) return;
    // NEW-7 — defense in depth: every UI entry point into a placement change (the map handles,
    // the numeric Rotation field) is gated on `locked` at the control, but the write itself must
    // refuse too, so a stale closure or a future caller can never move/resize/rotate a plan the
    // owner explicitly locked.
    if (existing.locked) { console.warn("[sitePlanOverlays] commitPlacement refused — overlay is locked:", id); return; }
    const next = { ...existing, ...placement };
    setOverlays((list) => { const l = list.map((o) => (o.id === id ? next : o)); notifiedRef.current?.(l); return l; });

    const { data: points, error: pointsError } = await fetchOverlayCompPoints(id);
    if (pointsError) console.error("[sitePlanOverlays] fetching pinned comps for recompute failed:", pointsError);
    const compPositions = (points || []).map((p) => {
      const ll = imagePointToLatLon(next, next.imgW, next.imgH, p.sitePlanPoint.x, p.sitePlanPoint.y);
      return ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lon) ? { id: p.id, lat: ll.lat, lon: ll.lon } : null;
    }).filter(Boolean);

    // Item 7: carries the version this client last saw — the RPC refuses (and reports
    // `conflict`) if the row changed elsewhere since, rather than silently clobbering a
    // concurrent drag from another live session on the same plan.
    const expected0 = Number.isFinite(overlayVersionsRef.current[id]) ? overlayVersionsRef.current[id] : existing.version;
    let outcome = await commitOverlayPlacementWithComps(id, next, compPositions, expected0);

    // NEW-18 — a reported conflict here is presumed stale bookkeeping, not a foreign edit
    // (the queue above already rules out a second call racing this one): refetch the row's
    // real current version and retry exactly once before believing it. A conflict that
    // survives a fresh version is a genuine concurrent editor.
    if (outcome.conflict) {
      const { data: fresh } = await fetchAllOverlays();
      const freshVersion = (fresh || []).find((o) => o.id === id)?.version;
      if (Number.isFinite(freshVersion) && freshVersion !== expected0) {
        noteVersion(id, freshVersion);
        outcome = await commitOverlayPlacementWithComps(id, next, compPositions, freshVersion);
      }
    }

    if (outcome.conflict) {
      // Survived the retry — a genuine second editor moved this plan mid-gesture. Never
      // silently discard this session's own in-progress placement: `next` stays on screen
      // (it was already applied above), and the version cache is refreshed so the user's next
      // move/release retries clean instead of repeating the same stale write.
      console.warn("[sitePlanOverlays] placement commit conflict survived retry — treating as a genuine concurrent edit:", id);
      setPanelError("Someone else changed this site plan just now, so your last move hasn't saved yet — move it again to retry.");
      const { data: fresh } = await fetchAllOverlays();
      noteVersion(id, (fresh || []).find((o) => o.id === id)?.version);
    } else if (outcome.error) {
      console.error("[sitePlanOverlays] placement commit failed:", outcome.error);
      setPanelError(friendlySaveError(outcome.error));
      await reload(); // the optimistic move didn't actually save — pull the real, current position back
    } else {
      // Success — advance the locally-held version so the NEXT drag's guard compares against
      // what the server actually has now, not the pre-commit value (else every subsequent
      // drag in this same session would spuriously read as a conflict against itself).
      noteVersion(id, outcome.version);
      if (Number.isFinite(outcome.version)) {
        setOverlays((list) => list.map((o) => (o.id === id ? { ...o, version: outcome.version } : o)));
      }
      if (compPositions.length) {
        // Tell the comps panel/map markers to refetch — otherwise the mover sees their own and
        // teammates' pins sitting at the old spot until the next tab-focus refetch
        // (CompsPanel's own cross-device polling, which is otherwise the only thing that would
        // eventually pick this up).
        compsChangedRef.current && compsChangedRef.current();
      }
    }
  });

  useEffect(() => {
    if (!commitPlacementRef) return undefined;
    commitPlacementRef.current = commitPlacement;
    return () => { if (commitPlacementRef) commitPlacementRef.current = null; };
  }, [commitPlacementRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (patch) => setFlow((f) => (f ? { ...f, ...patch } : f));

  const rasterizePage = async (bytesOrFile, page) => {
    const { renderPdfPageToImageData } = await import("../../files/pdfRaster.js");
    const { imageData } = await renderPdfPageToImageData(bytesOrFile, page, {
      targetDpi: OVERLAY_RASTER_BASE_DPI, maxLongEdgePx: OVERLAY_RASTER_MAX_LONG_EDGE_PX,
    });
    const blob = await imageDataToBlob(imageData, "image/jpeg", OVERLAY_RASTER_JPEG_QUALITY);
    const thumbDataUrl = imageDataToThumbDataUrl(imageData);
    return { blob, w: imageData.width, h: imageData.height, thumbDataUrl, url: URL.createObjectURL(blob) };
  };

  // `presetProjectId` (B1167712/NEW-1) — set when the upload starts FROM a comp's own detail
  // view (the site is already known, so there's nothing to resolve later) or from the embedded
  // per-site card below; the top-of-the-Comps-list "+ Site plan" button (order (a), no comp open
  // yet) calls this with nothing, and the reload sweep above attaches it once a site exists.
  const startNewUpload = (presetProjectId) => { setPanelError(null); setFlow({ ...emptyFlow(), projectId: presetProjectId || null }); };
  const cancelFlow = () => setFlow(null);

  // B1167712 — the Comps list's own "+ Site plan" button lives outside this component (it's part
  // of the toolbar CompsPanel renders), so it reaches this the same way SitePlansSection already
  // hands MapFinder `commitPlacementRef`/`dropIntakeRef`: a ref this effect assigns, that button calls.
  useEffect(() => {
    if (!startUploadRef) return undefined;
    startUploadRef.current = (presetProjectId) => { setAdjustOpen(false); startNewUpload(presetProjectId); };
    return () => { if (startUploadRef) startUploadRef.current = null; };
  }, [startUploadRef]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // The file-picker's own `accept` attribute doesn't reliably block an unsupported image type
    // (the OS/browser file dialog can still offer "All files", and a HEIC photo's own MIME type
    // passes a broad "image/*" filter) — checked here too, not just in the drop-intake gate below,
    // so a picked (not dropped) HEIC/TIFF file gets the same clear, specific rejection instead of
    // silently failing partway through capImageFile's image decode.
    const unsupported = unsupportedImageReason(file);
    if (unsupported) { setF({ error: unsupported, step: "error" }); return; }
    try {
      if (isPdf(file)) {
        const { pdfPageCount } = await import("../../files/pdfRaster.js");
        const pageCount = await pdfPageCount(file);
        const r = await rasterizePage(file, 1);
        setF({ pageCount, page: 1, previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h, thumbDataUrl: r.thumbDataUrl,
          title: stripFileExt(file.name || "Site plan"), step: "page" });
      } else {
        const r = await capImageFile(file);
        setF({ pageCount: 1, page: 1, previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h, thumbDataUrl: r.thumbDataUrl,
          title: stripFileExt(file.name || "Site plan"), step: "page" });
      }
    } catch (e) {
      setF({ error: friendlyPdfError(e, file) || (e && e.message) || "Couldn't read that file.", step: "error" });
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
      for (const f of rejected) onRejectFile && onRejectFile(f.name || "that file", unsupportedImageReason(f) || "only PDF or image files can become a site plan");
      if (!accepted.length) return;
      setAdjustOpen(false);
      pickFile(accepted[0], { dropPlacement: dropPlacement || null, queue: accepted.slice(1) });
    };
    return () => { if (dropIntakeRef) dropIntakeRef.current = null; };
  }, [dropIntakeRef]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const choosePage = async (n) => {
    if (n < 1 || n > flow.pageCount) return;
    setF({ page: n, crop: null }); // a different page invalidates any crop drawn against the old one
    try {
      const src = flow.fileBuffer || flow.file;
      const r = await rasterizePage(src, n);
      setF({ previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h, thumbDataUrl: r.thumbDataUrl });
    } catch (e) {
      console.error("[sitePlanOverlays] page render failed:", e);
      setF({ error: friendlySaveError(e) });
    }
  };

  // Upload the whole brochure (if new), place the overlay with a default placement, and arm it
  // for editing immediately — no anchor step, no scale check. A dropped file's own drop point
  // (flow.dropPlacement, a bare {lat,lng}) is merged into suggestPlacement's own full placement
  // as a CENTER OVERRIDE — never used standalone (NEW-17: a center with no scale has nothing to
  // draw, and used to leave `ft_per_px` null on every drag-and-dropped upload).
  const confirmPage = async () => {
    const f = flow; // close over this render's flow — queue/dropPlacement/etc, before "saving" clears the step-specific fields nothing else needs
    setF({ step: "saving", uploadProgress: null });
    try {
      const placement = suggestPlacement ? suggestPlacement(f.rasterW, f.rasterH, f.dropPlacement) : null;
      const onProgress = (sent, total) => setF({ uploadProgress: { sent, total } });
      let overlay;
      if (f.overlayId) {
        const existing = overlaysRef.current.find((o) => o.id === f.overlayId);
        const { data, error } = await updateOverlay(f.overlayId, {
          ...existing, page: f.page, imgW: f.rasterW, imgH: f.rasterH, thumbDataUrl: f.thumbDataUrl,
          // B1134754 — a stored crop is a rect in the OLD raster's own pixel grid; a different
          // page/image invalidates it exactly like it invalidates the old placement fit below,
          // so this clears it too rather than silently applying a stale rect to new artwork.
          crop: f.crop || null,
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
          // B972512-HARDENING item 8 — a brand-new overlay is ALWAYS private (teamId null) at
          // upload time, regardless of what team the uploader belongs to. Before this, the
          // upload form's own team picker shared it with the team the INSTANT the row was
          // inserted — while it still held only the auto-suggested default placement
          // (centered/sized to the current view, never actually where it belongs) — so a
          // teammate could see a wrongly-placed, half-set-up plan pop onto their map with no
          // explanation. Sharing is now a deliberate, POST-placement action (OverlayRow's "Share
          // with" control, gated on the overlay actually being placed — see `shareOverlay`).
          projectId: f.projectId, teamId: null,
          reviewId: uploaded.id, page: f.page,
          docTitle: f.title, docDate: f.docDate, sourceFileName: (f.file && f.file.name) || "",
          imgW: f.rasterW, imgH: f.rasterH, thumbDataUrl: f.thumbDataUrl, opacity: 0.85, visible: true,
          crop: f.crop || null,
          ...(placement || {}),
        });
        if (error) throw error;
        overlay = data;
      }
      // B972512-HARDENING item 9 — this used to be `if (up) {...}` with no `else`: any failure
      // (not signed in, oversize, a real upload error) silently vanished and the overlay row
      // saved fine with `raster_key: null` — placed on the map, correctly positioned, and
      // completely invisible, with nothing telling the person why. The row itself is still
      // worth keeping (the placement succeeded; only the picture failed), so this doesn't throw
      // and abort the whole flow — it surfaces the failure loudly instead.
      const { key: rasterKey, error: rasterError } = await uploadOverlayRaster(overlay.id, f.rasterBlob);
      if (rasterError) {
        console.error("[sitePlanOverlays] raster upload failed:", rasterError);
        setPanelError(`Saved “${overlay.docTitle || "this site plan"}”, but its image didn't upload — ${friendlySaveError(rasterError)} You can retry from “Change page…”.`);
      } else {
        const { data } = await updateOverlay(overlay.id, { ...overlay, rasterKey });
        overlay = data || overlay;
      }
      await reload();
      setAdjustOpen(true);
      // NEW-17 — only arm "Editing on map" when the overlay actually has a full, drawable
      // placement (overlayPlaced requires center + a non-null scale); arming it on anything less
      // used to leave the panel reading "Not placed yet" and "Editing on map" at once, with
      // nothing rendered on the map for the handles to attach to — a dead end. The rare case
      // where `suggestPlacement` itself returned null (the map genuinely wasn't ready yet) now
      // just leaves the row honestly unplaced; its own "Place on map" button (below) already
      // self-heals by seeding a placement before arming.
      if (overlayPlaced(overlay)) onActivateOverlay && onActivateOverlay(overlay.id);
      // A multi-file drop queues the rest — place them one after another through the same flow
      // rather than a second modal; each still gets its own title/date/page pick.
      if (f.queue && f.queue.length) pickFile(f.queue[0], { queue: f.queue.slice(1) });
      else setFlow(null);
    } catch (e) {
      console.error("[sitePlanOverlays] save failed:", e);
      setF({ error: friendlySaveError(e), step: "error" });
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
      setF({ fileBuffer: bytes, pageCount, page: 1, previewUrl: r.url, rasterBlob: r.blob, rasterW: r.w, rasterH: r.h, thumbDataUrl: r.thumbDataUrl, step: "page" });
    } catch (e) {
      console.error("[sitePlanOverlays] reopen failed:", e);
      setF({ error: friendlyPdfError(e) || friendlySaveError(e), step: "error" });
    }
  };

  // ---- simple per-item controls -----------------------------------------------------------
  // NEW-18 — same version-race fix as the placement-drag committer above: queued per overlay id,
  // reads the synchronously-updated version cache rather than a possibly-stale prop, and retries
  // once on a reported conflict before treating it as a genuine foreign edit.
  const patchAndReload = (o, patch) => serialized(o.id, async () => {
    const expected0 = Number.isFinite(overlayVersionsRef.current[o.id]) ? overlayVersionsRef.current[o.id] : o.version;
    let { error, data, conflict } = await updateOverlay(o.id, { ...o, ...patch, version: expected0 });
    if (conflict) {
      const { data: fresh } = await fetchAllOverlays();
      const freshVersion = (fresh || []).find((x) => x.id === o.id)?.version;
      if (Number.isFinite(freshVersion) && freshVersion !== expected0) {
        noteVersion(o.id, freshVersion);
        ({ error, data, conflict } = await updateOverlay(o.id, { ...o, ...patch, version: freshVersion }));
      }
    }
    if (conflict) {
      console.warn("[sitePlanOverlays] update conflict survived retry — treating as a genuine concurrent edit:", o.id);
      setPanelError("Someone else changed this site plan just now — your change hasn't saved. Try again.");
    } else if (error) {
      console.error("[sitePlanOverlays] update failed:", error); setPanelError(friendlySaveError(error));
    } else if (data && Number.isFinite(data.version)) {
      noteVersion(o.id, data.version);
    }
    await reload();
  });
  const rename = (o, docTitle) => patchAndReload(o, { docTitle });
  // NEW-8 (owner report, build 9c35724: "changing opacity noticeably slowed his computer") —
  // MEASURED, not assumed: the map's own opacity write (rotatedImageLayer.js's setOpacity) is
  // already a plain CSS `img.style.opacity` set with no re-raster of any kind, so the drag
  // itself was never the cost. The real cost was this function — every `onChange` tick called
  // `patchAndReload`, i.e. one Supabase UPDATE *plus* one full-list refetch+re-render, with no
  // debounce, so a rapid slider drag (which can fire dozens of `input` events) queued dozens of
  // serialized network round trips. `setOpacityLive` applies the value LOCALLY (no network) on
  // every tick — the map already reads opacity straight off `overlays` state, so this alone
  // keeps the drag itself compositor-only — and defers the actual persist to one debounced
  // write per pause, flushed early by `flushOpacityWrite` the instant the drag/keypress ends
  // (OverlayRow's `onMouseUp`/`onTouchEnd`/`onKeyUp`) so the value is never left waiting out the
  // full debounce window for no reason.
  const OPACITY_DEBOUNCE_MS = 300;
  const setOpacityLive = (o, opacity) => {
    setOverlays((list) => list.map((x) => (x.id === o.id ? { ...x, opacity } : x)));
    const entry = opacityDebounceRef.current[o.id] || {};
    clearTimeout(entry.timer);
    entry.opacity = opacity;
    entry.timer = setTimeout(() => {
      delete opacityDebounceRef.current[o.id];
      patchAndReload(o, { opacity });
    }, OPACITY_DEBOUNCE_MS);
    opacityDebounceRef.current[o.id] = entry;
  };
  const flushOpacityWrite = (o) => {
    const entry = opacityDebounceRef.current[o.id];
    if (!entry) return;
    clearTimeout(entry.timer);
    delete opacityDebounceRef.current[o.id];
    patchAndReload(o, { opacity: entry.opacity });
  };
  // Rotation is a PLACEMENT field (it moves any pinned comp's derived position), so it goes
  // through the same atomic commit the map's own rotate handle uses — never the plain
  // patchAndReload path opacity/visible/locked use, which never touches pinned comps.
  const setRotation = (o, rotationDeg) => commitPlacement(o.id, { rotationDeg });

  // ---- crop (B1134754 NEW-21), for an ALREADY-PLACED overlay -------------------------------
  // A crop never moves the placement transform (see site_plan_overlays_crop.sql's header), so
  // it commits through the plain patchAndReload path — never commitPlacement — and never
  // recomputes a pinned comp's position. (`cropTarget` state itself is declared near the top of
  // the component, above the `if (!open) return null` early return — see that declaration.)
  // NEW-1 (B1783328) — B1154369 closed the map handles + the rotation field but never checked
  // this control, so a locked overlay's crop stayed editable end to end. Refused at BOTH the
  // entry point (the tool never opens on a locked overlay, matching the button's own `disabled`)
  // and the commit (defense in depth, same shape as `commitPlacement`'s `existing.locked` guard —
  // never trust a disabled control alone to keep every future caller honest).
  const startCrop = async (o) => {
    if (!o.rasterKey) return;
    if (overlayPlaced(o) && o.locked) { console.warn("[sitePlanOverlays] startCrop refused — overlay is locked:", o.id); return; }
    setPanelError(null);
    const src = await downloadOverlayRasterUrl(o.rasterKey);
    if (!src) { setPanelError("Couldn't load this plan's image to crop it — reload and try again."); return; }
    setCropTarget({ overlay: o, src });
  };
  const commitCrop = async (crop) => {
    const o = cropTarget && cropTarget.overlay;
    if (o && overlayPlaced(o) && o.locked) { console.warn("[sitePlanOverlays] commitCrop refused — overlay is locked:", o.id); setCropTarget(null); return; }
    setCropTarget(null);
    if (!o) return;
    await patchAndReload(o, { crop });
  };
  const toggleVisible = (o) => patchAndReload(o, { visible: !o.visible });
  const shareOverlay = (o, teamId) => patchAndReload(o, { teamId });
  // B1167712 (NEW-1, owner correction) — the ONE control that changes OR detaches a plan's site,
  // always visible on the plan itself. Picking a site is a deliberate, explicit choice, so it
  // always clears `siteLinkDeclined` (a fresh choice supersedes any earlier auto-suggestion);
  // picking "No site" is the detach action and sets it, so the reload-sweep resolver above never
  // re-attaches this same plan behind the owner's back.
  const setOverlaySite = (o, newProjectId) => patchAndReload(o, { projectId: newProjectId || null, siteLinkDeclined: !newProjectId });
  // B972512-HARDENING item 17 — `locked` exists on the schema (mirrors the Site Planner's own
  // reference-image "locked" flag) but had NO control anywhere in this feature's UI, so the
  // owner-only UPDATE policy this column relies on was never actually exercised — confirmed
  // intended by precedent: `sites.share_locked` (team_share_default.sql's `set_plan_lock`) is
  // the SAME owner-only rule, applied consistently app-wide. Adding the control now means that
  // rule is finally real, so it also needs to be LEGIBLE for a non-owner rather than a dead
  // toggle — see OverlayRow's lock button, gated on `isOwner`.
  // NEW-7 (owner report, build 9c35724) — locking an overlay that is CURRENTLY armed for
  // editing used to leave it that way: the panel's own "Editing on map" buttons only ever
  // gated *re-arming* (`disabled={placed && o.locked}`), and neither the map handles
  // controller (`useSitePlanOverlayLayers.js`'s `syncHandles`) nor the placement-commit path
  // ever consulted `locked` at all — so a plan locked mid-edit stayed fully draggable until
  // the next reload. `syncHandles`'s own `active` lookup now excludes a locked overlay (the
  // map-layer half of the fix); this is the panel half — locking an already-active overlay
  // disarms it in the same click, so the row's own label/button state and the map agree instantly.
  const toggleLocked = (o) => {
    const locking = !o.locked;
    if (locking && activeOverlayId === o.id) onActivateOverlay && onActivateOverlay(null);
    return patchAndReload(o, { locked: locking });
  };
  // B1114992 — deleting a site plan is now UNCONDITIONAL: no proactive "N comps are still
  // pinned" block. A comp pinned to this overlay (own-owner or a teammate's) is detached to a
  // plain 'pin' anchor at its already-current lat/lon in the same statement as the delete —
  // matching this row's own confirm-dialog copy below ("Comps pinned to it keep their location
  // but lose the link back"), which used to be untrue (the delete was refused instead). See
  // comps_site_plan_overlay_delete_reverts_to_pin.sql for the full mechanism and reasoning.
  const remove = async (o) => {
    const { error } = await deleteOverlay(o.id);
    if (error) { console.error("[sitePlanOverlays] delete failed:", error); setPanelError(friendlySaveError(error)); }
    else if (activeOverlayId === o.id) onActivateOverlay && onActivateOverlay(null);
    await reload();
  };

  const loadTrash = async () => {
    setTrashLoading(true);
    const { data } = await fetchDeletedOverlays();
    setTrashLoading(false);
    setTrash(data || []);
  };
  const toggleTrash = () => {
    setTrashOpen((was) => { if (!was) loadTrash(); return !was; });
  };
  const restore = async (o) => {
    const { error } = await restoreOverlay(o.id);
    if (error) { console.error("[sitePlanOverlays] restore failed:", error); setPanelError(friendlySaveError(error)); }
    await reload();
    await loadTrash();
  };
  const purgeForever = async (o) => {
    const { error } = await permanentlyDeleteOverlay(o.id);
    if (error) { console.error("[sitePlanOverlays] permanent delete failed:", error); setPanelError(friendlySaveError(error)); }
    await loadTrash();
  };

  // B1167712-B1167714 (NEW-1/2/3, owner decision 2026-09-07) — "we really shouldn't even show
  // site plans... they should just be attached to comps." There is no more standalone list.
  // `focusedOverlay` is the ONE plan the currently-open comp's SITE owns (never a per-comp copy —
  // the site is the join, see the shared shared/comps/lib/compSiteMatch.js header); with a comp
  // open and no plan yet, a compact upload prompt takes its place. With nothing open (browsing
  // the comp list) and no upload/crop flow running, this renders nothing at all.
  const focusedOverlay = focusedProjectId ? overlays.find((o) => o.projectId === focusedProjectId) || null : null;
  const showEmbeddedCard = !!focusedProjectId && !flow;
  // Scoped "Recently deleted" — this site's own binned plans, plus any never-resolved orphan
  // (deleted before it ever got a location, so it has no site to be scoped to) — never a global
  // trash list. `o.project_id` here is the raw select row (fetchDeletedOverlays doesn't run
  // rowToOverlay), matching `o.doc_title`/`o.source_file_name` below.
  const scopedTrash = trash.filter((o) => o.project_id === focusedProjectId || !o.project_id);
  // A plan the owner has explicitly detached (or one that was never resolved and the reload
  // sweep hasn't reached yet) has no site of its own — the ONLY way back to it once the old
  // standalone list is gone, so the empty state below offers it directly rather than stranding
  // it (mirrors the "Recently deleted" scoping above: reachable from wherever it's missed, never
  // a persistent global list). Fresh every render, same precedent as CompsPanel's own
  // `trackedSites` derivation — a handful of rows at most.
  const orphanOverlays = overlays.filter((o) => !o.projectId && o.id !== focusedOverlay?.id);
  const siteOptions = (() => {
    const byGroup = new Map();
    for (const s of loadSiteSummaries()) {
      const g = s.groupId || s.id;
      if (!byGroup.has(g)) byGroup.set(g, s);
    }
    return [...byGroup.values()];
  })();

  // B1310208/B1310209 (NEW-1/NEW-2) — the ONE thing the resting card's "Adjust" button does.
  // An unplaced plan has nothing for the panel to show (no position, no rotation, nothing on the
  // map to move), so pressing Adjust places it first — the same default-placement-then-arm a
  // fresh upload already gets (confirmPage, above) — and arms Move/resize immediately so the
  // owner can reposition it right away, exactly as the old "Place on map" button did. An
  // already-placed plan just toggles the panel open/closed — opening it no longer also arms map
  // handles (that's now the panel's own explicit "Move / resize" button), so checking opacity or
  // rotation doesn't summon drag handles nobody asked for.
  const openAdjust = async () => {
    if (!focusedOverlay) return;
    if (!overlayPlaced(focusedOverlay)) {
      const placement = suggestPlacement ? suggestPlacement(focusedOverlay.imgW, focusedOverlay.imgH) : null;
      if (!placement) { setPanelError("Couldn't place this site plan — the map isn't ready yet. Try again in a moment."); return; }
      await patchAndReload(focusedOverlay, placement);
      setAdjustOpen(true);
      onActivateOverlay && onActivateOverlay(focusedOverlay.id);
      return;
    }
    setAdjustOpen((was) => !was);
  };
  // Done (and re-pressing Adjust to close) also stands down any map handles / pin-drop mode this
  // plan armed — leaving the panel with no map handles left dangling behind it.
  const closeAdjust = () => {
    setAdjustOpen(false);
    if (focusedOverlay && activeOverlayId === focusedOverlay.id) onActivateOverlay && onActivateOverlay(null);
    if (focusedOverlay && pinningOverlayId === focusedOverlay.id) onStopPinOnOverlay?.();
  };

  const errorBanner = panelError && (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8, padding: "6px 8px",
      border: "1px solid var(--danger-text)", borderRadius: RADIUS.sm, background: "var(--surface-raised)",
    }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{panelError}</div>
      <IconButton size={22} aria-label="Dismiss" title="Dismiss" onClick={() => setPanelError(null)}>✕</IconButton>
    </div>
  );

  const trashBlock = (
    <div style={{ marginTop: focusedOverlay ? 8 : 4 }}>
      <button onClick={toggleTrash} style={{
        border: "none", background: "none", padding: "4px 0", cursor: "pointer", fontFamily: "inherit",
        fontSize: FONT_SIZE.label, color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        <span style={{ display: "inline-block", transform: trashOpen ? "none" : "rotate(-90deg)" }}>▾</span>
        Recently deleted{trashOpen && scopedTrash.length ? ` (${scopedTrash.length})` : ""}
      </button>
      {trashOpen && (
        trashLoading ? (
          <div style={{ ...metaText, padding: "4px 0" }}>Loading…</div>
        ) : scopedTrash.length === 0 ? (
          <div style={{ ...metaText, padding: "4px 0" }}>Nothing here.</div>
        ) : (
          scopedTrash.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderTop: "1px solid var(--border-default)" }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.source_file_name || undefined}>
                {o.doc_title || "Untitled site plan"} <span style={metaText}>· p.{o.page}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => restore(o)}>Restore</Button>
              <Button size="sm" variant="ghost" style={{ color: "var(--danger-text)" }} onClick={() => purgeForever(o)}>Delete forever</Button>
            </div>
          ))
        )
      )}
    </div>
  );

  return (
    <>
    {showEmbeddedCard && (
      <div style={{ borderBottom: "1px solid var(--border-default)", padding: "10px 14px" }}>
        {errorBanner}
        {loading ? (
          <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Loading…</div>
        ) : focusedOverlay ? (
          <>
          {/* B1167712 (NEW-1, owner correction) — ALWAYS visible on the plan itself: which site
              it's attached to, one dropdown to change it, and picking "No site" detaches it —
              never a fact the owner can't see or undo. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={metaText}>Site</span>
            <select value={focusedOverlay.projectId || ""} onChange={(e) => setOverlaySite(focusedOverlay, e.target.value || null)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">No site (detached)</option>
              {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.site || s.name}</option>)}
            </select>
          </div>
          <OverlayRow o={focusedOverlay}
            duplicateCount={1}
            adjustOpen={adjustOpen}
            onOpenAdjust={openAdjust}
            onRename={(name) => rename(focusedOverlay, name)}
            rasterFailed={!!rasterFailedIds?.has(focusedOverlay.id)}
            zoomBelowGate={zoomBelowGate}
            onZoomToOverlay={onZoomToOverlay}
            pinning={pinningOverlayId === focusedOverlay.id}
            // B1167713 (NEW-2) — the ONLY thing that changed about pinning: the target is always
            // the comp already open here, never a brand-new one (this card's own "Pin comp here"; the
            // map toolbar's "Place comp → on a
            // site plan" menu still creates new comps, unchanged, via onPlaceComp elsewhere).
            onStartPin={() => onStartPinExistingComp?.(focusedCompId, focusedOverlay.id)}
            onStopPin={() => onStopPinOnOverlay?.()}
            onConfirmChangePage={() => startChangePage(focusedOverlay)}
            onDelete={() => { closeAdjust(); remove(focusedOverlay); }}
          />
          </>
        ) : (
          <div>
            <div style={{ fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)", marginBottom: 6 }}>Site plan</div>
            <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginBottom: 8 }}>
              No plan uploaded for this site yet — drop a broker flyer or park plan on it, then drag it into position on the map.
            </div>
            <Button size="sm" variant="ghost" onClick={() => startNewUpload(focusedProjectId)}>+ Upload site plan</Button>
            {/* B1167712 (NEW-1, owner correction) — the way back for a plan the owner (or the
                matcher) hasn't attached anywhere yet, now that the standalone list is gone. */}
            {orphanOverlays.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ ...metaText, marginBottom: 4 }}>
                  {orphanOverlays.length} unattached site plan{orphanOverlays.length === 1 ? "" : "s"}:
                </div>
                {orphanOverlays.map((o) => (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {o.docTitle || "Untitled site plan"}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setOverlaySite(o, focusedProjectId)}>Attach here</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {trashBlock}
      </div>
    )}

    {flow && (
      <div style={{ borderBottom: "1px solid var(--border-default)", padding: "10px 14px" }}>
        {errorBanner}
        <div style={{ padding: 10, border: "1px solid var(--border-default)", borderRadius: 8, background: "var(--surface-raised)" }}>
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
              </>}
              {flow.pageCount > 1 && (
                <Field label={`Page (${flow.page} of ${flow.pageCount})`} stacked>
                  <span style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" variant="ghost" disabled={flow.page <= 1} onClick={() => choosePage(flow.page - 1)}>&larr;</Button>
                    <Button size="sm" variant="ghost" disabled={flow.page >= flow.pageCount} onClick={() => choosePage(flow.page + 1)}>&rarr;</Button>
                  </span>
                </Field>
              )}
              {flow.cropping ? (
                // B1134754 NEW-21 — "crop should be available BEFORE placement… trimming the
                // flyer down to the plan first, then placing, is the natural workflow." Same
                // tool the post-placement "Crop…" button opens, over the just-rasterized page.
                <ImageCropTool
                  src={flow.previewUrl} imgW={flow.rasterW} imgH={flow.rasterH} crop={flow.crop}
                  onCommit={(crop) => setF({ crop, cropping: false })}
                  onCancel={() => setF({ cropping: false })}
                  maxWidth={420} maxHeight={340}
                />
              ) : (
                <>
                  <PagePreview url={flow.previewUrl} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <Button size="sm" onClick={confirmPage} disabled={!flow.overlayId && (!flow.title || !flow.docDate)}>{flow.overlayId ? "Use this page" : "Place on map"}</Button>
                    {/* NEW-2 (B1263073) — same wording fix as OverlayRow's crop control below:
                        "Cropped ✓" named a completed status, not the reachable action (re-opening
                        the crop tool). "Edit crop" once a crop exists, matching the other spot. */}
                    <Button size="sm" variant="ghost" onClick={() => setF({ cropping: true })} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <CropIcon />{hasCrop(flow) ? "Edit crop" : "Crop…"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelFlow}>Cancel</Button>
                  </div>
                </>
              )}
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
      </div>
    )}

    {/* B1134754 NEW-21 — cropping an ALREADY-PLACED overlay. A simple centered overlay (this
        panel has no existing modal primitive) rather than a second bespoke crop surface. */}
    {cropTarget && (
      <div style={{
        position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.35)", // design-exempt: modal backdrop scrim — no backdrop-color token exists repo-wide yet
        display: "flex", alignItems: "center", justifyContent: "center",
      }} onPointerDown={(e) => { if (e.target === e.currentTarget) setCropTarget(null); }}>
        <div style={{
          background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, padding: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.35)", // design-exempt: no shadow-color token yet repo-wide (matches model/FindReplaceBar.jsx's own popPanel precedent)
        }}>
          <div style={{ fontSize: FONT_SIZE.control, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>
            Crop “{cropTarget.overlay.docTitle || "this site plan"}”
          </div>
          <ImageCropTool
            src={cropTarget.src} imgW={cropTarget.overlay.imgW} imgH={cropTarget.overlay.imgH} crop={cropTarget.overlay.crop}
            onCommit={commitCrop} onCancel={() => setCropTarget(null)}
          />
        </div>
      </div>
    )}

    {/* B1310209 (NEW-2, owner decision 2026-09-07) — the Adjust panel is DOCKED to the map, not
        floated over wherever the rail happens to sit, so it portals straight into the map's own
        host element (the same relatively-positioned box the Comps rail and the Layers panel are
        already children of, one level up in MapFinder.jsx) rather than rendering in this
        component's own place in the tree, deep inside the rail's scroll region. `mapHostRef` is a
        plain ref MapFinder attaches to that element — by the time a user can press "Adjust" the
        map has long since mounted, so reading `.current` at render time (rather than mirroring it
        into state) is safe. */}
    {adjustOpen && focusedOverlay && mapHostRef?.current && createPortal(
      <SitePlanAdjustPanel o={focusedOverlay}
        isActive={activeOverlayId === focusedOverlay.id && overlayPlaced(focusedOverlay)}
        onActivate={async () => {
          if (!overlayPlaced(focusedOverlay)) {
            const placement = suggestPlacement ? suggestPlacement(focusedOverlay.imgW, focusedOverlay.imgH) : null;
            if (!placement) { setPanelError("Couldn't place this site plan — the map isn't ready yet. Try again in a moment."); return; }
            await patchAndReload(focusedOverlay, placement);
          }
          onActivateOverlay && onActivateOverlay(focusedOverlay.id);
        }}
        onDeactivate={() => onActivateOverlay && onActivateOverlay(null)}
        onSetOpacity={(v) => setOpacityLive(focusedOverlay, v)}
        onOpacityCommit={() => flushOpacityWrite(focusedOverlay)}
        onSetRotation={(deg) => setRotation(focusedOverlay, deg)}
        onStartCrop={() => startCrop(focusedOverlay)}
        onToggleVisible={() => toggleVisible(focusedOverlay)}
        onToggleLocked={() => toggleLocked(focusedOverlay)}
        teams={teams}
        onShareTeam={(teamId) => shareOverlay(focusedOverlay, teamId)}
        isOwner={focusedOverlay.userId === currentUserId}
        onClose={closeAdjust}
      />,
      mapHostRef.current,
    )}
    </>
  );
}
