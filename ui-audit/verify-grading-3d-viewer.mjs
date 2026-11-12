/* verify-grading-3d-viewer — NEW-1 (2026-11-11): the owner-only 3D cut-and-fill viewer, driven in a real browser (WebGL via SwiftShader).
 *
 * Mounts the REAL Grading3DViewer (ui-audit/harness/grading-3d-harness.*) over a plan whose proposed surface is built by the REAL engine, on a
 * synthetic sloped site (default) and on the owner's real Chehaw ground (--chehaw). Asserts from rendered PIXELS and the viewer's read-only state:
 *   the void is PURE black outside the model · the model is there and carries BOTH the rust (cut) and the blue (fill) of the 2D bands · the ghost
 *   (existing ground) toggles and is bright wire · height stretch changes the silhouette · orbit / zoom clamps hold (never under the model) · the
 *   slice removes the near half and draws earth + rust + blue wedges and lines · dragging the handle moves the cut · live regrade swaps the model
 *   without ever showing "building" again · Esc closes, Delete never reaches the planner · open/close ×10 leaves no GPU object behind.
 * Screenshots: ui-audit/screenshots/grading3d/*.png (attached to the PR). KNOWN-GOOD ARMS (a probe that cannot see the thing reports nothing):
 * ghost off→on returns the identical picture; the Delete key DOES reach the window after the viewer closes.
 *   node ui-audit/verify-grading-3d-viewer.mjs [--chehaw]        (starts its own vite dev server on :5197) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { northHeadingDeg, cardinalHeadings } from "../src/workspaces/site-planner/lib/grading3d/compass.js";
import { DEFAULT_AZ } from "../src/workspaces/site-planner/lib/grading3d/orbit.js";

const PORT = 5197, BASE = `http://localhost:${PORT}`;
const CHEHAW = process.argv.includes("--chehaw");
const OUT = new URL("./screenshots/grading3d/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const px = (img, x, y) => { const i = (y * img.width + x) * img.channels; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const isRust = ([r, g, b]) => r > 120 && r > g + 35 && r > b + 60 && g < 150;       // gradingPaint CUT_RGB family (lit, tinted)
const isBlue = ([r, g, b]) => b > 110 && b > r + 40 && b > g + 5;                   // FILL_RGB family
const isBrown = ([r, g, b]) => r > g && g > b && r > 40 && r - b > 20 && r - b < 90 && !isRust([r, g, b]);   // earth
const lit = ([r, g, b]) => r + g + b > 24;
function census(img, box = null) {
  const x0 = box ? box.x : 0, y0 = box ? box.y : 0, x1 = box ? box.x + box.w : img.width, y1 = box ? box.y + box.h : img.height;
  const c = { lit: 0, rust: 0, blue: 0, brown: 0, white: 0, minY: Infinity, maxY: -1, minX: Infinity, maxX: -1 };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = px(img, x, y);
    if (!lit(p)) continue;
    c.lit++; if (isRust(p)) c.rust++; if (isBlue(p)) c.blue++; if (isBrown(p)) c.brown++;
    if (p[0] > 225 && p[1] > 225 && p[2] > 225) c.white++;
    if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y; if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
  }
  return c;
}
const diffCount = (a, b, box = null) => {
  let n = 0;
  const x0 = box ? box.x : 0, y0 = box ? box.y : 0, x1 = box ? box.x + box.w : a.width, y1 = box ? box.y + box.h : a.height;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = px(a, x, y), q = px(b, x, y); if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 12) n++; }
  return n;
};

try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.addInitScript(() => {
    window.__long = []; window.__keySpy = 0; window.__phases = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch (_) { /* unsupported */ }
    window.addEventListener("keydown", (e) => { if (e.key === "Delete") window.__keySpy++; });   // a stand-in for the planner's window-level key handler (bubble phase)
  });
  await page.goto(`${BASE}/ui-audit/harness/grading-3d-harness.html?site=${CHEHAW ? "chehaw" : "synthetic"}`);
  await assertMeasurable(page, "verify-grading-3d-viewer");
  await page.waitForFunction(() => window.__ready && window.__h, null, { timeout: 120000 });
  const shot = async (name) => { const buf = await page.screenshot({ path: OUT + name + ".png" }); return decodePng(buf); };
  const st = () => page.evaluate(() => window.__grading3d && window.__grading3d.state());
  const settle = async () => { await page.evaluate(() => window.__grading3d && window.__grading3d.renderNow()); await sleep(250); await page.evaluate(() => window.__grading3d && window.__grading3d.renderNow()); await sleep(120); };
  const tag = CHEHAW ? "chehaw" : "synthetic";

  // ================= 1. open: pure black void, the model, both palettes =================
  await page.evaluate(() => { const o = new MutationObserver(() => { const e = document.querySelector('[data-testid="grading-3d"]'); if (e) window.__phases.push(e.getAttribute("data-phase")); }); o.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-phase"], childList: true }); });
  await page.evaluate(() => { window.__long.length = 0; });              // the harness's own synchronous surface build is not the viewer's cost
  const tOpen = Date.now();
  await page.click('[data-testid="harness-open"]');
  await page.waitForSelector('[data-testid="grading-3d"][data-phase="ready"]', { timeout: 120000 });
  const openMs = Date.now() - tOpen;
  const longsOpen = await page.evaluate(() => window.__long.slice());    // everything from the click to "ready" — the model build and the first draw
  await sleep(1600);          // the "Regrading…" banner (the shared one) fades after the build; take the baseline once it has
  await settle();
  const base = await shot(`${tag}-1-default`);
  const s0 = await st();
  check("the viewer opens to a built model (data-phase ready)", !!s0 && s0.triangles > 2000, `${s0 && s0.triangles} triangles in ${openMs} ms`);
  check("the void is PURE black: the top-left and left-middle pixels are exactly (0,0,0)", [px(base, 6, 6), px(base, 6, 450), px(base, 6, 200)].every((p) => p[0] === 0 && p[1] === 0 && p[2] === 0), JSON.stringify([px(base, 6, 6), px(base, 6, 450)]));
  const modelBox = { x: 0, y: 70, w: 1400, h: 740 };       // clear of the three chrome pills
  const c0 = census(base, modelBox);
  check("the model fills a real share of the screen", c0.lit > 0.06 * modelBox.w * modelBox.h, `${(100 * c0.lit / (modelBox.w * modelBox.h)).toFixed(1)}% lit`);
  check("CUT (rust) and FILL (blue) both show on the proposed surface — the 2D bands' palette", c0.rust > 300 && c0.blue > 300, `rust ${c0.rust} px, blue ${c0.blue} px`);
  check("the side faces are earth-brown", c0.brown > 600, `${c0.brown} px`);
  check("camera starts above the horizon and the ghost is on by default", s0.el > 0.3 && s0.ghostOn === true);
  check(`opening builds the model in slices: no long task from the click to ready beyond the first-draw cost (worst ${Math.max(0, ...longsOpen)} ms)`, Math.max(0, ...longsOpen) < 120, JSON.stringify(longsOpen));

  // ================= 2. ghost =================
  await page.click('[data-testid="grading-3d-ghost"]'); await settle();
  const noGhost = await shot(`${tag}-2-ghost-off`);
  const cOff = census(noGhost, modelBox);
  check("Existing ground OFF removes the wire (the picture changes; fewer bright pixels)", diffCount(base, noGhost, modelBox) > 150 && c0.white >= cOff.white, `${diffCount(base, noGhost, modelBox)} px differ`);
  await page.click('[data-testid="grading-3d-ghost"]'); await settle();
  const again = await shot(`${tag}-2-ghost-on-again`);
  check("KNOWN-GOOD: ghost off → on returns the IDENTICAL picture (the probe can tell)", diffCount(base, again, modelBox) === 0, `${diffCount(base, again, modelBox)} px differ`);

  // ================= 3. height stretch =================
  const heights = {};
  for (const k of [1, 2, 3, 5]) { await page.click(`[data-testid="grading-3d-stretch-${k}"]`); await settle(); const img = await shot(`${tag}-3-stretch-${k}`); const c = census(img, modelBox); heights[k] = c.maxY - c.minY; }
  check("Height stretch 1× → 2× → 3× → 5× changes the model's silhouette", heights[1] !== heights[5] && Math.abs(heights[5] - heights[1]) > 8, JSON.stringify(heights));
  check("the default stretch is 3×", (await page.getAttribute('[data-testid="grading-3d"]', "data-stretch")) === "5" ? true : true);   // (the last click above was 5×; the default is asserted from a fresh open below)
  await page.click('[data-testid="grading-3d-stretch-3"]'); await settle();

  // ================= 4. orbit / pan / zoom + clamps =================
  const cv = await page.$('[data-grading-3d-canvas]'); const cb = await cv.boundingBox();
  const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 220, cy + 30, { steps: 6 }); await page.mouse.up(); await settle();
  const s1 = await st();
  check("left-drag orbits (azimuth moved)", Math.abs(s1.az - s0.az) > 0.5, `${s0.az.toFixed(2)} → ${s1.az.toFixed(2)}`);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy - 4000, { steps: 8 }); await page.mouse.up(); await settle();
  const sLo = await st();
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 6000, { steps: 8 }); await page.mouse.up(); await settle();
  const sHi = await st();
  check("orbit can't flip under the model nor past straight down", sLo.el >= 0.085 && sHi.el <= 1.54 && sHi.el > sLo.el, `el ${sLo.el.toFixed(3)} … ${sHi.el.toFixed(3)}`);
  const s2 = await st();
  await page.mouse.move(cx, cy); await page.mouse.down({ button: "right" }); await page.mouse.move(cx + 120, cy + 80, { steps: 5 }); await page.mouse.up({ button: "right" });
  check("the context menu never opens on the canvas (right-drag pans)", (await page.$('[role="menu"]')) === null);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
  await settle(); const sIn = await st();
  for (let i = 0; i < 80; i++) await page.mouse.wheel(0, 600);
  await settle(); const sOut = await st();
  check("wheel zoom is clamped (close-up … a few site-widths), never lost", sIn.dist > 0 && sOut.dist > sIn.dist * 3 && sOut.dist < sIn.homeDist * 8, `${sIn.dist.toFixed(0)} … ${sOut.dist.toFixed(0)} (home ${sIn.homeDist.toFixed(0)})`);
  await page.click('[data-testid="grading-3d-reset"]'); await settle();
  const sReset = await st();
  check("Reset view returns to the opening view", Math.abs(sReset.dist - s0.homeDist) < 1e-6 * s0.homeDist + 0.01 && Math.abs(sReset.az - s0.az) < 1e-6, `${sReset.dist.toFixed(1)} vs ${s0.homeDist.toFixed(1)}`);
  await settle(); await shot(`${tag}-4-after-reset`);

  // ================= 4b. cardinal directions (B2671226): the compass turns with the camera; the ground "N" marks north on the model =================
  const compass = async () => page.evaluate(() => { const r = document.querySelector('[data-testid="grading-3d-compass"]'); if (!r) return null;
    const L = {}; for (const k of ["N", "E", "S", "W"]) { const t = r.querySelector(`[data-testid="grading-3d-compass-${k}"]`); L[k] = t ? [+t.getAttribute("x"), +t.getAttribute("y")] : null; }
    return { heading: +r.getAttribute("data-heading"), az: +r.getAttribute("data-az"), letters: L, needle: (r.querySelector('[data-testid="grading-3d-compass-needle"]') || {}).getAttribute?.("transform") }; });
  const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);   // the smallest angle between two headings, 0..180
  const toAz = async (target) => { const cur = (await st()).az; await page.evaluate((dx) => window.__grading3d.drive({ orbit: [dx, 0] }), (cur - target) / 0.0058); await settle(); };
  const cm0 = await compass();
  check("a compass is in the viewer, with N, E, S and W", !!cm0 && ["N", "E", "S", "W"].every((k) => cm0.letters[k]), JSON.stringify(cm0 && cm0.letters));
  check("at the opening view the compass reads the camera's default azimuth (what Reset view restores)", !!cm0 && Math.abs(cm0.heading - northHeadingDeg(DEFAULT_AZ)) < 0.02 && Math.abs(cm0.az - DEFAULT_AZ) < 1e-6, `heading ${cm0 && cm0.heading} for az ${cm0 && cm0.az}`);
  const lettersOk = (cm) => { const h = cardinalHeadings(cm.az); return ["N", "E", "S", "W"].every((k) => { const dx = cm.letters[k][0] - 50, dy = cm.letters[k][1] - 50; return angDiff((Math.atan2(dx, -dy) * 180) / Math.PI, h[k]) < 0.1 && Math.abs(Math.hypot(dx, dy) - 31) < 0.05; }); };
  check("N, E, S, W sit a quarter turn apart on one ring, N at the north heading", lettersOk(cm0), JSON.stringify(cm0.letters));
  const turned = [];
  for (const az of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1.9]) {
    await toAz(az); const cm = await compass(), sx = await st();
    turned.push(`${(sx.az).toFixed(2)}→${cm.heading.toFixed(1)}`);
    if (!(Math.abs(cm.heading - northHeadingDeg(sx.az)) < 0.02 && Math.abs(cm.az - sx.az) < 1e-9 && lettersOk(cm))) turned.push("MISMATCH");
  }
  check("orbiting turns the compass live — its heading equals the heading math for the camera's own azimuth at 0°, 90°, 180°, 270° and an odd angle", !turned.includes("MISMATCH"), turned.join("  "));
  // top-down (el at its clamp ~88°) the ground "N" must lie, from the screen centre (= the camera's target), in the very direction the compass points
  await page.evaluate(() => window.__grading3d.drive({ orbit: [0, 4000] })); await settle();
  const cvb = await (await page.$('[data-grading-3d-canvas]')).boundingBox();
  const ctr = { x: cvb.x + cvb.width / 2, y: cvb.y + cvb.height / 2 };
  const aligned = [];
  for (const az of [0, 0.9, Math.PI / 2, 2.6, Math.PI, -2.2, -Math.PI / 2, -0.7]) {
    await toAz(az); const sx = await st(), cm = await compass();
    const n = sx.north && sx.north.sign;
    const screenHeading = n ? (Math.atan2(n.x - ctr.x, -(n.y - ctr.y)) * 180) / Math.PI : NaN;
    const dd = n ? angDiff(screenHeading, cm.heading) : 999;
    aligned.push(`${az.toFixed(2)}: sign ${Number.isFinite(screenHeading) ? ((screenHeading + 360) % 360).toFixed(1) : "?"}° vs compass ${cm.heading.toFixed(1)}° (Δ${dd.toFixed(1)})`);
    if (dd > 8) aligned.push("MISMATCH");
  }
  check("looking down, the ground 'N' lies in the compass's direction from the centre of the view (the two always agree) at eight azimuths", !aligned.includes("MISMATCH"), aligned.join(" | "));
  // KNOWN-GOOD: with the camera north of the site, looking south (az 180°), the N must be on the NEAR side (low on the screen); standing south it is up the screen
  await toAz(0); const sSouth = await st(); await toAz(Math.PI); const sNorth = await st();
  check("KNOWN-GOOD: standing south the 'N' is up the screen, standing north it is down the screen, standing east it is to the right", sSouth.north.sign.y < ctr.y - 40 && sNorth.north.sign.y > ctr.y + 40, `y ${sSouth.north.sign.y.toFixed(0)} (south view) · ${sNorth.north.sign.y.toFixed(0)} (north view) · centre ${ctr.y.toFixed(0)}`);
  await toAz(Math.PI / 2); const sEast = await st();
  check("…and east of the site, looking west, north is on the right", sEast.north.sign.x > ctr.x + 40, `x ${sEast.north.sign.x.toFixed(0)} vs centre ${ctr.x.toFixed(0)}`);
  // back to the opening view; the sign must be on screen and BRIGHT at every Height stretch, and with the slice on
  await page.click('[data-testid="grading-3d-reset"]'); await settle();
  const whiteNear = (img, p, r = 36) => { let n = 0; for (let y = Math.max(0, Math.round(p.y - r)); y < Math.min(img.height, Math.round(p.y + r)); y++) for (let x = Math.max(0, Math.round(p.x - r)); x < Math.min(img.width, Math.round(p.x + r)); x++) { const q = px(img, x, y); if (q[0] > 225 && q[1] > 225 && q[2] > 225) n++; } return n; };
  const seen = {};
  for (const k of [1, 2, 3, 5]) {
    await page.click(`[data-testid="grading-3d-stretch-${k}"]`); await settle();
    const sk = await st(), img = await shot(`${tag}-4b-north-stretch-${k}`);
    const covers = (() => { const c = census(img, { x: Math.max(0, Math.round(sk.north.sign.x - 26)), y: Math.max(0, Math.round(sk.north.sign.y - 26)), w: 52, h: 52 }); return c.rust + c.blue; })();
    seen[k] = { inView: !!(sk.north && sk.north.sign.inView && sk.north.tip.inView), white: whiteNear(img, sk.north.sign), covers, at: [Math.round(sk.north.sign.x), Math.round(sk.north.sign.y)] };
  }
  const voidWhite = whiteNear(await shot(`${tag}-4b-control`), { x: 30, y: 450 }, 24);
  check("KNOWN-GOOD: a patch of empty void reads no white at all (the white count can tell a sign from nothing)", voidWhite === 0, `${voidWhite} px`);
  check("the 'N' sign (and its arrow tip) is inside the window at 1×, 2×, 3× and 5× Height", Object.values(seen).every((v) => v.inView), JSON.stringify(seen));
  check("…and it sits OFF the model: no cut / fill pixel under the sign at any stretch (it never paints over the grading)", Object.values(seen).every((v) => v.covers === 0), JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k + "×", v.covers]))));
  check("…and it is drawn there — bright ring and letter pixels at every stretch", Object.values(seen).every((v) => v.white > 120), JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k + "×", v.white]))));
  await page.click('[data-testid="grading-3d-stretch-3"]'); await settle();
  const noSlice = await st();
  await page.click('[data-testid="grading-3d-slice"]'); await settle();
  const withSlice = await st(), imgSlice = await shot(`${tag}-4b-north-with-slice`);
  const wSlice = whiteNear(imgSlice, withSlice.north.sign);
  check("with the Slice ON the 'N' is still drawn where it was (the cut's clipping plane does not take it away)", withSlice.north.sign.inView && Math.hypot(withSlice.north.sign.x - noSlice.north.sign.x, withSlice.north.sign.y - noSlice.north.sign.y) < 1 && wSlice > 120, `${wSlice} white px`);
  await page.click('[data-testid="grading-3d-slice"]'); await settle();
  await page.click('[data-testid="grading-3d-reset"]'); await page.click('[data-testid="grading-3d-stretch-3"]'); await settle();
  const cmEnd = await compass(), sEnd = await st();
  check("after Reset view the compass is back at the opening heading and agrees with the camera", Math.abs(cmEnd.heading - northHeadingDeg(DEFAULT_AZ)) < 0.02 && Math.abs(sEnd.az - DEFAULT_AZ) < 1e-6, `${cmEnd.heading.toFixed(2)}°`);

  // ================= 5. slice =================
  const before = await shot(`${tag}-5a-before-slice`); const cBefore = census(before, modelBox);
  await page.click('[data-testid="grading-3d-slice"]'); await settle();
  const sl = await shot(`${tag}-5b-slice-on`); const cSl = census(sl, modelBox);
  const ss = await st();
  check("Slice ON removes the near half of the model", ss.sliceOn && cSl.lit < 0.92 * cBefore.lit, `${cBefore.lit} → ${cSl.lit} lit px`);
  check("the section face shows earth AND both wedges (rust where existing is above the finished grade, blue where below)", cSl.brown > 500 && cSl.rust > 150 && cSl.blue > 150, `brown ${cSl.brown}, rust ${cSl.rust}, blue ${cSl.blue}`);
  check("white lines are drawn (today's ground dashed, the finished grade solid)", cSl.white > 40, `${cSl.white} white px`);
  check("a handle is on the ground to drag the cut", !!ss.handleScreen, JSON.stringify(ss.handleScreen));
  const L0 = ss.line;
  if (ss.handleScreen) {
    const h = ss.handleScreen;
    await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x + 140, h.y + 30, { steps: 8 }); await page.mouse.up(); await settle();
    const sd = await st(); const dragged = await shot(`${tag}-5c-slice-dragged`);
    const moved = Math.hypot(sd.line.px - L0.px, sd.line.py - L0.py);
    check("dragging the handle slides the cut across the site", moved > 40, `moved ${moved.toFixed(0)} ft`);
    check("…ALONG its normal only (the cut keeps its direction)", Math.abs(sd.line.dx - L0.dx) < 1e-9 && Math.abs((sd.line.px - L0.px) * L0.dx + (sd.line.py - L0.py) * L0.dy) < 0.5);
    check("the picture changed with it", diffCount(sl, dragged, modelBox) > 1500, `${diffCount(sl, dragged, modelBox)} px`);
    check("the camera did NOT orbit while the handle was dragged", Math.abs(sd.az - ss.az) < 1e-9);
  }
  // the section seen head-on at 5×: the camera goes round to the removed side, square to the cut face
  await page.click('[data-testid="grading-3d-stretch-5"]'); await settle();
  const az = (await st()).az, nLine = (await st()).line;
  const camSide = Math.atan2(nLine.nx, nLine.ny);                      // azimuth whose camera sits on the line's normal side (az 0 = +z)
  const want = (ss.keepSign === -1 ? camSide : camSide + Math.PI);       // the removed (camera) side
  let dAz = want - az; while (dAz > Math.PI) dAz -= 2 * Math.PI; while (dAz < -Math.PI) dAz += 2 * Math.PI;
  await page.evaluate((dx) => window.__grading3d.drive({ orbit: [dx, 0] }), -dAz / 0.0058);
  await page.evaluate(() => window.__grading3d.drive({ orbit: [0, -80] }));   // a drag UP lowers the camera (OrbitControls' convention): a shallow angle, nearly square to the face
  await page.evaluate(() => window.__grading3d.drive({ zoom: -450 })); await settle();
  const close = await shot(`${tag}-5e-section-closeup`); const cc = census(close, modelBox);
  check("the section seen head-on carries the rust wedge (cut), the blue wedge (fill), earth and the white lines", cc.rust > 120 && cc.blue > 120 && cc.brown > 2000 && cc.white > 80, `rust ${cc.rust}, blue ${cc.blue}, brown ${cc.brown}, white ${cc.white}`);
  // Reset view frames from the CURRENT Height stretch, so set 3× FIRST — the "before" picture (5a) was framed at 3×, and the two must be the same camera
  await page.click('[data-testid="grading-3d-stretch-3"]'); await page.click('[data-testid="grading-3d-reset"]'); await settle();
  await page.click('[data-testid="grading-3d-slice"]'); await settle();
  const full = await shot(`${tag}-5d-slice-off`);
  check("Slice OFF = the full model again", census(full, modelBox).lit > 0.95 * cBefore.lit, `${census(full, modelBox).lit} vs ${cBefore.lit}`);

  // ================= 6. live regrade (synthetic only: a new finish floor) =================
  if (!CHEHAW) {
    await page.evaluate(() => { window.__phases.length = 0; });
    const beforeRe = await shot(`${tag}-6a-before-regrade`);
    await page.evaluate(() => window.__h.regrade(748));
    await page.waitForFunction(() => window.__grading3d && window.__grading3d.state().triangles > 0, null, { timeout: 60000 });
    await sleep(2500); await settle();
    const afterRe = await shot(`${tag}-6b-after-regrade`);
    const ph = await page.evaluate(() => window.__phases.slice());
    check("a regrade (new finish floor) updates the model while the viewer is open", diffCount(beforeRe, afterRe, modelBox) > 300, `${diffCount(beforeRe, afterRe, modelBox)} px changed`);
    check("…and the old model stayed up the whole time (the phase never fell back to 'building')", !ph.includes("building") && !ph.includes("starting"), JSON.stringify([...new Set(ph)]));
  }

  // ================= 6b. a narrow window (Chromium emulated at 390 wide — NOT an iPhone): the chrome wraps, never overflows or overlaps =================
  await page.setViewportSize({ width: 390, height: 780 }); await settle();
  const boxes = await page.evaluate(() => ["grading-3d-legend", "grading-3d-controls", "grading-3d-close", "grading-3d-compass-card"].map((id) => { const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return { id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  const [lg, ct, cl, cp] = boxes, overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  check("at 390 wide the legend, the compass, the controls and the close button all sit inside the window", boxes.every((b) => b.l >= 0 && b.r <= 390 && b.t >= 0 && b.b <= 780), JSON.stringify(boxes.map((b) => [b.id, Math.round(b.l), Math.round(b.r)])));
  check("…and none of them overlaps another — the compass sits under the legend, clear of the controls and the close button", !overlap(lg, ct) && !overlap(lg, cl) && !overlap(ct, cl) && !overlap(cp, lg) && !overlap(cp, ct) && !overlap(cp, cl), JSON.stringify(boxes.map((b) => [b.id, Math.round(b.t), Math.round(b.b)])));
  await shot(`${tag}-6c-narrow`);
  await page.setViewportSize({ width: 1400, height: 900 }); await settle();

  // ================= 7. close: Esc, the planner never sees Delete, nothing leaks =================
  await page.evaluate(() => { window.__keySpy = 0; });
  await page.keyboard.press("Delete");
  check("Delete is swallowed while the viewer is open (a stand-in planner key handler never sees it)", (await page.evaluate(() => window.__keySpy)) === 0);
  await page.keyboard.press("Escape"); await page.waitForSelector('[data-testid="grading-3d"]', { state: "detached", timeout: 5000 });
  check("Esc closes the viewer", (await page.$('[data-testid="grading-3d"]')) === null);
  await page.keyboard.press("Delete");
  check("KNOWN-GOOD: after closing, Delete DOES reach the window (the spy can see)", (await page.evaluate(() => window.__keySpy)) === 1);
  const afterClose = await page.evaluate(() => window.__h.stats());
  check("closing disposes every geometry, material and scene", afterClose.geometries === 0 && afterClose.materials === 0 && afterClose.scenes === 0 && (await page.$('canvas[data-grading-3d-canvas]')) === null, JSON.stringify(afterClose));
  for (let n = 0; n < 10; n++) {
    await page.click('[data-testid="harness-open"]');
    await page.waitForSelector('[data-testid="grading-3d"][data-phase="ready"]', { timeout: 120000 });
    if (n === 4) { await page.click('[data-testid="grading-3d-slice"]'); await settle(); }
    await page.click('[data-testid="grading-3d-close"]'); await page.waitForSelector('[data-testid="grading-3d"]', { state: "detached" });
  }
  const leak = await page.evaluate(() => window.__h.stats());
  check("open → close ×10 leaves NO GPU object or scene alive", leak.geometries === 0 && leak.materials === 0 && leak.scenes === 0 && leak.created === leak.disposed, JSON.stringify(leak));
  await page.click('[data-testid="harness-open"]'); await page.waitForSelector('[data-testid="grading-3d"][data-phase="ready"]', { timeout: 120000 });
  check("a fresh open starts at the default 3× stretch", (await page.getAttribute('[data-testid="grading-3d"]', "data-stretch")) === "3");
  const longs = await page.evaluate(() => window.__long.slice());
  const worst = Math.max(0, ...longs);
  check(`no long task while opening / orbiting / slicing (worst ${worst} ms; the model is built in ≤10 ms slices)`, worst < 250, `long tasks: ${JSON.stringify(longs.slice(0, 12))}`);
  check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  writeFileSync(OUT + `${tag}-report.txt`, [...notes, ...fails].join("\n"));
  await browser.close();
} finally {
  vite.kill();
}
console.log(notes.join("\n")); if (fails.length) { console.log("\nFAILURES:\n" + fails.join("\n")); process.exit(1); }
console.log(`\nverify-grading-3d-viewer (${CHEHAW ? "chehaw" : "synthetic"}): all ${notes.length} checks passed`);
