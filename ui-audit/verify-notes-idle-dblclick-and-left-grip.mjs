/* Self-verification for two owner-reported items dispatched 2026-09-17:
 *
 *   NEW-1 — double-clicking an empty area of a sketch canvas (a REAL page, other content
 *           already on it) still did nothing, a recurrence of B1683296-98. This drives the
 *           EXACT gesture with REAL, TRUSTED input (Playwright's `page.mouse` API — CDP-
 *           dispatched, isTrusted:true in Chromium, not `element.click()` and not a page-context
 *           `dispatchEvent`), both as two genuinely separate slow presses (no native `dblclick`
 *           forms at all — the exact reported race) and as a fast native double-click
 *           (regression: the existing fast path must keep working, and must not double-create).
 *
 *   NEW-2 — dragging a Notes page's LEFT width grip outward shifted the content left instead of
 *           only moving the boundary. This drags the real grip with real trusted mouse input and
 *           asserts: the body's on-screen X position is unchanged, the sheet's right edge is
 *           unchanged, and the sheet's left edge visibly tracks the drag.
 *
 * Run: npx vite preview --port 4173 &  (already built)
 *      node ui-audit/verify-notes-idle-dblclick-and-left-grip.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-idle-dblclick-and-left-grip");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const tb = (id) => page.locator(`[data-testid="${id}"]`);
const settle = async () => page.waitForTimeout(1100);

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await tb("module-tab-notes").first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });

console.log("\nNEW-1 — sketch double-click, real trusted input\n");

/* A fresh throwaway page, never touching a real one — matches the dispatch's own instruction
 * ("do not touch or edit that page; reproduce on a new throwaway page instead"). `nt-box` on a
 * still-empty page turns THAT (empty) paragraph into a sketch holding one blank, auto-opened
 * box, and leaves a fresh paragraph after it to keep typing on — done FIRST, before any other
 * body text exists, so it doesn't swallow unrelated words into the box's own label. */
await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await settle();
await tb("nt-box").click();
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(400);
ok("a sketch with one open, blank box is on the page (the note toolbar's own Box command)",
  await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 1);
await page.keyboard.type("Existing box", { delay: 6 });
await page.keyboard.press("Escape");
await settle();
ok("that box is committed with its text — this is now a REAL page with existing sketch content",
  await page.locator("[data-sketch-node]").count() === 1);

/* Now add SEPARATE body text, in the paragraph the sketch's own tail-insurance left after it —
 * a real page with both prose and a sketch, matching the screenshot's "otherwise-used canvas". */
await page.mouse.click(...(await (async () => {
  const b = await tb("note-body").boundingBox();
  return [b.x + 20, b.y + b.height - 12];
})()));
await page.keyboard.type("Throwaway page for NEW-1 verification.", { delay: 6 });
await settle();

const canvasBox = async () => tb("note-sketch").first().locator("[data-sketch-canvas]").boundingBox();

/* ════ Case A — THE EXACT REPORTED RACE: two REAL, separately-dispatched presses on a
 * DIFFERENT empty area — the same shape as the report's own diagnosis: `page.mouse.down()`/
 * `up()` called twice, rather than one `page.mouse.dblclick()`, never forms a native `dblclick`
 * in this Chromium/CDP setup at ANY gap (calibrated separately from 150ms to 700ms — every one
 * failed to raise a native `dblclick`; only the single combined `dblclick()` call does), so a
 * SHORT, ordinary-cadence gap already proves the case without needing an artificially slow one.
 * Before this fix, the idle case (nothing pending) had NO fallback at all when native recognition
 * failed — node count stayed put, nothing appeared, matching "nothing happens — no box, no
 * error" byte for byte. */
{
  const c = await canvasBox();
  const spot = { x: c.x + c.width - 60, y: c.y + c.height - 40 };
  const before = await page.locator("[data-sketch-node]").count();
  await page.evaluate(() => {
    window.__dblCountA = 0;
    window.addEventListener("dblclick", () => { window.__dblCountA += 1; }, true);
  });
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(180); // an ordinary double-click cadence, well inside SKETCH_DBLTAP_MS
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const nativeDbl = await page.evaluate(() => window.__dblCountA);
  ok("(A) two separately-dispatched presses, ordinary cadence, raised NO native dblclick in this Chromium/CDP setup — proves this is the idle-case race, not the already-fixed relocate case",
    nativeDbl === 0, `${nativeDbl} dblclick event(s)`);
  const after = await page.locator("[data-sketch-node]").count();
  ok("⛔ THE EXACT REPORTED BUG, IDLE STATE: two separate presses on empty canvas, nothing pending beforehand, no native dblclick — a box now appears anyway",
    after === before + 1, `${before} → ${after} box(es)`);
  ok("...focused and ready to type into, per the on-canvas hint",
    await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 1
    && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "sketch-box-label");
  await page.keyboard.type("Placed by the reconstructed idle double-click", { delay: 6 });
  await page.keyboard.press("Escape");
  await settle();
}

