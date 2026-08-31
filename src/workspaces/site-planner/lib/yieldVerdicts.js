/* v3 UI SPEC Part A — the Yield panel's VERDICT STRIP (A2), as pure data so both the strip
 * and the tests read one source. Presentation only: this reads the SAME `drainage` object the
 * detail groups below expand on and maps it to up-to-three one-line verdicts (detention ·
 * mitigation · buildability) — it never computes a stormwater value itself.
 *
 * Each verdict carries:
 *   key      "det" | "mit" | "ffe"
 *   label    "Detention" | "Mitigation" | "Buildability"  (the sentence prefix)
 *   pill     "SHORT" | "OK" | "…"                          (word-only status pill, G5)
 *   tone     "danger" | "good" | "neutral"                 (pill color; kept for legacy readers)
 *   sentence the text after "{label}: " — e.g. "0.0 of 33.8 ac-ft" / "not required" / "checking flood data"
 *   pair     { provided, required } when the sentence is a numeric provided/required pair (else absent)
 *   short    true on a shortfall → the row hangs a compact ⚡ Optimize pond button (detention/mitigation only)
 *   loading  true while a verdict is blocked on flood data
 *   action   true → show the ⚡ Optimize pond button (short detention/mitigation)
 *   text     "{label}: {sentence}" (full line, for legacy readers e.g. the group summary)
 *   sortRank 0 SHORT · 1 loading · 2 OK  (the strip sorts by this: shortfalls first)
 */

const AC_FT = 43560;
const EPS = 0.005; // an ac-ft residue inside display precision is "met", never a phantom SHORT
// NEW-16 — a MATERIALITY floor for a mitigation requirement. Below this the "requirement" is
// grid-cell crumbs at a flood-zone edge (≈0.05 ac-ft ≈ 80 yd³ — engineering noise), not a real
// obligation, so it reads "not required (trace)" with the raw value in the ⓘ, never a red SHORT.
export const TRACE_ACFT = 0.05;

// B2/B3 — one decimal for ac-ft; a sub-0.05 residue collapses to a clean "0.0" so a signed
// zero ("−0.00") can never render.
export function fmtAcFt(v) {
  const n = Math.abs(v) < 0.05 ? 0 : v;
  return n.toFixed(1);
}

// The provided/required pair (A2): "0.0 of 33.8 ac-ft". Rendered ONCE per panel (G1).
export function fmtProvidedOfRequired(provided, required) {
  return `${fmtAcFt(provided)} of ${fmtAcFt(required)} AC-FT`;
}

// Signed 1-decimal ac-ft for a delta (surplus/shortfall): a sub-0.05 residue reads "0.0" with
// NO sign — so a signed zero ("−0.0" / "+0.00") can never render. (Still used by the FFE rows.)
export function fmtSignedAcFt(v) {
  const n = Math.abs(v) < 0.05 ? 0 : v;
  const mag = (Math.round(Math.abs(n) * 10) / 10).toFixed(1);
  return n === 0 ? mag : `${n < 0 ? "−" : "+"}${mag}`;
}

/* NEW-7 — SIGNED MARGIN instead of a flat OK/FAIL chip.
 *
 * On Bain, Detention at +97% surplus and Mitigation at +0.5% surplus (98.2 vs 97.7 — half an
 * acre-foot) rendered IDENTICAL green OK chips. A 0.5% margin is erased by any side-slope change, a
 * six-inch pad bump, or an as-built survey, and the reader could not see that from the panel.
 *
 * Every check therefore carries its margin as BOTH a percentage and an absolute, and the chip is
 * BANDED: a surplus under `thinPct` reads amber "THIN", not green "OK". Thresholds are per-check —
 * a mitigation ledger built on grid-sampled fill deserves more headroom than a detention volume
 * computed off a rate. */
export const DEFAULT_THIN_PCT = 0.05; // 5% surplus or less = thin
export const THIN_PCT_BY_CHECK = { det: 0.05, mit: 0.05 };

export function thinThresholdFor(key, overrides = null) {
  const o = overrides && Number.isFinite(overrides[key]) ? overrides[key] : null;
  if (o != null) return o;
  return THIN_PCT_BY_CHECK[key] != null ? THIN_PCT_BY_CHECK[key] : DEFAULT_THIN_PCT;
}

