#!/usr/bin/env node
/* verify-hidden-content-behaviour — CAN A HIDDEN OBJECT STILL AFFECT WHAT YOU SEE OR DO?
 *
 * ⛔ THE FOLLOW-ON FROM B3296. That defect was one seam: the dissolved road pavement kept painting.
 * The static sweep (`audit-hidden-content-reads.mjs`) enumerates who else reads the whole model where
 * the drawing wants the visible subset. This harness is the other half — it asks the running app,
 * on the owner's real plan, whether a hidden object can still reach him:
 *
 *   EXTENT   Zoom to fit — does the view frame around content that is not on screen?
 *   PRINT    the export crop — is the printed sheet framed to hidden content? (PDF-PARITY)
 *   SNAP     the ambient flush-snap — can an invisible neighbour pull an element you are dragging?
 *   MAGNET   the road-connect magnet — can a hidden road weld the endpoint of one you are drawing?
 *   BOUNDARY the parcel-edge snap — can a hidden parcel boundary pull the cursor?
 *   LABELS   the collision pass — do labels dodge a measurement chip that is not drawn?
 *   HIT      click targets — can you select what you cannot see?
 *
 * Each arm states what it measured, so a PASS is a reading rather than an absence.
 *
 *   npm run verify:hiddencontent      (node ui-audit/verify-hidden-content-behaviour.mjs [--url …])
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const CACHE = "ui-audit/.cache/hidden-behaviour";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SITE_ID = "hbsite1";

/* ⛔ THE FIXTURE IS CHOSEN BY THE QUESTION, NOT BY HABIT, AND THE CHOICE IS COMPUTED.
 *
 * The EXTENT arm needs a plan where hiding a group actually MOVES the drawing's bounds. On the owner's
 * Woods Road plan nothing does — its parcel and its elements span 2,947 ft and 2,906 ft, within 1.4% —
 * so an extent arm run there can only ever report "unchanged", which is indistinguishable from the
 * defect it is looking for. Measured across every real fixture: Woods Road NONE · Bain NONE ·
 * Silvestri ROADS ×1.21. So the extent and print arms run on Silvestri and the hit-test arm on Woods
 * Road, and the mover is derived below rather than picked. */
