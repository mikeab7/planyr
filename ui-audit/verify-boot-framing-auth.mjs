#!/usr/bin/env node
/* verify-boot-framing-auth — THE SIGNED-IN BOOT, DRIVEN IN A SANDBOX. (B1574432)
 *
 * ⛔ THIS ARM IS THE ONE THAT DID NOT EXIST WHEN B1574432 SHIPPED, AND ITS ABSENCE IS WHY THAT
 * SHIPPED BROKEN. The boot flash rides a REMOUNT that only a signed-in boot performs: `applyUser`
 * bumps `loadEpoch` when the cloud pull settles, and `SitePlannerApp` keys the planner
 * `${activeSiteId}:${loadEpoch}`. The authoring session could not sign in from its sandbox, so it
 * drove a ROUTE CHANGE as a structural proxy, proved every arm green, and parked the real path as
 * `Verify: live, Blocker: auth`. The one path it could not drive is the one that took production
 * down. docs/incidents/B1594320-CANVAS-VISIBILITY-OUTAGE.md makes closing that gap requirement #1
 * for re-attempting the gate at all; ui-audit/lib/authRemount.mjs is how, and its header explains
 * why the two-event race is produced by the real supabase-js rather than simulated.
 *
 * ── THE TWO ARMS, AND WHAT EACH WOULD HAVE CAUGHT ───────────────────────────────────────────────
 *   resume    The ordinary signed-in cold load. The plan paints from the device cache, the cloud
 *             pull settles, the planner REMOUNTS over an already-painted plan — and that second
 *             mount must not paint the `useState` boot default on its way to the same framing.
 *             This is the flash the owner filmed, in the configuration he filmed it in.
 *   ceiling   The reveal ceiling must be measured from the FIRST mount of a plan, not restarted by
 *             each remount. B1574432's watchdog was a per-mount `setTimeout`, so "1.5 seconds"
 *             really meant "1.5 seconds since the most recent remount" and a repeating remount
 *             could postpone the reveal indefinitely — incident requirement #2, which #1686's
 *             branch also failed to meet. The container is forced degenerate so the ceiling is the
 *             ONLY thing that can reveal the canvas, and the deadline is then checked against the
 *             FIRST mount's clock with a remount in between.
 *
 * ⛔ EVERY ARM CARRIES A PRECONDITION THAT REFUSES TO SCORE. The failure shape this whole family
 * keeps producing is a verdict phrased as "nothing did the bad thing", which passes vacuously when
 * nothing happened at all. So: an arm that did not observe a SECOND MOUNT did not test a remount
 * and FAILS rather than printing a pass, and an arm whose container was not actually degenerate did
 * not test the ceiling and FAILS too.
 *
 * Run:  VITE_SUPABASE_URL=https://bootauth.supabase.co \
 *       VITE_SUPABASE_ANON_KEY=boot-framing-auth-dummy-key npm run build
 *       node ui-audit/verify-boot-framing-auth.mjs [--assert]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed, fixtureSeedMulti } from "./lib/planFixture.mjs";
import { BOOT_FRAMING_INIT, bootFramingReport, framingLines } from "./lib/bootFraming.mjs";
import { AUTH_FIXTURE, authSessionSeed, cloudCacheSeed, detectSupabase, supabaseRouteHandler } from "./lib/authRemount.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
const argv = process.argv.slice(2);
const ASSERT = argv.includes("--assert");
const FIXTURE = (argv.find((a) => a.startsWith("--fixture=")) || "").split("=")[1] || "goose-creek-plan1copy.json";
const SETTLE_MS = +((argv.find((a) => a.startsWith("--settle=")) || "").split("=")[1] || 6000);
/* Matches lib/bootFramingDeadline.js's BOOT_FRAMING_CEILING_MS. Read from the source rather than
   retyped, so the two cannot drift and a raised ceiling cannot quietly widen this assertion. */
