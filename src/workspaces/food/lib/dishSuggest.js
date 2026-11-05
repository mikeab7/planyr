/* dishSuggest — which dishes already saved at THIS place does a typed name mean? (B2268434, "saving dishes is clunky")
 *
 * Typing "pad thia" must offer "Pad Thai" so a re-rate lands on the dish he already has instead of minting a twin. Pure, no
 * Supabase import. Same tolerance as the restaurant search: prefix / word-prefix / contains first, then `fuzzyNameScore`
 * (searchProximity.js — one edit for short names, two for 7+ letters) for misspellings. Rows are `dishRowsForTable` rows. */
import { fuzzyNameScore } from "./searchProximity.js";

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function suggestDishes(query, rows, limit = 4) {
  const q = norm(query);
  if (q.length < 2) return [];
  const scored = [];
  for (const r of rows || []) {
    const n = norm(r.name);
    if (!n) continue;
    let sc = 0;
    if (n === q) sc = 4;
    else if (n.startsWith(q)) sc = 3;
    else if (n.split(" ").some((w) => w.startsWith(q))) sc = 2.5;
    else if (n.includes(q)) sc = 2;
    else sc = fuzzyNameScore(query, r.name);
    if (sc > 0) scored.push({ r, sc });
  }
  scored.sort((a, b) => b.sc - a.sc || a.r.name.localeCompare(b.r.name));
  return scored.slice(0, limit).map((x) => x.r);
}

/** The dish he means is already saved under exactly this name (case/space/punctuation-blind). */
export function sameDishName(a, b) { return !!norm(a) && norm(a) === norm(b); }
