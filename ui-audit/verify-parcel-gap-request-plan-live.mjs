/* V1861056 step 9 / B2428112 — the SAME reason + "Email Michael to request it" link INSIDE a plan (Land › ＋ Add parcels › Add by address), on the real
 * deploy, signed in as the throwaway test account. A throwaway plan located in Pike County KY is created, used, and deleted (owner rule 15, re-read).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-parcel-gap-request-plan-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * The geocoder is stubbed to the exact Pike point (the harness verify-memphis-line-band-live uses the same stub); every parcel server is the real one. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const base = process.argv[2] || "https://planyr.io";
const wantBuild = process.argv[3] || null;
const P = { lat: 37.4791, lng: -82.5188 };
const PLAN_ID = `${LIVE_PREFIX}gaprequest-${Date.now().toString(36)}`;
const s = await openSignedIn({ base });
let code = 1;
try {
  await assertMeasurable(s.page, "verify-parcel-gap-request-plan-live");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (wantBuild && !String(s.build && s.build.build).startsWith(wantBuild)) throw new Error(`served build ${s.build && s.build.build} is not ${wantBuild}`);
  const page = s.page;
  await page.route(/geocode\.arcgis\.com\/.*findAddressCandidates/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ candidates: [{ address: `${P.lat},${P.lng}`, location: { x: P.lng, y: P.lat }, score: 100 }] }) }));
  const plan = { ...throwawayPlan(PLAN_ID), origin: { lat: P.lat, lon: P.lng }, site: "ZZ Live Check — parcel gap request" };
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  if (err) throw new Error("throwaway plan insert failed — " + err);
  await page.goto(`${base}/#/project/${PLAN_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 60000 }).catch(async () => {
    await page.getByRole("button", { name: /^Land$/ }).first().click().catch(() => {});
    await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 30000 });
  });
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="land-add-btn"]').first().click();
  const input = page.locator('input[placeholder="123 Main St, Katy TX"]').first();
  await input.waitFor({ timeout: 8000 });
  await input.fill(`${P.lat}, ${P.lng}`);
  await input.press("Enter");
  await page.waitForTimeout(500);
  const res = page.locator('[data-testid="identify-result"]');
  await res.filter({ hasText: /paid subscription/ }).waitFor({ timeout: 40000 });
  const text = await res.innerText();
  const link = page.getByTestId("identify-gap-request");
  const href = await link.getAttribute("href");
  const u = new URL(href);
  const ok = /Pike County keeps its parcel map behind a paid subscription/.test(text) && (await link.innerText()) === "Email Michael to request it"
    && u.pathname === "michael@planyr.io" && u.searchParams.get("subject") === "Parcel data request: Pike County, KY" && /Point I clicked: 37\.4\d{4}, -82\.5\d{4}/.test(u.searchParams.get("body") || "");
  console.log(`  [${ok ? "PASS" : "FAIL"}] in-plan Pick county lots, Pike KY — "${text.replace(/\n/g, " | ").slice(0, 170)}"`);
  code = ok ? 0 : 1;
} catch (e) { console.error("FAIL", e.message); }
finally {
  const cl = await cleanupLive(s.page, { planId: PLAN_ID }).catch((e) => ({ errors: [String(e)], left: {} }));
  console.log(`cleanup: throwaway plan ${PLAN_ID} → left ${JSON.stringify(cl.left)}${cl.errors && cl.errors.length ? " errors " + cl.errors.join("; ") : ""}`);
  await s.close().catch(() => {});
  process.exit(code);
}
