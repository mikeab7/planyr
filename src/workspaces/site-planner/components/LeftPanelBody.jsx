/* @planner-extract — the left panel body (every docked or floating panel) (audit batch G6, behaviour-identical move).
 * Was `renderPanelBody` inside SitePlanner.jsx; now a module-scope memoized component
 * (MODULE-SCOPE-COMPONENTS). Everything they read from the planner arrives as a prop; no import back from SitePlanner.jsx. */
import { Suspense, lazy, memo } from "react";
import LazyPanel from "./LazyPanel.jsx";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import ColorField from "../../../shared/ui/ColorField.jsx";
import { MEASURE_LINE, labelRevealNote } from "../lib/measureStyle.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import ParcelRequestLink from "./ParcelRequestLink.jsx";
import { feetToLatLng } from "../lib/arcgis.js";
import { apprRows, apprVal } from "../lib/appraisal.js";
import { TYPE, typeStyle, toHex6, SETBACK_LINE } from "../lib/planStyle.js";
import ActionLink from "./ActionLink.jsx";
import WatchOutChip from "./WatchOutChip.jsx";
import YieldFooterDisclaimer from "./YieldFooterDisclaimer.jsx";
import Collapse from "./Collapse.jsx";
import { roadClassesOf, classMinRadius, ROAD_CLASS_SEEDS } from "../lib/roadClasses.js";
import { SQFT_PER_ACRE } from "../lib/siteGeometry.js";
import { costRollup } from "../lib/costTakeoff.js";
import { DIM_CALLOUT_MIN_PPF } from "../lib/labelLayout.js";
import { balanceAssist, netImportCy, TIE_DROP_FT } from "../lib/proposedSurface.js";
import { solveBalanceFfe, ffeDualDisplay } from "../lib/ffeBalance.js";
import { GRADING_RULES, chipLabel as gradingChipLabel } from "../lib/gradingRules.js";
import ParcelsPanel from "./ParcelsPanel.jsx";
import { dissolvedParcelSqft } from "../lib/polyClip.js";
import { maxFiniteUpTo } from "../lib/buildingProps.js";
import { acreageComparison } from "../lib/parcelArea.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { commaInt as f0, commaDec1 as f1, commaDec2 as f2 } from "../../../shared/units/numberFormat.js";
import { BORDER_1, SURF_RAISED } from "../lib/plannerShared.js";
import { NumInput } from "./NumInput.jsx";
import { CostDisclosure, DrainagePanel, ProvenanceLegend, YieldPanel } from "./YieldDrainagePanels.jsx";
import { COLOR_SEED, ROW4 } from "../lib/plannerConstants.js";
import { Section, Field, PairedField, PairedFieldHead, PercentField, StdSubLabel } from "./PropFields.jsx";
import { DASH_OPTIONS } from "./PlannerIcons.jsx";
import { NO_AUTOFILL } from "../../../shared/ui/noAutofill.js";

const GradingPanel = lazy(() => import("./GradingPanels.jsx").then((m) => ({ default: m.GradingPanel })));
const SiteAnalysis = lazy(() => import("./SiteAnalysis.jsx"));
const OverlaysPanel = lazy(() => import("./OverlaysPanel.jsx"));
const ParcelCopyNote = lazy(() => import("./ParcelCopyNote.jsx")); // NEW-1 (2026-10-29) — the "this is a copy of the county's data" line

