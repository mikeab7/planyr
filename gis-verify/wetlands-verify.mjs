// B130 in-browser verification driver (Playwright + headless Chromium).
// Loads wetlands-verify.html, watches the live network for the NWI exportImage request,
// waits for esri-leaflet's `load` event, then screenshots the painted map. Prints a JSON
// verdict. Run: NODE_PATH=/opt/node22/lib/node_modules node gis-verify/wetlands-verify.mjs
// Global Playwright (ESM import doesn't honour NODE_PATH; it's CommonJS, so default-import).
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const PORT = process.env.PORT || "8000";
const PAGE = `http://localhost:${PORT}/gis-verify/wetlands-verify.html`;
const SHOT = "gis-verify/wetlands-fwsprimary-vector-verified.png";
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const exportResponses = [];
const failures = [];

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--ignore-certificate-errors"] });
// ignoreHTTPSErrors: this sandbox's egress proxy MITMs all TLS with an "Anthropic Egress
// Gateway" CA that the OS trusts (curl/openssl OK) but Playwright's bundled Chromium doesn't.
// Real planyr.io users hit fwsprimary directly with its genuine public USGS cert and no proxy,
// so accepting the proxy cert here faithfully emulates the production network path.
const page = await browser.newPage({ viewport: { width: 820, height: 820 }, ignoreHTTPSErrors: true });

page.on("response", (r) => {
  const u = r.url();
  if (u.includes("Wetlands_gdb_split") || /\/export(\?|$)/i.test(u)) {
    exportResponses.push({ status: r.status(), type: r.headers()["content-type"] || "", isExport: /\/export(\?|$)/i.test(u), url: u.slice(0, 100) });
  }
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (u.includes("fwsprimary")) failures.push({ url: u.slice(0, 90), err: r.failure() && r.failure().errorText });
});

await page.goto(PAGE, { waitUntil: "load", timeout: 30000 });

// Wait (up to 25s) for esri-leaflet to fire its `load` event for the wetlands layer.
let loaded = false;
for (let i = 0; i < 50; i++) {
  loaded = await page.evaluate(() => window.__verify && window.__verify.wetlandsLoaded === true);
  if (loaded) break;
  await page.waitForTimeout(500);
}
// settle a beat so tiles finish painting before the screenshot
await page.waitForTimeout(1500);

const verify = await page.evaluate(() => window.__verify);
await page.screenshot({ path: SHOT });
await browser.close();

const exportOnly = exportResponses.filter((r) => r.isExport);
const allExport200png = exportOnly.length > 0 && exportOnly.every((r) => r.status === 200 && /image\//.test(r.type));

console.log(JSON.stringify({
  verdict: loaded && allExport200png && failures.length === 0 ? "PASS" : "CHECK",
  esriLeafletLoadEvent: loaded,
  exportRequestsSeen: exportOnly.length,
  exportAll200png: allExport200png,
  exportSamples: exportOnly.slice(0, 4),
  otherWetlandsResponses: exportResponses.filter((r) => !r.isExport).slice(0, 3),
  requestFailures: failures,
  pageVerifyState: verify,
  screenshot: SHOT,
}, null, 2));
