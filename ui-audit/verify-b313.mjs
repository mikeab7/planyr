/* Self-verification for B313 — Undo (Ctrl+Z) after moving a building.
 * Seeds a single-building plan, boots the planner logged-out, drags the building
 * on the SVG canvas, and checks that ONE Ctrl+Z snaps it ALL the way back to its
 * pre-drag position (the reported bug: undo did nothing / only partially reverted).
 * Also checks redo, two-moves-two-undos, and Esc-mid-drag cancel.
 * Building plan-style fill: #f3ece1 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const A_ID = "verify-undo";
const site = { id: A_ID, groupId: A_ID, site: "Verify Undo", name: "Plan 1", origin: null, county: null,
  parcels: [], els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 200, h: 150, rot: 0, dock: "none" }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [A_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(A_ID)});
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seedScript);
const page = await ctx.newPage();
// Real JS exceptions fail the run. External GIS hosts are CORS-blocked by the sandbox
// proxy (Houston city map services) — that network noise is environmental, not our code.
const NETWORK_NOISE = /CORS policy|Failed to load resource|ERR_FAILED|net::|Access to fetch/i;
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);

const fit = async () => { try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(400); };
const centerOf = (fill) => page.evaluate((f) => {
  let best = null;
  for (const r of document.querySelectorAll("svg rect")) {
    if ((r.getAttribute("fill") || "").toLowerCase() !== f) continue;
    const b = r.getBoundingClientRect();
    if (b.width < 8 || b.height < 8) continue;
    if (!best || b.width * b.height > best.area) best = { x: b.x + b.width / 2, y: b.y + b.height / 2, area: b.width * b.height };
  }
  return best;
}, fill);
const BLD = "#f3ece1";
const bld = () => centerOf(BLD);
const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2); await page.mouse.move(to.x, to.y); await page.mouse.move(to.x, to.y); await page.mouse.up(); await page.waitForTimeout(300); };
const undo = async () => { await page.keyboard.press("Control+z"); await page.waitForTimeout(300); };
const redo = async () => { await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(300); };
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

await fit();
await page.keyboard.press("Escape"); await page.waitForTimeout(150);

/* ---- 1) one drag → one Ctrl+Z reverts the WHOLE move ---- */
const o = await bld();
log(!!o, `building present (origin ${o ? `${o.x.toFixed(0)},${o.y.toFixed(0)}` : "MISSING"})`);
await drag(o, { x: o.x + 260, y: o.y + 150 });
const moved = await bld();
log(d(moved, o) > 120, `building dragged away (Δ=${d(moved, o).toFixed(0)}px)`);
await undo();
const afterUndo = await bld();
log(d(afterUndo, o) < 8, `ONE Ctrl+Z snapped it fully back to origin (Δ from origin=${d(afterUndo, o).toFixed(1)}px — must be ~0, not partial)`);

/* ---- 2) redo restores the move ---- */
await redo();
const afterRedo = await bld();
log(d(afterRedo, moved) < 8, `Ctrl+Shift+Z redid the move (Δ from moved-spot=${d(afterRedo, moved).toFixed(1)}px)`);
await undo(); // back to origin for the next phase
await page.waitForTimeout(150);

/* ---- 3) two separate moves → two undos, each reverts exactly one ---- */
const o2 = await bld();
await drag(o2, { x: o2.x + 180, y: o2.y });          // move 1 (right)
const s1 = await bld();
await drag(s1, { x: s1.x, y: s1.y + 160 });          // move 2 (down)
const s2 = await bld();
log(d(s1, o2) > 80 && d(s2, s1) > 80, `two distinct moves applied (m1 Δ=${d(s1, o2).toFixed(0)}, m2 Δ=${d(s2, s1).toFixed(0)})`);
await undo();
const u1 = await bld();
log(d(u1, s1) < 8, `first undo reverts move 2 only → back at move-1 spot (Δ=${d(u1, s1).toFixed(1)}px)`);
await undo();
const u2 = await bld();
log(d(u2, o2) < 8, `second undo reverts move 1 → back at origin (Δ=${d(u2, o2).toFixed(1)}px)`);

/* ---- 4) Esc mid-drag cancels the move (no half-recorded command) ---- */
const o3 = await bld();
await page.mouse.move(o3.x, o3.y); await page.mouse.down();
await page.mouse.move(o3.x + 140, o3.y + 90); await page.mouse.move(o3.x + 200, o3.y + 120);
await page.keyboard.press("Escape"); await page.waitForTimeout(200);
await page.mouse.up(); await page.waitForTimeout(200);
const afterEsc = await bld();
log(d(afterEsc, o3) < 8, `Esc mid-drag returned the building to pre-drag (Δ=${d(afterEsc, o3).toFixed(1)}px)`);
// and the stack is clean: an undo now should NOT move the (already-correct) building oddly
await undo(); await page.waitForTimeout(150);
const afterEscUndo = await bld();
log(d(afterEscUndo, o3) < 8, `after a cancelled drag, undo leaves the building put (no dangling half-command; Δ=${d(afterEscUndo, o3).toFixed(1)}px)`);

await page.screenshot({ path: OUT + "b313-undo.png" });
console.log(errors.length ? `page errors:\n${errors.slice(0, 8).join("\n")}` : "(no page errors)");
if (errors.length) fail++;
await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL B313 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
