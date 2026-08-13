/* verify-notes-marquee — SELECT SEVERAL BOXES AND MOVE THEM TOGETHER, WITH A REAL MOUSE.
 *
 * ⛔ THE OWNER NAMED THE RISK, NOT JUST THE FEATURE: *"the same drag on empty space currently means
 * 'make a box here'. One gesture has to learn two meanings… Get that boundary right and prove it
 * with a test at several drag distances including zero and one pixel."*
 *
 * `test/notesMarquee.test.js` proves the boundary as arithmetic. This proves it as a GESTURE, which
 * is a different claim: the pure function can be perfect while the wiring places a box anyway,
 * and that failure — a stray box left behind every time somebody tries to select — is worse than
 * having no marquee at all. So the distances below are driven through `page.mouse` and judged by
 * what reached STORAGE, which is the only place a stray box would show up.
 *
 * ⛔ AND EVERY GESTURE IS A REAL ONE. A synthetic mousedown reaches nothing on this page (B364017)
 * and a synthetic key mutates nothing (SYNTHETIC-KEYS-DONT-EDIT) — a harness built on either would
 * report a page of green ticks having exercised none of it.
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

/** The stored boxes — the only thing that counts. A box that looks moved and stored the old
 *  numbers is the bug; a stray box exists here or it does not exist. */
const stored = (page) => page.evaluate((k) => {
  const doc = JSON.parse(localStorage.getItem(k) || "null");
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAnchor") {
      const t = [];
      const dig = (x) => { if (x?.type === "text") t.push(x.text); (x?.content || []).forEach(dig); };
      dig(n);
      out.push({ x: n.attrs.x, y: n.attrs.y, w: n.attrs.w, text: t.join("") });
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}, `${PAGE_PREFIX}p1`);

const selectedIds = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="note-anchor"][data-selected="1"]')]
    .map((el) => (el.querySelector(".planyr-anchor-content") || el).innerText.trim()));

/** A document-space point, on screen right now. */
const clientOf = (page, dx, dy) => page.evaluate(([x, y]) => {
  const dom = document.querySelector('[data-testid="note-body"]');
  const r = dom.getBoundingClientRect();
  const s = r.width / (dom.offsetWidth || 1) || 1;
  return { x: Math.round(r.left + x * s), y: Math.round(r.top + y * s) };
}, [dx, dy]);

/** ⛔ FOUR BOXES IN A BLOCK, with clear page to their right — so a band can be drawn from empty
 *  space without starting on top of one, which would be a different gesture entirely. */
async function seed(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Grand Port", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const box = (x, y, t) => ({ type: "noteAnchor", attrs: { x, y, w: 140 }, content: [P(t)] });
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [box(40, 90, "one"), box(40, 150, "two"), box(40, 210, "three"), box(40, 400, "far"), P("Flow.")],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 20000 });
  await pacedWait(page, 700);
}

/** Drag with the real mouse, from one document point by a CLIENT-pixel delta. */
async function dragFrom(page, docX, docY, dx, dy, { steps = 8, shift = false } = {}) {
  const c = await clientOf(page, docX, docY);
  await page.mouse.move(c.x, c.y);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(Math.round(c.x + (dx * i) / steps), Math.round(c.y + (dy * i) / steps));
    await pacedWait(page, 25);
  }
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  /* ⛔ LONGER THAN THE EDITOR'S SAVE DEBOUNCE (600 ms), because this harness judges by STORAGE.
   * The first run read at 500 ms and reported a group drag as having moved nothing — the boxes
   * had moved on screen and in the document, and the bytes simply had not landed yet. A read that
   * races the writer measures the harness, not the app. */
  await pacedWait(page, 1100);
}

