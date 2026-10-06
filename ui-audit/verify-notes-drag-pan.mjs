/* verify-notes-drag-pan — NEW-1 (B2156912), 2026-10-06. Owner report (Michael): in Notes,
 * click-and-drag should ALWAYS pan the page, from any spot. A drag that began on a TABLE did not
 * pan — it selected the table instead — and he said the press itself should not select either.
 *
 * ⛔ WHY IT NEVER REACHED THE PAN. `focusFromMat` treats `table`/`.tableWrapper`/a box/an image as
 * CONTENT and returns before `beginBlankGesture` (the only mouse pan) is ever armed, and
 * ProseMirror has already taken the same `mousedown` for itself. So only blank paper and bare mat
 * ever panned. A press on a box's text selected the box on mousedown; the box body also drags the
 * BOX (`notesAnchorNode.js` `beginDrag`) rather than the page.
 *
 * WHAT THIS PROVES, every case a REAL trusted mouse (`page.mouse.move/down/move/up` — never a
 * synthetic event): for a drag that starts on (a) a table cell, (b) a table header, (c) a table's
 * top border, (d) an unfocused box's text, (e) a picture box, (f) blank paper, (g) the grey mat —
 *   · the workspace transform moved by the drag delta (±1.5px),
 *   · the box count did not change and nothing was moved or stored,
 *   · NOTHING got selected: no box selected/editing, no caret or range in the editor, no cell
 *     selection, no node selection, DOM focus not in the editor, `data-panning` cleared on release.
 * and plain clicks keep today's behaviour (caret in the cell, typing lands there, double-click
 * blank + a character makes exactly one box, double-click on a word selects it, Tab walks cells),
 * the exceptions keep their own drag (the box grip moves the box, the east handle resizes it), and
 * a drag that starts INSIDE the box being edited selects text instead of panning.
 *
 * ⛔ RED-PROOF: `--baseline=<url>` (or the same file against pre-fix code) is expected to FAIL the
 * table / box-text / picture arms and PASS the blank-paper and grey-mat arms (the known-good arms,
 * which already panned) — if those two fail the run is VOID, not a score.
 */
import { chromium } from "playwright";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const pageKey = (id) => `planyr:notes:page:v1:local:${id}`;
const TOL = 1.5;

let pass = 0; let fail = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });

const P = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const cell = (t) => ({ type: "tableCell", content: [P(t)] });
const head = (t) => ({ type: "tableHeader", content: [P(t)] });
const TABLE = { type: "table", content: [
  { type: "tableRow", content: [head("Name"), head("Qty")] },
  { type: "tableRow", content: [cell("Alpha"), cell("Beta")] },
  { type: "tableRow", content: [cell("Gamma"), cell("Delta")] },
] };
const DOC = { type: "doc", content: [
  { type: "noteAnchor", attrs: { x: 40, y: 10, w: 360 }, content: [TABLE] },
  { type: "noteAnchor", attrs: { x: 40, y: 260, w: 240 }, content: [P("Hello world")] },
  { type: "noteAnchor", attrs: { x: 330, y: 260, w: 200, h: 120 },
    content: [{ type: "noteImage", attrs: { imageId: "missing-img", alt: "pic", mime: "image/png" } }] },
  P(""),
] };

async function openNote(viewport = { width: 1400, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await assertMeasurable(page, "verify-notes-drag-pan");
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, k, doc]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Drag", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(k, JSON.stringify(doc));
  }, [TREE_KEY, pageKey("p1"), DOC]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 20000 });
  await pacedWait(page, 900);
  return page;
}

const view = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="note-workspace"]');
  const t = el?.style.transform || "";
  const m = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(t);
  const s = /scale\(([-0-9.]+)\)/.exec(t);
  return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0, z: s ? parseFloat(s[1]) : 1 };
});
const boxCount = (page) => page.locator(".planyr-anchor").count();
const center = (page, sel, nth = 0) => page.evaluate(([s, n]) => {
  const el = document.querySelectorAll(s)[n];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), r: { l: r.left, t: r.top, w: r.width, h: r.height } };
}, [sel, nth]);
const wordCenter = (page, w) => page.evaluate((word) => {
  const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const i = node.textContent.indexOf(word);
    if (i === -1) continue;
    const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length);
    const b = r.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), l: b.left, r: b.right };
  }
  return null;
}, w);

