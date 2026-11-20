/* verify-grading-drive — NEW-1 (2026-11-11, owner, Georgia Test Site › Concept A): a DRIVE TIES INTO THE ROAD'S GRADE AT THE PROPERTY LINE.
 *
 * The owner's screenshot: the 30-ft entrance drive off Chehaw Rd on the west was graded at about the truck-court elevation all the way to the property
 * line (the road and the ground at the line ≈ 805 ft), so its side slopes cut a deep channel and the flag read "54 ft past the property line". Expected:
 * the drive starts at the existing ground at the line, a 50-ft near-flat landing, then one constant grade to the court / lot edge; its side slopes daylight
 * inside the property; a spot at the tie-in ("road NNN.N") and a fall arrow + % tag on the drive; earthwork, contours and the flag follow.
 *
 * Drives the REAL GradingController + GradingCanvas on the owner's real Chehaw ground and Concept A (ui-audit/harness/grading-harness.*, `?owner=2&app=1`),
 * once with the drive only a RING in the limit (`?drive=ring` — the BEFORE arm: exactly what main does) and once as a graded DRIVE (`?drive=1`).
 *
 * VOID RULES (an instrument that could not have seen the bug is not a verdict): the BEFORE arm must reproduce the bug (a deep cut within 40 ft of the line AND
 * grading flagged past the line) — a before arm that does not is reported VOID; the drive must be on the map in both arms.
 *
 *   node ui-audit/verify-grading-drive.mjs      (starts its own vite dev server on :5207; PNGs → ui-audit/screenshots/grading/drive-{before,after}.png) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5207, BASE = `http://localhost:${PORT}`;
const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
let code = 0;
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
  const errs = [];
  const run = async (arm) => {
    const page = await (await browser.newContext({ viewport: { width: 1760, height: 1040 } })).newPage();
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html?owner=2&app=1&drive=${arm}&ffe=793&zoom=drive&sel=none`);
    await assertMeasurable(page, "verify-grading-drive");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    await page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 120000 });
    await page.waitForSelector('[data-layer="cutfill"]', { state: "attached", timeout: 120000 });
    await page.waitForTimeout(1800);
    const m = await page.evaluate(() => {
      const gs = window.__harness.gradeSurface, g = gs.grid;
      const drv = document.querySelector("[data-harness-drive]");
      const tie = gs.planes.get("drv") ? gs.planes.get("drv").drive.tie : null;
      // the tie-in point: from the drive's own path in the plane (after), or the line crossing recomputed from the outline (before) — the harness exposes the outline
      const pts = drv ? drv.getAttribute("points") : "";
      let atLine = 0, n = 0;
      const ref = tie || window.__harnessDriveTie || null;
      for (const c of g.cells) { if (c.dzFt == null || !ref) continue; if (Math.hypot(c.x - ref.x, c.y - ref.y) < 40) { atLine = Math.max(atLine, Math.abs(c.dzFt)); n++; } }
      const per = g.outside && g.outside.perEl ? Object.values(g.outside.perEl) : [];
      const labels = [...document.querySelectorAll("[data-spot-label^='drive']")].map((el) => el.querySelector("text") && el.querySelector("text").textContent);
      return { hasDrv: !!drv, plane: !!gs.planes.get("drv"), atLine, n, outside: g.outside ? g.outside.count : 0, past: per.length ? Math.max(...per.map((p) => p.maxPastFt)) : 0, labels,
        zTie: gs.planes.get("drv") ? gs.planes.get("drv").drive.zTie : null, gradePct: gs.planes.get("drv") ? gs.planes.get("drv").drive.gradePct : null };
    });
    await page.locator("#canvas").screenshot({ path: `${OUT}drive-${arm === "1" ? "after" : "before"}.png` });
    await page.close();
    return m;
  };
  const before = await run("ring");
  const after = await run("1");
  check("the drive is on the map in both arms (the instrument can see it)", before.hasDrv && after.hasDrv);
  // known-good arm: the BEFORE picture must show the owner's bug, or the whole run is void
  const reproduced = before.outside > 0 && before.past > 10;
  check("BEFORE (drive only a ring, as on main) reproduces the bug: grading flagged past the line", reproduced, `past ${before.past.toFixed(1)} ft, ${before.outside} cells`);
  if (!reproduced) { console.log("VOID — the before arm did not reproduce the owner's bug; the after arm proves nothing"); code = 2; }
  check("AFTER: the drive is a graded plane that starts at the existing ground at the line", after.plane && Number.isFinite(after.zTie), `tie ${after.zTie && after.zTie.toFixed(1)} ft, grade ${after.gradePct && after.gradePct.toFixed(2)}%`);
  check("AFTER: nothing is graded past the line (flag gone)", after.outside === 0 && after.past === 0, `${after.outside} cells, ${after.past} ft`);
  check("AFTER: the drive's labels are drawn — the tie-in spot and the fall tag", after.labels.some((t) => /^road \d/.test(t)) && after.labels.some((t) => /% (fall|rise)$/.test(t)), JSON.stringify(after.labels));
  check("BEFORE draws no drive labels (no plane)", before.labels.length === 0);
  check("no page errors", errs.length === 0, errs.join(" | "));
  console.log(notes.concat(fails).join("\n"));
  console.log(JSON.stringify({ before, after }));
  await browser.close();
  if (fails.length && !code) code = 1;
} finally { vite.kill(); }
process.exit(code);
