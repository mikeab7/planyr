/* NEW-1 verification — the canvas can never be left stuck mid-pan (frozen grab/hand
 * cursor that swallows clicks) when a gesture is interrupted instead of ending with a
 * normal pointer-up.
 *
 * Drives a real (headless) pointer: start a pan with the Pan tool (cursor → "grabbing"),
 * then interrupt it two ways the app used to ignore —
 *   (1) window "blur"        (alt-tab / OS dialog / a debugger attaching), and
 *   (2) a synthetic pointercancel on the canvas (the event the browser fires in place
 *       of pointerup when the gesture is taken over).
 * After each, the canvas cursor must fall back to "grab" (idle), proving panning/drag
 * state was released. A stuck "grabbing" would be the lockup.
 *
 * Run:  npm run build && npx vite preview --port 4173   (in one shell)
 *       node ui-audit/verify-pointer-recover.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const DEMO_ID = "uiaudit-demo";
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Pointer Recover Demo", name: "Plan 1",
  origin: null, county: null, parcels: [], els: [], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const cursorOf = (page) => page.$eval("svg[aria-label='Site plan canvas']", (el) => getComputedStyle(el).cursor);

let failed = false;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failed = true; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

const svg = await page.$("svg[aria-label='Site plan canvas']");
check("planner canvas rendered", !!svg);
if (!svg) { console.log(errors); await browser.close(); process.exit(1); }

const box = await svg.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

// Switch to the Pan tool so a drag anywhere is a pan (independent of content under the cursor).
await page.keyboard.press("h");
await page.waitForTimeout(150);
check("pan tool idle cursor is grab", (await cursorOf(page)) === "grab", await cursorOf(page));

// ---- (1) interrupt by window blur -------------------------------------------------
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy + 40, { steps: 4 });
await page.waitForTimeout(120);
check("cursor is grabbing while panning", (await cursorOf(page)) === "grabbing", await cursorOf(page));
await page.evaluate(() => window.dispatchEvent(new Event("blur")));
await page.waitForTimeout(150);
check("blur recovers cursor to grab", (await cursorOf(page)) === "grab", await cursorOf(page));
await page.mouse.up();
await page.waitForTimeout(80);

// ---- (2) interrupt by pointercancel ----------------------------------------------
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 50, cy - 30, { steps: 4 });
await page.waitForTimeout(120);
check("cursor is grabbing while panning (2)", (await cursorOf(page)) === "grabbing", await cursorOf(page));
await page.evaluate(() => {
  const el = document.querySelector("svg[aria-label='Site plan canvas']");
  el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
});
await page.waitForTimeout(150);
check("pointercancel recovers cursor to grab", (await cursorOf(page)) === "grab", await cursorOf(page));
await page.mouse.up();

// ---- after recovery, the canvas still works (a fresh pan engages) -----------------
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 40, cy + 20, { steps: 3 });
await page.waitForTimeout(120);
check("canvas still interactive after recovery", (await cursorOf(page)) === "grabbing", await cursorOf(page));
await page.mouse.up();

check("no uncaught page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
process.exit(failed ? 1 : 0);