/** Everything "something got selected" can mean, read off the REAL DOM — never PM state. */
const residue = (page) => page.evaluate(() => {
  const pm = document.querySelector(".ProseMirror");
  const sel = document.getSelection();
  const inEditor = !!(sel && sel.rangeCount && pm && pm.contains(sel.getRangeAt(0).startContainer));
  const ae = document.activeElement;
  return {
    boxSelected: document.querySelectorAll('.planyr-anchor[data-selected="1"]').length,
    boxEditing: document.querySelectorAll('.planyr-anchor[data-editing="1"]').length,
    rangeInEditor: inEditor,
    selectedText: (sel?.toString() || ""),
    cellSelection: document.querySelectorAll(".selectedCell").length,
    nodeSelection: document.querySelectorAll(".ProseMirror-selectednode").length,
    editorFocused: !!(ae && pm && pm.contains(ae)),
    panning: document.querySelector('[data-testid="note-mat"]')?.getAttribute("data-panning"),
    bodyCursor: document.body.style.cursor,
  };
});
const clean = (r) => r.boxSelected === 0 && r.boxEditing === 0 && !r.rangeInEditor && r.selectedText === ""
  && r.cellSelection === 0 && r.nodeSelection === 0 && !r.editorFocused && !r.panning && !r.bodyCursor;

async function drag(page, from, d, { steps = 12, midRead = null } = {}) {
  await page.mouse.move(from.x, from.y);
  await pacedWait(page, 60);
  await page.mouse.down();
  let mid = null;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(Math.round(from.x + (d.dx * i) / steps), Math.round(from.y + (d.dy * i) / steps));
    await pacedWait(page, 16);
    if (midRead && i === Math.ceil(steps / 2)) mid = await midRead();
  }
  await page.mouse.up();
  await pacedWait(page, 250);
  return mid;
}

