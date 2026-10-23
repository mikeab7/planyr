#!/usr/bin/env node
/* verify-food-visit-sheet-layout — the Food place card / "Log a visit" sheet on an iPhone, LAYOUT only (NEW-1..4 + NEW-6, 2026-10-23, owner on his iPhone:
 * "the sheet looks and feels off — simulate an iPhone screen and figure it out").
 *
 *   NEW-1  the space above the header is TIGHT: sheet top → first line of the title ≤ HEADER_GAP_MAX (was 58 with a 56-high handle zone whose bar sat at its bottom)
 *   NEW-2  the ✕ is centred on the title's FIRST line (also for a name that wraps), inside the sheet, on top of the handle zone's overlap, never under it
 *   NEW-3  every chip's text INK is centred in the chip (|ink centre − chip centre| ≤ INK_TOL) — measured from pixels, not from a line box
 *   NEW-4  DOM order in the form: Food · Ambiance · dishes · Date · … · actions
 *   NEW-6  Date and every field fully inside the sheet and aligned with its siblings; the Cancel / Log row clears the home indicator and the keyboard
 * Each runs at iPhone 15 (393×852) and iPhone 15 Pro Max (430×932), in WebKit AND Chromium, with 1 and 3 dishes, keyboard down and up.
 *
 * ENGINE, stated: WebKit here is Playwright's Linux WebKit build (real WebKit layout, Inter as in production — NOT iOS Safari, no SF font, no collapsing toolbar,
 * env(safe-area-inset-*) = 0); Chromium is iPhone device emulation. The drag itself stays in verify-food-visit-sheet-touch.mjs (CDP touch).
 * KNOWN-ANSWER ARM (DRIVER-SCROLL §6): a chip planted with its text 6 px too high must read off-centre, a symmetric one must read centred — else the ink reader is
 * void and the run says so instead of printing a score. A run that found no chips at all is VACUOUS and fails.
 *
 * Usage: build with the fixture env (ui-audit/lib/foodFixture.mjs), `npx vite preview --port 4180`, then
 *   PW_CHROME=<chromium> node ui-audit/verify-food-visit-sheet-layout.mjs [baseUrl] [--shots=<dir>] [--engine=webkit|chromium]
 *   --live [baseUrl]: the DEPLOYED site, signed in as the test account (e2e@planyr.test) on a throwaway visit seeded on the real Aburi Sushi row and deleted at the end
 *   (owner rule 15). Nothing is ever submitted; /version.json and the build marker (the `data-chip` contract) are read in the SAME call as the assertions.
 */
import { chromium, webkit } from "playwright";
import { mkdirSync } from "node:fs";
import { open, openPlace, LIVE, seedLive, cleanupLive, closeLeakedLive } from "./lib/foodIosPage.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const ONLY = (process.argv.find((a) => a.startsWith("--engine=")) || "").slice(9);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const HEADER_GAP_MAX = 34; // sheet top → first line of the title (the design: 28)
const INK_TOL = 1; // css px
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHEET = '[data-testid="food-bottom-sheet"]';
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } finally { await closeLeakedLive(); } };

/** ink centre of the text inside a chip vs the chip's own centre, from the element's pixels. */
async function inkOffset(helper, locator) {
  const box = await locator.boundingBox();
  const png = await locator.screenshot({ animations: "disabled" });
  const r = await helper.evaluate(async ({ b64, cssW, cssH }) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const dpr = img.height / cssH, W = img.width, H = img.height;
    const x0 = Math.round(Math.min(cssH * 0.3, cssW * 0.15) * dpr), x1 = W - x0, y0 = Math.round(2 * dpr), y1 = H - y0;
    const d = g.getImageData(0, 0, W, H).data;
    const counts = new Map();
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * W + x) * 4; const k = (d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3); counts.set(k, (counts.get(k) || 0) + 1); }
    let best = null, bn = -1; for (const [k, n] of counts) if (n > bn) { bn = n; best = k; }
    const [br, bg, bb] = best.split(",").map((v) => v * 8 + 4);
    let top = -1, bot = -1;
    for (let y = y0; y < y1; y++) {
      let ink = false;
      for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) > 90) { ink = true; break; } }
      if (ink) { if (top < 0) top = y; bot = y; }
    }
    if (top < 0) return { none: true };
    return { inkC: (top + bot + 1) / 2 / dpr, boxC: H / 2 / dpr, inkH: (bot - top + 1) / dpr, dpr };
  }, { b64: png.toString("base64"), cssW: box.width, cssH: box.height });
  return r.none ? null : { ...r, off: r.inkC - r.boxC };
}

