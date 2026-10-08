/* Admin panels — RPC wrappers + row shaping for Usage / Issues / Support / Ops
 * (B711905–B711908). Pure: every function takes the Supabase client or the raw RPC result, so
 * the whole read path is unit-tested against mocked responses. Every wrapper returns
 * `{ data, error }` where `error` is a readable string or null — a failure is never swallowed
 * (LOUD-FAILURE); the section components render it. Every RPC named here checks is_admin()
 * server-side (src/workspaces/admin/db/admin_panels.sql); nothing here is a security boundary. */

export async function callAdminRpc(client, name, args) {
  if (!client) return { data: null, error: "Not connected." };
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) return { data: null, error: error.message || String(error) };
    return { data: data ?? null, error: null };
  } catch (err) {
    return { data: null, error: (err && err.message) || String(err) };
  }
}

/* ── Issues ─────────────────────────────────────────────────────────────────────────────────── */
export const ISSUE_KINDS = [
  { id: "error", label: "Errors" },
  { id: "event", label: "Diagnostic events" },
  { id: "timing", label: "Timing" },
];
export const ISSUE_WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export const fetchErrorGroups = (client, kind = "error", days = 30) =>
  callAdminRpc(client, "admin_error_groups", { p_kind: kind, p_days: days });
export const fetchErrorGroupRows = (client, g, limit = 25) =>
  callAdminRpc(client, "admin_error_group_rows", {
    p_kind: g.kind, p_source: g.source ?? null, p_message: g.message ?? "", p_limit: limit,
  });

/* Newest-seen first; numbers coerced (bigint arrives as number or string); a blank message is
 * labelled rather than shown as an empty cell. */
export function shapeErrorGroups(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      kind: r.kind, source: r.source ?? null, module: r.module || null,
      message: r.message && r.message.trim() ? r.message : "(no message)",
      rawMessage: r.message ?? "",
      occurrences: Number(r.occurrences) || 0, accounts: Number(r.accounts) || 0,
      firstSeen: r.first_seen || null, lastSeen: r.last_seen || null,
      lastBuild: r.last_build || null, builds: Number(r.builds) || 0,
    }))
    .sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0));
}
/** The key the row-fetch RPC groups by — the original (un-labelled) message. */
export const groupRowArgs = (g) => ({ kind: g.kind, source: g.source, message: g.rawMessage });

/* ── Support ────────────────────────────────────────────────────────────────────────────────── */
export const fetchSupportReports = (client) => callAdminRpc(client, "admin_list_support_reports");
export const setReportStatus = (client, id, status) =>
  callAdminRpc(client, "admin_set_report_status", { p_id: id, p_status: status });
export const fetchRecentErrorsForUser = (client, userId, limit = 15) =>
  callAdminRpc(client, "admin_recent_errors_for_user", { p_user: userId, p_limit: limit });

/* Open first (oldest open first — the longest-waiting is the most urgent), then closed newest first. */
export function shapeTickets(rows) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id, at: r.at, userId: r.user_id || null, email: r.user_email || null,
    category: r.category, description: r.description || "", context: r.context || null,
    build: r.build || null, route: r.route || null,
    status: r.status === "closed" ? "closed" : "open", closedAt: r.closed_at || null,
  }));
  const open = list.filter((t) => t.status === "open").sort((a, b) => new Date(a.at) - new Date(b.at));
  const closed = list.filter((t) => t.status === "closed").sort((a, b) => new Date(b.at) - new Date(a.at));
  return { open, closed };
}
export const ticketFrom = (t) => t.email || (t.userId ? "signed-in account" : "signed out");

/* ── Usage ──────────────────────────────────────────────────────────────────────────────────── */
export const fetchUsage = (client) => callAdminRpc(client, "admin_usage_overview");

