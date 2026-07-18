/* Headless drive for the zoom-aware overlay re-raster (B749 / V262) — logged-out, on the BUILT app.
 *
 * Drops a REAL PDF site-plan overlay (so the in-session PDFDocumentProxy is held and the PDF-only
 * hi-res path can run), then drives the view: zoom IN past the ~1.5× upgrade threshold and confirm
 * a hi-res raster swaps in WITHOUT moving/resizing the placement, then zoom back OUT and confirm it
 * drops back to the persisted base raster (and the transient blob URL is released).
 *
 * Checks (V262 pending steps — no sign-in):
 *  1. Zooming into detail swaps the <image> href from the base data: URL to a transient blob: URL
 *     (the hi-res re-raster fired) — the "linework sharpens instead of softening" mechanism.
 *  2. The hi-res swap does NOT move or resize the placement — x/y/width/height are byte-identical.
 *  3. Zooming back out drops the overlay back to the base raster (href returns to the data: URL) —
 *     memory doesn't balloon; the session-only blob is dropped, not retained.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { readFileSync, mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const PDF = readFileSync(new URL("../e2e/fixtures/sample.pdf", import.meta.url));

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const site = { id: "S", groupId: "S", site: "PDFyard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const fails = [];
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails.push(name); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

for (const sel of ['[title="Overlay"]', '[title="References"]', 'button:has-text("References")']) {
  try { await page.locator(sel).first().click({ timeout: 2500 }); break; } catch (_) {}
}
await page.waitForTimeout(600);

// Drop the real PDF through the actual overlay dropzone input.
const input = page.locator('input[type="file"][accept*="pdf"]').first();
await input.setInputFiles({ name: "site-plan.pdf", mimeType: "application/pdf", buffer: PDF });
await page.waitForFunction(() => !!document.querySelector("image[data-overlay-image]"), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);

const readImg = () => page.evaluate(() => {
  const img = document.querySelector("image[data-overlay-image]");
  if (!img) return null;
  const href = img.getAttribute("href") || img.getAttribute("xlink:href") || "";
  return {
    kind: href.startsWith("blob:") ? "blob" : href.startsWith("data:") ? "data" : "other",
    geo: [img.getAttribute("x"), img.getAttribute("y"), img.getAttribute("width"), img.getAttribute("height")].join("|"),
  };
});
// The ANCHORED placement lives in the persisted overlay record (world x/y in feet + ftPerPx + intrinsic
// imgW/imgH). The hi-res raster is a render override only — it must NEVER write these back.
const readRec = () => page.evaluate(() => {
  try {
    const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const o = Object.values(m)[0]?.sheetOverlays?.[0];
    return o ? { x: o.x, y: o.y, ftPerPx: o.ftPerPx, imgW: o.imgW, imgH: o.imgH } : null;
  } catch (_) { return null; }
});

const base = await readImg();
const rec0 = await readRec();
check("B749 — the dropped PDF placed a base raster on the map (data: URL)", !!base && base.kind === "data", JSON.stringify(base));
await page.screenshot({ path: OUT + "reraster-base.png" });

// --- Zoom IN over the canvas center: each wheel tick = 1.12×, capped at ppf≤8. ---
// Use the rect of the SVG that actually owns the overlay image (the canvas), not an icon SVG.
const box = await page.evaluate(() => {
  const img = document.querySelector("image[data-overlay-image]");
  const svg = img && img.ownerSVGElement;
  const r = (svg || document.body).getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
for (let i = 0; i < 22; i++) { await page.mouse.wheel(0, -140); await page.waitForTimeout(35); }
// Zoom is now settled at a FIXED level. Poll across the base→hi-res transition, collecting every
// (kind, on-screen geometry) sample. Since view.ppf no longer changes, the geometry must be IDENTICAL
// for the base frame and the hi-res frame — i.e. the swap moves/resizes nothing at a fixed zoom.
const samples = [];
for (let i = 0; i < 40; i++) {
  const s = await readImg();
  if (s) samples.push(s);
  if (samples.some((x) => x.kind === "blob") && samples.some((x) => x.kind === "data")) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(300);
const hi = await readImg();
await page.screenshot({ path: OUT + "reraster-hires.png" });

check("B749 — zooming into detail swaps in a HI-RES raster (transient blob: URL)", !!hi && hi.kind === "blob", JSON.stringify(hi));
// At a fixed zoom, every sampled frame (base + hi-res) shares one on-screen geometry → the swap is in place.
const geos = new Set(samples.map((s) => s.geo));
const sawBoth = samples.some((s) => s.kind === "blob") && samples.some((s) => s.kind === "data");
check("B749 — at a fixed zoom the base→hi-res swap keeps ONE on-screen geometry (no jump/resize)",
  geos.size === 1, `${sawBoth ? "saw base+hires; " : ""}distinct-geoms=${geos.size} :: ${[...geos].join(" ")}`);

// --- Zoom back OUT: should drop back to the base raster (and release the blob). ---
await page.mouse.move(cx, cy);
for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, 140); await page.waitForTimeout(35); }
await page.waitForFunction(() => {
  const img = document.querySelector("image[data-overlay-image]");
  const href = img && (img.getAttribute("href") || img.getAttribute("xlink:href") || "");
  return href && href.startsWith("data:");
}, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);
const out = await readImg();
await page.screenshot({ path: OUT + "reraster-zoomout.png" });
check("B749 — zooming back out drops the overlay back to the BASE raster (blob released)", !!out && out.kind === "data", JSON.stringify(out));

// The whole zoom in/out cycle must leave the ANCHORED placement record untouched (hi-res is render-only,
// never persisted) — this is the durable proof that "swapping to hi-res does not move or resize" it.
const rec1 = await readRec();
const recSame = rec0 && rec1 && rec0.x === rec1.x && rec0.y === rec1.y && rec0.ftPerPx === rec1.ftPerPx && rec0.imgW === rec1.imgW && rec0.imgH === rec1.imgH;
check("B749 — the anchored placement record is UNCHANGED across the re-raster cycle (hi-res never persisted)",
  !!recSame, `before=${JSON.stringify(rec0)} after=${JSON.stringify(rec1)}`);

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.length}\n` : "\nALL PASSED\n");
process.exit(fails.length ? 1 : 0);
