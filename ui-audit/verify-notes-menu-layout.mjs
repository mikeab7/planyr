/* verify-notes-menu-layout — WORD'S TWO MENUS, FULLY ON SCREEN, AND A GROUP THAT MOVES TOGETHER.
 *
 * Three owner items from one chat block (2026-08-17), verified together because they touch the
 * same two surfaces and one of them is most of the fix for another:
 *
 *   NEW-MINI-TOOLBAR   *"there's too many things… That should be in the Microsoft Word format or
 *                      OneNote format where you right click something and there's one menu that's
 *                      the typical menu with cut, copy, paste, whatever. And then there's another
 *                      menu that kind of goes horizontal that has text size, text colour, bold
 *                      italic underline strikethrough, all that good stuff."*
 *   NEW-MENU-OFFSCREEN *"you can't see everything on the menu because the delete part is hidden
 *                      behind my start menu or task bar."*
 *   NEW-MULTI-DRAG     *"if I select multiple things and then I grab one of them to move it, it
 *                      should move all of the items together."*
 *
 * ⛔ THE MENU IS MEASURED AS A WHOLE ASSEMBLY, STRIP INCLUDED — that is the specific thing his
 * report needed and the specific thing the old code got wrong. It positioned against a HARD-CODED
 * 420px guess at the menu's height, so a taller menu ran off the bottom and the row that fell off
 * was the last one: `Delete this box`. Measuring only the list would reproduce the same class of
 * error one layer down.
 *
 * ⛔ AND EVERY FORMATTING VERDICT IS THE STORED DOCUMENT. A strip of icons is exactly the kind of
 * surface that looks right and does nothing: the button paints, the click "works", and the
 * command ran against a selection the menu had already stolen. So Bold from the strip is judged
 * on `localStorage`, never on `aria-pressed`, which would be the menu marking its own homework.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

/** ⛔ A SHORT WINDOW, DELIBERATELY. His is a maximised laptop with a taskbar; the failure only
 *  exists when the menu is a real fraction of the window height. A tall test window hides it. */
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 620 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "verify-notes-menu-layout");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function seed(boxes = []) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, key, bs]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Menu", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(key, JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Underline this sentence please" }] },
        ...bs.map((b, i) => ({
          type: "noteAnchor", attrs: b,
          content: [{ type: "paragraph", content: [{ type: "text", text: `box ${i + 1}` }] }],
        })),
      ],
    }));
  }, [TREE_KEY, PAGE_KEY, boxes]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

const storedBoxes = () => page.evaluate((k) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAnchor") { out.push({ ...n.attrs }); return; }
    (n.content || []).forEach(walk);
  };
  try { walk(JSON.parse(localStorage.getItem(k))); } catch (_) { /* unreadable */ }
  return out;
}, PAGE_KEY);

const storedMarks = async () => {
  const raw = await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY);
  const out = new Set();
  const walk = (n) => { if (!n) return; for (const m of n.marks || []) out.add(m.type); (n.content || []).forEach(walk); };
  try { walk(JSON.parse(raw)); } catch (_) { /* unreadable */ }
  return [...out];
};

/** Select a word with a real double-click, then right-click ON it. */
async function openMenuOnWord(word) {
  const spot = await page.evaluate((needle) => {
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + needle.length);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, word);
  if (!spot) return false;
  await page.mouse.dblclick(spot.x, spot.y);
  await pacedWait(page, 200);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  await pacedWait(page, 400);
  return (await page.locator('[data-testid="note-doc-menu"]').count()) > 0;
}

/** The whole assembly's rect, and the vertical list's row count. */
const menuGeom = () => page.evaluate(() => {
  const el = document.querySelector('[data-testid="note-doc-menu"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const rows = [...document.querySelectorAll('[data-testid="note-doc-menu-list"] [data-testid^="note-menu-"]')].length;
  const del = document.querySelector('[data-testid="note-menu-delete-box"]');
  const d = del ? del.getBoundingClientRect() : null;
  return {
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    rows,
    flipped: el.getAttribute("data-menu-flipped") === "1",
    hasMini: Boolean(document.querySelector('[data-testid="note-menu-mini"]')),
    deleteBottom: d ? Math.round(d.bottom) : null,
    viewH: window.visualViewport?.height ?? window.innerHeight,
    viewW: window.visualViewport?.width ?? window.innerWidth,
  };
});

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 1 · TWO MENUS, WORD'S SHAPE
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("1 · A HORIZONTAL STRIP FOR FORMATTING, A SHORT VERTICAL LIST FOR COMMANDS");
console.log("=".repeat(100));
await seed();
ok("a real right-click on selected text opens the menu", await openMenuOnWord("sentence"));
let g = await menuGeom();
console.log(`    assembly ${g?.w}×${g?.h} at ${g?.x},${g?.y} · list rows ${g?.rows} · strip ${g?.hasMini}`);
ok("⛔ there IS a horizontal formatting strip", Boolean(g?.hasMini));

const strip = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-menu-mini"] [data-testid^="note-menu-"]')]
  .map((b) => b.getAttribute("data-testid").replace("note-menu-", "")));
