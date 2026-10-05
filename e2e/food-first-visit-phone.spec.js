/* V1476080 / B2057920 — Food first visit + keyboard + contact-card AutoFill, SIGNED IN, on emulated iPhones.
 *
 * Runs in the `webkit-phone` project (Playwright WebKit, iPhone 15 + iPhone SE descriptors, touch on,
 * upright) against real planyr.io as the seeded test account (E2E_LOGIN_KEY or E2E_EMAIL/E2E_PASSWORD —
 * never printed). EMULATED, not a phone: the real iOS keyboard and Safari's AutoFill bar cannot be
 * produced here, so the keyboard is modelled through window.visualViewport (as iOS does: layout viewport
 * unchanged, visual viewport shrinks) and AutoFill is checked by the ATTRIBUTES iOS keys off.
 *
 * Writes ONE visit + ONE dish on the test account's own data and deletes them in `finally`, asserting
 * they are gone. The thumb-friendly rating control is paused by the owner: the dish rating is set the
 * simplest way that works and nothing here asserts how ratings feel to enter. */
import { test, expect, devices } from "@playwright/test";
import { hasAccount, STORAGE_STATE } from "./helpers.js";

const CONTACT = /(^|[^a-z])(name|title|first|last|full|given|family|nick|e-?mail|phone|tel|mobile|address|street|city|state|zip|postal|org|organi[sz]ation|company|job|contact|country|birthday|bday)([^a-z]|$)/i;
const STANDARD_AC = /^(name|honorific|given|additional|family|nickname|username|email|tel|street|address|postal|cc-|organization|country|bday|url|one-time|new-password|current-password|on)/i;

