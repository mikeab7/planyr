/* Verify the overlay lifecycle fixes (B276 + B277), logged-out, on the built app.
 *
 *  B277 (visibility toggle): hiding an overlay removes it from the map but KEEPS it in
 *    the Overlay panel; the hidden state PERSISTS across reload; showing it brings it back.
 *  B276 (delete persists): removing an overlay is durable — after a reload it stays gone,
 *    and the persisted record carries a `deletedIds` tombstone (the mechanism that, on a
 *    signed-in cloud/2-tab merge, stops the deleted overlay from being resurrected; the
 *    merge logic itself is unit-tested in test/storage.test.js — B276 cases).
 *
 * Image overlay (not PDF): the sandbox Chromium can't run pdf.js, so we seed an SVG/raster
 * overlay `src` directly — the same render/persist path a dropped sheet uses.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const imgW = 800, imgH = 600, ftPerPx = 1.25;
const drawSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='#c8a06e'/><text x='60' y='320' font-size='90' font-family='monospace' fill='#1a1a1a'>JACINTO PORT</text></svg>`;
const overlay = { id: "ovJ", name: "Jacinto Port.pdf", imgW, imgH, page: 1, pageCount: 1,
  ftPerPx, rotation: 0, opacity: 0.85, locked: false, x: -(imgW * ftPerPx) / 2, y: -(imgH * ftPerPx) / 2,
  detectedScale: null, sheet: null, src: "data:image/svg+xml;utf8," + encodeURIComponent(drawSvg) };
const site = { id: "J", groupId: "J", site: "Jacinto", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [overlay], parcelDrawings: [], updatedAt: Date.now() };
// Seed ONCE (guard on the key): addInitScript re-runs on every reload, so an unconditional
// seed would re-plant the original overlay on each reload and mask whatever the app persisted.
// Guarding lets the app's own saved state (hide / delete) survive the reload — the whole point.
const seed = `(()=>{try{if(!localStorage.getItem('planarfit:sites:v1'))localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ J: site })}));localStorage.setItem('planarfit:currentSite:v1','J');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
let fail = 0;
const check = (name, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${name}`); if (!ok) fail++; };
page.on("dialog", async (d) => { console.log("  [DIALOG — should never appear, inline editors only]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });

const hasOverlayImg = () => page.evaluate(() => !!document.querySelector('image[data-overlay-image="1"]'));
const overlayRowListed = () => page.evaluate(() => Array.from(document.querySelectorAll("button")).some((b) => b.textContent.trim() === "Jacinto Port.pdf"));
const storedSite = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("planarfit:sites:v1")).J; } catch (e) { return null; } });
const boot = async () => { await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(1500); try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(500); };
const openOverlayPanel = async () => { try { await page.locator('[title="Overlay"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(300); };

await boot();
check("overlay renders on the map at boot", await hasOverlayImg());
await page.screenshot({ path: OUT + "overlay-1-shown.png" });

// ---- B277: hide ----
await openOverlayPanel();
check("Overlay panel lists the overlay", await overlayRowListed());
await page.locator('[title="Hide overlay"]').first().click(); await page.waitForTimeout(900);
check("B277 hide — overlay removed from the map", !(await hasOverlayImg()));
check("B277 hide — overlay STILL listed in the panel (hidden, not deleted)", await overlayRowListed());
await page.screenshot({ path: OUT + "overlay-2-hidden.png" });

// reload → hidden persists
await boot();
check("B277 hide PERSISTS across reload — still off the map", !(await hasOverlayImg()));
await openOverlayPanel();
check("B277 hide PERSISTS — overlay still listed (recoverable)", await overlayRowListed());
{
  const s = await storedSite();
  check("B277 — record persists visible:false on the overlay", !!(s && s.sheetOverlays[0] && s.sheetOverlays[0].visible === false));
}

// ---- B277: show again ----
await page.locator('[title="Show overlay"]').first().click(); await page.waitForTimeout(700);
check("B277 show — overlay returns to the map", await hasOverlayImg());

// ---- B276: delete persists ----
await page.locator('[title="Remove"]').first().click(); await page.waitForTimeout(900);
check("B276 delete — overlay removed from the map", !(await hasOverlayImg()));
check("B276 delete — overlay no longer listed in the panel", !(await overlayRowListed()));
await page.screenshot({ path: OUT + "overlay-3-deleted.png" });

// reload → delete persists + tombstone written
await boot();
check("B276 delete PERSISTS across reload — overlay stays gone", !(await hasOverlayImg()));
{
  const s = await storedSite();
  check("B276 — record has NO overlay after reload", !!(s && s.sheetOverlays.length === 0));
  check("B276 — record carries the deletedIds tombstone (blocks cloud/2-tab resurrection)", !!(s && Array.isArray(s.deletedIds) && s.deletedIds.includes("ovJ")));
}

await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL OVERLAY DELETE/HIDE CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