/* NEW-3 (B1034) — the PERCENTAGE FLOOR. A percentage of a near-zero requirement is noise, not
 * information: on Tsakiris a 0.2 ac-ft mitigation requirement against 29.6 provided rendered
 * "+18420%", which makes a trivial absolute surplus look catastrophic. Below this requirement the
 * margin drops the percentage entirely and states the absolute against the requirement instead.
 * CRITERIA-CONFIGURABLE (`marginPctFloorAcFt` in detentionCriteria.js), never an inline constant
 * at a call site — the caller passes the resolved value through `overrides`. */
export const DEFAULT_MARGIN_PCT_FLOOR_ACFT = 1.0;

/* The signed margin for a provided/required pair. `pct` is null when the requirement is zero or
 * below the percentage floor (no meaningful percentage of nothing). `band`: "short" | "thin" | "ok".
 * Pure. */
export function marginFor(provided, required, { key = null, thinPct = null, overrides = null, pctFloorAcFt = null } = {}) {
  if (!Number.isFinite(provided) || !Number.isFinite(required)) return null;
  const absAcFt = provided - required;
  const floor = Number.isFinite(pctFloorAcFt) ? pctFloorAcFt : DEFAULT_MARGIN_PCT_FLOOR_ACFT;
  const pct = required > EPS && required >= floor ? absAcFt / required : null;
  const thin = thinPct != null ? thinPct : thinThresholdFor(key, overrides);
  const band = absAcFt < -EPS ? "short"
    : pct != null && pct <= thin ? "thin"
    : absAcFt <= EPS && required > EPS ? "thin"
    : "ok";
  return { absAcFt, pct, band, thinPct: thin, thin: band === "thin", requiredAcFt: required, pctFloorAcFt: floor };
}

// The margin as the panel says it: "+0.5 ac-ft (+0.5%)" / "−12.3 ac-ft (−16%)". NEW-3 (B1034):
// with the percentage suppressed (a requirement below the floor) it states the absolute against
// the requirement — "+29.4 ac-ft over a 0.2 ac-ft requirement" — never a bare number and never a
// five-digit percentage. Pure.
export function fmtMargin(margin) {
  if (!margin) return null;
  const abs = fmtSignedAcFt(margin.absAcFt);
  if (margin.pct == null) {
    return Number.isFinite(margin.requiredAcFt) && margin.requiredAcFt > EPS
      ? `${abs} AC-FT over a ${fmtAcFt(margin.requiredAcFt)} AC-FT requirement`
      : `${abs} AC-FT`;
  }
  const p = Math.abs(margin.pct * 100);
  const pStr = p >= 10 ? Math.round(p) : (Math.round(p * 10) / 10).toFixed(1);
  const sign = margin.absAcFt < -EPS ? "−" : margin.absAcFt > EPS ? "+" : "";
  return `${abs} AC-FT (${sign}${pStr}%)`;
}

const finish = (v) => ({ ...v, text: `${v.label}: ${v.sentence}` });
const loadingRow = (key, label) => finish({ key, label, pill: "…", tone: "neutral", sentence: "checking flood data", loading: true, sortRank: 1 });
/* B849713/NEW-3 — "checking flood data" is a claim that a fetch is IN FLIGHT. Under B1442 (manual-
 * only checks) a plan that has simply never been checked sits in that state FOREVER — no fetch is
 * running, nothing is coming, and the row contradicted the header's own honest "Flood data: not
 * checked". Mirrors buildabilityVerdict's already-shipped "not checked yet" + `recheck` (the strip
 * renderer swaps this text for "checking…" for the span of a REAL fetch via `v.recheck &&
 * drainRefreshing`, so the genuinely-loading case still reads as loading). */
