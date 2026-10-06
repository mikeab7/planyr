/* V1519600 / B626576 (×2) — Food half-step rating slider, SIGNED IN, on emulated iPhones, upright + sideways.
 *
 * Runs in the `webkit-phone` project (PW_WEBKIT_PHONE=1) against a real deploy (BASE_URL) as the seeded
 * test account (E2E_LOGIN_KEY or E2E_EMAIL/E2E_PASSWORD — never printed). Four combinations:
 * iPhone 15 and iPhone SE, each upright and landscape.
 *
 * WHAT IS REAL AND WHAT IS NOT (PHONE-TESTING.md): Playwright's WebKit has no touch-drag primitive
 * (page.touchscreen only taps), so the TOUCH DRAG of the slider runs in Chromium with the same iPhone
 * descriptor through CDP Input.dispatchTouchEvent (a real touch pipeline, but Chromium's — not Safari's).
 * Everything that is layout / structure / display after a reload is read in WebKit.
 *
 *  A. Chromium + touch: first visit → Food and Ambiance are ONE slider each (1–10, step 0.5, "Not rated"),
 *     no tap-button grid (dish score included); a touch DRAG sets Food and Ambiance to chosen half-steps;
 *     Save; the stored row holds exactly those values.
 *  B. WebKit, fresh page (= reload): the card shows those exact values; "Log a visit" (log another) and
 *     the edit form each show the same two sliders, no tap grid.
 *  C. A quarter-point rating written the way an old save would be (8.75 / 7.25) still displays as saved on
 *     the card and in the edit form.
 *
 * Writes only on the test account; everything created is deleted in `finally` and asserted gone. */
import { test, expect, devices, chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { hasAccount, STORAGE_STATE } from "./helpers.js";

test.describe.configure({ mode: "serial" });

const COMBOS = ["iPhone 15", "iPhone 15 landscape", "iPhone SE", "iPhone SE landscape"];
const FOOD = 7.5, AMBIANCE = 6.5; // the half-steps the touch drag has to land on
const OLD_FOOD = 8.75, OLD_AMBIANCE = 7.25; // quarter points saved in the older period

const build = (page) => page.evaluate(async () => ({
  version: await (await fetch("/version.json", { cache: "no-store" })).json().catch(() => null),
  chunks: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src").split("/").pop()).filter((s) => /food|index/i.test(s)),
  viewport: [innerWidth, innerHeight], touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches,
}));
const who = (page) => page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data?.user?.email);
const visitIds = (page) => page.evaluate(async () => ((await window.pfSupabase.from("food_visits").select("id")).data || []).map((r) => r.id));

async function openFood(page) {
  await page.goto("/#/food");
  await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20_000 });
  await page.evaluate(() => document.activeElement?.blur?.());
}

/** Search and open a place. `name` = reopen that exact place; otherwise the first never-visited result. */
async function openPlace(page, name) {
  const box = page.locator('[data-testid="food-search-box"]');
  await box.tap();
  await page.keyboard.press("Control+a").catch(() => {});
  await box.pressSequentially(name || "pizza", { delay: 40 });
  await page.waitForSelector('[data-testid="food-search-results"] button', { timeout: 30_000 });
  const rows = page.locator('[data-testid="food-search-results"] button');
  const n = await rows.count();
  let picked = null;
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).innerText();
    if (/live search/i.test(t)) continue;
    if (name ? !t.includes(name) : /been here/i.test(t)) continue;
    picked = t.split("\n")[0].trim();
    await rows.nth(i).tap();
    break;
  }
  expect(picked, name ? `result "${name}" found` : "a never-visited result exists").toBeTruthy();
  await page.waitForSelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]');
  await page.evaluate(() => document.activeElement?.blur?.());
  return picked;
}

/** The structural contract of one open visit form: Food + Ambiance = ONE slider each, 1–10 step 0.5,
 *  no tap-button grid anywhere (the dish score included), no stray number buttons. Returns what it read. */
