/* verify-road-row-band — the road RIGHT-OF-WAY band (owner, 2026-11-24: "I should be able to edit the right-of-way boundary …
 * maybe it should be opaque up to the right-of-way boundary").
 *
 * Logged-out, blank local site, no external GIS. Seeds three roads into the plan the toolbar creates:
 *   A — a straight east-west road with a designated ROW (centred, the shape every plan saved before this feature has);
 *   B — a north-south road crossing A, with its own ROW (an intersection where the ROWs overlap);
 *   C — a curved road with an UNEVEN ROW (one side wider).
 * Then checks: the solid band underlay is drawn for each, at the very bottom of the drawing (under every element); the ROW
 * lines stop where they meet the other road's band; typing one side in Properties moves only that line; dragging the line's
 * grip moves it; Ctrl+Z puts it back; the View ▾ "Right-of-way" switch hides band + lines; the export sheet carries the band.
 *
 * Run:  npm run build && npx vite preview --port 4173  (then)  node ui-audit/verify-road-row-band.mjs
 */
import pw from "playwright";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-row-band/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-road-row-band");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
const fails = [], notes = [];
const check = (ok, label, detail = "") => { (ok ? notes : fails).push(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
try { await page.getByTestId("map-toolbar-draw").click({ timeout: 8000 }); await page.getByTestId("map-toolbar-draw").click({ timeout: 8000 }); } catch (_) {}
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(1500);

const planKey = await page.evaluate(() => Object.keys(localStorage).find((k) => /^planarfit:sites:v1:p:/.test(k)));
check(!!planKey, "a local plan entry exists to seed", planKey || "none");
const xs = (w, row, shift) => { const x = { bands: [{ type: "travel", w }], rowDesignFt: row }; if (shift) x.rowShiftFt = shift; return x; };
const road = (id, pts, w, x, z, vtx) => ({ id, type: "road", pts, vtx: vtx || pts.map(() => ({})), travelW: w, curb: 0.5, rot: 0, cx: 0, cy: 0, w: 10, h: 10, z, xsection: x });
const ELS = [
  road("rA", [{ x: -400, y: 0 }, { x: 400, y: 0 }], 36, xs(36, 80), 1),
  road("rB", [{ x: 0, y: -400 }, { x: 0, y: 400 }], 24, xs(24, 60), 2),
  road("rC", [{ x: 150, y: 150 }, { x: 450, y: 180 }, { x: 600, y: 400 }], 24, xs(24, 70, 10), 3, [{}, { treatment: "arc", radius: 200 }, {}]),
  { id: "lsA", type: "landscape", cx: -200, cy: 60, w: 120, h: 30, rot: 0, z: 0 },   // created BEFORE the roads, inside A's ROW: must stay visible
];
await page.evaluate(([k, els]) => { const s = JSON.parse(localStorage.getItem(k)); s.els = els; s.updatedAt = Date.now(); localStorage.setItem(k, JSON.stringify(s)); }, [planKey, ELS]);
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__plannerView.centerOn(100, 100, 0.9));
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "01-three-roads.png" });