const CEILING_MS = (() => {
  const src = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/bootFramingDeadline.js"), "utf8");
  const m = src.match(/BOOT_FRAMING_CEILING_MS\s*=\s*(\d+)/);
  if (!m) throw new Error("verify-boot-framing-auth: could not read BOOT_FRAMING_CEILING_MS from the source");
  return +m[1];
})();
/* A background tab CLAMPS `setTimeout`, and the incident's own live measurement recorded a 1500 ms
   timer firing at 2291 ms. The allowance covers that clamp and nothing more: a ceiling RESTARTED by
   a remount lands a further whole ceiling out, which this cannot absorb. */
const CLAMP_ALLOWANCE_MS = 2000;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("verify-boot-framing-auth: no dist/ build — run `npm run build` first (with the dummy Supabase env, see this file's header).");
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

/* ⛔ THE RUN'S OWN PRECONDITION, ASKED BEFORE ANY ARM. A build with no Supabase config has
 * `supabaseConfigured() === false`, so `onAuthChange` returns a no-op and there is NO AUTH PATH AT
 * ALL — every arm below would boot signed-out, observe one mount, and report exactly what a healthy
 * signed-in boot reports. That is the vacuity this harness exists to remove, so it is a hard failure
 * with the remedy named, never a skip. The host itself is read out of the bundle rather than pinned
 * here, so this runs against whatever build is in dist/ — CI's included. */
const SB = detectSupabase(DIST);
const fixture = JSON.parse(readFileSync(join(ROOT, "ui-audit", "fixtures", FIXTURE), "utf8"));
const seed = fixtureSeed(fixture, { id: "bootframe", name: "Boot framing", site: "Boot framing" });
/* Two plans, so the ceiling arm can force a REPEATING remount by alternating routes. */
const seed2 = fixtureSeedMulti([
  { fixture, id: "bootframe", name: "Boot framing", site: "Boot framing" },
  { fixture, id: "bootframe2", name: "Boot framing B", site: "Boot framing B" },
], "bootframe");
const LIVE_SITES = [
  { id: "bootframe", site: "Boot framing", name: "Boot framing" },
  { id: "bootframe2", site: "Boot framing B", name: "Boot framing B" },
];

const browser = await chromium.launch({
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-background-networking"],
});

async function newCtx({ degenerate = false, multi = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 830 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.route("**", supabaseRouteHandler({
    base: BASE,
    supabaseUrl: SB.url,
    liveSites: LIVE_SITES,
    onLocal: (route) => {
      /* The degenerate-container arm injects its CSS into the DOCUMENT RESPONSE, never through an
         `addInitScript` that appends a <style>: that script runs before the parser has built <head>,
         and React mounts the planner before DOMContentLoaded, so the rule would not be in the
         cascade when the container is measured — the arm would then read a healthy container, frame
         normally, and certify a ceiling it never involved. (This rig has made that exact mistake.) */
      if (!degenerate || route.request().resourceType() !== "document") return route.continue();
      const html = readFileSync(join(DIST, "index.html"), "utf8").replace(
        "</head>",
        '<style>div:has(> svg[data-testid="planner-canvas"]){height:0!important;min-height:0!important;max-height:0!important;flex:0 0 0!important;}</style></head>',
      );
      return route.fulfill({ status: 200, contentType: "text/html", body: html });
    },
  }));
  await ctx.addInitScript(multi ? seed2 : seed);
  await ctx.addInitScript(cloudCacheSeed());   // must follow the plan seed — it copies what that wrote
  await ctx.addInitScript(authSessionSeed({ ref: SB.ref, url: SB.url }));
  await ctx.addInitScript(BOOT_FRAMING_INIT);
  return ctx;
}

/* ---- arm 1: the ordinary signed-in cold load ---------------------------------------------- */
async function resumeArm() {
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-boot-framing-auth").catch((e) => { e.message = `[arm: resume] ${e.message}`; throw e; });
  await page.goto(`${BASE}#/project/bootframe/site`, { waitUntil: "load" });
  await page.waitForTimeout(SETTLE_MS);
  const state = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]');
    /* el-tier: one drawn ELEMENT's own node is the subject here — whether a press at its own centre
       reaches it, which is exactly what production could not do. The count beside it is this arm's
       vacuity precondition (an arm that painted no element cannot ask the question), never a census
       of what the plan contains — COUNT-EVERY-KIND's [data-feature] census is the tool for that. */
    const els = [...document.querySelectorAll("[data-el-id]")];
    if (!c) return { canvas: false };
    const cb = c.getBoundingClientRect();
    /* el-tier: one drawn ELEMENT's own node is the subject — whether a press at its own centre
       reaches it. `els.length` is this arm's vacuity precondition, not a plan census. */
    const el = els[0];
    let hit = null;
    if (el) {
      const b = el.getBoundingClientRect();
      const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const owner = t && t.closest ? t.closest("[data-el-id]") : null;
      hit = owner ? owner.getAttribute("data-el-id") : (t ? `<${(t.tagName || "?").toLowerCase()}>` : null);
    }
    const inView = els.slice(0, 3).some((e) => {
      const b = e.getBoundingClientRect();
      return b.right > cb.x && b.x < cb.right && b.bottom > cb.y && b.y < cb.bottom;
    });
    return { canvas: true, visibility: getComputedStyle(c).visibility, els: els.length, hit, inView,
             reveal: c.getAttribute("data-planner-reveal") || "" };
  });
  const raw = await page.evaluate(() => window.__bootFramingStop());
  await ctx.close();
  return { report: bootFramingReport(raw), state };
}