async function assertSliders(page, form, where, { fresh }) {
  const sliders = form.locator('[data-testid="rating-slider"]');
  await expect(sliders, `${where}: exactly two rating sliders (Food, Ambiance)`).toHaveCount(2);
  const attrs = await sliders.evaluateAll((els) => els.map((e) => ({ type: e.type, min: e.min, max: e.max, step: e.step, label: e.getAttribute("aria-label"), vt: e.getAttribute("aria-valuetext"), value: e.value })));
  expect(attrs.map((a) => a.label), where).toEqual(["Food rating", "Ambiance rating"]);
  for (const a of attrs) expect([a.type, a.min, a.max, a.step], `${where}: ${a.label} is a 1–10 range, step 0.5`).toEqual(["range", "1", "10", "0.5"]);
  if (fresh) for (const a of attrs) expect(a.vt, `${where}: ${a.label} starts "not rated"`).toBe("not rated");
  const grid = await page.locator('[data-testid^="score-tap"]').count();
  expect(grid, `${where}: no tap-button grid anywhere on the page`).toBe(0);
  const numberButtons = await form.locator("button").evaluateAll((bs) => bs.map((b) => (b.textContent || "").trim()).filter((t) => /^(10|[1-9])(\.\d+)?$/.test(t)));
  expect(numberButtons, `${where}: no numbered rating buttons in the form`).toEqual([]);
  return attrs;
}

/** Drag a range slider with a real finger (CDP touch) until it reads `target`, touching only. */
async function touchSetSlider(page, cdp, slider, target) {
  // centre it in its scroller: at the edge it can sit under the sticky Save bar, which would eat the touch
  await slider.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const read = () => slider.evaluate((e) => Number(e.value));
  const geom = async () => { const b = await slider.boundingBox(); return { x: b.x, y: b.y + b.height / 2, w: b.width }; };
  const xFor = (g, v) => g.x + 14 + ((v - 1) / 9) * (g.w - 28); // 28 px thumb
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const drag = async (x0, x1, y) => {
    await send("touchStart", [{ x: x0, y, id: 1 }]);
    const steps = 10;
    for (let i = 1; i <= steps; i++) { await new Promise((r) => setTimeout(r, 25)); await send("touchMove", [{ x: x0 + ((x1 - x0) * i) / steps, y, id: 1 }]); }
    await send("touchEnd", []);
    await new Promise((r) => setTimeout(r, 150));
  };
  let g = await geom();
  const hit = await slider.evaluate((e, [x, y]) => { const t = document.elementFromPoint(x, y); return t === e; }, [xFor(g, 5.5), g.y]);
  expect(hit, "the touch point lands on the slider itself (nothing floats over it)").toBe(true);
  await drag(xFor(g, 5.5), xFor(g, target), g.y); // the thumb rests at 5.5 before any touch
  for (let tries = 0; tries < 8 && (await read()) !== target; tries++) {
    g = await geom();
    const v = await read();
    const x0 = xFor(g, v);
    await drag(x0, x0 + ((target - v) / 9) * (g.w - 28), g.y); // a small touch-drag from the thumb toward the target
  }
  return read();
}

