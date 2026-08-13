/* verify-notes-anchor-soak — THE GESTURE UNDER LOAD, NOT AT FOUR HAND-PICKED POINTS.
 *
 * ⛔ WHY THIS EXISTS, in the owner's words: *"The last two rounds each passed a handful of
 * hand-picked points and he still found it broken in seconds."* Both of those rounds were
 * green. Both shipped. The gesture failed on his machine inside a minute, because what breaks
 * it is not a bad coordinate — it is REPETITION: the litter one attempt leaves behind is what
 * kills the next one at the same spot, and a check that resets between every point can never
 * see that.
 *
 * So this drives the four things he asked for, in one continuous session per scenario:
 *   1. 20 presses at free points, a unique marker typed in each — every block at its own point,
 *      every marker in its own block.
 *   2. 20 presses where nothing is typed — the stored document must be BYTE-IDENTICAL after.
 *   3. 10 presses aimed INSIDE existing blocks, empty and non-empty — the caret lands in the
 *      block pressed and no new block appears.
 *   4. The whole set again at a zoom level that is not 100%, and again in a SHORT window
 *      (his is about 500 points tall), which is where the edge cases bite.
 *
 * Run:
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-anchor-soak.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const pageErrors = [];

/* ⛔ ONE PLACE THAT KNOWS THE GEOMETRY, and it converts in the PAGE rather than out here. The
 * store holds unscaled offsets from the editor's own box; a client coordinate is that, times
 * the live zoom, plus the box's top-left — and the box moves the moment anything scrolls. */
const DRIVER = {
  frame: (page) => page.evaluate(() => {
    const dom = document.querySelector('[data-testid="note-body"]');
    const r = dom.getBoundingClientRect();
    const scale = r.width / (dom.offsetWidth || 1) || 1;
    const flow = [...dom.children].filter((c) => !c.classList.contains("planyr-anchor"));
    const bottom = flow.length ? flow[flow.length - 1].getBoundingClientRect().bottom : r.top;
    return { width: dom.offsetWidth, blankFrom: Math.ceil((bottom - r.top) / scale) + 24, viewport: window.innerHeight, scale };
  }),
  clientOf: (page, docX, docY) => page.evaluate(([dx, dy]) => {
    const dom = document.querySelector('[data-testid="note-body"]');
    const r = dom.getBoundingClientRect();
    const scale = r.width / (dom.offsetWidth || 1) || 1;
    return { x: Math.round(r.left + dx * scale), y: Math.round(r.top + dy * scale) };
  }, [docX, docY]),
  blocks: (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="note-anchor"]')].map((el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
    empty: el.getAttribute("data-empty") === "1",
    text: (el.querySelector(".planyr-anchor-content") || el).innerText.trim(),
  }))),
};

const storedDoc = (page) => page.evaluate((k) => localStorage.getItem(k), `${PAGE_PREFIX}p1`);