/* ---- arm 2: the ceiling, against a REPEATING remount ---------------------------------------
 *
 * ⛔ WHY THIS ARM ALTERNATES ROUTES INSTEAD OF JUST REMOUNTING ONCE. The incident names the failure
 * precisely: a per-mount deadline means "1.5 s since the MOST RECENT remount", so "a repeating
 * remount could postpone the reveal indefinitely". A single remount cannot distinguish the two
 * designs — it shifts the deadline by only the gap between the two mounts, which disappears inside
 * any allowance generous enough to cover a background tab's timer clamp. (The first cut of this arm
 * did exactly that, and a deliberately per-mount build passed it.) Remounts arriving FASTER than the
 * ceiling separate them completely: an absolute per-plan deadline still fires — a mount whose plan's
 * deadline has already passed arms a zero-length timer and reveals at once — while a per-mount one
 * never fires at all, for as long as the remounts keep coming.
 *
 * The container is forced degenerate throughout, so a real framing is correctly impossible and the
 * ceiling is the ONLY thing that can reveal the canvas.
 */
async function ceilingArm() {
  const ctx = await newCtx({ degenerate: true, multi: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}#/project/bootframe/site`, { waitUntil: "load" }).catch(() => {});
  const t0 = Date.now();
  const mounts = new Set();
  let firstMountAt = null, firstRevealAt = null, sawHidden = false, last = null;
  /* ~700 ms apart, comfortably inside the 1500 ms ceiling, for about four ceilings' worth. */
  for (let i = 0; i < 26; i++) {
    if (i && i % 5 === 0) {
      const to = (i / 5) % 2 ? "bootframe2" : "bootframe";
      await page.evaluate((h) => { window.location.hash = h; }, `#/project/${to}/site`);
    }
    await new Promise((r) => setTimeout(r, 140));
    const st = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="planner-canvas"]');
      if (!c) return null;
      const r = c.parentElement ? c.parentElement.getBoundingClientRect() : null;
      return { inline: c.style.visibility || "", mount: c.getAttribute("data-planner-mount") || "",
               reveal: c.getAttribute("data-planner-reveal") || "",
               wrapW: r ? Math.round(r.width) : null, wrapH: r ? Math.round(r.height) : null };
    });
    if (!st) continue;
    last = st;
    if (st.mount) { if (firstMountAt === null) firstMountAt = Date.now() - t0; mounts.add(st.mount); }
    if (st.inline === "hidden") sawHidden = true;
    else if (sawHidden && firstRevealAt === null) firstRevealAt = Date.now() - t0;
  }
  /* The FINAL state is the verdict: after four ceilings' worth of remounts arriving every ~700 ms,
     is the canvas the user is looking at revealed, or is it still waiting on a clock that keeps
     being restarted? */
  const finalState = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]');
    return c ? { inline: c.style.visibility || "", reveal: c.getAttribute("data-planner-reveal") || "",
                 wrapH: c.parentElement ? Math.round(c.parentElement.getBoundingClientRect().height) : null } : null;
  });
  const raw = await page.evaluate(() => (window.__bootFramingStop ? window.__bootFramingStop() : null));
  await ctx.close();
  const sampled = new Set([...(raw?.painted || []), ...(raw?.committed || [])].map((r) => r.mount).filter(Boolean));
  return { firstMountAt, firstRevealAt, box: last, finalState, sawHidden,
           waitedMs: Date.now() - t0, mounts: new Set([...mounts, ...sampled]).size };
}

