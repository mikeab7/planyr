/* measure-rename-delay — NEW-1 (B2671215, owner 2026-11-10): "I renamed it and it took a second for it to go into effect. When I hit enter,
 * it should immediately change the name when I rename a concept or project."
 *
 * Measures, in a real browser on the owner's real Quiddity plan shape (the `bain-quiddity` fixture, two plans in one project), how long
 * after the Enter keystroke each place a name is shown reads the NEW name:
 *
 *   plan-current   the current plan, double-click its row in the plan menu  → the breadcrumb + the menu's current row
 *   plan-other     another plan, its ⋯ ▸ Rename                             → its row in the list
 *   project        the project, header menu ▸ Rename                        → the project crumb + its row
 *
 * and, per run, whether the name is STILL the new one 1.5 s later in storage and on screen (a rename must not be undone by an autosave).
 *
 * Two numbers per display, never one: `atFrame` = was the new name already in the DOM at the first animation frame after Enter (the
 * "same frame" the owner asked for — a boolean, independent of machine speed), and `ms` = Enter → the DOM first showing it (capped at the
 * observation window; `never` if it did not arrive).
 *
 *   node ui-audit/measure-rename-delay.mjs [http://localhost:4173] [--runs 5] [--assert]
 *
 * `--assert` exits non-zero unless EVERY display was on the new name at the first frame, in every run, and no run reverted.
 * KNOWN-GOOD ARM: the run is VOID (not scored) unless a rename of the PROJECT (which always reached the screen at once) reads on its
 * display in every run — a probe that cannot see a name appear would otherwise report "never" for everything and look like a finding.
 *
 * BEFORE / AFTER, measured 2026-11-10 (this build's fix: `saveSite` announcing a plan's own `name`, and an autosave never moving it; local dev
 * server, 5 runs each, 3 s window, the bain-quiddity two-plan project):
 *   BEFORE  plan-current  crumb NEVER and current row NEVER within 3 s in 5 of 5 runs (the name was in storage at once; the screen kept the
 *                         old one until something unrelated re-rendered the planner — 9 s and counting in a longer watch); in separate
 *                         8-run watches the rename was also undone by the planner's autosave in 2-3 of 8 runs
 *           plan-other    list row ≈ 21 ms (median) — already fine       project  ≈ 3 ms — already fine
 *   AFTER   plan-current  crumb 18 ms / current row 18 ms median (worst 23), atFrame true 5/5, 0 undone
 *           plan-other    22 ms (worst 27)                                project   3 ms (worst 11)
 */
import { chromium } from "@playwright/test";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSite } from "./lib/planFixture.mjs";

const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "http://localhost:4173").replace(/\/$/, "");
const RUNS = Number((process.argv.find((a, i) => process.argv[i - 1] === "--runs")) || 5);
const ASSERT = process.argv.includes("--assert");
const WINDOW_MS = 3000;
const EXEC = process.env.PW_CHROME || undefined;

const fx = readFixture("bain-quiddity");
const planA = fixtureSite(fx, { id: "qa1", name: "Concept A - Quiddity", site: "Bain" });
const planB = { ...fixtureSite(fx, { id: "qb2", name: "Concept B - Quiddity DIA", site: "Bain" }), groupId: "qa1" };
const SEED = `localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ qa1: planA, qb2: planB }))}); localStorage.setItem('planarfit:currentSite:v1','qa1');`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/* In-page probe: Enter (capture phase) starts the clock; the first animation frame snapshots every display; a MutationObserver notes the
 * first moment each display reads the new name. `want` maps a display key → [selector, mustNotContainInput]. */
const installProbe = (page, newName, displays) => page.evaluate(([NEW, displays]) => {
  window.__r = { t0: null, frame: null, first: {} };
  const read = () => {
    const out = {};
    for (const [k, sel] of Object.entries(displays)) {
      const el = document.querySelector(sel);
      out[k] = !!(el && el.textContent.includes(NEW) && !el.querySelector("input"));
    }
    return out;
  };
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || window.__r.t0 != null) return;
    window.__r.t0 = performance.now();
    requestAnimationFrame(() => { window.__r.frame = read(); });
  }, true);
  new MutationObserver(() => {
    if (window.__r.t0 == null) return;
    const now = performance.now(); const r = read();
    for (const k of Object.keys(r)) if (r[k] && window.__r.first[k] == null) window.__r.first[k] = now - window.__r.t0;
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
}, [newName, displays]);

