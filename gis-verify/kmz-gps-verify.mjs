/* B683 / B684 live verification — GPS lat/long readout + Google Earth (KMZ) export.
 *
 * Drives the real built app headless:
 *   1. MAP VIEWER: mouse over the map → a WGS84 lat/long "you are here" chip appears (B683);
 *      right-click empty map → "Export to Google Earth (KMZ)" downloads a valid .kmz (B684).
 *   2. SITE-PLANNER CANVAS: open the seeded site → mouse over the canvas → the GPS chip shows
 *      lat/long (B683); right-click empty canvas → export → a valid .kmz downloads (B684).
 * Each downloaded .kmz is unzipped (its central-dir + doc.kml read) and checked to be real KML
 * with lon,lat-ordered coordinates near the seeded site (−95.8°, 29.79°) — the #1 KML gotcha.
 *
 * Run: preview server on :4173, then `node gis-verify/kmz-gps-verify.mjs`
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || undefined;

// A georeferenced site with a boundary parcel, a building, and a detention pond (feet frame).
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({
    a1: { id:"a1", groupId:"a1", site:"Katy Logistics Park", name:"Plan 1",
          origin:{ lat:29.786, lon:-95.83 }, county:"harris",
          parcels:[{ id:"pc1", active:true, addr:"123 Test Rd", points:[{x:-400,y:-300},{x:400,y:-300},{x:400,y:300},{x:-400,y:300}] }],
          els:[{ id:"b1", type:"building", cx:0, cy:0, w:400, h:200, rot:0 },
               { id:"pd1", type:"pond", points:[{x:-350,y:180},{x:-250,y:180},{x:-250,y:270},{x:-350,y:270}] }],
          measures:[], callouts:[], markups:[], settings:{}, underlay:null,
          updatedAt: Date.now(), status:"active" }
  }));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch(e){} })();`;

// Minimal ZIP reader: pull the single STORED (or DEFLATEd) entry's bytes back out.
function unzipFirst(buf) {
  // Local file header at 0: sig(4) ver(2) flag(2) method(2) time(2) date(2) crc(4) comp(4) unc(4) nlen(2) elen(2)
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) throw new Error("not a zip");
  const method = buf.readUInt16LE(8);
  const comp = buf.readUInt32LE(18);
  const nlen = buf.readUInt16LE(26);
  const elen = buf.readUInt16LE(28);
  const name = buf.slice(30, 30 + nlen).toString("utf8");
  const dataStart = 30 + nlen + elen;
  const data = buf.slice(dataStart, dataStart + comp);
  const bytes = method === 0 ? data : inflateRawSync(data);
  return { name, text: bytes.toString("utf8") };
}

function checkKml(text, tag, results) {
  const okKml = text.includes("<kml") && text.includes("<Document>");
  // A coordinate near the seeded site, lon,lat order → lon ≈ −95.8 comes BEFORE lat ≈ 29.79.
  const m = text.match(/<coordinates>\s*(-?\d+\.\d+),(-?\d+\.\d+)/);
  const lon = m ? Number(m[1]) : NaN, lat = m ? Number(m[2]) : NaN;
  const orderOk = m && lon < -90 && lon > -100 && lat > 29 && lat < 31; // lon first (negative ~−95), lat second (~29.8)
  const hasBuilding = /Building 1/.test(text);
  const hasBoundary = /<name>123 Test Rd<\/name>|<name>Boundary/.test(text);
  results.push([`${tag}: valid KML document`, okKml]);
  results.push([`${tag}: coordinates are lon,lat (lon=${m ? lon : "?"}, lat=${m ? lat : "?"})`, !!orderOk]);
  results.push([`${tag}: boundary + building present`, hasBoundary && hasBuilding]);
}

const results = [];
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const consoleErrs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text()); });

async function grabDownload(clickFn) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), clickFn()]);
  const path = await dl.path();
  const buf = await readFile(path);
  return { name: dl.suggestedFilename(), buf };
}

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

// ── 1. MAP VIEWER ──────────────────────────────────────────────────────────
const mapBox = await page.locator(".leaflet-container").first().boundingBox();
await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
await page.mouse.move(mapBox.x + mapBox.width / 2 + 12, mapBox.y + mapBox.height / 2 + 8);
await page.waitForTimeout(400);
const mapReadout = await page.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find((d) => /°,\s/.test(d.textContent) && d.children.length === 0 && /^-?\d+\.\d{6}°/.test(d.textContent.trim()));
  return el ? el.textContent.trim() : null;
});
results.push([`MAP VIEWER: GPS readout shows lat/long ("${mapReadout || "—"}")`, !!mapReadout && /-?\d+\.\d{6}°,\s*-?\d+\.\d{6}°/.test(mapReadout)]);

// Guard regression: right-click ON the site marker must show the STATUS menu, not the export menu.
const pin = await page.locator(".leaflet-marker-pane img, .leaflet-marker-pane .leaflet-marker-icon").first().boundingBox().catch(() => null);
if (pin) {
  await page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2, { button: "right" });
  await page.waitForTimeout(300);
  const exportShown = await page.getByText("Export to Google Earth (KMZ)").first().isVisible().catch(() => false);
  results.push(["MAP VIEWER: right-click ON a site shows status menu, NOT export", !exportShown]);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// Right-click empty map → export menu → KMZ download.
await page.mouse.click(mapBox.x + 60, mapBox.y + mapBox.height - 60, { button: "right" });
await page.waitForTimeout(300);
const mapMenuVisible = await page.getByText("Export to Google Earth (KMZ)").first().isVisible().catch(() => false);
results.push(["MAP VIEWER: right-click export menu appears", mapMenuVisible]);
if (mapMenuVisible) {
  try {
    const { name, buf } = await grabDownload(() => page.getByText("Export to Google Earth (KMZ)").first().click());
    results.push([`MAP VIEWER: KMZ downloaded (${name})`, /\.kmz$/.test(name)]);
    const { name: inner, text } = unzipFirst(buf);
    results.push([`MAP VIEWER: archive contains doc.kml (${inner})`, inner === "doc.kml"]);
    checkKml(text, "MAP VIEWER", results);
  } catch (e) { results.push([`MAP VIEWER: KMZ download — ${e.message}`, false]); }
}

// ── 2. SITE-PLANNER CANVAS ───────────────────────────────────────────────────
// Open the seeded site (its "Your sites" panel row → onOpenSite).
await page.locator('[title^="Open site"]').first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(3000);
// The planner canvas is the LARGEST <svg> on the page (icon svgs are tiny).
const canvas = await page.evaluate(() => {
  let best = null, area = 0;
  for (const s of document.querySelectorAll("svg")) {
    const r = s.getBoundingClientRect();
    if (r.width * r.height > area) { area = r.width * r.height; best = { x: r.x, y: r.y, width: r.width, height: r.height }; }
  }
  return best && best.width > 300 ? best : null;
});
if (canvas) {
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.move(canvas.x + canvas.width / 2 + 15, canvas.y + canvas.height / 2 + 10);
  await page.waitForTimeout(400);
  const canvasReadout = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => d.children.length === 0 && /^-?\d+\.\d{6}°,\s*-?\d+\.\d{6}°$/.test(d.textContent.trim()));
    return el ? el.textContent.trim() : null;
  });
  results.push([`CANVAS: GPS readout shows lat/long ("${canvasReadout || "—"}")`, !!canvasReadout]);

  // Right-click empty canvas → Map menu → export.
  await page.mouse.click(canvas.x + canvas.width - 80, canvas.y + 80, { button: "right" });
  await page.waitForTimeout(300);
  const canvasMenu = await page.getByText("Export to Google Earth (KMZ)").first().isVisible().catch(() => false);
  results.push(["CANVAS: right-click export menu appears", canvasMenu]);
  if (canvasMenu) {
    try {
      const { name, buf } = await grabDownload(() => page.getByText("Export to Google Earth (KMZ)").first().click());
      results.push([`CANVAS: KMZ downloaded (${name})`, /\.kmz$/.test(name)]);
      const { text } = unzipFirst(buf);
      checkKml(text, "CANVAS", results);
    } catch (e) { results.push([`CANVAS: KMZ download — ${e.message}`, false]); }
  }
} else {
  results.push(["CANVAS: opened the planner", false]);
}

await browser.close();

console.log("\n──── B683 / B684 verification ────");
let pass = 0;
for (const [label, ok] of results) { console.log(`${ok ? "✓" : "✗"} ${label}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed`);
if (consoleErrs.length) console.log(`\n(console errors: ${consoleErrs.slice(0, 5).join(" | ")})`);
process.exit(pass === results.length ? 0 : 1);
