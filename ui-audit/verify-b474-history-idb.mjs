/* B474 — the version-history ring now lives in IndexedDB (gigabytes), off localStorage's ~5 MB cap, with
 * a synchronous in-memory ring + a localStorage fallback. This drives a REAL browser (real IndexedDB):
 * create a site, make several edits (forcing version snapshots), and confirm the ring lands in the
 * IndexedDB "planyr" db AND survives a reload. Logged-out (sandbox can't sign in) — history isn't
 * cloud-synced anyway, so this is the full end-to-end check for Stage A.
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-b474-history-idb.mjs */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
const HISTORY_KEY = "planarfit:sites:history:v1";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

// Read the version-history ring straight out of the IndexedDB "planyr" kv store, in the page.
const readIdbHistory = (page) => page.evaluate((key) => new Promise((resolve) => {
  try {
    const req = indexedDB.open("planyr", 1);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
        g.onsuccess = () => resolve(typeof g.result === "string" ? g.result : null);
        g.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    };
    req.onerror = () => resolve(null);
  } catch (_) { resolve(null); }
}), HISTORY_KEY);
const domMarkups = (page) => page.evaluate(() => document.querySelectorAll("svg rect[stroke], svg polygon[stroke], svg path[stroke]").length);
const histCount = (raw, id) => { try { const r = JSON.parse(raw || "{}"); const list = r[id] || (id ? [] : Object.values(r)[0] || []); return Array.isArray(list) ? list.length : 0; } catch (_) { return 0; } };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

// Clean slate (also wipe the IndexedDB ring), so we test creation, not resume.
await page.evaluate((ks) => { for (const k of ks) localStorage.removeItem(k); }, [SITES_KEY, CUR_KEY, HISTORY_KEY]);
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase("planyr"); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
check("app booted clean with initHistoryStore at module load", errs.length === 0, errs.join(" | ").slice(0, 160));

// Create a new site + place several count-changing edits (each distinct shape → forces a snapshot).
const startBtn = page.locator('text="Start blank"').first();
if (await startBtn.isVisible().catch(() => false)) { await startBtn.click(); await page.waitForTimeout(2500); }
const newId = await page.evaluate((k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, CUR_KEY);
check("a new site was created", !!newId, `id=${newId}`);
const box = await page.evaluate(() => { let z = null, a = 0; for (const s of document.querySelectorAll("svg")) { const r = s.getBoundingClientRect(); if (r.width * r.height > a) { a = r.width * r.height; z = r; } } return z ? { x: z.x, y: z.y, w: z.width, h: z.height } : null; });
if (box) {
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
  for (let i = 0; i < 3; i++) { // 3 separate edits, each > the 50ms coalesce so each save snapshots the prior
    await page.keyboard.press("r"); await page.waitForTimeout(150);
    await page.mouse.move(cx - 140 + i * 50, cy - 90 + i * 30); await page.mouse.down();
    await page.mouse.move(cx + 60 + i * 50, cy + 40 + i * 30, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(700);
}
check("edits rendered on the canvas", (await domMarkups(page)) > 0, `shapes=${await domMarkups(page)}`);

// The ring should now be in IndexedDB (Stage A).
const idbBefore = await readIdbHistory(page);
check("version history is written to IndexedDB", histCount(idbBefore, newId) > 0, `snapshots=${histCount(idbBefore, newId)}`);

// THE TEST: reload → the IndexedDB ring (and thus the undo history) survives.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const idbAfter = await readIdbHistory(page);
check("the IndexedDB version history SURVIVED the reload", histCount(idbAfter, newId) > 0, `snapshots=${histCount(idbAfter, newId)}`);
check("the planner re-opened the site (boot intact)", (await domMarkups(page)) > 0, `shapes=${await domMarkups(page)}`);
check("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 160));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB474 history→IndexedDB: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
