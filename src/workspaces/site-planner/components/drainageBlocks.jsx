/* buildDrainageBlocks — the Detention / Mitigation / FFE verdict groups of the Drainage panel, moved verbatim out of
 * DrainagePanel's render body (audit batch L3). It is a pure function of `ctx` (the panel's props, state and setters);
 * it was an inline IIFE closing over those same names. @planner-extract */
import ActionLink from "./ActionLink.jsx";
import { bulletBarLayout, stackedBarLayout, ACFT_EPS } from "../lib/yieldBar.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import SourceTag from "./SourceTag.jsx";
import { SQFT_PER_ACRE } from "../lib/siteGeometry.js";
import { commaInt as f0, commaDec1 as f1, commaDec2 as f2 } from "../../../shared/units/numberFormat.js";
import WatchOutChip from "./WatchOutChip.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { CF_PER_ACFT } from "../../../shared/units/areaUnits.js";
import { NJNY_NOT_WIRED_FLAGS } from "../lib/njnyJurisdiction.js";
import { ruleBadge, AUTHORITY_SHORT } from "../lib/detentionRules.js";
import { NAVD88_NOTE, NEWER_MODEL_NOTE, EXCLUSIONS_NOTE, OFFSITE_NOTE, DERIVED_BFE_NOTE, DERIVED_XS_WSEL_NOTE, DERIVED_WSE02_DRAFT_NOTE, DERIVED_WSE100_DRAFT_NOTE, BKDD_DATUM_NOTE, isEstimatedWseSrc, estWseNote, wseProvLabel, ffeBasisText } from "../lib/floodplainMitigation.js";
import RowInfo from "../../../shared/ui/RowInfo.jsx";
import { formatAge } from "../lib/gisCache.js";
import { fmtSignedAcFt } from "../lib/yieldVerdicts.js";
import { classifyWseSource } from "../lib/provenance.js";
import { floodJurCounty } from "../lib/floodplainRules.js";
import { OUTSIDE_FLOODPLAIN_FFE_NOTE, SITE_BASED_FFE_NOTE } from "../lib/buildability.js";
import { screeningStudyNote, screeningDeclined } from "../lib/screeningBfeCopy.js";
import { EST_FLIP_LABEL, ROWB6, ROWSB } from "../lib/plannerShared.js";
import { NumInput } from "./NumInput.jsx";
import { YIELD_PAL, FlashValue, StatusChip, InlineDisclosure, BulletBar, row, note } from "./yieldPanelParts.jsx";

