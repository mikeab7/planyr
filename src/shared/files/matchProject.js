/* Project matcher — browser/shared, deterministic, "never auto-guess" (B312).
 *
 * MIRRORS the decision logic of server/filing/matcher.js (the same confident-single-match /
 * else-needs-filing contract + thresholds), but built for the BROWSER plain-code path: instead
 * of comparing pre-extracted fields, it SEARCHES the sheet's own text for each named project's
 * identifiers (name, address, parcel, job number). That's the robust deterministic move — a
 * title block prints the project's name/address/job#, so "does project X appear on this sheet"
 * beats trying to blindly extract a single "project name" string.
 *
 * Kept self-contained (no import of the server copy — /server is walled off from the bundle;
 * same fitToBoundary precedent). A misfiled drawing is worse than an unfiled one, so it refuses
 * to decide on a weak or ambiguous read and routes the file to the "needs filing" tray.
 */
const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const normId = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "");
const STOP = new Set(["the", "a", "an", "of", "and", "for", "project", "site", "development", "phase", "tract", "lot", "block", "no", "number", "bldg", "building", "addition", "subdivision"]);
const tokens = (s) => norm(s).split(" ").filter((t) => t && !STOP.has(t));
const asArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const noisyOr = (cs) => 1 - cs.reduce((p, c) => p * (1 - Math.max(0, Math.min(1, c))), 1);

// Does a normalized needle appear as a phrase in the normalized haystack? (word-boundary-safe
// via the single-space normalization on both sides).
const phraseIn = (needle, hayNorm) => { const n = norm(needle); return n.length >= 3 && ` ${hayNorm} `.includes(` ${n} `); };

/* Score one project against the full sheet text. Returns { id, name, score, signals } — signals
 * lists what matched so the decision is explainable, never a black box. */
export function scoreProjectInText(text, project = {}) {
  const hay = norm(text);
  const haystackIds = normId(text);
  const al = project.aliases || {};
  const names = [project.name, ...asArr(al.names)].filter(Boolean);
  const signals = [];
  const push = (kind, conf, detail) => { if (conf > 0) signals.push({ kind, conf, detail }); };

  // Exact identifiers an engineer's title block carries — strong, low false-positive.
  for (const p of asArr(al.parcels)) { const id = normId(p); if (id.length >= 6 && haystackIds.includes(id)) { push("parcel", 0.97, p); break; } }
  for (const j of asArr(al.jobNumbers)) { const id = normId(j); if (id.length >= 4 && haystackIds.includes(id)) { push("jobNumber", 0.95, j); break; } }
  for (const a of asArr(al.addresses)) {
    // Address: require the street number + ≥1 distinctive street token to co-occur (not just "rd").
    const ts = tokens(a); const numTok = ts.find((t) => /^\d{2,}$/.test(t));
    const hit = ts.filter((t) => t.length >= 3 && phraseIn(t, hay)).length;
    if (numTok && haystackIds.includes(normId(numTok)) && hit >= 2) { push("address", 0.85, a); break; }
  }
  // Project name: the primary printed identifier. Full-phrase hit is strong; otherwise require
  // a high token-overlap of the name's distinctive words (so "Katy Grand" must mostly appear).
  let nameConf = 0;
  for (const n of names) {
    if (phraseIn(n, hay)) { nameConf = Math.max(nameConf, 0.9); continue; }
    const nt = tokens(n); if (!nt.length) continue;
    const hit = nt.filter((t) => phraseIn(t, hay)).length;
    if (nt.length >= 2 && hit === nt.length) nameConf = Math.max(nameConf, 0.8); // all name words present
  }
  push("name", nameConf, project.name);

  return { id: project.id, name: project.name, score: noisyOr(signals.map((s) => s.conf)), signals };
}

/* The shared decision: a confident SINGLE project, or route to "needs filing" with a reason.
 * Identical shape + thresholds to server/filing/matcher.js. */
export function decide(candidates, opts = {}) {
  const minConfidence = opts.minConfidence ?? 0.6;
  const minMargin = opts.minMargin ?? 0.15;
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const d = { matched: null, projectId: null, confidence: sorted[0] ? +sorted[0].score.toFixed(3) : 0, candidates: sorted, needsFiling: true, reason: "" };
  if (!sorted.length || sorted[0].score < minConfidence) { d.reason = "no-match"; return d; }
  const top = sorted[0];
  const margin = top.score - (sorted[1] ? sorted[1].score : 0);
  if (sorted[1] && sorted[1].score > 0 && margin < minMargin) { d.reason = "ambiguous"; return d; }
  d.matched = { id: top.id, name: top.name, signals: top.signals };
  d.projectId = top.id; d.needsFiling = false; d.reason = "matched";
  return d;
}

/* Match the sheet text against the named projects. `projects` = [{ id, name, aliases? }].
 * Returns { matched, projectId, confidence, candidates, needsFiling, reason }. */
export function matchProjectInText(text, projects = [], opts = {}) {
  if (!norm(text)) return { matched: null, projectId: null, confidence: 0, candidates: [], needsFiling: true, reason: "no-readable-identifiers" };
  return decide(projects.map((p) => scoreProjectInText(text, p)), opts);
}
