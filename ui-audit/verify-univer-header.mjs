/* verify-univer-header — the Univer grid's header is ONE flat, left-aligned strip, and undo / redo are curved arrows
 * (NEW-1 B2574352 + NEW-2 B2574353; docs/SPREADSHEET-UNIVER-SPIKE.md "Look"). Owner, 2026-10-30: "make everything left aligned up at
 * the top … collapse [the second header] into a dropdown that's left aligned … it drops down to one", and "fix the undo buttons,
 * because right now they're angular and they should be curvilinear".
 *
 * Per theme (light AND dark):
 *   1 one-row        ONE row of controls above the formula bar, no tab band, header no taller than a single tool row
 *   2 dropdown-left  the Start ▾ tab dropdown is the strip's leftmost control, at the grid's left edge
 *   3 tools-left     the first tool is left of the strip's midpoint, packed beside the dropdown (no centring)
 *   4 flat           nothing in the strip has a border radius or a box shadow (computed style of every visible node)
 *   5 curved icons   undo + redo are the arc glyphs, same size and colour as the neighbouring icons, disabled AND enabled
 *   6 switching      choosing Formulas in the dropdown swaps the tools in the SAME strip; Start brings them back
 *   7 narrow         at a narrow window the strip stays one row and keeps Univer's "⋮" overflow
 * KNOWN-GOOD / TEETH ARM: the ribbon is flipped to Univer's own two-strip "classic" layout in the same page and the SAME judge must
 * go RED on one-row, dropdown-left and flat — a verdict that cannot see the old shape proves nothing about the new one. (Run
 * against `origin/main` it is RED throughout: no dropdown, two rows, a rounded pill, Univer's default glyphs.)
 *
 * Where it runs:
 *   default         the standalone host (ui-audit/univer-sandbox) — the real <UniverSheet>, no sign-in needed
 *   --live <base>   the real app signed in as the test account (E2E_LOGIN_KEY), is_admin answered `true` for THIS browser only (a
 *                   visibility switch, not a security boundary), on a throwaway project that is deleted and re-read as gone
 * Usage: node ui-audit/verify-univer-header.mjs [--live https://planyr.io] [--shots dir] [--json out.json] */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { measureHeaderInPage, judgeHeader } from "./lib/univerHeader.mjs";

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const LIVE = val("--live");
const SHOTS = val("--shots");
const JSON_OUT = val("--json");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PORT = 5198, SANDBOX = `http://localhost:${PORT}`;
let failures = 0, voided = false, server, page, browser, signed = null;
const report = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); report.push({ name, ok: !!cond, extra }); if (!cond) failures++; };

async function startSandbox() {
  const up = async () => { const r = await fetch(`${SANDBOX}/ui-audit/univer-sandbox/index.html`).catch(() => null); return !!(r && r.ok); };
  if (await up()) return;
  server = spawn("npx", ["vite", "--config", "ui-audit/univer-sandbox/vite.config.mjs"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
  for (let i = 0; i < 80; i++) { if (await up()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("the Univer sandbox did not start");
}
const launch = () => chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const api = (body) => page.evaluate(`(() => { const api = window.__planyrUniverRead.api(); return (${body.toString()})(api); })()`);
const measure = () => page.evaluate(measureHeaderInPage);
const settle = (ms = 700) => page.waitForTimeout(ms);

/** put the page in a theme, ready to be measured. Sandbox: flip the attribute the app's ThemeProvider writes (the grid follows it).
 *  Live: the app's own storage key + a reload, exactly as verify-univer-theme-live does. */
async function inTheme(theme) {
  if (LIVE) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), ["planyr.theme", theme]);
    await openLive();
  } else {
    await page.goto(`${SANDBOX}/ui-audit/univer-sandbox/index.html`, { waitUntil: "networkidle" });     // a fresh grid per theme: no edit history carried over
    await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__sandboxLoad);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await settle(1800);
  }
  const t = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (t !== theme) { voided = true; throw new Error(`VOID — wanted data-theme=${theme}, the page is on ${t}`); }
}

