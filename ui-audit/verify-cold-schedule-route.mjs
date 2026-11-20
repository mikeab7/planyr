/* NEW-1 (B1638832) — a cold load of a bare "#/schedule" must stay project-less. LIVE, SIGNED IN, REAL EMBED.
 *
 *   node ui-audit/verify-cold-schedule-route.mjs [https://planyr.io]      (EXPECT_BUILD=<sha> to pin the served build)
 *
 * THE DEFECT (owner, 2026-11-15, build adfbc60, reproduced 2 of 2 on his account): cold-loading
 * planyr.io/?cb=…#/schedule rewrote the URL to #/project/<last-opened>/schedule. Mechanism, measured on the test
 * account: the embedded scheduler re-announces its state (`planar:nav-state`) whenever its schedule list changes and
 * answers every `planar:nav-request`; the shell read ANY announcement after the neutral "reports" view as "a person
 * clicked a Task Report row" (resolveReportRowNavigation, B1614528) and adopted the stale account-wide active
 * schedule's project into the URL. A quiet account never re-announces, so a bare cold load only reproduces on a busy one
 * — which is why this harness FORCES the re-announcement with the shell's own message instead of waiting for it.
 *
 * WHAT IT DOES: seeds ONE throwaway schedule (with one task) linked to the test account's fixture site, then
 *   KNOWN-GOOD ARMS (expected values known independently of the code under test — the run is VOID if any is wrong):
 *     K1  a cold #/project/<fixture>/schedule stays on that project.
 *     K2  a bare-domain boot (EMPTY hash) resumes into the project's schedule ("open where I left off").
 *     K3  a genuine Task Report row click in the REAL embed still adopts the clicked row's project
 *         (and, with the fix, the embed marks that one announcement `rowLink`).
 *   UNDER TEST:
 *     U1  cold #/schedule settles bare, then stays bare through three more embed re-announcements.
 *     U2  cold #/schedule stays bare while the embed is re-announcing DURING the load (the slow-account shape).
 *     U3  cold #/notes and #/markup (the report's adjacent cases) stay bare.
 *   The throwaway schedule is soft-deleted at the end (and its absence verified), always — constraint 15.
 * Red on build adfbc60 (U1/U2 fail); green on the fix. */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const PROJECT_HASH = `#/project/${FIXTURE_SITE_ID}/schedule`;
const NAME = "zz cold-schedule-route (auto-deleted)";
let fails = 0, voids = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };
const known = (cond, msg) => { if (!cond) voids++; console.log(`  ${cond ? "✓ [known-good]" : "✗ VOID [known-good arm wrong]"} ${msg}`); };

const s = await openSignedIn({ base });
const page = s.page;
await assertMeasurable(page, "verify-cold-schedule-route");
console.log("served build:", JSON.stringify(s.build));
if (process.env.EXPECT_BUILD) ok(String(s.build && s.build.build).startsWith(process.env.EXPECT_BUILD.slice(0, 7)), `served build matches ${process.env.EXPECT_BUILD.slice(0, 7)}`);

// Every hash this tab ever holds, and every nav-state the embed announces, from before the app's first script.
await page.addInitScript(() => {
  window.__hashes = [location.hash];
  window.__navStates = [];
  const rec = () => { const h = location.hash; if (window.__hashes[window.__hashes.length - 1] !== h) window.__hashes.push(h); };
  addEventListener("hashchange", rec);
  const ps = history.pushState, rs = history.replaceState;
  history.pushState = function () { const r = ps.apply(this, arguments); rec(); return r; };
  history.replaceState = function () { const r = rs.apply(this, arguments); rec(); return r; };
  addEventListener("message", (e) => { const d = e.data; if (d && d.type === "planar:nav-state") window.__navStates.push({ section: d.section, activeId: d.activeId, rowLink: d.rowLink === true }); });
});

const liveIds = () => page.evaluate(async () => { const r = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); return r.error ? null : r.data.map((x) => x.id); });
const hashNow = () => page.evaluate(() => location.hash);
const hashesSeen = () => page.evaluate(() => window.__hashes);
const reannounce = () => page.evaluate(() => { const f = document.querySelector("iframe"); if (f && f.contentWindow) f.contentWindow.postMessage({ source: "planar-shell", type: "planar:nav-request" }, location.origin); });
const cold = async (hash) => { await page.goto(`${base}/?cb=${Date.now()}${hash}`, { waitUntil: "domcontentloaded" }); };
const waitNeutral = () => page.waitForFunction(() => { const l = window.__navStates; return l.length && l[l.length - 1].section === "reports"; }, null, { timeout: 25000 });

