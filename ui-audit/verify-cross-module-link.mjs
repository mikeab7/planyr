/**
 * Headless verification — cross-module project connections (Site ↔ Schedule).
 *
 * Verifies the NEW Scheduler-wrapper logic against the real built app, the half the sandbox can
 * cover. The embedded Gantt app (public/sequence/index.html) talks to its OWN Supabase project,
 * which is NOT reachable from this sandbox, so the real iframe never emits its nav-state here.
 * We therefore drive the wrapper through the SAME same-origin postMessage contract the iframe
 * uses (parseNavState / link-changed) — this exercises every line of Scheduler.jsx +
 * LinkSchedulePanel + the Shell's setScheduleLink mirror. The genuine end-to-end round-trip
 * through the live iframe + its backend is logged as a V### check in VERIFICATION.md.
 *
 * Asserts:
 *   1. Landing on #/project/<gid>/schedule with an UNLINKED same-named schedule shows the
 *      "Connect a schedule" panel + the suggested same-named match (suggest-and-confirm).
 *   2. Confirming the link (the iframe echoes link-changed) mirrors scheduleProjectId onto the
 *      logged-out site store (planarfit:sites:v1) via the Shell.
 *   3. Once a schedule reports itself LINKED to the routed site, the panel disappears (the
 *      project-aware payoff — the tab now carries straight through to the connected schedule).
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-cross-module-link.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const GID = "grp-pappa";
const SITE_NAME = "Pappadoupolos";
const SCHED_ID = 1;

const sites = {
  [GID]: {
    id: GID, groupId: GID, site: SITE_NAME, name: "Plan 1", status: "active",
    origin: { lat: 29.77, lon: -95.38 }, county: "harris",
    parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
    updatedAt: Date.now(),
  },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

// Post a bridge message AS the embedded scheduler would (same-origin → passes the wrapper's
// origin guard). Runs in the page so window.location.origin is correct.
const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);

const navState = (projects) => ({ type: "planar:nav-state", section: "projects", activeId: SCHED_ID, projects });
const UNLINKED = [{ id: SCHED_ID, name: SITE_NAME }];
const LINKED = [{ id: SCHED_ID, name: SITE_NAME, linkedSiteId: GID, linkedSiteName: SITE_NAME }];

const EXEC = process.env.PW_CHROME || chromium.executablePath();
let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.error("  ✗ " + m); failures++; };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(seed);
  // The embedded app's own Supabase ref is unreachable here and would hang its init; fail those
  // requests fast so they don't slow the page. The wrapper logic under test doesn't need them.
  await ctx.route(/ksetjztkplttbcehyicv\.supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();

  await page.goto(BASE + "#/project/" + GID + "/schedule", { waitUntil: "load" });
  await page.waitForSelector("iframe", { timeout: 15000 }).catch(() => {});
  // Drive the wrapper with the iframe's nav-state (unlinked) — this also flips it "ready".
  await page.waitForTimeout(500);
  await postSeq(page, navState(UNLINKED));

  // 1 — resolution panel + same-named suggestion.
  const panel = page.getByRole("dialog", { name: /connect this site to a schedule/i });
  try { await panel.waitFor({ state: "visible", timeout: 8000 }); ok("resolution panel shown for an unlinked site"); }
  catch (_) { bad("resolution panel never appeared"); }

  const suggest = page.getByRole("button", { name: new RegExp("Link the existing schedule .*" + SITE_NAME, "i") });
  try { await suggest.waitFor({ state: "visible", timeout: 4000 }); ok("same-named schedule surfaced as a suggested match"); }
  catch (_) { bad("no suggested same-named match button"); }

  // 2 — confirm the link. The wrapper posts nav-link to the iframe; the iframe would echo
  // link-changed, which the Shell mirrors onto the site store. Simulate that echo.
  try { await suggest.click({ timeout: 4000 }); } catch (_) { bad("could not click the suggested link"); }
  await postSeq(page, { type: "planar:link-changed", siteId: GID, scheduleId: SCHED_ID, name: SITE_NAME });
  await page.waitForTimeout(700);
  const linked = await page.evaluate((gid) => {
    try { const rec = (JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"))[gid]; return rec ? (rec.scheduleProjectId ?? null) : "no-record"; }
    catch (e) { return "error:" + e.message; }
  }, GID);
  if (linked === SCHED_ID) ok("site store mirrored the schedule link (scheduleProjectId=" + linked + ")");
  else bad("site store did not record the schedule link (got: " + linked + ")");

  // 3 — the iframe now reports the schedule as LINKED → panel disappears (project-aware payoff).
  await postSeq(page, navState(LINKED));
  try { await panel.waitFor({ state: "hidden", timeout: 6000 }); ok("panel closed once the schedule is linked to the routed site"); }
  catch (_) { bad("panel stayed open after the schedule reported itself linked"); }

  await browser.close();
  console.log(failures ? `\nFAILED (${failures} check${failures === 1 ? "" : "s"})` : "\nPASS — cross-module link wrapper verified");
  process.exit(failures ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