async function seedPage(page, { tries = 3 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    /* Reload FIRST. The editor flushes its unsaved document on `beforeunload`, so writing the
     * seed and THEN reloading lets the page being torn down write its own document over it. */
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
    await pacedWait(page, 200);
    await page.evaluate(([treeKey, prefix]) => {
      localStorage.clear();
      localStorage.setItem(treeKey, JSON.stringify({
        v: 3, tombs: [], trash: [],
        pages: [{ id: "p1", title: "Soak", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
      }));
      localStorage.setItem(prefix + "p1", JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Existing first line." }] }],
      }));
    }, [TREE_KEY, PAGE_PREFIX]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
    await pacedWait(page, 400);
    if (await page.locator('[data-testid="note-anchor"]').count() === 0) return;
  }
  throw new Error("seed leaked — a block from an earlier scenario survived the reset");
}

/**
 * One full soak, in a window of the given size and at the given zoom.
 *
 * ⛔ EVERY SCENARIO RUNS IN ONE CONTINUOUS SESSION, WITHOUT RESETTING BETWEEN POINTS. That is
 * the whole design: what broke this on his machine was the leftovers of the previous attempt,
 * and a harness that reseeds between points is blind to exactly that.
 */
async function soak(label, { width, height, zoomSteps }) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "verify-notes-anchor-soak");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await seedPage(page);

  if (zoomSteps) {
    await page.keyboard.down("Control");
    for (let i = 0; i < zoomSteps; i += 1) await page.keyboard.press("Equal");
    await page.keyboard.up("Control");
    await pacedWait(page, 400);
    const z = await page.locator('[data-testid="note-sheet"]').getAttribute("data-zoom");
    ok(`${label} · the document really is at a zoom other than 100%`, Number(z) !== 1, `data-zoom=${z}`);
  }

  /* ---- 1. TWENTY FREE POINTS, EACH TYPED IN ------------------------------------------- */
  const frame = await DRIVER.frame(page);
  /* A grid, not random numbers: the points must not overlap each other's blocks, which would
   * make a failure a property of the fixture rather than of the app. Rows are one block-height
   * apart and columns are far enough apart that a 180-wide block cannot reach the next one. */
  const rows = Math.max(4, Math.floor((frame.viewport - 220) / (34 * frame.scale)));
  const points = [];
  for (let i = 0; i < 20; i += 1) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    points.push({
      x: Math.round(20 + col * Math.max(60, (frame.width - 60) / 3)),
      y: frame.blankFrom + (row % rows) * 34 + (col * 400),
      marker: `M${i}`,
    });
  }

  const placed = [];
  for (const p of points) {
    const c = await DRIVER.clientOf(page, p.x, p.y);
    if (c.y < 60 || c.y > frame.viewport - 30) continue;      // off-screen: the mouse cannot go there
    await page.mouse.click(c.x, c.y);
    await pacedWait(page, 140);
    await page.keyboard.type(p.marker);
    await pacedWait(page, 120);
    placed.push(p);
  }
  await pacedWait(page, 900);

  const blocks = await DRIVER.blocks(page);
  ok(`${label} · every press made exactly one block`, blocks.length === placed.length,
    `${placed.length} presses, ${blocks.length} blocks`);
  const misplaced = placed.filter((p) => !blocks.some((b) => b.left === p.x && b.top === p.y));
  ok(`${label} · ⛔ EVERY BLOCK IS AT ITS OWN PRESS POINT, all ${placed.length} of them`,
    misplaced.length === 0, misplaced.length ? JSON.stringify(misplaced.slice(0, 3)) : "exact");
  const strayed = placed.filter((p) => {
    const b = blocks.find((x) => x.left === p.x && x.top === p.y);
    return !b || b.text !== p.marker;
  });
  ok(`${label} · ⛔ EVERY MARKER IS IN ITS OWN BLOCK — nothing landed in a neighbour`,
    strayed.length === 0, strayed.length ? JSON.stringify(strayed.slice(0, 3).map((s) => s.marker)) : "each alone");

  /* ---- 2. TWENTY ABANDONED PRESSES: THE DOCUMENT MUST NOT MOVE ------------------------ */
  const before = await storedDoc(page);
  const abandoned = [];
  for (let i = 0; i < 20; i += 1) {
    const p = points[i];
    const c = await DRIVER.clientOf(page, p.x + 7, p.y + 11);
    if (c.y < 60 || c.y > frame.viewport - 30) continue;
    await page.mouse.click(c.x, c.y);
    await pacedWait(page, 90);
    abandoned.push(p);
  }
  // Leave the last provisional block by moving the caret off the page entirely.
  await page.locator('[data-testid="notes-tree"]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await pacedWait(page, 1200);
  const after = await storedDoc(page);
  ok(`${label} · ⛔ ${abandoned.length} PRESSES WITH NOTHING TYPED LEFT THE STORED DOCUMENT BYTE-IDENTICAL`,
    before === after, before === after ? `${before.length} bytes, unchanged` : `${before?.length} → ${after?.length} bytes`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  const afterReload = await DRIVER.blocks(page);
  ok(`${label} · …and after a reload only the blocks that were TYPED IN came back`,
    afterReload.length === placed.length && afterReload.every((b) => !b.empty),
    `${afterReload.length} blocks, ${afterReload.filter((b) => b.empty).length} empty`);

  /* ---- 3. TEN PRESSES INSIDE EXISTING BLOCKS ------------------------------------------ */
  /* ⛔ IDENTIFIED BY ITS OWN COORDINATES, NOT BY ITS INDEX. The index was taken from the
   * FILTERED on-screen list and then used against the FULL list further down, which agrees
   * only while the first on-screen box happens to be the first box — true at 100% and false
   * the moment a zoom pushes one off the top. A row that is right by coincidence is the thing
   * this whole file exists to stop. */
  const targets = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-anchor"]')]
    /* The DOCUMENT-space key is named apart from the rect, because a DOMRect has its own
     * `left`/`top` and spreading it second silently overwrote them — the key then matched
     * nothing and the row failed for a reason that had nothing to do with the app. */
    .map((el) => ({ ...el.getBoundingClientRect().toJSON(), docLeft: parseFloat(el.style.left), docTop: parseFloat(el.style.top) }))
    .filter((r) => r.top > 60 && r.bottom < window.innerHeight - 20)
    .slice(0, 5));
  const countBefore = afterReload.length;
  const inside = [];
  for (const t of targets) {
    /* ⛔ CLEAR OF THE BOX'S OWN CHROME. The delete and the width handle live at the right-hand
     * edge, so a press 8px in from it is a press on a CONTROL — which is a different test, and
     * one that would delete the box being measured. */
    for (const at of [{ dx: t.width - 36, dy: t.height - 8 }, { dx: 24, dy: t.height / 2 }]) {
      await page.mouse.click(Math.round(t.x + at.dx), Math.round(t.y + at.dy));
      await pacedWait(page, 130);
      await page.keyboard.type("*");
      await pacedWait(page, 110);
      inside.push(`${t.docLeft},${t.docTop}`);
    }
  }
  await pacedWait(page, 900);
  const afterInside = await DRIVER.blocks(page);
  ok(`${label} · ⛔ ${inside.length} PRESSES INSIDE EXISTING BLOCKS MADE NO NEW BLOCK`,
    afterInside.length === countBefore, `${countBefore} → ${afterInside.length}`);
  const wrongBlock = afterInside.filter((b) => {
    const expected = inside.filter((k) => k === `${b.left},${b.top}`).length;
    return (b.text.match(/\*/g) || []).length !== expected;
  });
  ok(`${label} · ⛔ …AND EVERY CHARACTER LANDED IN THE BLOCK THAT WAS PRESSED`,
    wrongBlock.length === 0, wrongBlock.length ? JSON.stringify(afterInside.map((b) => b.text).slice(0, 4)) : "each in its own");

  /* ---- 4. AN EMPTY BLOCK IS NEVER AN INVISIBLE DEAD ZONE ------------------------------
   *
   * ⛔ ON A FRESH PAGE, DELIBERATELY. The first version of this section reused the soaked page
   * and picked a "free" spot that already had a block in it, so the press landed inside that
   * block, no new one was made — and the follow-up check went GREEN because the text it looked
   * for did appear, in the wrong block. A check passing on the wrong property is this feature's
   * whole history; the fixture has to make the point genuinely free. */
  await seedPage(page);
  const f2 = await DRIVER.frame(page);
  const spot = { x: 40, y: f2.blankFrom + 40 };
  const c1 = await DRIVER.clientOf(page, spot.x, spot.y);
  await page.mouse.click(c1.x, c1.y);
  await pacedWait(page, 250);
  const afterFirst = await DRIVER.blocks(page);
  const provisional = afterFirst.find((b) => b.left === spot.x && b.top === spot.y);
  ok(`${label} · the press on a genuinely free point made exactly one block`,
    afterFirst.length === 1 && !!provisional, `${afterFirst.length} blocks`);
  ok(`${label} · ⛔ AN EMPTY BLOCK SAYS SO ON THE PAGE — it can never be an invisible obstacle`,
    !!provisional && provisional.empty, provisional ? `data-empty=${provisional.empty}` : "absent");
  /* …and pressing INSIDE it reaches it rather than doing nothing. This is the exact gesture
   * that failed: the second attempt at a spot you already tried. */
  await page.mouse.click(c1.x + 6, c1.y + 6);
  await pacedWait(page, 220);
  await page.keyboard.type("SECOND");
  await pacedWait(page, 400);
  const after2 = await DRIVER.blocks(page);
  ok(`${label} · ⛔ A SECOND PRESS AT THE SAME SPOT TYPES INTO IT — the "intermittent" failure`,
    after2.length === 1 && after2[0].text === "SECOND" && after2[0].left === spot.x && after2[0].top === spot.y,
    after2.length ? `${after2.length} block(s): ${JSON.stringify(after2.map((b) => b.text))} at ${after2[0].left},${after2[0].top}` : "the press did nothing");

  await ctx.close();
}

/* ⛔ THREE WINDOWS, because the geometry is where this breaks. The short one is HIS — about
 * 500 points of usable height — and it is the one that puts the blank page under the fold. */
await soak("A · a full-height window at 100%", { width: 1500, height: 950, zoomSteps: 0 });
await soak("B · the same, zoomed in", { width: 1500, height: 950, zoomSteps: 2 });
await soak("C · a SHORT window, which is his", { width: 1280, height: 520, zoomSteps: 0 });

ok("no uncaught page errors across the whole soak", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
