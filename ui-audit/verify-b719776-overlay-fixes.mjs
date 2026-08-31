/* B719776–B719779 — logged-out headless verification of three of the four fixes (per
 * ATTEMPT-BEFORE-YOU-PARK: no auth / no external GIS needed for any of these three).
 *   (c) B719778 — Remove aerial clears settings.aerialHidden; a fresh aerial then shows.
 *   (d) B719779 — Crop: trim fields produce a clipPath sized/positioned per the formula; Reset clears it.
 *   (b) B719777 — a reference with no way to recover its bytes offers a direct on-canvas Remove.
 * (a) B719776 (the rehydrate cache backfill + rasterize-failure telemetry) needs a real signed-in
 * Storage round-trip and stays a live-verify item (Blocker: auth) — see VERIFICATION.md.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const parcel = { id: "pc1", locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] };
const drawSvg = (w, h, color) => `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='${w}' height='${h}' fill='${color}'/></svg>`;

async function openSite(site, page, ctx, { e2e = false } = {}) {
  const seed = `(()=>{try{${e2e ? "window.__PLANYR_E2E = true;" : ""}localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ [site.id]: site })}));localStorage.setItem('planarfit:currentSite:v1','${site.id}');}catch(e){}})();`;
  await ctx.addInitScript(seed);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* ---------------------------------------------------------------------------------------------
 * (c) B719778 — Remove-aerial clears the stale flag; a FRESH aerial then renders visible.
 * ------------------------------------------------------------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { console.log("  [DIALOG]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
  const imgW = 400, imgH = 300, ftPerPx = 1;
  const underlay = { src: "data:image/svg+xml;utf8," + encodeURIComponent(drawSvg(imgW, imgH, "#4a90d9")),
    imgW, imgH, x: -imgW / 2, y: -imgH / 2, ftPerPx, opacity: 1, locked: false };
  const site = { id: "AER1", groupId: "AER1", site: "AerialTest", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
    parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: { aerialHidden: true }, // stale flag, pre-set
    underlay, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
  await openSite(site, page, ctx);
  await assertMeasurable(page, "verify-b719776-overlay-fixes");

  await page.locator('[title="Overlays"]').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: new URL("./screens/", import.meta.url).pathname + "aerial-hidden-stale.png" });

  const readAerialHidden = () => page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const s = raw.AER1;
    return s && s.settings ? s.settings.aerialHidden ?? null : "NO-SETTINGS";
  });
  check("[precondition] plan seeded with the STALE aerialHidden:true flag", (await readAerialHidden()) === true);

  const removeBtn = page.locator('[title="Remove"]').first();
  const hasRemove = await removeBtn.count();
  check("Aerial row's Remove (✕) button is present", hasRemove > 0);
  if (hasRemove) {
    await removeBtn.click();
    await page.waitForTimeout(400);
    const after = await readAerialHidden();
    check("Remove CLEARS aerialHidden (no residue key), not sets it", after === null || after === undefined, `settings.aerialHidden=${JSON.stringify(after)}`);
  }

  // PREDICTED SYMPTOM, explicitly tested: drop a FRESH aerial next and confirm it's visible.
  await page.evaluate(async () => {
    const dataUrl = "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='150'><rect width='200' height='150' fill='#d94a4a'/></svg>");
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], "fresh-aerial.svg", { type: "image/svg+xml" });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('input[type="file"][accept="image/*"]');
    if (input) { Object.defineProperty(input, "files", { value: dt.files }); input.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await page.waitForTimeout(800);
  const freshVisible = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const s = raw.AER1;
    return { hasUnderlay: !!(s && s.underlay), aerialHidden: s && s.settings ? (s.settings.aerialHidden ?? null) : "NO-SETTINGS" };
  });
  check("a FRESH aerial dropped after Remove is NOT born hidden (the predicted symptom)", freshVisible.hasUnderlay && (freshVisible.aerialHidden === null || freshVisible.aerialHidden === undefined), JSON.stringify(freshVisible));
  await ctx.close();
}

/* ---------------------------------------------------------------------------------------------
 * (d) B719779 — Crop trim fields produce a correctly-sized/positioned <clipPath>; Reset clears it.
 * ------------------------------------------------------------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { console.log("  [DIALOG]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
  const imgW = 1000, imgH = 800, ftPerPx = 1; // 1000x800 ft "sheet"
  const overlay = { id: "ovCrop", name: "crop-test.png", imgW, imgH, page: 1, pageCount: 1,
    ftPerPx, rotation: 0, opacity: 1, locked: false, x: -imgW / 2, y: -imgH / 2,
    src: "data:image/svg+xml;utf8," + encodeURIComponent(drawSvg(imgW, imgH, "#e8a83c")) };
  const site = { id: "CROP1", groupId: "CROP1", site: "CropTest", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
    parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {},
    underlay: null, sheetOverlays: [overlay], parcelDrawings: [], updatedAt: Date.now() };
  await openSite(site, page, ctx, { e2e: true }); // PDF-PARITY check below needs window.__plannerExportSvg
  await assertMeasurable(page, "verify-b719776-overlay-fixes");

  await page.locator('[title="Overlays"]').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: "crop-test.png" }).first().click();
  await page.waitForTimeout(400);

  const clipBefore = await page.evaluate(() => !!document.querySelector('clipPath[id="ov-crop-ovCrop"]'));
  check("uncropped overlay renders with NO clipPath (byte-identical to before this feature)", !clipBefore);

  // Fill Left/Top/Right/Bottom trim fields (feet). Left=100, Top=50, Right=200, Bottom=80.
  const trims = { "Left edge": "100", "Top edge": "50", "Right edge": "200", "Bottom edge": "80" };
  for (const [title, val] of Object.entries(trims)) {
    const input = page.locator(`input[aria-label="Crop ${title}"]`);
    await input.fill(val);
    await input.dispatchEvent("change");
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: new URL("./screens/", import.meta.url).pathname + "crop-applied.png" });

  const model = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const o = raw.CROP1.sheetOverlays.find((x) => x.id === "ovCrop");
    return o ? o.crop : null;
  });
  // trim{left:100,top:50,right:200,bottom:80} on a 1000x800 sheet at ftPerPx=1 -> crop{x:100,y:50,w:700,h:670}
  check("crop persisted with the CORRECT rect from the four trim fields", model && model.x === 100 && model.y === 50 && model.w === 700 && model.h === 670, JSON.stringify(model));

  const clip = await page.evaluate(() => {
    const cp = document.querySelector('clipPath[id="ov-crop-ovCrop"] rect');
    const img = document.querySelector('image[data-overlay-id="ovCrop"]');
    return cp && img ? {
      rect: { x: +cp.getAttribute("x"), y: +cp.getAttribute("y"), w: +cp.getAttribute("width"), h: +cp.getAttribute("height") },
      imgClipAttr: img.getAttribute("clip-path"),
      imgBox: { x: +img.getAttribute("x"), y: +img.getAttribute("y"), w: +img.getAttribute("width"), h: +img.getAttribute("height") },
    } : null;
  });
  check("<clipPath> rendered and referenced by the <image>'s clip-path attribute", !!(clip && clip.imgClipAttr === "url(#ov-crop-ovCrop)"), JSON.stringify(clip));
  if (clip) {
    // The <image> box (full image) is unchanged; the clip rect sits STRICTLY inside it — the visible
    // crop is smaller than the full image, at the crop's own offset.
    check("clip rect x/y is INSIDE the image's own box (crop offset applied)", clip.rect.x > clip.imgBox.x && clip.rect.y > clip.imgBox.y);
    check("clip rect is SMALLER than the full image box (real trim, not a no-op)", clip.rect.w < clip.imgBox.w && clip.rect.h < clip.imgBox.h);
  }

  // PDF-PARITY (mandatory LIVE-VERIFY class, ATTEMPT-BEFORE-YOU-PARK-doable logged-out): the exported
  // sheet must crop identically to the screen. `buildExportSvg` clones the live SVG wholesale, so the
  // clipPath + its reference on the <image> should survive into the export with no separate plumbing.
  const exportHtml = await page.evaluate(() => window.__plannerExportSvg ? window.__plannerExportSvg() : null);
  const hasExportHook = typeof exportHtml === "string";
  check("window.__plannerExportSvg hook is reachable (E2E-gated sheet builder)", hasExportHook);
  if (hasExportHook) {
    check("exported sheet carries the SAME clipPath id", exportHtml.includes('id="ov-crop-ovCrop"'), `len=${exportHtml.length}`);
    check("exported <image> references it via clip-path", exportHtml.includes('clip-path="url(#ov-crop-ovCrop)"') || exportHtml.includes("clip-path=\"url(#ov-crop-ovCrop)\""));
  }

  // Reset crop clears it entirely.
  await page.locator("button", { hasText: "Reset crop" }).first().click();
  await page.waitForTimeout(300);
  const afterReset = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const o = raw.CROP1.sheetOverlays.find((x) => x.id === "ovCrop");
    return { crop: o ? o.crop : "MISSING", clipPathInDom: !!document.querySelector('clipPath[id="ov-crop-ovCrop"]') };
  });
  check("Reset crop clears the stored crop (no residue key) AND removes the clipPath from the DOM", (afterReset.crop === null || afterReset.crop === undefined) && !afterReset.clipPathInDom, JSON.stringify(afterReset));
  await ctx.close();
}

/* ---------------------------------------------------------------------------------------------
 * (b) B719777 — a reference with NO idbKey/storageKey/src (unrecoverable on this device, no
 * network needed to prove it) offers a direct on-canvas "remove this reference" and it works.
 * ------------------------------------------------------------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { console.log("  [DIALOG]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
  const overlay = { id: "ovBroken", name: "Untitled picture.png", imgW: 1244, imgH: 1008, page: 1, pageCount: 1,
    ftPerPx: 1, rotation: 0, opacity: 0.85, locked: false, x: -600, y: -500, src: null, idbKey: null, storageKey: null };
  const site = { id: "BROKEN1", groupId: "BROKEN1", site: "BrokenRef", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
    parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {},
    underlay: null, sheetOverlays: [overlay], parcelDrawings: [], updatedAt: Date.now() };
  await openSite(site, page, ctx);
  await assertMeasurable(page, "verify-b719776-overlay-fixes");
  await page.waitForTimeout(800);
  await page.screenshot({ path: new URL("./screens/", import.meta.url).pathname + "broken-reference-placeholder.png" });

  const bodyText = await page.evaluate(() => document.body.innerText || "");
  check('canvas shows the honest placeholder ("image not on this device")', bodyText.includes("Untitled picture.png") && bodyText.includes("not on this device"));
  check('canvas placeholder ALSO offers "remove this overlay" directly (not just the Overlays panel)', bodyText.includes("remove this overlay"));

  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}").BROKEN1.sheetOverlays.length);
  await page.locator("text=remove this reference").first().click({ timeout: 4000 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}").BROKEN1.sheetOverlays.length);
  check("clicking it removes the reference (persisted, not just a visual no-op)", before === 1 && after === 0, `before=${before} after=${after}`);
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? "\n✓ ALL CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
