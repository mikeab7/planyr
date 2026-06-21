/* B308 verification — the street-imagery layer works with NO per-user token, via the
 * same-origin /api/mapillary proxy, and no token rides in the client request URL.
 *
 * Logged-out, on the built app (vite preview). NOTE: vite preview has no Functions
 * runtime, so /api/mapillary returns the SPA index.html — the client treats that as
 * "not available here" (graceful), which is the right degrade. The LIVE proof (imagery
 * actually renders) is on planyr.io Production where the secret + the Function exist —
 * see VERIFICATION. What we PROVE here: (1) the layer loads with no token gate, (2) the
 * request goes same-origin to /api/mapillary with NO access_token / MLY token, (3) no
 * direct graph.mapillary.com call, (4) graceful degrade, 0 JS errors.
 *
 * Run (needs `npx vite preview --port 4178` up): node gis-verify/mapillary-proxy-verify.mjs
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4178/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const mlyReqs = [];   // requests to our proxy
const directReqs = []; // any direct graph.mapillary.com calls (should be none w/o a token)
const tokenLeaks = []; // any request URL carrying access_token / an MLY token
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/mapillary/")) mlyReqs.push(u);
  if (u.includes("graph.mapillary.com")) directReqs.push(u);
  if (/access_token=|MLY%7C|MLY\|/.test(u)) tokenLeaks.push(u);
});

const out = { pass: true, notes: [] };
const ok = (c, label) => { out.notes.push(`${c ? "✅" : "❌"} ${label}`); if (!c) out.pass = false; return c; };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

// Toggle the street-imagery layer ON
try {
  await page.locator('label:has-text("Poles & hydrants from street imagery") input[type="checkbox"]').first().check({ timeout: 5000 });
  await page.waitForTimeout(500);
} catch (e) { out.notes.push("· (toggle failed: " + e.message + ")"); }

ok((await page.getByText("Works automatically", { exact: false }).count()) > 0, "B308: layer reads 'Works automatically — no token needed' (no token gate)");
ok((await page.getByText("Not configured — add a free access token", { exact: false }).count()) === 0, "B308: the old 'Not configured — add a token' gate is gone");

// Zoom in past the z≥16 threshold so the layer fetches (each zoom = a moveend).
for (let i = 0; i < 7; i++) {
  try { await page.locator(".leaflet-control-zoom-in").first().click({ timeout: 1500 }); } catch (_) { /* fall back to wheel */ await page.mouse.wheel(0, -400); }
  await page.waitForTimeout(350);
}
await page.waitForTimeout(1500);

ok(mlyReqs.length > 0, `B308: the layer requested the same-origin proxy /api/mapillary (${mlyReqs.length} request(s))`);
ok(mlyReqs.every((u) => u.startsWith(BASE) || u.includes("localhost")), "B308: those requests are SAME-ORIGIN");
ok(directReqs.length === 0, "B308: NO direct graph.mapillary.com call (no token → proxy only)");
ok(tokenLeaks.length === 0, `B308: NO token in any request URL (access_token/MLY) — ${tokenLeaks.length} leak(s)`);
ok(pageErrors.length === 0, `no page JS errors (${pageErrors.length})`);
if (mlyReqs[0]) out.notes.push("· sample proxy request: " + mlyReqs[0].replace(BASE, "/"));

await page.screenshot({ path: "gis-verify/mapillary-proxy-verify.png" });
console.log("\n=== mapillary-proxy-verify ===");
out.notes.forEach((n) => console.log("  " + n));
console.log(`\n${out.pass ? "PASS ✅" : "FAIL ❌"}  (screenshot: gis-verify/mapillary-proxy-verify.png)\n`);
await browser.close();
process.exit(out.pass ? 0 : 1);
