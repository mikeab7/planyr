/* verify-notes-left-margin-reachable — THE LEFT OF THE PAGE IS REACHABLE: THERE IS ALWAYS A
 * MARGIN TO PRESS IN, AND A BOX DRAGGED PAST THE PAGE'S LEFT EDGE MAKES THE PAGE WIDER
 * (NOTES-FREE-PLACEMENT round 2, owner report 2026-09-08).
 *
 * ⛔ WHY THIS EXISTS SEPARATELY FROM `verify-notes-free-placement`. That harness drove eight
 * directions, read storage back after a reload, and passed — on a page that had NOT yet grown,
 * where the sheet is centred and there is a wide strip of grey on each side. The owner drove the
 * SHIPPED build by hand and found the left half dead. The variable neither of us had written down
 * is whether the page has ALREADY GROWN: from that moment the sheet was left-aligned flush against
 * the pane and the left gutter was ZERO, so there was nothing to press in and nowhere to drag to.
 * WRONG-CASE, exactly: the command was fine, the scene was not.
 *
 * ⛔ SO EVERY CASE HERE STARTS FROM AN ALREADY-GROWN PAGE, and the two assertions are the ones he
 * named: after a drag to a negative offset the page's WIDTH INCREASES and the box's left edge sits
 * OUTSIDE the original page bounds; and a press in the left margin of a grown page creates a note.
 * Both were proven to go RED on `origin/main` before the fix — see the run recorded on the item.
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

/** A page that is ALREADY GROWN — one box out past the right margin. That is the whole point. */
const GROWN = (extra = []) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Body line one." }] },
    { type: "noteAnchor", attrs: { x: 900, y: 120, w: 180, h: null, aid: "grown" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "ALREADY OUT RIGHT" }] }] },
    ...extra.map((e) => ({ type: "noteAnchor", attrs: { x: e.x, y: e.y, w: 180, h: null, aid: e.aid },
      content: [{ type: "paragraph", content: [{ type: "text", text: e.t || "BOX" }] }] })),
    { type: "paragraph", content: [] },
  ],
});

async function open(doc, width) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-left-margin-reachable");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Reach", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  return page;
}

const geom = (page) => page.evaluate(() => {
  const sheet = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
  const mat = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
  const probeY = Math.round(sheet.top + 320);
  const probeX = Math.round(mat.left + 24);
  const hit = document.elementFromPoint(probeX, probeY);
  return {
    sheetL: Math.round(sheet.left), sheetR: Math.round(sheet.right), sheetW: Math.round(sheet.width),
    matL: Math.round(mat.left), matR: Math.round(mat.right),
    leftGutter: Math.round(sheet.left - mat.left),
    probe: { x: probeX, y: probeY, el: hit ? (hit.getAttribute("data-testid") || hit.className || hit.tagName) : "none" },
  };
});

const stored = (page) => page.evaluate((k) => {
  const out = [];
  try { const w = (n) => { if (n?.type === "noteAnchor") out.push({ aid: n.attrs.aid, x: n.attrs.x, y: n.attrs.y }); (n?.content || []).forEach(w); };
    w(JSON.parse(localStorage.getItem(k))); } catch (_) { /* caller fails on the empty answer */ }
  return out;
}, PAGE_KEY);

const WIDTHS = [1000, 1280, 1600];

