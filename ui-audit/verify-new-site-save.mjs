/* PIN THE DATA LOSS (owner: "I placed a bunch of new stuff on a NEW site and it didn't save at all —
 * gone after reload"). This drives the EXACT path the existing harnesses never test: create a brand-new
 * site at RUNTIME via the app's own "Start blank" button (not a pre-seeded localStorage site), place
 * content, then check it persisted and SURVIVES a reload.
 *
 * Logged-out (the sandbox can't sign in), so this proves the pure-code path: autosave fires → writeSites
 * → boot resume. If it reproduces here, it's a code bug and this localizes WHICH step drops the data.
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-new-site-save.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";        // logged-out store
const CUR_KEY = "planarfit:currentSite:v1";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

// Total drawn items across collections in the store (robust to which collection the edit lands in).
const storeSummary = (page) => page.evaluate((k) => {
  let obj = {}; try { obj = JSON.parse(localStorage.getItem(k) || "{}"); } catch (_) {}
  const ids = Object.keys(obj);
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  const rows = ids.map((id) => { const s = obj[id]; return { id, items: n(s.els) + n(s.markups) + n(s.measures) + n(s.callouts) + n(s.parcels), origin: !!s.origin }; });
  return { count: ids.length, rows };
}, SITES_KEY);
const currentSite = (page) => page.evaluate((k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, CUR_KEY);
const domMarkups = (page) => page.evaluate(() => document.querySelectorAll("svg rect[stroke], svg polygon[stroke], svg path[stroke]").length);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

// Start completely clean (no sites) so we exercise NEW-site creation, not a resume.
await page.evaluate((ks) => { for (const k of ks) localStorage.removeItem(k); }, [SITES_KEY, CUR_KEY]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const before = await storeSummary(page);
check("clean start — no sites in the store", before.count === 0, `count=${before.count}`);

// --- Create a brand-new site via the app's own "Start blank" button (the newBlankSite path). ---
const startBtn = page.locator('text="Start blank"').first();
const haveStart = await startBtn.isVisible().catch(() => false);
check('"Start blank" button is reachable on boot', haveStart);
if (haveStart) { await startBtn.click(); await page.waitForTimeout(2500); }
const newId = await currentSite(page);
check("a new site id was created + set as current", !!newId, `currentSite=${newId}`);

// --- Place NEW content (count-changing) on the canvas: a markup rectangle (tool "r"). ---
const box = await page.evaluate(() => { let z = null, a = 0; for (const s of document.querySelectorAll("svg")) { const r = s.getBoundingClientRect(); if (r.width * r.height > a) { a = r.width * r.height; z = r; } } return z ? { x: z.x, y: z.y, w: z.width, h: z.height } : null; });
check("the planner canvas (SVG) rendered for the new blank site", !!box, box ? `${Math.round(box.w)}x${Math.round(box.h)}` : "no svg");
if (box) {
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
  const m0 = await domMarkups(page);
  await page.keyboard.press("r"); await page.waitForTimeout(200);
  await page.mouse.move(cx - 120, cy - 90); await page.mouse.down();
  await page.mouse.move(cx + 130, cy + 80, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(250);
  // a second one so "a bunch of new stuff" is realistic + robust to one missing
  await page.keyboard.press("r"); await page.waitForTimeout(150);
  await page.mouse.move(cx + 160, cy - 120); await page.mouse.down();
  await page.mouse.move(cx + 300, cy - 10, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(700); // > the 400ms autosave settle
  check("the placed content rendered on the canvas", (await domMarkups(page)) > m0, `Δshapes=${(await domMarkups(page)) - m0}`);
}
const afterPlace = await storeSummary(page);
const placedRow = afterPlace.rows.find((r) => r.id === newId) || afterPlace.rows[0];
check("the NEW site was written to the store with its content", !!placedRow && placedRow.items > 0, `rows=${JSON.stringify(afterPlace.rows)}`);
await page.screenshot({ path: OUT + "newsite-after-place.png" });

// --- THE TEST: reload and confirm the new site + its content SURVIVE (the owner's "gone after reload"). ---
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const afterReload = await storeSummary(page);
const survivedRow = afterReload.rows.find((r) => r.id === newId);
check("the new site STILL EXISTS in the store after reload", !!survivedRow, `rows=${JSON.stringify(afterReload.rows)}`);
check("its placed content SURVIVED the reload (no data loss)", !!survivedRow && survivedRow.items > 0, survivedRow ? `items=${survivedRow.items}` : "row gone");
check("the planner RE-OPENED the new site (not bounced to the map)", (await domMarkups(page)) > 0, `shapes on canvas=${await domMarkups(page)}`);
await page.screenshot({ path: OUT + "newsite-after-reload.png" });
check("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nNEW-SITE SAVE repro: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
