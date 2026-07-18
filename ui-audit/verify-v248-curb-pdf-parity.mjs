/* V248 (B719) live-look verification: road curb/border drawn to a true 6" (0.5') curb, TO SCALE —
 * thin at overview zoom, thickens proportionally on zoom-in, and PDF/print export PARITY (the
 * printed curb matches the on-screen thin curb, scaled consistently, not a fixed pixel weight).
 *
 * Reuses the verify-b718-b719.mjs demo (a 6" road + a 12" road at the same zoom — the 12" curb
 * must render ~2x the 6" curb's stroke width, both on screen AND in the exported print sheet).
 *
 * Run: node ui-audit/verify-v248-curb-pdf-parity.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ROAD_FILL = "#b9b4a8";
const ROAD_STROKE = "#7c786d";
const DEMO_ID = "verify-v248-pdfparity";

const ptsB = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
const bboxB = roadStripBBox(ptsB, [], 24, 0.5, { defaultRadius: 120 });
const roadB = { id: "rB", type: "road", pts: ptsB, vtx: [], travelW: 24, curb: 0.5, roadClass: "aisle", ...bboxB };
const ptsC = [{ x: -150, y: 150 }, { x: 150, y: 150 }];
const bboxC = roadStripBBox(ptsC, [], 24, 1.0, { defaultRadius: 120 });
const roadC = { id: "rC", type: "road", pts: ptsC, vtx: [], travelW: 24, curb: 1.0, roadClass: "aisle", ...bboxC };
const parcel = { id: "pc1", locked: false, points: [{ x: -220, y: -120 }, { x: 220, y: -120 }, { x: 220, y: 220 }, { x: -220, y: 220 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify V248 PDF parity", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [roadB, roadC], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
  // Capture the intermediate composed print-sheet SVG (before PDF rasterization) so we can
  // measure the curb stroke widths that actually reach the printed page.
  window.__capturedSvgs = [];
  const origCOU = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    try { if (blob && blob.type === 'image/svg+xml') blob.text().then((t) => window.__capturedSvgs.push(t)); } catch (e) {}
    return origCOU(blob);
  };
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NETWORK_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::|ERR_CONNECTION_RESET/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push(m.text()); });
page.on("dialog", (d) => { errors.push(`alert: ${d.message()}`); d.dismiss().catch(() => {}); });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(600);

const curbWidths = () => page.evaluate((stroke) => {
  const ws = [...document.querySelectorAll("svg polyline")]
    .filter((p) => (p.getAttribute("stroke") || "").toLowerCase() === stroke)
    .map((p) => parseFloat(p.getAttribute("stroke-width")))
    .filter((w) => Number.isFinite(w));
  return [...new Set(ws.map((w) => Math.round(w * 1000) / 1000))].sort((a, b) => a - b);
}, ROAD_STROKE);

// ---- Multiple zoom levels: thin at overview, thickens proportionally on zoom-in ----
console.log("\n== B719 thin-to-scale curb across zoom levels ==");
const wFit = await curbWidths();
log(wFit.length >= 2, `at fit zoom: curb widths ${wFit.join(", ")}px (expect 2 distinct values)`);
log(wFit[0] <= 1.6, `6" curb reads THIN at fit zoom (${wFit[0]}px, well under the old ~3px band)`);
const ratioFit = wFit.length >= 2 ? wFit[1] / wFit[0] : NaN;
log(ratioFit >= 1.8 && ratioFit <= 2.2, `12" curb ~2x the 6" curb at fit zoom (ratio ${ratioFit.toFixed(2)})`);
await page.screenshot({ path: OUT + "v248-fit-zoom.png" });

const zoom = async (n) => { for (let i = 0; i < Math.abs(n); i++) { await page.mouse.move(720, 450); await page.mouse.wheel(0, n < 0 ? -300 : 300); await page.waitForTimeout(70); } await page.waitForTimeout(300); };
await zoom(-8); // zoom IN
const wZoomedIn = await curbWidths();
log(wZoomedIn.length >= 2, `zoomed in: curb widths ${wZoomedIn.join(", ")}px`);
log(wZoomedIn[0] > wFit[0], `6" curb GREW on zoom-in (${wFit[0]}px → ${wZoomedIn[0]}px) — proportional to real-world scale`);
const ratioZoomIn = wZoomedIn.length >= 2 ? wZoomedIn[1] / wZoomedIn[0] : NaN;
log(ratioZoomIn >= 1.8 && ratioZoomIn <= 2.2, `12"/6" ratio still ~2.0 after zoom (${ratioZoomIn.toFixed(2)}) — proportional growth, not a fixed weight`);
await page.screenshot({ path: OUT + "v248-zoomed-in.png" });
await zoom(8); // back to fit for the export check
await page.waitForTimeout(300);

// ---- PDF-PARITY: export the sheet and confirm the printed curb matches the on-screen ratio ----
console.log("\n== B719 PDF-PARITY: exported sheet curb matches on-screen thin-to-scale curb ==");
const wBeforeExport = await curbWidths();
await page.getByText("File ▾", { exact: false }).first().click({ timeout: 5000 });
await page.waitForTimeout(300);
await page.getByText("Download PDF / pick frame", { exact: false }).first().click({ timeout: 5000 });
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Download PDF" }).first().click({ timeout: 5000 });

let svgText = null;
for (let i = 0; i < 60 && !svgText; i++) {
  await page.waitForTimeout(300);
  const arr = await page.evaluate(() => window.__capturedSvgs || []);
  if (arr.length) svgText = arr[0];
}
log(!!svgText, `composed print-sheet SVG captured (${svgText ? svgText.length : 0} bytes)`);

if (svgText) {
  const widths = [...svgText.matchAll(/<polyline[^>]*stroke="#7c786d"[^>]*stroke-width="([\d.]+)"/gi)]
    .map((m) => parseFloat(m[1]));
  const uniq = [...new Set(widths.map((w) => Math.round(w * 1000) / 1000))].sort((a, b) => a - b);
  log(uniq.length >= 2, `printed sheet has ${uniq.length} distinct curb stroke widths (${uniq.join(", ")}px)`);
  const ratioPrint = uniq.length >= 2 ? uniq[1] / uniq[0] : NaN;
  log(ratioPrint >= 1.8 && ratioPrint <= 2.2, `printed 12"/6" curb ratio ~2.0 (${ratioPrint.toFixed(2)}) — PDF-PARITY: the export preserves the on-screen to-scale relationship (was ${(wBeforeExport[1] / wBeforeExport[0]).toFixed(2)} on screen)`);
} else {
  fail++;
}

console.log(errors.length ? `\nPAGE ERRORS/ALERTS:\n${errors.slice(0, 10).join("\n")}` : "\n(no page errors)");
if (errors.length) fail++;
console.log(fail === 0 ? "\n✓ ALL V248 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
