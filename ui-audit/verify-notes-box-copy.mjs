#!/usr/bin/env node
/* verify-notes-box-copy — NEW-1 (2026-11-15): COPYING A BOX WORKS LIKE COPYING A CELL IN EXCEL; COPYING TEXT NEVER COPIES THE BOX.
 *
 * Owner: "it must be obvious when he is copying a BOX as opposed to TEXT, the way Excel shows a copied cell." Click a box's outline → Ctrl+C → moving dashed
 * outline (`data-copied`) until Esc / a new copy / an edit → Ctrl+V makes a NEW box with all its text and formatting. Any text selection — a drag, Shift+End,
 * Ctrl+A — copies TEXT only: no outline, no box on the clipboard, and a paste inserts text.
 *
 * ⛔ WHAT MAKES IT AN INSTRUMENT (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): REAL mouse and REAL keys only (Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+Z / Esc), the system
 * clipboard is read back, every box verdict is read from the STORED document (`__noteEditor.json()`), and the run carries its own known-good arms:
 *   · the box-copy arm must put `data-planyr-boxes` on the clipboard and an outline on the box (else the harness is not pressing what it thinks → VOID);
 *   · the text-copy arms are judged against the box-copy arm: the SAME paste target must give a different, text-only result.
 * Red-proof: run it against a build without the feature (git stash the src/ change). The box-copy arms and the text-copy arms must fail there.
 *
 * Local run: BASE_URL (default http://127.0.0.1:5199) · PW_CHROME (executable) · ONLY=id,id. Exit 0 = pass, 1 = a check failed, 2 = VOID. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const TREE_KEY = "planyr:notes:tree:v1:local"; const PAGE_KEY = (id) => `planyr:notes:page:v1:local:${id}`;
let pass = 0; let fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const voided = (why) => { console.log(`\nVOID: ${why}`); process.exitCode = 2; throw new Error("void"); };
const only = (process.env.ONLY || "").split(",").filter(Boolean);

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-box-copy");
const settle = (ms) => page.waitForTimeout(ms);

const para = (t, marks) => ({ type: "paragraph", content: t ? [{ type: "text", text: t, ...(marks ? { marks } : {}) }] : [] });
const box = (aid, x, y, content, w = 400, extra = {}) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid, fit: false, ...extra }, content });
const A_TEXT = "Alpha line one of the first box"; const B_TEXT = "Bravo text in the second box";
const DOC1 = () => ({ type: "doc", content: [box("a", 40, 100, [para("Heading-ish bold alpha", [{ type: "bold" }]), para(A_TEXT)], 400), box("b", 40, 300, [para(B_TEXT)], 360), para("")] });
const DOC2 = () => ({ type: "doc", content: [box("c", 60, 120, [para("Gamma on page two")], 300), para("")] });

async function seed(d1 = DOC1(), d2 = DOC2()) {
  /* Leave the previous app instance first: a hash-only navigation keeps it alive, and its pagehide flush would write its old document over the seed. */
  await page.goto("about:blank");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, k1, k2, a, b]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [
      { id: "p1", title: "Throwaway one", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
      { id: "p2", title: "Throwaway two", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(k1, JSON.stringify(a)); localStorage.setItem(k2, JSON.stringify(b));
  }, [TREE_KEY, PAGE_KEY("p1"), PAGE_KEY("p2"), d1, d2]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await settle(1200);
}
const doc = () => page.evaluate(() => window.__noteEditor.json());
const boxesOf = (d) => (d.content || []).filter((n) => n.type === "noteAnchor");
const textOf = (n) => JSON.stringify(n.content);
const key = async (k) => { await page.keyboard.press(k); await settle(150); };
const pointIn = (needle) => page.evaluate((n) => {
  const t = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); let node;
  while ((node = t.nextNode())) { const i = node.nodeValue.indexOf(n); if (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 2, y: Math.round(b.top + b.height / 2) }; } }
  return null; }, needle);