for (const label of COMBOS) {
  test.describe(`Food rating slider on ${label} (signed in)`, () => {
    const { defaultBrowserType, ...descriptor } = devices[label];
    test.use({ ...descriptor, storageState: STORAGE_STATE, ignoreHTTPSErrors: false });
    test.skip(!hasAccount, "needs the seeded test account (E2E_LOGIN_KEY or E2E_EMAIL/E2E_PASSWORD)");

    test("one half-step slider each; touch-drag saves the exact value; quarter points still read as saved", async ({ page, baseURL }, info) => {
      test.setTimeout(420_000);
      const report = [];
      const note = (s) => { report.push(s); console.log(`[${label}] ${s}`); };

      await openFood(page);
      const b0 = await build(page);
      const email = await who(page);
      expect(email, "must be the test account — never Michael's").toBe("e2e@planyr.test");
      note(`WebKit build ${JSON.stringify(b0.version)} · chunks ${b0.chunks.join(",")} · viewport ${b0.viewport.join("x")} · touch ${b0.touch} · coarse ${b0.coarse} · signed in as ${email}`);
      const baseline = new Set(await visitIds(page));

      const cb = await chromium.launch({ args: ["--no-sandbox"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) });
      try {
        // ── A. Chromium + real touch: first visit, drag the sliders, save ───────────────────────────
        const cctx = await cb.newContext({ ...descriptor, storageState: STORAGE_STATE, baseURL, ignoreHTTPSErrors: false });
        const cpage = await cctx.newPage();
        await openFood(cpage);
        const cbuild = await build(cpage);
        note(`Chromium(touch) build ${JSON.stringify(cbuild.version)} · viewport ${cbuild.viewport.join("x")} · touch ${cbuild.touch} · coarse ${cbuild.coarse}`);
        expect(cbuild.version?.build, "Chromium and WebKit read the same deploy").toBe(b0.version?.build);
        expect(await who(cpage)).toBe("e2e@planyr.test");

        const place = await openPlace(cpage);
        await expect(cpage.locator('[data-testid="food-visit-card"]'), "place has no prior visit").toHaveCount(0);
        await cpage.locator('[data-testid="food-log-visit-btn"]').tap();
        const cform = cpage.locator("form").filter({ has: cpage.locator('[data-testid="rating-slider"]') });
        await expect(cform).toBeVisible();
        const a1 = await assertSliders(cpage, cform, "first visit (Chromium)", { fresh: true });
        expect(await cform.locator('[data-testid="dish-score-slider"]').count(), "dish score is a slider").toBeGreaterThanOrEqual(1);
        note(`PASS first visit "${place}": 2 sliders ${JSON.stringify(a1.map((a) => [a.label, a.min, a.max, a.step, a.vt]))}, dish score = slider, no tap grid`);

        const cdp = await cctx.newCDPSession(cpage);
        const sliders = cform.locator('[data-testid="rating-slider"]');
        const gotFood = await touchSetSlider(cpage, cdp, sliders.nth(0), FOOD);
        const gotAmb = await touchSetSlider(cpage, cdp, sliders.nth(1), AMBIANCE);
        expect([gotFood, gotAmb], "touch-drag landed on the exact half-steps").toEqual([FOOD, AMBIANCE]);
        await expect(cform.getByText(`${FOOD} / 10`)).toBeVisible();
        await expect(cform.getByText(`${AMBIANCE} / 10`)).toBeVisible();
        note(`PASS touch drag: Food → ${gotFood}, Ambiance → ${gotAmb} (labels read "${FOOD} / 10" and "${AMBIANCE} / 10")`);

        await cform.locator('[data-testid="visit-dish-name"]').first().fill("E2E test dish");
        const submit = cform.locator('button[type="submit"]');
        await submit.scrollIntoViewIfNeeded();
        await submit.tap();
        await expect(cpage.locator('[data-testid="food-save-confirmation"]')).toBeVisible({ timeout: 20_000 });
        const created = (await visitIds(cpage)).filter((id) => !baseline.has(id));
        expect(created.length, "exactly one new visit row").toBe(1);
        const row = await cpage.evaluate(async (id) => (await window.pfSupabase.from("food_visits").select("place_id,rating,rating_ambiance").eq("id", id).single()).data, created[0]);
        expect([Number(row.rating), Number(row.rating_ambiance)], "saved exactly the dragged half-steps").toEqual([FOOD, AMBIANCE]);
        note(`PASS saved: stored rating ${row.rating}, ambiance ${row.rating_ambiance}`);
        await cctx.close();

        // ── B. WebKit, fresh page = after a reload: card, log-another, edit ─────────────────────────
        await openFood(page);
        await openPlace(page, place);
        const card = page.locator('[data-testid="food-visit-card"]');
        await expect(card).toHaveCount(1, { timeout: 15_000 });
        await expect(card).toContainText(`Food ${FOOD}/10`);
        await expect(card).toContainText(`Ambiance ${AMBIANCE}/10`);
        note(`PASS after reload (WebKit): card reads "${(await card.innerText()).replace(/\s+/g, " ").trim()}"`);

        await page.locator('[data-testid="food-log-visit-btn"]').tap();
        const lform = page.locator("form").filter({ has: page.locator('[data-testid="rating-slider"]') });
        await expect(lform).toBeVisible();
        const a2 = await assertSliders(page, lform, "log another (WebKit)", { fresh: true });
        note(`PASS log another: 2 sliders ${JSON.stringify(a2.map((a) => [a.label, a.min, a.max, a.step, a.vt]))}, no tap grid`);
        const cancel = lform.getByRole("button", { name: /cancel/i });
        if (await cancel.count()) await cancel.first().tap();
        else await page.keyboard.press("Escape");
        await expect(page.locator('[data-testid="rating-slider"]')).toHaveCount(0, { timeout: 10_000 });

        await card.first().tap();
        const eform = page.locator('[data-testid="food-visit-card-editing"] form');
        await expect(eform).toBeVisible();
        const a3 = await assertSliders(page, eform, "edit old visit (WebKit)", { fresh: false });
        expect(a3.map((a) => Number(a.value)), "edit form opens on the saved half-steps").toEqual([FOOD, AMBIANCE]);
        await expect(eform.getByText(`${FOOD} / 10`)).toBeVisible();
        await expect(eform.getByText(`${AMBIANCE} / 10`)).toBeVisible();
        note(`PASS edit old visit: 2 sliders, opens on ${FOOD} / ${AMBIANCE}, no tap grid`);
        const ecancel = eform.getByRole("button", { name: /cancel/i });
        if (await ecancel.count()) await ecancel.first().tap();

        // ── C. quarter points saved in the older period still display as saved ──────────────────────
        const oldId = await page.evaluate(async ({ placeId, f, a }) => {
          const uid = (await window.pfSupabase.auth.getUser()).data.user.id;
          const r = await window.pfSupabase.from("food_visits").insert({ user_id: uid, place_id: placeId, rating: f, rating_ambiance: a }).select("id").single();
          return r.error ? { error: r.error.message } : { id: r.data.id };
        }, { placeId: row.place_id, f: OLD_FOOD, a: OLD_AMBIANCE });
        expect(oldId.error, "an older quarter-point row can be stored").toBeUndefined();
        await openFood(page);
        await openPlace(page, place);
        const oldCard = page.locator('[data-testid="food-visit-card"]').filter({ hasText: `Food ${OLD_FOOD}/10` });
        await expect(oldCard).toHaveCount(1, { timeout: 15_000 });
        await expect(oldCard).toContainText(`Ambiance ${OLD_AMBIANCE}/10`);
        note(`PASS quarter points on the card: "${(await oldCard.innerText()).replace(/\s+/g, " ").trim()}"`);
        await oldCard.tap();
        const oform = page.locator('[data-testid="food-visit-card-editing"] form');
        await expect(oform).toBeVisible();
        await expect(oform.getByText(`${OLD_FOOD} / 10`)).toBeVisible();
        await expect(oform.getByText(`${OLD_AMBIANCE} / 10`)).toBeVisible();
        note(`PASS quarter points in the edit form: labels read "${OLD_FOOD} / 10" and "${OLD_AMBIANCE} / 10" (thumbs sit on ${(await oform.locator('[data-testid="rating-slider"]').evaluateAll((e) => e.map((x) => x.value))).join(" / ")})`);
        const ocancel = oform.getByRole("button", { name: /cancel/i });
        if (await ocancel.count()) await ocancel.first().tap();
      } finally {
        await cb.close().catch(() => {});
        // ── cleanup: delete everything this run created (test account only), assert gone ─────────────
        if (!page.isClosed()) {
          if (!(await page.evaluate(() => !!window.pfSupabase).catch(() => false))) await openFood(page);
          const fresh = (await visitIds(page)).filter((id) => !baseline.has(id));
          const gone = await page.evaluate(async (ids) => {
            for (const id of ids) {
              await window.pfSupabase.from("food_dishes").delete().eq("visit_id", id);
              await window.pfSupabase.from("food_visits").delete().eq("id", id);
            }
            const q = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
            const v = await window.pfSupabase.from("food_visits").select("id").in("id", q);
            const d = await window.pfSupabase.from("food_dishes").select("id").in("visit_id", q);
            return { visits: (v.data || []).length, dishes: (d.data || []).length };
          }, fresh);
          note(`CLEANUP: deleted ${fresh.length} visit(s) created by this run; remaining visits=${gone.visits} dishes=${gone.dishes}`);
          expect(gone, "everything created is gone").toEqual({ visits: 0, dishes: 0 });
          expect(new Set(await visitIds(page))).toEqual(baseline);
        }
        await info.attach("report.txt", { body: report.join("\n"), contentType: "text/plain" });
        try { mkdirSync("test-results", { recursive: true }); writeFileSync(`test-results/V1519600-${label.replace(/\s+/g, "-")}.txt`, report.join("\n")); } catch (_) { /* report file is a convenience */ }
      }
    });
  });
}
