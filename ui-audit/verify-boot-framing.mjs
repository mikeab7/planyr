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
 *   hidden     the case that defeated an earlier fix — the document starts hidden. ASSERTED, and
 *              B1600352 is why: this arm used to be reported-only, on the reasoning that a
 *              suspended rAF paints nothing so "no flash" there is vacuous by construction. That
 *              reasoning is sound about FLASHES and says nothing at all about the opposite failure,
 *              a canvas that is never revealed — which contributes zero painted framings, hence
 *              zero offenders, hence ✅. A blank plan on planyr.io scored a pass here. So the arm
 *              now asserts, BEFORE it foregrounds anything, that the canvas is revealed, framed off
 *              the boot default, and hit-testable.
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
/* `--base=<url>` points the rig at an ALREADY-DEPLOYED build (a Cloudflare preview, or planyr.io)
 * instead of serving `dist/` here. Worth having beyond convenience: it is the only way to judge the
 * bundle that was actually shipped rather than one built moments ago on this machine — the
 * "prove the browser is running the build you are judging" rule. The seeded plan is a synthetic
 * fixture written into a throwaway browser context; it signs in to nothing and touches no real
 * plan. Everything off that origin is still aborted, so a deployed run is as hermetic as a local
 * one (no GIS, no Supabase, no tiles). */
const REMOTE_BASE = (argv.find((a) => a.startsWith("--base=")) || "").split("=")[1] || "";

