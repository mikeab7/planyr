/* Polyline free-angle regression (owner report 2026-06-24: "it seemed to only go at specific
 * angles"). The markup polyline/polygon (and easement) rubber-band PREVIEW used to apply snap45()
 * unconditionally, so while drawing, the line jumped to 45° increments even though the committed
 * point was free-angle — making it look like the tool only drew at 45°. Fix: the preview snaps to
 * 45° ONLY while Shift is held, matching the commit. This drives the tool with NO Shift and asserts
 * the live preview segment sits at the cursor's true (~19°) angle, not snapped to 0/45°.
 *
 * Run: vite preview on :4173, then  node ui-audit/verify-polyline-free-angle.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";
const sites = { s1: { id: "s1", groupId: "s1", site: "Katy Tract", name: "Concept A", status: "active",
  origin: { lat: 29.78, lon: -95.79 }, county: "harris",
  parcels: [{ id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] }],
  els: [], markups: [], updatedAt: Date.now() } };
const seed = `(() => { try { if (localStorage.getItem("__pfa__")) return;
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, ${JSON.stringify(JSON.stringify(sites))});
  localStorage.setItem("planarfit:currentSite:v1", "s1"); localStorage.setItem("__pfa__","1"); } catch(e){} })();`;

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`  ${pass ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? "  · " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const box = await page.evaluate(() => { let best=null,ba=0; for (const s of document.querySelectorAll("svg")) { const r=s.getBoundingClientRect(); const a=r.width*r.height; if(a>ba){ba=a;best=r;} } return {x:best.x,y:best.y,w:best.width,h:best.height}; });
await page.getByRole("button", { name: /Polyline/ }).first().click();
await page.waitForTimeout(200);

// Click the first point at canvas centre.
const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
await page.mouse.click(cx, cy);
await page.waitForTimeout(200);

// Move the cursor to a deliberately OFF-45° point: +220px right, +80px down ≈ 20° below horizontal.
// No Shift held. The fix must let the preview track this angle, NOT snap it to 0° or 45°.
const tx = cx + 220, ty = cy + 80;
await page.mouse.move(tx, ty);
await page.waitForTimeout(250);

// Read the dashed preview polyline (stroke-dasharray="5 4" is the mkPoly draft) and measure its
// last segment angle (screen space; +y is downward in SVG, matching the cursor).
const seg = await page.evaluate(() => {
  const pl = document.querySelector('svg polyline[stroke-dasharray="5 4"]');
  if (!pl) return null;
  const pts = pl.getAttribute("points").trim().split(/\s+/).map((p) => p.split(",").map(Number));
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const deg = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  return { a, b, deg };
});
check("the rubber-band preview exists while drawing", !!seg, seg ? `last seg ${seg.deg.toFixed(1)}°` : "no preview polyline");

if (seg) {
  const ad = Math.abs(seg.deg);
  // Cursor angle ≈ atan2(80,220) ≈ 19.98°. The fix → preview ≈ 20°. The OLD bug → snapped to 0°.
  check("preview follows the free cursor angle (~20°), not snapped to 0/45°", ad > 8 && ad < 35, `measured ${seg.deg.toFixed(1)}° (expected ~20°; bug would be ~0°)`);
}
await page.screenshot({ path: OUT + "polyline-free-angle.png" });

// Now hold Shift and move — the preview SHOULD snap to 45° (still works as the intentional constraint).
await page.keyboard.down("Shift");
await page.mouse.move(cx + 220, cy + 80);
await page.waitForTimeout(250);
const segShift = await page.evaluate(() => {
  const pl = document.querySelector('svg polyline[stroke-dasharray="5 4"]');
  if (!pl) return null;
  const pts = pl.getAttribute("points").trim().split(/\s+/).map((p) => p.split(",").map(Number));
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
});
await page.keyboard.up("Shift");
if (segShift != null) {
  const near45 = Math.min(...[0, 45, 90, 135, 180].map((m) => Math.abs(Math.abs(segShift) - m)));
  check("with Shift held, the preview DOES snap to 45° (intentional constraint kept)", near45 < 6, `Shift seg ${segShift.toFixed(1)}° (nearest 45°-multiple Δ=${near45.toFixed(1)})`);
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\nPolyline free-angle: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
