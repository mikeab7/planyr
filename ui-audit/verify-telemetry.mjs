/* Runtime verification for B276 — client error telemetry.
 *
 * Drives the BUILT app (vite preview on :4173) in headless Chromium and exercises the
 * real global handlers installed by src/shared/telemetry/clientErrors.js. The DB sink
 * is a no-op in the sandbox (no Supabase anon key in a local build), so we verify the
 * CAPTURE pipeline via the window.pfTelemetry diagnostic handle (handlers → buildErrorRow
 * → recent ring buffer); the one-line Supabase insert is the only piece that needs a live
 * signed-in check (logged in VERIFICATION.md). Asserts:
 *   1. window 'error'            → a row with source "window.onerror"
 *   2. window 'unhandledrejection' → a row with source "unhandledrejection"
 *   3. window 'vite:preloadError'  → a row with source "vite:preloadError"
 *   4. a repeat of (1) within the dup window → SUPPRESSED (no new row) — storm guard
 *   5. the build id is baked in (not "dev") and the page never crashed (fail-safe)
 *
 * Run:  npm run build && npx vite preview --host   (then, in another shell)
 *       node ui-audit/verify-telemetry.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage();

let navigations = 0;
page.on("load", () => { navigations++; });

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const pass = (m) => console.log("PASS —", m);

await page.goto(BASE, { waitUntil: "load" });
// Telemetry installs synchronously in main.jsx before render, but wait for the handle.
await page.waitForFunction(() => !!window.pfTelemetry, { timeout: 8000 });

// Snapshot of what's already been captured during boot (don't assume it's empty).
const recent = () => page.evaluate(() => window.pfTelemetry.recent());
const lastOf = (rows, source) => [...rows].reverse().find((r) => r.source === source);

// 1) window 'error'
const before1 = (await recent()).length;
await page.evaluate(() => {
  const ev = new ErrorEvent("error", { error: new Error("synthetic telemetry probe — alpha"), message: "synthetic telemetry probe — alpha" });
  window.dispatchEvent(ev);
});
let rows = await recent();
const r1 = lastOf(rows, "window.onerror");
if (rows.length === before1 + 1 && r1 && r1.message.includes("alpha")) pass("window 'error' captured (source window.onerror)");
else fail(`window 'error' not captured as expected (len ${before1} → ${rows.length}, row ${JSON.stringify(r1)})`);

// 2) unhandledrejection
const before2 = rows.length;
await page.evaluate(() => {
  const ev = new Event("unhandledrejection");
  ev.reason = new Error("synthetic telemetry probe — bravo");
  window.dispatchEvent(ev);
});
rows = await recent();
const r2 = lastOf(rows, "unhandledrejection");
if (rows.length === before2 + 1 && r2 && r2.message.includes("bravo")) pass("'unhandledrejection' captured (source unhandledrejection)");
else fail(`'unhandledrejection' not captured (len ${before2} → ${rows.length}, row ${JSON.stringify(r2)})`);

// 3) vite:preloadError (Vite puts the error on event.payload).
// This event is ALSO handled by the B221 chunk-reload guard, which would reload the
// page (destroying our execution context). Stamp its cooldown first so it suppresses
// the reload — here we isolate the telemetry CAPTURE; the reload behavior is covered by
// verify-chunk-reload.mjs. (Telemetry's listener is registered first, so it captures
// before the guard decides anyway.)
await page.evaluate(() => sessionStorage.setItem("planyr:chunkReloadAt", String(Date.now())));
const before3 = rows.length;
await page.evaluate(() => {
  const ev = new Event("vite:preloadError");
  ev.payload = new Error("synthetic telemetry probe — charlie chunk");
  window.dispatchEvent(ev);
});
rows = await recent();
const r3 = lastOf(rows, "vite:preloadError");
if (rows.length === before3 + 1 && r3 && r3.message.includes("charlie")) pass("'vite:preloadError' captured (source vite:preloadError)");
else fail(`'vite:preloadError' not captured (len ${before3} → ${rows.length}, row ${JSON.stringify(r3)})`);

// 4) duplicate of (1) within the dup window → suppressed (storm guard)
const before4 = rows.length;
await page.evaluate(() => {
  const ev = new ErrorEvent("error", { error: new Error("synthetic telemetry probe — alpha"), message: "synthetic telemetry probe — alpha" });
  window.dispatchEvent(ev);
});
rows = await recent();
if (rows.length === before4) pass("duplicate error within the dup window was SUPPRESSED (no new row)");
else fail(`duplicate error was not suppressed (len ${before4} → ${rows.length})`);

// 5) build id baked in + page never crashed (telemetry is fail-safe)
const build = (r1 && r1.build) || "";
if (build && build !== "dev") pass(`build id baked into rows: "${build}"`);
else fail(`build id missing/dev in telemetry rows (got "${build}")`);

const alive = await page.evaluate(() => !!document.querySelector("#root") && document.body.childElementCount > 0);
if (alive && navigations === 1) pass("app still alive, no crash/navigation from firing synthetic errors (fail-safe)");
else fail(`page not healthy after synthetic errors (alive ${alive}, navigations ${navigations})`);

await browser.close();
console.log(process.exitCode ? "\n❌ telemetry verification failed" : "\n✅ all telemetry checks passed");