const read = () => page.evaluate(() => {
  const u = document.querySelector('[data-testid="row-underlay"]');
  const svg = document.querySelector('[data-testid="planner-canvas"] svg') || document.querySelector("svg");
  // el-tier: the FIRST drawn element node is the yardstick for paint order (the underlay must precede it), not a census.
  const firstEl = document.querySelector("[data-el-id]");
  const bands = u ? [...u.querySelectorAll("[data-row-band]")].map((p) => p.getAttribute("data-row-band")) : [];
  const lines = {};
  for (const p of document.querySelectorAll("polyline[data-row-line]")) lines[p.getAttribute("data-row-line")] = (lines[p.getAttribute("data-row-line")] || 0) + 1;
  const under = !!(u && firstEl && (u.compareDocumentPosition(firstEl) & Node.DOCUMENT_POSITION_FOLLOWING));
  const fill = u && u.querySelector("path") ? u.querySelector("path").getAttribute("fill") : null;
  return { bands, lines, under, fill, hasSvg: !!svg };
});
let r = await read();
check(r.bands.length === 3 && ["rA", "rB", "rC"].every((id) => r.bands.includes(id)), "a solid ROW band is drawn for all three roads", JSON.stringify(r.bands));
check(r.under, "the band underlay sits BEFORE (under) every drawn element in the paint order");
check(r.fill && r.fill.toLowerCase() === "#e2e7d9", "the band uses the Right-of-way standard fill", r.fill);
check(r.lines.rA === 4 && r.lines.rB === 4, "at the crossing each road's two ROW lines are cut in two by the other road's band (4 pieces each)", JSON.stringify(r.lines));
check(r.lines.rC >= 2, "the curved road draws both ROW lines", JSON.stringify(r.lines));
const lsVisible = await page.evaluate(() => { const n = document.querySelector('[data-el-id="lsA"]'); if (!n) return null; const b = n.getBoundingClientRect(); const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!(t && n.contains(t)); });
check(lsVisible === true, "a landscape strip drawn BEFORE the road, inside its ROW, is still on top of the band (nothing is covered)", String(lsVisible));

// uneven ROW geometry, read from the drawn lines of C: distance from each line's midpoint to the centerline differs by 2×shift
const sel = async (id) => {
  const b = await page.evaluate((elId) => { const n = document.querySelector(`[data-el-id="${elId}"]`); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  return b;
};
// select road A by clicking its pavement a little off the crossing
const v = await page.evaluate(() => window.__plannerView.get());
const box = await page.getByTestId("planner-canvas").boundingBox();
const toScr = (x, y) => ({ x: box.x + v.w / 2 + (x - 100) * 0.9, y: box.y + v.h / 2 + (y - 100) * 0.9 });
const pA = toScr(-250, 0);
await page.mouse.click(pA.x, pA.y); await page.waitForTimeout(400);
await page.mouse.dblclick(pA.x, pA.y); await page.waitForTimeout(700);
const hasGrips = await page.evaluate(() => !!document.querySelector('[data-testid="road-row-handle-l"]') && !!document.querySelector('[data-testid="road-row-handle-r"]'));
check(hasGrips, "selecting road A shows a drag grip on each ROW line");
const sideInputs = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="road-row-side-"] input, input[data-testid^="road-row-side-"]')].map((i) => i.value));
const sideLabels = await page.evaluate(() => [...document.querySelectorAll('[data-field-group]')].map((n) => n.innerText.split("\n")[0]).filter((t) => / side$/.test(t)));
check(sideInputs.length === 2 && sideInputs.every((x) => x === "40"), "Properties shows each side's distance (40 ft each for a centred 80 ft ROW)", JSON.stringify(sideInputs));
check(sideLabels.includes("South side") && sideLabels.includes("North side"), "the two sides are named by the compass (an east-west road: North / South)", JSON.stringify(sideLabels));
await page.screenshot({ path: OUT + "02-road-A-selected.png" });

const storedA = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).els.find((e) => e.id === "rA").xsection, planKey);
// type the north side to 60
const north = page.locator('[data-testid="road-row-side-r"] input, input[data-testid="road-row-side-r"]').first();
await north.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("60"); await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
let xA = await storedA();
check(xA.rowDesignFt === 100 && xA.rowShiftFt === -10, "typing North = 60 keeps South at 40: width 100, shifted 10 ft north", JSON.stringify(xA));
await page.screenshot({ path: OUT + "03-north-60.png" });
// typing below the curb is held at the curb
await north.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("5"); await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
xA = await storedA();
const northNow = xA.rowDesignFt / 2 - (xA.rowShiftFt || 0);
check(northNow >= 18.5 - 1e-6 && northNow < 19, "a side typed inside the pavement is held at the back of curb", `north=${northNow}`);
await page.evaluate(() => document.activeElement && document.activeElement.blur()); // a typing box keeps its own undo; the plan's undo is outside it
await page.keyboard.press("Control+z"); await page.waitForTimeout(800);
xA = await storedA();
check(xA.rowDesignFt === 100 && xA.rowShiftFt === -10, "Ctrl+Z undoes that one edit", JSON.stringify(xA));

