/* Headless smoke for the DWG drop → convert-service gate (B748 / V261 step 1) — logged-out,
 * on the BUILT app with NO `VITE_CONVERT_URL` set (the local/preview build).
 *
 * Drops a real .dwg through the actual overlay dropzone file input and confirms the LOUD-FAILURE
 * "not set up yet" state: with the convert endpoint unconfigured the client short-circuits with the
 * `code:"unset"` message BEFORE any network call, so this needs no live service.
 *
 * Checks (V261 step 1 — "TODAY, no deploy — no sign-in"):
 *  1. The visible note "DWG conversion isn't set up yet — export a DXF from AutoCAD/Civil 3D instead."
 *     appears (never a spinner into nothing).
 *  2. NO overlay raster (<image data-overlay-image>) is placed — the DWG did NOT silently import as blank.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const site = { id: "S", groupId: "S", site: "DWGyard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');}catch(e){}})();`;

// The bytes never reach the (unconfigured) converter, so any .dwg-named blob exercises the gate.
// Use a plausible DWG magic header ("AC1027" = AutoCAD 2013) so the extension sniff is unambiguous.
const dwgBytes = Buffer.concat([Buffer.from("AC1027"), Buffer.alloc(512, 0)]);

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const fails = [];
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails.push(name); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

// Open the References/Overlay panel so the dropzone file input mounts.
for (const sel of ['[title="Overlay"]', '[title="References"]', 'button:has-text("References")']) {
  try { await page.locator(sel).first().click({ timeout: 2500 }); break; } catch (_) {}
}
await page.waitForTimeout(600);

// Drop the .dwg through the real overlay file input (accept="...,.dxf,.dwg").
const input = page.locator('input[type="file"][accept*="dwg"]').first();
await input.setInputFiles({ name: "site-plan.dwg", mimeType: "image/vnd.dwg", buffer: dwgBytes });
// Give addOverlayFile → convertDwgToDxf(unset) → flashWarn a moment to render.
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "dwg-unset.png" });

const res = await page.evaluate(() => {
  const txt = document.body.innerText || "";
  return {
    note: txt.includes("DWG conversion isn't set up yet") && txt.includes("export a DXF from AutoCAD/Civil 3D instead"),
    hasImg: !!document.querySelector("image[data-overlay-image]"),
    // guard against a stuck busy-spinner: the overlay panel should not be left "busy"
    busy: /Adding…|Processing…|Loading…/.test(txt),
  };
});

check("B748 — dropping a .dwg with VITE_CONVERT_URL unset shows the 'not set up yet' note", res.note);
check("B748 — no overlay raster is silently placed for the DWG (never a blank import)", !res.hasImg);
check("B748 — no stuck spinner (never a spinner into nothing / LOUD-FAILURE)", !res.busy);

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.length}\n` : "\nALL PASSED\n");
process.exit(fails.length ? 1 : 0);