/* ════ Case B — a genuinely FAST, native double-click on yet another empty spot still works
 * (the pre-existing path this fix must not disturb), and does not mint a SECOND box on top of
 * the one this session's own manual detection would already have created for the same gesture. */
{
  const c = await canvasBox();
  const spot = { x: c.x + 60, y: c.y + c.height - 40 };
  const before = await page.locator("[data-sketch-node]").count();
  await page.mouse.dblclick(spot.x, spot.y);
  await page.waitForTimeout(500);
  const after = await page.locator("[data-sketch-node]").count();
  ok("(B) a fast native double-click on empty canvas still creates exactly ONE box — never zero, never two",
    after === before + 1, `${before} → ${after} box(es)`);
  ok("...focused and typeable", await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 1);
  await page.keyboard.type("Placed by the fast native dblclick", { delay: 6 });
  await page.keyboard.press("Escape");
  await settle();
}

/* ════ Case C — double-clicking an EXISTING, already-committed box still just reopens it
 * (B1683297, unaffected by this change) — the manual idle-tap detector must never fire when
 * the press lands on a real node. */
{
  const nodes = page.locator("[data-sketch-node]");
  const first = nodes.first();
  const id = await first.getAttribute("data-sketch-node");
  const before = await nodes.count();
  const box = await first.locator(".planyr-sketch-box").boundingBox();
  await page.mouse.click(box.x + 10, box.y + 10); // select
  await page.waitForTimeout(150);
  await page.mouse.dblclick(box.x + 10, box.y + 10); // reopen
  await page.waitForTimeout(300);
  const after = await nodes.count();
  ok("(C) double-clicking an EXISTING box reopens it and creates nothing new",
    after === before, `${before} → ${after} box(es), reopened id ${id}`);
  ok("...its editor is genuinely open", await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 1);
  await page.keyboard.press("Escape");
  await settle();
}

const finalBoxCount = await page.locator("[data-sketch-node]").count();
ok("no console/page error across the whole NEW-1 run", pageErrors.length === 0, pageErrors.join(" | ") || "clean");
ok("final tally: exactly 3 boxes on the canvas (1 seeded + 1 from case A + 1 from case B; case C reopens, creates nothing)",
  finalBoxCount === 3, `${finalBoxCount} box(es)`);

console.log("\nNEW-2 — left width grip: content fixed, boundary moves\n");

const pageErrors2Start = pageErrors.length;
await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await settle();
await page.mouse.click(...(await (async () => {
  const b = await tb("note-body").boundingBox();
  return [b.x + 20, b.y + 12];
})()));
await page.keyboard.type("Fixed body text for NEW-2 verification.", { delay: 6 });
await settle();
/* The session already holds several notes pages from the NEW-1 run above — a bare reload can
 * land the app on any of them, not necessarily this one. Read THIS page's own stored width
 * directly from its storage record rather than trusting whichever page the app opens by
 * default post-reload. */
const w2PageId = await page.evaluate(() => {
  const t = JSON.parse(localStorage.getItem("planyr:notes:tree:v1:local") || "null");
  return t.pages[t.pages.length - 1].id;
});
const storedPageWidth = () => page.evaluate((k) => {
  const p = JSON.parse(localStorage.getItem(k) || "null");
  return p?.doc?.attrs?.pageWidth ?? p?.attrs?.pageWidth ?? null;
}, `planyr:notes:page:v1:local:${w2PageId}`);
ok("this page starts genuinely unpinned (Fit to content) before any drag", (await storedPageWidth()) == null);