const click = async (n) => { const p = await pointIn(n); if (!p) throw new Error(`no "${n}" on the page`); await page.mouse.click(p.x, p.y); await settle(250); };
const enter = async (n) => { await click(n); await settle(700); await click(n); await settle(250); };
const rectOf = (aid) => page.evaluate((id) => { const e = document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }, aid);
/** Click a box's OUTLINE (its top border band, at 30 % — the north strip's own centre is a resize handle) so the box itself is selected. */
async function selectByOutline(aid) {
  const r = await rectOf(aid); if (!r) throw new Error(`no box ${aid}`);
  const at = { x: r.l + r.w * 0.3, y: r.t - 1 };
  await page.mouse.move(at.x, at.y, { steps: 3 }); await settle(120);
  const onBand = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-edge"), [at.x, at.y]);
  if (!onBand) voided(`the outline of box ${aid} is not under the pointer`);
  await page.mouse.click(at.x, at.y); await settle(300);
  const sel = await page.evaluate((id) => document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`)?.getAttribute("data-selected"), aid);
  if (sel !== "1") voided(`clicking the outline of ${aid} did not select the box`);
}
const ants = () => page.evaluate(() => [...document.querySelectorAll('.planyr-anchor[data-copied="1"]')].map((e) => e.getAttribute("data-anchor-id")));
const clip = () => page.evaluate(async () => { const out = {}; try { for (const it of await navigator.clipboard.read()) for (const t of it.types) out[t] = await (await it.getType(t)).text(); } catch (e) { out.err = String(e); } return out; });
const setClip = (k) => page.evaluate(async (c) => { await navigator.clipboard.write([new ClipboardItem(Object.fromEntries(Object.entries(c).filter(([t]) => t.startsWith("text/")).map(([t, v]) => [t, new Blob([v], { type: t })])))]); }, k);
const antsPlaying = () => page.evaluate(() => { const e = document.querySelector('.planyr-anchor[data-copied="1"]'); if (!e) return null; const cs = getComputedStyle(e, "::after"); return { name: cs.animationName, content: cs.content, bg: cs.backgroundImage.slice(0, 40) }; });
const noMarker = (c) => !/data-planyr-boxes|planyr-anchor|data-anchor-|noteAnchor/.test(c["text/html"] || "");
const chipVisible = () => page.locator('[data-testid="note-paste-options"]').first().isVisible().catch(() => false);

const S = [];
const sc = (id, label, fn) => S.push({ id, label, fn });

/* ───────────── BOX COPY ───────────── */
sc("box-copy-ants", "box copy: clicking the outline then Ctrl+C draws the moving dashed outline and puts a BOX on the clipboard", async () => {
  await selectByOutline("a"); await key("Control+c"); await settle(300);
  const c = await clip();
  /* The known-good arm: a box copy MUST leave a box on the clipboard. Its absence is a FAIL (the feature is not there), not a VOID — the harness proved it selected the box. */
  if (!/data-planyr-boxes/.test(c["text/html"] || "")) { ok("a box copy puts a BOX on the system clipboard (known-good arm)", false, (c["text/html"] || "").slice(0, 160)); return; }
  ok("the copied box wears the outline (and only it)", JSON.stringify(await ants()) === '["a"]', JSON.stringify(await ants()));
  const p = await antsPlaying(); ok("the outline really animates (moving, not static)", !!p && p.name === "planyr-ants" && p.content !== "none", JSON.stringify(p));
  ok("system clipboard still holds the CONTENT as plain text (for Word / Excel / email)", /Alpha line one of the first box/.test(c["text/plain"] || ""), JSON.stringify(c["text/plain"]));
});
sc("box-paste-canvas", "box copy → Ctrl+V on empty canvas makes a NEW box with all its text and formatting; the outline stays for the next paste", async () => {
  const before = boxesOf(await doc());
  await selectByOutline("a"); await key("Control+c"); await settle(300);
  await key("Escape"); await key("Escape");                       // deselect; the outline is gone with Esc — copy again so the clipboard + outline are both live
  await selectByOutline("a"); await key("Control+c"); await settle(250);
  await page.mouse.dblclick(1000, 700); await settle(400);       // double-click on blank paper: arms a caret there
  if (!(await page.locator('[data-testid="note-pending-caret"]').count())) voided("the double-click on blank paper armed no caret — the harness is not placing where it thinks");
  await key("Control+v"); await settle(1000);
  const d = boxesOf(await doc());
  ok("one new box", d.length === before.length + 1, `${before.length} → ${d.length}`);
  const src = d.find((b) => b.attrs.aid === "a"); const nb = d.find((b) => !before.some((o) => o.attrs.aid === b.attrs.aid));
  ok("the new box carries ALL the text and marks (bold line + normal line)", !!nb && textOf(nb) === textOf(src), nb ? textOf(nb) : "none");
  ok("the new box keeps the source's width, height rule and fit", !!nb && nb.attrs.w === src.attrs.w && nb.attrs.h === src.attrs.h && nb.attrs.fit === src.attrs.fit, JSON.stringify(nb?.attrs));
  ok("the source box is untouched (position and words)", src.attrs.x === 40 && src.attrs.y === 100 && textOf(src) === textOf(before.find((b) => b.attrs.aid === "a")));
  ok("it landed where he clicked on blank paper (not at the source)", !!nb && (Math.abs(nb.attrs.x - 40) > 200 || Math.abs(nb.attrs.y - 100) > 200), JSON.stringify(nb?.attrs));
  ok("the new box is not inside another box", d.every((b) => !JSON.stringify(b.content).includes("noteAnchor")));
  ok("the outline stays on the SOURCE after a paste (Excel: paste again)", JSON.stringify(await ants()) === '["a"]', JSON.stringify(await ants()));
  await key("Control+z"); await settle(500);
  ok("ONE Ctrl+Z removes the pasted box", boxesOf(await doc()).length === before.length, String(boxesOf(await doc()).length));
});
sc("box-paste-offset", "box copy → Ctrl+V with nothing armed lands offset from the source, and each repeat steps further", async () => {
  await selectByOutline("a"); await key("Control+c"); await settle(250);
  await key("Control+v"); await settle(700);
  const first = boxesOf(await doc()).filter((b) => b.attrs.aid !== "a" && b.attrs.aid !== "b");
  ok("one new box, down and right of the source", first.length === 1 && first[0].attrs.x > 40 && first[0].attrs.y > 100 && first[0].attrs.x - 40 < 80, JSON.stringify(first.map((b) => b.attrs)));
  await selectByOutline("a"); await key("Control+v"); await settle(700);
  const second = boxesOf(await doc()).filter((b) => b.attrs.aid !== "a" && b.attrs.aid !== "b");
  ok("a second paste of the SAME copy steps further along", second.length === 2 && new Set(second.map((b) => `${b.attrs.x},${b.attrs.y}`)).size === 2, JSON.stringify(second.map((b) => b.attrs)));
});
sc("box-paste-into-box", "box copy → Ctrl+V with the caret inside ANOTHER box's text lands as its own new box; that box's text is untouched", async () => {
  await selectByOutline("a"); await key("Control+c"); await settle(300);
  await key("Escape"); await key("Escape");
  const bBefore = boxesOf(await doc()).find((b) => b.attrs.aid === "b");
  await enter(B_TEXT); await key("End"); await key("Control+v"); await settle(1000);
  const d = boxesOf(await doc());
  const bNow = d.find((b) => b.attrs.aid === "b");
  ok("a new box exists (3 boxes)", d.length === 3, String(d.length));
  ok("box B's own words are exactly as they were", textOf(bNow) === textOf(bBefore), textOf(bNow));
  ok("the pasted box is not inside box B", d.every((b) => !JSON.stringify(b.content).includes("noteAnchor")));
  ok("the paste-options tab is offered", await chipVisible());
  // the text-only version
  await key("Control"); await settle(400); await key("t"); await settle(900);
  const d2 = boxesOf(await doc());
  ok("Keep Text Only: the pasted box is gone again (2 boxes)", d2.length === 2, String(d2.length));
  const b2 = d2.find((b) => b.attrs.aid === "b");
  ok("…and the words went in at the caret in box B", JSON.stringify(b2.content).includes(A_TEXT) && JSON.stringify(b2.content).includes(B_TEXT), textOf(b2));
  await key("Control+z"); await settle(600);
  const d3 = boxesOf(await doc());
  ok("ONE Ctrl+Z undoes the pick (back to the pasted box)", d3.length === 3 && textOf(d3.find((b) => b.attrs.aid === "b")) === textOf(bBefore), String(d3.length));
});
sc("box-ants-end", "the outline ends with Esc, with a new copy, or with an edit — and with nothing else", async () => {
  await selectByOutline("a"); await key("Control+c"); await settle(250);
  ok("starts on A", JSON.stringify(await ants()) === '["a"]');
  await key("Escape"); ok("Esc clears it", (await ants()).length === 0, JSON.stringify(await ants()));
  await selectByOutline("a"); await key("Control+c"); await settle(250);
  await key("Escape"); await settle(100);
  await selectByOutline("b"); await key("Control+c"); await settle(250);
  ok("a NEW copy moves it to the new box only", JSON.stringify(await ants()) === '["b"]', JSON.stringify(await ants()));
  await enter(B_TEXT); await key("End"); await page.keyboard.type(" and more"); await settle(400);
  ok("an edit (typing) clears it", (await ants()).length === 0, JSON.stringify(await ants()));
  // mere selection / hover / scrolling leaves it alone
  await key("Escape"); await key("Escape");
  await selectByOutline("a"); await key("Control+c"); await settle(250);
  await page.mouse.move(900, 500); await page.mouse.move(700, 600); await settle(300);
  ok("hovering and moving the mouse leave it alone", JSON.stringify(await ants()) === '["a"]', JSON.stringify(await ants()));
});
sc("box-cut", "Ctrl+X on a selected box cuts it (one Ctrl+Z restores it) and Ctrl+V brings it back as a new box", async () => {
  const before = boxesOf(await doc()); const aBefore = before.find((b) => b.attrs.aid === "a");
  await selectByOutline("a"); await key("Control+x"); await settle(500);
  ok("the box is gone", boxesOf(await doc()).length === before.length - 1);
  ok("no outline is left behind (nothing to outline)", (await ants()).length === 0);
  await key("Control+z"); await settle(600);
  const back = boxesOf(await doc()).find((b) => b.attrs.aid === "a");
  ok("ONE Ctrl+Z restores it exactly (position and words)", !!back && back.attrs.x === 40 && back.attrs.y === 100 && textOf(back) === textOf(aBefore), JSON.stringify(back?.attrs));
  await selectByOutline("a"); await key("Control+x"); await settle(400);
  await key("Control+v"); await settle(800);
  const after = boxesOf(await doc());
  ok("Ctrl+V after the cut brings back one box with the same words", after.length === before.length && after.some((b) => textOf(b) === textOf(aBefore)), String(after.length));
});
sc("box-cross-page", "a copied box pastes onto ANOTHER page, in place, and the clipboard text is plain text", async () => {
  await selectByOutline("a"); await key("Control+c"); await settle(300);
  const c = await clip();
  await page.locator('[data-testid="notes-row-p2"]').first().click(); await settle(1500);
  await page.waitForSelector('[data-testid="note-body"]');
  const before = boxesOf(await doc());
  await page.mouse.click(1000, 700); await settle(300);          // a press on the page itself (focus leaves the rail row), as anyone pasting would
  await key("Control+v"); await settle(1000);
  const d = boxesOf(await doc());
  ok("page two gained exactly one box", d.length === before.length + 1, `${before.length} → ${d.length}`);
  const nb = d.find((b) => !before.some((o) => o.attrs.aid === b.attrs.aid));
  ok("it carries the bold line + normal line", !!nb && JSON.stringify(nb.content).includes(A_TEXT) && JSON.stringify(nb.content).includes('"bold"'), nb ? textOf(nb) : "none");
  ok("it landed in place (same x and y as on the source page)", !!nb && nb.attrs.x === 40 && nb.attrs.y === 100, JSON.stringify(nb?.attrs));
  ok("the clipboard's plain-text half is plain text (no markup)", !/[<>]/.test(c["text/plain"] || "") && /Alpha line one/.test(c["text/plain"] || ""), JSON.stringify(c["text/plain"]));
});

/* ───────────── TEXT COPY ───────────── */
const textSelections = {
  "ctrl-a": async () => { await key("Control+a"); },
  "partial": async () => { await key("Home"); await page.keyboard.down("Shift"); await key("End"); await page.keyboard.up("Shift"); },
  "drag-all": async () => {
    const r = await rectOf("a");
    await page.mouse.move(r.l + 18, r.t + r.h - 14); await page.mouse.down(); await page.mouse.move(r.l + r.w - 6, r.t + r.h - 14, { steps: 8 }); await page.mouse.up(); await settle(200);
  },
};
for (const [id, pick] of Object.entries(textSelections)) {
  sc(`text-${id}`, `text copy (${id}): copies TEXT ONLY — no outline, no box on the clipboard, a paste inserts text`, async () => {
    await enter(A_TEXT); await pick(); await settle(150);
    await key("Control+c"); await settle(350);
    const c = await clip();
    ok("no outline anywhere", (await ants()).length === 0, JSON.stringify(await ants()));
    ok("the clipboard carries no box (no marker, no box frame, no position)", noMarker(c), (c["text/html"] || "").slice(0, 200));
    ok("the words are on the clipboard", /Alpha line one/.test(c["text/plain"] || ""), JSON.stringify(c["text/plain"]));
    const keep = { "text/html": c["text/html"], "text/plain": c["text/plain"] };
    // (1) inside another box
    await key("Escape"); await key("Escape");
    const boxesBefore = boxesOf(await doc()).length;
    await enter(B_TEXT); await key("End"); await key("Control+v"); await settle(900);
    const d = boxesOf(await doc());
    ok("pasted inside another box: NO new box was made", d.length === boxesBefore, `${boxesBefore} → ${d.length}`);
    ok("…the text went into that box", JSON.stringify(d.find((b) => b.attrs.aid === "b").content).includes("Alpha line one"));
    ok("…and nothing is nested", d.every((b) => !JSON.stringify(b.content).includes("noteAnchor")));
    ok("no outline after the paste either", (await ants()).length === 0);
    // (2) empty canvas (fresh page; the same clipboard)
    await seed();
    await setClip(keep);
    const r0 = boxesOf(await doc()).length;
    await page.mouse.dblclick(1000, 700); await settle(400);
    await key("Control+v"); await settle(1000);
    const e = boxesOf(await doc());
    const nb = e.find((b) => !["a", "b"].includes(b.attrs.aid));
    ok("pasted on empty canvas: the text sits in ONE new box that holds just the text", e.length === r0 + 1 && !!nb && JSON.stringify(nb.content).includes("Alpha line one"), `${r0} → ${e.length}`);
    ok("…made fresh (default size / placement), NOT a copy of the source box (source is 400 wide)", !!nb && nb.attrs.w !== 400, JSON.stringify(nb?.attrs));
    ok("…and no outline", (await ants()).length === 0);
  });
}

/* ── run ── */
try {
  for (const s of S) {
    if (only.length && !only.includes(s.id)) continue;
    console.log(`\n— ${s.label}`);
    try { await seed(); await s.fn(); } catch (e) { if (/void/i.test(e.message)) throw e; fail++; console.log(`  ✗ scenario ran: ${String(e.message || e).slice(0, 260)}`); }
  }
  ok("page errors during the run", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (e) { if (e.message !== "void") { fail++; console.log("  ✗ run aborted:", String(e).slice(0, 300)); } }
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode || (fail ? 1 : 0));