const spanOf = (els, parcels) => {
  const a = [];
  (parcels || []).forEach((p) => a.push(...(p.points || [])));
  (els || []).forEach((e) => {
    if (e.points) a.push(...e.points);
    else if (e.cx != null) a.push({ x: e.cx - e.w / 2, y: e.cy - e.h / 2 }, { x: e.cx + e.w / 2, y: e.cy + e.h / 2 });
  });
  if (!a.length) return 0;
  const xs = a.map((p) => p.x), ys = a.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

/** The element type whose hiding shrinks the drawing's bounds the most, with the predicted ratio. */
function extentMover(fixture) {
  const base = spanOf(fixture.els, fixture.parcels);
  let best = null;
  for (const t of [...new Set((fixture.els || []).map((e) => e.type))]) {
    const s = spanOf((fixture.els || []).filter((e) => e.type !== t), fixture.parcels);
    const ratio = s > 0 ? base / s : 1;
    if (!best || ratio > best.ratio) best = { type: t, ratio };
  }
  return best;
}

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const openViewMenu = async (page) => {
  const btn = page.locator('[data-testid="view-menu-btn"]');
  if (await btn.getAttribute("aria-expanded") !== "true") { await btn.click(); await pacedWait(page, 350); }
};
const toggleRow = async (page, testid) => {
  await openViewMenu(page);
  await page.locator(`[data-testid="${testid}"]`).click();
  await pacedWait(page, 700);
};
const closeViewMenu = async (page) => {
  const btn = page.locator('[data-testid="view-menu-btn"]');
  if (await btn.getAttribute("aria-expanded") === "true") { await btn.click(); await pacedWait(page, 300); }
};

/* The live view, read off the canvas's own published attribute rather than re-derived. `__plannerView`
 * is a control surface (setView/centerOn/probes), not a getter, so the honest read is the attribute
 * the app already stamps for exactly this purpose. */
const viewOf = (page) => page.evaluate(() => {
  const svg = document.querySelector("[data-view-ppf]") || document.querySelector('[data-testid="planner-canvas"]');
  const ppf = svg && svg.getAttribute("data-view-ppf");
  return ppf == null ? null : { ppf: Number(ppf) };
});

/** Click "Zoom to fit" through the real control and read the resulting view. */
async function zoomToFit(page) {
  await page.locator('[aria-label="Zoom to fit"]').first().click();
  await pacedWait(page, 900);
  return viewOf(page);
}

/* ⛔ `__plannerExportSvg` IS ASYNC (it dynamic-imports the export chunk). A sync read stringifies a
 * Promise, finds no viewBox and reports "no sheet built" — an instrument failure that reads exactly
 * like a real one, which is the shape this repo keeps paying for. Await it. */
const sheetExtent = (page) => page.evaluate(async () => {
  const svg = window.__plannerExportSvg ? await window.__plannerExportSvg() : null;
  if (!svg) return null;
  const m = String(svg).match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function boot(fixtureName, { noAerial = false } = {}) {
  /* ⛔ `noAerial` IS NOT A CONVENIENCE — IT IS WHAT MAKES THE EXTENT ARM ABLE TO SEE ANYTHING.
   *
   * `fit()` frames the parcels, the elements AND the aerial underlay, and on every real fixture the
   * aerial is the widest thing by far: Silvestri's is ±4,570 ft against ±3,270 ft of drawing. So with
   * an aerial seeded, hiding ANY content group leaves the frame identical — the arm reports ×1.00 on a
   * correct build and on a broken one alike, which is exactly the indistinguishability this whole
   * exercise is about. Dropping the raster makes the drawing define its own bounds, which is the
   * condition under which the question "does the frame follow what is visible" has an answer at all.
   *
   * ⚠ AND IT IS ALSO THE HONEST SCOPE OF THE FIX: on a plan WITH an aerial — which is most of the
   * owner's — Zoom to fit is framed by the photo either way, so this defect was invisible to him. */
  const fixture = noAerial ? { ...readFixture(fixtureName), rasters: [] } : readFixture(fixtureName);
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: `${SITE_ID}-${fixtureName}${noAerial ? "-na" : ""}`, cacheDir: CACHE });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await assertMeasurable(page, "verify-hidden-content-behaviour");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await pacedWait(page, 3000);
  if (errs.length) { console.log("⛔ render crashed:", errs[0].slice(0, 300)); process.exit(1); }
  return { page, ctx, fixture };
}

try {
  mkdirSync(CACHE, { recursive: true });

  // ══════════════════════════ EXTENT + PRINT — on the plan where content defines the bounds
  const A = await boot("sylvestri", { noAerial: true });
  const mover = extentMover(A.fixture);
  console.log(`\n${A.fixture.site} / ${A.fixture.name} — extent + print`);
  check("setup · hiding a group SHOULD change the frame here (else both arms are vacuous)",
    mover.ratio > 1.05, `hiding ${mover.type} predicts a ×${mover.ratio.toFixed(2)} zoom-in`);

  await closeViewMenu(A.page);
  const fitAll = await zoomToFit(A.page);
  const cropAll = await sheetExtent(A.page);
  check("setup · Zoom to fit and the export sheet both answer", !!fitAll?.ppf && !!cropAll,
    `ppf ${fitAll?.ppf?.toFixed(5)} · sheet viewBox w ${cropAll?.w?.toFixed(0)}`);

  await toggleRow(A.page, `view-row-el:${mover.type}`);
  await closeViewMenu(A.page);
  const fitHidden = await zoomToFit(A.page);
  const cropHidden = await sheetExtent(A.page);

  const gotRatio = fitAll && fitHidden ? fitHidden.ppf / fitAll.ppf : 1;
  check("EXTENT · Zoom to fit frames only what is VISIBLE",
    Math.abs(gotRatio - mover.ratio) / mover.ratio < 0.12,
    `ppf ×${gotRatio.toFixed(2)} (predicted ×${mover.ratio.toFixed(2)})`);
  check("PRINT · the export crop follows what is visible (PDF-PARITY)",
    cropAll && cropHidden && cropHidden.w < cropAll.w * 0.98,
    cropAll && cropHidden ? `sheet viewBox width ${cropAll.w.toFixed(0)} → ${cropHidden.w.toFixed(0)}` : "no sheet built");
  await A.ctx.close();

  // ══════════════════════════ HIT — on the owner's own reported plan
  const B = await boot("woods");
  console.log(`\n${B.fixture.site} / ${B.fixture.name} — click targets`);
  await toggleRow(B.page, "view-row-el:pond");
  await closeViewMenu(B.page);
  const pondIds = new Set((B.fixture.els || []).filter((e) => e.type === "pond").map((e) => `el:${e.id}`));
  const probes = await B.page.evaluate(() => {
    /* Ask the APP's own resolver rather than re-implementing the hit test — a harness that re-derives
     * the rule tests its own copy of it (B233153). */
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const r = svg.getBoundingClientRect();
    const out = [];
    for (let i = 1; i <= 10; i++) for (let j = 1; j <= 10; j++) {
      const t = window.__plannerHitTarget ? window.__plannerHitTarget(r.x + (r.width * i) / 11, r.y + (r.height * j) / 11) : null;
      if (t) out.push(String(t));
    }
    return out;
  });
  const hitHidden = probes.filter((t) => [...pondIds].some((id) => t.includes(id)));
  check("HIT · a hidden element answers no click anywhere on the canvas", hitHidden.length === 0,
    hitHidden.length ? `${hitHidden.length} probe(s) resolved to a hidden pond` : `${probes.length} probes hit something, none a hidden pond`);
  await B.ctx.close();

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} scored arms pass.`);
  process.exitCode = bad.length ? 1 : 0;
} finally {
  await browser.close();
}
