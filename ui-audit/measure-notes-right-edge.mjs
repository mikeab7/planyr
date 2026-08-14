/* measure-notes-right-edge — THE PAGE GROWS RIGHT; THE BOX IS NOT CRUSHED (NEW-RIGHT-EDGE).
 *
 * ⛔ HIS REPORT: *"it's not letting me expand this box out to the right… it seems like there's a
 * wall where when I go past it, it squeezes my text box down to where it's literally one
 * character wide. And it's on the right side of the canvas."* His screenshot shows a box holding
 * "High Voltage Planning Study" rendered ONE LETTER PER LINE against the right margin.
 *
 * ⛔ AND HE NAMED THE CAUSE AS HIS OWN EARLIER INSTRUCTION, which is why this file states the
 * history rather than just the fix. When the block used to JUMP LEFT away from the click he asked
 * for *"if it will not fit, NARROW the block to the space available — do not slide it sideways."*
 * Right about not sliding, wrong about narrowing with no usable floor: near the margin the space
 * available is a few pixels, so the box became a few pixels.
 *
 * ⛔ THE TEST IS HIS, VERBATIM: *"place a box at increasing x across the full width in small
 * steps and assert the stored width never drops below the floor, and that beyond the floor the
 * scrollable canvas width increases instead."* Both halves are asserted here, and the LEFT EDGE
 * is checked at every step too — because the fix must not reintroduce the sliding this replaced.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const FLOOR = 160;                       // ANCHOR_MIN_WIDTH — kept in step by the unit suite

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "measure-notes-right-edge");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

async function seed(boxes = []) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix, bs]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Edge", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line of ordinary text" }] },
        ...bs.map((b) => ({
          type: "noteAnchor", attrs: b,
          content: [{ type: "paragraph", content: [{ type: "text", text: "High Voltage Planning Study" }] }],
        })),
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX, boxes]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
}

/** The rendered box, the STORED box, and how wide the scrollable sheet is. */
const readState = () => page.evaluate(() => {
  const el = document.querySelector(".planyr-anchor");
  const pm = document.querySelector(".ProseMirror");
  const raw = localStorage.getItem("planyr:notes:page:v1:local:p1");
  let stored = null;
  try {
    const walk = (n) => {
      if (n?.type === "noteAnchor") { stored = n.attrs; return; }
      (n?.content || []).forEach(walk);
    };
    walk(JSON.parse(raw));
  } catch (_) { /* unreadable — reported as null */ }
  /* ⛔ THE REAL SCROLLER, FOUND BY COMPUTED STYLE — not by a substring of an inline style, which
   * is what the first version did and it matched an outer wrapper that cannot scroll. That
   * reported "the canvas did not grow" while the canvas was growing perfectly well, which is
   * TRAPS.md trap 3 wearing a new hat: a confident verdict from an instrument pointed at the
   * wrong element. */
  let scroller = null;
  for (let n = pm?.parentElement; n; n = n.parentElement) {
    const ox = getComputedStyle(n).overflowX;
    if (ox === "auto" || ox === "scroll") { scroller = n; break; }
  }
  return {
    renderedW: el ? Math.round(el.getBoundingClientRect().width) : null,
    renderedLeft: el ? Math.round(parseFloat(el.style.left)) : null,
    lines: el ? Math.round(el.getBoundingClientRect().height / 18) : null,
    stored,
    hostWidth: pm ? Math.round(pm.clientWidth) : null,
    sheetScrollW: pm ? Math.round(pm.scrollWidth) : null,
    canvasScrollW: scroller ? Math.round(scroller.scrollWidth) : null,
    canvasClientW: scroller ? Math.round(scroller.clientWidth) : null,
  };
});

/* ════ 1. HIS TEST: a box placed at increasing x across the full width ════════════════════ */
console.log("\n" + "=".repeat(104));
console.log("A BOX AT INCREASING x — the stored width must never drop below the floor");
console.log("=".repeat(104));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("x", 8) + pad("stored w", 11) + pad("rendered w", 13) + pad("left kept", 12) + pad("canvas scrollW", 16) + "verdict");
console.log("-".repeat(104));

/* ⛔ THE DENOMINATOR IS THE SCROLLER'S WIDTH, NOT THE SHEET'S — and getting that wrong is the
 * third instrument error of this shape today (TRAPS.md trap 2). The first version asked whether
 * the box passed the SHEET's right edge and demanded the canvas grow; but the sheet is narrower
 * than the scroller, so a box could sit comfortably inside the visible canvas while "overhanging"
 * by that measure, and six perfectly correct rows were reported as failures. Growth is only owed
 * when the box passes what the WINDOW can show. */
