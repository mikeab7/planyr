/* B343 — a HIDDEN site-plan overlay must stay hidden across reload even in the exact state a
 * SIGNED-IN reload produces: the big raster has been stripped from the cloud row (src=null) and
 * only the transform + a Storage key survive. This is the closest the sandbox can get to the
 * signed-in path (it CORS-blocks Supabase auth/Storage, so the raster never re-downloads here —
 * which is fine: a hidden overlay must render NOTHING anyway, not even the "Loading…" placeholder).
 *
 * Complements ui-audit/verify-overlay-delete-hide.mjs (which uses an inline-src overlay). The
 * render guard `if (o.visible === false) return null` sits BEFORE the src-null placeholder, so a
 * hidden stripped overlay shows neither the image nor the placeholder — it can't "reappear".
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
// Stripped + HIDDEN: exactly the shape an overlay has on a signed-in reload after the raster was
// dropped from the DB row (B72). storageKey present, src null, visible:false.
const overlay = { id: "ovJ", name: "ARCH IFC.pdf", imgW, imgH, page: 1, pageCount: 1,
  ftPerPx, rotation: 89, opacity: 0.85, locked: false, x: -(imgW * ftPerPx) / 2, y: -(imgH * ftPerPx) / 2,
  detectedScale: null, sheet: null, src: null, strippedForCloud: true,
  storageKey: "uid/site-overlays/J/ovJ.pdf", visible: false };
const site = { id: "J", groupId: "J", site: "Jacinto", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [overlay], parcelDrawings: [], updatedAt: Date.now() };
// Seed ONCE (guard on the key) so the app's own persisted hide/show survives the reload.
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
// The src-null fallback render — a dashed placeholder with this exact text. Present only when the
// overlay is SHOWN but its raster hasn't loaded; ABSENT when the overlay is hidden.
const placeholderShown = () => page.evaluate(() =>
  Array.from(document.querySelectorAll("text")).some((t) => /Loading drawing from cloud/.test(t.textContent || "")));
const overlayRowListed = () => page.evaluate(() => Array.from(document.querySelectorAll("button")).some((b) => b.textContent.trim() === "ARCH IFC.pdf"));
const storedSite = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("planarfit:sites:v1")).J; } catch (e) { return null; } });
const boot = async () => { await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(1500); try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(500); };
const openOverlayPanel = async () => { try { await page.locator('[title="Overlay"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(300); };

await boot();
// Seeded hidden — at boot it must render NOTHING (no image, no placeholder) yet stay recoverable.
check("hidden+stripped overlay renders NOTHING on the map at boot (no image)", !(await hasOverlayImg()));
check("hidden+stripped overlay shows NO 'Loading…' placeholder either (hide wins over rehydrate)", !(await placeholderShown()));
await openOverlayPanel();
check("Overlay panel still LISTS the hidden overlay (recoverable, not deleted)", await overlayRowListed());
await page.screenshot({ path: OUT + "overlay-stripped-1-hidden.png" });

// Reload → the hide persists in the exact signed-in reload shape.
await boot();
check("hide PERSISTS across reload — still nothing on the map (no image)", !(await hasOverlayImg()));
check("hide PERSISTS across reload — still no placeholder", !(await placeholderShown()));
{
  const s = await storedSite();
  check("record still carries visible:false AND the storageKey (signed-in reload shape intact)",
    !!(s && s.sheetOverlays[0] && s.sheetOverlays[0].visible === false && s.sheetOverlays[0].storageKey));
}

// Show again → the placeholder appears (proving the visible guard was the only thing hiding it;
// the raster can't re-download logged-out, so we get the placeholder, not the image).
await openOverlayPanel();
await page.locator('[title="Show overlay"]').first().click(); await page.waitForTimeout(700);
check("Show — the overlay returns (dashed 'Loading…' placeholder appears; raster stays cloud-only here)", await placeholderShown());
await page.screenshot({ path: OUT + "overlay-stripped-2-shown.png" });
{
  const s = await storedSite();
  check("Show is persisted (visible:false cleared in the record)", !!(s && s.sheetOverlays[0] && s.sheetOverlays[0].visible !== false));
}

await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL HIDDEN-STRIPPED OVERLAY CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