/** Blank paper: inside the sheet's body, below the title band, and over NO box (hit-tested). */
async function blankPaper(page) {
  return page.evaluate(() => {
    const body = document.querySelector('[data-testid="note-body"]').getBoundingClientRect();
    for (let y = body.top + 420; y < Math.min(innerHeight - 20, body.top + 700); y += 20) {
      for (let x = body.left + 20; x < body.right - 20; x += 25) {
        const stack = document.elementsFromPoint(x, y);
        if (!stack.length) continue;
        if (stack.some((e) => e.closest && e.closest(".planyr-anchor, table, input"))) continue;
        if (stack[0].closest('[data-testid="note-sheet"]')) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  });
}
async function greyMat(page) {
  return page.evaluate(() => {
    const m = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
    for (let y = m.top + 40; y < m.bottom - 40; y += 30) {
      for (let x = m.left + 10; x < m.right - 10; x += 20) {
        const stack = document.elementsFromPoint(x, y);
        if (stack[0] && stack[0].getAttribute("data-testid") === "note-mat") return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  });
}

/** One pan arm on a FRESH page (a harness that keeps pressing the same box ends up inside it). */
async function panArm(label, pick, { delta = { dx: -70, dy: -45 }, prep = null } = {}) {
  const page = await openNote();
  if (prep) await prep(page);
  const at = await pick(page);
  if (!at) { ok(`${label}: a press point exists`, false, "no point found"); await page.close(); return null; }
  const boxes = await boxCount(page);
  const v0 = await view(page);
  const mid = await drag(page, at, delta, { midRead: () => page.evaluate(() => document.querySelector('[data-testid="note-mat"]').getAttribute("data-panning")) });
  const v1 = await view(page);
  const dx = (v1.x - v0.x) / v0.z; const dy = (v1.y - v0.y) / v0.z;
  const r = await residue(page);
  ok(`${label}: the workspace moved by the drag delta`,
    Math.abs((v1.x - v0.x) - delta.dx) <= TOL && Math.abs((v1.y - v0.y) - delta.dy) <= TOL,
    `asked ${delta.dx},${delta.dy} · moved ${(v1.x - v0.x).toFixed(1)},${(v1.y - v0.y).toFixed(1)} (z ${v0.z})`);
  ok(`${label}: data-panning was armed mid-drag`, mid === "1", `mid=${JSON.stringify(mid)}`);
  ok(`${label}: box count unchanged`, (await boxCount(page)) === boxes);
  ok(`${label}: ⛔ nothing selected afterwards (no box, caret, range, cell, node, focus, panning)`, clean(r), JSON.stringify(r));
  void dx; void dy;
  return page;
}

const tableCell = (page) => center(page, ".ProseMirror table td");
const tableHead = (page) => center(page, ".ProseMirror table th");
const tableTopBorder = async (page) => {
  const c = await center(page, ".ProseMirror table");
  return c ? { x: Math.round(c.r.l + c.r.w * 0.25), y: Math.round(c.r.t + 1) } : null;
};

console.log("\n0 · KNOWN-GOOD ARMS — blank paper and the grey mat already panned before this change");
let p = await panArm("blank paper", blankPaper); await p?.close();
p = await panArm("grey mat", greyMat); await p?.close();
const voidRun = failures.length > 0;
if (voidRun) { console.log("\n  ⚠ A known-good arm failed — the instrument cannot see a pan. RUN IS VOID."); }

console.log("\n1 · A DRAG THAT STARTS ON A TABLE PANS (the reported defect)");
p = await panArm("table cell", tableCell); await p?.close();
p = await panArm("table header", tableHead); await p?.close();
p = await panArm("table top border", tableTopBorder); await p?.close();

console.log("\n2 · …ON AN UNFOCUSED BOX'S TEXT AND ON A PICTURE");
p = await panArm("unfocused box text", (pg) => wordCenter(pg, "Hello")); await p?.close();
p = await panArm("picture box", (pg) => center(pg, ".planyr-note-image, .planyr-anchor[data-anchor-kind=\"image\"]")); await p?.close();

console.log("\n3 · …AT ANOTHER ZOOM, AND ON AN ALREADY-PANNED VIEW");
p = await panArm("table cell @ zoomed in", tableCell, {
  prep: async (pg) => { await pg.mouse.move(700, 450); await pg.keyboard.press("Control+="); await pacedWait(pg, 300); },
});
if (p) { ok("zoom actually changed (known-good for this arm)", (await view(p)).z !== 1, `z=${(await view(p)).z}`); await p.close(); }
p = await panArm("table cell @ already-panned view", tableCell, {
  delta: { dx: 55, dy: 30 },
  prep: async (pg) => {
    const g = await greyMat(pg);
    await drag(pg, g, { dx: -40, dy: -25 });
  },
});
await p?.close();

console.log("\n4 · PLAIN CLICKS KEEP TODAY'S BEHAVIOUR");
{
  const page = await openNote();
  const c = await tableCell(page);
  await page.mouse.click(c.x, c.y);                       // press 1: selects the box (stage 1)
  await pacedWait(page, 150);
  await page.mouse.click(c.x, c.y);                       // press 2: enters, caret in the cell
  await pacedWait(page, 150);
  const inCell = await page.evaluate(() => {
    const s = document.getSelection(); if (!s?.rangeCount) return false;
    const n = s.getRangeAt(0).startContainer; return !!(n.nodeType === 3 ? n.parentElement : n)?.closest("td, th");
  });
  ok("a plain click on a cell (twice: select, then enter) puts the caret in a cell", inCell);
  ok("…and it created no box", (await boxCount(page)) === 3);
  await page.keyboard.type("Zq");
  await pacedWait(page, 900);
  const txt = await page.evaluate((k) => localStorage.getItem(k), pageKey("p1"));
  ok("typing lands in the cell (stored document)", /Zq/.test(txt || ""));
  const w = await wordCenter(page, "Hello");
  await page.mouse.click(w.x, w.y); await pacedWait(page, 150);
  await page.mouse.click(w.x, w.y);
  await pacedWait(page, 800);        // out of the multi-click window, or the next press counts as a TRIPLE click
  await page.mouse.dblclick(w.x, w.y); await pacedWait(page, 200);
  ok("double-click on a word selects that word", (await residue(page)).selectedText.trim() === "Hello", JSON.stringify((await residue(page)).selectedText));
  await page.close();
}
{
  const page = await openNote();
  const before = await boxCount(page);
  const b = await blankPaper(page);
  await page.mouse.dblclick(b.x, b.y);
  await pacedWait(page, 150);
  await page.keyboard.type("Q");
  await pacedWait(page, 250);
  ok("double-click on blank paper + a character makes exactly one box", (await boxCount(page)) === before + 1, `${before} → ${await boxCount(page)}`);
  await page.close();
}
{
  const page = await openNote();
  const c = await tableCell(page);
  await page.mouse.click(c.x, c.y); await pacedWait(page, 150);
  await page.mouse.click(c.x, c.y); await pacedWait(page, 150);
  const idx = () => page.evaluate(() => {
    const cells = [...document.querySelectorAll(".ProseMirror table td, .ProseMirror table th")];
    const s = document.getSelection(); const n = s?.anchorNode;
    return cells.indexOf((n && (n.nodeType === 3 ? n.parentElement : n))?.closest("td, th"));
  });
  const a = await idx();
  await page.keyboard.press("Tab"); await pacedWait(page, 150);
  ok("Tab moves between cells", (await idx()) === a + 1, `${a} → ${await idx()}`);
  await page.close();
}

console.log("\n5 · EXCEPTIONS KEEP THEIR OWN DRAG, AND THE BOX BEING EDITED SELECTS TEXT");
{
  const page = await openNote();
  const w = await wordCenter(page, "Hello");
  await page.mouse.click(w.x, w.y); await pacedWait(page, 150);
  await page.mouse.click(w.x, w.y); await pacedWait(page, 150);
  const v0 = await view(page);
  const w2 = await wordCenter(page, "Hello");
  await drag(page, { x: Math.round(w2.l + 1), y: w2.y }, { dx: Math.round(w2.r - w2.l - 2), dy: 0 }, { steps: 8 });
  const v1 = await view(page);
  const r = await residue(page);
  ok("drag inside the box being edited selects text", r.selectedText.length > 0, JSON.stringify(r.selectedText));
  ok("…and does NOT pan", Math.abs(v1.x - v0.x) <= TOL && Math.abs(v1.y - v0.y) <= TOL, `moved ${(v1.x - v0.x).toFixed(1)},${(v1.y - v0.y).toFixed(1)}`);
  await page.close();
}
{
  const page = await openNote();
  const box = page.locator('.planyr-anchor').nth(1);
  const bb = await box.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);   // hover reveals the grip
  await pacedWait(page, 150);
  const g = await center(page, ".planyr-anchor-grip", 1);
  const v0 = await view(page);
  const x0 = (await box.boundingBox()).x;
  await drag(page, { x: g.x, y: g.y }, { dx: 60, dy: 40 }, { steps: 8 });
  const x1 = (await box.boundingBox()).x;
  const v1 = await view(page);
  ok("the box grip still MOVES the box", x1 - x0 > 40, `box moved ${(x1 - x0).toFixed(1)}`);
  ok("…and does not pan", Math.abs(v1.x - v0.x) <= TOL && Math.abs(v1.y - v0.y) <= TOL);
  await page.close();
}
{
  const page = await openNote();
  const box = page.locator('.planyr-anchor').nth(1);
  const w = await wordCenter(page, "Hello");
  await page.mouse.click(w.x, w.y); await pacedWait(page, 200);   // select (stage 1) → east handle live
  const h = await center(page, '.planyr-anchor[data-selected="1"] .planyr-anchor-h-e');
  const v0 = await view(page);
  const w0 = (await box.boundingBox()).width;
  if (h) await drag(page, { x: h.x, y: h.y }, { dx: 50, dy: 0 }, { steps: 8 });
  const w1 = (await box.boundingBox()).width;
  const v1 = await view(page);
  ok("the east resize handle still RESIZES", !!h && w1 - w0 > 30, `width ${w0.toFixed(0)} → ${w1.toFixed(0)}`);
  ok("…and does not pan", Math.abs(v1.x - v0.x) <= TOL && Math.abs(v1.y - v0.y) <= TOL);
  await page.close();
}

{
  const page = await openNote();
  const t = await center(page, ".ProseMirror table");
  const colW = () => page.evaluate(() => document.querySelector(".ProseMirror table td, .ProseMirror table th").getBoundingClientRect().width);
  const w0 = await colW();
  const v0 = await view(page);
  const border = { x: Math.round(t.r.l + w0), y: Math.round(t.r.t + t.r.h / 2) };
  await page.mouse.move(border.x - 3, border.y); await pacedWait(page, 100);
  await page.mouse.move(border.x, border.y); await pacedWait(page, 150);
  await drag(page, border, { dx: 40, dy: 0 }, { steps: 8 });
  const w1 = await colW();
  const v1 = await view(page);
  ok("a table's column border still RESIZES the column", Math.abs(w1 - w0) > 15, `first column ${w0.toFixed(0)} → ${w1.toFixed(0)}`);
  ok("…and does not pan", Math.abs(v1.x - v0.x) <= TOL && Math.abs(v1.y - v0.y) <= TOL);
  await page.close();
}

{
  const page = await openNote();
  const w = await wordCenter(page, "Hello");
  await page.mouse.click(w.x, w.y); await pacedWait(page, 250);      // stage 1: the box is now SELECTED
  const v0 = await view(page);
  const w2 = await wordCenter(page, "Hello");
  await drag(page, { x: Math.round(w2.l + 1), y: w2.y }, { dx: Math.round(w2.r - w2.l - 2), dy: 0 }, { steps: 8 });
  const v1 = await view(page);
  ok("a drag that starts in an already-selected box keeps selecting text (its press is the click-in)",
    (await residue(page)).selectedText.length > 0 && Math.abs(v1.x - v0.x) <= TOL, JSON.stringify((await residue(page)).selectedText));
  await page.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed${voidRun ? " (RUN VOID: a known-good arm failed)" : ""}`);
if (fail) console.log("failed:\n  " + failures.join("\n  "));
process.exit(fail === 0 ? 0 : 1);
