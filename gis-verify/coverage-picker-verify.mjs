/* NEW-1..NEW-4 verification — coverage-aware Layers picker, end to end.
 *
 * Boots the built app (map finder) logged-out and checks, in the running app:
 *   NEW-2  the "Relevance" control (Show all / Dim / Hide) + a "nearby range" slider render.
 *   NEW-3  the Mapillary layer reads "Poles & hydrants from street imagery" with its plain
 *          sublabel + a demoted "Source: Mapillary" note; the old brand-first name is gone.
 *   NEW-4  toggling that layer (no token) shows the honest "Not configured" state — a gray
 *          "needs setup" dot, NOT a red "failed".
 *   NEW-1  pan north out of the Houston region → regional layers (HCFCD / City of Houston /
 *          H-GAC ETJ) flip to "No data in this area" (dimmed), proving the coverage engine
 *          reprojects each service's real extent and intersects it with the live view.
 *
 * Run (needs `npx vite preview --port 4173` up): node gis-verify/coverage-picker-verify.mjs
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
// Record ?f=json probes to the regional hosts (so we can see which extents were read).
const probes = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("f=json") && /geogimstest|hctx\.net|fortbendcountytx|HGAC_City_ETJ/i.test(u)) probes.push({ status: r.status(), u: u.slice(0, 90) });
});

const out = { pass: true, notes: [] };
const ok = (cond, label) => { out.notes.push(`${cond ? "✅" : "❌"} ${label}`); if (!cond) out.pass = false; return cond; };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2000);

// ---- NEW-2: Relevance control + nearby range ----
const hasRelevance = (await page.getByText("Relevance", { exact: false }).count()) > 0;
const hasModes = (await page.getByRole("button", { name: "Dim" }).count()) > 0
  && (await page.getByRole("button", { name: "Hide" }).count()) > 0
  && (await page.getByRole("button", { name: "Show all" }).count()) > 0;
ok(hasRelevance && hasModes, "NEW-2: Relevance control (Show all / Dim / Hide) renders");
const hasRange = (await page.getByText(/\bmi$/, { exact: false }).count()) > 0
  || (await page.locator('input[aria-label="Nearby range (miles)"]').count()) > 0;
ok(hasRange, "NEW-2: nearby-range slider renders (Dim is the default mode)");

// ---- NEW-3: Mapillary plain-language rename ----
const hasNewName = (await page.getByText("Poles & hydrants from street imagery", { exact: false }).count()) > 0;
const oldNameGone = (await page.getByText("Street-level detections", { exact: false }).count()) === 0;
const hasSublabel = (await page.getByText("Detected in crowdsourced street-level photos", { exact: false }).count()) > 0;
const hasSource = (await page.getByText("Source: Mapillary", { exact: false }).count()) > 0;
ok(hasNewName && oldNameGone, "NEW-3: layer renamed to 'Poles & hydrants from street imagery' (old name gone)");
ok(hasSublabel && hasSource, "NEW-3: plain sublabel shown + 'Mapillary' demoted to a source note");

// ---- NEW-4: honest 'not configured' state (no token) ----
try {
  const cb = page.locator('label:has-text("Poles & hydrants from street imagery") input[type="checkbox"]').first();
  await cb.check({ timeout: 4000 });
  await page.waitForTimeout(600);
} catch (e) { out.notes.push("· (could not toggle Mapillary: " + e.message + ")"); }
const notConfigured = (await page.getByText("Not configured", { exact: false }).count()) > 0;
ok(notConfigured, "NEW-4: tokenless layer reads 'Not configured' (needs setup, not a red failure)");

// ---- NEW-1: pan north out of the Houston region → regional layers go out-of-coverage ----
const beforeNoData = await page.getByText("No data in this area", { exact: false }).count();
const map = page.locator(".leaflet-container").first();
const box = await map.boundingBox();
if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // big upward drags move the view north (Houston 29.8°N → ~33°N over several drags)
  for (let i = 0; i < 7; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 360, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  }
}
await page.waitForTimeout(1500); // let the debounced coverage recompute settle
const afterNoData = await page.getByText("No data in this area", { exact: false }).count();
out.notes.push(`· extent ?f=json probes seen: ${probes.length} (${[...new Set(probes.map((p) => p.u.replace(/https?:\/\//, "").split("/")[0]))].join(", ") || "none"})`);
out.notes.push(`· "No data in this area" rows — before pan: ${beforeNoData}, after pan north: ${afterNoData}`);
ok(afterNoData > beforeNoData, "NEW-1: panning out of the region flips regional layers to 'No data in this area' (coverage engine live)");

await page.screenshot({ path: "gis-verify/coverage-picker-verify.png" });
ok(pageErrors.length === 0, `no page JS errors (${pageErrors.length})`);
if (pageErrors.length) out.notes.push("  errors: " + pageErrors.slice(0, 3).join(" | "));

console.log("\n=== coverage-picker-verify ===");
out.notes.forEach((n) => console.log("  " + n));
console.log(`\n${out.pass ? "PASS ✅" : "FAIL ❌"}  (screenshot: gis-verify/coverage-picker-verify.png)\n`);
await browser.close();
process.exit(out.pass ? 0 : 1);
