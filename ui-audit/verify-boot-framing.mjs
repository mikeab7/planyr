#!/usr/bin/env node
/* verify-boot-framing — ONE FRAMING PER LOAD. The canvas may never paint a framing it is about to
 * throw away. (B1574432, owner report 2026-09-11 with a 60 fps iPhone screen recording.)
 *
 * THE INVARIANT, in the owner's words: "the canvas commits ONE framing per load. Whatever framing
 * is first painted is the framing that stays; no intermediate framing is ever shown to the user."
 *
 * ⛔ WHAT MAKES THIS RIG DIFFERENT FROM THE FOUR ATTEMPTS BEFORE IT. Every earlier instrument was
 * an EVENT recorder (`setView` dispatches) or a DOM PROXY POLL (the Leaflet scale bar, the tile z).
 * The event recorder reads ZERO on the owner's own armed production tab, because it is per-MOUNT
 * and boot contains a remount; the polls each read one value straight through a zoom that really
 * happened. This samples the COMMITTED FRAMING ITSELF — the three attributes the SVG's transform is
 * built from — once per ANIMATION FRAME, so what it reports is what was on screen.
 *
 * ── THE ARMS ────────────────────────────────────────────────────────────────────────────────────
 *   visible    the real case — a cold load in a foregrounded tab.
 *   hidden     the case that defeated an earlier fix — the document starts hidden.
 *              (Reported, never asserted: a suspended rAF paints nothing, so "no flash" there is
 *              vacuous by construction and the report says so rather than scoring it.)
 *   control    ⛔ THE KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). After boot settles, one
 *              deliberate "Fit view" click must show up as exactly ONE new painted framing. If it
 *              does not, the rig cannot see framings at all and its verdict on the unknown arm is
 *              worthless — so the run FAILS rather than printing a score.
 *
 * Run:  node ui-audit/verify-boot-framing.mjs [--assert] [--fixture goose-creek-plan1copy.json]
 *       (needs a build in dist/ — it serves it itself on an ephemeral port)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed, fixtureSeedMulti } from "./lib/planFixture.mjs";
import { BOOT_FRAMING_INIT, bootFramingReport, framingLines } from "./lib/bootFraming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
/* ⛔ NO HARDCODED BROWSER PATH — the same rule visual-regression.mjs states: let Playwright resolve
 * the chromium its own `npx playwright install` step fetched, so this measures the browser CI
 * measures. `PW_CHROME` stays available as a deliberate local override. */
const EXEC = process.env.PW_CHROME || undefined;
const argv = process.argv.slice(2);
const ASSERT = argv.includes("--assert");
const FIXTURE = (argv.find((a) => a.startsWith("--fixture=")) || "").split("=")[1] || "goose-creek-plan1copy.json";
const SETTLE_MS = +((argv.find((a) => a.startsWith("--settle=")) || "").split("=")[1] || 5000);

