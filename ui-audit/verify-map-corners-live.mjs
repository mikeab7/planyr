/* verify-map-corners-live — V1625808: the B2206704–B2206706 furniture checks, driven SIGNED IN on a real deploy.
 * Reads /version.json and the served chunk hashes IN THE SAME CALL as each measurement (a stale tab proves nothing).
 *   node ui-audit/verify-map-corners-live.mjs [base] [--expect-build=<sha>]   */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { readFurnitureFrame, judgeFurniture } from "./lib/furnitureFrames.mjs";
import { MAP_CORNER_PX } from "../src/workspaces/site-planner/lib/mapCorners.js";
const base = process.argv.find((a) => a.startsWith("http")) || "https://planyr.io";
const expect = (process.argv.find((a) => a.startsWith("--expect-build=")) || "").split("=")[1];
let fail = 0; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fail++; };
const s = await openSignedIn({ base, viewport: { width: 1191, height: 640 } });
const { page } = s;
await page.addInitScript(`window.__readFur = ${readFurnitureFrame.toString()};`);
await page.goto(`${base}/#/project/e2e-fixture/site`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 45000 });
await page.waitForTimeout(4000);
const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /assets/.test(x)).slice(0, 3));
console.log(`signed in as ${s.proof?.email}; build ${ver.build}; chunks ${chunks.join(", ")}`);
if (expect) ok(String(ver.build).startsWith(expect), `served build ${ver.build} is the merge commit ${expect}`);
await page.evaluate(() => document.querySelector('[data-rail-tab="yield"]')?.click());
await page.waitForTimeout(1500);
await page.mouse.move(700, 330); await page.waitForTimeout(500);
// per-frame recorder through a real slow grip drag
await page.evaluate(() => { window.__fr = []; window.__run = true; const t = () => { if (!window.__run) return; window.__fr.push(window.__readFur()); requestAnimationFrame(t); }; requestAnimationFrame(t); });
const grip = await page.locator('[title="Drag to resize"]').first().boundingBox();
const y = grip.y + grip.height / 2, x0 = grip.x + grip.width / 2;
await page.mouse.move(x0, y); await page.mouse.down();
for (let i = 1; i <= 50; i++) { await page.mouse.move(x0 + (i * 3.1) + 0.37, y); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
for (let i = 1; i <= 50; i++) { await page.mouse.move(x0 + 155 - (i * 4.3) + 0.21, y); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
await page.mouse.up(); await page.waitForTimeout(400);
const frames = await page.evaluate(() => { window.__run = false; return window.__fr; });
const fv = judgeFurniture(frames, { requireObserved: ["north", "scale-bar", "help", "zoom"] });
ok(fv.violations.length === 0, `furniture inside the visible pane on all ${frames.length} frames of a live drag (${[...fv.observed].join(", ")})${fv.violations[0] ? " — " + fv.violations[0] : ""}`);
const f = await page.evaluate(() => window.__readFur());
const b = f.canvas.bottom, r = f.canvas.right, it = f.items;
ok(Math.abs(b - it["scale-bar"].bottom - MAP_CORNER_PX) <= 1.5 && Math.abs(b - it.zoom.bottom - (b - it["scale-bar"].bottom)) <= 1, `scale bar and zoom stack share one baseline ${MAP_CORNER_PX}px above the bottom (${(b - it.zoom.bottom).toFixed(1)})`);
ok(Math.abs(r - it.zoom.right - MAP_CORNER_PX) <= 1.5, `zoom stack ${MAP_CORNER_PX}px from the right edge (${(r - it.zoom.right).toFixed(1)})`);
ok(it["scale-bar"].right <= it.help.left + .5 && it.help.right <= it.zoom.left + .5, "order: scale bar · help · zoom");
const lbl = await page.evaluate(() => { const svg = document.querySelector('[data-map-furniture="scale-bar"] svg'); const t = [...svg.querySelectorAll("text")].filter((x) => x.textContent !== "FEET"); const l = t[t.length - 1].getBBox(); return { end: t[t.length - 1].textContent, margin: svg.viewBox.baseVal.width - (l.x + l.width) }; });
ok(lbl.margin >= 5, `scale bar end label "${lbl.end}" has ${lbl.margin.toFixed(1)}px clear of the plate's right border`);
await s.close();
console.log(fail ? `FAIL (${fail})` : "PASS"); process.exit(fail ? 1 : 0);
