/* B845088 (NEW-1) — the shared-with indicator's display rule: what a site row shows for who it's
 * shared with. Owner override, live review of the shipped panel (2026-08-30, PR #1226/#1228):
 * "don't show the people instead show the team. Or, like, if it's a team that it's shared with,
 * just show that... but if it's just shared with an individual, then sure list that." This
 * reverses the design call PR #1228 made — that the monogram's job was "who else can see this," a
 * per-PERSON fact even though the team is the unit of the grant. The owner has overruled that: the
 * unit of the grant is the unit to display.
 *
 * Confirmed by reading the schema, not assumed: `public.sites` carries exactly two sharing
 * columns, `team_id` and `share_locked` — no per-person grant table, column, or code path exists
 * anywhere in this workspace (lib/sharing.js's `shareProject`/`makeProjectPrivate` stamp/clear one
 * `team_id`, never a per-person list). So the "shared with an individual" case cannot occur today,
 * and is deliberately NOT built — see the `kind: "unknown"` case's doc below for where a future
 * `{kind:"person",...}` branch would slot in without touching the team case.
 *
 * This retires `lib/sharedWithMonogram.js` (B859504's original ship + its same-day amendment):
 * that module's whole job was "who else is on the roster besides me," which needed a per-team
 * roster fetch on every row. A team chip needs none of that — just the team's own name, which
 * MapFinder already has from `teams.listMyTeams()` for the share menu.
 *
 * myTeams: the viewer's own [{id, name}] list (teams.listMyTeams()'s shape).
 * Returns one of:
 *   { kind: "none" }        — s.teamId is falsy. No indicator (unchanged from before).
 *   { kind: "team", name }  — s.teamId resolves to a team the viewer is a member of.
 *   { kind: "unknown" }     — s.teamId is set but names no team on the viewer's own list (the team
 *                             was deleted, or the viewer left it since the site was shared). The
 *                             row is still shared, but this account can no longer say with whom —
 *                             the caller falls back to the plain share glyph, never a blank or a
 *                             guessed name.
 */
export function sharedWithDisplay(teamId, myTeams) {
  if (!teamId) return { kind: "none" };
  const t = (myTeams || []).find((x) => x && x.id === teamId);
  if (!t) return { kind: "unknown" };
  return { kind: "team", name: t.name || "Shared team" };
}
