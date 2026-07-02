/**
 * Headless verification — cross-module project connections (Site ↔ Schedule).
 *
 * Verifies the Scheduler-wrapper logic against the real built app — the half the sandbox can
 * cover. The embedded Gantt app (public/sequence/index.html) talks to its OWN Supabase project,
 * unreachable from this sandbox, so the real iframe never emits its nav-state here. We drive the
 * wrapper through the SAME same-origin postMessage contract the iframe uses (parseNavState /
 * link-changed), exercising Scheduler.jsx + LinkSchedulePanel + the Shell's setScheduleLink mirror.
 * The genuine end-to-end round-trip through the live iframe + its backend is a V### check.
 *
 * Scenarios:
 *   1. Link flow (B493): unlinked site → panel + same-named suggestion → confirm → mirror → panel closes.
 *   2. Anti-oscillation (B560): arrive on site A while the iframe's active schedule is linked to a
 *      DIFFERENT site B → the route must NOT flip to B (no flash), breadcrumb shows A's name.
 *   3. No-UUID (B560): cold load to a site NOT in the store → never show the raw group_id.
 *   4. User push-up (B560): picking a B-linked schedule in the breadcrumb routes to B.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-cross-module-link.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || chromium.executablePath();

let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.error("  ✗ " + m); failures++; };

const site = (gid, name) => ({
  id: gid, groupId: gid, site: name, name: "Plan 1", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "harris",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = (sites) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
  window.__hc = [];
  window.addEventListener('hashchange', () => { try { window.__hc.push(location.hash); } catch (_) {} });
} catch (e) {} })();`;

// Post a bridge message AS the embedded scheduler would (same-origin → passes the origin guard).
const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);
const navState = (projects, activeId) => ({ type: "planar:nav-state", section: "projects", activeId, projects });

async function newPage(browser, sites) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(seedScript(sites));
  // The embedded app's Supabase ref is unreachable here and would hang init; fail it fast.
  await ctx.route(/ksetjztkplttbcehyicv\.supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  return { ctx, page };
}

// ── Scenario 1 — the B493 link flow (unchanged behavior must stay green) ──────────────────
async function scenarioLinkFlow(browser) {
  console.log("Scenario 1 — link flow");
  const GID = "grp-pappa", NAME = "Pappadoupolos", SID = 1;
  const { ctx, page } = await newPage(browser, { [GID]: site(GID, NAME) });
  await page.goto(BASE + "#/project/" + GID + "/schedule", { waitUntil: "load" });
  await page.waitForSelector("iframe", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await postSeq(page, navState([{ id: SID, name: NAME }], SID)); // unlinked

  const panel = page.getByRole("dialog", { name: /connect this site to a schedule/i });
  try { await panel.waitFor({ state: "visible", timeout: 8000 }); ok("resolution panel shown for an unlinked site"); }
  catch (_) { bad("resolution panel never appeared"); }

  const suggest = page.getByRole("button", { name: new RegExp("Link the existing schedule .*" + NAME, "i") });
  try { await suggest.waitFor({ state: "visible", timeout: 4000 }); ok("same-named schedule surfaced as a suggested match"); }
  catch (_) { bad("no suggested same-named match button"); }

  try { await suggest.click({ timeout: 4000 }); } catch (_) { bad("could not click the suggested link"); }
  await postSeq(page, { type: "planar:link-changed", siteId: GID, scheduleId: SID, name: NAME });
  await page.waitForTimeout(700);
  const linked = await page.evaluate((gid) => {
    try { const rec = (JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"))[gid]; return rec ? (rec.scheduleProjectId ?? null) : "no-record"; }
    catch (e) { return "error:" + e.message; }
  }, GID);
  if (linked === SID) ok("site store mirrored the schedule link (scheduleProjectId=" + linked + ")");
  else bad("site store did not record the schedule link (got: " + linked + ")");

  await postSeq(page, navState([{ id: SID, name: NAME, linkedSiteId: GID, linkedSiteName: NAME }], SID));
  try { await panel.waitFor({ state: "hidden", timeout: 6000 }); ok("panel closed once the schedule is linked to the routed site"); }
  catch (_) { bad("panel stayed open after the schedule reported itself linked"); }
  await ctx.close();
}

// ── Scenario 2 — anti-oscillation (B560): no route flip when the iframe is on a DIFFERENT project ──
async function scenarioAntiOscillation(browser) {
  console.log("Scenario 2 — anti-oscillation");
  const A = "grp-a", B = "grp-b";
  const { ctx, page } = await newPage(browser, { [A]: site(A, "Pappadoupolos"), [B]: site(B, "Grand Port") });
  await page.goto(BASE + "#/project/" + A + "/schedule", { waitUntil: "load" });
  await page.waitForSelector("iframe", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  // The iframe's ACTIVE schedule (id:2) is linked to B — a different site than the routed A. A
  // schedule linked to A (id:1) also exists. The OLD code pushed B up → A↔B ping-pong (the flash).
  const projects = [
    { id: 1, name: "Pappadoupolos", linkedSiteId: A, linkedSiteName: "Pappadoupolos" },
    { id: 2, name: "Grand Port", linkedSiteId: B, linkedSiteName: "Grand Port" },
  ];
  await postSeq(page, navState(projects, 2)); // active = the B-linked schedule (mismatch)
  await page.waitForTimeout(1500); // give any loop time to manifest

  const hash = await page.evaluate(() => location.hash);
  const flips = await page.evaluate(() => (window.__hc || []).filter((h) => h.includes("grp-b")).length);
  if (hash === "#/project/" + A + "/schedule" && flips === 0) ok("route stayed on site A — no oscillation to B");
  else bad(`route oscillated (hash=${hash}, B-flips=${flips})`);

  // Breadcrumb shows the ROUTED project (Pappadoupolos), never the active schedule's name / placeholder / id.
  const crumb = await page.evaluate(() => document.body.innerText);
  if (/Pappadoupolos/.test(crumb)) ok("breadcrumb shows the routed project name");
  else bad("breadcrumb did NOT show the routed project name");
  if (!/Select a project|grp-a|grp-b/.test(crumb)) ok("no placeholder or raw group_id leaked into the UI");
  else bad("placeholder/raw id leaked: " + (crumb.match(/Select a project|grp-a|grp-b/) || [])[0]);
  await ctx.close();
}

// ── Scenario 3 — no-UUID (B560): a site not in the store must never render its raw id ──
async function scenarioNoUuid(browser) {
  console.log("Scenario 3 — no raw id");
  const MISSING = "grp-zzz-not-in-store";
  const { ctx, page } = await newPage(browser, {}); // empty site store
  await page.goto(BASE + "#/project/" + MISSING + "/schedule", { waitUntil: "load" });
  await page.waitForSelector("iframe", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await postSeq(page, navState([{ id: 9, name: "Some Other Schedule", linkedSiteId: "grp-other" }], 9));
  await page.waitForTimeout(1200);
  const text = await page.evaluate(() => document.body.innerText);
  if (!text.includes(MISSING)) ok("the unresolved group_id is never shown as a name");
  else bad("raw group_id leaked into the UI: " + MISSING);
  // The resolution panel must NOT offer to create a schedule named the raw id.
  const createsUuid = await page.evaluate((id) =>
    [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes(id)), MISSING);
  if (!createsUuid) ok("no Create button names a schedule the raw id");
  else bad("a Create button would name a schedule the raw id");
  await ctx.close();
}

// ── Scenario 4 — user push-up (B560): picking a B-linked schedule routes to B ──
async function scenarioUserPushUp(browser) {
  console.log("Scenario 4 — user push-up");
  const A = "grp-a", B = "grp-b";
  const { ctx, page } = await newPage(browser, { [A]: site(A, "Pappadoupolos"), [B]: site(B, "Grand Port") });
  await page.goto(BASE + "#/project/" + A + "/schedule", { waitUntil: "load" });
  await page.waitForSelector("iframe", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const projects = [
    { id: 1, name: "Pappadoupolos", linkedSiteId: A, linkedSiteName: "Pappadoupolos" },
    { id: 2, name: "Grand Port", linkedSiteId: B, linkedSiteName: "Grand Port" },
  ];
  await postSeq(page, navState(projects, 1)); // active = A's schedule (consistent with the route)
  await page.waitForTimeout(600);
  // Open the breadcrumb switcher and pick the B-linked schedule (id:2).
  let picked = false;
  try {
    await page.locator('[title="Switch project"]').first().click({ timeout: 4000 });
    await page.locator('[data-testid="project-row-2"]').click({ timeout: 4000 });
    picked = true;
  } catch (_) { /* fall through to report */ }
  if (!picked) { bad("could not open the breadcrumb and pick a schedule"); await ctx.close(); return; }
  await page.waitForTimeout(800);
  const hash = await page.evaluate(() => location.hash);
  if (hash === "#/project/" + B + "/schedule") ok("picking a B-linked schedule routed the project to B");
  else bad("route did not follow the picked schedule (hash=" + hash + ")");
  await ctx.close();
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  try {
    await scenarioLinkFlow(browser);
    await scenarioAntiOscillation(browser);
    await scenarioNoUuid(browser);
    await scenarioUserPushUp(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\nFAILED (${failures} check${failures === 1 ? "" : "s"})` : "\nPASS — cross-module link + anti-regression verified");
  process.exit(failures ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
