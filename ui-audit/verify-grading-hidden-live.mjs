/* verify-grading-hidden-live (V1742993) — the owner-only grading layer is INVISIBLE to every other account.
 * Signs in as the throwaway test account (authenticated only, not in admin_users), opens the Site Planner
 * and the fixture plan, and asserts: the is_admin() answer is false; Site Analysis has no Ground group;
 * Layers has no "Buildable at"/"Cut & Fill" rows; no GradingController/GradingPanels chunk was requested.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-grading-hidden-live.mjs [https://planyr.io] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.argv[2] || "https://planyr.io";
const out = [], bad = [];
const ok = (n, c, x = "") => (c ? out : bad).push(`${c ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`);
const s = await openSignedIn({ base: BASE });
const page = s.page;
try {
  await assertMeasurable(page, "verify-grading-hidden-live");
  const chunks = [], rpc = [];
  page.on("request", (r) => { if (/Grading(Controller|Panels)/.test(r.url())) chunks.push(r.url()); });
  page.on("response", async (r) => { if (/rpc\/is_admin/.test(r.url())) { try { rpc.push(await r.text()); } catch (_) {} } });
  const ver = await page.evaluate(() => fetch("/version.json").then((r) => r.json()));
  console.log("served build", JSON.stringify(ver), "signed in as", s.proof.email);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.getByText("e2e", { exact: false }).filter({ visible: true }).first().click({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const admin = await page.evaluate(async () => (await window.pfSupabase.rpc("is_admin")).data);
  ok("is_admin() is false for the test account", admin === false, String(admin));
  const analysis = page.getByRole("button", { name: /Site Analysis|Analysis/ }).filter({ visible: true }).first();
  if (await analysis.count()) { await analysis.click().catch(() => {}); await page.waitForTimeout(2500); }
  const panelUp = (await page.locator('[data-site-analysis="1"]').count()) > 0 || (await page.locator('[data-panel-body="analysis"]').count()) > 0;
  ok("known-good arm: the Site Analysis panel really is open (else the absence below proves nothing)", panelUp);
  ok("no Ground group in Site Analysis", (await page.locator('[data-section="ground"]').count()) === 0);
  const layers = page.getByRole("button", { name: /Layers/ }).filter({ visible: true }).first();
  if (await layers.count()) { await layers.click().catch(() => {}); await page.waitForTimeout(1500); }
  ok("no Buildable / Cut & Fill rows in Layers", (await page.locator('[data-testid^="layer-row-grading-"]').count()) === 0 && (await page.getByText(/Buildable at|Cut & Fill/).count()) === 0);
  ok("no Building grading tab", (await page.locator('[data-grading-tab]').count()) === 0);
  ok("no GradingController / GradingPanels chunk requested", chunks.length === 0, chunks.join(","));
  console.log(`planner reached: ${(await page.locator("svg").count()) > 0}`);
} finally { await s.close(); }
console.log([...out, ...bad].join("\n"));
process.exit(bad.length ? 1 : 0);