const notCheckedRow = (key, label) => finish({ key, label, pill: "…", tone: "neutral", sentence: "not checked yet", recheck: true, sortRank: 3 });
/* B853264 (×3) — the THIRD site the same "checking flood data" defect class was found at, this
 * time via a Michael-requested dedupe search rather than a report. Proven by tracing the source,
 * not by inference: `pondLedger.usableCf` (Detention's own provided figure) and
 * `pondLedger.creditedMitCf` (Mitigation's provided figure) are BOTH nulled by the exact same rule
 * in `accumulatePondLedgerUncached` (lib/pondLedger.js) — any pond whose split facts didn't survive
 * into a restored/reloaded session (`factsKnown: false`, `SitePlanner.jsx`'s `pondSplitFor`, only
 * reachable when a check ran, the plan was reloaded, and a pond has no persisted split record — e.g.
 * one drawn after the last check). There is NO other way either field goes null once a requirement/
 * ledger has resolved and `floodChecked` is true — the pond ledger is pure, synchronous math with no
 * async gap, so `loadingRow`'s "still catching up" framing never actually applied here. Proof this
 * is the same bug class: `SitePlanner.jsx`'s own closed-face chip ALREADY has honest, named wording
 * for both exact states ("NEW-9 — usable split unknown on a remembered view" → `RE-CHECK` for
 * Detention; `"provided unknown"` / `RE-CHECK` for Mitigation) while the top strip still said
 * "checking flood data" for both. */
const pondFactsUnknownRow = (key, label) => finish({ key, label, pill: "…", tone: "warn", sentence: "pond details unknown", recheck: true, sortRank: 3 });
/* NEW-6 — a GENUINELY unresolved mitigation state (not a fetch in progress): the
 * flood geometry stands but a required elevation input (BFE / pad FFE / existing grade) never
 * resolved, or the last check predates the drawn area with no last-good to hold. Mirrors the
 * ALREADY-SHIPPED "closed face" chip (SitePlanner.jsx's own `mitVerdict`/`mitChip` derivation —
 * "volume unknown" / "N/A") and the open detail group's "Mitigation volume UNKNOWN — {reason}"
 * row, neither of which was ever wrong — only the top-line verdict strip fell through to the
 * generic `loadingRow` and stuck there forever, because nothing was actually fetching. */
const unresolvedMitigationRow = (reason) => finish({
  key: "mit", label: "Mitigation", pill: "N/A", tone: "warn",
  sentence: reason ? `volume unknown: ${reason}` : "volume unknown",
  unavailable: true, loading: false, short: false, action: false, sortRank: 2.5,
});
const okRow = (key, label, sentence) => finish({ key, label, pill: "OK", tone: "good", sentence, sortRank: 2 });
const pairRow = (key, label, provided, required, short, opts = {}) => {
  // NEW-16 display invariant: a SHORT pair must NEVER show two identical numbers (the
  // "0.0 of 0.0" danger pill). When the 1-dp strings collide on a real shortfall, bump both
  // sides to 2 dp so the gap is visible; if even 2 dp ties (sub-cent residue) fall back to 1 dp.
  let provStr = fmtAcFt(provided), reqStr = fmtAcFt(required);
  if (short && provStr === reqStr) {
    const p2 = (Math.round(provided * 100) / 100).toFixed(2);
    const r2 = (Math.round(required * 100) / 100).toFixed(2);
    if (p2 !== r2) { provStr = p2; reqStr = r2; }
  }
  // NEW-7 — the signed margin + banded chip. A thin surplus is amber "THIN", never green "OK":
  // the reader must be able to see that half an acre-foot of headroom is not a passing design.
  const margin = marginFor(provided, required, { key, overrides: opts.thinOverrides, pctFloorAcFt: opts.pctFloorAcFt });
  const thin = !short && margin && margin.band === "thin";
  return finish({
    key, label,
    pill: short ? "SHORT" : thin ? "THIN" : "OK",
    tone: short ? "danger" : thin ? "warn" : "good",
    // NEW-2 (B1033) — `pairText` is the bare provided/required pair, kept stable so later clauses
    // can append to `sentence` without the renderer having to unpick them back out again.
    pair: { provided, required }, pairText: `${provStr} of ${reqStr} AC-FT`, sentence: `${provStr} of ${reqStr} AC-FT`,
    margin, marginText: fmtMargin(margin), thin,
    short, action: short, sortRank: short ? 0 : thin ? 1.5 : 2,
  });
};

// Detention: the required number is the point requirement, or the CONSERVATIVE (upper) end of a
// screening band — a single number in the strip (the band range moves into the A3 basis tag).
/* NEW-2 (B1127) — the NAMED UNAVAILABLE row.
 *
 * ⛔ THIS BRANCH IS THE BUG FIX, AND ITS ABSENCE WAS SEVERE. Before it, a `kind:"unavailable"`
 * requirement (every Colorado site) matched none of the numeric branches below and fell through to
 * `loadingRow`, so the loudest surface in the panel read **"Detention: checking flood data"** — with
 * a "…" spinner pill — permanently, on every Colorado plan. That is the precise failure the Colorado
 * guard was built to prevent: it reads as work in progress and invites the reader to wait for a
 * number that is never coming. The guard's own carrier was correct the whole time; the strip simply
 * had no branch for it. `loading` is explicitly false here, and the suite asserts it.
 *
 * The row is deliberately NOT a shortfall (nothing is wrong with the design) and NOT an OK (nothing
 * has been checked), so it sorts below the real verdicts and above "not checked yet". */
