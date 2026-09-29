/* verify-notes-canvas — THE BLUEBEAM-STYLE WORKSPACE, DRIVEN (NEW-1, 2026-09-21).
 *
 * ⛔ WHY THIS EXISTS BESIDE THE WIDTH MATRIX. The matrix proves the page's BOUNDARIES behave; this
 * proves the VIEW does. They are separate files because they fail for different reasons and a
 * combined run would let one green hide the other's gap — and because one of these checks
 * (`beginViewPan`) guards a function that was written, committed, and **wired to nothing** until
 * a dead-store audit caught it. A gesture nobody drives is a gesture that does not exist, so every
 * one of them is driven here with real trusted input.
 *
 * ⛔ WHAT IT COVERS, one section each:
 *   1. wheel zoom, ANCHORED AT THE CURSOR — the point under the pointer stays under the pointer
 *   2. PLAIN WHEEL ZOOMS at the cursor (like the site plan); Shift+wheel and a sideways swipe PAN
 *   3. MIDDLE-mouse drag pan, from on top of the page
 *   4. SPACE + drag pan, and that space still types a space when the caret is in text
 *   5. Ctrl+= · Ctrl+− · Ctrl+0 (100%) · Ctrl+9 (fit the page)
 *   6. the view PERSISTS per page and survives a reload
 *   7. the workspace is UNBOUNDED — the page can be pushed past every edge
 *   8. B1393 — double-click on blank paper INSIDE the sheet places a box AT THE CLICK POINT, at a
 *      far-out zoom, at 100%, and at a far-in zoom
 *   9. the plain wheel does NOT hijack what scrolls itself: a wide table, a code block, an open
 *      toolbar menu, the notebook rail — they scroll, and the zoom does not move
 *
 * ⛔ WHAT IT CANNOT COVER HEADLESS, STATED RATHER THAN FOLDED INTO A PASS:
 *   · a REAL two-finger trackpad pinch. macOS/Windows deliver it to the page as a Ctrl+wheel,
 *     which section 1 drives exactly; what is NOT exercised here is a real touchscreen pinch
 *     (two simultaneous touch pointers). Playwright's CDP touch emulation raises the events but
 *     not the OS gesture recognition, so a pass would be about this harness, not about a finger.
 *     It is listed as UNVERIFIED and carried to the live check, never scored.
 *   · a real trackpad's momentum/inertia scrolling after the fingers lift.
 *
 * ⛔ FOREGROUND-OR-VOID and SYNTHETIC-KEYS-DONT-EDIT both apply and both are honoured: every
 * gesture is Playwright's own mouse/keyboard, and the tab is asserted measurable before anything
 * is read.
 */
import { chromium } from "playwright";

import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

/* An anchored zoom is arithmetic, so the tolerance is for rounding and for the browser's own
 * sub-pixel rasterisation of a scaled layer — not for a policy. */
const ANCHOR_TOL = 2;
/* The fixture's 24 flow paragraphs migrate into ONE box when the page opens (NEW-1, 2026-09-22). */
const BASE_BOXES = 1;
/* A box is placed at the point pressed; the tolerance is the anchor's own border and rounding,
 * the same number `verify-notes-in-sheet-placement` uses and for the same reason. */
const POS_TOL = 6;

