/**
 * B707–B712 headless self-check (sandbox, logged-out): seeds a georeferenced site
 * with a parcel + an anchored pond + a building, opens the planner, and asserts the
 * new floodplain-suite UI renders its honest states:
 *   1. pond inspector — the new anchor fields (Permanent pool / Receiving flowline)
 *      + the Detention storage section;
 *   2. Yield — the ⛆ drainage check affordance + the Earthwork cost section with the
 *      explicit "not screened yet" line (NEVER a silent 0);
 *   3. Site Analysis — the Floodplain mitigation & buildability card (not-checked state).
 * Run: npm run build && npx vite preview  (port 4173), then node this file.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = "/tmp/claude-0/-home-user-planyr/02d058c3-0fc6-56a9-aff7-914e594b14c9/scratchpad/screens/";
mkdirSync(OUT, { recursive: true });

const site = {
  id: "s_floodmit",
  groupId: "s_floodmit",
  site: "Floodmit Smoke Site",
  name: "Plan 1",
  status: "active",
  origin: { lat: 29.77, lon: -95.65 },
  county: "harris",
  parcels: [{ id: "p1", active: true, points: [{ x: -600, y: -450 }, { x: 600, y: -450 }, { x: 600, y: 450 }, { x: -600, y: 450 }] }],
  els: [
    { id: "pond1", type: "pond", cx: 0, cy: 0, w: 300, h: 220, rot: 0, det: { depth: 8, freeboard: 1, slope: 3, tobElev: 96, poolElev: 90 } },
    { id: "b1", type: "building", cx: 0, cy: -320, w: 400, h: 180, rot: 0, dock: "cross" },
  ],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(),
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_floodmit: ${JSON.stringify(site)} }));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok, extra }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  // open the seeded site from the Your Sites rail (the finder is the landing surface)
  await page.getByText("Floodmit Smoke Site", { exact: false }).first().click();
  await page.waitForTimeout(3000);
  // the site card / plan list may need a second click to enter the plan
  const openPlan = page.getByText(/Open plan|Plan 1/i).first();
  if (await openPlan.count()) { try { await openPlan.click({ timeout: 2500 }); await page.waitForTimeout(2500); } catch (_) {} }
  await page.screenshot({ path: OUT + "01-planner.png" });

  const canvas = page.locator("svg").first();
  check("planner SVG canvas rendered", await canvas.count() > 0);

  // ---- 1. select the pond (centered in the seeded view) → inspector fields ----
  const box = await page.locator("main, body").first().boundingBox();
  // click the canvas center a few px around until the Detention storage section appears
  let pondSelected = false;
  for (const [dx, dy] of [[0, 0], [20, 10], [-25, -12], [0, 30]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await page.waitForTimeout(400);
    if (await page.getByText("Detention storage", { exact: false }).count()) { pondSelected = true; break; }
  }
  check("pond selected (Detention storage section)", pondSelected);
  if (pondSelected) {
    check("Permanent pool elev. field", (await page.getByText("Permanent pool elev.", { exact: false }).count()) > 0);
    check("Receiving flowline elev. field", (await page.getByText("Receiving flowline elev.", { exact: false }).count()) > 0);
    check("NAVD88 / NGVD29 datum note", (await page.getByText("NGVD29", { exact: false }).count()) > 0);
    check("pool dead-storage note (anchored, no WSE)", (await page.getByText("dead storage", { exact: false }).count()) > 0);
    await page.screenshot({ path: OUT + "02-pond-inspector.png" });
  }

  // ---- 1b. B713: a fill element's inspector carries the pad-elevation field ----
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // the building sits above canvas center in the seeded layout
  let bldgSelected = false;
  for (const dy of [-320, -300, -340]) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + dy * 0.5);
    await page.waitForTimeout(350);
    if (await page.getByText("Pad elev.", { exact: false }).count()) { bldgSelected = true; break; }
  }
  check("fill element shows the Pad elev. field (B713)", bldgSelected);

  // ---- 2. Yield: drainage check + earthwork cost honest states ----
  // deselect, then open the Yield left-rail panel
  await page.keyboard.press("Escape");
  const yieldTab = page.getByText(/^Yield/, { exact: false }).first();
  try { await yieldTab.click({ timeout: 4000 }); } catch (_) { /* may already be open */ }
  await page.waitForTimeout(600);
  check("⛆ Check drainage criteria button", (await page.getByText("Check drainage criteria", { exact: false }).count()) > 0);
  check("Earthwork cost section", (await page.getByText("Earthwork cost", { exact: false }).count()) > 0);
  // expand the collapsed Earthwork section and confirm the not-screened line
  try {
    await page.getByText("Earthwork cost", { exact: false }).first().click({ timeout: 3000 });
    await page.waitForTimeout(400);
  } catch (_) {}
  check("earthwork: pond excavation line", (await page.getByText("Pond excavation", { exact: false }).count()) > 0);
  check("earthwork: NOT-screened warning (never silent 0)", (await page.getByText("not screened yet", { exact: false }).count()) > 0);
  await page.screenshot({ path: OUT + "03-yield.png" });

  // ---- 2b. run the drainage check → in-sandbox the GIS hosts are blocked, so the
  // HONEST failure states must render (never a silent nothing / fabricated clear) ----
  try {
    await page.getByText("Check drainage criteria", { exact: false }).first().click({ timeout: 3000 });
    // sandbox fetch timeouts + jittered retries across ~8 GIS sources can run long
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(4000);
      if (!(await page.getByText(/Checking drainage criteria/i).count())) break;
    }
    const errState = (await page.getByText(/Couldn't resolve the drainage authority|unavailable/i).count()) > 0;
    const okState = (await page.getByText(/Detention required/i).count()) > 0;
    check("drainage check resolves to an HONEST state (error or result)", errState || okState, errState ? "error state (expected in sandbox)" : "result state");
    await page.screenshot({ path: OUT + "04-drainage-after-check.png" });
  } catch (e) { check("drainage check click", false, e.message); }

  // ---- 3. Site Analysis: the mitigation & buildability card ----
  const saTab = page.getByText("Site Analysis", { exact: false }).first();
  try { await saTab.click({ timeout: 4000 }); await page.waitForTimeout(800); } catch (_) {}
  check("Floodplain mitigation & buildability card", (await page.getByText("Floodplain mitigation", { exact: false }).count()) > 0);
  await page.screenshot({ path: OUT + "05-analysis-card.png" });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