/* ═══ 1. THERE IS ALWAYS A MARGIN BESIDE THE PAGE ═════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("1. A GROWN PAGE STILL HAS GREY BESIDE IT — the gutter that must never be zero");
console.log("=".repeat(100));
for (const W of WIDTHS) {
  const page = await open(GROWN(), W);
  const g = await geom(page);
  ok(`${W}px: the grown page keeps a usable left margin`,
    g.leftGutter >= 40, `gutter ${g.leftGutter} · sheet ${g.sheetW} at [${g.sheetL}..${g.sheetR}] in mat [${g.matL}..${g.matR}]`);
  ok(`${W}px: …and a press at the mat's own left edge lands on the MAT, not on the page`,
    g.probe.el === "note-mat", `${g.probe.el} at (${g.probe.x}, ${g.probe.y})`);
  await page.context().close();
}

/* ═══ 2. HIS REPRO: A PRESS IN THE LEFT MARGIN OF AN ALREADY-GROWN PAGE CREATES A NOTE ════ */
console.log("\n" + "=".repeat(100));
console.log("2. HIS REPRO — double-click in the left margin of an ALREADY-GROWN page");
console.log("=".repeat(100));
for (const W of WIDTHS) {
  const page = await open(GROWN(), W);
  const g = await geom(page);
  const before = (await stored(page)).length;
  const at = { x: Math.round(g.matL + Math.min(40, Math.max(12, g.leftGutter / 2))), y: g.probe.y };
  await page.mouse.dblclick(at.x, at.y);
  await pacedWait(page, 400);
  await page.keyboard.type("FROM THE LEFT MARGIN");
  await pacedWait(page, 900);
  const after = await stored(page);
  const text = await page.evaluate((k) => (localStorage.getItem(k) || "").includes("FROM THE LEFT MARGIN"), PAGE_KEY);
  ok(`${W}px: a double-click in the left margin creates a note`,
    after.length === before + 1, `${before} → ${after.length} · ${JSON.stringify(after.map((a) => a.x))}`);
  ok(`${W}px: …and what you type goes into it`, text, String(text));
  ok(`${W}px: …and the new note is VISIBLE on screen, not scrolled out from under you`,
    await page.evaluate(() => {
      const els = [...document.querySelectorAll(".planyr-anchor")];
      const fresh = els[els.length - 1];
      const r = fresh.getBoundingClientRect();
      return r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
    }), "on screen");
  await page.context().close();
}

/* ═══ 3. THE ASSERTION HE ASKED FOR, VERBATIM ═════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("3. DRAG PAST THE LEFT EDGE — the page's WIDTH INCREASES and the box sits OUTSIDE the");
console.log("   original page bounds. His stated red-proof, asserted exactly.");
console.log("=".repeat(100));
for (const W of WIDTHS) {
  /* The box to drag starts just inside the page's own left edge, so the gesture is entirely on
   * screen — a grip the pointer cannot reach is a harness failure, not a product one
   * (DRIVER-SCROLL-IS-NOT-APP-SCROLL). */
  const page = await open(GROWN([{ x: 40, y: 320, aid: "drag", t: "DRAG ME LEFT" }]), W);
  const g0 = await geom(page);
  const originalPageLeft = g0.sheetL;
  const originalWidth = g0.sheetW;
  const src = await page.evaluate(() => {
    const el = document.querySelector('.planyr-anchor[data-anchor-id="drag"]');   // B2426788: grabbed by its BORDER (top edge)
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.3), y: Math.round(r.top + 0.5),
      onScreen: r.left > 0 && r.right < window.innerWidth };
  });
  ok(`${W}px: the box's top border is on screen before the drag starts (the harness can vouch for the gesture)`,
    src.onScreen, `border at x=${src.x}`);
  const travel = 260;
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) await page.mouse.move(Math.max(4, src.x - (travel * i) / 24), src.y);
  await page.mouse.up();
  await pacedWait(page, 900);

  const g1 = await geom(page);
  const box = (await stored(page)).find((a) => a.aid === "drag") || {};
  const screen = await page.evaluate(() => {
    const r = document.querySelector('.planyr-anchor[data-anchor-id="drag"]').getBoundingClientRect();
    return { left: Math.round(r.left) };
  });
  ok(`${W}px: ⛔ the box's stored offset is NEGATIVE — it is outside the page's own origin`,
    Number(box.x) < 0, `stored x=${box.x}`);
  ok(`${W}px: ⛔ the page's WIDTH INCREASED to hold it`,
    g1.sheetW > originalWidth, `${originalWidth} → ${g1.sheetW}`);
  ok(`${W}px: ⛔ …and the box's left edge sits OUTSIDE the ORIGINAL page bounds`,
    screen.left < originalPageLeft, `box left ${screen.left} against the original page's left edge ${originalPageLeft}`);
  ok(`${W}px: …and it is still on screen, so you can see what you did`,
    screen.left > -180, `box left ${screen.left}`);
  await page.context().close();
}

console.log("\n" + "=".repeat(100));
if (failures.length) { console.log(`⛔ ${failures.length} FAILED:\n  ${failures.join("\n  ")}`); process.exitCode = 1; }
else console.log("✓ every case passed");
await browser.close();
