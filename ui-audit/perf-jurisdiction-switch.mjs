#!/usr/bin/env node
/* perf-jurisdiction-switch — does opening a plan stall the main thread while the jurisdiction lookups come back?
 * (NEW-1, slow report 55807aa9 — plan smun6o2o628f "Bolt-on", build 99c87bb.)
 *
 * ⛔ THE REPORT. After a plan switch the owner's recorder saw ~30 long tasks of 123–142 ms (≈8.4 s total over a
 * minute) all labelled `Response.json.then:jurisdiction-…:5638`, starting ~5 s after the switch. See
 * `lib/jurisdictionSwitch.mjs` for what that label does and does not say (it names the promise reaction that
 * RESUMED, not the work the chain then did).
 *
 * WHAT THIS DRIVES. The real app, a signed-out local store holding the plan's six live parcels (the fixture is
 * `fixtures/bolt-on-jurisdiction.json`, read from public.site_elements), and GIS answers REPLAYED from payloads
 * recorded off the live services — so size, count and shape are the real ones and the run has no network jitter.
 * Scenarios, each in a fresh browser context (cold in-memory + IndexedDB caches — the owner's first open after the
 * parcels changed):
 *   cold-load            straight onto Bolt-on
 *   switch-from-other    open another plan (Bain, Harris County), settle, then switch to Bolt-on
 *   switch-same-group    Bolt-on and a sibling plan in the SAME project, switch between them
 *   switch-analysis-open the same switch with the Site Analysis panel open
 * and records, per scenario: long tasks, long-animation-frame script attribution (invoker, chunk, char offset — the
 * source the owner's recorder labels from), and how many GIS requests were made / answered.
 *
 *   # 1. record once (needs outbound network):  PLANYR_RECORD=ui-audit/fixtures/bolt-on-gis-payloads.json
 *   # 2. xvfb-run -a node ui-audit/perf-jurisdiction-switch.mjs [--replay file] [--only name] [--json] [--assert] [--label x]
 *   BASE_URL defaults to http://localhost:4173/ (vite preview of a build; a dummy Supabase env is fine).
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSite } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { attribute, verdict } from "./lib/jurisdictionSwitch.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const RECORD = process.env.PLANYR_RECORD || "";
const REPLAY = argOf("--replay", join(HERE, "fixtures", "bolt-on-gis-payloads.json"));
const LABEL = argOf("--label", "run"), ONLY = argOf("--only", ""), OUT = argOf("--out", "");
const SETTLE_MS = Number(argOf("--settle", 9000));          // the owner's burst started ~5 s after the switch and ran ~6 s
const DPR = 2, VW = 1722, VH = 700;

/* ── the plans ─────────────────────────────────────────────────────────────────────────────────────────────── */
const fx = JSON.parse(readFileSync(join(HERE, "fixtures", "bolt-on-jurisdiction.json"), "utf8"));
const boltParcels = fx.parcels.map((p, i) => ({
  id: p.id, z: i * 1024, locked: false, stroke: "#0729cf", weight: 4,
  points: p.pts.split(" ").map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; }),
}));
const boltFixture = { schemaVersion: fx.schemaVersion, origin: fx.origin, county: fx.county, parcels: boltParcels, settings: fx.settings, els: [] };
/* group id = plan id, the convention perf-edit-switch uses: a raw hash switch from one PROJECT to another whose group id is not a plan id
 * was measured to be ignored for 30 s+ in a running app (production: group smqfy2r7pdec, plan smun6o2o628f). */
const BOLT = "smun6o2o628f", SIBLING = "smun6o2o628g", OTHER = "sw-goose", GROUP = BOLT;
const plans = () => {
  const bolt = fixtureSite(boltFixture, { id: BOLT, name: "Bolt-on", site: "Grand Port" }); bolt.groupId = GROUP;
  const sib = fixtureSite(boltFixture, { id: SIBLING, name: "Bolt-on 2", site: "Grand Port" }); sib.groupId = GROUP;
  const other = fixtureSite(readFixture("goose-creek-plan1-copy"), { id: OTHER, name: "Other plan", site: "Other project" }); other.groupId = OTHER;
  for (const r of [bolt, sib, other]) { r.status = "pursuit"; r.role = "pursuit"; }
  return { [BOLT]: bolt, [SIBLING]: sib, [OTHER]: other };
};

