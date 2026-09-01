#!/usr/bin/env node
/* visual-regression.mjs — visual regression baselines on every PR (NEW-1, global/ui-audit).
 *
 * WHY THIS EXISTS. Every design-system check that shipped 2026-08-31/09-01 — docs/DESIGN.md, the
 * drift guard, docs/UI-INVENTORY.md, nestingMismatches()/siblingMismatches()/alignmentMismatches(),
 * the 5-role type scale, the locked-geometry primitives in controls.jsx — only ever catches a
 * failure mode someone anticipated and wrote a rule for. This is the opposite kind of check: render
 * the real app, diff the picture against a human-approved baseline, and fail if anything moved. No
 * theory of "what wrong looks like" required.
 *
 * Built on the rig this repo already has, not from scratch: ui-inventory.mjs's own boot/seed/prep
 * pattern (a real vite-preview server + headless Chromium), lib/pngDiff.mjs's dependency-free PNG
 * decoder (already used by verify-perceptual-parity.mjs), and lib/fakeTile.mjs's deterministic
 * per-(z,x,y) tile route (already used by boot-tail.mjs and friends to keep Leaflet's tile fetches
 * off the real network). See ui-audit/lib/visualBaseline.mjs for the surface list, the tolerance
 * policy (measured, not assumed — see that file's own header), and the generated
 * docs/VISUAL-REGRESSION.md builder.
 *
 * ⛔ THIS SCRIPT DELIBERATELY DOES NOT FOLLOW ui-inventory.mjs's "bare run writes the output" habit.
 * A bare run here NEVER writes a baseline — only `--approve` does, and only after you've looked at
 * what you're approving. Overwriting an approved picture is exactly the action this whole check
 * exists to gate, so it needs its own explicit verb, not "whatever running the script with no flags
 * happens to do."
 *
 * ⛔ THE BASELINE-CAPTURING BROWSER MUST BE THE EXACT SAME CHROMIUM BUILD CI RUNS, NOT "A" CHROMIUM
 * (MEASURED, NOT ASSUMED — B1026272's first real CI run, 2026-09-01, failed all 8 surfaces at
 * up to 2.9% of pixels differing, worst channel delta up to 233/255). Root cause: baselines were
 * first approved using whatever Chromium revision happened to be pre-installed in that session's
 * sandbox, which was NOT the revision `npx playwright install --with-deps chromium` resolves to in
 * real CI (pinned by `playwright`'s exact version in package-lock.json — here, revision 1228, Chrome
 * for Testing 149.0.7827.55). Downloading and using THAT exact revision to re-capture reproduced the
 * CI failure locally byte-for-byte (confirming the cause) and, once approved with it, passed clean.
 * Inspecting the diff images showed the mismatch was ENTIRELY on text-glyph edges (nav labels, the
 * logo, header text) — two Chromium point releases hint/antialias text very slightly differently —
 * never on layout, color fills, icons, or borders; still a real, silent trap, not a false alarm, so
 * this is the rule now: **never set `PW_CHROME` to a locally-convenient alternate browser when
 * approving a baseline.** Run `npx playwright install chromium` first (it resolves and fetches
 * exactly the revision `playwright-core`'s installed version expects — the same one CI's `--with-deps
 * chromium` step fetches) and let this script's default, unoverridden `chromium.launch()` resolve to
 * it. Playwright's own resolution already fails LOUD ("Executable doesn't exist…") rather than
 * silently substituting a nearby revision — trust that failure rather than working around it with an
 * explicit `PW_CHROME` path, which is exactly how the original mismatch was introduced.
 *
 * USAGE (a vite preview server must be running — `npx vite build && npx vite preview --port 4173`):
 *   node ui-audit/visual-regression.mjs                → CI mode: capture, diff against the
 *                                                          committed baselines, exit 1 on any
 *                                                          surface exceeding tolerance, any missing
 *                                                          baseline, or docs/VISUAL-REGRESSION.md
 *                                                          drift. Never writes anything under
 *                                                          version control; writes diff artifacts to
 *                                                          .perf/visual-regression/ (gitignored) on
 *                                                          failure, for CI to upload.
 *   node ui-audit/visual-regression.mjs --check         → identical to the bare run (the explicit
 *                                                          spelling, matching this repo's other
 *                                                          `--check` gates).
 *   node ui-audit/visual-regression.mjs --approve \
 *        --reason="widened the account chip"            → re-captures every surface, OVERWRITES the
 *                                                          baseline PNGs that changed, updates
 *                                                          ui-audit/visual-baselines/manifest.json
 *                                                          and regenerates docs/VISUAL-REGRESSION.md.
 *                                                          Commit the result.
 *   node ui-audit/visual-regression.mjs --surface=library --approve   → limit to one surface (dev
 *                                                          convenience — e.g. iterating on a fix).
 *   BASE_URL=http://localhost:4173/ node ui-audit/visual-regression.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { decodePng, diffImages } from "./lib/pngDiff.mjs";
import { fakeTilePng, parseTileUrl, encodeRgbPng } from "./lib/fakeTile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { SURFACES, THEMES, TOLERANCE, baselineFile, evaluateDiff, buildStatusMarkdown } from "./lib/visualBaseline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const BASELINE_DIR = join(HERE, "visual-baselines");
const MANIFEST_PATH = join(BASELINE_DIR, "manifest.json");
const DOC_PATH = join(REPO, "docs", "VISUAL-REGRESSION.md");
const ARTIFACT_DIR = join(REPO, ".perf", "visual-regression");

/* Recorded once by ui-audit/measure-visual-noise.mjs and pasted here by hand (a dated finding, not
 * a live measurement — see visualBaseline.mjs's header for why the noise-floor number must never be
 * re-measured inside a `--check`-gated generated doc). Update this string, with a new date, if a
 * future noise-floor run finds anything nonzero. */
