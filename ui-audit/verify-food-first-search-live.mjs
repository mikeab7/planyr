/* V1446736 / V1446737 (B2021648 / B2021649) — live, signed in as the test account.
 *   node ui-audit/verify-food-first-search-live.mjs [https://planyr.io] [runs=3]
 * Per fresh page load: records every food_places_search_by_name request's duration (the mount warm-up
 * is the first; the user's first typed search is the next) and the keystroke→first-row time. Then
 * checks "dao" never lists a saved Dairy Queen while "dairy" does (tagged). The saved Dairy Queen is a
 * THROWAWAY food_visits row on the test account, deleted at the end (and re-checked gone). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const RUNS = Number(process.argv[3] || 3);
const H = "verify-food-first-search-live";
const s = await openSignedIn({ base });
const { page: signInPage } = s;
let page = signInPage;
let visitId = null, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
try {
  await assertMeasurable(page, H);
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  console.log("served build:", JSON.stringify(build), "| signed in as", s.proof.email);

  // Throwaway saved Dairy Queen on the TEST account only.
  const dq = await page.evaluate(async () => {
    const { data } = await window.pfSupabase.from("food_places").select("id,name,address").ilike("name", "Dairy Queen%").limit(1);
    return data && data[0];
  });
  ok(!!dq, "found a Dairy Queen in the snapshot: " + (dq && dq.name));
  const ins = await page.evaluate(async (placeId) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { data, error } = await window.pfSupabase.from("food_visits")
      .insert({ user_id: u.user.id, place_id: placeId, visited_on: "2026-10-08", rating: 7 }).select("id").single();
    return { id: data && data.id, error: error && error.message };
  }, dq.id);
  ok(!!ins.id, "seeded throwaway saved Dairy Queen visit" + (ins.error ? " — " + ins.error : ""));
  visitId = ins.id;

  const results = [];
  for (let run = 1; run <= RUNS; run++) {
    if (page !== signInPage) await page.close(); page = await s.context.newPage(); // new document per run so the init-script observer is installed
    await page.addInitScript(() => {
      window.__rpc = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name.includes("food_places_search_by_name")) window.__rpc.push({ start: Math.round(e.startTime), ms: Math.round(e.responseEnd - e.startTime) }); }).observe({ type: "resource", buffered: true });
    });
    await page.goto(base + "/#/food", { waitUntil: "domcontentloaded" });
    const box = page.getByTestId("food-search-box");
    await box.waitFor({ state: "visible", timeout: 30000 });
    await pacedWait(page, 4000); // let the mount warm-up + data loads settle, as a person opening the page would
    const t0 = Date.now();
    await box.click();
    await box.pressSequentially("dao", { delay: 60 });
    const rowsSel = '[data-testid="food-search-results"] button';
    await page.waitForSelector(rowsSel, { timeout: 20000 }).catch(() => {});
    const firstRowMs = Date.now() - t0;
    await pacedWait(page, 1500);
    const names = await page.$$eval(rowsSel, (b) => b.map((x) => x.innerText.split("\n")[0]));
    const rpc = await page.evaluate(() => window.__rpc);
    // later searches in the same page load
    const later = [];
    for (const q of ["pho", "sushi", "bbq"]) {
      await box.fill(""); await pacedWait(page, 300);
      const before = (await page.evaluate(() => window.__rpc.length));
      await box.pressSequentially(q, { delay: 60 });
      await page.waitForFunction((n) => window.__rpc.length > n, before, { timeout: 15000 }).catch(() => {});
      await pacedWait(page, 400);
      const r = await page.evaluate(() => window.__rpc);
      later.push(r[r.length - 1] && r[r.length - 1].ms);
    }
    results.push({ run, names, rpc, firstRowMs, later });
    console.log(`run ${run}: rpc durations (ms, in order) = ${rpc.map((r) => r.ms).join(", ")} | "dao" first row after ${firstRowMs} ms | later searches ${later.join(", ")} ms | rows: ${names.join(" | ")}`);
    ok(!names.some((n) => /dairy queen/i.test(n)), `run ${run}: "dao" does not list Dairy Queen`);
  }

  // saved Dairy Queen still found by a real match
  const box = page.getByTestId("food-search-box");
  await box.fill(""); await box.pressSequentially("dairy", { delay: 60 });
  await page.waitForSelector('[data-testid="food-search-results"] button', { timeout: 20000 }).catch(() => {});
  await pacedWait(page, 1500);
  const dairy = await page.$$eval('[data-testid="food-search-results"] button', (b) => b.map((x) => x.innerText.replace(/\n/g, " · ")));
  console.log('"dairy" rows:', dairy.join(" | "));
  ok(dairy.some((r) => /dairy queen/i.test(r) && /been here/i.test(r)), '"dairy" lists the saved Dairy Queen tagged Been here');
  const dao = results[0].names;
  ok(dao.length > 0 && /dao/i.test(dao[0]), `"dao" rows start with a real Dao match (${dao[0]})`);
} catch (e) { console.error("ERROR", e.message); fail++; }
finally {
  if (visitId) {
    page = signInPage; await page.goto(base + "/", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20000 }).catch(() => {});
    const gone = await page.evaluate(async (id) => {
      await window.pfSupabase.from("food_visits").delete().eq("id", id);
      const { data } = await window.pfSupabase.from("food_visits").select("id").eq("id", id);
      return !data || data.length === 0;
    }, visitId).catch(() => false);
    ok(gone, "cleanup: throwaway visit deleted and confirmed gone");
  }
  await s.close();
}
process.exit(fail ? 1 : 0);
