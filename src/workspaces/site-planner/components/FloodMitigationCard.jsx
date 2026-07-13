import React from "react";
import { formatAge } from "../lib/gisCache.js";
import { NAVD88_NOTE, NEWER_MODEL_NOTE, EXCLUSIONS_NOTE, OFFSITE_NOTE, DERIVED_BFE_NOTE, DERIVED_XS_WSEL_NOTE, DERIVED_WSE02_DRAFT_NOTE, DERIVED_WSE100_DRAFT_NOTE } from "../lib/floodplainMitigation.js";

// Human-readable label for a WSE provider tag (the engine emits terse strings).
const WSE_PROVIDER_LABEL = {
  "static-bfe": "published BFE", "ao-depth": "AO depth + grade", "manual": "manual",
  "bfe-line-interp": "derived (BFE lines)", "xs-wsel": "derived (cross-sections)",
  "xs-wsel-02": "derived (cross-sections)", "fbcdd-wse02-draft": "derived (FBCDD study — DRAFT)",
  "fbcdd-wse100-draft": "derived (FBCDD study — DRAFT)", "derived-wse100": "derived (100-yr raster)",
  "mixed": "mixed",
};
const wseProvLabel = (p) => WSE_PROVIDER_LABEL[p] || p || "—";
// Human-readable label for an FFE basis (single or multi-basis / governing).
const FFE_BASIS_LABEL = {
  "wse02pct": "0.2% (500-yr) WSE", "wse1pct": "FEMA BFE", "atlas14_100yr": "Atlas-14 100-yr WSE",
  "pre_atlas14_100yr": "pre-Atlas-14 100-yr WSE", "zone_a_est_bfe": "Zone A estimated BFE",
  "site": "outside-SFHA site basis",
};
const ffeBasisText = (ffe) => {
  const g = ffe.governingBasis;
  if (g) return `${g.label || FFE_BASIS_LABEL[g.basis] || g.basis} + ${g.plusFt}′`;
  return `${FFE_BASIS_LABEL[ffe.basis] || (ffe.basis === "wse02pct" ? "0.2% WSE" : "BFE")} + ${ffe.plusFt}′`;
};

/* Floodplain mitigation & buildability card (B707/B710/B712) — rendered by
 * SitePlanner directly under the Site Analysis screen. Deliberately a SIBLING of
 * the auto-refreshing flood finding, not part of it: this card's data is
 * button-gated (the ⛆ drainage check) with its own staleness clock, and mixing the
 * two freshness models in one card would lie about data age.
 *
 * Honest states, in order: not-checked → run the check; geometry outage → UNKNOWN
 * (never clear); zero zones → a real none (verified NFHL); zones → the per-class
 * ledger with volumes or the UNKNOWN reason, hard flags loud and solid. */
