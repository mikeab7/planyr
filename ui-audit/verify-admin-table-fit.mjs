/* verify-admin-table-fit (follow-up to B2136274, owner report 2026-10-06 on build bc99218) — at LAPTOP widths
 * (1280 and up) no admin table may scroll sideways inside its card, and on Users the STATUS chip — the column that
 * answers "who is using it" — must be inside the viewport without scrolling. Drives the real client against a dev
 * server with the test account's real session and MOCKED admin RPC answers (the e2e account is never allowlisted).
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm run dev -- --port 5199 &
 *   E2E_LOGIN_KEY=… node ui-audit/verify-admin-table-fit.mjs http://localhost:5199 https://planyr.io
 * Known-good arm (proves the instrument can see overflow): at a TABLET-and-below width the Users table is ALLOWED
 * to scroll sideways, and must report scrollWidth > clientWidth there — a run that never sees overflow anywhere
 * is VOID, not green. The data is deliberately realistic-wide (long names, e-mails, company/team labels, all four
 * statuses, large counts): short fixtures hide exactly this defect. */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "http://localhost:5199";
const deploy = process.argv[3] || "https://planyr.io";
const key = process.env.E2E_LOGIN_KEY;
if (!key) throw new Error("E2E_LOGIN_KEY not set");

const now = Date.now(); const iso = (d) => new Date(now - d * 86400000).toISOString();
const mk = (i, o) => ({ id: "u" + i, email: `user${i}@example.com`, name: null, org: null, team: null, team_role: null, created_at: iso(30 + i), last_sign_in_at: iso(i), email_confirmed_at: iso(30), provider: "email", projects: 3, plans: 12, files: 40, reviews: 7, schedules: 4, last_activity: iso(i), ...o });
const USERS = [
  mk(1, { name: "Alexandria Montgomery-Fitzgerald", email: "alexandria.montgomery-fitzgerald@industrialrealtypartners.com", org: "Industrial Realty Partners of North Texas", team: "Acquisitions & Development", team_role: "admin", projects: 128, plans: 412, files: 2210, reviews: 96, schedules: 41 }),
  mk(2, { name: "Bob Q. Customer", email: "bob@acme.com", org: "Acme", last_activity: iso(20), last_sign_in_at: iso(20) }),
  mk(3, { email: "e2e@planyr.test" }),
  mk(4, { name: "Newbie", email: "new@acme.com", projects: 0, plans: 0, files: 0, reviews: 0, schedules: 0, last_activity: null }),
  mk(5, { name: "Old Timer", email: "old@acme.com", last_activity: iso(100), last_sign_in_at: iso(100) }),
  ...Array.from({ length: 6 }, (_, i) => mk(10 + i, { name: `Customer Number ${i}`, email: `customer.number.${i}@somelongcompanyname.example.org`, org: "Somewhat Long Company Name LLC", team: "Operations", team_role: "member" })),
];
const CRIT = [{ county_key: "tx_harris", county_label: "Harris County", state: "TX", family: "detention", request_count: 14, first_asked: iso(40), last_asked: iso(1) }, { county_key: "co_denver", county_label: "Denver County (consolidated city and county)", state: "CO", family: "floodplain", request_count: 3, first_asked: iso(9), last_asked: iso(2) }];
const SLOW = Array.from({ length: 11 }, (_, i) => ({ id: "s" + i, at: iso(12 + i), user_id: "u1", user_email: "alexandria.montgomery-fitzgerald@industrialrealtypartners.com", category: "slow", description: "", context: {}, build: "abc", route: "site-planner", status: "open", closed_at: null }));
const answers = {
  admin_error_groups: () => [{ kind: "error", source: "react", module: "site-planner", message: "Cannot read properties of undefined (reading 'x') in a very long message that goes on and on and on", occurrences: 12, accounts: 3, first_seen: iso(0.5), last_seen: iso(0.1), last_build: "abc1234", builds: 2 }],
  admin_error_group_rows: () => [], admin_list_problem_reports: () => [], admin_recent_errors_for_user: () => [],
  admin_list_support_reports: () => [{ id: "t1", at: iso(2), user_id: "u1", user_email: "alexandria.montgomery-fitzgerald@industrialrealtypartners.com", category: "problem", description: "The grid froze when I dragged a very long task bar across several months of the schedule", context: {}, build: "abc", route: "schedule", status: "open", closed_at: null }, ...SLOW],
  admin_users_overview: () => USERS,
  admin_user_activity: () => ({ plans: [iso(2)], reviews: [], schedules: [], files: [] }),
  admin_usage_overview: () => ({ generated_at: iso(0), totals: { accounts: 10, active_7d: 1, active_30d: 4, projects: 69, plans: 103, reviews: 48, files: 64, schedules: 10, teams: 1, team_members: 4, pending_invites: 1 }, weekly: Array.from({ length: 12 }, (_, i) => ({ week: new Date(now - (11 - i) * 7 * 86400000).toISOString().slice(0, 10), signups: i % 3, plans_created: 2 + (i % 5), plans_edited: 5 + i })), accounts: [] }),
  admin_get_ops: () => ({ snapshots: {}, sweeps: [] }),
  admin_list_criteria_requests: () => CRIT, admin_list_signup_attempts: () => [{ at: iso(1), email_domain: "somelongcompanyname.example.org", outcome: "created" }],
  admin_list_password_resets: () => [{ at: iso(3), admin_email: "owner@example.com", target_email: "customer.number.1@somelongcompanyname.example.org" }],
  admin_list_users: () => USERS.map((u) => ({ id: u.id, email: u.email, first_name: u.name, last_name: null, org: u.org, created_at: u.created_at })),
};

