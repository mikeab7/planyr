/* verify-notes-box-drag — A PRESS WITH NO MOVEMENT NEVER MOVES A BOX.
 *
 * ⛔ THE REPORT: *"a box reading 'sdasd' sat in the lower right of his Grand Port page. He
 * clicked it, no drag, and it jumped to the upper right."*
 *
 * ⛔ AND THE REASON THIS IS A REAL-MOUSE HARNESS AND NOT A SYNTHETIC ONE, stated by the
 * reporter against his own instrument: a synthetic drag from the grip — six interpolated
 * pointermove/mousemove steps, +200/+100 — **moved nothing at all**. If a real drag works and a
 * synthetic one does not even register, then a synthetic no-movement result is not evidence the
 * bug is absent; it is evidence the instrument never reached the code. (The drag is bound
 * through POINTER CAPTURE, which is exactly the sort of thing a dispatched event does not
 * produce — the same species as SYNTHETIC-KEYS-DONT-EDIT and B364017's press table.)
 *
 * So every gesture below is `page.mouse`, and the fixture is the page he actually has: TEN
 * boxes, the one under test near the BOTTOM, pressed while a DIFFERENT box holds the caret.
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

/** The stored attributes — the only thing that counts. A box that looks right and stored the
 *  wrong numbers is the bug; a box that stored the right ones is not. */
const storedBoxes = (page) => page.evaluate((k) => {
  const doc = JSON.parse(localStorage.getItem(k) || "null");
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAnchor") {
      const text = [];
      const dig = (x) => { if (x?.type === "text") text.push(x.text); (x?.content || []).forEach(dig); };
      dig(n);
      out.push({ x: n.attrs.x, y: n.attrs.y, w: n.attrs.w, text: text.join("") });
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}, `${PAGE_PREFIX}p1`);

const renderedBoxes = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="note-anchor"]')].map((el) => ({
    left: parseFloat(el.style.left), top: parseFloat(el.style.top),
    w: parseFloat(el.style.width), text: (el.querySelector(".planyr-anchor-content") || el).innerText.trim(),
    rect: el.getBoundingClientRect().toJSON(),
  })));

/** ⛔ HIS PAGE: ten boxes down the sheet, each with words in it. Seeded as a DOCUMENT rather
 *  than placed by gesture, so the fixture is exact and the run is about the press. */
async function seedTen(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Grand Port", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    const boxes = [];
    for (let i = 0; i < 10; i += 1) {
      boxes.push({
        type: "noteAnchor",
        attrs: { x: 40 + (i % 2) * 380, y: 60 + i * 62, w: 180 },
        content: [{ type: "paragraph", content: [{ type: "text", text: i === 9 ? "sdasd" : `box ${i}` }] }],
      });
    }
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [...boxes, { type: "paragraph", content: [{ type: "text", text: "Flow text." }] }],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 20000 });
  await pacedWait(page, 600);
}