console.log(`    strip: ${strip.join(" · ")}`);
for (const want of ["size", "bold", "italic", "underline", "strike", "color", "highlight", "bullets", "numbering", "indent", "outdent"]) {
  ok(`…the strip offers ${want}`, strip.includes(want));
}

const listRows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-doc-menu-list"] > * > [data-testid^="note-menu-"], [data-testid="note-doc-menu-list"] > [data-testid^="note-menu-"]')]
  .map((b) => b.getAttribute("data-testid").replace("note-menu-", "")));
console.log(`    list: ${listRows.join(" · ")}`);
ok("⛔ the vertical list is SHORT — commands only", listRows.length <= 6, `${listRows.length} rows`);
ok("⛔ …and carries none of the formatting any more",
  !listRows.some((r) => ["bold", "italic", "underline", "strike", "bullets", "numbering"].includes(r)));
ok("the clipboard commands are on it", ["cut", "copy", "paste"].every((r) => listRows.includes(r)));
ok("⛔ paste is ONE row with a submenu, not three", listRows.includes("paste") && !listRows.includes("paste-plain"));

await page.locator('[data-testid="note-menu-paste"]').first().hover();
await pacedWait(page, 300);
const sub = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-menu-paste-sub"] [data-testid^="note-menu-"]')]
  .map((b) => b.getAttribute("data-testid").replace("note-menu-", "")));
ok("…and the submenu holds all three modes", sub.length === 3, sub.join(","));

/* ⛔ THE STRIP ACTUALLY WORKS, judged on the stored document. */
console.log("\n  the strip acts on the real selection");
await seed();
if (await openMenuOnWord("sentence")) {
  ok("no underline in the document to begin with", !(await storedMarks()).includes("underline"));
  await page.locator('[data-testid="note-menu-underline"]').click();
  await pacedWait(page, 900);
  ok("⛔ Underline from the STRIP reaches the stored document", (await storedMarks()).includes("underline"),
    (await storedMarks()).join(","));
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 2 · HIS CASE: OPENED NEAR THE BOTTOM, NOTHING IS OFF SCREEN
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("2 · THE MENU IS ALWAYS FULLY VISIBLE — including `Delete this box`");
console.log("=".repeat(100));
const pad = (s, n) => String(s == null ? "—" : s).padEnd(n);
console.log(pad("opened at y", 14) + pad("assembly", 18) + pad("bottom", 10) + pad("viewport", 10) + pad("flipped", 9) + "verdict");
console.log("-".repeat(100));

/* THE BOX IS PUT LOW AND THE MENU IS OPENED ON THE BOX ITSELF. The first version right-clicked
 * at a chosen VIEWPORT y with the box's x - and three of the four points were not over the editor
 * at all, so no menu opened and it reported a failure about PLACEMENT while measuring nothing. A
 * box menu only exists on a box; the honest way to reach the bottom of the screen is to put the
 * box there and right-click it where it lands. */
for (const docY of [40, 200, 300, 380]) {
  await seed([{ x: 300, y: docY, w: 240 }]);
  const box = await page.locator(".planyr-anchor").first().boundingBox();
  if (!box) { ok(`a box seeded at document y=${docY} renders`, false); continue; }
  const px = Math.round(box.x + box.width / 2);
  const py = Math.round(box.y + Math.min(10, box.height / 2));
  await page.mouse.click(px, py);
  await pacedWait(page, 250);
  await page.mouse.click(px, py, { button: "right" });
  await pacedWait(page, 400);
  g = await menuGeom();
  if (!g) { console.log(pad(py, 14) + "no menu"); ok(`a right-click on a box at screen y=${py} opens a menu`, false); continue; }
  const bottom = g.y + g.h;
  const fits = g.y >= 0 && bottom <= g.viewH && g.x >= 0 && g.x + g.w <= g.viewW;
  console.log(pad(py, 14) + pad(`${g.w}x${g.h} at ${g.x},${g.y}`, 18) + pad(bottom, 10) + pad(g.viewH, 10)
    + pad(g.flipped ? "yes" : "no", 9) + (fits ? "ok" : "OFF SCREEN"));
  ok(`opened on a box at screen y=${py}: the whole assembly is inside the viewport`, fits,
    `bottom ${bottom} vs ${g.viewH}`);
  ok(`  ...and it is the BOX menu, so 'Delete this box' is the row under test`,
    g.deleteBottom != null, g.deleteBottom == null ? "no delete row - wrong menu" : `bottom ${g.deleteBottom}`);
  if (g.deleteBottom != null) {
    ok("  'Delete this box' is fully on screen", g.deleteBottom <= g.viewH, `${g.deleteBottom} vs ${g.viewH}`);
  }
}
/* 3 · A GROUP MOVES TOGETHER */
console.log("\n" + "=".repeat(100));
console.log("3 · GRABBING ONE OF SEVERAL SELECTED BOXES MOVES THEM ALL");
console.log("=".repeat(100));
await seed([{ x: 120, y: 60, w: 200, aid: "a1" }, { x: 380, y: 130, w: 200, aid: "a2" }, { x: 140, y: 210, w: 200, aid: "a3" }]);

/* THE SELECTION IS BUILT WITH SHIFT+CLICK, NOT A MARQUEE. The first version dragged a band from
 * above-left of the boxes - which on a short window starts over the toolbar, so the band never
 * began and it selected nothing, reporting a failure about the DRAG while never having a
 * multi-selection at all. Shift+click is this module's own documented toggle and it puts the
 * fixture into the state under test directly. (The marquee has its own harness.) */
const boxRects = await page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")]
  .map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 8) }; }));
