/* verify-dashboard-comp-focus-live — NEW-1 (2026-11-15): clicking the Dashboard's Comps card must land on
 * the Site Planner map with the Records tab open AND the featured comp focused (its record open), the
 * same as clicking its map pin or its Records row. Closes V989200 step 4.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-dashboard-comp-focus-live.mjs [https://planyr.io]
 *
 * Signed in as the throwaway test account (openSignedIn). Seeds ONE throwaway comp (newest, so it is the
 * Comps card's featured comp), clicks the card, asserts the record is open, and ALWAYS deletes the comp
 * (owner rule 15 — test artifacts are cleared without asking). Never touches any other row.
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL §6 / vacuity): the control arm opens the SAME comp by clicking its Records
 * row; if that arm does not open the record, the run is VOID, not scored — so a red result on the card arm
 * means the card, not the instrument. Red on a build without the fix (the card arm fails, the row arm passes).
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const TITLE = `ZZ e2e focus probe ${Date.now()}`;
let s, seededId = null, failed = false;
const say = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed = true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, ms = 20000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; }
}

try {
  s = await openSignedIn({ base });
  const { page } = s;
  await assertMeasurable(page, "verify-dashboard-comp-focus-live");
  console.log("build:", JSON.stringify(s.build));

  // 1. seed one throwaway lease comp through the app's own signed-in Supabase client
  const seeded = await page.evaluate(async (title) => {
    const sb = window.pfSupabase;
    const { data: au } = await sb.auth.getUser();
    const { data, error } = await sb.from("comps").insert({
      comp_type: "lease", comp_date: new Date().toISOString().slice(0, 10), title,
      anchor_kind: "pin", lat: 29.7604, lon: -95.3698, county: "harris",
      lease_rate: 0.63, lease_rate_period: "monthly", lease_rate_expense: "nnn", lease_size_sf: 137171,
    }).select("id").single();
    return { id: data?.id || null, error: error ? error.message : null, uid: au?.user?.id || null };
  }, TITLE);
  if (!seeded.id) throw new Error("seed failed: " + seeded.error);
  seededId = seeded.id;
  console.log("seeded throwaway comp", seededId);

  const recordOpen = () => page.evaluate((t) => {
    const n = document.querySelector('[data-testid="comp-record-name"]');
    return !!n && n.textContent.includes(t);
  }, TITLE);
  const openOnDashboard = async () => {
    await page.goto(base + "/#/dashboard", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    const ok = await waitFor(page, () => {
      const c = document.querySelector('[data-card-key="compsSummary"] [role="button"]');
      return !!c && /latest of/i.test(document.querySelector('[data-card-key="compsSummary"]').textContent || "");
    }, null, 30000);
    if (!ok) console.log("card now reads:", JSON.stringify(await page.evaluate(() => (document.querySelector('[data-card-key="compsSummary"]')?.outerHTML || "no card").slice(0, 600))));
    return ok;
  };

  // 2. CONTROL ARM — open the same comp from its Records row (the known-good behaviour)
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  const rowSel = `text=${TITLE}`;
  let rowOk = false;
  try {
    // Records tab is the default rail tab for comps only once chosen; open it if a tab control exists.
    const tab = page.getByRole("tab", { name: /records/i }).first();
    if (await tab.count()) await tab.click().catch(() => {});
    await page.locator(rowSel).first().click({ timeout: 30000 });
    rowOk = await waitFor(page, (t) => !!document.querySelector('[data-testid="comp-record-name"]')?.textContent.includes(t), TITLE, 15000);
  } catch { /* handled below */ }
  if (!rowOk) { console.log("VOID: the control arm (Records row → record) did not open the record — the instrument cannot see the thing, no verdict."); process.exitCode = 2; throw new Error("void"); }
  say(true, "control arm: Records row opens the comp's record (instrument can see it)");

  // 3. THE CLAIM — Dashboard card click
  if (!(await openOnDashboard())) throw new Error("Comps card did not render on the Dashboard");
  const cardText = await page.locator('[data-card-key="compsSummary"]').first().innerText();
  console.log("card text:", JSON.stringify(cardText.slice(0, 160)));
  await page.locator('[data-card-key="compsSummary"] [role="button"]').first().click();
  await waitFor(page, () => location.hash.startsWith("#/site"), null, 15000);
  say(await page.evaluate(() => location.hash.startsWith("#/site")), "card click routes to #/site");
  const opened = await waitFor(page, (t) => !!document.querySelector('[data-testid="comp-record-name"]')?.textContent.includes(t), TITLE, 20000);
  say(opened, "the featured comp's record is open (focused) after the card click");
  const listStillShown = await page.evaluate(() => !!document.querySelector("[data-records-header]") && !document.querySelector('[data-testid="comp-record-name"]'));
  say(!listStillShown, "the Records list is NOT left showing with nothing focused");

  // 4. a repeat click on the SAME comp re-fires (new token) — go back to the list, click the card again
  await sleep(500);
  await openOnDashboard();
  await page.locator('[data-card-key="compsSummary"] [role="button"]').first().click();
  say(await waitFor(page, (t) => !!document.querySelector('[data-testid="comp-record-name"]')?.textContent.includes(t), TITLE, 20000),
    "a second visit (fresh Dashboard → card) focuses the comp again");
} catch (e) {
  if (e.message !== "void") { console.error("ERROR", e.message); failed = true; }
} finally {
  if (seededId && s) {
    const del = await s.page.evaluate(async (id) => {
      const { error, count } = await window.pfSupabase.from("comps").delete({ count: "exact" }).eq("id", id);
      const { data } = await window.pfSupabase.from("comps").select("id").eq("id", id);
      return { error: error ? error.message : null, gone: !(data && data.length) };
    }, seededId).catch((e) => ({ error: String(e), gone: false }));
    console.log(del.gone ? "cleanup: throwaway comp deleted and confirmed gone" : "CLEANUP FAILED: " + JSON.stringify(del));
    if (!del.gone) failed = true;
  }
  if (s) await s.close();
  if (process.exitCode !== 2) process.exit(failed ? 1 : 0);
}
