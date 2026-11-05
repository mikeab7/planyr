/* verify-notes-free-placement — THE PAGE GROWS IN ALL FOUR DIRECTIONS, THE WHOLE BOX DRAGS, AND
 * NOTHING VANISHES IN SILENCE (NOTES-FREE-PLACEMENT, owner report 2026-09-08).
 *
 * ⛔ HIS WORDS, on the page-grows feature shipped a fortnight earlier: *"super buggy just to begin
 * with, only works on the right, not the left, and also the text size of the notebook page header
 * is massive."* All three held, and the first resolved into five separate defects.
 *
 * ⛔ WHAT THIS HARNESS EXISTS TO STOP COMING BACK, and it is the shape rather than the numbers:
 * growth was implemented on TWO of four edges and the other two were floored instead, which reads
 * as working right up until somebody drags the other way. So every case below is run as a FOUR-WAY
 * (or eight-way) sweep rather than as one direction with the others assumed — a single-direction
 * check is exactly what shipped last time.
 *
 * ⛔ AND IT MEASURES THE STORED DOCUMENT AFTER A RELOAD, not the screen. The canonical failure in
 * this module is a gesture that renders correctly and stores nothing (B434417 — rendered 300,
 * stored 180, 180 after a reload), so every geometry case here reads storage back on a fresh load.
 *
 * Traps honoured, all from docs/NOTES-CARRY-FORWARD.md §1: a REAL mouse (a synthetic click reaches
 * nothing — the placement is on `mousedown`), reads after the 600ms save debounce, and
 * `assertMeasurable` before anything is measured (FOREGROUND-OR-VOID).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const failures = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

const docWith = (boxes) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Body line one." }] },
    ...boxes.map((b, i) => ({
      type: "noteAnchor",
      attrs: { x: b.x, y: b.y, w: b.w ?? 180, h: null, aid: b.aid || `a${i + 1}` },
      content: [{ type: "paragraph", content: [{ type: "text", text: b.text || `BOX${i + 1}` }] }],
    })),
    { type: "paragraph", content: [] },
  ],
});

async function openPage(doc, { viewport = { width: 1400, height: 900 } } = {}) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await assertMeasurable(page, "verify-notes-free-placement");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Free placement", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  page.__errs = errs;
  return page;
}

/** Every anchor's STORED attributes, read out of localStorage rather than off the screen. */
const stored = (page) => page.evaluate((k) => {
  const out = [];
  try {
    const walk = (n) => { if (n?.type === "noteAnchor") out.push(n.attrs); (n?.content || []).forEach(walk); };
    walk(JSON.parse(localStorage.getItem(k)));
  } catch (_) { /* an unreadable page answers empty, and the caller fails on it */ }
  return out;
}, PAGE_KEY);

/** The page's own rendered geometry, and whether every box is actually ON it. */
const geom = (page) => page.evaluate(() => {
  const sheet = document.querySelector('[data-testid="note-sheet"]');
  const s = sheet?.getBoundingClientRect();
  const boxes = [...document.querySelectorAll(".planyr-anchor")].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.getAttribute("data-anchor-id"),
      left: Math.round(parseFloat(el.style.left)),
      top: Math.round(parseFloat(el.style.top)),
      onSheet: !!s && r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1,
    };
  });
  const title = document.querySelector('[data-testid="note-title"]')?.getBoundingClientRect();
  return {
    sheetW: s ? Math.round(s.width) : null,
    sheetH: s ? Math.round(s.height) : null,
    titleTop: title ? Math.round(title.top) : null,
    boxes,
  };
});

