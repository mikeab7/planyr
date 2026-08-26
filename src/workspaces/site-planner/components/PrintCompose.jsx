/* PrintCompose (B765985) — the dedicated "how will this exhibit print" screen.
 *
 * Owner: "once we pick a rectangle to print, it should take us to a screen where we then
 * edit how the ultimate exhibit will print, like collapsing the bottom and right menus."
 *
 * Replaces the old floating print bar + on-canvas frame as the DOWNLOAD step. Picking the
 * frame on the canvas is unchanged (SitePlanner still owns that — this component never
 * touches the canvas or the drawing); once the user is happy with roughly what area to
 * frame, "Continue" hands off here. From here on nothing of the editing chrome — either
 * rail, the canvas furniture — is visible or reachable: this is a full-screen surface with
 * its own panel, not an overlay floating over the drawing (that was the OLD bug this item
 * exists to fix, and repeating it over the SHEET preview instead of the canvas would just
 * move the same mistake — see CHROME-NEVER-EATS-A-PRESS / B750096 in the root CLAUDE.md).
 *
 * PDF-PARITY, proven rather than asserted: `previewSrc` is a blob URL of the EXACT SAME
 * `sheetSvg` string the final PDF rasterizes (see exportSheet.js's `buildComposedSheet`,
 * the one function both paths call). There is no second rendering of the sheet to drift
 * from the first.
 *
 * MODULE-SCOPE-COMPONENTS: this file is the module scope. SitePlanner.jsx renders
 * `<PrintCompose .../>` conditionally; nothing here is defined inside another component's
 * render body.
 */
import { Button, ToggleChip, Section, Field } from "../../../shared/ui/controls.jsx";
import { PAPER_SIZES } from "../lib/printSheet.js";
import { STANDARD_SCALES, scaleLabel } from "../lib/printScale.js";

const panelWrap = { width: 380, flex: "none", display: "flex", flexDirection: "column", background: "var(--surface-raised)", borderLeft: "1px solid var(--border-default)", boxShadow: "-8px 0 24px rgba(0,0,0,0.08)" };
const panelScroll = { flex: 1, overflowY: "auto", padding: "14px 14px 4px" };
const panelFooter = { flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--border-default)" };
const readOnlyVal = { fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", textAlign: "right" };
const textInput = { font: "inherit", fontSize: 12.5, padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)", width: 168 };
const checkRow = { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-primary)", padding: "5px 0", cursor: "pointer", userSelect: "none" };

function ContentToggle({ label, title, checked, onChange }) {
  return (
    <label style={checkRow} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ cursor: "pointer", margin: 0 }} />
      {label}
    </label>
  );
}