function unavailableDetentionRow(req) {
  /* PANEL-BREVITY: verdict first, ONE short line — and literally one SENTENCE, assembled from a
   * computed subject so the budget counts a single string rather than one per regime.
   *
   * `req.verdictSubject` is composed by the carrier itself (see `mhfdDetention.verdictSubjectFor`)
   * so the district name and its component short names — "MHFD WQCV + EURV" — stay in the lazily
   * loaded Colorado tier. This module is on the BOOT PATH because the row has to render instantly,
   * so deriving that subject here would have put Colorado data in the eager bundle. The fallback IS
   * eager, and has to be: it is what a Colorado site with no resolved regime reads. */
  const comps = Array.isArray(req.components) ? req.components : [];
  const sentence = `${req.verdictSubject || "Colorado detention"} — not carried yet`;
  return finish({
    key: "det",
    label: "Detention",
    pill: "N/A",
    tone: "warn",
    sentence,
    unavailable: true,
    loading: false,       // ← the fix: never a spinner for a state that will not resolve on its own
    short: false,
    action: false,
    headline: req.headline || null,
    // Carried so the panel can list the components and what each one still needs, without
    // re-deriving any of it from the carrier.
    components: comps,
    needs: comps.filter((c) => c.state !== "computed").map((c) => c.needs).filter(Boolean),
    sortRank: 2.5,
  });
}

/* ⛔ B877440 — the sibling of unavailableDetentionRow, for a county the drainage identify
 * actually resolved but that carries NO modeled detention authority (Tarrant, Dallas, Amarillo…
 * — anything outside the Houston-MSA registry). Before this branch existed, `req` was left
 * `null` for exactly this case (SitePlanner's detReq derivation skipped computeRequiredDetention
 * entirely when drainAuthorityId was falsy), which — once a drainage check had run — fell through
 * detentionVerdict's numeric branches into `loadingRow`: the same permanent "checking flood
 * data" spinner B1127 fixed for Colorado, for a different root cause. `req.kind === "unknown"`
 * with the `no-criteria-modeled` flag is computeRequiredDetention's OWN, already-correct refusal
 * (proven: identical for authorityId null/"generic"/undefined) — this only NAMES it for the
 * panel, with the county the identify resolved, and offers the one honest action: request it. */
function noCriteriaDetentionRow(req) {
  const county = req.governingCounty ? String(req.governingCounty) : null;
  const countyLabel = county ? county.replace(/\b\w/g, (c) => c.toUpperCase()) + (/county$/i.test(county) ? "" : " County") : null;
  // PANEL-BREVITY: ONE template literal (the unavailableDetentionRow precedent above), so the
  // budget counts a single string rather than one per with/without-a-county-name branch.
  const sentence = `no detention criteria on file for ${countyLabel || "this jurisdiction"}`;
  return finish({
    key: "det", label: "Detention", pill: "N/A", tone: "warn", sentence,
    unavailable: true, loading: false, short: false, action: false,
    // No hardcoded headline literal — unlike unavailableDetentionRow's MHFD case, nothing renders
    // this row's headline today, and the sentence already carries the whole fact.
    headline: null,
    requestCriteria: county ? { countyKey: county, countyLabel, family: "detention" } : null,
    sortRank: 2.5,
  });
}

