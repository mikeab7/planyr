/* verify-notes-anchor-zoom — THE BLOCK LANDS WHERE YOU CLICKED, AND THE WRITING ZOOMS.
 *
 * ⛔ THIS HARNESS EXISTS BECAUSE THE LAST TWO ROUNDS PASSED ON THE WRONG PROPERTY.
 *
 * "Double-click in blank space and type there" has been reported four times. The previous
 * check confirmed that the old alignment hack was gone and that text landed left-aligned at
 * the END OF THE DOCUMENT — and passed. **Landing at the end of the document IS the reported
 * bug.** Before that, a check asserted that the caret took FOCUS, which was also true while
 * the text appeared on line one.
 *
 * So the only assertion that counts here is a GEOMETRIC one: the rendered top-left of the new
 * block, measured off the page, against the coordinates that were clicked, within a stated
 * tolerance. Every weaker signal is named below and explicitly refused:
 *
 *   ✗ "the old hack is gone"     — it was gone, and the bug was still there.
 *   ✗ "the alignment is default" — it was, and the bug was still there.
 *   ✗ "text appeared"            — it did, at the wrong end of the document.
 *   ✓ "the block's rect is at the click point, ±TOLERANCE"
 *
 * And three properties beyond placement, because a block that lands right and then drifts is
 * the SAME bug arriving later: it must not move as you type (the crawl that killed round 2),
 * it must survive a reload (the position is in the document, not in a stylesheet), and the
 * rest of the document must be untouched (no padding paragraphs, which round 2 left behind
 * permanently in the document, the Markdown and the PDF).
 *
 * Run:
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-anchor-zoom.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** How far the rendered block may sit from the point pressed. A few pixels of chrome (the
 *  block's own padding and its 1px border) is honest; anything more is a placement bug. */
const TOLERANCE = 8;

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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

/* ⛔ FOREGROUND-OR-VOID. Every assertion below is a GEOMETRIC one, and a background tab
 * suspends rAF — so the boxes would agree with each other while describing a view the app
 * already left. That is the failure mode this precondition exists for. */
await assertMeasurable(page, "verify-notes-anchor-zoom");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const tb = (id) => page.locator(`[data-testid="${id}"]`);
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const storedDoc = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `${PAGE_PREFIX}p1`);
const anchorsIn = (doc) => {
  const out = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "noteAnchor") out.push(n); (n.content || []).forEach(walk); };
  walk(doc);
  return out;
};
const textOf = (n) => {
  const out = [];
  const walk = (x) => { if (!x || typeof x !== "object") return; if (x.type === "text") out.push(x.text); (x.content || []).forEach(walk); };
  walk(n);
  return out.join("");
};