if (!SB) {
  console.error("verify-boot-framing-auth: the built bundle in dist/ carries NO Supabase config, so `onAuthChange` is a no-op");
  console.error("and there is no signed-in boot to drive. Every arm would pass vacuously, so this run REFUSES to score.");
  console.error(`Rebuild with:  VITE_SUPABASE_URL=${AUTH_FIXTURE.suggestedUrl} VITE_SUPABASE_ANON_KEY=${AUTH_FIXTURE.suggestedKey} npm run build`);
  await browser.close();
  server.close();
  process.exit(ASSERT ? 1 : 2);
}

const resume = await resumeArm();
const ceiling = await ceilingArm();
await browser.close();
server.close();

let failed = false;
const W = 96;
console.log("═".repeat(W));
console.log("verify-boot-framing-auth — THE SIGNED-IN BOOT, DRIVEN IN A SANDBOX");
console.log("═".repeat(W));
console.log(`fixture: ${FIXTURE}   viewport 430×830   ceiling ${CEILING_MS} ms (read from the source)\n`);

console.log("PRECONDITION (a build with no Supabase config has no auth path at all — every arm below would be VACUOUS)");
console.log(`  ✅ the served bundle is Supabase-configured — ${SB.url} (read from the bundle, every request to it answered here)\n`);

console.log("ARM: resume (a signed-in cold load — the cloud pull settles and the planner REMOUNTS)");
console.log(`  planner mounts observed  : ${resume.report.mounts}`);
console.log(`  PAINTED framings         : ${resume.report.paintedFramings}`);
framingLines(resume.report.painted).forEach((l) => console.log(l));
if (resume.report.vacuous) { resume.report.vacuity.forEach((v) => console.log(`  ❌ VACUOUS: ${v}`)); failed = true; }
else if (!resume.state.canvas) { console.log("  ❌ no canvas at all — VACUOUS"); failed = true; }
else if (!resume.state.els) { console.log("  ❌ the seeded plan painted NO elements — this arm cannot ask its question (VACUOUS)"); failed = true; }
else if (resume.report.mounts < 2) {
  /* ⛔ THE PRECONDITION THAT MAKES THIS ARM MEAN ANYTHING. One mount means the resumed session never
     settled a cloud pull, so `loadEpoch` never bumped and no remount happened — the arm would then
     be reporting on an ordinary signed-out boot while claiming to test the signed-in one. */
  console.log(`  ❌ only ${resume.report.mounts} planner mount — the signed-in \`loadEpoch\` remount did NOT happen, so this arm tested an ordinary boot and proved nothing. VACUOUS.`);
  failed = true;
} else {
  console.log(`  ✅ the signed-in remount really happened (${resume.report.mounts} mounts — this is the configuration the owner filmed)`);
  if (resume.report.bootDefaultFlashes.length) {
    console.log(`  ❌ THE BOOT DEFAULT WAS PAINTED AND THEN THROWN AWAY, ${resume.report.bootDefaultFlashes.length} time(s) — the flash, on the real signed-in path:`);
    resume.report.bootDefaultFlashes.forEach((f) => console.log(`       ppf=0.35 off=(60, 60) at t=${f.at}ms, held ${f.heldMs}ms over ${f.samples} frame(s), then replaced  (mount ${f.mount || "?"})`));
    failed = true;
  } else console.log("  ✅ the boot default was never painted-then-replaced, on either mount");
  if (resume.report.offenders.length) {
    resume.report.offenders.forEach((o) => console.log(`  ❌ mount ${o.mount} painted ${o.framings} distinct framings — ${o.framings - 1} shown then thrown away`));
    failed = true;
  } else console.log(`  ✅ every mount painted exactly one framing (${resume.report.mounts} mounts, ${resume.report.paintedFramings} framings)`);
  if (resume.state.visibility !== "visible") { console.log(`  ❌ the canvas is ${resume.state.visibility} after a signed-in boot — the B1594320 outage shape`); failed = true; }
  if (resume.state.reveal !== "framed") { console.log(`  ❌ data-planner-reveal reads "${resume.state.reveal || "(empty)"}" — a healthy signed-in boot must be revealed BY ITS FRAMING, not by the ceiling`); failed = true; }
  if (!resume.state.inView || !resume.state.hit || String(resume.state.hit).startsWith("<")) {
    console.log(`  ❌ the plan is not on screen and hit-testable (inView=${resume.state.inView}, elementFromPoint=${resume.state.hit ?? "null"}) — revealed is not the same as showing the plan`);
    failed = true;
  } else console.log("  ✅ revealed by its framing, plan on screen, hit-testable");
}
console.log("");

