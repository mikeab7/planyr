/* verify-notes-context-menu — THE RIGHT-CLICK MENU IS WORD'S, AND NOTHING DESTRUCTIVE SITS UNDER
 * THE POINTER (B539651, owner instruction 2026-08-14).
 *
 * ⛔ HIS WORDS, both halves: *"the delete option shouldn't just be shown, like, anytime I click on
 * the box… I should only be able to use the keystroke to delete or a right click and then delete
 * option. And then the right click should have the normal formatting option, like it's a Word
 * document or an email where I can change text, I can underline, make it the exact same format.
 * Just copy Word."*
 *
 * ⛔ EVERY PRESS IS A REAL PRESS AND EVERY VERDICT IS THE STORED DOCUMENT. A menu is exactly the
 * kind of surface that looks right and does nothing: the items render, the click "works", and the
 * command ran against a selection the menu had already stolen. So each formatting row is driven
 * with a real right-click on real selected text and then judged on `localStorage` — not on the
 * button's own `aria-pressed`, which would be the menu marking its own homework.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "verify-notes-context-menu");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function seed() {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Menu", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Underline this sentence please" }] },
        { type: "noteAnchor", attrs: { x: 620, y: 200, w: 200 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "a placed box" }] }] },
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

const storedDoc = () => page.evaluate((k) => localStorage.getItem(k), `${PAGE_PREFIX}p1`);

/** Marks present anywhere in the STORED document — the honest read of "did the command land". */
const storedMarks = async () => {
  const raw = await storedDoc();
  const out = new Set();
  const walk = (n) => {
    if (!n) return;
    for (const m of n.marks || []) out.add(m.type);
    (n.content || []).forEach(walk);
  };
  try { walk(JSON.parse(raw)); } catch (_) { /* unreadable */ }
  return [...out];
};
const storedTypes = async () => {
  const raw = await storedDoc();
  const out = new Set();
  const walk = (n) => { if (!n) return; if (n.type) out.add(n.type); (n.content || []).forEach(walk); };
  try { walk(JSON.parse(raw)); } catch (_) { /* unreadable */ }
  return [...out];
};

/** Select a run of real text by double-clicking a word, then right-click ON it. */
async function selectWordAndOpenMenu(word) {
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
  await page.mouse.dblclick(spot.x, spot.y);          // selects the word
  await pacedWait(page, 200);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  await pacedWait(page, 350);
  return page.locator('[data-testid="note-doc-menu"]').count().then((c) => c > 0);
}

console.log("\n1 · NOTHING DESTRUCTIVE APPEARS JUST BECAUSE A BOX IS SELECTED");
await seed();
await page.locator(".planyr-anchor").first().click();
await pacedWait(page, 400);
ok("the box IS selected — the ring is on", await page.locator('.planyr-anchor[data-selected="1"]').count() > 0);
ok("⛔ and there is NO delete × anywhere on it", await page.locator('[data-testid="note-anchor-delete"]').count() === 0);
ok("…while the resize handle IS there — the non-destructive control stays",
  await page.locator('[data-testid="note-anchor-size"]').count() > 0);

console.log("\n2 · THE KEYSTROKE STILL DELETES (the route he explicitly kept)");
const beforeKey = await storedTypes();
await page.keyboard.press("Delete");
await pacedWait(page, 900);
const afterKey = await storedTypes();
ok("Delete removes the selected box", beforeKey.includes("noteAnchor") && !afterKey.includes("noteAnchor"),
  `${beforeKey.includes("noteAnchor")} → ${afterKey.includes("noteAnchor")}`);

console.log("\n3 · THE DOCUMENT MENU IS WORD'S");
await seed();
const opened = await selectWordAndOpenMenu("sentence");
ok("a real right-click on selected text opens the menu", opened);
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="note-menu-"]')]
  .map((b) => b.getAttribute("data-testid").replace("note-menu-", "")));
console.log(`    rows: ${rows.join(" · ")}`);
/* ⛔ AMENDED (NEW-MINI-TOOLBAR, owner instruction 2026-08-17). The menu is now Word's TWO menus:
 * a horizontal formatting STRIP above a short vertical list of COMMANDS. So the formatting rows
 * are still asserted — they moved, they did not go — and the three paste modes are now under a
 * `paste` submenu rather than being three top-level rows, which is what he asked for. Everything
 * here is still enumerated from the DOM, so a control that quietly disappeared still fails. */
for (const want of ["cut", "copy", "paste", "bold", "italic", "underline", "bullets", "numbering", "indent", "outdent", "link"]) {
  ok(`…offers ${want}`, rows.includes(want));
}
await page.locator('[data-testid="note-menu-paste"]').first().hover();
await pacedWait(page, 300);
const pasteModes = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-menu-paste-sub"] [data-testid^="note-menu-"]')]
  .map((b) => b.getAttribute("data-testid").replace("note-menu-", "")));
ok("⛔ …and the three paste modes live under it, not as three top-level rows",
  pasteModes.length === 3 && pasteModes.includes("paste-plain"), pasteModes.join(","));
ok("⛔ …and the DOCUMENT menu offers no Delete-this-box", !rows.includes("delete-box"));

console.log("\n4 · AN ITEM ACTS ON THE REAL SELECTION — judged on the STORED document");
ok("no underline in the document to begin with", !(await storedMarks()).includes("underline"));
await page.locator('[data-testid="note-menu-underline"]').click();
await pacedWait(page, 900);
ok("⛔ Underline from the menu reaches the stored document", (await storedMarks()).includes("underline"),
  (await storedMarks()).join(","));

await seed();
if (await selectWordAndOpenMenu("sentence")) {
  await page.locator('[data-testid="note-menu-bullets"]').click();
  await pacedWait(page, 900);
  ok("⛔ Bullets from the menu reaches the stored document", (await storedTypes()).includes("bulletList"),
    (await storedTypes()).join(","));
}

console.log("\n5 · THE BOX MENU IS THE DOCUMENT'S PLUS ITS OWN ACTION");
await seed();
const box = await page.locator(".planyr-anchor").first().boundingBox();
await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), { button: "right" });
await pacedWait(page, 400);
const boxRows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="note-menu-"]')]
  .map((b) => b.getAttribute("data-testid").replace("note-menu-", "")));
ok("right-clicking a box opens a menu", boxRows.length > 0);
ok("⛔ …which DOES offer Delete this box", boxRows.includes("delete-box"));
ok("…and still offers the formatting items, because it is still text",
  ["bold", "underline", "bullets"].every((r) => boxRows.includes(r)));
ok("it is marked as the box menu, so the two are distinguishable",
  await page.locator('[data-menu-kind="box"]').count() > 0);

const beforeDel = await storedTypes();
await page.locator('[data-testid="note-menu-delete-box"]').click();
await pacedWait(page, 900);
const afterDel = await storedTypes();
ok("⛔ Delete this box removes it from the STORED document",
  beforeDel.includes("noteAnchor") && !afterDel.includes("noteAnchor"));

/* ⛔ AND IT IS UNDOABLE, which is the trap B421489 left behind: a destructive control that
 * cannot be taken back is worse than one that is missing. The focus has to come home. */
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ …and Ctrl+Z brings it back — focus came home after the delete",
  (await storedTypes()).includes("noteAnchor"));

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`page errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
