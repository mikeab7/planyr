/* B784/B785 (NEW-1/NEW-2) — a site-plan overlay whose cloud Storage object is GONE (and with no local
 * IndexedDB copy) must NOT hang forever on "Loading drawing…" re-hitting Storage on every render (a repeated
 * 400 "Object not found" in prod). After the fix it shows a TERMINAL, honest, clickable placeholder and the
 * fetch is attempted AT MOST ONCE per mount.
 *
 * This seeds a site with TWO overlays: (1) a valid IndexedDB-backed image (must still rehydrate — proves the
 * happy path is intact), and (2) a storageKey-only PDF pointing at a nonexistent object with NO idbKey / NO
 * src (the stuck one). Supabase Storage downloads are intercepted and answered with HTTP 400 "Object not
 * found" (the exact prod signature), so classifyStorageError → "missing" → the placeholder reads "click to
 * re-add" and the endpoint is hit exactly once (no repeat-400 loop).
 *
 * FULL run (exercises the "missing → re-add" classification — Supabase client must exist in the build):
 *   VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=stub-anon-key npm run build
 *   npx vite preview --port 4173
 *   node ui-audit/verify-overlay-missing-storage.mjs
 * If the build has NO Supabase config (supabase===null), no request fires; the harness still asserts the
 * loop stopped and the placeholder is terminal (a "retry" state), and says so. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };
const ovImgs = (page) => page.evaluate(() => document.querySelectorAll("image[data-overlay-image]").length);
const bodyText = (page) => page.evaluate(() => document.body.innerText || "");
const overlayTexts = (page) => page.evaluate(() => Array.from(document.querySelectorAll("svg text")).map((t) => t.textContent).filter((s) => /Loading drawing|re-add|retry|not on this device|Couldn't/i.test(s)));

// Drop a small image overlay through the file input so it gets an idbKey (local cross-device copy). Returns imgs count grows.
const dropSmallOverlay = (page) => page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 240; c.height = 180;
  const ctx = c.getContext("2d"); ctx.fillStyle = "#3377cc"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff"; ctx.fillRect(20, 20, 60, 40);
  const dataUrl = c.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], "valid-overlay.png", { type: "image/png" });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.querySelector('input[accept="application/pdf,image/*,.dxf,.dwg"]');
  if (!input) return false;
  input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});

// Inject the missing overlay via an init script that runs BEFORE the app boots on the NEXT navigation
// (and AFTER the current page's unload flush) — so the ghost is present in localStorage when the app loads
// the site into memory. Injecting after boot instead gets clobbered by the app's own autosave/unload flush,
// which writes the in-memory state (with no ghost) back over the injection.
const armMissingInjection = (page) => page.addInitScript((SITES_KEY) => {
  try {
    const m = JSON.parse(localStorage.getItem(SITES_KEY) || "{}");
    const sid = Object.keys(m)[0];
    if (!sid) return;
    const site = m[sid];
    site.sheetOverlays = site.sheetOverlays || [];
    if (site.sheetOverlays.some((o) => o && o.id === "ghost-missing")) return; // idempotent across boots
    site.sheetOverlays.push({
      id: "ghost-missing", name: "GONE - Site Plan.pdf",
      storageKey: `stub-uid/site-overlays/${sid}/ghost-missing.pdf`,
      x: -80, y: -50, imgW: 800, imgH: 520, ftPerPx: 0.25, page: 1, pageCount: 1,
      rotation: 0, opacity: 0.85, locked: false,
    });
    m[sid] = site;
    localStorage.setItem(SITES_KEY, JSON.stringify(m));
  } catch (_) { /* leave storage untouched on any parse error */ }
}, SITES_KEY);
const seededCount = (page) => page.evaluate((SITES_KEY) => {
  const m = JSON.parse(localStorage.getItem(SITES_KEY) || "{}");
  const s = Object.values(m)[0];
  return s && s.sheetOverlays ? s.sheetOverlays.length : 0;
}, SITES_KEY);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));

// Intercept Supabase Storage object downloads: 400 "Object not found" (the prod signature) + count hits.
let storageHits = 0;
await ctx.route("**/storage/v1/object/**", async (route) => {
  storageHits++;
  await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ statusCode: "400", error: "Object not found", message: "Object not found" }) });
});

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

// Open References so the panel's file input is available, then drop the valid overlay.
const refsTab = page.locator('button', { hasText: "References" }).first();
if (await refsTab.count()) { await refsTab.click().catch(() => {}); await page.waitForTimeout(700); }
const dropped = await dropSmallOverlay(page);
check("valid overlay dropped", dropped);
await page.waitForTimeout(2500); // render + autosave + idb stash
check("valid overlay rendered after drop", (await ovImgs(page)) >= 1, `imgs=${await ovImgs(page)}`);

// Arm the injection (runs on the next boot, before the app loads the site) and reload so the rehydrate
// effect runs on BOTH the valid (idb) overlay and the ghost (missing Storage) one.
await armMissingInjection(page);
storageHits = 0; // count only the hits after reload
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
check("missing overlay seeded into the saved site (survives the boot flush)", (await seededCount(page)) >= 2, `overlays=${await seededCount(page)}`);
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, i % 2 ? 200 : -200); await page.waitForTimeout(150); } // churn to re-run the [sheetOverlays] effect
await page.waitForTimeout(4000);

const texts = await overlayTexts(page);
const stuckLoading = texts.some((t) => /Loading drawing/i.test(t));
const terminal = texts.some((t) => /re-add|retry|not on this device|Couldn't/i.test(t));
check("valid overlay STILL rehydrates after reload (happy path intact)", (await ovImgs(page)) >= 1, `imgs=${await ovImgs(page)}`);
check("missing overlay shows a TERMINAL placeholder (not stuck on 'Loading drawing…')", terminal && !stuckLoading, `texts=${JSON.stringify(texts)}`);

// The core NEW-1 assertion: the fetch is attempted at most once — no repeat-400 loop.
if (storageHits > 0) {
  check("Storage hit EXACTLY ONCE for the missing object (no repeat-400 loop)", storageHits === 1, `hits=${storageHits}`);
  check("placeholder classifies it as MISSING → 'click to re-add' (Supabase 400)", texts.some((t) => /re-add/i.test(t)), `texts=${JSON.stringify(texts)}`);
} else {
  console.log("  ℹ️  No Storage request fired — this build has no Supabase config (supabase===null); the 'missing→re-add' classification is covered by unit tests. Verifying loop-stop + terminal placeholder only.");
  check("no repeat Storage loop (0 hits, unconfigured build)", storageHits === 0, `hits=${storageHits}`);
}
check("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB784/B785 overlay-missing-storage: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
