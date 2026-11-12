/* verify-project-gate-live — NEW-1 (B2671231, owner 2026-11-12): "a real, live project briefly shows 'This project doesn't exist'."
 * Driven LIVE and SIGNED IN as the throwaway test account (never a real project), on a THROWAWAY project made for this run:
 *
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge sha7> node ui-audit/verify-project-gate-live.mjs [https://planyr.io]
 *   (no EXPECT_SHA → the run is a BEFORE-FIX probe: it prints the verdicts but the build check is skipped)
 *
 *   A  cold load by URL ×5 under a slow network (CDP-throttled): the doesn't-exist card never mounts, at any instant of any load
 *      (a MutationObserver armed before the page's own scripts records every appearance)
 *   B  THE MECHANISM, forced: the stored session's access token is made expired AND the token-refresh call is refused, so supabase-js
 *      has no usable session and sends the ANONYMOUS key — then the tab is refocused ×6 (each refocus re-asks the gate). The card never
 *      mounts. INSTRUMENT PROOF: the harness counts the `sites` reads that went out with the anonymous role vs the user's token; the arm is
 *      VOID unless at least one anonymous read really went out (a hold that caught nothing proves nothing); supabase-js holds the read behind its refresh back-off, so the arm waits for it
 *   C  a reload + refocus storm with a healthy session: never the card
 *   D  KNOWN-GOOD: an id that never existed STILL shows the card (so "never" in A–C is not just a card that cannot render)
 *   E  cleanup (constraint #15, never asked): the throwaway project's rows are removed and the count left is READ BACK = 0
 * The run is VOID unless the signed-in proof holds AND (when EXPECT_SHA is set) the served build, read from /version.json in the SAME
 * call as the assertions, contains it.
 */
import { execSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const stamp = Date.now().toString(36);
const PROJ = `zz-project-gate-${stamp}`;
const NOTICE = '[data-testid="deleted-project-notice"]';
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + String(extra).slice(0, 300) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await openSignedIn({ base: BASE });
const { page } = s;
let gid = null;
const waitFor = async (fn, ms = 30000, step = 500) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(step); } };
const dbRows = () => page.evaluate(async (g) => ((await window.pfSupabase.from("sites").select("id,group_id,deleted_at").eq("group_id", g)).data || []), gid);

/* Every appearance of the card, recorded from before the page's own scripts run, surviving until read. */
await page.addInitScript((sel) => {
  window.__noticeSeen = 0; window.__noticeStatus = [];
  const look = () => { const n = document.querySelector(sel); if (n) { window.__noticeSeen++; window.__noticeStatus.push(n.getAttribute("data-status")); } };
  const start = () => { look(); new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true }); };
  if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start);
}, NOTICE);
const seen = () => page.evaluate(() => ({ n: window.__noticeSeen || 0, status: window.__noticeStatus || [] })).catch(() => ({ n: -1, status: [] }));

/* Which identity did each `sites` read go out as? Read from the request's full header set (`allHeaders()` — `headers()` omits some).
 * A bearer that is a JWT with role "authenticated" is the SIGNED-IN USER; anything else (the publishable/anon key, a JWT with role
 * "anon", or no bearer) is the ANONYMOUS role — the identity row-level security answers with zero rows and no error. Nothing printed. */
const reads = { anon: 0, user: 0 };
const roleOf = (auth) => { try { return JSON.parse(Buffer.from(String(auth).replace(/^Bearer /i, "").split(".")[1], "base64url").toString()).role || "?"; } catch { return "not-a-jwt"; } };
page.on("request", (rq) => {
  if (!/\/rest\/v1\/sites\?/.test(rq.url()) || rq.method() !== "GET") return;
  rq.allHeaders().then((h) => { if (roleOf(h["authorization"] || "") === "authenticated") reads.user++; else reads.anon++; }).catch(() => {});
});

/* The GATE's own question (cloudCheckDeleted: select=id,group_id,site,name,deleted_at by id / by group_id) — counted apart, with what came back. */
const gate = { asked: 0, anon: 0, emptyAnswers: 0, errored: 0 };
page.on("response", async (rs) => {
  const u = rs.url(); if (!/\/rest\/v1\/sites\?select=id%2Cgroup_id%2Csite%2Cname%2Cdeleted_at/.test(u) || rs.request().method() !== "GET") return;
  try { const h = await rs.request().allHeaders(); const anon = roleOf(h["authorization"] || "") !== "authenticated"; gate.asked++; if (anon) gate.anon++; const t = await rs.text(); if (rs.status() !== 200) gate.errored++; else if (t.trim() === "[]") gate.emptyAnswers++; } catch (_) {}
});

