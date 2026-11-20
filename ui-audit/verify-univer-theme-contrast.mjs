/* Univer grid (owner-only spike, B2557488) — IS THE NEW GRID READABLE IN PLANYR'S LIGHT AND DARK THEMES? (NEW-2)
 *
 * The owner opened "Try the new grid" in the dark theme and saw: tool icons invisible, the Start/Formulas/Data/View strip a
 * bright pill, column letters and row numbers the colour of their strip, the formula bar and name box empty black boxes. The
 * grid is a CANVAS plus Univer's own DOM, and Univer repaints the canvas through its own dark-mode colour inversion, so no
 * stylesheet reads can say what lands on screen — this harness measures PIXELS.
 *
 * Method: for each region, take the SCREENSHOT, find the region's background (its most common colour) and the pixel furthest
 * from it, and report the WCAG contrast ratio between them ("ink contrast"). Four scenarios, because the theme can be wrong in
 * two different ways: mounted in light · mounted in dark · flipped light→dark WHILE OPEN · flipped dark→light WHILE OPEN (a theme
 * built once at mount passes the first two and fails the flips).
 * KNOWN-GOOD ARM: the bottom sheet tab ("Sheet1") — the owner saw it read fine on the broken build, so it must read in every
 * scenario; the run is VOID, not scored, if it does not (then the rig, not the theme, is what is wrong).
 * Run: node ui-audit/verify-univer-theme-contrast.mjs [--json out.json]   (starts the sandbox host itself; exit 1 on any FAIL, 2 when VOID) */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { scenario, setTheme } from "./lib/univerThemeContrast.mjs";

const PORT = 5198, BASE = `http://localhost:${PORT}`;
let server = null;

async function startSandbox() {
  const up = async () => { const r = await fetch(`${BASE}/ui-audit/univer-sandbox/index.html`).catch(() => null); return !!(r && r.ok); };
  if (await up()) return;
  server = spawn("npx", ["vite", "--config", "ui-audit/univer-sandbox/vite.config.mjs"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
  for (let i = 0; i < 60; i++) { if (await up()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("the Univer sandbox did not start");
}

async function main() {
  await startSandbox();
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const all = [];
  const plans = [
    { name: "mounted in light", start: "light", then: [] },
    { name: "mounted in dark", start: "dark", then: [] },
    { name: "light → dark while open", start: "light", then: ["dark"] },
    { name: "dark → light while open", start: "dark", then: ["light"] },
  ];
  for (const plan of plans) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 200)));
    await page.addInitScript((t) => { document.addEventListener("DOMContentLoaded", () => document.documentElement.setAttribute("data-theme", t)); }, plan.start);
    await page.goto(`${BASE}/ui-audit/univer-sandbox/index.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__sandboxLoad);
    await assertMeasurable(page, "verify-univer-theme-contrast");
    await page.waitForTimeout(800);
    for (const t of plan.then) await setTheme(page, t);
    all.push(await scenario(page, plan.name, plan.then));
    await ctx.close();
  }
  await browser.close();
  if (server) server.kill();

  let failed = 0, voided = false;
  for (const s of all) {
    console.log(`\n── ${s.name}  [data-theme=${s.colours.theme} univer-dark=${s.colours.univerDark}]  icon ${s.colours.toolbarIconColor} on ${s.colours.toolbarBg} · strip ${s.colours.stripBg} · surface ${s.colours.appSurface}`);
    for (const r of s.results) { console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}  — ${r.detail}`); if (!r.ok) { if (r.id === "known-good-arm") voided = true; else failed++; } }
  }
  const ji = process.argv.indexOf("--json"); if (ji >= 0) writeFileSync(process.argv[ji + 1], JSON.stringify(all, null, 1));
  if (voided) { console.log("\nVOID — the known-good arm (the bottom sheet tab, mounted fresh) did not read, so none of the numbers above can be trusted."); process.exit(2); }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { if (server) server.kill(); console.error(e); process.exit(1); });