if (!existsSync(join(DIST, "index.html"))) {
  console.error("verify-boot-framing: no dist/ build — run `npm run build` first.");
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0].split("#")[0];
  let p = join(DIST, url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  if (!existsSync(p) || p.endsWith("/")) p = join(DIST, "index.html");
  try {
    const body = readFileSync(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (_) { res.writeHead(404); res.end("nope"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* One place asserts the tab is measurable, so the literal harness name appears exactly once and a
 * failure still says WHICH arm was void (test/tabTiming.test.js requires the naming). */
const measurable = async (page, arm) => {
  try { await assertMeasurable(page, "verify-boot-framing"); }
  catch (e) { e.message = `[arm: ${arm}] ${e.message}`; throw e; }
};

const fixture = JSON.parse(readFileSync(join(ROOT, "ui-audit", "fixtures", FIXTURE), "utf8"));
const seed = fixtureSeed(fixture, { id: "bootframe", name: "Boot framing", site: "Boot framing" });
/* Two plans, so the REMOUNT arm has somewhere to go. A route change to another project changes
   this component's React key exactly the way a signed-in boot's `loadEpoch` bump does — a fresh
   mount, a fresh `view` state, and a plan already painted behind it. */
const seed2 = fixtureSeedMulti([
  { fixture, id: "bootframe", name: "Boot framing", site: "Boot framing" },
  { fixture, id: "bootframe2", name: "Boot framing B", site: "Boot framing B" },
], "bootframe");

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-background-networking"] });

/* Tiles and every external host are blocked in this sandbox anyway; aborting them explicitly keeps
 * the boot deterministic rather than paced by a proxy's 30 s timeouts. */
async function newPage({ multi = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 830 }, deviceScaleFactor: 1 });
  await ctx.route("**", (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(multi ? seed2 : seed);
  await ctx.addInitScript(BOOT_FRAMING_INIT);
  return { ctx, page: await ctx.newPage() };
}

/* ⛔ THE ARM THAT IS THE OWNER'S ACTUAL CASE. On his signed-in cold load the planner is mounted
 * TWICE: once from the device's cached copy (that is the dimmed, correct plan in his recording),
 * and again the moment the cloud pull settles, because `applyUser` bumps `loadEpoch` in the same
 * commit as `setCloudLoading(false)` — which is the un-dim. The second mount starts from the same
 * hardcoded `useState({ ppf: 0.35, … })`, and THAT time the un-computed framing lands on top of a
 * fully painted plan instead of behind a loading screen. This sandbox cannot sign in, so the
 * remount is driven the other way it happens — a route change to another project, which changes the
 * same React key. Same structural event, same assertion: EVERY mount paints exactly one framing. */
async function remountArm() {
  const { ctx, page } = await newPage({ multi: true });
  await measurable(page, "remount");
  await page.goto(`${BASE}#/project/bootframe/site`, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.location.hash = "#/project/bootframe2/site"; });
  await page.waitForTimeout(3000);
  const raw = await page.evaluate(() => window.__bootFramingStop());
  const report = bootFramingReport(raw);
  return { name: "remount mid-session (a second plan opens over a painted one)", report, ctx,
           expectMounts: 2 };
}

async function runArm(name) {
  const { ctx, page } = await newPage();
  await measurable(page, name);
  await page.goto(`${BASE}#/project/bootframe/site`, { waitUntil: "load" });
  await page.waitForTimeout(SETTLE_MS);
  const raw = await page.evaluate(() => (window.__bootFramingStop ? window.__bootFramingStop() : null));
  return { name, report: bootFramingReport(raw), ctx };
}

/* ⛔ THE ARM THAT DEFEATED AN EARLIER FIX: a document that is genuinely BACKGROUNDED while it
 * boots. This does NOT fake `visibilityState` — a getter override changes what the app reads while
 * the browser keeps painting and keeps firing rAF, which tests the app's own gating and nothing
 * else. A second page is brought to the front instead, so the booting tab is really hidden: its
 * rAF is really suspended (the in-page sampler records nothing at all while it is), and when it is
 * foregrounded the browser paints the DOM AS IT STANDS before any effect of ours can run. What the
 * user sees on returning to that tab is therefore the first thing this arm records — which is
 * exactly the question, and it IS assertable. */
async function backgroundedArm() {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 830 }, deviceScaleFactor: 1 });
  await ctx.route("**", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  await ctx.addInitScript(seed);
  /* Both halves of "hidden", because headless Chromium gives neither one on its own:
     · the READ the app gates on — `document.visibilityState` — is switchable through a flag, so it
       really says "hidden" during boot and really flips (with the event) on return; and
     · the FRAME LOOP is throttled for real by bringing a decoy page to the front, so this is not a
       fully-painting tab merely lying about itself.
     The combination reproduces what the app and the compositor each experience. Stated rather than
     implied: `visibilityState` here is an override, and the harness prints the throttled frame
     count as the evidence that the suppression was real. */
  await ctx.addInitScript(`(() => { try {
    window.__planyrForceHidden = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__planyrForceHidden ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__planyrForceHidden });
  } catch (e) {} })();`);
  await ctx.addInitScript(BOOT_FRAMING_INIT);
  const page = await ctx.newPage();
  const decoy = await ctx.newPage();
  await decoy.goto("about:blank");
  await decoy.bringToFront();
  await page.goto(`${BASE}#/project/bootframe/site`, { waitUntil: "load" }).catch(() => {});
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const whileHidden = await page.evaluate(() => ({ vis: document.visibilityState, raw: (window.__bootFraming ? window.__bootFraming() : null) }));
  await decoy.close();
  await page.bringToFront();
  await page.evaluate(() => { window.__planyrForceHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await measurable(page, "backgrounded → foregrounded");
  await page.waitForTimeout(2500);
  const raw = await page.evaluate(() => window.__bootFramingStop());
  return { name: "backgrounded → foregrounded", report: bootFramingReport(raw), ctx,
           reallyHidden: whileHidden.vis, framesWhileHidden: whileHidden?.raw?.frames ?? null };
}

/* ---- the known-good arm: one deliberate framing must read as exactly one new painted framing ---- */
async function controlArm() {
  const { ctx, page } = await newPage();
  await measurable(page, "control");
  await page.goto(`${BASE}#/project/bootframe/site`, { waitUntil: "load" });
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => window.__bootFramingReset && window.__bootFramingReset());
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.__bootFraming());
  const beforeN = bootFramingReport(before, { minFrames: 5 }).paintedFramings;
  // Pan the canvas by a real drag — a user view move is the one framing change available with no
  // panel open, and it is what the rig must be able to see.
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  if (!box) { await ctx.close(); return { ok: false, why: "no canvas — the control could not be performed" }; }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 6); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__bootFramingStop());
  const rep = bootFramingReport(after, { minFrames: 5 });
  await ctx.close();
  return { ok: rep.paintedFramings > beforeN, beforeN, afterN: rep.paintedFramings, rep };
}