const storedNames = (page) => page.evaluate(() => {
  const m = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return Object.fromEntries(Object.values(m).map((s) => [s.id, { name: s.name, site: s.site }]));
});

const CASES = {
  "plan-current": {
    newName: "Renamed One",
    displays: { crumb: '[data-testid="plan-crumb"]', currentRow: '[data-testid="plan-current-row"]' },
    drive: async (page) => {
      await page.getByTestId("plan-crumb").click();
      return async (name) => { await page.getByTestId("plan-current-name").dblclick(); const i = page.getByTestId("plan-rename-input"); await i.fill(name); await i.press("Enter"); };
    },
    stays: (s, n) => s.qa1.name === n,
  },
  "plan-other": {
    newName: "Alt layout",
    displays: { listRow: '[data-testid="plan-open-qb2"]' },
    drive: async (page) => {
      await page.getByTestId("plan-crumb").click();
      return async (name) => { await page.getByTestId("plan-more-qb2").click(); await page.getByTestId("plan-ctx-rename").click(); const i = page.getByTestId("plan-rename-input"); await i.fill(name); await i.press("Enter"); };
    },
    stays: (s, n) => s.qb2.name === n,
  },
  project: {
    newName: "Bain Renamed",
    displays: { projectCrumb: '[data-testid="project-crumb-name"]' },
    drive: async (page) => {
      await page.getByTestId("project-crumb").click();
      return async (name) => {
        await page.getByTestId("project-kebab-qa1").click();
        await page.getByTestId("project-rename").click();
        const i = page.locator('[data-testid^="project-row-"] input').first();
        await i.fill(name); await i.press("Enter");
      };
    },
    stays: (s, n) => s.qa1.site === n,
  },
};

const median = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const report = {};
let void_ = false;

try {
  for (const [label, c] of Object.entries(CASES)) {
    const runs = [];
    for (let r = 0; r < RUNS; r++) {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const page = await ctx.newPage();
      await page.addInitScript(() => { window.__PLANYR_E2E = true; });
      await page.addInitScript(SEED);
      await page.goto(`${BASE}/#/project/qa1/site`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("planner-canvas").waitFor({ timeout: 60_000 });
      await assertMeasurable(page, "measure-rename-delay");
      await page.waitForTimeout(1200);
      const go = await c.drive(page);
      await installProbe(page, c.newName, c.displays);
      await go(c.newName);
      await page.waitForTimeout(WINDOW_MS);
      const got = await page.evaluate(() => window.__r);
      const st = await storedNames(page);
      const screenStill = await page.evaluate(([NEW, displays]) => Object.entries(displays).every(([, sel]) => { const el = document.querySelector(sel); return !!el && el.textContent.includes(NEW); }), [c.newName, c.displays]).catch(() => false);
      runs.push({
        atFrame: Object.keys(c.displays).every((k) => got.frame && got.frame[k] === true),
        ms: Object.fromEntries(Object.keys(c.displays).map((k) => [k, got.first[k] == null ? "never" : Math.round(got.first[k])])),
        reverted: !c.stays(st, c.newName) || !screenStill,
      });
      await ctx.close();
    }
    report[label] = {
      runs: RUNS,
      atFrameEveryRun: runs.every((x) => x.atFrame),
      msMedian: Object.fromEntries(Object.keys(c.displays).map((k) => [k, median(runs.map((x) => (x.ms[k] === "never" ? null : x.ms[k])))])),
      msWorst: Object.fromEntries(Object.keys(c.displays).map((k) => [k, runs.some((x) => x.ms[k] === "never") ? "never" : Math.max(...runs.map((x) => x.ms[k]))])),
      revertedRuns: runs.filter((x) => x.reverted).length,
    };
    console.log(label.padEnd(13), JSON.stringify(report[label]));
  }
  // KNOWN-GOOD ARM: the project rename always reached its display at once — if even that reads "never", the probe is blind, not the app.
  const arm = report.project;
  if (!arm || Object.values(arm.msWorst).some((v) => v === "never")) { void_ = true; console.log("VOID — the known-good arm (project rename) never read its new name: the probe cannot see a name appear; nothing above is scored."); }
} finally {
  await browser.close();
}

const bad = Object.entries(report).filter(([, r]) => !r.atFrameEveryRun || r.revertedRuns > 0);
if (void_) process.exit(2);
console.log(bad.length ? `\nNOT instant: ${bad.map(([k]) => k).join(", ")}` : "\nEvery display read the new name on the first frame after Enter, in every run, and no rename was undone.");
if (ASSERT && bad.length) process.exit(1);