const failures = [];
const voids = [];
const unverified = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};
const known = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} [known-good] ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) voids.push(label);
};
const cannot = (label, why) => {
  console.log(`· [not exercisable headless] ${label} — ${why}`);
  unverified.push(`${label} — ${why}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/** ⛔ A PLAIN VERTICAL WHEEL ZOOMS NOW (NEW-1, 2026-09-29), so a harness that wants to PAN the way it
 *  used to must say so: Shift+wheel is the vertical pan, a sideways delta the horizontal one. */
const panWheel = async (page, dx, dy) => {
  if (dy) { await page.keyboard.down("Shift"); await page.mouse.wheel(0, dy); await page.keyboard.up("Shift"); }
  if (dx) await page.mouse.wheel(dx, 0);
};

const P = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const DOC = {
  type: "doc",
  content: Array.from({ length: 24 }, (_, i) =>
    P(`Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog while the surveyor `
      + "checks the plat and the pond is staked out at the south east corner.")),
};

async function openPage({ width = 1500, height = 950, doc = DOC } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await assertMeasurable(page, "verify-notes-canvas");
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, pageKey, d]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Canvas", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(pageKey, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  page._errs = errs;
  return page;
}

/** The view, read off the workspace layer's own transform — the app's real state, not a re-derived
 *  copy of its formula. */
const view = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="note-workspace"]');
  const t = el?.style.transform || "";
  const m = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)\s*scale\(([-0-9.]+)\)/.exec(t);
  return m ? { x: -parseFloat(m[1]), y: -parseFloat(m[2]), z: parseFloat(m[3]) } : null;
});

const sheetRect = (page) => page.evaluate(() => {
  const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});

const matRect = (page) => page.evaluate(() => {
  const r = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});

/** Where a given WORKSPACE point currently lands on screen — the one question an anchored zoom is
 *  about. Computed from the mat's own box plus the live transform, so it is a reading of the real
 *  DOM rather than of the app's intentions. */
async function screenOf(page, wx, wy) {
  const v = await view(page);
  const m = await matRect(page);
  return { x: m.left + wx * v.z - v.x, y: m.top + wy * v.z - v.y };
}

async function workspaceOf(page, cx, cy) {
  const v = await view(page);
  const m = await matRect(page);
  return { x: (cx - m.left + v.x) / v.z, y: (cy - m.top + v.y) / v.z };
}

/** ⛔ BRING A WORKSPACE POINT INTO VIEW WITH A REAL GESTURE, then measure there.
 *
 *  Needed because at a far-IN zoom there is no blank paper on screen at all: at 800% the writing
 *  column alone is 4,640px wide, so every pixel of a 1,232px mat is text and a "click on blank
 *  paper" arm has nowhere to click. That is the view being zoomed in, not a defect — but a
 *  harness that scored it as "no box was created" would be reporting its own framing as an app
 *  failure. Panning first is legitimate setup and it uses middle-drag, which section 3 has
 *  already proved is one-to-one, so this cannot quietly become a second, unverified mechanism. */
async function bringIntoView(page, w) {
  const m = await matRect(page);
  const target = { x: m.left + m.width / 2, y: m.top + m.height / 2 };
  for (let i = 0; i < 12; i += 1) {
    const at = await screenOf(page, w.x, w.y);
    if (Math.abs(at.x - target.x) < 24 && Math.abs(at.y - target.y) < 24) return true;
    /* One drag can only move as far as the window allows, so this converges over several. */
    const from = { x: m.left + m.width / 2, y: m.top + m.height / 2 };
    const dx = Math.max(-m.width * 0.4, Math.min(m.width * 0.4, target.x - at.x));
    const dy = Math.max(-m.height * 0.4, Math.min(m.height * 0.4, target.y - at.y));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2);
    await page.mouse.move(from.x + dx, from.y + dy);
    await page.mouse.up({ button: "middle" });
    await pacedWait(page, 120);
  }
  return false;
}

async function section(name, fn, doc) {
  console.log(`\n── ${name} ──`);
  const page = await openPage(doc ? { doc } : {});
  try {
    await fn(page);
  } catch (e) {
    ok(`${name} threw`, false, e.message);
  }
  if (page._errs.length) ok(`${name}: no console errors`, false, page._errs.slice(0, 2).join(" | "));
  await page.context().close();
}

/* ── 1 · WHEEL ZOOM, ANCHORED AT THE CURSOR ─────────────────────────────────────────────────── */
await section("1 · wheel zoom is anchored at the cursor", async (page) => {
  const m = await matRect(page);
  /* Three genuinely different anchors, because "it happens to work at the middle" is the failure
   * an anchored zoom has: the identity view and a centre anchor agree with almost any wrong
   * formula. */
  for (const [label, at] of [
    ["at the middle", { x: m.left + m.width / 2, y: m.top + m.height / 2 }],
    ["near the top-left", { x: m.left + 90, y: m.top + 70 }],
    ["near the bottom-right", { x: m.right - 90, y: m.bottom - 70 }],
  ]) {
    for (const [dir, delta] of [["in", -240], ["out", 240]]) {
      const under = await workspaceOf(page, at.x, at.y);
      const z0 = (await view(page)).z;
      await page.mouse.move(at.x, at.y);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, delta);
      await page.keyboard.up("Control");
      await pacedWait(page, 200);
      const v1 = await view(page);
      const now = await screenOf(page, under.x, under.y);
      const moved = Math.hypot(now.x - at.x, now.y - at.y);
      ok(`zoom ${dir} ${label}: the point under the pointer stays under the pointer`,
        moved <= ANCHOR_TOL, `moved ${moved.toFixed(2)}px · zoom ${z0.toFixed(3)} → ${v1.z.toFixed(3)}`);
      ok(`zoom ${dir} ${label}: the level actually changed`,
        dir === "in" ? v1.z > z0 : v1.z < z0, `${z0.toFixed(3)} → ${v1.z.toFixed(3)}`);
    }
  }

  /* The range the brief asked to be stated. */
  await page.mouse.move(m.left + m.width / 2, m.top + m.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await pacedWait(page, 250);
  const zIn = (await view(page)).z;
  await page.keyboard.down("Control");
  for (let i = 0; i < 90; i += 1) await page.mouse.wheel(0, 240);
  await page.keyboard.up("Control");
  await pacedWait(page, 250);
  const zOut = (await view(page)).z;
  ok("zooms all the way in to 800%", Math.abs(zIn - 8) < 0.01, `${(zIn * 100).toFixed(0)}%`);
  ok("zooms all the way out to 10%", Math.abs(zOut - 0.1) < 0.001, `${(zOut * 100).toFixed(0)}%`);

  /* ⛔ A TRACKPAD PINCH IS A Ctrl+WHEEL, and that is the path just driven. A real TOUCHSCREEN
   * pinch is two touch pointers and is not honestly reachable here — said, not scored. */
  cannot("a real touchscreen pinch (two simultaneous touch pointers)",
    "CDP touch emulation raises the events but not the OS gesture; a trackpad pinch arrives as the "
    + "Ctrl+wheel this section already drives");
  cannot("trackpad momentum/inertia after the fingers lift",
    "the browser synthesises it from the OS; a driver cannot reproduce the decay curve");
});

/* ── 2 · PLAIN WHEEL ZOOMS; SHIFT+WHEEL AND A SIDEWAYS SWIPE PAN ───────────────────────────── */
await section("2 · a plain wheel zooms at the cursor (like the site plan); Shift+wheel and a sideways swipe pan", async (page) => {
  const m = await matRect(page);
  const at = { x: m.left + m.width / 2 + 120, y: m.top + 260 };
  await page.mouse.move(at.x, at.y);

  /* ⛔ THE RED-PROOF ARM: on the pre-change build a plain wheel-up moved the page (a pan) and left
   * the zoom at exactly 1.0; this is the row that fails there. */
  const under = await workspaceOf(page, at.x, at.y);
  const z0 = (await view(page)).z;
  await page.mouse.wheel(0, -120);
  await pacedWait(page, 250);
  const zUp = (await view(page)).z;
  ok("⛔ a plain wheel-UP zooms IN", zUp > z0 + 0.05, `${z0.toFixed(3)} → ${zUp.toFixed(3)}`);
  const now = await screenOf(page, under.x, under.y);
  ok("and the point under the pointer stays under the pointer",
    Math.hypot(now.x - at.x, now.y - at.y) <= ANCHOR_TOL, `moved ${Math.hypot(now.x - at.x, now.y - at.y).toFixed(2)}px`);
  await page.mouse.wheel(0, 240);
  await pacedWait(page, 250);
  const zDown = (await view(page)).z;
  ok("a plain wheel-DOWN zooms OUT", zDown < zUp - 0.05, `${zUp.toFixed(3)} → ${zDown.toFixed(3)}`);
  await pacedWait(page, 700);          // past the persist debounce
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("planyr:notes:view:")));
  ok("the wheel-reached level is persisted like any other", stored.length === 1, stored.join(", ") || "nothing stored");

  /* The pill reads the level the wheel reached. */
  const pill = await page.evaluate(() => document.querySelector('[data-testid="note-zoom-level"]')?.textContent?.trim());
  ok("the zoom pill's percentage follows the wheel", pill === `${Math.round(zDown * 100)}%`,
    `pill ${JSON.stringify(pill)} vs view ${(zDown * 100).toFixed(0)}%`);

  await page.keyboard.press("Control+0");
  await pacedWait(page, 250);
  const before = await sheetRect(page);
  const zPan = (await view(page)).z;
  await page.keyboard.down("Shift");
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, 60);
  await page.keyboard.up("Shift");
  await pacedWait(page, 250);
  const afterV = await sheetRect(page);
  ok("Shift+wheel moves the page UP the screen", afterV.top < before.top - 50,
    `top ${before.top.toFixed(0)} → ${afterV.top.toFixed(0)}`);
  ok("and does not change the zoom", Math.abs((await view(page)).z - zPan) < 1e-6);

  const beforeH = await sheetRect(page);
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel(60, 0);
  await pacedWait(page, 250);
  const afterH = await sheetRect(page);
  ok("a two-finger sideways swipe moves the page LEFT", afterH.left < beforeH.left - 20,
    `left ${beforeH.left.toFixed(0)} → ${afterH.left.toFixed(0)}`);
  ok("and does not change the zoom either", Math.abs((await view(page)).z - zPan) < 1e-6);

  known("the page really moved (a zero reading would make every pan row above vacuous)",
    Math.abs(afterH.left - before.left) > 20 || Math.abs(afterV.top - before.top) > 20);
});

/* ── 3 · MIDDLE-MOUSE DRAG PAN ──────────────────────────────────────────────────────────────── */
await section("3 · middle-mouse drag pans, from on top of the page", async (page) => {
  const s = await sheetRect(page);
  /* ⛔ DELIBERATELY STARTED ON THE PAGE ITSELF, not on blank workspace. Panning from blank
   * workspace is the mat's own left-drag gesture and is covered elsewhere; the whole reason
   * middle-drag exists is the case where you are zoomed in far enough that there is no blank
   * workspace on screen to grab. */
  const from = { x: s.left + s.width / 2, y: s.top + 160 };
  const v0 = await view(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(from.x - i * 10, from.y + i * 6);
  await page.mouse.up({ button: "middle" });
  await pacedWait(page, 250);
  const v1 = await view(page);
  ok("middle-drag pans the view one-to-one with the pointer",
    Math.abs((v1.x - v0.x) - 120) <= 2 && Math.abs((v1.y - v0.y) + 72) <= 2,
    `Δview ${(v1.x - v0.x).toFixed(1)}, ${(v1.y - v0.y).toFixed(1)} against a pointer of −120, +72`);
  ok("and it does not change the zoom", Math.abs(v1.z - v0.z) < 1e-6);
  const boxes = await page.evaluate(() => document.querySelectorAll(".planyr-anchor").length);
  /* The fixture's flow paragraphs migrate into ONE box on open (NEW-1, 2026-09-22), so "nothing was
   * created" is a comparison against that baseline, not against zero. */
  ok("a middle-drag over the page creates nothing", boxes === BASE_BOXES, `${boxes} boxes (baseline ${BASE_BOXES})`);
});

/* ── 4 · SPACE + DRAG PAN ───────────────────────────────────────────────────────────────────── */
await section("4 · space+drag pans, and space still types when the caret is in text", async (page) => {
  const s = await sheetRect(page);
  const from = { x: s.left + s.width / 2, y: s.top + 200 };

  /* First the half that must NOT happen: with the caret in the writing, space is a space. */
  /* The writing lives in the migrated box now (NEW-1, 2026-09-22), so aim at ITS first line rather
   * than at blank paper, where a press only arms a placement caret. */
  const line = await page.evaluate(() => {
    const r = document.querySelector(".planyr-anchor p").getBoundingClientRect();
    return { x: r.left + 40, y: r.top + r.height / 2 };
  });
  /* Press 1 SELECTS a box; press 2 (a separate click, past the double-click budget) ENTERS it. */
  await page.mouse.click(line.x, line.y);
  await pacedWait(page, 600);
  await page.mouse.click(line.x, line.y);
  await pacedWait(page, 250);
  const textBefore = await page.evaluate(() => document.querySelector('[data-testid="note-body"]').textContent.length);
  await page.keyboard.press("Space");
  await pacedWait(page, 200);
  const textAfter = await page.evaluate(() => document.querySelector('[data-testid="note-body"]').textContent.length);
  ok("⛔ space in the writing is still a SPACE, never a pan mode", textAfter === textBefore + 1,
    `${textBefore} → ${textAfter} characters`);
  await page.keyboard.press("Control+z");
  await pacedWait(page, 200);

  /* Now the pan. The caret has to be out of the text for space to mean anything else — that is the
   * rule, not a limitation of the test. */
  await page.evaluate(() => document.activeElement?.blur?.());
  await pacedWait(page, 120);
  const v0 = await view(page);
  await page.keyboard.down("Space");
  await pacedWait(page, 80);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(from.x + i * 9, from.y - i * 5);
  await page.mouse.up();
  await page.keyboard.up("Space");
  await pacedWait(page, 250);
  const v1 = await view(page);
  ok("space+drag pans the view one-to-one with the pointer",
    Math.abs((v1.x - v0.x) + 108) <= 2 && Math.abs((v1.y - v0.y) - 60) <= 2,
    `Δview ${(v1.x - v0.x).toFixed(1)}, ${(v1.y - v0.y).toFixed(1)} against a pointer of +108, −60`);
  const boxes = await page.evaluate(() => document.querySelectorAll(".planyr-anchor").length);
  ok("a space+drag creates nothing", boxes === BASE_BOXES, `${boxes} boxes (baseline ${BASE_BOXES})`);
});

/* ── 5 · THE KEYBOARD ───────────────────────────────────────────────────────────────────────── */
await section("5 · Ctrl+= · Ctrl+− · Ctrl+0 · Ctrl+9", async (page) => {
  const z = async () => (await view(page)).z;
  ok("a page opens at 100%", Math.abs((await z()) - 1) < 1e-6, `${((await z()) * 100).toFixed(0)}%`);

  await page.keyboard.press("Control+Equal");
  await pacedWait(page, 200);
  ok("Ctrl+= steps in, onto a nameable rung", Math.abs((await z()) - 1.1) < 1e-6, `${((await z()) * 100).toFixed(0)}%`);

  await page.keyboard.press("Control+Minus");
  await page.keyboard.press("Control+Minus");
  await pacedWait(page, 250);
  ok("Ctrl+− steps out", Math.abs((await z()) - 0.9) < 1e-6, `${((await z()) * 100).toFixed(0)}%`);

  /* Push the view somewhere odd first, so "reset" is proved to reset the FRAMING, not only the
   * level — a Ctrl+0 that leaves the page off-screen is not a reset. */
  const m = await matRect(page);
  await page.mouse.move(m.left + 200, m.top + 200);
  for (let i = 0; i < 6; i += 1) await panWheel(page, 300, 300);
  await pacedWait(page, 250);
  await page.keyboard.press("Control+0");
  await pacedWait(page, 300);
  const afterReset = await sheetRect(page);
  ok("Ctrl+0 returns to 100%", Math.abs((await z()) - 1) < 1e-6, `${((await z()) * 100).toFixed(0)}%`);
  ok("Ctrl+0 brings the page back on screen", afterReset.left > m.left - 10 && afterReset.left < m.right,
    `page left ${afterReset.left.toFixed(0)} inside mat ${m.left.toFixed(0)}..${m.right.toFixed(0)}`);

  await page.keyboard.press("Control+9");
  await pacedWait(page, 350);
  const fitted = await sheetRect(page);
  const zf = await z();
  ok("Ctrl+9 fits the WHOLE page inside the mat, both axes",
    fitted.left >= m.left - 2 && fitted.right <= m.right + 2
    && fitted.top >= m.top - 2 && fitted.bottom <= m.bottom + 2,
    `page ${fitted.left.toFixed(0)}..${fitted.right.toFixed(0)} × ${fitted.top.toFixed(0)}..${fitted.bottom.toFixed(0)} `
    + `in mat ${m.left.toFixed(0)}..${m.right.toFixed(0)} × ${m.top.toFixed(0)}..${m.bottom.toFixed(0)} at ${(zf * 100).toFixed(0)}%`);
  ok("and it zoomed OUT to do it (this page is taller than the window)", zf < 1, `${(zf * 100).toFixed(0)}%`);
});

/* ── 6 · THE VIEW PERSISTS ──────────────────────────────────────────────────────────────────── */
await section("6 · the view is remembered per page and survives a reload", async (page) => {
  const m = await matRect(page);
  await page.mouse.move(m.left + m.width / 2, m.top + m.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  for (let i = 0; i < 4; i += 1) await panWheel(page, 0, 90);
  await pacedWait(page, 700);            // past the persist debounce
  const before = await view(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 1200);
  const after = await view(page);
  ok("the zoom level comes back", Math.abs(after.z - before.z) < 0.01,
    `${(before.z * 100).toFixed(0)}% → ${(after.z * 100).toFixed(0)}%`);
  ok("and so does where the page was left", Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2,
    `view ${before.x.toFixed(0)},${before.y.toFixed(0)} → ${after.x.toFixed(0)},${after.y.toFixed(0)}`);

  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("planyr:notes:view:")));
  ok("⛔ IT IS KEYED PER PAGE, not one level for the whole workspace",
    stored.length === 1 && stored[0].endsWith(":p1"), stored.join(", ") || "nothing stored");
});

/* ── 7 · THE WORKSPACE IS UNBOUNDED ─────────────────────────────────────────────────────────── */
await section("7 · the page can be pushed past every edge — there is no hard stop", async (page) => {
  const m = await matRect(page);
  const centre = { x: m.left + m.width / 2, y: m.top + m.height / 2 };
  /* ⛔ THIS IS THE ONE PROPERTY A SCROLLER COULD NEVER HAVE, and it is the whole reason the width
   * feature's compensation could be deleted: `scrollLeft` clamps at 0 and at its content's edge.
   * Pushing the page clean off each side in turn is the direct reading of "unbounded". */
  for (const [label, dx, dy, test] of [
    ["off the RIGHT", -400, 0, (s) => s.left > m.right],
    ["off the LEFT", 400, 0, (s) => s.right < m.left],
    ["off the BOTTOM", 0, -400, (s) => s.top > m.bottom],
    ["off the TOP", 0, 400, (s) => s.bottom < m.top],
  ]) {
    await page.keyboard.press("Control+0");
    await pacedWait(page, 250);
    await page.mouse.move(centre.x, centre.y);
    for (let i = 0; i < 14; i += 1) await panWheel(page, dx, dy);
    await pacedWait(page, 300);
    const s = await sheetRect(page);
    ok(`the page can be pushed ${label} of the window`, test(s),
      `page ${s.left.toFixed(0)}..${s.right.toFixed(0)} × ${s.top.toFixed(0)}..${s.bottom.toFixed(0)}`);
  }
  await page.keyboard.press("Control+0");
  await pacedWait(page, 300);
  const back = await sheetRect(page);
  ok("and Ctrl+0 always brings it back", back.left > m.left && back.right < m.right + 400,
    `page left ${back.left.toFixed(0)}`);
});

/* ── 8 · B1393 AT EVERY ZOOM ────────────────────────────────────────────────────────────────── */
/* ⛔ SECTION 8 OPENS A FRESH PAGE PER ARM, and that is a correction rather than a style choice.
 * The first version reused one page and reset it by rewriting localStorage plus a reload; the
 * editor's own save debounce put the previous arm's box back, so the second arm found TWO boxes
 * whose text both matched and `find` picked the older one — reporting "off by 185px" about a
 * placement that was correct. A contaminated fixture reporting a false failure is the same species
 * as a contaminated fixture reporting a false pass, and it is the reason this file asserts on a
 * page that has held exactly one box in its life. */
console.log("\n── 8 · B1393 · double-click on blank paper places a box AT THE CLICK POINT, at any zoom ──");
/* ⛔ THE REGRESSION THIS SECTION EXISTS FOR IS NAMED IN THE BRIEF: PR #1774 / B1393 must not
 * break. It was only ever checked at 100%, where the view transform is the identity and a
 * placement that forgets to map through it is indistinguishable from one that does not. At a
 * far-out or far-in zoom the two answers diverge by a factor of the scale, so this is the check
 * that actually constrains the coordinate mapping. */
/* ⛔ A SWEEP ACROSS THE RANGE, NOT THREE POINTS — because "does it work far out" turned out to
 * have a measured answer rather than a yes/no one, and reporting the yes/no would have been the
 * dishonest half of it.
 *
 * The blank paper this gesture needs is the sheet's own side padding, ~40 workspace px, so on
 * screen it is 40 × zoom wide: 32px at 80%, 10px at 25%, and **4px at 10%**. Below roughly a
 * pointer's own width there is nothing a person could aim at either, so an arm that clicked there
 * and found no box would be reporting the ZOOM, not the placement. Each level therefore declares
 * whether its target is aimable and is asserted only if it is — and the levels that are not are
 * printed with their measured strip width rather than quietly dropped. */
const AIMABLE_MIN = 8;   // screen px — narrower than this and a person could not hit it either
/* ⛔ THE ZOOM IS REACHED WITH THE KEYBOARD LADDER, NOT WITH WHEEL NOTCHES, because the wheel is
 * PROPORTIONAL and "a few notches" is not a level. The first version asked for 6/12/24 notches of
 * 240 and every one of them landed on the 10% floor (each notch is ×0.55, so six of them is
 * already ×0.028) — three arms that all printed "(10%)" while claiming to be 50%, 25% and 10%.
 * Ctrl+− walks exact, nameable rungs, so each arm is at the level its label says. */
for (const [label, zoomTo] of [
  ["10% (the far end)", { key: "Control+Minus", n: 8 }],
  ["25%", { key: "Control+Minus", n: 6 }],
  ["50% (working far-out)", { key: "Control+Minus", n: 4 }],
  ["at 100%", null],
  ["200%", { key: "Control+Equal", n: 5 }],
  /* 12 rungs, not 8: the ladder from 100% is 1.1·1.25·1.5·1.75·2·2.5·3·4·6·8, so eight
   presses lands on 400%. Overshooting is safe — the level clamps at the ceiling. */
  ["800% (far in)", { key: "Control+Equal", n: 12 }],
]) {
  const page = await openPage();
  try {
    /* ⛔ THE TARGET IS CHOSEN IN WORKSPACE COORDINATES, AT 100%, BEFORE ANY ZOOM. That is what
     * makes the three arms the SAME question asked at three scales: the same spot on the same
     * paper, aimed at through three different transforms. Choosing it on screen after zooming
     * would silently make each arm a different question. */
    const s100 = await sheetRect(page);
    const m100 = await matRect(page);
    const blank = await workspaceOf(page, s100.right - 34, s100.top + 300);
    ok(`${label}: the aiming point is real blank paper inside the sheet`,
      s100.right - 34 > s100.left && s100.top + 300 < s100.bottom,
      `sheet ${s100.left.toFixed(0)}..${s100.right.toFixed(0)} × ${s100.top.toFixed(0)}..${s100.bottom.toFixed(0)}, mat right ${m100.right.toFixed(0)}`);

    if (zoomTo) {
      for (let i = 0; i < zoomTo.n; i += 1) await page.keyboard.press(zoomTo.key);
      await pacedWait(page, 350);
    }
    const v = await view(page);
    /* The blank strip's own width on screen at this level — the thing that decides whether this
     * arm is a question about placement or a question about zoom. */
    const strip = 34 * v.z;
    if (strip < AIMABLE_MIN) {
      cannot(`${label} (${(v.z * 100).toFixed(0)}%): double-click placement on the side margin`,
        `the blank strip is ${strip.toFixed(1)}px wide on screen at this zoom — narrower than a pointer, `
        + "so neither this harness nor a person can aim at it; zoom in to place a box");
      await page.context().close();
      continue;
    }
    const reached = await bringIntoView(page, blank);
    ok(`${label} (${(v.z * 100).toFixed(0)}%): the blank-paper point can be brought on screen`,
      reached, reached ? `strip ${strip.toFixed(1)}px wide on screen` : "middle-drag could not bring it into the mat");
    if (reached) {
      const point = await screenOf(page, blank.x, blank.y);
      await page.mouse.move(point.x, point.y);
      await page.mouse.dblclick(point.x, point.y);
      await pacedWait(page, 200);
      await page.keyboard.type("here");
      await pacedWait(page, 400);

      const boxes = await page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), left: r.left, top: r.top };
      }));
      /* Only the box that holds the typing is the one this gesture made — the migrated flow box is
       * the fixture's own baseline. */
      const made = boxes.filter((b) => b.text === "here");
      ok(`${label} (${(v.z * 100).toFixed(0)}%): exactly ONE box was created and holds the typing`,
        made.length === 1 && boxes.length === BASE_BOXES + 1,
        `${boxes.length} box(es), ${made.length} holding "here"`);
      if (made.length === 1) {
        const got = await workspaceOf(page, made[0].left, made[0].top);
        const dx = Math.abs(got.x - blank.x);
        const dy = Math.abs(got.y - blank.y);
        ok(`${label} (${(v.z * 100).toFixed(0)}%): it landed ON the click point`,
          dx <= POS_TOL && dy <= POS_TOL, `off by ${dx.toFixed(1)}, ${dy.toFixed(1)} workspace px`);
      }
    }
  } catch (e) {
    ok(`${label}: B1393 arm threw`, false, e.message);
  }
  if (page._errs.length) ok(`${label}: no console errors`, false, page._errs.slice(0, 2).join(" | "));
  await page.context().close();
}

/* ── 9 · THE PLAIN WHEEL MUST NOT HIJACK WHAT SCROLLS ITSELF (NEW-1) ───────────────────────── */
const cell = (t, w) => ({ type: "tableCell", attrs: { colwidth: [w] }, content: [P(t)] });
const WIDE_DOC = {
  type: "doc",
  content: [
    P("Above the table."),
    { type: "table", content: [
      { type: "tableRow", content: [cell("alpha", 700), cell("bravo", 700)] },
      { type: "tableRow", content: [cell("charlie", 700), cell("delta", 700)] },
    ] },
    { type: "codeBlock", content: [{ type: "text", text: "x".repeat(400) }] },
    ...Array.from({ length: 14 }, (_, i) => P(`Trailing paragraph ${i + 1} so the note is tall.`)),
  ],
};
await section("9 · the wheel over a wide table, a code block, an open menu and the rail scrolls THEM, not the zoom", async (page) => {
  const zoom = async () => (await view(page)).z;
  const centreOf = (sel) => page.evaluate((q) => {
    const el = document.querySelector(q);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 200), y: r.top + r.height / 2 };
  }, sel);

  /* Known-good arm: over blank canvas, the very same wheel DOES zoom — so a "zoom unchanged" row
   * below is about the element owning the wheel, never about a canvas that could not zoom. */
  const m = await matRect(page);
  await page.mouse.move(m.right - 30, m.top + 200);
  const z0 = await zoom();
  await page.mouse.wheel(0, -120);
  await pacedWait(page, 250);
  known("over the blank canvas the same plain wheel zooms (the arms below are not vacuous)", (await zoom()) > z0 + 0.05);
  await page.keyboard.press("Control+0");
  await pacedWait(page, 300);

  const tbl = await page.evaluate(() => {
    const w = document.querySelector(".tableWrapper");
    return w ? { sw: w.scrollWidth, cw: w.clientWidth, cs: getComputedStyle(w).overflowX } : null;
  });
  ok("precondition: the fixture's table genuinely overflows its wrapper sideways",
    !!tbl && tbl.sw > tbl.cw + 20 && tbl.cs === "auto", JSON.stringify(tbl));

  if (tbl && tbl.sw > tbl.cw + 20) {
    const at = await centreOf(".tableWrapper table");
    const zBefore = await zoom();
    const vBefore = await view(page);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 200);
    await page.keyboard.up("Shift");
    await pacedWait(page, 300);
    const sl = await page.evaluate(() => document.querySelector(".tableWrapper").scrollLeft);
    const vAfter = await view(page);
    ok("Shift+wheel over the wide table scrolls the TABLE sideways", sl > 20, `scrollLeft ${sl}`);
    ok("and neither zoom nor pan of the canvas moved", Math.abs(vAfter.z - zBefore) < 1e-6
      && Math.abs(vAfter.x - vBefore.x) < 1e-6 && Math.abs(vAfter.y - vBefore.y) < 1e-6,
      `view ${JSON.stringify(vBefore)} → ${JSON.stringify(vAfter)}`);

    await page.evaluate(() => { document.querySelector(".tableWrapper").scrollLeft = 0; });
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(90, 0);
    await pacedWait(page, 300);
    const sl2 = await page.evaluate(() => document.querySelector(".tableWrapper").scrollLeft);
    ok("a sideways swipe over the wide table scrolls the TABLE too", sl2 > 20 && Math.abs((await zoom()) - zBefore) < 1e-6,
      `scrollLeft ${sl2}`);

    /* And the converse, so this is not "the table swallows everything": a plain VERTICAL wheel over
     * a table that only scrolls sideways has nothing to scroll and must zoom like anywhere else. */
    await page.evaluate(() => { document.querySelector(".tableWrapper").scrollLeft = 0; });
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -120);
    await pacedWait(page, 250);
    ok("a plain vertical wheel over the same table (nothing to scroll that way) still zooms",
      (await zoom()) > zBefore + 0.05, `${zBefore.toFixed(3)} → ${(await zoom()).toFixed(3)}`);
  }

  cannot("a wheel over a code block that overflows sideways",
    "inside a placed box a code block wraps (nothing to scroll), so it cannot be made to overflow here; "
    + "the wide-table arm above exercises the same generic 'element that really scrolls owns the wheel' rule");

  /* An open toolbar menu (portaled outside the canvas). */
  await page.keyboard.press("Control+0");
  await pacedWait(page, 300);
  await page.click('[data-testid="nt-font"]');
  await pacedWait(page, 250);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="nt-font-menu"]');
    return el ? { sh: el.scrollHeight, ch: el.clientHeight } : null;
  });
  ok("precondition: the Font menu is open", !!menu, JSON.stringify(menu));
  if (menu) {
    const at = await centreOf('[data-testid="nt-font-menu"]');
    const zBefore = await zoom();
    const vBefore = await view(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -120);
    await pacedWait(page, 300);
    const vAfter = await view(page);
    ok("the wheel over the open Font menu never zooms or pans the canvas beneath it",
      Math.abs(vAfter.z - zBefore) < 1e-6 && Math.abs(vAfter.x - vBefore.x) < 1e-6 && Math.abs(vAfter.y - vBefore.y) < 1e-6,
      `view ${JSON.stringify(vBefore)} → ${JSON.stringify(vAfter)}`);
  }
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);

  /* The notebook rail. */
  const rail = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="notes-tree"] [role="tree"]') || document.querySelector('[role="tree"]');
    return el ? { sh: el.scrollHeight, ch: el.clientHeight } : null;
  });
  if (rail) {
    const at = await centreOf('[role="tree"]');
    const zBefore = await zoom();
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, 120);
    await pacedWait(page, 300);
    ok("the wheel over the notebook rail never zooms the canvas", Math.abs((await zoom()) - zBefore) < 1e-6,
      `zoom ${zBefore.toFixed(3)} → ${(await zoom()).toFixed(3)}`);
  } else {
    ok("the notebook rail is present to be tested", false, "no [role=tree] found");
  }
}, WIDE_DOC);

/* ── verdict ────────────────────────────────────────────────────────────────────────────────── */
await browser.close();

if (unverified.length) {
  console.log("\n── NOT EXERCISED HERE (named, never folded into a pass) ──");
  for (const u of unverified) console.log(`  · ${u}`);
}
if (voids.length) {
  console.log(`\n⛔ RUN VOID — ${voids.length} known-good arm(s) did not report their known value: ${voids.join(", ")}`);
  process.exit(2);
}
console.log(`\n${failures.length ? "✗" : "✓"} ${failures.length ? `${failures.length} failed: ${failures.join(", ")}` : "all checks passed"}`);
process.exit(failures.length ? 1 : 0);