async function run(label, { width, height, zoomSteps = 0 }) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "verify-notes-marquee");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await seed(page);

  if (zoomSteps) {
    await page.keyboard.down("Control");
    for (let i = 0; i < zoomSteps; i += 1) await page.keyboard.press("Equal");
    await page.keyboard.up("Control");
    await pacedWait(page, 500);
  }

  const before = await stored(page);
  ok(`${label} · the fixture is four boxes with words in them`, before.length === 4 && before.every((b) => b.text), JSON.stringify(before.map((b) => b.text)));

  /* ---- 1. ⛔ THE BOUNDARY, DRIVEN. Zero, one, and either side of the threshold. ---------- */
  for (const d of [0, 1, 2, 3]) {
    await seed(page);
    const base = await stored(page);
    await dragFrom(page, 420, 300, d, 0, { steps: Math.max(1, d) });
    await page.keyboard.press("Escape");                 // discard whatever the press left
    await pacedWait(page, 400);
    const after = await stored(page);
    ok(`${label} · a ${d}px press on blank page is a PLACE, not a select`,
      after.length >= base.length && (await selectedIds(page)).length === 0,
      `${base.length} → ${after.length} boxes`);
  }

  for (const d of [12, 40, 120]) {
    await seed(page);
    const base = await stored(page);
    await dragFrom(page, 420, 60, -260, 220);            // a band over boxes one/two/three
    const sel = await selectedIds(page);
    const after = await stored(page);
    ok(`${label} · a ${d >= 12 ? "real" : ""} drag SELECTS and places NOTHING`,
      after.length === base.length,
      `${base.length} → ${after.length} boxes`);
    ok(`${label} · …and it caught the boxes it swept (${sel.length})`, sel.length >= 2, JSON.stringify(sel));
    break;                                                // one representative drag per window
  }

  /* ---- 2. DRAGGING ONE SELECTED BOX MOVES THE WHOLE SET, BY ONE DELTA ------------------- */
  await seed(page);
  const base2 = await stored(page);
  await dragFrom(page, 420, 60, -260, 220);
  const sel2 = await selectedIds(page);
  ok(`${label} · three boxes are selected before the group drag`, sel2.length === 3, JSON.stringify(sel2));
  if (sel2.length === 3) {
    const scale = await page.evaluate(() => {
      const dom = document.querySelector('[data-testid="note-body"]');
      return dom.getBoundingClientRect().width / (dom.offsetWidth || 1) || 1;
    });
    await dragFrom(page, 60, 100, 90, 60);               // grab box "one", inside the selection
    const moved = await stored(page);
    const deltas = moved.map((b, i) => ({ t: b.text, dx: b.x - base2[i].x, dy: b.y - base2[i].y }));
    const set = deltas.filter((d) => ["one", "two", "three"].includes(d.t));
    const outside = deltas.find((d) => d.t === "far");
    ok(`${label} · ⛔ ALL THREE MOVED BY THE SAME DELTA — the arrangement is not deformed`,
      set.every((d) => d.dx === set[0].dx && d.dy === set[0].dy), JSON.stringify(set));
    ok(`${label} · …by the pointer's delta`,
      Math.abs(set[0].dx - 90 / scale) <= 3 && Math.abs(set[0].dy - 60 / scale) <= 3,
      `asked ${Math.round(90 / scale)},${Math.round(60 / scale)} · moved ${set[0].dx},${set[0].dy}`);
    ok(`${label} · ⛔ …AND THE BOX OUTSIDE THE SELECTION DID NOT MOVE`, outside && !outside.dx && !outside.dy, JSON.stringify(outside));

    /* ---- 3. ONE UNDO STEP PUTS THE WHOLE GROUP BACK ----------------------------------- */
    await page.keyboard.press("Control+z");
    await pacedWait(page, 1200);
    const undone = await stored(page);
    ok(`${label} · ⛔ ONE Ctrl+Z RESTORES ALL THREE — a group move is one undo step`,
      JSON.stringify(undone.map((b) => [b.x, b.y])) === JSON.stringify(base2.map((b) => [b.x, b.y])),
      JSON.stringify(undone.map((b) => [b.x, b.y])));
  }

  /* ---- 4. ARROW KEYS NUDGE THE SELECTION ------------------------------------------------ */
  await seed(page);
  const base3 = await stored(page);
  await dragFrom(page, 420, 60, -260, 220);
  await page.keyboard.press("ArrowRight");
  await pacedWait(page, 1200);
  const nudged = await stored(page);
  const moved3 = nudged.filter((b, i) => b.x !== base3[i].x);
  ok(`${label} · an arrow key nudges every selected box and nothing else`, moved3.length === 3, `${moved3.length} moved`);

  /* ---- 5. DELETE REMOVES THE WHOLE SET AS ONE STEP -------------------------------------- */
  await page.keyboard.press("Delete");
  await pacedWait(page, 1200);
  const afterDel = await stored(page);
  ok(`${label} · ⛔ DELETE REMOVES THE WHOLE SELECTION`, afterDel.length === base3.length - 3, `${base3.length} → ${afterDel.length}`);
  await page.keyboard.press("Control+z");
  await pacedWait(page, 1200);
  const backAgain = await stored(page);
  ok(`${label} · ⛔ …AND ONE Ctrl+Z BRINGS THEM ALL BACK`, backAgain.length === base3.length, `${afterDel.length} → ${backAgain.length}`);

  /* ---- 6. ESCAPE AND CLICK-AWAY CLEAR IT ------------------------------------------------ */
  await seed(page);
  await dragFrom(page, 420, 60, -260, 220);
  ok(`${label} · a selection exists to clear`, (await selectedIds(page)).length >= 2);
  await page.keyboard.press("Escape");
  await pacedWait(page, 400);
  ok(`${label} · ⛔ ESCAPE CLEARS THE SELECTION`, (await selectedIds(page)).length === 0);

  await dragFrom(page, 420, 60, -260, 220);
  const beforeAway = await stored(page);
  const away = await clientOf(page, 420, 320);
  await page.mouse.click(away.x, away.y);
  await pacedWait(page, 500);
  ok(`${label} · ⛔ A PRESS AWAY CLEARS IT TOO`, (await selectedIds(page)).length === 0);
  ok(`${label} · …and every box still has its words`, (await stored(page)).filter((b) => b.text).length === beforeAway.filter((b) => b.text).length);

  await ctx.close();
}

await run("A · a full window", { width: 1500, height: 950 });
await run("B · a SHORT window, which is his", { width: 1280, height: 620 });
await run("C · zoomed in", { width: 1500, height: 950, zoomSteps: 2 });

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