const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); };

const tokens = await (async () => {
  const res = await fetch(deploy + "/api/auth/e2e-session", { method: "POST", headers: { "x-e2e-login-key": key } });
  if (res.status !== 200) throw new Error("e2e-session " + res.status);
  const b = await res.json();
  return { access_token: b.access_token, refresh_token: b.refresh_token };
})();

async function open(width, hash) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name === "is_admin") return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    if (name in answers) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answers[name]()) });
    return route.continue();
  });
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 });
  const err = await page.evaluate(async (t) => (await window.pfSupabase.auth.setSession(t)).error?.message || null, tokens);
  if (err) throw new Error("setSession: " + err);
  await page.waitForTimeout(3000);
  await page.goto(base + "/" + hash, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 });
  await page.waitForSelector('[data-testid="admin-app"]', { timeout: 20000 });
  await page.waitForTimeout(1800);
  await assertMeasurable(page, "verify-admin-table-fit");
  return { ctx, page };
}

/** Every table's scroll container on the page: { scrollWidth, clientWidth }. */
const tableBoxes = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="admin-main"] table')].map((t) => {
  const c = t.parentElement;
  return { cols: t.querySelectorAll("th").length, first: (t.querySelector("th")?.textContent || "").trim(), sw: c.scrollWidth, cw: c.clientWidth };
}));
const statusInView = (page) => page.evaluate(() => {
  const chip = [...document.querySelectorAll('[data-testid="user-row"]')].map((r) => [...r.querySelectorAll("td")].find((td) => /^(Active|Quiet|Dormant|Never used)$/.test(td.textContent.trim())));
  if (!chip.length || chip.some((x) => !x)) return { ok: false, why: "no status cell found" };
  const box = chip[0].closest("table").parentElement.getBoundingClientRect();
  const bad = chip.filter((td) => { const r = td.getBoundingClientRect(); return r.right > box.right + 0.5 || r.right > innerWidth + 0.5 || r.left < box.left - 0.5; });
  return { ok: bad.length === 0, why: `${bad.length}/${chip.length} status cells outside the visible card/viewport` };
});

const SECTIONS = ["overview", "users", "issues", "support", "usage", "criteria", "password-reset", "ops"];
const HAS_TABLE = new Set(["overview", "users", "issues", "support", "criteria", "password-reset"]); // usage + ops (empty digest) draw none
let sawOverflowAnywhere = false;
try {
  for (const width of [1280, 1440, 1600]) {
    for (const id of SECTIONS) {
      const { ctx, page } = await open(width, `#/admin/${id}`);
      if (id === "password-reset") { await page.getByText(/Reset history/).first().click().catch(() => {}); await page.waitForTimeout(300); }
      if (id === "users") await page.locator("details summary").first().click().catch(() => {});
      if (id === "support") await page.getByText("Expand").first().click().catch(() => {});
      await page.waitForTimeout(400);
      const boxes = await tableBoxes(page);
      const over = boxes.filter((b) => b.sw > b.cw + 1);
      check(`${width} ${id}: no table scrolls sideways (${boxes.length} table${boxes.length === 1 ? "" : "s"})`, (!HAS_TABLE.has(id) || boxes.length > 0) && over.length === 0, over.map((b) => `"${b.first}…" ${b.cols} cols: scrollWidth ${b.sw} > clientWidth ${b.cw}`).join("; "));
      if (id === "users") {
        const u = boxes.find((b) => b.first === "Account" || b.first === "Name");
        check(`${width} users: the Users table's scrollWidth equals its clientWidth`, !!u && u.sw <= u.cw + 1, u ? `${u.sw} vs ${u.cw}` : "table not found");
        const s = await statusInView(page);
        check(`${width} users: the status chip is inside the viewport without scrolling`, s.ok, s.why);
        if (width === 1280) await page.screenshot({ path: (process.env.SHOT || "/tmp/admin-users-1280.png").replace(".png", "-closed.png") });
        // with a row open (detail panel) the table must STILL not scroll sideways
        await page.locator('[data-testid="user-row"]').first().click(); await page.waitForTimeout(700);
        const after = (await tableBoxes(page)).filter((b) => b.sw > b.cw + 1);
        check(`${width} users + detail panel open: no table scrolls sideways`, after.length === 0, after.map((b) => `"${b.first}…" ${b.sw} > ${b.cw}`).join("; "));
        check(`${width} users + detail panel open: status chip still visible`, (await statusInView(page)).ok);
        if (width === 1280) await page.screenshot({ path: process.env.SHOT || "/tmp/admin-users-1280.png" });
      }
      await ctx.close();
    }
  }
  // KNOWN-GOOD ARM — below tablet width the table may scroll; the instrument must SEE that overflow.
  { const { ctx, page } = await open(640, "#/admin/users");
    const boxes = await tableBoxes(page);
    sawOverflowAnywhere = boxes.some((b) => b.sw > b.cw + 1);
    check("KNOWN-GOOD: at 640 wide the Users table is allowed to scroll, and the instrument sees it", sawOverflowAnywhere, boxes.map((b) => `${b.sw}/${b.cw}`).join(" "));
    await ctx.close(); }
} finally { await browser.close(); }
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
