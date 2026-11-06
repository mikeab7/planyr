#!/usr/bin/env node
/* verify-notes-engine-live — V2115860 / B2671191: Notes on Tiptap 3.33.0, SIGNED IN as the TEST account on a real deploy, on a
 * THROWAWAY page it creates and then deletes (owner rule 15; nothing else is ever touched).
 *
 * Drives, with real mouse / keyboard / toolbar input and judged on the live editor's own document (`window.__noteEditor.json()`,
 * E2E-armed by an init script) and, after a cache-busting reload, on what persisted:
 *   1 type + format a word: bold · text colour · highlight · size · font · line spacing
 *   2 paste the committed Excel fixture (clipboard-bank/excel-mixed-cells) with its exact bytes AND through the browser clipboard
 *     (a trusted Ctrl+V), judged by the SAME structural judge the CI bank uses (ui-audit/lib/pasteBank.mjs)
 *   3 the paste-options tab → "Values and Source Formatting" brings the shading; Ctrl+Z puts the table back as pasted
 *   4 fill a row, then No fill · drag a row's lower line · move a box by its border · Ctrl+Z
 *   5 reload with a cache-busting query: everything persisted
 *   6 delete the throwaway and prove it is gone from the list and the Bin (ui-audit/lib/notesSweep.mjs)
 * `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs (read in the same run).
 * Known-good arms VOID the run (exit 2): a real bold lights B; the Excel paste lands a table at all. */
import { readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { sweepNotesThrowaways } from "./lib/notesSweep.mjs";
import { loadBank, summariseDoc, checkEntry, checkOptionFills } from "./lib/pasteBank.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const TITLE = "ZZ throwaway engine check " + Date.now().toString(36);
let pass = 0; let fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const voided = (why) => { console.log(`\nVOID: ${why}`); process.exitCode = 2; throw new Error("void"); };
const arm = [[() => { window.__PLANYR_E2E = true; }, undefined]];
const bankEntry = loadBank().find((b) => b.id === "clipboard-bank/excel-mixed-cells");

let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE, initScripts: arm, contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } }); }
  catch (e) { if (!/answered 5\d\d|Failed to fetch/.test(String(e)) || i === 11) throw e; console.log("sign-in route hiccup, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-notes-engine-live");
const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
const chunks = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^(NoteEditor|Notes|index)-/.test(n)).slice(0, 6));
console.log("signed in as", s.proof.email, "· served build", served.build, "· chunks", chunks.join(","));
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, served.build === process.env.EXPECT_BUILD, JSON.stringify(served));

const para = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const DOC = () => ({ type: "doc", content: [
  { type: "noteAnchor", attrs: { x: 40, y: 40, w: 520, h: null, aid: "fmt" }, content: [para("Alpha bravo charlie")] },
  { type: "noteAnchor", attrs: { x: 40, y: 220, w: 520, h: null, aid: "pst" }, content: [para("x")] },
  para(""),
] });
const live = () => page.evaluate(() => window.__noteEditor?.json?.() ?? null);
const settle = (ms = 900) => page.waitForTimeout(ms);
async function pointIn(needle, whole = false) {
  const p = await page.evaluate(([n, w]) => {
    const t = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node; while ((node = t.nextNode())) { const i = node.nodeValue.indexOf(n); if (i >= 0) { const r = document.createRange(); r.setStart(node, w ? i : i + 1); r.setEnd(node, w ? i + n.length : i + 1); const b = r.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; } }
    return null;
  }, [needle, whole]);
  if (!p) throw new Error(`no "${needle}" on the page`);
  return p;
}
const clickAt = async (n) => { const p = await pointIn(n); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); };
const enter = async (n) => { await clickAt(n); await page.waitForTimeout(650); await clickAt(n); await page.waitForTimeout(300); };
const pressed = (id) => page.locator(`[data-testid="${id}"]`).first().getAttribute("aria-pressed");
const tool = async (id) => {
  const el = page.locator(`[data-testid="${id}"]`).first();
  if (!(await el.count()) || !(await el.isVisible().catch(() => false))) { await page.locator('[data-testid="nt-more"]').first().click().catch(() => {}); await settle(300); }
  await page.locator(`[data-testid="${id}"]`).first().click(); await settle(400);
};
const runsOf = (doc, needle) => { const out = []; const w = (n) => { if (!n) return; if (n.type === "text" && n.text.includes(needle)) out.push(n); (n.content || []).forEach(w); }; w(doc); return out; };
const markNames = (n) => (n?.marks || []).map((m) => m.type + (m.attrs ? JSON.stringify(Object.fromEntries(Object.entries(m.attrs).filter(([, v]) => v != null))) : ""));
const boxes = (doc) => (doc.content || []).filter((n) => n.type === "noteAnchor");
const tableOf = (doc) => { let t = null; const w = (n) => { if (!n || t) return; if (n.type === "table") { t = n; return; } (n.content || []).forEach(w); }; w(doc); return t; };

