/* Scheduler connector config (server-side only).
 *
 * The MCP connector (functions/api/mcp/*) lets the Claude you already pay for read your
 * live Scheduler and drop *pending* suggestions into it — which you then Approve/Dismiss in
 * the Scheduler's existing Review panel. It talks to the SCHEDULER's Supabase project, which
 * is a DIFFERENT project from the main app (ref ksetjztkplttbcehyicv — see
 * public/sequence/index.html:10310). Its anon key is already public in that page, so reading
 * it from server env here leaks nothing new; RLS allows insert/select and blocks anon DELETE.
 *
 * Like server/filing/config.js: reads ONLY from process.env / the CF Pages env object, never
 * a VITE_ var, and degrades gracefully (null) when unset rather than throwing.
 */
export function schedulerConfig(env = {}) {
  return {
    supabase: {
      url: env.SCHEDULER_SUPABASE_URL || null,
      anonKey: env.SCHEDULER_SUPABASE_ANON_KEY || null,
    },
    // The single key for the schedule blob the Scheduler reads/writes (public/sequence/index.html "hs-v1").
    scheduleKey: env.SCHEDULER_KEY || "hs-v1",
    // Shared-secret bearer gate for the connector. When set, the MCP endpoint requires
    // Authorization: Bearer <token>. Absent → the endpoint is closed (503) rather than open.
    // (claude.ai's native custom-connector OAuth is the production hardening — see README;
    // this token is what Claude Desktop via `mcp-remote --header` uses to test end-to-end.)
    connectorToken: env.SCHEDULER_CONNECTOR_TOKEN || null,
    serverName: env.SCHEDULER_MCP_NAME || "planyr-scheduler",
  };
}

export function schedulerConfigured(cfg) {
  return !!(cfg && cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey);
}