function detentionVerdict(d) {
  const req = d.req;
  const usableAcFt = d.providedUsableCf == null ? null : d.providedUsableCf / AC_FT;
  const inundated = d.pondFullyInundated && usableAcFt != null && usableAcFt < 1e-6;
  // Checked BEFORE the numeric branches: an unavailable requirement has no number to compare, and
  // falling through to them is what produced the permanent "checking flood data".
  if (req && req.kind === "unavailable") return unavailableDetentionRow(req);
  if (req && req.kind === "unknown" && Array.isArray(req.flags) && req.flags.includes("no-criteria-modeled")) return noCriteriaDetentionRow(req);
  const requiredAcFt = req && req.kind === "point" && req.requiredAcFt > EPS ? req.requiredAcFt
    : req && req.kind === "band" ? req.bandAcFt[1] : null;
  if (requiredAcFt == null) {
    if (req && req.kind === "point") return okRow("det", "Detention", "not required");
    // B849713/NEW-3 — no requirement has EVER been resolved (not a fetch in progress): say so.
    if (!d.floodChecked) return notCheckedRow("det", "Detention");
    return loadingRow("det", "Detention");
  }
  // B854xxx/NEW-1 — a resolved `req` does NOT imply a flood check ran: `req` hydrates from
  // `drainCtxData` (a live OR a RESTORED context's `.ctx`), while `floodChecked` reads that same
  // restored record's separate `.checkedAt` field (SitePlanner.jsx `drainRestoredCtx`) — two
  // different fields of one restorable object, not implications of each other. A saved
  // `settings.drainage.lastCheck` that carries enough for `hydrateDrainageContext` to rebuild a
  // requirement but no valid `checkedAt` (a record from before that stamp was reliably written,
  // or one that otherwise lost it) resolves `requiredAcFt` while `floodChecked` correctly stays
  // false — reproducing the owner's Richfield report (header "not checked", Detention "checking
  // flood data") even though nothing was fetching. So this branch gets the same guard as the one
  // above.
  // B853264 (×3) — and once `floodChecked` IS true, `usableAcFt == null` is NEVER genuine loading
  // (see `pondFactsUnknownRow`'s header): it is exclusively a pond whose split facts didn't survive
  // into this restored session. Honest + a real ↻ affordance, never a claimed in-flight fetch.
  if (usableAcFt == null) {
    if (!d.floodChecked) return notCheckedRow("det", "Detention");
    return pondFactsUnknownRow("det", "Detention");
  }
  const short = usableAcFt < requiredAcFt - EPS || inundated;
  const v = pairRow("det", "Detention", usableAcFt, requiredAcFt, short, { thinOverrides: d.thinMarginPct, pctFloorAcFt: d.marginPctFloorAcFt });
  // R1 — when the (ASSUMED) coincident-storm policy MATERIALLY drives this usable number, the
  // verdict carries the assumption (R-PRINCIPLE: an assumed criterion never silently drives a
  // number). The default ship is non-coincident (the pond recovers to normal tailwater between
  // storms); an override to coincident reads the other way. The citation target rides `assumptionSource`.
  if (d.coincidentAssumption) {
    v.assumption = d.coincidentAssumption.coincident
      ? "the design storm coincides with the flood, so usable is credited only above the flood level; confirm the coincident-storm rule"
      : "the pond recovers to normal tailwater between storms (design storm not coincident with the flood); confirm the coincident-storm rule";
    v.assumptionSource = d.coincidentAssumption.source || null;
    v.text = `${v.text} (${v.assumption})`;
  }
  return v;
}

