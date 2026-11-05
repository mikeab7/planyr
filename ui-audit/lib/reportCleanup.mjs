/* reportCleanup — an automated check that files a problem report or a "something was slow" tap MUST remove it
 * at the end of its own run (B2159505). Reports piled up in the admin Support queue (the owner's "17 open, none
 * real" — three 'test — please ignore (zz-sweep-V464176)' reports, an e2e slow tap, …) because the table has no
 * client DELETE policy and nothing ever cleaned up. Two tools, pick by harness kind:
 *
 *  • LIVE harness (signed in / against a real backend, the report really lands): call
 *      await cleanupReports(page)   // before page/context closes; THROWS unless the rows are proven gone
 *    It reads this browser's own report session id and calls public.delete_my_session_reports(), which removes only
 *    that session's recent anonymous-or-own rows and returns { deleted, remaining } — remaining must be 0.
 *  • LOCAL harness (a built app that may carry real Supabase credentials): call
 *      await swallowReportWrites(ctx)   // report inserts are answered 201 locally and never leave the machine
 *
 * Mark live test text with REPORT_TEST_MARKER so a leftover is recognisable (the admin Support "Hide internal"
 * switch hides signed-out reports that carry it). `missingReportCleanup(source)` is the pure rule test/reportCleanupGuard
 * applies to every ui-audit harness. */
export const REPORT_TEST_MARKER = "test — please ignore (zz-sweep)";
const SESSION_KEY = "planyr:reports:sessionId:v1";

export async function cleanupReports(page) {
  const r = await page.evaluate(async (key) => {
    const sid = localStorage.getItem(key);
    if (!sid) return { skipped: true };           // nothing was ever filed from this browser
    const c = window.pfSupabase;
    if (!c) return { error: "pfSupabase not available — cannot clean up" };
    const { data, error } = await c.rpc("delete_my_session_reports", { p_session_id: sid });
    return error ? { error: error.message } : data;
  }, SESSION_KEY);
  if (r.error) throw new Error("reportCleanup: " + r.error);
  if (r.skipped) return { deleted: 0, remaining: 0 };
  if (r.remaining !== 0) throw new Error(`reportCleanup: ${r.remaining} report(s) still present after cleanup`);
  return r;
}

export async function swallowReportWrites(ctx) {
  await ctx.route("**/rest/v1/problem_reports*", (route) => route.fulfill({ status: 201, contentType: "application/json", body: "" }));
}

/** Does this harness source file a real report without cleaning up? Returns a reason string, or null when fine. */
export function missingReportCleanup(source) {
  const files = /help-report-fab|Something was slow|Report a problem|submitReport|problem_reports/.test(source);
  const sends = /(?:getByText|locator|text=)[^\n]*(?:Something was slow|Send\b)|\.click\(\)[^\n]*(?:slow|Send)|from\("problem_reports"\)\s*\.insert|rpc\("submit/.test(source) || /Something was slow just now/.test(source);
  if (!files || !sends) return null;
  const live = /openSignedIn|https:\/\/planyr\.io|pfSupabase/.test(source);
  const safe = /cleanupReports\(|swallowReportWrites\(/.test(source);
  return live && !safe ? "files a problem report / slow tap against a live backend but never calls cleanupReports()" : null;
}
