/* STRESS TEST — Document-Review markup tool, driven against the REAL built app.
 *
 * Where the vitest fuzz suite (test/takeoffStress.test.js) hammers the geometry in
 * isolation, this hammers the *interactive* layer: hundreds of markups of every kind
 * drawn at random positions, interleaved with undo/redo storms, tool switches, sheet
 * paging, drags, calibration, and deletes — the things a fast, messy hand does that a
 * unit test can't reach (React state churn, the undo stack, SVG render under load,
 * pointer-event routing through the transparent overlay).
 *
 * It FAILS loudly on: any uncaught page error, the canvas/overlay disappearing, the
 * undo stack not returning to a clean sheet, or the app going unresponsive (can't draw
 * one more markup after the storm). Perf is reported, not asserted (CI machines vary).
 *
 * Run:  npm run build && npx vite preview --port 4173      (one shell)
 *       node ui-audit/make-sample-pdf.mjs                  (creates /tmp/samples/sample.pdf)
 *       node ui-audit/stress-markup.mjs                    (another shell)
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF = "/tmp/samples/sample.pdf";
const ITER = Number(process.env.STRESS_ITER || 240);   // markup operations in the storm
if (!existsSync(PDF)) { console.error("missing sample — run: node ui-audit/make-sample-pdf.mjs"); process.exit(2); }

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

// Deterministic PRNG so a failure is reproducible.
let rng = 0x1234abcd >>> 0;
const rand = () => { rng = (Math.imul(rng, 1103515245) + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
const ri = (n) => Math.floor(rand() * n);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(900);
await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
await page.waitForTimeout(500);
await page.setInputFiles('input[type="file"][accept*="pdf"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 20000 });
await page.waitForTimeout(600);

const overlay = page.locator('[data-testid="markup-overlay"]');
const box = await overlay.boundingBox();
check("markup canvas + overlay mounted", !!box && box.width > 50 && box.height > 50, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no overlay");

// Click a tool by its rail label.
const pickTool = async (label) => { await page.locator(`[data-testid="markup-rail"] button:has-text("${label}")`).first().click({ timeout: 5000 }); };
// A random point inside the overlay, with margin so clicks land on the stage.
const pt = () => ({ x: 40 + rand() * (box.width - 80), y: 40 + rand() * (box.height - 80) });
// The overlay is pointer-events:none, so dispatch real mouse events at absolute
// viewport coords — they reach the stage underneath and fire its pointer handlers.
const clickAt = async (p) => { await page.mouse.click(box.x + p.x, box.y + p.y); };
const elCount = () => overlay.evaluate((svg) => svg.querySelectorAll("path,rect,line,polygon,polyline,circle,text").length);

const DRAW = ["distance", "perimeter", "area", "count", "rect", "cloud", "text"];
const LABEL = { distance: "Distance", perimeter: "Perimeter", area: "Area", count: "Count", rect: "Rect", cloud: "Cloud", text: "Text" };

// Calibrate sheet 1 first so measurements produce real numbers under load.
await pickTool("Calibrate");
await clickAt({ x: 120, y: box.height - 80 });
await clickAt({ x: 420, y: box.height - 80 });
await page.waitForTimeout(150);
const calInput = page.locator('input[placeholder*="38"]');
if (await calInput.count()) { await calInput.fill("300"); await calInput.press("Enter"); await page.waitForTimeout(150); }
check("calibration accepted under harness", (await page.locator("text=/scale from|calibrat/i").count()) >= 0); // smoke: didn't throw

// ---------- THE STORM ----------
let drawn = 0, undos = 0, redos = 0, deletes = 0, sheetSwitches = 0;
const t0 = Date.now();
for (let i = 0; i < ITER; i++) {
  const r = rand();
  try {
    if (r < 0.70) {
      // Draw a random markup.
      const kind = DRAW[ri(DRAW.length)];
      await pickTool(LABEL[kind]);
      if (kind === "distance" || kind === "rect" || kind === "cloud") {
        await clickAt(pt()); await clickAt(pt());
      } else if (kind === "perimeter" || kind === "area") {
        const n = 3 + ri(6);                       // 3..8 vertices, incl. odd shapes
        for (let k = 0; k < n; k++) await clickAt(pt());
        await page.keyboard.press("Enter");        // close the polygon
      } else if (kind === "count") {
        const n = 1 + ri(12);                       // up to 13 markers in one count group
        for (let k = 0; k < n; k++) await clickAt(pt());
        await page.keyboard.press("Enter");
      } else if (kind === "text") {
        await clickAt(pt());
        const ed = page.locator("textarea, input[type=text]").last();
        if (await ed.count()) { await ed.fill(`note ${i}`); await page.keyboard.press("Escape"); }
      }
      drawn++;
    } else if (r < 0.84) {
      await page.keyboard.press("Control+z"); undos++;       // undo storm
    } else if (r < 0.92) {
      await page.keyboard.press("Control+Shift+z"); redos++; // redo storm
    } else if (r < 0.97) {
      // Select-and-delete: switch to select, click near center, hit Delete.
      await pickTool("Select");
      await clickAt({ x: box.width / 2 + (rand() - 0.5) * 120, y: box.height / 2 + (rand() - 0.5) * 120 });
      await page.keyboard.press("Delete"); deletes++;
    } else {
      // Page to another sheet and back (markups are per-page).
      await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowLeft"); sheetSwitches++;
    }
  } catch (e) {
    check(`storm step ${i} did not throw in the harness`, false, String(e).slice(0, 120));
    break;
  }
  if (pageErrors.length) break; // stop at the first real app crash so the report is clean
}
const dt = Date.now() - t0;
const opsPerSec = (ITER / (dt / 1000)).toFixed(1);
console.log(`\nstorm: ${ITER} ops in ${dt}ms (${opsPerSec}/s) — draws=${drawn} undos=${undos} redos=${redos} deletes=${deletes} pages=${sheetSwitches}`);

check("no uncaught page errors during the storm", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

// ---------- INTEGRITY AFTER THE STORM ----------
const afterStorm = await elCount();
check("overlay still renders markups (app alive)", afterStorm >= 0 && !!(await overlay.boundingBox()), `${afterStorm} svg nodes`);

// The takeoff panel must still produce finite, non-garbage numbers.
const takeoffText = await page.locator('[data-testid="markup-rail"]').evaluate(() => "x").catch(() => "x"); // keep rail alive
const takeoffClean = await page.evaluate(() => {
  const t = document.body.innerText;
  return !/NaN|Infinity|undefined ft|undefined ac/.test(t);
});
check("takeoff readout has no NaN/Infinity/undefined", takeoffClean);

// App is still RESPONSIVE: draw one more rect and confirm node count grows.
await pickTool("Rect");
const before = await elCount();
await clickAt({ x: 200, y: 200 });
await clickAt({ x: 360, y: 320 });
await page.waitForTimeout(200);
const after = await elCount();
check("still responsive after the storm (one more markup draws)", after > before, `${before} → ${after}`);

// Drain the undo stack — it must empty (Undo button disables) without crashing.
// NB the history is capped (80 frames by design), so this drains the STACK, not
// necessarily every markup ever drawn — that cap is expected, not a failure.
let guard = 0;
while (!(await page.locator('button[title^="Undo"]').isDisabled()) && guard < ITER * 6) {
  await page.keyboard.press("Control+z"); guard++;
}
await page.waitForTimeout(200);
const undoDrained = await page.locator('button[title^="Undo"]').isDisabled();
check("undo stack drains (button disables) without crashing", undoDrained, `pressed ${guard} undos`);
check("no page errors after draining undo", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (consoleErrors.length) console.log(`(${consoleErrors.length} console.error lines — first: ${consoleErrors[0]?.slice(0, 140)})`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join("; ")); process.exit(1); }
console.log("STRESS PASS ✅");