function mitigationVerdict(d) {
  const mitV = d.mitigation;
  // NEW-6 — the drawn geometry outgrew the last fetch and no last-good volume has been
  // captured yet (see SitePlanner.jsx's `drainMitDisplay`/NEW-2). A real refresh isn't running by
  // itself (checks are manual-only, per NEW-4) — nothing is "checking", so this must never say so;
  // the header's own freshness line carries the re-check affordance for this exact state (B867).
  if (d.mitStalePending) return unresolvedMitigationRow(null);
  const notRequired = () => okRow("mit", "Mitigation", "not required");
  if (mitV && mitV.intersectAcres === 0) return notRequired();
  if (d.floodGeo && d.floodGeo.state === "loaded" && d.floodGeo.zoneCount === 0) return notRequired();
  if (mitV && mitV.intersectAcres > 0 && mitV.volumeCf != null) {
    // NEW-16 — below the materiality floor the requirement is trace noise, never a red SHORT:
    // exact zero reads "not required"; a sub-0.05 crumb reads "not required (trace)" with the
    // raw ac-ft carried for the ⓘ. Only a requirement ABOVE the floor is a real obligation.
    if (!(mitV.volumeAcFt > TRACE_ACFT)) {
      const isTrace = mitV.volumeAcFt > EPS;
      return finish({ key: "mit", label: "Mitigation", pill: "OK", tone: "good",
        sentence: isTrace ? "not required (trace)" : "not required",
        trace: isTrace, traceAcFt: isTrace ? mitV.volumeAcFt : null, sortRank: 2 });
    }
    const provCf = d.mitProvided ? d.mitProvided.creditedCf : 0;
    // B908944 (×2) — same root cause as `pondFactsUnknownRow` above: `d.mitProvided.creditedCf` is
    // `pondLedger.creditedMitCf`, nulled by the identical `factsKnown:false` rule. Never genuine
    // loading. Matches the closed-face chip's own "provided unknown" / RE-CHECK for this state.
    if (provCf == null) return pondFactsUnknownRow("mit", "Mitigation");
    if (mitV.flags && mitV.flags.includes("floodway_intersect")) {
      return finish({ key: "mit", label: "Mitigation", pill: "SHORT", tone: "danger", sentence: "fill in the floodway (stop)", short: true, action: true, sortRank: 0 });
    }
    const provAcFt = provCf / AC_FT;
    const row = pairRow("mit", "Mitigation", provAcFt, mitV.volumeAcFt, provAcFt < mitV.volumeAcFt - EPS, { thinOverrides: d.thinMarginPct, pctFloorAcFt: d.marginPctFloorAcFt });
    // NEW-3 — a total that ties is NOT compliance: FBC's offset is hydraulically equivalent, an
    // elevation-matched test. A band ledger that fails demotes the row to SHORT even when the
    // acre-foot totals net positive, and says which is which.
    if (d.mitBands && d.mitBands.known && d.mitBands.overallPass === false) {
      const n = d.mitBands.shortBands.length;
      row.pill = "SHORT"; row.tone = "danger"; row.short = true; row.action = true; row.sortRank = 0;
      row.bandFail = { shortBands: n, totalWouldPass: d.mitBands.totalWouldPass, shortCf: d.mitBands.totals.shortCf };
      // NEW-2 (B1033) — carried as a wrappable SUFFIX as well as in the legacy one-line sentence.
      row.suffix = `${n} elevation band${n === 1 ? "" : "s"} short`;
      row.sentence = `${row.sentence} — ${n} elevation band${n === 1 ? "" : "s"} short`;
      row.text = `${row.label}: ${row.sentence}`;
    }
    // NEW-4 — the requirement could not be priced against the flood line the jurisdiction requires
    // (no 0.2% surface resolvable), so it UNDERSTATES. Never let that read as a clean pass.
    if (d.mitigation && Array.isArray(d.mitigation.flags) && d.mitigation.flags.includes("offset-basis-unresolved")) {
      row.understated = true;
      if (row.pill === "OK") { row.pill = "THIN"; row.tone = "warn"; row.thin = true; row.sortRank = 1.5; }
    }
    // NEW-5 (B1036) — the pond-berm prism couldn't be priced (no existing grade, no flood
    // elevation, or an unanchored pond), so the requirement is a FLOOR of unknown size. A
    // requirement with an unpriceable term must never render as a clean pass.
    if (d.mitigation && Array.isArray(d.mitigation.flags) && d.mitigation.flags.includes("berm-contribution-unknown")) {
      row.understated = true;
      row.bermUnknown = d.mitigation.bermState || true;
      if (row.pill === "OK") { row.pill = "THIN"; row.tone = "warn"; row.thin = true; row.sortRank = 1.5; }
    }
    return row;
  }
  if (mitV && mitV.intersectAcres === 0) return notRequired();
  // NEW-6 — real geometry, real intersect acreage, but the VOLUME never resolved: a
  // missing elevation input (floodplainMitigation.js's `unknownReason` — no published BFE, no
  // pad FFE entered, no existing-grade source), not a fetch in progress. The open detail group
  // already says "Mitigation volume UNKNOWN — {reason}" for exactly this case; the strip is now
  // the same honest state instead of an eternal "checking flood data".
  if (mitV && mitV.intersectAcres > 0) return unresolvedMitigationRow(mitV.unknownReason);
  // NEW-6 — a restored (remembered) check with no restorable mitigation ledger. Same wording
  // as the closed-face chip's own verdict below (SitePlanner.jsx) for this exact state — a real
  // ↻ re-check would compute it, so this row keeps the recheck affordance. (PANEL-BREVITY: the
  // detail group's longer "not screened in this remembered view" row already exists below and
  // is not repeated here — state a fact once.)
  if (d.mitRememberedMissing) return finish({ key: "mit", label: "Mitigation", pill: "…", tone: "warn", sentence: "not screened", recheck: true, sortRank: 3 });
  // NEW-6 — the flood-geometry source itself failed this check (an outage), never a
  // fabricated all-clear. A ↻ retry can genuinely resolve it.
  if (d.floodGeo && d.floodGeo.state === "failed") return finish({ key: "mit", label: "Mitigation", pill: "…", tone: "warn", sentence: "flood source down", recheck: true, sortRank: 3 });
  // Defensive backstop only — every reachable `mitV` shape above already has an honest branch.
  if (mitV) return loadingRow("mit", "Mitigation");
  return null;
}

