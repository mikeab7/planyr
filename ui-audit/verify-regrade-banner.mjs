/* verify-regrade-banner — NEW-1 (2026-11-04). The "Regrading…" banner in a real browser, on the owner's real Chehaw ground, through the
 * REAL GradingController + GradingCanvas + the real banner (ui-audit/harness/grading-harness.*, `?banner=1`). Typing a finished floor
 * is the rebuild. What it asserts (each is a line of the owner's spec):
 *   1  the banner appears centred at the bottom of the map area, with the bar RISING (the real work's fractions), then the new grade lands;
 *   2  NOTHING on the map changes while it shows: the map's own markup is byte-identical until the new surface arrives;
 *   3  it takes no presses (elementFromPoint through it hits the map) and lies clear of the left panel;
 *   4  it goes away (fade) after the work, never before MIN_VISIBLE;
 *   5  a typed floor that changes nothing (same value) rebuilds nothing and shows no banner;
 *   6  window.__plannerPerf() stays quiet with it showing (no long frame blamed on it) and the banner adds no rAF/timer of its own.
 * KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): `?banner=0` runs the identical rebuild with no banner mounted — the sampler must see
 * NO banner there and see the rebuild happen (surface key moved); otherwise the run is VOID (exit 2), never green.
 *   node ui-audit/verify-regrade-banner.mjs        (starts its own vite dev server on :5197) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5197, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
let void_ = null;

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
const stopVite = () => { try { process.kill(-vite.pid); } catch { try { vite.kill(); } catch {} } };
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errs = [];
  /* The CPU is throttled 4× (the same stand-in ui-audit/profile-planner-perf.mjs uses for a weak machine). Unthrottled, this whole regrade takes
   * ~450 ms on a fast box, too short for the surface build's progress to be observable; the owner's own machine is not a fast box. */
  const THROTTLE = +(process.env.THROTTLE || 4);
  const open = async (qs, throttle = THROTTLE) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html${qs}`);
    await assertMeasurable(page, "verify-regrade-banner");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    // settled: an FFE number, the earthwork priced, the contours traced for the current surface, no banner
    await page.waitForFunction(() => {
      const i = document.querySelector('[data-testid="grading-ffe"]'); const H = window.__harness; const m = H && H.model, s = H && H.gradeSurface;
      const ew = document.querySelector("[data-grading-earthwork]");
      return i && /\d/.test(i.value) && s && m && m.contours && m.contours.key === s.surfaceKey && ew && ew.getAttribute("data-grading-earthwork") !== "pending";
    }, null, { timeout: 240000 });
    await page.waitForTimeout(2500);
    return page;
  };
  /* sampler in the PAGE (paced by MessageChannel, never a clamped timer): every ~40 ms record the banner, the surface key, the map markup hash. */
  const startSampler = (page) => page.evaluate(() => {
    const out = window.__samples = [];
    const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
    const ids = new WeakMap(); let nid = 0; const idOf = (o) => { if (!o) return 0; if (!ids.has(o)) ids.set(o, ++nid); return ids.get(o); };
    const mc = new MessageChannel(); let stop = false; window.__stopSampler = () => { stop = true; };
    let last = 0;
    const loop = () => { if (stop) return; const t = performance.now(); if (t - last >= 40) { last = t;
      const b = document.querySelector('[data-testid="regrade-banner"]'); const H = window.__harness;
      out.push({ t, banner: !!b, phase: b && b.getAttribute("data-phase"), frac: b ? +b.getAttribute("data-regrade-frac") : null, indet: b ? b.getAttribute("data-regrade-indeterminate") : null,
        opacity: b ? +getComputedStyle(b.firstChild).opacity : null, surf: H && H.gradeSurface && H.gradeSurface.surfaceKey, mdl: idOf(H && H.model) + ":" + idOf(H && H.gradeSurface), map: hash(document.getElementById("canvas").innerHTML) }); }
      mc.port2.postMessage(0); };
    mc.port1.onmessage = loop; mc.port2.postMessage(0);
  });
  const typeFloor = async (page, v) => { await page.fill('[data-testid="grading-ffe"]', String(v)); await page.keyboard.press("Enter"); };

  // ================= known-good arm: no banner mounted, identical rebuild =================
  {
    const page = await open("?banner=0&contours=1&buildable=0");
    const k0 = await page.evaluate(() => window.__harness.gradeSurface.surfaceKey);
    await startSampler(page);
    await typeFloor(page, 803);
    await page.waitForFunction((k) => window.__harness.gradeSurface.surfaceKey !== k, k0, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const smp = await page.evaluate(() => window.__samples);
    if (smp.some((s) => s.banner)) void_ = "the no-banner arm saw a banner — the sampler's query is not about the banner";
    else if (new Set(smp.map((s) => s.surf)).size < 2) void_ = "the no-banner arm saw no rebuild — the instrument cannot see one";
    else check("known-good arm: same rebuild with no banner mounted — sampler sees the rebuild and NO banner", true, `${smp.length} samples`);
    await page.context().close();
  }

  if (!void_) {
    // ================= the real run =================
    const page = await open("?banner=1&contours=1&buildable=0&planyrDiag=1");
    const before = await page.evaluate(() => ({ key: window.__harness.gradeSurface.surfaceKey, map: (() => { const s = document.getElementById("canvas").innerHTML; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; })(), banner: !!document.querySelector('[data-testid="regrade-banner"]') }));
    check("settled and idle: no banner before any change", before.banner === false);
    // 5. a typed floor equal to the current one rebuilds nothing
    const cur = await page.inputValue('[data-testid="grading-ffe"]');
    await startSampler(page);
    await typeFloor(page, cur);
    await page.waitForTimeout(1500);
    let smp = await page.evaluate(() => window.__samples);
    check("5: re-typing the same floor rebuilds nothing and shows no banner", !smp.some((s) => s.banner) && new Set(smp.map((s) => s.surf)).size === 1, `${smp.length} samples`);
    await page.evaluate(() => window.__stopSampler());

    // 1-4, 6. a real change
    await page.evaluate(() => { window.__rafCalls = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { window.__rafCalls++; return r(f); }; });
    await startSampler(page);
    await page.screenshot({ path: ".perf/regrade-banner-before.png" });
    await typeFloor(page, 806);
    // grab a screenshot while the banner is up
    await page.waitForSelector('[data-testid="regrade-banner"]', { timeout: 240000 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: ".perf/regrade-banner-showing.png" });
    const geo = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="regrade-banner"]'); const pill = b && b.firstChild, r = pill && pill.getBoundingClientRect(), panel = document.getElementById("panel").getBoundingClientRect(), cv = document.getElementById("canvas").getBoundingClientRect();
      const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + 8) : null;
      return r ? { cx: r.left + r.width / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom, panelRight: panel.right, vw: innerWidth, vh: innerHeight, text: pill.innerText, hitTag: hit && (hit.closest("#canvas") ? "canvas" : hit.tagName), pe: getComputedStyle(pill).pointerEvents, peWrap: getComputedStyle(b).pointerEvents } : null;
    });
    check("3: the banner is a pill reading 'Regrading…'", !!geo && /Regrading…/.test(geo.text), geo && JSON.stringify(geo.text));
    check("1: centred horizontally in the map area (right of the left panel)", !!geo && Math.abs(geo.cx - (geo.panelRight + (geo.vw - geo.panelRight) / 2)) <= 2, geo && `centre ${Math.round(geo.cx)} vs map-area centre ${Math.round(geo.panelRight + (geo.vw - geo.panelRight) / 2)}`);
    check("1: sits at the bottom of the map (lower third of the window)", !!geo && geo.bottom > geo.vh * 0.8 && geo.bottom < geo.vh, geo && `bottom ${Math.round(geo.bottom)} of ${geo.vh}`);
    check("3: clear of the left panel", !!geo && geo.left > geo.panelRight);
    check("3: takes no presses — a press at the banner reaches the map under it", !!geo && geo.hitTag === "canvas" && geo.pe === "none" && geo.peWrap === "none", geo && `elementFromPoint → ${geo.hitTag}`);
    const k1 = before.key;
    await page.waitForFunction((k) => window.__harness.gradeSurface.surfaceKey !== k, k1, { timeout: 240000 });
    await page.waitForFunction(() => { const H = window.__harness; return H.model && H.model.contours && H.model.contours.key === H.gradeSurface.surfaceKey; }, null, { timeout: 240000 });
    await page.waitForTimeout(2500);   // MIN_VISIBLE + fade + settle
    smp = await page.evaluate(() => window.__samples);
    const rafCalls = await page.evaluate(() => window.__rafCalls);
    await page.evaluate(() => window.__stopSampler());
    if (process.env.DUMP) console.log(smp.filter((s) => s.banner || s.surf !== smp[0].surf).map((s) => `${Math.round(s.t)} ${s.phase} f=${s.frac} i=${s.indet} op=${s.opacity} m=${s.map}`).join("\n"));
    const shown = smp.filter((s) => s.banner && s.phase === "shown");
    check("1: the banner showed during the regrade", shown.length >= 3, `${shown.length} shown samples of ${smp.length}`);
    const fr = shown.map((s) => s.frac);
    let mono = true; for (let i = 1; i < fr.length; i++) if (fr[i] < fr[i - 1] - 1e-9) mono = false;
    check("1: the bar RISES with the real work (never backwards)", mono && fr[fr.length - 1] > fr[0], `${fr[0]} → ${fr[fr.length - 1]}`);
    check("1: the bar is determinate for at least part of the work (the chunked surface build reports real fractions)", shown.some((s) => s.indet === "0" && s.frac > 0 && s.frac < 1), `distinct fractions ${new Set(fr.map((x) => x.toFixed(2))).size}`);
    // 2. NOTHING ON THE MAP CHANGES because of the banner. The app's own picture legitimately swaps when the new surface / model lands; the banner
    //    appearing, rising and fading must never move a single node of the map. So: between any two consecutive samples where the app's model and
    //    surface are the SAME objects, the map markup is byte-identical — across the banner's whole life (mount, bar updates, fade, unmount).
    let flips = 0, pairs = 0, pairsWithBanner = 0;
    for (let i = 1; i < smp.length; i++) if (smp[i].mdl === smp[i - 1].mdl) { pairs++; if (smp[i].banner || smp[i - 1].banner) pairsWithBanner++; if (smp[i].map !== smp[i - 1].map) flips++; }
    check("2: the banner (mount, bar updates, fade, unmount) never changes the map — markup identical whenever the app's model is", flips === 0 && pairsWithBanner >= 10, `${pairsWithBanner} banner-adjacent sample pairs, ${pairs} in all, ${flips} map changes without a model change`);
    const mapHasBanner = await page.evaluate(() => !!document.querySelector('#canvas [data-testid="regrade-banner"]'));
    check("2: the banner is not part of the map's drawing (it lives outside the map's SVG)", !mapHasBanner);
    const oldSurf = smp[0].surf;
    const tShownFirst = shown[0].t;
    const leaving = smp.find((s) => s.phase === "leaving");
    check("4: it fades out afterwards (a 'leaving' phase with falling opacity), then is gone", !!leaving && smp[smp.length - 1].banner === false, leaving ? `opacity ${leaving.opacity}` : "never left");
    const lastShownT = [...smp].reverse().find((s) => s.banner).t;
    check("4: stayed up at least ~400 ms once shown", lastShownT - tShownFirst >= 400, `${Math.round(lastShownT - tShownFirst)} ms`);
    const swapped = smp.find((s) => s.surf !== oldSurf);
    check("2: then the new grade swaps in (the surface moved on)", !!swapped);
    // 6. quiet — judged below, in the passes that can judge it (an unthrottled pass, and a banner / no-banner A/B at the same throttle)
    const perfThrottled = await page.evaluate(() => (window.__plannerPerf ? window.__plannerPerf() : null));
    // the banner's own rAF: the app's chunked build uses a few; the banner must add none — compare against a no-banner page's count below
    const shownMs = Math.round(lastShownT - tShownFirst);
    console.log(`  (rAF calls during the whole regrade with the banner mounted: ${rafCalls}; banner visible ${shownMs} ms)`);
    await page.screenshot({ path: ".perf/regrade-banner-after.png" });
    await page.context().close();

    // rAF A/B: the same rebuild with no banner mounted must use the same number of rAF calls (±the sampler-free noise), i.e. the banner adds none
    const pageB = await open("?banner=0&contours=1&buildable=0");
    await pageB.evaluate(() => { window.__rafCalls = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { window.__rafCalls++; return r(f); }; });
    const kB = await pageB.evaluate(() => window.__harness.gradeSurface.surfaceKey);
    await startSampler(pageB);
    await typeFloor(pageB, 806);
    await pageB.waitForFunction((k) => window.__harness.gradeSurface.surfaceKey !== k, kB, { timeout: 240000 });
    await pageB.waitForFunction(() => { const H = window.__harness; return H.model && H.model.contours && H.model.contours.key === H.gradeSurface.surfaceKey; }, null, { timeout: 240000 });
    await pageB.waitForTimeout(2500);
    const rafB = await pageB.evaluate(() => window.__rafCalls);
    check("6: the banner adds no rAF of its own (same rebuild, banner unmounted: rAF calls comparable)", rafCalls <= rafB * 1.35 + 10, `with ${rafCalls} vs without ${rafB}`);
    await pageB.context().close();
  }
  if (!void_) {
    /* 6 (quiet). The owner's criterion: window.__plannerPerf() stays "quiet" during a rebuild with the banner showing. Two passes:
     *  (i)  UNTHROTTLED, banner mounted and actually shown: no long frame at all.
     *  (ii) at the 4× throttle, the SAME rebuild with and without the banner: the banner adds no long frame, and no extra blocking time. (Under 4×
     *       the rebuild's own render can make a long frame by itself; the A/B is what says whose it is.) */
    const onePass = async (banner, throttle) => {
      const page = await open(`?banner=${banner}&contours=1&buildable=0&planyrDiag=1`, throttle);
      const k = await page.evaluate(() => window.__harness.gradeSurface.surfaceKey);
      await page.evaluate(() => window.__plannerPerf());          // arm the census
      await startSampler(page);
      const t0 = await page.evaluate(() => performance.now());
      await typeFloor(page, banner ? 804 : 804);
      await page.waitForFunction((x) => window.__harness.gradeSurface.surfaceKey !== x, k, { timeout: 240000 });
      await page.waitForFunction(() => { const H = window.__harness; return H.model && H.model.contours && H.model.contours.key === H.gradeSurface.surfaceKey; }, null, { timeout: 240000 });
      await page.waitForTimeout(2200);
      const perf = await page.evaluate(() => window.__plannerPerf());
      const smp = await page.evaluate(() => window.__samples);
      await page.evaluate(() => window.__stopSampler());
      await page.context().close();
      return { perf, shown: smp.filter((x) => x.banner && x.phase === "shown").length };
    };
    const q = await onePass(1, 1);
    check("6: unthrottled, banner SHOWN (>=3 samples) and window.__plannerPerf() is quiet — no long frame", q.shown >= 3 && q.perf && q.perf.summary.longFrames === 0 && q.perf.verdict === "quiet", `shown ${q.shown} samples; ${JSON.stringify(q.perf && q.perf.summary)} verdict ${q.perf && q.perf.verdict}`);
    const w = await onePass(1, THROTTLE), n = await onePass(0, THROTTLE);
    console.log(`  (A/B at ${THROTTLE}× throttle — with banner: ${JSON.stringify(w.perf.summary)}; without: ${JSON.stringify(n.perf.summary)})`);
    check(`6: at ${THROTTLE}× the banner adds no long frame and no blocking time (A/B vs the same rebuild with no banner)`,
      w.shown >= 3 && w.perf.summary.longFrames <= n.perf.summary.longFrames && w.perf.summary.blockingMs <= n.perf.summary.blockingMs + 50, `with ${w.perf.summary.longFrames} long / ${w.perf.summary.blockingMs} ms blocking, without ${n.perf.summary.longFrames} / ${n.perf.summary.blockingMs}`);
  }
  check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  await browser.close();
} finally { stopVite(); }
if (void_) { console.error("VOID — " + void_); process.exit(2); }
console.log(notes.join("\n")); if (fails.length) { console.log("\n" + fails.join("\n")); process.exit(1); }
console.log(`\nregrade banner: ${notes.length} checks passed`);
