/* verify-grading-header-centred — ROUND 10 (NEW-4, owner 2026-10-30: "the settings icon at the top right of the menu looks like it's
 * not even centered within the little icon"). The Grading panel header's gear button drew a ⚙ TEXT glyph, which sits high and left of
 * its em box. This renders the real header (the harness mounts GradingPanel's GradingHeaderActions into the panel chrome slot) at 2×
 * device pixels, saves a PNG, and asserts for EACH button in the header (the info ⓘ and the gear) that the centre of its INK is within
 * 0.75 CSS px of the centre of its own box in both axes. KNOWN-BAD ARM (the instrument must be able to see an off-centre glyph, or the
 * run is VOID): the same button with its glyph nudged 2 CSS px. NOTE: the ⚙ TEXT glyph's off-centre drawing depends on the platform
 * font (the owner's machine); this sandbox's font draws it centred, so the original defect cannot be reproduced HERE — the fix is
 * structural (a drawn icon is centred by construction in every font), and the live check on his machine is V-tracked.
 *   node ui-audit/verify-grading-header-centred.mjs   (starts its own vite dev server on :5197) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5197, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fails = [], notes = [];
const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1760, height: 1040 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ui-audit/harness/grading-harness.html?buildable=0&contours=1&zoom=site&mode=boundary&owner=2`);
  await assertMeasurable(page, "verify-grading-header-centred");
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForSelector('[data-grading-header-actions] [data-grading-gear]', { timeout: 120000 });
  await page.waitForTimeout(600);
  const header = page.locator("#panel-header");
  await header.screenshot({ path: `${OUT}grading-header-2x.png` });
  notes.push(`  · wrote ${OUT}grading-header-2x.png`);
  /* the ink of a button: render the page region as pixels and find the bbox of pixels that differ from the button's own background */
  const measure = async (sel) => {
    const box = await page.locator(sel).first().boundingBox();
    const buf = await page.screenshot({ clip: { x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 4 } });
    return page.evaluate(async ([b64, bw, bh]) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, s = c.width / (bw + 4);
      // the box's own colour = the pixel just inside its inner corner; ink = pixels well away from it, inside the inner box (2 CSS px in from the border)
      const px = (x, y) => { const k = (y * c.width + x) * 4; return [d[k], d[k + 1], d[k + 2]]; };
      const inset = Math.round(6 * s), bgc = px(Math.round(8 * s), Math.round(8 * s));   // 4 CSS px inside the box: clear of the border and the rounded corners
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = inset; y < c.height - inset; y++) for (let x = inset; x < c.width - inset; x++) { const p = px(x, y); if (Math.abs(p[0] - bgc[0]) + Math.abs(p[1] - bgc[1]) + Math.abs(p[2] - bgc[2]) > 90) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) return null;
      return { cx: (x0 + x1 + 1) / 2 / s - 2, cy: (y0 + y1 + 1) / 2 / s - 2, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
    }, [buf.toString("base64"), box.width, box.height]).then((ink) => ink && { dx: ink.cx - box.width / 2, dy: ink.cy - box.height / 2, w: ink.w, h: ink.h, box });
  };
  const gear = await measure('[data-grading-gear]');
  const info = await measure('[data-grading-header-actions] button[aria-label^="About"]');
  const row = (name, m) => `${name}: ink ${m.w.toFixed(1)}×${m.h.toFixed(1)} px, off-centre dx ${m.dx.toFixed(2)} dy ${m.dy.toFixed(2)}`;
  if (!gear || !info) fails.push("✗ VOID — could not read the ink of the gear / info buttons");
  else {
    notes.push("  · " + row("gear", gear)); notes.push("  · " + row("info", info));
    const TOL = 0.75;
    for (const [name, m] of [["gear", gear], ["info", info]]) {
      const ok = Math.abs(m.dx) <= TOL && Math.abs(m.dy) <= TOL;
      (ok ? notes : fails).push(`${ok ? "✓" : "✗"} the ${name} glyph is centred in its button (|dx|,|dy| ≤ ${TOL} px)`);
    }
  }
  // known-bad arm: the same square with its glyph nudged 2 CSS px must read off-centre, or this instrument cannot see the defect
  await page.evaluate(() => {
    const b = document.createElement("button"); b.setAttribute("data-bad-gear", "1");
    b.style.cssText = "position:fixed;left:40px;top:40px;width:24px;height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid #999;background:#fff;color:#000;font-size:14px";
    b.innerHTML = '<span style="transform:translate(2px,2px);display:block">●</span>'; document.body.appendChild(b);
  });
  const badM = await measure('[data-bad-gear]');
  if (!badM) fails.push("✗ VOID — the known-bad arm could not be read");
  else {
    notes.push("  · " + row("nudged glyph (known-bad arm)", badM));
    if (!(Math.abs(badM.dx) > 1.5 && Math.abs(badM.dy) > 1.5)) fails.push("✗ VOID — the instrument reads a glyph nudged 2 px as centred, so it cannot see the defect");
  }
  await browser.close();
} finally { vite.kill(); }
for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log("\nOK");