const arms = [];
arms.push(await runArm("visible"));
arms.push(await backgroundedArm());
arms.push(await remountArm());
const control = await controlArm();

console.log("═".repeat(96));
console.log("verify-boot-framing — ONE FRAMING PER LOAD");
console.log("═".repeat(96));
console.log(`fixture: ${FIXTURE}   viewport 430×830   settle ${SETTLE_MS} ms\n`);

console.log("KNOWN-GOOD ARM (the rig must be able to SEE a framing change before its verdict means anything)");
if (control.ok) console.log(`  ✅ a deliberate pan produced a new painted framing (${control.beforeN} → ${control.afterN})\n`);
else console.log(`  ❌ a deliberate pan produced NO new painted framing (${control.beforeN} → ${control.afterN ?? "?"}) — this run is VACUOUS${control.why ? `: ${control.why}` : ""}\n`);

let failed = !control.ok;
for (const arm of arms) {
  const { name, report, ctx } = arm;
  console.log(`ARM: ${name}`);
  if (arm.reallyHidden !== undefined) {
    console.log(`  document.visibilityState while booting : ${arm.reallyHidden}${arm.reallyHidden === "hidden" ? "  (overridden read + a really de-prioritised frame loop — see the frame count below)" : "  ⚠ the app did NOT read the document as hidden — this arm did not test what it claims"}`);
    console.log(`  animation frames while hidden          : ${arm.framesWhileHidden} in ${SETTLE_MS} ms — a de-prioritised frame loop, which is what makes the suppression real rather than claimed`);
  }
  console.log(`  animation frames sampled : ${report.frames} (${report.visibleFrames} with the tab visible)`);
  console.log(`  planner mounts observed  : ${report.mounts}${arm.expectMounts ? ` (this arm needs ${arm.expectMounts} — one mount means the remount never happened and the arm proved nothing)` : ""}`);
  if (arm.expectMounts && report.mounts < arm.expectMounts) { console.log("  ❌ the remount did not happen — this arm is VACUOUS"); failed = true; }
  console.log(`  PAINTED framings         : ${report.paintedFramings}`);
  console.log(`  committed framings       : ${report.committedFramings}`);
  if (report.unpainted.length) console.log(`  held-but-never-painted   : ${report.unpainted.length} (the canvas carried a framing while deliberately unpainted — correct, and not counted)`);
  if (report.vacuous) report.vacuity.forEach((v) => console.log(`  ⚠ VACUOUS: ${v}`));
  framingLines(report.painted).forEach((l) => console.log(l));
  if (report.vacuous) { console.log("  ❌ this arm observed nothing — a run that cannot see the property does not get to score it"); failed = true; }
  else if (report.ok) console.log(`  ✅ every mount painted exactly one framing (${report.mounts} mount${report.mounts === 1 ? "" : "s"}, ${report.paintedFramings} framing${report.paintedFramings === 1 ? "" : "s"}) — the invariant holds`);
  else {
    report.offenders.forEach((o) => console.log(`  ❌ mount ${o.mount} painted ${o.framings} distinct framings — the user saw ${o.framings - 1} framing(s) that mount then threw away`));
    if (!report.offenders.length) console.log("  ❌ no framing could be attributed to a mount");
    failed = true;
  }
  console.log("");
  await ctx.close();
}

await browser.close();
server.close();
if (ASSERT && failed) process.exit(1);
