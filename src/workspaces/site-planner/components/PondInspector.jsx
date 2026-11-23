/* @planner-extract — the pond block of the Properties inspector (audit batch G5, behaviour-identical move).
 * Was an IIFE inside SitePlanner.jsx; now a module-scope memoized component (MODULE-SCOPE-COMPONENTS).
 * Everything it reads from the planner arrives as a prop; it never imports back from SitePlanner.jsx. */
import { Fragment, Suspense, memo } from "react";
import ColorField from "../../../shared/ui/ColorField.jsx";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { TYPE, toHex6 } from "../lib/planStyle.js";
import { ringsOverlap } from "../lib/metesAndBounds.js";
import SourceTag from "./SourceTag.jsx";
import ActionLink from "./ActionLink.jsx";
import WatchOutChip from "./WatchOutChip.jsx";
import Collapse from "./Collapse.jsx";
import Chip from "../../../shared/ui/Chip.jsx";
import RowInfo from "../../../shared/ui/RowInfo.jsx";
import { pondInspectorChips, POND_CHIP_DEFS, pondGroupSummary, POND_FLOOD_NOTES, POND_PURPOSE_TOOLTIP, POND_PURPOSE_DESCRIPTOR } from "../lib/pondInspectorCopy.js";
import { buildingNumbers } from "../lib/siteModel.js";
import { SQFT_PER_ACRE, elCorners, ringOf } from "../lib/siteGeometry.js";
import { pointInRing } from "../lib/ringMath.js";
import { autoContourInterval, detentionStorage, usablePondVolume, drawdownWarning, bermAsFillHeight } from "../lib/pondGeom.js";
import { effectivePondRole, POND_ROLE_LABEL, pondDisplayName } from "../lib/pondLedger.js";
import { detentionVerdict, mitigationVerdict } from "../lib/pondVerdict.js";
import { ringsArea } from "../lib/pondOffset.js";
import { pondScreeningGuards } from "../lib/pondScreeningGuards.js";
import { inwardBermSplit, EXT_BERM_SLOPE } from "../lib/inwardBerm.js";
import { pondFloodplainTier, effectivePadElev, isEstimatedWseSrc } from "../lib/floodplainMitigation.js";
import { checkPondCriteria } from "../lib/pondCriteriaRules.js";
import { sizePondForTargets, scaleRing } from "../lib/pondSizing.js";
import { makeItBuildableOptions, requirementNote, DEFAULT_MAX_EXCAV_DEPTH_FT } from "../lib/buildableEnvelope.js";
import { estDepthToWaterFt, estMaxExcavDepthFt, poolRelevantForRole } from "../lib/pondScreeningDefaults.js";
import { tailwaterNote } from "../lib/tailwaterSource.js";
import { pondGroundwaterScreen } from "../lib/groundwater.js";
import { subsidenceFlag } from "../lib/subsidence.js";
import { pumpAllowance } from "../lib/detentionCriteria.js";
import { selectDetentionMethod } from "../lib/detentionMethod.js";
import { computeTimeOfConcentration } from "../lib/timeOfConcentration.js";
import { outletProblems } from "../lib/outletStructure.js";
import { assessRoutedDetention, suggestedPreDevReleaseCfs, autoSizeCompoundOutlet } from "../lib/pondRouting.js";
import { regionalDetentionFor, feeInLieuCompare } from "../lib/regionalDetention.js";
import { optimizeAffordance, materialAlternative } from "../lib/pondOptimizeAffordance.js";
import { solvePondExpansion, solvePondDepth, pondDefaultsFor, deadStoragePoolDepthFt, computeRateBasedDetention, DESIGN_STORM_PERIODS } from "../lib/detentionRules.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { CF_PER_ACFT } from "../../../shared/units/areaUnits.js";
import { commaInt as f0, commaDec1 as f1, commaDec2 as f2 } from "../../../shared/units/numberFormat.js";
import { PondSection, ROWB6, SURF_RAISED } from "../lib/plannerShared.js";
import { POND_ADD_FILL_DEFAULT } from "../lib/planRenderHelpers.jsx";
import { NumInput } from "./NumInput.jsx";
import { DesignChangeSummaryCard, ProvenanceLegend } from "./YieldDrainagePanels.jsx";
import { COLOR_SEED, polySelfIntersects, ROW6, expandPolygon } from "../lib/plannerConstants.js";
import { Field, PairedField, PairedFieldHead } from "./PropFields.jsx";