function buildabilityVerdict(d) {
  const bb = d.buildability;
  const row = (pill, tone, sentence, extra) => finish({ key: "ffe", label: "Buildability", pill, tone, sentence, short: pill === "SHORT", sortRank: pill === "SHORT" ? 0 : pill === "…" ? 1 : 2, ...extra });
  // v3 B2 — buildability is now a PERMANENT strip row (its own group was deleted). When it has
  // not been assessed it reads a neutral "not checked yet" that sorts LAST (below the real
  // verdicts, so it never outshouts a passing one) and hangs a ↻ re-check (the `recheck` flag;
  // the strip renderer draws the ↻ that re-pulls the flood data).
  if (!bb) return row("…", "neutral", "not checked yet", { recheck: true, sortRank: 3 });
  const ffe = bb.ffe;
  /* ⛔ B209508 — A FINISHED-FLOOR ELEVATION MAY NOT BE STATED WHILE THE AUTHORITY BEHIND IT IS
   * UNKNOWN. "pads assumed at 144.8′ FFE" reads as a settled screening answer, but the number comes
   * from whichever floodplain rule survived — and a FAILED jurisdiction lookup removes candidates
   * silently, so the surviving rule can be the LAXER one. At Bain a flaky City-of-Houston ETJ lookup
   * is the difference between Ch. 19's 500-yr basis and Fort Bend County's, which is 1–2 ft of
   * finished floor on a site with two detention ponds.
   *
   * So when the administrator reports an unresolved jurisdiction role, the row states the GAP
   * instead of the number. The elevation is still reachable — the FFE detail line under the row
   * carries it, labelled provisional — but the one-line verdict never asserts a settled floor off an
   * incomplete candidate set. */
  /* NEW-1a — the SPLIT case refuses for a sharper reason than the unresolved one: there the
   * jurisdiction is unknown, here it is KNOWN and there are two of it, and a one-line "pads pass at
   * X′" is a claim about the whole site that is false for whichever lots the other ordinance
   * governs. Both are the same VERDICT (an unsettled FFE) so they share one line and differ only in
   * the reason — PANEL-BREVITY: this adds a state without adding a line. */
  /* ⛔ NEW-1d — AND THE UNMODELLED CASE REFUSES HERE TOO, which it did not.
   *
   * `settled` already accounted for an authority with no transcribed rule, and this row did not
   * read it — it only asked about `unresolved || split`. So a site wholly inside a city whose
   * ordinance we do not have (not split, nothing failed) fell straight through to
   * "pads pass at X′ FFE": a settled claim about a floor, with a governing city's rule missing from
   * the comparison that produced it. Gate on the module's own `settled`, so a fourth state cannot
   * be added upstream and forgotten here again.
   *
   * ⚠ THE NUMBER IS CARRIED, NOT DROPPED. An unsettled FFE is not "no requirement" — the default
   * while we wait is the authority we DO have, and the panel names it and shows its elevation on
   * the line beneath. A blank would read as "nothing required", which is the one answer that is
   * certainly wrong (the same four-state discipline the freshness light uses: unchecked is not a
   * pass). `provisionalFfeFt` is what the detail line prints. */
  if (d.administrator && (d.administrator.unresolved || d.administrator.split || d.administrator.unmodelledCandidates?.length)) {
    /* PANEL-BREVITY, and it is a genuine collapse rather than a deletion: the verdict row states
     * the VERDICT and the line immediately beneath it — `yield-ffe-unresolved`, `yield-ffe-split`
     * or `yield-ffe-unmodelled` — already names which case this is and why, in full. Carrying the
     * reason here as well printed it twice. Measured: 14 lines / 685 chars before, 13 / 615 after,
     * so this adds three states without adding a line. */
    return row("?", "warn", "FFE rule not settled", {
      sortRank: 1, ffeUnsettled: true,
      provisionalFfeFt: Number.isFinite(ffe.requiredFfeFt) ? ffe.requiredFfeFt : null,
    });
  }
  if (ffe.status === "pass") return row("OK", "good", `pads pass at ${fmtAcFt(ffe.requiredFfeFt)}′ FFE`);
  if (ffe.status === "assumed") return row("OK", "neutral", `pads assumed at ${fmtAcFt(ffe.requiredFfeFt)}′ FFE`);
  if (ffe.status === "short") return row("SHORT", "danger", `pads ${fmtAcFt(ffe.shortByFt)}′ short of required FFE`);
  if (ffe.status === "no_rule") return row("OK", "good", ffe.outsideFloodplain ? "pads outside floodplain" : "no FFE rule modeled");
  return row("…", "neutral", "set BFE to screen FFE");
}

