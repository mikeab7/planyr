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

const finish = (v) => ({ ...v, text: `${v.label}: ${v.sentence}` });
const loadingRow = (key, label) => finish({ key, label, pill: "…", tone: "neutral", sentence: "checking flood data", loading: true, sortRank: 1 });
const okRow = (key, label, sentence) => finish({ key, label, pill: "OK", tone: "good", sentence, sortRank: 2 });
const pairRow = (key, label, provided, required, short) => {
  // NEW-16 display invariant: a SHORT pair must NEVER show two identical numbers (the
  // "0.0 of 0.0" danger pill). When the 1-dp strings collide on a real shortfall, bump both
  // sides to 2 dp so the gap is visible; if even 2 dp ties (sub-cent residue) fall back to 1 dp.
  let provStr = fmtAcFt(provided), reqStr = fmtAcFt(required);
  if (short && provStr === reqStr) {
    const p2 = (Math.round(provided * 100) / 100).toFixed(2);
    const r2 = (Math.round(required * 100) / 100).toFixed(2);
    if (p2 !== r2) { provStr = p2; reqStr = r2; }
  }
  return finish({
    key, label,
    pill: short ? "SHORT" : "OK", tone: short ? "danger" : "good",
    pair: { provided, required }, sentence: `${provStr} of ${reqStr} ac-ft`,
    short, action: short, sortRank: short ? 0 : 2,
  });
};

// Detention: the required number is the point requirement, or the CONSERVATIVE (upper) end of a
// screening band — a single number in the strip (the band range moves into the A3 basis tag).
function detentionVerdict(d) {
  const req = d.req;
  const usableAcFt = d.providedUsableCf == null ? null : d.providedUsableCf / AC_FT;
  const inundated = d.pondFullyInundated && usableAcFt != null && usableAcFt < 1e-6;
  const requiredAcFt = req && req.kind === "point" && req.requiredAcFt > EPS ? req.requiredAcFt
    : req && req.kind === "band" ? req.bandAcFt[1] : null;
  if (requiredAcFt == null) {
    if (req && req.kind === "point") return okRow("det", "Detention", "not required");
    return loadingRow("det", "Detention");
  }
  if (usableAcFt == null) return loadingRow("det", "Detention");
  const short = usableAcFt < requiredAcFt - EPS || inundated;
  const v = pairRow("det", "Detention", usableAcFt, requiredAcFt, short);
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
    return pairRow("mit", "Mitigation", provAcFt, mitV.volumeAcFt, provAcFt < mitV.volumeAcFt - EPS);
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

// The strip: up to three one-line verdicts (detention · mitigation · buildability). Nulls drop.
// Sorted SHORT-first, then loading, then OK (A2), stable within a rank.
export function yieldVerdictStrip(d) {
  if (!d) return [];
  const rows = [detentionVerdict(d), mitigationVerdict(d), buildabilityVerdict(d)].filter(Boolean);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.sortRank - b.r.sortRank || a.i - b.i)
    .map(({ r }) => r);
}
