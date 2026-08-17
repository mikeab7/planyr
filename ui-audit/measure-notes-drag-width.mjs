/* measure-notes-drag-width — A BOX MUST NOT REFLOW UNDER HIS HAND (NEW-DRAG-NARROWS).
 *
 * ⛔ HIS REPORT: *"when I grab this, it's normally wider if I let go, but when I grab it, it
 * shortens up."* His screenshot catches it mid-gesture — "High Voltage Planning Study" wrapped
 * onto TWO lines while the button is down, one line at rest.
 *
 * ⛔ AND HIS ACCEPTANCE TEST, WHICH IS THE ONLY WAY TO SEE THIS AT ALL: *"capture the rendered
 * width and the stored w at three moments — before pointerdown, during the drag with the pointer
 * held, and after release. All three must be equal."* The middle reading is the whole point: this
 * defect exists ONLY while the button is down, so any check that presses and releases before
 * measuring reports a working feature. Every previous box harness in this repo does exactly that.
 *
 * ⛔ IT ALSO ASSERTS THE REVERSE, because he asked for it and because it is the failure mode a
 * naive fix introduces: *"no box should get WIDER while dragged either."* The property is
 * EQUALITY, not "did not shrink".
 *
 * ⛔ THE CAUSE, for the record, since it is the same one twice: the move drag ran `placeAnchor`,
 * whose job is *"narrow the block to the space available"* — so dragging rightward shrank the
 * room and the box reflowed; on release only x/y were committed, so the stored width sprang back.
 * That is B539648's right-edge crush surviving in the one path that item did not touch.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "measure-notes-drag-width");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function seed(box, zoom = 1) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, key, b, z]) => {
    localStorage.clear();
    localStorage.setItem("planyr:notes:zoom:v1:local", String(z));
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Drag", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(key, JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line of ordinary text" }] },
        { type: "noteAnchor", attrs: b,
          content: [{ type: "paragraph", content: [{ type: "text", text: "High Voltage Planning Study" }] }] },
      ],
    }));
  }, [TREE_KEY, PAGE_KEY, box, zoom]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** ⛔ THE RENDERED WIDTH, THE STORED WIDTH, AND HOW MANY LINES THE WORDS TAKE — all three, because
 *  the thing he SAW was the wrapping, and a box can reflow without its stored number moving. The
 *  line count is what makes "it shortens up" measurable rather than a matter of opinion. */
const readBox = () => page.evaluate((k) => {
  const el = document.querySelector(".planyr-anchor");
  const p = el && el.querySelector(".planyr-anchor-content p");
  let stored = null;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAnchor") { stored = n.attrs; return; }
    (n.content || []).forEach(walk);
  };
  try { walk(JSON.parse(localStorage.getItem(k))); } catch (_) { /* unreadable */ }
  const r = el ? el.getBoundingClientRect() : null;
  // A line box is what one line of this text occupies; the ratio is the wrap count.
  const lh = p ? parseFloat(getComputedStyle(p).lineHeight) || 18 : 18;
  return {
    renderedW: r ? Math.round(r.width) : null,
    renderedH: r ? Math.round(r.height) : null,
    styleW: el ? Math.round(parseFloat(el.style.width) || 0) : null,
    attrW: el ? Number(el.getAttribute("data-anchor-w")) : null,
    storedW: stored ? Number(stored.w) : null,
    storedX: stored ? Number(stored.x) : null,
    lines: p ? Math.max(1, Math.round(p.getBoundingClientRect().height / lh)) : null,
  };
}, PAGE_KEY);

const pad = (s, n) => String(s == null ? "—" : s).padEnd(n);

/**
 * Drag the grip and read the box AT ALL THREE MOMENTS. The middle read happens with the button
 * still down, which is the only state the defect exists in.
 */