console.log("ARM: ceiling (degenerate container + a REPEATING remount — only the ceiling can reveal the canvas)");
console.log(`  canvas wrap box          : ${ceiling.finalState ? `?x${ceiling.finalState.wrapH}` : "?"} — must be degenerate on purpose`);
console.log(`  planner mounts observed  : ${ceiling.mounts} over ${ceiling.waitedMs} ms (remounts every ~700 ms, well inside the ${CEILING_MS} ms ceiling)`);
console.log(`  first mount at           : ${ceiling.firstMountAt ?? "?"} ms`);
console.log(`  first reveal at          : ${ceiling.firstRevealAt ?? "never"} ms`);
console.log(`  FINAL state              : visibility="${ceiling.finalState?.inline || "(none — revealed)"}"  reveal="${ceiling.finalState?.reveal || "(empty)"}"`);
if (!ceiling.finalState || ceiling.finalState.wrapH > 1) {
  console.log("  ❌ the container was NOT degenerate — a real framing was possible, so the ceiling was never exercised. VACUOUS.");
  failed = true;
} else if (!ceiling.sawHidden) {
  console.log("  ❌ the canvas was never hidden — this build has no hide-until-ready gate, so there is no ceiling to test. VACUOUS.");
  failed = true;
} else if (ceiling.mounts < 4) {
  console.log(`  ❌ only ${ceiling.mounts} planner mounts in ${ceiling.waitedMs} ms — the repeating remount did not happen, so this arm cannot show a deadline surviving one. VACUOUS.`);
  failed = true;
} else if (ceiling.firstRevealAt === null || ceiling.finalState.inline === "hidden") {
  console.log(`  ❌ THE CANVAS IS STILL HIDDEN after ${ceiling.mounts} remounts across ${ceiling.waitedMs} ms. The ceiling is being RESTARTED by each remount, so a repeating remount postpones the reveal indefinitely — incident requirement #2 unmet, and this is the B1594320 outage shape (a permanently blank canvas).`);
  failed = true;
} else if (ceiling.finalState.reveal !== "ceiling") {
  console.log(`  ❌ revealed, but data-planner-reveal reads "${ceiling.finalState.reveal || "(empty)"}" rather than "ceiling" — something other than the ceiling opened the gate on a container that cannot be framed, so this arm did not test it. VACUOUS.`);
  failed = true;
} else {
  const budget = (ceiling.firstMountAt ?? 0) + CEILING_MS + CLAMP_ALLOWANCE_MS;
  console.log(`  ✅ the canvas is revealed by the CEILING after ${ceiling.mounts} remounts — the deadline is absolute per plan, so a repeating remount cannot postpone it`);
  if (ceiling.firstRevealAt > budget) {
    console.log(`  ❌ but the FIRST reveal landed at ${ceiling.firstRevealAt} ms, past ${Math.round(budget)} ms — measured from a later mount rather than the first`);
    failed = true;
  } else {
    console.log(`  ✅ and the first reveal landed at ${ceiling.firstRevealAt} ms — within ${CEILING_MS} ms of the FIRST mount (+${CLAMP_ALLOWANCE_MS} ms for a background tab's timer clamp)`);
  }
}
console.log("");

console.log(failed ? "VERDICT: ✗ FAIL" : "VERDICT: ✓ PASS");
if (ASSERT && failed) process.exit(1);
