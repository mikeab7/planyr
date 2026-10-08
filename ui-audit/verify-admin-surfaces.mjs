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
const now = Date.now(); const iso = (d) => new Date(now - d * 86400000).toISOString();
const GROUP = { kind: "error", source: "react", module: "site-planner", message: "Cannot read properties of undefined", occurrences: 12, accounts: 3, first_seen: iso(0.5), last_seen: iso(0.1), last_build: "abc1234", builds: 2 };
const CHUNKS = ["AdminGate", "SitePlannerApp", "DocReview", "Library"].flatMap((f, i) => ["vite:preloadError", "unhandledrejection", "react"].map((src, j) => ({ kind: "error", source: src, module: null, message: `Failed to fetch dynamically imported module: https://planyr.io/assets/${f}-H${i}${j}abcdEF.js`, occurrences: 1, accounts: 1, first_seen: iso(3), last_seen: iso(2), last_build: "abc", builds: 1 })));
const USERS = [
  { id: "u1", email: "ann@acme.com", name: "Ann Real", org: "Acme", team: "Ops", team_role: "admin", created_at: iso(40), last_sign_in_at: iso(1), email_confirmed_at: iso(40), provider: "email", projects: 3, plans: 5, files: 2, reviews: 1, schedules: 1, last_activity: iso(2) },
  { id: "u2", email: "bob@acme.com", name: null, org: null, team: null, team_role: null, created_at: iso(60), last_sign_in_at: iso(20), email_confirmed_at: null, provider: "google", projects: 1, plans: 1, files: 0, reviews: 0, schedules: 0, last_activity: iso(20) },
  { id: "u3", email: "e2e@planyr.test", name: null, org: null, team: null, team_role: null, created_at: iso(90), last_sign_in_at: iso(0), email_confirmed_at: iso(90), provider: "email", projects: 2, plans: 2, files: 0, reviews: 0, schedules: 0, last_activity: iso(0) },
  { id: "u4", email: "new@acme.com", name: "Newbie", org: "Acme", team: null, team_role: null, created_at: iso(1), last_sign_in_at: iso(1), email_confirmed_at: iso(1), provider: "email", projects: 0, plans: 0, files: 0, reviews: 0, schedules: 0, last_activity: null },
  { id: "u5", email: "old@acme.com", name: "Old Timer", org: null, team: null, team_role: null, created_at: iso(200), last_sign_in_at: iso(100), email_confirmed_at: iso(200), provider: "email", projects: 1, plans: 1, files: 1, reviews: 0, schedules: 0, last_activity: iso(100) },
];
const SLOW = Array.from({ length: 11 }, (_, i) => ({ id: "s" + i, at: iso(12 + i), user_id: "u1", user_email: "ann@acme.com", category: "slow", description: "", context: {}, build: "abc", route: "site-planner", status: "open", closed_at: null }));
// B2159505: automated-test reports that must NOT pad the Support queue by default (the owner's 17-open case).
const TESTY = [
  { id: "z1", at: iso(5), user_id: null, user_email: null, category: "problem", description: "test — please ignore (zz-sweep-V464176)", context: {}, build: "abc", route: "site", status: "open", closed_at: null },
  { id: "z2", at: iso(5), user_id: null, user_email: null, category: "problem", description: "test — please ignore (zz-sweep-V464176)", context: {}, build: "abc", route: "site", status: "open", closed_at: null },
  { id: "z3", at: iso(5), user_id: "u3", user_email: "e2e@planyr.test", category: "problem", description: "test — please ignore (zz-sweep-V464176)", context: {}, build: "abc", route: "site", status: "open", closed_at: null },
  { id: "z4", at: iso(4), user_id: "u3", user_email: "e2e@planyr.test", category: "slow", description: "", context: {}, build: "abc", route: "site", status: "open", closed_at: null },
];
// B2159506: a user's recent errors — two real, plus deploy reloads that must collapse into one muted line.
const USER_ERRORS = [
  { id: "e1", at: iso(1), build: "abc", module: "site-planner", source: "react", message: "Cannot read properties of undefined" },
  ...["Notes", "Library", "DocReview"].map((f, i) => ({ id: "d" + i, at: iso(1), build: "abc", module: null, source: "vite:preloadError", message: `Failed to fetch dynamically imported module: https://planyr.io/assets/${f}-Hh${i}abcdEF.js` })),
];
const answers = {
  admin_error_groups: () => (mock.empty ? [] : [GROUP, ...CHUNKS]),
  admin_error_group_rows: () => [{ id: "r1", at: "2026-10-04T12:00:00Z", user_id: null, build: "abc1234", module: "site-planner", url: "https://planyr.io/#/site", user_agent: "UA", stack: "Error: x\n  at y" }],
  admin_list_problem_reports: () => [],
  admin_list_support_reports: () => (mock.empty ? [] : [{ id: "t1", at: "2026-10-03T00:00:00Z", user_id: "u1", user_email: "ann@acme.com", category: "problem", description: "it broke", context: { route: "site-planner" }, build: "abc", route: "site-planner", status: "open", closed_at: null }, ...SLOW, ...TESTY]),
  admin_recent_errors_for_user: () => USER_ERRORS,
  admin_set_report_status: () => true,
  admin_record_session_sweep: () => "11111111-1111-4111-8111-111111111111",
  admin_users_overview: () => (mock.empty ? [] : USERS),
  admin_user_activity: () => ({ plans: [iso(2), iso(3)], reviews: [], schedules: [iso(9)], files: [iso(30)] }),
  admin_usage_overview: () => ({ generated_at: "2026-10-05T00:00:00Z", totals: { accounts: 10, active_7d: 1, active_30d: 4, projects: 69, plans: 103, reviews: 48, files: 64, schedules: 10, teams: 1, team_members: 4, pending_invites: 1 }, weekly: Array.from({ length: 12 }, (_, i) => ({ week: new Date(now - (11 - i) * 7 * 86400000).toISOString().slice(0, 10), signups: i % 3, plans_created: 2 + (i % 5), plans_edited: 5 + i })), accounts: [] }),
  admin_get_ops: () => ({ snapshots: { backlog: { updated_at: iso(0.1), payload: { commit: "abc1234def5678", open: { count: 339, recent: [{ id: "B1", title: "Thing" }], topTags: [{ tag: "#ui", count: 2 }] }, verify: { count: 1, recent: [] } } } }, sweeps: [] }),
  admin_list_criteria_requests: () => [], admin_list_signup_attempts: () => [], admin_list_password_resets: () => [], admin_list_users: () => USERS.map((u) => ({ id: u.id, email: u.email, first_name: u.name, last_name: null, org: u.org, created_at: u.created_at })),
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
    const SHOTDIR = process.env.SHOTDIR || "/tmp/admin-shots";
    const { mkdirSync } = await import("node:fs"); mkdirSync(SHOTDIR, { recursive: true });
    const main = () => page.locator('[data-testid="admin-main"]');
    check("lands on Overview, ONE section mounted", (await page.locator('[data-testid^="admin-section-"]').count()) === 1 && (await page.locator('[data-testid="admin-section-overview"]').count()) === 1);
    let t0 = await main().innerText();
    check("Overview: six headline tiles", (await page.locator('[data-testid^="tile-"]').count()) === 6);
    check("Overview: accounts follow Hide internal (4 real of 5, internal excluded)", /excluding 1 internal/.test(t0) && (await page.locator('[data-testid="tile-accounts"]').innerText()).includes("4"));
    check("Overview: error tile excludes deploy noise (1 group, 12 deploy reloads noted)", (await page.locator('[data-testid="tile-errors"]').innerText()).includes("12 deploy reloads"));
    check("Overview: newest sign-ups + top errors present", /Newest sign-ups/.test(t0) && /Top errors, 7 days/.test(t0) && /Cannot read properties/.test(t0));
    check("Overview needs no page scroll at laptop height", await page.evaluate(() => { const m = document.querySelector('[data-testid="admin-main"]'); return m.scrollHeight <= m.clientHeight + 1; }));
    check("nav badges: support 12 open, issues 1 new, no criteria badge", (await page.locator('[data-testid="admin-badge-support"]').innerText()) === "12" && (await page.locator('[data-testid="admin-badge-issues"]').innerText()) === "1" && (await page.locator('[data-testid="admin-badge-criteria"]').count()) === 0);
    await page.screenshot({ path: `${SHOTDIR}/overview-laptop.png` });
    const IDS = ["overview", "users", "issues", "support", "usage", "criteria", "parcel-coverage", "password-reset", "ops"];
    const navOrder = await page.$$eval('[data-testid^="admin-nav-"]:not(select)', (els) => els.map((e) => e.dataset.testid.replace("admin-nav-", "")).filter((x) => x !== "select"));
    check("nav order", navOrder.join(",") === IDS.join(","), navOrder.join(","));
    for (const id of IDS.slice(1)) {
      await page.locator(`[data-testid="admin-nav-${id}"]`).click(); await page.waitForTimeout(id === "parcel-coverage" ? 2500 : 900);
      check(`nav → ${id}: hash #/admin/${id}, exactly that section mounted`, (await page.evaluate(() => location.hash)) === `#/admin/${id}` && (await page.locator(`[data-testid="admin-section-${id}"]`).count()) === 1 && (await page.locator('[data-testid^="admin-section-"]').count()) === 1);
      check(`${id}: no horizontal page scroll`, await page.evaluate(() => { const m = document.querySelector('[data-testid="admin-app"]'); return m.scrollWidth <= m.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1; }));
      await page.screenshot({ path: `${SHOTDIR}/${id}-laptop.png` });
    }
    // Users
    await page.locator('[data-testid="admin-nav-users"]').click(); await page.waitForTimeout(600);
    check("Users: internal hidden by default (4 rows)", (await page.locator('[data-testid="user-row"]').count()) === 4);
    await page.locator('[data-testid="hide-internal"]').uncheck(); await page.waitForTimeout(300);
    check("Users: 'Hide internal' off shows all 5 with an Internal chip", (await page.locator('[data-testid="user-row"]').count()) === 5 && /Internal/.test(await main().innerText()));
    await page.locator('[data-testid="hide-internal"]').check();
    await page.getByRole("button", { name: /^Never used/ }).click(); await page.waitForTimeout(200);
    check("Users: status chip filters (Never used → 1)", (await page.locator('[data-testid="user-row"]').count()) === 1);
    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByLabel("Search name or email").fill("ann"); await page.waitForTimeout(200);
    check("Users: search narrows", (await page.locator('[data-testid="user-row"]').count()) === 1);
    await page.locator('[data-testid="user-row"]').first().click(); await page.waitForTimeout(700);
    const det = await page.locator('[data-testid="user-detail"]').innerText();
    check("Users: detail panel shows facts, activity dates, open support item", /Email confirmed/.test(det) && /Plans edited/.test(det) && /it broke/.test(det) && /via email/.test(det));
    check("Users: detail 'Recent errors' drops deploy reloads → 1 real error + ONE muted '3 deploy reloads (expected)' line (B2159506)", /Cannot read properties of undefined/.test(det) && !/Failed to fetch dynamically/.test(det) && /3 deploy reloads \(expected\)/.test(det) && (await page.locator('[data-testid="user-detail"] [data-testid="deploy-reloads-line"]').count()) === 1);
    await page.screenshot({ path: `${SHOTDIR}/users-detail-laptop.png` });
    await page.getByRole("button", { name: "Reset password…" }).click(); await page.waitForTimeout(1200);
    check("Users → Password reset link prefilled with that account", (await page.evaluate(() => location.hash)).includes("password-reset?user=u1") && (await page.getByLabel("Select a user").inputValue()) === "u1");
    // Issues
    await page.locator('[data-testid="admin-nav-issues"]').click(); await page.waitForTimeout(800);
    const it = await main().innerText();
    check("Issues: deploy reloads folded into ONE line (12 occurrences across 4 files)", /Deploy reloads — 12 occurrences across 4 files/.test(it) && (await page.locator('[data-testid="deploy-fold"]').count()) === 1);
    check("Issues: chunk rows not listed as errors", !/Failed to fetch dynamically/.test(it));
    await page.getByText("Show files").click(); await page.waitForTimeout(200);
    check("Issues: fold expands to per-file rows", /AdminGate\.js/.test(await main().innerText()));
    await page.locator('[data-testid="admin-section-issues"] >> text=Recent rows').click(); await page.waitForTimeout(800);
    check("Issues: opening a group's recent rows works", /abc1234/.test(await page.locator('[data-testid="admin-section-issues"]').innerText()));
    // Support
    await page.locator('[data-testid="admin-nav-support"]').click(); await page.waitForTimeout(800);
    check("Support: 1 written row on top + ONE grouped line '11 slow taps'", (await page.locator('[data-testid="support-row"]').count()) === 1 && (await page.locator('[data-testid="slow-group"]').count()) === 1 && /11 slow taps, latest 12 days ago/.test(await main().innerText()));
    await page.getByRole("button", { name: "Close all" }).click(); await page.waitForTimeout(200);
    check("Support: Close all asks to confirm first", /Close 11\?/.test(await main().innerText()));
    await page.getByRole("button", { name: "Cancel" }).click();
    // B2159505 — test reports are hidden by default (the 4 mock test rows), badge + blurb follow the toggle, then it reveals them
    const sup = page.locator('[data-testid="admin-section-support"]');
    check("Support: 'Hide internal' ON by default and hides the 4 test reports (2 signed-out marked tests + 2 from the e2e account)", await page.locator('[data-testid="support-hide-internal"]').isChecked() && /Hide internal \(4\)/.test(await sup.innerText()) && /12 open/.test(await sup.innerText()) && !/zz-sweep/.test(await sup.innerText()));
    check("Support: nav badge follows the toggle (12, not 16)", (await page.locator('[data-testid="admin-badge-support"]').innerText()).trim() === "12");
    await page.locator('[data-testid="support-hide-internal"]').uncheck(); await page.waitForTimeout(300);
    check("Support: switching Hide internal OFF shows them (16 open, badge 16)", /16 open/.test(await sup.innerText()) && /zz-sweep/.test(await sup.innerText()) && (await page.locator('[data-testid="admin-badge-support"]').innerText()).trim() === "16");
    await page.locator('[data-testid="support-hide-internal"]').check(); await page.waitForTimeout(200);
    await page.locator('[data-testid="admin-nav-overview"]').click(); await page.waitForTimeout(500);
    check("Overview: 'Open support' tile follows the toggle and says so ('12 … excl. 4 internal/test')", /12/.test(await page.locator('[data-testid="tile-support"]').innerText()) && /excl\. 4 internal\/test/.test(await page.locator('[data-testid="tile-support"]').innerText()));
    await page.locator('[data-testid="admin-nav-support"]').click(); await page.waitForTimeout(400);
    // Ops
    await page.locator('[data-testid="admin-nav-ops"]').click(); await page.waitForTimeout(800);
    const ot = await main().innerText();
    check("Ops: empty sweep state says it is recorded automatically; digest header reads 'Updated … after abc1234' (B2159504/7)", /No session sweep recorded yet/.test(ot) && /Recorded automatically by the weekly sweep/.test(ot) && /Updated\s+\d+ (min|hr) ago\s+after\s+abc1234/.test(await page.locator('[data-testid="digest-stamp"]').innerText()) && /339/.test(ot) && !/Not updating/.test(ot));
    check("Ops: manual form is collapsed under 'Record manually'", (await page.locator('[data-testid="record-manually"]').count()) === 1 && !(await page.getByLabel("Sessions archived").isVisible()));
    const hook = await page.evaluate(async () => typeof window.pfAdminRecordSweep);
    check("Ops: the sweep's record hook (window.pfAdminRecordSweep) is installed while the admin page is open", hook === "function");
    const hookRes = await page.evaluate(() => window.pfAdminRecordSweep({ archived: 3, stillOpen: [{ title: "A session", waitingOn: "a decision" }], note: "harness" }));
    check("Ops: calling the hook reaches admin_record_session_sweep and answers { ok: true }", hookRes && hookRes.ok === true);
    check("no 'Coming soon' placeholders", !/Coming soon/.test(await page.locator('[data-testid="admin-app"]').innerText()));
    // sub-path cold load + back/forward
    await page.goto(base + "/#/admin/usage"); await page.waitForTimeout(2500);
    check("cold #/admin/usage opens Usage", (await page.locator('[data-testid="admin-section-usage"]').count()) === 1);
    await page.locator('[data-testid="admin-nav-users"]').click(); await page.waitForTimeout(400);
    await page.goBack(); await page.waitForTimeout(600);
    check("browser Back returns to Usage", (await page.evaluate(() => location.hash)) === "#/admin/usage" && (await page.locator('[data-testid="admin-section-usage"]').count()) === 1);
    check("Usage: trend chart drawn with labelled axes", (await page.locator('[data-testid="admin-section-usage"] svg polyline').count()) === 3 && (await page.locator('[data-testid="admin-section-usage"] svg text').count()) > 6);
    await page.goto(base + "/#/admin/bogus"); await page.waitForTimeout(2500);
    check("unknown sub-path falls back to Overview", (await page.locator('[data-testid="admin-section-overview"]').count()) === 1);
    await page.goto(base + "/#/admin"); await page.waitForTimeout(2000);
    await page.reload(); await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 });
    check("reload on #/admin stays on the admin page", true);
    await page.getByText("Back to Planyr").click(); await page.waitForTimeout(1200);
    check("Back to Planyr leaves the admin page", (await page.locator('[data-testid="admin-app"]').count()) === 0);
    await ctx.close(); }

  // 3b — REGRESSION (B2122576 reopened): reaching #/admin IN-APP from a route other than Site used to
  // bounce to #/site ~100 ms later (measured live on the owner's account, build 00ac52e). Navigate from
  // the dashboard via the real menu click, and from non-Site modules by hash, then wait 2 s.
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens, "#/dashboard");
    const trail = []; await page.exposeFunction("__hc", (v) => trail.push(v));
    await page.evaluate(() => window.addEventListener("hashchange", (e) => window.__hc(new URL(e.newURL).hash)));
    const settled = async (label) => {
      await page.waitForTimeout(2000);
      const hash = await page.evaluate(() => location.hash);
      const mounted = await page.locator('[data-testid="admin-app"]').count();
      check(`${label}: stays on #/admin with the admin root mounted 2 s later`, hash === "#/admin" && mounted === 1, `hash=${hash} mounted=${mounted} trail=${trail.join(" ")}`);
    };
    // the account menu has answered is_admin by now (cached) — exactly the owner's situation
    await page.locator('button[aria-label^="Account:"]:visible').first().click(); await page.waitForTimeout(600);
    trail.length = 0;
    await page.locator('[data-testid="account-admin-row"]').click();
    await settled("dashboard → Admin row (real click)");
    for (const from of ["#/dashboard", "#/schedule", "#/library", "#/notes", "#/markup", "#/food"]) {
      await page.evaluate((h) => { location.hash = h; }, from); await page.waitForTimeout(2500);
      trail.length = 0;
      await page.evaluate(() => { location.hash = "#/admin"; });
      await settled(`${from} → #/admin (hash)`);
    }
    await ctx.close(); }

  // 4 — empty + visible error states, per section (one at a time now).
  const gotoSection = async (page, id) => { await page.locator(`[data-testid="admin-nav-${id}"]`).click(); await page.waitForTimeout(1200); };
  mock.empty = true;
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens, "#/admin");
    await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 }); await page.waitForTimeout(1500);
    const want = { users: /No accounts match/, issues: /Nothing in this window/, support: /Nothing open/, ops: /No session sweep recorded yet/, criteria: /No requests filed yet/ };
    for (const [id, re] of Object.entries(want)) { await gotoSection(page, id); check(`${id}: proper empty state`, re.test(await page.locator('[data-testid="admin-main"]').innerText())); }
    await ctx.close(); }
  mock.empty = false; mock.sectionFail = true;
  { const { ctx, page } = await newPage({ width: 1440, height: 900 }, tokens, "#/admin");
    await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 }); await page.waitForTimeout(2000);
    for (const id of ["overview", "users", "issues", "support", "usage", "ops"]) {
      await gotoSection(page, id);
      const t = await page.locator('[data-testid="admin-main"]').innerText();
      check(`${id}: failure is VISIBLE with Retry`, /Could not load/.test(t) && /Retry/.test(t));
    }
    await gotoSection(page, "usage"); // still failing here — Retry is on screen
    mock.sectionFail = false;
    await page.locator('[data-testid="admin-section-usage"] >> text=Retry').click(); await page.waitForTimeout(1000);
    check("usage: Retry recovers", /103/.test(await page.locator('[data-testid="admin-section-usage"]').innerText()));
    await ctx.close(); }

  // 4b — PHONE width: nav collapses to a select, every section usable, no horizontal page scroll.
  { const { ctx, page } = await newPage({ width: 390, height: 844 }, tokens, "#/admin");
    await page.waitForSelector('[data-testid="admin-app"]', { timeout: 15000 }); await page.waitForTimeout(2000);
    const SHOTDIR = process.env.SHOTDIR || "/tmp/admin-shots";
    check("phone: nav is a select, side nav hidden", (await page.locator('[data-testid="admin-nav-select"]').isVisible()) && !(await page.locator('[data-testid="admin-nav-users"]').isVisible()));
    for (const id of ["overview", "users", "issues", "support", "usage", "criteria", "parcel-coverage", "password-reset", "ops"]) {
      await page.locator('[data-testid="admin-nav-select"]').selectOption(id); await page.waitForTimeout(id === "parcel-coverage" ? 2500 : 900);
      check(`phone ${id}: mounted, no horizontal PAGE scroll`, (await page.locator(`[data-testid="admin-section-${id}"]`).count()) === 1 && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.querySelector('[data-testid="admin-app"]').scrollWidth <= document.querySelector('[data-testid="admin-app"]').clientWidth + 1));
      await page.screenshot({ path: `${SHOTDIR}/${id}-phone.png` });
    }
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