let created = null;
try {
  // ---- seed one throwaway schedule with one task, linked to the fixture site ----
  const before = new Set((await liveIds()) || []);
  const seed = await s.context.newPage();
  await seed.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
  await seed.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
  if (!(await seed.locator('[data-testid="open-history-desktop"]').count())) { await seed.getByRole("button", { name: "New schedule" }).click(); await seed.waitForTimeout(3000); }
  await seed.waitForTimeout(3000); await seed.close();
  const fresh = ((await liveIds()) || []).filter((i) => !before.has(i));
  if (fresh.length !== 1) throw new Error("expected exactly one new throwaway schedule row, found " + JSON.stringify(fresh));
  created = fresh[0];
  const seedErr = await page.evaluate(async ({ id, site, name }) => {
    const r = await window.pfSupabase.from("schedules").select("rev,data").eq("id", id).single();
    if (r.error) return r.error.message;
    const d = r.data.data || {};
    // The real task shape (same as ui-audit/verify-grid-strip.mjs's fixture): a thinner object crashes the Task Report.
    const task = { id: 1, name: "zz cold-route task", start: "2026-11-02", end: "2026-12-10", duration: 28, predecessors: [], health: "yellow", percentComplete: 10, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 28, predUnresolved: [], meetingBodyMissing: false, finishConflict: false, startConflict: false }; // health "yellow" is the embed's "In Progress" — the Task Report default filter
    const u = await window.pfSupabase.from("schedules").update({ name, data: { ...d, id, name, linkedSiteId: site, linkedSiteName: "E2E Fixture", tasks: Array.isArray(d.tasks) && d.tasks.length ? d.tasks : [task] }, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row");
  }, { id: created, site: FIXTURE_SITE_ID, name: NAME });
  if (seedErr) throw new Error("could not seed the throwaway schedule: " + seedErr);
  console.log("throwaway schedule:", created);

  // ---- K1: a project deep link stays on its project ----
  console.log("\nK1 — cold deep link to the project's schedule");
  await cold(PROJECT_HASH); await page.waitForTimeout(6000);
  known((await hashNow()) === PROJECT_HASH, `#/project/<fixture>/schedule stays put (${await hashNow()})`);

  // ---- K2: a bare-domain boot resumes where the person left off ----
  console.log("\nK2 — bare-domain boot (EMPTY hash) resumes the last project");
  await page.goto(`${base}/?cb=${Date.now()}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(5000);
  known((await hashNow()) === PROJECT_HASH, `bare domain resumes into ${PROJECT_HASH} (${await hashNow()})`);

  // ---- K3: a genuine Task Report row click through the REAL embed still adopts its project ----
  console.log("\nK3 — a real Task Report row click still adopts the row's project");
  await cold("#/schedule"); await waitNeutral().catch(() => {});
  await page.waitForTimeout(2500);
  const frame = page.frames().find((f) => f.url().includes("/sequence"));
  const rowBtn = frame ? frame.locator('button[title^="Open row in"]').first() : null;
  const rowCount = rowBtn ? await rowBtn.count() : 0;
  if (!rowCount && process.env.DEBUG_SHOT) { await page.screenshot({ path: process.env.DEBUG_SHOT }); console.log("  debug: embed text →", frame ? (await frame.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "?")).replace(/\s+/g, " ") : "no frame"); }
  known(rowCount > 0, `the neutral Reports view lists the throwaway task's "Open row in …" link (${rowCount})`);
  if (rowCount > 0) {
    await rowBtn.click();
    await page.waitForFunction((h) => location.hash === h, PROJECT_HASH, { timeout: 8000 }).catch(() => {});
    known((await hashNow()) === PROJECT_HASH, `a genuine row click lands on the project (${await hashNow()})`);
    const clickMsgs = await page.evaluate(() => window.__navStates.filter((m) => m.rowLink));
    ok(clickMsgs.length >= 1 && clickMsgs.every((m) => m.section === "projects"), `the REAL embed marked that announcement rowLink (${clickMsgs.length}×, all on "projects") — new with the fix`);
  }

  if (voids) { console.log(`\nVOID — ${voids} known-good arm(s) did not report their known value; the unknown arms below prove nothing. Not scoring.`); }
  else {
    // ---- U1: cold bare #/schedule, then more embed re-announcements ----
    console.log("\nU1 — cold #/schedule settles bare and STAYS bare through further re-announcements");
    await cold("#/schedule"); await waitNeutral();
    await page.waitForTimeout(1500);
    ok((await hashNow()) === "#/schedule", `settled bare (${await hashNow()})`);
    for (let i = 0; i < 3; i++) { await reannounce(); await page.waitForTimeout(1200); }
    await page.waitForTimeout(2500);
    ok((await hashNow()) === "#/schedule", `still bare after three more embed announcements (${await hashNow()})`);
    ok((await hashesSeen()).every((h) => h === "#/schedule"), `the tab never held any other hash (${JSON.stringify(await hashesSeen())})`);

    // ---- U2: re-announcements DURING the load ----
    console.log("\nU2 — cold #/schedule while the embed re-announces throughout the load");
    await cold("#/schedule");
    for (let i = 0; i < 40; i++) { await reannounce().catch(() => {}); await page.waitForTimeout(150); }
    await page.waitForTimeout(2500);
    ok((await hashNow()) === "#/schedule", `bare at the end (${await hashNow()})`);
    ok((await hashesSeen()).every((h) => h === "#/schedule"), `never held another hash (${JSON.stringify(await hashesSeen())})`);

    // ---- U3: the report's adjacent cases ----
    console.log("\nU3 — adjacent cold loads stay bare");
    for (const h of ["#/notes", "#/markup"]) {
      await cold(h); await page.waitForTimeout(6000);
      ok((await hashNow()) === h, `${h} stays ${h} (${await hashNow()})`);
    }
    await cold("#/review"); await page.waitForTimeout(3000);
    console.log(`  info: "#/review" is not a real slug (Review's is "markup") and falls back to the default module → ${await hashNow()}`);
  }
} catch (e) {
  fails++; console.log("  ✗ FAIL harness error:", e.message);
} finally {
  if (created != null) {
    const matched = await page.evaluate(async (id) => { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id"); return u.error ? "err:" + u.error.message : (u.data || []).length; }, created).catch((e) => "err:" + e.message);
    const gone = !((await liveIds()) || []).includes(created);
    console.log(`\ncleanup: soft-delete matched ${matched}; throwaway ${created} ${gone ? "gone" : "STILL LIVE"}`);
    if (!gone) fails++;
  }
  await s.close();
}
console.log(voids ? "\nRESULT: VOID" : fails ? `\nRESULT: ${fails} FAIL` : "\nRESULT: PASS");
process.exit(voids || fails ? 1 : 0);
