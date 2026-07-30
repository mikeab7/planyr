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
  return `${fmtAcFt(provided)} of ${fmtAcFt(required)} ac-ft`;
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
      ? `${abs} ac-ft over a ${fmtAcFt(margin.requiredAcFt)} ac-ft requirement`
      : `${abs} ac-ft`;
  }
  const p = Math.abs(margin.pct * 100);
  const pStr = p >= 10 ? Math.round(p) : (Math.round(p * 10) / 10).toFixed(1);
  const sign = margin.absAcFt < -EPS ? "−" : margin.absAcFt > EPS ? "+" : "";
  return `${abs} ac-ft (${sign}${pStr}%)`;
}

const finish = (v) => ({ ...v, text: `${v.label}: ${v.sentence}` });
const loadingRow = (key, label) => finish({ key, label, pill: "…", tone: "neutral", sentence: "checking flood data", loading: true, sortRank: 1 });
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
    pair: { provided, required }, pairText: `${provStr} of ${reqStr} ac-ft`, sentence: `${provStr} of ${reqStr} ac-ft`,
    margin, marginText: fmtMargin(margin), thin,
    short, action: short, sortRank: short ? 0 : thin ? 1.5 : 2,
  });
};

// Detention: the required number is the point requirement, or the CONSERVATIVE (upper) end of a
// screening band — a single number in the strip (the band range moves into the A3 basis tag).
/* NEW-2 (B1123) — the NAMED UNAVAILABLE row.
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

function detentionVerdict(d) {
  const req = d.req;
  const usableAcFt = d.providedUsableCf == null ? null : d.providedUsableCf / AC_FT;
  const inundated = d.pondFullyInundated && usableAcFt != null && usableAcFt < 1e-6;
  // Checked BEFORE the numeric branches: an unavailable requirement has no number to compare, and
  // falling through to them is what produced the permanent "checking flood data".
  if (req && req.kind === "unavailable") return unavailableDetentionRow(req);
  const requiredAcFt = req && req.kind === "point" && req.requiredAcFt > EPS ? req.requiredAcFt
    : req && req.kind === "band" ? req.bandAcFt[1] : null;
  if (requiredAcFt == null) {
    if (req && req.kind === "point") return okRow("det", "Detention", "not required");
    return loadingRow("det", "Detention");
  }
  if (usableAcFt == null) return loadingRow("det", "Detention");
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
  if (d.mitStalePending) return loadingRow("mit", "Mitigation");
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
    if (provCf == null) return loadingRow("mit", "Mitigation");
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
  if (mitV || d.mitRememberedMissing || (d.floodGeo && d.floodGeo.state === "failed")) return loadingRow("mit", "Mitigation");
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
        ? `${fmtAcFt(rec.overlapCf / AC_FT)} ac-ft counted twice`
        : "duty split not declared",
      sentence: rec.overlapCf > 0
        ? `${r.sentence} — ${fmtAcFt(rec.overlapCf / AC_FT)} ac-ft counted twice`
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
