/**
 * Verify a plotted deed draws EXACTLY as written and shows its misclosure as its own line (NEW-1).
 * Seeds the REAL Grand Port "Tract 1 – 94.53 Acres" (13 calls, saved the OLD way: ring drops the final
 * endpoint) plus its ~0.01 ft save-and-except hole, logged-out, then checks on the real canvas:
 *   known-good arm: the hole (closes to noise) draws NO gap line — a run where this fails is VOID;
 *   Tract 1 draws a red dashed `deed-gap` segment ~31.4 ft long, its panel names the miss in plain words,
 *   and the exported sheet (PDF-PARITY) carries the same gap line.
 * Run: npm run build && npx vite preview --port 4173 &  then  node ui-audit/verify-deed-gap.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { callsToPath } from "../src/workspaces/site-planner/lib/deedParse.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";
const mkCalls = (rows) => rows.map(([az, distFt]) => ({ az, distFt, label: `${az.toFixed(2)}° ${distFt}′` }));
const TRACT1 = mkCalls([[87.07111111111111, 1773.49], [87.2625, 763.87], [180, 445.02], [270, 825.06], [290.05944444444447, 17.15], [290.0761111111111, 41.13], [180.26, 60], [90, 39.94], [180.04777777777778, 1023.21], [173.37583333333333, 233.99], [168.3925, 307.5], [251.4011111111111, 1790.01], [357.3377777777778, 2477.79]]);
const HOLE = mkCalls([[116.72083333333333, 572.04], [180.27444444444444, 1212.6], [164.90055555555554, 295.46], [254.14555555555557, 425.88], [3.963611111111111, 1414.11], [296.7208333333333, 285.18], [357.33722222222224, 332.82]]);
const path1 = callsToPath(TRACT1, { x: -2600, y: -300 });
const holePath = callsToPath(HOLE, { x: -1500, y: -300 });
// saved the OLD way: ring = path minus the final endpoint (what the pre-fix plot stored)
const mk = (id, path, calls, except, label) => ({ id, kind: "encumbrance", pts: path.slice(0, -1), centerline: path, closed: true, calls, label, deedGroup: "g1", except, stroke: except ? "#b91c1c" : "#7c3aed", fill: except ? "#b91c1c" : "#7c3aed", fillOpacity: 0.12, weight: 2, dash: except ? "6 4" : "solid" });
const xs = path1.map((p) => p.x), ys = path1.map((p) => p.y);
const PARCEL = [{ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }, { x: Math.min(...xs), y: Math.max(...ys) }];
const site = { s_gap: { id: "s_gap", groupId: "s_gap", site: "Deed Gap Test", name: "Plan 1", status: "active", origin: { lat: 29.80, lon: -95.83 }, county: "harris", parcels: [{ id: "pA", points: PARCEL, locked: true }], els: [], measures: [], callouts: [], markups: [mk("t1", path1, TRACT1, false, "Tract 1 – 94.53 Acres"), mk("h1", holePath, HOLE, true, "Save & except")], deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now() } };
const seed = `(() => { try { window.__PLANYR_E2E = true; localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)})); localStorage.setItem('planarfit:currentSite:v1', 's_gap'); } catch (e) {} })();`;

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-deed-gap");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /^Site$/ }).first().click().catch(() => {});
await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "Zoom to fit" }).first().click().catch(() => {});
await page.waitForTimeout(800);

const nBoundary = await page.locator('[data-testid="deed-boundary"]').count();
const nExcept = await page.locator('[data-testid="deed-except"]').count();
expect("PRECONDITION: seeded Tract 1 and its hole are both on the canvas", nBoundary === 1 && nExcept === 1, `${nBoundary}/${nExcept}`);
const gaps = await page.locator('[data-testid="deed-gap"]').count();
expect("exactly ONE gap line (Tract 1); the 0.01 ft hole draws none (known-good arm)", gaps === 1, `${gaps} gap line(s)`);
const len = await page.locator('[data-testid="deed-gap"]').evaluate((l) => {
  return { x1: +l.getAttribute("x1"), y1: +l.getAttribute("y1"), x2: +l.getAttribute("x2"), y2: +l.getAttribute("y2"), dash: l.getAttribute("stroke-dasharray") };
});
expect("the gap line is dashed", !!len.dash, len.dash);
expect("Tract 1's courses are drawn as their own open polyline (not the closing polygon edge)", (await page.locator('[data-testid="deed-courses"]').count()) === 1);

// select Tract 1 by clicking inside its polygon
const pt = await page.locator('[data-testid="deed-boundary"]').evaluate((el) => {
  const poly = (e) => e.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
  const P = poly(el), H = poly(document.querySelector('[data-testid="deed-except"]'));
  const pip = (Q, x, y) => { let c = false; for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) { if ((Q[i][1] > y) !== (Q[j][1] > y) && x < ((Q[j][0] - Q[i][0]) * (y - Q[i][1])) / (Q[j][1] - Q[i][1]) + Q[i][0]) c = !c; } return c; };
  const inside = (x, y) => pip(P, x, y) && !pip(H, x, y); // inside Tract 1, outside the carved hole
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  for (let k = 0; k < 4000; k++) { const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys)); if (inside(x, y)) { const q = el.ownerSVGElement.createSVGPoint(); q.x = x; q.y = y; const v = q.matrixTransform(el.getScreenCTM()); return { x: v.x, y: v.y }; } }
  return null;
});
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(400);
await page.mouse.dblclick(pt.x, pt.y); // double-click opens Properties
await page.waitForTimeout(700);

const txt = (await page.locator('[data-testid="deed-closure"]').first().innerText().catch(() => "")) || "";
expect("panel names the miss in plain words with the precision ratio", /does not close — it misses by 31\.\d ft\. The red dashed line is the gap\. Precision 1:/.test(txt), txt);

const html = await page.evaluate(async () => (typeof window.__plannerExportSvg === "function" ? await window.__plannerExportSvg() : null));
expect("PDF-PARITY: the exported sheet carries the gap line", !!html && html.includes('data-testid="deed-gap"'));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
