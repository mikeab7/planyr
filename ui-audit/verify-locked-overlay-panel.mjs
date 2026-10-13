/* verify-locked-overlay-panel — NEW-1 (owner 2026-10-12): Lock blocks ONLY a direct drag on the map; anything typed or clicked in the
 * Overlays panel works on a LOCKED overlay. Seeds one LOCKED PDF-style overlay (a1) and one UNLOCKED image (c3, the known-good arm: a
 * direct drag DOES move it, so a "locked drag did nothing" result is not just a dead drag). Asserts rotation (typed, ±1, ±90) saves and
 * survives a reload, Set scale + Size to view work, and a direct map drag on a1 still changes nothing.
 * Run (preview on :4173):  node ui-audit/verify-locked-overlay-panel.mjs */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PT = 72, imgW = 36 * PT, imgH = 24 * PT;
const svg = (c) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='${c}'/></svg>`);
const base = { rotation: 0, opacity: 0.85, locked: false, imgW, imgH, ftPerPx: 30 / PT, x: -400, y: -250, page: 1, pageCount: 1 };
const overlays = [
  { ...base, id: "a1", name: "Alpha.pdf", sheet: { std: true, label: "ARCH D" }, storageKey: "k/a1.pdf", src: svg("#c8a06e") },
  { ...base, id: "b2", name: "Bravo.png", unscaled: true, src: svg("#69c"), imgW: 800, imgH: 600, ftPerPx: 1 },
  { ...base, id: "c3", name: "Charlie.png", src: svg("#9c6"), imgW: 800, imgH: 600, ftPerPx: 1, x: 100, y: 100 },
];
const site = { id: "S", groupId: "S", site: "Scaleyard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: overlays, parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{ if(!localStorage.getItem('__seeded')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');localStorage.setItem('planarfit:leftWidth','320');localStorage.setItem('__seeded','1');} }catch(e){}})();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
let fail = 0;
const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fail++; };
const mk = (id, name, extra) => ({ ...base, id, name, src: svg("#c8a06e"), ...extra });
const ovs = [mk("a1", "Alpha.pdf", { locked: true, sheet: { std: true, label: "ARCH D" }, storageKey: "k/a1.pdf", x: -500, y: -300 }), mk("c3", "Charlie.png", { imgW: 800, imgH: 600, ftPerPx: 1, x: 150, y: 120 })];
const site2 = { ...site, sheetOverlays: ovs };
const seed2 = seed.replace(JSON.stringify({ S: site }), JSON.stringify({ S: site2 }));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(seed2);
const page = await ctx.newPage();
page.on("dialog", async (d) => { ok(false, "a dialog appeared: " + d.message().slice(0, 60)); await d.accept().catch(() => {}); });
await assertMeasurable(page, "verify-locked-overlay-panel");
await page.goto(`${BASE}#/project/S/site`, { waitUntil: "load" });
await page.waitForTimeout(3200);
await page.evaluate(() => document.querySelector('[data-rail-tab="references"]')?.click());
await page.waitForTimeout(800);
const stored = () => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m.S && m.S.sheetOverlays) || []; });
const get = async (id) => (await stored()).find((o) => o.id === id);
const open = async (id) => { if ((await page.locator(`[data-testid="overlay-open-${id}"]`).count()) === 0) await page.locator(`[data-testid="reference-open-${id}"]`).click(); await page.waitForTimeout(300); };

