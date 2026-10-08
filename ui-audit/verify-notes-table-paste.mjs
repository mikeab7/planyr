#!/usr/bin/env node
/* verify-notes-table-paste — A TABLE COPIED FROM ONENOTE / WORD / EXCEL / SHEETS / OUTLOOK ARRIVES
 * AS A REAL NOTES TABLE, EVERYWHERE A PASTE CAN LAND. (Owner report 2026-10-05: "I tried copying a
 * table from OneNote earlier and it did not copy well at all. Or it didn't copy it at all.")
 *
 * The clipboards are the committed fixtures in test/fixtures/clipboard-tables — modelled on each
 * product's real markup (see manifest.json), never a hand-simplified <table><tr><td>. Each is pasted
 * three ways: html+text · html+text+PICTURE (Excel, and some OneNote builds, put a picture of the
 * cells beside the html) · plain text only (Excel/Sheets give tab-separated text).
 *
 * LANDING SPOTS: caret in a box's text · caret in a bullet · armed empty sheet (a press on blank
 * paper) · armed point beside an existing box · nothing focused · caret in an existing table cell.
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a plain two-line text paste on every
 * landing spot must land as text. If that fails the harness, not the app, is on trial and the run
 * is VOID. ⛔ Judged on the STORED document; every selection/press is a real mouse press.
 *
 * `BASE_URL` (default http://127.0.0.1:5199) · `ONLY=<fixture>` · `LAND=<spot>` to narrow.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { fixtureNames, loadFixture, summariseTables, diffAgainst, TINY_PNG_B64 } from "./lib/clipboardTableFixtures.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-table-paste");

let passN = 0; let failN = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};

const box = (aid, x, y, content, w = 360) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content });
const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cellP = (t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(t)] });
const LANDINGS = {
  "in-box-text": { doc: [box("b1", 40, 40, [para("Intro line")]), para("")], act: async () => { await enter("Intro line"); } },
  "box-selected-not-editing": { doc: [box("b1", 40, 40, [para("Intro line")]), para("")], act: async () => { await clickIn("Intro line"); } },
  "in-bullet": { doc: [box("b1", 40, 40, [{ type: "bulletList", content: [{ type: "listItem", content: [para("Bullet one")] }] }]), para("")], act: async () => { await enter("Bullet one"); } },
  "in-heading": { doc: [box("b1", 40, 40, [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading line" }] }]), para("")], act: async () => { await enter("Heading line"); } },
  "in-ordered-item": { doc: [box("b1", 40, 40, [{ type: "orderedList", content: [{ type: "listItem", content: [para("Numbered one")] }] }]), para("")], act: async () => { await enter("Numbered one"); } },
  "in-task-item": { doc: [box("b1", 40, 40, [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [para("Task one")] }] }]), para("")], act: async () => { await enter("Task one"); } },
  "in-nested-bullet": { doc: [box("b1", 40, 40, [{ type: "bulletList", content: [{ type: "listItem", content: [para("Outer"), { type: "bulletList", content: [{ type: "listItem", content: [para("Inner bullet")] }] }] }] }]), para("")], act: async () => { await enter("Inner bullet"); } },
  "in-blockquote": { doc: [box("b1", 40, 40, [{ type: "blockquote", content: [para("Quoted")] }]), para("")], act: async () => { await enter("Quoted"); } },
  "armed-empty-sheet": { doc: [para("")], act: async () => { await armBlank(0.5, 0.45); } },
  "armed-beside-box": { doc: [box("b1", 40, 40, [para("Existing box")]), para("")], act: async () => { await armBlank(0.55, 0.7); } },
  "nothing-focused": { doc: [box("b1", 40, 40, [para("Existing box")]), para("")], act: async () => {
    // a real press first (saves are gated on a genuine user event, as in life), then focus leaves everything
    await page.locator('[data-testid="note-title"]').click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await pacedWait(page, 150);
  } },
  "in-table-cell": {
    doc: [box("b1", 40, 40, [{ type: "table", content: [
      { type: "tableRow", content: [cellP("x1"), cellP("x2")] }, { type: "tableRow", content: [cellP("x3"), cellP("x4")] },
    ] }]), para("")],
    act: async () => { await enter("x1"); },
  },
};

/** Desktop is TWO-STAGE: press 1 on a box SELECTS it (nothing focused), press 2 puts the caret in.
 *  `enter` is a person's second press, spaced out so it is not read as a double-click. */
