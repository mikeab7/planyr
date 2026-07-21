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
const pairRow = (key, label, provided, required, short) => finish({
  key, label,
  pill: short ? "SHORT" : "OK", tone: short ? "danger" : "good",
  pair: { provided, required }, sentence: fmtProvidedOfRequired(provided, required),
  short, action: short, sortRank: short ? 0 : 2,
});

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
  return pairRow("det", "Detention", usableAcFt, requiredAcFt, short);
}

function mitigationVerdict(d) {
  const mitV = d.mitigation;
  if (d.mitStalePending) return loadingRow("mit", "Mitigation");
  const notRequired = () => okRow("mit", "Mitigation", "not required");
  if (mitV && mitV.intersectAcres === 0) return notRequired();
  if (d.floodGeo && d.floodGeo.state === "loaded" && d.floodGeo.zoneCount === 0) return notRequired();
  if (mitV && mitV.intersectAcres > 0 && mitV.volumeCf != null) {
    if (!(mitV.volumeAcFt > EPS)) return notRequired();
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
  if (!bb) return null;
  const ffe = bb.ffe;
  const row = (pill, tone, sentence) => finish({ key: "ffe", label: "Buildability", pill, tone, sentence, short: pill === "SHORT", sortRank: pill === "SHORT" ? 0 : pill === "…" ? 1 : 2 });
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