export default function FloodMitigationCard({ drainage, PAL, onCheck }) {
  const d = drainage;
  const muted = PAL?.muted || "#353B49";
  const ink = PAL?.ink || "#1B1E26";
  const line = PAL?.panelLine || "#E1E5EB";
  const danger = PAL?.danger || "#b91c1c";
  const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString();
  const box = { marginTop: 8, border: `1px solid ${line}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 };
  const head = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: ink, marginBottom: 5 };
  const noteStyle = { fontSize: 10.5, color: muted, lineHeight: 1.45, marginTop: 3 };
  const warnStyle = { fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, marginTop: 4, fontWeight: 700 };
  const dangerStyle = { ...warnStyle, color: danger };
  const rowStyle = { display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0" };
  const row = (k, v, key) => (
    <div key={key || k} style={rowStyle}>
      <span style={{ color: muted }}>{k}</span>
      <span style={{ fontWeight: 650, color: ink, fontFamily: "ui-monospace, monospace", textAlign: "right" }}>{v}</span>
    </div>
  );

  if (!d || d.status === "idle" || (!d.mitigation && !d.floodGeo)) {
    return (
      <div style={box}>
        <div style={head}>Floodplain mitigation &amp; buildability</div>
        <div style={noteStyle}>
          Runs off the same explicit check as the detention criteria — fill volume owed as compensating storage, the pad's required finished floor, and the permitting pathway.
        </div>
        {onCheck && (
          <button onClick={onCheck} disabled={d?.status === "busy"} style={{ marginTop: 7, width: "100%", padding: "6px 10px", border: `1px solid ${line}`, borderRadius: 7, background: "transparent", color: ink, fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
            {d?.status === "busy" ? "Checking…" : "⛆ Check drainage criteria"}
          </button>
        )}
      </div>
    );
  }

  const mit = d.mitigation;
  const b = d.buildability;
  const geo = d.floodGeo;

  return (
    <div style={box}>
      <div style={head}>Floodplain mitigation &amp; buildability</div>

      {/* the same staleness/prior-answer honesty the Yield readout carries */}
      {d.stale && (
        <div style={warnStyle}>⚠ The site boundary or drawn fill changed since this check — re-check drainage criteria; the figures below are from the previous layout.</div>
      )}
      {d.showingPrior && (
        <div style={d.status === "busy" ? noteStyle : warnStyle}>{d.status === "busy" ? "Re-checking… showing the previous result." : `Re-check failed${d.error ? ` (${d.error})` : ""} — showing the previous result.`}</div>
      )}
      {geo && geo.state === "failed" && (
        <div style={dangerStyle}>⚠ The flood-zone geometry source is unavailable — mitigation reads UNKNOWN, never a clear. Re-check shortly.</div>
      )}
      {geo && geo.wse02Flags && geo.wse02Flags.state === "failed" && (
        <div style={warnStyle}>⚠ Fort Bend's watershed-study server didn't answer — the DRAFT 0.2% WSE couldn't be read this check (an outage is never a value). Re-check shortly or enter a 0.2% WSE.</div>
      )}
      {geo && geo.wse100Flags && geo.wse100Flags.state === "failed" && (
        <div style={warnStyle}>⚠ Fort Bend's watershed-study server didn't answer — the DRAFT 1% (100-yr) WSE couldn't be read this check (an outage is never a value). Re-check shortly or enter a BFE.</div>
      )}
      {geo && geo.state === "loaded" && geo.zoneCount === 0 && (
        <div style={noteStyle}>No mapped flood zones intersect the site envelope (FEMA NFHL, verified source) — no mitigation trigger on this screening pull.</div>
      )}
      {geo && geo.truncated && (
        <div style={warnStyle}>⚠ The flood-zone pull hit the feature cap — figures below may UNDERCOUNT; treat them as a floor, not a total.</div>
      )}

      {mit && mit.intersectAcres > 0 && (
        <>
          {/* the per-class ledger — geometry always renders, even when volumes can't */}
          {Object.entries(mit.perClass).map(([cls, bucket]) => {
            if (!(bucket.acres > 0)) return null;
            const label = cls === "1pct" ? "1% (100-yr) floodplain fill" : cls === "02pct" ? "0.2% (500-yr) band fill" : "Regulatory FLOODWAY fill";
            const val = cls === "floodway"
              ? `${f2(bucket.acres)} ac`
              : bucket.volumeCf != null
                ? `${f2(bucket.acres)} ac · ${f2(bucket.volumeCf / 43560)} ac-ft`
                : `${f2(bucket.acres)} ac · UNKNOWN`;
            return row(label, val, "cls-" + cls);
          })}
          {mit.volumeCf != null
            ? row("Required compensating storage", `${f2(mit.volumeAcFt)} ac-ft · ${f2(mit.cutCy)} cy`, "total")
            : <div style={warnStyle}>⚠ Mitigation volume UNKNOWN — {mit.unknownReason}. The intersect geometry above still stands.</div>}
          {/* B755 — the number was priced off a DERIVED BFE (FEMA BFE lines interpolated
              at the fill): say so, show the bracket + conservative bound, never let it
              read as a published value. */}
          {geo && geo.derivedBfe && mit.providers.wse1pct === "bfe-line-interp" && (
            <div style={warnStyle}>
              ⚑ BFE ≈ {f2(geo.derivedBfe.bfeFt)}′ DERIVED from FEMA's Base Flood Elevation lines
              {geo.derivedBfe.detail && geo.derivedBfe.detail.hiElev != null && geo.derivedBfe.detail.hiElev !== geo.derivedBfe.detail.loElev
                ? ` (interpolated between the ${f2(geo.derivedBfe.detail.loElev)}′ and ${f2(geo.derivedBfe.detail.hiElev)}′ contours; conservative bound ${f2(geo.derivedBfe.detail.hiElev)}′)`
                : (geo.derivedBfe.method === "nearest-line" ? " (nearest single BFE line — ±~0.5′)" : "")}
              {" "}— a screening estimate, not a published or surveyed BFE. Confirm before design; enter a BFE to override.
            </div>
          )}
          {/* B762 — the 1% WSE was read from FEMA's regulatory cross-sections (WSEL_REG at
              the nearest stream reach). A regulatory value, but still effective-model vintage. */}
          {geo && geo.derivedXsWsel && mit.providers.wse1pct === "xs-wsel" && (
            <div style={warnStyle}>
              ⚑ 1% WSE ≈ {f2(geo.derivedXsWsel.wselFt)}′ read from FEMA's regulatory cross-sections
              {geo.derivedXsWsel.detail && geo.derivedXsWsel.detail.wtrNm ? ` on ${geo.derivedXsWsel.detail.wtrNm}` : ""}
              {" "}— the effective-model regulatory water surface at the nearest reach; a jurisdiction may enforce a newer model. Enter a BFE to override.
            </div>
          )}
          {/* B770 — the 0.2% band was priced off FBCDD's Atlas-14 watershed-study raster:
              DRAFT results, so the number must never read as an effective value. B794 adds
              the BASIS distinction: Interim §9's mitigation trigger keys the PRE-Atlas-14
              0.2% (the effective 2014 FIS), so the Atlas-14 read is a labeled stand-in. */}
          {geo && geo.derivedWse02 && mit.providers.wse02pct === "fbcdd-wse02-draft" && (
            <div style={warnStyle}>
              ⚑ 0.2% WSE ≈ {f2(geo.derivedWse02.wseFt)}′ read from Fort Bend's Atlas-14 watershed-study rasters — DRAFT study results, screening only. Basis note: FBCDD Interim §9 references the PRE-Atlas-14 0.2% (effective 2014 FIS profile) — this Atlas-14 value stands in for it, labeled, not equal to it. Enter the FIS 0.2% WSE to override.
            </div>
          )}
          {/* B807 — the 1% band was priced off FBCDD's Atlas-14 per-watershed DRAFT raster
              (the unstudied-Zone-A path: NFHL publishes nothing to price from). LAST in
              precedence — any effective-model value above it wins — and the number must
              never read as an effective elevation. */}
          {geo && geo.derivedWse100 && mit.providers.wse1pct === "fbcdd-wse100-draft" && (
            <div style={warnStyle}>
              ⚑ 1% WSE ≈ {f2(geo.derivedWse100.wseFt)}′ read from Fort Bend's Atlas-14 watershed-study rasters{geo.derivedWse100.watershed ? ` (${geo.derivedWse100.watershed.replace(/_/g, " ")} watershed)` : ""} — DRAFT study results, screening only. Basis note: the county's mitigation rules reference the EFFECTIVE (pre-Atlas-14) floodplain — this Atlas-14 value stands in for it, labeled, not equal to it. Enter a BFE to override.
            </div>
          )}
          {/* B794 — sanity guard: a 0.2% surface can never sit below the 1% surface; a
              derived value that does signals a study/vintage mismatch. Flag, never clamp. */}
          {mit.flags.includes("wse02-below-1pct") && (
            <div style={warnStyle}>
              ⚠ The derived 0.2% (500-yr) WSE reads BELOW the 1% (100-yr) water surface here — physically impossible on one reach, so the two values come from mismatched studies or vintages. Don't rely on the 0.2% number; enter one from the effective FIS profile.
            </div>
          )}
          {/* BFE lines are mapped but publish a datum we can't safely compare — say why
              we still can't derive, rather than a bare UNKNOWN. */}
          {geo && geo.bfeLineFlags && geo.bfeLineFlags.usable === 0 && geo.bfeLineFlags.datumExcluded > 0 && (
            <div style={warnStyle}>⚠ FEMA Base Flood Elevation lines are mapped here but publish a non-NAVD88 datum — the tool won't derive a BFE from a mixed datum (a multi-foot silent error); enter one manually, converted to NAVD88.</div>
          )}
          {mit.flags.includes("floodway_intersect") && (
            <div style={dangerStyle}>⚑ FILL IN THE FLOODWAY IS PROHIBITED — {f2(mit.floodwayAcres)} ac of fill footprint sits in the regulatory floodway. Relocate that fill; no mitigation ratio prices it.</div>
          )}
          {mit.flags.includes("unstudied_a") && (
            <div style={warnStyle}>⚠ Unstudied Zone A on the site — BFE undetermined from the map; a flood study or the effective model sets the governing elevation.</div>
          )}
          {mit.flags.includes("datum_mismatch") && (
            <div style={warnStyle}>⚠ A zone publishes its elevation in a non-NAVD88 datum — convert before comparing (a mixed datum is a multi-foot silent error).</div>
          )}
          {d.mitigationStraddle && (
            <div style={warnStyle}>⚑ Jurisdiction straddle — every candidate priced, the worst case shown{d.mitigationStraddle.anyUnknown ? " (one candidate is UNKNOWN)" : ""}: {d.mitigationStraddle.candidates.map((c) => `${c.rule.label} ${c.result.volumeCf != null ? f2(c.result.volumeCf / 43560) + " ac-ft" : "unknown"}`).join(" · ")}.</div>
          )}
          {mit.expertBypass && <div style={noteStyle}>Expert bypass in use — volume = intersect area × the entered average fill depth.</div>}
          <div style={noteStyle}>
            Rule: {d.mitigationRule?.label} — {mit.trigger === "1pct_plus_02pct" ? "1% + 0.2% trigger" : "1% trigger"} @ {mit.ratio}:1
            {d.mitigationRule?.offsetScope === "storage_and_conveyance" ? " (offsets storage AND conveyance — large contiguous fringe fill can trigger a no-rise/hydraulic analysis beyond this volume screen)" : ""}.
            {mit.flags.includes("rule_unverified") ? " RULE UNVERIFIED — edit & confirm in settings." : ""}
          </div>
          <div style={noteStyle}>
            Providers: pad FFE {mit.providers.padElev || "—"} · grade {mit.providers.existGrade || "—"} · 1% WSE {wseProvLabel(mit.providers.wse1pct)} · 0.2% WSE {wseProvLabel(mit.providers.wse02pct)}
            {geo && geo.ts != null ? ` · flood data ${formatAge(Date.now() - geo.ts)}` : ""}
          </div>
        </>
      )}
      {mit && mit.intersectAcres === 0 && geo && geo.state === "loaded" && geo.zoneCount > 0 && (
        <div style={noteStyle}>Mapped flood zones are near, but no drawn fill footprint intersects them — mitigation volume 0 on this layout.</div>
      )}

      {b && (
        <div style={{ marginTop: 7, borderTop: `1px solid ${line}`, paddingTop: 6 }}>
          {b.ffe.status === "pass" && row("Required FFE", `${f2(b.ffe.requiredFfeFt)}′ (${ffeBasisText(b.ffe)}) — pad PASSES`, "ffe")}
          {/* NEW-3 — no pad entered: the pad defaulted to the code minimum, so this is an
              ASSUMED floor (the rule dictates it), not a verified pass on a real pad FFE. */}
          {b.ffe.status === "assumed" && (
            <>
              {row("Required FFE", `${f2(b.ffe.requiredFfeFt)}′ (${ffeBasisText(b.ffe)})`, "ffe")}
              <div style={noteStyle}>No pad entered — the pad is ASSUMED at this code minimum. Enter a finished-floor elevation to check a real design.</div>
            </>
          )}
          {b.ffe.status === "short" && (
            <div style={dangerStyle}>⚠ Pad FFE is {f2(b.ffe.shortByFt)}′ SHORT of the required {f2(b.ffe.requiredFfeFt)}′ ({ffeBasisText(b.ffe)}).</div>
          )}
          {(b.ffe.status === "unknown" || b.ffe.status === "no_rule") && (
            <div style={noteStyle}>Required FFE unknown — {b.ffe.unknownReason}.</div>
          )}
          {/* B759 — a multi-basis rule (Fort Bend) takes the MAX of several elevations
              (more-restrictive controls); bases with no input yet are named, never dropped. */}
          {b.ffe.pendingBases && b.ffe.pendingBases.length > 0 && (
            <div style={noteStyle}>The finished floor must clear the HIGHEST of several bases (more-restrictive controls governs). Not computed here yet — enter or confirm: {b.ffe.pendingBases.map((pb) => `${pb.label || pb.basis} +${pb.plusFt}′`).join(" · ")}.</div>
          )}
          {/* B770 — the governing FFE basis is the 0.2% WSE and that WSE came from the
              FBCDD DRAFT raster: the verdict itself must carry the draft caveat. */}
          {(b.ffe.status === "pass" || b.ffe.status === "short" || b.ffe.status === "assumed") && b.ffe.basis === "wse02pct" && d.wse02Src === "fbcdd-wse02-draft" && (
            <div style={warnStyle}>⚑ The 0.2% WSE behind this required FFE is a DRAFT Fort Bend watershed-study value — screening only; confirm before design.</div>
          )}
          {/* B807 variant-(b) — the governing FFE basis is the Atlas-14 100-yr and that
              value came from the FBCDD DRAFT raster: the verdict carries the caveat. */}
          {(b.ffe.status === "pass" || b.ffe.status === "short" || b.ffe.status === "assumed") && b.ffe.basis === "atlas14_100yr" && d.wse100Src === "fbcdd-wse100-draft" && (
            <div style={warnStyle}>⚑ The Atlas-14 100-yr WSE behind this required FFE is a DRAFT Fort Bend watershed-study value — screening only; confirm before design.</div>
          )}
          {b.pathway && (
            <div style={b.pathway.fillToElevate === "restricted" ? warnStyle : noteStyle}>
              {b.pathway.fillToElevate === "restricted" ? "⚠ " : ""}{b.pathway.note}
            </div>
          )}
          {b.lomr && <div style={warnStyle}>⚑ {b.lomr.note}</div>}
          {b.wetlands404 && <div style={warnStyle}>⚑ {b.wetlands404.note}</div>}
          {b.flags.includes("rule_unverified") && <div style={noteStyle}>Buildability rule unverified — edit &amp; confirm in settings.</div>}
        </div>
      )}

      <div style={{ marginTop: 7, borderTop: `1px solid ${line}`, paddingTop: 6, fontSize: 10, color: muted, lineHeight: 1.5 }}>
        {NAVD88_NOTE} {NEWER_MODEL_NOTE}
        {geo && geo.derivedBfe && <><br />{DERIVED_BFE_NOTE}</>}
        {geo && geo.derivedXsWsel && <><br />{DERIVED_XS_WSEL_NOTE}</>}
        {geo && geo.derivedWse02 && <><br />{DERIVED_WSE02_DRAFT_NOTE}</>}
        {geo && geo.derivedWse100 && <><br />{DERIVED_WSE100_DRAFT_NOTE}</>}
        <br />{EXCLUSIONS_NOTE}
        <br />{OFFSITE_NOTE} Screening only — confirm with your engineer and the reviewing authority.
      </div>
    </div>
  );
}