async function seed() {
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3,
      pages: [{ id: "p1", title: "Anchors", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
      trash: [],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Existing first line." }] }],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 400);
}

/** A blank point on the sheet, well below the text and well right of the left margin — the
 *  exact gesture the report describes. Returns the client coordinates pressed. */
async function blankPoint({ dx = 420, dy = 220 } = {}) {
  return page.evaluate(([ddx, ddy]) => {
    const body = document.querySelector('[data-testid="note-body"]');
    const r = body.getBoundingClientRect();
    const last = body.lastElementChild;
    const bottom = last ? last.getBoundingClientRect().bottom : r.top;
    return { x: Math.round(r.left + ddx), y: Math.round(bottom + ddy) };
  }, [dx, dy]);
}

await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

/* ════ 1. THE PLACEMENT — the assertion the last two rounds did not make ═══════════════ */
console.log("\n1 · Double-click in blank space starts a block THERE (NEW-2)");
await seed();

const before = await storedDoc();
const at = await blankPoint();
await page.mouse.dblclick(at.x, at.y);
await pacedWait(page, 350);

ok("a block appeared", await tb("note-anchor").count() > 0);

const rect = await tb("note-anchor").first().boundingBox();
const dx = rect ? Math.abs(rect.x - at.x) : Infinity;
const dy = rect ? Math.abs(rect.y - at.y) : Infinity;
ok(`⛔ ITS RENDERED POSITION IS THE POINT CLICKED (±${TOLERANCE}px)`, dx <= TOLERANCE && dy <= TOLERANCE,
  `clicked (${at.x}, ${at.y}) · rendered (${Math.round(rect?.x)}, ${Math.round(rect?.y)}) · off by ${Math.round(dx)}, ${Math.round(dy)}`);

// …and the explicit refutation of the false pass: it is NOT at the end of the document.
const bodyBox = await tb("note-body").boundingBox();
/* The FLOW text, not the anchored block — which now sits earlier in document order (see
   `addNoteAnchorAt` for why) and would otherwise be measured against itself. */
const lastLineBottom = await page.evaluate(() => {
  const body = document.querySelector('[data-testid="note-body"]');
  const flow = [...body.children].filter((c) => !c.classList.contains("planyr-anchor"));
  const first = flow[0];
  return first ? first.getBoundingClientRect().bottom : 0;
});
ok("⛔ AND IT IS NOT AT THE END OF THE DOCUMENT — the exact shape of the last false pass",
  rect && rect.y > lastLineBottom + 40, `block top ${Math.round(rect?.y)} vs first line bottom ${Math.round(lastLineBottom)}`);
ok("…nor snapped back to the left margin", rect && rect.x > (bodyBox?.x || 0) + 100,
  `block left ${Math.round(rect?.x)} vs text left ${Math.round(bodyBox?.x)}`);

/* ════ 2. TYPING INTO IT DOES NOT MOVE IT — the crawl that killed round 2 ══════════════ */
console.log("\n2 · It does not crawl as you type");
await page.keyboard.type("Bain follow-ups");
await pacedWait(page, 700);
const afterType = await tb("note-anchor").first().boundingBox();
ok("⛔ THE BLOCK HAS NOT MOVED A PIXEL WHILE TYPING",
  Math.abs(afterType.x - rect.x) < 1 && Math.abs(afterType.y - rect.y) < 1,
  `${Math.round(rect.x)},${Math.round(rect.y)} → ${Math.round(afterType.x)},${Math.round(afterType.y)}`);

const doc = await storedDoc();
const anchors = anchorsIn(doc);
ok("the words went INTO the block, not into the paragraph above", anchors.length === 1 && textOf(anchors[0]).includes("Bain follow-ups"),
  JSON.stringify(textOf(anchors[0] || {})));
ok("its position is stored on the NODE, as two numbers", Number.isFinite(anchors[0]?.attrs?.x) && Number.isFinite(anchors[0]?.attrs?.y),
  JSON.stringify(anchors[0]?.attrs));

/* ════ 3. NOTHING WAS LEFT BEHIND — round 2's permanent padding paragraphs ═════════════ */
console.log("\n3 · The rest of the document is untouched");
const paras = (doc.content || []).filter((n) => n.type === "paragraph");
const beforeParas = (before.content || []).filter((n) => n.type === "paragraph");
ok("⛔ NO PADDING PARAGRAPHS WERE INSERTED", paras.length === beforeParas.length,
  `${beforeParas.length} → ${paras.length}`);
/* Compared by its WORDS, not by raw JSON: the editor legitimately normalises a paragraph on
   load (it stamps the default `textAlign: null`), and asserting on that would be a check that
   fails for a reason nobody cares about — the noisy twin of the false pass this file exists
   to prevent. */
ok("…and the existing line still says exactly what it said",
  textOf(paras[0]) === textOf(beforeParas[0]) && textOf(paras[0]) === "Existing first line.",
  JSON.stringify(textOf(paras[0])));
ok("…and no alignment was written onto anything",
  !JSON.stringify(doc).includes('"textAlign":"center"') && !JSON.stringify(doc).includes('"textAlign":"right"'));

/* ════ 4. IT SURVIVES A RELOAD — the position is in the document, not in a stylesheet ══ */
console.log("\n4 · It comes back in the same place");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 600);
const afterReload = await tb("note-anchor").first().boundingBox();
ok("⛔ AFTER A RELOAD IT IS IN THE SAME PLACE", afterReload
  && Math.abs(afterReload.x - rect.x) <= 2 && Math.abs(afterReload.y - rect.y) <= 2,
  afterReload ? `${Math.round(afterReload.x)}, ${Math.round(afterReload.y)}` : "absent");
ok("…with its words", (await tb("note-anchor").first().innerText()).includes("Bain follow-ups"));

/* ════ 5. IT CAN BE MOVED AFTERWARDS ══════════════════════════════════════════════════ */
console.log("\n5 · It can be moved");
const grip = tb("note-anchor-grip").first();
const gb = await grip.boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width / 2 - 120, gb.y + gb.height / 2 + 60, { steps: 8 });
await page.mouse.up();
await pacedWait(page, 800);
const moved = await tb("note-anchor").first().boundingBox();
ok("⛔ DRAGGING THE GRIP MOVES IT, BY ABOUT WHAT WAS DRAGGED",
  Math.abs((moved.x - afterReload.x) + 120) < 12 && Math.abs((moved.y - afterReload.y) - 60) < 12,
  `moved by ${Math.round(moved.x - afterReload.x)}, ${Math.round(moved.y - afterReload.y)}`);
const movedDoc = anchorsIn(await storedDoc())[0];
ok("…and the new position was WRITTEN, not just painted", Math.abs(movedDoc.attrs.x - anchors[0].attrs.x + 120) < 12,
  `stored x ${anchors[0].attrs.x} → ${movedDoc.attrs.x}`);

/* ════ 6. A DOUBLE-CLICK ON TEXT STILL SELECTS A WORD ═════════════════════════════════ */
console.log("\n6 · The gesture did not eat double-click-to-select");
const firstLine = await page.evaluate(() => {
  const body = document.querySelector('[data-testid="note-body"]');
  const el = [...body.children].find((c) => !c.classList.contains("planyr-anchor"));
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
});
const anchorsBefore = anchorsIn(await storedDoc()).length;
await page.mouse.dblclick(firstLine.x, firstLine.y);
await pacedWait(page, 300);
ok("a word is selected", (await page.evaluate(() => String(window.getSelection()))).trim().length > 0,
  JSON.stringify((await page.evaluate(() => String(window.getSelection()))).trim()));
