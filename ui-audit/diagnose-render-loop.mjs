/* diagnose-render-loop.mjs — DRIVE THE OWNER'S REPORTED GESTURE AND NAME THE EFFECT THAT PUMPS.
 *
 * NEW-1 / NEW-2. The owner's 2026-09-19 session produced two React #185 crashes 58 seconds apart on
 * one loaded build (27671fa) while he was pinch-zooming and dragging a road's control points on a
 * located plan. De-minifying the deployed chunks at the reported offsets named both throw sites
 * exactly — the `setGeoZoom` dispatch inside the geo-registration layout effect's `commit`
 * (SitePlannerApp chunk), and the `setCrumbCompact` dispatch inside ProjectBreadcrumb's crumb-fit
 * layout effect (AppHeader chunk). What no stack could say is WHY either effect kept re-running.
 *
 * This is the instrument for that question, and it is the whole reason this item was not
 * pattern-matched and patched. It drives the real gesture in a real browser at phone width with real
 * touch events, then reads `window.__planyrLoopProbe()` — the per-effect run counter and the
 * per-dependency churn verdict from src/app/renderLoopProbe.js. A dependency reported as
 * `identity-only` is a value-identical replacement object: the effect re-ran for no reason, which is
 * the B1189 signature and is a pump by definition.
 *
 * FOREGROUND-OR-VOID: every measurement here is taken through `assertMeasurable`, because a
 * background tab suspends rAF and a pinch driven against a suspended frame loop reports a gesture
 * that never happened.
 *
 * Usage:  node ui-audit/diagnose-render-loop.mjs [--url http://localhost:4173] [--keep]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const URL = arg("--url", process.env.PLANYR_URL || "http://localhost:4173");
const CPU = Number(arg("--cpu", "1")) || 1;          // CDP CPU throttling multiplier — a phone is slow, and slowness is what denies React its eager-bailout
const ROUNDS = Number(arg("--rounds", "6")) || 6;
const WIDTHS = (arg("--widths", "390") || "390").split(",").map((n) => Number(n.trim())).filter(Boolean);
const HARNESS = "diagnose-render-loop";

const SITE_ID = "e2eLoop1";
const P1 = "pLoop1";
/* A located plan: a real origin (Katy, TX — the shared coordinate spine's own zone) plus a parcel, so
 * the basemap is created, the geo-registration effect has an `origin` to register against, and the
 * view frames on something. The reported case is a LOCATED plan; on an unlocated one the whole effect
 * returns at its `!origin` guard and the case under test does not exist. */
const locatedSite = () => ({
  id: SITE_ID, groupId: SITE_ID, site: "Render loop repro", name: "Phase II - TAS R1",
  origin: { lat: 29.7869, lon: -95.8244 },
  county: "harris",
  parcels: [{ id: P1, points: [{ x: 120, y: 80 }, { x: 1320, y: 80 }, { x: 1320, y: 880 }, { x: 120, y: 880 }], locked: true }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, updatedAt: Date.now(),
});

/* Two-finger pinch through CDP, which is the only way to produce a real multi-touch TouchList.
 * The planner reads `e.touches` off NATIVE touch events (B555 — pointer events are unreliable for
 * multi-touch on iOS), so a synthesised pointer pair exercises nothing. */
async function pinch(cdp, cx, cy, fromGap, toGap, steps = 12) {
  const pts = (gap) => ([
    { x: cx - gap / 2, y: cy, id: 1 },
    { x: cx + gap / 2, y: cy, id: 2 },
  ]);
  const send = (type, gap) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : pts(gap).map((p) => ({ x: p.x, y: p.y, id: p.id })),
  });
  await send("touchStart", fromGap);
  for (let i = 1; i <= steps; i++) {
    await send("touchMove", fromGap + ((toGap - fromGap) * i) / steps);
  }
  await send("touchEnd", toGap);
}

