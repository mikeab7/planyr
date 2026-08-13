/* Default team sharing for NEWLY CREATED projects (B326416 / B326418).
 *
 * WHAT THIS DECIDES: when a user creates a BRAND-NEW project, which team (if any) that project's
 * site plans are born shared with. That is the whole of it — this module is a pure function over
 * (preference, the teams you belong to). It never looks at, and can never affect, a project that
 * already exists.
 *
 * ⛔ SCOPE IS NEW PROJECTS ONLY, AND THAT IS ENFORCED IN THREE INDEPENDENT PLACES — this module is
 *    only the first and weakest of them. Nothing here may ever be called from a load, migrate,
 *    save or sync path; it is called at the two creation entry points and nowhere else.
 *      (1) HERE — the resolution runs once, at creation, and its answer is stamped on the new model.
 *      (2) THE CLIENT WRITE PATH — `cloudSync.siteRowFor` puts `team_id` in the row ONLY when
 *          `isNew` (B714). An ordinary content save carries no `team_id` at all.
 *      (3) THE DATABASE — `db/team_share_default.sql`'s `guard_team_share` trigger REFUSES any
 *          UPDATE that changes `sites.team_id` unless it arrives through the explicit
 *          `set_project_team` RPC. So an existing project cannot become shared by any ordinary
 *          write path — not a buggy client, not a stale in-memory model, not a cache replay, not a
 *          future refactor of this file. (1) and (2) are conveniences; (3) is the guarantee.
 *
 * WHY AMBIGUITY DENIES: every branch that cannot name ONE team returns null — a private project.
 * Sharing a plan someone believed was private is far worse than a plan that starts private and is
 * shared with one deliberate click, so the resolution is fail-closed at every fork. A user who
 * belongs to NO team resolves to null through the very first branch and is completely unaffected.
 *
 * LOUD-FAILURE: the answer is never a bare null. `reason` names WHICH branch produced it, so a
 * surface can say "new projects aren't being shared because you haven't picked a team yet" instead
 * of silently not sharing, and a test can assert the branch rather than just the outcome.
 */

/** The preference bag, stored account-level in `profiles.prefs` (see lib/userPrefs.js). */
export const DEFAULT_SHARE_PREF = { enabled: true, teamId: null };

/** Every reason `resolveNewProjectTeam` can return. Exported so callers/tests can't typo one. */
export const SHARE_REASONS = {
  NO_TEAMS: "no-teams",           // not on a team — solo users are untouched by this feature
  DISABLED: "disabled",           // the owner turned the default off
  ONE_TEAM: "one-team",           // exactly one team, so there is nothing to choose
  CHOSEN: "chosen",               // several teams, and this one was picked
  CHOSEN_GONE: "chosen-team-left", // the picked team is no longer one of yours → deny
  AMBIGUOUS: "ambiguous",         // several teams, none picked → deny, and say so
};

/** Coerce anything (a missing key, a legacy row, a hand-edited value) into the pref shape. */
export function normalizeSharePref(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    // Absent means DEFAULT-ON: that is the product decision (a team's plans are shared unless you
    // say otherwise). Only an explicit `false` turns it off, so a malformed value can't silently
    // disable a feature the owner believes is running.
    enabled: p.enabled === false ? false : true,
    teamId: typeof p.teamId === "string" && p.teamId ? p.teamId : null,
  };
}

/**
 * Which team a BRAND-NEW project is born shared with.
 *
 * @param {object}   opts
 * @param {object}   opts.pref  the account preference bag (any shape; normalized here)
 * @param {Array}    opts.teams the teams the user belongs to — `[{ id, name, ... }]`
 * @returns {{ teamId: string|null, reason: string, teamName: string|null }}
 */
