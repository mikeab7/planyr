/* Project matcher (B270) — pure, dependency-free, the "never auto-guess" core.
 *
 * Given the fields a title-block read pulled off a drawing, decide which of the named
 * projects it belongs to — and, just as importantly, REFUSE to decide when it isn't sure.
 * A misfiled drawing is worse than an unfiled one (KEY DECISIONS), so the contract is:
 *   - a confident SINGLE project  → auto-route + auto-name
 *   - no match / multiple matches / low confidence → "needs filing" tray (reason given)
 * It never picks a "best guess" to break a tie.
 *
 * Signals, strongest → weakest: parcel/account number (exact), job/project number (exact),
 * street address (token overlap), project name (token overlap). Each yields a confidence in
 * [0,1]; they combine noisy-or so one strong signal dominates and weak signals can corroborate
 * without ever manufacturing certainty from nothing. The thresholds live in config
 * (minConfidence / minMargin) so they're tunable without touching this logic.
 *
 * A "project" here is { id, name, aliases?: { names?, addresses?, parcels?, jobNumbers? } }.
 * Names are the always-present signal; aliases (address / parcel / job number off the title
 * block) sharpen it when the library carries them. With only names, the matcher leans on the
 * name and still refuses on a weak/ambiguous overlap — exactly the intended caution.
 */

// ---- normalization ---------------------------------------------------------
const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const normId = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, ""); // parcel/job numbers: ignore punctuation/spacing entirely

// Tokens for fuzzy overlap, minus filler words that would inflate a coincidental match.
const STOP = new Set(["the", "a", "an", "of", "and", "for", "project", "site", "development", "phase", "ph", "tract", "lot", "block", "no", "number", "bldg", "building"]);
const tokens = (s) => norm(s).split(" ").filter((t) => t && !STOP.has(t));

// Sørensen–Dice overlap of two token *sets* (order-free, length-normalized) → [0,1].
function diceTokens(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const asArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
// Best signal confidence across a project's own value + its aliases.
const bestOver = (values, score) => asArr(values).reduce((m, v) => Math.max(m, score(v)), 0);

// noisy-or: combine independent confidences so the result rises with corroboration but is
// dominated by the single strongest signal, and never exceeds any one of them by much.
const noisyOr = (cs) => 1 - cs.reduce((p, c) => p * (1 - Math.max(0, Math.min(1, c))), 1);

/* Score one project against the read. Returns { id, name, score, signals } where signals
 * lists each contributing match (for an honest "matched because…" explanation, never a
 * black box). */
export function scoreProject(fields = {}, project = {}) {
  const al = project.aliases || {};
  const names = [project.name, ...asArr(al.names)];
  const signals = [];
  const push = (kind, conf, detail) => { if (conf > 0) signals.push({ kind, conf, detail }); };

  // Exact identifiers — the trustworthy signals an engineer's title block carries.
  if (norm(fields.parcel)) {
    const c = bestOver(al.parcels, (p) => (normId(p) && normId(p) === normId(fields.parcel) ? 0.97 : 0));
    push("parcel", c, fields.parcel);
  }
  if (norm(fields.projectNumber)) {
    const c = bestOver(al.jobNumbers, (j) => (normId(j) && normId(j) === normId(fields.projectNumber) ? 0.95 : 0));
    push("jobNumber", c, fields.projectNumber);
  }
  // Street address — token overlap (handles "FM 1093" vs "F.M. 1093 Rd", suite/zip noise).
  if (norm(fields.address)) {
    const o = bestOver(al.addresses, (a) => diceTokens(a, fields.address));
    const c = o >= 0.8 ? 0.9 : o >= 0.6 ? 0.72 : o * 0.6; // a partial address is weak corroboration, not proof
    push("address", c, fields.address);
  }
  // Project name — the primary title-block field; a strong name match is itself confident.
  if (norm(fields.projectName)) {
    const d = bestOver(names, (n) => diceTokens(n, fields.projectName));
    const c = d >= 0.85 ? 0.9 : d; // cap a perfect-token coincidence just under the exact-id signals
    push("name", c, fields.projectName);
  }

  return { id: project.id, name: project.name, score: noisyOr(signals.map((s) => s.conf)), signals };
}

/* Match the read against the named projects. Returns:
 *   { matched, projectId, confidence, candidates, needsFiling, reason }
 * `matched` is non-null ONLY for a confident single project; otherwise needsFiling is true
 * and `reason` says why (no-readable-identifiers / no-match / ambiguous / low-confidence). */
export function matchProject(fields = {}, projects = [], opts = {}) {
  const minConfidence = opts.minConfidence ?? 0.6;
  const minMargin = opts.minMargin ?? 0.15;

  const hasSignal = norm(fields.projectName) || norm(fields.address) || norm(fields.parcel) || norm(fields.projectNumber);
  const candidates = projects.map((p) => scoreProject(fields, p)).sort((a, b) => b.score - a.score);
  const decision = { matched: null, projectId: null, confidence: candidates[0] ? +candidates[0].score.toFixed(3) : 0, candidates, needsFiling: true, reason: "" };

  if (!hasSignal) { decision.reason = "no-readable-identifiers"; return decision; }
  if (!candidates.length || candidates[0].score < minConfidence) { decision.reason = "no-match"; return decision; }

  const top = candidates[0];
  const margin = top.score - (candidates[1] ? candidates[1].score : 0);
  // Ambiguous when a runner-up is within the margin (two plausible homes → let a human pick,
  // never coin-flip). Distinct from merely low confidence (the only candidate is weak).
  if (candidates[1] && candidates[1].score >= minConfidence && margin < minMargin) { decision.reason = "ambiguous"; return decision; }
  if (margin < minMargin && candidates[1] && candidates[1].score > 0) { decision.reason = "ambiguous"; return decision; }

  decision.matched = { id: top.id, name: top.name, signals: top.signals };
  decision.projectId = top.id;
  decision.needsFiling = false;
  decision.reason = "matched";
  return decision;
}
