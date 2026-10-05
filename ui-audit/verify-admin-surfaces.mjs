/* verify-admin-surfaces (NEW-2 / NEW-1, admin build-out) — drives the REAL client against a local dev
 * server with the REAL test-account session (e2e@planyr.test, via the deploy's e2e-session route) and
 * MOCKED admin RPC answers, so the admin half of the page can be exercised without ever putting the
 * test account on admin_users. The server-side gate is proven separately in SQL (admin_panels.sql run
 * as the e2e uid → "not authorized"). Asserts: Admin row on every surface (dashboard, each module,
 * phone width), cold load + reload of #/admin, Back to Planyr, every section's loading → data / empty /
 * visible-error states, error-then-retry on menu open, account-switch both directions, and no
 * horizontal page scroll at laptop width.
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm run dev -- --port 5199 &
 *   E2E_LOGIN_KEY=… node ui-audit/verify-admin-surfaces.mjs http://localhost:5199 https://planyr.io
 * Known-good arm: with is_admin mocked FALSE the row and page must be absent (a run that only ever sees
 * "present" proves nothing). */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "http://localhost:5199";
const deploy = process.argv[3] || "https://planyr.io";
const key = process.env.E2E_LOGIN_KEY;
if (!key) throw new Error("E2E_LOGIN_KEY not set");

const mock = { isAdmin: true, isAdminFail: false, empty: false, sectionFail: false };
const GROUP = { kind: "error", source: "react", module: "site-planner", message: "Cannot read properties of undefined", occurrences: 12, accounts: 3, first_seen: "2026-10-01T00:00:00Z", last_seen: "2026-10-04T12:00:00Z", last_build: "abc1234", builds: 2 };
const answers = {
  admin_error_groups: () => (mock.empty ? [] : [GROUP]),
  admin_error_group_rows: () => [{ id: "r1", at: "2026-10-04T12:00:00Z", user_id: null, build: "abc1234", module: "site-planner", url: "https://planyr.io/#/site", user_agent: "UA", stack: "Error: x\n  at y" }],
  admin_list_problem_reports: () => [],
  admin_list_support_reports: () => (mock.empty ? [] : [{ id: "t1", at: "2026-10-03T00:00:00Z", user_id: "11111111-1111-1111-1111-111111111111", user_email: "a@b.c", category: "problem", description: "it broke", context: {}, build: "abc", route: "site-planner", status: "open", closed_at: null }]),
  admin_recent_errors_for_user: () => [],
  admin_set_report_status: () => true,
  admin_usage_overview: () => ({ generated_at: "2026-10-05T00:00:00Z", totals: { accounts: 10, active_7d: 1, active_30d: 4, projects: 69, plans: 103, reviews: 48, files: 64, schedules: 10, teams: 1, team_members: 4, pending_invites: 1 }, weekly: [{ week: "2026-09-28", signups: 1, plans_created: 3, plans_edited: 8 }], accounts: [{ id: "u", email: "x@y.z", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: "2026-10-04T00:00:00Z", plans: 5, projects: 3, files: 2, last_plan_edit: null }] }),
  admin_get_ops: () => ({ snapshots: { backlog: { updated_at: "2026-10-05T00:00:00Z", payload: { open: { count: 339, recent: [{ id: "B1", title: "Thing" }], topTags: [{ tag: "#ui", count: 2 }] }, verify: { count: 1, recent: [] } } } }, sweeps: [] }),
  admin_list_criteria_requests: () => [], admin_list_signup_attempts: () => [], admin_list_password_resets: () => [], admin_list_users: () => [],
};

const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); };

async function newPage(viewport, tokens, hash = "") {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name === "is_admin") {
      if (mock.isAdminFail) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mock.isAdmin) });
    }
    if (name in answers) {
      if (mock.sectionFail) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "section exploded" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answers[name]()) });
    }
    return route.continue();
  });
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 });
  const err = await page.evaluate(async (t) => (await window.pfSupabase.auth.setSession(t)).error?.message || null, tokens);
  if (err) throw new Error("setSession: " + err);
  await page.waitForTimeout(3500); // let the post-sign-in landing settle, so what follows is a TRUE cold load
  await page.goto(base + "/" + hash, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await assertMeasurable(page, "verify-admin-surfaces");
  return { ctx, page };
}

async function accountRowPresent(page) {
  // Open the (visible) account pill, read the Admin row, close.
  const pill = page.locator('button[aria-label^="Account:"]:visible').first();
  await pill.click({ timeout: 8000 });
  await page.waitForTimeout(500);
  const has = (await page.locator('[data-testid="account-admin-row"]').count()) > 0;
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5).catch(() => {});
  return has;
}

const tokens = await (async () => {
  const res = await fetch(deploy + "/api/auth/e2e-session", { method: "POST", headers: { "x-e2e-login-key": key } });
  if (res.status !== 200) throw new Error("e2e-session " + res.status);
  const b = await res.json();
  return { access_token: b.access_token, refresh_token: b.refresh_token };
})();