const cdp = await page.context().newCDPSession(page);
const throttle = (on) => cdp.send("Network.emulateNetworkConditions", on
  ? { offline: false, latency: 350, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (200 * 1024) / 8 }
  : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const projectUrl = (id) => `${BASE}/?cb=${Date.now()}#/project/${id}/site`;
const refocus = async (n) => { for (let i = 0; i < n; i++) { await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(700); } };

try {
  await assertMeasurable(page, "verify-project-gate-live");
  const build0 = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build));
  const containsMerge = (b) => { if (!EXPECT_SHA) return true; if (String(b).startsWith(EXPECT_SHA.slice(0, 7))) return true; try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${b}`, { stdio: "ignore" }); return true; } catch { return false; } };
  console.log(`served build: ${build0}  expect: ${EXPECT_SHA || "(unset — BEFORE-FIX probe)"}`);
  ok("KNOWN-GOOD: served build contains the merge commit (read in this call)", containsMerge(build0), `build=${build0}`);
  ok("KNOWN-GOOD: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  /* ---- throwaway project: + New project, rename (materialises the sites row), draw one line ---- */
  await page.goto(`${BASE}/#/project/e2e-fixture`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30000 });
  const crumb = () => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();
  await crumb().click();
  await page.getByTestId("project-new").click();
  await page.waitForFunction(() => { const m = location.hash.match(/project\/([^/]+)/); return !!m && !/^e2e-fixture/.test(m[1]); }, null, { timeout: 30000 });
  gid = await page.evaluate(() => (location.hash.match(/project\/([^/]+)/) || [])[1]);
  if (!gid || /^e2e-fixture/.test(gid)) { const bad = gid; gid = null; throw new Error(`new project did not open (hash group "${bad}") — refusing to touch the fixture`); }
  await crumb().click(); await page.getByTestId(`project-row-${gid}`).hover(); await page.getByTestId(`project-kebab-${gid}`).click(); await page.getByTestId("project-rename").click();
  const first = page.getByRole("textbox", { name: /^Rename / }); await first.fill(PROJ); await first.press("Enter");
  ok("setup: the throwaway project has a cloud row", !!(await waitFor(async () => (await dbRows()).length >= 1, 60000)), gid);
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.keyboard.press("l");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press("v").catch(() => {});
  await sleep(2500);

  /* The app remembers projects THIS browser minted (B1202176's rescue, `planyr:freshProjects:v1`) and lets them through the gate even
   * when the cloud says "no such row" — which would MASK the very bug under test. Bain was not minted in this browser, so forget it. */
  const forgot = await page.evaluate((g) => { const k = "planyr:freshProjects:v1"; let had = false; try { const l = JSON.parse(localStorage.getItem(k) || "[]"); had = l.includes(g); localStorage.setItem(k, JSON.stringify(l.filter((x) => x !== g))); } catch (_) {} return { had, now: (localStorage.getItem(k) || "").includes(g) }; }, gid);
  ok("setup: the throwaway project is no longer remembered as freshly minted (the rescue cannot mask the check)", !forgot.now, JSON.stringify(forgot));

  /* ---- A · cold load by URL ×5 under a slow network ---- */
  await throttle(true);
  let aSeen = 0, aLoaded = 0;
  for (let i = 0; i < 5; i++) {
    await page.goto(projectUrl(gid), { waitUntil: "domcontentloaded" });
    const loaded = await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 60000 }).then(() => true).catch(() => false);
    if (loaded) aLoaded++;
    await sleep(5000); // the gate's check lands well after first paint on a slow link
    aSeen += (await seen()).n;
  }
  await throttle(false);
  ok("A the project loaded on every one of 5 slow cold loads (the arm could see the project)", aLoaded === 5, `${aLoaded}/5`);
  ok("A the doesn't-exist card never mounted on any of them", aSeen === 0, `appearances=${aSeen}`);

  /* ---- B · THE MECHANISM: unusable session (expired token + refresh refused) → anonymous reads → refocus storm ---- */
  // The owner's case is a tab that is ALREADY signed in whose token then lapses while the refresh fails (slow / dropped link):
  // the app still believes it is signed in (no SIGNED_OUT is ever emitted for a retryable failure), so the gate keeps asking —
  // and supabase-js, with no session to hand back, sends the anonymous key. Expiring the token BEFORE the load would instead make
  // the app read "signed out" and skip the gate altogether (measured: zero reads), which is not the case being tested.
  await page.goto(projectUrl(gid), { waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 60000 });
  await sleep(3000);
  const key = await page.evaluate(() => Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)));
  ok("B setup: found the stored session key", !!key, key ? "sb-…-auth-token" : "none");
  await page.route(/\/auth\/v1\/token/, (route) => route.abort("failed"));
  await page.evaluate((k) => { const v = JSON.parse(localStorage.getItem(k)); v.expires_at = Math.floor(Date.now() / 1000) - 120; v.expires_in = 0; localStorage.setItem(k, JSON.stringify(v)); }, key);
  await page.evaluate(() => { window.__noticeSeen = 0; window.__noticeStatus = []; });
  reads.anon = 0; reads.user = 0;
  await refocus(3);
  // supabase-js holds EVERY request behind its auth lock while it retries the refused refresh with growing back-off, so the gate's
  // read only goes out (as the anonymous role, once the retries give up) well after the refocus — wait for it, never guess a delay.
  const waited0 = Date.now();
  const gotRead = await waitFor(async () => { await refocus(1); return reads.anon + reads.user > 0; }, 150000, 2000);
  console.log(`B first gate read left after ${Math.round((Date.now() - waited0) / 1000)} s`);
  await refocus(3);
  await sleep(3000);
  const b = await seen();
  console.log(`B the gate's own reads — asked: ${gate.asked}, as the anonymous role: ${gate.anon}, answered with an empty list: ${gate.emptyAnswers}, errored: ${gate.errored}`);
  console.log(`B reads that went out — anonymous role: ${reads.anon}, signed-in token: ${reads.user}`);
  ok("B INSTRUMENT: at least one `sites` read really went out as the ANONYMOUS role (else this arm proved nothing)", reads.anon > 0, JSON.stringify(reads));
  ok("B with no usable session and a refocus storm, the doesn't-exist card never mounted", b.n === 0, `appearances=${b.n} statuses=${b.status.join(",")}`);
  await page.unroute(/\/auth\/v1\/token/);

  /* ---- C · healthy session again: reload + refocus storm ---- */
  await page.goto(`${BASE}/#/project/e2e-fixture`, { waitUntil: "domcontentloaded" }); // let supabase-js refresh and the session recover
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 60000 });
  await sleep(2000);
  await page.goto(projectUrl(gid), { waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 60000 });
  await refocus(8);
  await sleep(1500);
  ok("C healthy session: reload + 8 refocuses, the card never mounted and the project is on screen", (await seen()).n === 0 && (await page.getByTestId("planner-canvas").isVisible()), JSON.stringify(await seen()));

  /* ---- D · KNOWN-GOOD: an id that never existed STILL shows the card ---- */
  await page.goto(projectUrl(`zz-never-existed-${stamp}`), { waitUntil: "domcontentloaded" });
  const cardShown = await page.locator(NOTICE).waitFor({ state: "visible", timeout: 40000 }).then(() => true).catch(() => false);
  ok("D KNOWN-GOOD: a project id that never existed still shows 'This project doesn't exist'", cardShown && /doesn.t exist/.test(await page.locator(NOTICE).innerText().catch(() => "")));
} catch (e) {
  ok("harness ran to the end", false, String(e && e.stack || e).slice(0, 500));
} finally {
  /* ---- E · cleanup: the throwaway project's rows are removed, and the count left is READ BACK ---- */
  try {
    await throttle(false).catch(() => {});
    await page.unroute(/\/auth\/v1\/token/).catch(() => {});
    if (gid && !/^e2e-fixture/.test(gid)) {
      await page.goto(`${BASE}/#/project/e2e-fixture`, { waitUntil: "domcontentloaded" });
      await sleep(4000);
      const left = await page.evaluate(async (g) => {
        const c = window.pfSupabase;
        const rows = ((await c.from("sites").select("id,group_id").eq("group_id", g)).data || []);
        const ids = rows.filter((r) => !/^e2e-fixture/.test(r.id) && !/^e2e-fixture/.test(r.group_id)).map((r) => r.id);
        if (ids.length) { await c.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids); await c.from("sites").delete().in("id", ids); }
        return ((await c.from("sites").select("id").eq("group_id", g)).data || []).length;
      }, gid);
      ok("E cleanup: no row of the throwaway project is left (read back)", left === 0, `${left} left`);
    }
  } catch (e) { ok("E cleanup ran", false, String(e.message || e).slice(0, 200)); }
  await s.close().catch(() => {});
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
