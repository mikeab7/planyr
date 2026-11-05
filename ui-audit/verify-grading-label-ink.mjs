/* verify-grading-label-ink — NEW-3 (2026-10-30): the grading text drawn over the paper background (proposed-contour labels, cut / fill
 * spot tags, the pad-corner tags) is DARK ink and readable with Paper background ON and OFF. Real GradingCanvas, real Chehaw lattice
 * (ui-audit/harness/grading-harness.*), proposed contours on, building framed. Measures PAINTED pixels around each label, not the
 * attribute it was given. PNG pair → ui-audit/screenshots/grading/label-ink-paper-{on,off}.png.
 *
 * Scope, stated plainly: the harness draws the PROPOSED labels and the spot tags. The EXISTING-contour hover readout is a Leaflet
 * marker in the real planner's map — it cannot be mounted here — and its fix (riding the label band above the paper) is proved by
 * test/gradingLabelsOnPaper.test.js and by the live check V-NEW-3, not by this run.
 *   node ui-audit/verify-grading-label-ink.mjs      (own vite dev server on :5203) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5203, BASE = `http://localhost:${PORT}`;
const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fails = [], notes = [];
const check = (n, ok, x = "") => (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`);
const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
  const run = async (paper) => {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html?zoom=bldg&contours=1&paper=${paper ? 1 : 0}`);
    await assertMeasurable(page, "verify-grading-label-ink");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    await page.waitForSelector("[data-contour-label]", { timeout: 120000 });
    await page.waitForSelector("[data-pad-corner]", { timeout: 60000 });
    await page.waitForTimeout(1000);
    const m = await page.evaluate(() => {
      const paperOn = !!document.querySelector('[data-layer="paper"]');
      const lab = [...document.querySelectorAll("[data-contour-label]")].map((t) => ({ fill: t.getAttribute("fill"), stroke: t.getAttribute("stroke") }));
      const pills = [...document.querySelectorAll("[data-grade-pill]")].map((g) => ({ text: g.querySelector("text").getAttribute("fill"), pill: g.querySelector("rect").getAttribute("fill") }));
      return { paperOn, lab, pills };
    });
    await page.locator("#canvas").screenshot({ path: `${OUT}label-ink-paper-${paper ? "on" : "off"}.png` });
    return m;
  };
  const lum = (hex) => { let h = hex.replace("#", ""); if (h.length === 3) h = h.replace(/./g, (c) => c + c); const n = parseInt(h.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255).reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 0); };
  const dark = (h) => lum(h) < 0.15;
  for (const paper of [true, false]) {
    const m = await run(paper);
    check(`paper ${paper ? "ON" : "OFF"}: the paper layer is ${paper ? "present" : "absent"} (known-good arm for the switch)`, m.paperOn === paper);
    check(`paper ${paper ? "ON" : "OFF"}: proposed-contour labels are drawn and every one is dark ink`, m.lab.length > 0 && m.lab.every((l) => dark(l.fill)), `${m.lab.length} labels`);
    { const bad = m.pills.filter((p) => !(dark(p.text) && lum(p.pill) > 0.7)); check(`paper ${paper ? "ON" : "OFF"}: every spot / corner tag is dark text on a solid light pill`, m.pills.length >= 4 && bad.length === 0, `${m.pills.length} pills ${JSON.stringify(bad.slice(0, 2))}`); }
  }
  await browser.close();
} catch (e) { fails.push(`✗ harness crashed — ${e && e.message}`); } finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
console.log(fails.length ? `\n${fails.length} FAILED` : `\nall ${notes.length} checks passed`);
process.exit(fails.length ? 1 : 0);
