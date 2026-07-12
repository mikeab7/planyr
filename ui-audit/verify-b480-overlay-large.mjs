/* B480-followup (NEW-1) — a LARGE site-plan overlay must re-render after reload from the on-device
 * IndexedDB raster, never strand on the "Re-add … not on this device" placeholder. Cowork found a 7.5 MB
 * overlay showing the placeholder after reload even though its ~10 MB raster sat in IndexedDB: the rehydrate
 * effect's old `cancelled` guard discarded a SLOW idbGet whenever the [sheetOverlays] effect re-ran before
 * the read resolved, and never re-fetched. This drops a large (incompressible → multi-MB) overlay, reloads,
 * injects churn to provoke an effect re-run, and asserts the overlay re-renders from the local raster.
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-b480-overlay-large.mjs */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };
const ovImgs = (page) => page.evaluate(() => document.querySelectorAll("image[data-overlay-image]").length);
const reAddText = (page) => page.evaluate(() => (document.body.innerText.match(/Re-add|not on this device|not synced/i) || [])[0] || "");
const ovRec = (page) => page.evaluate((k) => { try { const m = JSON.parse(localStorage.getItem(k) || "{}"); const s = Object.values(m)[0]; const o = s && s.sheetOverlays && s.sheetOverlays[0]; return o ? { hasSrc: !!o.src, idbKey: o.idbKey || null, storageKey: o.storageKey || null } : null; } catch (_) { return null; } }, SITES_KEY);
const idbBytes = (page, key) => page.evaluate((k) => new Promise((res) => { try { const r = indexedDB.open("planyr"); r.onsuccess = () => { try { const g = r.result.transaction("kv", "readonly").objectStore("kv").get(k); g.onsuccess = () => res(typeof g.result === "string" ? g.result.length : 0); g.onerror = () => res(0); } catch (_) { res(0); } }; r.onerror = () => res(0); } catch (_) { res(0); } }), key);

// Generate a LARGE incompressible PNG in-browser (random pixels → big data-URL → slow idbGet) and feed it
// to the overlay file input as a real File. Returns the data-URL length.
const dropLargeOverlay = (page) => page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 1500; c.height = 1500;
  const ctx = c.getContext("2d"); const img = ctx.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = (i * 7) % 256; img.data[i + 1] = (i * 13) % 256; img.data[i + 2] = (i * 29) % 256; img.data[i + 3] = 255; }
  // scramble so it doesn't compress to nothing
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] ^= (img.data[i + 1] * 31) & 255; }
  ctx.putImageData(img, 0, 0);
  const dataUrl = c.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], "test-large.png", { type: "image/png" });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.querySelector('input[accept="application/pdf,image/*,.dxf,.dwg"]');
  if (!input) return -1;
  input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  return dataUrl.length;
});

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

const ovTab = page.locator('button[title="Overlay"]').first();
if (await ovTab.count()) { await ovTab.click(); await page.waitForTimeout(900); }
const urlLen = await dropLargeOverlay(page);
check("large overlay generated + dropped", urlLen > 1_000_000, `data-url ≈ ${(urlLen / 1024 / 1024).toFixed(1)} MB`);
await page.waitForTimeout(2500); // render + autosave + the (slow) idbPut confirm
check("large overlay rendered after drop", (await ovImgs(page)) > 0, `imgs=${await ovImgs(page)}`);

const rec = await ovRec(page);
check("persisted record references the raster (idbKey or storageKey), heavy src off the cap", !!(rec && (rec.idbKey || rec.storageKey)) , JSON.stringify(rec));
const key = rec && rec.idbKey;
check("large raster is in IndexedDB", key ? (await idbBytes(page, key)) > 1_000_000 : false, key ? `bytes=${await idbBytes(page, key)}` : "no idbKey");

// THE TEST: reload, then immediately churn (zoom/pan) to provoke the [sheetOverlays] effect to re-run while
// the large idbGet is still in flight — the exact condition that stranded it before the fix.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, i % 2 ? 240 : -240); await page.waitForTimeout(120); } // churn during rehydrate
await page.waitForTimeout(4000);
check("large overlay RE-RENDERED after reload (not stranded on the placeholder)", (await ovImgs(page)) > 0, `imgs=${await ovImgs(page)}`);
check("no 'Re-add / not on this device' placeholder is showing", (await reAddText(page)) === "", `text="${await reAddText(page)}"`);
check("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 160));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB480 large-overlay rehydrate: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