async function enter(needle) { await clickIn(needle); await pacedWait(page, 650); await clickIn(needle); }
async function clickIn(needle) {
  const p = await page.evaluate((n) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i + n.length); r.collapse(true);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, needle);
  if (!p) throw new Error(`could not find "${needle}" to click`);
  await page.mouse.click(p.x, p.y);
  await pacedWait(page, 250);
}
async function armBlank(fx, fy) {
  // Boxes-only pages: a DOUBLE-click on blank paper arms the caret (a single press no longer does).
  const at = await page.evaluate(([a, b]) => {
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round(s.left + s.width * a), y: Math.round(s.top + s.height * b) };
  }, [fx, fy]);
  await page.mouse.dblclick(at.x, at.y);
  await pacedWait(page, 450);
  const armed = await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]'));
  if (!armed) throw new Error("a double-click on blank paper did not arm a caret — the harness is not in the state it claims");
}

async function seed(docContent) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, { type: "doc", content: docContent }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
}

/** A REAL paste event carrying a DataTransfer with the fixture's exact bytes. */
async function paste({ html, text, png }) {
  await page.evaluate(([h, t, p]) => {
    const dt = new DataTransfer();
    if (h) dt.setData("text/html", h);
    if (t != null) dt.setData("text/plain", t);
    if (p) {
      const bin = Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
      dt.items.add(new File([bin], "image.png", { type: "image/png" }));
    }
    const target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html || null, text ?? null, png || null]);
  await pacedWait(page, 1100);
}
const stored = async () => JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY) || "null");
const textOfDoc = (doc) => { const o = []; const w = (n) => { if (!n) return; if (n.text) o.push(n.text); (n.content || []).forEach(w); }; w(doc); return o.join("|"); };
const countType = (doc, t) => { let c = 0; const w = (n) => { if (!n) return; if (n.type === t) c += 1; (n.content || []).forEach(w); }; w(doc); return c; };

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const landOnly = process.env.LAND ? process.env.LAND.split(",") : null;
const landings = Object.keys(LANDINGS).filter((l) => !landOnly || landOnly.includes(l));

/* ── KNOWN-GOOD ARM ───────────────────────────────────────────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARM — plain two-line text must land as text on every landing spot ===");
let armOk = true;
for (const land of landings) {
  await seed(LANDINGS[land].doc);
  await LANDINGS[land].act();
  await paste({ text: "alpha line\nbeta line" });
  const d = await stored();
  const t = textOfDoc(d);
  const good = ["nothing-focused", "box-selected-not-editing"].includes(land) ? true : /alpha line/.test(t) && /beta line/.test(t);
  if (!good) armOk = false;
  ok(`plain text pastes on "${land}"`, good, t);
}
if (!armOk) { console.log("\nVOID: the known-good arm failed — the harness cannot see a paste, so no table verdict below means anything."); process.exit(2); }

/* ── THE TABLES ───────────────────────────────────────────────────────────────────────── */
for (const name of fixtureNames.filter((n) => !only || only.includes(n))) {
  const fx = loadFixture(name);
  for (const variant of ["html", "html+png", "plain"]) {
    if (variant === "plain" && !fx.plainTable) continue;
    for (const land of landings) {
      if (land === "nothing-focused") continue;          // its verdict is separate, below
      await seed(LANDINGS[land].doc);
      await LANDINGS[land].act();
      await paste({ html: variant === "plain" ? null : fx.html, text: fx.text, png: variant === "html+png" ? TINY_PNG_B64 : null });
      const d = await stored();
      const tables = summariseTables(d);
      const label = `${name} · ${variant} · ${land}`;
      if (land === "in-table-cell") {
        // Pasting a grid into a cell fills cells from there (Excel's behaviour): every pasted cell's
        // text must exist as a cell somewhere in the page; nothing is dropped.
        const have = new Set(tables.flatMap((x) => x.grid.flat().map((c) => (typeof c === "string" ? c : c.t))));
        const lost = fx.grid.flat().map((c) => (typeof c === "string" ? c : c.t)).filter((c) => c && !have.has(c));
        ok(`${label} — every cell's text is in the page`, lost.length === 0, `missing: ${JSON.stringify(lost)}`);
        continue;
      }
      const t = tables.find((x) => x.where === "box") || tables[0];
      const problems = diffAgainst(t, fx);
      if (variant === "plain") {
        // plain text carries no marks and no merged cells: only the grid text is owed.
        const grid = fx.grid.map((r) => r.flatMap((c) => (typeof c === "string" ? [c] : [c.t, ""])));
        const got = t ? t.grid.map((r) => r.map((c) => (typeof c === "string" ? c : c.t))) : null;
        ok(`${label} — arrives as a table with the same text`, !!t && JSON.stringify(grid) === JSON.stringify(got), `want ${JSON.stringify(grid)}\n      got  ${JSON.stringify(got)}`);
      } else {
        ok(`${label} — arrives as one intact table`, problems.length === 0, problems.join("\n      "));
      }
      ok(`${label} — it sits INSIDE a box, not loose`, !t || t.where === "box", `where=${t && t.where}`);
      ok(`${label} — no picture pasted instead`, countType(d, "noteImage") === 0, `images=${countType(d, "noteImage")}`);
    }
  }
}

