/* Verify the overlay-panel control refinements (B564–B568), logged-out, on the built app.
 *
 *  B564 (NEW-1): the hide / lock / remove header buttons render at IDENTICAL sizes (one shared
 *    square icon-button style + inline SVG icons — no more emoji-vs-SVG metric mismatch).
 *  B565 (NEW-2): a numeric percent input sits beside the opacity slider, two-way bound + clamped 10–100%.
 *  B566 (NEW-3): the scale control is a Bluebeam-style preset dropdown; picking "Custom…" reveals
 *    editable [page][unit] = [real][unit] fields; 0.5" = 60' resolves to 1"=120' (impossible before).
 *  B567 (NEW-4): the Width row, the Reset-rotation button, and the obsolete drop-hint text are gone.
 *  B568 (NEW-5): the filename has its OWN full-width row and WRAPS (no mid-name ellipsis truncation).
 *
 * Image overlay carrying a `sheet` (so the scale block renders): the sandbox Chromium can't run pdf.js,
 * so we seed an SVG `src` directly with the page's intrinsic size in POINTS (36"×24" ARCH D) and a
 * matching scale — the same render/persist path a dropped sheet uses.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const PT = 72;
const imgW = 36 * PT, imgH = 24 * PT;          // ARCH D landscape, in points
const ftPerPx = 30 / PT;                        // 1" = 30' → matches the eng-30 preset for the round-trip check
const LONGNAME = "VERY-LONG-SITE-PLAN-FILENAME-grading-and-drainage-civil-set-sheet-C-5.pdf";
const drawSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='#c8a06e'/><text x='80' y='400' font-size='120' font-family='monospace' fill='#1a1a1a'>SITE PLAN</text></svg>`;
const overlay = { id: "ovS", name: LONGNAME, imgW, imgH, page: 1, pageCount: 1,
  ftPerPx, rotation: 0, opacity: 0.85, locked: false, x: -(imgW * ftPerPx) / 2, y: -(imgH * ftPerPx) / 2,
  detectedScale: 30, sheet: { std: true, label: "ARCH D (24×36)" }, src: "data:image/svg+xml;utf8," + encodeURIComponent(drawSvg) };
const site = { id: "S", groupId: "S", site: "Scaleyard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [overlay], parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
page.on("dialog", async (d) => { console.log("  [DIALOG — should never appear, inline editors only]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });

const overlayImgOpacity = () => page.evaluate(() => { const el = document.querySelector('image[data-overlay-image="1"]'); return el ? +el.getAttribute("opacity") : null; });
const panelText = () => page.evaluate(() => (document.body.innerText || ""));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Overlay"]').first().click({ timeout: 4000 }); } catch (e) {}
await page.waitForTimeout(400);
// expand the row
await page.locator("button", { hasText: "VERY-LONG-SITE-PLAN" }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "overlay-panel-expanded.png" });

// ---- B564: the three header icon buttons render at identical sizes ----
const boxes = await page.evaluate(() => {
  const pick = (t) => { const b = document.querySelector(`[title="${t}"]`); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  return { hide: pick("Hide overlay"), lock: pick("Lock"), remove: pick("Remove") };
});
const allBoxes = [boxes.hide, boxes.lock, boxes.remove];
const haveAll = allBoxes.every(Boolean);
check("B564 — all three header buttons present (hide/lock/remove)", haveAll, JSON.stringify(boxes));
if (haveAll) {
  const square = allBoxes.every((b) => Math.abs(b.w - b.h) <= 1);
  const sameW = allBoxes.every((b) => Math.abs(b.w - boxes.hide.w) <= 1);
  const sameH = allBoxes.every((b) => Math.abs(b.h - boxes.hide.h) <= 1);
  check("B564 — each header button is square (w≈h)", square);
  check("B564 — all three header buttons are the SAME size", sameW && sameH);
}

// ---- B568: filename on its own full-width row, wrapping (taller than a single line) ----
const fileRow = await page.evaluate((nm) => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes(nm.slice(0, 24)));
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  const hideR = document.querySelector('[title="Hide overlay"]').getBoundingClientRect();
  const card = btn.closest("div");
  const cardR = card.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), hideTop: Math.round(hideR.top), cardW: Math.round(cardR.width) };
}, LONGNAME);
check("B568 — filename row found", !!fileRow, JSON.stringify(fileRow));
if (fileRow) {
  check("B568 — filename takes ~the full panel width", fileRow.w >= fileRow.cardW - 24, `name=${fileRow.w}px card=${fileRow.cardW}px`);
  check("B568 — filename sits ABOVE the action buttons (own row)", fileRow.bottom <= fileRow.hideTop + 2, `nameBottom=${fileRow.bottom} hideTop=${fileRow.hideTop}`);
  check("B568 — long name WRAPS to multiple lines (not single-line truncation)", fileRow.h >= 34, `height=${fileRow.h}px`);
}

// ---- B565: opacity numeric input, two-way bound + clamped ----
const pct = page.locator('[data-testid="overlay-opacity-pct"]');
check("B565 — opacity percent input present", await pct.count() === 1);
check("B565 — shows 85% for stored opacity 0.85", (await pct.inputValue()) === "85", `value=${await pct.inputValue()}`);
await pct.fill("40"); await page.waitForTimeout(250);
check("B565 — typing 40 sets the overlay to ~0.40 opacity (live)", Math.abs((await overlayImgOpacity()) - 0.4) < 0.02, `opacity=${await overlayImgOpacity()}`);
await pct.fill("5"); await pct.blur(); await page.waitForTimeout(250);
check("B565 — below-range 5 clamps to 10% (opacity 0.1)", Math.abs((await overlayImgOpacity()) - 0.1) < 0.02, `opacity=${await overlayImgOpacity()}`);
check("B565 — field re-displays the clamped 10 after blur", (await pct.inputValue()) === "10", `value=${await pct.inputValue()}`);
// restore a sane opacity for the screenshot
await pct.fill("85"); await pct.blur(); await page.waitForTimeout(150);

// ---- B566: scale preset dropdown + Custom paired fields ----
const presetSel = page.locator('[data-testid="overlay-scale-preset"]');
check("B566 — scale preset dropdown present", await presetSel.count() === 1);
check("B566 — round-trips to eng-30 (1\"=30') for the seeded size", (await presetSel.inputValue()) === "eng-30", `value=${await presetSel.inputValue()}`);
// pick an architectural preset → 1/4" = 1' → 4 ft/in
await presetSel.selectOption("arch-1-4"); await page.waitForTimeout(250);
check("B566 — selecting 1/4\"=1'-0\" applies 1\"=4'", (await panelText()).includes("1″=4′"), "(arch preset)");
// now Custom… → reveal the paired fields, enter 0.5" = 60' → 1"=120'
await presetSel.selectOption("custom"); await page.waitForTimeout(250);
const custom = page.locator('[data-testid="overlay-scale-custom"]');
check("B566 — picking Custom… reveals the paired page=real fields", await custom.count() === 1);
const pageInput = custom.locator("input").nth(0);
const realInput = custom.locator("input").nth(1);
await pageInput.fill("0.5"); await page.waitForTimeout(120);
await realInput.fill("60"); await realInput.press("Enter"); await page.waitForTimeout(300);
const afterText = await panelText();
check("B566 — 0.5\" = 60' resolves to 1\"=120' (the impossible-before scale)", afterText.includes("1″=120′"), afterText.includes("1″=120′") ? "" : "no 1″=120′ in panel");
// width feet = imgW(2592) * ftPerPx(120/72=1.6667) = 4320
check("B566 — sheet now reads ~4320' wide at that scale", afterText.includes("4320′ wide"), afterText.includes("4320′ wide") ? "" : "no 4320′ wide");
// a fraction works too: 1/2 → same 120
await pageInput.fill("1/2"); await page.waitForTimeout(120);
await realInput.fill("60"); await realInput.press("Enter"); await page.waitForTimeout(300);
check("B566 — fraction '1/2' in the page field also resolves to 1\"=120'", (await panelText()).includes("1″=120′"));
await page.screenshot({ path: OUT + "overlay-panel-scale-custom.png" });

// ---- B567: removed cruft is gone ----
// Scope the Width/Reset checks to the overlay CARD's own text (avoid false matches elsewhere on the page).
const cardText = await page.evaluate((nm) => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes(nm.slice(0, 24)));
  const card = btn && btn.parentElement; // the per-overlay card div
  return card ? (card.innerText || "") : "";
}, LONGNAME);
const body = await panelText();
check("B567 — the Width row is gone for a SHEET/PDF overlay (scale picker owns sizing)", !cardText.includes("Width"), "(no Width control)");
check("B567 — the 'Reset rotation' button is gone", !cardText.includes("Reset rotation"));
check("B567 — the 'Drag it to move' drop-hint tail is gone", !body.includes("Drag it to move"));
check("B567 — the 'Sizing to the drawing scale comes next' parenthetical is gone", !body.includes("Sizing to the drawing scale comes next"));
check("B567 — the 'Scale to the drawing — sizes the sheet' line is gone", !cardText.includes("Scale to the drawing"));
check("B567 — core drop hint kept", body.includes("White paper is knocked out"));

// ---- helper: boot a fresh context with a seeded site and expand its overlay row ----
const cardTextFor = (p, nm) => p.evaluate((n) => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").includes(n));
  const card = b && b.parentElement;
  return card ? (card.innerText || "") : "";
}, nm);
async function bootScenario(seedSite, expandMatch) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const key = Object.keys(seedSite)[0];
  await c.addInitScript(`(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(seedSite)}));localStorage.setItem('planarfit:currentSite:v1','${key}');}catch(e){}})();`);
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: "load" });
  await p.waitForTimeout(1300);
  try { await p.locator('[title="Overlay"]').first().click({ timeout: 4000 }); } catch (e) {}
  await p.waitForTimeout(300);
  await p.locator("button", { hasText: expandMatch }).first().click();
  await p.waitForTimeout(300);
  return { c, p };
}

// ---- B567 fix (review finding): an IMAGE overlay (sheet:null) KEEPS its numeric Width control ----
// The scale picker is PDF-only (gated on o.sheet); removing Width for images would leave them with no
// numeric size entry. So images must retain Width + the ±10% nudge.
{
  const imgOverlay = { ...overlay, id: "ovIMG", name: "site-aerial-photo.png", detectedScale: null, sheet: null };
  const imgSite = { I: { ...site, id: "I", groupId: "I", name: "ImgPlan", sheetOverlays: [imgOverlay] } };
  const { c, p } = await bootScenario(imgSite, "site-aerial-photo.png");
  const ct = await cardTextFor(p, "site-aerial-photo.png");
  check("B567 fix — image overlay (no sheet) KEEPS the numeric Width control", ct.includes("Width"));
  check("B567 fix — image overlay shows NO scale preset picker (no physical inch)", await p.locator('[data-testid="overlay-scale-preset"]').count() === 0);
  check("B567 fix — image overlay still has the opacity percent field", await p.locator('[data-testid="overlay-opacity-pct"]').count() === 1);
  await p.screenshot({ path: OUT + "overlay-panel-image.png" });
  await c.close();
}

// ---- B566 fix (review finding): an idle focus→blur on the custom REAL field must NOT quantize ----
// Seed a sheet overlay at a non-round metric scale (1"=1m → 3.2808 ft/in); the custom row auto-shows with
// the real field displaying the rounded "3.3". Focusing then blurring it WITHOUT editing must leave the
// scale exactly where it was (per-field dirty guard) — pre-fix this re-committed "3.3" and drifted ~0.6%.
{
  const M = 3.280839895 / 72; // ftPerPx for 1"=1m ; width = imgW(2592)*M = 118.1' → "118′ wide"
  const metricOverlay = { ...overlay, id: "ovM", name: "metric-scale-sheet.pdf", ftPerPx: M };
  const metricSite = { M: { ...site, id: "M", groupId: "M", name: "MetricPlan", sheetOverlays: [metricOverlay] } };
  const { c, p } = await bootScenario(metricSite, "metric-scale-sheet.pdf");
  const widthOf = async () => { const m = (await p.evaluate(() => document.body.innerText)).match(/(\d+)′ wide/); return m ? m[1] : null; };
  const before = await widthOf();
  check("B566 fix — non-round metric scale renders ~118' wide before the idle blur", before === "118", `before=${before}`);
  const realC = p.locator('[data-testid="overlay-scale-custom"] input').nth(1);
  await realC.focus(); await p.waitForTimeout(100); await realC.blur(); await p.waitForTimeout(250);
  const after = await widthOf();
  check("B566 fix — idle focus+blur on the custom real field does NOT quantize the scale", before === after, `before=${before} after=${after}`);
  await c.close();
}

await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL OVERLAY-PANEL CONTROL CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
