/* Users (NEW-3): shaping, status chips, internal-account flagging, filtering and sorting for the
 * admin Users section. Pure. Reads admin_users_overview() / admin_user_activity() (SECURITY DEFINER,
 * is_admin()-gated — db/admin_users_overview.sql). COUNTS AND DATES ONLY, never content. */
import { callAdminRpc } from "./adminPanels.js";

export const fetchUsersOverview = (client) => callAdminRpc(client, "admin_users_overview");
export const fetchUserActivity = (client, userId) => callAdminRpc(client, "admin_user_activity", { p_user: userId });

const n = (v) => Number(v) || 0;
const DAY = 86_400_000;

/** Test / internal accounts. Rules are STRUCTURAL (no personal address ships in the bundle): the test
 * domain, Planyr's own domain, an e2e/test local part, the signed-in admin's own account, and any
 * address the admin marked internal by hand (`marked`, a set of lower-cased emails). */
export function isInternalEmail(email, { selfEmail = null, marked = null } = {}) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  if (selfEmail && e === String(selfEmail).trim().toLowerCase()) return true;
  if (marked && marked.has(e)) return true;
  const [local, domain = ""] = e.split("@");
  return domain === "planyr.test" || domain === "planyr.io" || /^(e2e|test|qa)([._+-]|$)/.test(local);
}

export function shapeUsers(raw, opts = {}) {
  return (Array.isArray(raw) ? raw : []).map((r) => {
    const u = {
      id: r.id, email: r.email || "", name: r.name || "", org: r.org || "",
      team: r.team || "", teamRole: r.team_role || "",
      createdAt: r.created_at || null, lastSignIn: r.last_sign_in_at || null, lastActivity: r.last_activity || null,
      confirmed: !!r.email_confirmed_at, provider: r.provider || "email",
      projects: n(r.projects), plans: n(r.plans), files: n(r.files), reviews: n(r.reviews), schedules: n(r.schedules),
    };
    u.internal = isInternalEmail(u.email, opts);
    u.status = userStatus(u, opts.now);
    return u;
  });
}

export const STATUSES = [
  { id: "active", label: "Active", hint: "Activity in the last 7 days" },
  { id: "quiet", label: "Quiet", hint: "Last activity 8–30 days ago" },
  { id: "dormant", label: "Dormant", hint: "Last activity over 30 days ago" },
  { id: "never", label: "Never used", hint: "Signed up, created nothing" },
];

/** Active ≤7 whole days since last activity · Quiet 8–30 · Dormant >30 · Never used = nothing created. */
export function userStatus(u, now = Date.now()) {
  const made = n(u.projects) + n(u.plans) + n(u.files) + n(u.reviews) + n(u.schedules);
  const at = u.lastActivity || (made > 0 ? u.lastSignIn : null);
  if (!at && made === 0) return "never";
  if (!at) return "never";
  const days = Math.floor((now - new Date(at).getTime()) / DAY);
  return days <= 7 ? "active" : days <= 30 ? "quiet" : "dormant";
}

const latest = (...xs) => xs.filter(Boolean).reduce((a, b) => (!a || new Date(b) > new Date(a) ? b : a), null);

export function statusCounts(users) {
  const c = { active: 0, quiet: 0, dormant: 0, never: 0 };
  for (const u of users) c[u.status] += 1;
  return c;
}

export function filterUsers(users, { hideInternal = true, status = null, query = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return users.filter((u) => {
    if (hideInternal && u.internal) return false;
    if (status && u.status !== status) return false;
    return !q || `${u.name} ${u.email} ${u.org}`.toLowerCase().includes(q);
  });
}

export const USER_SORTS = {
  name: (u) => (u.name || u.email).toLowerCase(), email: (u) => u.email.toLowerCase(), org: (u) => `${u.org} ${u.team}`.toLowerCase(),
  createdAt: (u) => new Date(u.createdAt || 0).getTime(), lastSignIn: (u) => new Date(u.lastSignIn || 0).getTime(),
  lastActivity: (u) => new Date(u.lastActivity || 0).getTime(),
  projects: (u) => u.projects, plans: (u) => u.plans, files: (u) => u.files, reviews: (u) => u.reviews, schedules: (u) => u.schedules,
  status: (u) => STATUSES.findIndex((s) => s.id === u.status),
};
/** Default: last activity, newest first (never-used accounts fall to the bottom, newest sign-up first). */
export function sortUsers(users, key = "lastActivity", dir = "desc") {
  const get = USER_SORTS[key] || USER_SORTS.lastActivity;
  const sign = dir === "asc" ? 1 : -1;
  return [...users].sort((a, b) => {
    const x = get(a), y = get(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c ? sign * c : USER_SORTS.createdAt(b) - USER_SORTS.createdAt(a);
  });
}

/** Overview headline numbers over the (internal-filtered) accounts. Active = signed in OR edited. */
export function overviewStats(users, now = Date.now()) {
  const within = (iso, days) => !!iso && now - new Date(iso).getTime() < days * DAY;
  const seen = (u) => latest(u.lastSignIn, u.lastActivity);
  return {
    accounts: users.length,
    active7: users.filter((u) => within(seen(u), 7)).length,
    active30: users.filter((u) => within(seen(u), 30)).length,
    newSignups7: users.filter((u) => within(u.createdAt, 7)).length,
  };
}
export const newestSignups = (users, k = 5) => [...users].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, k);

export const teamLabel = (u) => [u.org, u.team && (u.teamRole ? `${u.team} (${u.teamRole})` : u.team)].filter(Boolean).join(" · ");

export function shapeUserActivity(raw) {
  const arr = (k) => (raw && Array.isArray(raw[k]) ? raw[k].filter(Boolean) : []);
  return [
    { key: "plans", label: "Plans edited", dates: arr("plans") },
    { key: "reviews", label: "Reviews edited", dates: arr("reviews") },
    { key: "schedules", label: "Schedules edited", dates: arr("schedules") },
    { key: "files", label: "Files updated", dates: arr("files") },
  ];
}