async function scenarios(theme) {
  console.log(`\n══ ${theme.toUpperCase()} ═══════════════════════════════════════════════`);
  await inTheme(theme);
  await assertMeasurable(page, "verify-univer-header");
  const build = LIVE ? (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})))).build : "sandbox";
  const m = await measure();
  console.log(`${LIVE ? "served build " + build + " · " : ""}header ${m.header ? m.header.height.toFixed(0) : "?"} px tall, ${m.rows} row(s), dropdown "${m.dropdown ? m.dropdown.text : "none"}"`);

  // KNOWN-GOOD ARM 0: undo / redo / the painter all start DISABLED on a fresh grid, so the disabled-colour comparison is like for like.
  ok(`[${theme}] KNOWN-GOOD ARM: undo, redo and the neighbouring tool all start disabled (a fresh grid, no edits)`, !!(m.undo && m.redo && m.neighbour) && m.undo.disabled && m.redo.disabled && m.neighbour.disabled, JSON.stringify([m.undo && m.undo.disabled, m.redo && m.redo.disabled, m.neighbour && m.neighbour.disabled]));
  // KNOWN-GOOD ARM 1: the measurement must have found a real strip full of controls.
  ok(`[${theme}] KNOWN-GOOD ARM: the header was found and holds a real strip of controls`, m.found && m.interactiveCount >= 15 && m.header.width > 400, `${m.interactiveCount} controls, ${m.found ? m.header.width.toFixed(0) : 0} px wide`);
  if (!m.found || m.interactiveCount < 15) { voided = true; throw new Error("VOID — no header to judge"); }

  // 1-5 — the current state, judged by the pure rules.
  for (const r of judgeHeader(m)) ok(`[${theme}] ${r.label}`, r.ok, r.detail);

  // KNOWN-GOOD ARM for the registered-tools rule: at this width the indent buttons are visible, so the rule is judged on something real.
  ok(`[${theme}] KNOWN-GOOD ARM: the indent buttons another session registers are visible in the strip at full width`, m.registered.every((r) => r.shown), JSON.stringify(m.registered.map((r) => [r.cmd.split(".").pop(), r.shown])));
  // 5b — enabled state: one edit makes undo clickable; it must wear the same ink as the other enabled tools.
  await api((a) => { a.getActiveWorkbook().getActiveSheet().getRange(0, 0).setValue("x"); });
  await settle(500);
  const m2 = await measure();
  const enabled = judgeHeader({ ...m2, enabledUndo: m2.undo }).find((r) => r.id === "icon-enabled-colour");
  ok(`[${theme}] ${enabled ? enabled.label : "enabled undo colour"}`, !!enabled && enabled.ok, enabled ? enabled.detail : "no enabled icon measured");

  // 6 — the dropdown really drives the strip.
  const sigStart = m2.toolSig;
  ok(`[${theme}] Start tab holds the full tool set (${m2.toolCount} tools)`, m2.toolCount >= 15, m2.toolSig.split("|").slice(0, 6).join(", ") + " …");
  await page.click('[data-u-comp="headerbar"] a[data-state]');
  await settle(450);
  await page.getByText("Formulas", { exact: true }).first().click();
  await settle(700);
  const mf = await measure();
  ok(`[${theme}] choosing Formulas swaps the tools in the same strip (label "${mf.dropdown && mf.dropdown.text}", still ${mf.rows} row)`,
    !!mf.dropdown && /^Formulas/.test(mf.dropdown.text) && mf.rows === 1 && mf.toolSig !== sigStart && Math.abs(mf.header.height - m2.header.height) < 1.5,
    `tools ${mf.toolCount} (was ${m2.toolCount}); header ${mf.header.height.toFixed(0)} px`);
  const fj = judgeHeader(mf).filter((r) => ["one-row", "dropdown-left", "tools-left", "flat"].includes(r.id));
  ok(`[${theme}] …and the Formulas tab keeps the same single, left-aligned, flat strip`, fj.every((r) => r.ok), fj.filter((r) => !r.ok).map((r) => r.id + ": " + r.detail).join(" | ") || "one-row, dropdown-left, tools-left, flat");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${LIVE ? "live" : "sandbox"}-${theme}-formulas.png`, clip: { x: 0, y: 0, width: m.host.width, height: 230 } });
  await page.click('[data-u-comp="headerbar"] a[data-state]'); await settle(450);
  await page.getByText("Start", { exact: true }).first().click(); await settle(700);
  const mb = await measure();
  ok(`[${theme}] choosing Start brings the original tools back`, !!mb.dropdown && /^Start/.test(mb.dropdown.text) && mb.toolSig === sigStart, `label "${mb.dropdown && mb.dropdown.text}"`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${LIVE ? "live" : "sandbox"}-${theme}-start.png`, clip: { x: 0, y: 0, width: m.host.width, height: 230 } });

  // 7 — narrow window: still one row, overflow kept.
  const vp = page.viewportSize();
  await page.setViewportSize({ width: 760, height: vp.height }); await settle(900);
  const mn = await measure();
  const nj = judgeHeader(mn).filter((r) => ["one-row", "dropdown-left", "flat"].includes(r.id));
  ok(`[${theme}] narrow window: still one flat row with the dropdown at the left, and Univer's ⋮ overflow is kept`, nj.every((r) => r.ok) && mn.overflow, `header ${mn.header.height.toFixed(0)} px, ${mn.rows} row(s), overflow ${mn.overflow}${nj.filter((r) => !r.ok).map((r) => " · " + r.id + ": " + r.detail).join("")}`);
  await page.setViewportSize(vp); await settle(700);

  // TEETH ARMS — same page, same judge, deliberately wrong states: each must go RED where it should.
  if (theme === "light") {
    await api((a) => a.setRibbonType("classic")); await settle(900);
    const mc = await measure();
    const cj = judgeHeader(mc);
    ok("TEETH: Univer's default two-strip ribbon is judged RED on one-row and dropdown-left (the judge can see the old shape)",
      ["one-row", "dropdown-left"].every((id) => cj.find((r) => r.id === id && !r.ok)), `classic: ${mc.rows} row(s), header ${mc.header.height.toFixed(0)} px, tab band ${mc.tabBandHeight.toFixed(0)} px; red: ${cj.filter((r) => !r.ok).map((r) => r.id).join(", ")}`);
    console.log(`MEASURE header height — one strip (collapsed): ${m.header.height.toFixed(0)} px · Univer's two-strip header (classic): ${mc.header.height.toFixed(0)} px`);
    report.push({ heights: { collapsed: m.header.height, classic: mc.header.height } });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${LIVE ? "live" : "sandbox"}-classic-before.png`, clip: { x: 0, y: 0, width: m.host.width, height: 230 } });
    await api((a) => a.setRibbonType("collapsed")); await settle(900);
    // a pill + a shadow forced onto the tab dropdown (inline !important beats the stylesheet's) must be caught by the flat rule
    await page.evaluate(() => { const a = document.querySelector('[data-u-comp="headerbar"] a[data-state]'); a.style.setProperty("border-radius", "9999px", "important"); a.style.setProperty("box-shadow", "0 2px 6px #000", "important"); });
    const mp = await measure();
    const pj = judgeHeader(mp).find((r) => r.id === "flat");
    ok("TEETH: a rounded, shadowed dropdown is judged RED by the flat rule", !!pj && !pj.ok, pj ? pj.detail : "no verdict");
    await page.evaluate(() => { const a = document.querySelector('[data-u-comp="headerbar"] a[data-state]'); a.style.removeProperty("border-radius"); a.style.removeProperty("box-shadow"); });
    // the old Univer glyph (a filled path, no arc) must be judged RED by the curved rule
    const old = judgeHeader({ ...m, undo: { ...m.undo, marker: "", paths: ["M4.72365 2.72206C4.975 2.9 4 3 4 4Z"], filledPath: true, stroke: "" } }).find((r) => r.id === "undo-curved");
    ok("TEETH: Univer's old filled, arc-less undo glyph is judged RED by the curved rule", !!old && !old.ok, old ? old.detail : "no verdict");
  }
}

async function openLive() {
  const base = LIVE;
  await page.goto(`${base}/?cb=${Date.now()}#/project/${signed.PROJECT}/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="model-root"]', { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 90000 });
  await page.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); return !!(a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet()); }, null, { timeout: 90000, polling: 25 });
  await page.waitForTimeout(1500);
}

