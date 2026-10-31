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
 *
 * NEW-1 (owner report) — `data-wheelscroll="1"` on the outer full-screen wrapper. The
 * canvas's non-passive wheel-zoom handler is bound to the canvas WRAPPER and calls
 * `e.preventDefault()` on every wheel event that doesn't bubble through a
 * `[data-wheelscroll]` node (SitePlanner.jsx's wheel-zoom block) — this screen renders as a
 * DOM descendant of that wrapper even though it's visually `position:fixed` over it, so
 * without the attribute every wheel notch here silently zoomed the hidden canvas instead of
 * scrolling anything: the options column couldn't scroll at all, and scrolling over the
 * preview image invisibly re-zoomed the canvas underneath for when the dialog closes. One
 * attribute on the root opts the WHOLE screen out — the options column keeps its own
 * `overflowY:auto` and scrolls natively; the preview pane has nothing to scroll, so a wheel
 * over it is now simply inert (it does not zoom the preview — see NEW-1 in BACKLOG.md).
 * Keyboard PageDown/ArrowDown already scrolled the panel correctly (native browser behavior on
 * a focused control inside an `overflow:auto` region) — measured, not assumed, in
 * ui-audit/verify-print-menu-scroll-and-band.mjs; only the mouse/trackpad wheel was broken.
 */
import { Button, ToggleChip, SegmentedControl, Section, Field, CONTROL_RADIUS } from "../../../shared/ui/controls.jsx";
import { PRIMARY_PAPERS, OTHER_PAPERS, CUSTOM_PAPER, CUSTOM_PAPER_LABEL, paperChoice, paperPick } from "../lib/printSheet.js";
import { STANDARD_SCALES, scaleLabel } from "../lib/printScale.js";

/* NEW-1 (2026-10-30, owner-approved mockup) — the panel uses ONE text size throughout (the owner rejects
 * mixed sizes); hierarchy comes from grouping, order, bold and the card treatment only. Section headings are
 * the shared `Section` primitive's own label. */
const TEXT = 12;
const panelWrap = { width: 380, flex: "none", display: "flex", flexDirection: "column", background: "var(--surface-raised)", borderLeft: "1px solid var(--border-default)", boxShadow: "-8px 0 24px rgba(0,0,0,0.08)" };
const panelScroll = { flex: 1, overflowY: "auto", padding: "14px 14px 4px", fontSize: TEXT };
const panelFooter = { flex: "none", display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--border-default)" };
const textInput = { font: "inherit", fontSize: TEXT, padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)", width: 168 };
const checkRow = { display: "flex", alignItems: "center", gap: 8, fontSize: TEXT, color: "var(--text-primary)", padding: "5px 0", cursor: "pointer", userSelect: "none" };
const secondary = { color: "var(--text-secondary)" };

function ContentToggle({ label, title, checked, onChange }) {
  return (
    <label style={checkRow} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ cursor: "pointer", margin: 0 }} />
      {label}
    </label>
  );
}

/* A "Sheet" card: the whole card is the click target (it is one <label>), checkbox at the left, bold title,
 * one plain description line, and a small page icon at the right showing where the piece sits on the sheet. */
function SheetCard({ title, description, tinted, checked, onChange, icon }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer", userSelect: "none",
      borderRadius: CONTROL_RADIUS.control, border: `1px solid ${tinted ? "var(--accent)" : "var(--border-default)"}`,
      background: tinted ? "color-mix(in srgb, var(--accent) 10%, var(--surface-raised))" : "var(--surface-raised)",
    }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ cursor: "pointer", margin: 0, flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 700, color: "var(--text-primary)" }}>{title}</span>
        <span style={{ display: "block", marginTop: 2, ...secondary }}>{description}</span>
      </span>
      {icon}
    </label>
  );
}

const pageIconSvg = (children) => (
  <svg width="26" height="32" viewBox="0 0 26 32" aria-hidden="true" style={{ flex: "none" }}>
    <rect x="1" y="1" width="24" height="30" rx="2" fill="var(--surface-raised)" stroke="var(--text-secondary)" strokeWidth="1.5" />
    {children}
  </svg>
);
// Bar along the bottom of the page.
const StripIcon = () => pageIconSvg(<rect x="4" y="24" width="18" height="4" rx="1" fill="var(--accent)" />);
// Small block in a corner of the page.
const TableIcon = () => pageIconSvg(<rect x="14" y="4" width="8" height="8" rx="1" fill="var(--accent)" />);

