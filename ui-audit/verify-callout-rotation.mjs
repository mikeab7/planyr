#!/usr/bin/env node
/* verify-callout-rotation — NEW-2 (B1612641) — text boxes and callouts can be rotated, matching
 * how a building already rotates, and the NEW-1 padding fix holds under rotation.
 *
 *   node ui-audit/verify-callout-rotation.mjs [--assert]
 *
 * Drives the REAL app in a headless browser (no synthetic events dispatched directly against
 * React state — a real pointer drag on the rotate handle, per SYNTHETIC-KEYS-DONT-EDIT's sibling
 * caution about trusting a harness's own instrument): select a plain text box, drag its rotate
 * handle ~90°, and check:
 *   1. the rotate handle exists only once something is selected, matching the building/markup
 *      convention (`data-handle="rotate"`);
 *   2. the drag actually rotates the committed box+text (the `<g rotate(...)>` this item added);
 *   3. NEW-1's padding-slot symmetry is untouched by rotation — the box/text's own `x`/`y` attributes
 *      (which live INSIDE the rotated group) don't change at all when the group's transform does,
 *      so the symmetry proof from verify-callout-padding-symmetry.mjs carries over unchanged;
 *   4. a callout WITH a leader keeps its arrow pointed at the same fixed screen point after the
 *      box rotates — the leader must never swing with the box;
 *   5. `c.rot` round-trips through a reload (save/reload persistence — plan-switch persistence is
 *      the same code path, the whole site model, so this is the representative case);
 *   6. the rotated box/text group is NOT inside a `data-export="skip"` ancestor, which is what
 *      makes the PDF/PNG export (a straight `cloneNode(true)` of this same live SVG — see
 *      exportSheet.js) carry the rotation for free, with no second render path to keep in sync
 *      (PDF-PARITY).
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const SITE_ID = "smverifrotate1";
const ASSERT = process.argv.includes("--assert");
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };

const CX = 4200, CY = -4200;      // a plain text box (no leader)
const LX = 5200, LY = -4200;      // a callout WITH a leader, aimed at a fixed target
const LEADER_TARGET = { x: LX + 60, y: LY };

function withScene(fx) {
  const f = JSON.parse(JSON.stringify(fx));
  f.callouts = (f.callouts || []).concat([
    { id: "zzRotBox", z: 900000, box: { x: CX, y: CY }, text: "Rotate me", noLeader: true },
    { id: "zzRotLeader", z: 900000, box: { x: LX, y: LY }, tip: LEADER_TARGET, text: "Points at X" },
  ]);
  return f;
}

async function run() {
  const fixture = withScene(readFixture("richfield"));
  const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    return route.abort();
  });

  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-callout-rotation");
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + `#/project/${SITE_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "load" });
  await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
  await page.evaluate(([x, y]) => window.__plannerView?.centerOn(x, y, 0.9), [(CX + LX) / 2, CY]);
  await pacedWait(page, 1000);

  // --- 1. no rotate handle before selection ---
  const preSelectHandle = await page.locator('[data-handle="rotate"]').count();
  if (preSelectHandle === 0) ok("no rotate handle before anything is selected");
  else bad(`rotate handle present before selection (${preSelectHandle})`);

  // --- select the plain text box, confirm the handle appears ---
  const box = page.locator('[data-testid="callout-box-zzRotBox"]');
  await box.click();
  await pacedWait(page, 300);
  const handle = page.locator('[data-testid="callout-handle-rotate-zzRotBox"]');
  if (await handle.count()) ok("rotate handle appears on selection (matches the building/markup convention)");
  else { bad("rotate handle did NOT appear on selection — aborting the rest of this run"); await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); if (ASSERT && fail) process.exit(1); return; }

  // --- read the box+text geometry BEFORE rotating (for the padding-holds-under-rotation check) ---
  const before = await page.evaluate(() => {
    const g = document.querySelector('g[data-feature="callout:zzRotBox"]');
    const rect = g.querySelector('[data-testid="callout-box-zzRotBox"]');
    const texts = [...g.querySelectorAll("text")];
    return {
      rectAttrs: { y: +rect.getAttribute("y"), h: +rect.getAttribute("height") },
      textYs: texts.map((t) => +t.getAttribute("y")),
      rotateGroupTransform: rect.closest("g").getAttribute("transform"),
    };
  });

  // --- 2. drag the rotate handle ~90° clockwise ---
  const hb = await handle.boundingBox();
  const boxBB = await box.boundingBox();
  const cx = boxBB.x + boxBB.width / 2, cy = boxBB.y + boxBB.height / 2;
  const r = Math.hypot((hb.x + hb.width / 2) - cx, (hb.y + hb.height / 2) - cy);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + r, cy, { steps: 12 });   // ~90° clockwise from "up" to "right"
  await page.mouse.up();
  await pacedWait(page, 400);

  const after = await page.evaluate(() => {
    const site = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const c = Object.values(site).flatMap((s) => s.callouts || []).find((x) => x.id === "zzRotBox");
    const g = document.querySelector('g[data-feature="callout:zzRotBox"]');
    const rect = g.querySelector('[data-testid="callout-box-zzRotBox"]');
    const texts = [...g.querySelectorAll("text")];
    return {
      rot: c ? c.rot : null,
      rectAttrs: { y: +rect.getAttribute("y"), h: +rect.getAttribute("height") },
      textYs: texts.map((t) => +t.getAttribute("y")),
      rotateGroupTransform: rect.closest("g").getAttribute("transform"),
      exportSkipAncestor: !!rect.closest('[data-export="skip"]'),
    };
  });

  console.log(`  rotation drag result: c.rot=${after.rot}, group transform="${after.rotateGroupTransform}"`);
  if (after.rot != null && Math.abs(((after.rot % 360) + 360) % 360 - 90) <= 15) ok(`drag rotated the callout to ~90° (c.rot=${after.rot})`);
  else bad(`drag did not produce ~90° rotation (c.rot=${after.rot})`);
  if (after.rotateGroupTransform && /rotate\(/.test(after.rotateGroupTransform)) ok(`the committed box+text group carries a rotate(...) transform ("${after.rotateGroupTransform}")`);
  else bad(`the committed box+text group carries no rotate(...) transform`);

  // --- 3. padding symmetry (NEW-1) is untouched by rotation: the box/text's own attributes,
  //        which live INSIDE the rotated group, must be byte-identical before/after — only the
  //        group's transform should have changed. ---
  const attrsUnchanged = before.rectAttrs.y === after.rectAttrs.y && before.rectAttrs.h === after.rectAttrs.h
    && JSON.stringify(before.textYs) === JSON.stringify(after.textYs);
  if (attrsUnchanged) ok("NEW-1's padding-slot symmetry holds under rotation (box/text local attributes unchanged — only the enclosing rotate() transform differs)");
  else bad(`box/text local attributes changed under rotation — before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

  // --- 6. PDF-PARITY: the rotated group must not be under a data-export="skip" ancestor ---
  if (!after.exportSkipAncestor) ok("the rotated box/text is NOT under data-export=\"skip\" — the export clone (exportSheet.js) will carry the rotation for free");
  else bad("the rotated box/text IS under data-export=\"skip\" — it would be stripped from the PDF/PNG export");

  // --- 5. persistence across reload ---
  // ⛔ DRIVER-SCROLL-IS-NOT-APP-SCROLL-class trap, caught live while writing this harness: a plain
  // `page.reload()` in THIS context re-runs `ctx.addInitScript(fixtureSeed(...))`, which is exactly
  // what seeded the plan in the first place — so it RE-SEEDS the original fixture on every reload
  // and wipes the drag's own result BEFORE the app even boots. That is a property of this harness's
  // OWN seeding mechanism (Playwright re-runs an init script on every navigation in the context by
  // design), never a real user's browser, which never re-seeds anything on F5. A first version of
  // this check reported "rotation does not survive a reload" this way — false: `localStorage`
  // already held the correct `rot` before the reload; it was this harness overwriting its own
  // evidence. The honest way to test a REAL reload is a second, un-seeded context that inherits the
  // exact storage state the first context ended up in.
  const state = await ctx.storageState();
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, storageState: state });
  await ctx2.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx2.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE + `#/project/${SITE_ID}/site`, { waitUntil: "load" });
  await waitForSelectorReleased(page2, "svg[data-view-ppf]", { timeout: 30000 });
  await page2.evaluate(([x, y]) => window.__plannerView?.centerOn(x, y, 0.9), [(CX + LX) / 2, CY]);
  await pacedWait(page2, 800);
  const afterReload = await page2.evaluate(() => {
    const g = document.querySelector('g[data-feature="callout:zzRotBox"]');
    const rect = g?.querySelector('[data-testid="callout-box-zzRotBox"]');
    return rect ? rect.closest("g").getAttribute("transform") : null;
  });
  if (afterReload && afterReload === after.rotateGroupTransform) ok(`rotation survives a real reload — a fresh, un-seeded context inheriting the same storage renders the same transform ("${afterReload}")`);
  else bad(`rotation did NOT survive a real reload (before="${after.rotateGroupTransform}" after="${afterReload}")`);
  await ctx2.close();

  // --- extra: the width-resize grip still works on a ROTATED box (startCalloutResize/onMove's
  //     "calloutResize" branch were rewritten to work in the box's own rotated local frame —
  //     worth proving live, not just reasoning about the math). Drag the right-mid grip outward
  //     along the box's OWN (rotated ~85°) local x-axis and confirm boxW grew sensibly. ---
  await page.locator('[data-testid="callout-box-zzRotBox"]').click();
  await pacedWait(page, 300);
  const rGrip = page.locator('[data-testid="callout-handle-r"]').first();
  const before2 = await page.evaluate(() => {
    const site = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const c = Object.values(site).flatMap((s) => s.callouts || []).find((x) => x.id === "zzRotBox");
    return c ? { boxW: c.boxW ?? null, box: c.box } : null;
  });
  const gb = await rGrip.boundingBox();
  if (gb) {
    // Move 60px further out along the box's own rotated x-axis (the grip's own screen position
    // relative to the box centre already tells us that direction).
    const bb = await page.locator('[data-testid="callout-box-zzRotBox"]').boundingBox();
    const bcx = bb.x + bb.width / 2, bcy = bb.y + bb.height / 2;
    const gx = gb.x + gb.width / 2, gy = gb.y + gb.height / 2;
    const dx = gx - bcx, dy = gy - bcy, dlen = Math.hypot(dx, dy) || 1;
    const targetX = gx + (dx / dlen) * 60, targetY = gy + (dy / dlen) * 60;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await page.mouse.up();
    await pacedWait(page, 300);
    const after2 = await page.evaluate(() => {
      const site = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const c = Object.values(site).flatMap((s) => s.callouts || []).find((x) => x.id === "zzRotBox");
      return c ? { boxW: c.boxW ?? null, box: c.box } : null;
    });
    console.log(`  resize-on-rotated-box: boxW ${before2?.boxW} -> ${after2?.boxW}`);
    const grew = after2 && Number.isFinite(after2.boxW) && after2.boxW > (before2?.boxW || 0);
    if (grew) ok(`the width grip still resizes correctly on a rotated box (boxW grew to ${after2.boxW.toFixed(1)}ft, no NaN)`);
    else bad(`resizing the rotated box produced a bad result (before=${JSON.stringify(before2)} after=${JSON.stringify(after2)})`);
  } else bad("could not find the right-mid width grip on the rotated box to test resize");

  // --- 4. a leader stays pointed at its fixed target when the OTHER callout's box rotates
  //        (sanity: rotating one callout must never move a different callout's leader) plus the
  //        stronger, same-object case: rotate zzRotLeader itself and confirm its OWN leader tip
  //        (the arrowhead's fixed screen point) does not move. ---
  const leaderBefore = await page.evaluate(() => {
    const line = document.querySelector('[data-testid="callout-leader-run-zzRotLeader-0"]');
    return line ? { x2: +line.getAttribute("x2"), y2: +line.getAttribute("y2") } : null;
  });
  await page.locator('[data-testid="callout-box-zzRotLeader"]').click();
  await pacedWait(page, 300);
  const leaderHandle = page.locator('[data-testid="callout-handle-rotate-zzRotLeader"]');
  if (await leaderHandle.count()) {
    const lhb = await leaderHandle.boundingBox();
    const lBoxBB = await page.locator('[data-testid="callout-box-zzRotLeader"]').boundingBox();
    const lcx = lBoxBB.x + lBoxBB.width / 2, lcy = lBoxBB.y + lBoxBB.height / 2;
    const lr = Math.hypot((lhb.x + lhb.width / 2) - lcx, (lhb.y + lhb.height / 2) - lcy);
    await page.mouse.move(lhb.x + lhb.width / 2, lhb.y + lhb.height / 2);
    await page.mouse.down();
    await page.mouse.move(lcx + lr, lcy, { steps: 12 });
    await page.mouse.up();
    await pacedWait(page, 400);
    const leaderAfter = await page.evaluate(() => {
      const line = document.querySelector('[data-testid="callout-leader-run-zzRotLeader-0"]');
      return line ? { x2: +line.getAttribute("x2"), y2: +line.getAttribute("y2") } : null;
    });
    const moved = leaderBefore && leaderAfter ? Math.hypot(leaderAfter.x2 - leaderBefore.x2, leaderAfter.y2 - leaderBefore.y2) : Infinity;
    if (leaderBefore && leaderAfter && moved < 0.5) ok(`the leader's arrow stays pointed at its fixed target after rotating its own box (moved ${moved.toFixed(3)}px)`);
    else bad(`the leader's arrow MOVED when the box rotated (before=${JSON.stringify(leaderBefore)} after=${JSON.stringify(leaderAfter)}, moved ${moved})`);
  } else bad("rotate handle missing on the leadered callout — could not run the leader-stays-fixed check");

  if (errors.length === 0) ok("no JS crash"); else bad(`JS errors: ${errors.slice(0, 3).join("; ")}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (ASSERT && fail) process.exit(1);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