async function run(label, { width, height, zoomSteps = 0 }) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "verify-notes-box-drag");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await seedTen(page);

  if (zoomSteps) {
    await page.keyboard.down("Control");
    for (let i = 0; i < zoomSteps; i += 1) await page.keyboard.press("Equal");
    await page.keyboard.up("Control");
    await pacedWait(page, 400);
  }

  const before = await storedBoxes(page);
  ok(`${label} · the fixture really is ten boxes with words in them`, before.length === 10 && before.every((b) => b.text));

  /* ⛔ HIS EXACT SHAPE: put the caret in one box first, then press a DIFFERENT one — the box
   * lowest on the page, which is where "sdasd" was. */
  const rendered = await renderedBoxes(page);
  const onScreen = rendered.filter((b) => b.rect.top > 70 && b.rect.bottom < height - 20);
  ok(`${label} · at least two boxes are reachable on screen`, onScreen.length >= 2, `${onScreen.length} of ${rendered.length}`);
  const first = onScreen[0];
  const target = onScreen[onScreen.length - 1];

  await page.mouse.click(Math.round(first.rect.left + 30), Math.round(first.rect.top + 10));
  await pacedWait(page, 250);

  /* ---- 1. A PRESS ON THE BOX BODY, NO MOVEMENT ---------------------------------------- */
  await page.mouse.move(Math.round(target.rect.left + 40), Math.round(target.rect.top + 10));
  await page.mouse.down();
  await pacedWait(page, 180);                 // a real click has dwell; a jump often needs it
  await page.mouse.up();
  await pacedWait(page, 900);
  let after = await storedBoxes(page);
  ok(`${label} · ⛔ A PRESS ON THE BOX MOVES NOTHING — not it, not any other box`,
    JSON.stringify(after.map((b) => [b.x, b.y])) === JSON.stringify(before.map((b) => [b.x, b.y])),
    JSON.stringify(after.map((b, i) => (b.x === before[i].x && b.y === before[i].y ? null : `${before[i].text}: ${before[i].x},${before[i].y} → ${b.x},${b.y}`)).filter(Boolean)) || "identical");

  /* ---- 2. A PRESS ON THE GRIP, NO MOVEMENT — the handle the drag is bound to ----------- */
  const grip = await page.evaluate((idx) => {
    const el = [...document.querySelectorAll('[data-testid="note-anchor"]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.top > 70 && r.bottom < window.innerHeight - 20; })[idx];
    const g = el?.querySelector('[data-testid="note-anchor-grip"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, onScreen.length - 1);
  ok(`${label} · the box has a grab handle to press`, !!grip);
  if (grip) {
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await pacedWait(page, 180);
    await page.mouse.up();
    await pacedWait(page, 900);
    after = await storedBoxes(page);
    ok(`${label} · ⛔ A PRESS ON THE GRIP WITH NO MOVEMENT MOVES NOTHING`,
      JSON.stringify(after.map((b) => [b.x, b.y])) === JSON.stringify(before.map((b) => [b.x, b.y])),
      JSON.stringify(after.map((b, i) => (b.x === before[i].x && b.y === before[i].y ? null : `${before[i].text}: ${before[i].x},${before[i].y} → ${b.x},${b.y}`)).filter(Boolean)) || "identical");

    /* ---- 3. A REAL DRAG MOVES BY EXACTLY THE POINTER DELTA ---------------------------- */
    const scale = await page.evaluate(() => {
      const dom = document.querySelector('[data-testid="note-body"]');
      return dom.getBoundingClientRect().width / (dom.offsetWidth || 1) || 1;
    });
    const dx = -120;
    const dy = -60;
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) {
      await page.mouse.move(Math.round(grip.x + (dx * i) / 6), Math.round(grip.y + (dy * i) / 6));
      await pacedWait(page, 30);
    }
    await page.mouse.up();
    await pacedWait(page, 900);
    const dragged = await storedBoxes(page);
    const moved = dragged.map((b, i) => ({ i, ddx: b.x - before[i].x, ddy: b.y - before[i].y }))
      .filter((m) => m.ddx || m.ddy);
    ok(`${label} · ⛔ A REAL DRAG MOVES EXACTLY ONE BOX`, moved.length === 1, JSON.stringify(moved));
    if (moved.length === 1) {
      ok(`${label} · ⛔ …BY EXACTLY THE POINTER DELTA — it does not re-seat under the cursor on grab`,
        Math.abs(moved[0].ddx - dx / scale) <= 2 && Math.abs(moved[0].ddy - dy / scale) <= 2,
        `asked ${Math.round(dx / scale)},${Math.round(dy / scale)} · moved ${moved[0].ddx},${moved[0].ddy}`);
    }
  }

  /* ---- 3b. THE WIDTH HANDLE ACTUALLY RESIZES ------------------------------------------
   *
   * ⛔ REPORTED AS "PRESENT BUT NOT BEHAVIOUR-VERIFIED" — the control was found in the DOM, but
   * a synthetic drag moves nothing on this build (the whole reason this file exists), so its
   * BEHAVIOUR had never been driven. A control that exists and does nothing is worse than one
   * that is missing, because nothing says so. Real mouse, stored attributes, both directions.
   *
   * The other assertions are the ones that would catch a plausible-but-wrong implementation:
   * only the pressed box changes, its POSITION does not move while its width does, and the
   * number that changes is the STORED `w` rather than a style the next reload forgets. */
  const sizer = await page.evaluate((idx) => {
    const el = [...document.querySelectorAll('[data-testid="note-anchor"]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.top > 70 && r.bottom < window.innerHeight - 20; })[idx];
    const s = el?.querySelector('[data-testid="note-anchor-size"]');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, onScreen.length - 1);
  ok(`${label} · the box has a width handle to press`, !!sizer);
  if (sizer) {
    const pre = await storedBoxes(page);
    const scale2 = await page.evaluate(() => {
      const dom = document.querySelector('[data-testid="note-body"]');
      return dom.getBoundingClientRect().width / (dom.offsetWidth || 1) || 1;
    });
    const widen = 90;
    await page.mouse.move(sizer.x, sizer.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) {
      await page.mouse.move(Math.round(sizer.x + (widen * i) / 6), sizer.y);
      await pacedWait(page, 30);
    }
    await page.mouse.up();
    await pacedWait(page, 900);
    const wide = await storedBoxes(page);
    const changed = wide.map((b, i) => ({ i, dw: (b.w || 0) - (pre[i].w || 0) })).filter((m) => m.dw);
    ok(`${label} · ⛔ A REAL DRAG ON THE WIDTH HANDLE RESIZES EXACTLY ONE BOX`,
      changed.length === 1, JSON.stringify(changed));
    if (changed.length === 1) {
      ok(`${label} · ⛔ …BY THE POINTER DELTA, and the box does NOT move while it resizes`,
        Math.abs(changed[0].dw - widen / scale2) <= 3
          && wide[changed[0].i].x === pre[changed[0].i].x && wide[changed[0].i].y === pre[changed[0].i].y,
        `asked ${Math.round(widen / scale2)} · got ${changed[0].dw} · x,y ${pre[changed[0].i].x},${pre[changed[0].i].y} → ${wide[changed[0].i].x},${wide[changed[0].i].y}`);

      /* Narrowing is the direction a min-width floor silently eats — B350000 had exactly that
       * bug, a stylesheet floor quietly undoing a width the code had chosen.
       *
       * ⛔ THE HANDLE IS RE-QUERIED, NOT ASSUMED. It travels with the box's right edge, so the
       * first resize moved it; pressing where it USED to be presses empty page and reports "it
       * did not narrow" about a gesture that never touched the control. That false failure
       * happened on this harness's first run, beside the real one it found. */
      const sizer2 = await page.evaluate((idx) => {
        const el = [...document.querySelectorAll('[data-testid="note-anchor"]')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.top > 70 && r.bottom < window.innerHeight - 20; })[idx];
        const s = el?.querySelector('[data-testid="note-anchor-size"]');
        if (!s) return null;
        const r = s.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }, onScreen.length - 1);
      ok(`${label} · the width handle is still findable after a resize`, !!sizer2);
      const narrow = -140;
      await page.mouse.move(sizer2.x, sizer2.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i += 1) {
        await page.mouse.move(Math.round(sizer2.x + (narrow * i) / 6), sizer2.y);
        await pacedWait(page, 30);
      }
      await page.mouse.up();
      await pacedWait(page, 900);
      const thin = await storedBoxes(page);
      ok(`${label} · ⛔ …AND IT NARROWS AGAIN — no floor quietly undoing the chosen width`,
        thin[changed[0].i].w < wide[changed[0].i].w,
        `${wide[changed[0].i].w} → ${thin[changed[0].i].w}`);

      /* ⛔ AND IT SURVIVES A RELOAD, which is the difference between a width and a style. */
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 20000 });
      await pacedWait(page, 600);
      const back = await storedBoxes(page);
      ok(`${label} · ⛔ …AND THE NEW WIDTH IS STILL THERE AFTER A RELOAD`,
        back[changed[0].i]?.w === thin[changed[0].i].w,
        `${thin[changed[0].i].w} → ${back[changed[0].i]?.w}`);
    }
  }

  /* ---- 4. AND THE WORDS ARE ALL STILL THERE ------------------------------------------- */
  const end = await storedBoxes(page);
  ok(`${label} · ⛔ EVERY BOX STILL HAS ITS WORDS — nothing was emptied or removed`,
    end.length === 10 && end.every((b) => b.text),
    `${end.length} boxes, ${end.filter((b) => !b.text).length} empty`);

  await ctx.close();
}

await run("A · a full window", { width: 1500, height: 950 });
await run("B · a SHORT window, which is his", { width: 1280, height: 520 });
await run("C · zoomed in", { width: 1500, height: 950, zoomSteps: 2 });

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