export function resolveNewProjectTeam({ pref, teams } = {}) {
  const list = Array.isArray(teams) ? teams.filter((t) => t && typeof t.id === "string" && t.id) : [];
  const nameOf = (id) => { const t = list.find((x) => x.id === id); return t ? (t.name || null) : null; };
  const deny = (reason) => ({ teamId: null, reason, teamName: null });

  // Solo user — asked FIRST so that "I'm not on a team" can never fall through into any other
  // branch. Nothing about a solo user's experience changes, whatever the preference says.
  if (list.length === 0) return deny(SHARE_REASONS.NO_TEAMS);

  const p = normalizeSharePref(pref);
  if (!p.enabled) return deny(SHARE_REASONS.DISABLED);

  if (p.teamId) {
    // A picked team you have since left / been removed from is NOT a licence to fall back to
    // another team — that would share a project with people the owner never chose.
    if (!list.some((t) => t.id === p.teamId)) return deny(SHARE_REASONS.CHOSEN_GONE);
    return { teamId: p.teamId, reason: SHARE_REASONS.CHOSEN, teamName: nameOf(p.teamId) };
  }

  if (list.length === 1) return { teamId: list[0].id, reason: SHARE_REASONS.ONE_TEAM, teamName: list[0].name || null };

  // Several teams and no choice recorded. Picking one for the owner is a data-exposure decision
  // made by a coin flip, so it is refused; the Team panel surfaces this reason and asks.
  return deny(SHARE_REASONS.AMBIGUOUS);
}

/* ------------------------------------------------------- the runtime half (cached) --------- */
/* Creating a project is a click, so the answer has to be ready BEFORE it happens rather than
 * fetched during it. `primeShareContext` is called once when a user signs in; `defaultShareTeam`
 * is what the creation paths await, and after priming it resolves from cache without a round trip.
 *
 * It is a cache of the INPUTS, never of the decision: the resolution re-runs each time, so a
 * preference the owner has just changed takes effect on the very next project.
 *
 * FAIL-CLOSED ON EVERY ERROR. If the preference or the team list cannot be read, we do not know
 * whether this project should be shared — and "don't know" must never resolve to "share it". A
 * failed lookup returns null with a reason, which means the project is born private and can be
 * shared in one deliberate click.
 */
let ctx = null;      // { uid, pref, teams }
let inflight = null;

export function resetShareContext() { ctx = null; inflight = null; }

export async function primeShareContext(uid, { loadPrefs, listTeams } = {}) {
  if (!uid || !loadPrefs || !listTeams) { ctx = null; return null; }
  if (ctx && ctx.uid === uid) return ctx;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [prefRes, teams] = await Promise.all([loadPrefs(uid), listTeams()]);
      ctx = { uid, pref: (prefRes && prefRes.prefs && prefRes.prefs.newProjectSharing) || null, teams: teams || [] };
    } catch (_) {
      ctx = null;   // unknown → the resolver below denies
    } finally { inflight = null; }
    return ctx;
  })();
  return inflight;
}

/** The team a project created RIGHT NOW should be born shared with. Never throws. */
export async function defaultShareTeam(uid, loaders) {
  if (!uid) return { teamId: null, reason: SHARE_REASONS.NO_TEAMS, teamName: null };
  if (!ctx || ctx.uid !== uid) await primeShareContext(uid, loaders);
  if (!ctx || ctx.uid !== uid) return { teamId: null, reason: "context-unavailable", teamName: null };
  return resolveNewProjectTeam({ pref: ctx.pref, teams: ctx.teams });
}

/**
 * Which team a NEW PLAN inside an EXISTING project is born shared with: whatever the project
 * already is. A plan is not a project — it never consults the preference, so adding a plan to an
 * old private project can never share it, however the account default is set.
 *
 * Unanimity is required. A group whose plans disagree about their team is a state this app has no
 * way to produce, so meeting one means something is already wrong; the new plan is born PRIVATE
 * rather than guessing which answer was right. (Private is recoverable in one click. The reverse
 * is not.)
 *
 * @param {Array} plansOfGroup the project's existing plans — `[{ teamId }]`
 * @returns {{ teamId: string|null, reason: string }}
 */
export function resolveNewPlanTeam(plansOfGroup) {
  const plans = Array.isArray(plansOfGroup) ? plansOfGroup.filter(Boolean) : [];
  if (plans.length === 0) return { teamId: null, reason: "no-siblings" };
  const teamIds = new Set(plans.map((p) => p.teamId || null));
  if (teamIds.size > 1) return { teamId: null, reason: "group-disagrees" };
  const only = [...teamIds][0];
  return { teamId: only || null, reason: only ? "inherited" : "project-private" };
}