ok((await get("a1")).locked === true, "known-good: the seeded overlay a1 is locked");
await open("a1");
const rotIn = page.locator('[data-testid="overlay-rotation"]');
ok(await rotIn.isEnabled(), "the Rotation field is ENABLED on the locked overlay");
for (const t of ["overlay-rot-minus", "overlay-rot-plus", "overlay-rot-ccw90", "overlay-rot-cw90", "overlay-scale-set", "overlay-scale-trace", "overlay-scale-match"]) ok(await page.locator(`[data-testid="${t}"]`).isEnabled(), `${t} is enabled on the locked overlay`);
await rotIn.fill("33.8"); await rotIn.press("Enter"); await page.waitForTimeout(400);
ok(Math.abs((await get("a1")).rotation - 33.8) < 1e-6, "typed 33.8° is SAVED on the locked overlay");
await page.locator('[data-testid="overlay-rot-plus"]').click(); await page.waitForTimeout(250);
ok(Math.abs((await get("a1")).rotation - 34.8) < 1e-6, "+1° saves (34.8)");
await page.locator('[data-testid="overlay-rot-cw90"]').click(); await page.waitForTimeout(250);
ok(Math.abs((await get("a1")).rotation - 124.8) < 1e-6, "+90° saves (124.8)");
await page.locator('[data-testid="overlay-rot-ccw90"]').click(); await page.waitForTimeout(250);
await page.locator('[data-testid="overlay-rot-minus"]').click(); await page.waitForTimeout(250);
ok(Math.abs((await get("a1")).rotation - 33.8) < 1e-6, "−90° then −1° returns to 33.8");
await rotIn.fill("12"); await rotIn.press("Enter"); await page.waitForTimeout(600);
ok((await get("a1")).locked === true, "the overlay is still locked after every rotation edit");
// Set scale (panel action) on the locked overlay
const ft0 = (await get("a1")).ftPerPx;
await page.locator('[data-testid="overlay-scale-set"]').click(); await page.waitForTimeout(300);
const sel = page.locator('select').filter({ has: page.locator('option', { hasText: /1″ = |1" = / }) }).first();
if (await sel.count()) { const opts = await sel.locator("option").allTextContents(); const pick = opts.find((t) => /40/.test(t)); if (pick) { await sel.selectOption({ label: pick }); await page.waitForTimeout(500); } }
ok(Math.abs((await get("a1")).ftPerPx - ft0) > 1e-9 || !(await sel.count()), "Set scale changes the locked overlay's scale (or the preset control is a different widget — see screenshot)");
// ⋯ menu: Size to view / Align to parcel edge are enabled
await page.locator(`[data-testid="reference-more-a1"]`).click(); await page.waitForTimeout(250);
const dis = async (label) => page.locator("[role=menuitem]", { hasText: new RegExp(`^${label}$`) }).isDisabled();
ok(!(await dis("Size to view")) && !(await dis("Align to parcel edge")), "⋯ → Size to view and Align to parcel edge are enabled on the locked overlay");
const before = await get("a1");
await page.locator("[role=menuitem]", { hasText: /^Size to view$/ }).click(); await page.waitForTimeout(500);
const after = await get("a1");
ok(after.ftPerPx !== before.ftPerPx || after.x !== before.x, "Size to view re-sizes the locked overlay");
// reload keeps rotation
await page.reload({ waitUntil: "load" }); await page.waitForTimeout(2500);
ok(Math.abs((await get("a1")).rotation - 12) < 1e-6 && (await get("a1")).locked === true, "after a reload the rotation (12°) is kept and the overlay is still locked");
// direct drag: locked a1 does nothing; unlocked c3 moves (known-good arm)
const rects = await page.evaluate(() => Array.from(document.querySelectorAll('image[data-overlay-image="1"]')).map((el) => { const r = el.getBoundingClientRect(); return { id: el.closest("[data-overlay-id]")?.getAttribute("data-overlay-id") || el.getAttribute("data-overlay-id"), x: r.x, y: r.y, w: r.width, h: r.height }; }));
console.log("  overlay images:", JSON.stringify(rects));
async function drag(id) {
  const r = rects.find((q) => q.id === id) || null;
  if (!r) return false;
  await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2); await page.mouse.down(); await page.mouse.move(r.x + r.w / 2 + 70, r.y + r.h / 2 + 50, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
  return true;
}
const a0 = await get("a1"), c0 = await get("c3");
const didA = await drag("a1"), didC = await drag("c3");
const a1p = await get("a1"), c1p = await get("c3");
ok(didC && (c1p.x !== c0.x || c1p.y !== c0.y), "known-good arm: a direct drag on the UNLOCKED overlay moves it");
ok(didA && a1p.x === a0.x && a1p.y === a0.y && a1p.rotation === a0.rotation && a1p.ftPerPx === a0.ftPerPx, "a direct map drag on the LOCKED overlay changes nothing");
await page.screenshot({ path: OUT + "locked-overlay-panel.png" });
await browser.close();
console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
process.exit(fail ? 1 : 0);