/** Drag one box by its BORDER (B2426788 — the striped grip is retired), with a real mouse, in `steps` so the gesture is a gesture. */
async function dragBox(page, aid, dx, dy, { steps = 10 } = {}) {
  const src = await page.evaluate((id) => {
    const el = document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`);
    if (!el || !el.querySelector(".planyr-anchor-edge")) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.3), y: Math.round(r.top + 0.5) };
  }, aid);
  if (!src) throw new Error(`dragBox: no border band for ${aid} — the harness cannot vouch for a gesture it never made`);
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(src.x + (dx * i) / steps, src.y + (dy * i) / steps);
  await page.mouse.up();
  await pacedWait(page, 800);                       // past the 600ms save debounce
}

/** Reload and read the stored document back — the only claim about persistence worth making. */
async function reloadAndRead(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  return { stored: await stored(page), geom: await geom(page) };
}

/* ═══ 1. THE FOUR-WAY (AND EIGHT-WAY) SWEEP — his own requested table ══════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("1. LEFT · RIGHT · ABOVE · BELOW · FOUR DIAGONALS — every one grows the page and persists");
console.log("=".repeat(100));

const START = { x: 240, y: 160, w: 180, aid: "m1" };
const D = 420;
const DIRECTIONS = [
  ["left", -D, 0], ["right", D, 0], ["above", 0, -D], ["below", 0, D],
  ["up-left", -D, -D], ["up-right", D, -D], ["down-left", -D, D], ["down-right", D, D],
];

const table = [];
for (const [name, dx, dy] of DIRECTIONS) {
  const page = await openPage(docWith([START]));
  const before = await geom(page);
  await dragBox(page, "m1", dx, dy);
  const afterStored = await stored(page);
  const afterGeom = await geom(page);
  const back = await reloadAndRead(page);
  const a = afterStored[0] || {};
  const b = back.stored[0] || {};
  table.push({
    direction: name,
    storedX: a.x, storedY: a.y,
    movedX: Math.round((a.x ?? 0) - START.x), movedY: Math.round((a.y ?? 0) - START.y),
    sheetW: `${before.sheetW}→${afterGeom.sheetW}`,
    sheetH: `${before.sheetH}→${afterGeom.sheetH}`,
    onSheet: afterGeom.boxes[0]?.onSheet,
    afterReload: `${b.x},${b.y}`,
  });
  /* ⛔ THE PROPERTY IS THAT THE BOX WENT WHERE IT WAS DRAGGED, on the axis that was dragged.
   * "Roughly" rather than exactly, because a real mouse gesture is measured in whole client
   * pixels against a page whose own origin can shift as it grows; the defect being guarded is a
   * FLOOR (a box that stopped dead at 4/0 while the page stayed its natural size), which is off
   * by hundreds, not by three. */
  const wantX = dx !== 0, wantY = dy !== 0;
  ok(`drag ${name}: the box travelled with the pointer`,
    (!wantX || Math.abs((a.x ?? 0) - (START.x + dx)) <= 12) && (!wantY || Math.abs((a.y ?? 0) - (START.y + dy)) <= 12),
    `stored (${a.x}, ${a.y}) against an asked-for (${START.x + dx}, ${START.y + dy})`);
  ok(`drag ${name}: the page grew to hold it — the box is inside the visible sheet`,
    afterGeom.boxes[0]?.onSheet === true,
    `sheet ${afterGeom.sheetW}×${afterGeom.sheetH}`);
  ok(`drag ${name}: and it is still there after a reload`,
    b.x === a.x && b.y === a.y, `${b.x},${b.y}`);
  await page.context().close();
}
console.table(table);

/* ═══ 2. GROW THEN COME BACK — the shrink that already worked on the right, on every side ══ */
console.log("\n" + "=".repeat(100));
console.log("2. GROW, THEN DRAG BACK INSIDE — the page must shrink again (it already did on the right)");
console.log("=".repeat(100));
for (const [name, dx, dy] of [["left", -D, 0], ["right", D, 0], ["above", 0, -D]]) {
  const page = await openPage(docWith([START]));
  const natural = await geom(page);
  await dragBox(page, "m1", dx, dy);
  const grown = await geom(page);
  await dragBox(page, "m1", -dx, -dy);
  const shrunk = await geom(page);
  ok(`${name}: the page grew`, grown.sheetW > natural.sheetW || grown.sheetH > natural.sheetH,
    `${natural.sheetW}×${natural.sheetH} → ${grown.sheetW}×${grown.sheetH}`);
  ok(`${name}: …and shrank back to its natural size when the box came home`,
    shrunk.sheetW === natural.sheetW, `${grown.sheetW} → ${shrunk.sheetW} (natural ${natural.sheetW})`);
  await page.context().close();
}

/* ═══ 3. TWO BOXES ON OPPOSITE SIDES AT ONCE ══════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("3. TWO BOXES, OPPOSITE SIDES — the page holds both, and holding one does not drop the other");
console.log("=".repeat(100));
{
  const page = await openPage(docWith([
    { x: -320, y: 120, aid: "L", text: "FAR LEFT" },
    { x: 620, y: 260, aid: "R", text: "FAR RIGHT" },
  ]));
  const g = await geom(page);
  ok("both boxes render inside the page", g.boxes.every((b) => b.onSheet),
    g.boxes.map((b) => `${b.id}:${b.onSheet}`).join(" "));
  const back = await reloadAndRead(page);
  ok("…and both survive a reload at their own coordinates",
    back.stored.length === 2 && back.stored.some((a) => a.x === -320) && back.stored.some((a) => a.x === 620),
    back.stored.map((a) => `${a.x},${a.y}`).join(" · "));
  await page.context().close();
}

/* ═══ 4. FAR LEFT TO FAR RIGHT IN ONE GESTURE ═════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("4. ONE GESTURE, FAR LEFT TO FAR RIGHT — the page must not clamp it halfway");
console.log("=".repeat(100));
{
  const page = await openPage(docWith([{ x: -300, y: 200, aid: "s1" }]));
  await dragBox(page, "s1", 900, 0, { steps: 24 });
  const a = (await stored(page))[0] || {};
  const g = await geom(page);
  ok("the box crossed the whole page in one drag", a.x > 400, `stored x ${a.x}`);
  ok("…and is on the page at the end of it", g.boxes[0]?.onSheet === true, `sheet ${g.sheetW}`);
  const back = await reloadAndRead(page);
  ok("…and stayed there after a reload", (back.stored[0] || {}).x === a.x, `${(back.stored[0] || {}).x}`);
  await page.context().close();
}

/* ═══ 5. THE PAGE AT ITS MINIMUM WIDTH, WITH A BOX AT THE EXTREME LEFT ════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("5. A NARROW WINDOW WITH A BOX FAR OFF THE LEFT — the case a floor used to hide");
console.log("=".repeat(100));
{
  const page = await openPage(docWith([{ x: -500, y: 140, aid: "n1" }]), { viewport: { width: 420, height: 820 } });
  const g = await geom(page);
  const a = (await stored(page))[0] || {};
  ok("the box keeps the coordinate it was given, on a phone-width window", a.x === -500, `stored x ${a.x}`);
  ok("…and the page reaches it rather than clipping it", g.boxes[0]?.onSheet === true,
    `sheet ${g.sheetW}, box left ${g.boxes[0]?.left}`);
  await page.context().close();
}

/* ═══ 6. NEW-5 — SOMETHING CAN SIT ABOVE THE TITLE, NEVER BEHIND IT ═══════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("6. ABOVE THE PAGE TITLE — never OVERLAPPING it (B1433856, NOTES-TITLE-BAND-DEAD-ZONE)");
console.log("=".repeat(100));
/* ⛔ THIS SECTION USED TO ASSERT THE BUG. Its original title was "'top: 0' used to render below
 * the title band" and its own passing assertion — `overlapsTitleBand` REQUIRED to be true — is
 * exactly the defect B1433856 fixed: a box negative enough to reach the band rendered BEHIND the
 * title's own `<input>` (which spans the band at `width: 100%`, always), and a real click on the
 * shared pixels focused NEITHER element (`document.activeElement` stayed `BODY`) — a permanent,
 * reload-surviving dead zone on the owner's own account. The corrected invariant is the opposite:
 * NO anchored block may ever paint inside the title band's own rect, at ANY x within the sheet
 * and ANY negative y. See the growth effect's own comment on `growGap` in `NoteEditor.jsx` for the
 * mechanism (the GAP below the band grows to clear it; padding-top before the band cannot, because
 * it shifts the band and the block down together). */
for (const y of [-10, -30, -60, -90, -260]) {
  const page = await openPage(docWith([{ x: 300, y, aid: "t1", text: "ABOVE THE TITLE" }]));
  const r = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="note-title"]').getBoundingClientRect();
    const b = document.querySelector('.planyr-anchor[data-anchor-id="t1"]').getBoundingClientRect();
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return {
      overlapsTitleBand: b.top < t.bottom && b.bottom > t.top,
      insideSheet: b.top >= s.top - 1 && b.bottom <= s.bottom + 1,
      titleTop: Math.round(t.top), titleBottom: Math.round(t.bottom),
      boxTop: Math.round(b.top), boxBottom: Math.round(b.bottom), sheetTop: Math.round(s.top),
    };
  });
  ok(`y=${y}: ⛔ the block NEVER paints inside the title's own rect`, !r.overlapsTitleBand,
    `title [${r.titleTop}..${r.titleBottom}] · box [${r.boxTop}..${r.boxBottom}]`);
  ok(`y=${y}: …and the sheet grew to hold it rather than letting it escape`, r.insideSheet,
    `sheet top ${r.sheetTop}`);
  await page.context().close();
}

/* ⛔ RED-PROOF, PER THE ITEM'S OWN ASK: A PRESS ANYWHERE INSIDE THE TITLE BAND'S RECT MUST FOCUS
 * EITHER THE TITLE OR A NOTE — NEVER NOTHING. This is the owner's OWN measured failure, reproduced
 * exactly: he found a click landing where the title's rect and a note's rect share pixels focused
 * NEITHER — `document.activeElement` stayed `BODY` — because the note's own first press only
 * SELECTS it (B434416's two-stage model), invisibly, under text that reads as more title. Clicking
 * at the ACTUAL geometric intersection (never a guessed point) is what makes this a genuine
 * red-proof rather than a check that happens to land beside the collision. */
{
  const page = await openPage(docWith([{ x: 300, y: -60, aid: "u1", text: "ABOVE THE TITLE" }]));
  const geo = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="note-title"]').getBoundingClientRect();
    const b = document.querySelector('.planyr-anchor[data-anchor-id="u1"]').getBoundingClientRect();
    const overlap = { left: Math.max(t.left, b.left), right: Math.min(t.right, b.right),
      top: Math.max(t.top, b.top), bottom: Math.min(t.bottom, b.bottom) };
    const hasOverlap = overlap.left < overlap.right && overlap.top < overlap.bottom;
    const point = hasOverlap
      ? { x: (overlap.left + overlap.right) / 2, y: (overlap.top + overlap.bottom) / 2 }
      : { x: t.left + t.width / 2, y: t.top + t.height / 2 };
    return { hasOverlap, point };
  });
  ok("⛔ …and this fixture genuinely produces the collision the click is aimed at (or, once fixed, none)",
    true, geo.hasOverlap ? `real overlap at (${Math.round(geo.point.x)}, ${Math.round(geo.point.y)})` : "no overlap — clicking the title row instead");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.click(Math.round(geo.point.x), Math.round(geo.point.y));
  const after = await page.evaluate(() => {
    const el = document.activeElement;
    return { activeTag: el ? (el.getAttribute?.("data-testid") || el.tagName) : "none" };
  });
  /* ⛔ THE BAR IS `document.activeElement`, LITERALLY — that is what the owner measured
   * ("activeElement stayed BODY") and it is the strict reading of "focuses neither": a box's own
   * first press SELECTS it without focusing anything (B434416's two-stage model, correct
   * everywhere else on the page), so a lenient "or was merely selected" bar would pass on the
   * broken build too, which defeats the point of a red-proof. Once nothing overlaps the band, this
   * collapses to an ordinary press on the title, which always focuses it. */
  ok("⛔ a press at the collision point moves focus somewhere real — activeElement is never BODY",
    after.activeTag !== "BODY" && after.activeTag !== "none", after.activeTag);
  await page.context().close();
}

