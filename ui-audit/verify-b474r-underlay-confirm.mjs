/* B474 REVIEW (#2/#6) — confirm-before-strip: if the IndexedDB write FAILS, the underlay's inline src must
 * NOT be stripped from the saved record (idbKey is attached only AFTER idbPut confirms), so the aerial
 * survives a reload instead of vanishing silently. We break IndexedDB writes (override IDBObjectStore.put to
 * throw) BEFORE the app loads — indexedDB still exists (idbAvailable() true), but every put fails, exactly
 * like a full/evicted/private-mode store. Logged-out, the underlay has NO cloud fallback, so the inline
 * localStorage copy is the only thing standing between the user and permanent loss. Pre-fix this test fails
 * (record saved with idbKey + src:null → blank aerial on reload); post-fix the aerial re-renders.
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-b474r-underlay-confirm.mjs */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAVUlEQVR42u3OMQ0AMAwEsZ8/6Qyk0iWwI3v2eMHd3QEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+9gE0lQGfXn0lWQAAAABJRU5ErkJggg==";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };
const ulRec = (page) => page.evaluate((k) => { try { const m = JSON.parse(localStorage.getItem(k) || "{}"); const s = Object.values(m)[0]; const u = s && s.underlay; return u ? { hasSrc: typeof u.src === "string" && u.src.startsWith("data:"), idbKey: u.idbKey || null } : null; } catch (_) { return null; } }, SITES_KEY);
const ulImgs = (page) => page.evaluate(() => Array.from(document.querySelectorAll("image")).filter((im) => { const h = im.getAttribute("href") || im.getAttribute("xlink:href") || ""; return h.startsWith("data:"); }).length);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, ignoreHTTPSErrors: true });
// THE INJECTION: break every IndexedDB write before any app code runs. indexedDB still exists (open works,
// so idbAvailable() stays true), but objectStore.put throws → idbPut resolves false → the confirm-before-
// strip path must keep the underlay src inline.
await ctx.addInitScript(() => { try { const p = window.IDBObjectStore && window.IDBObjectStore.prototype; if (p && p.put) p.put = function () { throw new Error("idb put blocked (test)"); }; } catch (_) {} });
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

// Open the "Aerial" panel so its file input mounts, then drop an aerial underlay image.
const aerialTab = page.locator('button[title="Aerial"]').first();
if (await aerialTab.count()) { await aerialTab.click(); await page.waitForTimeout(900); }
const input = page.locator('input[accept="image/*"]').first();
check("underlay file input present", (await input.count()) > 0);
if ((await input.count()) > 0) {
  await input.setInputFiles({ name: "aerial.png", mimeType: "image/png", buffer: Buffer.from(PNG_B64, "base64") });
  await page.waitForTimeout(2200);
}
check("underlay rendered after drop", (await ulImgs(page)) > 0, `images=${await ulImgs(page)}`);
await page.waitForTimeout(1400); // autosave settle + the (failing) idbPut resolves false

// THE CORE ASSERTION: idbPut failed, so the saved record must KEEP the inline src and must NOT carry an
// idbKey (which would have let dropIdbBackedSrc strip the only on-device copy).
const rec = await ulRec(page);
check("idbPut failed → saved record KEEPS the inline src (not stripped)", rec && rec.hasSrc === true, JSON.stringify(rec));
check("idbPut failed → NO idbKey attached (confirm-before-strip held)", rec && rec.idbKey === null, JSON.stringify(rec));

// THE PROOF: reload → the aerial is still there (recovered from the inline localStorage src), not lost.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
check("aerial SURVIVES reload despite the dead IndexedDB (no silent loss)", (await ulImgs(page)) > 0, `images=${await ulImgs(page)}`);
check("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 160));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB474 review — underlay confirm-before-strip: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