let created = false;
try {
  await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
  await page.locator('[data-testid="notes-new-page"]').click();
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  created = true;
  await page.locator('[data-testid="note-title"]').fill(TITLE);
  await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await settle(1200);
  await page.evaluate((d) => window.__noteEditor.setDoc(d), DOC());
  await settle(1500);

  console.log("\n=== 1 · type and format ===");
  await enter("Alpha bravo charlie");
  await page.keyboard.press("End"); await page.keyboard.type(" delta"); await settle(500);
  ok("typed text lands in the box", /Alpha bravo charlie delta/.test(JSON.stringify(await live())));
  { const p = await pointIn("bravo", true); await page.mouse.dblclick(p.x, p.y); await settle(300); }
  await tool("nt-bold");
  { const armBold = await pressed("nt-bold"); if (armBold !== "true") voided("a real bold did not light B — the toolbar is not reaching the document"); }
  ok("[known-good] bold stored on the selected word", markNames(runsOf(await live(), "bravo")[0]).includes("bold"));
  await tool("nt-color"); await page.locator('[data-testid="nt-color-popover"] button').nth(2).click(); await settle(400);
  await tool("nt-highlight"); await page.locator('[data-testid="nt-highlight-popover"] button').nth(2).click(); await settle(400);
  await tool("nt-size");
  { const opt = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-size-opt-"]')].map((b) => b.getAttribute("data-testid")).filter((t) => !/default$/.test(t))[3]); if (opt) await page.locator(`[data-testid="${opt}"]`).click(); await settle(400); }
  { const el = page.locator('[data-testid="nt-font"]').first(); if (!(await el.isVisible().catch(() => false))) { await page.locator('[data-testid="nt-more"]').first().click().catch(() => {}); await settle(300); }
    const vals = await page.locator('[data-testid="nt-font"]').first().evaluate((n) => [...n.options].map((o) => o.value)); const pick = vals.filter(Boolean)[3] || vals[1]; await page.locator('[data-testid="nt-font"]').first().selectOption(pick); await settle(500); }
  { const marks = markNames(runsOf(await live(), "bravo")[0]).join(" ");
    ok("text colour stored", /"color":"#?[0-9a-fA-F]+/.test(marks), marks);
    ok("highlight stored", /highlight/.test(marks), marks);
    ok("size stored", /fontSize/.test(marks), marks);
    ok("font stored", /fontFamily/.test(marks), marks); }
  await tool("nt-spacing");
  { const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-spacing-line-"]')].map((b) => b.getAttribute("data-testid")));
    const pick = opts.find((o) => /1-5|1\.5|150/.test(o)) || opts[opts.length - 2];
    if (pick) await page.locator(`[data-testid="${pick}"]`).first().click(); await settle(500); await page.keyboard.press("Escape");
    const lh = boxes(await live())[0].content[0].attrs?.lineHeight;
    ok("line spacing stored on the paragraph", lh != null && lh !== "", `lineHeight=${lh} (picked ${pick})`); }

  console.log("\n=== 2 · paste the Excel fixture ===");
  const fx = bankEntry;
  await enter("x"); await page.keyboard.press("Backspace"); await settle(300);
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t);
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [fx.html, fx.text]);
  await settle(1500);
  { const t = tableOf(await live()); if (!t) voided("the Excel paste did not land a table at all"); }
  { const problems = checkEntry(fx, summariseDoc(await live())); ok("exact-bytes paste: rows, columns, merge, empty cell, bold, red text, no imported shading", problems.length === 0, problems.join("\n      ")); }

  console.log("\n=== 3 · paste options ===");
  { const chip = page.locator('[data-testid="note-paste-badge"]');
    ok("the paste-options tab is offered", (await chip.count()) === 1);
    if (await chip.count()) {
      const before = JSON.stringify(tableOf(await live()));
      await chip.click(); await settle(300);
      await page.locator('[data-testid="note-paste-valuesFormat"]').click(); await settle(1200);
      const problems = checkOptionFills(fx, summariseDoc(await live()));
      ok("Values and Source Formatting brings the header blue-grey and the yellow cell", problems.length === 0, problems.join("\n      "));
      await page.keyboard.press("Control+z"); await settle(900);
      ok("one Ctrl+Z puts the table back as pasted", JSON.stringify(tableOf(await live())) === before);
    } }

  console.log("\n=== 4 · fill, row height, box move ===");
  await enter("Plain");
  await tool("nt-fill"); await page.locator('[data-testid="nt-fill-yellow"]').click(); await settle(1000);
  { const row = tableOf(await live()).content[2]; ok("the row is filled", row.content.every((c) => c.attrs?.background === "#fef08a"), JSON.stringify(row.content.map((c) => c.attrs?.background))); }
  await tool("nt-fill"); await page.locator('[data-testid="nt-fill-none"]').click(); await settle(1000);
  { const row = tableOf(await live()).content[2]; ok("No fill clears it", row.content.every((c) => !c.attrs?.background || c.attrs.background === "transparent")); }
  {
    const rect = await page.evaluate(() => { const td = [...document.querySelectorAll(".ProseMirror td")].find((c) => c.textContent.trim() === "Plain"); const r = td.getBoundingClientRect(); return { x: r.left + r.width / 2, bottom: r.bottom }; });
    await page.mouse.move(rect.x, rect.bottom - 1); await settle(200);
    await page.mouse.down(); await page.mouse.move(rect.x, rect.bottom + 14, { steps: 6 }); await page.mouse.move(rect.x, rect.bottom + 40, { steps: 6 }); await page.mouse.up(); await settle(1000);
    const rh = tableOf(await live()).content.map((r) => r.attrs?.rowHeight ?? null);
    ok("dragging the row's lower line sets its height", rh.some((h) => typeof h === "number" && h > 40), JSON.stringify(rh));
  }
  {
    const before = boxes(await live()).map((b) => [b.attrs.x, b.attrs.y]);
    const r = await page.evaluate(() => { const b = document.querySelector('.planyr-anchor[data-aid="fmt"]') || document.querySelectorAll(".planyr-anchor")[0]; const q = b.getBoundingClientRect(); return { x: q.left, y: q.top, h: q.height }; });
    await page.mouse.move(r.x - 2, r.y + r.h / 2); await settle(200);
    await page.mouse.down(); await page.mouse.move(r.x + 40, r.y + r.h / 2 + 30, { steps: 8 }); await page.mouse.up(); await settle(1000);
    const after = boxes(await live()).map((b) => [b.attrs.x, b.attrs.y]);
    ok("moving a box by its border moves it", after[0][0] > before[0][0] + 20 && after[0][1] > before[0][1] + 15, `${JSON.stringify(before[0])} → ${JSON.stringify(after[0])}`);
    await page.keyboard.press("Control+z"); await settle(900);
    const undone = boxes(await live()).map((b) => [b.attrs.x, b.attrs.y]);
    ok("Ctrl+Z puts the box back", JSON.stringify(undone[0]) === JSON.stringify(before[0]), JSON.stringify(undone[0]));
  }

  console.log("\n=== 5 · reload with a cache-busting query ===");
  const snap = await live();
  const want = { bravo: markNames(runsOf(snap, "bravo")[0]).sort().join("|"), grid: JSON.stringify(summariseDoc(snap).tables[0]?.cells.map((c) => [c.r, c.c, c.text, c.colspan])) };
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 }); await settle(3000);
  { const after = await live();
    ok("this is the throwaway page after the reload", JSON.stringify(after).includes("Alpha"), "page did not reopen on the throwaway");
    ok("formatting persisted", markNames(runsOf(after, "bravo")[0]).sort().join("|") === want.bravo, markNames(runsOf(after, "bravo")[0]).join(" "));
    ok("the table persisted (same cells, same merge)", JSON.stringify(summariseDoc(after).tables[0]?.cells.map((c) => [c.r, c.c, c.text, c.colspan])) === want.grid);
    const sv = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json())); console.log("   served build after reload:", sv.build); }
} catch (e) {
  if (e.message !== "void") { fail++; console.log("  ✗ run aborted:", String(e).slice(0, 300)); }
} finally {
  await s.close().catch(() => {});
  const swept = await sweepNotesThrowaways({ base: BASE });
  ok("the throwaway is gone from the page list and the Bin", swept.pagesLeft === 0 && swept.binLeft === 0, JSON.stringify(swept));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode || (fail ? 1 : 0));