/** ⛔ A PER-FRAME SAMPLER, NOT POLLING — AND THE FIRST VERSION OF THIS HARNESS WAS VACUOUS
 *  WITHOUT IT. It read the box five times during the drag with a 60 ms pause between reads, and
 *  came back GREEN on code that has the defect. The reason is `fitAnchorBox`: it runs from a
 *  ResizeObserver and re-derives the rendered width from `data-anchor-w`, so a narrowing written
 *  to `style.width` alone is undone on the very next frame. The box really does reflow — for one
 *  or two frames per pointer move, repeatedly, all the way across the drag — and a reader that
 *  arrives 60 ms later always finds it restored.
 *
 *  ⛔ SO THE MEASUREMENT HAS TO LIVE ON THE FRAME CLOCK, INSIDE THE PAGE. This installs a
 *  `requestAnimationFrame` loop that records the rendered width and the wrap count on EVERY frame
 *  of the gesture and hands back the extremes. A transient reflow is still a reflow — it is
 *  exactly what he photographed — and a probe that can only see sustained states cannot see this
 *  bug at all. (DRIVER-SCROLL-IS-NOT-APP-SCROLL clause 6: prove the instrument can report the
 *  known answer before trusting it on the unknown one.) */
const startSampler = () => page.evaluate(() => {
  const el = document.querySelector(".planyr-anchor");
  const p = el && el.querySelector(".planyr-anchor-content p");
  window.__samples = [];
  window.__sampling = true;
  const lh = p ? parseFloat(getComputedStyle(p).lineHeight) || 18 : 18;
  const tick = () => {
    if (!window.__sampling) return;
    const r = el.getBoundingClientRect();
    window.__samples.push({
      w: Math.round(r.width),
      lines: p ? Math.max(1, Math.round(p.getBoundingClientRect().height / lh)) : 1,
      styleW: Math.round(parseFloat(el.style.width) || 0),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const stopSampler = () => page.evaluate(() => {
  window.__sampling = false;
  const s = window.__samples || [];
  const ws = s.map((x) => x.w);
  const styleWs = s.map((x) => x.styleW);
  const lines = s.map((x) => x.lines);
  return {
    frames: s.length,
    minW: ws.length ? Math.min(...ws) : null,
    maxW: ws.length ? Math.max(...ws) : null,
    minStyleW: styleWs.length ? Math.min(...styleWs) : null,
    maxStyleW: styleWs.length ? Math.max(...styleWs) : null,
    maxLines: lines.length ? Math.max(...lines) : null,
  };
});

/**
 * Drag the grip and read the box AT ALL THREE MOMENTS. The middle reading is taken on every
 * animation frame, which is the only clock that can see the defect.
 */
async function dragAndWatch({ dx, dy }) {
  await page.locator(".planyr-anchor").first().click();      // stage 1: select, revealing the grip
  await pacedWait(page, 350);
  const grip = page.locator('[data-testid="note-anchor-grip"]').first();
  if (!(await grip.count())) return null;
  const g = await grip.boundingBox();
  if (!g) return null;

  const before = await readBox();
  const cx = g.x + g.width / 2;
  const cy = g.y + g.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await startSampler();                      // ⛔ armed WITH THE BUTTON DOWN
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(cx + (dx * i) / 10, cy + (dy * i) / 10);
    await pacedWait(page, 40);
  }
  const during = await stopSampler();
  await page.mouse.up();
  await pacedWait(page, 900);
  const after = await readBox();
  return { before, during, after };
}

async function scenario(name, { box, zoom = 1, dx, dy }) {
  console.log("\n" + "=".repeat(104));
  console.log(name);
  console.log("=".repeat(104));
  await seed(box, zoom);
  const r = await dragAndWatch({ dx, dy });
  if (!r) { ok(`${name}: the grip is reachable`, false, "grip not in the DOM"); return; }
  const { before, during, after } = r;

  console.log(pad("moment", 14) + pad("rendered w", 13) + pad("stored w", 11) + pad("lines", 7) + "x");
  console.log("-".repeat(104));
  console.log(pad("before", 14) + pad(before.renderedW, 13) + pad(before.storedW, 11) + pad(before.lines, 7) + before.storedX);
  console.log(pad("during (min)", 14) + pad(during.minW, 13) + pad("—", 11) + pad("—", 7) + `${during.frames} frames sampled`);
  console.log(pad("during (max)", 14) + pad(during.maxW, 13) + pad("—", 11) + pad(during.maxLines, 7) + `style.width ${during.minStyleW}–${during.maxStyleW}`);
  console.log(pad("after", 14) + pad(after.renderedW, 13) + pad(after.storedW, 11) + pad(after.lines, 7) + after.storedX);

  /* ⛔ THE SAMPLER MUST HAVE ACTUALLY RUN, or every assertion below is vacuously true. */
  ok(`${name} · the frame sampler observed the gesture`, (during.frames || 0) >= 5, `${during.frames} frames`);

  /* ⛔ EQUALITY, IN BOTH DIRECTIONS. "It did not shrink" would pass a fix that made it grow. */
  ok(`${name} · the rendered width is IDENTICAL on every frame of the gesture`,
    Math.abs((during.minW ?? 0) - before.renderedW) <= 1 && Math.abs((during.maxW ?? 0) - before.renderedW) <= 1,
    `rest ${before.renderedW} · during ${during.minW}–${during.maxW}`);

  /* ⛔ AND THE STYLE THE HANDLER ITSELF WROTE, which is the layer the ResizeObserver fit hides.
   * A box whose style.width dips and is restored within the frame is still reflowing under his
   * hand — it is what he photographed — and only this reading can see it.
   *
   * ⛔ COMPARED AGAINST THE RESTING *STYLE* WIDTH, NOT THE RENDERED ONE. `style.width` is in
   * UNZOOMED css pixels and `getBoundingClientRect` is in zoomed ones, so at 200% the first
   * version of this line compared 300 against 600 and reported a failure on every row — including
   * the rows that were correct. Two units, one comparison, is its own bug. */
  ok(`${name} · …and the handler never WRITES a different width mid-drag`,
    Math.abs((during.minStyleW ?? 0) - before.styleW) <= 1 && Math.abs((during.maxStyleW ?? 0) - before.styleW) <= 1,
    `style.width ${during.minStyleW}–${during.maxStyleW} against ${before.styleW} at rest`);

  ok(`${name} · …so the words never re-wrap under his hand`,
    (during.maxLines ?? 1) === before.lines, `rest ${before.lines} line(s), worst during ${during.maxLines}`);

  ok(`${name} · the stored width is untouched by a move`,
    before.storedW === after.storedW, `${before.storedW} → ${after.storedW}`);

  /* And the gesture still did its actual job, or the checks above are satisfied by a dead drag. */
  ok(`${name} · …while the box really did MOVE (the drag is not simply inert)`,
    Math.abs((after.storedX ?? 0) - (before.storedX ?? 0)) > 20, `x ${before.storedX} → ${after.storedX}`);
}

/* ⛔ THE RIGHT-EDGE CASE IS THE ONE THAT FAILED, because the old rule narrowed the box to the room
 * left before the margin — so a box in the middle of the page could look perfectly fine while his
 * did not. Both are run, at two zooms, exactly as he asked. */
await scenario("A · mid-page, dragged right, 100%", { box: { x: 200, y: 120, w: 300 }, dx: 240, dy: 40 });
await scenario("B · near the right edge, dragged right, 100%", { box: { x: 520, y: 120, w: 300 }, dx: 220, dy: 30 });
await scenario("C · near the right edge, dragged LEFT, 100%", { box: { x: 560, y: 120, w: 300 }, dx: -260, dy: 20 });
await scenario("D · near the right edge, dragged right, 200%", { box: { x: 520, y: 120, w: 300 }, zoom: 2, dx: 220, dy: 30 });
await scenario("E · mid-page, dragged right, 80%", { box: { x: 200, y: 120, w: 300 }, zoom: 0.8, dx: 200, dy: 30 });

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`page errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