// drag the south grip 20 ft further south (screen +y)
const g = await page.evaluate(() => { const n = document.querySelector('[data-testid="road-row-handle-l"]'); const b = n.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
await page.mouse.move(g.x, g.y); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(g.x, g.y + i * 1.8); await page.waitForTimeout(30); }
const midDrag = await page.evaluate(() => [...document.querySelectorAll("text")].map((t) => t.textContent).find((t) => /from center/.test(t)) || null);
await page.screenshot({ path: OUT + "04-mid-drag.png" });
await page.mouse.up(); await page.waitForTimeout(1000);
check(!!midDrag, "while dragging, the line shows its new distance from the centerline", midDrag || "none");
xA = await storedA();
const southNow = xA.rowDesignFt / 2 + (xA.rowShiftFt || 0), northKeep = xA.rowDesignFt / 2 - (xA.rowShiftFt || 0);
check(southNow >= 58 && southNow <= 62 && Math.abs(northKeep - 60) < 0.01, "dragging the south line ~20 ft out moves only the south side (north stays 60)", `south=${southNow} north=${northKeep}`);
await page.screenshot({ path: OUT + "05-after-drag.png" });
await page.keyboard.press("Control+z"); await page.waitForTimeout(800);
xA = await storedA();
check(xA.rowDesignFt === 100 && xA.rowShiftFt === -10, "one Ctrl+Z undoes the whole drag", JSON.stringify(xA));

// the width field keeps the shift
const widthBox = page.locator('[data-testid="road-row"] input, input[data-testid="road-row"]').first();
await widthBox.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("120"); await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
xA = await storedA();
check(xA.rowDesignFt === 120 && xA.rowShiftFt === -10, "a new total width keeps the uneven split (each side grows by half)", JSON.stringify(xA));

// export sheet carries the band
const exportHtml = await page.evaluate(async () => (window.__plannerExportSvg ? await window.__plannerExportSvg() : null));
check(!!exportHtml && /data-row-underlay/.test(exportHtml) && (exportHtml.match(/data-row-band=/g) || []).length === 3, "PDF-PARITY: the exported sheet carries the ROW band underlay for all three roads", exportHtml ? `bands=${(exportHtml.match(/data-row-band=/g) || []).length}` : "no export hook");
check(!!exportHtml && !/data-row-grip/.test(exportHtml), "the drag grips never reach the export");

// View toggle
await page.keyboard.press("Escape");
await page.locator('[data-testid="view-menu-btn"]').click(); await page.waitForTimeout(250);
const tog = page.locator('label:has-text("Right-of-way") input[type="checkbox"]');
check(await tog.count() === 1, "View ▾ has one \"Right-of-way\" switch");
await tog.uncheck(); await page.waitForTimeout(500);
r = await read();
check(r.bands.length === 0 && Object.keys(r.lines).length === 0, "switching it off hides both the band and the lines", JSON.stringify(r));
await tog.check(); await page.waitForTimeout(500);
r = await read();
check(r.bands.length === 3, "switching it back on restores the bands", JSON.stringify(r.bands));
await page.locator('[data-testid="view-menu-btn"]').click();
await page.evaluate(() => window.__plannerView.centerOn(100, 100, 0.9)); await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "06-final.png" });

check(errs.length === 0, "no page errors", errs.join(" | "));
console.log("\n" + notes.join("\n"));
if (fails.length) console.log("\n" + fails.join("\n"));
console.log(`\n${fails.length ? "FAIL" : "PASS"} — ${notes.length} passed, ${fails.length} failed. Screens → ${OUT}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