/* NEW-1 — the RECONCILIATION override. Two ledgers can each add up correctly on their own terms
 * while together claiming more storage than physically exists (Bain: 150.9 + 98.2 = 249.1 ac-ft of
 * service against 206.3 ac-ft of pond). No single-ledger verdict can see that, so when the site
 * reconciliation FAILS both storage verdicts are forced to a hard FAIL — never a pair of green OKs
 * over a 42.8 ac-ft double-count. The row carries the overlap volume and the ponds involved. */
function applyReconciliation(rows, d) {
  const rec = d.reconcile;
  if (!rec || rec.state !== "fail") return rows;
  // NEW-4 (B1035) — the reconciliation is a SITE-level failure, so its paragraph is stated ONCE.
  // It used to render verbatim three times (under Detention, under Mitigation, and again under
  // Storage reconciles). The FIRST affected row carries the sentence (`primary`); the others carry
  // a back-reference naming the row that has it, so the reader is pointed, not repeated at.
  let primaryLabel = null;
  return rows.map((r) => {
    if (r.key !== "det" && r.key !== "mit") return r;
    const primary = primaryLabel == null;
    if (primary) primaryLabel = r.label;
    const v = {
      ...r,
      pill: "FAIL", tone: "danger", short: true, action: true, sortRank: -1,
      reconcileFail: {
        overlapAcFt: rec.overlapCf != null ? rec.overlapCf / AC_FT : null,
        physicalAcFt: rec.physicalCf != null ? rec.physicalCf / AC_FT : null,
        claimedAcFt: rec.claimedCf != null ? rec.claimedCf / AC_FT : null,
        ponds: (rec.offenders && rec.offenders.length ? rec.offenders : rec.undeclared || []).map((p) => p.name || p.id),
        undeclared: (rec.undeclared || []).length > 0,
        primary,
        // The one sentence, on the primary row only; every other affected row points at it.
        message: primary ? rec.message : `Same storage reconciliation as ${primaryLabel} above.`,
        fullMessage: rec.message,
      },
      // NEW-2 (B1033) — the reconciliation clause is a SUFFIX, kept apart from the bold nowrap
      // provided/required pair so it can WRAP. Concatenated into one nowrap headline it was
      // clipped mid-word at the panel edge ("…12.2 ac-ft counted twi").
      suffix: rec.overlapCf > 0
        ? `${fmtAcFt(rec.overlapCf / AC_FT)} AC-FT counted twice`
        : "duty split not declared",
      sentence: rec.overlapCf > 0
        ? `${r.sentence} — ${fmtAcFt(rec.overlapCf / AC_FT)} AC-FT counted twice`
        : `${r.sentence} — duty split not declared`,
    };
    return { ...v, text: `${v.label}: ${v.sentence}` };
  });
}

// The strip: up to three one-line verdicts (detention · mitigation · buildability). Nulls drop.
// Sorted SHORT-first, then loading, then OK (A2), stable within a rank.
export function yieldVerdictStrip(d) {
  if (!d) return [];
  const rows = applyReconciliation([detentionVerdict(d), mitigationVerdict(d), buildabilityVerdict(d)].filter(Boolean), d);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.sortRank - b.r.sortRank || a.i - b.i)
    .map(({ r }) => r);
}