/* ── NOTHING FOCUSED ──────────────────────────────────────────────────────────────────── */
if (!landOnly || landOnly.includes("nothing-focused")) {
  console.log("\n=== NOTHING FOCUSED — a table must not vanish silently ===");
  for (const name of ["onenote-desktop", "excel"]) {
    if (only && !only.includes(name)) continue;
    const fx = loadFixture(name);
    await seed(LANDINGS["nothing-focused"].doc);
    await LANDINGS["nothing-focused"].act();
    await paste({ html: fx.html, text: fx.text });
    const d = await stored();
    const tables = summariseTables(d);
    const arrived = tables.some((t) => diffAgainst(t, fx).length === 0);
    const told = await page.evaluate(() => /paste|click|place/i.test(document.body.innerText) && !!document.querySelector('[role="status"], [data-testid*="notice"]'));
    ok(`${name} · nothing focused — the table arrives (or the app says why not)`, arrived || told, `tables=${JSON.stringify(tables.map((t) => t.grid))}`);
  }
}


/* ── MODES · UNDO · BOX WIDTH · THE KEYBOARD ──────────────────────────────────────────── */
if (!only || only.includes("onenote-desktop")) {
  const fx = loadFixture("onenote-desktop");
  const boxOf = (d) => (d.content || []).find((n) => n.type === "noteAnchor" && JSON.stringify(n).includes('"table"'));
  const marksIn = (d) => { const o = new Set(); const w = (n) => { if (!n) return; (n.marks || []).forEach((m) => o.add(m.type + (m.type === "textStyle" ? JSON.stringify(m.attrs) : ""))); (n.content || []).forEach(w); }; w(d); return [...o]; };

  console.log("\n=== THE THREE PASTE MODES, on a pasted table (chip → in-place re-transform) ===");
  await seed(LANDINGS["in-box-text"].doc); await LANDINGS["in-box-text"].act();
  await paste({ html: fx.html, text: fx.text });
  const chip = page.locator('[data-testid="note-paste-badge"]');
  ok("the paste-options chip appears after a table paste", await chip.count() > 0);
  if (await chip.count()) {
    await chip.click(); await pacedWait(page, 250);
    await page.locator('[data-testid="note-paste-merge"]').click(); await pacedWait(page, 1000);
    const dm = await stored();
    const tm = summariseTables(dm)[0];
    ok("Merge formatting keeps the table (rows, columns, text)", !!tm && diffAgainst(tm, { grid: fx.grid, marks: [["Dock high", "bold"], ["cross-docked", "italic"], ["Survey", "link"]] }).length === 0, JSON.stringify(tm && tm.grid));
    ok("…and drops the source fonts/sizes (no textStyle marks left)", !marksIn(dm).some((m) => m.startsWith("textStyle")), JSON.stringify(marksIn(dm)));
  }
  await seed(LANDINGS["in-box-text"].doc); await LANDINGS["in-box-text"].act();
  await paste({ html: fx.html, text: fx.text });
  if (await chip.count()) {
    await chip.click(); await pacedWait(page, 250);
    await page.locator('[data-testid="note-paste-text"]').click(); await pacedWait(page, 1000);
    const dt = await stored();
    ok("Keep text only: no table is left", countType(dt, "table") === 0);
    const paras = []; const w = (n) => { if (!n) return; if (n.type === "paragraph") paras.push((n.content || []).map((c) => c.text || "").join("")); (n.content || []).forEach(w); }; w(dt);
    ok("…and it is TAB-SEPARATED TEXT, one line per row (the stated choice)", paras.includes("Unit\tArea (SF)\tNotes") && paras.includes("A-100\t12,500\tDock high and cross-docked"), JSON.stringify(paras));
  }

  console.log("\n=== AFTER THE PASTE THE CARET IS STILL IN THE BOX (a character typed lands in it, not in the hidden page paragraph) ===");
  for (const land of ["in-box-text", "armed-empty-sheet", "box-selected-not-editing"]) {
    await seed(LANDINGS[land].doc); await LANDINGS[land].act();
    await paste({ html: fx.html, text: fx.text });
    await page.keyboard.type("Q"); await pacedWait(page, 1000);
    const d = await stored();
    const inBox = (d.content || []).some((n) => n.type === "noteAnchor" && JSON.stringify(n).includes("Q"));
    const loose = (d.content || []).some((n) => n.type !== "noteAnchor" && JSON.stringify(n).includes("Q"));
    ok(`${land}: the next typed character is inside a box and nothing is typed into the loose page paragraph`, inBox && !loose, `inBox=${inBox} loose=${loose}`);
  }

  console.log("\n=== UNDO — one Ctrl+Z takes the pasted table back out ===");
  await seed(LANDINGS["in-box-text"].doc); await LANDINGS["in-box-text"].act();
  await paste({ html: fx.html, text: fx.text });
  await page.keyboard.press("Control+z"); await pacedWait(page, 900);
  ok("in a box: one Ctrl+Z removes the table", countType(await stored(), "table") === 0);
  await seed(LANDINGS["armed-empty-sheet"].doc); await LANDINGS["armed-empty-sheet"].act();
  await paste({ html: fx.html, text: fx.text });
  const dArmed = await stored();
  const bx = boxOf(dArmed);
  ok("a table pasted on blank paper makes a box WIDE enough for its columns (not a sticky-note sliver)", !!bx && bx.attrs.w >= 480, `w=${bx && bx.attrs.w}`);
  await page.keyboard.press("Control+z"); await pacedWait(page, 900);
  let undone = 1;
  if (countType(await stored(), "table") > 0) { await page.keyboard.press("Control+z"); await pacedWait(page, 900); undone = 2; }
  ok(`on blank paper: Ctrl+Z removes the table (${undone} press${undone > 1 ? "es" : ""})`, countType(await stored(), "table") === 0);

  console.log("\n=== Ctrl+Shift+V — the text-only route keeps tab-separated TEXT, never a table ===");
  await seed(LANDINGS["in-box-text"].doc); await LANDINGS["in-box-text"].act();
  await page.evaluate((t) => navigator.clipboard.writeText(t), fx.text);
  await page.keyboard.press("Control+Shift+V"); await pacedWait(page, 1000);
  const dsv = await stored();
  ok("Ctrl+Shift+V of a spreadsheet's text gives lines with tabs and NO table", countType(dsv, "table") === 0 && /Unit\tArea/.test(JSON.stringify(dsv).replace(/\\t/g, "\t")), textOfDoc(dsv));

  console.log("\n=== A REAL Ctrl+V through the browser clipboard (trusted paste, the page's own clipboard object) ===");
  // Chrome sanitises html written through the async clipboard API, so this proves the TRUSTED-event
  // route and the grid; the exact-bytes proof is the DataTransfer matrix above.
  const frag = fx.html.replace(/^[\s\S]*<!--StartFragment-->/, "").replace(/<!--EndFragment-->[\s\S]*$/, "");
  for (const land of ["in-box-text", "box-selected-not-editing", "armed-empty-sheet", "nothing-focused"]) {
    await seed(LANDINGS[land].doc); await LANDINGS[land].act();
    await page.evaluate(async ([h, t]) => {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([t], { type: "text/plain" }) })]);
    }, [frag, fx.text]);
    await page.keyboard.press("Control+V"); await pacedWait(page, 1300);
    const d = await stored();
    const t = summariseTables(d)[0];
    const flat = t ? t.grid.map((r) => r.map((c) => (typeof c === "string" ? c : c.t))) : null;
    ok(`real Ctrl+V · ${land} — a 4-row × 3-column table arrives with every cell's text`, !!t && flat.length === 4 && flat[0].length === 3 && JSON.stringify(flat) === JSON.stringify(fx.grid), JSON.stringify(flat));
  }
}

