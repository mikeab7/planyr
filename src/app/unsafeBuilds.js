/* unsafeBuilds — the append-only registry of build ids known to carry a defect serious enough
 * that a stale tab running one should be told more insistently than the ordinary "a newer
 * version is available" courtesy notice (B1517889).
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM ORDINARY BUILD SKEW: buildSkew.js's own notice is
 * deliberately non-blocking and dismissible — right for the common case (a cosmetic fix, a new
 * feature), wrong for a build whose known defect is destructive on a timer. B1517888 is exactly
 * that shape: a stale tab predating that fix ran an unguarded 30-day auto-purge that could
 * permanently destroy a live project's plan. This registry is the deploy-time declaration that
 * feeds the escalation — `vite.config.js`'s `buildStamp()` embeds every entry's `build` id into
 * `/version.json` as `supersedes_unsafe`, and `buildSkew.js`'s `isLoadedBuildUnsafe` checks the
 * CURRENT tab's own loaded build against whatever the SERVER currently declares.
 *
 * ⛔ LEAVE THIS EMPTY UNLESS A SPECIFIC PAST BUILD IS KNOWN-UNSAFE FOR A STATED REASON. The
 * mechanism this file feeds is defence in depth, never the primary fix — the primary fix for a
 * destructive defect belongs in the code (or, as with B1517888, the database) so the danger is
 * closed for EVERY build, past and future, not just the ones a session remembered to list here.
 * B1517888 itself is not listed below: its server-side trigger makes the dangerous path
 * impossible regardless of which build issued the delete, so escalating every pre-fix build here
 * would nag users to reload for a risk that no longer exists once the trigger is live. Add an
 * entry only when staying on an old build carries a REAL, STILL-LIVE cost that nothing server-side
 * can close — e.g. a client-only correctness bug with no database-side mitigation.
 *
 * Each entry: { build, reason, date }. `build` must match `git rev-parse --short HEAD` for the
 * commit in question — check `git log --oneline` for the exact short SHA before adding one.
 */
export const UNSAFE_BUILDS = [
  // { build: "abc1234", reason: "one-line description of what was dangerous about it", date: "2026-09-11" },
];
