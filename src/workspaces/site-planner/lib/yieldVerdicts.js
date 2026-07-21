/* FINAL UI SPEC Part B — the Yield panel's verdict strip (B1.1) + number-format rule
 * (B2/B3), as pure data so both the strip and the tests read one source. Presentation only:
 * this reads the SAME `drainage` object the detailed verdict groups below expand on, and
 * maps it to up-to-four one-line verdicts — it never computes a stormwater value itself.
 *
 * A verdict is { key, tone, text, short }. tone drives the colored dot (good=green,
 * danger=red, warn=amber, null=neutral). `short` marks a detention/mitigation shortfall so
 * the caller can hang a compact ⚡ Design pond button off the line. */

const AC_FT = 43560;
const EPS = 0.005; // an ac-ft residue inside display precision is "met", never a phantom SHORT

// B2/B3 — one decimal for ac-ft, and a sub-0.05 residue collapses to a clean "0.0" so a
// signed zero ("−0.00") can never render. The caller adds an explicit +/− where a sign is
// wanted (the magnitude is always formatted through here).
export function fmtAcFt(v) {
  const n = Math.abs(v) < 0.05 ? 0 : v;
  return n.toFixed(1);
}

// "provided / required" on the requirement bar (B2), tabular-nums applied by the renderer.
export function fmtProvidedOfRequired(provided, required) {
  return `${fmtAcFt(provided)} / ${fmtAcFt(required)}`;
}

// Signed 1-decimal ac-ft for a delta (surplus/shortfall): a sub-0.05 residue reads "0.0"
// with NO sign — so a signed zero ("−0.0" / "+0.00") can never render.
export function fmtSignedAcFt(v) {
  const n = Math.abs(v) < 0.05 ? 0 : v;
  const mag = (Math.round(Math.abs(n) * 10) / 10).toFixed(1);
  return n === 0 ? mag : `${n < 0 ? "−" : "+"}${mag}`;
}

function detentionVerdict(d) {
  const req = d.req;
  const usableAcFt = d.providedUsableCf == null ? null : d.providedUsableCf / AC_FT;
  const inundated = d.pondFullyInundated && usableAcFt != null && usableAcFt < 1e-6;
  if (req && req.kind === "point" && req.requiredAcFt > EPS) {
    if (usableAcFt == null) return { key: "det", tone: null, text: "Detention — checking flood data ↻" };
    const dv = usableAcFt - req.requiredAcFt;
    const short = dv < -EPS || inundated;
    return short
      ? { key: "det", tone: "danger", short: true, text: `Detention SHORT — ${fmtAcFt(usableAcFt)} of ${fmtAcFt(req.requiredAcFt)} ac-ft` }
      : { key: "det", tone: "good", text: `Detention covered ✓ +${fmtAcFt(Math.max(0, dv))} ac-ft` };
  }
  if (req && req.kind === "point") return { key: "det", tone: null, text: "Detention not required" };
  if (req && req.kind === "band") {
    if (usableAcFt == null) return { key: "det", tone: null, text: "Detention — checking flood data ↻" };
    const covered = usableAcFt >= req.bandAcFt[1] - EPS && !inundated;
    const short = usableAcFt < req.bandAcFt[0] - EPS || inundated;
    if (covered) return { key: "det", tone: "good", text: `Detention covered ✓ (${fmtAcFt(req.bandAcFt[0])}–${fmtAcFt(req.bandAcFt[1])} ac-ft band)` };
    if (short) return { key: "det", tone: "danger", short: true, text: `Detention SHORT — ${fmtAcFt(usableAcFt)} of ${fmtAcFt(req.bandAcFt[1])} ac-ft` };
    return { key: "det", tone: "warn", text: `Detention — within the ${fmtAcFt(req.bandAcFt[0])}–${fmtAcFt(req.bandAcFt[1])} ac-ft band` };
  }
  return { key: "det", tone: "warn", text: "Detention — checking flood data ↻" };
}

function mitigationVerdict(d) {
  const mitV = d.mitigation;
  if (d.mitStalePending) return { key: "mit", tone: "warn", text: "Mitigation — checking flood data ↻" };
  if (mitV && mitV.intersectAcres > 0 && mitV.volumeCf != null) {
    const provCf = d.mitProvided ? d.mitProvided.creditedCf : 0;
    if (provCf == null) return { key: "mit", tone: "warn", text: "Mitigation — checking flood data ↻" };
    if (!(mitV.volumeAcFt > EPS)) return { key: "mit", tone: null, text: "Mitigation not required" };
    const bal = provCf / AC_FT - mitV.volumeAcFt;
    if (mitV.flags && mitV.flags.includes("floodway_intersect")) return { key: "mit", tone: "danger", text: "Mitigation — fill in the floodway (STOP)" };
    return bal < -EPS
      ? { key: "mit", tone: "danger", short: true, text: `Mitigation SHORT — ${fmtAcFt(provCf / AC_FT)} of ${fmtAcFt(mitV.volumeAcFt)} ac-ft` }
      : { key: "mit", tone: "good", text: "Mitigation covered ✓" };
  }
  if (mitV && mitV.intersectAcres === 0) return { key: "mit", tone: null, text: "Mitigation not required" };
  if (d.floodGeo && d.floodGeo.state === "loaded" && d.floodGeo.zoneCount === 0) return { key: "mit", tone: null, text: "Mitigation not required" };
  if (mitV || d.mitRememberedMissing || (d.floodGeo && d.floodGeo.state === "failed")) return { key: "mit", tone: "warn", text: "Mitigation — checking flood data ↻" };
  return null;
}

function buildabilityVerdict(d) {
  const bb = d.buildability;
  if (!bb) return null;
  const ffe = bb.ffe;
  if (ffe.status === "pass") return { key: "ffe", tone: "good", text: `Building pads pass · ${fmtAcFt(ffe.requiredFfeFt)}′ FFE` };
  if (ffe.status === "assumed") return { key: "ffe", tone: null, text: `Building pads assumed at ${fmtAcFt(ffe.requiredFfeFt)}′ FFE` };
  if (ffe.status === "short") return { key: "ffe", tone: "danger", text: `Building pads ${fmtAcFt(ffe.shortByFt)}′ short of required FFE` };
  if (ffe.status === "no_rule") return { key: "ffe", tone: "good", text: ffe.outsideFloodplain ? "Building pads outside floodplain" : "Building pads — no FFE rule modeled" };
  return { key: "ffe", tone: "warn", text: "Building pads — set BFE to screen FFE" };
}

// The strip: up to four one-line verdicts, in the fixed order detention · mitigation ·
// buildability. Null entries (nothing to say) are dropped. `d` is the drainage object.
export function yieldVerdictStrip(d) {
  if (!d) return [];
  return [detentionVerdict(d), mitigationVerdict(d), buildabilityVerdict(d)].filter(Boolean);
}