export function buildDrainageBlocks(ctx) {
  const {
    drainage, heat, onMitOpenChange,
    drainAdvOpen, setDrainAdvOpen, drainEditField, setDrainEditField, drainGroupOpen, setDrainGroupOpen, drainMethodOpen, setDrainMethodOpen,
  } = ctx;
  const Y = YIELD_PAL;
  const d = drainage;
  // B823 — warn notes are hard-capped at ONE line (≤110 chars, unit-guarded); the
  // teaching/detail copy rides an optional ⓘ hover (native title — the infoRow pattern).
  // B895 — one shared WatchOutChip definition draws every item-specific watch-out in
  // this panel consistently (⚠ + non-italic bold amber); the (text, key, info)
  // signature is UNCHANGED so every existing call site below still works, and so
  // test/drainageNoteLength.test.js's `warnNote(` scan still finds them all.
  const warnNote = (text, key, info) => <WatchOutChip key={key} info={info}>{text}</WatchOutChip>;
  // B862 — keyedNote is the METHOD/basis/exclusion note (muted, non-actionable). It's
  // tagged data-note="method" so groupFold folds it into "Assumptions & method ▸";
  // actionable warnings use warnNote (which stays inline).
  const keyedNote = (text, key) => <div key={key} data-note="method" style={{ fontSize: 10.5, color: Y.muted, lineHeight: 1.4, margin: "3px 0 0" }}>{text}</div>;
  // NEW-1 — verdict-first density: ONE line per concept (value or honest state) with
  // the basis / source / caveats tucked into an ⓘ hover (native title — the Impervious-
  // row pattern), so the ~30-row floodplain-101 wall collapses. `info` is the teaching
  // copy; `tone` colours the value (warn/danger) without fading the label (theming rule).
  // B895 — `opts.tag` is an optional { code, basis } SourceTag, right-aligned next to
  // the value for the panel's headline figures.
  const infoRow = (label, value, info, opts = {}) => {
    const { tone, sub, key, tag } = opts;
    const vColor = tone === "danger" ? Y.dangerText : tone === "warn" ? Y.warnText : Y.text;
    return (
      <div key={key || label} title={info || ""} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "5px 0", borderBottom: `1px solid ${Y.hairline}`, cursor: info ? "help" : "default" }}>
        <span style={{ fontSize: 12, color: Y.rowLabel }}>{label}{info ? <span style={{ fontSize: 9.5, color: Y.muted, marginLeft: 4 }} aria-hidden="true">ⓘ</span> : null}</span>
        <span style={ROWB6}>
          <span style={{ fontFamily: NUM_FONT, fontSize: 13, color: vColor, fontWeight: 650, fontVariantNumeric: TABULAR_NUMS, textAlign: "right" }}>
            {value}{sub ? <span style={{ color: Y.muted, fontWeight: 400, fontSize: 10.5 }}> {sub}</span> : null}
          </span>
          {tag ? <span onClick={(e) => e.stopPropagation()}><SourceTag code={tag.code} label={label} basis={tag.basis} /></span> : null}
        </span>
      </div>
    );
  };
  // B862 (chat NEW-3) — jump-to-field: open the mitigation group, reveal the target
  // input (autoField rows carry id="drain-field-<key>"), scroll it into view + focus it.
  // So an actionable warning offers the FIX, not prose alone ("Set BFE →").
  const jumpToDrainField = (fieldKey) => {
    setDrainGroupOpen((s2) => ({ ...s2, mit: true }));
    if (fieldKey) setDrainEditField(fieldKey);
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => {
      const el = typeof document !== "undefined" ? document.getElementById("drain-field-" + fieldKey) : null;
      if (el) { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} const inp = el.querySelector("input"); if (inp) try { inp.focus(); } catch (_) {} }
    });
  };
  // An actionable warning that carries its fix affordance (a jump-to-field button),
  // distinct from the prose-only warnNote. Text stays one line (≤110); detail rides ⓘ.
  // B895 — the fix button is an ActionLink (the global interactive accent), no longer
  // amber, so an ACTION never reads as a passive ESTIMATE-tone watch-out chip.
  const actionWarn = (text, key, info, onAction, actionLabel) => (
    <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", margin: "4px 0 0" }}>
      <WatchOutChip info={info} style={{ margin: 0, flex: 1, minWidth: 0 }}>{text}</WatchOutChip>
      {onAction ? <ActionLink onClick={onAction}>{actionLabel || "Set →"}</ActionLink> : null}
    </div>
  );
  // B750 — one segmented button for the Auto/Yes/No channel control (mirrors the
  // per-pond Outfall toggle). Selected rides the global accent + --on-accent text.
  const seg = (label, selected, onClick, key, aria = "Drains to HCFCD channel") => (
    <button key={key} onClick={onClick} aria-label={`${aria}: ${label}`} aria-pressed={selected} style={{ flex: 1, padding: "4px 6px", borderRadius: RADIUS.sm, border: `1px solid ${selected ? "var(--accent)" : Y.border}`, background: selected ? "var(--accent)" : Y.cardBg, color: selected ? "var(--on-accent)" : Y.text, fontWeight: 700, fontSize: 10.5, fontFamily: "inherit", cursor: "pointer" }}>{label}</button>
  );
  // B750 — the two overridable assumptions, grouped so the user can correct either:
  // which agency reviews drainage, and whether the site drains to an HCFCD channel.
  const assumptionsBlock = () => {
    const cd = d.channelDischarge, ac = d.authorityChoice, ot = d.outfallType;
    const showAuth = ac && (ac.detectedId || ac.override);
    const showChan = cd && cd.relevant;
    const showOutfall = ot && ot.relevant;
    // B1080 — the governing-district line for a NON-HCFCD site (BKDD, or nowhere).
    const dn = d.districtNote;
    if (!showAuth && !showChan && !showOutfall && !dn) return null;
    const rows = [];
    if (showAuth) rows.push(
      <div key="auth" style={ROWSB}>
        <span style={{ fontSize: 11, color: Y.rowLabel }}>Reviewing agency</span>
        <select value={ac.override || ""} onChange={(e) => ac.onSet(e.target.value || null)}
          style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6, border: `1px solid ${Y.border}`, background: Y.cardBg, color: Y.text, fontFamily: "inherit", maxWidth: 180 }}>
          <option value="">Auto{ac.detectedLabel ? ` · detected: ${ac.detectedLabel}` : ""}</option>
          {ac.choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
    );
    if (showChan) {
      const det = cd.detected;
      const unit = det && det.unitNo ? `Unit ${det.unitNo}` : "an HCFCD channel";
      const nm = det && det.name ? ` (${det.name})` : "";
      const dist = det && det.distFt != null ? ` within ~${Math.round(det.distFt)} ft` : "";
      const defers = d.reviewer?.authorityId === "coh" && (d.acres || 0) > 20
        ? " At over 20 acres, City of Houston still defers to HCFCD's rate, so it's included regardless — only a smaller tract would use Houston's rate alone." : "";
      let msg, warn = false;
      if (cd.source === "override" && cd.override === true) msg = "You confirmed this site drains to an HCFCD channel — HCFCD's rate applies (no assumption).";
      else if (cd.source === "override" && cd.override === false) msg = "You marked this site as NOT draining to an HCFCD channel." + defers;
      else if (det && det.near === true) msg = `HCFCD channel detected — ${unit}${nm}${dist}. Assuming your detention discharges to it, so HCFCD's rate is included. Not right? Set this to No.`;
      else if (det && det.near === false) { msg = "No HCFCD channel found near your site. If one runs through it — you can see it on the aerial — set this to Yes."; warn = true; }
      else { msg = "Couldn't confirm from HCFCD's map server whether a channel is adjacent — the stricter reading is shown. Set Yes or No to tell the tool directly."; warn = true; }
      rows.push(
        <div key="chan" style={{ marginTop: showAuth ? 6 : 0 }}>
          <div style={ROWSB}>
            <span style={{ fontSize: 11, color: Y.rowLabel }}>Drains to HCFCD channel</span>
            <span style={{ display: "flex", gap: 4, width: 156 }}>
              {seg("Auto", cd.override == null, () => cd.onSet(null), "a")}
              {seg("Yes", cd.override === true, () => cd.onSet(true), "y")}
              {seg("No", cd.override === false, () => cd.onSet(false), "n")}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: warn ? Y.warnText : Y.muted, lineHeight: 1.45, margin: "3px 0 0", fontStyle: warn ? "italic" : "normal" }}>{msg}</div>
        </div>
      );
    }
    // PANEL-BREVITY: NO label row. The sentence names the governing authority in its
    // own first words ("BKDD governs drainage here — …"), so a "Drainage authority"
    // caption above it would restate the line it labels. Net visible-copy change: zero.
    if (dn) rows.push(
      <div key="district" style={{ marginTop: rows.length ? 6 : 0, fontSize: 10.5, color: dn.tone === "warn" ? Y.warnText : Y.muted, lineHeight: 1.45, fontStyle: dn.tone === "warn" ? "italic" : "normal" }}>{dn.text}</div>
    );
    if (showOutfall) {
      const ov = ot.value;
      const otNote = ov === "stormSewer"
        ? "Storm-sewer outfall — unincorporated Harris County's minimum detention is 0.75 AC-FT/AC."
        : ov === "roadsideDitch"
        ? "Roadside-ditch outfall — unincorporated Harris County's minimum detention is 1.0 AC-FT/AC."
        : "Unincorporated Harris County sets the minimum detention by how the site drains out: to a storm sewer → 0.75, to a roadside ditch → 1.0 AC-FT/AC. Pick one for a single number; left on Auto, the 0.75–1.0 range is shown.";
      rows.push(
        <div key="outfall" style={{ marginTop: rows.length ? 6 : 0 }}>
          <div style={ROWSB}>
            <span style={{ fontSize: 11, color: Y.rowLabel }}>Outfall type</span>
            <span style={{ display: "flex", gap: 4, width: 200 }}>
              {seg("Auto", ov == null || ov === "unknown", () => ot.onSet(null), "a", "Outfall type")}
              {seg("Storm sewer", ov === "stormSewer", () => ot.onSet("stormSewer"), "s", "Outfall type")}
              {seg("Ditch", ov === "roadsideDitch", () => ot.onSet("roadsideDitch"), "d", "Outfall type")}
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: Y.muted, lineHeight: 1.45, margin: "3px 0 0" }}>{otNote}</div>
        </div>
      );
    }
    // NEW-2 — this is an INPUTS group ("Assumptions — correct if needed"), never a
    // stale-notice container. Fetch staleness surfaces in EXACTLY ONE place — the status
    // line above — so the header no longer morphs into the dev-speak "the fetch predates
    // the drawn area" banner, and the border no longer demotes to dashed on stale (that
    // read as trapping the reviewing-agency selector inside a warning box).
    return (
      <div key="assumptions" data-flat-group="assumptions" style={{ marginTop: 7, borderTop: `1px solid ${Y.border}`, padding: "8px 0 2px" }}>
        <div title={d.channelDischarge?.overrideIgnored ? "HCFCD n/a outside Harris: saved channel answer ignored." : ""} style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: Y.rowLabel, marginBottom: 4, cursor: d.channelDischarge?.overrideIgnored ? "help" : undefined }}>Assumptions: correct if needed{d.channelDischarge?.overrideIgnored ? <span style={{ fontSize: 9, marginLeft: 4, letterSpacing: 0 }} aria-hidden="true">ⓘ</span> : null}</div>
        {rows}
      </div>
    );
  };
  // First-time idle (no prior answer) → the check button + intro.
  if (d.status !== "ready" && !d.showingPrior) {
    return (
      <div style={{ marginTop: 7 }}>
        <button
          disabled={d.status === "busy"}
          onClick={d.onCheck}
          style={{ width: "100%", padding: "7px 10px", border: `1px solid ${Y.border}`, borderRadius: RADIUS.md, background: Y.cardBg, color: Y.text, fontWeight: 700, fontSize: 11.5, cursor: d.status === "busy" ? "default" : "pointer" }}
        >{d.status === "busy" ? "Checking drainage criteria…" : "⛆ Check drainage criteria"}</button>
        {d.status === "error"
          ? warnNote(`Couldn't resolve the drainage authority — ${d.error}. Try again.`)
          : note("Resolves who reviews this site's drainage and the required detention volume.")}
      </div>
    );
  }
  const req = d.req;
  const providedAcFt = d.providedCf / CF_PER_ACFT;
  // NEW-9 — null = the usable split is UNKNOWN (restored check without the
  // per-pond facts): every consumer below must render "re-check", never gross.
  const usableAcFt = d.providedUsableCf == null ? null : d.providedUsableCf / CF_PER_ACFT; // Regime B: minus permanent-pool dead storage
  const out = [];
  // B788/B791 — a remembered or stale check must read PAST tense with its date;
  // only a live check this session may claim present-tense "detected".
  const checkedOnDate = d.lastCheckedAt ? new Date(d.lastCheckedAt).toLocaleDateString() : null;
  const detectedPhrase = (d.restored || d.stale) && checkedOnDate
    ? `(from city-limits GIS, checked ${checkedOnDate})`
    : "(detected from city-limits GIS)";
  // NEW-1(e)/B860 — ONE status line. The old "⚠ site boundary changed since; numbers
  // below reflect the old boundary" banner is GONE: the detention/mitigation/pond/FFE
  // math recomputes LIVE off the cached facts, so a pure in-envelope edit never demotes
  // the numbers (a click's worth of staleness on pure math was the whole bug). Only the
  // FETCH can go stale — d.fetchStale, the drawn area outgrowing the fetched flood
  // envelope. Auto on → that self-heals ("Refreshing…", the numbers stay live); auto off
  // or a failed refresh → an honest last-good + ↻ prompt (LOUD-FAILURE, never blank). A
  // fresh edit shows a transient "Recomputing…" then the changed verdicts flash. The
  // fetched flood data's age rides every line so a stale pull is never mistaken for now.
  {
    // v3 A1 — the steady-state "As of … · live check · {mode}" clock and its standalone
    // "↻ Re-check" pill are DELETED: the header's single "Flood data {age} ago · ↻" line
    // is the only freshness element, and it turns amber while a verdict is blocked loading
    // (state D). The retry behavior stays: a genuine FAILURE / stale-pull state still
    // surfaces LOUD (LOUD-FAILURE) as a warn banner here, with its own ↻ retry.
    const busy = d.status === "busy";
    let statusText = null;
    if (d.showingPrior && !busy) statusText = `Couldn't refresh: showing the last good result${checkedOnDate ? ` (as of ${checkedOnDate})` : ""}.`;
    else if (d.fetchStale && !d.autoEnabled) statusText = "⚠ The flood pull predates the drawn area: re-check to screen the new footprint.";
    else if (d.autoStalled) statusText = "Flood data is temporarily unavailable: estimates shown may update once it loads.";
    if (statusText) {
      out.push(
        <div key="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "7px 0 2px", border: `1px solid ${Y.warnText}`, borderRadius: 8, padding: "6px 9px", background: Y.cardBg }}>
          <span title={d.showingPrior && d.error ? `Refresh error: ${d.error}` : ""} style={{ fontSize: 11, color: Y.warnText, fontWeight: 700, lineHeight: 1.4, cursor: d.showingPrior && d.error ? "help" : undefined }}>{statusText}</span>
          <ActionLink onClick={d.onCheck} disabled={busy} title="Refresh the GIS fetch (flood zones + reviewing authority). The detention / mitigation / pond numbers already recompute live on every edit; this only re-pulls the map data.">↻ Re-check</ActionLink>
        </div>
      );
    }
  }
  // B824 — ONE drainage home. Below the status line the readout is organized as
  // three COLLAPSED verdict groups (Detention · Floodplain mitigation · Buildability
  // / FFE): one verdict line each when closed; the detail that used to live on the
  // Site Analysis FloodMitigationCard (deleted — the split-brain fix) expands inside.
  // detR / mitR / ffeR collect each group's rows; fold state is drainGroupOpen.
  const detR = [], mitR = [], ffeR = [];
  // B862 (chat NEW-3) — verdict-first group. Closed face = a solid status CHIP + the
  // section label + the one-line verdict (the largest type in the row; hierarchy by
  // weight/size, never fading) + an always-visible required-vs-provided BAR. Expanded:
  // the data rows + actionable warnings inline, and the method/exclusion notes folded
  // into "Assumptions & method ▸" (the caveat budget). opts: { chip, bar }.
  const groupFold = (gKey, label, verdict, tone, kids, sub, opts = {}) => {
    // v3 A3 — a group may default OPEN (opts.open); a stored user toggle still wins.
    const open = drainGroupOpen[gKey] != null ? !!drainGroupOpen[gKey] : !!opts.open;
    const vColor = tone === "danger" ? Y.dangerText : tone === "warn" ? Y.warnText : tone === "good" ? "var(--success-text)" : Y.text;
    const { chip, bar, action, method } = opts;
    // Partition the group's children: method notes (keyedNote → data-note="method")
    // collapse into the fold; everything else (data rows, verdict rows, actionable
    // warnings, inputs, bars) stays inline. v3 A3 — opts.method is an EXPLICIT list that
    // always folds into the "Assumptions & method" disclosure (used to relocate the prior
    // detention detail there so the visible body is just the spec's four items).
    const inlineKids = [], methodKids = [...(method || [])];
    for (const k of (kids || [])) {
      if (k && k.props && k.props["data-note"] === "method") methodKids.push(k); else inlineKids.push(k);
    }
    const methodShown = !!drainMethodOpen[gKey];
    return (
      <div key={"grp-" + gKey} style={{ borderBottom: `1px solid ${Y.hairline}`, padding: "2px 0" }}>
        <button type="button" aria-expanded={open} onClick={() => setDrainGroupOpen((s2) => { const next = { ...s2, [gKey]: !s2[gKey] }; if (gKey === "mit" && onMitOpenChange) onMitOpenChange(!!next.mit); return next; })}
          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "transparent", border: "none", padding: "5px 0", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ color: Y.muted, fontSize: 10, flex: "none" }}>{open ? "▾" : "▸"}</span>
            {chip ? <StatusChip label={chip} tone={tone} /> : null}
            <span style={{ fontSize: 11, fontWeight: 700, color: Y.rowLabel, letterSpacing: "0.02em", whiteSpace: "normal", overflowWrap: "anywhere" }}>{label}</span>
          </span>
          {/* v3 B7 — the group summary (verdict) shows ONLY when closed; when open, the
              detail below carries it (parity with the Collapse groups). */}
          {!open && (
          <span style={{ fontFamily: NUM_FONT, fontSize: 13.5, fontWeight: 800, fontVariantNumeric: TABULAR_NUMS, color: vColor, textAlign: "right", whiteSpace: "nowrap", flex: "none" }}>
            <FlashValue token={String(verdict)}>{verdict}</FlashValue>{sub ? <span style={{ color: Y.muted, fontWeight: 400, fontSize: 10 }}> {sub}</span> : null}
          </span>
          )}
        </button>
        {bar ? <div style={{ padding: "1px 2px 5px 20px" }}>{bar}</div> : null}
        {/* B909/B910 — the ⚡ Design cure sits ALWAYS-VISIBLE right under the bar
            (not gated behind "open"), so a novice sees SHORT and the fix in the
            same glance without needing to expand the card first. */}
        {action ? <div style={{ padding: "1px 2px 7px 20px" }}>{action}</div> : null}
        {open && <div style={{ padding: "1px 0 3px 10px", borderLeft: `2px solid ${Y.hairline}` }}>
          {inlineKids}
          {methodKids.length > 0 && (
            <InlineDisclosure
              open={methodShown}
              onToggle={() => setDrainMethodOpen((s2) => ({ ...s2, [gKey]: !s2[gKey] }))}
              label="Assumptions & method"
              count={methodKids.length}
              Y={Y}
            >
              {methodKids}
            </InlineDisclosure>
          )}
        </div>}
      </div>
    );
  };
  if (req && req.kind === "unavailable") {
    /* NEW-8 — Colorado. ONE visible line (PANEL-BREVITY: the verdict strip carries the
     * state, so this adds a single named line, not a paragraph); the full why — WQCV +
     * EURV, the four regimes, what to do instead — rides the ⓘ, which is exempt from the
     * copy budget. Never a number, never a blank.
     *
     * ⚠ B1127 CORRECTION to the line above: "the verdict strip already carries the state"
     * was NOT true when it was written. `yieldVerdicts.detentionVerdict` had no branch for
     * `kind:"unavailable"`, so the strip fell through to `loadingRow` and read "Detention:
     * checking flood data" — permanently — on every Colorado site. It is true now, because
     * B1127 added that branch. Do not delete the branch and leave this comment. */
    /* B1105 — on an MHFD site the ONE visible line names the two governing volumes and
     * where to size them, because that is now true and actionable; the blanket "Planyr
     * does not carry Colorado criteria" would be wrong there. PANEL-BREVITY: this REPLACES
     * the old sentence rather than adding one (the line count is unchanged), the component
     * table and the statute reconciliation ride the ⓘ / method notes below, and the
     * numbers-over-prose rule is why the visible text is "WQCV + EURV" and not a
     * paragraph explaining that two volumes govern. */
    const coMhfd = (req.flags || []).includes("colorado-mhfd");
    /* PANEL-BREVITY rule 5, applied while passing through: the two non-MHFD variants used
     * to be two separate literals for the SAME sentence (one just prefixed with the regime
     * name), so they are now one sentence with a computed subject. That pays for the MHFD
     * variant outright — this branch ends up SHORTER than before B1105 touched it. */
    /* NEW-5 (copy only) — "Planyr does not yet carry Colorado detention criteria" read
     * as "this app has nothing for you here", which is not what is true. District
     * MEMBERSHIP and WHICH MANUAL APPLIES are different questions: the Town of
     * Johnstown sits in Weld/Larimer, outside the Mile High Flood District, and governs
     * drainage by its own storm-drainage criteria PLUS MHFD's Drainage Criteria Manuals
     * Volumes 1–3. So for the three non-member regimes the honest line points at the
     * town, which is who to ask. Nothing computed changes — no rule record, no engine,
     * no new state; the verdict strip still reads N/A and still carries "not carried
     * yet", so the guard is untouched. ONE literal with a computed subject
     * (PANEL-BREVITY rule 5), and SHORTER than the sentence it replaces. */
    const coSubject = !d.coRegime ? "Colorado"
      : d.coRegime.id === "mhfd" ? "MHFD governs here"
      : `Outside MHFD (${d.coRegime.short} County)`;
    detR.push(warnNote(
      // `panelLine` rides the carrier from the lazily-loaded MHFD module — see the note on
      // MHFD_PANEL_LINE there. It can only be non-null once that chunk has landed, which is
      // also the only moment this branch can be reached, so there is no first-paint gap.
      coMhfd && req.panelLine
        ? req.panelLine
        // NEW-1 (Georgia) — the named "not available in Georgia yet" state; one line, the why rides the ⓘ.
        : (req.flags || []).some((f) => f === "georgia-not-wired" || f === "california-not-wired" || NJNY_NOT_WIRED_FLAGS.includes(f))
          ? req.headline // PANEL-BREVITY: the carrier's own headline, so no new literal is added here
          : `${coSubject} — confirm the criteria your town has adopted.`,
      "co-detention",
      // The explanation rides the lazily-loaded Colorado tier (with the rest of the
      // Colorado prose). Until it lands, the visible line and its verdict are already
      // correct — only the ⓘ fills in a moment later.
      (req.flags || []).some((f) => f === "georgia-not-wired" || f === "california-not-wired" || NJNY_NOT_WIRED_FLAGS.includes(f))
        ? req.detail
        : d.coDetail
        ? `${d.coDetail}${d.coRegime ? ` Reviewing regime: ${d.coRegime.label} (${d.coRegime.criteria}). ${d.coRegime.note}` : ""}`
        : null,
    ));
    /* B1105 — the MHFD DETAIL, entirely inside "Assumptions & method ▸".
     *
     * Every line is a `keyedNote`, which the copy budget exempts — the deliberate choice
     * PANEL-BREVITY calls for: honesty stays REACHABLE without the default view
     * accumulating lines. WQCV and EURV get one line EACH (a water-quality requirement and
     * a flood volume are never collapsed), each naming the document it still waits on.
     *
     * ⛔ The lines are COMPOSED IN THE LAZY TIER (`mhfdMethodNotes` → `d.coMhfdNotes`) and
     * this render only maps them onto the note primitive. Do NOT inline the strings back
     * here: they are Colorado prose that can only render once that chunk has landed, so on
     * the boot path they cost every Texas user bytes for text they can never see — which
     * breached `bundle.siteRouteJsBytes` on CI. */
    if (coMhfd) {
      detR.push(keyedNote(ruleBadge(req.rule), "mhfd-badge"));
      for (const n of ((d.coMhfdBag && d.coMhfdBag.notes) || [])) detR.push(keyedNote(n.text, n.key));
    }
  } else if (req && (req.kind === "point" || req.kind === "none")) {
    // v3 A3 — the numeric "Detention required" row is deleted (the required number lives
    // once, in the verdict strip, G1). The requirement BASIS (adopted rule/authority)
    // stays as the CODE-provenance note below.
    detR.push(keyedNote(ruleBadge(req.rule, req.rateAcFtPerAc), "badge"));
    // Municipal adopt-by-reference: show the overlay's own record + its extra rule.
    if (req.overlayRule) {
      detR.push(keyedNote(ruleBadge(req.overlayRule), "overlay-badge"));
      if (req.overlayRule.params?.runoffReductionPct) detR.push(warnNote(`${req.overlayRule.authorityLabel} also requires a ${req.overlayRule.params.runoffReductionPct}% runoff reduction on top of detention.`, "runoff"));
    }
    if (req.governing?.candidates?.length > 1) {
      // B750 — name the reviewing authority (detected/overridden) DISTINCTLY from the
      // governing-rate authority (the badge). On a >20 ac Houston tract they differ, and
      // that difference read as indecision; spell out that it's Houston's own rule.
      const cands = req.governing.candidates.map((c) => `${c.rule?.authorityLabel || c.authorityId} ${f1(c.acFt)} AC-FT`);
      const govLabel = req.rule?.authorityLabel || req.governing.picked;
      if (d.reviewer?.authorityId === "coh" && req.governing.picked === "hcfcd") {
        detR.push(keyedNote(`Reviewing authority: ${d.reviewer.label} ${d.reviewer.source === "override" ? "(you set this)" : detectedPhrase}. For a tract over 20 acres, City of Houston applies the larger of its own rate and HCFCD's — ${cands.join(" vs ")} — so ${govLabel}'s ${f1(req.requiredAcFt ?? 0)} AC-FT governs.`, "gov"));
      } else {
        detR.push(keyedNote(`Greater-of: ${cands.join(" vs ")} — more restrictive governs${d.reviewer?.label ? ` (${d.reviewer.label} review)` : ""}.`, "gov"));
      }
    }
    if (req.flags.includes("curve-approximate")) detR.push(warnNote("Rate read from an approximate Fig. 9.2 curve — exact breakpoints pending transcription.", "curve"));
    if (req.flags.includes("secondary-source")) detR.push(warnNote("June-2026 Houston rate verified against secondary coverage — manual PDF confirmation pending.", "sec-src"));
    if (req.flags.includes("added-impervious-unknown")) detR.push(warnNote("Rate applies to ADDED impervious — full-site impervious used here.", "added-imp", "On redevelopment this rate prices only the ADDED impervious area; the full site's impervious was used as a conservative stand-in. Enter the added-impervious area to refine."));
    if (req.flags.includes("hcfcd-not-applicable")) detR.push(warnNote("Houston set as reviewer but the site is outside Harris — Houston's own rate shown alone.", "hcfcd-na", "You set City of Houston as the reviewing agency, but this site is outside Harris County, so HCFCD's rate can't apply. Double-check the reviewing agency under Assumptions."));
  } else if (req && req.kind === "band") {
    // Band authorities NEVER render a single number.
    detR.push(row("Detention required", `${f1(req.bandAcFt[0])}–${f1(req.bandAcFt[1])} AC-FT`, "", false, { code: "code" }));
    // The badge shows the GOVERNING per-acre band (e.g. "0.75–1.0 ac-ft/ac by
    // outfall"), never the rule record's base rate — an unset-outfall Harris band
    // read "0.65 ac-ft/ac" directly under the 0.75–1.0 figure (contradictory).
    detR.push(keyedNote(ruleBadge(req.rule, req.rateBandAcFtPerAc, req.rateBandLabel), "badge"));
    if (req.overlayRule) {
      detR.push(keyedNote(ruleBadge(req.overlayRule), "overlay-badge"));
      if (req.overlayRule.params?.runoffReductionPct) detR.push(warnNote(`${req.overlayRule.authorityLabel} also requires a ${req.overlayRule.params.runoffReductionPct}% runoff reduction on top of detention.`, "runoff"));
    }
    detR.push(
      req.flags.includes("hced-infra-outfall-min")
        ? warnNote("Harris minimum depends on the outfall type — set it under Assumptions for one number.", "band",
            "Unincorporated Harris County's minimum detention: 0.75 AC-FT/AC to a storm sewer, 1.0 to a roadside ditch. A formal Method-2 analysis can lower it, but never below 0.75.")
        : req.flags.includes("verify-with-county-engineer")
        ? warnNote("No published flat rate for this county: verify with the county engineer.", "band")
        : warnNote("Exact criteria tables pending transcription — treat as a screening band only.", "band"));
  } else if (req && req.kind === "unknown") {
    detR.push(row("Detention required", "unknown"));
    detR.push(warnNote(req.basis, "unk"));
    if (req.governing?.candidates?.length) {
      for (const c of req.governing.candidates) {
        detR.push(row(`· if ${c.rule?.authorityLabel || c.authorityId}`, c.result?.kind === "band" ? `${f2(c.result.bandAcFt[0])}–${f1(c.result.bandAcFt[1])} AC-FT` : `${f1(c.acFt)} AC-FT`, "", true));
        if (c.rule) detR.push(keyedNote(ruleBadge(c.rule, c.result?.rateAcFtPerAc ?? c.result?.rateBandAcFtPerAc, c.result?.rateBandLabel), `cand-badge-${c.authorityId}`));
      }
    }
  } else if (d.reqCandidates) {
    // Boundary straddle: every candidate labeled + its rule record — never a silent default.
    detR.push(row("Detention required", "straddle"));
    for (const { aid, r } of d.reqCandidates) {
      detR.push(row(`· if ${r.rule?.authorityLabel || aid}`, r.kind === "band" ? `${f2(r.bandAcFt[0])}–${f1(r.bandAcFt[1])} AC-FT` : r.kind === "point" ? `${f1(r.requiredAcFt)} AC-FT` : "unknown", "", true));
      if (r.rule) detR.push(keyedNote(ruleBadge(r.rule, r.rateAcFtPerAc ?? r.rateBandAcFtPerAc, r.rateBandLabel), `straddle-badge-${aid}`));
    }
    if (d.ambiguous[0]) detR.push(warnNote(d.ambiguous[0].detail, "straddle"));
  } else if (d.authorityFlags.includes("jurisdiction-unavailable")) {
    // County/city lookup failed — an outage is an unknown, never "no requirement".
    detR.push(row("Detention required", "unknown"));
    detR.push(warnNote("County/city lookup unavailable — reviewing authority unresolved; re-check shortly.", "jurfail"));
  } else if (d.authorityFlags.includes("no-criteria-modeled")) {
    detR.push(row("Detention required", "—"));
    detR.push(warnNote("No detention criteria modeled for this county yet — verify locally.", "nocrit"));
  }
  // An unmodeled city keeps the county number but MUST carry the caveat (coexists
  // with a truthy req, so it lives outside the req-shaped chain above).
  if (d.authorityFlags.includes("city-criteria-unverified") && !(d.cityNotes || []).length) detR.push(warnNote("This city's detention criteria aren't modeled — county floor shown; verify with the city.", "city-unv", "The county requirement is a screening floor, not the city's own rule — confirm the city's criteria before design. This note only appears when the parcel is materially INSIDE the city's limits (an edge sliver or ETJ-only overlap no longer triggers it — B823)."));
  if (d.authorityFlags.includes("jurisdiction-partial")) detR.push(warnNote("City-limits lookup incomplete — re-check (Houston limits would change the reviewer).", "jur-partial", "The city-limits source didn't answer completely (an outage). If this parcel is actually inside Houston's city limits, the reviewing authority would be the City of Houston, not the county."));
  // ETJ context: being in a city's ETJ does NOT make that city the detention authority —
  // the county's criteria govern (owner rule 2026-07-10). Surfaced so it's never mistaken
  // for a city-limits detection.
  // NEW-1 — Baytown / Mont Belvieu: the city's own policy line REPLACES the generic "city-unv" sentence above for these cities.
  for (const cn of (d.cityNotes || [])) detR.push(warnNote(cn.short, "citynote-" + cn.id, cn.detail || null));
  for (const e of d.etjNotes) detR.push(warnNote(e.short || e.note, "etj-" + String(e.city || "").toLowerCase(), e.detail || null));
  // B750 — the two overridable assumptions (reviewing agency + channel discharge).
  { const ab = assumptionsBlock(); if (ab) detR.push(ab); }
  // B823 (amends B797(c)) — a stored channel answer where HCFCD doesn't govern renders
  // NOTHING inline: the answer is silently ignored and the fact moves to one line
  // inside the Assumptions header ⓘ (see assumptionsBlock) — the B806 gating pattern.
  // NEW-1(a) — the "dead storage earns no credit" teaching copy + the usable figure fold
  // into an ⓘ on the provided row (the pond count stays as the visible sub).
  if (d.providedUsableCf == null) {
    // NEW-9 — restored check without the per-pond split: gross is shown AS gross,
    // with a loud "usable unknown" warning — never silently credited as usable.
    detR.push(row("Detention provided (gross)", `${f1(providedAcFt)} AC-FT`, d.pondCount ? `· ${d.pondCount} pond${d.pondCount > 1 ? "s" : ""}` : "", false, { code: "plan" }));
    detR.push(warnNote("Usable split wasn't saved with this remembered check — gross OVERSTATES usable; ↻ re-check.", "det-remembered-split",
      "This remembered check predates the per-pond split record (or a pond was drawn after it). How much of the gross volume is usable for detention (above the flood water surface and the permanent pool) is unknown until the next live check — so no surplus/short verdict is shown."));
  } else if (d.deadCf > 0) {
    detR.push(infoRow("Detention provided", `${f1(providedAcFt)} AC-FT`,
      `Usable ${f1(usableAcFt)} AC-FT after ${f1(d.deadCf / CF_PER_ACFT)} AC-FT sits below the flood WSE / permanent pool; dead storage earns no credit. Anchored ponds split at their real water surfaces; the rest use the Regime-B estimate.`,
      { key: "provided", sub: d.pondCount ? `· ${d.pondCount} pond${d.pondCount > 1 ? "s" : ""} · usable ${f2(usableAcFt)}` : `· usable ${f2(usableAcFt)}`, tag: { code: "plan" } }));
  } else {
    detR.push(row("Detention provided", `${f1(providedAcFt)} AC-FT`, d.pondCount ? `· ${d.pondCount} pond${d.pondCount > 1 ? "s" : ""}` : "· no ponds drawn", false, { code: "plan" }));
  }
  // NEW-1 — the fully-inundated crisis, surfaced as a LOUD inline remedy row: the flood
  // WSE sits at/above the top of bank, so usable detention is ZERO no matter how large the
  // excavation. Carries the assistant's remedy; the NEW-5 Apply chip mounts here.
  if (d.pondFullyInundated && d.providedUsableCf != null && d.providedUsableCf < 1e-6) {
    detR.push(
      <div key="det-inundated" style={{ fontSize: 11, color: Y.dangerText, lineHeight: 1.45, margin: "5px 0 2px", fontWeight: 800, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", border: `1px solid ${Y.dangerText}`, borderRadius: 8, padding: "6px 9px" }}>
        <span>⚠ Flood WSE ≥ top of bank: usable detention is ZERO. Raise the top of bank (berm) to lift storage above the flood.</span>
        {d.onApplyInundatedBerm && d.inundatedBermPreview
          ? <button type="button" title={d.inundatedBermPreview.diff} onClick={() => d.onApplyInundatedBerm()} style={{ flex: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)", whiteSpace: "nowrap" }}>Raise TOB +{f1(d.inundatedBermPreview.hFt)}′ →</button>
          : null}
      </div>
    );
  }
  // B862 (chat NEW-3) — the three-band pond-storage split as stacked SOLID segments,
  // ordered bottom→top (dead · mitigation-candidate · usable above the flood WSE), so the
  // usable-vs-dead breakdown reads at a glance. NEW-1 — the flood-WSE marker sits at the
  // usable/mit-candidate boundary (the below-WSE cumulative), so with usable = 0 it pins to
  // the RIGHT edge (everything is below the flood surface), not far left. Site-level aggregate.
  if (d.providedUsableCf != null && d.deadCf > 0 && d.pondCount > 0) {
    const usAf = d.providedUsableCf / CF_PER_ACFT;
    const mitAf = d.mitProvided && d.mitProvided.creditedCf != null ? d.mitProvided.creditedCf / CF_PER_ACFT : 0;
    const deadRemAf = Math.max(0, d.deadCf / CF_PER_ACFT - mitAf);
    const splitLayout = stackedBarLayout({ segments: [{ key: "dead", value: deadRemAf }, { key: "mit", value: mitAf }, { key: "usable", value: usAf }], markerValue: deadRemAf + mitAf });
    const swatch = (c) => <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: c, marginRight: 3, verticalAlign: "middle" }} />;
    detR.push(
      <div key="det-split" style={{ padding: "3px 2px 4px 0" }} title="How the drawn ponds' gross storage divides: usable detention (above the flood water surface) · below-WSE cut credited to mitigation · dead storage (permanent pool / below WSE, no detention credit). The tick marks the flood water surface.">
        <BulletBar layout={splitLayout} Y={Y} width={200} />
        <div style={{ display: "flex", gap: 10, marginTop: 2, fontSize: 9.5, color: Y.muted, flexWrap: "wrap" }}>
          <span>{swatch("var(--success-text)")}usable {f2(usAf)}</span>
          {mitAf > 0.005 && <span>{swatch(Y.detention)}mit-candidate {f2(mitAf)}</span>}
          <span>{swatch(Y.detZeroBorder)}dead {f2(deadRemAf)}</span>
        </div>
      </div>
    );
  }
  // NEW-11/B831 — ponds sitting in easement / pipeline corridors: one loud line
  // with the acreage; a corridor-source outage says "not screened", never a
  // silent all-clear (drawn easements screen regardless).
  if (d.corridorConflicts && d.corridorConflicts.count > 0) {
    const cc = d.corridorConflicts;
    detR.push(warnNote(`${cc.count} pond${cc.count > 1 ? "s" : ""} in pipeline/easement corridors (~${f2(cc.totalSf / SQFT_PER_ACRE)} AC) — operator approval risk.`, "pond-corridor",
      "Excavating a basin over a pipeline or inside a recorded easement usually needs the operator's / easement holder's approval and can force relocation. The pipeline corridor is an ASSUMED screening band off a schematic centerline — verify the recorded easement width. Applies to detention and mitigation basins alike; each pond's inspector shows its own overlap."));
  }
  if (d.corridorConflicts && d.corridorConflicts.state === "failed") {
    detR.push(warnNote("Pipeline corridor source didn't answer — corridor conflicts not screened this session.", "pond-corridor-fail",
      "An outage is never an all-clear: drawn easements were still screened, but the assumed pipeline corridor bands couldn't be fetched. Toggle the layer or re-check later to retry."));
  }
  {
    // B712 — the mitigation ledger joins the readout. ADDITIVE with detention:
    // the same acre-foot can't count twice, and the copy names which band went
    // where. Honest states: UNKNOWN volume renders as UNKNOWN with its reason
    // (geometry still shown), a floodway hit is a hard stop, an unanchored
    // in-floodplain pond forces the gross-volume caution.
    const mit = d.mitigation;
    if (mit && mit.intersectAcres > 0) {
      // B824 — the per-class ledger (migrated from the deleted card): geometry
      // always renders, even when volumes can't.
      for (const [cls, bucket] of Object.entries(mit.perClass || {})) {
        if (!(bucket.acres > 0)) continue;
        const clsLbl = cls === "1pct" ? "1% (100-yr) floodplain fill" : cls === "02pct" ? "0.2% (500-yr) band fill" : "Regulatory FLOODWAY fill";
        mitR.push(row(clsLbl, `${f2(bucket.acres)} AC`, cls === "floodway" ? "" : bucket.volumeCf != null ? `· ${f1(bucket.volumeCf / CF_PER_ACFT)} AC-FT` : "· UNKNOWN"));
      }
      if (mit.volumeCf != null) mitR.push(row("Required compensating storage", `${f1(mit.volumeAcFt)} AC-FT`, `· ${f2(mit.cutCy)} cy`, false, { code: "code" }));
      // NEW-8 — the Provided/Balance ledger: below-WSE cut CREDITED from ponds whose
      // role is Mitigation or Dual (set per pond in its inspector). Role only gates
      // credit — the detention usable split (B708) is untouched, and the exclusive
      // bands mean no acre-foot ever lands in both ledgers. An over-dug state is as
      // loud as a shortfall (wasted excavation is wasted money — warn, not danger).
      if (mit.volumeCf != null && d.mitProvided) {
        const provCf = d.mitProvided.creditedCf;
        if (provCf == null) {
          mitR.push(row("Provided (credited pond cut)", "unknown — ↻ re-check"));
        } else {
          const provAcFt = provCf / CF_PER_ACFT;
          const nProv = d.mitProvided.pondCount;
          mitR.push(infoRow("Provided (credited pond cut)", `${f1(provAcFt)} AC-FT`,
            "Below-WSE cut in ponds whose purpose is Mitigation or Hybrid — set each pond's purpose in its inspector. Below the flood WSE the flood already occupies the volume at design stage: no detention credit, but it IS candidate compensating storage for fill. Credit is a screening call: the cut must be hydraulically connected to the floodplain at flood stages and sit in the same watershed; your engineer confirms both.",
            { key: "mit-prov", sub: nProv ? `· ${nProv} pond${nProv > 1 ? "s" : ""}` : "· no credited ponds", tag: { code: "plan" } }));
          const bal = provAcFt - mit.volumeAcFt;
          const overBy = bal - Math.max(1, mit.volumeAcFt * 0.1); // beyond required + max(1 ac-ft, 10%)
          // NEW-2 — a surplus reads quiet COVERED (green), only a real shortfall is loud
          // (danger); "over-dug" is retired from the salient balance line.
          const balText = bal < 0 ? `${f1(Math.abs(bal))} AC-FT SHORT` : "covered";
          const balColor = bal < 0 ? Y.dangerText : Y.green;
          mitR.push(
            <div key="mit-balance" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${Y.hairline}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: Y.rowLabel }}>Balance</span>
              <span style={{ fontFamily: NUM_FONT, fontSize: 13, fontWeight: 750, fontVariantNumeric: TABULAR_NUMS, color: balColor }}>{balText}</span>
            </div>
          );
          // NEW-21/NEW-26 — when the site is SHORT because a below-flood cut EXISTS but earns
          // no credit (the SAME shared gate the verdict + Optimize card use), name WHY + the
          // fix, so "0.0 provided" over a real cut is never left unexplained. Post-NEW-26 the
          // only reason is a GATED / absent outfall (the default is connected → credits).
          if (bal < 0 && d.mitProvided.uncreditedCf > 0.02 * CF_PER_ACFT && d.mitProvided.gatedReason) {
            const uncAcFt = d.mitProvided.uncreditedCf / CF_PER_ACFT;
            mitR.push(warnNote(
              d.mitProvided.gatedReason === "no-outfall"
                ? `A pond has ${f1(uncAcFt)} AC-FT of below-flood cut that earns NO credit: it has no outfall to the floodplain, so the flood can't reach it. Add an open outfall connection, or provide the mitigation in a connected basin.`
                : `A pond has ${f1(uncAcFt)} AC-FT of below-flood cut that earns NO credit: its outfall is marked gated (a flap valve keeps the flood out). Turn off "outfall gated" in the pond inspector if the outlet is open.`,
              "mit-gated",
              "The SAME credit rule the verdict and the Optimize card use: a below-flood cut compensates when the floodplain can reach it. A detention pond is connected through its outfall by default (the flood backs in), so it credits, unless the outfall is gated or absent."));
          }
          // NEW-2 — surplus cut is a quiet efficiency note (method fold), never a warning:
          // extra below-WSE cut is dirt cost with no yield; the balancer ranks shrink moves.
          if (overBy > 0) mitR.push(keyedNote(`Surplus: provided ${f2(provAcFt)} vs required ${f2(mit.volumeAcFt)} — ~${f0(bal)} AC-FT of cut beyond the requirement earns no extra credit (dirt cost only; the ledger balancer ranks shrink options).`, "mit-overdug"));
          // NEW-26 — the credit rides an ASSUMED open (ungated) outfall connection; flag it with
          // its citation target so the assumption never silently drives the number.
          if (provCf > 0) mitR.push(warnNote("Credited cut assumes an OPEN (ungated) outfall connection; engineer confirms.", "mit-prov-confirm",
            "A detention pond drains to the floodplain through its outfall; during a flood the receiving water backs in through that same outlet, occupying the below-WSE storage (compensating storage). So the below-flood cut is credited by default. ASSUMED per BKDD Rules 22-01 (citation target, unverified until the code text lands); some districts require a dedicated opening or restrict in-pond credit. If the outfall is gated / flap-valved, mark it in the pond inspector; then the cut earns no credit. The cut must also fill and drain with the floodplain in the same watershed (a design-level judgment)."));
        }
      }
      // B809 — the heat-map affordance rides the group: Auto follows this group's
      // expansion; the tie-out line makes the overlay-equals-ledger fact VISIBLE
      // (identical by construction — same retained cells; seeing it is the point).
      if (heat && heat.available) {
        mitR.push(
          <div key="mit-heat" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${Y.hairline}` }}>
            <span style={{ fontSize: 11, color: Y.rowLabel }} title="Paints the exact cells the engine priced onto the plan — floodway renders as prohibition hatch, unpriced bands as grey hatch. Auto shows it while this group is open.">Fill-depth heat map<span style={{ fontSize: 9.5, color: Y.muted, marginLeft: 4 }} aria-hidden="true">ⓘ</span></span>
            <span style={{ display: "flex", gap: 4, width: 156 }}>
              {seg("Auto", heat.user == null, () => heat.onToggle(null), "h-a", "Fill-depth heat map")}
              {seg("On", heat.user === true, () => heat.onToggle(true), "h-on", "Fill-depth heat map")}
              {seg("Off", heat.user === false, () => heat.onToggle(false), "h-off", "Fill-depth heat map")}
            </span>
          </div>
        );
        if (heat.on && heat.totals) mitR.push(keyedNote(`Overlay Σ ${f1(heat.totals.volumeAcFt)} AC-FT = ledger ${heat.ledgerAcFt != null ? f2(heat.ledgerAcFt) : "—"} AC-FT — same cells, by construction.`, "mit-heat-tie"));
      }
      if (mit.volumeCf != null) {
        const mitTag = mit.expertBypass ? "expert avg-depth"
          : d.mitigationStraddle ? "straddle worst-case"
          : mit.providers?.wse1pct === "bfe-line-interp" ? "BFE derived"
          : mit.providers?.wse1pct === "fbcdd-wse100-draft" ? "DRAFT Atlas-14 100-yr"
          : "";
        // NEW-1(a) — "volumes are additive" teaching copy → ⓘ on the row.
        mitR.push(infoRow("Mitigation volume", `+${f1(mit.volumeAcFt)} AC-FT`,
          "Additive with detention — the same acre-foot can't count twice. The mitigation cut must be hydraulically connected to the floodplain at flood stages; the per-class ledger, providers and derivation notes are the rows of this group (B824 — one drainage home).",
          { key: "mit", sub: mitTag, tag: { code: "code", basis: "The compensating-storage ratio is the adopted criteria value; the fill footprint it's applied to is measured from your drawn geometry." } }));
        // B755 — when the volume is priced off a DERIVED BFE, say so loudly (an
        // estimate to verify, never a published number) and show the conservative bound.
        if (mit.providers?.wse1pct === "bfe-line-interp" && d.floodGeo?.derivedBfe) {
          const db = d.floodGeo.derivedBfe;
          const dt = db.detail || {};
          const bracket = dt.hiElev != null && dt.hiElev !== dt.loElev
            ? ` (between FEMA's ${f1(dt.loElev)}′ and ${f1(dt.hiElev)}′ lines; conservative bound ${f1(dt.hiElev)}′)`
            : (db.method === "nearest-line" ? " (nearest single BFE line — ±~0.5′)" : "");
          mitR.push(warnNote(`BFE ≈ ${f1(db.bfeFt)}′ DERIVED from FEMA's Base Flood Elevation lines.`, "mit-derived", `A screening estimate, not a published BFE${bracket} — confirm before design. Type a BFE below to override.`));
        }
        // B807 — the volume was priced off the FBCDD DRAFT Atlas-14 100-yr raster
        // (the unstudied-Zone-A path): loud, labeled, never an effective value.
        if (mit.providers?.wse1pct === "fbcdd-wse100-draft" && d.floodGeo?.derivedWse100) {
          mitR.push(warnNote(`1% WSE ≈ ${f1(d.floodGeo.derivedWse100.wseFt)}′ — FBCDD Atlas-14 DRAFT${d.floodGeo.derivedWse100.watershed ? ` (${d.floodGeo.derivedWse100.watershed.replace(/_/g, " ")} watershed)` : ""}.`, "mit-derived-100", "Read from Fort Bend's Atlas-14 watershed-study rasters — DRAFT study results, screening only. Basis note: the county's mitigation rules reference the EFFECTIVE (pre-Atlas-14) floodplain — this Atlas-14 value stands in for it, labeled, not equal to it. Type a BFE below to override."));
        }
        // B824 — the remaining derivation notes migrated from the card (xs-wsel +
        // the DRAFT 0.2% stand-in), so no shipped honesty copy was lost in the merge.
        if (mit.providers?.wse1pct === "xs-wsel" && d.floodGeo?.derivedXsWsel) {
          const dxs = d.floodGeo.derivedXsWsel;
          mitR.push(warnNote(`1% WSE ≈ ${f1(dxs.wselFt)}′ read from FEMA's regulatory cross-sections${dxs.detail && dxs.detail.wtrNm ? ` on ${dxs.detail.wtrNm}` : ""}.`, "mit-derived-xs", "The effective-model regulatory water surface (WSEL_REG) at the nearest reach; a jurisdiction may enforce a newer model. Type a BFE below to override."));
        }
        if (mit.providers?.wse02pct === "fbcdd-wse02-draft" && d.floodGeo?.derivedWse02) {
          mitR.push(warnNote(`0.2% WSE ≈ ${f1(d.floodGeo.derivedWse02.wseFt)}′ — FBCDD Atlas-14 DRAFT.`, "mit-derived-02", "Read from Fort Bend's Atlas-14 watershed-study rasters — DRAFT study results, screening only. FBCDD Interim §9 keys the PRE-Atlas-14 (2014 FIS) basis, so this value is a labeled stand-in for it. Enter the FIS 0.2% WSE to override."));
        }
        if (d.mitigationStraddle && d.mitigationStraddle.anyUnknown) mitR.push(warnNote("Straddle with an UNKNOWN candidate — worst PRICED case shown.", "mit-straddle-unk", "One straddle candidate couldn't be priced, so it could govern with a larger number than shown. Enter its elevations to price it."));
        if (req && req.kind === "point" && req.requiredAcFt > 0) {
          mitR.push(row("Combined basin volume", `${f1(req.requiredAcFt + mit.volumeAcFt)} AC-FT`, "", false, { code: "code" }));
        }
      } else {
        mitR.push(row("Floodplain mitigation", "UNKNOWN"));
        mitR.push(warnNote(`Mitigation volume UNKNOWN — ${mit.unknownReason}.`, "mit-unk", `The floodplain geometry still stands: ${f2(mit.intersectAcres)} AC of fill footprint intersects mapped zones — only the VOLUME is unpriced.`));
      }
      if (mit.flags.includes("floodway_intersect")) mitR.push(
        <div key="mit-fw" style={{ fontSize: 11, color: Y.dangerText, lineHeight: 1.45, margin: "4px 0 0", fontWeight: 800 }}>
          ⚑ FILL IN THE FLOODWAY{d.mitigationRule?.floodwayBufferFt > 0 ? ` (+ its ${f0(d.mitigationRule.floodwayBufferFt)}-ft BUFFER)` : ""} IS PROHIBITED — {f2(mit.floodwayAcres)} AC of fill footprint sits in the regulatory floodway{d.mitigationRule?.floodwayBufferFt > 0 ? ` or within ${f0(d.mitigationRule.floodwayBufferFt)} ft of it (${d.mitigationRule.label} extends the prohibition to a buffer zone)` : ""}. Relocate it; no mitigation ratio prices floodway fill.
        </div>
      );
      // NEW-2 / B882 — an accepted estimate (any provider) priced the 1% surface: stamp
      // the ledger loudly, naming the winning source.
      if (isEstimatedWseSrc(mit.providers.wse1pct)) mitR.push(warnNote(`1% WSE is ${wseProvLabel(mit.providers.wse1pct)} — screening only.`, "mit-est-wse", estWseNote(mit.providers.wse1pct)));
      if (mit.flags.includes("rule_unverified")) mitR.push(warnNote("Mitigation rule unverified — edit & confirm in the inputs below.", "mit-unv"));
      // B824 — sanity/datum flags + the rule and providers lines, migrated from the card.
      if (mit.flags.includes("wse02-below-1pct")) mitR.push(warnNote("The 0.2% WSE reads BELOW the 1% here — mismatched studies; don't rely on it.", "mit-02below", "A 0.2% (500-yr) surface can never sit below the 1% (100-yr) surface on one reach — the two values come from mismatched studies or vintages. Enter a 0.2% WSE from the effective FIS profile."));
      if (mit.flags.includes("unstudied_a")) mitR.push(warnNote("Unstudied Zone A on the site — BFE undetermined from the map.", "mit-unstudied-a", "FEMA publishes no BFE for this zone; a flood study or the effective model sets the governing elevation."));
      if (mit.flags.includes("datum_mismatch")) mitR.push(warnNote("A zone publishes a non-NAVD88 datum — convert before comparing.", "mit-datum", "Mixed datums are a multi-foot silent error in the Houston area (subsidence): convert NGVD29 values to NAVD88 before entering or comparing."));
      if (d.floodGeo?.bfeLineFlags && d.floodGeo.bfeLineFlags.usable === 0 && d.floodGeo.bfeLineFlags.datumExcluded > 0) mitR.push(warnNote("FEMA BFE lines here publish a non-NAVD88 datum — no auto-derive; enter one manually.", "mit-bfe-datum", "Deriving from a mixed datum would be a multi-foot silent error, so the tool refuses. Convert the published lines to NAVD88 and enter a BFE below."));
      if (d.mitigationStraddle) mitR.push(warnNote(`Jurisdiction straddle — every candidate priced, worst case shown${d.mitigationStraddle.anyUnknown ? " (one UNKNOWN)" : ""}.`, "mit-straddle-detail", `Candidates: ${d.mitigationStraddle.candidates.map((c) => `${c.rule.label} ${c.result.volumeCf != null ? f1(c.result.volumeCf / CF_PER_ACFT) + " ac-ft" : "unknown"}`).join(" · ")}.`));
      if (mit.expertBypass) mitR.push(keyedNote("Expert bypass in use — volume = intersect area × the entered average fill depth.", "mit-bypass"));
      // ── NEW-4 — WHICH flood line this requirement was computed from. Fort Bend owes the
      // offset up to the pre-Atlas-14 500-yr line, not the 100-yr; the reader must be able
      // to see which one produced the number, and when the stricter one wasn't available.
      if (d.offsetSurface) {
        const ob = mit.offsetBasis || null;
        const mismatch = ob && ob.matched === false;
        mitR.push(
          <div key="mit-offset-surface" data-testid="yield-offset-surface" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0" }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 3, fontSize: 12, color: Y.rowLabel }}>
              Measured up to
              <RowInfo label="Which flood line the offset is owed to" sections={[
                { text: `${d.offsetSurface.authority || "This county"} sets the level that storage has to be replaced up to. It is not always the 100-year line — ${d.offsetSurface.note || "check the county's own rule."}` },
                { text: "It matters because the higher line means more storage was taken away, so more has to be given back. A design that is barely over the requirement can flip to short on this one choice." },
              ]} />
            </span>
            <span style={ROWB6}>
              <span style={{ fontSize: 12, fontWeight: 600, color: mismatch ? Y.warnText : Y.text, whiteSpace: "nowrap" }}>
                {d.offsetSurface.label}{d.offsetElevFt != null ? ` · ${f1(d.offsetElevFt)}′` : ""}
              </span>
              <SourceTag code="code" label="Offset surface" basis={`${d.offsetSurface.authority || "Jurisdiction"} — ${d.offsetSurface.source || "rule not transcribed"}`} />
            </span>
          </div>
        );
        if (mismatch) mitR.push(warnNote(`No ${d.offsetSurface.basis === "02pct" ? "500-year" : "100-year"} level known here — the requirement is understated.`, "mit-offset-mismatch", `${d.offsetSurface.authority || "This jurisdiction"} owes the offset up to the ${d.offsetSurface.label}, but no such water surface was available this check, so the volume priced against the ${ob.used === "02pct" ? "500-year" : "100-year"} line instead. ${d.offsetSurface.note || ""}`));
      }
      // ── NEW-3 — the ELEVATION-MATCHED (hydraulically equivalent) band ledger. A matching
      // total is not compliance: storage has to come back in the band it was taken from.
      if (d.mitBands && d.mitBands.known) {
        const bl = d.mitBands;
        mitR.push(
          <div key="mit-bands-head" data-testid="yield-mit-bands" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0", borderTop: `1px solid ${Y.hairline}` }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 3, fontSize: 12, color: Y.rowLabel }}>
              Replaced at the right levels
              <RowInfo label="Storage replaced level by level" sections={[
                { text: "A one-to-one offset has to be matched level by level, not just in total. Water sitting at one level can't be stored by a hole dug lower down — so the storage you take away in each one-foot slice has to be given back in that same slice." },
                { text: "The totals can tie while every foot of the match is in the wrong place. That is why this check exists separately from the acre-foot figure above." },
                { text: "Digging below the bottom of the floodplain makes useful dirt, but it replaces no floodwater, so it earns no credit here." },
              ]} />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: bl.overallPass ? "var(--success-text)" : Y.dangerText, whiteSpace: "nowrap" }}>
              {bl.overallPass ? "every level covered" : `${bl.shortBands.length} level${bl.shortBands.length === 1 ? "" : "s"} short`}
            </span>
          </div>
        );
        if (!bl.overallPass) {
          mitR.push(
            <div key="mit-bands-tbl" style={{ padding: "2px 0 5px" }}>
              {bl.shortBands.slice(0, 6).map((b) => (
                <div key={`bnd-${b.loFt}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 11, color: Y.rowLabel, lineHeight: 1.6 }}>
                  <span style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{f1(b.loFt)}′–{f1(b.hiFt)}′</span>
                  <span style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, color: Y.dangerText, whiteSpace: "nowrap" }}>
                    {f1(b.createdCf / CF_PER_ACFT)} given back of {f1(b.requiredCf / CF_PER_ACFT)} taken
                  </span>
                </div>
              ))}
              {bl.shortBands.length > 6 && <div style={{ fontSize: 10.5, color: Y.muted, marginTop: 2 }}>…and {bl.shortBands.length - 6} more.</div>}
              {bl.totalWouldPass && <div style={{ fontSize: 11, color: Y.dangerText, lineHeight: 1.5, marginTop: 3 }}>The acre-foot totals tie — but the levels do not, so this would not survive review.</div>}
            </div>
          );
        }
        if (bl.excludedBelowBottomCf > 0.05 * CF_PER_ACFT) mitR.push(keyedNote(`${f1(bl.excludedBelowBottomCf / CF_PER_ACFT)} AC-FT was dug below the bottom of the floodplain — useful dirt, but it replaces no floodwater, so it earns no credit here.`, "mit-below-bottom"));
        if (bl.unanchoredIds.length) mitR.push(warnNote(`${bl.unanchoredIds.length} pond${bl.unanchoredIds.length === 1 ? " has" : "s have"} no top-of-bank elevation set.`, "mit-band-unanchored", "A pond with no top-of-bank elevation has no known position in the column, so it can contribute nothing to the level-by-level check. Set its top-of-bank elevation in the pond inspector."));
      } else if (d.mitBands && d.mitBands.known === false) {
        mitR.push(keyedNote("The level-by-level check can't run yet — it needs the governing flood level and a top-of-bank elevation on each pond.", "mit-bands-unk"));
      }
      mitR.push(keyedNote(`Rule: ${d.mitigationRule?.label} — ${mit.trigger === "1pct_plus_02pct" ? "1% + 0.2% trigger" : "1% trigger"} @ ${mit.ratio}:1${d.mitigationRule?.offsetScope === "storage_and_conveyance" ? " (offsets storage AND conveyance — large contiguous fringe fill can trigger a no-rise/hydraulic analysis beyond this volume screen)" : ""}.`, "mit-rule"));
      mitR.push(keyedNote(`Providers: pad FFE ${{ "proposed-surface": "proposed surface (auto-grade)" }[mit.providers.padElev] || mit.providers.padElev || "—"} · grade ${{ "3dep-grid": "3DEP per-cell grid", "3dep": "3DEP median" }[mit.providers.existGrade] || mit.providers.existGrade || "—"} · 1% WSE ${wseProvLabel(mit.providers.wse1pct)} · 0.2% WSE ${wseProvLabel(mit.providers.wse02pct)}${d.floodGeo && d.floodGeo.ts != null ? ` · flood data ${formatAge(Date.now() - d.floodGeo.ts)}` : ""}`, "mit-providers"));
      // B826 — surface-basis honesty: when the proposed-surface engine priced the
      // fill, say so (the flat-pad figure would differ BY DESIGN — courts price
      // at their real planes); the flat path keeps its own labels below.
      if (mit.padBasis === "surface") mitR.push(keyedNote("Fill priced off the auto-graded proposed surface — courts and paving price at their real planes, not one flat pad.", "mit-surface", "The proposed-surface engine grades each element (pad flat at FFE, dock courts dropped and falling away, paving tied at the doors and falling to the drainage target) and mitigation prices fill as surface − ground per cell. The flat-pad screening comparison lives in Yield → Earthwork cost."));
      // B808 — grade-basis honesty: the median fallback is named (never silently
      // flat), and the grid's own flags surface one line each (the B823 cap).
      if (mit.gradeBasis === "median") mitR.push(keyedNote("Flat-grade estimate — one median grade priced every cell.", "mit-flat", "The per-cell 3DEP grid was unavailable this check (or the check predates it) — every cell priced at the site-median grade. ↻ Re-check to fetch the grid; a typed grade always overrides."));
      if (mit.flags.includes("grid-voids")) mitR.push(warnNote("Over 5% of the priced footprint sits on DEM voids — those cells priced nothing.", "mit-voids", "The 3DEP grid has no ground return under part of the footprint (water, structures, data gaps). Void cells are EXCLUDED from the volume — treat the number as a floor there and confirm grades before design."));
      if (mit.flags.includes("grid-median-delta") && mit.volumeFlatCf != null) mitR.push(warnNote(`Terrain relief moved this volume >15% vs the flat-grade estimate.`, "mit-delta", `Per-cell grid: ${f1(mit.volumeAcFt)} AC-FT vs flat median: ${f1(mit.volumeFlatCf / CF_PER_ACFT)} AC-FT. The old single-grade number was silently wrong on this site — the per-cell figure stands (screening).`));
      // NEW-8 — what remains a footnote is only the UNCREDITED remainder (below-WSE
      // cut sitting in detention-role ponds); the credited share now lives in the
      // Provided row above instead of being footnoted away.
      if (d.mitProvided && d.mitProvided.uncreditedCf > 0.05 * CF_PER_ACFT) mitR.push(warnNote(`Below-WSE cut in detention-purpose ponds: ${f1(d.mitProvided.uncreditedCf / CF_PER_ACFT)} AC-FT — uncredited.`, "mit-cand",
        "This volume sits below the flood WSE in ponds whose purpose is Detention, so it is credited to neither ledger (it earns no detention credit either). Set a pond's purpose to Mitigation or Hybrid in its inspector to credit its below-WSE cut here."));
      // B833 — transition wedges + in-floodplain pond berms are REAL fill: when the
      // proposed surface priced them, the required volume above already includes
      // them and the delta is named; without the surface the footprint-only figure
      // stays honestly labeled a FLOOR.
      if (mit.wedgePriced) {
        if (mit.wedgeAcFt > 0) mitR.push(warnNote(`+${f1(mit.wedgeAcFt)} AC-FT of the requirement comes from transition slopes past pad edges.`, "mit-wedge",
          "Past every graded edge the fill continues as a daylight wedge (3:1 default, 4:1 with the mowable toggle) down to existing ground; inside the mapped floodplain that wedge displaces storage too, so it joins the required volume. Priced from the auto-graded surface's transition cells — screening; the wedge fringe renders on the cut/fill map."));
        if (mit.wedgeUnknownSf > 0.02 * SQFT_PER_ACRE) mitR.push(warnNote(`~${f2(mit.wedgeUnknownSf / SQFT_PER_ACRE)} AC of wedge sits on unpriceable cells — the wedge share is a floor.`, "mit-wedge-unk",
          "Part of the transition fringe crosses DEM voids or zones without a usable water surface — those cells price nothing (never zero-as-a-number). Enter a BFE or re-check to close the gap."));
        if (mit.bermAcFt > 0) mitR.push(warnNote(`+${f1(mit.bermAcFt)} AC-FT from pond berms whose fill sits in the mapped floodplain.`, "mit-berm",
          "A bermed pond's embankment is placed fill inside the drawn footprint (the outline is the berm's outer toe; it rises inward to the crest); the below-WSE share of that fill inside the floodplain displaces storage, so it joins the requirement (sampled berm cells times the below-WSE slice, screening; upland berms price as earthwork only, never here)."));
        // NEW-5 (B1036) — a berm contribution of ZERO has five different meanings and
        // they must never look alike. Three of them are UNKNOWNS on the REQUIRED side of
        // the ledger; a silent confident 0.0 there is the defect class this codebase
        // refuses. Each state says which it is, and the unknowns flag the requirement.
        if (mit.bermState === "unknown-grade") mitR.push(warnNote("Pond berms can't be priced: no existing-ground elevation reached this site.", "mit-berm-unk-grade",
          "A berm's fill volume is its crest height ABOVE existing ground, so with neither the per-cell 3DEP grid nor a typed existing grade there is no height to price and the berm's share of the requirement is UNKNOWN — not zero. ↻ Re-check to fetch the terrain grid, or type an existing grade in the pond's Properties."));
        else if (mit.bermState === "unknown-wse") mitR.push(warnNote("Pond berms sit in the floodplain but no flood elevation resolved — their share is unknown.", "mit-berm-unk-wse",
          "Only the part of a berm BELOW the flood water surface displaces storage. With no governing flood elevation (published BFE or an accepted estimate) that slice can't be measured, so the berm's share of the requirement is UNKNOWN rather than zero. Enter a BFE, or accept the screening estimate, in the Floodplain inputs."));
        else if (mit.bermState === "unknown-anchor") mitR.push(warnNote("A pond has no top-of-bank elevation, so it isn't known whether it's bermed.", "mit-berm-unk-anchor",
          "Whether a basin is cut into the ground or built up behind an embankment is the difference between zero floodplain fill and a real requirement. Set the pond's top-of-bank elevation in its Properties to resolve it."));
        else if (mit.bermState === "upland") mitR.push(keyedNote(`${mit.bermCount === 1 ? "The pond berm sits" : "Pond berms sit"} outside the mapped floodplain — earthwork only, no mitigation owed.`, "mit-berm-upland",
          "A berm above existing ground is placed fill, but only fill INSIDE the mapped floodplain and BELOW the flood water surface displaces storage. This one is upland, so it prices as earthwork and adds nothing here."));
        else if (mit.bermState === "none") mitR.push(keyedNote("No pond berms — every basin is cut at or below existing ground.", "mit-berm-none",
          "Each pond's top of bank sits at or below the surrounding ground, so nothing is built up above grade and no berm fill enters the requirement. A confident zero, not a missing number."));
      } else {
        mitR.push(warnNote("Fill priced at element footprints — daylight/transition slopes aren't counted here; treat as a floor.", "mit-wedge-floor",
          "Past a pad or court edge, fill continues as a graded wedge (3:1 default) down to existing grade; inside the mapped floodplain that wedge displaces storage too. Wedges price automatically once the auto-graded surface exists — enter an FFE (or let the code-minimum auto-pad engage) to generate it."));
      }
    } else if (d.floodGeo && d.floodGeo.state === "loaded" && d.floodGeo.zoneCount === 0) {
      // B824 — card-migrated honest state: a verified NONE is said out loud.
      mitR.push(keyedNote("No mapped flood zones intersect the site envelope (FEMA NFHL, verified source) — no mitigation trigger on this screening pull.", "mit-nozones"));
    } else if (mit && mit.intersectAcres === 0 && d.floodGeo && d.floodGeo.state === "loaded" && d.floodGeo.zoneCount > 0) {
      mitR.push(keyedNote("Mapped flood zones are near, but no drawn fill footprint intersects them — mitigation volume 0 on this layout.", "mit-nointersect"));
    } else if (d.mitRememberedMissing) {
      // NEW-2(b) — a remembered check with no restorable mitigation: an explicit row +
      // re-check prompt, never a silently-missing ledger (the "isn't calculating" report).
      mitR.push(row("Floodplain mitigation", "not screened in this remembered view"));
      mitR.push(warnNote("Mitigation wasn't saved with this remembered check — ↻ re-check to screen it.", "mit-remembered-missing", "The remembered result predates the mitigation ledger, so fill volume hasn't been screened against the mapped floodplain in this view. ↻ Re-check drainage criteria to price it."));
    }
    // NEW-4 — FLOOD-LEVEL SENSITIVITY. In unstudied Zone A the flood level is an
    // ESTIMATE standing in for a base flood elevation FEMA never published, and on a flat
    // site the whole mitigation obligation can rest on a few inches of it (Tsakiris: 0.2
    // ac-ft, because the estimated surface sits about a quarter foot above grade). This
    // ladder answers the underwriting question — does a flood level two feet higher make
    // that 2 ac-ft or 20? Every row comes from fmEvalAtWse, the SAME evaluator the live
    // panel uses, so a scenario can never disagree with the number above it.
    if (d.wseSweep && d.wseSweep.ok) {
      const sw = d.wseSweep;
      if (sw.flat) {
        // A flat answer is still an answer, and a short one: folded, one line.
        mitR.push(keyedNote(`Flood-level sensitivity: nothing moves from ${f1(sw.baseWseFt)}′ up to +${Math.max(...sw.stepsFt)}′.`, "wse-sens-flat"));
      } else {
        const maxReq = sw.rows.reduce((mx, r) => Math.max(mx, r.mitigationAcFt ?? 0), 0);
        mitR.push(
          <div key="wse-sens" data-testid="yield-wse-sensitivity" style={{ padding: "4px 0 2px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3, fontSize: 11, fontWeight: 700, color: Y.rowLabel, letterSpacing: "0.02em" }}>
              If the flood level is higher
              <RowInfo label="Flood-level sensitivity" sections={[
                { text: "This site's floodplain has a mapped boundary but no published base flood elevation, so the flood level driving the requirement above is an estimate. These rows re-run the same check at higher flood levels, to show how fast the obligation grows if the estimate is low." },
                { text: "Screening only, and not a design allowance — an engineer's study sets the number a reviewer will accept." },
              ]} />
            </div>
            {sw.rows.map((r) => (
              <div key={`ws-${r.stepFt}`} style={ROWSB}>
                <span style={{ fontFamily: NUM_FONT, fontSize: 11, color: r.stepFt === 0 ? Y.text : Y.muted, fontVariantNumeric: TABULAR_NUMS, whiteSpace: "nowrap", minWidth: 62 }}>
                  {r.stepFt === 0 ? "now" : `+${f1(r.stepFt)}′`} · {f1(r.wseFt)}′
                </span>
                {r.unknown ? (
                  <span style={{ fontSize: 11, color: Y.warnText, fontWeight: 700 }}>unknown</span>
                ) : (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                    <BulletBar layout={bulletBarLayout({ provided: r.creditedAcFt ?? 0, required: r.mitigationAcFt, reference: maxReq })} Y={Y} width={110} />
                    <span style={{ fontFamily: NUM_FONT, fontSize: 11.5, fontWeight: 700, fontVariantNumeric: TABULAR_NUMS, color: Y.text, minWidth: 54, textAlign: "right" }}>
                      {r.mitigationAcFt == null ? "—" : `${f2(r.mitigationAcFt)} AC-FT`}
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        );
        if (sw.anyUnknown) mitR.push(keyedNote("Some flood levels in the ladder can't be priced — those rows read unknown rather than zero.", "wse-sens-unk"));
      }
    }
    if (d.unanchoredInTrigger > 0) mitR.push(warnNote(`${d.unanchoredInTrigger} floodplain pond${d.unanchoredInTrigger > 1 ? "s" : ""} not elevation-anchored — gross volume OVERSTATES usable detention.`, "mit-unanch", "An unanchored pond can't split usable from dead storage at the flood water surface, so the gross volume above overstates usable detention. Set each pond's top-of-bank elevation in its panel."));
    // B822 — the anchored-but-WSE-unknown half: the anchor exists (manual or the 3DEP
    // auto), the reach's flood elevation doesn't — the BFE input is what's missing.
    if (d.anchoredNoWseInTrigger > 0) mitR.push(actionWarn(`${d.anchoredNoWseInTrigger} anchored floodplain pond${d.anchoredNoWseInTrigger > 1 ? "s" : ""} — flood WSE unknown; gross OVERSTATES.`, "mit-anch-nowse", "The pond has a top-of-bank anchor but the reach's flood elevation is unknown, so usable storage can't be split from flood-occupied volume. Enter a BFE (inputs below) — on Fort Bend Zone A the DRAFT Atlas-14 raster usually supplies it automatically.", () => jumpToDrainField("bfeFt"), "Set BFE →"));
    if (d.pondFullyInundated) mitR.push(warnNote("A pond's top of bank sits at/below the flood WSE — its usable detention is ZERO.", "mit-inund", "Fully inundated in the design flood: every acre-foot below the flood water surface is already water, so the pond credits nothing. Fix: click ⚡ Optimize pond on the Detention card to raise the rim above the flood level in one click."));
    if (d.floodGeo && d.floodGeo.state === "failed") mitR.push(warnNote("Flood-zone geometry unavailable — mitigation not screened; re-check.", "fmgeo-fail", "The flood-zone source didn't answer, so nothing could be screened this check. An outage is never an all-clear — re-check shortly."));
    if (d.floodGeo && d.floodGeo.truncated) mitR.push(warnNote("The flood-zone pull hit the feature cap — mitigation figures may UNDERCOUNT; treat them as a floor.", "fmgeo-trunc"));
    if (d.floodGeo?.wse02Flags && d.floodGeo.wse02Flags.state === "failed") mitR.push(warnNote("Fort Bend's study server didn't answer — the DRAFT 0.2% WSE couldn't be read.", "mit-wse02-fail", "An outage is never a value: the 0.2% band stays honest-unknown this check. Re-check shortly or enter a 0.2% WSE from the effective FIS profile."));
    if (d.floodGeo?.wse100Flags && d.floodGeo.wse100Flags.state === "failed") mitR.push(warnNote("Fort Bend's study server didn't answer — the DRAFT 1% WSE couldn't be read.", "mit-wse100-fail", "An outage is never a value: the 1% band stays honest-unknown this check. Re-check shortly or enter a BFE."));
  }
  if (req && req.kind === "point" && req.requiredAcFt > 0 && usableAcFt != null) {
    const diff = usableAcFt - req.requiredAcFt; // compare USABLE volume (Regime B credits nothing below the pool)
    detR.push(
      <div key="deficit" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${Y.hairline}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: Y.rowLabel }}>{diff >= 0 ? "Surplus" : "Shortfall"}</span>
        <span style={{ fontFamily: NUM_FONT, fontSize: 13, fontWeight: 750, fontVariantNumeric: TABULAR_NUMS, color: diff >= 0 ? Y.green : Y.dangerText }}>
          {fmtSignedAcFt(diff)} AC-FT
        </span>
      </div>
    );
  }
  if (d.tier) {
    // NEW-4 dedupe: on a Harris site whose HCFCD channel lookup FAILED, the dedicated
    // "channel data unavailable" warning below already says adjacency is unknown — drop
    // the tier's redundant "Channel adjacency unknown" so it renders once.
    const tierUnknowns = d.channelFailed ? d.tier.unknowns.filter((u) => u.id !== "regulated-channel") : d.tier.unknowns;
    // NEW-1(a) — triggers + unknowns fold into the tier row's ⓘ instead of two notes.
    const tierInfo = [
      d.tier.triggers.length ? `Triggers: ${d.tier.triggers.map((t) => `${t.label}${t.detail ? `: ${t.detail}` : ""}`).join(" · ")}` : "",
      tierUnknowns.length ? `Unknown: ${tierUnknowns.map((u) => u.label).join(" · ")}` : "",
      d.tier.tier === "dia"
        ? "A full drainage impact analysis (H&H study) is the likely bar at this size / with these triggers."
        : "Rate-method detention is likely sufficient — no DIA trigger found on this screen.",
    ].filter(Boolean).join("\n");
    detR.push(infoRow("Analysis tier", d.tier.tier === "dia" ? "Full DIA" : "Rate method", tierInfo, { key: "tier" }));
  }
  if (d.floodFailed) detR.push(warnNote("Flood-zone data unavailable — tier and regime can't be assessed.", "floodfail", "An outage is never an all-clear: the analysis tier and hydraulic regime stay unassessed until the source answers. Re-check shortly."));
  if (d.regime) {
    // NEW-1(a) — the regime collapses to ONE verdict line ("Regime B — floodplain/
    // tailwater governed ⓘ"); reasons, consequence ("never assume a deep outfall helps
    // here"), the wet-bottom note and the outfall value-of-information all move into ⓘ.
    const regimeInfo = [
      ...d.regime.reasons,
      d.regime.consequence,
      d.regime.wetBottomWarning ? "Wet-bottom note: permanent pool below the static water surface does not count toward detention." : "",
      d.outfall ? `${d.outfall.headline} ${d.outfall.detail}` : "",
      // B807 — the regime verdict itself keys published FEMA BFEs only (screening
      // honesty, unchanged); this one line discloses the DRAFT stand-in pricing.
      d.mitigation?.providers?.wse1pct === "fbcdd-wse100-draft"
        ? "A DRAFT Atlas-14 watershed-study 1% WSE is pricing the floodplain mitigation — the regime verdict itself still keys published FEMA BFEs only."
        : "",
    ].filter(Boolean).join("\n");
    detR.push(
      <div key="regime" title={regimeInfo} style={{ display: "flex", alignItems: "baseline", gap: 4, padding: "5px 0", borderBottom: `1px solid ${Y.hairline}`, cursor: "help" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: d.regime.regime === "B" ? Y.warnText : Y.rowLabel }}>{d.regime.label}</span>
        <span style={{ fontSize: 9.5, color: Y.muted }} aria-hidden="true">ⓘ</span>
      </div>
    );
    // NEW-1 — "Regime unknown" must state its CAUSE and the ONE resolving action, never a
    // naked label. Each unknown flag maps to a one-line cause → action (with the jump/↻ that
    // resolves it), so the user is never left decoding the bare word.
    if (d.regime.regime === "unknown") {
      const fl = d.regime.flags || [];
      if (fl.includes("no-published-bfe")) {
        detR.push(actionWarn("Cause: Zone A with no published BFE: the governing water surface can't be read from the map.", "regime-unk-bfe",
          "Enter a 1% BFE (inputs below), or accept the boundary-grade estimate, so the regime and the usable/dead split can resolve. On Fort Bend Zone A the DRAFT Atlas-14 raster usually supplies it automatically.", () => jumpToDrainField("bfeFt"), "Enter BFE →"));
      } else if (fl.includes("bfe-datum-unpublished")) {
        detR.push(warnNote("Cause: the published BFE has no vertical datum — confirm it before comparing elevations.", "regime-unk-datum", "An elevation without its datum (usually NAVD88) can be off by feet; confirm against the FIRM panel."));
      } else if (fl.includes("ground-elevation-missing")) {
        /* NEW-2(b)/NEW-3 — WHY the grade is missing is now a KNOWN fact with four
           outcomes, and they want different words: "still loading" is not a to-do,
           "the federal service failed" names the service, and only two of the four are
           a ↻. PANEL-BREVITY rule 5 + the B1104/NEW-5 precedent: the SUBJECT is
           computed so the budget still counts ONE literal, and WHICH of the four it is
           — with the service named and the held value's age — rides `groundElevNote` in
           the note's info argument (hover, exempt) rather than a visible line each.
           COLLAPSED, never deleted. An unresolved grade reads as UNRESOLVED in every
           branch, never as zero; only the two states a re-pull could fix offer the ↻. */
        const gs = d.groundElev || null;
        const gSt = gs && gs.status;
        const gSubject = gSt === "pending" ? "is still loading" : "is unresolved";
        const gRetry = gSt !== "pending" && gSt !== "void";
        const gLine = `Cause: site grade ${gSubject} — nothing is assumed in its place, so the regime can't settle against the BFE.`;
        detR.push(gRetry
          ? actionWarn(gLine, "regime-unk-grade", d.groundElevNote, () => d.onCheck && d.onCheck(), "↻ Re-check")
          : warnNote(gLine, "regime-unk-grade", d.groundElevNote || undefined));
      } else {
        detR.push(warnNote(`Cause: ${(d.regime.reasons && d.regime.reasons[0]) || "flood facts not established"}. ↻ Re-check to resolve.`, "regime-unk-other"));
      }
    }
  }
  for (const w of d.watersheds) detR.push(warnNote(`${w.authorityLabel}: ${w.note}`, w.id));
  if (d.watershedFailed) detR.push(warnNote("HCFCD watershed data unavailable — supplemental-retention screening skipped.", "wsfail", "Any Addicks/Barker or Upper-Cypress Creek supplemental-retention requirement can't be screened while the watershed source is down."));
  // NEW-2/B861 — drainage-district membership (BKDD): ADDITIVE to the county, so it
  // renders whether or not a reviewer resolved. The overlay's `short` is the rate-
  // control stamp; its `detail` ⓘ carries the full basis (hydrograph routing, PE/RPLS
  // seals, 365-day permit, datum trap). A boundary-source outage is an honest unknown.
  for (const dd of d.districtOverlays) detR.push(warnNote(dd.short, "district-" + (dd.id || dd.name), dd.detail));
  // The county's volumetric number renders as usual — stamp it a PROXY inside a
  // rate-control district (final sizing is hydrograph routing, not a volume).
  if (d.districtOverlays.length && req && (req.kind === "point" || req.kind === "band")) {
    detR.push(warnNote("Rate-control district: the volume above is a screening proxy, not the sizing basis.", "district-proxy", "Inside the Brookshire–Katy DD detention is sized by RATE (post-development peak ≤ pre-development at the 2/10/100-yr storms, offsite areas included) via hydrograph routing (HEC-HMS) — there is no volumetric AC-FT/AC rule. The number above is the county's volumetric screening estimate; treat it as a scale proxy only, and let the district engineer's routing govern."));
  }
  if (d.districtFailed) detR.push(warnNote("Drainage-district membership unverified — the boundary source didn't answer.", "districtfail", "The Brookshire–Katy DD boundary layer didn't respond, so district membership couldn't be confirmed on this check — an outage is never a 'not in a district'. ↻ Re-check shortly."));
  // NEW-1(d) — suppress the "district criteria may ALSO apply" note for any district
  // that is already the applied reviewing jurisdiction above (it isn't an ALSO then).
  if (d.mudDistricts.length) {
    const reviewerLbl = (d.reviewer?.label || "").toLowerCase();
    const shownMuds = d.mudDistricts.filter((m) => {
      const nm = String(m.name || "").toLowerCase();
      return !(reviewerLbl && nm && (reviewerLbl.includes(nm) || nm.includes(reviewerLbl)));
    });
    if (shownMuds.length) detR.push(keyedNote(`In ${shownMuds.map((m) => m.name).join(", ")} — district drainage criteria may also apply; verify with the district's engineer.`, "mud"));
  }
  if (d.mudFailed) detR.push(warnNote("MUD / water-district data unavailable — district criteria can't be screened.", "mudfail", "Can't tell whether a municipal utility / water district's own drainage criteria apply until the TCEQ source answers."));
  if (d.channelFailed) detR.push(warnNote("HCFCD channel data is unavailable — channel adjacency unknown.", "chanfail"));
  if (d.multiParcel) detR.push(keyedNote("Checked against the largest active parcel.", "multi"));
  // NEW-1(e) — the remembered/stale provenance + re-check now live in the single status
  // line at the TOP of the readout (no trailing "remembered" line, no bottom button).
  // B712 — the mitigation inputs: jurisdiction defaulted from the resolved
  // drainage authority (stored only on override — the B74 pattern) + the
  // elevation set. ALL blank by default (the road-cost unit-price pattern);
  // a blank input reads UNKNOWN downstream, never zero. Inline editors only.
  if (d.floodMit) {
    const fm = d.floodMit;
    const fmRuleRow = fm.rules[fm.jurKey] || fm.rules.generic;
    const fmInputStyle = { width: 78, padding: "3px 6px", border: `1px solid ${Y.border}`, borderRadius: 6, background: "transparent", color: Y.text, fontSize: 11.5, fontFamily: "inherit", textAlign: "right" };
    // NumInput never commits a cleared field (it restores the old value), so
    // every "blank = auto/unknown" input carries an explicit Clear chip — the
    // expert bypass especially must never be one-way.
    const fmRow = (label, key, placeholder, title) => (
      <div key={"fm-" + key} id={"drain-field-" + key} title={title || ""} style={ROWSB}>
        <span style={{ fontSize: 11, color: Y.muted }}>{label}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {Number.isFinite(fm.settings[key]) && (
            <button
              type="button"
              title="Clear — back to blank (auto / unknown)"
              onClick={() => fm.onChange({ [key]: null })}
              style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, padding: "2px 7px", borderRadius: RADIUS.pill, border: `1px solid ${Y.border}`, background: "transparent", color: Y.muted }}
            >×</button>
          )}
          <NumInput allowClear style={fmInputStyle} value={Number.isFinite(fm.settings[key]) ? fm.settings[key] : ""} placeholder={placeholder || "—"} onCommit={(n) => fm.onChange({ [key]: Number.isFinite(n) ? n : null })} />
        </span>
      </div>
    );
    // NEW-1(b) — an AUTO-RESOLVED elevation reads as grey "~value · source" text (not an
    // input) until tapped: the common case is "leave it on the auto value", so the input
    // field is noise. Tap "edit" to override; the "auto" chip collapses back. Falls back
    // to the plain input when there's no auto value to show.
    const autoField = (label, key, autoVal, sourceLabel, title, opts = {}) => {
      const manual = Number.isFinite(fm.settings[key]) ? fm.settings[key] : null;
      const hasAuto = autoVal != null && isFinite(autoVal);
      const editing = drainEditField === key;
      // NEW-2/NEW-3 — srcKey: a provenance tag stored beside the value
      // ("est-boundary-grade" / "suggested-accepted"). Typing or clearing the
      // value ALWAYS clears the tag — a stale tag would mislabel a manual entry.
      const srcPatch = opts.srcKey ? { [opts.srcKey]: null } : {};
      // B895 — the field's current SourceTag. A raw typed number (no stored src) is
      // always YOURS. `opts.srcIsWseProvider` fields (bfeFt/wse02Ft) store a real
      // WSE_PROVIDER_LABEL code even once "manual", so classifyWseSource resolves it
      // precisely; other srcKey fields (padSrc's "suggested-accepted") just mean "the
      // committed value is the same accepted suggestion" — reuse the caller's tag.
      const storedSrc = opts.srcKey ? fm.settings[opts.srcKey] : null;
      const fieldTag = manual != null
        ? (!storedSrc ? { code: "yours" } : opts.srcIsWseProvider ? { code: classifyWseSource(storedSrc) } : opts.tag)
        : (hasAuto ? opts.tag : null);
      if (manual == null && hasAuto && !editing) {
        return (
          <div key={"fm-" + key} id={"drain-field-" + key} title={title || ""} style={ROWSB}>
            <span style={{ fontSize: 11, color: Y.muted }}>{label}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {/* NEW-3 — the one-click accept: writes the suggestion into the field
                  with provenance; distinct from "edit" (type your own value). */}
              {opts.accept && (
                <button type="button" title={opts.accept.title || ""} onClick={() => { fm.onChange(opts.accept.patch); setDrainEditField(null); }} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: RADIUS.pill, border: `1px solid ${Y.border}`, background: "transparent", color: Y.rowLabel }}>{opts.accept.label || "✓ use"}</button>
              )}
              <button type="button" onClick={() => setDrainEditField(key)} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ fontSize: 11.5, fontFamily: NUM_FONT, color: Y.rowLabel }}>~{f1(autoVal)}′</span>
                <span style={{ fontSize: 10, color: Y.muted }}>· {sourceLabel}</span>
                <span style={{ fontSize: 10, color: Y.muted, textDecoration: "underline" }}>edit</span>
              </button>
              {fieldTag ? <span onClick={(e) => e.stopPropagation()}><SourceTag code={fieldTag.code} label={label} basis={fieldTag.basis} /></span> : null}
            </span>
          </div>
        );
      }
      return (
        <div key={"fm-" + key} id={"drain-field-" + key} title={title || ""} style={ROWSB}>
          <span style={{ fontSize: 11, color: Y.muted }}>{label}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {manual != null && (
              <button type="button" title="Clear — back to blank (auto / unknown)" onClick={() => { fm.onChange({ [key]: null, ...srcPatch }); setDrainEditField(null); }} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, padding: "2px 7px", borderRadius: RADIUS.pill, border: `1px solid ${Y.border}`, background: "transparent", color: Y.muted }}>×</button>
            )}
            {manual == null && hasAuto && (
              <button type="button" title={`Use the auto value (~${f1(autoVal)}′ · ${sourceLabel})`} onClick={() => setDrainEditField(null)} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, padding: "2px 7px", borderRadius: RADIUS.pill, border: `1px solid ${Y.border}`, background: "transparent", color: Y.muted }}>auto</button>
            )}
            <NumInput allowClear style={fmInputStyle} value={manual != null ? manual : ""} placeholder={hasAuto ? `~${f1(autoVal)}` : "—"} onCommit={(n) => fm.onChange({ [key]: Number.isFinite(n) ? n : null, ...srcPatch })} />
            {manual != null && fieldTag ? <SourceTag code={fieldTag.code} label={label} /> : null}
          </span>
        </div>
      );
    };
    // Fort Bend keys the 0.2% mitigation basis to the effective FIRM 48157C FIS (B794).
    const fmFortBend = fm.siteCounty === "fortbend" || (fm.identifyCounties || []).some((c) => /fort\s*bend/i.test(String(c)));
    mitR.push(
      <div key="fm-inputs" style={{ marginTop: 8, border: `1px solid ${Y.border}`, borderRadius: 8, padding: "7px 9px", background: Y.cardBg }}>
        {/* NEW-1(c) — the datum / blank-reads-UNKNOWN / newer-model footnote folds into
            an ⓘ on the header instead of a paragraph at the bottom of the block. */}
        <div title={"Feet NAVD88 (convert NGVD29 documents first — mixed datums are a multi-foot silent error). Blank inputs read UNKNOWN, never zero. Jurisdictions may enforce newer model elevations than the effective FIRM — when in doubt, enter the higher. Only tick “verified” after confirming the CURRENT ordinance text."}
          style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: Y.rowLabel, marginBottom: 4, cursor: "help" }}>
          Floodplain mitigation inputs (ft NAVD88)<span style={{ fontSize: 9, marginLeft: 4, letterSpacing: 0 }} aria-hidden="true">ⓘ</span>
        </div>
        <div style={ROWSB}>
          <span style={{ fontSize: 11, color: Y.muted }}>Jurisdiction</span>
          {/* B790 — Auto is a real, reachable state (the B750 agency-picker pattern):
              selecting it writes jurKey:null so detection re-engages; a hand-pick
              sticks until the user returns to Auto. */}
          <select value={fm.jurKeyOverride || ""} onChange={(e) => fm.onChange({ jurKey: e.target.value || null })} style={{ ...fmInputStyle, width: 168, textAlign: "left", cursor: "pointer" }}>
            <option value="">Auto · detected: {(fm.rules[fm.detectedJurKey] || fm.rules.generic).label}</option>
            {Object.entries(fm.rules).map(([k, r2]) => <option key={k} value={k}>{r2.label}</option>)}
          </select>
        </div>
        {(() => {
          // B790 — a hand-picked rule whose implied county contradicts the identify
          // county gets a loud mismatch row (the sticky-"harris"-on-Fort-Bend class).
          const impliedCounty = fm.jurKeyOverride ? floodJurCounty(fm.jurKeyOverride) : null;
          const ids = fm.identifyCounties || [];
          if (!impliedCounty || !ids.length || ids.some((c) => String(c).toLowerCase().includes(impliedCounty))) return null;
          const detectedLabel = (fm.rules[fm.detectedJurKey] || fm.rules.generic).label;
          return warnNote(`You picked ${fmRuleRow.label} but the county map reads ${ids.join(" + ")} — switch Jurisdiction to Auto.`, "fm-jur-mismatch", `The hand-picked rule's county contradicts the identify county, so the ${detectedLabel} rule likely applies here. Auto re-engages detection.`);
        })()}
        {/* NEW-3 — a blank pad defaults to the code-minimum required FFE (greyed
            placeholder, the B755 derived-value pattern); typing overrides it. */}
        {/* NEW-1(b) + NEW-3 — pad / grade / BFE / 0.2% render as grey "~value · source"
            text until tapped (auto pad = code-min FFE, grade = 3DEP, BFE = derived lines,
            0.2% = FBCDD DRAFT raster). No auto value → the plain blank input. */}
        {(() => {
          // NEW-3 — the suggested pad FFE: the ghost names its GOVERNING basis
          // ("code min = HAG 153.1′ + 4′ — Waller §D(5)"), losing bases ride the
          // tooltip, and ✓ use writes it with provenance. Buildings fully outside
          // the trigger bands suppress the suggestion — the county FFE rule
          // doesn't bind there, and we say so instead of fabricating a number.
          const sf = fm.suggestFfe;
          // NEW-4 — the SITE-BASED tier: a good-practice screening pad from the pond's
          // design water surface (+ HAG margin), offered ONLY when no ordinance FFE rule
          // binds. Distinct provenance (never dressed as a rule) + its own chip.
          const isSite = !!(sf && sf.applies && sf.basisKind === "site");
          const noRule = !!(sf && sf.applies === false);
          const gb = sf && sf.applies ? sf.governingBasis : null;
          // Value: an ordinance suggestion reads the AUTO code-min FFE; the SITE basis
          // reads its own computed value.
          const suggVal = isSite
            ? (Number.isFinite(sf.requiredFfeFt) ? sf.requiredFfeFt : null)
            : (!noRule && fm.autoFfe && Number.isFinite(fm.autoFfe.requiredFfeFt) ? fm.autoFfe.requiredFfeFt : null);
          const gbWse = !isSite && gb && suggVal != null && Number.isFinite(gb.plusFt) ? suggVal - gb.plusFt : null;
          const basisTxt = isSite
            ? (gb ? gb.label : "site basis")
            : (gb ? `${gbWse != null ? `${f1(gbWse)}′ ` : ""}(${gb.label || gb.basis}) + ${gb.plusFt}′` : null);
          const estTag = sf && sf.applies && sf.estimated ? " · ESTIMATED" : "";
          const losing = sf && sf.applies && sf.losingBases && sf.losingBases.length
            ? ` Non-governing bases: ${sf.losingBases.map((b) => isSite ? `${b.label} → ${f1(b.ffe)}′` : `${b.label || b.basis} + ${b.plusFt}′ → ${f1(b.requiredFfeFt)}′`).join("; ")}.`
            : "";
          // NEW-4 — when an ordinance rule binds, the site-based screening pad is superseded;
          // it demotes to this tooltip note (not a competing suggestion).
          const siteDemote = !isSite && sf && sf.applies && sf.site && Number.isFinite(sf.site.requiredFfeFt)
            ? ` A site-based screening pad (~${f1(sf.site.requiredFfeFt)}′ from the pond design WSE / adjacent grade) is superseded here by the ordinance minimum.`
            : "";
          const ghostLabel = isSite ? `SITE-BASED = ${basisTxt}${estTag}` : basisTxt ? `code min = ${basisTxt}${estTag}` : "code min";
          const rows = [autoField("Pad / finished floor (FFE)", "padFfeFt",
            suggVal,
            ghostLabel,
            (noRule
              ? OUTSIDE_FLOODPLAIN_FFE_NOTE + " "
              : isSite
                ? SITE_BASED_FFE_NOTE + " ✓ use writes it into the Pad/FFE field (re-prices the fill ledger + FFE check); tap edit to enter a real design pad."
                : "Blank = the code-minimum required FFE is ASSUMED (the rule dictates the floor on a floodplain fill). The plan-level pad elevation; a selected element's own padElevFt overrides it. ✓ use writes the suggestion (re-prices the fill ledger + FFE check); tap edit to enter a real design pad.") + losing + siteDemote,
            {
              srcKey: "padSrc",
              accept: suggVal != null && !Number.isFinite(fm.settings.padFfeFt)
                ? { label: "✓ use", title: `Write the suggested ${f1(suggVal)}′ into the Pad/FFE field${basisTxt ? ` — ${isSite ? "SITE-BASED: " : ""}${basisTxt}` : ""}${estTag ? " (from an ESTIMATED water surface — screening only)" : ""}`, patch: { padFfeFt: Math.round(suggVal * 10) / 10, padSrc: "suggested-accepted" } }
                : null,
              tag: isSite
                ? { code: "estimate", basis: "Screening pad from your pond's design water surface — not an ordinance minimum." }
                : { code: "code", basis: "Code-minimum required finished-floor elevation, from the governing basis below." },
            })];
          // NEW-4 — the SITE-BASED provenance chip, so the pad's origin never reads as a rule.
          if (isSite) {
            rows.push(
              <div key="fm-ffe-site" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: Y.muted, lineHeight: 1.45, padding: "1px 0 3px" }} title={SITE_BASED_FFE_NOTE}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.05em", color: "var(--on-accent)", background: "var(--accent)", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" }}>SITE-BASED</span>
                <span>Screening pad from your pond's design water surface — not an ordinance minimum; the reviewing agency sets the final FFE.</span>
              </div>
            );
          }
          if (noRule) {
            rows.push(
              <div key="fm-ffe-norule" style={{ fontSize: 10.5, color: Y.muted, lineHeight: 1.45, padding: "1px 0 3px" }} title={OUTSIDE_FLOODPLAIN_FFE_NOTE}>
                No suggested FFE: buildings sit outside the mapped floodplain — the county FFE rule doesn't bind them{sf && sf.unknownReason ? ` and ${sf.unknownReason}` : " (drainage-criteria / pond-WSE checks may still govern; verify locally)"}.
              </div>
            );
          }
          if (fm.padSrc === "suggested-accepted" && Number.isFinite(fm.settings.padFfeFt)) {
            rows.push(
              <div key="fm-ffe-prov" style={{ fontSize: 10, color: Y.muted, padding: "0 0 3px" }}>
                pad = accepted suggestion{basisTxt ? ` (${basisTxt}${estTag})` : ""} — × restores auto
              </div>
            );
          }
          return rows;
        })()}
        {autoField("Existing grade", "existGradeFt", fm.autoGradeFt, "3DEP",
          "Auto = the 3DEP bare-earth median sampled by this drainage check. Tap edit to enter a surveyed grade.",
          { tag: { code: "survey", basis: "3DEP bare-earth elevation, sampled at this drainage check." } })}
        {/* B807 — on unstudied Zone A (no FEMA lines to derive from) the greyed
            placeholder falls back to the FBCDD DRAFT Atlas-14 100-yr read, labeled
            DRAFT; the FEMA-lines derivation still wins when it exists (engine
            precedence: the draft raster is the LAST rung). */}
        {autoField("BFE (1% WSE)", "bfeFt",
          // B755 round 3 — same auto-tier precedence as the engine's own
          // zoneWaterSurface: cross-section (studied, most authoritative) beats
          // BFE-line interpolation beats the FBCDD DRAFT raster fallback.
          fm.derivedXsWsel && Number.isFinite(fm.derivedXsWsel.wselFt) ? fm.derivedXsWsel.wselFt
            : fm.derivedBfe && Number.isFinite(fm.derivedBfe.bfeFt) ? fm.derivedBfe.bfeFt
            : fm.derivedWse100 && Number.isFinite(fm.derivedWse100.wseFt) ? fm.derivedWse100.wseFt : null,
          fm.derivedXsWsel && Number.isFinite(fm.derivedXsWsel.wselFt) ? wseProvLabel("xs-wsel")
            : fm.derivedBfe && Number.isFinite(fm.derivedBfe.bfeFt) ? "derived (FEMA lines)" : "DRAFT (FBCDD 100-yr)",
          "Many AE reaches publish NO static BFE — the tool derives the 1% water surface from FEMA's regulatory cross-sections or BFE lines when it can (a screening estimate); on unstudied Zone A in Fort Bend it falls back to the county's DRAFT Atlas-14 100-yr raster. Tap edit to override with the FIRM panel / effective model.",
          { srcKey: "bfeSrc", srcIsWseProvider: true, tag: { code: "estimate", basis: "Derived from FEMA's regulatory cross-sections or published BFE lines, or (if unstudied) the FBCDD DRAFT Atlas-14 100-yr raster — not a published BFE." } })}
        {/* NEW-2 / B882 — unstudied Zone A with NO other 1% surface: offer the estimated
            BFE as an ACCEPT-GATED chip (never auto-committed), sourced by the provider
            REGISTRY (district model → FEMA InFRM EBFE → grade-@-boundary) and NAMED. */}
        {fm.estWse && !Number.isFinite(fm.settings.bfeFt) && (() => {
          const est = fm.estWse;
          const isGrade = est.provider === "est-boundary-grade";
          const gradeDet = isGrade ? est.detail : (est.detail && est.detail.grade ? est.detail.grade.detail : null);
          const gradeSuffix = isGrade && gradeDet
            ? ` (sampled ${f1(gradeDet.minFt)}–${f1(gradeDet.maxFt)}′${gradeDet.spreadFt > 2 ? " · sloped reach — coarse" : ""})` : "";
          return (
            <div key="fm-est-wse" style={ROWSB}
              title={`${estWseNote(est.provider)}${screeningStudyNote(fm.screening)}`}>
              <span style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.4 }}>
                Est. BFE ≈ {f1(est.wseFt)}′ — {est.providerLabel || wseProvLabel(est.provider)} (screening estimate){gradeSuffix}
              </span>
              <button type="button"
                title={`Write the estimate (${f1(est.wseFt)}′) into the BFE field with source “${est.providerLabel || wseProvLabel(est.provider)}” — every consumer (mitigation, heat map, pond split, FFE) stamps it ESTIMATED. Screening only, never a published/regulatory BFE; × on the field restores unknown.`}
                onClick={() => fm.onChange({ bfeFt: est.wseFt, bfeSrc: est.provider })}
                style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: RADIUS.pill, border: `1px solid ${Y.border}`, background: "transparent", color: Y.rowLabel, whiteSpace: "nowrap" }}>✓ use</button>
            </div>
          );
        })()}
        {/* B882 (scope additions) — the "challenge the estimate" signals, shown while the
            estimate is on offer so a go/no-go decision is never made on a screening number
            alone. (a) suspect vs grade · (c) cross-provider disagreement · (b) ±1 ft sensitivity. */}
        {fm.estWse && !Number.isFinite(fm.settings.bfeFt) && fm.estSanity && fm.estSanity.suspect &&
          warnNote(`⚠ SUSPECT estimate — ${fm.estSanity.reasons.map((r) => r.label).join("; ")} — verify first.`, "fm-est-suspect", fm.estSanity.reasons.map((r) => r.detail).join(" "))}
        {fm.estWse && !Number.isFinite(fm.settings.bfeFt) && fm.estDisagreement &&
          warnNote(`Estimates disagree — ${`${fm.estDisagreement.winner.label} ${f1(fm.estDisagreement.winner.wseFt)}′ vs ${fm.estDisagreement.other.label} ${f1(fm.estDisagreement.other.wseFt)}′ (Δ ${f1(fm.estDisagreement.absDeltaFt)}′)`}; higher used.`, "fm-est-disagree", "Both are screening estimates, not published BFEs — the higher source is used here. Disagreement between sources is itself a caution; a site-specific H&H / Atlas-14 study and the reviewing agency set the final value.")}
        {fm.estWse && !Number.isFinite(fm.settings.bfeFt) && fm.estSensitivity && fm.estSensitivity.sensitive &&
          warnNote(`⚠ ESTIMATE-SENSITIVE — ${fm.estSensitivity.flips.map((fl) => EST_FLIP_LABEL[fl.key] || fl.key).join(", ")} changes within ±1 ft.`, "fm-est-sensitive", "The mitigation volume, required finished-floor, buildability verdict and/or detention split flip within a ±1-ft band around this screening estimate — exactly the range a sealed H&H / Atlas-14 study resolves. Don't kill or commit the deal on the screening number alone.")}
        {/* NEW-1 (B1089) — THE SCREENING STUDY'S DECLINE IS NEVER SILENT, and a committed
            estimate can no longer suppress it. Previously this fact reached the user ONLY
            through the hover on the accept-gated estimate row above, which renders only
            while NO elevation has been committed — so on a site that already carries one
            (Tsakiris), the study ran, declined, and said nothing at all. B1036's silent-zero
            class, and worst exactly where it matters most: the terrain that defeats a
            screening method is the terrain that most needs a sealed study.

            PANEL-BREVITY, and this is why it is ONE template rather than branches: the two
            facts are the same story ("your flood level is a screening estimate, and the
            better method could not improve on it"), so they CONSOLIDATE into the line that
            already existed instead of adding one. Net ZERO new lines in the case that
            motivated the fix. The named state carries the visible half (rule 3); the reason
            and its implication — including the §5.C(3) connection — ride the ⓘ. */}
        {(() => {
          const declined = screeningDeclined(fm.screening);
          const estCommitted = isEstimatedWseSrc(fm.bfeSrc) && Number.isFinite(fm.settings.bfeFt);
          if (!declined && !estCommitted) return null;
          return warnNote(
            `${estCommitted ? `BFE is ${wseProvLabel(fm.bfeSrc)}` : "Flood level"} — ${declined ? `screening can't improve it: ${declined.state}` : "screening only"}`,
            "fm-est-bfe",
            `${estCommitted ? estWseNote(fm.bfeSrc) : ""}${declined ? `${estCommitted ? " " : ""}${declined.detail}` : ""}`,
          );
        })()}
        {/* NEW-3 (B1057 completion) — THE ORDINANCE TRIGGER. One line, because this is a
            SUBMITTAL REQUIREMENT that belongs in schedule and budget at the front of a
            project rather than surfacing in review: on an approximate A zone over the
            threshold, the county requires the developer to GENERATE the base flood and
            500-year elevations with Atlas 14. PANEL-BREVITY: the verbatim citation, the
            thresholds and the provenance ride the ⓘ hover, never the default view. The
            `verified` flag decides the wording — a county ordinance we have read states
            it; the federal fallback says "likely" and names itself as unconfirmed. */}
        {fm.bfeDataReq && warnNote(
          `Atlas-14 BFE + 500-yr data ${fm.bfeDataReq.verified ? "REQUIRED" : "likely required"} with the submittal — ${fm.bfeDataReq.citation}.`,
          "fm-bfe-data-req",
          `${fm.bfeDataReq.plain} Verbatim: “${fm.bfeDataReq.quote}” — ${fm.bfeDataReq.source}${fm.bfeDataReq.note ? ` ${fm.bfeDataReq.note}` : ""}${fm.bfeDataReq.verified ? "" : " NOT confirmed against this county's adopted ordinance — 44 CFR 60.3 binds the COMMUNITY and reaches a developer only through the local ordinance, which may be stricter."} Trigger: more than ${fm.bfeDataReq.lotsThreshold} lots or ${fm.bfeDataReq.acresThreshold} acres, whichever is lesser${Number.isFinite(fm.bfeDataReq.acres) ? ` — this site measures ${f1(fm.bfeDataReq.acres)} AC` : ""}.`,
        )}
        {/* B794 — the ⓘ names WHERE the number comes from, county-specific: Fort Bend's
            mitigation basis is the effective FIRM 48157C FIS (2014-04-02, pre-Atlas-14). */}
        {autoField("0.2% (500-yr) WSE", "wse02Ft",
          Number.isFinite(fm.derivedWse02Ft) ? fm.derivedWse02Ft : null,
          fm.derivedWse02Src === "fbcdd-wse02-draft" ? "DRAFT (FBCDD)"
            : fm.derivedWse02Src === "maapnext-wse02" ? "MAAPnext (screening)"
            : fm.derivedWse02Src === "ebfe-wse02" ? "InFRM BLE (screening)"
            // NEW-1 — Planyr's own study fills BOTH fields from ONE derivation, so the
            // 1% and the 0.2% here cannot come from mismatched methods or vintages.
            : fm.derivedWse02Src === "screening-bfe-wse02" ? "Planyr Atlas-14 (screening)" : "screening",
          fmFortBend
            ? "From the EFFECTIVE FIS profile — Fort Bend: countywide FIRM 48157C, eff. 2014-04-02 (pre-Atlas-14, the basis FBCDD Interim §9 references). The Atlas-14 DRAFT raster auto-fills a labeled stand-in when it can (screening only); tap edit to enter the FIS value."
            : "Not an NFHL attribute — from the effective FEMA FIS profile, HCFCD MAAPnext model, or FEMA InFRM Base Level Engineering (screening estimate, B882); tap edit to enter the effective FIS value.",
          { tag: { code: "estimate", basis: "A DRAFT/screening 0.2% water surface — not a published FIS value." } })}
        {/* NEW-1(c) — dock-drop row only when dock-stack court elements exist. */}
        {fm.hasDockElements && fmRow("Dock-high drop: court below slab FF (ft)", "dockDropFt", "4", "Industrial dock-high: building-attached truck courts + their trailer strips auto-price at slab FF minus this drop (typ. 48\u2033 docks); blank = 4")}
        {/* NEW-1(c) — expert bypass, whole-site-as-pad, and the ratio / verified rule
            editor live behind ONE Advanced fold so the common case stays lean. */}
        <div style={{ marginTop: 4, borderTop: `1px solid ${Y.hairline}`, paddingTop: 4 }}>
          <button type="button" onClick={() => setDrainAdvOpen((v) => !v)} style={{ background: "transparent", border: "none", padding: "2px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 10.5, color: Y.rowLabel, fontWeight: 700, letterSpacing: "0.04em" }}>
            {drainAdvOpen ? "▾" : "▸"} Advanced
          </button>
          {drainAdvOpen && (
            <div style={{ marginTop: 2 }}>
              {fmRow("Expert: average depth of fill below the flood elevation (ft)", "avgFillDepthFt", "bypass", "Expert bypass: volume = intersect area × this constant depth")}
              <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 11, color: Y.text, cursor: "pointer", padding: "3px 0" }}>
                <input type="checkbox" checked={!!fm.settings.wholeSiteAsPad} onChange={(e) => fm.onChange({ wholeSiteAsPad: e.target.checked || null })} />
                Treat the entire site as pad (fill everywhere, not just drawn elements)
              </label>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "3px 0" }}>
                <span style={{ fontSize: 10.5, color: Y.muted, lineHeight: 1.4 }}>
                  {fmRuleRow.label}: {fmRuleRow.trigger === "1pct_plus_02pct" ? "1% + 0.2%" : "1%"} trigger @
                  <NumInput style={{ ...fmInputStyle, width: 44, margin: "0 4px" }} value={fmRuleRow.ratio} min={0.01} onCommit={(n) => Number.isFinite(n) && n > 0 && fm.onRuleChange(fm.jurKey, { ratio: n })} />:1
                </span>
                <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10.5, color: fmRuleRow.verified ? Y.text : "var(--warn-text)", cursor: "pointer", whiteSpace: "nowrap", fontWeight: 700 }}>
                  <input type="checkbox" checked={!!fmRuleRow.verified} onChange={(e) => fm.onRuleChange(fm.jurKey, { verified: e.target.checked })} />
                  verified
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  // B824 — Buildability / FFE detail, migrated from the deleted FloodMitigationCard.
  // The "ASSUMED at this code minimum" copy is load-bearing (asserted by
  // ui-audit/verify-auto-ffe.mjs); the standing datum/exclusion notes render once here.
  {
    const b = d.buildability;
    if (b) {
      if (b.ffe.status === "pass") ffeR.push(row("Required FFE", `${f2(b.ffe.requiredFfeFt)}′ (${ffeBasisText(b.ffe)})`, "— pad PASSES", false, { code: "code" }));
      if (b.ffe.status === "assumed") {
        ffeR.push(row("Required FFE", `${f2(b.ffe.requiredFfeFt)}′ (${ffeBasisText(b.ffe)})`, "", false, { code: "code" }));
        ffeR.push(keyedNote("No pad entered — the pad is ASSUMED at this code minimum. Enter a finished-floor elevation to check a real design.", "ffe-assumed"));
      }
      if (b.ffe.status === "short") ffeR.push(
        <div key="ffe-short" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", margin: "4px 0 0" }}>
          <span style={{ fontSize: 11, color: Y.dangerText, lineHeight: 1.45, fontWeight: 800 }}>⚠ Pad FFE is {f2(b.ffe.shortByFt)}′ SHORT of the required {f2(b.ffe.requiredFfeFt)}′ ({ffeBasisText(b.ffe)}).</span>
          <ActionLink onClick={() => jumpToDrainField("padFfeFt")}>Set pad →</ActionLink>
        </div>
      );
      // NEW-3 — outside the mapped floodplain, show the honest no-rule note (never a
      // phantom "need one of …" input demand); an unknown INSIDE the floodplain still names
      // the missing input. §A(9)-class pathway copy renders below either way.
      if (b.ffe.status === "no_rule" && b.ffe.outsideFloodplain) {
        ffeR.push(keyedNote(b.ffe.note || OUTSIDE_FLOODPLAIN_FFE_NOTE, "ffe-outside"));
        // B869/V352 fix (2026-07-19) — no ordinance FFE rule binds outside the mapped
        // floodplain, but the site-based good-practice screening tier (pond design WSE +
        // freeboard, or HAG + margin) may still be on offer via suggestedFfe(). That
        // computation already runs (d.floodMit.suggestFfe) — this panel just never READ
        // it, so the SITE-BASED chip only ever surfaced inside the Mitigation group's
        // input editor, never here in Buildability / FFE where the B869 spec (and every
        // "Expect" step in V352) says it belongs. Reuses the existing derivation
        // (DEDUPE-FIRST) — no new pure logic, just the missing render.
        const sf = d.floodMit && d.floodMit.suggestFfe;
        if (sf && sf.applies && sf.basisKind === "site" && Number.isFinite(sf.requiredFfeFt)) {
          const estTag = sf.estimated ? " · ESTIMATED" : "";
          const basisLabel = sf.governingBasis ? sf.governingBasis.label : "site basis";
          const alreadyAccepted = d.floodMit.padSrc === "suggested-accepted" && Number.isFinite(d.floodMit.settings.padFfeFt);
          ffeR.push(
            <div key="ffe-site-suggest" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", margin: "4px 0 0" }} title={SITE_BASED_FFE_NOTE}>
              <span style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10.5, color: Y.muted, lineHeight: 1.45, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.05em", color: "var(--on-accent)", background: "var(--accent)", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", flex: "none" }}>SITE-BASED</span>
                <span>Suggested pad ~{f1(sf.requiredFfeFt)}′ ({basisLabel}){estTag} — {SITE_BASED_FFE_NOTE}</span>
              </span>
              {!alreadyAccepted && (
                <ActionLink onClick={() => d.floodMit.onChange({ padFfeFt: Math.round(sf.requiredFfeFt * 10) / 10, padSrc: "suggested-accepted" })}>✓ use →</ActionLink>
              )}
            </div>
          );
          if (alreadyAccepted) ffeR.push(keyedNote(`pad = accepted SITE-BASED suggestion (${basisLabel}${estTag}) — clear it in Floodplain mitigation → Pad / finished floor to restore auto`, "ffe-site-accepted"));
        } else if (sf && sf.applies === false && sf.unknownReason) {
          // Outside the floodplain but no usable site basis yet (e.g. an unanchored pond) —
          // name why, never a silent absence (LOUD-FAILURE).
          ffeR.push(keyedNote(`No site-based screening pad yet — ${sf.unknownReason}.`, "ffe-site-unavailable"));
        }
      } else if (b.ffe.status === "unknown" || b.ffe.status === "no_rule") ffeR.push(keyedNote(`Required FFE unknown — ${b.ffe.unknownReason || "no FFE rule modeled for this jurisdiction — verify locally"}.`, "ffe-unk"));
      if (b.ffe.pendingBases && b.ffe.pendingBases.length > 0) ffeR.push(keyedNote(`The finished floor must clear the HIGHEST of several bases (more-restrictive controls governs). Not computed here yet — enter or confirm: ${b.ffe.pendingBases.map((pb) => `${pb.label || pb.basis} +${pb.plusFt}′`).join(" · ")}.`, "ffe-pending"));
      if ((b.ffe.status === "pass" || b.ffe.status === "short" || b.ffe.status === "assumed") && b.ffe.basis === "wse02pct" && d.wse02Src === "fbcdd-wse02-draft")
        ffeR.push(warnNote("The 0.2% WSE behind this required FFE is a DRAFT Fort Bend watershed-study value.", "ffe-draft02", "Screening only — confirm before design; enter the effective FIS 0.2% WSE to override."));
      if ((b.ffe.status === "pass" || b.ffe.status === "short" || b.ffe.status === "assumed") && b.ffe.basis === "wse02pct" && (d.wse02Src === "ebfe-wse02" || d.wse02Src === "maapnext-wse02")) // B882
        ffeR.push(warnNote(`The 0.2% WSE behind this required FFE is ${wseProvLabel(d.wse02Src)}.`, "ffe-est02", "Screening only — an estimate, not a published FIS value; confirm before design; enter the effective FIS 0.2% WSE to override."));
      if ((b.ffe.status === "pass" || b.ffe.status === "short" || b.ffe.status === "assumed") && b.ffe.basis === "atlas14_100yr" && d.wse100Src === "fbcdd-wse100-draft")
        ffeR.push(warnNote("The Atlas-14 100-yr WSE behind this required FFE is a DRAFT Fort Bend watershed-study value.", "ffe-draft100", "Screening only — confirm before design; enter a BFE to override."));
      // NEW-2 / B882 — the ESTIMATED stamp rides the FFE verdict when the governing basis
      // is ANY accepted estimate (never dropped off a consumer), naming the source.
      if ((b.ffe.status === "pass" || b.ffe.status === "short" || b.ffe.status === "assumed") && b.ffe.basis === "wse1pct" && isEstimatedWseSrc(d.floodMit?.bfeSrc))
        ffeR.push(warnNote(`The 1% WSE behind this required FFE is ${wseProvLabel(d.floodMit.bfeSrc)}.`, "ffe-est-wse", estWseNote(d.floodMit.bfeSrc)));
      // NEW-1 (Waller) — "prohibited" is a stronger enum than "restricted": no
      // structural fill in EITHER band, open foundations only (no fill-to-elevate
      // / LOMR-F pathway at all). Reads as the loudest warn line.
      if (b.pathway) ffeR.push((b.pathway.fillToElevate === "restricted" || b.pathway.fillToElevate === "prohibited" ? warnNote : keyedNote)(`${b.pathway.fillToElevate === "prohibited" ? "⛔ " : b.pathway.fillToElevate === "restricted" ? "⚠ " : ""}${b.pathway.note}`, "ffe-pathway"));
      if (b.lomr) ffeR.push(warnNote(`⚑ ${b.lomr.note}`, "ffe-lomr"));
      if (b.wetlands404) ffeR.push(warnNote(`⚑ ${b.wetlands404.note}`, "ffe-404"));
      if (b.flags.includes("rule_unverified")) ffeR.push(keyedNote("Buildability rule unverified — edit & confirm in settings.", "ffe-unv"));
      const g2 = d.floodGeo;
      ffeR.push(keyedNote([NAVD88_NOTE, d.districtOverlays.length ? BKDD_DATUM_NOTE : "", NEWER_MODEL_NOTE, g2 && g2.derivedBfe ? DERIVED_BFE_NOTE : "", g2 && g2.derivedXsWsel ? DERIVED_XS_WSEL_NOTE : "", g2 && g2.derivedWse02 ? DERIVED_WSE02_DRAFT_NOTE : "", g2 && g2.derivedWse100 ? DERIVED_WSE100_DRAFT_NOTE : "", EXCLUSIONS_NOTE, OFFSITE_NOTE].filter(Boolean).join(" "), "ffe-standing"));
    }
    if (!ffeR.length) ffeR.push(keyedNote("Not assessed on this check — ↻ Re-check to screen the required finished floor.", "ffe-none"));
  }
  // B862 (chat NEW-3) — verdict-first: each group's closed face is a solid status CHIP.
  // NEW-1/NEW-2 — the chip vocabulary is STATUS-ONLY: COVERED / SHORT / NEEDS INPUT /
  // UNKNOWN / RE-CHECK / CLEAR / NONE / STOP (the requirement TYPE — band vs point — rides
  // the value suffix, never the chip; "BAND" and "OVER-DUG" are retired). The NUMBER is the
  // verdict (largest type), and a required-vs-provided BAR. Copy is verb/numbers-first;
  // every UNKNOWN names the one action that resolves it. The bar geometry is the shared
  // yieldBar.js layout so screen + PDF can't drift.
  // The BAR geometry comes from the ONE shared spec (yieldBar.js) so the screen and
  // the PDF export can't drift; only the header CHIP / verdict word (richer — floodway,
  // straddle, remembered states) is computed here.
  // v3 A2/A3 — no requirement-band bar here; the provided/required pair lives once, in
  // the verdict strip (G1). These groups carry the per-pond DETAIL only.
  /* B1110 — `detVerdict` / `detTone` / `detSub` are GONE.
   *
   * They were assigned by every branch of this block and read by none of them: the v3
   * A2/A3 rework moved the requirement pair out to the verdict strip (G1) and left the
   * locals behind. Rendering them here would now VIOLATE PANEL-BREVITY rule 5 — the same
   * pair would appear twice in one panel — so the honest resolution of a dead store whose
   * design moved on is to delete it, not to find it a home. `detChip` is the one value
   * this block produces that the render consumes, and B1127 makes it actually reach the
   * DOM (it previously only fed a tone comparison). Do NOT reintroduce a verdict local
   * here; if a group needs the number, read it from the strip row. */
  let detChip = null;
  if (req && req.kind === "point" && req.requiredAcFt > ACFT_EPS && usableAcFt == null) {
    // NEW-9 — usable split unknown on a remembered view: an honest non-verdict + the action.
    detChip = "RE-CHECK";
  } else if (req && req.kind === "point" && req.requiredAcFt > ACFT_EPS) {
    // B909 round 3 polish — a shortfall inside display-precision epsilon reads as MET,
    // never a "SHORT -0.00 ac-ft" rounding artifact.
    detChip = usableAcFt - req.requiredAcFt < -ACFT_EPS ? "SHORT" : "COVERED";
  } else if (req && req.kind === "point") {
    // A requirement that itself rounds to zero (epsilon residue) is nothing to
    // satisfy — quiet NONE, never a phantom SHORT/COVERED against "req 0.00".
    detChip = "NONE";
  } else if (req && req.kind === "band" && usableAcFt == null) {
    // NEW-1 — a band requirement with an unknown usable split is honestly "unknown",
    // never a gross-fed all-clear.
    detChip = "RE-CHECK";
  } else if (req && req.kind === "band") {
    // NEW-1 — the CHIP carries the STATUS (COVERED / SHORT / NEEDS INPUT), computed off
    // USABLE against the band; the requirement TYPE ("screening band") rides the suffix,
    // never the chip. (The old chip literally read "BAND" — a type where a verdict belongs.)
    detChip = usableAcFt >= req.bandAcFt[1] - ACFT_EPS ? "COVERED"
      : usableAcFt < req.bandAcFt[0] - ACFT_EPS ? "SHORT" : "NEEDS INPUT";
  } else if (req && req.kind === "unavailable") {
    /* NEW-8 / B1105 — the hard, unmistakable Colorado state, and B1127 is what finally
     * puts it on screen: this chip is now PASSED to the group header (see the groupFold
     * call below), where before it only fed a tone comparison and the closed face read a
     * bare "0 ponds · check" with no Colorado signal at all.
     *
     * A NAMED state, not a failure to compute: "UNKNOWN" would read as "we could not look
     * it up", inviting the reader to wait for a number that is never coming. MHFD gets its
     * own chip because its state is genuinely different — the method is carried and the
     * district's tables are not — and one shared chip would have flattened that. */
    detChip = (req.flags || []).includes("colorado-mhfd") ? "N/A · MHFD" : "N/A · CO";
  } else if (req && req.kind === "unknown") { detChip = "UNKNOWN"; }
  else if (d.reqCandidates) { detChip = "STRADDLE"; }
  else { detChip = "SET AGENCY"; }
  // NEW-1 — fully-inundated is a crisis, not a covered state: when the flood WSE sits at
  // or above the top of bank, usable detention is ZERO regardless of gross, so the verdict
  // must read SHORT (danger), never "covered". Overrides a stale/optimistic band read.
  if (d.pondFullyInundated && usableAcFt != null && usableAcFt < 1e-6 && req && (req.kind === "point" || req.kind === "band")) {
    detChip = "SHORT";
  }
  const mitV = d.mitigation;
  let mitVerdict = "—", mitTone = null, mitSub = "", mitChip = null;
  // B867 reopen — STALE state lives in the HEADER line ONLY (never a per-section chip):
  // the old NEW-2 code put a "RE-CHECK · flood pull predates the drawn area" chip and a
  // "· stale" suffix INSIDE this section — the exact per-section stale pathway the owner
  // reopened B867 to kill. Deleted. The last-good HOLD (drainMitDisplay, NEW-2) still
  // prevents a fresh-0 all-clear; while a genuine refresh is in flight with no last-good to
  // show, the section reads an honest UNKNOWN (we don't know the volume yet) — the header
  // line ("Refreshing…" / "Couldn't refresh — last good · ↻") carries the staleness.
  if (d.mitStalePending) {
    // ⛔ NEW-5 (owner-adversarial review, 2026-09-05) — the site's mitigation REQUIREMENT
    // being stale/blocked does not make the PROVIDED volume unknown too: `d.mitProvided`
    // is pure pond-ledger geometry with no network dependency, so a pond already assigned
    // a mitigation role reports a real, already-reconciled dedicated volume. A bare
    // "volume unknown" here — right above the SAME collapse's own "109.2 claimed / 109.2
    // exists — Storage reconciles" detail rows — was the reported contradiction. Never
    // adds a "re-check" clause: the header's own freshness line already carries that
    // affordance for this exact state (PANEL-BREVITY).
    const mitProvCf0 = d.mitProvided ? d.mitProvided.creditedCf : null;
    if (mitProvCf0 != null && mitProvCf0 / CF_PER_ACFT > ACFT_EPS) {
      mitVerdict = `providing ${f1(mitProvCf0 / CF_PER_ACFT)} AC-FT`; mitTone = "warn"; mitChip = "UNKNOWN"; mitSub = "requirement unknown";
    } else {
      mitVerdict = "volume unknown"; mitTone = "warn"; mitChip = "UNKNOWN"; mitSub = "";
    }
  } else if (mitV && mitV.intersectAcres > 0) {
    const mitTag = mitV.expertBypass ? "expert avg-depth" : d.mitigationStraddle ? "straddle worst-case" : mitV.providers?.wse1pct === "bfe-line-interp" ? "BFE derived" : mitV.providers?.wse1pct === "fbcdd-wse100-draft" ? "DRAFT Atlas-14 100-yr" : "";
    if (mitV.volumeCf != null) {
      // NEW-8 — the closed face is the BALANCE (provided credited cut vs required).
      const provCf = d.mitProvided ? d.mitProvided.creditedCf : 0;
      if (provCf == null) {
        mitVerdict = "provided unknown"; mitTone = "warn"; mitChip = "RE-CHECK"; mitSub = `req ${f2(mitV.volumeAcFt)}`;
      } else if (!(mitV.volumeAcFt > ACFT_EPS)) {
        // Never celebrate a requirement that doesn't exist (owner correction,
        // B909 round 2): a fill footprint that owes ZERO compensating storage
        // gets a quiet neutral readout, not a triumphant "COVERED ✓" — a pond's
        // below-WSE cut earns nothing toward a requirement that was never there.
        // B909 round 3 polish — the epsilon gate (not a strict >0) also catches a
        // requirement that rounds to 0.00 (floating-point residue from the berm-fill
        // credit math), so it never reads as a genuine "SHORT -0.00 ac-ft req 0.00".
        const provAcFt = provCf / CF_PER_ACFT;
        mitVerdict = "not required for this plan"; mitTone = null; mitChip = "NOT REQUIRED";
        mitSub = provAcFt > ACFT_EPS ? `${f1(provAcFt)} AC-FT credited anyway` : "";
      } else {
        const provAcFt = provCf / CF_PER_ACFT;
        const bal = provAcFt - mitV.volumeAcFt;
        const short = bal < -ACFT_EPS;
        // NEW-2 — "OVER-DUG" is retired: an over-provided cut just reads COVERED (a
        // zero-requirement surplus must never out-shout a real detention shortfall).
        // B909 round 3 — a shortfall inside display-precision epsilon reads as MET.
        mitVerdict = short ? `${fmtSignedAcFt(bal)} AC-FT` : "covered";
        mitTone = short ? "danger" : "good";
        mitChip = short ? "SHORT" : "COVERED";
        mitSub = `req ${f2(mitV.volumeAcFt)}${mitTag ? ` · ${mitTag}` : ""}`;
      }
    } else {
      // NEW-5 — same reasoning as the mitStalePending branch above: the requirement volume
      // never resolved (missing elevation input), but a known PROVIDED figure may still exist.
      const mitProvCf0 = d.mitProvided ? d.mitProvided.creditedCf : null;
      if (mitProvCf0 != null && mitProvCf0 / CF_PER_ACFT > ACFT_EPS) {
        mitVerdict = `providing ${f1(mitProvCf0 / CF_PER_ACFT)} AC-FT`; mitTone = "warn"; mitChip = "UNKNOWN";
        mitSub = mitTag ? `requirement unknown · ${mitTag}` : "requirement unknown";
      } else {
        mitVerdict = "volume unknown"; mitTone = "warn"; mitChip = "UNKNOWN"; mitSub = mitTag;
      }
    }
    if (mitV.flags && mitV.flags.includes("floodway_intersect")) { mitVerdict = `floodway fill · ${mitVerdict}`; mitTone = "danger"; mitChip = "STOP"; }
  } else if (d.mitRememberedMissing) { mitVerdict = "not screened"; mitTone = "warn"; mitChip = "RE-CHECK"; }
  else if (d.floodGeo && d.floodGeo.state === "failed") { mitVerdict = "flood source down"; mitTone = "warn"; mitChip = "RE-CHECK"; }
  else if (d.floodGeo && d.floodGeo.state === "loaded" && d.floodGeo.zoneCount === 0) { mitVerdict = "no mapped zones"; mitChip = "CLEAR"; }
  else if (mitV && mitV.intersectAcres === 0) { mitVerdict = "no fill in the trigger floodplain"; mitChip = "COVERED"; mitTone = "good"; mitSub = "nothing to offset"; }
  const bb = d.buildability;
  let ffeVerdict = "—", ffeTone = null, ffeChip = null;
  if (bb && bb.ffe.status === "pass") { ffeVerdict = `${f2(bb.ffe.requiredFfeFt)}′ req`; ffeTone = "good"; ffeChip = "PASSES"; }
  else if (bb && bb.ffe.status === "assumed") { ffeVerdict = `${f2(bb.ffe.requiredFfeFt)}′ req`; ffeChip = "ASSUMED"; }
  else if (bb && bb.ffe.status === "short") { ffeVerdict = `pad ${f2(bb.ffe.shortByFt)}′ short`; ffeTone = "danger"; ffeChip = "SHORT"; }
  // NEW-3 — outside the mapped floodplain / no rule modeled: a NEUTRAL "no rule" verdict,
  // never the "SET BFE" call to action (no county FFE ordinance binds here). A NEW-4
  // site-based screening pad may still be offered below; that's a suggestion, not a rule.
  else if (bb && bb.ffe.status === "no_rule") { ffeVerdict = bb.ffe.outsideFloodplain ? "outside floodplain" : "no rule modeled"; ffeTone = null; ffeChip = "NO RULE"; }
  else if (bb) { ffeVerdict = "unknown"; ffeTone = "warn"; ffeChip = "SET BFE"; }
  // B909/B910 — ONE primary "⚡ Design pond" cure, not two separate buttons: a
  // single basin can carry BOTH detention (rate control) and floodplain
  // mitigation (compensating storage) at once, so two buttons would wrongly
  // imply two separate ponds/actions. The SAME button + SAME handler renders on
  // WHICHEVER card(s) currently read SHORT (never when covered/unknown/
  // straddle/needs-input — the button would have nothing honest to do); if both
  // cards are short, both show it and clicking either does the whole job,
  // moving BOTH verdicts toward met. Put where the shortfall is diagnosed, so
  // the cure sits next to the problem statement.
  const detShort = detChip === "SHORT", mitShort = mitChip === "SHORT";
  // v3 A2 — the tooltip must never promise the drawn outline "grows". Two honest
  // states: with a pond drawn, Optimize solves its elevations/outlet and leaves the
  // outline untouched; with no pond, it draws a right-sized one and solves its outlet.
  const hasPond = !!(d.ponds && d.ponds.length > 0);
  const designAction = (detShort || mitShort) && d.onDesignPond ? (
    <button type="button" onClick={d.onDesignPond}
      title={hasPond
        ? "One click: sets the pond's elevations and outlet so storage counts. Your drawn outline is never changed."
        : "One click: draws a right-sized pond and solves its outlet."}
      style={{ width: "100%", padding: "8px 10px", border: "none", borderRadius: RADIUS.md, background: "var(--accent)", color: "var(--on-accent)", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
      ⚡ Optimize pond
    </button>
  ) : null;
  // NEW-18 (B983) — the MITIGATION card does NOT hang the one-click ⚡ (which reliably closes
  // detention but often can't close mitigation without a bigger footprint the tool won't
  // redraw — a near-no-op that reads as an action). Instead it offers "See mitigation options",
  // opening the pond's Sizing assistant where deepen vs. enlarge are laid out with Apply chips.
  // With NO pond yet, the ⚡ (draw a right-sized one) stays honest, so it falls through to it.
  const mitigationAction = mitShort
    ? (hasPond && d.onSeeMitigationOptions
        ? <ActionLink onClick={d.onSeeMitigationOptions} title="Open the pond's sizing helper, which lays out the honest ways to add compensating storage (deepen the pond, or enlarge its footprint) with one-click Apply. Mitigation usually needs a bigger pond, so there is no reliable single-click cure the way detention has.">See mitigation options →</ActionLink>
        : designAction)
    : null;
  // Each card only shows the button for ITS OWN shortfall — "Optimize pond" on
  // the Detention card when detention alone is fine but mitigation is short
  // would read as a false alarm on that card.
  // v3 A3 — DETENTION DETAIL (open by default). A4 — MITIGATION DETAIL renders ONLY
  // when a mitigation requirement exists (req rounds above zero); otherwise nothing
  // about mitigation shows in the panel beyond the verdict-strip "not required" row.
  const mitRequired = !!(mitV && mitV.volumeCf != null && mitV.volumeAcFt > ACFT_EPS);
  // v3 A3 — the DETENTION DETAIL body is EXACTLY: per-pond row(s) · the explainer (when
  // storage below the flood earns no credit yet) · the Requirement basis row. The ⚡
  // Optimize pond button is the action. ALL prior detail (required/provided/tier/regime/
  // assumptions block + reviewing-agency select/flood-WSE diagram/district warnings)
  // relocates verbatim into "Assumptions & method" via opts.method (nothing lost). The
  // header shows "N pond · short/ok" — the requirement range lives ONLY in the basis tag.
  const detVisible = (() => {
    const rows = [];
    for (const p of (d.ponds || [])) {
      rows.push(
        <div key={`pp-${p.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0", borderBottom: `1px solid ${Y.hairline}` }}>
          {/* v3 B7 — the pond label never wraps: it sits on one line and ellipsizes a long
              name (full name in the title), with the ↗ kept fixed at the end. */}
          <button type="button" onClick={() => d.onSelectPond && d.onSelectPond(p.id)} title={p.label} style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0, overflow: "hidden", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "var(--accent)", fontWeight: 600, textAlign: "left" }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{p.label}</span>
            <span style={{ flex: "none" }}>↗</span>
          </button>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: NUM_FONT, fontSize: 13, color: Y.text, fontWeight: 700, fontVariantNumeric: TABULAR_NUMS }}>{p.countsAcFt == null ? "usable unknown" : `${f1(p.countsAcFt)} AC-FT counts`}</span>
            <span title={`${f0(p.holdsAcFt * CF_PER_ACFT)} cf stored`} style={{ fontSize: 10.5, color: Y.muted, cursor: "help" }}>holds {f1(p.holdsAcFt)}</span>
          </span>
        </div>
      );
    }
    const siteCounts = d.providedUsableCf == null ? null : d.providedUsableCf / CF_PER_ACFT;
    const siteHolds = (d.providedCf || 0) / CF_PER_ACFT;
    const gapAcFt = siteCounts != null ? siteHolds - siteCounts : null;
    // NEW-1 (B1032) — the explainer must ACCOUNT for the gap, not blame all of it on the
    // flood. Before this it read "17.4 of its 80.8 ac-ft sits below the flood level" on a
    // Tsakiris pond with ZERO dead storage — the whole 17.4 was volume the inward berm
    // ring takes out of the drawn footprint, and that wrong sentence is what sent the
    // owner's own diagnosis after the wrong number. Each term renders only when it is
    // real, and together they equal the gap by construction.
    if (siteCounts != null && gapAcFt != null && gapAcFt > ACFT_EPS) {
      const modelHolds = d.modelGrossCf != null ? d.modelGrossCf / CF_PER_ACFT : null;
      const bermAcFt = modelHolds != null ? Math.max(0, siteHolds - modelHolds) : 0;
      const deadAcFt = d.deadCf != null ? d.deadCf / CF_PER_ACFT : 0;
      const mitAcFt = d.mitDedicatedCf != null ? d.mitDedicatedCf / CF_PER_ACFT : 0;
      const unusedAcFt = d.unusedCf != null ? d.unusedCf / CF_PER_ACFT : 0;
      // NEW-2 (2026-07-28) — PANEL-BREVITY. B1032's explainer was RIGHT and stays whole; it
      // was just spent as prose in the default view ("Of the 80.8 ac-ft the outline could
      // hold, 17.4 is taken up by the earthen berm ring built inside the outline, 29.6 is
      // set aside for floodplain compensating storage — 33.8 ac-ft is left to count for
      // detention."). Numbers over prose, named state over a sentence explaining the state:
      // the visible line is now the counted-of-held PAIR, each deduction is a short labelled
      // term, and the term-by-term account moves into "Assumptions & method ▸". Nothing is
      // deleted — the ⓘ text is byte-identical and the terms are all still reachable.
      const terms = [];
      if (bermAcFt > ACFT_EPS) terms.push(`berm ring ${f1(bermAcFt)}`);
      if (deadAcFt > ACFT_EPS) terms.push(`permanent water ${f1(deadAcFt)}`);
      if (mitAcFt > ACFT_EPS) terms.push(`floodplain compensation ${f1(mitAcFt)}`);
      if (unusedAcFt > ACFT_EPS) terms.push(`below flood level ${f1(unusedAcFt)}`);
      rows.push(
        <div key="det-explainer" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 12.5, color: Y.rowLabel, lineHeight: 1.5, padding: "4px 0" }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
            Counts for detention
            <RowInfo label="Why some storage doesn't count" sections={[{ text: "Storage above the flood level is empty when the design storm arrives and earns detention credit. The rest is spoken for: the berm ring is earth, not water; storage below the pond's standing water level is permanently full; and storage set aside to compensate for floodplain fill is already promised to that ledger — the same acre-foot can never serve two purposes." }]} />
          </span>
          <span style={{ fontFamily: NUM_FONT, fontSize: 13, fontWeight: 700, fontVariantNumeric: TABULAR_NUMS, whiteSpace: "nowrap" }}>{f1(siteCounts)} of {f1(siteHolds)} AC-FT held</span>
        </div>
      );
      // The account itself — every term B1032 bought, folded, not dropped.
      if (terms.length) rows.push(keyedNote(`Not counted: ${terms.join(" · ")} AC-FT.${d.rimRaiseFeasible ? " Raising the rim adds storage above the flood level." : ""}`, "det-terms"));
      else if (d.rimRaiseFeasible) rows.push(keyedNote("Raising the rim adds storage above the flood level.", "det-rim"));
    }
    // ── NEW-1 — STORAGE RECONCILIATION. Two ledgers can each add up on their own terms
    // while together claiming more water than the ponds hold. This row is the only place
    // that cross-check is visible, so it renders whenever it has an answer — a green tie-out
    // as much as a red double-count (a silent pass would teach the reader nothing).
    if (d.reconcile && d.reconcile.state !== "unknown") {
      const rc = d.reconcile;
      const bad = rc.state === "fail";
      rows.push(
        <div key="rec-row" data-testid="yield-reconcile-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0", borderTop: `1px solid ${Y.hairline}` }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 3, fontSize: 12, color: Y.rowLabel }}>
            Storage reconciles
            <RowInfo label="Storage reconciliation" sections={[{ text: "Detention counts the storage above the flood level; mitigation counts the storage below it. Both are real, but they have to fit inside the same ponds. This row adds up everything the two checks claim and holds it against what the ponds physically hold. If the claim is bigger, the same water is being counted twice — and both checks above are wrong, however green they look." }]} />
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: NUM_FONT, fontSize: 13, fontWeight: 700, fontVariantNumeric: TABULAR_NUMS, color: bad ? Y.dangerText : "var(--success-text)" }}>
              {f1(rc.claimedCf / CF_PER_ACFT)} claimed / {f1(rc.physicalCf / CF_PER_ACFT)} exists
            </span>
          </span>
        </div>
      );
      // NEW-4 (B1035) — the reconciliation SENTENCE is stated once, on the verdict strip
      // above (the level the failure applies to). This row keeps the claimed-vs-exists
      // NUMBERS and points at it, instead of repeating the same paragraph verbatim.
      if (bad) rows.push(
        <div key="rec-msg" style={{ fontSize: 12, color: Y.dangerText, lineHeight: 1.5, padding: "2px 0 5px" }}>
          Counted twice — see Detention above.
          <RowInfo label="Storage reconciliation" sections={[{ text: rc.message }]} />
        </div>
      );
    } else if (d.reconcile && d.reconcile.state === "unknown") {
      rows.push(warnNote("Storage can't be reconciled until every pond's flood split is known — re-check the flood data.", "rec-unk", d.reconcile.message));
    }
    // ── NEW-2 — DRAWDOWN, per pond and site-wide.
    if (d.drawdown && d.drawdown.known && d.drawdown.site && d.drawdown.site.label) {
      const dd = d.drawdown;
      rows.push(
        <div key="dd-row" data-testid="yield-drawdown-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0" }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 3, fontSize: 12, color: Y.rowLabel }}>
            Time to empty
            <RowInfo label="Time to empty" sections={[
              { text: `Ponds are only allowed to let water out at a set rate, so a big pond takes a long time to drain. This is how long the counted storage takes to empty at that allowed rate${dd.acres ? ` for this site's acreage` : ""}.` },
              { text: "It is the best case: water leaves faster when the pond is full and slows as the level drops, so the real time is longer." },
              { text: `Anything past ${dd.maxHr >= 48 ? `${Math.round(dd.maxHr / 24)} days` : `${dd.maxHr} hours`} is flagged. It matters twice over — a pond still full when the next storm arrives isn't really available, and a pond doing double duty as flood mitigation has to be empty again before the next flood.` },
            ]} />
          </span>
          <span style={{ fontFamily: NUM_FONT, fontSize: 13, fontWeight: 700, fontVariantNumeric: TABULAR_NUMS, color: dd.site.tone === "ok" ? Y.text : dd.site.tone === "red" ? Y.dangerText : Y.warnText, whiteSpace: "nowrap" }}>{dd.site.label}</span>
        </div>
      );
      if (dd.ponds.length > 1) rows.push(
        <div key="dd-per" style={{ fontSize: 10.5, color: Y.muted, lineHeight: 1.5, padding: "0 0 4px" }}>
          Per pond: {dd.ponds.filter((p) => p.label).map((p) => `${p.name} ${p.label}`).join(" · ")}
        </div>
      );
    } else if (d.drawdown && !d.drawdown.known && (d.pondCount || 0) > 0) {
      rows.push(keyedNote("Time to empty needs the allowed release rate — set it in Standards or give the pond an outlet.", "dd-unk"));
    }
    /* ── NEW-7 — in COLORADO the same number is a water-rights TEST, not a note.
     * C.R.S. 37-92-602(8): 97% of a 5-year storm out in 72 hr, 99% of larger events in
     * 120 hr. Detention that misses it is an out-of-priority diversion. Texas renders
     * nothing here — `applies` is false — so its presentation is untouched.
     * PANEL-BREVITY: ONE line, whichever way it goes; the statute text, the rebuttable
     * presumption, the State Engineer notification and the optimism caveat all live in
     * the ⓘ. */
    if (d.drawdownStatute && d.drawdownStatute.applies) {
      const st = d.drawdownStatute;
      const detail = [
        ...st.statute.tests.map((t) => t.text),
        st.presumption,
        st.notification.text,
        st.proxyNote,
        st.statute.note,
      ].join(" ");
      rows.push(st.verdict === "fail"
        ? warnNote(`Fails Colorado's 72-hour drawdown statute (${st.statute.citation}).`, "co-drawdown", detail)
        : st.verdict === "unknown"
          ? keyedNote(`Colorado's 72-hour drawdown statute (${st.statute.citation}) needs the allowed release rate.`, "co-drawdown", detail)
          : keyedNote(`Inside Colorado's 72/120-hour drawdown limits (${st.statute.citation}) — screening, not compliance.`, "co-drawdown", detail));
    }
    // ── NEW-6 — the two gravity-drain tests, and NEW-5's prism-vs-extrusion honesty delta.
    {
      const models = (d.pondModels || []).filter((m) => m.gravity || m.prism);
      const gravFails = models.filter((m) => m.gravity && m.gravity.known && (m.gravity.detention.pass === false || m.gravity.mitigation.pass === false));
      const gravUnknown = models.filter((m) => m.gravity && !m.gravity.known);
      for (const m of gravFails) {
        const g = m.gravity;
        const parts = [];
        if (g.detention.pass === false) parts.push(`gravity drains only ${Math.round((g.detention.share || 0) * 100)}% of detention storage (rule: ${Math.round((d.gravityShareRequired || 0.5) * 100)}%)`);
        if (g.mitigation.pass === false) parts.push(`${f1(g.mitigation.deadCf / CF_PER_ACFT)} AC-FT of mitigation storage sits below the outlet, so it earns no credit`);
        rows.push(warnNote(`${m.name}: ${parts.join("; ")}.`, `grav-${m.id}`, g.detention.basis + " " + g.mitigation.basis));
      }
      if (gravUnknown.length && !gravFails.length) {
        rows.push(keyedNote(`Gravity drainage isn't screened yet — ${gravUnknown.length === 1 ? `${gravUnknown[0].name} has` : `${gravUnknown.length} ponds have`} no outlet elevation set.`, "grav-unk"));
      }
      // NEW-5 — only worth saying when a straight-down read would have been materially wrong.
      const worst = models.filter((m) => m.prism && m.prism.deltaPct != null).sort((a, b) => b.prism.deltaPct - a.prism.deltaPct)[0];
      if (worst && worst.prism.deltaPct > 0.15) {
        // NEW-2 — a METHOD note (how storage is measured), not an action: it belongs in
        // "Assumptions & method ▸", not in the default view. Text unchanged, home changed.
        rows.push(keyedNote(`Storage is measured as a real basin with sloping sides, not a straight-sided box — on ${worst.name} that is ${Math.round(worst.prism.deltaPct * 100)}% less than the outline would suggest.${worst.prism.pinched ? " Its sides also meet before it reaches the depth set for it, so it can't actually be dug that deep." : ""}`, "prism-note"));
      }
    }
    // ── NEW-10 — is the surplus real slack, or the hole the pad fill came out of?
    if (d.cutFill && d.cutFill.surplus && d.cutFill.surplus.driver === "borrow") {
      rows.push(
        <div key="borrow-note" data-testid="yield-borrow-note" style={{ fontSize: 12, color: Y.warnText, lineHeight: 1.5, padding: "3px 0" }}>
          Surplus is dirt-driven: shrinking to the bare requirement means importing ~{Math.round(d.cutFill.surplus.importIfShrunkCy).toLocaleString("en-US")} cy of fill.
        </div>
      );
    }
    if (req && req.rule) {
      const shortAuth = AUTHORITY_SHORT[req.rule.authority] || req.rule.authorityLabel || "criteria";
      // v3 B4 — some rules cite the appendix on `source.section` (e.g. Waller's
      // "Appendix E, Volume Requirements…"), not `governingManual.section`; check both
      // so the basis reads "Waller Co. App. E", never a truncated "Waller Co.".
      const appM = (req.rule.governingManual?.section || req.rule.source?.section || "").match(/Appendix\s+([A-Z])/);
      const basisVal = appM ? `${shortAuth} App. ${appM[1]}` : shortAuth;
      const rangeTxt = req.kind === "band" ? `Screening range ${f1(req.bandAcFt[0])} to ${f1(req.bandAcFt[1])} AC-FT; planned to the conservative end.`
        : (req.requiredAcFt != null ? `Required ${f1(req.requiredAcFt)} AC-FT.` : "");
      const unverified = req.kind === "band" || req.rule.verified === false;
      const basisTitle = `Adopted criteria. ${rangeTxt}${unverified ? " Criteria values still unverified: confirm in Standards." : ""}`.replace(/\s+/g, " ").trim();
      rows.push(
        <div key="det-basis" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0" }}>
          <span style={{ fontSize: 12, color: Y.rowLabel }}>Requirement basis</span>
          <span style={ROWB6}>
            <span style={{ fontSize: 12, color: Y.text, fontWeight: 600, whiteSpace: "nowrap" }}>{basisVal}</span>
            <SourceTag code="code" label="Requirement basis" basis={basisTitle} />
          </span>
        </div>
      );
    }
    return rows;
  })();
  const detCount = d.pondCount || 0;
  // v3 B7 — the closed summary styles "N pond" as secondary ink and only the status
  // word (short) in its tone color, never the whole line red.
  /* B1127 — a Colorado site has no requirement to be "ok" or "short" AGAINST, so the
   * status word is a named state instead of a check verdict. Before this the closed face
   * read "0 ponds · check" on every Colorado plan, which says nothing about Colorado and
   * implies a check is pending. */
  const detUnavailable = !!(req && req.kind === "unavailable");
  const detStatusWord = detUnavailable ? "not carried" : detShort ? "short" : detChip === "COVERED" ? "ok" : "check";
  const detClosed = (
    <>
      {detUnavailable ? null : <span style={{ color: Y.muted, fontWeight: 400 }}>{detCount} pond{detCount === 1 ? "" : "s"} · </span>}
      <span style={{ color: detShort ? Y.dangerText : detChip === "COVERED" ? "var(--success-text)" : Y.warnText }}>{detStatusWord}</span>
    </>
  );
  /* B1127 — `chip` is passed ONLY for the unavailable (Colorado) kind. That is what puts
   * "N/A · MHFD" / "N/A · CO" on screen beside the group label, where the chip string used
   * to be computed and thrown away. Deliberately NOT passed for the Texas kinds: their
   * status already reads in the closed face, and adding a chip there would change a Texas
   * panel — which this item may not do. */
  out.push(groupFold("det", "Detention detail", detClosed, detShort ? "danger" : detChip === "COVERED" ? "good" : "warn", detVisible, "", { chip: detUnavailable ? detChip : null, action: detShort ? designAction : null, open: true, method: detR }));
  if (mitRequired) out.push(groupFold("mit", "Mitigation detail", mitVerdict, mitTone, mitR, mitSub, { chip: mitChip, action: mitigationAction }));
  // NEW-10/B830 — the ledger balancer: one card of ranked screening moves that
  // close detention + mitigation together. Every move is one line + ⓘ; nothing
  // is applied without a click — the ONE apply affordance is the berm move
  // (NEW-13, the owner's explicit ask), which is history-backed + provenance-
  // stamped. Renders only when there are moves to rank.
  {
    const bal = d.balancer;
    if (bal && bal.moves.length) {
      const balR = [];
      for (const m of bal.moves) {
        balR.push(
          <div key={`mv-${m.kind}-${m.id}`} title={m.info} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${Y.hairline}`, cursor: "help" }}>
            <span style={{ fontSize: 11, color: Y.rowLabel, lineHeight: 1.4 }}>{m.label}<span style={{ fontSize: 9.5, color: Y.muted, marginLeft: 4 }} aria-hidden="true">ⓘ</span></span>
            {m.apply && d.onApplyBerm ? (
              <button onClick={() => d.onApplyBerm(m.apply)} style={{ padding: "3px 10px", border: "1px solid var(--accent)", borderRadius: 7, background: "var(--accent)", color: "var(--on-accent)", fontWeight: 700, fontSize: 10.5, whiteSpace: "nowrap", cursor: "pointer" }}>Apply</button>
            ) : null}
          </div>
        );
      }
      if (bal.bermExcluded && bal.bermExcluded.length) {
        const n = bal.bermExcluded.length;
        balR.push(warnNote(`${n} pond${n > 1 ? "s" : ""} excluded from the berm auto-suggest: floodplain fringe / role.`, "bal-excl",
          `Excluded: ${bal.bermExcluded.map((x) => `${x.name || x.id} (${x.reason === "floodplain-fringe" ? "in the mapped floodplain: berming below the WSE is levee-adjacent hydraulics, engineer territory" : x.reason === "mitigation-role" ? "mitigation-role pond" : "split facts unknown, re-check"})`).join(" · ")}.`));
      }
      balR.push(keyedNote("Proposals only: nothing changes without your click; redraw the plan to take a move. Screening.", "bal-caveat"));
      const balSub = bal.detGapAcFt > 0 ? `det gap ${f2(bal.detGapAcFt)}` : bal.mitOverAcFt > 0 ? `surplus ${f2(bal.mitOverAcFt)}` : "";
      out.push(groupFold("bal", "Ledger balancer", `${bal.moves.length} move${bal.moves.length > 1 ? "s" : ""} screened`, null, balR, balSub));
    }
  }
  // FINAL UI SPEC B1.2 — Buildability/FFE is its OWN top-level group (③): return its
  // detail rows + verdict/chip so the panel renders them directly there, with the
  // verdict as the group's closed summary (no redundant nested groupFold header).
  // NEW-1(e) — the bottom "↻ Re-check" button folded into the top status line.
  // B895 — the generic "screening estimate — confirm with your engineer and the
  // reviewing authority" caveat that used to repeat here (and ~6 more times across
  // this panel) now lives ONCE in the panel footer (YieldFooterDisclaimer, below).
  return { sw: out, ffeR, ffeVerdict, ffeChip, ffeTone };
}
