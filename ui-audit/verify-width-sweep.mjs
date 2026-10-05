/* verify-width-sweep.mjs — NEW-3: the app-shell WIDTH SWEEP. A required CI gate.
 *
 * For every module route, at widths 800 · 960 · 1024 · 1280 · 1440 · 1920 · 2560, each at heights 450
 * and 900 (+ one pass at deviceScaleFactor 2), asserts — from DOM GEOMETRY, never a screenshot diff —
 *   · no page-level scroll in either direction (documentElement AND body);
 *   · every interactive control in the shell chrome sits fully inside the viewport and is not cut by a
 *     clipping ancestor;
 *   · no two chrome controls' boxes intersect;
 *   · each header row / toolbar is exactly one row tall;
 *   · every shared toolbar's More menu, when present, opens (and closes on Escape with focus handed
 *     back to its trigger) and lists every item the bar dropped — nothing is simply gone.
 * Verdict lives in `lib/widthSweep.mjs` (pure, unit-tested by `test/widthSweep.test.js`).
 *
 * WHY IT EXISTS: 2026-10-05 the owner's Schedule header wrapped its action buttons onto a second line
 * at a laptop window, clipped the status column at the right edge and showed a page scrollbar — found
 * by him, on his screen, because CI only ever looked at one width. Browser zoom and OS display scaling
 * SHRINK the CSS viewport, so "big monitor" never meant "wide viewport"; this sweeps the viewport.
 *
 * SIGNED IN vs OUT. Against a deploy (BASE_URL not localhost) with E2E_LOGIN_KEY set it signs in as the
 * test account via the one shared helper (`lib/signedInSession.mjs`) and opens the fixture project, so
 * the real per-module toolbars render. Against the CI preview server (localhost) it runs signed out —
 * hermetic, no secrets — and the module routes render whatever a signed-out visitor gets; Schedule's
 * Grid/Split/Gantt chrome still renders there, which is the surface the owner's screenshot was of.
 *
 * Run:  npm run build && npx vite preview --port 4173 --strictPort &   (then)
 *       node ui-audit/verify-width-sweep.mjs [--routes=schedule,notes] [--widths=800,960] [--heights=450]
 *                                            [--no-dsf2] [--shots=dir]
 *       BASE_URL=https://planyr.io node ui-audit/verify-width-sweep.mjs     (signed in; needs E2E_LOGIN_KEY)
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { collectSnapshot, auditSnapshot, auditMenu } from "./lib/widthSweep.mjs";

const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const flag = (name) => process.argv.includes(`--${name}`);

export const WIDTHS = [800, 960, 1024, 1280, 1440, 1920, 2560];
export const HEIGHTS = [450, 900];
const PROJECT = process.env.SWEEP_PROJECT || "e2e-fixture-site";
/* Every module route. `ready` is a selector that proves the chrome this route is about has mounted —
 * a route that never gets there FAILS LOUDLY rather than being measured half-rendered. */
export const ROUTES = [
  { id: "dashboard", hash: "#/dashboard", ready: "header" },
  { id: "site", hash: `#/project/${PROJECT}/site`, ready: "header" },
  { id: "schedule", hash: `#/project/${PROJECT}/schedule`, ready: 'header [aria-label="View"], header [title="Settings"]' },
  { id: "schedule-reports", hash: "#/schedule", ready: 'header [title="Settings"]' },
  { id: "review", hash: `#/project/${PROJECT}/markup`, ready: "header" },
  { id: "library", hash: `#/project/${PROJECT}/library`, ready: "header" },
  { id: "notes", hash: `#/project/${PROJECT}/notes`, ready: "header" },
  { id: "spreadsheet", hash: `#/project/${PROJECT}/spreadsheet`, ready: "header" },
  { id: "food", hash: "#/food", ready: "header" },
];

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/+$/, "");
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const wantSignedIn = !isLocal && !!process.env.E2E_LOGIN_KEY;

const routes = (arg("routes") ? arg("routes").split(",") : null);
const widths = arg("widths") ? arg("widths").split(",").map(Number) : WIDTHS;
const heights = arg("heights") ? arg("heights").split(",").map(Number) : HEIGHTS;
const shotsDir = arg("shots");
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

async function newContexts() {
  if (wantSignedIn) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    const s1 = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 } });
    const s2 = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 }, contextOptions: { deviceScaleFactor: 2 } });
    return { build: s1.build, proof: s1.proof, normal: s1, dsf2: s2, close: async () => { await s1.close(); await s2.close(); } };
  }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] }); // never an ignore-cert flag
  const mk = async (dsf) => { const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dsf }); return { context, page: await context.newPage() }; };
  return { build: null, proof: null, normal: await mk(1), dsf2: await mk(2), close: () => browser.close() };
}

async function settle(page) {
  await pacedWait(page, 350);
  // two frames: let the layout effects + ResizeObserver cascade of a width change finish
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await pacedWait(page, 150);
}

async function gotoRoute(page, route) {
  await page.goto(`${BASE}/${route.hash}`, { waitUntil: "load" });
  if (page.url().indexOf(route.hash) < 0) await page.evaluate((h) => { location.hash = h; }, route.hash);
  const ok = await page.waitForSelector(route.ready, { state: "attached", timeout: 30000 }).then(() => true, () => false);
  await pacedWait(page, 1500);
  return ok;
}