const MAXP = { "iPhone 15": [393, 852], "iPhone 15 Pro Max": [430, 932] };
async function openForm(br, name) {
  const [w, h] = MAXP[name];
  const { ctx, page } = await open(br, name, "ios");
  await page.setViewportSize({ width: w, height: h }); await sleep(800);
  await assertMeasurable(page, "verify-food-visit-sheet-layout"); // FOREGROUND-OR-VOID
  await openPlace(page, "aburi", /aburi/i, false);
  return { ctx, page, w, h };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

if (LIVE) { await seedLive(); console.log("live: throwaway Aburi visit seeded on the test account"); }
for (const [en, type] of Object.entries({ webkit, chromium })) {
  if (ONLY && ONLY !== en) continue;
  const br = await type.launch(en === "chromium" ? { executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] } : {});
  const helperCtx = await br.newContext(); const helper = await helperCtx.newPage();
  for (const name of Object.keys(MAXP)) {
    const L = `[${en} ${name}]`;
    // ── the instrument itself: a planted chip must read as planted ─────────────────────────────────
    await section(`${L} ink reader`, async () => {
      const { ctx, page } = await openForm(br, name);
      await page.evaluate(() => {
        const mk = (id, pad) => { const e = document.createElement("span"); e.id = id; e.textContent = "8.0 Food"; e.style.cssText = `position:fixed;left:20px;top:${id === "plant-hi" ? 120 : 160}px;z-index:99999;display:inline-flex;align-items:flex-start;justify-content:center;height:28px;padding:${pad};box-sizing:border-box;background:#eceef3;color:#222;font:12px Inter,sans-serif;line-height:1;border-radius:14px;width:90px`; document.body.appendChild(e); };
        mk("plant-hi", "4px 10px 0"); mk("plant-mid", "8px 10px 0");
      });
      const hi = await inkOffset(helper, page.locator("#plant-hi")), mid = await inkOffset(helper, page.locator("#plant-mid"));
      check(`${L} KNOWN ANSWER: a chip planted with its text 6 px too high reads off-centre (≤ -3)`, hi && hi.off <= -3, JSON.stringify(hi));
      check(`${L} KNOWN ANSWER: a chip planted with its text centred reads centred (|off| ≤ ${INK_TOL})`, mid && Math.abs(mid.off) <= INK_TOL, JSON.stringify(mid));
      await ctx.close();
    });

    // ── the place card ──────────────────────────────────────────────────────────────────────────────
    await section(`${L} card`, async () => {
      const { ctx, page } = await openForm(br, name);
      await shot(page, `${en}-${name.replace(/ /g, "")}-card`);
      const g = await page.evaluate((SHEET) => {
        const s = document.querySelector(SHEET), sr = s.getBoundingClientRect();
        const title = document.querySelector('[data-testid="food-panel-title"]');
        const rg = document.createRange(); rg.selectNodeContents(title); const line = rg.getClientRects()[0];
        const x = document.querySelector('[data-testid="food-panel-close"]').getBoundingClientRect();
        const bar = s.children[0].querySelector("span").getBoundingClientRect();
        const at = (px, py) => { const e = document.elementFromPoint(px, py); return { x: !!e?.closest('[data-testid="food-panel-close"]'), handle: !!e?.closest('[data-testid="food-sheet-drag-handle"]'), grab: !!e?.closest("[data-sheet-grab]") }; };
        return { gap: line.top - sr.top, barBottomToTitle: line.top - bar.bottom, titleC: line.top + line.height / 2, xC: x.top + x.height / 2, xTop: x.top - sr.top, xRight: sr.right - x.right, xW: x.width, xH: x.height,
          barHit: at(bar.left + bar.width / 2, bar.top + bar.height / 2), xHit: at(x.left + x.width / 2, x.top + x.height / 2),
          leftEdgeHit: at(sr.left + 8, sr.top + 40), zoneH: s.children[0].getBoundingClientRect().height };
      }, SHEET);
      check(`${L} NEW-1 sheet top → title is tight (≤ ${HEADER_GAP_MAX})`, g.gap <= HEADER_GAP_MAX, `${g.gap.toFixed(1)}`);
      check(`${L} NEW-1 grab bar sits right above the title (≤ 24 between them)`, g.barBottomToTitle <= 24, `${g.barBottomToTitle.toFixed(1)}`);
      check(`${L} NEW-1 the grab zone is still forgiving (handle zone ≥ 48 tall)`, g.zoneH >= 48, `${g.zoneH}`);
      check(`${L} NEW-1 a press on the bar is the handle; a press 40 px down at the edge is still a grab area`, g.barHit.handle && (g.leftEdgeHit.handle || g.leftEdgeHit.grab), JSON.stringify({ bar: g.barHit, edge: g.leftEdgeHit }));
      check(`${L} NEW-2 ✕ centre = title first-line centre (±1)`, Math.abs(g.xC - g.titleC) <= 1, `x ${g.xC.toFixed(1)} title ${g.titleC.toFixed(1)}`);
      check(`${L} NEW-2 ✕ is a 44 target, wholly inside the sheet's top-right, and the topmost thing at its centre`, g.xW >= 44 && g.xH >= 44 && g.xTop >= 0 && g.xRight >= 0 && g.xHit.x, JSON.stringify({ w: g.xW, h: g.xH, top: g.xTop, right: g.xRight, hit: g.xHit }));
      // a long name wraps to two lines: the ✕ stays beside the FIRST line
      const wrapped = await page.evaluate(() => {
        const t = document.querySelector('[data-testid="food-panel-title"]'); const keep = t.textContent;
        t.textContent = "Aburi Sushi & Izakaya Downtown Houston Location Number Two";
        const rg = document.createRange(); rg.selectNodeContents(t); const rects = [...rg.getClientRects()];
        const x = document.querySelector('[data-testid="food-panel-close"]').getBoundingClientRect();
        const out = { lines: new Set(rects.map((r) => Math.round(r.top))).size, titleC: rects[0].top + rects[0].height / 2, xC: x.top + x.height / 2 };
        t.textContent = keep; return out;
      });
      check(`${L} NEW-2 a long name wraps (≥ 2 lines) and the ✕ is still on the first line (±1)`, wrapped.lines >= 2 && Math.abs(wrapped.xC - wrapped.titleC) <= 1, JSON.stringify(wrapped));
      // the build marker: the `data-chip` contract exists only in a build that has the change (NEW-3) — and, live, which commit is being judged
      const nChip = await page.locator("[data-chip]").count();
      const ver = LIVE ? await page.evaluate(async () => { try { return (await (await fetch("/version.json?cb=" + Date.now(), { cache: "no-store" })).json()); } catch (e) { return { error: String(e) }; } }) : null;
      check(`${L} BUILD MARKER: the page being judged carries the new chip contract (≥ 3 [data-chip])${ver ? " — version " + JSON.stringify(ver).slice(0, 120) : ""}`, nChip >= 3, `${nChip}`);
      // chips on the card
      // data-chip is the contract; the ids keep this runnable against a build that predates it
      const chips = page.locator('[data-chip], [data-testid="food-score-pill-food"], [data-testid="food-score-pill-ambiance"], [data-testid="food-add-to-list-btn"]'); const n = await chips.count();
      let worst = 0, seen = [];
      for (let i = 0; i < n; i++) { if (!(await chips.nth(i).isVisible())) continue; const m = await inkOffset(helper, chips.nth(i)); if (m) { worst = Math.max(worst, Math.abs(m.off)); seen.push(`${(await chips.nth(i).getAttribute("data-testid")) || "chip"}:${m.off.toFixed(2)}`); } }
      check(`${L} NEW-3 VACUITY: the card shows ≥ 3 chips (Food, Ambiance, + List)`, seen.length >= 3, seen.join(" "));
      check(`${L} NEW-3 every chip on the card has its text ink centred (|off| ≤ ${INK_TOL})`, seen.length >= 3 && worst <= INK_TOL, seen.join(" "));
      await ctx.close();
    });

    // ── the visit form: 1 dish, then 3 dishes, then the keyboard ─────────────────────────────────────
    await section(`${L} form`, async () => {
      const { ctx, page, w } = await openForm(br, name);
      await page.locator('[data-testid="food-log-visit-btn"]').evaluate((b) => b.click()); await sleep(900);
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(300);
      const order = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const food = q('[role="group"][aria-label="Food"]'), amb = q('[role="group"][aria-label="Ambiance"]'), dishes = q('[data-testid="visit-dishes"]'), date = q('[data-testid="visit-date-input"]'), actions = q('[data-testid="visit-form-actions"]');
        const before = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
        const firstDish = q('[data-testid="visit-dish-row"]');
        return { dom: before(food, amb) && before(amb, dishes) && before(dishes, date) && before(date, actions) && before(amb, firstDish), ys: [food, amb, firstDish, date].map((e) => Math.round(e.getBoundingClientRect().top)) };
      });
      check(`${L} NEW-4 DOM order: Food, Ambiance, dishes (first dish row below Ambiance), Date, actions`, order.dom, JSON.stringify(order.ys));
      check(`${L} NEW-4 …and visually the same order top to bottom`, order.ys.every((y, i) => i === 0 || y >= order.ys[i - 1]), JSON.stringify(order.ys));
      // set values so the readouts become chips; date gets a value so the native control draws
      await page.locator('[data-testid="rating-slider"]').nth(0).fill("8.5"); await page.locator('[data-testid="rating-slider"]').nth(1).fill("7.25");
      await page.locator('[data-testid="visit-date-input"]').evaluate((i) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "2026-10-11"); i.dispatchEvent(new Event("input", { bubbles: true })); });
      await sleep(300);
      for (const dishes of [1, 3]) {
        while ((await page.locator('[data-testid="visit-dish-row"]').count()) < dishes) { await page.locator('[data-testid="visit-dish-add"]').evaluate((b) => b.click()); await sleep(250); }
        await shot(page, `${en}-${name.replace(/ /g, "")}-form-${dishes}dish`);
        const m = await page.evaluate((SHEET) => {
          const s = document.querySelector(SHEET), sr = s.getBoundingClientRect(), c = s.children[1], cl = c.getBoundingClientRect().left, cw = cl + c.clientWidth;
          const out = [];
          for (const e of s.querySelectorAll("input, textarea, select, button, [role=group]")) { const b = e.getBoundingClientRect(); if (!b.width) continue; if (b.left < sr.left - 0.5 || b.right > cw + 0.5) out.push(`${e.tagName}[${e.dataset?.testid || e.getAttribute("aria-label") || ""}] ${Math.round(b.left)}..${Math.round(b.right)} (col ${Math.round(cl)}..${Math.round(cw)})`); }
          const r = (id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
          const d = r("visit-date-input"), cst = r("visit-cost-input"), n = r("visit-notes-input");
          return { out: out.slice(0, 5), dateL: d.left, dateR: d.right, costL: cst.left, costR: cst.right, notesR: n.right, dateH: d.height, costH: cst.height, docSW: document.documentElement.scrollWidth, iw: innerWidth };
        }, SHEET);
        check(`${L} NEW-6 ${dishes} dish(es): every field and group inside the sheet's content column`, m.out.length === 0, JSON.stringify(m.out));
        check(`${L} NEW-6 ${dishes} dish(es): Date is exactly as wide as Cost and Notes (same left and right edge, ±0.5)`, Math.abs(m.dateL - m.costL) <= 0.5 && Math.abs(m.dateR - m.costR) <= 0.5 && Math.abs(m.dateR - m.notesR) <= 0.5, JSON.stringify({ d: [m.dateL, m.dateR], c: [m.costL, m.costR], n: m.notesR }));
        check(`${L} NEW-6 ${dishes} dish(es): Date is as tall as a touch target (≥ 44)`, m.dateH >= 43.5, `${m.dateH}`);
        check(`${L} NEW-5 ${dishes} dish(es): no sideways page scroll`, m.docSW <= m.iw, JSON.stringify({ docSW: m.docSW, iw: m.iw }));
      }
      // chips in the form: the two readouts and each dish score readout that has been set
      const ro = page.locator('[data-testid="rating-slider-readout"][data-score-state="set"]'); const rn = await ro.count(); let worst = 0, seen = [];
      for (let i = 0; i < rn; i++) { const m = await inkOffset(helper, ro.nth(i)); if (m) { worst = Math.max(worst, Math.abs(m.off)); seen.push(m.off.toFixed(2)); } }
      check(`${L} NEW-3 VACUITY: the form shows both rating readout chips`, seen.length === 2, seen.join(" "));
      check(`${L} NEW-3 the Food / Ambiance readout chips have their text centred (|off| ≤ ${INK_TOL})`, seen.length === 2 && worst <= INK_TOL, seen.join(" "));
      // keyboard DOWN: the Cancel / Log row is pinned inside the sheet, above the home-indicator padding
      const down = await page.evaluate((SHEET) => { const s = document.querySelector(SHEET).getBoundingClientRect(), a = document.querySelector('[data-testid="visit-form-actions"]').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, sheetTop: s.top, sheetBottom: s.bottom }; }, SHEET);
      check(`${L} NEW-6 keyboard down: the Cancel / Log row is pinned inside the sheet`, down.top >= down.sheetTop && down.bottom <= down.sheetBottom + 0.5, JSON.stringify(down));
      // keyboard UP on the notes field. By design (B2046224 x3) the Save row flows with the content while typing, so it must be REACHABLE: scrolled to the end it sits above the keyboard.
      await page.locator('[data-testid="visit-notes-input"]').focus(); await sleep(900);
      await page.evaluate((SHEET) => { const c = document.querySelector(SHEET).children[1]; c.scrollTop = c.scrollHeight; }, SHEET); await sleep(300);
      const kb = await page.evaluate((SHEET) => {
        const band = window.__kb?.band?.() || { top: 0, bottom: innerHeight }; const a = document.querySelector('[data-testid="visit-form-actions"]').getBoundingClientRect();
        const s = document.querySelector(SHEET).getBoundingClientRect(); const f = document.activeElement.getBoundingClientRect();
        return { open: !!window.__kb?.open, bandBottom: band.bottom, actionsBottom: a.bottom, actionsTop: a.top, sheetTop: s.top, sheetBottom: s.bottom, fieldBottom: f.bottom, docSW: document.documentElement.scrollWidth, iw: innerWidth };
      }, SHEET);
      await shot(page, `${en}-${name.replace(/ /g, "")}-form-keyboard`);
      check(`${L} NEW-6 keyboard up: the keyboard model is on and nothing scrolls sideways`, kb.open && kb.docSW <= kb.iw, JSON.stringify({ open: kb.open, docSW: kb.docSW, iw: kb.iw }));
      check(`${L} NEW-6 keyboard up: scrolled to the end, the Cancel / Log row sits fully above the keyboard, inside the sheet`, kb.actionsBottom <= kb.bandBottom + 1 && kb.actionsTop >= kb.sheetTop, JSON.stringify(kb));
      await ctx.close();
    });
  }
  await helperCtx.close(); await br.close();
}

// the ✕ closes the card on a plain tap (Chromium touch): it is not swallowed by the grab zone
await section("tap ✕", async () => {
  const br = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
  const { ctx, page } = await openForm(br, "iPhone 15");
  const b = await page.locator('[data-testid="food-panel-close"]').boundingBox();
  const hBefore = await page.evaluate((S) => document.querySelector(S).getBoundingClientRect().height, SHEET);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(700);
  check("NEW-2 a tap on the ✕ closes the card (and does not start a drag)", (await page.locator(SHEET).count()) === 0, `sheet was ${Math.round(hBefore)} tall`);
  await ctx.close(); await br.close();
});

if (LIVE) { const c = await cleanupLive(); console.log("live cleanup:", JSON.stringify(c)); if (c.error || c.left !== 0) { check("live cleanup left rows behind", false, JSON.stringify(c)); } }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