export default function PrintCompose({
  paper, onPaper, orient, onOrient,
  fitToFramePage, onToggleFitToFramePage,
  scaleFtPerIn, onScale, fitWarning,
  previewSrc, previewLoading, pageAspect,
  siteLabel, planLabel, dateStr,
  preparedBy, onPreparedBy,
  showDims, onToggleDims,
  showAreas, onToggleAreas,
  aerialAvailable, showAerial, onToggleAerial,
  overlayPrintable, printOverlay, onTogglePrintOverlay,
  mapLayersPrintable, printMapLayers, onToggleMapLayers,
  showMetricsBand, onToggleMetricsBand,
  buildingsTablePrintable, showBuildingsTable, onToggleBuildingsTable,
  flattenMarkups, onToggleFlattenMarkups,
  onReposition, onCancel, onDownload,
  downloading,
}) {
  const choice = paperChoice(paper, fitToFramePage);
  const pickPaper = (key) => {
    if (!key) return;
    const next = paperPick(key, paper, !!fitToFramePage);
    if (next.paper !== paper) onPaper(next.paper);
    if (next.fitToFramePage !== !!fitToFramePage) onToggleFitToFramePage(next.fitToFramePage);
  };
  return (
    <div data-testid="print-compose" data-wheelscroll="1" style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", background: "var(--surface-page)" }}>
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
          <Button variant="ghost" size="sm" onClick={onCancel} title="Close without printing">✕</Button>
        </div>
        <div style={panelScroll}>
          <Section title="Paper" accent="var(--accent)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 }}>
              {PRIMARY_PAPERS.map((p) => (
                <ToggleChip key={p.key} active={choice.primary === p.key} onClick={() => pickPaper(p.key)} aria-pressed={choice.primary === p.key}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "9px 6px", fontSize: TEXT, borderRadius: CONTROL_RADIUS.control }}>
                  <span style={{ fontWeight: 700 }}>{p.size}</span>
                  <span style={{ fontWeight: 400, ...(choice.primary === p.key ? { opacity: 0.85 } : secondary) }}>{p.name}</span>
                </ToggleChip>
              ))}
            </div>
            <select aria-label="Other size" value={choice.other} onChange={(e) => pickPaper(e.target.value)} style={{ ...textInput, width: "100%", marginBottom: 8 }}>
              <option value="" disabled>Other size</option>
              {OTHER_PAPERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <option value={CUSTOM_PAPER}>{CUSTOM_PAPER_LABEL}</option>
            </select>
            <SegmentedControl
              aria-label="Orientation"
              value={orient} onChange={(k) => !fitToFramePage && onOrient(k)}
              style={fitToFramePage ? { opacity: 0.45 } : undefined}
              options={[
                { key: "landscape", label: "Landscape", disabled: !!fitToFramePage, title: fitToFramePage ? "Orientation follows the frame" : undefined },
                { key: "portrait", label: "Portrait", disabled: !!fitToFramePage, title: fitToFramePage ? "Orientation follows the frame" : undefined },
              ]}
            />
          </Section>

          <Section title="Scale" accent="var(--accent)">
            <select value={scaleFtPerIn || 0} onChange={(e) => onScale(Number(e.target.value) || null)} style={{ ...textInput, width: "100%" }} aria-label="Scale">
              <option value={0}>Scale to fit (NTS)</option>
              {STANDARD_SCALES.map((s) => <option key={s} value={s}>{scaleLabel(s)}</option>)}
            </select>
            {!fitWarning && scaleFtPerIn > 0 && (
              <div style={{ marginTop: 6, ...secondary }}>The printed scale bar will agree with this ratio.</div>
            )}
          </Section>

          <Section title="Sheet" accent="var(--accent)">
            <SheetCard tinted title="Site summary strip" description="Detention required vs. provided, site totals, screening note. Runs across the bottom of the sheet."
              checked={showMetricsBand} onChange={onToggleMetricsBand} icon={<StripIcon />} />
            {buildingsTablePrintable && (
              <SheetCard title="Buildings table" description="Each building's name and square feet, with a total. Sits in a corner of the plan."
                checked={showBuildingsTable} onChange={onToggleBuildingsTable} icon={<TableIcon />} />
            )}
          </Section>

          <Section title="On the plan" accent="var(--accent)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 12 }}>
              <ContentToggle label="Dimensions" checked={showDims} onChange={onToggleDims} />
              <ContentToggle label="Square feet labels" checked={showAreas} onChange={onToggleAreas} />
              {aerialAvailable && <ContentToggle label="Aerial" checked={showAerial} onChange={onToggleAerial} />}
              {mapLayersPrintable && <ContentToggle label="Map layers" checked={printMapLayers} onChange={onToggleMapLayers} />}
              {overlayPrintable && <ContentToggle label="Overlay" checked={printOverlay} onChange={onTogglePrintOverlay} />}
            </div>
          </Section>

          <Section title="Title block" accent="var(--accent)">
            <div style={{ marginBottom: 8, ...secondary }}>{[siteLabel || "—", planLabel || "—", dateStr].join(" · ")}</div>
            <Field label="Prepared by">
              <input type="text" autoComplete="off" value={preparedBy} onChange={(e) => onPreparedBy(e.target.value)} placeholder="Name or firm" style={textInput} />
            </Field>
          </Section>

          <Section title="Markups" accent="var(--accent)">
            <ContentToggle label="Flatten markups (unrecoverable)" title="Off: callouts, lines, shapes and measurements stay editable in the PDF. On: they are burned into the page and can't be edited again." checked={!!flattenMarkups} onChange={onToggleFlattenMarkups} />
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
