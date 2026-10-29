/* partySuggest — pure suggestion logic for the comp form's two party fields (NEW-8; provisional
 * label until the real B# is minted at push time, per /CLAUDE.md's LATE-BIND rule).
 *
 * The SOURCE of suggestions is independent from the map toolbar's PlaceSearchField (that one drives live, debounced, abortable
 * GEOCODING; this one suggests from data already held client-side — no fetch, no debounce, no abort). The LIST behaviour
 * (arrows, Enter, Escape, highlight, a11y) is the one shared hook, `shared/ui/useListboxNav.js`, used by both.
 *
 * NON-NEGOTIABLE (owner brief): suggestions only ever NARROW what to type, never FORCE or REWRITE
 * it. A brand-new name is always enterable with zero friction. Two spellings of the same company
 * ("Core5" / "Core 5" / "Core5 Industrial Partners") are never merged or auto-corrected here —
 * that judgment call belongs to the owner, not the code.
 */

/** Every distinct party name already used on the given comps — both sides (provider AND
 * acquirer), across every comp type, so a name typed as a lease's Owner/Developer surfaces as
 * the same suggestion on a building sale's Seller field. Exact strings only, first-seen order,
 * no case-folding and no de-duplication of near-spellings — only an exact repeat is dropped.
 * Caller passes the comps the VIEWER can already see (e.g. CompsPanel's own loaded `comps`
 * state, already RLS-scoped by fetchAllComps to the signed-in user's own + their team's rows) —
 * this function does no fetching or visibility filtering of its own. */
export function collectPartyNames(comps) {
  const seen = new Set();
  const names = [];
  for (const c of comps || []) {
    for (const raw of [c?.partyProvider, c?.partyAcquirer]) {
      const s = raw != null ? String(raw).trim() : "";
      if (s && !seen.has(s)) { seen.add(s); names.push(s); }
    }
  }
  return names;
}

/** Case- and whitespace-insensitive SUBSTRING match — loose on purpose, so "Core5", "Core 5" and
 * "Core5 Industrial Partners" all surface each other no matter which one someone starts typing.
 * An empty/blank query suggests nothing (there's nothing yet to narrow). Never throws, never
 * filters down to "no match" as an error — a genuinely new name just gets an empty list, which
 * is the caller's cue to let the typed text stand as-is. */
export function matchPartyNames(query, candidates, limit = 8) {
  const q = (query || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];
  const out = [];
  for (const c of candidates || []) {
    if (String(c).toLowerCase().replace(/\s+/g, " ").includes(q)) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}
