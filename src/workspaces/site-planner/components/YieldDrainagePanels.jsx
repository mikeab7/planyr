/* The Yield and Drainage left-rail panels (and their private helpers), extracted from SitePlanner.jsx (B1064 step 1).
 * Presentational: every value arrives by prop; nothing here reads the planner component's state. Not lazy yet — that is the
 * next step (see B1064). @planner-extract */
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import ActionLink from "./ActionLink.jsx";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { SQFT_PER_ACRE } from "../lib/siteGeometry.js";
import { commaInt as f0, commaDec1 as f1, commaDec2 as f2 } from "../../../shared/units/numberFormat.js";
import Collapse from "./Collapse.jsx";
import { DOGEAR_W, DOGEAR_D } from "../lib/dogEar.js";
import { wasRequested } from "../lib/criteriaRequests.js";
import { useCriteriaRequest } from "../lib/useCriteriaRequest.js";
import { detentionLandTakeEstimate } from "../lib/pondGeom.js";
import WatchOutChip from "./WatchOutChip.jsx";
import RowInfo from "../../../shared/ui/RowInfo.jsx";
import { yieldVerdictStrip, TRACE_ACFT } from "../lib/yieldVerdicts.js";
import { floodStatusLine, floodDotColorToken } from "../lib/factRevalidation.js";
import { exposureHeadline, FLOOD_CLASS_LABEL } from "../lib/buildingFloodExposure.js";
import { YIELD_PAL, CostDisclosure, ProvenanceLegend, DesignChangeSummaryCard, groupHead, row, note } from "./yieldPanelParts.jsx";
import { buildDrainageBlocks } from "./drainageBlocks.jsx";
export { CostDisclosure, ProvenanceLegend, DesignChangeSummaryCard } from "./yieldPanelParts.jsx";

