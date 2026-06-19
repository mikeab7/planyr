/* B184 + B185 verification — Site Analysis constraint queries + "show on map" toggle.
 *
 * Boots a LOCATED site near Sheldon Lake, TX (known NWI wetlands + San Jacinto
 * floodplain), opens the ⚐ Analysis left-rail tab, and checks:
 *   B184 — flood / wetlands / pipelines / oil&gas RESOLVE (Present / None found),
 *          NOT "UNKNOWN / Failed to execute query" (the bug).
 *   B185 — a resolved card shows "◍ Map"; clicking it flips to "◉ On map" and adds
 *          the GIS overlay layer to the planner's Leaflet map.
 *
 * Run: node ui-audit/verify-analysis.mjs   (vite preview must be on :4173)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// Origin over Sheldon Lake (wetlands) with a ~1000 ft parcel — guarantees a PRESENT
// wetlands hit so the show-on-map toggle has something to draw.
const site = {
  id: "analysis-demo", groupId: "analysis-demo", site: "Sheldon Constraint Demo", name: "Plan 1",
  origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" }, status: "active",
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const qFails = [];
page.on("console", (m) => { const t = m.text(); if (t.includes("[siteAnalysis]")) qFails.push(t); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2000);

// Open the ⚐ Analysis left-rail tab.
await page.locator('button[title="Analysis"]').click();
await page.waitForTimeout(500);

// Wait for the screen to finish (the Refresh button stops saying "Screening…"), up to 30s.
for (let i = 0; i < 60; i++) {
  const busy = await page.locator('button:has-text("Screening…")').count();
  if (!busy) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1500); // settle

// Read every finding card: category → status label + whether it offers a Map toggle.
const cards = await page.evaluate(() => {
  const cats = ["Floodplain", "Wetlands", "Pipelines", "Oil & gas wells", "Environmental contamination", "Jurisdiction", "Road authority", "Zoning / entitlement"];
  const spans = [...document.querySelectorAll("span")];
  const out = {};
  for (const cat of cats) {
    const lab = spans.find((s) => s.textContent.trim() === cat && s.style.fontWeight === "700");
    if (!lab) continue;
    let card = lab;
    for (let i = 0; i < 7 && card; i++) { card = card.parentElement; if (card && card.style && card.style.borderRadius === "8px") break; }
    const text = (card || lab).innerText.replace(/\s+/g, " ").trim();
    out[cat] = { text, hasMapBtn: !!(card && card.querySelector('button[title*="map"]')) };
  }
  return out;
});

const overlayImgs = () => page.evaluate(() => document.querySelectorAll(".leaflet-pane img.leaflet-image-layer, .envpane img").length);

console.log("\n=== Site Analysis cards ===");
let b184ok = true;
const mustResolve = ["Floodplain", "Wetlands", "Pipelines", "Oil & gas wells"];
for (const [cat, info] of Object.entries(cards)) {
  console.log(`• ${cat}: ${info.text}`);
}
for (const cat of mustResolve) {
  const info = cards[cat];
  if (!info) { console.log(`❌ ${cat}: card not found`); b184ok = false; continue; }
  const t = info.text.toLowerCase();
  const failed = t.includes("failed to execute query") || t.includes("unknown");
  const resolved = t.includes("present") || t.includes("none found");
  if (failed || !resolved) { console.log(`❌ ${cat}: did NOT resolve (still unknown/failed)`); b184ok = false; }
}
console.log(`\nB184 (queries resolve, no "Failed to execute query"): ${b184ok ? "✅ PASS" : "❌ FAIL"}`);

// --- B185: click a resolved card's "◍ Map" toggle ---
const before = await overlayImgs();
// Prefer Wetlands (PRESENT over the lake) for a visible layer.
let b185ok = false, toggleCat = null;
for (const cat of ["Wetlands", "Floodplain", "Pipelines", "Oil & gas wells"]) {
  if (cards[cat] && cards[cat].hasMapBtn) { toggleCat = cat; break; }
}
if (toggleCat) {
  // Click the Map button inside that category's card.
  const clicked = await page.evaluate((cat) => {
    const spans = [...document.querySelectorAll("span")];
    const lab = spans.find((s) => s.textContent.trim() === cat && s.style.fontWeight === "700");
    if (!lab) return false;
    let card = lab;
    for (let i = 0; i < 7 && card; i++) { card = card.parentElement; if (card && card.style && card.style.borderRadius === "8px") break; }
    const btn = card && card.querySelector('button[title*="map"]');
    if (!btn) return false;
    btn.click(); return true;
  }, toggleCat);
  await page.waitForTimeout(3500); // let the overlay probe + image export land
  const after = await overlayImgs();
  const onState = await page.evaluate((cat) => {
    const spans = [...document.querySelectorAll("span")];
    const lab = spans.find((s) => s.textContent.trim() === cat && s.style.fontWeight === "700");
    let card = lab;
    for (let i = 0; i < 7 && card; i++) { card = card.parentElement; if (card && card.style && card.style.borderRadius === "8px") break; }
    const btn = card && card.querySelector('button[title*="map"]');
    return btn ? btn.innerText.trim() : "(no btn)";
  }, toggleCat);
  console.log(`\nB185 toggle on "${toggleCat}": clicked=${clicked} button="${onState}" overlayImgs ${before}→${after}`);
  b185ok = clicked && /on map/i.test(onState) && after > before;
  console.log(`B185 (card toggles the map overlay on): ${b185ok ? "✅ PASS" : "❌ FAIL"}`);
} else {
  console.log("\nB185: no resolved card offered a Map toggle (depends on B184 resolving) ❌");
}

if (qFails.length) { console.log("\n[siteAnalysis] diagnostics logged (expected only on a real failure):"); qFails.forEach((l) => console.log("  " + l.split("\n")[0])); }

await page.screenshot({ path: "ui-audit/screens/analysis-verify.png" });
console.log("\nscreenshot → ui-audit/screens/analysis-verify.png");
console.log(`\nRESULT: B184 ${b184ok ? "PASS" : "FAIL"} · B185 ${b185ok ? "PASS" : "FAIL"}`);
await browser.close();
process.exit(b184ok && b185ok ? 0 : 1);
