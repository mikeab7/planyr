/* V249 / B731 (code B722) — the FAR row is gone from the PRINTED metrics band (PDF/export parity).
 *
 * Drives the REAL export path in the running app (logged-out, seeded site with a building):
 * File ▾ → "Download PDF / pick frame…" → print preview → "Download PDF" → exportPDF() builds the
 * composed print sheet SVG via the shared printMetricPairs() + buildPrintSheetSvg(). We intercept
 * the image/svg+xml blob handed to URL.createObjectURL (the exact sheet that gets rasterized into
 * the PDF) and assert its printed metrics band lists the real metrics but NO "FAR" row.
 *
 * This confirms in the running app (not from reading code) that the printed band dropped FAR.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

// A site with a real building + parking + parcels so the metrics band is fully populated.
const site = {
  id: "uiaudit-v249", groupId: "uiaudit-v249", site: "Metrics Band Tract", name: "Plan 1",
  origin: null, county: "harris",
  parcels: [
    { id: "pcA", locked: true, active: true, points: [{ x: -400, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 200 }, { x: -400, y: 200 }] },
  ],
  els: [
    { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
    { id: "e2", type: "parking", cx: -300, cy: 90, w: 150, h: 180, rot: 0 },
  ],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [],
  updatedAt: Date.now(), data: { status: "active" },
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  ⚠ pageerror:", e.message));
page.on("dialog", (d) => { console.log("  ⚠ dialog:", d.type(), JSON.stringify(d.message())); d.dismiss().catch(() => {}); });
page.on("console", (m) => { const t = m.text(); if (/pdf|export|Nothing|Couldn|error/i.test(t)) console.log("  · console:", t); });
await page.addInitScript(seed);
// Capture every image/svg+xml blob text handed to URL.createObjectURL (the sheet that gets rasterized).
await page.addInitScript(() => {
  window.__svgBlobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    try {
      if (obj && obj.type === "image/svg+xml") obj.text().then((t) => window.__svgBlobs.push(t)).catch(() => {});
    } catch (_) {}
    return orig(obj);
  };
});
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
try { await page.getByRole("button", { name: /site planner/i }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(1500);

// Open File ▾ → Download PDF / pick frame…
await page.getByRole("button", { name: /^File ▾$/ }).first().click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /Download PDF \/ pick frame/ }).first().click();
await page.waitForTimeout(1200);

// Print preview is up (auto-fitted frame around the building). Click its Download PDF.
const dl = page.getByRole("button", { name: /^Download PDF$/ }).first();
ok(await dl.isVisible().catch(() => false), "print preview shows a Download PDF button (print mode entered)");
await dl.click();

// exportPDF is async (inline images + rasterize). Poll for the captured sheet SVG.
let sheet = "";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500);
  const blobs = await page.evaluate(() => window.__svgBlobs || []);
  sheet = blobs.find((t) => /Site area/.test(t) && /Lot coverage/.test(t)) || "";
  if (sheet) break;
}
ok(!!sheet, "captured the composed print-sheet SVG (the rasterized metrics band)");

if (sheet) {
  // The printed metrics band must carry the real metrics …
  ok(/Site area/.test(sheet), "printed band lists 'Site area'");
  ok(/Lot coverage/.test(sheet), "printed band lists 'Lot coverage'");
  ok(/Car stalls/.test(sheet), "printed band lists 'Car stalls'");
  ok(/Impervious/.test(sheet), "printed band lists 'Impervious'");
  // … and must NOT list FAR anywhere (label or the "(1-story)" variant).
  ok(!/FAR/.test(sheet), "printed band has NO 'FAR' row (label absent)");
  ok(!/1-story/.test(sheet), "printed band has NO 'FAR (1-story)' variant");
}

console.log(`\nV249 FAR-print parity: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
