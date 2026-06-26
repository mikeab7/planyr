/* B474 (raster increment) — the heavy UNDERLAY image moves off the ~5 MB localStorage cap into IndexedDB.
 * Drives a real browser: create a site, drop an underlay image, and confirm (a) the raster is stashed in
 * IndexedDB, (b) the PERSISTED record dropped the heavy data-URL src but kept the ref (off the cap), and
 * (c) it RE-HYDRATES from IndexedDB after a reload (the underlay used to be lost / need a re-drop).
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-b474-underlay-idb.mjs */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
// a small but non-trivial PNG (64×64) so its data-URL is clearly larger than any UI icon
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAVUlEQVR42u3OMQ0AMAwEsZ8/6Qyk0iWwI3v2eMHd3QEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+9gE0lQGfXn0lWQAAAABJRU5ErkJggg==";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };
const idbRasterBytes = (page, key) => page.evaluate((k) => new Promise((res) => {
  try { const r = indexedDB.open("planyr", 1); r.onsuccess = () => { try { const g = r.result.transaction("kv", "readonly").objectStore("kv").get(k); g.onsuccess = () => res(typeof g.result === "string" ? g.result.length : 0); g.onerror = () => res(0); } catch (_) { res(0); } }; r.onerror = () => res(0); } catch (_) { res(0); }
}), key);
const recUnderlay = (page) => page.evaluate((k) => { try { const m = JSON.parse(localStorage.getItem(k) || "{}"); const s = Object.values(m)[0]; return s && s.underlay ? { hasSrc: !!s.underlay.src, idbKey: s.underlay.idbKey || null } : null; } catch (_) { return null; } }, SITES_KEY);
// the underlay renders as an SVG <image href="data:…"> (not an <img>); count those.
const bigImgs = (page) => page.evaluate(() => Array.from(document.querySelectorAll("image")).filter((i) => {
  const h = i.getAttribute("href") || i.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
  return h.startsWith("data:");
}).length);

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

// Open the "Aerial underlay" left-rail panel so its (hidden) file input mounts in the DOM.
const aerialTab = page.locator('button[title="Aerial"]').first();
if (await aerialTab.count()) { await aerialTab.click(); await page.waitForTimeout(900); }
const baseBig = await bigImgs(page);

// Drop an underlay image via the hidden file input.
const input = page.locator('input[type="file"][accept="image/*"]').first();
const have = await input.count();
check("underlay file input present", have > 0);
if (have > 0) {
  await input.setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: Buffer.from(PNG_B64, "base64") });
  await page.waitForTimeout(1800);
}
check("underlay image rendered after drop", (await bigImgs(page)) > baseBig, `imgs ${baseBig}→${await bigImgs(page)}`);
await page.waitForTimeout(1000); // autosave settle

check("underlay raster stashed in IndexedDB", (await idbRasterBytes(page, `raster:${siteId}:underlay`)) > 0, `bytes=${await idbRasterBytes(page, `raster:${siteId}:underlay`)}`);
const rec = await recUnderlay(page);
check("persisted record dropped the heavy src but kept the idb ref (off the cap)", rec && rec.hasSrc === false && !!rec.idbKey, JSON.stringify(rec));

// THE TEST: reload → the underlay re-hydrates from IndexedDB (used to need a re-drop).
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
check("underlay RE-HYDRATED from IndexedDB after reload", (await bigImgs(page)) > baseBig, `imgs=${await bigImgs(page)}`);
check("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 160));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB474 underlay→IndexedDB: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