// ---- Site Yield panel (B225) ----------------------------------------------
// Presentational reskin of the yield readout: an identity-tile header, the three
// KPI cards, a composition donut + legend, and grouped detail rows. Every value is
// passed in from the engine's existing computation — nothing is recomputed here
// except the donut's four partition percentages, and those are derived from engine
// OUTPUTS (coverage %, impervious %, detention %), never from raw geometry. One
// semantic colour = one meaning across the donut arcs, the legend swatches, and the
// group dots, so the eye carries the same mapping everywhere.
export function YieldPanel({
  buildingCount, // v3 A6 — the BUILDINGS closed summary "{n} · {sf} SF"
  siteSqft, bldg, cov, stalls, ratio, trailers, impPct, pondArea, detPct, open,
  pondBermRingSf, // v3 C4 — site-wide berm-ring land area (ac source), for the LAND USE Pond legend title
  providedDetCf, pondCount, // B719: site-wide provided detention VOLUME (cf) + pond count — the same accumulator the drainage screen uses
  bumpCount, bumpArea, bumpsUniform, inactiveCount, easeAll, easeArea, easeBldgArea, easePaveArea,
  parcelOverlaps, // B652: {count,names,overlapAcres} when active parcels overlap, else null
  onOpenDrainage, // NEW-1 (2026-09-05) — jumps the left rail to the new Drainage panel
}) {
  const Y = YIELD_PAL;
  const acres = siteSqft / SQFT_PER_ACRE;
  const hasSite = siteSqft > 0;

  // Composition — read engine OUTPUTS, never re-derive geometry. The four shares sum
  // to 100 by construction (open is the clamped remainder), so the ring always closes.
  const buildingPct = hasSite ? cov : 0;
  const pavingPct = hasSite ? Math.max(0, impPct - cov) : 0;
  const detentionPct = hasSite ? detPct : 0;
  const openPct = hasSite ? Math.max(0, 100 - buildingPct - pavingPct - detentionPct) : 0;

  return (
    <div data-testid="yield-panel" data-flat-panel="1">
          {/* B652 warning + B715 fix: two or more ACTIVE parcels cover the same ground. Site area now
              DISSOLVES the overlap (counts it once), so the acreage is correct — but an overlap usually
              means a duplicate/stray outline worth reviewing. Non-blocking; names the offending parcels. */}
          {parcelOverlaps && (
            <div role="alert" style={{ margin: "10px 0 2px", padding: "2px 0 2px 9px", borderLeft: `3px solid ${Y.warnText}`, color: Y.warnText, fontSize: 11, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700 }}>⚠ Active parcels overlap</div>
              <div style={{ marginTop: 2 }}>{parcelOverlaps.names.join(", ")} cover the same ground (~{f2(parcelOverlaps.overlapAcres)} AC of overlap). Site area counts the shared ground once — but if one is a duplicate or stray outline, make it inactive in the Parcel panel.</div>
            </div>
          )}
          {/* v3 A5 — LAND USE: a stacked share bar + legend table + site total + impervious ratio.
              Replaces the donut, the SITE/BUILDING/COVERAGE tiles, and the standalone Impervious /
              Detention-sf/%/storage rows. Chart fills use the validated fixed palette (raw hex is
              the established data-viz exception, as the retired donut was). */}
          <Collapse sectionId="yield-land" title="Land use" defaultOpen={true} summary={hasSite ? `${f2(acres)} AC` : "no site drawn"}>
            {(() => {
              const sfShort = (sf) => sf >= 1e6 ? `${(sf / 1e6).toFixed(2)}M` : sf >= 1e3 ? `${Math.round(sf / 1e3).toLocaleString()}k` : `${Math.round(sf)}`;
              const pavingSf = Math.max(0, siteSqft * pavingPct / 100);
              const segs = [
                { key: "building", label: "Buildings", ac: bldg / SQFT_PER_ACRE, pct: buildingPct, fill: "#eda100", title: `${f0(bldg)} SF` },
                { key: "open", label: "Open space", ac: open / SQFT_PER_ACRE, pct: openPct, fill: "#008300", title: `${f0(open)} SF` },
                { key: "pond", label: "Pond", ac: pondArea / SQFT_PER_ACRE, pct: detentionPct, fill: "#2a78d6", title: pondBermRingSf > 0 ? `${f2((pondArea - pondBermRingSf) / SQFT_PER_ACRE)} AC water + ${f2(pondBermRingSf / SQFT_PER_ACRE)} AC berm (inside ${f2(pondArea / SQFT_PER_ACRE)} AC footprint)` : `${f0(pondArea)} SF water footprint` },
                { key: "paving", label: "Paving", ac: pavingSf / SQFT_PER_ACRE, pct: pavingPct, fill: "#eb6834", title: `${f0(pavingSf)} SF` },
              ];
              return (
                <>
                  <div style={{ display: "flex", height: 22, gap: 2, borderRadius: 6, overflow: "hidden", margin: "4px 0 10px", background: Y.track }}>
                    {hasSite && segs.filter((s) => s.pct > 0.05).map((s) => (
                      <div key={s.key} title={`${s.label} ${f2(s.ac)} AC · ${Math.round(s.pct)}%`} style={{ width: `${s.pct}%`, background: s.fill }} />
                    ))}
                  </div>
                  {segs.map((s) => (
                    // B944 folded the standalone "Detention %" row into this legend, so the pond's
                    // share of the site is now read here — testid'd so that assertion has a stable
                    // handle (the legend rows are otherwise addressable only by label text).
                    <div key={s.key} data-testid={`yield-landuse-${s.key}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: s.fill, flex: "none" }} />
                      <span style={{ flex: 1, fontSize: 11.5, color: Y.rowLabel, display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                        {s.label}
                        {/* NEW-1 (2026-09-05) — the pond is Yield's ONE line of consumed acreage; the
                            flood/detention/mitigation math that sized it lives in Drainage now. */}
                        {s.key === "pond" && onOpenDrainage && (
                          <ActionLink onClick={onOpenDrainage}>Drainage →</ActionLink>
                        )}
                      </span>
                      <span title={s.title} style={{ fontFamily: NUM_FONT, fontSize: 12, fontWeight: 650, color: Y.text, fontVariantNumeric: TABULAR_NUMS, whiteSpace: "nowrap", cursor: "help" }}>{f2(s.ac)} AC</span>
                      <span style={{ width: 40, textAlign: "right", fontFamily: NUM_FONT, fontSize: 11.5, color: Y.muted, fontVariantNumeric: TABULAR_NUMS }}>{Math.round(s.pct)}%</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "6px 0 0", marginTop: 4, borderTop: `1px solid ${Y.hairline}` }}>
                    <span style={{ fontSize: 11.5, color: Y.rowLabel }}>Site</span>
                    <span title={`${f0(siteSqft)} SF`} style={{ whiteSpace: "nowrap", cursor: "help" }}>
                      <span style={{ fontFamily: NUM_FONT, fontSize: 12.5, fontWeight: 650, color: Y.text, fontVariantNumeric: TABULAR_NUMS }}>{f2(acres)} AC</span>
                      <span style={{ fontSize: 10, color: Y.muted }}> · {sfShort(siteSqft)} SF</span>
                    </span>
                  </div>
                  {inactiveCount > 0 && note(`Excludes ${inactiveCount} inactive parcel${inactiveCount > 1 ? "s" : ""}: toggle in the Parcel panel.`)}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0 0", fontSize: 11, color: Y.muted }}>
                    <span>Impervious (buildings + paving)</span>
                    <span style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{f0(impPct)}%</span>
                  </div>
                </>
              );
            })()}
          </Collapse>
          {/* v3 A6 — BUILDINGS (closed). Aggregates only (per-building rows need building-level data
              not threaded to this panel); coverage lives here as a building fact, and the parking
              stall counts ride along so no drawn number is lost. */}
          <Collapse sectionId="yield-buildings" title="Buildings" defaultOpen={false} summary={hasSite ? `${buildingCount || 0} · ${f0(bldg)} SF` : "none"}>
            {row("Building", `${f0(bldg)} SF`, bumpCount ? `incl. ${bumpCount} bump-out${bumpCount > 1 ? "s" : ""}` : "")}
            {bumpCount > 0 && row("· Bump-outs", `${f0(bumpArea)} SF`, bumpsUniform ? `${bumpCount} × ${DOGEAR_W}′×${DOGEAR_D}′` : `${bumpCount} bump-out${bumpCount > 1 ? "s" : ""} · sizes vary`, true)}
            {row("Coverage", `${f0(cov)}%`)}
            {row("Car stalls", f0(stalls), ratio ? `· ${f2(ratio)}/1k sf` : "")}
            {row("Trailer stalls", f0(trailers))}
          </Collapse>
          {/* v3 B2 — the BUILDABILITY group is DELETED. Buildability is now a permanent verdict-
              strip row (see yieldVerdicts.buildabilityVerdict) — "not checked yet" with a ↻ when
              unassessed, OK/short when assessed — so a second group would only restate it. */}

          {easeAll.length > 0 && (<>
            {groupHead(Y.faint, "Easements")}
            {row("Easements", `${f2(easeArea / SQFT_PER_ACRE)} AC`, `${easeAll.length} · ${f0(easeArea)} SF gross`)}
            {row("· Restrict buildings", `${f0(easeBldgArea)} SF`, easeBldgArea ? `· ${f2(easeBldgArea / SQFT_PER_ACRE)} AC` : "", true)}
            {easePaveArea > 0 && row("· Restrict paving", `${f0(easePaveArea)} SF`, "", true)}
            {note("Gross of overlaps; subtracted from buildable area by the future yield engine.")}
          </>)}
    </div>
  );
}


// ⛔ NEW-1 (2026-09-05, owner directive — "Analysis screens, Drainage decides, Yield reports
// what is left over") — DRAINAGE is its own left-rail module, split out of what used to be
// Yield's "Stormwater" section. It OWNS: the governing authority and rule, required vs
// provided detention volume, pond sizing and the storage reconciliation, mitigation, finished-
// floor/freeboard (buildability), and the buildings-in-floodplain check. Yield keeps land-use/
// coverage/costs and shows the pond only as one line of consumed acreage that links here.
// Analysis keeps a single present/absent flood row that links here too. ONE fetch (checkDrainage,
// in SitePlanner.jsx), ONE cache (settings.drainage.lastCheck), ONE timestamp (checkedAt) —
// owned by this module, read by the other two (Yield via the Land Use pond link; Analysis via
// its one-line flood row). MODULE-SCOPE-COMPONENTS: its own top-level component, sharing only
// the module-scope `groupHead`/`row`/`note` helpers with YieldPanel (see their definitions above).
export function DrainagePanel({
  drainage, // B630–B632: required-vs-provided detention + tier + regime (null until a site exists)
  heat, // B809: { available, on, user, onToggle, totals, ledgerAcFt } — the fill-depth heat map
  onMitOpenChange, // B809: mirrors the mit group's expansion up (heat map defaults ON while open)
  floodExposure, // NEW-3: buildingFloodExposure() result — per-building footprint ∩ flood zone
  siteId, siteState, // B877440/B877441 — for the "Request criteria" action's filed row
  headerSlot, // flat-panel layout: PanelChrome's action slot, where the flood-data freshness + ↻ portals in
}) {
  // ⛔ B877440/B877441 — the "Request criteria" status + sender are the ONE shared hook (audit L3).
  const { critReqStatus, onRequestCriteria } = useCriteriaRequest(siteId, siteState);
  // NEW-1 — the drainage/mitigation readout redesign: an "Advanced" fold for the expert
  // inputs, and which auto-resolved elevation field (if any) the user has tapped to edit.
  const [drainAdvOpen, setDrainAdvOpen] = useState(false);
  const [drainEditField, setDrainEditField] = useState(null);
  // B824 — which of the three Stormwater verdict groups (det/mit/ffe) are expanded.
  // Collapsed by default: one verdict line per group is the whole closed face.
  const [drainGroupOpen, setDrainGroupOpen] = useState({});
  // B862 (chat NEW-3) — which group's "Assumptions & method ▸" fold is open. The method /
  // exclusion notes (prismoidal, tie-in slopes, NGVD29, offsite flow, …) collapse into it so
  // ≤3 lines of non-warning prose show before expansion; actionable warnings stay inline.
  const [drainMethodOpen, setDrainMethodOpen] = useState({});
  // B860 (chat NEW-1) — a transient "Recomputing…" acknowledgement: when the drainage
  // geometry signature changes, the pure math has already re-run live (synchronous), so
  // this is a ~500 ms visual cue that the edit folded in — then the changed verdicts flash
  // (FlashValue). Debounced by the sig dep: rapid edits coalesce to one settle.
  const [drainRecomputing, setDrainRecomputing] = useState(false);
  const drainSigRef = useRef(drainage?.sig);
  useEffect(() => {
    const sig = drainage?.sig;
    if (sig == null || drainSigRef.current === sig) return;
    drainSigRef.current = sig;
    setDrainRecomputing(true);
    const t = setTimeout(() => setDrainRecomputing(false), 520);
    return () => clearTimeout(t);
  }, [drainage?.sig]);
  const Y = YIELD_PAL;
  // B907 — a FORWARD-LOOKING land-take advisory: how much MORE land a detention
  // shortfall (required > provided, the SAME figures the site's "raise TOB" berm-apply
  // screen reads) would consume, at a typical screening pond depth. Advisory only —
  // never folded into the pie below, which stays 100%-consistent reflecting only what's
  // actually drawn.
  const detentionLandTake = drainage && drainage.req && drainage.req.kind === "point" && drainage.req.requiredAcFt > 0
    ? detentionLandTakeEstimate({ requiredAcFt: drainage.req.requiredAcFt, providedUsableCf: drainage.providedUsableCf, avgDepthFt: drainage.screeningPondDepthFt })
    : null;


  const drainageBlocks = drainage ? buildDrainageBlocks({ drainage, heat, onMitOpenChange, drainAdvOpen, setDrainAdvOpen, drainEditField, setDrainEditField, drainGroupOpen, setDrainGroupOpen, drainMethodOpen, setDrainMethodOpen }) : null;

  // v3 A2 — the verdict strip, computed once so the header freshness line (state D) and the
  // strip itself read one source.
  const verdictStrip = drainage ? yieldVerdictStrip(drainage) : [];
  const verdictLoading = verdictStrip.some((v) => v.loading);
  // NEW-20(a) — is a flood-data fetch actually in flight (live ↻ OR the B832 auto-revalidation)?
  // Drives the ↻ affordances' BUSY state so a click (or the on-load auto-check) is never silent:
  // the row reads "checking…", the ↻ spins and is disabled while running.
  const drainRefreshing = !!drainage && (drainage.status === "busy" || drainage.autoRefreshing);
  const floodAgeMs = drainage ? drainage.floodAgeMs : null;

  return (
    <div data-testid="drainage-panel" data-flat-panel="1">
      {/* v3 A1 — the ONE freshness element "Flood data {age} ago · ↻". Flat-panel layout (owner
          NEW-1): it is the section-level refresh action of the panel's ONE header row, so it
          portals into PanelChrome's action slot instead of drawing a header of its own. */}
      {headerSlot && drainage && drainage.onCheck && createPortal(
        <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: verdictLoading ? Y.warnText : Y.muted, whiteSpace: "nowrap", flex: "none" }}>
          {/* NEW-4 — THE LIGHT (owner: "leave it green while elements are in the same spot, once
              they're moved turn it red so we know to recheck"). One dot, no new line: green while
              the parcels / fill / ponds the last check was computed against are where they were,
              red once one of them moves, and nothing at all before a first check — a dot over a
              plan that was never checked would read as a verdict. The reason rides the hover
              (PANEL-BREVITY: a title is not visible copy), and `data-drain-freshness` lets a
              headless check assert the state without reading colours. */}
          {drainage.freshness && (drainage.freshness.state === "fresh" || drainage.freshness.state === "stale") && (
            // NEW-4 (B849713) — a stale check is a WARNING (something moved since he last ran it),
            // never an ERROR, so the dot is amber, not red — owner: "a yellow stale indicator when
            // he has run the check and has since changed elements on the plan."
            <span data-drain-freshness={drainage.freshness.state} aria-label={drainage.freshness.state === "stale" ? "Flood check is out of date" : "Flood check is up to date"}
              title={[drainage.freshness.note || "The flood check still matches what's drawn.", drainage.groundElevNote].filter(Boolean).join("\n")}
              data-ground-elev={drainage.groundElev?.status || undefined}
              data-ground-cached={drainage.groundElev?.fromCache ? "1" : undefined}
              style={{ color: floodDotColorToken(drainage.freshness.state) === "warn" ? Y.warnText : "var(--success-text)", fontSize: 9, lineHeight: 1, flex: "none" }}>●</span>
          )}
          {/* NEW-2(b) / NEW-3 — the elevation leg is the ONLY part of the check that can still be
              outstanding once the panel has published, and a failed one must never be silent. One
              muted glyph, no new line: "…" while it is still loading, "!" when the service failed
              or timed out (named in the hover). Nothing at all in the ordinary case, which is now
              the common case because the value is cached. */}
          {drainage.groundElev && (drainage.groundElev.status === "pending" || drainage.groundElev.status === "unavailable") && (
            <span data-ground-elev={drainage.groundElev.status} title={drainage.groundElevNote || undefined}
              aria-label={drainage.groundElev.status === "pending" ? "Ground elevation still loading" : "Ground elevation unavailable"}
              style={{ color: drainage.groundElev.status === "unavailable" ? Y.warnText : Y.faint, fontSize: 10, lineHeight: 1, flex: "none", cursor: "help" }}>
              {drainage.groundElev.status === "unavailable" ? "!" : "…"}
            </span>
          )}
          {/* NEW-20(a) — while a fetch is in flight the line says so ("checking…") instead of an
              unchanging "not checked", and the ↻ spins + disables so the click is never silent.
              NEW-4 (B849713, owner amendment) — a STALE check now KEEPS the last-run date instead
              of replacing it: "re-check" alone didn't say when it last ran, and he wants that date
              visible (the amber dot above already carries the "something moved" alarm, so the text
              doesn't have to). */}
          <span>{floodStatusLine({ refreshing: drainRefreshing, floodChecked: drainage.floodChecked, freshnessState: drainage.freshness?.state, floodAgeMs })}</span>
          <span aria-hidden="true" style={{ color: Y.faint }}>·</span>
          <button type="button" onClick={drainRefreshing ? undefined : drainage.onCheck} disabled={drainRefreshing} aria-busy={drainRefreshing} title={drainRefreshing ? "Re-checking the flood data…" : "Re-pull the GIS flood data for the drawn area."} style={{ border: "none", background: "none", color: verdictLoading ? Y.warnText : "var(--accent)", cursor: drainRefreshing ? "default" : "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit", padding: 0, lineHeight: 1, display: "inline-block", animation: drainRefreshing ? "spin 0.9s linear infinite" : undefined }} aria-label="Re-check flood data">↻</button>
        </span>,
        headerSlot,
      )}
          {/* v3 A2 — the VERDICT STRIP: one row per verdict, grid [40px pill | 1fr sentence |
              auto]. Word-only equal-width SHORT/OK/… pills (G5); the provided/required pair is
              bold+nowrap and renders ONCE per panel here (G1). The sentence NEVER ellipsizes — it
              renders single-line in full (item 2); the ⚡ Optimize pond button is NOT in the strip
              (the open DETENTION DETAIL below carries the labeled button), so the sentence always
              fits. A loading row shows "↻ retrying". Sorted shortfalls-first by yieldVerdictStrip.
              The freshness line lives in the header (A1). */}
          {verdictStrip.length > 0 && (() => {
            // NEW-7 — the banded chip needs a THIRD tone: "warn" (amber) for a surplus too thin to
            // rely on. Green now means real headroom, not merely "not short".
            const pillCol = { danger: ["var(--danger-bg)", "var(--danger-text)"], good: ["var(--success-bg)", "var(--success-text)"], warn: ["rgba(234,179,8,0.16)", "var(--warn-text)"], neutral: ["var(--planner-panel)", Y.muted] };
            return (
              <div style={{ margin: "10px 0 6px" }} data-testid="yield-verdict-strip">
                {verdictStrip.map((v) => (
                  <div key={v.key} data-verdict-row={v.key} style={{ padding: "4px 0", minHeight: 26 }}>
                    {/* The sentence takes the full remaining width and NEVER ellipsizes (item 2).
                        The "…" pill + "checking flood data" already convey a loading row, so no
                        competing "↻ retrying" element squeezes the sentence into an overflow. */}
                    <div style={{ minWidth: 0 }}>
                    {/* NEW-2 (B1033) — the row WRAPS. The provided/required pair keeps its bold
                        nowrap treatment (G1), but any clause appended to it (the reconciliation
                        "12.2 ac-ft counted twice", the elevation-band shortfall) is a separate
                        wrappable span, and the whole line carries the full text in a title. A single
                        nowrap headline was clipped mid-word at the panel edge — cutting off the one
                        word that carried the meaning ("…counted twi"). */}
                    <span data-testid={`yield-verdict-sentence-${v.key}`} title={v.text} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, color: Y.text, lineHeight: 1.35, whiteSpace: "normal", overflowWrap: "anywhere", minWidth: 0 }}>
                      {/* Flat rows (owner NEW-1): LABEL left, VALUE right. What the old left-gutter pill
                          said now rides the right end of the value — a tone-coloured status word (SHORT /
                          THIN / OK / N/A / FAIL), or, for a loading / pending row, the sentence itself
                          ("checking flood data", "not checked yet"), so no state is dropped. */}
                      <span data-verdict-label="1" style={{ flex: "none", color: Y.rowLabel }}>{v.label}</span>
                      <span data-verdict-value="1" style={{ flex: 1, minWidth: 0, textAlign: "right" }}>{v.pair
                        ? <b style={{ whiteSpace: "nowrap", fontWeight: 750 }}>{v.pairText || v.sentence}</b>
                        // NEW-20(a) — a recheck row reads "checking…" while its fetch is in flight,
                        // never a frozen "not checked yet" that looks like the click did nothing.
                        : <span style={{ color: v.loading || (v.recheck && drainRefreshing) ? Y.muted : Y.text }}>{v.recheck && drainRefreshing ? "checking…" : v.sentence}</span>}
                        {v.pill && v.pill !== "…" ? <span data-verdict-status={v.pill} style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", color: (pillCol[v.tone] || pillCol.neutral)[1] }}>{v.pill}</span> : null}</span>
                      {/* v3 B2 — an unassessed Buildability row (and the "set BFE" state) hangs a ↻
                          that re-pulls the flood data, since its own group was deleted. NEW-20(a): the
                          ↻ spins + disables while a fetch is in flight so the click is never silent. */}
                      {v.recheck && drainage && drainage.onCheck && (
                        <button type="button" onClick={drainRefreshing ? undefined : drainage.onCheck} disabled={drainRefreshing} aria-busy={drainRefreshing} aria-label="Re-check flood data" title={drainRefreshing ? "Re-checking the flood data…" : "Re-pull the GIS flood data for the drawn area."} style={{ border: "none", background: "none", color: "var(--accent)", cursor: drainRefreshing ? "default" : "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit", padding: 0, lineHeight: 1, flex: "none", display: "inline-block", animation: drainRefreshing ? "spin 0.9s linear infinite" : undefined }}>↻</button>
                      )}
                      {/* ⛔ B877440/B877441 — the ONE action a "no criteria on file" verdict offers.
                          Never unlocks a number; files a request Michael can see on the admin
                          page (B877442) and reads back "Requested ✓" — a second click never files
                          twice (requestCriteria checks the local mark, then the server's unique
                          index). A send that fails to reach the server says so, not "Requested". */}
                      {v.requestCriteria && (() => {
                        const rk = `${v.requestCriteria.countyKey}:${v.requestCriteria.family}`;
                        const already = critReqStatus[rk] || (wasRequested(v.requestCriteria.countyKey, v.requestCriteria.family) ? { done: true, at: wasRequested(v.requestCriteria.countyKey, v.requestCriteria.family) } : null);
                        if (already && already.done) return <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600 }}>Requested ✓ {new Date(already.at).toLocaleDateString()}</span>;
                        if (already && already.error) return (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10.5, color: "var(--danger-text)" }}>{already.error}</span>
                            <ActionLink onClick={() => onRequestCriteria(v.requestCriteria)}>Try again →</ActionLink>
                          </span>
                        );
                        return <ActionLink disabled={!!(already && already.busy)} onClick={() => onRequestCriteria(v.requestCriteria)}>{already && already.busy ? "Sending…" : `Request criteria for ${v.requestCriteria.countyLabel || "this county"} →`}</ActionLink>;
                      })()}
                      {/* NEW-16 — a trace mitigation requirement carries the raw ac-ft in the ⓘ,
                          so "not required (trace)" is honest, not a hidden number. */}
                      {v.trace && v.traceAcFt != null && (
                        <RowInfo label="Trace mitigation requirement" sections={[{ text: `The mapped floodplain clips this site by only about ${v.traceAcFt.toFixed(3)} AC-FT of storage — grid-cell crumbs where the zone edge grazes the boundary, below the ${TRACE_ACFT.toFixed(2)}-ac-ft materiality floor. Treated as not required; if the flood boundary runs close to your work area, confirm with your engineer.` }]} />
                      )}
                    </span>
                    {v.pair && v.suffix ? <div data-testid={`yield-verdict-suffix-${v.key}`} style={{ fontSize: 11, color: Y.text, lineHeight: 1.4, marginTop: 2, whiteSpace: "normal", overflowWrap: "anywhere" }}>{v.suffix}</div> : null}
                    {/* R1 — the ASSUMED coincident-storm policy stated on the verdict line whenever it
                        materially drives the usable number (never silently). Amber = ASSUMED. Hover shows
                        the citation target (BKDD Rules 22-01 + Waller Appendix E Sec 5) until it verifies. */}
                    {v.assumption && (
                      <div data-testid={`yield-verdict-assumption-${v.key}`} title={v.assumptionSource || undefined} style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.4, marginTop: 2, whiteSpace: "normal" }}>
                        Assumed: {v.assumption}.
                      </div>
                    )}
                    {/* NEW-2 — the drawdown time sits DIRECTLY under the recovery assumption it lets you
                        evaluate. Without it the assumption is unfalsifiable; with it a multi-day empty
                        time is visible on the same line of sight. */}
                    {v.assumption && v.key === "det" && drainage.drawdown && drainage.drawdown.known && drainage.drawdown.site && drainage.drawdown.site.label && (
                      <div data-testid="yield-drawdown-line" title={`${drainage.drawdown.note} Allowable release ${drainage.drawdown.releaseCfs.toFixed(2)} cfs.`} style={{ fontSize: 10.5, color: drainage.drawdown.site.tone === "ok" ? Y.muted : "var(--warn-text)", lineHeight: 1.4, marginTop: 2, whiteSpace: "normal", cursor: "help" }}>
                        At the allowed release rate the ponds take about <b>{drainage.drawdown.site.label}</b> to empty
                        {drainage.drawdown.site.tone !== "ok" ? " — longer than the recovery this assumption relies on, and longer than a shared flood-mitigation pond can be full between events." : "."}
                      </div>
                    )}
                    {/* NEW-7 — the signed margin, so a 97% surplus and a half-acre-foot surplus can
                        never look alike. Amber when thin. */}
                    {v.marginText && (
                      <div data-testid={`yield-verdict-margin-${v.key}`} title={v.thin ? `Only ${(v.margin.thinPct * 100).toFixed(0)}% headroom or less — a side-slope change, a small pad raise, or an as-built survey erases this.` : "Headroom over the requirement."} style={{ fontSize: 10.5, color: v.thin || v.short ? "var(--warn-text)" : Y.muted, lineHeight: 1.4, marginTop: 2, cursor: "help" }}>
                        Margin {v.marginText}{v.thin ? " — thin" : ""}
                      </div>
                    )}
                    {/* NEW-1 — the reconciliation failure, spelled out on the row it invalidates. */}
                    {v.reconcileFail && (
                      <div data-testid={`yield-reconcile-fail-${v.key}`} style={{ fontSize: 10.5, color: "var(--danger-text)", lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}>
                        {v.reconcileFail.message}
                      </div>
                    )}
                    {/* NEW-3 — a total that ties while the elevations do not. */}
                    {v.bandFail && (
                      <div data-testid="yield-band-fail" style={{ fontSize: 10.5, color: "var(--danger-text)", lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}>
                        The acre-foot totals {v.bandFail.totalWouldPass ? "tie, but the elevations do not" : "and the elevations both fall short"}: {v.bandFail.shortBands} one-foot band{v.bandFail.shortBands === 1 ? "" : "s"} of lost storage {v.bandFail.shortBands === 1 ? "is" : "are"} not replaced where {v.bandFail.shortBands === 1 ? "it was" : "they were"} taken. A one-to-one offset has to be matched foot for foot.
                      </div>
                    )}
                    {/* ── NEW-8 — NAME the entity whose floodplain standard produced the FFE. Three
                        candidate authorities on one site (county · city ETJ · edge city) with
                        materially different rules is not a footnote — it IS the elevation. This
                        rides the Buildability strip row because the old Buildability GROUP was
                        deleted (v3 B2) and buildability now lives here. */}
                    {/* B209508 — an UNRESOLVED jurisdiction outranks the rule line. When a jurisdiction
                        lookup failed, the candidate set is incomplete by construction, so naming a
                        "rule applied" would present the laxer surviving authority as settled. Say
                        what could not be checked instead, and keep the provisional answer clearly
                        labelled as provisional. */}
                    {v.key === "ffe" && drainage.administrator && drainage.administrator.unresolved && (
                      <div data-testid="yield-ffe-unresolved" style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}
                        title={drainage.administrator.unresolvedNote || ""}>
                        {/* NEW-2 — pending and failed are different facts and read differently: one
                            resolves on its own, the other needs a re-check. */}
                        <b>FFE rule not settled</b> — {drainage.administrator.unresolvedRoles.length
                          ? `${drainage.administrator.unresolvedRoles.map((r) => `the ${r} lookup failed`).join(" and ")}, so a stricter authority may apply that we could not check.`
                          : "the jurisdiction is still being looked up, and a city ETJ can impose a stricter floodplain rule than the county."}
                        {drainage.administrator.governingLabel ? ` Provisionally ${drainage.administrator.governingLabel}${drainage.administrator.governingRuleText ? ` (${drainage.administrator.governingRuleText})` : ""} — do not rely on it until the jurisdiction is confirmed.` : ""}
                      </div>
                    )}
                    {/* NEW-1a — a site that straddles a city limit has TWO floodplain authorities,
                        so the one number above is wrong for one group of lots. This outranks the
                        "Rule applied" line for the same reason the unresolved state does. */}
                    {v.key === "ffe" && drainage.administrator && !drainage.administrator.unresolved && drainage.administrator.split && (
                      <div data-testid="yield-ffe-split" style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}
                        title={drainage.administrator.splitNote || ""}>
                        <b>Two floodplain rules on this site</b> — {drainage.administrator.splitDetail?.inCity != null && drainage.administrator.splitDetail?.tested != null
                          ? `${drainage.administrator.splitDetail.inCity} of ${drainage.administrator.splitDetail.tested} drawn lots sit inside the City of ${drainage.administrator.splitDetail.city} and the rest do not`
                          : `part of the site is inside the City of ${drainage.administrator.splitDetail?.city} and part is not`}, so one finished-floor figure cannot be right for both. Confirm which parcels each rule covers before setting pads.
                        {/* PANEL-BREVITY rule 5 — state it once. When the unmodelled line below is
                            also showing it already names the governing authority and its rule, so
                            repeating it here printed the same fact twice on the owner's own site. */}
                        {drainage.administrator.governingLabel && !drainage.administrator.unmodelledCandidates?.length
                          ? ` Shown: ${drainage.administrator.governingLabel}${drainage.administrator.governingRuleText ? ` (${drainage.administrator.governingRuleText})` : ""}.` : ""}
                      </div>
                    )}
                    {/* ⛔ NEW-1d — THIS RENDERS ALONGSIDE A SPLIT, NOT INSTEAD OF ONE. It was gated
                        on `!split`, and Goose Creek — the site the whole item was built for — is
                        BOTH split and unmodelled, so the "no rule for Baytown" fact never reached
                        the screen on the one plan that needed it. Split and unmodelled are
                        independent facts about different things (how many authorities, versus
                        whether we hold their rules); wiring them mutually exclusive hid one.

                        AND IT NAMES THE DEFAULT. An unsettled FFE must never read as "no
                        requirement" — while the missing ordinance is unanswered the app falls back
                        to the authority it DOES have, so that authority, its rule and its elevation
                        are stated outright rather than alluded to as "the authorities we do
                        have". */}
                    {v.key === "ffe" && drainage.administrator && !drainage.administrator.unresolved
                      && drainage.administrator.unmodelledCandidates?.length > 0 && (
                      <div data-testid="yield-ffe-unmodelled" style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}
                        title={drainage.administrator.unmodelledNote || ""}>
                        <b>No rule on file for {drainage.administrator.unmodelledCandidates.map((u) => u.label).join(" and ")}</b> — {drainage.administrator.unmodelledCandidates.length === 1 ? "it administers" : "they administer"} part of this site.
                        {drainage.administrator.governingLabel
                          ? ` Using ${drainage.administrator.governingLabel}${drainage.administrator.governingRuleText ? ` (${drainage.administrator.governingRuleText})` : ""} meanwhile${Number.isFinite(v.provisionalFfeFt) ? `, so pads screen at ${f1(v.provisionalFfeFt)}′` : ""} — a floor, not the final answer.`
                          : ""}
                      </div>
                    )}
                    {v.key === "ffe" && drainage.administrator && !drainage.administrator.unresolved && !drainage.administrator.split
                      && !drainage.administrator.unmodelledCandidates?.length && drainage.administrator.governingLabel && (
                      <div data-testid="yield-ffe-administrator" style={{ fontSize: 10.5, color: drainage.administrator.ambiguous ? "var(--warn-text)" : Y.muted, lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}
                        title={`${drainage.administrator.selectionReason} Candidates: ${drainage.administrator.candidates.map((c) => c.label).join(" · ")}. ${drainage.administrator.governingSource || ""}`}>
                        Rule applied: <b>{drainage.administrator.governingLabel}</b>
                        {drainage.administrator.governingRuleText ? ` (${drainage.administrator.governingRuleText})` : ""}
                        {drainage.administrator.ambiguous ? " — more than one authority could govern here, so the stricter rule was used. Confirm who issues the permit." : ""}
                        {/* B209508 — never let "the stricter rule was used" stand unqualified when the
                            candidates measure from different flood surfaces and only their freeboard
                            was compared. */}
                        {drainage.administrator.basisMismatch ? " These authorities measure from different flood surfaces and only their freeboard was compared, so a rule with less freeboard could still govern." : ""}
                        {drainage.administrator.impliedFlood ? ` That floor implies the flood level here is at or below ${f1(drainage.administrator.impliedFlood.impliedFloodElevFt)}′ — worth checking against the FIRM panel.` : ""}
                      </div>
                    )}
                    {/* NEW-9 — the truck court sits below the finished floor and is checked apart
                        from the pad. Pavement is not a structure, so this is exposure, never a code
                        verdict — the copy says so. */}
                    {v.key === "ffe" && drainage.apron && drainage.apron.status !== "unknown" && (
                      <div data-testid="yield-apron-row" style={{ fontSize: 10.5, color: drainage.apron.status === "exposed" ? "var(--danger-text)" : drainage.apron.status === "thin" ? "var(--warn-text)" : Y.muted, lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}
                        title="Truck-court and paving fill is priced into the compensating-storage requirement, not only the building pads.">
                        Truck court: {drainage.apron.note}
                      </div>
                    )}
                    {/* AUDIT-FIRST fix found while wiring NEW-8/9: the Buildability DETAIL rows
                        (`ffeR` — the required-FFE basis, the DRAFT/estimated-WSE warnings, the
                        LOMR-F pathway note, the SITE-BASED suggested-pad chip) were still being
                        BUILT but never rendered anywhere: v3 B2 deleted the Buildability GROUP that
                        used to host them and nothing re-homed its contents, so every one of those
                        honesty lines had been silently invisible. Buildability now lives on this
                        strip row, so its detail renders here — no second header, nothing restated. */}
                    {v.key === "ffe" && drainageBlocks && drainageBlocks.ffeR && drainageBlocks.ffeR.length > 0 && (
                      <div data-testid="yield-ffe-detail" style={{ marginTop: 3 }}>{drainageBlocks.ffeR}</div>
                    )}
                    {/* NEW-4 — the requirement could not be priced against the flood line the
                        jurisdiction actually requires, so it understates. Say so. */}
                    {v.understated && (
                      <div style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, marginTop: 2, whiteSpace: "normal" }}>
                        This requirement was worked out from the 100-year flood line because no 500-year level is known here — {drainage.offsetSurface ? drainage.offsetSurface.authority : "this county"} owes the offset up to the 500-year line, so the figure is understated.
                      </div>
                    )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          {/* v3 A3/A4 — DETENTION DETAIL (open) + MITIGATION DETAIL (only when required) render as
              top-level groups directly off the drainage blocks; no "Stormwater" wrapper, and no
              Impervious / Detention-sf / Detention-% / Detention-storage rows (those moved to LAND
              USE and the pond inspector's Holds). */}
          {drainageBlocks && drainageBlocks.sw}
          {/* B907 — a detention shortfall's estimated additional land take (advisory only). */}
          {detentionLandTake && (
            <WatchOutChip
              style={{ margin: "6px 2px 8px" }}
              info={`Detention is short ${f1(detentionLandTake.deficitAcFt)} AC-FT against the required volume (site total). At a typical ${detentionLandTake.avgDepthFt}-ft screening pond depth, that shortfall would take roughly ${f2(detentionLandTake.footprintAc)} more acres of land than this plan currently shows drawn: a screening estimate (footprint ≈ volume / assumed depth), not a sized or placed pond. Size/expand a basin to confirm the real footprint.`}
            >
              Detention shortfall ≈ +{f2(detentionLandTake.footprintAc)} AC more land (screening estimate)
            </WatchOutChip>
          )}
          {/* NEW-3 — IN THE FLOODPLAIN? The number, not the picture. Verdict + one figure on the
              headline row; the per-building breakdown only when a building is actually exposed,
              and the honest non-answers ("didn't answer", "not pulled yet") never read as a
              clean zero. NEW-1 (2026-09-05) — promoted from a sub-section of Yield's Buildings
              group to its own Drainage collapse: buildings-in-floodplain is a drainage question. */}
          <Collapse sectionId="drainage-buildings" title="Buildings in the floodplain" defaultOpen={false}
            summary={(() => {
              const fx = floodExposure;
              if (!fx || fx.state === "no-buildings") return "none";
              const head = exposureHeadline(fx);
              return head ? head.text : "—";
            })()}>
            {/* NEW-3 — IN THE FLOODPLAIN? The number, not the picture. Verdict + one figure on the
                headline row; the per-building breakdown only when a building is actually exposed,
                and the honest non-answers ("didn't answer", "not pulled yet") never read as a
                clean zero. Lives inside this Collapse, so it costs the default view nothing. */}
            {(() => {
              const fx = floodExposure;
              if (!fx || fx.state === "no-buildings") return null;
              const head = exposureHeadline(fx);
              if (!head) return null;
              const TONE = { ok: Y.muted, warn: "var(--warn-text)", alert: "var(--danger)", unknown: "var(--warn-text)" };
              const hit = fx.state === "ok" ? fx.buildings.filter((b) => b.governing) : [];
              return (
                <>
                  {row("In the floodplain?", <span style={{ color: TONE[head.tone] || Y.text }}>{head.text}</span>,
                    fx.state === "ok" && fx.total.touched ? `${head.detail} · ${f0(fx.total.areaSf)} SF` : head.detail || "")}
                  {/* One line per EXPOSED building only — a clear building is already covered by
                      the headline, so listing it again would be words for no information. */}
                  {hit.map((b) => row(
                    `· ${b.label || `Building ${fx.buildings.indexOf(b) + 1}`}`,
                    `${b.pct.toFixed(b.pct < 10 ? 1 : 0)}%`,
                    [FLOOD_CLASS_LABEL[b.governing.cls] || b.governing.cls,
                      b.governing.zone ? `Zone ${b.governing.zone}` : null,
                      b.governing.unstudied ? "BFE undetermined" : (b.governing.bfeFt != null ? `BFE ${b.governing.bfeFt.toFixed(1)}′` : "no published BFE"),
                    ].filter(Boolean).join(" · "),
                    true,
                  ))}
                  {fx.state === "ok" && fx.total.touched > 0 && note("Screening overlap sampled off the FEMA map — good to about a percent, not a survey.")}
                </>
              );
            })()}
          </Collapse>
    </div>
  );
}
