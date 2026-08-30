/* B859504 (amendment, NEW-1) — the shared-with monogram's viewer-exclusion rule, pulled
 * out of MapFinder.jsx's siteRow so it can be asserted directly instead of only through a
 * source-text check. Pure: given a team's roster and the viewer's own id, decide what a row's
 * shared-with monogram should show.
 *
 * THE BUG THIS FIXES: `listMembers()` (lib/teams.js) returns a team's WHOLE roster, viewer
 * included — there is no "everyone but me" query. `siteRow` rendered `members[0]`'s initials
 * unconditionally, and on production (measured live, all 28 of the owner's sites) that was almost
 * always the VIEWER's own initials — he is the creator/admin of every team he shares to, and the
 * roster the RPC returns puts him first. Every shared row therefore read "MB +2": his own initials,
 * with the two people he'd actually want to know about collapsed behind a "+2". Excluding the
 * viewer from the candidate list is the fix — not a switch to a team-level marker. Sharing here IS
 * to a team (a site's context menu reads "Shared with <team>" / "Unshare", never a per-person
 * grant), but the monogram's job is still "who else can see this", which is a per-PERSON fact even
 * though the team is the unit of the grant — the same "avatar stack minus you" pattern collaborative
 * tools already use, not a wrong primitive.
 */

// members: [{userId, firstName, lastName, displayName, email}] | null. `listMembers` returns null
// only via the caller's own "not fetched yet" default — an already-resolved fetch always returns at
// least the roster's own creator, so an empty *array* here means the fetch failed or was refused
// (e.g. RLS on a team the viewer no longer belongs to), never "a team with nobody in it".
// myUid: the viewer's own id, or null when signed out (nothing to exclude).
//
// Returns one of:
//   { kind: "unknown" }                          — roster unresolved/unavailable; caller falls back
//                                                   to the plain share glyph (still "shared", just
//                                                   without a roster to name).
//   { kind: "none" }                              — nobody shares this but the viewer; caller renders
//                                                   no indicator at all.
//   { kind: "monogram", first, extra, others }    — `first` teammate (excluding the viewer) to show
//                                                   initials for, `extra` = how many more beyond that
//                                                   one, `others` = the full excluding-viewer list
//                                                   (for the hover tooltip).
export function sharedWithDisplay(members, myUid) {
  if (!members || !members.length) return { kind: "unknown" };
  const others = members.filter((m) => !myUid || m.userId !== myUid);
  if (!others.length) return { kind: "none" };
  return { kind: "monogram", first: others[0], extra: others.length - 1, others };
}
