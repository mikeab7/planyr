/* Set-aware sheet-title refinement (B659) — the cross-page correction a single-page reader
 * can never make.
 *
 * The failure it exists for: a title block prints the PROJECT NAME (and client/firm stamps) in
 * larger type than the sheet's own title, so the per-page tallest-line pick (sheetMeta
 * readSheetTitle) returns "GRAND PORT LOGISTICS" for every sheet of a 44-sheet set. The one
 * signal that separates the two is only visible with the whole file in hand: set-level
 * boilerplate repeats on (nearly) EVERY page, while the real title is per-sheet unique — except
 * for tiled plan runs ("GRADING PLAN" on 5 contiguous tiles), which are protected because a real
 * drawing title names a drawing TYPE (plan / elevation / section / notes / …) and an identity
 * stamp does not.
 *
 * PURE + browser-free: takes the per-page records from readSheetMeta (each carrying its ranked
 * `titleCandidates`), returns a new array with better `sheetTitle`s. Two demotions, in order:
 *   1. STOP TEXTS (hard) — the caller's known project names/aliases. The app KNOWS "Grand Port
 *      Logistics" is a project, so it can never be a sheet title. A candidate that IS the stop
 *      text (± one extra word) is dropped; a longer line that merely contains it survives
 *      ("GRAND PORT LOGISTICS SITE PLAN" is a real title).
 *   2. UBIQUITY (soft) — a candidate whose normalized text appears on most pages of the set is
 *      an identity stamp, UNLESS it carries a drawing-type word (the tiled-plan case). Demoted
 *      candidates only lose to a surviving alternative — a page whose every candidate is
 *      ubiquitous keeps its best line (fail open, never blank a working label).
 * Honesty: when nothing survives, the title falls back to the discipline `item` — the same
 * fallback the per-page reader uses; never a guess.
 */

const normT = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => normT(s).split(" ").filter(Boolean);

/* A word that names a drawing TYPE. A ubiquitous candidate carrying one is a legitimate tiled-run
 * title ("GRADING PLAN" over C-5–C-9), not an identity stamp — identity stamps (project, client,
 * firm) never say what kind of drawing the sheet is. */
export const DRAWING_TYPE_WORD = new RegExp(
  "\\b(" + [
    "plans?", "elevations?", "sections?", "details?", "notes?", "schedules?", "index", "cover",
    "surveys?", "plats?", "profiles?", "legends?", "abbreviations?", "specifications?",
    "diagrams?", "layouts?", "risers?", "calculations?", "assembl(?:y|ies)", "enlarged", "typical",
    "framing", "foundation", "demolition", "erosion", "drainage", "grading", "paving", "utilit(?:y|ies)",
    "photometrics?", "irrigation", "planting", "topograph(?:y|ic)", "boundary", "alta",
  ].join("|") + ")\\b", "i"
);

/* Does a candidate line amount to a caller-known STOP text (project name / alias)? Equality after
 * normalization, or containment with at most ONE extra word ("GRAND PORT LOGISTICS" inside
 * "GRAND PORT LOGISTICS BLDG" — still just the project identity). A line that adds ≥2 real words
 * on top of the name is treated as a genuine title that happens to mention the project. */
export function isStopText(text, stops) {
  let k = normT(text);
  if (!k) return true;
  // A doubled cell ("MESA DRIVE - MESA DRIVE -" — two identical stacked cells read as one row)
  // compares as its single phrase.
  const w = words(k), half = w.length >> 1;
  if (w.length >= 4 && w.length % 2 === 0 && w.slice(0, half).join(" ") === w.slice(half).join(" ")) k = w.slice(0, half).join(" ");
  for (const s of stops) {
    if (!s) continue;
    if (k === s) return true;
    if (k.includes(s) && words(k).length - words(s).length <= 1) return true;
    // The candidate is a ≥2-word FRAGMENT of a known identity string ("MESA DRIVE" inside the
    // project address "6955 Mesa Drive").
    if (words(k).length >= 2 && s.includes(k)) return true;
  }
  return false;
}

/* The stop-text list for a set of named projects: every project name + alias name. The one
 * convenience the UI callers share (DocReview rail, Stitcher, Library drop) so they can't
 * drift on what "the known names" means. Pure — takes the caller's own projects array. */
export function projectStopTexts(projects = []) {
  const out = [];
  const take = (v) => { for (const n of Array.isArray(v) ? v : v ? [v] : []) if (n) out.push(n); };
  for (const p of projects || []) {
    if (!p) continue;
    if (p.name) out.push(p.name);
    take(p.aliases && p.aliases.names);
    take(p.aliases && p.aliases.addresses); // the project's street line is identity, never a title
  }
  return out;
}

/* How many pages carry each normalized candidate text (presence per page, not occurrences). */
export function candidateFrequency(pages) {
  const freq = new Map();
  for (const p of pages || []) {
    const seen = new Set();
    for (const c of p && p.titleCandidates ? p.titleCandidates : []) {
      const k = normT(c.text);
      if (k && !seen.has(k)) { seen.add(k); freq.set(k, (freq.get(k) || 0) + 1); }
    }
  }
  return freq;
}

/* Refine every page's sheetTitle with the whole set in hand. Returns a NEW array; pages whose
 * title survives unchanged keep their original object (cheap identity for React callers).
 * `stopTexts` = known project names/aliases from the caller (may be empty — frequency still works).
 * Small files (< minPages readable pages) skip the frequency demotion — there aren't enough pages
 * to call anything "ubiquitous" — but stop texts always apply. */
export function refineSheetTitles(pages = [], { stopTexts = [], minPages = 4, ubiquityFrac = 0.45 } = {}) {
  const readable = pages.filter((p) => p && p.hasText && (p.titleCandidates || []).length);
  const stops = (stopTexts || []).map(normT).filter((s) => s.length >= 4);
  const freq = candidateFrequency(pages);
  const n = readable.length;
  const ubiThreshold = n >= minPages ? Math.max(3, Math.ceil(ubiquityFrac * n)) : Infinity;
  const isUbiquitous = (k) => (freq.get(k) || 0) >= ubiThreshold;

  return pages.map((p) => {
    if (!p || !p.hasText) return p;
    const cands = p.titleCandidates || [];
    if (!cands.length) return p;
    // Stop texts are CERTAIN knowledge (the app's own project list) — a page whose every candidate
    // is a stop text gets the item fallback, never the project name as its title. The frequency
    // demotion below is a HEURISTIC, so it fails open: a ubiquitous candidate carrying a
    // drawing-type word is protected (tiled-run titles), and a page whose every surviving
    // candidate is ubiquitous keeps its best line rather than going blank.
    const pool = cands.filter((c) => !isStopText(c.text, stops));
    const unique = pool.filter((c) => !isUbiquitous(normT(c.text)) || DRAWING_TYPE_WORD.test(c.text));
    const best = (unique.length ? unique : pool)[0];
    const title = (best && best.text) || (p.item && p.item.toLowerCase() !== "document" ? p.item : "") || p.sheetTitle || "";
    if (title === p.sheetTitle) return p;
    return { ...p, sheetTitle: title, titleRefined: true };
  });
}