/* ── GIS record / replay at the network layer ─────────────────────────────────────────────────────────────── */
const reqKey = (r) => `${r.method()} ${r.url()}${r.postData() ? "\n" + r.postData() : ""}`;
const isExternal = (u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:") && /^https?:/.test(u);
/* DATA requests only: an ArcGIS /query or /identify, or any f=json answer. Basemap/overlay TILES and image exports are not
 * GIS data — counting them made the first run report 1,000+ "GIS requests" per scenario — they get a generated PNG. */
const isGis = (u) => isExternal(u) && (/\/(query|identify)(\?|$)/.test(u) || /[?&]f=p?json/.test(u)) && !/\/export\?/.test(u);
const recorded = RECORD ? {} : JSON.parse(readFileSync(REPLAY, "utf8"));

const INSTRUMENT = `(() => {
  window.__E2E = true; window.__PLANYR_E2E = true;
  window.__lt = []; window.__loaf = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), +e.duration.toFixed(1)]); }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ t: Math.round(e.startTime), d: +e.duration.toFixed(1), scripts: (e.scripts || []).map((s) => ({ i: s.invoker || "", f: s.sourceFunctionName || "", u: (s.sourceURL || "").split("/").pop(), p: s.sourceCharPosition, d: +s.duration.toFixed(1) })) }); }).observe({ type: "long-animation-frame", buffered: true }); } catch (_) {}
})();`;

const results = [];
const browser = await chromium.launch({ executablePath: EXEC, headless: false, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

async function scenario(name, run) {
  if (ONLY && ONLY !== name) return;
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  const store = plans();
  await context.addInitScript((x) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify(x)); } catch (_) {} }, store);
  await context.addInitScript(INSTRUMENT);
  const stats = { gisRequests: 0, responses: 0, misses: [], bytes: 0, log: [] };
  await context.route("**/*", async (route) => {
    const req = route.request(); const u = req.url();
    if (!isExternal(u)) return route.continue();
    if (!isGis(u)) {
      const tile = parseTileUrl(u);
      if (tile) return route.fulfill({ status: 200, contentType: "image/png", body: fakeTilePng(tile.z, tile.x, tile.y) });
      return route.abort();
    }
    stats.gisRequests++;
    stats.log.push(u.replace(/^https?:\/\//, '').replace(/\?.*/, '').split('/').slice(-4).join('/') + (/returnGeometry=true/.test(u) ? ' [geom]' : ''));
    if (RECORD) {
      try {
        const res = await route.fetch(); const body = await res.text();
        recorded[reqKey(req)] = { status: res.status(), ct: res.headers()["content-type"] || "application/json", body };
        stats.responses++; stats.bytes += body.length;
        return route.fulfill({ response: res, body });
      } catch (e) { return route.abort(); }
    }
    const hit = recorded[reqKey(req)];
    if (hit) { stats.responses++; stats.bytes += hit.body.length; return route.fulfill({ status: hit.status, contentType: hit.ct, headers: { "access-control-allow-origin": "*" }, body: hit.body }); }
    stats.misses.push(u.slice(0, 160));
    /* a request the recording does not hold is a REPLAY MISS, reported loudly (never silently answered "nothing here") —
     * it gets a service error so the app takes its documented failure path, and the run lists every one. */
    return route.fulfill({ status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"error":{"code":503,"message":"replay miss"}}' });
  });
  const page = await context.newPage();
  await assertMeasurable(page, "perf-jurisdiction-switch");
  /* A switch is only a switch once the header names the new plan. Two traps, both measured here:
   *  · a raw hash write from one PROJECT to another was IGNORED for 30 s+ in a running app (the first, boot-time route is read
   *    from storage; later ones go through the project list), so after the first open every switch uses the header's own chips,
   *    exactly as the owner does;
   *  · the header carries hidden MEASURING copies of every chip (PriorityToolbar), so a bare getByText(...).first() resolves a
   *    zero-size node — every click must be scoped to :visible.
   * A switch that never lands THROWS rather than reporting a clean zero (an earlier draft "measured" a switch that had not
   * happened: zero requests for the plan it claimed to open). */
  const named = async (n) => page.waitForFunction((x) => (document.body.innerText || "").includes(x), n, { timeout: 45000 });
  const open = async (id, planName) => {                      // first open: a route, as a pasted link / reload does
    await page.evaluate((i) => { window.location.hash = `#/project/${i}/site`; }, id);
    await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
    await named(planName);
  };
  const chip = (text) => page.locator("span:visible", { hasText: new RegExp(`^${text}$`) }).first();
  const pick = (text) => page.locator("*:visible", { hasText: new RegExp(`^${text}$`) }).last();
  const switchProject = async (fromSite, toSite, planName) => { await chip(fromSite).click(); await pick(toSite).click(); await named(planName); };
  const switchPlan = async (fromPlan, toPlan) => { await chip(fromPlan).click(); await pick(toPlan).click(); await named(toPlan); };
  const go = { open, switchProject, switchPlan };
  const t0 = { v: 0 };
  const mark = async () => { t0.v = await page.evaluate(() => performance.now()); };
  try {
    await run({ page, go, mark, pacedWait: (ms) => pacedWait(page, ms) });
    const raw = await page.evaluate(() => ({ lt: window.__lt.slice(), loaf: window.__loaf.slice(), now: performance.now() }));
    const a = attribute(raw, [t0.v, raw.now]);
    const top = raw.loaf.filter((f) => f.t >= t0.v).sort((x, y) => y.d - x.d).slice(0, 6).map((f) => ({ t: Math.round(f.t - t0.v), d: f.d, scripts: f.scripts.filter((q) => q.d >= 5).map((q) => `${q.f || q.i}:${q.u}:${q.p}=${q.d}`) }));
    const s = { name, topFrames: top, windowMs: Math.round(raw.now - t0.v), gisRequests: stats.gisRequests, responses: stats.responses, replayMisses: stats.misses.length, missSample: stats.misses.slice(0, 3), requestLog: stats.log, attr: a };
    results.push(s);
    if (!has("--json")) process.stderr.write(`· ${name}: ${stats.responses}/${stats.gisRequests} GIS answers, jurisdiction ${a.jurisdictionMs} ms (max ${a.jurisdictionMaxMs}), ${a.tasks} long tasks (${a.over50} > 50 ms, longest ${a.maxTaskMs})${stats.misses.length ? `, ${stats.misses.length} REPLAY MISSES` : ""}\n`);
  } finally { await context.close(); }
}

try {
  await scenario("cold-load", async ({ page, go, mark, pacedWait: w }) => {
    await page.goto(BASE, { waitUntil: "load" });
    await mark(); await go.open(BOLT, "Bolt-on"); await w(SETTLE_MS);
  });
  await scenario("switch-from-other", async ({ page, go, mark, pacedWait: w }) => {
    await page.goto(BASE, { waitUntil: "load" });
    await go.open(OTHER, "Other plan"); await w(SETTLE_MS);
    await mark(); await go.switchProject("Other project", "Grand Port", "Bolt-on"); await w(SETTLE_MS);
  });
  await scenario("switch-same-group", async ({ page, go, mark, pacedWait: w }) => {
    await page.goto(BASE, { waitUntil: "load" });
    await go.open(BOLT, "Bolt-on"); await w(SETTLE_MS);
    await mark(); await go.switchPlan("Bolt-on", "Bolt-on 2"); await w(SETTLE_MS);
  });
  await scenario("switch-analysis-open", async ({ page, go, mark, pacedWait: w }) => {
    await page.goto(BASE, { waitUntil: "load" });
    await go.open(OTHER, "Other plan"); await w(3000);
    await page.locator("*:visible", { hasText: /^Analysis$/ }).last().click();      // the left rail's Analysis tab
    await w(1500);
    await mark(); await go.switchProject("Other project", "Grand Port", "Bolt-on"); await w(SETTLE_MS);
  });
} finally { await browser.close(); }

if (RECORD) { writeFileSync(RECORD, JSON.stringify(recorded)); process.stderr.write(`recorded ${Object.keys(recorded).length} GIS responses → ${RECORD}\n`); }
const budgetFile = join(HERE, "perf-jurisdiction-switch.budget.json");
const v = verdict(results, existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, "utf8")) : {});
const out = { label: LABEL, base: BASE, replay: RECORD ? null : REPLAY, scenarios: results, verdict: v };
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
if (has("--json")) console.log(JSON.stringify(out, null, 1));
else console.log(`\n${LABEL}\n` + v.lines.join("\n"));
if (has("--assert") && !v.pass) process.exit(1);