if (!REMOTE_BASE && !existsSync(join(DIST, "index.html"))) {
  console.error("verify-boot-framing: no dist/ build — run `npm run build` first, or pass --base=<url>.");
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
let BASE = REMOTE_BASE;
if (REMOTE_BASE) { server.close(); if (!BASE.endsWith("/")) BASE += "/"; }
else { await new Promise((r) => server.listen(0, "127.0.0.1", r)); BASE = `http://127.0.0.1:${server.address().port}/`; }

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

/* A deployed target is off-box, so the browser has to go through this environment's egress proxy —
 * a local run never touches it. `ignoreHTTPSErrors` on the context covers the proxy's own MITM
 * certificate (/root/.ccr/ca-bundle.crt) without teaching Chromium a new trust store. */
const PROXY = REMOTE_BASE ? (process.env.HTTPS_PROXY || process.env.https_proxy || "") : "";
const browser = await chromium.launch({
  ...(EXEC ? { executablePath: EXEC } : {}),
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-background-networking"],
});

/* Tiles and every external host are blocked in this sandbox anyway; aborting them explicitly keeps
 * the boot deterministic rather than paced by a proxy's 30 s timeouts. */
async function newPage({ multi = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 830 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
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
  const ctx = await browser.newContext({ viewport: { width: 430, height: 830 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
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
  /* ⛔ B1600352 — THE ASSERTION THIS ARM WAS MISSING, AND ITS ABSENCE PUT A BLANK CANVAS ON
   * planyr.io WITH THIS GATE GREEN. Counting framings-per-mount can only catch a canvas that
   * painted TOO MANY framings. It is structurally blind to one that painted NONE: an unrevealed
   * canvas contributes zero painted framings, therefore zero offenders, therefore ✅ — the same
   * shape as the vacuity this rig's own teeth proof already caught once (a build with no mount
   * stamp scored a pass because zero attributable mounts meant zero offenders). The rig counted
   * flashes and never once required the drawing to actually appear.
   *
   * So: BEFORE any foregrounding, and therefore before anything can rescue the build, the canvas
   * must already be REVEALED and HIT-TESTABLE, carrying a framing that is not the `useState` boot
   * default. A tab that is merely not frontmost is fully laid out — `getBoundingClientRect()` is
   * accurate there — so there is nothing to wait for, and a canvas still sitting unpainted at
   * ppf 0.35 off (60, 60) at this point is the production defect exactly. */
  /* el-tier: the ELEMENT tier really is the subject here — this arm picks one drawn element and
     asks whether a press at its own centre reaches it, which is a question about that element's
     own node, not a census of what the plan contains. The count is the arm's vacuity precondition
     (an arm that painted no elements cannot ask the question at all), not a measure of plan
     contents. COUNT-EVERY-KIND's [data-feature] census is the right tool for the latter. */
  const reveal = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]');
    if (!c) return { canvas: false };
    /* el-tier: one drawn ELEMENT's own node is the subject — the question is whether a press at
       its own centre reaches it, which is what production could not do. Not a plan census. */
    const els = [...document.querySelectorAll("[data-el-id]")];
    const el = els[0];
    let hit = null, elId = null;
    if (el) {
      elId = el.getAttribute("data-el-id");
      const b = el.getBoundingClientRect();
      const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const owner = t && t.closest ? t.closest("[data-el-id]") : null;
      hit = owner ? owner.getAttribute("data-el-id") : (t ? `<${(t.tagName || "?").toLowerCase()}>` : null);
    }
    /* el-tier: `els` is this arm's VACUITY PRECONDITION, not a census of plan contents — an arm
       whose fixture drew no element cannot ask whether a press reaches one, and must say so
       rather than score. COUNT-EVERY-KIND's [data-feature] census is the tool for "what is in
       this plan"; the question here is about one element's own node. */
    /* ⛔ B1600352 — "REVEALED" IS NOT "SHOWING THE PLAN", and the owner's 2026-09-12 01:03 live
       reading is why this is asserted separately. On the reverted build the canvas computes
       `visible` and the aerial paints across it, while every drawn element sits OUTSIDE the canvas
       box entirely (measured on production: elements at x 1195-1405, canvas box x 54-1023). A
       visible canvas with the plan off-screen reads to the owner as "my plan is gone", exactly as a
       blank one did — and it is worse, because it looks plausible. So the rig asks whether the plan
       is ON SCREEN, not merely whether the canvas was un-hidden. */
    const cb = c.getBoundingClientRect();
    const inView = els.slice(0, 3).map((e) => {
      const b = e.getBoundingClientRect();
      return { id: e.getAttribute("data-el-id"), x: Math.round(b.x), right: Math.round(b.right),
               inView: b.right > cb.x && b.x < cb.right && b.bottom > cb.y && b.y < cb.bottom };
    });
    return { canvas: true, visibility: getComputedStyle(c).visibility,
             canvasBox: `${Math.round(cb.x)}..${Math.round(cb.right)}`, inView, anyInView: inView.some((b) => b.inView),
             ppf: +c.getAttribute("data-view-ppf"), offX: +c.getAttribute("data-view-offx"), offY: +c.getAttribute("data-view-offy"),
             vis: document.visibilityState, els: document.querySelectorAll("[data-el-id]").length, elId, hit };
  });
  await decoy.close();
  await page.bringToFront();
  await page.evaluate(() => { window.__planyrForceHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await measurable(page, "backgrounded → foregrounded");
  await page.waitForTimeout(2500);
  const raw = await page.evaluate(() => window.__bootFramingStop());
  return { name: "backgrounded → foregrounded", report: bootFramingReport(raw), ctx, reveal,
           reallyHidden: whileHidden.vis, framesWhileHidden: whileHidden?.raw?.frames ?? null };
}

/* ⛔ B1600352 — THE WATCHDOG'S OWN CASE, WHICH HAD NO TEST AT ALL.
 *
 * "A 1.5 s watchdog reports boot-framing-stalled telemetry and reveals the drawing anyway, so this
 * can never leave a blank canvas" was the ENTIRE safety argument for gating paint in the first
 * place. Nothing verified it, and on production it was false: the watchdog's effect early-returned
 * on `document.visibilityState !== "visible"` and its deps were `[framingCommitted, active]`, so in
 * a document that booted hidden its timer was NEVER ARMED — not fired late, never armed. A
 * watchdog that only runs when the thing it guards is already healthy is not a watchdog.
 *
 * This arm puts the app in the only state the watchdog exists for and takes away its other exit: a
 * container that can never be measured (the canvas wrap is forced to zero height, so every
 * `getBoundingClientRect()` is degenerate and a real framing is correctly impossible), in a
 * document that reads hidden. The ONLY thing that can reveal the canvas here is the watchdog, on a
 * wall clock. `setTimeout` is not rAF-driven so it is not rAF-suspended, but it IS clamped in a
 * background tab — so the bound allows for that clamp and still fails a deadline that never
 * arrives. Asserted on the INLINE style, which is exactly what the gate writes, so a zero-height
 * container cannot make the assertion unreadable. */
async function watchdogArm() {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 830 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  await ctx.addInitScript(`(() => { try {
    window.__planyrForceHidden = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__planyrForceHidden ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__planyrForceHidden });
  } catch (e) {} })();`);
  /* ⛔ THE CSS IS INJECTED INTO THE DOCUMENT ITSELF, not appended by a script, and the first
     version of this arm got that wrong in a way worth recording: an `addInitScript` that appends a
     <style> runs before the parser has built <head>, and React's module script mounts the planner
     (and runs its layout effect) before DOMContentLoaded — so the rule was never in the cascade
     when the container was measured. The arm read a healthy 430x773 wrap, framed normally, and
     printed ✅ for a watchdog that had not been involved at all. Injecting at the response makes
     the rule present from parse time, and the box assertion below is what catches it if it is not. */
  await ctx.route("**", (route) => {
    const req = route.request();
    if (!req.url().startsWith(BASE)) return route.abort();
    if (req.resourceType() !== "document") return route.continue();
    const html = readFileSync(join(DIST, "index.html"), "utf8").replace(
      "</head>",
      '<style>div:has(> svg[data-testid="planner-canvas"]){height:0!important;min-height:0!important;max-height:0!important;flex:0 0 0!important;}</style></head>',
    );
    return route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  const page = await ctx.newPage();
  const decoy = await ctx.newPage();
  await decoy.goto("about:blank");
  await decoy.bringToFront();
  await page.goto(`${BASE}#/project/bootframe/site`, { waitUntil: "load" }).catch(() => {});
  const t0 = Date.now();
  let revealedAt = null, box = null, firstInline = null;
  /* A WALL CLOCK, polled — the deadline under test is a wall clock, so the observation of it has to
     be one too. Generous enough to absorb a background tab's timer clamp; a watchdog that never
     arms cannot pass it however generous it is. */
  for (let i = 0; i < 24 && revealedAt === null; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const st = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="planner-canvas"]');
      if (!c) return null;
      const r = c.parentElement ? c.parentElement.getBoundingClientRect() : null;
      return { inline: c.style.visibility || "", computed: getComputedStyle(c).visibility,
               wrapW: r ? Math.round(r.width) : null, wrapH: r ? Math.round(r.height) : null };
    });
    if (st) {
      box = st;
      /* ⛔ B1600353 — IF THE CANVAS WAS NEVER HIDDEN, THERE IS NO WATCHDOG TO TEST, and this arm
         must say so instead of scoring a pass. On a gateless build (B1594320 reverted the gate) the
         inline `visibility` is empty from the very first sample, so "revealed at 250 ms" would be
         trivially true and would certify a watchdog that does not exist — the same false-green shape
         this whole rig is being repaired for. The FIRST sample decides which build we are on. */
      if (firstInline === null) firstInline = st.inline;
      if (st.inline !== "hidden") revealedAt = Date.now() - t0;
    }
  }
  await ctx.close();
  return { revealedAt, box, waitedMs: Date.now() - t0, gateAbsent: firstInline !== "hidden" };
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
const watchdog = await watchdogArm();
const control = await controlArm();

console.log("═".repeat(96));
console.log("verify-boot-framing — ONE FRAMING PER LOAD");
console.log("═".repeat(96));
console.log(`fixture: ${FIXTURE}   viewport 430×830   settle ${SETTLE_MS} ms`);
console.log(`target : ${REMOTE_BASE ? `${BASE}  (a DEPLOYED build — judging the bundle that actually shipped)` : "dist/ served locally"}\n`);

console.log("KNOWN-GOOD ARM (the rig must be able to SEE a framing change before its verdict means anything)");
if (control.ok) console.log(`  ✅ a deliberate pan produced a new painted framing (${control.beforeN} → ${control.afterN})\n`);
else console.log(`  ❌ a deliberate pan produced NO new painted framing (${control.beforeN} → ${control.afterN ?? "?"}) — this run is VACUOUS${control.why ? `: ${control.why}` : ""}\n`);

let failed = !control.ok;
for (const arm of arms) {
  const { name, report, ctx } = arm;
  console.log(`ARM: ${name}`);
  if (arm.reallyHidden !== undefined) {
    /* ⛔ B1600352 — THIS BLOCK USED TO STATE SOMETHING ITS OWN NUMBER CONTRADICTED. It printed the
     * hidden-phase frame count and captioned it "a de-prioritised frame loop, which is what makes
     * the suppression real rather than claimed". The number it was printing on this machine was
     * 280 frames in 5,000 ms — 56 fps, a frame loop running at FULL RATE. Nothing was
     * de-prioritised, and a run whose headline evidence line asserts the opposite of what it
     * measured is worse than one that measures nothing.
     *
     * The honest statement, which is also the stronger one: what this arm reproduces is the app's
     * own READ of `document.visibilityState`, not a throttled compositor. That makes the arm
     * STRICTER rather than weaker — a live frame loop gives the app every opportunity to notice
     * and correct itself, and an unrevealed canvas under those conditions cannot be explained away
     * as "rAF was suspended, so of course nothing happened". The arm says which of the two it got
     * and never dresses one up as the other. */
    console.log(`  document.visibilityState while booting : ${arm.reallyHidden}${arm.reallyHidden === "hidden" ? "  (the READ the app gates on, overridden for the whole boot)" : "  ⚠ the app did NOT read the document as hidden — this arm did not test what it claims"}`);
    if (arm.reallyHidden !== "hidden") { console.log("  ❌ this arm did not reproduce a hidden boot — VACUOUS"); failed = true; }
    const fps = arm.framesWhileHidden == null ? null : (arm.framesWhileHidden / (SETTLE_MS / 1000));
    console.log(`  animation frames while hidden          : ${arm.framesWhileHidden} in ${SETTLE_MS} ms${fps == null ? "" : ` (~${fps.toFixed(0)}/s — ${fps > 20 ? "a FULL-RATE loop, so the app had every chance to self-correct; this arm is stricter than a throttled one, not weaker" : "genuinely de-prioritised"})`}`);
  }
  if (arm.reveal) {
    /* The reveal assertion. Judged BEFORE this arm foregrounds anything, so nothing the harness
       does can rescue the build it is judging. */
    const rv = arm.reveal;
    const isBootDefault = rv.ppf === 0.35 && rv.offX === 60 && rv.offY === 60;
    console.log(`  canvas while still hidden             : visibility=${rv.visibility}  ppf=${rv.ppf} off=(${rv.offX}, ${rv.offY})${isBootDefault ? "  ⟵ the useState BOOT DEFAULT" : ""}`);
    console.log(`  elementFromPoint at an element centre : ${rv.hit ?? "null"}${rv.elId ? `  (asked about ${rv.elId})` : ""}`);
    if (!rv.canvas) { console.log("  ❌ no canvas at all — VACUOUS"); failed = true; }
    else if (!rv.els) { console.log("  ❌ the seeded plan painted NO elements — this arm cannot see the property it asserts (VACUOUS)"); failed = true; }
    else {
      if (rv.visibility !== "visible") { console.log(`  ❌ the canvas is still ${rv.visibility} — a load that began in a non-frontmost tab never revealed the drawing. This is a BLANK PLAN, which is strictly worse than the flash this gate exists to prevent (B1600352).`); failed = true; }
      if (isBootDefault) { console.log("  ❌ the canvas is still carrying the useState boot default — no framing was ever committed"); failed = true; }
      if (!rv.hit || String(rv.hit).startsWith("<")) { console.log(`  ❌ elementFromPoint at an element's own centre resolved to ${rv.hit ?? "null"}, not to an element — the plan is unclickable as well as unpainted`); failed = true; }
      if (!rv.anyInView) {
        console.log(`  ❌ every drawn element is OUTSIDE the canvas box (canvas x ${rv.canvasBox}) — the canvas is painted but the PLAN IS OFF-SCREEN. To the owner this reads as "my plan is gone", and it is worse than a blank canvas because it looks plausible (B1600352).`);
        rv.inView.forEach((b) => console.log(`       ${b.id}  x ${b.x}..${b.right}  inView=${b.inView}`));
        failed = true;
      }
      if (rv.visibility === "visible" && !isBootDefault && rv.hit && !String(rv.hit).startsWith("<")) console.log("  ✅ revealed, framed off the boot default, and hit-testable — all before this arm foregrounded anything");
    }
  }
  console.log(`  animation frames sampled : ${report.frames} (${report.visibleFrames} with the tab visible)`);
  console.log(`  planner mounts observed  : ${report.mounts}${arm.expectMounts ? ` (this arm needs ${arm.expectMounts} — one mount means the remount never happened and the arm proved nothing)` : ""}`);
  /* ⛔ B1600353 — the remount arm counts mounts through `data-planner-mount`, which only exists
     while B1574432's gate is in the build. On a gateless build it cannot count mounts at all, so it
     reports that rather than failing as vacuous — the arm's OTHER assertions (revealed, framed off
     the boot default, hit-testable, plan on screen) do not need the stamp and still gate. */
  if (arm.expectMounts && report.mounts < arm.expectMounts) {
    if (report.gateAbsent) console.log(`  ⊘ mounts are not countable in this build (no \`data-planner-mount\`) — the remount COUNT is not applicable; this arm's framing assertions still gate`);
    else { console.log("  ❌ the remount did not happen — this arm is VACUOUS"); failed = true; }
  }
  if (report.gateAbsent) console.log("  framing gate             : ABSENT in this build (no `data-planner-mount`, canvas never held unpainted) — the FLASH half is not applicable here; every other assertion below still gates");
  console.log(`  PAINTED framings         : ${report.paintedFramings}`);
  console.log(`  committed framings       : ${report.committedFramings}`);
  if (report.unpainted.length) console.log(`  held-but-never-painted   : ${report.unpainted.length} (the canvas carried a framing while deliberately unpainted — correct, and not counted)`);
  if (report.vacuous) report.vacuity.forEach((v) => console.log(`  ⚠ VACUOUS: ${v}`));
  framingLines(report.painted).forEach((l) => console.log(l));
  if (report.vacuous) { console.log("  ❌ this arm observed nothing — a run that cannot see the property does not get to score it"); failed = true; }
  else if (report.gateAbsent) console.log("  ⊘ flash verdict not applicable — this build has no framing gate to flash");
  else if (report.ok) console.log(`  ✅ every mount painted exactly one framing (${report.mounts} mount${report.mounts === 1 ? "" : "s"}, ${report.paintedFramings} framing${report.paintedFramings === 1 ? "" : "s"}) — the invariant holds`);
  else {
    report.offenders.forEach((o) => console.log(`  ❌ mount ${o.mount} painted ${o.framings} distinct framings — the user saw ${o.framings - 1} framing(s) that mount then threw away`));
    if (!report.offenders.length) console.log("  ❌ no framing could be attributed to a mount");
    failed = true;
  }
  console.log("");
  await ctx.close();
}

console.log("WATCHDOG ARM (container never measurable + document hidden — only the watchdog can reveal the canvas)");
console.log(`  canvas wrap box          : ${watchdog.box ? `${watchdog.box.wrapW}x${watchdog.box.wrapH}` : "?"} — must be degenerate on purpose, so a real framing is correctly impossible`);
/* ⛔ THE PRECONDITION, AND IT ALREADY EARNED ITS PLACE: without it this arm scored ✅ over a
   healthy 430x773 container that framed normally and never involved the watchdog at all. An arm
   that cannot put the app into the state it is asking about does not get to report a result. */
if (watchdog.gateAbsent) {
  console.log("  ⊘ the canvas was never hidden — this build has no hide-until-ready gate, so there is NO WATCHDOG to test. Not applicable; not a pass.\n");
} else if (!watchdog.box || watchdog.box.wrapH > 1) {
  console.log(`  ❌ the container was NOT degenerate (${watchdog.box ? `${watchdog.box.wrapW}x${watchdog.box.wrapH}` : "unreadable"}) — a real framing was possible, so this arm never exercised the watchdog. VACUOUS.`);
  failed = true;
} else if (watchdog.revealedAt === null) {
  console.log(`  ❌ the canvas was STILL unrevealed after ${watchdog.waitedMs} ms (inline visibility="${watchdog.box?.inline ?? "?"}"). The boot-framing watchdog never fired — the LOUD-FAILURE safety net that justifies gating paint at all does not exist in the one condition it was written for (B1600352).`);
  failed = true;
} else {
  console.log(`  ✅ the watchdog revealed the canvas after ${watchdog.revealedAt} ms on a wall clock, with the document reading hidden throughout\n`);
}

await browser.close();
server.close();
if (ASSERT && failed) process.exit(1);
