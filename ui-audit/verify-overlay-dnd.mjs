/* Self-verification for NEW-1 / B25432 — Site-plan overlay drag-and-drop affordance.
 * The bug: the Site-plan overlay panel said "Drop a PDF onto the map" but dropping gave
 * zero feedback and the panel itself wasn't a drop target, so it read as broken.
 *
 * This boots the planner logged-out (this-device mode), opens the Overlay panel, and
 * simulates file drags (a real OS file-drag can't be fired headless, so we dispatch
 * native dragenter/dragover/drop events carrying a DataTransfer with a real PNG File):
 *   1. dragover on the PANEL dropzone → the "Drop to add this site plan" highlight shows.
 *   2. dragover on the CANVAS → the "Drop site plan to place it on the map" hint mounts.
 *   3. drop on the panel → preventDefault fires (no browser navigation) AND a new overlay
 *      is added (a row with the file name appears).
 *   4. dragleave → the canvas hint clears (no flicker).
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-overlay-dnd";
const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -450 }, { x: 700, y: -450 }, { x: 700, y: 450 }, { x: -700, y: 450 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Overlay DnD", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);

// Open the Overlay panel via its rail button.
try { await page.locator('[title="Overlay"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("overlay-tab warn", e.message); }
await page.waitForTimeout(400);

// In-page helper: dispatch a native drag event carrying a DataTransfer (+ optional PNG file)
// at the target element, and report whether the handler called preventDefault. We assign
// .dataTransfer onto a plain Event (robust across Chromium versions) so React's synthetic
// event exposes e.dataTransfer / e.dataTransfer.files exactly as a real drag would.
const fire = (selectorKind, type, withFile) => page.evaluate(({ selectorKind, type, withFile }) => {
  const target = selectorKind === "canvas"
    ? document.querySelector('svg[aria-label="Site plan canvas"]')?.parentElement
    : [...document.querySelectorAll("button")].find((b) => /Add site plan/i.test(b.textContent || ""))?.parentElement;
  if (!target) return { ok: false, reason: "target-not-found:" + selectorKind };
  const dt = new DataTransfer();
  if (withFile) {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    dt.items.add(new File([arr], "plan.png", { type: "image/png" }));
  } else {
    // A file-less drag still must advertise the "Files" type so our guard engages.
    try { dt.items.add("x", "text/plain"); } catch (e) {}
  }
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  target.dispatchEvent(ev);
  return { ok: true, prevented: ev.defaultPrevented, types: Array.from(dt.types || []) };
}, { selectorKind, type, withFile });

const seesText = (re) => page.evaluate((src) => {
  const rx = new RegExp(src, "i");
  return [...document.querySelectorAll("body *")].some((el) => el.children.length === 0 && rx.test(el.textContent || ""));
}, re.source);

const overlayRowCount = () => page.evaluate(() =>
  [...document.querySelectorAll('button[title="plan.png"]')].length);

let fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!cond) fail++; };

// 1. Panel dropzone highlight on dragover.
const r1 = await fire("panel", "dragover", true);
await page.waitForTimeout(150);
const panelHi = await seesText(/Drop to add this site plan/);
await page.screenshot({ path: OUT + "overlay-dnd-panel-hover.png" });
check("panel dragover engages (preventDefault)", r1.ok && r1.prevented, JSON.stringify(r1));
check("panel shows 'Drop to add this site plan' highlight", panelHi);

// 2. Canvas "drop to place" hint on dragover.
const r2 = await fire("canvas", "dragover", true);
await page.waitForTimeout(150);
const canvasHint = await seesText(/Drop site plan to place it on the map/);
await page.screenshot({ path: OUT + "overlay-dnd-canvas-hint.png" });
check("canvas dragover engages (preventDefault)", r2.ok && r2.prevented, JSON.stringify(r2));
check("canvas shows 'Drop site plan to place it on the map' hint", canvasHint);

// 4 (tested before the drop): dragleave clears the canvas hint without flicker.
await fire("canvas", "dragleave", false);
await page.waitForTimeout(150);
const hintCleared = !(await seesText(/Drop site plan to place it on the map/));
check("canvas hint clears on dragleave", hintCleared);

// 3. Drop a real PNG on the panel → preventDefault + a new overlay row appears.
const before = await overlayRowCount();
const r3 = await fire("panel", "drop", true);
await page.waitForTimeout(2000); // addOverlayFile rasterizes the image asynchronously
const after = await overlayRowCount();
await page.screenshot({ path: OUT + "overlay-dnd-after-drop.png" });
check("panel drop calls preventDefault (no browser navigation)", r3.ok && r3.prevented, JSON.stringify(r3));
check("dropping a file ADDS an overlay (row appears)", after > before, `rows ${before}→${after}`);

console.log(fail === 0 ? "\n✓ ALL OVERLAY-DND CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