const NOISE_FLOOR_NOTE =
  "0 differing pixels on all 8 surface/theme baselines, captured twice in a row against the " +
  "identical build with nothing changed (`node ui-audit/measure-visual-noise.mjs`, 2026-09-01).";
const ADDED_CI_TIME_NOTE =
  "locally measured (this session's sandbox, not yet confirmed against a real GitHub Actions run — " +
  "see the item's BACKLOG note for the update once one has run): preview-server startup ~3s + the " +
  "8-capture check itself ~21s ≈ ~24s on top of a build.yml job that already runs ~15 other steps. " +
  "Plus the new Playwright-chromium install step, cached via actions/cache on " +
  "~/.cache/ms-playwright: ~15s on a cache HIT (OS package install only — GitHub-hosted runners " +
  "don't persist apt state, so this part runs even on a cache hit) vs. ~50-70s on a cache MISS " +
  "(the browser binary itself, ~290 MB across chromium/ffmpeg/headless-shell, plus the same OS " +
  "packages) — a miss happens only on the first run or when package-lock.json's playwright version " +
  "changes. Steady-state total: **~40s added per PR**; worst case (cold cache): **~95s**.";

/* ---------------------------------------------------------------------------------------------
 * A local, GIS-free demo plan — deliberately its own fixture rather than importing ui-inventory.mjs's
 * module-scope `demoSite` (that one is not exported, and duplicating a ~20-line plain-object literal
 * is cheaper and less coupling than exporting a fixture two unrelated scripts would then both depend
 * on). Same shape: no `origin`/`county`, so the Site Planner never attempts a live GIS fetch when
 * this plan is open — the whole reason this fixture, not a real project, is what gets screenshotted.
 * ------------------------------------------------------------------------------------------- */
const DEMO_ID = "visual-regression-demo";
const DEMO_SITE_NAME = "Visual Regression Demo";
const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e2", type: "paving", cx: 0, cy: 132, w: 420, h: 120, rot: 0 },
  { id: "e3", type: "parking", cx: -330, cy: -40, w: 150, h: 180, rot: 0 },
  { id: "e4", type: "pond", cx: 330, cy: 165, w: 190, h: 120, rot: 0 },
];
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: DEMO_SITE_NAME, name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, updatedAt: 0,
};
const seedScript = (theme, withSite) => `(() => { try {
  ${withSite ? `
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoSite.id]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
  ` : `localStorage.removeItem('planarfit:currentSite:v1');`}
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
} catch (e) {} })();`;

/* Same actionability guard ui-inventory.mjs's own header documents: both the MapFinder and the
 * open-plan canvas keep their AppHeader mounted at once (one hidden via display:none), so a bare
 * selector can silently grab the wrong copy. `:visible` scopes to the rendered one. */
const clickIf = async (p, sel) => p.locator(`${sel}:visible`).first().click({ timeout: 5000 }).catch(() => {});
const openPlan = async (p) => { await p.getByText(DEMO_SITE_NAME).first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(600); };
const fit = async (p) => { await clickIf(p, '[title="Zoom to fit"]'); };

/* Per-surface Playwright prep — the browser-dependent half SURFACES (in the pure lib) deliberately
 * leaves out. Keyed by id so a mismatch (a surface in the lib with no prep here, or vice versa)
 * throws immediately in run() rather than silently capturing nothing for it. */
