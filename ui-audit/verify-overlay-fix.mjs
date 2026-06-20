/* Verify the overlay-size fix (NEW-1):
 *  A) Dropping an IMAGE runs the real addOverlayFile path → lands ~60% of the view
 *     (sane), never splattered. (PDF path uses pdf.js which the sandbox Chromium can't
 *     run — getOrInsertComputed — so we exercise the image path; the scale-guard logic
 *     is unit-tested separately in test/overlayScale.test.js.)
 *  B) An already-splattered overlay (mis-scaled ~20× too big) shrinks to a sane size
 *     with one click of the new "Size to view" button. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

// --- minimal valid RGB PNG (W×H, solid colour) ---
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const chunk = (type, data) => { const t = Buffer.from(type, "latin1"); const body = Buffer.concat([t, data]); return Buffer.concat([u32(data.length), body, u32(crc32(body))]); };
function makePng(w, h, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk("IHDR", Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]));
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from([r, g, b])))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([sig, ihdr, chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const pngBytes = Array.from(makePng(800, 600, [180, 120, 60]));

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const baseSite = (id, extra) => ({ id, groupId: id, site: id, name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now(), ...extra });

// Splattered overlay for Test B (≈20× too big, like a misread 1"=600' scale)
const imgW = 2592, imgH = 1728, badFtPerPx = 600 / 72;
const drawSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><text x='160' y='980' font-size='240' font-family='monospace' fill='#1a1a1a'>BV-255-2024-LD1</text></svg>`;
const splatterOv = { id: "ov1", name: "BV-255-2024-LD1 - ARCH ASSET FOR.pdf", imgW, imgH, page: 1, pageCount: 1,
  ftPerPx: badFtPerPx, rotation: 0, opacity: 0.85, locked: false, x: -(imgW * badFtPerPx) / 2, y: -(imgH * badFtPerPx) / 2,
  detectedScale: 600, sheet: { std: true, label: "ARCH D" }, src: "data:image/svg+xml;utf8," + encodeURIComponent(drawSvg) };

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let fail = 0;
const imgBox = (page) => page.evaluate(() => { const i = document.querySelector('image[data-overlay-image="1"]'); if (!i) return null; const b = i.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; });

// ---------- Test A: drop an image → sane size ----------
{
  const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ A: baseSite("A") })}));localStorage.setItem('planarfit:currentSite:v1','A');}catch(e){}})();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { console.log("  [A DIALOG]", d.message().slice(0, 120)); fail++; await d.accept().catch(() => {}); });
  await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(1600);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {}
  await page.waitForTimeout(600);
  const dropDiv = await page.evaluateHandle(() => document.querySelector('svg[role="application"]').parentElement);
  const dt = await page.evaluateHandle((data) => { const d = new DataTransfer(); d.items.add(new File([new Uint8Array(data)], "site-plan.png", { type: "image/png" })); return d; }, pngBytes);
  await dropDiv.asElement().dispatchEvent("dragover", { dataTransfer: dt });
  await dropDiv.asElement().dispatchEvent("drop", { dataTransfer: dt });
  await page.waitForTimeout(2500);
  const box = await imgBox(page);
  await page.screenshot({ path: OUT + "verify-A-image-drop.png" });
  const sane = box && box.w > 200 && box.w < 1440 * 1.5; // visible, not splattered
  console.log(`Test A (image drop): overlay box=${JSON.stringify(box)} viewport=1440  → ${sane ? "PASS (sane)" : "FAIL"}`);
  if (!sane) fail++;
  await ctx.close();
}

// ---------- Test B: rescue a splattered overlay with "Size to view" ----------
{
  const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ B: baseSite("B", { sheetOverlays: [splatterOv] }) })}));localStorage.setItem('planarfit:currentSite:v1','B');}catch(e){}})();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(1600);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {}
  await page.waitForTimeout(600);
  const before = await imgBox(page);
  await page.screenshot({ path: OUT + "verify-B-before.png" });
  await page.locator('[title="Overlay"]').first().click(); await page.waitForTimeout(300); // open overlay panel
  await page.getByText("BV-255-2024-LD1 - ARCH ASSET FOR.pdf").first().click(); await page.waitForTimeout(300); // select overlay
  await page.getByRole("button", { name: "Size to view" }).click(); await page.waitForTimeout(600);
  const after = await imgBox(page);
  await page.screenshot({ path: OUT + "verify-B-after.png" });
  const shrank = before && after && after.w < before.w && after.w > 200 && after.w < 1440 * 1.2;
  console.log(`Test B (Size to view): before=${JSON.stringify(before)} after=${JSON.stringify(after)} → ${shrank ? "PASS (shrank to sane)" : "FAIL"}`);
  if (!shrank) fail++;
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? "\n✓ ALL OVERLAY-FIX CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
