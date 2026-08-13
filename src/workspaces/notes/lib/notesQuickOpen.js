/* notesQuickOpen — jump to any note by name, without hunting the rail (NEW-2).
 *
 * PURE. The whole of the ranking lives here as a function of `(entries, query)`, which is
 * what lets "typing `gp` finds Grand Port" be a test rather than a claim.
 *
 * ⛔ FUZZY MEANS SUBSEQUENCE, NOT SUBSTRING, and that is the entire reason this exists
 * beside the rail's search box. The rail already does substring — `pond` finds
 * "Detention pond". What it cannot do is `dpond` → "Detention pond", or `gpent` →
 * "Grand Port / Entitlements", which is how anybody actually types when they know where
 * they are going. Obsidian is the reference implementation and this is its scoring shape:
 * every query character must appear in order, and WHERE it appears decides the score.
 *
 * THE SCORE, and why each term is there:
 *   • a hit at a WORD START is worth far more than one mid-word, so `gp` prefers
 *     "Grand Port" over "Bridgepoint";
 *   • CONSECUTIVE hits compound, so an exact prefix beats a scatter of letters;
 *   • a hit in the page's own TITLE outranks one in its trail, so the thing you named wins
 *     over its ancestors;
 *   • shorter titles win ties, because "Ponds" is more likely what `pond` meant than
 *     "Pond maintenance and inspection schedule 2026".
 * A query character that is not found at all returns `null` — a non-match is a non-match,
 * never a zero-scored row padding out the list.
 *
 * ⛔ AND TITLE HITS ALWAYS COME BEFORE BODY HITS, never interleaved by score. The two are
 * different questions ("the note called X" / "the note that mentions X") and mixing them by
 * a number nobody can see makes the list feel arbitrary. The store's existing full-text
 * index supplies the second half, unchanged — this file does not re-implement it.
 */

const WORD_BREAK = /[\s/\-_·—–.,:;()[\]]/;

const isApple = () => {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
};

/** How the shortcut is SPELLED for this machine — the string the rail prints. */
export const QUICK_OPEN_KEY = isApple() ? "⌘K" : "Ctrl+K";

/** Is this keypress the quick-open chord? One definition, so the window listener and the
 *  label the rail shows can never describe different keys. It deliberately ignores the
 *  press when a modifier that would make it a DIFFERENT command is held. */
export function isQuickOpenChord(e) {
  if (!e || e.altKey || e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return String(e.key || "").toLowerCase() === "k";
}

/** Score one candidate against a query. Higher is better; `null` means no match at all. */
export function fuzzyScore(text, query) {
  const hay = String(text || "");
  const q = String(query || "").trim();
  if (!q) return 0;
  if (!hay) return null;

  const lowHay = hay.toLowerCase();
  const lowQ = q.toLowerCase();

  let score = 0;
  let at = 0;
  let run = 0;
  for (let i = 0; i < lowQ.length; i += 1) {
    const ch = lowQ[i];
    if (ch === " ") { run = 0; continue; }          // a typed space is a separator, not a letter
    const found = lowHay.indexOf(ch, at);
    if (found < 0) return null;

    const atStart = found === 0 || WORD_BREAK.test(hay[found - 1]);
    const consecutive = found === at && i > 0;
    run = consecutive ? run + 1 : 0;

    score += 1;
    if (atStart) score += 8;
    if (consecutive) score += 4 + run;              // a real prefix compounds hard
    // Every character skipped costs a little, so a tight match beats a sprawling one.
    score -= Math.min(6, found - at) * 0.5;

    at = found + 1;
  }
  // Shorter is more likely to be what was meant, but only as a tie-breaker.
  score += Math.max(0, 12 - hay.length) * 0.15;
  return score;
}

/** Rank pages by TITLE, falling back to the page's trail so `entitle` can find a subpage
 *  whose own name is short. Returns the best `limit` rows, best first.
 *
 *  `entries` is `[{ pageId, pageTitle, trail, projectId }]` — the shape `recentPages` in
 *  lib/notesModel.js already produces, deliberately, so there is no second index to keep. */
export function rankQuickOpen(entries, query, { limit = 12 } = {}) {
  const q = String(query || "").trim();
  const rows = [];
  for (const e of entries || []) {
    if (!e?.pageId) continue;
    if (!q) { rows.push({ ...e, score: 0, where: "title" }); continue; }

    const title = fuzzyScore(e.pageTitle || "", q);
    // The trail is worth less than the title on purpose: matching an ancestor's name is a
    // weaker answer to "which note did you mean?" than matching the note's own.
    const trail = fuzzyScore([...(e.trail || []), e.pageTitle || ""].join(" / "), q);
    const best = title != null ? title + 6 : trail;
    if (best == null) continue;
    rows.push({ ...e, score: best, where: "title" });
  }
  rows.sort((a, b) => (b.score - a.score) || String(a.pageTitle || "").length - String(b.pageTitle || "").length);
  return rows.slice(0, Math.max(0, limit));
}

/** Title hits, then body hits — the two halves, joined in the one order that reads
 *  sensibly. Body rows the title half already found are dropped, so nothing appears twice.
 *
 *  `bodyHits` comes straight from the store's existing full-text search (`searchNotes`),
 *  whose body half already carries the excerpt. Quick open does not re-index anything. */
export function quickOpenResults({ titleHits = [], bodyHits = [], limit = 18 } = {}) {
  const seen = new Set(titleHits.map((t) => t.pageId));
  const bodies = bodyHits
    .filter((b) => b && b.where === "body" && !seen.has(b.pageId))
    .map((b) => ({ ...b, where: "body" }));
  return [...titleHits, ...bodies].slice(0, Math.max(0, limit));
}

/** Arrow-key movement with wrap-around, shared with the slash menu's behaviour so the two
 *  palettes in this module cannot disagree about what ↑ on the first row does. */
export function stepIndex(index, delta, count) {
  if (!count) return 0;
  return ((index + delta) % count + count) % count;
}