export default function PrintCompose({
  paper, onPaper, orient, onOrient,
  scaleFtPerIn, onScale, fitWarning,
  previewSrc, previewLoading, pageAspect,
  siteLabel, planLabel, dateStr,
  preparedBy, onPreparedBy,
  showDims, onToggleDims,
  showAreas, onToggleAreas,
  aerialAvailable, showAerial, onToggleAerial,
  overlayPrintable, printOverlay, onTogglePrintOverlay,
  mapLayersPrintable, printMapLayers, onToggleMapLayers,
  buildingRulesPanel,
  onReposition, onCancel, onDownload,
  downloading,
}) {
  return (
    <div data-testid="print-compose" style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", background: "var(--surface-page)" }}>
      {/* Sheet preview — the whole point of a compose SCREEN over an overlay: the sheet is
          shown at its true page proportions, on its own, with nothing else competing for
          the eye. Zero canvas furniture renders here at all (there is no canvas here). */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, minWidth: 0, position: "relative" }}>
        <div style={{ position: "absolute", top: 18, left: 18, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Compose exhibit</span>
          <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{siteLabel}{planLabel ? ` · ${planLabel}` : ""}</span>
        </div>
        {fitWarning && (
          <div role="alert" style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", maxWidth: "min(560px, calc(100% - 420px))", background: "var(--warn-text)", color: "#fff", padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", textAlign: "center" }}>
            {fitWarning}
          </div>
        )}
        <div style={{
          position: "relative", background: "#fff", boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
          width: "100%", maxWidth: "min(78vw, 78vh * " + pageAspect + ")",
          aspectRatio: String(pageAspect), overflow: "hidden",
        }}>
          {previewSrc && <img src={previewSrc} alt="Sheet preview" style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />}
          {(previewLoading || !previewSrc) && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: previewSrc ? "rgba(255,255,255,0.6)" : "#fff" }}>
              <span style={{ width: 22, height: 22, border: "3px solid rgba(0,0,0,0.12)", borderTopColor: "var(--accent)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
            </div>
          )}
        </div>
      </div>

      {/* The compose panel — a SEPARATE region, never floating over the sheet. */}
      <div style={panelWrap}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border-default)" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Exhibit settings</span>
          <Button variant="ghost" size="sm" onClick={onCancel} title="Close without printing — nothing is changed">✕</Button>
        </div>
        <div style={panelScroll}>
          <Section title="Sheet" accent="var(--accent)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              {PAPER_SIZES.map((p) => (
                <ToggleChip key={p.key} active={paper === p.key} onClick={() => onPaper(p.key)} title={p.note} style={{ justifyContent: "center" }}>
                  {p.label}
                </ToggleChip>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <ToggleChip active={orient === "landscape"} onClick={() => onOrient("landscape")} style={{ flex: 1, justifyContent: "center" }}>Landscape</ToggleChip>
              <ToggleChip active={orient === "portrait"} onClick={() => onOrient("portrait")} style={{ flex: 1, justifyContent: "center" }}>Portrait</ToggleChip>
            </div>
          </Section>

          <Section title="Scale" accent="var(--accent)">
            <select value={scaleFtPerIn || 0} onChange={(e) => onScale(Number(e.target.value) || null)}
              style={{ ...textInput, width: "100%" }} title="An explicit engineering scale locks the frame to a stated ratio; a printed exhibit can be measured off a scale rule. Fit to frame keeps today's behavior — no stated ratio.">
              <option value={0}>Fit to frame (no stated scale)</option>
              {STANDARD_SCALES.map((s) => <option key={s} value={s}>{scaleLabel(s)}</option>)}
            </select>
            {!fitWarning && scaleFtPerIn > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>The printed scale bar will agree with this ratio.</div>
            )}
          </Section>

          <Section title="Title block" accent="var(--accent)">
            <Field label="Project"><span style={readOnlyVal}>{siteLabel || "—"}</span></Field>
            <Field label="Plan"><span style={readOnlyVal}>{planLabel || "—"}</span></Field>
            <Field label="Date"><span style={readOnlyVal}>{dateStr}</span></Field>
            <Field label="North"><span style={readOnlyVal} title="A north arrow is always drawn on the plan itself">Included</span></Field>
            <Field label="Prepared by">
              <input type="text" value={preparedBy} onChange={(e) => onPreparedBy(e.target.value)} placeholder="Name or firm" style={textInput} />
            </Field>
          </Section>

          <Section title="Content" accent="var(--accent)">
            <ContentToggle label="Dimensions" title="The red footprint dimension callouts" checked={showDims} onChange={onToggleDims} />
            <ContentToggle label="Element area / SF labels" title="The square-footage / acreage line on element labels" checked={showAreas} onChange={onToggleAreas} />
            {aerialAvailable && <ContentToggle label="Aerial imagery" title="The satellite/aerial backdrop" checked={showAerial} onChange={onToggleAerial} />}
            {overlayPrintable && <ContentToggle label="Placed reference overlay" title="The placed site-plan overlay — exactly as shown (scale, position, rotation, opacity)" checked={printOverlay} onChange={onTogglePrintOverlay} />}
            {mapLayersPrintable && <ContentToggle label="Map / GIS layers" title="The live map layers (floodplain, pipelines, utilities…), exactly as shown on the map" checked={printMapLayers} onChange={onToggleMapLayers} />}
          </Section>

          <Section title="Buildings table" collapsed accent="var(--accent)">
            {buildingRulesPanel}
          </Section>
        </div>
        <div style={panelFooter}>
          <Button variant="ghost" size="sm" onClick={onReposition} title="Go back to the canvas to move or resize the frame — nothing here is lost">◂ Reposition</Button>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={!!fitWarning || downloading} onClick={onDownload} title={fitWarning || "Build a finished PDF and download it"}>
            {downloading ? "Preparing…" : "Download PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