async function main() {
  const themes = ["light", "dark"];
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    const { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } = await import("./lib/liveFixtures.mjs");
    const s = await openSignedIn({ base: LIVE });
    page = s.page;
    const PROJECT = `${LIVE_PREFIX}univer-header-${Date.now().toString(36)}`;
    signed = { PROJECT };
    try {
      await page.addInitScript(() => { window.__PLANYR_E2E = true; });
      let hits = 0;
      await page.route("**/rest/v1/rpc/is_admin*", (route) => { hits++; route.fulfill({ status: 200, contentType: "application/json", body: "true" }); });
      await seedThrowawayPlan(page, PROJECT);
      await page.evaluate(() => localStorage.setItem("planyr:model:univerGrid", "1"));
      await openLive();
      ok("KNOWN-GOOD ARM: the is_admin intercept was hit and the Univer grid is on", hits > 0 && (await page.locator('[data-testid="univer-grid"]').count()) === 1, `${hits} hit(s)`);
      if (!hits) { voided = true; throw new Error("VOID — the intercept never fired"); }
      for (const t of themes) await scenarios(t);
    } catch (e) { console.log("ABORT:", String(e.message).split("\n")[0]); failures++; }
    finally {
      try {
        await page.evaluate(() => { localStorage.removeItem("planyr:model:univerGrid"); localStorage.removeItem("planyr.theme"); }).catch(() => {});
        const out = await page.evaluate(async (id) => { const c = window.pfSupabase; await c.from("model_sheets").delete().eq("id", id); return ((await c.from("model_sheets").select("id").eq("id", id)).data || []).length; }, PROJECT);
        const gone = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)] }));
        ok("CLEANUP: the throwaway workbook row and plan are gone (re-read from the database)", out === 0 && !(gone.errors || []).length && gone.left?.site === 0, `model_sheets rows left ${out}; ${JSON.stringify(gone)}`);
      } catch (e) { ok("CLEANUP", false, String(e.message).split("\n")[0]); }
      await s.close();
    }
  } else {
    await startSandbox();
    browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 800 } });
    page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 200)));
    await page.goto(`${SANDBOX}/ui-audit/univer-sandbox/index.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__sandboxLoad);
    await settle(1500);
    try { for (const t of themes) await scenarios(t); }
    catch (e) { console.log("ABORT:", String(e.message).split("\n")[0]); failures++; }
    await browser.close();
    if (server) server.kill();
  }
  console.log(`\n${voided ? "VOID" : failures ? "FAILED" : "PASSED"} — ${failures} failure(s)`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), live: LIVE, failures, voided, report }, null, 2));
  process.exit(voided ? 2 : failures ? 1 : 0);
}
main().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