await seed([{ x: 0, y: 40, w: 180 }]);
const first = await readState();
const host = first.canvasClientW || first.hostWidth;
const STEP = Math.max(40, Math.round(host / 14));
console.log(`  (sheet ${first.hostWidth}px · visible canvas ${host}px — growth is owed past the canvas)\n`);
const failures = [];
let prevCanvas = 0;

for (let x = 0; x <= host + 200; x += STEP) {
  await seed([{ x, y: 40, w: 180 }]);
  const st = await readState();
  const storedW = Number(st.stored?.w) || 0;
  const leftKept = Number(st.stored?.x) === x && st.renderedLeft === x;
  const belowFloor = st.renderedW != null && st.renderedW < FLOOR - 1;
  // Past the point where the box no longer fits, the canvas must be growing instead.
  const overhangs = x + (st.renderedW || FLOOR) > host;
  const canvasGrew = (st.canvasScrollW || 0) > (st.canvasClientW || 0);

  let verdict = "ok";
  if (belowFloor) { verdict = "⛔ CRUSHED"; failures.push(`x=${x}: rendered ${st.renderedW}px, below the ${FLOOR}px floor`); }
  else if (!leftKept) { verdict = "⛔ LEFT EDGE MOVED"; failures.push(`x=${x}: stored x=${st.stored?.x}, rendered left=${st.renderedLeft}`); }
  else if (overhangs && !canvasGrew) { verdict = "⛔ NO ROOM MADE"; failures.push(`x=${x}: box overhangs and the canvas did not grow`); }

  console.log(pad(x, 8) + pad(storedW, 11) + pad(st.renderedW, 13) + pad(leftKept ? "yes" : "NO", 12)
    + pad(`${st.canvasScrollW} / ${st.canvasClientW}`, 16) + verdict);
  prevCanvas = st.canvasScrollW || prevCanvas;
}

/* ════ 2. THE TEXT IS READABLE, NOT ONE LETTER PER LINE ══════════════════════════════════ */
await seed([{ x: Math.round(host - 30), y: 40, w: 180 }]);
const edge = await readState();
console.log("\nHIS SCREENSHOT'S CASE — a box hard against the right margin");
console.log(`  rendered width : ${edge.renderedW}px (floor ${FLOOR})`);
console.log(`  wrapped into   : about ${edge.lines} line(s) — one letter per line would be ~27`);
if (edge.renderedW < FLOOR - 1) failures.push("the edge case still renders below the floor");
if ((edge.lines || 0) > 8) failures.push(`the edge case wraps into ~${edge.lines} lines — still crushed`);

/* ════ 3. DRAGGING THE HANDLE RIGHTWARD GROWS THE PAGE RATHER THAN STOPPING DEAD ═════════ */
// Start close enough to the canvas edge that a rightward drag genuinely has to make room.
await seed([{ x: Math.round(host - 260), y: 40, w: 180 }]);
await page.locator(".planyr-anchor").first().click();          // stage 1: select, revealing the handle
await pacedWait(page, 350);
const handle = page.locator(".planyr-anchor-size").first();
let dragged = null;
if (await handle.count()) {
  const hb = await handle.boundingBox();
  if (hb) {
    const beforeDrag = await readState();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    // Well past the old wall, in steps, so the handler sees real movement.
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(hb.x + hb.width / 2 + i * 60, hb.y + hb.height / 2);
    await page.mouse.up();
    await pacedWait(page, 900);
    const afterDrag = await readState();
    dragged = { before: beforeDrag, after: afterDrag };
    console.log("\nDRAGGING THE HANDLE RIGHTWARD, past the old wall");
    console.log(`  stored width : ${beforeDrag.stored?.w} → ${afterDrag.stored?.w}`);
    console.log(`  canvas       : ${beforeDrag.canvasScrollW} → ${afterDrag.canvasScrollW} (client ${afterDrag.canvasClientW})`);
    if (!(Number(afterDrag.stored?.w) > Number(beforeDrag.stored?.w) + 20)) {
      failures.push(`the drag did not widen the box (${beforeDrag.stored?.w} → ${afterDrag.stored?.w})`);
    }
    if (!((afterDrag.canvasScrollW || 0) > (afterDrag.canvasClientW || 0))) {
      failures.push("the drag widened the box but the canvas did not grow to hold it");
    }
  }
}
if (!dragged) console.log("\n⛔ COULD NOT REACH THE RESIZE HANDLE — the control moved.");

console.log("\n" + (failures.length ? `⛔ ${failures.length} FAILURE(S)` : "✓ every step ok"));
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`\npage errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);

await browser.close();
process.exit(failures.length ? 1 : 0);