/* SHIFT IS HELD ON THE KEYBOARD, NOT PASSED AS AN OPTION - and this cost a confident false
 * verdict about the app. `page.mouse.click` accepts button/clickCount/delay and SILENTLY IGNORES
 * `modifiers` (that option belongs to `locator.click`). So every click replaced the selection
 * instead of adding to it, one box ended up selected, and the harness reported "the group drag
 * moves only one box" - a real-sounding finding about working code. An option a driver quietly
 * drops is indistinguishable from a feature that does not work. */
await page.mouse.click(boxRects[0].x, boxRects[0].y);
await pacedWait(page, 220);
await page.keyboard.down("Shift");
for (let i = 1; i < boxRects.length; i += 1) {
  await page.mouse.click(boxRects[i].x, boxRects[i].y);
  await pacedWait(page, 220);
}
await page.keyboard.up("Shift");
await pacedWait(page, 300);
const selCount = await page.locator('.planyr-anchor[data-selected="1"]').count();
ok("three boxes are selected", selCount === 3, `${selCount} selected`);
const before = await storedBoxes();
const grip = page.locator('.planyr-anchor[data-selected="1"] [data-testid="note-anchor-grip"]').first();
let moved = null;
if (await grip.count()) {
  const gb = await grip.boundingBox();
  const cx = gb.x + gb.width / 2;
  const cy = gb.y + gb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(cx + (90 * i) / 6, cy + (50 * i) / 6);
  await page.mouse.up();
  await pacedWait(page, 900);
  moved = await storedBoxes();
}
if (!moved) { ok("the grip on a selected box is reachable", false, "grip not found"); } else {
  console.log(pad("box", 8) + pad("before", 16) + pad("after", 16) + "delta");
  const deltas = [];
  for (let i = 0; i < before.length; i += 1) {
    const d = { dx: moved[i].x - before[i].x, dy: moved[i].y - before[i].y };
    deltas.push(d);
    console.log(pad(i + 1, 8) + pad(`${before[i].x},${before[i].y}`, 16) + pad(`${moved[i].x},${moved[i].y}`, 16) + `${d.dx},${d.dy}`);
  }
  ok("⛔ EVERY selected box moved", deltas.every((d) => Math.abs(d.dx) > 10 || Math.abs(d.dy) > 10),
    deltas.map((d) => `${d.dx},${d.dy}`).join(" · "));
  /* ⛔ AND BY THE SAME DELTA — relative positions preserved EXACTLY. Clamping per box would move
   * them by different amounts, which deforms the arrangement he built. */
  ok("⛔ …by the SAME delta, so the arrangement is preserved exactly",
    deltas.every((d) => d.dx === deltas[0].dx && d.dy === deltas[0].dy));

  /* ⛔ ONE UNDO STEP. N frames for one gesture is not an undo, it is a chore. */
  await page.keyboard.press("Control+z");
  await pacedWait(page, 900);
  const undone = await storedBoxes();
  ok("⛔ ONE Ctrl+Z puts the whole group back",
    undone.every((b, i) => b.x === before[i].x && b.y === before[i].y),
    undone.map((b) => `${b.x},${b.y}`).join(" · "));
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`page errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