// iOS: the LAYOUT viewport stays put when the keyboard opens; only visualViewport shrinks.
const VV_STUB = () => {
  const target = new EventTarget();
  const vv = Object.assign(target, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  window.__setKeyboard = (px) => { vv.height = innerHeight - px; vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
};

// Both phone sizes write to the same test account (and the same restaurant) — never in parallel.
test.describe.configure({ mode: "serial" });

const PHONES = [
  { label: "iPhone 15", keyboard: 336 },
  { label: "iPhone SE", keyboard: 260 },
];

for (const { label, keyboard } of PHONES) {
  test.describe(`Food first visit on ${label} (signed in, WebKit-emulated)`, () => {
    const { defaultBrowserType, ...descriptor } = devices[label];
    test.use({ ...descriptor, storageState: STORAGE_STATE });
    test.skip(!hasAccount, "needs the seeded test account (E2E_LOGIN_KEY or E2E_EMAIL/E2E_PASSWORD)");

    test("first visit: dishes + rating, no What-I-had; keyboard keeps field + Save; no contact AutoFill", async ({ page, context }, info) => {
      test.setTimeout(240_000);
      await context.addInitScript(VV_STUB);
      const report = [];
      const note = (s) => { report.push(s); console.log(`[${label}] ${s}`); };
      const sb = (fn, arg) => page.evaluate(fn, arg);

      await page.goto("/#/food");
      await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 30_000 });
      // Build id + served chunk hashes, read in the SAME observation as what is asserted (CLAUDE.md rule).
      const build = await page.evaluate(async () => ({
        version: await (await fetch("/version.json", { cache: "no-store" })).json().catch(() => null),
        scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src").split("/").pop()).filter((s) => /food|index/i.test(s)),
        viewport: [innerWidth, innerHeight], touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches,
      }));
      note(`build ${JSON.stringify(build.version)} · chunks ${build.scripts.join(",")} · viewport ${build.viewport.join("x")} · touch ${build.touch} · coarse ${build.coarse}`);
      const email = await sb(async () => (await window.pfSupabase.auth.getUser()).data?.user?.email);
      expect(email, "must be the test account — never Michael's").toBe("e2e@planyr.test");
      note(`signed in as ${email}`);

      const visitIds = () => sb(async () => ((await window.pfSupabase.from("food_visits").select("id")).data || []).map((r) => r.id));
      const baseline = new Set(await visitIds());
      let createdId = null;
      try {
        // ── pick a restaurant this account has never visited ─────────────────────────────────────
        const box = page.locator('[data-testid="food-search-box"]');
        await box.tap();
        await box.pressSequentially("pizza", { delay: 50 });
        await page.waitForSelector('[data-testid="food-search-results"] button', { timeout: 30_000 });
        const rows = page.locator('[data-testid="food-search-results"] button');
        const n = await rows.count();
        let pickedName = null;
        for (let i = 0; i < n; i++) {
          const t = await rows.nth(i).innerText();
          if (/been here/i.test(t) || /live search/i.test(t)) continue;
          pickedName = t.split("\n")[0].trim();
          await rows.nth(i).tap();
          break;
        }
        expect(pickedName, "a never-visited result exists").toBeTruthy();
        await page.waitForSelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]');
        await expect(page.locator('[data-testid="food-visit-card"]'), "place has no prior visit").toHaveCount(0);
        note(`FIRST VISIT: restaurant "${pickedName}" has 0 prior visits on the test account`);

        // ── 1. first visit shows dishes + rating, NO "What I had" ───────────────────────────────
        await page.locator('[data-testid="food-log-visit-btn"]').tap();
        const form = page.locator("form").filter({ has: page.locator('[data-testid="visit-dishes"]') });
        await expect(form).toBeVisible();
        const labels = await form.locator("label").allInnerTexts();
        expect(labels.some((t) => /what i had/i.test(t)), `no "What I had" label (labels: ${JSON.stringify(labels.map((t) => t.split("\n")[0]))})`).toBe(false);
        expect(await form.getByText(/what i had/i).count(), 'no "What I had" text anywhere in the form').toBe(0);
        expect(await page.locator('[data-testid="visit-dishes"] [data-testid="visit-dish-name"]').count()).toBeGreaterThanOrEqual(1);
        expect(await page.locator('[data-testid="visit-dishes"] [data-testid="score-tap-grid"]').count(), "a dish rating control").toBeGreaterThanOrEqual(1);
        note('PASS first-visit form: Dishes block with name + rating control, no "What I had"');

        // ── 2. AUTOFILL attributes on EVERY Food text field in the form ─────────────────────────
        const fieldInfo = async () => page.evaluate(() => [...document.querySelectorAll('[data-testid="food-bottom-sheet"] input, [data-testid="food-bottom-sheet"] textarea, [data-testid="food-visit-panel"] input, [data-testid="food-visit-panel"] textarea')]
          .filter((e, i, a) => a.indexOf(e) === i && !["range", "checkbox", "radio", "button", "submit"].includes(e.type))
          .map((e) => ({ tid: e.dataset.testid || "", tag: e.tagName.toLowerCase(), type: e.type, ac: e.getAttribute("autocomplete"), name: e.getAttribute("name"), id: e.id, inputmode: e.getAttribute("inputmode"), ph: e.placeholder, aria: e.getAttribute("aria-label") })));
        const checkFields = (fields, where) => {
          expect(fields.length, `${where}: found text fields`).toBeGreaterThanOrEqual(1);
          for (const f of fields) {
            const why = JSON.stringify(f);
            expect(/^x-food-/.test(f.ac || ""), `${where} autocomplete non-standard x-food-*: ${why}`).toBe(true);
            expect(STANDARD_AC.test(f.ac || ""), `${where} autocomplete is not a contact token: ${why}`).toBe(false);
            expect(CONTACT.test(f.name || ""), `${where} name not a contact word: ${why}`).toBe(false);
            expect(CONTACT.test(f.id || ""), `${where} id not a contact word: ${why}`).toBe(false);
            expect(["email", "tel", "url"].includes(f.type), `${where} type not email/tel/url: ${why}`).toBe(false);
            expect(["email", "tel", "url"].includes(f.inputmode || ""), `${where} inputmode not email/tel/url: ${why}`).toBe(false);
            expect(CONTACT.test(`${f.ph} ${f.aria || ""}`), `${where} placeholder/aria-label avoids contact words: ${why}`).toBe(false);
          }
        };
        const visitFields = await fieldInfo();
        checkFields(visitFields, "visit form");
        note(`PASS AutoFill attributes, visit form (${visitFields.length} fields): ${JSON.stringify(visitFields.map((f) => ({ tid: f.tid, type: f.type, ac: f.ac, name: f.name, id: f.id, inputmode: f.inputmode })))}`);

        // ── 3. KEYBOARD: field + Save stay on screen, for EVERY visit-form field ────────────────
        const measure = async (el) => el.evaluate((node) => {
          const r = node.getBoundingClientRect(); const vv = window.visualViewport;
          return { top: r.top, bottom: r.bottom, vvTop: vv.offsetTop, vvBottom: vv.offsetTop + vv.height };
        });
        // NOTE (measured, and a deliberate product rule): while a field has focus the Save bar TUCKS —
        // it flows at the END of the form instead of floating over the card (B2046224 ×3: a pinned Save
        // covered the dish score buttons). So "Save stays on screen" is checked as: it is never floating
        // over the field being typed in; it is reachable by scrolling the sheet, ABOVE the keyboard; and
        // it is back, pinned and on screen, the moment the keyboard closes.
        const keyboardCheck = async (loc, saveLoc, what) => {
          await loc.scrollIntoViewIfNeeded();
          await loc.tap();
          await page.evaluate((px) => window.__setKeyboard(px), keyboard);
          await page.waitForTimeout(900);
          const f = await measure(loc), s0 = await measure(saveLoc);
          const fieldOk = f.top >= f.vvTop - 1 && f.bottom <= f.vvBottom + 1;
          const overlapsField = s0.top < f.bottom && s0.bottom > f.top; // Save drawn over the field being typed in
          const saveOnTyping = s0.top >= s0.vvTop - 1 && s0.bottom <= s0.vvBottom + 1;
          await saveLoc.evaluate((el) => el.scrollIntoView({ block: "end" })); // scroll the sheet's own scroller
          await page.waitForTimeout(500);
          const s1 = await measure(saveLoc);
          const saveReach = s1.top >= s1.vvTop - 1 && s1.bottom <= s1.vvBottom + 1;
          const saveHit = await saveLoc.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === el || el.contains(t); });
          await page.evaluate(() => { document.activeElement?.blur?.(); window.__setKeyboard(0); });
          await page.waitForTimeout(600);
          const s2 = await measure(saveLoc);
          const back = s2.top >= 0 && s2.bottom <= (await page.evaluate(() => innerHeight)) + 1;
          const pinned = await saveLoc.evaluate((el) => getComputedStyle(el.parentElement).position);
          note(`  keyboard up · ${what}: field ${f.top.toFixed(0)}–${f.bottom.toFixed(0)} in visible ${f.vvTop.toFixed(0)}–${f.vvBottom.toFixed(0)} → ${fieldOk ? "ON" : "OFF"} screen; Save while typing ${s0.top.toFixed(0)}–${s0.bottom.toFixed(0)} (${saveOnTyping ? "on screen" : "tucked below, not floating"}, over field: ${overlapsField}); after scrolling the sheet ${s1.top.toFixed(0)}–${s1.bottom.toFixed(0)} → ${saveReach ? "ON" : "OFF"} screen above keyboard, hit-testable ${saveHit}; keyboard closed → Save ${back ? "ON" : "OFF"} screen, ${pinned}`);
          expect(fieldOk, `${what}: the focused field is on screen with the keyboard up`).toBe(true);
          expect(overlapsField, `${what}: Save is not drawn over the field being typed in`).toBe(false);
          expect(saveReach && saveHit, `${what}: Save is reachable above the keyboard by scrolling the sheet`).toBe(true);
          expect(back, `${what}: Save is on screen again once the keyboard closes`).toBe(true);
        };
        const submit = form.locator('button[type="submit"]');
        const visitFieldLocs = [
          ["dish name", form.locator('[data-testid="visit-dish-name"]').first()],
          ["date", form.locator('[data-testid="visit-date-input"]')],
          ["what was good", form.locator('[data-testid="visit-highlights-input"]')],
          ["cost", form.locator('[data-testid="visit-cost-input"]')],
          ["notes", form.locator('[data-testid="visit-notes-input"]')],
        ];
        for (const [what, loc] of visitFieldLocs) await keyboardCheck(loc, submit, what);
        note("PASS keyboard: every visit-form field + Save on screen");

        // ── 4. add one dish with a rating, save ──────────────────────────────────────────────────
        await form.locator('[data-testid="visit-dish-name"]').first().fill("E2E test dish");
        const row = form.locator('[data-testid="visit-dish-row"]').first();
        await row.locator('[data-testid="score-tap-8"]').tap();
        await expect(row.locator('[data-testid="dish-score-numeral"]')).toHaveText(/^\s*8/);
        await submit.scrollIntoViewIfNeeded();
        await submit.tap();
        await expect(page.locator('[data-testid="food-save-confirmation"]')).toBeVisible({ timeout: 20_000 });
        const after = (await visitIds()).filter((id) => !baseline.has(id));
        expect(after.length, "exactly one new visit row").toBe(1);
        createdId = after[0];
        const dishes = await sb(async (vid) => (await window.pfSupabase.from("food_dishes").select("name,score").eq("visit_id", vid)).data, createdId);
        expect(dishes).toEqual([expect.objectContaining({ name: "E2E test dish", score: 8 })]);
        note(`PASS saved: visit ${createdId.slice(0, 8)}… with dish ${JSON.stringify(dishes)}`);

        // ── 5. visit + dish rating appear on the card ───────────────────────────────────────────
        await expect(page.locator('[data-testid="food-visit-card"]')).toHaveCount(1, { timeout: 15_000 });
        await expect(page.locator('[data-testid="food-dishes-section"]')).toContainText("E2E test dish");
        const dishRow = page.locator('[data-testid="dish-row"]').filter({ hasText: "E2E test dish" });
        await expect(dishRow.locator('[data-testid="dish-score-chip"]')).toHaveText(/^\s*8(\.0)?\s*$/);
        note(`PASS card: visit card present; dish row reads "${(await dishRow.innerText()).replace(/\s+/g, " ").trim()}"`);

        // ── 6. add-a-dish fields: keyboard + AutoFill ────────────────────────────────────────────
        await page.locator('[data-testid="food-add-dish-btn"]').scrollIntoViewIfNeeded();
        await page.locator('[data-testid="food-add-dish-btn"]').tap();
        const dishEdit = page.locator('[data-testid="dish-edit-row"]');
        await expect(dishEdit).toBeVisible();
        const dishFields = await page.evaluate(() => [...document.querySelectorAll('[data-testid="dish-edit-row"] input, [data-testid="dish-edit-row"] textarea')]
          .filter((e) => !["range", "checkbox", "radio", "button"].includes(e.type))
          .map((e) => ({ tid: e.dataset.testid || "", tag: e.tagName.toLowerCase(), type: e.type, ac: e.getAttribute("autocomplete"), name: e.getAttribute("name"), id: e.id, inputmode: e.getAttribute("inputmode"), ph: e.placeholder, aria: e.getAttribute("aria-label") })));
        checkFields(dishFields, "add-a-dish");
        note(`PASS AutoFill attributes, add-a-dish (${dishFields.length} fields): ${JSON.stringify(dishFields.map((f) => ({ tid: f.tid, type: f.type, ac: f.ac, name: f.name, id: f.id, inputmode: f.inputmode })))}`);
        const dishSave = page.locator('[data-testid="dish-save-btn"]');
        for (const tid of ["dish-name-input", "dish-price-input", "dish-note-input"]) {
          await keyboardCheck(dishEdit.locator(`[data-testid="${tid}"]`), dishSave, `add-a-dish ${tid}`);
        }
        note("PASS keyboard: every add-a-dish field + its Save on screen");
        await page.locator('[data-testid="dish-save-close-btn"], [data-testid="dish-edit-close"]').first().tap().catch(() => {});
      } finally {
        // ── cleanup: delete everything this run created, on the test account only, then assert gone ──
        const fresh = (await visitIds()).filter((id) => !baseline.has(id));
        const gone = await sb(async (ids) => {
          for (const id of ids) {
            await window.pfSupabase.from("food_dishes").delete().eq("visit_id", id);
            await window.pfSupabase.from("food_visits").delete().eq("id", id);
          }
          const v = await window.pfSupabase.from("food_visits").select("id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
          const d = await window.pfSupabase.from("food_dishes").select("id").in("visit_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
          return { visits: (v.data || []).length, dishes: (d.data || []).length };
        }, fresh);
        note(`CLEANUP: deleted ${fresh.length} visit(s) created by this run; remaining visits=${gone.visits} dishes=${gone.dishes}`);
        expect(gone, "visit and dish are gone").toEqual({ visits: 0, dishes: 0 });
        expect(new Set(await visitIds())).toEqual(baseline);
        await info.attach("report.txt", { body: report.join("\n"), contentType: "text/plain" });
      }
    });
  });
}