ok("⛔ AND NO SECOND BLOCK WAS CREATED", anchorsIn(await storedDoc()).length === anchorsBefore);

/* ════ 7. ZOOM — the DOCUMENT, not the app (NEW-3) ════════════════════════════════════ */
console.log("\n7 · Ctrl+zoom scales the writing and nothing else (NEW-3)");
const railBefore = await page.locator('[data-testid="notes-tree"]').boundingBox();
const sheetFontBefore = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="note-body"] p');
  return el.getBoundingClientRect().height;
});

await page.keyboard.down("Control");
await page.keyboard.press("Equal");
await page.keyboard.press("Equal");
await page.keyboard.up("Control");
await pacedWait(page, 400);

const zoomAttr = await tb("note-sheet").getAttribute("data-zoom");
ok("the level went up two steps", Number(zoomAttr) > 1, `data-zoom=${zoomAttr}`);
const sheetFontAfter = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="note-body"] p');
  return el.getBoundingClientRect().height;
});
ok("⛔ THE WRITING IS BIGGER", sheetFontAfter > sheetFontBefore * 1.1, `line height ${Math.round(sheetFontBefore)} → ${Math.round(sheetFontAfter)}`);
const railAfter = await page.locator('[data-testid="notes-tree"]').boundingBox();
ok("⛔ AND THE RAIL DID NOT MOVE OR RESIZE — the app is not zooming",
  Math.abs(railAfter.width - railBefore.width) < 1 && Math.abs(railAfter.x - railBefore.x) < 1,
  `${Math.round(railBefore.width)} → ${Math.round(railAfter.width)}`);
ok("the level is shown, and says what it is", (await tb("note-zoom-level").innerText()).trim().endsWith("%"),
  (await tb("note-zoom-level").innerText()).trim());

await page.keyboard.down("Control");
await page.keyboard.press("Digit0");
await page.keyboard.up("Control");
await pacedWait(page, 400);
ok("Ctrl+0 goes back to 100%", (await tb("note-sheet").getAttribute("data-zoom")) === "1");
ok("…and the level chip disappears at 100%, rather than sitting there saying nothing", await tb("note-zoom-level").count() === 0);

/* Ctrl+wheel, and the browser's own zoom suppressed. */
const sheetBox = await tb("note-sheet").boundingBox();
await page.mouse.move(sheetBox.x + 200, sheetBox.y + 120);
await page.keyboard.down("Control");
await page.mouse.wheel(0, -240);
await page.keyboard.up("Control");
await pacedWait(page, 400);
const wheeled = Number(await tb("note-sheet").getAttribute("data-zoom"));
ok("⛔ CTRL+WHEEL ZOOMS THE DOCUMENT", wheeled > 1, `data-zoom=${wheeled}`);
ok("…and the BROWSER's own zoom did not also fire", await page.evaluate(() => window.devicePixelRatio) === 1
  || await page.evaluate(() => Math.round(window.outerWidth) > 0), "page zoom untouched");

/* Persistence, and the anchored block still where it was in document terms. */
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 600);
ok("⛔ THE LEVEL SURVIVES A RELOAD", Math.abs(Number(await tb("note-sheet").getAttribute("data-zoom")) - wheeled) < 0.001,
  `data-zoom=${await tb("note-sheet").getAttribute("data-zoom")}`);

const zoomedAnchor = anchorsIn(await storedDoc())[0];
ok("⛔ AND ZOOMING DID NOT MOVE THE ANCHORED BLOCK'S STORED POSITION — it is in document space",
  zoomedAnchor.attrs.x === movedDoc.attrs.x && zoomedAnchor.attrs.y === movedDoc.attrs.y,
  `${movedDoc.attrs.x},${movedDoc.attrs.y} → ${zoomedAnchor.attrs.x},${zoomedAnchor.attrs.y}`);

/* ════ 8. AND THE GESTURE STILL WORKS WHILE ZOOMED ════════════════════════════════════ */
console.log("\n8 · The placement is still right at a zoom level ≠ 100%");
const at2 = await blankPoint({ dx: 300, dy: 160 });
await page.mouse.dblclick(at2.x, at2.y);
await pacedWait(page, 400);
const boxes = await tb("note-anchor").all();
const last = await boxes[boxes.length - 1].boundingBox();
const dx2 = Math.abs(last.x - at2.x);
const dy2 = Math.abs(last.y - at2.y);
ok(`⛔ ZOOMED IN, IT STILL LANDS AT THE POINT CLICKED (±${TOLERANCE * 2}px)`, dx2 <= TOLERANCE * 2 && dy2 <= TOLERANCE * 2,
  `clicked (${at2.x}, ${at2.y}) · rendered (${Math.round(last.x)}, ${Math.round(last.y)}) · off by ${Math.round(dx2)}, ${Math.round(dy2)}`);

ok("no uncaught page errors across the whole run", pageErrors.length === 0, pageErrors.join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