const rects = async () => {
  const sheet = await tb("note-sheet").boundingBox();
  const bodyEl = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="note-body"]');
    const p = body?.querySelector("p");
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  return { sheet, bodyEl };
};

const before = await rects();
ok("fixture in place: a paragraph and a sheet are both measurable before the drag", !!before.bodyEl && !!before.sheet);

const grip = tb("note-page-width-grip-left").first();
const gripBox = await grip.boundingBox();
ok("the left width grip exists and is on screen", !!gripBox);

const DRAG_PX = 90;
await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
await page.mouse.down();
// A few intermediate moves, matching a real drag rather than one teleporting jump.
for (const step of [20, 45, 70, DRAG_PX]) {
  await page.mouse.move(gripBox.x + gripBox.width / 2 - step, gripBox.y + gripBox.height / 2);
  await page.waitForTimeout(30);
}
const mid = await rects();
await page.mouse.up();
await page.waitForTimeout(400);
await settle();
const after = await rects();

ok("⛔ THE REPORTED BUG: the body's own on-screen X position is UNCHANGED across the drag (content does not move)",
  Math.abs(after.bodyEl.x - before.bodyEl.x) <= 1.5,
  `${before.bodyEl.x.toFixed(1)} → mid ${mid.bodyEl.x.toFixed(1)} → ${after.bodyEl.x.toFixed(1)}`);
ok("the body's on-screen Y position is likewise unchanged (no vertical side-effect)",
  Math.abs(after.bodyEl.y - before.bodyEl.y) <= 1.5);
ok("the sheet's RIGHT edge holds still on screen",
  Math.abs((after.sheet.x + after.sheet.width) - (before.sheet.x + before.sheet.width)) <= 1.5,
  `right edge ${(before.sheet.x + before.sheet.width).toFixed(1)} → ${(after.sheet.x + after.sheet.width).toFixed(1)}`);
ok("the sheet's LEFT edge (the boundary being dragged) genuinely moved outward, tracking the pointer",
  (before.sheet.x - after.sheet.x) >= DRAG_PX - 20,
  `left edge ${before.sheet.x.toFixed(1)} → ${after.sheet.x.toFixed(1)}, moved ${(before.sheet.x - after.sheet.x).toFixed(1)}px for a ${DRAG_PX}px drag`);
ok("the sheet is genuinely WIDER after the drag (new blank space opened, not just moved)",
  after.sheet.width > before.sheet.width + DRAG_PX - 20,
  `${before.sheet.width.toFixed(1)} → ${after.sheet.width.toFixed(1)}`);

/* The COMMITTED width must round-trip through storage (checked directly, by this page's own
 * id, rather than by re-measuring whichever page a bare reload happens to land the app on —
 * several other throwaway pages exist in this same session from the NEW-1 run above). A reload
 * settles at the app's ordinary right-grown rest position (the accepted trade-off
 * `widthDragLeftPadRef`'s own header states, mirroring `heightTopPadRef`'s) — that illusion
 * resetting is fine; the STORED number itself must not. */
const committedWidth = await storedPageWidth();
ok("the drag committed a real, persisted pageWidth attribute wider than the pre-drag default",
  typeof committedWidth === "number" && committedWidth >= before.sheet.width + DRAG_PX - 20,
  `stored pageWidth: ${committedWidth}`);
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(800);
const afterReloadWidth = await storedPageWidth();
ok("after a reload the STORED width is exactly what was committed — the resize itself persisted",
  afterReloadWidth === committedWidth, `${committedWidth} → ${afterReloadWidth} after reload`);

ok("no console/page error across the whole NEW-2 run", pageErrors.slice(pageErrors2Start).length === 0,
  pageErrors.slice(pageErrors2Start).join(" | ") || "clean");

await browser.close();
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed !== checks.length) {
  console.log("\nFailed:");
  for (const c of checks.filter((x) => !x.pass)) console.log(`  ✗ ${c.name}`);
}
process.exit(passed === checks.length ? 0 : 1);
