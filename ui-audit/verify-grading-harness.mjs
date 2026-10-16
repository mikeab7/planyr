/* verify-grading-harness — drives the REAL GradingController + panels (ui-audit/harness/grading-harness.*) in a
 * browser against the real Chehaw Rd parcel + USGS 3DEP lattice. Exercises what Node cannot: the worker protocol
 * (sweep + mask jobs), the controller hooks, the chip solvers, the fixes, the painted layers and the labels.
 * The is_admin gate is NOT under test here (test/gradingGate.test.js owns it); this proves the gated code works.
 *   node ui-audit/verify-grading-harness.mjs        (starts its own vite dev server on :5199) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5199, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || undefined;
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(`${BASE}/ui-audit/harness/grading-harness.html`);
  await assertMeasurable(page, "verify-grading-harness");
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });

  // ---- Ground row (the sweep, in the terrain worker)
  await page.waitForSelector('[data-ground-state="ready"]', { timeout: 60000 });
  const fig = await page.textContent('[data-ground-figure]');
  const ac = parseFloat(fig);
  check("Ground row: best single pad is 35-40 ac", ac > 35 && ac < 40, fig);
  const subTxt = await page.textContent('[data-ground-row="level"]');
  const fin = +(/finish (\d+) ft/.exec(subTxt) || [])[1];
  check("Ground row: best finish 793-797", fin >= 793 && fin <= 797, `finish ${fin}`);
  check("Ground row: severity pill Workable", (await page.textContent('[data-ground-severity]')) === "Workable");
  const relief = await page.textContent('[data-ground-row="relief"]');
  check("Ground row: relief ~95 ft, 719 to 814", /9[3-7] ft · 719 to 814/.test(relief), relief);

  // ---- Building tab, no FFE yet
  await page.waitForSelector("[data-building-grade-tab]");
  check("Building tab: asks for a finish elevation first", /Pick a chip/.test(await page.textContent("[data-ffe-note]")));

  // ---- the three chips give three different FFEs; Balanced reads balanced
  const ffe = async () => +(await page.inputValue('[data-testid="grading-ffe"]'));
  const results = {};
  for (const id of ["balanced", "least", "room"]) {
    await page.click(`[data-ffe-basis="${id}"]`);
    await page.waitForFunction((v) => { const el = document.querySelector('[data-testid="grading-ffe"]'); return el && el.value !== "" && document.querySelector(`[data-ffe-basis="${v}"]`).getAttribute("aria-pressed") === "true"; }, id, { timeout: 60000 });
    await page.waitForTimeout(400);
    results[id] = await ffe();
  }
  check("three chips, three different finishes", new Set(Object.values(results)).size === 3, JSON.stringify(results));
  check("Most room = the sweep's best finish", results.room === fin, `${results.room} vs ${fin}`);
  await page.click('[data-ffe-basis="balanced"]');
  await page.waitForFunction(() => document.querySelector('[data-grading-tile="net"]'));
  await page.waitForTimeout(1500);
  const netTile = await page.textContent('[data-grading-tile="net"]');
  check("Balanced reads CY net, balanced", /CY net, balanced/.test(netTile), netTile);
  const cut = await page.textContent('[data-grading-tile="cut"]'), fill = await page.textContent('[data-grading-tile="fill"]');
  check("tiles show cut and fill CY", /CY cut/.test(cut) && /CY fill/.test(fill), `${cut} | ${fill}`);

  // ---- layers painted + spot elevations
  check("Buildable layer painted (image + outline)", (await page.locator('[data-layer="buildable"] image').count()) === 1 && (await page.locator('[data-layer="buildable"] path').count()) === 1);
  check("Cut & Fill layer painted (image + dotted outline)", (await page.locator('[data-layer="cutfill"] image').count()) === 1);
  const pills = await page.locator("[data-grade-pill] text").allTextContents();
  check("spot elevations: a dock label, a curb label, far-edge values", pills.some((t) => /^dock \d/.test(t)) && pills.some((t) => /^curb \d/.test(t)), pills.slice(0, 8).join(" | "));
  check("fall tag reads 1.5% fall", pills.includes("1.5% fall"));
  const drop = await page.textContent('[data-court-drop]');
  check("court dock face → far edge readout", /^\d+\.\d → \d+\.\d ft$/.test(drop), drop);
  check("clear when it daylights inside the setback", (await page.locator('[data-grading-flag="clear"]').count()) === 1);

  // ---- the flag: push the building toward the property line and ask for the fixes
  await page.screenshot({ path: "/tmp/grading-harness-clear.png" });
  const flagShot = async (dx, dy) => {
    await page.evaluate(([x, y]) => window.__harness.applyMove(x, y), [dx, dy]);
    await page.waitForTimeout(2500);
    return page.locator('[data-grading-flag="1"]').count();
  };
  let flagged = 0, used = null;
  for (const [dx, dy] of [[0, 120], [0, 240], [0, 360], [-200, 0], [200, 0], [0, 480]]) {
    flagged = await flagShot(dx, dy); used = [dx, dy];
    if (flagged) break;
  }
  check("moving toward the boundary raises the setback flag", flagged === 1, JSON.stringify(used));
  if (flagged) {
    const title = await page.textContent('[data-grading-flag="1"] > div');
    check("flag names a compass side", /Slope crosses (the setback · (North|South|East|West|North-east|North-west|South-east|South-west)|the property line)/.test(title), title);
    await page.waitForFunction(() => { const b = document.querySelector('[data-fix="ffe"]'); return b && !/Finding/.test(b.textContent); }, null, { timeout: 90000 });
    const ffeBtn = await page.textContent('[data-fix="ffe"]'), mvBtn = await page.textContent('[data-fix="move"]');
    check("fix buttons offered", /(Raise|Lower) FFE to|No finish elevation clears it/.test(ffeBtn) && /Move building|No move/.test(mvBtn), `${ffeBtn} | ${mvBtn}`);
    check("red dot with N ft past the setback", (await page.locator("[data-flag-dot]").count()) === 1);
    check("wall fix is present and disabled", await page.locator('[data-fix="wall"]').isDisabled());
    await page.screenshot({ path: "/tmp/grading-harness-flag.png" });
    if (/Move building/.test(mvBtn)) {
      await page.click('[data-fix="move"]');
      await page.waitForTimeout(3000);
      check("applying Move building clears the flag", (await page.locator('[data-grading-flag="1"]').count()) === 0);
    }
  }
  check("no page errors", errs.length === 0, errs.slice(0, 3).join(" || "));
  await browser.close();
} finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
process.exit(fails.length ? 1 : 0);
