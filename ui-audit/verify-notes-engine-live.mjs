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
 *   4 fill a row, then No fill · drag a row's lower line
 *   B move a box by its TOP and LEFT border + Ctrl+Z at three stages — before the paste (after formatting), after the paste options,
 *     and after fill + row drag. Every one of those arms MUST be reached (a "not exercised" arm fails the run: V2115860's gap was exactly
 *     an arm that was skipped and passed quietly). (Not between the paste and its options tab: any other action ends that offer, as
 *     in Word.) Then one last border move that is KEPT, whose position must survive the reload
 *   5 reload with a cache-busting query: everything persisted (formatting, table, and that box position)
 *   7 B2671237 / B2671238: nothing draws on top of anything after an edit — stacked one-line boxes, then the owner's paste (a REAL copy from one box,
 *     Ctrl+V into another) and a representative set of the other box-changing actions (ui-audit/lib/notesOverlap.mjs); every box's rendered
 *     rectangle after each action, after ONE Ctrl+Z and (for the owner's case) after a cache-busting reload; a box nested in a box fails
 *   6 delete the throwaway and prove it is gone from the list and the Bin (ui-audit/lib/notesSweep.mjs)
 * `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs (read in the same run).
 * Known-good arms VOID the run (exit 2): a real bold lights B; the Excel paste lands a table at all. */
import { readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { sweepNotesThrowaways } from "./lib/notesSweep.mjs";
import { loadBank, summariseDoc, checkEntry, checkOptionFills } from "./lib/pasteBank.mjs";
import { runSweep, readRects } from "./lib/notesOverlap.mjs";

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
  { type: "noteAnchor", attrs: { x: 40, y: 150, w: 520, h: null, aid: "fmt" }, content: [para("Alpha bravo charlie")] },
  { type: "noteAnchor", attrs: { x: 40, y: 330, w: 520, h: null, aid: "pst" }, content: [para("x")] },
  para(""),
] });
const live = () => page.evaluate(() => window.__noteEditor?.json?.() ?? null);
const settle = (ms = 900) => page.waitForTimeout(ms);
const dump = async (tag) => { if (process.env.DBG) { const d = await live(); console.log("   [dbg]", tag, "bravo:", markNames(runsOf(d, "bravo")[0]).join(" ") || "NO MARKS", JSON.stringify((d?.content || []).map((n) => n.type === "noteAnchor" ? [n.attrs.aid, n.attrs.x, n.attrs.y, JSON.stringify(n.content).slice(0, 220)] : n.type))); } };
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
const markNames = (n) => (n?.marks || []).map((m) => { const a = Object.fromEntries(Object.entries(m.attrs || {}).filter(([, v]) => v != null)); return m.type + (Object.keys(a).length ? JSON.stringify(a) : ""); });
const boxes = (doc) => (doc.content || []).filter((n) => n.type === "noteAnchor");
const tableOf = (doc) => { let t = null; const w = (n) => { if (!n || t) return; if (n.type === "table") { t = n; return; } (n.content || []).forEach(w); }; w(doc); return t; };

const posOf = async () => { const b = boxes(await live()).find((n) => n.attrs.aid === "fmt"); return b ? [b.attrs.x, b.attrs.y] : null; };
const exercisedArms = [];
async function boxMoveTest(label) {
  const pos = posOf;
  if (!(await pos())) voided("the first box is missing before the move test");

    for (const side of ["top", "left"]) {
      const start = await pos();
      const r = await page.evaluate(() => { const b = [...document.querySelectorAll(".planyr-anchor")].find((a) => a.textContent.includes("Alpha")); const q = b.getBoundingClientRect(); return { l: q.left, t: q.top, w: q.width, h: q.height }; });
      const at = side === "top" ? { x: r.l + r.w / 2, y: r.t - 1 } : { x: r.l - 2, y: r.t + r.h / 2 };
      await page.mouse.move(at.x, at.y, { steps: 4 }); await settle(200);
      const onBand = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-edge"), [at.x, at.y]);
      if (!onBand && process.env.DBG) console.log("   [dbg] covered by", JSON.stringify(await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const chain = []; for (let n = e; n && chain.length < 6; n = n.parentElement) chain.push(`${n.tagName}.${(n.className || "").toString().slice(0, 40)}[${n.getAttribute("data-testid") || ""}]`); const a = [...document.querySelectorAll(".planyr-anchor")].map((q) => { const b = q.getBoundingClientRect(); return [q.textContent.slice(0, 12), Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }); return { at: [x, y], chain, anchors: a, vp: [innerWidth, innerHeight] }; }, [at.x, at.y])));
      if (!onBand) { console.log(`   • ${label}: ${side} band NOT under the pointer (covered by other chrome) — arm not exercised, not scored`); exercisedArms.push(`${label}/${side}:no`); continue; }
      exercisedArms.push(`${label}/${side}:yes`);
      if (process.env.DBG) console.log("   [dbg] press target", label, side, JSON.stringify(await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return { cls: e?.className?.toString().slice(0, 60), tag: e?.tagName, edge: !!e?.closest?.(".planyr-anchor-edge"), cursor: e ? getComputedStyle(e).cursor : null, active: document.activeElement?.className?.toString().slice(0, 40), sel: document.querySelectorAll('[data-selected="1"]').length }; }, [at.x, at.y])));
      await page.mouse.down(); await page.mouse.move(at.x + 40, at.y + 30, { steps: 8 }); await page.mouse.move(at.x + 40, at.y + 30, { steps: 2 }); await page.mouse.up(); await settle(1000);
      const moved = await pos();
      ok(`${label}: moving a box by its ${side} border moves it (X and Y)`, moved[0] > start[0] + 20 && moved[1] > start[1] + 15, `${JSON.stringify(start)} → ${JSON.stringify(moved)}`);
      await page.keyboard.press("Control+z"); await settle(900);
      ok(`${label}: Ctrl+Z puts the box back (${side})`, JSON.stringify(await pos()) === JSON.stringify(start), JSON.stringify(await pos()));
    }
}

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
  await dump("typed");
  ok("typed text lands in the box", /Alpha bravo charlie delta/.test(JSON.stringify(await live())));
  /* the word is selected with real keys (Home, Ctrl+Right, Ctrl+Shift+Right): a double-click on a word is timing-dependent */
  await page.keyboard.press("Home"); await page.keyboard.press("Control+ArrowRight"); await page.keyboard.press("Control+Shift+ArrowRight"); await settle(300);
  { const sel = await page.evaluate(() => window.__noteEditor.selection()); if (!sel || sel.empty) voided("the word was not selected — formatting cannot be judged"); }
  await tool("nt-bold");
  await dump("selected+bold");
  { const armBold = await pressed("nt-bold"); if (armBold !== "true") voided("a real bold did not light B — the toolbar is not reaching the document"); }
  ok("[known-good] bold stored on the selected word", markNames(runsOf(await live(), "bravo")[0]).includes("bold"), JSON.stringify(runsOf(await live(), "bravo")));
  await tool("nt-color"); await page.locator('[data-testid="nt-color-popover"] button').nth(2).click(); await settle(400);
  await tool("nt-highlight"); await page.locator('[data-testid="nt-highlight-popover"] button').nth(2).click(); await settle(400);
  await tool("nt-size");
  { const opt = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-size-opt-"]')].map((b) => b.getAttribute("data-testid")).filter((t) => !/default$/.test(t))[3]); if (opt) await page.locator(`[data-testid="${opt}"]`).click(); await settle(400); }
  await tool("nt-font");
  { const opt = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-font-opt-"]')].map((b) => b.getAttribute("data-testid")).filter((t) => !/default$/.test(t))[3]); if (opt) await page.locator(`[data-testid="${opt}"]`).click(); await settle(500); }
  { const marks = markNames(runsOf(await live(), "bravo")[0]).join(" ");
    ok("text colour stored", /"color":"#?[0-9a-fA-F]+/.test(marks), marks);
    ok("highlight stored", /highlight/.test(marks), marks);
    ok("size stored", /fontSize/.test(marks), marks);
    ok("font stored", /fontFamily/.test(marks), marks); }
  await dump("after-fmt");
  await tool("nt-spacing");
  { const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-spacing-line-"]')].map((b) => b.getAttribute("data-testid")));
    const pick = opts.find((o) => /1-5|1\.5|150/.test(o)) || opts[opts.length - 2];
    if (pick) await page.locator(`[data-testid="${pick}"]`).first().click(); await settle(500); await page.keyboard.press("Escape");
    const lh = boxes(await live())[0].content[0].attrs?.lineHeight;
    ok("line spacing stored on the paragraph", lh != null && lh !== "", `lineHeight=${lh} (picked ${pick})`); }

  await boxMoveTest("right after formatting");

  console.log("\n=== 2 · paste the Excel fixture ===");
  await dump("before-paste");
  const fx = bankEntry;
  await enter("x"); await page.keyboard.press("End"); await settle(300);   // table pastes land AFTER the line (a Backspace on a selected box would delete the box)
  /* 2a — the BROWSER clipboard (a trusted Ctrl+V). Chrome sanitises html written through the async clipboard API, so this proves the
   * real-keystroke route and the grid / merge / empty cell; the exact bytes (class-written bold, red) are 2b below. */
  {
    const frag = fx.html.replace(/^[\s\S]*<!--StartFragment-->/, "").replace(/<!--EndFragment-->[\s\S]*$/, "");
    await page.evaluate(async ([h, t]) => { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([t], { type: "text/plain" }) })]); }, [frag, fx.text]);
    const before = JSON.stringify(await live());
    await page.keyboard.press("Control+V"); await settle(1500);
    const sum = summariseDoc(await live()).tables[0];
    ok("real Ctrl+V from the browser clipboard: a 3×3 table with every cell's text and the empty cell empty", !!sum && sum.rows === 3 && sum.cols === 3 && sum.cells.find((c) => c.r === 0 && c.c === 0)?.text === "Header AB" && sum.cells.find((c) => c.r === 2 && c.c === 2)?.text === "12,500" && sum.cells.some((c) => c.r === 1 && c.c === 1 && c.raw === ""), JSON.stringify(sum && sum.cells.map((c) => [c.r, c.c, c.text, c.colspan])));
    await page.keyboard.press("Control+z"); await settle(900);
    ok("Ctrl+Z takes that paste back out", JSON.stringify(await live()) === before);
  }
  console.log("   2b — the exact fixture bytes");
  await enter("x"); await page.keyboard.press("End"); await settle(300);   // the undo above restored the earlier box selection; a paste over a selected box replaces it
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t);
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [fx.html, fx.text]);
  await settle(1500);
  await dump("after-paste");
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

  await dump("after-options");
  await boxMoveTest("after the paste option + undo");
  console.log("\n=== 4 · fill, row height, box move ===");
  await enter("Plain");
  await tool("nt-fill"); await page.locator('[data-testid="nt-fill-yellow"]').click(); await settle(1000);
  { const row = tableOf(await live()).content[2]; ok("the row is filled", row.content.every((c) => c.attrs?.background === "#fef08a"), JSON.stringify(row.content.map((c) => c.attrs?.background))); }
  await tool("nt-fill"); await page.locator('[data-testid="nt-fill-none"]').click(); await settle(1000);
  { const row = tableOf(await live()).content[2]; ok("No fill clears it", row.content.every((c) => !c.attrs?.background || c.attrs.background === "transparent")); }
  await dump("after-fill");
  {
    const rect = await page.evaluate(() => { const td = [...document.querySelectorAll(".ProseMirror td")].find((c) => c.textContent.trim() === "Plain"); const r = td.getBoundingClientRect(); return { x: r.left + r.width / 2, bottom: r.bottom }; });
    await page.mouse.move(rect.x, rect.bottom - 1); await settle(200);
    await page.mouse.down(); await page.mouse.move(rect.x, rect.bottom + 14, { steps: 6 }); await page.mouse.move(rect.x, rect.bottom + 40, { steps: 6 }); await page.mouse.up(); await settle(1000);
    const rh = tableOf(await live()).content.map((r) => r.attrs?.rowHeight ?? null);
    ok("dragging the row's lower line sets its height", rh.some((h) => typeof h === "number" && h > 40), JSON.stringify(rh));
  }
  await dump("after-rowdrag");
  await boxMoveTest("after the paste, fill and row drag");
  { const stages = ["right after formatting", "after the paste option + undo", "after the paste, fill and row drag"];
    const want = stages.flatMap((st) => ["top", "left"].map((sd) => `${st}/${sd}:yes`));
    const missing = want.filter((w) => !exercisedArms.includes(w));
    ok("every border-move arm was exercised (top and left, before the paste and at both stages after it) — none skipped as 'covered'", missing.length === 0, `not reached: ${missing.join(", ")} · saw: ${exercisedArms.join(" ")}`); }
  /* one last border move that is KEPT (no Ctrl+Z): its position must be what the reload brings back */
  let keptPos = null;
  {
    const start = await posOf();
    const r = await page.evaluate(() => { const b = [...document.querySelectorAll(".planyr-anchor")].find((a) => a.textContent.includes("Alpha")); const q = b.getBoundingClientRect(); return { l: q.left, t: q.top, w: q.width }; });
    const at = { x: r.l + r.w / 2, y: r.t - 1 };
    await page.mouse.move(at.x, at.y, { steps: 4 }); await settle(200);
    const onBand = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-edge"), [at.x, at.y]);
    ok("the kept move: the top border is under the pointer", onBand);
    if (onBand) {
      await page.mouse.down(); await page.mouse.move(at.x + 50, at.y + 35, { steps: 8 }); await page.mouse.move(at.x + 50, at.y + 35, { steps: 2 }); await page.mouse.up(); await settle(1500);
      keptPos = await posOf();
      ok("the kept move moved the box (X and Y)", !!keptPos && keptPos[0] > start[0] + 25 && keptPos[1] > start[1] + 20, `${JSON.stringify(start)} → ${JSON.stringify(keptPos)}`);
    }
  }
  await dump("end-of-4");
  console.log("\n=== 5 · reload with a cache-busting query ===");
  const snap = await live();
  const want = { pos: keptPos, bravo: markNames(runsOf(snap, "bravo")[0]).sort().join("|"), grid: JSON.stringify(summariseDoc(snap).tables[0]?.cells.map((c) => [c.r, c.c, c.text, c.colspan])) };
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid^="notes-row-"]', { timeout: 30000 }); await settle(2500);
  { const idx = await page.evaluate((t) => [...document.querySelectorAll('[data-testid^="notes-row-"]')].findIndex((r) => r.innerText.split("\n")[0].trim() === t), TITLE);
    if (idx >= 0) { await page.locator('[data-testid^="notes-row-"]').nth(idx).click(); await settle(2500); } }
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 }); await settle(2000);
  { const after = await live();
    ok("this is the throwaway page after the reload", JSON.stringify(after).includes("Alpha"), "page did not reopen on the throwaway");
    ok("the formatted word has marks to persist (not a vacuous comparison)", want.bravo.length > 0, want.bravo);
    ok("formatting persisted", markNames(runsOf(after, "bravo")[0]).sort().join("|") === want.bravo, markNames(runsOf(after, "bravo")[0]).join(" "));
    { const b = boxes(after).find((n) => n.attrs.aid === "fmt");
      ok("the box position persisted (the border move made after the paste is where the box reopens)", !!want.pos && !!b && b.attrs.x === want.pos[0] && b.attrs.y === want.pos[1], `wanted ${JSON.stringify(want.pos)}, reopened at ${JSON.stringify(b && [b.attrs.x, b.attrs.y])}`); }
    ok("the table persisted (same cells, same merge)", JSON.stringify(summariseDoc(after).tables[0]?.cells.map((c) => [c.r, c.c, c.text, c.colspan])) === want.grid);
    const sv = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json())); console.log("   served build after reload:", sv.build); }
  console.log("\n=== 7 · nothing draws on top of anything after an edit (B2671237 / B2671238) ===");
  {
    const seedLive = async (d) => { await page.evaluate((x) => window.__noteEditor.setDoc(x), d); await settle(1300); };
    const reopenRead = async () => {
      await page.waitForTimeout(4000);
      await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid^="notes-row-"]', { timeout: 30000 }); await settle(2500);
      const idx = await page.evaluate((t) => [...document.querySelectorAll('[data-testid^="notes-row-"]')].findIndex((r) => r.innerText.split("\n")[0].trim() === t), TITLE);
      if (idx >= 0) { await page.locator('[data-testid^="notes-row-"]').nth(idx).click(); await settle(2500); }
      await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 }); await settle(1800);
      return { rects: await readRects(page), doc: await live() };
    };
    const results = await runSweep({
      page, seed: seedLive, ok, settle, voided, reloadRead: reopenRead, reloadIds: ["paste-from-box"],
      only: ["paste-from-box", "paste-plain", "type-wrap", "enter-lines", "paste-option-merge", "paste-option-text", "bullets", "font-size", "table", "shrink", "resize-width", "move-onto"],
    });
    console.log("   sweep:", results.map((r) => `${r.id}:${r.status}`).join(" "));
    ok("the live sweep reached every scenario it was asked to run (none skipped)", results.length === 12 && results.every((r) => r.status === "done"), JSON.stringify(results));
  }
} catch (e) {
  if (e.message !== "void") { fail++; console.log("  ✗ run aborted:", String(e).slice(0, 300)); }
} finally {
  await s.close().catch(() => {});
  const swept = await sweepNotesThrowaways({ base: BASE });
  ok("the throwaway is gone from the page list and the Bin", swept.pagesLeft === 0 && swept.binLeft === 0, JSON.stringify(swept));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode || (fail ? 1 : 0));
