/* B474 (raster increment) — site-plan OVERLAYS cache in IndexedDB too (idb-first rehydrate; cloud Storage
 * stays the cross-device fallback). Drives a real browser: create a site, drop an overlay, and confirm the
 * raster lands in IndexedDB, the PERSISTED record drops the heavy src but keeps the ref (off the cap), and
 * the overlay RE-HYDRATES from IndexedDB after a reload (exercises the new idb-first overlay effect).
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-b474-overlay-idb.mjs */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAVUlEQVR42u3OMQ0AMAwEsZ8/6Qyk0iWwI3v2eMHd3QEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+9gE0lQGfXn0lWQAAAABJRU5ErkJggg==";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };
const idbBytes = (page, key) => page.evaluate((k) => new Promise((res) => {
  try { const r = indexedDB.open("planyr", 1); r.onsuccess = () => { try { const g = r.result.transaction("kv", "readonly").objectStore("kv").get(k); g.onsuccess = () => res(typeof g.result === "string" ? g.result.length : 0); g.onerror = () => res(0); } catch (_) { res(0); } }; r.onerror = () => res(0); } catch (_) { res(0); }
}), key);
const ovRec = (page) => page.evaluate((k) => { try { const m = JSON.parse(localStorage.getItem(k) || "{}"); const s = Object.values(m)[0]; const o = s && s.sheetOverlays && s.sheetOverlays[0]; return o ? { hasSrc: !!o.src, idbKey: o.idbKey || null } : null; } catch (_) { return null; } }, SITES_KEY);
const ovImgs = (page) => page.evaluate(() => document.querySelectorAll("image[data-overlay-image]").length);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.evaluate((ks) => { for (const k of ks) localStorage.removeItem(k); }, [SITES_KEY, CUR_KEY]);
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase("planyr"); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

const startBtn = page.locator('text="Start blank"').first();
if (await startBtn.isVisible().catch(() => false)) { await startBtn.click(); await page.waitForTimeout(2500); }
const siteId = await page.evaluate((k) => localStorage.getItem(k), CUR_KEY);
check("new site created", !!siteId, `id=${siteId}`);

// Open the "Overlay" panel so its file input mounts, then drop a site-plan overlay image.
const ovTab = page.locator('button[title="Overlay"]').first();
if (await ovTab.count()) { await ovTab.click(); await page.waitForTimeout(900); }
const input = page.locator('input[accept="application/pdf,image/*"]').first();
check("overlay file input present", (await input.count()) > 0);
if ((await input.count()) > 0) {
  await input.setInputFiles({ name: "siteplan.png", mimeType: "image/png", buffer: Buffer.from(PNG_B64, "base64") });
  await page.waitForTimeout(2200);
}
check("overlay rendered after drop", (await ovImgs(page)) > 0, `overlay images=${await ovImgs(page)}`);
await page.waitForTimeout(1100); // autosave settle

const rec = await ovRec(page);
check("persisted overlay dropped the heavy src but kept the idb ref (off the cap)", rec && rec.hasSrc === false && !!rec.idbKey, JSON.stringify(rec));
check("overlay raster stashed in IndexedDB", rec && rec.idbKey ? (await idbBytes(page, rec.idbKey)) > 0 : false, rec ? `key=${rec.idbKey}` : "no rec");

// THE TEST: reload → the overlay re-hydrates from IndexedDB (the new idb-first overlay effect).
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
check("overlay RE-HYDRATED from IndexedDB after reload", (await ovImgs(page)) > 0, `overlay images=${await ovImgs(page)}`);
check("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 160));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB474 overlay→IndexedDB: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