export const PondInspector = memo(function PondInspector({
  PAL,
  acresActive,
  applyBermMove,
  assessPondBuildable,
  chip,
  chipSm,
  clearElStyle,
  coincidentStorm,
  colorCtl,
  critAll,
  curStyle,
  deleteSel,
  designChangeSummary,
  detRegime,
  detReq,
  detWithAuto,
  dismissHybridHint,
  drainAuthorityId,
  drainBalancer,
  drainCtxData,
  drainFacts,
  drainMitDisplay,
  els,
  fillOpacityCell,
  flashWarn,
  floodJurKey,
  fmElev,
  fmResultView,
  fmRule,
  fmSettings,
  fmZones,
  hybridHintSeen,
  impPct,
  jumpToStandards,
  linkBtn,
  numInput,
  parcels,
  pondAuto,
  pondBermById,
  pondCriteria,
  pondEncumbrances,
  pondLedger,
  pondSplitFor,
  pondTailwaterResult,
  providedDetCf,
  providedUsableCf,
  pushHistory,
  rightSizeResultFor,
  sectionFactsFor,
  selEl,
  setDesignChangeSummary,
  setSelEl,
  setStyleDefault,
  settings,
  spinBtn,
  strokeOpacityCell,
  strokeWidthRow,
  toggleLock,
  undo,
}) {
                const det = selEl.det || {};
                // B822 — the effective values: manual wins, else the criteria/terrain autos
                // (pondAuto — provenance-carrying), else the old screening defaults.
                const depth = det.depth ?? 8, fb = det.freeboard ?? pondAuto.freeboard.value, slope = det.slope ?? pondAuto.slope.value;
                const tobEff = det.tobElev ?? (pondAuto.tobElev ? pondAuto.tobElev.value : null);
                const ring = selEl.points ? selEl.points : elCorners(selEl);
                const r = detentionStorage(ring, depth, fb, slope);
                // B822 layer (c) — the per-pond AUTO depth: the smallest depth closing the
                // site's REMAINING deficit (B640 solver), offered as a one-click apply (an
                // implicit depth would feed back into the provided volume it solves against).
                const depthSolve = (() => {
                  if (det.depth != null) return null; // manual depth — nothing to suggest
                  if (!detReq || detReq.kind !== "point" || !(detReq.requiredAcFt > 0)) return null;
                  const otherCf = Math.max(0, providedDetCf - r.vol);
                  const targetCf = detReq.requiredAcFt * CF_PER_ACFT - otherCf;
                  if (!(targetCf > 0)) return null;
                  return solvePondDepth({
                    requiredCf: targetCf,
                    volumeAtDepth: (dft) => detentionStorage(ring, dft, fb, slope),
                    startDepthFt: 2,
                  });
                })();
                const setDet = (patch) => { pushHistory(); setSelEl({ det: { depth, freeboard: fb, slope, ...det, ...patch } }); };
                const setDetLive = (patch) => setSelEl({ det: { depth, freeboard: fb, slope, ...det, ...patch } }); // B567: no-history sibling for live color picking
                // --- Expand this pond (B139): baseline + steppers; both steppers and free
                // drag feed the one Existing→Proposed readout. Baseline freezes the original
                // footprint + depth/slope so the delta is apples-to-apples. ---
                const base = det.baseline, inMode = !!base;
                const snapshotGeom = () => selEl.points ? { points: selEl.points.map((p) => ({ x: p.x, y: p.y })) } : { w: selEl.w, h: selEl.h, cx: selEl.cx, cy: selEl.cy, rot: selEl.rot };
                const startExpand = () => {
                  pushHistory();
                  setSelEl({ det: { ...det, depth, freeboard: fb, slope, expandFt: 0, baseline: { ring: ring.map((p) => ({ x: p.x, y: p.y })), geom: snapshotGeom(), depth, freeboard: fb, slope } } });
                  flashWarn("Expanding this pond — push the banks out or dig deeper, and watch the storage gained.", 4500);
                };
                const pushBanksOut = (n) => {
                  const N = Math.max(0, Math.round(n));
                  if (base.geom.points) {
                    const grown = N > 0 ? expandPolygon(base.geom.points, N) : base.geom.points.map((p) => ({ x: p.x, y: p.y }));
                    if (!grown || polySelfIntersects(grown)) { flashWarn("Can't push the banks out cleanly on this shape — the corners would cross. Drag the pond's edges on the map instead.", 6000); return; }
                    pushHistory();
                    setSelEl({ points: grown, det: { ...det, expandFt: N } });
                  } else {
                    pushHistory();
                    setSelEl({ w: base.geom.w + 2 * N, h: base.geom.h + 2 * N, cx: base.geom.cx, cy: base.geom.cy, rot: base.geom.rot, det: { ...det, expandFt: N } });
                  }
                };
                const digDeeper = (m) => setDet({ depth: base.depth + Math.max(0, Math.round(m)) });
                const resetExisting = () => {
                  pushHistory();
                  const g = base.geom.points ? { points: base.geom.points.map((p) => ({ x: p.x, y: p.y })) } : { w: base.geom.w, h: base.geom.h, cx: base.geom.cx, cy: base.geom.cy, rot: base.geom.rot };
                  setSelEl({ ...g, det: { ...det, depth: base.depth, freeboard: base.freeboard, slope: base.slope, expandFt: 0 } });
                };
                const doneExpand = () => { pushHistory(); const { baseline, expandFt, ...rest } = det; setSelEl({ det: rest }); flashWarn("Expansion kept — the pond now uses its new size everywhere.", 3500); };
                const stepRow = (label, val, step, apply) => (
                  <Field label={label}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <button style={{ ...spinBtn, width: 22, height: 22, fontSize: 13 }} onClick={() => apply(val - step)} title={`−${step} ft`}>−</button>
                      <NumInput style={{ ...numInput, width: 52, textAlign: "center" }} value={val} min={0} onCommit={(v) => apply(v)} />
                      <button style={{ ...spinBtn, width: 22, height: 22, fontSize: 13 }} onClick={() => apply(val + step)} title={`+${step} ft`}>＋</button>
                    </span>
                  </Field>
                );
                // B895 — `tag` is an optional { code, basis } SourceTag for this row's figure.
                const pondRow = (label, val, tag) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0", gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: PAL.muted }}>{label}</span>
                    <span style={ROWB6}>
                      <span style={{ fontFamily: NUM_FONT, fontSize: 12.5, color: PAL.ink, fontWeight: 650, fontVariantNumeric: TABULAR_NUMS }}>{val}</span>
                      {tag ? <SourceTag code={tag.code} label={label} basis={tag.basis} /> : null}
                    </span>
                  </div>
                );
                // B909 round 2 (owner correction, live test) — the pond inspector used to
                // open on a wall of technical fields with no plain-English orientation: a
                // user had no way to tell, at a glance, whether THIS pond was actually
                // doing its job. One status line up top says so directly, in the same
                // terms the Yield panel's cards use ("required detention" / "required
                // floodplain mitigation"), and — per the same correction — never claims a
                // requirement is met when that requirement is actually zero.
                // v3 UI SPEC B2 — the STATUS CARD is the ONE place in this panel the
                // provided/required pair is stated (G1). Detention always; mitigation only when
                // its requirement rounds above zero. Each card: SHORT (red) / OK (green), a
                // one-line "P of R ac-ft required" heading, an optional plain-English body, and
                // the ⚡ Optimize pond button when short. Presentation only — the numbers are the
                // same site provided/required the Yield verdict shows.
                // NEW-1 — the two REQUIREMENT figures are hoisted out of the statusCards IIFE because
                // the optimizer affordance below needs the same numbers. They must not be re-derived
                // separately: the whole point of NEW-1 is that the button and the cards read ONE
                // source, so the button can never again depend on what the cards happen to look like.
                // E2(a) — a requirement that ROUNDS TO 0 at the 1dp we display is treated as absent
                // (a "of 0.0 ac-ft required" card is meaningless). Floor 0.05 ac-ft, aligned with f1.
                const sc_detReqRaw = detReq && detReq.kind === "point" && detReq.requiredAcFt > 0 ? detReq.requiredAcFt
                  : detReq && detReq.kind === "band" ? detReq.bandAcFt[1] : null;
                const sc_detReqAcFt = sc_detReqRaw != null && sc_detReqRaw >= 0.05 ? sc_detReqRaw : null;
                const sc_mitReqAcFt = drainMitDisplay && drainMitDisplay.volumeCf > 0 && drainMitDisplay.volumeAcFt >= 0.05 ? drainMitDisplay.volumeAcFt : null;
                const statusCards = (() => {
                  const split = pondSplitFor(selEl);
                  const thisHoldsAcFt = r.vol / CF_PER_ACFT;
                  const thisInundated = !!(split.mode === "anchored" && split.bands && split.bands.fullyInundated);
                  const floodLevel = split.mode === "anchored" && split.wseFt != null ? split.wseFt : null;
                  const floodEst = !!(split.mode === "anchored" && isEstimatedWseSrc(split.wseSrc));
                  // E2(a) — the requirement floor is applied once, above (sc_detReqAcFt/sc_mitReqAcFt).
                  const detReqAcFt = sc_detReqAcFt;
                  const mitReqAcFt = sc_mitReqAcFt;
                  const out = [];
                  if (detReqAcFt != null && providedUsableCf != null) {
                    const provAcFt = providedUsableCf / CF_PER_ACFT;
                    const short = provAcFt < detReqAcFt - 0.005;
                    // PR-K — GREEN "Buildable" requires (1) the volume met, (2) no HARD envelope limit
                    // broken (rim above the drainage cap, outlet below the 100-yr receiving water), and
                    // (3) no outstanding REQUIREMENT. The floodway is now case (3): a mapped regulatory
                    // floodway lets the pond berm WITH a no-rise certification, so it's buildable but the
                    // verdict stays amber (naming the no-rise study) until that's provided — never the old
                    // flat "no fill". Zone A / AE fringe fill is compensating-storage debt (the mitigation
                    // ledger), not a verdict block, so those ponds can read green once the volume is met.
                    const bld = assessPondBuildable(selEl);
                    const inFloodway = pondFloodplainTier(ring, fmZones).inFloodway;
                    const hardBlocked = !bld.buildable;                 // drainage cap / outfall-tailwater
                    const needsNoRise = bld.requirements.length > 0;    // floodway berm → no-rise cert
                    const hardReasons = bld.hard.map((h) => h.label).join(" ");
                    const reqReasons = requirementNote({ requirements: bld.requirements });
                    const body = short && thisInundated && floodLevel != null && !hardBlocked
                      ? `The basin sits below the flood level (${f1(floodLevel)}′${floodEst ? " est." : ""}), so its ${f1(thisHoldsAcFt)} AC-FT don't count. Raising the rim creates storage that does.${inFloodway ? " Berming inside a mapped regulatory floodway needs a no-rise certification (an engineering study showing the berm adds zero rise to the 100-yr flood level)." : ""}`
                      : hardBlocked
                        ? `${hardReasons} ${makeItBuildableOptions({})}${needsNoRise ? ` ${reqReasons}` : ""}`.trim()
                        : needsNoRise
                          ? reqReasons
                          : "";
                    // I5 — the HEADLINE states the outcome; the achieved-vs-required figure is its OWN
                    // styled sub-line (never a wrapped dangling parenthesis). Every card carries both.
                    // NEW-1/NEW-2 — the strings now come from the ONE pure derivation
                    // (lib/pondVerdict.js): the heading NAMES this row's ledger ("Detention covered" /
                    // "Detention short 4.6 ac-ft" / "Detention not achievable here") instead of
                    // headlining the BUILDABILITY answer over a VOLUME sub-line, and buildability is
                    // demoted (never deleted) to the card's qualifier line. The over-provision state
                    // rides the same qualifier slot. `body` (the flood-level / make-it-buildable gloss)
                    // is unchanged and still renders underneath.
                    const vSlack = (() => {
                      // NEW-2 — the over-provision threshold is CRITERIA-CONFIGURABLE (the
                      // screeningPondDepthFt precedent), never an inline constant here.
                      const cx = critAll;
                      return { slackAcFt: cx.overdugSlackAcFt?.value, slackPct: cx.overdugSlackPct?.value };
                    })();
                    const earthPerCyRaw = (settings.prices || {}).earthworkCy;
                    const earthPerCy = earthPerCyRaw == null || earthPerCyRaw === "" || !Number.isFinite(+earthPerCyRaw) ? null : +earthPerCyRaw;
                    const dv = detentionVerdict({
                      providedAcFt: provAcFt,
                      requiredAcFt: detReqAcFt,
                      hardBlocked,
                      needsNoRise,
                      slack: vSlack,
                      earthPerCy,
                    });
                    out.push({ ...dv, body });
                  }
                  if (mitReqAcFt != null && pondLedger.creditedMitCf != null) {
                    const provMitAcFt = pondLedger.creditedMitCf / CF_PER_ACFT;
                    out.push({ ...mitigationVerdict({ providedAcFt: provMitAcFt, requiredAcFt: mitReqAcFt }), body: "" });
                  }
                  return out;
                })();
                // FINAL UI SPEC Part A — the condensed inspector's top-of-panel facts (the
                // "At a glance" table + the watch-out chips) come off ONE computation, reusing
                // the SAME pure helpers the detailed groups below use, so nothing can disagree.
                // Presentation only — no value / threshold / solver change.
                const g_split = pondSplitFor(selEl);
                const g_critRule = pondCriteria[floodJurKey] || pondCriteria.generic;
                // D2 — INWARD berm split: the drawn footprint is the FIXED land take; a rim above
                // grade fills a berm ring INSIDE it, so the water surface shrinks. Water + berm ring
                // always sum to the drawn footprint (nothing is ever computed outside it).
                const g_gradeFt = Number.isFinite(fmElev.existGradeFt) ? fmElev.existGradeFt : null;
                const g_bermH = g_gradeFt != null && Number.isFinite(det.tobElev) && det.tobElev > g_gradeFt + 0.02 ? det.tobElev - g_gradeFt : 0;
                const g_inward = inwardBermSplit(ring, g_bermH, { extSlope: EXT_BERM_SLOPE });
                const g_footprintSf = g_inward.footprintSf;      // FIXED drawn footprint = land take
                const g_waterSf = g_bermH > 0 ? g_inward.waterSf : g_footprintSf; // shrinking water surface
                const g_bermRingSf = g_inward.bermRingSf;        // interior berm ring (0 with no berm)
                const g_holdsAcFt = (g_split && g_split.grossCf != null ? g_split.grossCf : r.vol) / CF_PER_ACFT;
                const g_roleInfo = effectivePondRole(det, g_split);
                // PR-I (I1) — COMPUTE, don't interrogate: every engineering criterion the developer
                // can't know gets a pre-filled screening ESTIMATE from data the app already holds, so
                // no input box is ever an empty blank demanding expertise. Shown pre-filled + EST tag;
                // the developer's typed value always overrides. These feed the same PR-H envelope (I6).
                const g_wseForTw = g_split.mode === "anchored" && Number.isFinite(g_split.wseFt) ? g_split.wseFt : null;
                const g_dtwEst = estDepthToWaterFt({ measuredFt: det.depthToWaterFt });         // depth to water (ft below grade)
                const g_twEst = pondTailwaterResult(selEl, g_gradeFt);   // PR-N/O5 — channel tailwater ladder (never grade)
                const g_maxExcavEst = estMaxExcavDepthFt({ depthToWaterFt: g_dtwEst.valueFt });  // don't dig below groundwater
                const g_poolRelevant = poolRelevantForRole(g_roleInfo.role);                    // permanent pool only for wet ponds
                const estPillStyle = { fontSize: 9.5, color: PAL.muted, fontWeight: 700, letterSpacing: "0.04em", border: `1px solid ${PAL.panelLine}`, borderRadius: 4, padding: "1px 4px", whiteSpace: "nowrap", cursor: "help" };
                // PR-K — the "In floodway" watch-out now keys off the PRECISE floodway tier (a mapped
                // ZONE_SUBTY = "FLOODWAY" polygon), not the broad 1% trigger. Approximate Zone A gets
                // its own "BFE study required" chip. The 1% fringe (Zone AE outside a floodway) shows
                // neither — its compensating-storage debt lives in the mitigation card, not a chip.
                const g_tier = pondFloodplainTier(ring, fmZones);
                const g_facts = {
                  floodEstimated: g_split.mode === "anchored" && isEstimatedWseSrc(g_split.wseSrc),
                  rimBelowFlood: !!(g_split.mode === "anchored" && g_split.bands && g_split.bands.fullyInundated),
                  criteriaUnverified: !!(g_critRule && g_critRule.verified === false),
                  inFloodway: g_tier.inFloodway,
                  zoneA: g_tier.zoneA,
                };
                const g_chips = pondInspectorChips(g_facts);
                const g_chipRow = g_chips.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 2px" }}>
                    {g_chips.map((c) => <Chip key={c.id} tone={c.tone} text={c.text} popover={c.popover} />)}
                  </div>
                );
                // v3 UI SPEC B3 — DIMENSIONS rows (label left, value right, bold tabular; value+
                // unit nowrap G3). Provenance tags are quiet outlined chips (G7) whose definition
                // rides a hover title; sf/cf conversions live ONLY in the value's hover title (G4).
                // The geometry-help ⓘ moved to the header (B1).
                const provTag = (label, title) => (
                  <span title={title} style={{ flex: "none", display: "inline-block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", lineHeight: 1.5, borderRadius: 4, padding: "1.5px 5px", whiteSpace: "nowrap", color: PAL.muted, border: `1px solid ${PAL.border}`, cursor: "help" }}>{label}</span>
                );
                const g_glanceRow = (label, value, info, valueTitle) => (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${PAL.panelLine}`, minHeight: 26 }}>
                    <span style={{ fontSize: 11.5, color: PAL.muted, display: "inline-flex", alignItems: "center", gap: 3 }}>{label}{info ? <RowInfo label={typeof label === "string" ? label : "Pond"} sections={[{ text: info }]} /> : null}</span>
                    <span title={valueTitle || undefined} style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", cursor: valueTitle ? "help" : undefined }}>{value}</span>
                  </div>
                );
                const g_glanceNum = (s) => <span style={{ fontFamily: NUM_FONT, fontSize: 12.5, color: PAL.ink, fontWeight: 650, fontVariantNumeric: TABULAR_NUMS, whiteSpace: "nowrap" }}>{s}</span>;
                const g_purposeBtn = (v, label, tip) => {
                  const active = v === null ? g_roleInfo.source === "auto" : g_roleInfo.source === "owner" && det.role === v;
                  return (
                    <button key={String(v)} title={tip} style={{ ...chip, flex: "0 0 auto", padding: "3px 7px", fontSize: 10, ...(active ? { background: PAL.accent, color: "var(--on-accent)", borderColor: PAL.accent } : null) }}
                      onClick={() => setDet({ role: v })}>{label}</button>
                  );
                };
                const g_grade = Number.isFinite(fmElev.existGradeFt) ? fmElev.existGradeFt : null;
                const g_rim = tobEff;
                const g_rimVsGrade = g_rim != null && g_grade != null ? g_rim - g_grade : null;
                const g_floodLevel = g_split.mode === "anchored" && g_split.wseFt != null ? g_split.wseFt : null;
                const g_rimText = g_rim == null ? "not set"
                  : g_rimVsGrade == null ? `${f1(g_rim)}′ NAVD88`
                  : Math.abs(g_rimVsGrade) < 0.05 ? "at grade"
                  : g_rimVsGrade > 0 ? `+${f1(g_rimVsGrade)} ft above grade`
                  : `−${f1(Math.abs(g_rimVsGrade))} ft below grade`;
                const g_purposeDescriptor = g_roleInfo.source === "auto" ? POND_PURPOSE_DESCRIPTOR.auto
                  : POND_PURPOSE_DESCRIPTOR[det.role === "dual" ? "hybrid" : det.role] || POND_PURPOSE_DESCRIPTOR.auto;
                const g_atAGlance = (
                  <div style={{ marginBottom: 4 }}>
                    {/* D2 — Water area is the (shrinking) open water; Berm ring is the interior
                        annulus; Land take is the FIXED drawn footprint (water + berm ring = footprint). */}
                    {g_glanceRow("Water area",
                      <>{g_glanceNum(`${f2(g_waterSf / SQFT_PER_ACRE)} AC`)}{provTag(g_bermH > 0 ? "EST" : "PLAN", g_bermH > 0 ? "Open water inside the berm; it shrinks as the berm rises." : "Measured from your drawn shape")}</>,
                      null, `${f0(g_waterSf)} SF water surface`)}
                    {g_bermH > 0 && g_bermRingSf > 0 && g_glanceRow("Berm ring",
                      <>{g_glanceNum(`${f2(g_bermRingSf / SQFT_PER_ACRE)} AC`)}{provTag("EST", "The earthen berm ring INSIDE the drawn outline. Grows as the berm rises; water + berm ring equal the drawn footprint.")}</>,
                      null, `${f0(g_bermRingSf)} SF`)}
                    {g_glanceRow("Land take",
                      <>{g_glanceNum(`${f2(g_footprintSf / SQFT_PER_ACRE)} AC`)}{provTag("PLAN", "Your drawn footprint: the fixed outer limit of disturbance. It never changes; the berm builds inward.")}</>,
                      null, `${f0(g_footprintSf)} SF drawn footprint`)}
                    {g_glanceRow("Total depth",
                      <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                        <NumInput allowClear style={{ ...numInput, width: 60 }} value={det.depth ?? ""} placeholder={`~${f1(depth)}`} min={1} onCommit={(n) => setDet({ depth: Number.isFinite(n) ? n : null })} />
                        <span style={{ fontSize: 11, color: PAL.muted }}>ft</span>
                        {det.depth != null && <button style={chipSm} title="Clear: back to the screening default / solver suggestion" onClick={() => setDet({ depth: null })}>×</button>}
                      </span>,
                      "water depth + freeboard")}
                    {g_glanceRow("Rim",
                      // id (the `pond-release-field-` precedent): the Rim row IS the pond's
                      // top-of-bank anchor — the field B934 renamed from "Top-of-bank elev. (ft)"
                      // — and every outlet/routing spec has to set it. Addressing it by its label
                      // text is not possible (the label span also holds its ⓘ button), so it
                      // carries a stable id like the release field beside it.
                      <span id={`pond-rim-field-${selEl.id}`} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                        <NumInput allowClear style={{ ...numInput, width: 58 }} value={det.tobElev ?? ""} placeholder={pondAuto.tobElev ? `~${f1(pondAuto.tobElev.value)}` : "opt."} onCommit={(n) => setDet({ tobElev: Number.isFinite(n) ? n : null })} />
                        <span style={{ fontSize: 10.5, color: PAL.muted, whiteSpace: "nowrap" }}>{g_rimText}{g_floodLevel != null ? ` · flood ${f1(g_floodLevel)}′${g_facts.floodEstimated ? " est." : ""}` : ""}</span>
                        {det.tobElev != null && <button style={chipSm} title={pondAuto.tobElev ? `Clear: back to auto (${pondAuto.tobElev.source})` : "Clear: label rings by depth instead of elevation"} onClick={() => setDet({ tobElev: null })}>×</button>}
                      </span>,
                      "Set the top-of-bank elevation to label rings as real elevations instead of depths. Rim vs grade and the flood level read to the right.")}
                    {g_glanceRow("Holds (gross)", g_glanceNum(`${f1(g_holdsAcFt)} AC-FT`), "The full geometric tub volume before the flood / tailwater dead-storage split. The USABLE / achievable storage (what counts toward detention, and what the map + verdict report) is lower; see the verdict.", `${f0(r.vol)} cf stored`)}
                    {g_glanceRow(
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Purpose <RowInfo label="Purpose" sections={[{ text: POND_PURPOSE_TOOLTIP }]} /></span>,
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                        <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {g_purposeBtn(null, "Auto", POND_PURPOSE_DESCRIPTOR.auto)}
                          {g_purposeBtn("detention", POND_ROLE_LABEL.detention, POND_PURPOSE_DESCRIPTOR.detention)}
                          {g_purposeBtn("mitigation", POND_ROLE_LABEL.mitigation, POND_PURPOSE_DESCRIPTOR.mitigation)}
                          {g_purposeBtn("dual", POND_ROLE_LABEL.dual, POND_PURPOSE_DESCRIPTOR.hybrid)}
                        </span>
                        <span style={{ fontSize: 10, color: PAL.muted }}>picks by site needs · now: {POND_ROLE_LABEL[g_roleInfo.role] || g_purposeDescriptor}</span>
                      </span>)}
                  </div>
                );
                const g_sizingSummary = pondGroupSummary.sizing({});
                const g_outletStages = det.outlet && Array.isArray(det.outlet.stages) ? det.outlet.stages.length : 0;
                // v3 B5 — the closed OUTLET & STORMS summary names the storm outcome, not just the
                // stage count. Route the same way the expanded group does (same pure helper, no solver
                // change) so the summary reads "N stages · all storms PASS" / "N stages · M FAIL"; a
                // non-routable outlet (no TOB anchor) stays "N stages".
                // One routed pass feeds BOTH the outlet-fail count and the C3 FFE-proximity
                // screen (the routed peak water-surface elevation) — same pure helper, no solver
                // change. Null when the pond has no routable outlet / no TOB anchor.
                const g_routed = (() => {
                  if (g_outletStages === 0) return null;
                  const effDetO = detWithAuto(selEl.det);
                  if (!(effDetO.tobElev != null && Number.isFinite(effDetO.tobElev))) return null;
                  const critO = critAll;
                  const daO = Number.isFinite(det.daAcres) ? det.daAcres : acresActive;
                  const impO = Number.isFinite(det.daImpPct) ? det.daImpPct : impPct;
                  const tcO = computeTimeOfConcentration({ areaAcres: daO, impPct: impO, criteria: critO });
                  const twO = g_split && g_split.wseFt != null ? g_split.wseFt : null;
                  const routedO = assessRoutedDetention({ ring, det: effDetO, outlet: det.outlet, criteria: critO, areaAcres: daO, impPct: impO, tailwaterElevFt: twO, tcMin: tcO?.tcMin });
                  return routedO.kind === "routed" ? routedO : null;
                })();
                const g_outletFails = g_routed ? g_routed.perStorm.filter((s) => s.status !== "pass").length : null;
                const g_outletSummary = pondGroupSummary.outlet({ hasOutlet: g_outletStages > 0, stages: g_outletStages, fails: g_outletFails });
                // v3 C3 — screening guards (warnings only): a rim above grade → gravity-inflow
                // (inlets-through-the-berm) chip; if the routed peak water climbs to within 1 ft of
                // the lowest building's finished floor, name that building. Pure decision layer; the
                // peak WSE is the worst routed max across the modeled storms (null if not routable).
                const g_peakWseFt = g_routed
                  ? g_routed.perStorm.reduce((mx, s) => (Number.isFinite(s.maxElevFt) && (mx == null || s.maxElevFt > mx) ? s.maxElevFt : mx), null)
                  : null;
                const g_bldgNums = buildingNumbers(els);
                const g_dockDropFt = Number.isFinite(fmSettings.dockDropFt) ? fmSettings.dockDropFt : 4;
                const g_ffeBuildings = els
                  .filter((e) => e.type === "building")
                  .map((e) => ({ label: String(g_bldgNums.get(e.id) ?? ""), ffeFt: effectivePadElev(e, { padFfeFt: fmElev.padElevFt, dockDropFt: g_dockDropFt }) }))
                  .filter((b) => b.label && Number.isFinite(b.ffeFt));
                const g_guards = pondScreeningGuards({ rimVsGradeFt: g_rimVsGrade, peakWseFt: g_peakWseFt, buildings: g_ffeBuildings });
                const g_guardRow = g_guards.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "2px 0 2px" }}>
                    {g_guards.map((c) => <Chip key={c.id} tone={c.tone} text={c.text} popover={c.popover} />)}
                  </div>
                );
                const g_floodSummary = pondGroupSummary.flood({ wse: g_split.mode === "anchored" && g_split.wseFt != null ? f1(g_split.wseFt) : null, estimated: g_facts.floodEstimated });
                return (
                  <div style={{ marginTop: 12, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
                    {/* v3 UI SPEC B1 — header: subtitle (water area) + ⓘ geometry help · pin · Delete. */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 11.5, color: PAL.muted, whiteSpace: "nowrap" }} title="The open-water surface at the design water level (shrinks as the berm rises); distinct from the drawn footprint at the outer toe.">{f2(g_waterSf / SQFT_PER_ACRE)} AC water surface</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                        {/* NEW-1/B649504 — "click + on an edge" / "Shift-click to delete" described gestures
                            this app doesn't have: adding is Shift-click an edge, removing is right-click a
                            dot (or select it and press Delete). */}
                        <RowInfo label={pondDisplayName(g_roleInfo.role)} sections={[{ text: "Drag the body to move. Drag a corner dot to reshape; Shift-click an edge to add a point; right-click a dot to remove one." }]} />
                        <button style={{ ...chip, padding: "3px 8px" }} onClick={() => toggleLock(selEl.id)} title="Pin in place: prevents accidental moves/edits">{selEl.locked ? "📌 Unpin" : "📌 Pin"}</button>
                        <button type="button" style={{ ...chip, padding: "3px 10px", color: PAL.danger, fontWeight: 700 }} onClick={() => deleteSel(null, { entry: "panel:pond" })}>Delete</button>
                      </span>
                    </div>
                    {/* v3 UI SPEC B2 — status card(s): the ONE provided/required statement in this panel (G1).
                        E2(c) — EXACTLY ONE ⚡ Optimize pond button per panel. NEW-1 (2026-07-28) — that
                        button no longer lives INSIDE a card. It used to mount on the first NON-GREEN card
                        (`statusCards.findIndex(tone !== "ok")`), which meant an all-green panel had nothing
                        for it to attach to and the optimizer VANISHED. It is now a standalone action row
                        below the cards whose availability is decided by lib/pondOptimizeAffordance.js from
                        POSSIBILITY alone (drawn ring · known requirement · resolved split) — never tone. */}
                    {statusCards.length > 0 && (() => {
                      const toneColorOf = (c) => { const t = c.tone ?? (c.short ? "short" : "ok"); return t === "short" ? PAL.danger : t === "amber" ? PAL.warn : PAL.success; };
                      return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 11 }}>
                        {statusCards.map((c, i) => (
                          <div key={i} data-testid="pond-verdict-card" style={{ borderLeft: `3px solid ${toneColorOf(c)}`, background: "var(--planner-raised)", borderRadius: 8, padding: "9px 11px" }}>
                            {/* I5 — HEADLINE (outcome) + a separate styled achieved-vs-required sub-line; never a
                                wrapped dangling parenthesis. overflowWrap keeps it inside the panel at any width. */}
                            <div style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.35, color: toneColorOf(c), overflowWrap: "anywhere" }}>{c.heading}</div>
                            {c.subline ? <div title={c.basisNote || undefined} style={{ fontSize: 11, color: PAL.muted, fontWeight: 700, lineHeight: 1.4, marginTop: 2, letterSpacing: "0.02em", cursor: c.basisNote ? "help" : undefined }}>{c.subline}</div> : null}
                            {/* NEW-1 — the buildability answer, DEMOTED off the headline to its own
                                qualifier line (never deleted: floodway hard stops / the no-rise
                                certification are real and load-bearing). NEW-2 — the over-provision
                                state rides the same slot in WARN tone: as visible as a shortfall's
                                sub-line, never louder than a shortfall's headline. */}
                            {c.qualifier ? (
                              <div title={c.qualifier.title || undefined} style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.4, marginTop: 4, color: PAL.warn, cursor: c.qualifier.title ? "help" : undefined, overflowWrap: "anywhere" }}>▲ {c.qualifier.text}</div>
                            ) : null}
                            {c.body ? <div style={{ fontSize: 11.5, color: PAL.text, lineHeight: 1.5, marginTop: 4 }}>{c.body}</div> : null}
                          </div>
                        ))}
                      </div>
                      );
                    })()}
                    {/* NEW-1 — THE OPTIMIZER, as ONE LINE (owner decision, 2026-07-28: "I actually don't
                        even need a button necessarily... I want to lay out my buildings and then fill in
                        with my ponds"). Not a control to hunt for: a single suggestion that appears only
                        when the search finds a MATERIALLY smaller basin holding the same required volume,
                        states the delta plainly, and applies in one atomically-undoable click.

                        Its condition mentions no tone anywhere, which is the whole point — the button this
                        replaced mounted on `statusCards.findIndex(tone !== "ok")`, so once B1031 kept an
                        over-dug ledger GREEN the optimizer silently vanished from an all-green panel.
                        Availability is POSSIBILITY only (drawn ring · known requirement · resolved split),
                        and the mode that gets a line is "rightsize" — a COVERED or OVER-DUG pond, which is
                        exactly the case where land can come back. A SHORT pond is not silently dropped: it
                        keeps the Sizing assistant's raise/deepen/grow Apply chips below, which are that
                        same one-line-plus-Apply idiom, so nothing is stated twice.

                        Nothing materially better → NOTHING renders. Silence is information. */}
                    {(() => {
                      const provAcFt = providedUsableCf != null ? providedUsableCf / CF_PER_ACFT : null;
                      const provMitAcFt = pondLedger.creditedMitCf != null ? pondLedger.creditedMitCf / CF_PER_ACFT : null;
                      const aff = optimizeAffordance({
                        hasRing: Array.isArray(ring) && ring.length >= 3,
                        detRequiredAcFt: sc_detReqAcFt,
                        mitRequiredAcFt: sc_mitReqAcFt,
                        splitKnown: provAcFt != null && (sc_mitReqAcFt == null || provMitAcFt != null),
                        detShort: sc_detReqAcFt != null && provAcFt != null && provAcFt < sc_detReqAcFt - 0.005,
                        mitShort: sc_mitReqAcFt != null && provMitAcFt != null && provMitAcFt < sc_mitReqAcFt - 0.005,
                      });
                      if (!aff.available || aff.mode !== "rightsize") return null;
                      const alt = materialAlternative(rightSizeResultFor(selEl));
                      if (!alt) return null;
                      // The tool PROPOSES. One click writes through the normal element-sync path (one
                      // atomic undo); the drawn outline is never reshaped without it.
                      const apply = () => {
                        pushHistory();
                        if (selEl.points) setSelEl({ points: scaleRing(ring, alt.scale), depth: alt.depthFt });
                        else setSelEl({ w: selEl.w * alt.scale, h: selEl.h * alt.scale, depth: alt.depthFt });
                        flashWarn(`Pond resized to a ${f1(alt.depthFt)}′-deep basin on ${f2(alt.landTakeAc)} AC. One Ctrl+Z reverts.`, 6000);
                      };
                      return (
                        <div data-pond-card="rightsize" data-testid="pond-rightsize" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 11, fontSize: 11, color: PAL.text, lineHeight: 1.5 }}>
                          <span title={`Screening: a ${f1(alt.depthFt)}′-deep basin holds the same ${f2(alt.achievedAcFt)} AC-FT required volume on ${f2(alt.landTakeAc)} AC instead of ${f2(alt.baseLandTakeAc)} AC. An engineer redraws the chosen basin for real.`}>
                            {f1(alt.depthFt)}′ deep frees {f2(alt.landSavedAc)} AC
                            {alt.buildableSfDelta > 0 ? ` · ~${alt.buildableSfDelta.toLocaleString()} SF buildable` : ""}
                            {alt.earthworkCost != null ? ` · ~$${alt.earthworkCost.toLocaleString()} dirt` : ""}
                          </span>
                          <button type="button" onClick={apply} title="Resize this pond to that basin. One Ctrl+Z reverts."
                            style={{ flex: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)", whiteSpace: "nowrap" }}>Apply</button>
                        </div>
                      );
                    })()}
                    {designChangeSummary && designChangeSummary.pondId === selEl.id && (
                      <DesignChangeSummaryCard
                        summary={designChangeSummary}
                        onDismiss={() => setDesignChangeSummary(null)}
                        onUndo={() => { undo(); setDesignChangeSummary(null); }}
                      />
                    )}
                    {g_atAGlance}
                    {g_chipRow}
                    {g_guardRow}
                    {/* PR-G (d) — SOFT geotech warnings (deep excavation below likely groundwater);
                        never a hard block, but surfaced so the design isn't silently over-optimistic. */}
                    {(() => {
                      const soft = assessPondBuildable(selEl).soft;
                      return soft.length ? (
                        <div style={{ margin: "3px 0 2px" }}>
                          {soft.map((s) => <div key={s.code} style={{ fontSize: 11, color: PAL.warn, lineHeight: 1.45, fontWeight: 600 }}>▲ {s.label}</div>)}
                        </div>
                      ) : null;
                    })()}
                    {/* PR-L — the developer-readable pond SECTION: grade datum, the berm as fill above
                        grade, the excavation to the floor, storage bands at their true elevations, the
                        flood + groundwater + receiving-water levels, the outlet, the depth dimension, and
                        earthwork call-outs. SAME component (+ same facts source) as the ⚡ Optimize card,
                        so the picture never disagrees with the panel. Open by default (it's the headline
                        visual); collapsible for space. */}
                    <Collapse sectionId="pond-section" title="Section" defaultOpen={true} summary="grade · berm · storage bands">
                      <div style={{ padding: "4px 0 2px" }}>
                        <Suspense fallback={null}><PondSection facts={sectionFactsFor(selEl)} /></Suspense>
                      </div>
                    </Collapse>
                    {/* PR-J — "Engineering assumptions" is an ENGINEER-ONLY override section: it must
                        start CLOSED on every fresh load for every pond, so a developer never sees the
                        criteria unless they open it. persist={false} ignores any stale stored "open"
                        (e.g. from when this was "Sizing & criteria") — the in-session toggle still works. */}
                    <Collapse sectionId="pond-sizing" title="Engineering assumptions" defaultOpen={false} persist={false} summary={g_sizingSummary}>
                    {/* PR-I (I2) — TIER 2: a developer never needs to open this. Every criterion below is
                        pre-filled with a computed screening estimate (EST) and is editable purely as an
                        OVERRIDE. Plain-English header, no em dashes. */}
                    <div style={{ fontSize: 11, color: PAL.ink, lineHeight: 1.5, marginBottom: 8 }}>The app estimated these from the site data. Open only if you want to override a value.</div>
                    <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 7 }}>Detention storage</div>
                    {depthSolve && depthSolve.ok && Math.abs(depthSolve.depthFt - depth) > 0.05 && (
                      <div style={{ fontSize: 10.5, color: PAL.info, lineHeight: 1.45, margin: "1px 0 3px" }}>
                        Solver: ≈{f1(depthSolve.depthFt)}′ deep closes the site's remaining deficit.
                        <button style={{ ...chip, marginLeft: 6, padding: "2px 8px", fontSize: 10.5 }} onClick={() => setDet({ depth: depthSolve.depthFt })}>Apply</button>
                      </div>
                    )}
                    {depthSolve && !depthSolve.ok && depthSolve.reason === "slopes-collapse" && (
                      <div style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, margin: "1px 0 3px", fontWeight: 700 }}>
                        Solver clamped: this footprint maxes out at ≈{f1(depthSolve.maxUsableDepthFt)}′ ({slope}:1 slopes meet) — even that depth can't close the site deficit. Enlarge the footprint or add a pond.
                      </div>
                    )}
                    <Field label="Freeboard (ft)">
                      <span style={ROW6}>
                        <NumInput allowClear style={numInput} value={det.freeboard ?? ""} placeholder={`~${f1(pondAuto.freeboard.value)}`} min={0} onCommit={(n) => setDet({ freeboard: Number.isFinite(n) ? n : null })} />
                        {det.freeboard != null
                          ? <button style={chipSm} title={`Clear: back to auto (${pondAuto.freeboard.source})`} onClick={() => setDet({ freeboard: null })}>×</button>
                          : <span style={{ fontSize: 10, color: PAL.muted, whiteSpace: "nowrap" }} title={pondAuto.freeboard.verified ? "Verified criteria value" : "Unverified — confirm against the criteria manual"}>· {pondAuto.freeboard.source}</span>}
                      </span>
                    </Field>
                    <Field label="Side slope (n:1 H:V)">
                      <span style={ROW6}>
                        <NumInput allowClear style={numInput} value={det.slope ?? ""} placeholder={`~${f1(pondAuto.slope.value)}`} min={1} onCommit={(n) => setDet({ slope: Number.isFinite(n) ? n : null })} />
                        {det.slope != null
                          ? <button style={chipSm} title={`Clear: back to auto (${pondAuto.slope.source})`} onClick={() => setDet({ slope: null })}>×</button>
                          : <span style={{ fontSize: 10, color: PAL.muted, whiteSpace: "nowrap" }} title={pondAuto.slope.verified ? "Verified criteria value" : "Unverified — confirm against the criteria manual"}>· {pondAuto.slope.source}</span>}
                      </span>
                    </Field>
                    {/* v3 D5 — the "Max berm (ft)" input was REMOVED. The berm-height cap is COMPUTED,
                        never a user setting: the smaller of the drainage cap (runoff must still reach
                        the pond by gravity) and the geometric ceiling (where the inward berm closes the
                        footprint). Optimize applies up to that cap and the toast names the binding one. */}
                    {/* Stage contours on the plan — depth rings inside the basin. Default ON
                        (only `false` is ever stored to hide). Interval + top-of-bank elevation
                        only show when contours are on (progressive disclosure). */}
                    {(() => {
                      const on = det.contours !== false;
                      return (
                        <div style={{ marginTop: 6 }}>
                          <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.ink, cursor: "pointer", alignItems: "center" }} title="Draw depth rings (like a topographic map) inside the pond, and seat the stored volume on it">
                            <input type="checkbox" checked={on} onChange={(e) => setDet({ contours: e.target.checked ? true : false })} /> Show stage contours on plan
                          </label>
                          {on && (
                            <div style={{ marginTop: 6 }}>
                              <Field label="Contour interval (ft)">
                                <span style={ROW6}>
                                  <NumInput style={{ ...numInput, width: 56 }} value={det.contourInterval ?? autoContourInterval(depth)} min={0.5} onCommit={(n) => setDet({ contourInterval: Math.max(0.5, n) })} />
                                  {det.contourInterval != null && (
                                    <button style={chipSm} title="Back to the smart automatic spacing" onClick={() => setDet({ contourInterval: null })}>Auto</button>
                                  )}
                                </span>
                              </Field>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {det.availDepth != null && (
                      <div style={{ fontSize: 10.5, color: PAL.info, marginTop: 2, lineHeight: 1.4 }}>LiDAR available depth ≈ {f1(det.availDepth)}′.</div>
                    )}
                    {/* I3 — a permanent pool is only meaningful for a WET pond (retention). A dry
                        Detention basin has no standing water, so this input does NOT render for it. */}
                    {g_poolRelevant && (() => {
                      const poolEst = g_gradeFt != null ? Math.round((g_gradeFt - g_dtwEst.valueFt) * 10) / 10 : (g_wseForTw ?? null);
                      const usingEst = det.poolElev == null && Number.isFinite(poolEst);
                      return (
                        <Field label="Permanent pool elev. (ft)">
                          <span style={ROW6}>
                            <NumInput allowClear style={{ ...numInput, width: 64 }} value={det.poolElev ?? (Number.isFinite(poolEst) ? poolEst : "")} placeholder="water table" onCommit={(n) => setDet({ poolElev: Number.isFinite(n) ? n : null })} />
                            {det.poolElev != null
                              ? <button style={chipSm} title="Clear: back to the estimated water-table pool" onClick={() => setDet({ poolElev: null })}>×</button>
                              : usingEst && <span title="Screening estimate: the seasonal-high water table (grade minus depth to water). Refine with a geotech boring." style={estPillStyle}>EST</span>}
                          </span>
                        </Field>
                      );
                    })()}
                    {/* PR-G/PR-I — the 100-yr receiving-water (tailwater) elevation the pond must discharge
                        above by gravity; storage below it is DEAD. PR-I (I1): pre-filled with a screening
                        estimate (the flood WSE, else existing grade) so it's never a blank demanding an
                        expert value — the developer's typed value overrides. */}
                    <Field label="Receiving water (100-yr tailwater) elev. (ft)">
                      <span style={ROW6}>
                        <NumInput allowClear style={{ ...numInput, width: 64 }} value={det.receivingFlowlineElev ?? (Number.isFinite(g_twEst.valueFt) ? Math.round(g_twEst.valueFt * 10) / 10 : "")} placeholder="outfall elev" onCommit={(n) => setDet({ receivingFlowlineElev: Number.isFinite(n) ? n : null })} />
                        {det.receivingFlowlineElev != null
                          ? <button style={chipSm} title="Clear: back to the estimate" onClick={() => setDet({ receivingFlowlineElev: null })}>×</button>
                          : Number.isFinite(g_twEst.valueFt)
                            ? <span title={`Estimated from ${g_twEst.sourceLabel || "channel data"}. ${g_twEst.sourceTip || ""} The receiving channel's stage at the outfall; refine with the outfall survey. Storage below it can't drain by gravity (dead).`} style={estPillStyle}>EST</span>
                            : <span title="The receiving-water level comes from the drainage district channel, FEMA InFRM, a USGS gauge, or a terrain-derived channel flowline (never site grade). None resolved here, so enter the outfall elevation or check the Drainage district group. Leaving it blank means the gravity-discharge check is skipped, not failed." style={{ ...estPillStyle, color: PAL.warn }}>needs channel data</span>}
                      </span>
                    </Field>
                    {/* NEW-26 (owner directive 2026-07-24) — the outfall's flood connection. By DEFAULT a pond
                        is hydraulically CONNECTED to the floodplain through this outfall: during a flood the
                        receiving water backs IN through the outlet and its below-flood cut counts as
                        compensating (mitigation) storage. Ticking this marks the outfall as GATED (a flap
                        valve / backflow preventer keeps the flood out), which zeroes that in-pond mitigation
                        credit. Stored only when true — an unmarked pond stays connected. */}
                    <div style={{ marginTop: 6 }}>
                      <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.ink, cursor: "pointer", alignItems: "center" }} title="Tick only if the outfall carries a flap valve or backflow preventer (or is otherwise sealed against the receiving water). Sealed means the flood cannot back into the pond, so the pond's below-flood storage no longer counts as compensating (mitigation) storage. Left unticked, the pond is treated as an open, connected outfall (the default) and its below-flood cut is credited.">
                        <input type="checkbox" checked={!!det.outletGated} onChange={(e) => setDet({ outletGated: e.target.checked ? true : null })} /> Outfall gated (flap valve, no floodplain backflow)
                      </label>
                    </div>
                    {/* PR-G/PR-I — SOFT geotech screen: pre-filled with the depth to water ("don't dig
                        below groundwater"), else the 12-ft fallback. A warning, never a hard block. */}
                    <Field label="Max excavation depth (ft)">
                      <span style={ROW6}>
                        <NumInput allowClear style={{ ...numInput, width: 64 }} value={det.maxExcavDepthFt ?? (Number.isFinite(g_maxExcavEst.valueFt) ? Math.round(g_maxExcavEst.valueFt * 10) / 10 : "")} placeholder={`${DEFAULT_MAX_EXCAV_DEPTH_FT}`} onCommit={(n) => setDet({ maxExcavDepthFt: Number.isFinite(n) ? n : null })} />
                        {det.maxExcavDepthFt != null
                          ? <button style={chipSm} title="Clear: back to the estimate" onClick={() => setDet({ maxExcavDepthFt: null })}>×</button>
                          : Number.isFinite(g_maxExcavEst.valueFt) && <span title={`Screening estimate: ${g_maxExcavEst.source === "depth-to-water" ? "the seasonal-high depth to water (don't dig below groundwater)" : "a conservative default"}. Refine with a geotech boring.`} style={estPillStyle}>EST</span>}
                      </span>
                    </Field>
                    <div style={{ marginTop: 7, background: "var(--planner-raised)", borderRadius: RADIUS.md, padding: "8px 10px" }}>
                      {pondRow("Top-of-bank area", `${f0(r.aTop)} SF`)}
                      {pondRow("Water-surface area", `${f0(r.aWater)} SF`)}
                      {pondRow("Bottom area", `${f0(r.aBottom)} SF`)}
                      {pondRow("Water depth", `${f1(r.dw)} ft`)}
                      <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "5px 0 4px" }} />
                      {tobEff != null && pondRow("Pond floor", `${f1(tobEff - depth)}′ NAVD88`,
                        det.tobElev != null ? { code: "yours" } : { code: "survey", basis: "Top of bank ≈ existing grade — site 3DEP elevation median." })}
                      {pondRow("Stored volume", `${f1(r.vol / CF_PER_ACFT)} AC-FT`, { code: "plan", basis: `${f0(r.vol)} cf. Prismoidal (average-end-area) volume off this pond's drawn top-of-bank footprint; the basin tapers ${slope}:1 to its floor.` })}
                    </div>
                    {!r.feasible && (
                      <div style={{ fontSize: 10.5, color: PAL.danger, lineHeight: 1.4, marginTop: 4, fontWeight: 700 }}>
                        ⚠ This footprint can't hold an {f1(depth)}′ pond at {slope}:1 side slopes — the opposing slopes meet at about {f1(r.maxDepth)}′ deep. The volume above is for that {f1(r.maxDepth)}′ basin. Reduce the depth, flatten the side slope, or enlarge the footprint.
                      </div>
                    )}
                    {/* B708/B709 — the anchored flood-WSE split, criteria conformance, the
                        maintenance-berm land take, and the drawdown / berm-as-fill screens.
                        Salience tracks importance: flags are loud + solid, never faded. */}
                    {(() => {
                      const split = pondSplitFor(selEl);
                      const critRule = pondCriteria[floodJurKey] || pondCriteria.generic;
                      const crit = checkPondCriteria(det, critRule);
                      const dd = drawdownWarning(det);
                      const berm = bermAsFillHeight(det, fmElev.existGradeFt);
                      // D2 — INWARD berm: land take is the FIXED drawn footprint. The berm builds
                      // INSIDE the outline (never an outward ring), so it can never overlap the layout
                      // and there is no outward-ring overlap check to run.
                      const landTakeSf = ringsArea([ring]);
                      // The materialized-berm fill facts (height/crest/fill volume/below-WSE displacement)
                      // still come from the fill-cell model for the "Bermed basin" note + mitigation.
                      const matBerm = pondBermById.get(selEl.id) || null;
                      // B895 — WatchOutChip supplies its own ⚠ glyph, so callers no longer prefix one.
                      const warnLine = (txt, key, danger) => <WatchOutChip key={key} danger={danger}>{txt}</WatchOutChip>;
                      const noteLine = (txt, key) => (
                        <div key={key} style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 3 }}>{txt}</div>
                      );
                      const out = [];
                      if (split.mode === "anchored" && split.bands && split.wseFt != null) {
                        out.push(
                          <div key="split" style={{ marginTop: 7, background: "var(--planner-raised)", borderRadius: 8, padding: "8px 10px" }}>
                            {pondRow("Usable detention (above flood WSE)", `${f1(split.usableCf / CF_PER_ACFT)} AC-FT`)}
                            {pondRow("Below flood WSE", `${f1(split.bands.mitigationCandidateCf / CF_PER_ACFT)} AC-FT`)}
                            {split.bands.poolDeadCf > 0 && pondRow("Permanent pool (dead)", `${f1(split.bands.poolDeadCf / CF_PER_ACFT)} AC-FT`)}
                          </div>
                        );
                        // FINAL UI SPEC A2 — the flood-WSE caption, the ESTIMATE warning, and the
                        // fully-inundated warning move OUT of visible prose: their text now rides the
                        // "Flood level is estimated" / "Rim below flood level" chip popovers (A3) and
                        // the Flood & datum group. The value rows above stay.
                      } else if (split.mode === "unknown") {
                        // NEW-9 — a restored check without this pond's persisted facts: the split is
                        // unknown, and the gross figure above must not read as usable.
                        out.push(warnLine("Remembered check — this pond's usable/dead split wasn't saved with it. Usable detention is unknown until the next live check; the gross number above OVERSTATES usable.", "split-unknown", false));
                      } else if (split.mode === "anchored" && split.bands && split.bands.poolDeadCf > 0) {
                        out.push(noteLine(`Permanent pool below ${f1(det.poolElev)}′ holds ${f2(split.bands.poolDeadCf / CF_PER_ACFT)} AC-FT of dead storage (no detention credit). Groundwater can hold a wet bottom near mapped channels.`, "pool-note"));
                      } else if (split.inTrigger) {
                        // B822 — an auto-anchored pond (3DEP TOB) reaches here only when the reach's
                        // flood elevation is unknown; the truly-unanchored copy fires only when there
                        // is NO anchor at all (no manual, no 3DEP median).
                        out.push(warnLine(tobEff != null
                          ? "This pond sits in the mapped floodplain and its top of bank is anchored, but the reach's flood elevation is unknown — enter the BFE (drainage inputs in Yield) to split usable storage from flood-occupied volume. The gross number above OVERSTATES usable detention."
                          : "This pond sits in the mapped floodplain but isn't anchored — set the pond's top-of-bank elevation (and the reach's flood elevation) to split usable storage from flood-occupied volume. The gross number above OVERSTATES usable detention.", "unanchored", false));
                      }
                      if (crit.slope) out.push(warnLine(`${crit.slope.slope}:1 interior side slopes are steeper than the ${crit.slope.maxSideSlope}:1 criteria cap (${critRule.label}).`, "crit-slope", false));
                      if (crit.freeboard) out.push(warnLine(`${f1(crit.freeboard.freeboard)}′ freeboard is under the ${f1(crit.freeboard.minFreeboardFt)}′ criteria minimum (${critRule.label}).`, "crit-fb", false));
                      if (landTakeSf != null) {
                        // FINAL UI SPEC A1.4 — the land-take value lives in the At-a-glance table.
                        // D2 — the inward berm never overlaps the layout, so the old outward-ring
                        // overlap watch-out is gone; fee-in-lieu / optimizer notes below stay.
                        // NEW-C2 (Phase C) — if the jurisdiction has a regional-detention / fee-in-lieu
                        // program, show the deal trade: paying in lieu of this on-site pond recovers its
                        // land-take back to buildable ground.
                        const rdAuthId = ({ harris: "hcfcd", fortbend: "fortbend", coh: "coh" })[floodJurKey] || floodJurKey;
                        const rd = regionalDetentionFor(rdAuthId);
                        if (rd && rd.available === true) {
                          const cmp = feeInLieuCompare({ pondLandTakeAc: landTakeSf / SQFT_PER_ACRE, requiredAcFt: detReq && detReq.kind === "point" ? detReq.requiredAcFt : null, coverageRatio: 0.4 });
                          if (cmp.buildableSfRecovered != null) {
                            out.push(noteLine(`Fee-in-lieu may be available (${rd.authorityLabel}): paying in lieu of this on-site pond could recover ~${cmp.buildableSfRecovered.toLocaleString()} SF buildable from its ${f2(cmp.landRecoveredAc)}-ac land take (screening, 40% coverage). ${rd.eligibilityNote} Verify the fee + eligibility with the district.`, "fee-in-lieu"));
                          }
                        }
                        // NEW-D1 (Phase D) — the pond economics optimizer USED to render its answer
                        // here, buried as one gray sentence inside "Engineering assumptions" where a
                        // developer never looks. NEW-1 (2026-07-28) promoted it to the ONE apply-gated
                        // suggestion line beside the status cards, so this copy is DELETED rather than
                        // duplicated: PANEL-BREVITY forbids stating the same fact in two places.
                      }
                      if ((crit.slope || crit.freeboard || landTakeSf != null) && critRule && critRule.verified === false) {
                        out.push(noteLine("Criteria values are unverified placeholders: confirm in Standards against the county criteria manual (PCPM / DCM).", "crit-unv"));
                      }
                      // NEW-B (Phase B) — soils/groundwater wet-vs-dry pond screen + subsidence-district
                      // flag. Depth-to-water is manual here (auto-fills from SSURGO once the /api/soils
                      // proxy is live — SDA is egress-blocked in the sandbox); grade + county come from
                      // facts the app already holds, so this adds no new fetch.
                      {
                        const gwCounties = drainCtxData?.authority?.jurisdiction?.county || [];
                        const dtw = Number.isFinite(det.depthToWaterFt) ? det.depthToWaterFt : null;
                        const gw = pondGroundwaterScreen({ depthToWaterFt: dtw, gradeElevFt: fmElev.existGradeFt, tobElevFt: tobEff, pondDepthFt: Number.isFinite(det.depth) ? det.depth : 8 });
                        // PR-I (I1) — pre-fill with the regional seasonal-high screening estimate so the
                        // developer never faces a blank; the measured value (SSURGO/TWDB) overrides + drives
                        // the detailed wet/dry message above.
                        const dtwEstField = estDepthToWaterFt({ measuredFt: det.depthToWaterFt });
                        out.push(
                          <div key="gw-dtw" style={{ marginTop: 6 }}>
                            <Field label="Depth to water (ft)">
                              <span style={ROW6}>
                                <NumInput allowClear style={{ ...numInput, width: 64 }} value={dtw ?? (Number.isFinite(dtwEstField.valueFt) ? dtwEstField.valueFt : "")} placeholder="—" min={0} onCommit={(n) => setDet({ depthToWaterFt: Number.isFinite(n) && n >= 0 ? n : null })} />
                                {dtw == null && dtwEstField.estimated && <span title="Screening estimate: a shallow Gulf-Coast seasonal-high water table. Refine with SSURGO / a TWDB well / a geotech boring." style={estPillStyle}>EST</span>}
                                <RowInfo label="Depth to water (ft)" sections={[{ text: "Seasonal high water table (SSURGO / TWDB well). Pre-filled with a regional screening estimate until a measured value is entered." }]} />
                              </span>
                            </Field>
                          </div>
                        );
                        if (gw.known) out.push(gw.wetPond ? warnLine(gw.message, "gw-wet", false) : noteLine(gw.message, "gw-dry"));
                        else if (dtw != null) out.push(noteLine(gw.message, "gw-note"));
                        const subs = subsidenceFlag(gwCounties);
                        if (subs) out.push(noteLine(`Subsidence: ${subs.message}`, "subsidence"));
                      }
                      // NEW-11/B831 — this pond vs drawn easements + the assumed pipeline corridor.
                      {
                        const enc = pondEncumbrances.find((c) => c.pondId === selEl.id);
                        if (enc) {
                          out.push(warnLine(`Pond overlaps a pipeline/easement corridor by ~${f2(enc.totalSf / SQFT_PER_ACRE)} AC — operator approval / relocation risk.`, "pond-enc", false));
                          out.push(noteLine("Verify the recorded easement width — the pipeline corridor is an ASSUMED screening band off a schematic centerline (not a surveyed easement). Applies to detention and mitigation basins alike.", "pond-enc-note"));
                        }
                      }
                      if (dd) out.push(warnLine(`Gravity drawdown unlikely below ${f1(dd.flowlineElev)}′ — the pond bottom sits ${f1(dd.belowByFt)}′ below the receiving flowline. Pump station or a shallower basin (≤ ${f1(dd.suggestedMaxDepthFt)}′ deep).`, "drawdown", false));
                      if (matBerm && matBerm.maxHeightFt > 0.25) {
                        // NEW-6 — the berm is now MODELED dirt: crest at TOB, per-cell height off the
                        // grade grid, priced into the fill heat map + earthwork + (in-trigger) mitigation.
                        out.push(warnLine(`Bermed basin: crest ${f1(matBerm.crestElevFt)}′ NAVD88, up to ${f1(matBerm.maxHeightFt)}′ above existing grade. The berm is modeled fill (~${f0(matBerm.volCf / 27)} cy)${matBerm.floodCf > 0 ? `, ~${f2((matBerm.floodCf * (fmRule && isFinite(fmRule.ratio) ? fmRule.ratio : 1)) / CF_PER_ACFT)} AC-FT of it below the flood WSE; 1:1 offset applies` : ""}.`, "berm-fill", false));
                        if (split.inTrigger) {
                          // Waller §A(9) note + the conveyance caution (a ring levee in the floodplain
                          // can block flow — engineer's check).
                          if (floodJurKey === "waller") out.push(noteLine("Berms are fill — the 1:1 offset applies; §A(9) targets structural fill for structures, but confirm berm treatment with the County Engineer.", "berm-waller"));
                          out.push(noteLine("Conveyance caution: a ring levee in the mapped floodplain can block flow (a no-rise / H&H check is your engineer's call) — this screening models the fill volume, not the hydraulic effect.", "berm-conveyance"));
                        }
                      } else if (berm != null) {
                        out.push(warnLine(`Bermed basin: the top of bank sits ${f1(berm)}′ above existing grade. The berm itself is fill${split.inTrigger ? " requiring mitigation" : ""} and may block conveyance.`, "berm-fill", false));
                      }
                      return out.length ? <>{out}</> : null;
                    })()}
                    {/* FINAL UI SPEC A1.4 — the Purpose 4-way toggle moved to the At-a-glance
                        table (with per-option tooltips); the "Auto from elevation ~X%…" explanation
                        paragraph is deleted. The one-time Hybrid teaching hint is preserved here. */}
                    {g_roleInfo.role === "dual" && !hybridHintSeen && (
                      <div style={{ fontSize: 10.5, color: PAL.ink, lineHeight: 1.45, background: SURF_RAISED, border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "7px 9px", margin: "8px 0 0", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <span><strong>Hybrid</strong> = this pond serves BOTH ledgers: usable detention above the flood water surface, and compensating-storage mitigation for the cut below it. Set it to Detention or Mitigation to force one.</span>
                        <button type="button" onClick={dismissHybridHint} style={{ flex: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: RADIUS.pill, border: `1px solid ${PAL.border}`, background: "transparent", color: PAL.muted, whiteSpace: "nowrap" }}>Got it</button>
                      </div>
                    )}
                    {/* NEW-13/B830 — the one-click berm: when the site is SHORT and this pond is
                        part of the solved joint berm, offer the apply chip right here (and in the
                        Yield balancer card — same payload, same click). Fringe ponds render the
                        exclusion reason instead of a suggestion; an applied berm shows its
                        provenance (× on the elevation field restores auto). */}
                    {(() => {
                      const bal = drainBalancer;
                      if (!bal) return null;
                      const smallNote = { fontSize: 10, color: PAL.muted, lineHeight: 1.4, margin: "3px 0 0" };
                      const out = [];
                      const bermApplied = det.tobBerm && (det.tobBerm.applied == null ? selEl.det?.tobElev == null : Math.abs((selEl.det?.tobElev ?? NaN) - det.tobBerm.applied) < 0.01);
                      if (bermApplied) {
                        out.push(<div key="berm-prov" style={smallNote}>Berm — auto-solved: +{f1(det.tobBerm.h)}′ over the pre-berm bank rides this pond's top of bank. × on the elevation field restores auto.</div>);
                      }
                      const bermMove = !bermApplied && bal.moves ? bal.moves.find((m) => m.kind === "berm-raise" && m.apply && m.apply.perPond.some((t) => t.id === selEl.id)) : null;
                      if (bermMove) {
                        const mine = bermMove.apply.perPond.find((t) => t.id === selEl.id);
                        out.push(
                          <button key="berm-chip" style={{ ...chip, width: "100%", marginTop: 8, padding: "7px 10px", fontWeight: 700, textAlign: "center" }} title={bermMove.info}
                            onClick={() => applyBermMove(bermMove.apply)}>{bermMove.label} — Apply</button>
                        );
                        out.push(<div key="berm-note" style={smallNote}>Applies jointly to {bermMove.apply.perPond.length} upland detention pond{bermMove.apply.perPond.length > 1 ? "s" : ""} (one shared height — volume lands in proportion to area); this pond takes +{f2((mine?.addCf || 0) / CF_PER_ACFT)} AC-FT. The berm itself is fill.</div>);
                      }
                      const excl = bal.bermExcluded && bal.bermExcluded.find((x) => x.id === selEl.id);
                      if (excl && excl.reason === "floodplain-fringe") {
                        out.push(
                          <div key="berm-excl" title="Berming below the flood WSE changes how the floodplain itself behaves (levee-adjacent hydraulics): the auto-suggest won't propose it; that is engineer territory." style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, marginTop: 6, fontWeight: 700, cursor: "help" }}>
                            Excluded from the berm auto-suggest: floodplain fringe.<span style={{ fontSize: 9.5, color: PAL.muted, marginLeft: 4, fontWeight: 400 }} aria-hidden="true">ⓘ</span>
                          </div>
                        );
                      }
                      return out.length ? <>{out}</> : null;
                    })()}
                    {/* NEW-4 — the sizing assistant: solve the pond's TWO banded targets (below-WSE
                        mitigation, above-WSE usable detention) from the SAME bands the audit rows
                        read, so the assistant can never disagree with the ledger. Proposals only —
                        the owner redraws (the one apply affordance stays the B830 berm chip above). */}
                    {(() => {
                      const split = pondSplitFor(selEl);
                      const effDet = detWithAuto(selEl.det);
                      // Bands only exist on an anchored pond with a water surface — the assistant
                      // refuses (with the reason) rather than designing off gross (LOUD-FAILURE).
                      const mitReqCf = fmResultView && fmResultView.volumeCf != null ? fmResultView.volumeCf : null;
                      const detReqCf = detReq && detReq.kind === "point" && detReq.requiredAcFt > 0 ? detReq.requiredAcFt * CF_PER_ACFT : null;
                      if (mitReqCf == null && detReqCf == null) return null; // nothing to solve toward
                      if (split.wseFt == null && !split.inTrigger) return null; // upland pond — no bands; the B633 auto-size covers detention-only sizing
                      const mineCredited = split.mode === "anchored" && split.bands ? split.bands.mitigationCandidateCf : 0;
                      const eff = effectivePondRole(effDet, split);
                      const mineCounted = eff.role === "mitigation" || eff.role === "dual" ? mineCredited : 0;
                      const othersCredited = pondLedger.creditedMitCf != null ? Math.max(0, pondLedger.creditedMitCf - mineCounted) : null;
                      const othersUsable = providedUsableCf != null && split.usableCf != null ? Math.max(0, providedUsableCf - split.usableCf) : null;
                      const mitTargetCf = mitReqCf != null && othersCredited != null ? Math.max(0, mitReqCf - othersCredited) : 0;
                      const detTargetCf = detReqCf != null && othersUsable != null ? Math.max(0, detReqCf - othersUsable) : 0;
                      if (!(mitTargetCf > 0) && !(detTargetCf > 0) && split.wseFt == null) return null;
                      const assist = sizePondForTargets({
                        ring, det: effDet,
                        wseFt: split.wseFt, wseProvider: split.wseSrc ?? null,
                        inTrigger: !!split.inTrigger,
                        gradeFt: fmElev.existGradeFt,
                        mitTargetCf, detTargetCf,
                        mitRatio: fmRule && isFinite(fmRule.ratio) ? fmRule.ratio : 1,
                        coincidentStorm, // R1 — solver honors the same coincident-storm policy as the split
                      });
                      const smallNote = { fontSize: 10, color: PAL.muted, lineHeight: 1.45, margin: "3px 0 0" };
                      const actLine = (txt, key, warn) => (
                        <div key={key} style={{ fontSize: 10.5, color: warn ? "var(--warn-text)" : PAL.text, lineHeight: 1.5, marginTop: 3 }}>{txt}</div>
                      );
                      const head = (
                        <div key="assist-head" style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 }}>
                          Sizing assistant (screening){assist.estimated ? <span style={{ color: "var(--warn-text)" }}>{" · est. WSE"}</span> : null}
                        </div>
                      );
                      const body = [];
                      if (!assist.ok) {
                        body.push(actLine(`Assistant unavailable: ${assist.reason}.`, "assist-refuse", true));
                      } else {
                        // FINAL UI SPEC A2 — the "mitigation covered ✓" status is redundant with the
                        // status card at the top of the inspector; keep only the detention status.
                        const detTxt = detTargetCf > 0 || detReqCf != null
                          ? `detention ${assist.detention.covered ? "covered ✓" : `short ${f2(assist.detention.shortCf / CF_PER_ACFT)} AC-FT`}`
                          : null;
                        // v3 A4 — the bare no-target fallback line is deleted; render the status
                        // line only when there is a detention target to speak to.
                        if (detTxt) body.push(actLine(detTxt, "assist-status", !(assist.mitigation.covered && assist.detention.covered)));
                        // NEW-5 — the remedies are one-click APPLICABLE (apply-gated, never auto):
                        // each Apply writes the real element fields through the normal element-sync
                        // path (setDet = pushHistory + setSelEl → ONE atomic undo), auto-recompute
                        // re-runs, and the changed verdicts flash. A compact preview diff rides the
                        // hover title. Grow ghosts nothing blind — it collision-checks (B709) and
                        // disables on a hit; solver-infeasible (pinch-off) never renders Apply.
                        const grade = Number.isFinite(fmElev.existGradeFt) ? fmElev.existGradeFt : null;
                        const ratio = fmRule && isFinite(fmRule.ratio) ? fmRule.ratio : 1;
                        const use0 = assist.detention.providedCf;
                        const applyChip = (onApply, title, disabled, disabledReason) => (
                          <button type="button" disabled={disabled} title={disabled ? disabledReason : title} onClick={disabled ? undefined : onApply}
                            style={{ marginLeft: 8, flex: "none", cursor: disabled ? "default" : "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill, border: `1px solid ${disabled ? PAL.panelLine : "var(--accent)"}`, background: disabled ? "transparent" : "var(--accent)", color: disabled ? PAL.muted : "var(--on-accent)", whiteSpace: "nowrap", opacity: disabled ? 0.6 : 1 }}>Apply</button>
                        );
                        const actApply = (txt, key, warn, chip) => (
                          <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 10.5, color: warn ? "var(--warn-text)" : PAL.text, lineHeight: 1.5, marginTop: 3 }}>
                            <span>{txt}</span>{chip}
                          </div>
                        );
                        for (const a of assist.actions) {
                          // v3 A4 — the "usable detention is ZERO — flood WSE at/above the top of bank"
                          // notice is deleted here: the pond status card and Flood & datum already say
                          // the rim sits below flood, so repeating it in the assistant is redundant.
                          if (a.kind === "inundated") { /* not rendered */ }
                          else if (a.kind === "raise-tob") {
                            const newTob = effDet.tobElev + a.hFt;
                            const newBermH = grade != null ? newTob - grade : null;
                            const mitAdd = a.bermFillBelowWseCf ? (a.bermFillBelowWseCf * ratio) / CF_PER_ACFT : 0;
                            const preview = `TOB ${f1(effDet.tobElev)} → ${f1(newTob)}${newBermH != null ? ` · berm ${f1(newBermH)}′ above grade` : ""} · usable ${f2(use0 / CF_PER_ACFT)} → ${f2((use0 + a.addCf) / CF_PER_ACFT)} AC-FT${mitAdd > 0.005 ? ` · mitigation req +${f2(mitAdd)} AC-FT (berm fill)` : ""}. One Ctrl+Z reverts.`;
                            const onApply = () => setDet({ tobElev: Math.round(newTob * 100) / 100, depth: (Number.isFinite(effDet.depth) ? effDet.depth : depth) + a.hFt, tobBerm: { h: a.hFt, applied: Math.round(newTob * 100) / 100 } });
                            body.push(actApply(`→ raise the top of bank +${f1(a.hFt)}′ (berm) → +${f2(a.addCf / CF_PER_ACFT)} AC-FT usable${a.partial ? `; the +${f1(a.maxRaiseFt)}′ screening clamp still leaves it short` : ""}${a.bermFillBelowWseCf ? `; the berm prism below the WSE is NEW fill (~${f2(a.bermFillBelowWseCf / CF_PER_ACFT)} AC-FT) folded into the mitigation requirement` : ""}.`, "assist-tob", false, applyChip(onApply, preview, false)));
                          }
                          else if (a.kind === "deepen") {
                            const preview = `depth ${f1(Number.isFinite(effDet.depth) ? effDet.depth : depth)}′ → ${f1(a.depthFt)}′ · below-WSE +${f2(a.addCf / CF_PER_ACFT)} AC-FT (pinch-off ceiling ${f1(a.maxDepthFt)}′). One Ctrl+Z reverts.`;
                            const onApply = () => setDet({ depth: a.depthFt });
                            body.push(actApply(`→ deepen the floor to ${f1(a.depthFt)}′ design depth → +${f2(a.addCf / CF_PER_ACFT)} AC-FT below the WSE (pinch-off ceiling ${f1(a.maxDepthFt)}′).`, "assist-deepen", false, applyChip(onApply, preview, false)));
                          }
                          else if (a.kind === "pinch-off") body.push(actLine(`→ ${a.label}: the floor can only add ${f2((a.ceilingCf || 0) / CF_PER_ACFT)} AC-FT more.`, "assist-pinch", true));
                          else if (a.kind === "grow") {
                            const candRing = scaleRing(ring, a.factor);
                            const hits = els.filter((e2) => e2.id !== selEl.id && ["building", "parking", "trailer"].includes(e2.type) && ringsOverlap(candRing, ringOf(e2)));
                            const pastLine = parcels.length && candRing.some((p) => !parcels.some((pc) => pc.points && pointInRing(p, pc.points)));
                            const collideReason = hits.length ? `grown footprint overlaps ${hits.length === 1 ? "an element" : hits.length + " elements"} in your layout` : pastLine ? "grown footprint extends past the property line" : null;
                            const preview = `footprint +${f2(a.addAcres)} AC (×${a.factor.toFixed(2)}) at the current depth. Collision-checked (B709); one Ctrl+Z reverts.`;
                            const onApply = () => { pushHistory(); if (selEl.points) setSelEl({ points: candRing }); else setSelEl({ w: selEl.w * a.factor, h: selEl.h * a.factor }); };
                            body.push(actApply(`→ or grow the footprint ~+${f2(a.addAcres)} AC (at the current depth) to reach the mitigation target.`, "assist-grow", false, applyChip(onApply, preview, !!collideReason, collideReason || "")));
                          }
                          else if (a.kind === "grow-infeasible") body.push(actLine("→ even ~3× the footprint can't reach the mitigation target at these slopes. Rethink the basin.", "assist-grow-inf", true));
                        }
                        if (assist.ok && assist.mitigation.covered && assist.detention.covered && !assist.actions.length) {
                          body.push(actLine("Both bands cover their remaining site targets. No resize needed.", "assist-ok"));
                        }
                        if (mitTargetCf > 0 && eff.role === "detention") {
                          body.push(actLine("This pond's purpose is Detention: its below-WSE cut is NOT credited to mitigation. Switch the purpose to Mitigation or Hybrid to count it.", "assist-role", true));
                        }
                        if (split.inTrigger && floodJurKey === "waller" && assist.actions.some((a) => a.kind === "raise-tob")) {
                          body.push(<div key="assist-waller" style={smallNote}>Unincorporated Waller: berms are fill — the 1:1 offset applies; the no-structural-fill rule (Art. 5 §A(9)) targets structures, but confirm berm treatment with the County Engineer.</div>);
                        }
                      }
                      return (
                        <div data-pond-card="assistant" style={{ marginTop: 12, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
                          {head}
                          {body}
                        </div>
                      );
                    })()}
                    {/* B655 — per-pond required-vs-provided screening card. Editable inputs feed the
                        Modified Rational (rate-based) method in detentionRules.js; the authority
                        site total (detReq) is shown for reference. A pumped outfall credits its
                        constant discharge and suppresses the Regime-B tailwater penalty (noted). */}
                    {(() => {
                      const da = Number.isFinite(det.daAcres) ? det.daAcres : acresActive;
                      const imp = Number.isFinite(det.daImpPct) ? det.daImpPct : impPct;
                      const storm = det.designStorm || 100;
                      const rel = Number.isFinite(det.releaseRateCfs) ? det.releaseRateCfs : null;
                      // B902 — AUTO-SUGGEST: the site's own pre-development peak discharge (a
                      // screening estimate), offered as a placeholder + one-click "Use" for districts
                      // (Waller, BKDD) that publish no cfs/ac cap. Never overrides a stored release.
                      const detCriteria = critAll;
                      // B905 — COMPUTED time of concentration (Kirpich) — see the RATE CONTROL
                      // section below for the full explanation; used here so this card's suggested
                      // release agrees with the one the outlet solver actually targets.
                      const detTc = rel == null ? computeTimeOfConcentration({ areaAcres: da, impPct: imp, criteria: detCriteria }) : null;
                      const suggested = rel == null ? suggestedPreDevReleaseCfs({ requiredStorms: detCriteria.requiredStorms, areaAcres: da, tcMin: detTc?.tcMin }) : null;
                      // v3 A3 — the rate-based required-vs-provided card was RELOCATED: its result now
                      // renders as ONE row in "Outlet & storms" (Outlet sizing check · rate control),
                      // where the outlet that answers it lives, and no longer restates the site's
                      // volumetric detention requirement here. What stays are the runoff / rate inputs
                      // that feed both the outlet routing and that row.
                      const smallNote = { fontSize: 10, color: PAL.muted, lineHeight: 1.4, margin: "2px 0 0" };
                      return (
                        <div style={{ marginTop: 12, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
                          <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 7 }}>Sizing inputs (screening)</div>
                          <Field label="Drainage area (ac)">
                            <span style={ROW6}>
                              <NumInput allowClear style={{ ...numInput, width: 64 }} value={Math.round(da * 100) / 100} min={0} onCommit={(n) => setDet({ daAcres: n > 0 ? n : null })} />
                              {det.daAcres != null && <button style={chipSm} title="Back to the whole site" onClick={() => setDet({ daAcres: null })}>Site</button>}
                            </span>
                          </Field>
                          <Field label="Impervious %">
                            <span style={ROW6}>
                              <NumInput allowClear style={{ ...numInput, width: 64 }} value={Math.round(imp * 10) / 10} min={0} max={100} onCommit={(n) => setDet({ daImpPct: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null })} />
                              {det.daImpPct != null && <button style={chipSm} title="Back to the plan's auto value" onClick={() => setDet({ daImpPct: null })}>Auto</button>}
                            </span>
                          </Field>
                          {det.daImpPct == null && <div style={smallNote}>Impervious % auto from the plan.</div>}
                          <Field label="Design storm">
                            <select style={{ ...numInput, width: 88 }} value={storm} onChange={(e) => setDet({ designStorm: +e.target.value })}>
                              {DESIGN_STORM_PERIODS.map((p) => <option key={p} value={p}>{p}-yr</option>)}
                            </select>
                          </Field>
                          <div id={`pond-release-field-${selEl.id}`}>
                            <Field label="Allowable release (cfs)">
                              <span style={ROW6}>
                                <NumInput allowClear style={{ ...numInput, width: 64 }} value={rel ?? ""} placeholder={suggested ? `≈${suggested.cfs}` : "—"} min={0} onCommit={(n) => setDet({ releaseRateCfs: Number.isFinite(n) ? n : null })} />
                                {suggested && (
                                  <SourceTag code="estimate" label="Allowable release (cfs)" basis={`Suggested — pre-development (undeveloped/pasture) peak discharge, Modified Rational method (runoff coefficient ${suggested.runoffC}, ${suggested.tcMin}-min time of concentration), evaluated at each of ${detCriteria.label}'s required design storms (${detCriteria.requiredStorms.join("/")}-yr) — the smallest (most restrictive), the ${suggested.governingStormYr}-yr storm, governs. ${detCriteria.label} publishes no cfs/ac release cap, so Post ≤ Pre screens the outlet against the site's own computed pre-development peak. A screening estimate — type your own release to override.`} />
                                )}
                              </span>
                            </Field>
                          </div>
                          {suggested && (
                            <div style={smallNote}>
                              ≈ {suggested.cfs} cfs — suggested (pre-development peak) · <ActionLink onClick={() => setDet({ releaseRateCfs: suggested.cfs })}>Use this →</ActionLink>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* B139 — Expand this pond: enter mode (auto-baseline + ghost), then steppers
                        (push banks out / dig deeper) or free drag feed one Existing→Proposed delta. */}
                    {!inMode ? (
                      <div style={{ marginTop: 11 }}>
                        <button style={{ ...chip, width: "100%", padding: "8px 10px", fontWeight: 700 }} onClick={startExpand} title="See how much more detention you'd gain by enlarging this pond: it snapshots today's size, then you push the banks out or dig deeper.">Expand this pond</button>
                        {/* B633 — auto-size: solve the expand offset that closes the SITE's
                            detention shortfall (B630's required-vs-provided), then land the
                            user in the normal expand mode (baseline + ghost + overlap /
                            property-line warnings) to review and press Done. */}
                        {(() => {
                          if (!detReq || detReq.kind !== "point" || !(detReq.requiredAcFt > 0)) return null;
                          const requiredCf = detReq.requiredAcFt * CF_PER_ACFT;
                          // Regime B (B632): the permanent pool below the static water surface
                          // stores nothing — and it GROWS with the footprint (fixed water
                          // surface, bigger basin), so the solver must target USABLE volume =
                          // gross − dead AT EACH candidate size, not subtract a frozen constant.
                          // Missing elevations → poolDepthFt null → REFUSE (never a fabricated pool).
                          const regimeB = detRegime && detRegime.regime === "B";
                          const poolDepthFt = regimeB
                            ? deadStoragePoolDepthFt({ bfeFt: detRegime.elevations?.bfeFt, groundElevFt: detRegime.elevations?.groundFt, depthFt: depth, freeboardFt: fb })
                            : 0;
                          // B708: current usable via the ONE shared helper (anchored split when
                          // the pond carries a real WSE; the Regime-B estimate otherwise) — the
                          // same number the metrics loop and the B655 card show.
                          const thisSplit = pondSplitFor(selEl);
                          const anchoredThis = thisSplit.mode === "anchored";
                          const thisDeadCf = thisSplit.deadCf;
                          const thisUsableCf = thisSplit.usableCf;
                          // NEW-9 — a restored view without the per-pond split facts has an UNKNOWN
                          // usable (null, not zero): refuse to auto-size against it (the readout
                          // already says "re-check"); manual expand stays available.
                          if (providedUsableCf == null || thisUsableCf == null) return null;
                          // Target THIS pond's usable so the SITE meets required: other ponds'
                          // usable is the site total minus this pond's current usable.
                          const otherUsableCf = Math.max(0, providedUsableCf - thisUsableCf);
                          const targetUsableCf = requiredCf - otherUsableCf;
                          if (targetUsableCf <= thisUsableCf) return null; // this pond already covers its share
                          const regimeUnsure = !detRegime || detRegime.regime === "unknown" || drainFacts()?.floodFailed;
                          const authDefaults = drainAuthorityId ? pondDefaultsFor(drainAuthorityId) : null;
                          const defaultsDiffer = authDefaults && (authDefaults.sideSlope !== slope || authDefaults.freeboardFt !== fb);
                          const sizeForRequired = () => {
                            // An ANCHORED pond needs no estimated pool — its split is real.
                            if (!anchoredThis && regimeB && poolDepthFt == null) {
                              flashWarn("⚠ In this floodplain the permanent-pool depth can't be established (missing BFE or ground elevation) — refusing to size against an unknown usable volume.", 7500);
                              return;
                            }
                            // volumeAt returns USABLE volume (gross − permanent pool) at the candidate footprint.
                            const grossAt = (N) => {
                              if (selEl.points) {
                                const g = N > 0 ? expandPolygon(ring, N) : ring;
                                if (!g || polySelfIntersects(g)) return null;
                                return { g, res: detentionStorage(g, depth, fb, slope) };
                              }
                              const g = elCorners({ ...selEl, w: selEl.w + 2 * N, h: selEl.h + 2 * N });
                              return { g, res: detentionStorage(g, depth, fb, slope) };
                            };
                            const volumeAt = (N) => {
                              const gr = grossAt(N);
                              if (!gr) return null;
                              // Same shared split at the CANDIDATE footprint: anchored ponds keep
                              // their real WSE (screening: the current reach's governing WSE), the
                              // rest subtract the Regime-B pool that grows with the footprint.
                              const u = usablePondVolume(gr.g, { ...det, depth, freeboard: fb, slope }, { wseFt: thisSplit.wseFt, estimatePoolDepthFt: poolDepthFt });
                              return { ...gr.res, vol: u.usableCf };
                            };
                            const s = solvePondExpansion({ requiredCf: targetUsableCf, volumeAt });
                            if (s.ok) {
                              pushHistory();
                              const baseline = { ring: ring.map((p) => ({ x: p.x, y: p.y })), geom: snapshotGeom(), depth, freeboard: fb, slope };
                              const detNext = { ...det, depth, freeboard: fb, slope, expandFt: s.expandFt, baseline };
                              if (selEl.points) setSelEl({ points: expandPolygon(ring, s.expandFt), det: detNext });
                              else setSelEl({ w: selEl.w + 2 * s.expandFt, h: selEl.h + 2 * s.expandFt, det: detNext });
                              flashWarn(`Sized for required detention: banks pushed out ${s.expandFt}′ (+${f2((s.achievedCf - thisUsableCf) / CF_PER_ACFT)} AC-FT usable). Review the ghost, then press Done to keep it.`, 7000);
                            } else if (s.reason === "already-sufficient") {
                              flashWarn("This pond already covers the site's required detention.", 4000);
                            } else {
                              // Depth fallback: as you dig deeper the floor drops below the fixed
                              // water surface, so the permanent pool grows with depth too.
                              const poolAt = (dd) => (regimeB ? Math.max(0, Math.min(detRegime.elevations.bfeFt - (detRegime.elevations.groundFt - dd), dd - fb)) : 0);
                              const usableAtDepth = (dd) => {
                                const g = detentionStorage(ring, dd, fb, slope);
                                const u = usablePondVolume(ring, { ...det, depth: dd, freeboard: fb, slope }, { wseFt: thisSplit.wseFt, estimatePoolDepthFt: poolAt(dd) });
                                return { ...g, vol: u.usableCf };
                              };
                              const dAlt = solvePondDepth({ requiredCf: targetUsableCf, volumeAtDepth: usableAtDepth, startDepthFt: depth });
                              flashWarn(
                                s.reason === "geometry-failed"
                                  ? `Can't push the banks out cleanly past ${s.atFt}′ on this shape.${dAlt.ok ? ` Alternative: dig to ${f1(dAlt.depthFt)}′ deep (now ${f1(depth)}′).` : ""}`
                                  : dAlt.ok
                                    ? `Pushing the banks out isn't enough — but digging to ${f1(dAlt.depthFt)}′ deep (now ${f1(depth)}′) gets there. Use "Expand this pond" → Dig deeper.`
                                    : `This pond can't reach the required volume: at ${slope}:1 the side slopes meet at ${f1(dAlt.maxUsableDepthFt ?? r.maxDepth)}′ before enough storage exists. Enlarge the footprint or flatten the slopes.`,
                                8500
                              );
                            }
                          };
                          const shortfallUsableCf = targetUsableCf - thisUsableCf;
                          return (
                            <div style={{ marginTop: 8 }}>
                              <button style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${PAL.accent}`, borderRadius: RADIUS.md, background: "transparent", color: PAL.accent, fontWeight: 700, fontSize: 12, cursor: "pointer" }} onClick={sizeForRequired}>
                                ⇱ Size for required detention ({f2(shortfallUsableCf / CF_PER_ACFT)} AC-FT short)
                              </button>
                              <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 4 }}>
                                Solves how far to push the banks out so the site meets its required volume{thisDeadCf > 0 ? ` (the ${f2(thisDeadCf / CF_PER_ACFT)} AC-FT permanent pool grows with the footprint and stays uncredited; Regime B)` : ""}, then lets you review before keeping it.
                              </div>
                              {regimeUnsure && (
                                <div style={{ fontSize: 10, color: PAL.warn || PAL.muted, lineHeight: 1.45, marginTop: 4 }}>
                                  ⚠ Flood facts aren't established (regime unknown) — this sizes for a dry (Regime-A) outfall. If the site is in a floodplain, usable storage could be less; check the drainage criteria.
                                </div>
                              )}
                              {defaultsDiffer && (
                                <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                  <span>{(detReq.rule?.authorityLabel || "Authority")} defaults: {authDefaults.sideSlope}:1 slopes · {authDefaults.freeboardFt}′ freeboard.</span>
                                  <button style={{ ...chip, padding: "1px 8px", fontSize: 10 }} onClick={() => setDet({ slope: authDefaults.sideSlope, freeboard: authDefaults.freeboardFt })}>Apply</button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ) : (() => {
                      const baseVol = detentionStorage(base.ring, base.depth, base.freeboard, base.slope).vol;
                      const inc = r.vol - baseVol, sign = inc >= 0 ? "+" : "−", mag = Math.abs(inc);
                      const digVal = Math.max(0, Math.round(depth - base.depth));
                      const expandVal = Math.max(0, Math.round(det.expandFt || 0));
                      const warns = [];
                      const overlaps = els.filter((e) => e.id !== selEl.id && ["building", "parking", "trailer"].includes(e.type) && ringsOverlap(ring, ringOf(e)));
                      if (overlaps.length) warns.push(overlaps.length === 1 ? `Overlaps a ${TYPE[overlaps[0].type].label.toLowerCase()} — the expanded pond runs into your layout.` : `Overlaps ${overlaps.length} other elements — the expanded pond runs into your layout.`);
                      if (parcels.length && ring.some((p) => !parcels.some((pc) => pc.points && pc.points.length >= 3 && pointInRing(p, pc.points)))) warns.push("Extends past the property line.");
                      return (
                        <div style={{ marginTop: 11, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
                          <div style={{ fontSize: 10.5, color: PAL.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 800, marginBottom: 7 }}>Expanding · existing locked</div>
                          {stepRow("Push banks out (ft)", expandVal, 5, pushBanksOut)}
                          {stepRow("Dig deeper (ft)", digVal, 1, digDeeper)}
                          <div style={{ fontSize: 10, color: PAL.muted, marginTop: 3 }}>Or drag the pond's edges on the map.</div>
                          <div style={{ marginTop: 8, background: "var(--planner-raised)", borderRadius: 8, padding: "8px 10px" }}>
                            {pondRow("Existing storage", `${f2(baseVol / CF_PER_ACFT)} AC-FT`, { code: "plan" })}
                            {pondRow("Proposed storage", `${f2(r.vol / CF_PER_ACFT)} AC-FT`, { code: "plan" })}
                            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "5px 0 4px" }} />
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0" }}>
                              <span style={{ fontSize: 12, color: PAL.ink, fontWeight: 700 }}>{inc >= 0 ? "Storage gained" : "Storage lost"}</span>
                              <span style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontSize: 14, color: inc >= 0 ? PAL.success : PAL.danger, fontWeight: 800 }}>{sign}{f2(mag / CF_PER_ACFT)} AC-FT</span>
                            </div>
                            {pondRow("", `${sign}${f0(mag)} cf`)}
                          </div>
                          {warns.map((w, i) => <WatchOutChip key={i} style={{ marginTop: 5 }}>{w}</WatchOutChip>)}
                          <div style={{ marginTop: 9, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 7 }}>
                            <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 5 }}>Fill colors</div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ fontSize: 11.5, color: PAL.muted }}>Existing basin</span>
                              <ColorField value={toHex6(det.existFill ?? curStyle?.fill ?? "#5B97A5")} title="Existing basin fill"
                                {...colorCtl((v) => setDetLive({ existFill: v }))} seed={COLOR_SEED} swatchSize={12}
                                style={{ width: 30, height: 22, borderRadius: 5 }} />
                            </div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 11.5, color: PAL.muted }}>Added area</span>
                              <ColorField value={toHex6(det.addFill ?? POND_ADD_FILL_DEFAULT)} title="Added area fill"
                                {...colorCtl((v) => setDetLive({ addFill: v }))} seed={COLOR_SEED} swatchSize={12}
                                style={{ width: 30, height: 22, borderRadius: 5 }} />
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                            <button style={{ ...chip, flex: 1 }} onClick={resetExisting}>Reset to existing</button>
                            <button style={{ ...chip, flex: 1, borderColor: PAL.accent, color: PAL.accent, fontWeight: 700 }} onClick={doneExpand}>Done</button>
                          </div>
                        </div>
                      );
                    })()}
                    </Collapse>
                    <Collapse sectionId="pond-outlet" title="Outlet & storms" defaultOpen={false} summary={g_outletSummary}>
                    {/* NEW-A (Phase A) — RATE control (Post ≤ Pre): route each required storm through
                        the pond's OUTLET STRUCTURE and prove the routed post-development peak ≤ the
                        pre-development peak, per storm. This is what a rate-control district (FBCDD,
                        Brookshire–Katy DD, Waller) actually regulates — the volume band above is a
                        screening proxy. Criteria come from the cited jurisdiction registry
                        (detentionCriteria); the outlet is the additive det.outlet, persisted via setDet. */}
                    {(() => {
                      const effDet = detWithAuto(selEl.det);
                      const split = pondSplitFor(selEl);
                      const criteria = critAll;
                      const da = Number.isFinite(det.daAcres) ? det.daAcres : acresActive;
                      const imp = Number.isFinite(det.daImpPct) ? det.daImpPct : impPct;
                      // B905 — COMPUTED time of concentration (Kirpich), replacing the flat 15-min
                      // screening assumption everywhere Tc feeds this pond's routing below — the
                      // Rational intensity, the suggested pre-dev release, and the outlet solver.
                      const tc = computeTimeOfConcentration({ areaAcres: da, impPct: imp, criteria });
                      const smallNote = { fontSize: 10, color: PAL.muted, lineHeight: 1.45, margin: "2px 0 0" };
                      const head = (
                        <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 7 }}>Rate control · Post ≤ Pre (screening)</div>
                      );
                      const wrap = (kids) => (
                        <div style={{ marginTop: 12, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>{head}{kids}</div>
                      );
                      const anchored = effDet.tobElev != null && Number.isFinite(effDet.tobElev);
                      if (!anchored) {
                        return wrap(<div style={smallNote}>Set the pond's top-of-bank elevation (above) to route storms and prove Post ≤ Pre through an outlet.</div>);
                      }
                      const depthEff = Number.isFinite(effDet.depth) ? effDet.depth : 8;
                      const fbEff = Number.isFinite(effDet.freeboard) ? effDet.freeboard : 1;
                      const r2 = (n) => Math.round(n * 100) / 100;
                      const floorApprox = r2(effDet.tobElev - depthEff);
                      const designWs = r2(effDet.tobElev - fbEff);
                      // The allowable release the outlet is sized/checked against, in priority order:
                      // (1) a manual release rate the user typed; (2) the jurisdiction's published
                      // cfs/ac cap × drainage area, when one exists; (3) B902 AUTO-SUGGEST — the site's
                      // own pre-development peak discharge (a screening estimate), so a Post ≤ Pre
                      // district that publishes NO cfs/ac cap (Waller, BKDD) never leaves the button
                      // dead — the allowable release IS the site's pre-development peak in that regime.
                      const suggested = suggestedPreDevReleaseCfs({ requiredStorms: criteria.requiredStorms, areaAcres: da, tcMin: tc?.tcMin });
                      const relCap = Number.isFinite(det.releaseRateCfs) ? det.releaseRateCfs
                        : criteria.allowableReleaseCfsPerAc && da > 0 ? r2(criteria.allowableReleaseCfsPerAc.value * da)
                        : suggested ? suggested.cfs : null;
                      const relSource = Number.isFinite(det.releaseRateCfs) ? "manual"
                        : criteria.allowableReleaseCfsPerAc && da > 0 ? "code"
                        : suggested ? "suggested" : null;
                      const tailwaterElevFt = split && split.wseFt != null ? split.wseFt : null; // drowned-outlet regime
                      const outlet = det.outlet && Array.isArray(det.outlet.stages) && det.outlet.stages.length ? det.outlet : null;
                      const stages = outlet ? outlet.stages : [];
                      const writeOutlet = (next) => setDet({ outlet: next && next.stages && next.stages.length ? next : null });
                      // B903 — MULTI-STAGE OUTLET: a genuine editable LIST of stages (any mix of
                      // orifice/weir/restrictor, any length) rather than a fixed "primary + one
                      // optional weir" pair — real compound structures stack a low-flow orifice, a
                      // control weir, and an emergency spillway, and the auto-size solver below can
                      // produce exactly that.
                      const updateStage = (idx, patch) => { const s = [...stages]; s[idx] = { ...s[idx], ...patch }; writeOutlet({ stages: s }); };
                      const removeStage = (idx) => writeOutlet({ stages: stages.filter((_, i) => i !== idx) });
                      const addStage = (kind) => writeOutlet({
                        stages: [...stages, kind === "orifice"
                          ? { kind: "orifice", invertElevFt: floorApprox, diameterIn: 6, count: 1 }
                          : { kind: "weir", crestElevFt: designWs, lengthFt: 5 }],
                      });
                      const roleLabel = (s, i) => {
                        if (s.role === "primary") return "Low-flow orifice";
                        if (s.role === "control") return "Control weir";
                        if (s.role === "spillway") return "Emergency spillway";
                        const kindLabel = s.kind === "orifice" ? "Orifice" : s.kind === "weir" ? "Weir" : "Restrictor";
                        return i === 0 ? `Primary ${kindLabel.toLowerCase()}` : `${kindLabel} #${i + 1}`;
                      };
                      // B903 — "Auto-size" now solves the WHOLE compound structure (orifice + a
                      // control weir when needed + an emergency spillway) so EVERY required storm
                      // passes at once, reusing autoSizeCompoundOutlet (lib/pondRouting.js) — never a
                      // single orifice sized to one governing storm that can silently fail another.
                      // A manual "Allowable release" seeds the solve (still meaningfully honored)
                      // but the solver still iterates toward whatever ACTUALLY satisfies Post ≤ Pre
                      // for every storm, since that's the same check the routed table below proves.
                      const autosize = () => {
                        const overrideCfs = Number.isFinite(det.releaseRateCfs) ? det.releaseRateCfs : null;
                        const r = autoSizeCompoundOutlet({ ring, det: effDet, criteria, areaAcres: da, impPct: imp, tailwaterElevFt, overrideCfs, tcMin: tc?.tcMin });
                        if (!r.outlet) { flashWarn(r.reason || "Could not size an outlet — check the drainage area and top-of-bank elevation.", 6000); return; }
                        // Same one-setDet-call rule as B902: setDet rebuilds `det` from this
                        // render's closure, so a second synchronous call would clobber the first.
                        const patch = { outlet: r.outlet };
                        if (relSource === "suggested") patch.releaseRateCfs = relCap;
                        setDet(patch);
                        if (!r.ok) flashWarn(r.reason, 8000); // honest partial result — outlet still written, best attempt
                      };
                      const critLine = (
                        <div style={smallNote}>
                          Criteria: {criteria.label}{criteria.governingManual && criteria.governingManual.section ? ` · ${criteria.governingManual.section}` : ""}
                          {criteria.allowableReleaseCfsPerAc ? ` · release ${criteria.allowableReleaseCfsPerAc.value} cfs/ac${criteria.allowableReleaseCfsPerAc.verified ? "" : " (unverified)"}` : criteria.postLePre ? " · Post ≤ Pre (rate-match)" : ""}
                          {" · storms "}{criteria.requiredStorms.join("/")}-yr.
                        </div>
                      );
                      // B904 — CE roadmap #2's method-by-area guardrail: the Rational method
                      // (what routes above) is only valid for a small, quick-responding tributary
                      // area. Past the jurisdiction's screening ceiling, flag it loudly — the
                      // routed numbers above still ride the Rational proxy until a real NRCS
                      // unit-hydrograph inflow is wired into the routing pass (a follow-on).
                      const methodInfo = selectDetentionMethod({ areaAcres: da, criteria });
                      const methodLine = methodInfo.method === "nrcs" ? (
                        <WatchOutChip info={`NRCS Type III unit-hydrograph analysis is the correct method past this size (curve number + a design-storm hyetograph, convolved into a runoff hydrograph) — the Modified Rational method (Q=C·i·A) this pond's routing still uses is a peak-flow-only screening tool meant for small, quick-responding areas. The routed PRE/ROUTED numbers above are NOT yet re-derived from a true NRCS hydrograph — confirm this pond's detention with an HEC-HMS model.`}>
                          Tributary area ({r2(da)} AC) exceeds the Rational method's screening range (≤{methodInfo.ceilingAcres} AC) — NRCS unit-hydrograph indicated; the routing above still uses the Rational-method proxy.
                        </WatchOutChip>
                      ) : methodInfo.method === "rational" ? (
                        <div style={smallNote}>Method: Modified Rational (tributary area {r2(da)} AC, within the {methodInfo.ceilingAcres}-ac screening range for this criteria).</div>
                      ) : null;
                      // B905 — computed Tc provenance: replaces the old flat "Time of concentration
                      // = 15 min" text with the actual Kirpich inputs, tagged ESTIMATE while the flow
                      // path / grade are still screening estimates (not yet traced from real
                      // geometry / a DEM sample — a future wire-up; the tag flips to CODE on its own
                      // once real inputs are supplied, no caller change needed).
                      const tcLine = tc ? (
                        <div style={smallNote}>
                          Time of concentration: {tc.tcMin} min
                          <SourceTag code={tc.lengthEstimated || tc.slopeEstimated ? "estimate" : "code"} label="Time of concentration" basis={tc.basis} />
                        </div>
                      ) : null;
                      // NEW-27 (owner directive 2026-07-24) — PUMPED OUTFALL, criteria-DERIVED so the
                      // developer is never asked for a pump discharge he doesn't know ("that's not
                      // something I need to be calculating"). The allowed pump rate = the jurisdiction's
                      // pumped share of the allowable release; an OPTIONAL advanced override is honored +
                      // flagged. The gravity-vs-pump feasibility line consumes the derived value. All copy
                      // is em-dash-free (this renders in the property panel, which the harness scans).
                      const pumpAllow = pumpAllowance(criteria, {
                        releaseRateCfs: relCap,
                        overrideCfs: Number.isFinite(det.pumpRateCfs) ? det.pumpRateCfs : null,
                      });
                      const gravityImpaired = Number.isFinite(tailwaterElevFt) && floorApprox < tailwaterElevFt;
                      const pumpBlock = relCap != null && pumpAllow.sharePct != null ? (
                        <div style={{ marginTop: 10, background: SURF_RAISED, border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Pumped outfall (screening)</span>
                            {pumpAllow.overridden
                              ? <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 5, color: "var(--on-accent)", background: PAL.accent }}>YOUR RATE</span>
                              : <SourceTag code={pumpAllow.verified ? "code" : "estimate"} label="Pumped share of the allowable release" basis={pumpAllow.source} />}
                          </div>
                          <div style={{ fontSize: 11, color: PAL.text, lineHeight: 1.4 }}>
                            Up to <b>{f1(pumpAllow.allowedPumpCfs)} cfs</b> can be pumped
                            {pumpAllow.overridden
                              ? " (the rate you entered)."
                              : `: ${pumpAllow.sharePct}% of the ${relCap} cfs allowable release for ${criteria.label}${pumpAllow.verified ? "." : " (ASSUMED)."}`}
                            {" "}The rest leaves by gravity.
                          </div>
                          <div style={smallNote}>You don't calculate this; it comes from the criteria. A pump is a reviewer exception (reliability, backup power). Confirm with your engineer.</div>
                          <div style={{ ...smallNote, color: gravityImpaired ? PAL.warn : PAL.muted, marginTop: 3 }}>
                            {gravityImpaired
                              ? `Gravity outfall looks unlikely here (the pond floor sits below the receiving water), so a pump up to ${f1(pumpAllow.allowedPumpCfs)} cfs is indicated.`
                              : `Gravity outfall looks feasible here, so a pump is optional (up to ${f1(pumpAllow.allowedPumpCfs)} cfs if used).`}
                          </div>
                          <Field label="Override pump rate (cfs, optional)">
                            <span style={ROW6}>
                              <NumInput allowClear style={{ ...numInput, width: 72 }} value={det.pumpRateCfs ?? ""} placeholder={`≈${f1(pumpAllow.derivedCfs)}`} min={0} onCommit={(n) => setDet({ pumpRateCfs: Number.isFinite(n) && n >= 0 ? n : null })} />
                              {pumpAllow.overridden && <button style={chipSm} title="Clear: back to the criteria-derived rate" onClick={() => setDet({ pumpRateCfs: null })}>×</button>}
                            </span>
                          </Field>
                        </div>
                      ) : null;

                      if (!outlet) {
                        const primaryLabel = relSource === "suggested" ? "⚡ Auto-size detention" : "+ Propose outlet";
                        const primaryTitle = relCap == null
                          ? "Enter a drainage area (above) so a pre-development release can be estimated"
                          : relSource === "suggested"
                            ? `One click: solves a compound outlet (orifice, plus a control weir if needed) so EVERY required storm (${criteria.requiredStorms.join("/")}-yr) passes Post ≤ Pre against the site's own pre-development peaks`
                            : `One click: solves a compound outlet so every required storm (${criteria.requiredStorms.join("/")}-yr) passes, seeded from the ${relCap} cfs allowable release`;
                        return wrap(
                          <>
                            <div style={smallNote}>Add a screening outlet to route storms through the pond and check Post ≤ Pre.</div>
                            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                              <button style={{ ...chip, padding: "6px 10px", ...(relSource === "suggested" ? { background: PAL.accent, color: "var(--on-accent)", borderColor: PAL.accent, fontWeight: 700 } : null) }} onClick={autosize} disabled={relCap == null} title={primaryTitle}>{primaryLabel}</button>
                              <button style={{ ...chip, padding: "6px 10px" }} onClick={() => writeOutlet({ stages: [{ kind: "orifice", invertElevFt: floorApprox, diameterIn: 12, count: 1 }] })}>+ Orifice</button>
                              <button style={{ ...chip, padding: "6px 10px" }} onClick={() => writeOutlet({ stages: [{ kind: "restrictor", invertElevFt: floorApprox, maxCfs: relCap ?? 1 }] })}>+ Restrictor</button>
                            </div>
                            {relCap != null && (
                              <div style={smallNote}>
                                Allowable release ≈ {relCap} cfs
                                {relSource === "code" ? ` (${criteria.allowableReleaseCfsPerAc.value} cfs/ac × ${r2(da)} AC)`
                                  : relSource === "suggested" ? ` — suggested (pre-development peak, ${suggested.governingStormYr}-yr governing)` : " (manual)"}.
                                {relSource === "suggested" && (
                                  <SourceTag code="estimate" label="Allowable release" basis={`Suggested — pre-development (undeveloped/pasture) peak discharge, Modified Rational method (runoff coefficient ${suggested.runoffC}, ${suggested.tcMin}-min time of concentration), evaluated at each required design storm (${criteria.requiredStorms.join("/")}-yr); the smallest (${suggested.governingStormYr}-yr) governs. ${criteria.label} publishes no cfs/ac release cap. A screening estimate — click Auto-size detention to accept it, or type your own release to override.`} />
                                )}
                              </div>
                            )}
                            {critLine}
                            {methodLine}
                            {tcLine}
                            {pumpBlock}
                          </>
                        );
                      }

                      const routed = assessRoutedDetention({ ring, det: effDet, outlet, criteria, areaAcres: da, impPct: imp, tailwaterElevFt, tcMin: tc?.tcMin });
                      const oProbs = outletProblems(outlet);
                      const passChip = (ok) => (
                        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 5, color: "var(--on-accent)", background: ok ? PAL.success : PAL.danger }}>{ok ? "PASS" : "SHORT"}</span>
                      );
                      // B903 — an OVERTOPPED storm is a different failure than a plain rate
                      // exceedance (too little storage vs. too much outflow) — say which, honestly.
                      const statusChip = (s) => {
                        if (s.status === "unknown") return <span style={{ fontSize: 9.5, color: PAL.muted }}>—</span>;
                        if (s.status === "pass") return passChip(true);
                        return s.overtopped
                          ? <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 5, color: "var(--on-accent)", background: PAL.danger }}>OVERTOPS</span>
                          : passChip(false);
                      };

                      return wrap(
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 10.5, color: PAL.muted }}>{stages.length} outlet stage{stages.length === 1 ? "" : "s"}</span>
                            <button style={{ ...chip, padding: "3px 8px", fontSize: 10, fontWeight: 700 }} onClick={autosize} title="Re-solve a compound outlet so every required storm passes">⚡ Auto-size</button>
                          </div>
                          {stages.map((s, i) => (
                            <div key={i} style={{ marginTop: i > 0 ? 10 : 0, paddingTop: i > 0 ? 8 : 0, borderTop: i > 0 ? `1px solid ${PAL.panelLine}` : "none" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: PAL.text }}>{roleLabel(s, i)}</span>
                                <button style={{ ...chip, padding: "1px 6px", fontSize: 9.5 }} onClick={() => removeStage(i)} title="Remove this stage">× Remove</button>
                              </div>
                              {s.kind === "orifice" && (
                                <>
                                  <Field label="Orifice ⌀ (in)"><NumInput allowClear style={{ ...numInput, width: 64 }} value={s.diameterIn ?? ""} placeholder="—" min={0} onCommit={(n) => updateStage(i, { diameterIn: Number.isFinite(n) && n > 0 ? n : null })} /></Field>
                                  <Field label="Invert elev (ft)"><NumInput allowClear style={{ ...numInput, width: 72 }} value={Number.isFinite(s.invertElevFt) ? s.invertElevFt : ""} placeholder="—" onCommit={(n) => updateStage(i, { invertElevFt: Number.isFinite(n) ? n : null })} /></Field>
                                </>
                              )}
                              {s.kind === "weir" && (
                                <>
                                  <Field label="Weir length (ft)"><NumInput allowClear style={{ ...numInput, width: 64 }} value={s.lengthFt ?? ""} placeholder="—" min={0} onCommit={(n) => updateStage(i, { lengthFt: Number.isFinite(n) && n > 0 ? n : null })} /></Field>
                                  <Field label="Crest elev (ft)"><NumInput allowClear style={{ ...numInput, width: 72 }} value={Number.isFinite(s.crestElevFt) ? s.crestElevFt : ""} placeholder="—" onCommit={(n) => updateStage(i, { crestElevFt: Number.isFinite(n) ? n : null })} /></Field>
                                </>
                              )}
                              {s.kind === "restrictor" && (
                                <>
                                  <Field label="Max release (cfs)"><NumInput allowClear style={{ ...numInput, width: 64 }} value={s.maxCfs ?? ""} placeholder="—" min={0} onCommit={(n) => updateStage(i, { maxCfs: Number.isFinite(n) && n >= 0 ? n : null })} /></Field>
                                  <Field label="Invert elev (ft)"><NumInput allowClear style={{ ...numInput, width: 72 }} value={Number.isFinite(s.invertElevFt) ? s.invertElevFt : ""} placeholder="—" onCommit={(n) => updateStage(i, { invertElevFt: Number.isFinite(n) ? n : null })} /></Field>
                                </>
                              )}
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            <button style={{ ...chip, padding: "4px 8px", fontSize: 10.5 }} onClick={() => addStage("orifice")}>+ Add orifice</button>
                            <button style={{ ...chip, padding: "4px 8px", fontSize: 10.5 }} onClick={() => addStage("weir")}>+ Add weir</button>
                            <button style={{ ...chip, padding: "4px 8px", fontSize: 10.5 }} onClick={() => writeOutlet(null)} title="Remove the outlet">× Clear outlet</button>
                          </div>
                          {oProbs.length > 0 && <div style={{ ...smallNote, color: PAL.warn }}>Outlet incomplete: {oProbs.join("; ")}.</div>}
                          {routed.kind === "routed" ? (
                            <div style={{ marginTop: 8, background: SURF_RAISED, border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.md, padding: "8px 10px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <span style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Overall: Post ≤ Pre</span>
                                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", padding: "2px 8px", borderRadius: 5, color: "var(--on-accent)", background: routed.allPass ? PAL.success : PAL.danger }}>{routed.allPass ? "PASS: every storm" : "FAIL"}</span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr 1fr auto", gap: "2px 8px", fontSize: 11, alignItems: "center" }}>
                                <span style={{ fontSize: 9.5, color: PAL.muted, fontWeight: 700 }}>STORM</span>
                                <span style={{ fontSize: 9.5, color: PAL.muted, fontWeight: 700, textAlign: "right" }}>ALLOWABLE</span>
                                <span style={{ fontSize: 9.5, color: PAL.muted, fontWeight: 700, textAlign: "right" }}>ROUTED</span>
                                <span style={{ fontSize: 9.5, color: PAL.muted, fontWeight: 700, textAlign: "right" }}>PEAK WSE</span>
                                <span style={{ fontSize: 9.5, color: PAL.muted, fontWeight: 700, textAlign: "right" }}>STORAGE</span>
                                <span />
                                {routed.perStorm.map((s) => (
                                  <Fragment key={s.returnPeriodYr}>
                                    <span style={{ fontWeight: 700 }}>{s.returnPeriodYr}-yr</span>
                                    <span style={{ textAlign: "right", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{s.preCfs ?? "—"}</span>
                                    <span style={{ textAlign: "right", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, color: s.status === "short" ? PAL.danger : PAL.text }}>{s.routedPeakCfs ?? "—"}</span>
                                    <span style={{ textAlign: "right", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{s.maxElevFt ?? "—"}</span>
                                    <span style={{ textAlign: "right", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{s.peakStorageAcFt != null ? `${f2(s.peakStorageAcFt)} AC-FT` : "—"}</span>
                                    <span style={{ textAlign: "right" }}>{statusChip(s)}</span>
                                  </Fragment>
                                ))}
                              </div>
                              {!routed.allPass && (
                                <div style={{ ...smallNote, color: PAL.danger, marginTop: 4 }}>
                                  {routed.perStorm.filter((s) => s.status !== "pass").map((s) => (
                                    <div key={s.returnPeriodYr}>{s.returnPeriodYr}-yr {s.overtopped ? "overtops the basin before the outlet can pass it" : `is short by ${s.shortByCfs} cfs`} — click ⚡ Auto-size above, or deepen/enlarge this pond ("Expand this pond" below).</div>
                                  ))}
                                </div>
                              )}
                              {routed.flags.includes("impervious-conservative") && <div style={{ ...smallNote, color: PAL.warn }}>Impervious % unknown — post-development runoff taken at the conservative upper bound.</div>}
                            </div>
                          ) : (
                            <div style={{ ...smallNote, color: PAL.warn }}>Can't route yet: {routed.reason || "missing inputs"}.</div>
                          )}
                          {/* v3 A3 — the rate-control storage question, as ONE row where it belongs
                              (next to the outlet that answers it), NOT conflated with the site's
                              volumetric detention requirement in Sizing. The ⓘ spells out that the
                              two are different questions and both must hold. */}
                          {(() => {
                            const rcStorm = det.designStorm || 100;
                            const rcReq = computeRateBasedDetention({ acres: da, impPct: imp, allowableReleaseCfs: relCap, returnPeriodYr: rcStorm });
                            const rcVal = rcReq.kind === "rate-based" ? rcReq.requiredAcFt : null;
                            const bandAcFt = detReq && detReq.kind === "point" && detReq.requiredAcFt > 0 ? detReq.requiredAcFt
                              : detReq && detReq.kind === "band" && Array.isArray(detReq.bandAcFt) ? detReq.bandAcFt[1] : null;
                            const rcTitle = `Storage needed to throttle the ${rcStorm}-yr release to the allowable rate. This is a different question from the site's volumetric detention requirement (${bandAcFt != null ? f1(bandAcFt) : "—"} AC-FT): both must hold.`;
                            return (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 7, borderTop: `1px solid ${PAL.panelLine}` }}>
                                <span style={{ fontSize: 11.5, color: PAL.muted, display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  Outlet sizing check (rate control)
                                  <RowInfo label="Outlet sizing check (rate control)" sections={[{ text: rcTitle }]} />
                                </span>
                                <span style={{ fontFamily: NUM_FONT, fontSize: 12.5, fontWeight: 700, fontVariantNumeric: TABULAR_NUMS, color: PAL.ink, whiteSpace: "nowrap" }}>{rcVal != null ? `${f1(rcVal)} AC-FT` : "—"}</span>
                              </div>
                            );
                          })()}
                          {/* FINAL UI SPEC A1.6 — the assumption sentences (pre-development runoff
                              coefficient, criteria, screening reservoir-routing caveat, time of
                              concentration) collapse into ONE Basis ⓘ; the actionable NRCS
                              method-by-area warning stays inline. */}
                          {methodLine}
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
                            <span style={{ fontSize: 9.5, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Basis &amp; assumptions</span>
                            <RowInfo label="Rate control — basis & assumptions" sections={[
                              ...(routed.kind === "routed" && routed.assumptions.length > 0 ? [{ text: routed.assumptions.join(" ") }] : []),
                              { text: `Criteria: ${criteria.label}${criteria.governingManual && criteria.governingManual.section ? ` · ${criteria.governingManual.section}` : ""}${criteria.allowableReleaseCfsPerAc ? ` · release ${criteria.allowableReleaseCfsPerAc.value} cfs/ac${criteria.allowableReleaseCfsPerAc.verified ? "" : " (unverified)"}` : criteria.postLePre ? " · Post ≤ Pre (rate-match)" : ""} · storms ${criteria.requiredStorms.join("/")}-yr.` },
                              ...(tc ? [{ text: `Time of concentration: ${tc.tcMin} min.${tc.basis ? ` ${tc.basis}` : ""}` }] : []),
                              ...(routed.caveat ? [{ text: routed.caveat }] : []),
                            ]} />
                          </div>
                          {pumpBlock}
                        </>
                      );
                    })()}
                    </Collapse>
                    {/* v3 UI SPEC B5.3 — FLOOD & DATUM: no visible paragraphs. Each note reads as
                        a one-line entry whose ⓘ carries the full text; the standalone NAVD88 chip
                        relocated here (B4). */}
                    <Collapse sectionId="pond-flood" title="Flood & datum" defaultOpen={false} summary={g_floodSummary}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 0" }}>
                        {g_split.mode === "anchored" && g_split.bands && g_split.wseFt != null && (
                          <Chip tone="neutral" text={`Detention split at ${f1(g_split.wseFt)}′`} popover={POND_FLOOD_NOTES.split} />
                        )}
                        {g_facts.floodEstimated && <Chip tone="neutral" text="Flood level estimated" popover={POND_FLOOD_NOTES.estimate} />}
                        {g_facts.inFloodway && <Chip tone="amber" text={POND_CHIP_DEFS.find((c) => c.id === "floodway").text} popover={POND_CHIP_DEFS.find((c) => c.id === "floodway").popover} />}
                        {g_facts.zoneA && <Chip tone="amber" text={POND_CHIP_DEFS.find((c) => c.id === "zonea").text} popover={POND_CHIP_DEFS.find((c) => c.id === "zonea").popover} />}
                        <Chip tone="neutral" text="Elevations: NAVD88" popover={POND_FLOOD_NOTES.datum} />
                      </div>
                    </Collapse>
                    {/* PR-N (FOLD IN) — surface the drainage-district data the server already resolves:
                        which district governs, the criteria it applies, and the receiving-channel /
                        outfall tailwater SOURCE (EST + source-tagged). No more silent server-side-only
                        district logic. */}
                    {(() => {
                      const dOverlays = (drainCtxData?.authority?.overlays || []).filter((o) => o.kind === "drainage-district");
                      const dFailed = (drainCtxData?.authority?.flags || []).includes("bkdd-unverified");
                      const inDistrict = dOverlays.length > 0;
                      const critD = critAll;
                      const authLabel = dOverlays[0]?.name || detReq?.rule?.authorityLabel || null;
                      const twR = g_twEst;
                      const dSummary = inDistrict ? dOverlays[0].name.replace("Drainage District", "DD") : dFailed ? "membership unverified" : "county criteria";
                      const critRow = (label, cell, unit) => (cell && Number.isFinite(cell.value)) ? (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: `1px solid ${PAL.panelLine}` }}>
                          <span style={{ fontSize: 11.5, color: PAL.muted }}>{label}</span>
                          <span style={ROW6}>
                            <span style={{ fontFamily: NUM_FONT, fontSize: 12, color: PAL.ink, fontWeight: 650 }}>{cell.value}{unit}</span>
                            <SourceTag code={cell.verified ? "code" : "unverified"} label={label} basis={cell.source ? [{ text: String(cell.source) }] : undefined} />
                          </span>
                        </div>
                      ) : null;
                      return (
                        <Collapse sectionId="pond-district" title="Drainage district" defaultOpen={false} summary={dSummary}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 0" }}>
                            <div style={{ fontSize: 11.5, color: PAL.text, lineHeight: 1.5 }}>
                              {inDistrict ? <>Governing district: <strong>{authLabel}</strong>. {dOverlays[0].short}</>
                                : dFailed ? "Drainage-district membership could not be verified (the boundary source was unavailable). Confirm with the county."
                                  : "This parcel is not inside a mapped drainage district; county criteria govern detention."}
                            </div>
                            {inDistrict && critRow("Freeboard", critD.freeboardFt, "′")}
                            {inDistrict && critRow("Max side slope", critD.maxSideSlope, ":1")}
                            {inDistrict && dOverlays[0].detail && (
                              <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.45 }}>{dOverlays[0].detail}</div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "3px 0", borderTop: `1px solid ${PAL.panelLine}`, marginTop: 2 }}>
                              <span style={{ fontSize: 11.5, color: PAL.muted }}>Receiving water (outfall)</span>
                              <span style={ROW6}>
                                {Number.isFinite(twR.valueFt)
                                  ? <><span style={{ fontFamily: NUM_FONT, fontSize: 12, color: PAL.ink, fontWeight: 650 }}>{f1(twR.valueFt)}′</span><SourceTag code={twR.estimated ? "estimate" : "yours"} label={twR.sourceLabel || "Receiving water"} basis={twR.sourceTip ? [{ text: twR.sourceTip }] : undefined} /></>
                                  : <span style={{ fontSize: 11, color: PAL.warn, fontWeight: 600, cursor: "help" }} title={tailwaterNote(twR)}>needs channel data</span>}
                              </span>
                            </div>
                            <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.4 }}>
                              Receiving-water level is sourced from the district channel, FEMA InFRM, a USGS gauge, or a terrain-derived channel flowline. Never site grade.
                            </div>
                          </div>
                        </Collapse>
                      );
                    })()}
                    {curStyle && (
                    <Collapse sectionId="pond-appearance" title="Appearance" defaultOpen={false} summary="fill · outline · opacity">
                      <PairedFieldHead left="Outline" right="Fill" />
                      <PairedField label="Colour"
                        left={<span style={ROW6}><ColorField value={toHex6(curStyle.stroke)} {...colorCtl((v) => setSelEl({ stroke: v }))} seed={COLOR_SEED} title="Outline color" /></span>}
                        right={<span style={ROW6}><ColorField value={toHex6(curStyle.fill)} {...colorCtl((v) => setSelEl({ fill: v }))} seed={COLOR_SEED} title="Fill color" /></span>}
                      />
                      <PairedField label="Opacity" left={strokeOpacityCell} right={fillOpacityCell} />
                      {strokeWidthRow}
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <button style={{ ...chip, flex: 1 }} onClick={setStyleDefault} title={`Use these colors for every new ${(TYPE[selEl.type]?.label || "Element")}`}>Set as default</button>
                        <button style={chip} onClick={clearElStyle} title="Revert this element to the type default">Reset</button>
                        <button style={linkBtn} onClick={() => jumpToStandards("colors")} title="New detention pond elements start from Standards → Colors">Standards → Colors ↗</button>
                        <RowInfo label="New pond defaults" sections={[{ text: "New detention pond elements start from Standards → Colors." }]} />
                      </div>
                    </Collapse>
                    )}
                    {/* v3 B7 — the shared provenance legend at the bottom of the pond panel. */}
                    <ProvenanceLegend style={{ marginTop: 12, paddingTop: 9, borderTop: `1px solid ${PAL.panelLine}` }} />
                  </div>
                );
});

export default PondInspector;
