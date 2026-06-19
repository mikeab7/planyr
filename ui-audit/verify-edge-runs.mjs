/* Verify B206 (inactive parcel inherits active state) + B207 (edge-run setbacks) +
 * B208 (fanned, single-per-side dimensions).
 *
 * Logged-out (sandbox proxy blocks sign-in): seed one ACTIVE parcel whose east side is
 * digitized as 3 near-collinear segments + one INACTIVE parcel + two easements (one
 * anchored to the inactive parcel, one free), then drive the built app on :4173.
 *
 * Checks:
 *  B206 — only the ACTIVE parcel draws a setback line + acreage chip; an easement
 *         anchored to the inactive parcel is hidden, a free easement still shows.
 *  B207 — selecting the parcel shows ONE setback pill per SIDE (4 runs, not 6 edges);
 *         "Per segment" toggles to one pill per edge (6).
 *  B208 — the run length dimension + the setback pill are fanned (different positions),
 *         confirmed visually in the screenshot.
 *
 * Run:  npm run build && npx vite preview --port 4173   (separate shell)
 *       node ui-audit/verify-edge-runs.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const now = Date.now();
// Active parcel: S edge, an EAST side as 3 near-collinear segments (one logical run),
// N edge, W edge → 6 edges that group into 4 runs.
const p1 = {
  id: "p1", points: [
    { x: 0, y: 0 }, { x: 600, y: 0 },           // e0 South
    { x: 600, y: 133 }, { x: 601, y: 266 }, { x: 600, y: 400 }, // e1,e2,e3 East run (~90°±0.5°)
    { x: 0, y: 400 },                            // e4 North ; e5 West closes
  ],
};
// Inactive parcel offset to the east — would draw a setback + chip if not for B206.
const p2 = { id: "p2", active: false, points: [{ x: 800, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 400 }, { x: 800, y: 400 }] };
const easeOnInactive = { id: "eA", kind: "easement", mode: "boundary", parcelId: "p2", easeType: "utility", status: "existing", restrictsBuildings: true, pts: [{ x: 820, y: 20 }, { x: 1180, y: 20 }, { x: 1180, y: 60 }, { x: 820, y: 60 }] };
const easeFree = { id: "eB", kind: "easement", mode: "boundary", parcelId: null, easeType: "storm", status: "existing", restrictsBuildings: true, pts: [{ x: 50, y: 430 }, { x: 550, y: 430 }, { x: 550, y: 470 }, { x: 50, y: 470 }] };

const site = {
  id: "mv", groupId: "mv", site: "Mesa Verify", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [p1, p2], els: [], measures: [], callouts: [], markups: [easeOnInactive, easeFree],
  settings: { showSetback: true, setback: 25 }, underlay: null, status: "active", updatedAt: now,
};
const sites = { mv: site };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
const shot = async (n) => { await page.screenshot({ path: OUT + n }); console.log("  saved", n); };

// Open the seeded project from the breadcrumb.
await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Mesa Verify")').click();
await page.waitForTimeout(1400);
// Frame the parcels.
await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
await page.waitForTimeout(800);
await shot("edge-runs-1-loaded.png");

// ── B206: active-state inheritance (no parcel selected) ──
// Query document-wide (the page has many small icon <svg>s besides the canvas).
const counts = async () => page.evaluate(() => {
  const all = (sel) => [...document.querySelectorAll(sel)];
  const chips = all("text").filter((t) => /\bac$/.test((t.textContent || "").trim())).length;
  const setbackLines = all('polygon[stroke-dasharray="7 6"]').length;
  const easements = all("polygon").filter((p) => /url\(#pat-ease/.test(p.getAttribute("fill") || "")).length;
  const sbPills = all('rect[stroke="#b45309"]').length;
  return { chips, setbackLines, easements, sbPills };
});
let c = await counts();
ok("B206 — exactly ONE acreage chip (inactive parcel's chip hidden)", c.chips === 1, `chips=${c.chips}`);
ok("B206 — exactly ONE setback line (inactive parcel draws none)", c.setbackLines === 1, `setbackLines=${c.setbackLines}`);
ok("B206 — easement on the inactive parcel hidden; the free one shows (1)", c.easements === 1, `easementPolys=${c.easements}`);

// ── B207/B208: select the active parcel → per-SIDE setback pills (runs, not edges) ──
const parcelPoly = page.locator('polygon[pointer-events="all"]').first();
const bb = await parcelPoly.boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(700);
await shot("edge-runs-2-selected-byside.png");
c = await counts();
ok("B207 — ONE setback pill per SIDE: 4 runs (S, E-run, N, W), not 6 edges", c.sbPills === 4, `pills=${c.sbPills}`);

// Toggle to per-segment → one pill per edge (6).
await page.locator('button:has-text("Per segment")').click();
await page.waitForTimeout(500);
c = await counts();
ok("B207 — 'Per segment' override exposes one pill per edge (6)", c.sbPills === 6, `pills=${c.sbPills}`);
await shot("edge-runs-3-persegment.png");

// Back to "By side".
await page.locator('button:has-text("By side")').click();
await page.waitForTimeout(400);
c = await counts();
ok("B207 — toggling back to 'By side' returns to 4 pills", c.sbPills === 4, `pills=${c.sbPills}`);

// ── B208: the run-length dim (outboard) and setback pill (inboard) are fanned apart ──
const fan = await page.evaluate(() => {
  const pills = [...document.querySelectorAll('rect[stroke="#b45309"]')].map((r) => ({ x: +r.getAttribute("x") + 13, y: +r.getAttribute("y") + 9 }));
  // Boundary run-length dims are ink-colored text; exclude the setback pills' OWN
  // orange (#b45309) value text so we measure pill→boundary-dim distance, not pill→self.
  const dims = [...document.querySelectorAll("text")]
    .filter((t) => /^\d+′$/.test((t.textContent || "").trim()) && (t.getAttribute("fill") || "").toLowerCase() !== "#b45309")
    .map((t) => ({ x: +t.getAttribute("x"), y: +t.getAttribute("y") }));
  // For each pill, the nearest boundary dim must be fanned away (never coincident).
  let minGap = Infinity;
  pills.forEach((p) => dims.forEach((d) => { minGap = Math.min(minGap, Math.hypot(p.x - d.x, p.y - d.y)); }));
  return { pills: pills.length, dims: dims.length, minGap: Math.round(minGap) };
});
ok("B208 — boundary dim and setback pill are fanned apart (not stacked)", fan.minGap >= 12 && fan.dims >= 4, JSON.stringify(fan));

await ctx.close();
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join("; ")); process.exit(1); }
console.log("ALL PASS");