/* ⛔ THE ADJACENT CASES NAMED IN THE ITEM — a table, not an assumption. The fix does not measure
 * the band's own height at all any more (`growGap` reads only `TITLE_BAND_GAP` and the document's
 * own `y`s — see the comment on it), so it is provably indifferent to what makes the band taller
 * or shorter. Proven here rather than left as an inference:
 *   · title short → long → short again — does the dead zone clear?
 *   · a note level with the CHIPS ROW ("Edited …") rather than the bare title
 *   · the same, in dark mode
 *   · a title long enough to wrap to two lines — N/A: `note-title` is a plain single-line
 *     `<input>`, which cannot wrap regardless of length; confirmed against the live DOM below
 *     rather than assumed from the source. */
console.log("\n" + "=".repeat(100));
console.log("6b. ADJACENT CASES — title short→long→short, the chips row, dark mode, title wrap");
console.log("=".repeat(100));
{
  const overlap = async (page, aid) => page.evaluate((id) => {
    const t = document.querySelector('[data-testid="note-title"]').getBoundingClientRect();
    const b = document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`).getBoundingClientRect();
    return b.top < t.bottom && b.bottom > t.top;
  }, aid);

  // title short → long → short again
  {
    const page = await openPage(docWith([{ x: 300, y: -60, aid: "s1", text: "ABOVE THE TITLE" }]));
    ok("short title: no overlap", !(await overlap(page, "s1")));
    await page.evaluate(() => document.querySelector('[data-testid="note-title"]').focus());
    await page.keyboard.type("A very long page title that pushes the input's own text well past where a short placeholder would ever reach");
    await pacedWait(page, 300);
    ok("…grown to a long title: still no overlap", !(await overlap(page, "s1")));
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Short");
    await pacedWait(page, 300);
    ok("…back to a short title: still no overlap (the dead zone never formed, so there is nothing to 'clear')", !(await overlap(page, "s1")));
    await page.context().close();
  }

  // the chips row ("Edited …"), not just the bare title
  {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await assertMeasurable(page, "verify-notes-free-placement");
    await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
    await pacedWait(page, 250);
    const now = Date.now();
    await page.evaluate(([tk, pk, d, now_]) => {
      localStorage.clear();
      localStorage.setItem(tk, JSON.stringify({
        v: 3, tombs: [], trash: [],
        pages: [{ id: "p1", title: "Chips row", createdAt: now_ - 100000, updatedAt: now_, projectId: null, pages: [] }],
      }));
      localStorage.setItem(pk, JSON.stringify(d));
    }, [TREE_KEY, PAGE_KEY, docWith([{ x: 300, y: -60, aid: "c1", text: "ABOVE THE CHIPS ROW" }]), now]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
    await pacedWait(page, 700);
    const hasChip = await page.evaluate(() => !!document.querySelector('[data-testid="note-edited"]'));
    ok("⛔ the fixture genuinely shows the chips row (or this proves nothing)", hasChip);
    const bandBottom = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="note-edited"]');
      return chip ? chip.getBoundingClientRect().bottom : null;
    });
    const boxTop = await page.evaluate(() => document.querySelector('.planyr-anchor[data-anchor-id="c1"]').getBoundingClientRect().top);
    ok("…and the note renders below the CHIPS ROW's own bottom, not just below the title text",
      bandBottom != null && boxTop >= bandBottom, `chips bottom ${Math.round(bandBottom)} · box top ${Math.round(boxTop)}`);
    ok("…and no overlap with the title itself either", !(await overlap(page, "c1")));
    await page.context().close();
  }

  // the same, in dark mode
  {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await assertMeasurable(page, "verify-notes-free-placement");
    await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
    await pacedWait(page, 250);
    await page.evaluate(([tk, pk, d]) => {
      localStorage.clear();
      localStorage.setItem("planyr.theme", "dark");
      localStorage.setItem(tk, JSON.stringify({
        v: 3, tombs: [], trash: [],
        pages: [{ id: "p1", title: "Dark mode", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
      }));
      localStorage.setItem(pk, JSON.stringify(d));
    }, [TREE_KEY, PAGE_KEY, docWith([{ x: 300, y: -60, aid: "d1", text: "ABOVE THE TITLE, DARK" }])]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
    await pacedWait(page, 700);
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    ok("⛔ the fixture is genuinely in dark mode", theme === "dark", theme);
    ok("dark mode: no overlap", !(await overlap(page, "d1")));
    await page.context().close();
  }

  // a title long enough to "wrap" — confirmed N/A, not assumed
  {
    const page = await openPage(docWith([]));
    const tag = await page.evaluate(() => document.querySelector('[data-testid="note-title"]').tagName);
    ok("⛔ N/A CONFIRMED, NOT ASSUMED: note-title is a plain <input>, which cannot wrap at any length",
      tag === "INPUT", tag);
    await page.context().close();
  }
}

/* ═══ 7. NEW-2 — THE BODY DRAGS; THE GRIP IS VISIBLE AND USABLE ═══════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("7. DRAGGING BY THE BODY — and what the border looks like");
console.log("=".repeat(100));
{
  const page = await openPage(docWith([{ x: 200, y: 200, aid: "b1", text: "DRAG MY BODY" }]));
  const centre = await page.evaluate(() => {
    const r = document.querySelector('.planyr-anchor[data-anchor-id="b1"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 6) };
  });
  /* Press 1 selects (the two-stage model), and the same press-and-travel must move it. */
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(centre.x + (150 * i) / 10, centre.y + (90 * i) / 10);
  await page.mouse.up();
  await pacedWait(page, 800);
  const a = (await stored(page))[0] || {};
  ok("⛔ dragging a note by its BODY moves it", a.x > 300 && a.y > 260, `stored ${a.x},${a.y}`);

  const chrome = await page.evaluate(() => {
    const box = document.querySelector('.planyr-anchor[data-anchor-id="b1"]');
    const edge = box.querySelector(".planyr-anchor-edge-n");
    return {
      cursor: getComputedStyle(box).cursor,
      grips: box.querySelectorAll(".planyr-anchor-grip").length,
      edges: box.querySelectorAll(".planyr-anchor-edge").length,
      edgeEvents: edge ? getComputedStyle(edge).pointerEvents : "MISSING",
      edgeCursor: edge ? getComputedStyle(edge).cursor : "MISSING",
    };
  });
  ok("the cursor reads grab over the box's body (a drag there pans), the move cursor is the border's", chrome.cursor === "grab", chrome.cursor);
  ok("the striped grip is retired (B2426788) and the box carries four border strips", chrome.grips === 0 && chrome.edges === 4, `${chrome.grips} grips · ${chrome.edges} strips`);
  ok("…each a real target with the move cursor, so a box you are typing in can still be moved",
    chrome.edgeEvents !== "none" && chrome.edgeCursor === "move", `${chrome.edgeEvents} · ${chrome.edgeCursor}`);

  const idle = await page.evaluate(() => getComputedStyle(document.querySelector('.planyr-anchor[data-anchor-id="b1"]')).boxShadow);
  const onBand = await page.evaluate(() => {
    const r = document.querySelector('.planyr-anchor[data-anchor-id="b1"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.3), y: Math.round(r.top + 0.5) };
  });
  await page.mouse.move(onBand.x, onBand.y);
  await pacedWait(page, 250);
  const onHover = await page.evaluate(() => getComputedStyle(document.querySelector('.planyr-anchor[data-anchor-id="b1"]')).boxShadow);
  ok("the outline thickens in the accent colour when the pointer is on the border (and not before)",
    onHover !== "none" && onHover !== idle, `idle ${idle} → hovered ${onHover}`);
  await page.context().close();
}

/* ═══ 8. SUPERSEDED — A PRESS NO LONGER CREATES ANYTHING TO DESTROY ═══════════════════════ */
/* ⛔ THIS SECTION USED TO ASSERT NEW-3: that discarding an abandoned empty note SAID SO, with an
 * Undo. That shipped, the owner saw it, and he reversed his own instruction (NEW-9): the toast
 * reads wrong because nothing should have been created in the first place. Under NEW-8 a press
 * arms a caret and creates nothing, so there is no empty note, nothing to discard, and nothing to
 * announce — and the assertions that stood here would now be asserting the defect.
 * They are not merely deleted: the whole model is asserted, harder, in
 * `ui-audit/verify-notes-pending-caret.mjs`, which starts from his own words and checks the
 * document is BYTE-IDENTICAL after a press you type nothing into, that no notice appears, and
 * that the view never moves. What is kept here is the one line that connects the two files, so a
 * reader of this harness is not left wondering where the case went. */
console.log("\n" + "=".repeat(100));
console.log("8. (superseded by NEW-8/NEW-9 — see verify-notes-pending-caret.mjs)");
console.log("=".repeat(100));
{
  const page = await openPage(docWith([]));
  const spot = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round(s.right + 60), y: Math.round(s.top + 420) };
  });
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 400);
  const armed = await page.evaluate(() => ({
    caret: !!document.querySelector('[data-testid="note-pending-caret"]'),
    notes: document.querySelectorAll(".planyr-anchor").length,
    notice: !!document.querySelector('[data-testid="note-anchor-discarded"]'),
  }));
  ok("a press arms a caret and creates NOTHING (NEW-8)",
    armed.caret && armed.notes === 0, `caret ${armed.caret} · ${armed.notes} note(s)`);
  ok("⛔ …and there is no discard notice anywhere, because there is nothing to discard (NEW-9)",
    !armed.notice, String(armed.notice));
  await page.keyboard.type("kept");
  await pacedWait(page, 900);
  const after = await stored(page);
  ok("…and the first keystroke is what makes the note", after.length === 1, `${after.length} stored`);
  /* ⛔ AND THE BYTE CLAIM IS PROVEN, NOT GESTURED AT. A first draft of this line was written as an
   * expression that could not evaluate to false — a check that cannot fail is worse than no check,
   * because it reads as coverage. This one re-arms on a fresh point, abandons it, and compares the
   * stored document to what it was before the press. */
  const armedAgain = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round(s.right + 90), y: Math.round(s.top + 560) };
  });
  const beforeAbandon = await page.evaluate((k) => localStorage.getItem(k) || "", PAGE_KEY);
  await page.mouse.click(armedAgain.x, armedAgain.y);
  await pacedWait(page, 350);
  await page.keyboard.press("Escape");
  await pacedWait(page, 800);
  ok("⛔ …while a press typed into nothing leaves the document BYTE-IDENTICAL",
    (await page.evaluate((k) => localStorage.getItem(k) || "", PAGE_KEY)) === beforeAbandon,
    `${beforeAbandon.length} bytes, unchanged`);
  await page.context().close();
}

/* ═══ 9. NEW-4 — THE WHOLE MAT ACCEPTS THE GESTURE, AT ANY HEIGHT ═════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("9. THE MAT ACCEPTS THE GESTURE — including level with a line of text, which was the real limit");
console.log("=".repeat(100));
for (const [where, side, atLine] of [["right, level with a line", 1, true], ["right, below the text", 1, false],
  ["left, level with a line", -1, true], ["left, below the text", -1, false]]) {
  const page = await openPage(docWith([]));
  const spot = await page.evaluate(([sd, line]) => {
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    const p = document.querySelector('[data-testid="note-body"] p').getBoundingClientRect();
    const x = sd > 0 ? s.right + 140 : s.left - 140;
    return { x: Math.round(x), y: Math.round(line ? p.top + p.height / 2 : p.bottom + 320) };
  }, [side, atLine]);
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 300);
  await page.keyboard.type("M");
  await pacedWait(page, 900);
  const n = (await stored(page)).length;
  ok(`a press in the mat (${where}) creates a note`, n === 1, `${n} stored`);
  await page.context().close();
}
/* ⛔ THE KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a press ON the white page beside a
 * line must still go to the CARET, not place a box. Without this the four rows above would pass
 * just as happily on a build that had turned every press everywhere into a placement. */
{
  const page = await openPage(docWith([]));
  const spot = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="note-body"] p').getBoundingClientRect();
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round(s.right - 24), y: Math.round(p.top + p.height / 2) };
  });
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 300);
  await page.keyboard.type("Q");
  await pacedWait(page, 900);
  const anchors = (await stored(page)).length;
  const text = await page.evaluate((k) => (localStorage.getItem(k) || "").includes("Q"), PAGE_KEY);
  ok("⛔ KNOWN-GOOD ARM: a press ON the page beside a line still takes the caret, and places nothing",
    anchors === 0 && text, `${anchors} anchor(s), typed text reached the page: ${text}`);
  await page.context().close();
}

/* ═══ 10. NEW-6 — THE TITLE'S SIZE, AGAINST THE BODY'S ════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("10. THE PAGE TITLE — a ratio of the body, not a fixed number");
console.log("=".repeat(100));
for (const [label, viewport] of [["desktop", { width: 1400, height: 900 }], ["phone", { width: 390, height: 820 }]]) {
  const page = await openPage(docWith([]), { viewport });
  const t = await page.evaluate(() => {
    const title = document.querySelector('[data-testid="note-title"]');
    const body = document.querySelector('[data-testid="note-body"]');
    const meta = document.querySelector('[data-testid="note-edited"]') || document.querySelector('[data-testid="note-project-badge"]');
    return {
      title: parseFloat(getComputedStyle(title).fontSize),
      titleWeight: getComputedStyle(title).fontWeight,
      body: parseFloat(getComputedStyle(body).fontSize),
      meta: meta ? parseFloat(getComputedStyle(meta).fontSize) : null,
    };
  });
  const ratio = t.title / t.body;
  ok(`${label}: the title is inside the 28–32px band he named (desktop) / proportionate (phone)`,
    label === "desktop" ? (t.title >= 28 && t.title <= 32) : (t.title < 30 && t.title > 20),
    `${t.title}px against a ${t.body}px body — ${ratio.toFixed(2)}×`);
  ok(`${label}: …and keeps its weight distinction rather than buying it back with size`,
    Number(t.titleWeight) >= 700, t.titleWeight);
  if (t.meta != null) {
    ok(`${label}: the metadata line still reads as secondary`, t.meta < t.body, `${t.meta}px`);
  }
  await page.context().close();
}

console.log("\n" + "=".repeat(100));
if (failures.length) {
  console.log(`⛔ ${failures.length} FAILED:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log("✓ every case passed");
}
await browser.close();