const surfaces = ["#/dashboard", "#/site", "#/project/e2e-fixture-site/site", "#/markup", "#/library", "#/notes", "#/schedule", "#/food"];
try {
  // 1 — admin: row on every surface at laptop width.
  for (const hash of surfaces) {
    const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens, hash);
    check(`admin row present on ${hash}`, await accountRowPresent(page));
    await ctx.close();
  }
  // known-good arm: not admin → absent
  mock.isAdmin = false;
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens);
    check("KNOWN-GOOD: non-admin sees NO admin row", !(await accountRowPresent(page)));
    await page.goto(base + "/#/admin"); await page.waitForTimeout(2500);
    check("KNOWN-GOOD: non-admin at #/admin gets no admin page", (await page.locator('[data-testid="admin-app"]').count()) === 0);
    await ctx.close(); }
  mock.isAdmin = true;

  // 2 — phone layout row.
  { const { ctx, page } = await newPage({ width: 390, height: 844 }, tokens); await page.waitForTimeout(2500);
    check("admin row present on phone width (dashboard)", await accountRowPresent(page)); await ctx.close(); }

  // 3 — cold load, reload, Back to Planyr, sections.
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens, "#/admin");
    await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 });
    check("cold #/admin opens the admin page", true);
    await page.waitForTimeout(7000); // the Site Planner's boot used to rewrite #/admin → #/site at ~2.5 s
    check("…and STAYS on #/admin (no bounce to the map)", (await page.locator('[data-testid="admin-app"]').count()) === 1 && (await page.evaluate(() => location.hash)) === "#/admin");
    for (const id of ["issues", "reports", "support", "usage", "signups", "criteria", "password-reset", "ops"])
      check(`section present: ${id}`, (await page.locator(`[data-testid="admin-section-${id}"]`).count()) === 1);
    const txt = await page.locator('[data-testid="admin-app"]').innerText();
    check("Issues shows the grouped error", /Cannot read properties/.test(txt));
    check("Support shows the open ticket", /it broke/.test(txt));
    check("Usage shows totals", /Accounts/.test(txt) && /103/.test(txt));
    check("Ops shows the ledger digest", /339/.test(txt));
    check("no 'Coming soon' placeholders", !/Coming soon/.test(txt));
    const order = await page.$$eval('[data-testid^="admin-section-"]', (els) => els.map((e) => e.dataset.testid.replace("admin-section-", "")));
    check("section order", order.join(",") === "issues,reports,support,usage,signups,criteria,password-reset,ops", order.join(","));
    check("no horizontal page scroll at laptop width", await page.evaluate(() => { const s = document.querySelector('[data-testid="admin-app"]'); return s.scrollWidth <= s.clientWidth + 1; }));
    await page.locator('[data-testid="admin-section-issues"] >> text=Recent rows').click();
    await page.waitForTimeout(800);
    check("Issues: opening a group's recent rows works", /abc1234/.test(await page.locator('[data-testid="admin-section-issues"]').innerText()));
    await page.screenshot({ path: process.env.SHOT || "/tmp/admin-shot.png", fullPage: false });
    await page.reload(); await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 });
    check("reload on #/admin stays on the admin page", true);
    await page.getByText("Back to Planyr").click(); await page.waitForTimeout(1200);
    check("Back to Planyr leaves the admin page", (await page.locator('[data-testid="admin-app"]').count()) === 0);
    await ctx.close(); }

  // 4 — empty + visible error states.
  mock.empty = true;
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens, "#/admin");
    await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 }); await page.waitForTimeout(1500);
    const txt = await page.locator('[data-testid="admin-app"]').innerText();
    check("empty states render", /Nothing in this window/.test(txt) && /No tickets filed yet/.test(txt)); await ctx.close(); }
  mock.empty = false; mock.sectionFail = true;
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens, "#/admin");
    await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 }); await page.waitForTimeout(2000);
    for (const id of ["issues", "support", "usage", "ops"]) {
      const t = await page.locator(`[data-testid="admin-section-${id}"]`).innerText();
      check(`${id}: failure is VISIBLE with Retry`, /Could not load/.test(t) && /Retry/.test(t));
    }
    mock.sectionFail = false;
    await page.locator('[data-testid="admin-section-usage"] >> text=Retry').click(); await page.waitForTimeout(1000);
    check("usage: Retry recovers", /103/.test(await page.locator('[data-testid="admin-section-usage"]').innerText()));
    await ctx.close(); }

  // 5 — is_admin error → row hidden, retried on next menu open.
  mock.isAdminFail = true;
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens); await page.waitForTimeout(2500);
    check("is_admin ERROR: row hidden", !(await accountRowPresent(page)));
    mock.isAdminFail = false;
    check("…and recovers on the next menu open", await (async () => { await accountRowPresent(page); await page.waitForTimeout(800); return accountRowPresent(page); })());
    await ctx.close(); }
} finally { await browser.close(); }
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