/* ── EXCEL IS THE MUST-SHIP (owner, 2026-10-06: "we need to 100% be able to paste from Excel") ─── */
if (!only || only.includes("excel")) {
  console.log("\n=== EXCEL: a single cell · a one-column range · a LARGE range (timed) ===");
  const xl = (cells, extra = "") => `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta name=ProgId content=Excel.Sheet><meta name=Generator content="Microsoft Excel 15"></head><body><table border=0 cellpadding=0 cellspacing=0 style='border-collapse:collapse'><!--StartFragment-->${extra}${cells}<!--EndFragment--></table></body></html>`;
  const td = (t, n = "") => `<td class=xl65 ${n} style='border:.5pt solid black'>${t}</td>`;
  for (const land of ["in-box-text", "armed-empty-sheet", "box-selected-not-editing"]) {
    await seed(LANDINGS[land].doc); await LANDINGS[land].act();
    await paste({ html: xl(`<tr height=20>${td("Hello cell")}</tr>`), text: "Hello cell\r\n", png: TINY_PNG_B64 });
    const d = await stored();
    ok(`excel single cell · ${land} — arrives as TEXT, not a one-cell table, and not a picture`, countType(d, "table") === 0 && /Hello cell/.test(textOfDoc(d)) && countType(d, "noteImage") === 0, textOfDoc(d));
  }
  await seed(LANDINGS["in-box-text"].doc); await LANDINGS["in-box-text"].act();
  await paste({ html: xl([1, 2, 3, 4, 5].map((i) => `<tr height=20>${td("Item " + i)}</tr>`).join("")), text: "Item 1\r\nItem 2\r\nItem 3\r\nItem 4\r\nItem 5\r\n" });
  {
    const t = summariseTables(await stored())[0];
    ok("excel one-column range (borders on) — stays a 5×1 table with every row", !!t && t.grid.length === 5 && t.grid.every((r, i) => r.length === 1 && r[0] === `Item ${i + 1}`), JSON.stringify(t && t.grid));
  }
  const R = 300, C = 12;
  const big = Array.from({ length: R }, (_, r) => `<tr height=20>${Array.from({ length: C }, (_, c) => td(`r${r}c${c}`, c % 5 === 4 ? "x:num" : "")).join("")}</tr>`).join("");
  const bigText = Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => `r${r}c${c}`).join("\t")).join("\r\n") + "\r\n";
  for (const land of ["in-box-text", "armed-empty-sheet"]) {
    await seed(LANDINGS[land].doc); await LANDINGS[land].act();
    const t0 = Date.now();
    await paste({ html: xl(big, `<col width=64 span=${C}>`), text: bigText, png: TINY_PNG_B64 });
    const d = await stored();
    const t = summariseTables(d).find((x) => x.where === "box") || summariseTables(d)[0];
    ok(`excel ${R}×${C} range · ${land} — every row and column arrives, first and last cell exact`, !!t && t.grid.length === R && t.grid.every((r) => r.length === C) && t.grid[0][0] === "r0c0" && t.grid[R - 1][C - 1] === `r${R - 1}c${C - 1}`, t && `${t.grid.length}×${t.grid[0] && t.grid[0].length}`);
    await page.keyboard.type("Q"); await pacedWait(page, 800);
    ok(`excel ${R}×${C} range · ${land} — the page is still responsive afterwards (typing lands)`, /Q/.test(textOfDoc(await stored())));
  }
}

ok("no page error during any paste", errs.length === 0, errs.slice(0, 3).join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
if (failN) console.log("FAILED:\n - " + failures.slice(0, 60).join("\n - "));
await browser.close();
process.exit(failN ? 1 : 0);