/* A one-finger drag, used for the road control-point drag. */
async function touchDrag(cdp, from, to, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const fmtReport = (rows) => (rows.length
  ? rows.map((r) => {
    const deps = r.deps.length
      ? r.deps.map((d) => `        ${d.dep.padEnd(14)} identity-only ${String(d.identityOnly).padStart(4)}   value ${String(d.value).padStart(4)}   presence ${d.presence}`).join("\n")
      : "        (under the suspect threshold — no per-dependency classification)";
    return `    ${r.site}  —  ${r.runs} runs in the last ${r.windowMs} ms\n${deps}`;
  }).join("\n")
  : "    (nothing running hot)");

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, hasTouch: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e && e.message || e)));
  page.on("console", (m) => { if (m.type() === "error" && /update depth|React error #185/i.test(m.text())) crashes.push(m.text()); });

  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("e2e:seeded:" + id)) return;
    localStorage.setItem("e2e:seeded:" + id, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, locatedSite()]);

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // The app boots to a Dashboard landing page; reach the planner through its module tab.
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.waitFor({ state: "visible", timeout: 30_000 });
  await tab.click();
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 30_000 });
  await pacedWait(page, 1200);
  await assertMeasurable(page, "diagnose-render-loop");

  // ── Draw a real road with the real tool, at desktop width where the toolbar is not collapsed.
  // A hand-seeded road element would be a guess at `vtx`/`travelW`/`curb`/bbox; the tool is the
  // only thing that knows the current shape, and a road whose control points the drag must find is
  // the whole point of the case.
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).first().click();
  await page.mouse.click(box.x + 300, box.y + 420);
  await page.mouse.click(box.x + 620, box.y + 420);
  await page.mouse.click(box.x + 900, box.y + 250);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const roadCount = await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const s = m[Object.keys(m)[0]] || {};
    return (s.els || []).filter((e) => e.type === "road").length;
  });
  if (roadCount < 1) throw new Error("PRECONDITION FAILED: no road was drawn — the case under test needs a real road, so this run is VOID rather than green");

  const cdp = await ctx.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  // ── Phone width. The crash was caught on an iPhone, and the breadcrumb-fit effect under test
  // only mounts its measurement at narrow widths (`if (!narrow || !planSlot || !rowRef) return`).
  const PHONE_W = WIDTHS[0];
  await page.setViewportSize({ width: PHONE_W, height: 844 });
  await pacedWait(page, 900);
  await assertMeasurable(page, "diagnose-render-loop");

  const phoneBox = await page.getByTestId("planner-canvas").boundingBox();
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const cx = phoneBox.x + phoneBox.width / 2;
  const cy = phoneBox.y + phoneBox.height / 2;

  await page.evaluate(() => window.__planyrLoopProbeReset && window.__planyrLoopProbeReset());

  /* ⛔ THE CRUX MEASUREMENT: runs WITHIN ONE ANIMATION FRAME, not runs per second.
   *
   * React's #185 counts NESTED commits — a commit whose layout effects synchronously schedule
   * another commit, 50 deep, all inside one frame with no yield. A busy effect that runs twice per
   * frame for a second is 120 runs/s and can never trip it; an effect that runs 50 times inside ONE
   * frame trips it every time. Those two are indistinguishable in a per-second count, so the
   * per-second number alone cannot say whether a hot site is the PUMP or merely a passenger.
   * Sampled from a rAF loop installed by the HARNESS (never shipped), so no product code changes to
   * take this reading. */
  await page.evaluate(() => {
    window.__frameRuns = { max: {}, seq: 0 };
    let prev = {};
    const tick = () => {
      const rows = (window.__planyrLoopProbe && window.__planyrLoopProbe({ limit: 8 })) || [];
      const now = {};
      for (const r of rows) now[r.site] = r.runs;
      for (const site of Object.keys(now)) {
        const d = now[site] - (prev[site] || 0);
        if (d > 0) window.__frameRuns.max[site] = Math.max(window.__frameRuns.max[site] || 0, d);
      }
      prev = now;
      window.__frameRuns.seq++;
      window.__rafId = requestAnimationFrame(tick);
    };
    window.__rafId = requestAnimationFrame(tick);
  });

  // ── The reported gesture: pinch in and out several times, then drag a road control point.
  const hot = [];
  for (let round = 0; round < ROUNDS; round++) {
    await pinch(cdp, cx, cy, 120, 300);
    const afterZoomIn = await page.evaluate(() => window.__planyrLoopProbe && window.__planyrLoopProbe());
    hot.push(["pinch-in", afterZoomIn || []]);
    await pinch(cdp, cx, cy, 300, 120);
    const afterZoomOut = await page.evaluate(() => window.__planyrLoopProbe && window.__planyrLoopProbe());
    hot.push(["pinch-out", afterZoomOut || []]);

    // Select the road so its control-point handles mount, then drag one. `__plannerHitTarget` is the
    // app's OWN resolution (E2E-gated, read-only) — a harness re-implementing the hit rule tests its
    // own copy of it.
    const grip = await page.evaluate(() => {
      const h = document.querySelector('[data-handle-layer="1"] [data-vtx], [data-handle-layer="1"] .vtx-handle, [data-handle-layer="1"] rect, [data-handle-layer="1"] circle');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const roadNode = await page.locator('[data-feature^="el:"]').first().boundingBox().catch(() => null);
    if (roadNode) {
      await touchDrag(cdp, { x: roadNode.x + roadNode.width / 2, y: roadNode.y + roadNode.height / 2 }, { x: roadNode.x + roadNode.width / 2 + 3, y: roadNode.y + roadNode.height / 2 + 3 }, 3);
      await pacedWait(page, 120);
    }
    if (grip) {
      await touchDrag(cdp, grip, { x: grip.x + 26, y: grip.y - 18 });
      await pacedWait(page, 150);
    }
    const afterDrag = await page.evaluate(() => window.__planyrLoopProbe && window.__planyrLoopProbe());
    hot.push(["control-point-drag", afterDrag || []]);

    const dead = await page.getByTestId("boundary-error").count();
    if (dead || crashes.length) break;
  }

  await assertMeasurable(page, "diagnose-render-loop");
  const boundaryShown = await page.getByTestId("boundary-error").count();
  const canvasAlive = await page.getByTestId("planner-canvas").count();

  console.log(`\n=== ${HARNESS} — ${URL} ===`);
  console.log(`road drawn: ${roadCount}   canvas alive: ${canvasAlive ? "yes" : "NO"}   error-boundary card: ${boundaryShown ? "SHOWN" : "no"}`);
  console.log(`#185 / update-depth events seen: ${crashes.length}`);
  for (const c of crashes.slice(0, 3)) console.log(`    ${c.slice(0, 180)}`);
  console.log("\n--- render-loop probe, per gesture phase ---");
  for (const [phase, rows] of hot) {
    console.log(`\n  [${phase}]`);
    console.log(fmtReport(rows));
  }

  const verdictRows = hot.flatMap(([, rows]) => rows);
  const pumps = verdictRows.filter((r) => r.deps.some((d) => d.identityOnly > 0));
  const frameRuns = await page.evaluate(() => { cancelAnimationFrame(window.__rafId); return window.__frameRuns; });
  console.log("\n--- runs INSIDE a single animation frame (React's #185 counts nested commits, which all land in one frame) ---");
  console.log(`    frames sampled: ${frameRuns.seq}`);
  for (const [site, n] of Object.entries(frameRuns.max).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${site.padEnd(34)} worst single frame: ${n} runs   ${n >= 50 ? "← NESTED CHAIN (this is what trips #185)" : n > 4 ? "← bursty" : ""}`);
  }

  console.log("\n--- VERDICT ---");
  if (pumps.length) {
    for (const p of pumps) {
      const worst = p.deps.filter((d) => d.identityOnly).sort((a, b) => b.identityOnly - a.identityOnly)[0];
      console.log(`  PUMP: ${p.site} re-ran ${p.runs}× with \`${worst.dep}\` changing IDENTITY ONLY ${worst.identityOnly}× (a value-identical replacement object).`);
    }
  } else {
    console.log("  No identity-only dependency churn observed at any instrumented site.");
  }

  const failed = crashes.length > 0 || boundaryShown > 0 || canvasAlive === 0;
  console.log(`\n  RESULT: ${failed ? "RED — the planner crashed or was replaced by the boundary" : "GREEN — the planner survived the gesture"}`);

  if (!process.argv.includes("--keep")) await browser.close();
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
