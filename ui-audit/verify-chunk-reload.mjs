/* Runtime verification for B218 — stale-chunk-after-deploy auto-reload.
 *
 * Drives the BUILT app (vite preview on :4173) in headless Chromium and exercises the
 * real `vite:preloadError` listener installed by src/app/chunkReload.js:
 *   1. first preloadError  → the page reloads once (recovers a stale chunk),
 *   2. a second one right after → NO reload (cooldown active → error would surface),
 *   3. after the cooldown window → reloads again (a later deploy re-arms).
 * This proves the wiring end-to-end (correct event name, listener present in the
 * bundle, reload fires, loop-guard holds) — the pure decision is unit-tested separately.
 *
 * Run:  npm run build && npx vite preview --host   (then, in another shell)
 *       node ui-audit/verify-chunk-reload.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const KEY = "planyr:chunkReloadAt";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage();

let loads = 0;
page.on("load", () => { loads++; });

const fire = () =>
  page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError"))).catch(() => {});
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

await page.goto(BASE, { waitUntil: "load" });
await page.evaluate((k) => sessionStorage.removeItem(k), KEY); // clean slate
const base = loads;

// 1) First preloadError → expect a reload.
const nav1 = page.waitForEvent("load", { timeout: 6000 });
await fire();
await nav1.catch(() => {});
const afterFirst = loads;
if (afterFirst === base + 1) console.log("PASS 1/3 — first preloadError reloaded the page");
else fail(`first preloadError did not reload (loads ${base} → ${afterFirst})`);

// Confirm the guard timestamp was written (so the cooldown is real).
const stamped = await page.evaluate((k) => sessionStorage.getItem(k), KEY);
if (stamped) console.log("        guard timestamp set:", stamped);
else fail("guard timestamp was not written to sessionStorage");

// 2) Second preloadError immediately after → within cooldown → expect NO reload.
const before2 = loads;
await fire();
await page.waitForTimeout(1800);
if (loads === before2) console.log("PASS 2/3 — second preloadError within cooldown did NOT reload (no loop)");
else fail(`second preloadError reloaded despite cooldown (loads ${before2} → ${loads})`);

// 3) Push the timestamp past the cooldown → expect a reload again (later deploy re-arms).
await page.evaluate((k) => sessionStorage.setItem(k, String(Date.now() - 60_000)), KEY);
const before3 = loads;
const nav3 = page.waitForEvent("load", { timeout: 6000 });
await fire();
await nav3.catch(() => {});
if (loads === before3 + 1) console.log("PASS 3/3 — preloadError after the cooldown reloaded again (re-armed)");
else fail(`re-armed preloadError did not reload (loads ${before3} → ${loads})`);

await browser.close();
console.log(process.exitCode ? "\n❌ verification failed" : "\n✅ all checks passed");
