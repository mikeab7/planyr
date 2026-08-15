/* verify-markup-over-building.mjs — THE CASE FOUR SESSIONS NEVER DROVE.
 *
 * ⛔ WHY THIS HARNESS EXISTS WHEN `verify-v91632-real-plan.mjs` ALREADY PASSES 19/19 ON A REAL PLAN.
 * That harness reorders TWO TEXT BOXES against each other, and `audit-element-parity` reorders
 * markups against markups. Both are correct and both are blind to the report, because in both the
 * two objects share a band — so "back" moves within it and the picture changes. The owner's case is
 * a markup over a BUILDING, which is a question about the OTHER band. Measured on his own account
 * (a throwaway duplicate of Goose Creek Plan II): Send to Back ran, sent the markup to the back of a
 * band that is entirely above the elements, changed nothing visible, and then GREYED ITSELF — a
 * claim that the operation completed. The operation he wanted was two rows lower under a different
 * name.
 *
 * THE TRANSFERABLE RULE, and the reason it is stated here rather than in a commit message: WHEN A
 * USER SAYS A FEATURE "NEVER WORKS" AND IT DEMONSTRABLY WORKS IN THE CASE YOU TESTED, YOU TESTED THE
 * WRONG CASE. The variable is never the command — it is what the command is being asked about.
 *
 * WHAT THIS RUN IS: the owner's REAL saved plan (Bain / "Concept - Original", 47 elements, 5
 * georeferenced parcels, real rotations), in a REAL browser, against a REAL build, with the markup
 * DRAWN BY THE REAL TOOL over a real building — not seeded, because a seeded markup cannot prove the
 * tool produces the shape the defect needs. Every reading comes from the rendered DOM in document
 * order (paint order in SVG IS document order); a state read would call a dead feature green.
 *
 * WHAT IT IS NOT: a signed-in production tab. This sandbox's proxy CORS-blocks Supabase sign-in, so
 * the cloud round trip of these edits is out of reach here and is the live-verify half.
 *
 * Run: node ui-audit/verify-markup-over-building.mjs      (needs `npm run dev` on :5173)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.PLANYR_URL || "http://localhost:5173/";
const EXEC = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";
const SITE_ID = "markup-over-building";
const CACHE = fileURLToPath(new URL("../.cache/raster", import.meta.url));

const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

mkdirSync(CACHE, { recursive: true });
const fixture = readFixture("bain");
const buildings = (fixture.els || []).filter((e) => e.type === "building");
if (!buildings.length) throw new Error("the Bain fixture has no buildings — this harness cannot run");

console.log(`\n=== THE OWNER'S REAL PLAN =================================================`);
console.log(`  ${fixture.site} / ${fixture.name}  ·  ${fixture._source?.siteId}`);
console.log(`  ${(fixture.els || []).length} elements · ${buildings.length} buildings · ${(fixture.markups || []).length} markups`);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let ctx, page;
try {
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: SITE_ID, cacheDir: CACHE });
  ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  page = await ctx.newPage();
  await assertMeasurable(page, "verify-markup-over-building");
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  if (pageErrors.length) {
    console.log("\n⛔ THE REAL PLAN CRASHED THE RENDER — every result below would be meaningless:");
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 250)));
    process.exit(1);
  }

  const fit = async () => {
    const fits = page.locator('button[title="Zoom to fit"]');
    for (let i = (await fits.count()) - 1; i >= 0; i--) {
      await fits.nth(i).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  };
  await fit();

  /* ⛔ ARRIVE AT THE POINT, ALWAYS, THROUGH ONE OPENER. Playwright dispatches no mousemove when the
   * pointer is already where you click, and this app arms hover-scoped chrome on movement
   * (CHROME-NEVER-EATS-A-PRESS clause 7). Holding the pointer still is not driving the app a hand
   * drives, and it has produced confident wrong answers in BOTH directions in this repo. */
  const arrive = async (x, y) => {
    await page.mouse.move(x + 240, y + 170);
    await page.waitForTimeout(120);
    await page.mouse.move(x, y);
    await page.waitForTimeout(160);
  };
  async function openMenuAt(x, y, { deselect = true } = {}) {
    if (deselect) { await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
    await arrive(x, y);
    await page.mouse.click(x, y, { button: "right" });
    await page.waitForTimeout(400);
  }
  const readMenu = () => page.evaluate(() => {
    const menu = [...document.querySelectorAll(".menu")].filter((m) => m.getBoundingClientRect().width > 0).pop();
    if (!menu) return null;
    return [...menu.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").trim(), disabled: b.disabled === true, title: b.getAttribute("title") || "",
      testid: b.getAttribute("data-testid") || "",
    })).filter((r) => r.text && r.text.length < 90);
  });
  const closeMenu = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(150); };
  const clickRow = async (text) => {
    const hit = await page.evaluate((want) => {
      const menu = [...document.querySelectorAll(".menu")].filter((m) => m.getBoundingClientRect().width > 0).pop();
      if (!menu) return false;
      const b = [...menu.querySelectorAll("button")].find((n) => (n.textContent || "").trim().startsWith(want));
      if (!b || b.disabled) return false;
      b.click();
      return true;
    }, text);
    await page.waitForTimeout(500);
    return hit;
  };

  /* Paint order, read off the rendered DOM. `true` = the markup paints AFTER the building, i.e. it
   * is on top of it — the state the owner is trying to get out of. */
  const markupOnTop = (mk, el) => page.evaluate(([m, b]) => {
    const mn = document.querySelector(`[data-feature="markup:${m}"]`);
    const bn = document.querySelector(`[data-feature="el:${b}"]`);
    if (!mn || !bn) return null;
    return !(mn.compareDocumentPosition(bn) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [mk, el]);

  /* ⛔ THE PROBE POINT IS THE OVERLAP, AND IT IS FOUND BY ASKING THE BROWSER, NOT BY ARITHMETIC.
   * A point qualifies only when BOTH the markup and the building are in the hit stack there — which
   * is the definition of "over the building" and is exactly the region the owner reports as
   * unreachable. Handles and `data-chrome` are skipped by the same rule the app's own resolver uses. */
  const overlapPoint = (mk, el) => page.evaluate(([m, b]) => {
    const stackAt = (x, y) => {
      const keys = [];
      for (const n of document.elementsFromPoint(x, y)) {
        if (n.closest("[data-handle-layer], [data-chrome]")) continue;
        const f = n.closest("[data-feature]");
        const k = f && f.getAttribute("data-feature");
        if (k && !keys.includes(k)) keys.push(k);
      }
      return keys;
    };
    const mn = document.querySelector(`[data-feature="markup:${m}"]`);
    if (!mn) return null;
    const r = mn.getBoundingClientRect();
    const step = 3;
    for (let y = Math.round(r.top); y <= Math.round(r.bottom); y += step) {
      for (let x = Math.round(r.left); x <= Math.round(r.right); x += step) {
        if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue;
        const keys = stackAt(x, y);
        if (keys[0] === `markup:${m}` && keys.includes(`el:${b}`)) return { x, y, stack: keys };
      }
    }
    return null;
  }, [mk, el]);

  const stackAt = (x, y) => page.evaluate(({ px, py }) => {
    const keys = [];
    for (const n of document.elementsFromPoint(px, py)) {
      if (n.closest("[data-handle-layer], [data-chrome]")) continue;
      const f = n.closest("[data-feature]");
      const k = f && f.getAttribute("data-feature");
      if (k && !keys.includes(k)) keys.push(k);
    }
    return keys;
  }, { px: x, py: y });

  /* ── DRAW THE MARKUP WITH THE REAL TOOL, OVER A REAL BUILDING ───────────────────────────────
   * Not seeded. A seeded markup proves the model; only the tool proves the shape a user actually
   * gets — and the DEFAULT markup is UNFILLED, which is what makes its interior click-through and
   * its stroke the only grab surface. That default is part of the reported symptom ("you can only
   * grab it on a sliver"), so overriding it would be testing a shape he does not have. */
  console.log("\n=== drawing a markup rectangle over a real building, with the real tool ===");
  const target = await page.evaluate(() => {
    // The biggest building actually on screen — the more pixels, the more honest the probe.
    let best = null;
    document.querySelectorAll('[data-feature^="el:"]').forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      if (!best || r.width * r.height > best.area) best = { id: n.getAttribute("data-feature").slice(3), area: r.width * r.height, r: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    return best;
  });
  if (!target) throw new Error("no on-screen element large enough to draw over");

  await page.getByRole("button", { name: /^Rectangle/ }).click().catch(async () => { await page.keyboard.press("r"); });
  await page.waitForTimeout(250);
  // Drag a box that straddles the building: it covers it and hangs off one side, so there IS an
  // uncovered sliver — which is what makes the "unreachable across the overlap" claim measurable
  // rather than trivially true.
  const R = target.r;
  const from = { x: Math.round(R.x - 30), y: Math.round(R.y - 30) };
  const to = { x: Math.round(R.x + R.w * 0.75), y: Math.round(R.y + R.h * 0.75) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const mkId = await page.evaluate(() => {
    const n = [...document.querySelectorAll('[data-feature^="markup:"]')].pop();
    return n ? n.getAttribute("data-feature").slice(7) : null;
  });
  ok("a markup rectangle was DRAWN with the real tool on the owner's real plan", !!mkId, mkId ? `markup:${mkId} over el:${target.id}` : "no markup created");
  if (!mkId) throw new Error("could not draw the markup — nothing below can be measured");

  /* ⛔ THE VACUITY GUARD, and it is the whole reason this harness is not another green report on a
   * case that cannot fail. If the markup is not on top of the building here, this is the tidy
   * markup-vs-markup scene all over again and every result below is meaningless. */
  const before = await markupOnTop(mkId, target.id);
  ok("PRECONDITION — the markup is painted OVER the building (else this harness tests nothing)", before === true,
    `markup on top: ${before}`);

  const pt = await overlapPoint(mkId, target.id);
  ok("PRECONDITION — a point exists where the markup covers the building (the app's own hit stack says so)",
    !!pt, pt ? `(${pt.x}, ${pt.y}) → ${JSON.stringify(pt.stack)}` : "no overlap point found");
  if (!pt || before !== true) throw new Error("the preconditions failed — refusing to report a score");

  /* ── NEW-1 · THE REPORTED REPRO ─────────────────────────────────────────────────────────── */
  console.log("\n=== NEW-1 · right-click the markup over the building → Send to Back ===");
  await openMenuAt(pt.x, pt.y);
  let rows = await readMenu();
  const backRow = (rows || []).find((r) => r.text.startsWith("Send to Back"));
  ok("the markup's own menu opens over the building", !!backRow, rows ? `${rows.length} rows` : "no menu");
  // ⛔ PRE-FIX: this row was DISABLED. A greyed row is a claim the operation is already done.
  ok("'Send to Back' is OFFERED, not greyed out", !!backRow && !backRow.disabled,
    backRow ? `disabled=${backRow.disabled} title="${backRow.title}"` : "row absent");

  const clicked = await clickRow("Send to Back");
  ok("'Send to Back' is clickable", clicked);
  await page.waitForTimeout(400);

  const after = await markupOnTop(mkId, target.id);
  // ⛔ THE ASSERTION THE WHOLE ITEM TURNS ON: the picture changed.
  ok("the markup is now BEHIND the building — the picture changed", after === false, `markup on top: ${after}`);
  const stackNow = await stackAt(pt.x, pt.y);
  ok("...and the browser's own hit test agrees the building is on top there",
    stackNow[0] === `el:${target.id}` && stackNow.includes(`markup:${mkId}`), JSON.stringify(stackNow));

  /* ── NEW-1 · AND ONLY NOW MAY THE ROW GREY ──────────────────────────────────────────────── */
  console.log("\n=== NEW-1 · the greyed state may only appear at a TRUE end of the stack ===");
  // The markup is still selected, so this right-click reaches it (NEW-2's priority rule).
  await openMenuAt(pt.x, pt.y, { deselect: false });
  rows = await readMenu();
  const back2 = (rows || []).find((r) => r.text.startsWith("Send to Back"));
  ok("the row is greyed only once the markup is genuinely at the back", !!back2 && back2.disabled === true,
    back2 ? `disabled=${back2.disabled}` : "row absent");
  ok("...and it says WHY, in terms of the whole drawing rather than a hidden band",
    !!back2 && /behind everything on the plan/i.test(back2.title), back2 ? `title="${back2.title}"` : "");
  await closeMenu();

  /* ── NEW-2 · THE WAY BACK ───────────────────────────────────────────────────────────────── */
  console.log("\n=== NEW-2 · a markup behind a building must be reachable again ===");
  // (a) While selected, its own menu is still reachable over the overlap.
  await openMenuAt(pt.x, pt.y, { deselect: false });
  rows = await readMenu();
  ok("(a) while it is selected, a right-click over the overlap still reaches the MARKUP",
    !!(rows || []).find((r) => /Bring in front of buildings/.test(r.text)),
    (rows || []).slice(0, 4).map((r) => r.text).join(" | "));
  await closeMenu();

  // (b) Deselected — this is the state the owner was stuck in.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const deselStack = await stackAt(pt.x, pt.y);
  ok("(b) PRECONDITION — deselected, an ordinary press at this point reaches the BUILDING, not the markup",
    deselStack[0] === `el:${target.id}`, JSON.stringify(deselStack));

  await openMenuAt(pt.x, pt.y);
  rows = await readMenu();
  const liftRow = (rows || []).find((r) => r.testid === "under-lift-0");
  const selRow = (rows || []).find((r) => r.testid === "under-select-0");
  ok("(b) the covering element's menu NAMES what is underneath", !!liftRow && !!selRow,
    liftRow ? `"${liftRow.text}" + "${selRow?.text}"` : (rows || []).map((r) => r.text).join(" | "));

  if (liftRow) {
    await page.evaluate(() => document.querySelector('[data-testid="under-lift-0"]')?.click());
    await page.waitForTimeout(500);
    const back = await markupOnTop(mkId, target.id);
    ok("(b) one click brings it back in front — the door is not one-way", back === true, `markup on top: ${back}`);
  } else {
    ok("(b) one click brings it back in front — the door is not one-way", false, "the row was never offered");
    await closeMenu();
  }

  /* ── NEW-1 · THE SINGLE-STEP MODES CROSS TOO, AND THE ROUND TRIP IS EXACT ────────────────── */
  console.log("\n=== NEW-1 · Send Backward / Bring Forward step across the band edge ===");
  await openMenuAt(pt.x, pt.y);
  await clickRow("Send Backward");
  const stepped = await markupOnTop(mkId, target.id);
  ok("Send Backward crosses the band edge in one step", stepped === false, `markup on top: ${stepped}`);
  await openMenuAt(pt.x, pt.y, { deselect: false });
  await clickRow("Bring Forward");
  const returned = await markupOnTop(mkId, target.id);
  ok("Bring Forward brings it back — the steps are inverses across the edge", returned === true, `markup on top: ${returned}`);

  /* ── PERSISTENCE ────────────────────────────────────────────────────────────────────────── */
  console.log("\n=== the move is a real edit — it survives a reload ===");
  await openMenuAt(pt.x, pt.y);
  await clickRow("Send to Back");
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const survived = await markupOnTop(mkId, target.id);
  ok("still behind the building after a hard reload", survived === false, `markup on top: ${survived}`);

  /* ── PDF-PARITY ─────────────────────────────────────────────────────────────────────────── */
  console.log("\n=== PDF-PARITY — the exported sheet stacks it the same way ===");
  const sheet = await page.evaluate(async ([m, b]) => {
    if (typeof window.__plannerExportSvg !== "function") return "no-hook";
    const svg = await window.__plannerExportSvg();
    if (!svg) return "no-svg";
    const host = document.createElement("div");
    host.innerHTML = typeof svg === "string" ? svg : svg.outerHTML;
    const mn = host.querySelector(`[data-feature="markup:${m}"]`) || host.querySelector(`[data-markup="${m}"]`);
    const bn = host.querySelector(`[data-feature="el:${b}"]`) || host.querySelector(`[data-el-id="${b}"]`);
    if (!mn || !bn) return "missing";
    return (mn.compareDocumentPosition(bn) & Node.DOCUMENT_POSITION_FOLLOWING) ? "building-on-top" : "markup-on-top";
  }, [mkId, target.id]);
  // The export CLONES the live SVG, so this COULD be argued from the source. PDF-PARITY exists
  // precisely to refuse that argument: build the real sheet and read its order.
  ok("the built sheet paints the building over the markup, exactly as the screen does",
    sheet === "building-on-top", `sheet: ${sheet}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
} finally {
  await page?.close().catch(() => {});
  await ctx?.close().catch(() => {});
  await browser.close().catch(() => {});
}