const PREP = {
  "map-landing": { hash: "#/site", withSite: false, prep: async (p) => { await clickIf(p, '[title="Collapse layers"]'); await p.waitForTimeout(150); } },
  "site-planner-header": { hash: "#/site", withSite: true, prep: async (p) => { await openPlan(p); await fit(p); } },
  "site-planner-left-rail": { hash: "#/site", withSite: true, prep: async (p) => { await openPlan(p); await fit(p); await clickIf(p, 'button[title="Yield"]'); await p.waitForTimeout(200); } },
  library: { hash: "#/library", withSite: false, prep: async () => {} },
};

/* Forced-still stylesheet: no in-flight transition/animation can ever be caught mid-frame, and the
 * one known network-racy element (the map's status toast — see ui-inventory.mjs's own comment on
 * `[data-testid="map-status-toast"]`) is hidden outright, belt-and-braces alongside the route-level
 * network block below (which already stops the fetch that races it). */
const STILL_CSS = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  [data-testid="map-status-toast"] { display: none !important; }
`;

export async function captureSurface(browser, surfaceId, theme) {
  const s = PREP[surfaceId];
  if (!s) throw new Error(`no PREP entry for surface "${surfaceId}" — SURFACES and PREP have drifted apart`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seedScript(theme, s.withSite));
  /* Same route pattern as ui-audit/boot-tail.mjs: same-origin/data/blob pass through untouched, a
   * tile URL gets a real, decodable, DETERMINISTIC PNG (color is a pure function of z/x/y — never
   * the network, never wall-clock), and everything else cross-origin is aborted. This is what makes
   * the map-landing surface safe to diff on a real internet connection (a GitHub Actions runner,
   * unlike this sandbox, has one): no live imagery vintage, no GIS server latency, no county-outage
   * fallback race can ever reach the picture being compared. */
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    const t = parseTileUrl(url);
    if (t) return route.fulfill({ status: 200, headers: { "content-type": "image/png", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) });
    return route.abort();
  });
  const page = await ctx.newPage();
  await assertMeasurable(page, "visual-regression");
  await page.goto(BASE + s.hash, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  try { await s.prep(page); } catch (e) { console.warn(`  prep(${surfaceId}/${theme}) warn:`, e.message); }
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: STILL_CSS });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(150);
  const png = await page.screenshot();
  await ctx.close();
  return png;
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return { tolerance: TOLERANCE, surfaces: {} };
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function gitHeadShort() {
  try { return execSync("git rev-parse --short HEAD", { cwd: REPO, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

/* A visualization, not a gating signal — encodeRgbPng (lib/fakeTile.mjs's own hand-rolled PNG
 * encoder, reused rather than a second one written here) draws differing pixels in solid magenta
 * over a dimmed copy of the actual render, so a CI artifact shows a reviewer WHERE a diff sits at a
 * glance instead of them squinting at two full screenshots side by side. */
function diffHighlightPng(actual, baseline) {
  return encodeRgbPng(actual.width, actual.height, (row, col, p, raw) => {
    const ia = (row * actual.width + col) * actual.channels;
    const ib = (row * baseline.width + col) * baseline.channels;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(actual.data[ia + c] - baseline.data[ib + c]));
    if (d > 0) { raw[p] = 255; raw[p + 1] = 0; raw[p + 2] = 255; }
    else { raw[p] = actual.data[ia] >> 1; raw[p + 1] = actual.data[ia + 1] >> 1; raw[p + 2] = actual.data[ia + 2] >> 1; }
  });
}

async function run() {
  const argv = process.argv.slice(2);
  const approve = argv.includes("--approve");
  const onlySurface = argv.find((a) => a.startsWith("--surface="))?.slice("--surface=".length) || null;
  const reasonArg = argv.find((a) => a.startsWith("--reason="))?.slice("--reason=".length);
  const surfaces = onlySurface ? SURFACES.filter((s) => s.id === onlySurface) : SURFACES;
  if (onlySurface && !surfaces.length) {
    console.error(`--surface=${onlySurface} matches no known surface (${SURFACES.map((s) => s.id).join(", ")})`);
    process.exit(2);
  }
  if (approve && !reasonArg) {
    console.error('--approve requires --reason="<why this baseline changed>" — the approval record IS this reason, on this commit, in this PR.');
    process.exit(2);
  }

  const manifest = loadManifest();
  const EXEC = process.env.PW_CHROME || undefined;
  const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-background-networking"] });

  const results = []; // { surfaceId, theme, status: "match"|"pass"|"fail"|"missing"|"approved", detail }
  try {
    for (const s of surfaces) {
      for (const theme of THEMES) {
        const png = await captureSurface(browser, s.id, theme);
        const file = baselineFile(s.id, theme);
        const baselinePath = join(BASELINE_DIR, file);

        if (approve) {
          const prior = existsSync(baselinePath) ? readFileSync(baselinePath) : null;
          const changed = !prior || !prior.equals(png);
          mkdirSync(BASELINE_DIR, { recursive: true });
          writeFileSync(baselinePath, png);
          (manifest.surfaces[s.id] ||= {})[theme] = {
            approvedAt: new Date().toISOString().slice(0, 10),
            approvedCommit: gitHeadShort(),
            note: reasonArg,
          };
          results.push({ surfaceId: s.id, theme, status: "approved", detail: changed ? "pixels changed — baseline updated" : "no pixel change — re-stamped" });
          continue;
        }

        if (!existsSync(baselinePath)) {
          results.push({ surfaceId: s.id, theme, status: "missing", detail: `no baseline at ${baselinePath} — run --approve to establish one` });
          continue;
        }
        const baseline = decodePng(readFileSync(baselinePath));
        const actual = decodePng(png);
        let stats = null;
        if (actual.width !== baseline.width || actual.height !== baseline.height) {
          stats = { differing: actual.width * actual.height, pct: 100, maxDelta: 255, bbox: null };
        } else if (!actual.data.equals(baseline.data)) {
          stats = diffImages(actual, baseline);
        }
        const verdict = evaluateDiff(stats, manifest.tolerance || TOLERANCE);
        results.push({ surfaceId: s.id, theme, status: verdict.pass ? "pass" : "fail", detail: verdict.reason });

        if (!verdict.pass) {
          mkdirSync(ARTIFACT_DIR, { recursive: true });
          writeFileSync(join(ARTIFACT_DIR, `actual--${file}`), png);
          writeFileSync(join(ARTIFACT_DIR, `baseline--${file}`), readFileSync(baselinePath));
          if (stats && actual.width === baseline.width && actual.height === baseline.height) {
            writeFileSync(join(ARTIFACT_DIR, `diff--${file}`), diffHighlightPng(actual, baseline));
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  for (const r of results) {
    const icon = { approved: "✓", pass: "✓", match: "✓", fail: "✗", missing: "⚠" }[r.status] || "?";
    console.log(`  ${icon} ${r.surfaceId} (${r.theme}): ${r.status} — ${r.detail}`);
  }

  if (approve) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
    const md = buildStatusMarkdown({ manifest, noiseFloor: NOISE_FLOOR_NOTE, addedCiTimeNote: ADDED_CI_TIME_NOTE });
    writeFileSync(DOC_PATH, md);
    console.log(`\n${results.length} baseline(s) approved. ui-audit/visual-baselines/manifest.json and docs/VISUAL-REGRESSION.md written — commit them together with your code change.`);
    return;
  }

  const failing = results.filter((r) => r.status === "fail" || r.status === "missing");
  const expectedMd = buildStatusMarkdown({ manifest, noiseFloor: NOISE_FLOOR_NOTE, addedCiTimeNote: ADDED_CI_TIME_NOTE });
  const committedMd = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : null;
  const docStale = committedMd !== expectedMd;

  if (existsSync(ARTIFACT_DIR) && !failing.length) rmSync(ARTIFACT_DIR, { recursive: true, force: true });

  if (docStale) {
    console.error("\ndocs/VISUAL-REGRESSION.md is out of date relative to ui-audit/visual-baselines/manifest.json — regenerate with `node ui-audit/visual-regression.mjs --approve` (or, if only the doc drifted with no pixel change, see the item's own note) and commit it.");
  }
  if (failing.length) {
    console.error(`\n${failing.length} surface/theme pair(s) did not match their baseline. Diff artifacts written to ${ARTIFACT_DIR}/ (gitignored — CI uploads this directory on failure). If the new picture is correct, approve it: node ui-audit/visual-regression.mjs --approve --reason="..."`);
  }
  if (docStale || failing.length) process.exit(1);
  console.log(`\nAll ${results.length} surface/theme pair(s) match their approved baseline. docs/VISUAL-REGRESSION.md is up to date.`);
}

/* Guard the CLI entry point so `ui-audit/measure-visual-noise.mjs` can import `captureSurface`
 * without also triggering a full --check/--approve run as an import side effect. */
if (import.meta.url === `file://${process.argv[1]}`) run();
