/* Collision-resistant element-id minter (B591).
 *
 * The Site Planner minted every drawn element's id from ONE per-tab counter ("e1", "e2", …).
 * `ensureIdAbove` re-seeded that counter at load — but only from `parcels` + `els`, never
 * markups/measures/callouts/tombstones. So the invariant the whole tombstone system rests on
 * — "ids are never reused, so tombstoning by id is safe" — was FALSE in two ways:
 *   1. After reopening a plan, the counter could sit BELOW a markup id that had been deleted,
 *      so a freshly drawn polyline could be minted with an id already sitting in `deletedIds`.
 *   2. Two tabs of the same plan re-seeded the counter from the same restored ids and minted
 *      IDENTICAL ids for their first new draws.
 * Either way `mergeSiteContent`'s tombstone filter (cross-tab sync / take-over / boot pull)
 * then stripped the just-drawn item, vanishing it mid-session with no reload.
 *
 * The fix: a per-minter `salt` — a few random letters, distinct per page-load/tab — appended
 * to every id, so two tabs (or two sessions) can never mint the same id and a new id can never
 * equal a retained tombstone. The salt is LETTERS ONLY, so the numeric-sequence parse in
 * `seedAbove` (and any legacy `parseInt(replace(/\D/g,""))` reader) still recovers the
 * sequence number for ordering. Existing short ids ("e5") keep working untouched.
 *
 * Pure and injectable (explicit salt) so the uniqueness/seed contract is unit-tested.
 */

export function createIdMinter(salt = "") {
  let n = 1;
  const mint = () => `e${n++}${salt}`;
  // Advance the counter past every numeric id already in use — feed it EVERY id-bearing
  // collection plus the tombstone list, so the in-session sequence stays monotonic and a new
  // id never re-collides with a retained one within this tab.
  mint.seedAbove = (ids) => {
    (ids || []).forEach((id) => {
      const k = parseInt(String(id).replace(/\D/g, ""), 10);
      if (!isNaN(k) && k >= n) n = k + 1;
    });
    return mint;
  };
  mint.peek = () => n; // test seam: the next sequence number to be minted
  return mint;
}

// A per-page-load salt: random lowercase letters (digit-free, so a numeric id parse recovers
// only the sequence number). Separate JS contexts (separate tabs) evaluate this independently,
// so concurrent tabs of the same plan cannot mint the same id.
export function randomIdSalt(len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return s;
}
