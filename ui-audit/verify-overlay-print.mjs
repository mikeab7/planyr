/* B739 verification — the PDF/PNG export must composite the live GIS overlay layers
 * (FEMA floodplain, TxRRC pipelines, …). Drives the built app headlessly: seed a located
 * site, boot the planner, turn FEMA + pipelines ON in the Layers panel, enter print mode,
 * confirm the new "Print map layers" checkbox appears, click Download PDF, and assert that
 * <image data-export-overlay> nodes were composited into the export SVG.
 *
 * The overlay <image> is created (and tagged data-export-overlay) in buildExportSvg BEFORE
 * the network fetch, so this proves the compositing WIRING regardless of whether the sandbox
 * can reach the live FEMA/RRC hosts (the live-imagery paint check is V-logged separately).
 *
 * Run:  npm run build && npx vite preview  (then, in another shell)
 *       node ui-audit/verify-overlay-print.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const site = {
  id: "b739", groupId: "b739", site: "B739 Bayou Site", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${JSON.stringify(site.id)}: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

// Count how many <image> nodes are tagged data-export-overlay (created synchronously in
// buildExportSvg before any fetch), so the signal doesn't depend on live GIS hosts.
const probe = `(() => {
  window.__overlayImg = 0;
  const orig = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name) {
    try { if (name === 'data-export-overlay') window.__overlayImg++; } catch (e) {}
    return orig.apply(this, arguments);
  };
})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
await ctx.addInitScript(probe);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

// Open the Layers panel, enable FEMA + pipelines. They live in the scrollable "Environmental
// & hazards" group below the panel fold, so toggle them via a native DOM click in-page (fires
// React's onChange) instead of a Playwright actionability click gated on viewport visibility.
await page.locator('button:has-text("Layers")').first().click({ timeout: 8000 });
await page.waitForTimeout(400);
const checked = await page.evaluate((labels) => {
  const lbls = [...document.querySelectorAll("label")];
  let n = 0;
  for (const want of labels) {
    const lbl = lbls.find((l) => l.textContent.includes(want));
    const cb = lbl && lbl.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) { cb.click(); }
    if (cb && cb.checked) n++;
  }
  return n;
}, ["FEMA flood zones", "Pipelines (TxRRC)"]);
console.log("raster layers turned on:", checked);
await page.waitForTimeout(500);

// Enter print mode via File ▾ → Download PDF / pick frame…
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
await page.waitForTimeout(700);

// The new "Print map layers" checkbox must be present (mapLayersPrintable wired + a raster layer on).
const cbVisible = await page.locator('label:has-text("Print map layers")').first().isVisible().catch(() => false);

// Click Download PDF (print toolbar) → doPrint → exportPDF → composites overlay <image>s.
await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
await page.waitForTimeout(3000);

const overlayImg = await page.evaluate(() => window.__overlayImg || 0);
console.log("printMapLayers checkbox visible:", cbVisible);
console.log("data-export-overlay <image> nodes composited into the export:", overlayImg);
console.log("page errors:", errs.length ? errs.slice(0, 5) : "none");

const ok = cbVisible && overlayImg >= 2;
console.log(ok ? "PASS ✅ — FEMA + pipelines composited into the PDF export" : "FAIL ❌");
await browser.close();
process.exit(ok ? 0 : 1);