const n = (v) => Number(v) || 0;
export function shapeUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const t = raw.totals || {};
  const weekly = (Array.isArray(raw.weekly) ? raw.weekly : []).map((w) => ({
    week: w.week, signups: n(w.signups), plansCreated: n(w.plans_created), plansEdited: n(w.plans_edited),
  }));
  const peak = Math.max(1, ...weekly.map((w) => Math.max(w.signups, w.plansCreated, w.plansEdited)));
  return {
    generatedAt: raw.generated_at || null,
    totals: {
      accounts: n(t.accounts), active7: n(t.active_7d), active30: n(t.active_30d),
      projects: n(t.projects), plans: n(t.plans), reviews: n(t.reviews), files: n(t.files),
      schedules: n(t.schedules), teams: n(t.teams), members: n(t.team_members), pendingInvites: n(t.pending_invites),
    },
    weekly, peak,
    accounts: (Array.isArray(raw.accounts) ? raw.accounts : []).map((a) => ({
      id: a.id, email: a.email || "(no email)", createdAt: a.created_at || null,
      lastSignIn: a.last_sign_in_at || null, lastPlanEdit: a.last_plan_edit || null,
      projects: n(a.projects), plans: n(a.plans), files: n(a.files),
    })),
  };
}
/** What this page cannot answer — recorded on B711905 and shown on the page so the gap is visible. */
export const USAGE_CANNOT_ANSWER =
  "Not answerable from this data: which features get used, and where people drop off inside a session. That needs event tracking, which is deliberately not built.";

/* ── Ops ────────────────────────────────────────────────────────────────────────────────────── */
export const fetchOps = (client) => callAdminRpc(client, "admin_get_ops");
export const recordSessionSweep = (client, { archived, stillOpen, note }) =>
  callAdminRpc(client, "admin_record_session_sweep", {
    p_archived: archived, p_still_open: stillOpen, p_note: note || null,
  });

const digest = (d) => ({
  count: n(d && d.count),
  recent: Array.isArray(d && d.recent) ? d.recent.map((x) => ({ id: String(x.id), title: String(x.title || "") })) : [],
});
export function shapeOps(raw) {
  const snaps = (raw && raw.snapshots) || {};
  const backlog = snaps.backlog || null;
  const verification = snaps.verification || null;
  return {
    backlog: backlog && {
      updatedAt: backlog.updated_at || null,
      commit: (backlog.payload && backlog.payload.commit) || null,
      open: { ...digest(backlog.payload && backlog.payload.open), topTags: (backlog.payload && backlog.payload.open && backlog.payload.open.topTags) || [] },
      verify: digest(backlog.payload && backlog.payload.verify),
    },
    verification: verification && {
      updatedAt: verification.updated_at || null,
      commit: (verification.payload && verification.payload.commit) || null,
      pending: digest(verification.payload && verification.payload.pending),
    },
    sweeps: (Array.isArray(raw && raw.sweeps) ? raw.sweeps : []).map((s) => ({
      id: s.id, at: s.at, archived: n(s.archived), note: s.note || "",
      stillOpen: (Array.isArray(s.still_open) ? s.still_open : []).map((o) => ({ title: String(o.title || ""), waitingOn: String(o.waiting_on || "") })),
    })),
  };
}
/** "Updated <relative> after <short commit>" for the Outstanding-work header (B2159504). `commit` is null for a digest
 * loaded by hand (no merge recorded). `stale` = older than 3 days, i.e. the post-merge refresh has stopped. */
export const DIGEST_STALE_MS = 3 * 86_400_000;
export function digestStamp(ops, now = Date.now()) {
  const d = ops && (ops.backlog || ops.verification);
  if (!d) return null;
  const at = d.updatedAt;
  return {
    at, ago: ago(at, now), commit: d.commit ? String(d.commit).slice(0, 7) : null,
    stale: !at || now - new Date(at).getTime() > DIGEST_STALE_MS,
  };
}
/** Parse the "still open" textarea: one session per line, "title — waiting on …" (dash optional). */
export function parseStillOpen(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)\s+[—–-]\s+(.*)$/.exec(l);
    return m ? { title: m[1].trim(), waiting_on: m[2].trim() } : { title: l, waiting_on: "" };
  });
}

/* ── Shared formatting ──────────────────────────────────────────────────────────────────────── */
export function ago(iso, now = Date.now()) {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.floor(h / 24)} days ago`;
}