export const LeftPanelBody = memo(function LeftPanelBody({
  PAL,
  addByAddress,
  addMethodCard,
  addParcelAnchor,
  addParcelMenu,
  addRuleTier,
  addrBusy,
  addrQuery,
  analysisLayerZoomNote,
  basemapOn,
  bldg,
  buildingRules,
  bumpArea,
  bumpCount,
  bumpsUniform,
  cfHeatUser,
  checkJurisdiction,
  chip,
  colorCtl,
  cov,
  detPct,
  dockActionsEl,
  draftMeasureStd,
  draftParcelStd,
  draftTypeStd,
  drainCtxData,
  drainFacts,
  easeAll,
  easeArea,
  easeBldgArea,
  easePaveArea,
  els,
  ensureBasemapOn,
  flashWarn,
  floatActionsEl,
  floodExposure,
  fmAutoFfeFt,
  fmBalanceRaiseFt,
  fmEffectivePadFt,
  fmGradeAt,
  fmHeat,
  fmHeatOn,
  fmHeatTotals,
  fmHeatUser,
  fmManualPadFt,
  fmResultView,
  foreignOverlays,
  grEditLimit,
  grModel,
  grOn,
  grPatchBuilding,
  grSetCfg,
  grSetLayer,
  grToggleBuildable,
  gradDockActionsEl,
  gradFloatActionsEl,
  gradeSurface,
  gradingOn,
  gsApronRatio,
  gsBuildAtFfe,
  gsBuildAtT,
  gsDaylightAsap,
  gsDockDrop,
  gsFieldT,
  gsSettings,
  gsShrinkPct,
  gsTarget,
  identAdded,
  identifyMode,
  identifyRes,
  impPct,
  isFloating,
  jurInfo,
  jurRow,
  layerStatus,
  leftWidth,
  measureStdValueUI,
  menuItem,
  menuPanel,
  mergePick,
  metricRow,
  moveRuleTier,
  numInput,
  open,
  origin,
  outlinePhase,
  outlineRefused,
  ovCalib,
  ovCalibMsg,
  ovPageFocus,
  ovRenaming,
  ovRowMenu,
  overlayBusy,
  overlayLoadErr,
  overlayPanelHandlers,
  overlays,
  pageOpen,
  parcelOverlaps,
  parcelPanelH,
  parcelRows,
  parcelSiteAcres,
  parcelStdValue,
  parcels,
  pickedParcelIds,
  pondArea,
  pondBermFillCf,
  pondBermFloodCount,
  pondBermRingSf,
  pondCount,
  pondExcavationCf,
  pondLedger,
  providedDetCf,
  pushHistory,
  ratio,
  refRows,
  removeRuleTier,
  renderParcelPage,
  resetBuildingRules,
  roadLengthOf,
  roadPavedWidth,
  selOverlay,
  selParcel,
  selectTool,
  setAddParcelMenu,
  setAddrQuery,
  setAnalysisWetlands,
  setCfHeatUser,
  setDeedBusy,
  setDeedErr,
  setFmHeatUser,
  setFmMitOpen,
  setIdentifyMode,
  setIdentifyRes,
  setJurInfo,
  setLeftPanel,
  setMulti,
  setRuleTier,
  setSel,
  setSetLocOpen,
  setSettings,
  setStdDraft,
  setTitleErr,
  setTitleOpen,
  settings,
  showAerial,
  showForeignOverlay,
  siteId,
  siteSqft,
  siteStateId,
  splitTarget,
  stalls,
  standardsFocus,
  stdDraft,
  toggleAnalysisCall,
  toggleAnalysisLayer,
  tool,
  trailers,
  view,
  _pid,
}) {
  return (<>
          {/* Overlays (B654; user-facing name via B966630; data model unified in B848736) — every
              backdrop the plan sits over, in ONE list, ONE add flow, and ONE shared calibration
              (the ovCalib trace/align flow). An aerial captured from the Map (top-left) is just a
              reference that happens to be a photo — it lands in `sheetOverlays` like everything
              else, bottom-pinned (lib/overlayOrder.js's `isPinnedMapReference`) so it still renders
              beneath everything, matching the old dedicated aerial slot's position. There is no
              second card and no second concept: dropping a screenshot here (or on the map) adds it
              to this same list, through the same dropzone below. */}
          {_pid === "references" && (
          <Section>
            {/* NEW-1 (2026-10-08 redesign) — the panel body lives in components/OverlaysPanel.jsx; every
                handler below is one of this file's EXISTING overlay functions. */}
            <LazyPanel name="Overlays" minHeight={180} label="Loading overlays…">
            <OverlaysPanel
              overlays={[...refRows, ...foreignOverlays.rows.map((r) => ({ ...r.overlay, id: "foreign:" + r.key, foreign: { planName: r.planName }, _fr: r }))]} selId={selOverlay} showAerial={showAerial} hasParcel={parcels.length > 0}
              busy={overlayBusy} loadErr={overlayLoadErr} basemapNote={!!(origin && basemapOn && showAerial)}
              calib={ovCalib} calibMsg={ovCalibMsg()} menuId={ovRowMenu} renamingId={ovRenaming} pageFocusTick={ovPageFocus}
              onShowForeign={(row) => showForeignOverlay(row._fr)}
              handlers={overlayPanelHandlers} />
            </LazyPanel>
          </Section>
          )}

          {/* Parcel menu — empty hint when no parcel is selected */}
          {/* every parcel in this plan — click to select */}
          {/* Site Analysis (B147): screen the active-parcel footprint for floodplain,
              wetlands, pipelines, oil/gas wells, contamination, jurisdiction & zoning. */}
          {_pid === "analysis" && (
            <Section>
              {!origin ? (
                <div style={{ fontSize: 12, color: PAL.muted, lineHeight: 1.6 }}>Site Analysis needs a georeferenced plan. Bring a parcel in from the map to anchor it, then screen it here.</div>
              ) : (() => {
                const act = parcels.filter((p) => p.active !== false && (p.points?.length || 0) >= 3);
                const rings = act.map((p) => p.points.map((pt) => { const [lat, lng] = feetToLatLng(pt, origin.lat, origin.lon); return [lng, lat]; }));
                const acres = dissolvedParcelSqft(act) / SQFT_PER_ACRE; // B715: dissolve overlaps (count shared ground once)
                // NEW-1 — save-and-except carve-outs ride along as HOLES, so every area fraction the panel states is of the
                // land that is actually the property (parcelArea.js: the same deduction every acreage number takes).
                const holeRings = act.flatMap((p) => (Array.isArray(p.exceptions) ? p.exceptions : [])
                  .map((h) => (h && Array.isArray(h.pts) ? h.pts : Array.isArray(h) ? h : null))
                  .filter((pts) => pts && pts.length >= 3)
                  .map((pts) => pts.map((pt) => { const [lat, lng] = feetToLatLng(pt, origin.lat, origin.lon); return [lng, lat]; })));
                const analysisNode = (
                  <SiteAnalysis rings={rings} holes={holeRings} acres={acres} parcelCount={act.length}
                    isLayerOn={(id) => !!overlays?.[id]?.on} onToggleLayer={toggleAnalysisLayer} layerStatus={layerStatus} layerZoomNote={analysisLayerZoomNote}
                    callsChecked={settings.analysisCalls || null} onToggleCall={toggleAnalysisCall}
                    onOpenDrainage={() => setLeftPanel("drainage")}
                    onFindings={(fs) => { const w = fs && fs.find((f) => f.id === "wetlands"); setAnalysisWetlands(w ? w.status : null); }} />
                );
                // Site Analysis carries NO grading or ground rows (NEW-1, amends B2315856): the owner-only Grading panel is its own
                // left-dock item beside Drainage and Yield.
                return (
                  <>
                    <LazyPanel name="Site Analysis" minHeight={220} label="Loading site analysis…">
                      {analysisNode}
                    </LazyPanel>
                  </>
                );
              })()}
            </Section>
          )}
          {_pid === "parcel" && (
            // B651 — count the CURRENT lots only: a superseded (split) parent is history, not a
            // counted parcel, so splitting one lot into two still reads "Parcels · 2".
            <Section>
              {/* NEW-1 — THE LOAD-BEARING ROW. Un-located plan (drawn while the county service was
                  down): this is the way back to the real world, and it sits at the top of the panel
                  the owner is already in when drawing a boundary. */}
              {!origin && (
                <button data-testid="set-location-cta" onClick={() => setSetLocOpen(true)}
                  title="Say where this plan sits on the earth — the aerial, flood layer, contours and county rules switch on. Nothing you drew moves."
                  style={{ ...chip, width: "100%", marginBottom: 9, background: PAL.accent, color: "#fff", borderColor: PAL.accent, fontWeight: 700 }}>
                  📍 Set this plan's location
                </button>
              )}
              {/* NEW-1 (B1239328) — the Land tab is a LIST OF LAND, not a tool tray: the old Add ▾ /
                  Split / Merge / Select-parcels row is gone (Split and Merge already live in the
                  Parcel tools flyout as "Split a parcel" / "Combine parcels"; Select parcels is gone
                  entirely, replaced by per-parcel Lock — see startMoveParcel). ＋ Add survives as ONE
                  icon control, in the header, opening the same four add-methods menu it always did
                  (now including the deed/title path, which used to live only in the right rail). */}
              {parcels.length === 0 ? (
                <>
                  <div style={{ fontSize: 12, color: PAL.muted, lineHeight: 1.6, marginBottom: 10 }}>No land in this plan yet — add it one of four ways:</div>
                  {origin ? (
                    <button style={addMethodCard} onClick={() => { setIdentifyMode(true); ensureBasemapOn(); setIdentifyRes(null); setJurInfo(null); }}>
                      <div style={{ fontWeight: 650, fontSize: 13 }}>🔍 Click a lot on the map</div>
                      <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Property lines from the county appraisal district light up on the aerial — click one lot or several.</div>
                    </button>
                  ) : (
                    <button style={addMethodCard} onClick={() => setSetLocOpen(true)}>
                      <div style={{ fontWeight: 650, fontSize: 13 }}>🔍 Click a lot on the map</div>
                      <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Needs a location first — set one and this turns on.</div>
                    </button>
                  )}
                  {origin ? (
                    <div style={addMethodCard}>
                      <div style={{ fontWeight: 650, fontSize: 13, color: PAL.ink }}>📍 Add by address</div>
                      <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, margin: "2px 0 6px" }}>We'll look up that address, or a parcel number, at the county and add the lot.</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={addrQuery}
                          onChange={(e) => setAddrQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); addByAddress(); } }}
                          placeholder="123 Main St, Katy TX"
                          style={{ flex: 1, minWidth: 0, padding: "6px 8px", fontSize: 12, fontFamily: "inherit", border: `1px solid ${PAL.panelLine || "var(--border-default)"}`, borderRadius: 6, outline: "none", color: PAL.ink, background: SURF_RAISED }} />
                        <button
                          onClick={addByAddress} disabled={addrBusy || !addrQuery.trim()}
                          title="Find this address and add its parcel"
                          style={{ flex: "none", padding: "6px 11px", fontSize: 12, fontWeight: 600, borderRadius: RADIUS.sm, border: `1px solid ${PAL.accent}`, background: addrBusy || !addrQuery.trim() ? SURF_RAISED : PAL.accent, color: addrBusy || !addrQuery.trim() ? PAL.muted : SURF_RAISED, cursor: addrBusy ? "progress" : (!addrQuery.trim() ? "default" : "pointer") }}>
                          {addrBusy ? "…" : "Find"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button style={addMethodCard} onClick={() => setSetLocOpen(true)}>
                      <div style={{ fontWeight: 650, fontSize: 13 }}>📍 Add by address</div>
                      <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Needs a location first — set one and this turns on.</div>
                    </button>
                  )}
                  <button style={addMethodCard} onClick={() => selectTool("parcel")}>
                    <div style={{ fontWeight: 650, fontSize: 13 }}>✏️ Draw a new boundary</div>
                    <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>For a lot that's not in county records yet.</div>
                  </button>
                  <button style={{ ...addMethodCard, marginBottom: 0 }} onClick={() => { setTitleErr(""); setDeedErr(""); setDeedBusy(false); setTitleOpen(true); }}>
                    <div style={{ fontWeight: 650, fontSize: 13 }}>📜 Deed / Title — metes &amp; bounds…</div>
                    <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Type in the legal description's calls and it plots the boundary for you.</div>
                  </button>
                </>
              ) : (() => {
                // VIEW-INDEPENDENT-ONCE: the rows / site acres are functions of `parcels` alone — memoised at the top
                // level (parcelRows / parcelSiteAcres), so a pan or zoom never re-derives them.
                const addParcelNode = (
                  <div ref={addParcelAnchor} style={{ position: "relative", flex: 1 }}>
                        <button
                          aria-haspopup="menu" aria-expanded={addParcelMenu} aria-label="Add parcels" data-testid="land-add-btn"
                          style={{ ...chip, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 600 }}
                          onClick={() => setAddParcelMenu((o) => !o)} title="Add land to this plan — click lots on the map, draw a boundary, or plot a deed">
                          + Add parcels ▾
                        </button>
                        <AnchoredMenu open={addParcelMenu} onClose={() => setAddParcelMenu(false)} anchorRef={addParcelAnchor} placement="below-left" width={Math.max(248, leftWidth - 48)} panelStyle={menuPanel}>
                          {/* Identify from the county's parcel map — the headline path (needs a georeferenced frame). */}
                          {origin ? (
                            <button style={menuItem(identifyMode)} onClick={() => { setIdentifyMode(true); ensureBasemapOn(); setIdentifyRes(null); setJurInfo(null); setAddParcelMenu(false); }}>
                              <div style={{ fontWeight: 650, fontSize: 13 }}>Pick lots on the map</div>
                              <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>County property lines light up on the aerial — click one lot or several.</div>
                            </button>
                          ) : (
                            // NEW-1 — a dead end no more: the reason this is off is that the plan has no
                            // location, and that is now fixable right here.
                            <button style={menuItem(false)} onClick={() => { setSetLocOpen(true); setAddParcelMenu(false); }}>
                              <div style={{ fontWeight: 650, fontSize: 13 }}>🔍 Click a lot on the map</div>
                              <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Needs a location first — set one and this turns on.</div>
                            </button>
                          )}
                          {/* Add by address (B384) — geocode a typed address, then identify-and-add the lot
                              at that point through the SAME quickAddAt path. Needs a georeferenced frame. */}
                          {origin ? (
                            <div style={{ padding: "7px 10px" }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ fontWeight: 650, fontSize: 13, color: PAL.ink }}>📍 Add by address</div>
                              <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, margin: "2px 0 6px" }}>We'll look up that address, or a parcel number, at the county and add the lot.</div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  value={addrQuery}
                                  onChange={(e) => setAddrQuery(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); addByAddress(); } }}
                                  placeholder="123 Main St, Katy TX"
                                  style={{ flex: 1, minWidth: 0, padding: "6px 8px", fontSize: 12, fontFamily: "inherit", border: `1px solid ${PAL.panelLine || "var(--border-default)"}`, borderRadius: 6, outline: "none", color: PAL.ink, background: SURF_RAISED }} />
                                <button
                                  onClick={addByAddress} disabled={addrBusy || !addrQuery.trim()}
                                  title="Find this address and add its parcel"
                                  style={{ flex: "none", padding: "6px 11px", fontSize: 12, fontWeight: 600, borderRadius: RADIUS.sm, border: `1px solid ${PAL.accent}`, background: addrBusy || !addrQuery.trim() ? SURF_RAISED : PAL.accent, color: addrBusy || !addrQuery.trim() ? PAL.muted : SURF_RAISED, cursor: addrBusy ? "progress" : (!addrQuery.trim() ? "default" : "pointer") }}>
                                  {addrBusy ? "…" : "Find"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button style={menuItem(false)} onClick={() => { setSetLocOpen(true); setAddParcelMenu(false); }}>
                              <div style={{ fontWeight: 650, fontSize: 13 }}>📍 Add by address</div>
                              <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Needs a location first — set one and this turns on.</div>
                            </button>
                          )}
                          {/* Draw a new boundary — always available (no GIS frame needed). */}
                          <button style={menuItem(tool === "parcel")} onClick={() => { selectTool("parcel"); setAddParcelMenu(false); }}>
                            <div style={{ fontWeight: 650, fontSize: 13 }}>Draw a parcel</div>
                            <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>For a lot that's not in county records yet.</div>
                          </button>
                          {/* Deed / Title metes & bounds (NEW-1, B1239328) — used to live only in the
                              right rail's Parcel tools flyout; folded in here so ＋ Add is the one
                              place that offers every way to add land. Same handler the rail uses. */}
                          <button style={menuItem(false)} onClick={() => { setAddParcelMenu(false); setTitleErr(""); setDeedErr(""); setDeedBusy(false); setTitleOpen(true); }}>
                            <div style={{ fontWeight: 650, fontSize: 13 }}>Plot from a deed</div>
                            <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Type in the legal description's calls and it plots the boundary for you.</div>
                          </button>
                        </AnchoredMenu>
                      </div>
                );
                const splitRow = splitTarget ? parcelRows.find((r) => r.id === splitTarget) : null;
                if (pageOpen) return renderParcelPage();
                return (
                  <ParcelsPanel
                    rows={parcelRows} siteAcres={parcelSiteAcres} addMenu={addParcelNode}
                    splitMode={splitRow ? { name: splitRow.name, acres: splitRow.acres } : null}
                    selectedId={selParcel?.id || null} pickMode={mergePick} pickedIds={pickedParcelIds}
                    combinePreview={parcelPanelH.combinePreview} handlers={parcelPanelH} />
                );
              })()}
              {/* identify result + armed status (B383) — the body of the ＋ Add parcel menu's
                  "Identify from county GIS" path. The entry point lives in ＋ Add above; no
                  duplicate toggle down here. The status row is the off-switch (so is Esc). */}
              {(identifyMode || identifyRes) && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 10 }}>
                {identifyMode && (
                  <>
                    <button style={{ ...chip, width: "100%", background: PAL.accent, color: "#fff", borderColor: PAL.accent }}
                      onClick={() => { setIdentifyMode(false); setIdentifyRes(null); setJurInfo(null); }} title="Stop adding parcels">
                      {identAdded > 0 ? `Adding lots — ${identAdded} added · Done` : "Click lit-up lots to add · Done"}
                    </button>
                    {/* NEW-1 (select-parcel first paint) — one short status line, from the outline set's own state; it replaces the old zoom-only hint. */}
                    {(outlinePhase === "loading" || outlinePhase === "empty" || outlinePhase === "zoom" || outlineRefused) && (
                      <div data-testid="parcel-outline-status" data-phase={outlineRefused && outlinePhase !== "zoom" && outlinePhase !== "empty" ? "refused" : outlinePhase} role="status" style={{ fontSize: 10.5, color: outlinePhase === "zoom" || outlineRefused ? "var(--warn-text)" : PAL.muted, lineHeight: 1.4, marginTop: 5 }}>
                        {outlinePhase === "zoom" ? "Zoom in to see the county lot lines (a click still adds the lot)."
                          : outlineRefused ? "The county server wouldn't send some of the lot lines here — zoom in, or click a lot anyway."
                          : outlinePhase === "loading" ? "Loading parcels…" : "No parcels here"}
                      </div>
                    )}
                  </>
                )}
                {identifyRes && (
                  <div data-testid="identify-result" style={{ marginTop: identifyMode ? 8 : 0, background: "var(--planner-raised)", border: "1px solid var(--planner-border)", borderRadius: 8, padding: "8px 10px", fontSize: 11.5 }}>
                    {identifyRes.busy ? <span style={{ color: PAL.muted }}>{identifyRes.geo ? "Finding address…" : "Querying county GIS…"}</span>
                      : identifyRes.error ? <><span style={{ color: PAL.warn }}>{identifyRes.error}</span>{identifyRes.request && <ParcelRequestLink href={identifyRes.request} testId="identify-gap-request" />}</>
                      : identifyRes.removed ? <span style={{ color: PAL.muted }}>Removed {identifyRes.addr || "that lot"} from the plan — click it again to re-add.</span>
                      : identifyRes.already ? <span style={{ color: PAL.muted }}>{identifyRes.addr || "That lot"} is already in this plan — selected it.</span>
                      : <>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                            <span style={{ color: "#15803d", fontWeight: 800, fontSize: 13, lineHeight: 1 }}>✓</span>
                            <span style={{ fontWeight: 700, color: PAL.ink }}>Added {identifyRes.addr || "parcel"}</span>
                          </div>
                          {identifyRes.fromFallback && <div data-testid="identify-from-fallback" style={{ color: PAL.warn, marginBottom: 5 }}>{identifyRes.fromFallback}</div>}
                          {identifyRes.stackNote && <div data-testid="identify-stack" style={{ color: PAL.muted, marginBottom: 4 }}>{identifyRes.stackNote}</div>}
                          {identifyRes.county && <Suspense fallback={null}><ParcelCopyNote county={identifyRes.county} point={{ lat: identifyRes.lat, lng: identifyRes.lng }} testId="identify-copy" style={{ marginTop: 6, marginBottom: 4 }} /></Suspense>}
                          {apprRows(identifyRes.attrs).slice(0, 4).map((r) => (
                            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0" }}>
                              <span style={{ color: PAL.muted }}>{r.label}</span><span style={{ color: PAL.ink, fontWeight: 600 }}>{apprVal(r.label, r.value)}</span>
                            </div>
                          ))}
                          <button style={{ ...chip, width: "100%", marginTop: 6 }} onClick={checkJurisdiction} disabled={jurInfo?.busy}>
                            {jurInfo?.busy ? "Checking jurisdiction…" : "⚖︎ Jurisdiction & road authority"}
                          </button>
                          {jurInfo && !jurInfo.busy && (
                            <div style={{ marginTop: 7, borderTop: "1px dashed var(--planner-border)", paddingTop: 6 }}>
                              {jurInfo.error ? <span style={{ color: PAL.warn }}>{jurInfo.error}</span> : <>
                                {jurRow("County", jurInfo.j.county.length ? jurInfo.j.county.join(" + ") : "—", jurInfo.j.ages.county)}
                                {jurRow("City", jurInfo.j.unincorporated ? (jurInfo.j.etjUnavailable ? "Outside city limits" : "Unincorporated") : jurInfo.j.city.join(" + "), jurInfo.j.ages.city)}
                                {jurRow("ETJ", jurInfo.j.etj.length ? jurInfo.j.etj.map((n) => `${n} ETJ`).join(" + ") : ((jurInfo.j.etjUndetermined || []).length ? "ETJ undetermined (disputed)" : (jurInfo.j.etjReleased || []).length ? `${jurInfo.j.etjReleased.join(" + ")} ETJ release area (SB 2038)` : jurInfo.j.etjUnavailable ? "ETJ data unavailable here" : (jurInfo.j.sources.find((s) => s.id === "etj") || {}).state === "unavailable" ? "no ETJ layer here (Houston/Austin/DFW covered)" : "not in a city ETJ"), jurInfo.j.ages.etj)}
                                {Array.isArray(jurInfo.j.isd) && jurRow("School dist.", jurInfo.j.isd.length ? jurInfo.j.isd.join(" + ") : "—", jurInfo.j.ages.isd)}
                                {jurRow("Road maint.", jurInfo.road.authorities.length ? jurInfo.road.authorities.join(" · ") + (jurInfo.road.nearest?.route ? ` (${jurInfo.road.nearest.route})` : "") : "unknown", jurInfo.road.ageMs)}
                                {jurInfo.j.straddle && <div style={{ color: PAL.warn, marginTop: 3 }}>⚑ Straddles a boundary — touches multiple jurisdictions.</div>}
                                <div style={{ color: PAL.muted, marginTop: 4, fontStyle: "italic" }}>Screening only — verify with the jurisdiction.</div>
                              </>}
                            </div>
                          )}
                        </>}
                  </div>
                )}
              </div>
              )}
            </Section>
          )}
          {/* Stated-vs-measured acreage for a parcel that carries a typed deed / stated figure. The county's own
              acreage now sits BESIDE the drawn acres inside the parcel page's county record (B2191xxx), and the
              old Geometry check / Appraisal data / Taxes blocks that used to follow are gone. */}
          {_pid === "parcel" && pageOpen && selParcel && (() => {
            const cmp = acreageComparison(selParcel);
            if (!(cmp.stated && cmp.measured)) return null;
            const [color, mark] = cmp.agreement === "match" ? ["#2f7a3e", "✓"] : cmp.agreement === "close" ? ["var(--text-secondary)", "≈"] : ["#b45309", "▲"];
            return (
              <Section>
                <div data-testid="parcel-stated-check" style={{ fontSize: 11, color, lineHeight: 1.5 }}>
                  <b>{mark} Stated vs measured</b> · stated {f2(cmp.stated)} AC vs {f2(cmp.measured)} AC drawn ({f0(cmp.diffFrac * 100)}% {cmp.agreement === "match" ? "match" : "off"})
                </div>
              </Section>
            );
          })()}
          {/* metrics. NEW-1 — `data-testid="yield-metrics"` marks the numbers as ONE readable
              region: the content-visibility harness compares this subtree's text before and after
              every hide, and its first cut scoped to `[data-surface="planner"]`'s parent instead,
              which resolved to most of the page — so it was diffing canvas labels and the View
              menu's own chrome and reported six false failures. A panel worth asserting on is
              worth being able to select. */}
          {_pid === "yield" && (<div data-testid="yield-metrics" style={{ display: "contents" }}>
          <YieldPanel
            buildingCount={els.filter((e) => e.type === "building" && !e.dogEar).length}
            siteSqft={siteSqft} bldg={bldg} cov={cov} stalls={stalls} ratio={ratio}
            providedDetCf={providedDetCf} pondCount={pondCount}
            trailers={trailers} impPct={impPct} pondArea={pondArea} detPct={detPct} open={open}
            pondBermRingSf={pondBermRingSf}
            bumpCount={bumpCount} bumpArea={bumpArea} bumpsUniform={bumpsUniform}
            inactiveCount={parcels.filter((p) => p.active === false).length}
            easeAll={easeAll} easeArea={easeArea} easeBldgArea={easeBldgArea} easePaveArea={easePaveArea}
            parcelOverlaps={parcelOverlaps}
            onOpenDrainage={() => setLeftPanel("drainage")} // NEW-1 — the pond's one Land Use line links into Drainage
          />
          {/* v3 A8 — ④ Costs: the road + earthwork cards fold into one group. Closed summary is
              "not priced yet" until unit prices are entered; once priced it shows the totals. */}
          {(() => {
          const costP = settings.prices || {};
          const costRoad = costRollup(els, roadPavedWidth, roadLengthOf, costP).total;
          const costEarthPriced = Number.isFinite(costP.earthworkCy) && +costP.earthworkCy > 0;
          const costSummary = (costRoad == null && !costEarthPriced) ? "not priced yet"
            : (costRoad != null ? `$${Math.round(costRoad).toLocaleString()} road${costEarthPriced ? " + earthwork" : ""}` : "earthwork priced");
          return (
          <Collapse sectionId="yield-costs" title="Costs" defaultOpen={false} summary={costSummary}>
          {(() => {
            // B712 — earthwork cost lines: the floodplain-mitigation CUT + pond
            // excavation, in CY, priced ONLY by the user (the road-cost pattern —
            // never a hardcoded rate). An unchecked drainage screen renders an
            // explicit not-checked state; an un-priceable mitigation volume renders
            // UNKNOWN — NEVER a silent 0 CY in a priced takeoff.
            const prices = settings.prices || {};
            const pondCy = pondExcavationCf / 27;
            // B907 — when a basin reuses an existing pond/depression (det.baseline, the
            // "Expand this pond" flow), pondExcavationCf is already the INCREMENTAL cut
            // (incrementalExcavationCf, wired at the ledger build) — flag it here so the
            // line reads honestly, not as a from-scratch dig.
            const anyIncrementalExc = pondLedger.perPond.some((p) => p.excavationIncremental);
            const drainageChecked = !!drainCtxData;
            // NEW-2 — fmResultView carries the remembered mitigation summary on a restored check
            // (fmResult is null then), so the earthwork cut line survives a reload too.
            const mitKnown = fmResultView && fmResultView.volumeCf != null;
            const mitCy = mitKnown ? fmResultView.cutCy : null;
            const fmGeoFailed = drainageChecked && drainCtxData?.floodGeo?.state === "failed";
            const mitRelevant = drainageChecked && ((fmResultView && fmResultView.intersectAcres > 0) || fmGeoFailed);
            // B826 — the graded-surface earthwork (cut/fill off the auto-graded planes)
            // joins this section: rows render whenever the surface engine could build
            // (elements + an FFE), UNKNOWN — never 0 CY — when no ground elevation exists.
            const gsG = gradeSurface ? gradeSurface.grid : null;
            const gsPriced = gsG && gsG.fillCy != null;
            if (!(pondCy > 0) && !mitRelevant && !gsG) return null;
            const usd = (n) => `$${Math.round(n).toLocaleString()}`;
            const pEarthRaw = prices.earthworkCy;
            const pEarth = pEarthRaw == null || pEarthRaw === "" ? null : Number.isFinite(+pEarthRaw) && +pEarthRaw >= 0 ? +pEarthRaw : null;
            const setPrice = (k, v) => setSettings((sx) => ({ ...sx, prices: { ...(sx.prices || {}), [k]: v } }));
            const pricedCy = (pondCy > 0 ? pondCy : 0) + (mitCy || 0) + (gsPriced ? gsG.cutCy : 0);
            const shrinkFactor = 1 + (gsShrinkPct ?? 0) / 100;
            const borrowCy = (pondCy > 0 ? pondCy : 0) + (mitCy || 0);
            // B833(e) — pond berms are PLACED FILL: they join the fill side of the net
            // (an upland berm is earthwork only; its in-floodplain share already joined
            // the mitigation requirement above).
            const bermCy = pondBermFillCf / 27;
            const netCy = gsPriced ? netImportCy({ fillCy: gsG.fillCy + bermCy, cutCy: gsG.cutCy, borrowCy, shrinkFactor }) : null;
            const setGrading = (patch) => setSettings((sx) => ({ ...sx, grading: { ...(sx.grading || {}), ...patch } }));
            // B895 — "Set unit prices" jumps to + focuses the (one shared) $/CY bid field below.
            const jumpToEarthPrice = () => {
              const el = typeof document !== "undefined" ? document.getElementById("price-field-earthworkCy") : null;
              if (el) { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} const inp = el.querySelector("input"); if (inp) try { inp.focus(); } catch (_) {} }
            };
            const earthPriceCell = (cy) => pEarth != null ? usd(cy * pEarth) : <ActionLink onClick={jumpToEarthPrice}>Set $/CY →</ActionLink>;
            return (
              <CostDisclosure label="Earthwork">
                {pondCy > 0 && metricRow(anyIncrementalExc ? "Pond excavation (incremental)" : "Pond excavation", `${f0(pondCy)} CY`, earthPriceCell(pondCy),
                  { code: "plan", basis: anyIncrementalExc ? "One or more basins reuse an existing pond/depression (Expand this pond) — this nets out the pre-expansion basin's own cut, pricing only the ADDED dirt, not a from-scratch re-dig." : undefined })}
                {bermCy > 0 && metricRow("Pond berms — fill", `${f0(bermCy)} CY`, `modeled embankment · ${gsApronRatio}:1 face`, { code: "plan" })}
                {bermCy > 0 && <WatchOutChip style={{ margin: "0 0 3px" }}>Netted against basin cut below — the berm can be built from basin spoil (haul/compaction math is your engineer's).</WatchOutChip>}
                {mitRelevant && (mitKnown
                  ? metricRow("Floodplain mitigation cut", `${f0(mitCy)} CY`, earthPriceCell(mitCy), { code: "plan" })
                  : metricRow("Floodplain mitigation cut", "UNKNOWN", fmGeoFailed ? "flood source unavailable" : "enter elevations"))}
                {gsG && (gsPriced ? (<>
                  {metricRow("Graded surface — cut", `${f0(gsG.cutCy)} CY`, earthPriceCell(gsG.cutCy), { code: "plan" })}
                  {metricRow("Graded surface — fill", `${f0(gsG.fillCy)} CY`, "placed (compacted)", { code: "plan" })}
                  {gsG.wedgeFillCy > 0.5 && metricRow("· incl. transition wedges", `${f0(gsG.wedgeFillCy)} CY`, `daylight fringe @ ${gsApronRatio}:1`)}
                  {metricRow("Net dirt (screening)", `${f0(Math.abs(netCy))} CY ${netCy > 0 ? "import" : "export"}`,
                    gsShrinkPct == null ? "no shrink applied" : `@ ${gsShrinkPct}% shrink`, { code: "plan" })}
                </>) : (
                  metricRow("Graded surface cut / fill", "UNKNOWN", "no ground elevation — ↻ re-check drainage")
                ))}
                {pondBermFloodCount > 0 && (
                  <WatchOutChip info="This pond's earthen berm sits inside the drawn footprint, in the mapped floodplain (the drawn outline is the berm's outer toe; the embankment rises inward from it). The part of that fill below the flood water surface displaces flood storage, so its below-WSE share already joined the mitigation requirement (screening: sampled berm cells times the below-WSE slice). Engineer confirms.">
                    {pondBermFloodCount} pond berm{pondBermFloodCount > 1 ? "s" : ""} in the mapped floodplain: {pondBermFloodCount > 1 ? "their" : "its"} below-flood fill is priced into mitigation.
                  </WatchOutChip>
                )}
                {!drainageChecked && (
                  <WatchOutChip>Floodplain mitigation not screened yet — run ⛆ Check drainage criteria; this takeoff is INCOMPLETE until then, not zero.</WatchOutChip>
                )}
                {/* B826 — violation flags off the auto-graded surface: one WatchOutChip each
                    (the B823 cap); ADA/TAS is LEGAL (danger token), the rest screening. */}
                {gradeSurface && gradeSurface.violations.map((v) => (
                  <WatchOutChip key={v.kind} info={v.detail} danger={v.legal}>{v.legal ? "⚑ " : ""}{v.short}</WatchOutChip>
                ))}
                {gsG && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <button style={chip} disabled={!gsPriced}
                      title="One click: finds the uniform paving-field lower/raise (sweeping every floating class between its band floor and cap — the threshold tie at the doors holds by construction) that nets the dirt closest to zero, and applies it."
                      onClick={() => {
                        // B833 — berm fill rides the fill side of the balance target too.
                        const res = balanceAssist({ buildAtT: gsBuildAtT, shrinkFactor, borrowCy: borrowCy - bermCy * shrinkFactor });
                        if (res) { pushHistory(); setGrading({ fieldT: res.t }); }
                      }}>⚖ Balance the dirt</button>
                    {gsFieldT > 0 && (
                      <button style={chip} title="Back to the flattest class-band slopes (highest paving field)"
                        onClick={() => { pushHistory(); setGrading({ fieldT: null }); }}>× Reset field</button>
                    )}
                    {gsFieldT > 0 && <span style={{ fontSize: 10.5, color: PAL.muted }}>field slopes at {Math.round(gsFieldT * 100)}% of class band</span>}
                  </div>
                )}
                {/* DECISION 3 (grading milestone) — the balance-optimal finished floor. The pad
                    floats UP off its regulatory code minimum (fmAutoFfeFt) to reuse basin spoil
                    as fill, never below it; the dual readout decomposes floor + balance uplift.
                    Auto pad only — a manually typed pad FFE wins outright. */}
                {gsG && fmManualPadFt == null && Number.isFinite(fmAutoFfeFt) && (() => {
                  const ffeDual = ffeDualDisplay({ ffeFt: fmEffectivePadFt, regMinFfeFt: fmAutoFfeFt });
                  const applied = fmBalanceRaiseFt > 0.05;
                  const exporting = gsPriced && netCy != null && netCy < -10; // hauling spoil off at the current floor
                  const raiseFfeToBalance = () => {
                    const netAtFfe = (ffe) => {
                      const g = gsBuildAtFfe(ffe);
                      return g && g.fillCy != null ? netImportCy({ fillCy: g.fillCy + bermCy, cutCy: g.cutCy, borrowCy, shrinkFactor }) : null;
                    };
                    const sol = solveBalanceFfe({ netAtFfe, regMinFfeFt: fmAutoFfeFt });
                    if (sol && sol.balanceRaiseFt > 0.05) { pushHistory(); setGrading({ ffeBalanceRaiseFt: sol.balanceRaiseFt }); }
                    else if (sol && sol.clamped === "imports-at-floor") flashWarn("The site already needs fill trucked in; raising the finished floor only adds more. No balance raise made.", 5000);
                    else flashWarn("The finished floor already balances the on-site dirt.", 5000);
                  };
                  return (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {!applied && exporting && (
                          <button style={chip}
                            title="One click: raises the finished floor off its regulatory code minimum just enough to reuse the basin spoil as pad fill instead of hauling it off. It never drops below the code floor; × Reset floor returns it to the minimum."
                            onClick={raiseFfeToBalance}>⚖ Raise FFE to balance</button>
                        )}
                        {applied && (
                          <button style={chip} title="Return the finished floor to its regulatory code minimum (BFE + the jurisdiction's freeboard)."
                            onClick={() => { pushHistory(); setGrading({ ffeBalanceRaiseFt: null }); }}>× Reset floor to code min</button>
                        )}
                      </div>
                      {ffeDual && (
                        <div style={{ fontSize: 10.5, color: PAL.muted, marginTop: 4, lineHeight: 1.4 }} title="The finished floor sits at the regulatory code minimum (the base-flood elevation plus the jurisdiction's required freeboard). When the site would haul spoil off, raising it for balance reuses that dirt on the pads as fill.">{ffeDual.full}</div>
                      )}
                    </div>
                  );
                })()}
                {gsG && (
                  <label style={{ display: "flex", gap: 6, fontSize: 11, color: PAL.muted, cursor: "pointer", marginTop: 8 }}
                    title="Paints proposed − existing per cell over the plan — warm = fill, cool = cut, grey hatch = no ground data. Same cells these rows summed (engine truth). Turns the fill-depth heat map off while on — one exhibit at a time. The dashed daylight line (where fill/cut tapers to existing ground) rides either exhibit.">
                    <input type="checkbox" checked={cfHeatUser} onChange={(e) => setCfHeatUser(e.target.checked)} /> Cut/fill map on the plan
                  </label>
                )}
                {gsG && (
                  <label style={{ display: "flex", gap: 6, fontSize: 11, color: PAL.muted, cursor: "pointer", marginTop: 6 }}
                    title="B833 — grade each paving field toward the drainage target at its class slope CEILING (the steepest maintainable rate), so the surface gets down to existing ground sooner and the transition wedge past each edge starts lower and daylights earlier — less fill in the floodplain. While on, the ⚖ balance sweep has nothing left to vary (an explicit per-element slope override still wins).">
                    <input type="checkbox" checked={gsDaylightAsap} onChange={(e) => { pushHistory(); setGrading({ daylightAsap: e.target.checked || null }); }} /> Daylight ASAP (steepest legal field)
                  </label>
                )}
                {gsG && (
                  <label style={{ display: "flex", gap: 6, fontSize: 11, color: PAL.muted, cursor: "pointer", marginTop: 6 }}
                    title="B833 — the daylight wedges default to the 3:1 maximum tie-down (the steepest allowed, smallest fringe). Check for the 4:1 mowable preference — a gentler face that takes more room and more fill; the mitigation and earthwork numbers follow.">
                    <input type="checkbox" checked={!!gsSettings.apron41} onChange={(e) => { pushHistory(); setGrading({ apron41: e.target.checked || null }); }} /> 4:1 transition slopes (mowable)
                  </label>
                )}
                <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 6px" }}>Unit prices (your bids)</div>
                <div id="price-field-earthworkCy">
                  <Field label="Excavation / cut">
                    <span style={ROW4}>
                      <span style={{ fontSize: 12, color: PAL.muted }}>$</span>
                      <NumInput style={{ ...numInput, width: 70 }} value={prices.earthworkCy ?? null} min={0} placeholder="—" onCommit={(n) => setPrice("earthworkCy", n)} />
                      <span style={{ fontSize: 11, color: PAL.muted }}>/CY</span>
                    </span>
                  </Field>
                </div>
                {gsG && (
                  <Field label="Fill shrink/swell (%)">
                    <span style={ROW4}>
                      <NumInput allowClear style={{ ...numInput, width: 70 }} value={gsShrinkPct ?? null} min={0} placeholder="0"
                        onCommit={(n) => setGrading({ shrinkPct: Number.isFinite(n) ? n : null })} />
                      <span style={{ fontSize: 11, color: PAL.muted }} title="Compacted fill needs MORE bank dirt than its placed volume (clay placed at 95% Proctor commonly shrinks 10–25%). Blank = none applied — enter your geotech's number.">bank→placed ⓘ</span>
                    </span>
                  </Field>
                )}
                {pEarth != null && pricedCy > 0 && metricRow("Subtotal", usd(pricedCy * pEarth), "priced cut lines", { code: "yours", basis: "Priced off the unit-price bid you entered above." })}
                {gsG && (
                  <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.45, margin: "6px 0 0" }}>
                    Auto-graded planes (B826 screening): pads flat at FFE{fmEffectivePadFt != null ? ` ${f1(fmEffectivePadFt)}′` : ""}; dock courts −{f1(gsDockDrop)}′ falling away; paving ties at FFE − {TIE_DROP_FT}′ and falls toward {gsTarget ? "the detention pond" : "the low side"}; existing ground from {fmGradeAt ? "the 3DEP per-cell grid" : "the flat site median (screening)"}. Confirm with your civil engineer.
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.4, margin: "6px 0 0" }}>
                  Pond excavation is the full basin cut (top of bank → achievable floor){anyIncrementalExc ? " — except a basin reusing an existing pond/depression, which nets to only its ADDED cut" : ""}. Pond + mitigation cut count as on-site borrow in the net-dirt line — the same dirt raises the pad; volumes stay separate ledgers.
                </div>
              </CostDisclosure>
            );
          })()}
          {(() => {
            // Road cost takeoff (B180/B181): paving (SY, FC-FC — curb excluded) + curb
            // (LF, both sides), split by curb type so each rides its own unit price.
            // Unit prices are user-supplied (anchor to your own bids) — never defaulted.
            const prices = settings.prices || {};
            const cost = costRollup(els, roadPavedWidth, roadLengthOf, prices);
            if (!cost.segments) return null;
            const usd = (n) => `$${Math.round(n).toLocaleString()}`;
            const setPrice = (k, v) => setSettings((s) => ({ ...s, prices: { ...(s.prices || {}), [k]: v } }));
            const priceField = (label, k, unit) => (
              <div id={`price-field-${k}`}>
                <Field label={label}>
                  <span style={ROW4}>
                    <span style={{ fontSize: 12, color: PAL.muted }}>$</span>
                    <NumInput style={{ ...numInput, width: 70 }} value={prices[k] ?? null} min={0} placeholder="—" onCommit={(n) => setPrice(k, n)} />
                    <span style={{ fontSize: 11, color: PAL.muted }}>{unit}</span>
                  </span>
                </Field>
              </div>
            );
            // B895 — "Set unit prices" jumps to + focuses the matching bid field below.
            const jumpToPrice = (k) => {
              const el = typeof document !== "undefined" ? document.getElementById(`price-field-${k}`) : null;
              if (el) { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} const inp = el.querySelector("input"); if (inp) try { inp.focus(); } catch (_) {} }
            };
            const priceCell = (costVal, k) => costVal != null ? usd(costVal) : <ActionLink onClick={() => jumpToPrice(k)}>Set $/{k === "pavingSy" ? "SY" : "LF"} →</ActionLink>;
            return (
              <CostDisclosure label="Road">
                {metricRow("Paving", `${f0(cost.pavingSy)} SY`, priceCell(cost.pavingCost, "pavingSy"), { code: "plan" })}
                {cost.curbBarrierLf > 0 && metricRow("Curb · barrier", `${f0(cost.curbBarrierLf)} LF`, priceCell(cost.curbBarrierCost, "curbBarrierLf"), { code: "plan" })}
                {cost.curbGutterLf > 0 && metricRow("Curb · curb & gutter", `${f0(cost.curbGutterLf)} LF`, priceCell(cost.curbGutterCost, "curbGutterLf"), { code: "plan" })}
                <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 6px" }}>Unit prices (your bids)</div>
                {priceField("Paving", "pavingSy", "/SY")}
                {cost.curbBarrierLf > 0 && priceField("Barrier curb", "curbBarrierLf", "/LF")}
                {cost.curbGutterLf > 0 && priceField("Curb & gutter", "curbGutterLf", "/LF")}
                {cost.total != null && metricRow("Subtotal", usd(cost.total), "priced lines", { code: "yours", basis: "Priced off the unit-price bids you entered above." })}
                <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.4, margin: "6px 0 0" }}>
                  Paving is face-of-curb to face-of-curb (curb excluded); curb-&amp;-gutter trims the gutter pan from paving.
                </div>
              </CostDisclosure>
            );
          })()}
          </Collapse>
          ); })()}
          {/* v3 A8→A9 — the panel FOOTER renders after the COSTS group (last, per the spec order):
              the ONE screening disclaimer + the provenance legend (four quiet outlined chips with a
              muted plain-English definition; Yield panel only). */}
          <YieldFooterDisclaimer />
          <ProvenanceLegend style={{ marginTop: 7, marginBottom: 9 }} />
          </div>)}

          {/* NEW-1 (2026-09-05, owner directive) — DRAINAGE owns the flood/detention/mitigation
              working surface split out of Yield's old "Stormwater" section: the governing
              authority + rule, required-vs-provided detention, pond sizing + storage
              reconciliation, mitigation, finished-floor/freeboard, and the buildings-in-
              floodplain check. Reads the SAME `drainFacts()` (ONE fetch, ONE cache, ONE
              timestamp) Yield used to. */}
          {_pid === "drainage" && (<div data-testid="drainage-metrics" style={{ display: "contents" }}>
          <DrainagePanel
            headerSlot={dockActionsEl || floatActionsEl}
            drainage={drainFacts()}
            heat={{ available: !!fmHeat, on: fmHeatOn, user: fmHeatUser, onToggle: setFmHeatUser, totals: fmHeatTotals, ledgerAcFt: fmResultView?.volumeAcFt ?? null }}
            floodExposure={floodExposure} // NEW-3 — per-building floodplain exposure, its own Collapse here
            onMitOpenChange={setFmMitOpen}
            siteId={siteId} siteState={siteStateId} // B877440/B877441 — the "Request criteria" action on a no-data detention row
          />
          </div>)}

          {/* Grading (owner-only; NEW-1, amends B2315856) — the per-building cards + the Ground rows. It only READS grModel:
              the controller is mounted from this component (below) whether or not the panel is open, so the Cut & Fill layer and
              the suggested FFE paint with the panel closed and opening it never starts a build. */}
          {_pid === "grading" && gradingOn && (<div data-testid="grading-metrics" style={{ display: "contents" }}>
            <Suspense fallback={<div style={{ fontSize: 12, color: PAL.muted }}>Loading grading…</div>}>
              <GradingPanel planOn={grOn} showOnMap={!!(settings.grading || {}).layers?.cutfill} onPlanOn={(v) => grSetCfg({ enabled: v ? true : null })}
                onShowOnMap={(v) => grSetLayer("cutfill", v)} model={grOn ? (grModel || null) : null} headerSlot={isFloating("grading") ? gradFloatActionsEl : gradDockActionsEl}
                showContours={!!(settings.grading || {}).layers?.contours} onShowContours={(v) => grSetLayer("contours", v)}
                showPaper={(settings.grading || {}).layers?.paper !== false} onShowPaper={(v) => grSetLayer("paper", v)}
                showSpots={(settings.grading || {}).layers?.spots !== false} onShowSpots={(v) => grSetLayer("spots", v)} PAL={PAL}
                onPullLimit={(id, span) => grEditLimit(span)}
                buildableOn={!!(grModel && grModel.cfg && grModel.cfg.layers.buildable)} onToggleBuildable={grToggleBuildable}
                dockDropFt={gsDockDrop} onCfg={grSetCfg}
                onDockDrop={(v) => { pushHistory(); setSettings((sx) => ({ ...sx, floodMitigation: { ...(sx.floodMitigation || {}), dockDropFt: v } })); }}
                onSelectBuilding={(id) => { setMulti([]); setSel({ kind: "el", id }); }}
                onApplyFfeFix={(id, fx) => grPatchBuilding(id, { padElevFt: fx.ffe, ffeBasis: "typed" }, { history: true })}
                onApplyMoveFix={(id, mv) => grModel.actions.applyMoveFix(id, mv)} />
            </Suspense>
          </div>)}

          {/* Standards (B653) — pure per-element-type STARTING VALUES. The what-you-see
              toggles + grid/snap moved to the on-canvas View (eye) menu; each section
              below is one element type, deep-linkable from that type's inspector via
              standardsFocus (the remount key opens the focused section). */}
          {_pid === "standards" && (<>
          <div style={{ fontSize: 11.5, color: PAL.muted, lineHeight: 1.55, margin: "2px 2px 10px" }}>
            <b style={{ color: PAL.ink }}>Starting values</b> for new objects. Select an object to override just that one.
          </div>

          <div data-std-sec="parcels">
          <Section key={`std-parcels:${standardsFocus === "parcels"}`} title="Parcels" collapsed={standardsFocus !== "parcels"}>
            <Field label="Default setback"><NumInput style={numInput} value={settings.setback} min={0} onCommit={(n) => setSettings((s) => ({ ...s, setback: n }))} /></Field>
            {/* B929 — the rest of a parcel's own properties, now settable as defaults for NEW parcels
                (stamped at creation via parcelDefaultStyle; each mirrors a control in the parcel
                inspector). livePick uses hist=false since these touch settings only (RC-6). */}
            {/* NEW-2 — every edit here lands in the PENDING DRAFT (draftParcelStd). Nothing is
                stored until one of the footer's three actions commits it, which is what makes
                "Save for this plan" mean something. Values read draft-first, then this plan's
                copy, then the account default (see parcelStdValue).
                NEW-1 — the section styles TWO different lines, so each group is labelled: an
                unlabelled pair of colour rows left it guessing which line you were editing. */}
            <StdSubLabel>Parcel line</StdSubLabel>
            <PairedFieldHead left="Outline" right="Fill" />
            <PairedField label="Colour"
              left={<ColorField value={toHex6(parcelStdValue("stroke") ?? PAL.parcel)} title="Outline color" seed={COLOR_SEED} {...colorCtl((v) => draftParcelStd({ stroke: v }), false)} />}
              right={parcelStdValue("fill") ? <ColorField value={toHex6(parcelStdValue("fill"))} title="Fill color" seed={COLOR_SEED} {...colorCtl((v) => draftParcelStd({ fill: v }), false)} /> : undefined}
            />
            <PairedField label="Width"
              left={<NumInput style={{ ...numInput, width: "100%" }} value={parcelStdValue("weight") ?? 2} min={0.5} step={0.5} coarse={2} onCommit={(n) => draftParcelStd({ weight: n })} />}
            />
            <PairedField label="Pattern"
              left={<select value={parcelStdValue("dash") ?? "solid"} onChange={(e) => draftParcelStd({ dash: e.target.value })} style={{ ...numInput, width: "100%", cursor: "pointer" }}>{DASH_OPTIONS}</select>}
            />
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, margin: "2px 2px 8px", cursor: "pointer" }}>
              <input type="checkbox" checked={!!parcelStdValue("fill")} onChange={(e) => draftParcelStd(e.target.checked ? { fill: "#5b6650" } : { fill: null, fillOpacity: null })} /> Fill new parcels (off by default)
            </label>
            {parcelStdValue("fill") && (
              <PairedField label="Opacity"
                right={<PercentField value={parcelStdValue("fillOpacity") ?? 0.12} max={60} onCommit={(v) => draftParcelStd({ fillOpacity: v })} inputStyle={numInput} ariaLabel="Fill opacity" />}
              />
            )}
            {/* NEW-1 — the SETBACK line, with the same three controls as the boundary above. It
                had none at all: colour, weight and dash were hardcoded at the one place it was
                drawn. Defaults match today's look exactly, so an existing plan is unchanged. */}
            <StdSubLabel>Setback line</StdSubLabel>
            <Field label="Line color">
              <ColorField value={toHex6(parcelStdValue("sbStroke") ?? PAL.setback)} title="Setback line color" seed={COLOR_SEED}
                {...colorCtl((v) => draftParcelStd({ sbStroke: v }), false)} />
            </Field>
            <Field label="Line weight">
              <NumInput style={numInput} value={parcelStdValue("sbWeight") ?? SETBACK_LINE.weight} min={0.25} step={0.25} coarse={2} onCommit={(n) => draftParcelStd({ sbWeight: n })} />
            </Field>
            <Field label="Line style">
              <select value={parcelStdValue("sbDash") ?? SETBACK_LINE.dash} onChange={(e) => draftParcelStd({ sbDash: e.target.value })}
                style={{ ...numInput, width: "auto", cursor: "pointer" }}>
                {DASH_OPTIONS}
              </select>
            </Field>
            {/* B721 cross-link (consistent with B164's placement): per-edge setbacks are a
                property of the parcel itself, not a global default — say so here so nobody hunts
                for a per-edge control on this panel. */}
            <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.5, margin: "6px 2px 2px" }}>Per-edge setbacks live on the parcel — select it on the canvas.</div>
          </Section>
          </div>

          {/* NEW-1 — MEASUREMENTS. Measurements are the only drawn object that had no standards at
              all: their colour was hardcoded at the one place they were painted. Same shape as the
              Parcels section above (draft-first reads, one footer Apply), same mechanic (stamped at
              creation via measureDefaultStyle), so a measurement is born with these and the footer's
              Apply pushes them onto measurements already drawn. */}
          <div data-std-sec="measure">
          <Section key={`std-measure:${standardsFocus === "measure"}`} title="Measurements" collapsed={standardsFocus !== "measure"}>
            <PairedFieldHead left="Line" right="Fill" />
            <PairedField label="Colour"
              left={<ColorField value={toHex6(measureStdValueUI("stroke") ?? PAL.accent)} title="Measurement line color" seed={COLOR_SEED} {...colorCtl((v) => draftMeasureStd({ stroke: v }), false)} />}
              right={measureStdValueUI("fill") ? <ColorField value={toHex6(measureStdValueUI("fill"))} title="Measurement fill color" seed={COLOR_SEED} {...colorCtl((v) => draftMeasureStd({ fill: v }), false)} /> : undefined}
            />
            <PairedField label="Width"
              left={<NumInput style={{ ...numInput, width: "100%" }} value={measureStdValueUI("weight") ?? MEASURE_LINE.weight} min={0.5} step={0.5} coarse={2} onCommit={(n) => draftMeasureStd({ weight: n })} />}
            />
            <PairedField label="Pattern"
              left={<select value={measureStdValueUI("dash") ?? MEASURE_LINE.dash} onChange={(e) => draftMeasureStd({ dash: e.target.value })} style={{ ...numInput, width: "100%", cursor: "pointer" }}>{DASH_OPTIONS}</select>}
            />
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, margin: "2px 2px 8px", cursor: "pointer" }}>
              <input type="checkbox" checked={!!measureStdValueUI("fill")} onChange={(e) => draftMeasureStd(e.target.checked ? { fill: PAL.accent } : { fill: null, fillOpacity: null })} /> Use a separate fill colour
            </label>
            <PairedField label="Opacity"
              right={<PercentField value={measureStdValueUI("fillOpacity") ?? MEASURE_LINE.fillOpacity} onCommit={(v) => draftMeasureStd({ fillOpacity: v })} inputStyle={numInput} ariaLabel="Fill opacity" />}
            />
            {/* NEW-2 — the project-level reveal zoom. Same one-click capture as the per-measurement
                control, so nobody ever types a zoom number. */}
            <StdSubLabel>Labels</StdSubLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "2px 2px 4px" }}>
              <button style={chip} title="Zoom to where you want measurement labels to start showing, then click this."
                onClick={() => draftMeasureStd({ labelPpf: view.ppf })}>Set at current zoom</button>
              {measureStdValueUI("labelPpf") != null && <button style={chip} onClick={() => draftMeasureStd({ labelPpf: null })}>Reset to default</button>}
            </div>
            <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.5, margin: "0 2px 2px" }}>
              {labelRevealNote({}, { measureStyle: { labelPpf: measureStdValueUI("labelPpf") } }, DIM_CALLOUT_MIN_PPF)}
            </div>
          </Section>
          </div>

          {/* Structural column grid (B568): speed bay + flex-to-band typical bays + dock doors.
              These are the plan-wide defaults; a single building can pin its own in its inspector. */}
          <div data-std-sec="building">
          <Section key={`std-building:${standardsFocus === "building"}`} title="Buildings — structural grid" collapsed={standardsFocus !== "building"}>
            <Field label="Speed bay (ft)"><NumInput style={numInput} value={settings.speedBay} min={1} onCommit={(n) => setSettings((s) => ({ ...s, speedBay: n }))} /></Field>
            <Field label="Typ. bay — length"><NumInput style={numInput} value={settings.bayLengthTarget} min={1} onCommit={(n) => setSettings((s) => ({ ...s, bayLengthTarget: n }))} /></Field>
            <Field label="Typ. bay — depth"><NumInput style={numInput} value={settings.bayDepthTarget} min={1} onCommit={(n) => setSettings((s) => ({ ...s, bayDepthTarget: n }))} /></Field>
            <Field label="Bay band (min / max)"><span style={{ display: "flex", gap: 5 }}><NumInput style={{ ...numInput, width: 42 }} value={settings.bayMin} min={1} onCommit={(n) => setSettings((s) => ({ ...s, bayMin: n }))} /> <NumInput style={{ ...numInput, width: 42 }} value={settings.bayMax} min={1} onCommit={(n) => setSettings((s) => ({ ...s, bayMax: n }))} /></span></Field>
            <Field label="Dock door — W / o.c."><span style={{ display: "flex", gap: 5 }}><NumInput style={{ ...numInput, width: 42 }} value={settings.doorWidth} min={1} onCommit={(n) => setSettings((s) => ({ ...s, doorWidth: n }))} /> <NumInput style={{ ...numInput, width: 42 }} value={settings.doorOC} min={2} onCommit={(n) => setSettings((s) => ({ ...s, doorOC: n }))} /></span></Field>
            <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.45, marginTop: 2 }}>Interior bays are sized evenly within the band toward the typical size, so the columns are uniformly spaced; the speed bay is pinned. The band is the allowed bay range.</div>
          </Section>
          </div>

          {/* NEW-1 — BUILDINGS: PROGRAM. Clear height & slab thickness by building size — the
              selected-building panel's CLEAR/SLAB fields (effectiveBuildingProps) come from this
              tier table, exactly the way the column-grid math above reads the structural-grid
              fields. (Also fed the printed buildings table, B197, and its per-building overrides
              list on the compose screen, until both were removed — B1804993.)
              Same direct-commit model as that sibling section (an edit
              here IS saved to this plan immediately — there is nothing to "Apply", since a
              building resolves its clear height/slab live, same as the grid); "Save for all
              projects" below additionally promotes it to the account, same button that already
              carries Parcels/Measurements/Colors. Per-building overrides live on the building
              itself (Properties → Structure) and always win — this table is the auto/default
              only, exactly like the grid's own per-building overrides. Shares the "building"
              focus key with the structural-grid section above so `jumpToStandards("building")`
              (the Properties-panel pointer, NEW-2) opens and scrolls to both together. */}
          <div data-std-sec="building">
          {(() => {
            const tinyNum = { ...numInput, width: 68, padding: "4px 7px", fontSize: 11.5 };
            const valNum = { ...numInput, width: 46, padding: "4px 7px", fontSize: 11.5 };
            const moveBtn = (on) => ({ width: 16, height: 13, padding: 0, display: "grid", placeItems: "center", fontSize: 8, lineHeight: 1, border: BORDER_1, borderRadius: 3, background: SURF_RAISED, fontFamily: "inherit", cursor: on ? "pointer" : "default", color: on ? PAL.ink : "#cfc7b5", opacity: on ? 1 : 0.5 });
            // Order is COSMETIC ONLY (evalTier resolves the smallest qualifying threshold
            // regardless of array position — see buildingProps.js) — ▲▼ let the owner arrange
            // rows for readability without any risk of changing which tier a size resolves to.
            const tierRow = (key, t, i, unit, count) => (
              <div key={`${key}${i}`} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 2px", fontSize: 11.5, color: PAL.ink }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <button title="Move up" disabled={i === 0} onClick={() => moveRuleTier(key, i, -1)} style={moveBtn(i > 0)}>▲</button>
                  <button title="Move down" disabled={i === count - 1} onClick={() => moveRuleTier(key, i, 1)} style={moveBtn(i < count - 1)}>▼</button>
                </span>
                {t.upTo != null ? (
                  <><span style={{ color: PAL.muted }}>under</span><NumInput style={tinyNum} value={t.upTo} min={1} onCommit={(n) => setRuleTier(key, i, "upTo", n)} /><span style={{ color: PAL.muted }}>SF</span></>
                ) : (
                  <span style={{ color: PAL.muted, flex: "0 0 auto" }}>{maxFiniteUpTo(buildingRules[key]) != null ? `${maxFiniteUpTo(buildingRules[key]).toLocaleString()} SF & above` : "and above"}</span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ color: PAL.muted }}>→</span>
                <NumInput style={valNum} value={t.value} min={1} onCommit={(n) => setRuleTier(key, i, "value", n)} /><span style={{ color: PAL.muted, width: 16 }}>{unit}</span>
                <button title="Remove this tier" disabled={count <= 1} onClick={() => removeRuleTier(key, i)} style={{ ...chip, padding: "2px 6px", fontSize: 10, opacity: count <= 1 ? 0.4 : 1 }}>✕</button>
              </div>
            );
            return (
              <Section key={`std-buildingprogram:${standardsFocus === "building"}`} title="Buildings — program" collapsed={standardsFocus !== "building"}>
                <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.45, margin: "0 2px 8px" }}>
                  A building steps up automatically when it crosses a threshold below, unless it's been overridden on that building itself.
                </div>
                <StdSubLabel>Clear height (ft)</StdSubLabel>
                {buildingRules.clearHeight.map((t, i) => tierRow("clearHeight", t, i, "ft", buildingRules.clearHeight.length))}
                <button style={{ ...chip, fontSize: 11, padding: "4px 8px", marginTop: 3 }} onClick={() => addRuleTier("clearHeight")}>+ Add tier</button>
                <StdSubLabel>Slab thickness (in)</StdSubLabel>
                {buildingRules.slab.map((t, i) => tierRow("slab", t, i, "in", buildingRules.slab.length))}
                <button style={{ ...chip, fontSize: 11, padding: "4px 8px", marginTop: 3 }} onClick={() => addRuleTier("slab")}>+ Add tier</button>
                <button style={{ ...chip, width: "100%", marginTop: 10, fontSize: 11.5, padding: "5px 8px" }} onClick={resetBuildingRules}>Reset to defaults</button>
              </Section>
            );
          })()}
          </div>

          <div data-std-sec="parking">
          <Section key={`std-parking:${standardsFocus === "parking"}`} title="Parking" collapsed={standardsFocus !== "parking"}>
            <Field label="Stall W / D"><span style={{ display: "flex", gap: 5 }}><NumInput style={{ ...numInput, width: 42 }} value={settings.stallW} min={1} onCommit={(n) => setSettings((s) => ({ ...s, stallW: n }))} /> <NumInput style={{ ...numInput, width: 42 }} value={settings.stallDepth} min={1} onCommit={(n) => setSettings((s) => ({ ...s, stallDepth: n }))} /></span></Field>
            <Field label="Drive aisle"><NumInput style={numInput} value={settings.aisle} min={1} onCommit={(n) => setSettings((s) => ({ ...s, aisle: n }))} /></Field>
            <Field label="Park angle"><select style={{ ...numInput, width: 58 }} value={settings.parkAngle} onChange={(e) => setSettings((s) => ({ ...s, parkAngle: +e.target.value }))}><option value={90}>90°</option><option value={60}>60°</option><option value={45}>45°</option></select></Field>
          </Section>
          </div>

          <div data-std-sec="trailers">
          <Section key={`std-trailers:${standardsFocus === "trailers"}`} title="Trailers" collapsed={standardsFocus !== "trailers"}>
            <Field label="Trailer W / L"><span style={{ display: "flex", gap: 5 }}><NumInput style={{ ...numInput, width: 42 }} value={settings.trailerW} min={1} onCommit={(n) => setSettings((s) => ({ ...s, trailerW: n }))} /> <NumInput style={{ ...numInput, width: 42 }} value={settings.trailerL} min={1} onCommit={(n) => setSettings((s) => ({ ...s, trailerL: n }))} /></span></Field>
            <Field label="Trailer aisle"><NumInput style={numInput} value={settings.trailerAisle} min={0} onCommit={(n) => setSettings((s) => ({ ...s, trailerAisle: n }))} /></Field>
          </Section>

          </div>

          {/* Default depths for the building-anchored dock-zone stack (B228), outward from
              the dock face. Editable per plan — the building "+" reads these. */}
          <div data-std-sec="dockzones">
          <Section key={`std-dockzones:${standardsFocus === "dockzones"}`} title="Dock zones" collapsed={standardsFocus !== "dockzones"}>
            <Field label="Truck court (ft)"><NumInput style={numInput} value={settings.truckCourtD ?? 135} min={1} onCommit={(n) => setSettings((s) => ({ ...s, truckCourtD: n }))} /></Field>
            <Field label="Trailer parking (ft)"><NumInput style={numInput} value={settings.trailerParkD ?? 50} min={1} onCommit={(n) => setSettings((s) => ({ ...s, trailerParkD: n }))} /></Field>
            <Field label="Buffer (ft)"><NumInput style={numInput} value={settings.bufferD ?? 15} min={1} onCommit={(n) => setSettings((s) => ({ ...s, bufferD: n }))} /></Field>
            <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.4, marginTop: 2 }}>Outward from the dock face: truck court → trailer parking → buffer. New zones use these depths; each is still editable per building.</div>
          </Section>
          </div>

          {/* B825 — the grading-standards registry, read-only reference: per-surface-class
              slope limits with their cites (lib/gradingRules.js). The ADA/TAS cap is a LEGAL
              requirement and renders with the danger token — never a stylistic note. Values
              are consumed by the future B826 proposed-surface engine; per-element overrides
              ride each element's gradeOverride when that engine lands. */}
          <div data-std-sec="grading">
          <Section key={`std-grading:${standardsFocus === "grading"}`} title="Grading standards" collapsed={standardsFocus !== "grading"}>
            {Object.values(GRADING_RULES).map((gr) => (
              <div key={gr.id}
                title={`${gr.appliesTo}. ${gr.basis === "published" ? `${gr.source?.name || "Published"} — ${gr.source?.section || ""}${gr.sourceDate ? ` (checked ${gr.sourceDate})` : ""}` : "Planyr screening convention — not a published standard; verify with your civil engineer."} ${gr.note}`}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "3px 0", borderBottom: `1px solid ${PAL.panelLine}`, cursor: "help" }}>
                <span style={{ fontSize: 11.5, color: PAL.ink }}>
                  {gr.label}
                  {gr.legalClass && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", color: PAL.danger, border: `1px solid ${PAL.danger}`, borderRadius: 4, padding: "0 4px" }} title="Legal requirement (ADA/TAS) — violations are legal, not stylistic">LEGAL</span>}
                  <span style={{ fontSize: 9.5, color: PAL.muted, marginLeft: 4 }} aria-hidden="true">ⓘ</span>
                </span>
                <span style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontSize: 11, color: gr.legalClass ? PAL.danger : PAL.ink, fontWeight: 650, whiteSpace: "nowrap" }}>{gradingChipLabel(gr)}</span>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.45, marginTop: 4 }}>
              Reference values for the grading concept (screening). Published rows carry their cite in the ⓘ; convention rows are Planyr screening conventions, never implied-published. The proposed-surface engine (B826) will grade to these.
            </div>
          </Section>
          </div>

          <div data-std-sec="roads">
          <Section key={`std-roads:${standardsFocus === "roads"}`} title="Roads" collapsed={standardsFocus !== "roads"}>
            <Field label="Curb width (ft)"><NumInput style={numInput} value={settings.roadCurb ?? 0.5} min={0} onCommit={(n) => setSettings((s) => ({ ...s, roadCurb: n }))} /></Field>
            <Field label="Road widths (ft)">
              <input {...NO_AUTOFILL} style={{ ...numInput, width: 150 }} value={settings.roadWidths ?? "24, 26, 30, 36, 40"}
                onChange={(e) => setSettings((s) => ({ ...s, roadWidths: e.target.value }))} />
            </Field>
            {/* Road classes — civil defaults + min-radius warning thresholds (B599/NEW-4). */}
            {(() => {
              const setRCC = (key, patch) => setSettings((s) => {
                const list = (Array.isArray(s.roadClasses) && s.roadClasses.length ? s.roadClasses : ROAD_CLASS_SEEDS).map((c) => ({ ...c }));
                const i = list.findIndex((c) => c.key === key);
                if (i >= 0) list[i] = { ...list[i], ...patch };
                return { ...s, roadClasses: list };
              });
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "2px 0 4px" }}>Road classes — civil defaults</div>
                  <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.4, marginBottom: 6 }}>Default curve radius for new vertices + a min-radius warning per class. Seeds are starting points — verify against current AASHTO / the adopted fire code; nothing here is authoritative.</div>
                  {roadClassesOf(settings).map((c) => (
                    <div key={c.key} style={{ marginBottom: 7 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: PAL.ink, marginBottom: 2 }}>{c.label}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <label style={{ fontSize: 10.5, color: PAL.muted, display: "flex", alignItems: "center", gap: 4 }}>Default R <NumInput style={{ ...numInput, width: 54 }} value={Math.round(c.defaultRadius ?? 50)} min={1} onCommit={(n) => setRCC(c.key, { defaultRadius: n })} /></label>
                        {c.designSpeed != null ? (
                          <label style={{ fontSize: 10.5, color: PAL.muted, display: "flex", alignItems: "center", gap: 4 }}>Design mph <NumInput style={{ ...numInput, width: 48 }} value={Math.round(c.designSpeed)} min={0} onCommit={(n) => setRCC(c.key, { designSpeed: n })} /></label>
                        ) : (
                          <label style={{ fontSize: 10.5, color: PAL.muted, display: "flex", alignItems: "center", gap: 4 }}>Warn below R <NumInput style={{ ...numInput, width: 54 }} value={Math.round(c.minRadius ?? 0)} min={0} onCommit={(n) => setRCC(c.key, { minRadius: n })} /></label>
                        )}
                        <span style={{ fontSize: 10.5, color: PAL.muted }}>= {f0(classMinRadius(c))}′ min</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Section>

          </div>

          {/* element default colors — edit without selecting anything */}
          <div data-std-sec="colors">
          <Section key={`std-colors:${standardsFocus === "colors"}`} title="Colors" collapsed={standardsFocus !== "colors"}>
            {Object.keys(TYPE).map((k) => {
              const st = typeStyle(k, settings);
              return (
                <div key={k} style={{ marginBottom: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ flex: 1, fontSize: 12, color: PAL.ink, minWidth: 90 }}>{TYPE[k].label.split(" / ")[0]}</span>
                    {/* NEW-2 — draft edits. The canvas still previews them live (typeStyle reads
                        the draft's preview layer), but nothing is stored until a footer action. */}
                    <ColorField title="Fill" value={toHex6(st.fill)} seed={COLOR_SEED} style={{ width: 30, height: 24 }}
                      {...colorCtl((v) => draftTypeStd(k, { fill: v }), false)} />
                    <ColorField title="Line" value={toHex6(st.stroke)} seed={COLOR_SEED} style={{ width: 30, height: 24 }}
                      {...colorCtl((v) => draftTypeStd(k, { stroke: v }), false)} />
                    {/* NEW-8 — the type's default OUTLINE opacity and width, beside its two colours. */}
                    <NumInput style={{ ...numInput, width: 44 }} ariaLabel={`${TYPE[k].label.split(" / ")[0]} outline opacity (%)`} value={Math.round((st.strokeOpacity ?? 1) * 100)} min={0} max={100} step={5}
                      onCommit={(n) => draftTypeStd(k, { strokeOpacity: Math.max(0, Math.min(100, Math.round(n))) / 100 })} />
                    <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>%</span>
                    <NumInput style={{ ...numInput, width: 44 }} ariaLabel={`${TYPE[k].label.split(" / ")[0]} line weight`} value={st.strokeWidth ?? st.weight ?? 1} min={0.5} max={12} step={0.5} coarse={2}
                      onCommit={(n) => draftTypeStd(k, { strokeWidth: Math.max(0.5, Math.min(12, n)) })} />
                  </div>
                </div>
              );
            })}
            {/* NEW-2 — a reset is a draft edit like any other (a null per key = "clear it"), so it
                previews immediately but still goes through one of the footer's three actions. */}
            <button style={{ ...chip, marginTop: 4, color: PAL.accent }}
              onClick={() => setStdDraft({ ...stdDraft, typeStyles: Object.fromEntries(Object.keys(TYPE).map((t) => [t, { fill: null, stroke: null, strokeOpacity: null, strokeWidth: null }])) })}>Reset all to built-in</button>
          </Section>
          </div>

          </>)}
  </>);
});