/** Open each shared toolbar's More menu, list its items, close with Escape, confirm focus came back. */
async function checkMenus(page, snap) {
  const out = [];
  for (const t of snap.toolbars) {
    if (!t.menuIds.length) continue;
    const more = page.locator(`[data-priority-toolbar="${t.name}"] [data-toolbar-more]`).first();
    if (!(await more.count())) { out.push({ kind: "no-more-button", detail: `toolbar "${t.name}" has overflow ids but no More button` }); continue; }
    await more.click();
    await pacedWait(page, 120);
    const ids = await page.evaluate(() => [...document.querySelectorAll('[data-toolbar-menu] [data-menu-item-id]')].map((e) => e.getAttribute("data-menu-item-id")));
    out.push(...auditMenu(t, ids));
    await page.keyboard.press("Escape");
    await pacedWait(page, 120);
    const refocused = await page.evaluate((name) => {
      const m = document.querySelector(`[data-priority-toolbar="${name}"] [data-toolbar-more]`);
      return !!m && document.activeElement === m;
    }, t.name);
    const stillOpen = await page.evaluate(() => !!document.querySelector("[data-toolbar-menu]"));
    if (stillOpen) out.push({ kind: "menu-stuck-open", detail: `toolbar "${t.name}": Escape did not close the More menu` });
    else if (!refocused) out.push({ kind: "menu-focus-lost", detail: `toolbar "${t.name}": focus did not return to the More button after Escape` });
  }
  return out;
}

async function sweepRoute({ page }, route, heightsToRun, pass, results) {
  const ready = await gotoRoute(page, route);
  if (!ready) results.push({ route: route.id, w: 0, h: 0, pass, violations: [{ kind: "route-not-ready", detail: `selector ${route.ready} never appeared — measuring a half-rendered route would be vacuous` }] });
  for (const h of heightsToRun) {
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: h });
      await settle(page);
      await assertMeasurable(page, `verify-width-sweep ${route.id} ${w}x${h}`, { raf: false });
      const snap = await page.evaluate(collectSnapshot);
      const violations = auditSnapshot(snap);
      violations.push(...(await checkMenus(page, snap)));
      // a probe that opened a menu must leave the page as it found it
      await page.keyboard.press("Escape").catch(() => {});
      if (shotsDir && pass === "dsf1") await page.screenshot({ path: `${shotsDir}/${route.id}-${w}x${h}.png` });
      results.push({ route: route.id, w, h, pass, violations, controls: snap.controls.length, toolbars: snap.toolbars.map((t) => `${t.name}:${t.barIds.length}bar+${t.menuIds.length}menu`) });
    }
  }
}

const sel = ROUTES.filter((r) => !routes || routes.includes(r.id));
const ctxs = await newContexts();
const results = [];
try {
  await assertMeasurable(ctxs.normal.page, "verify-width-sweep");
  console.log(`verify-width-sweep · base ${BASE} · ${wantSignedIn ? `SIGNED IN as ${ctxs.proof.email}, build ${JSON.stringify(ctxs.build)}` : "signed out"} · ${sel.length} routes × ${widths.length} widths × ${heights.length} heights${flag("no-dsf2") ? "" : " + a deviceScaleFactor 2 pass"}`);
  for (const r of sel) await sweepRoute(ctxs.normal, r, heights, "dsf1", results);
  if (!flag("no-dsf2")) for (const r of sel) await sweepRoute(ctxs.dsf2, r, [900], "dsf2", results);
} finally {
  await ctxs.close();
}

/* ---- report ------------------------------------------------------------------------------- */
const bad = results.filter((r) => r.violations.length);
mkdirSync(new URL("./out/", import.meta.url).pathname, { recursive: true });
writeFileSync(new URL("./out/width-sweep.json", import.meta.url).pathname, JSON.stringify({ base: BASE, signedIn: wantSignedIn, build: ctxs.build, results }, null, 1));
for (const r of sel.map((x) => x.id)) {
  const rs = results.filter((x) => x.route === r);
  const line = widths.map((w) => {
    const cells = rs.filter((x) => x.w === w);
    const n = cells.reduce((a, c) => a + c.violations.length, 0);
    return `${w}:${n ? "✗" + n : "✓"}`;
  }).join("  ");
  console.log(`${r.padEnd(17)} ${line}`);
}
const byKind = {};
for (const r of bad) for (const v of r.violations) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
console.log(`\n${results.length} states measured, ${bad.length} with violations`, JSON.stringify(byKind));
for (const r of bad.slice(0, 60)) {
  console.log(`\n✗ ${r.route} @ ${r.w}×${r.h} (${r.pass})`);
  for (const v of r.violations.slice(0, 6)) console.log(`   - [${v.kind}] ${v.detail}`);
  if (r.violations.length > 6) console.log(`   … +${r.violations.length - 6} more`);
}
if (bad.length > 60) console.log(`\n… ${bad.length - 60} more failing states (see ui-audit/out/width-sweep.json)`);
// VACUITY: a sweep that measured no controls anywhere proves nothing — refuse to score it.
const totalControls = results.reduce((a, r) => a + (r.controls || 0), 0);
if (!results.length || totalControls === 0) { console.error("\nVOID: the sweep measured no chrome controls at all — the instrument is broken, not the app."); process.exit(2); }
if (bad.length) { console.error(`\nFAIL: ${bad.length} state(s) break the shell's layout rules.`); process.exit(1); }
console.log("\nPASS: the shell fills every measured window exactly, nothing wraps, clips, overlaps or scrolls the page.");
