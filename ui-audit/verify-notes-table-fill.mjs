#!/usr/bin/env node
/* verify-notes-table-fill — A HEADER ROW ON ANY ROW, BOLD TELLING THE TRUTH IN IT, AND CELL FILL
 * (NEW-1 / NEW-2, owner report 2026-10-28: a Notes table's SECOND row was all header cells — bold and grey —
 * while the B button read off, the size box read the same, and "Header" only ever touched row 1).
 *
 * Real clicks and real keys (page.mouse / page.keyboard), judged on the STORED document and on COMPUTED
 * style, then re-read after a reload. Throwaway data only: the page lives in a fresh browser context's own
 * localStorage (signed out), nothing of anyone's real notes is touched, and the context is discarded.
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a REAL bold mark in an ordinary box must light the
 * B button and plain text must not. If it does not, the harness (focus, selection) is on trial and the run is
 * VOID — no verdict about header cells means anything.
 *
 * `BASE_URL` (default http://localhost:4173) · `PW_CHROME` · `SKIP_PHONE=1` to skip the narrow-viewport arm.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const PK = (id) => `planyr:notes:page:v1:local:${id}`;
const ACTIVE_KEY = "planyr:notes:activePage:v1:local";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-table-fill");

let passN = 0; let failN = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};

/* ── fixtures: Michael's shape (row 2 all tableHeader, row 1 plain) ─────────────────────────── */
const para = (t, marks) => ({ type: "paragraph", content: t ? [{ type: "text", text: t, ...(marks ? { marks } : {}) }] : [] });
const cell = (t, kind = "tableCell") => ({ type: kind, attrs: { colspan: 1, rowspan: 1, colwidth: [150] }, content: [para(t)] });
const TABLE = () => ({ type: "table", content: [
  { type: "tableRow", content: [cell("Permit"), cell("Number"), cell("Authority")] },
  { type: "tableRow", content: [cell("TDLR TABS Compliance", "tableHeader"), cell("TABS2027000388", "tableHeader"), cell("Texas Dept of Licensing", "tableHeader")] },
  { type: "tableRow", content: [cell("Other permit"), cell("N-1"), cell("Some authority")] },
] });
const box = (aid, x, y, content, w = 520) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content });
const DOC = () => [box("tbl", 40, 40, [TABLE()]), box("bold", 40, 380, [para("Plain words here"), para("Truly bold words", [{ type: "bold" }])]), box("tgt", 40, 520, [para("Target text")]), para("")];
const TREE = { v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "ZZ throwaway fill check", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] };

async function seed(theme = "light") {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tree, doc, ak, th]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", th);
    localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify(tree));
    localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify({ type: "doc", content: doc }));
    localStorage.setItem(ak, "p1");
  }, [TREE, DOC(), ACTIVE_KEY, theme]);
  await reload();
}
async function reload() {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
}
/* ⛔ the wait lives INSIDE the reader (carry-forward §1: a read before the 600 ms save debounce is a false failure). */
const stored = async () => { await pacedWait(page, 1000); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PK("p1")) || "null"); };
const findTable = (doc) => { let t = null; const w = (n) => { if (!n || t) return; if (n.type === "table") { t = n; return; } (n.content || []).forEach(w); }; w(doc); return t; };
const rowsOf = (doc) => (findTable(doc)?.content || []).map((r) => r.content.map((c) => ({ kind: c.type, bg: c.attrs?.background ?? null, text: JSON.stringify(c).match(/"text":"([^"]*)"/)?.[1] })));
const kindsOf = (doc) => rowsOf(doc).map((r) => r.map((c) => (c.kind === "tableHeader" ? "H" : "-")).join(""));
const persisted = async () => { await pacedWait(page, 1000); await reload(); return stored(); };

async function pointIn(needle) {
  const p = await page.evaluate((n) => {
    const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i + 1); r.collapse(true);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, needle);
  if (!p) throw new Error(`could not find "${needle}" on the page`);
  return p;
}
const clickAt = async (needle) => { const p = await pointIn(needle); await page.mouse.click(p.x, p.y); await pacedWait(page, 250); };
/** Desktop is TWO-STAGE: press 1 on a box SELECTS it, a second spaced press puts the caret in. */
async function enter(needle) { await clickAt(needle); await pacedWait(page, 650); await clickAt(needle); await pacedWait(page, 300); }
const pressed = (testid) => page.locator(`[data-testid="${testid}"]`).first().getAttribute("aria-pressed");
const css = (needle, prop) => page.evaluate(([n, pr]) => {
  const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) if (node.nodeValue.includes(n)) { const c = node.parentElement.closest("td,th"); return c ? getComputedStyle(c)[pr] : null; }
  return null;
}, [needle, prop]);
const cellTag = (needle) => page.evaluate((n) => {
  const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) if (node.nodeValue.includes(n)) return node.parentElement.closest("td,th")?.tagName || null;
  return null;
}, needle);
const click = async (testid) => { await page.locator(`[data-testid="${testid}"]`).first().click(); await pacedWait(page, 400); };
const key = async (k) => { await page.keyboard.press(k); await pacedWait(page, 700); };
const YELLOW = "#fef08a"; const YELLOW_RGB = "rgb(254, 240, 138)"; const INK_RGB = "rgb(27, 30, 38)";

/* ── KNOWN-GOOD ARM ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARM — a real bold mark lights B; plain text does not ===");
await seed();
await enter("Truly bold words");
const armBold = await pressed("nt-bold");
await enter("Plain words here");
const armPlain = await pressed("nt-bold");
ok("B is lit on a real bold run", armBold === "true", `aria-pressed=${armBold}`);
ok("B is off on plain text", armPlain === "false", `aria-pressed=${armPlain}`);
if (armBold !== "true" || armPlain !== "false") { console.log("\nVOID: the known-good arm failed — no header verdict means anything."); await browser.close(); process.exit(2); }

/* ── NEW-1: the stray header row ───────────────────────────────────────────────────────────── */
console.log("\n=== NEW-1 — row 2 is a header row (Michael's table) ===");
ok("fixture really has row 2 all header, row 1 plain", kindsOf(await stored()).join("|") === "---|HHH|---", kindsOf(await stored()).join("|"));
await enter("TABS2027000388");
ok("Header row button is PRESSED with the caret in row 2", (await pressed("nt-header-row")) === "true", `aria-pressed=${await pressed("nt-header-row")}`);
ok("button is labelled 'Header row'", /Header row/.test(await page.locator('[data-testid="nt-header-row"]').first().innerText()));
ok("Bold is LIT in a header cell although no bold mark is stored", (await pressed("nt-bold")) === "true");
const boldTitle = await page.locator('[data-testid="nt-bold"]').first().getAttribute("aria-label");
ok("Bold's tooltip names the real control", /header row: use Header row to change/i.test(boldTitle || ""), boldTitle);
ok("(the text really is visibly bold)", Number(await css("TABS2027000388", "fontWeight")) >= 600);
await click("nt-bold");
ok("clicking B in a header cell adds NO bold mark (it would change nothing visible)", !/"bold"/.test(JSON.stringify(findTable(await stored()))));
await enter("Other permit");
ok("caret in row 3: Header row is NOT pressed", (await pressed("nt-header-row")) === "false");
ok("caret in row 3: Bold is off", (await pressed("nt-bold")) === "false");

console.log("\n--- one click undoes it ---");
await enter("TABS2027000388");
await click("nt-header-row");
let d = await persisted();
ok("row 2 is a plain row now, rows 1 and 3 untouched", kindsOf(d).join("|") === "---|---|---", kindsOf(d).join("|"));
ok("…and it renders as <td> (no bold, no shade)", (await cellTag("TABS2027000388")) === "TD" && Number(await css("TABS2027000388", "fontWeight")) < 600);
await enter("TABS2027000388");
ok("Header row now reads off in row 2", (await pressed("nt-header-row")) === "false");
await click("nt-header-row");
d = await persisted();
ok("pressing it again makes row 2 a header row (row 1 untouched)", kindsOf(d).join("|") === "---|HHH|---", kindsOf(d).join("|"));
await seed();
await enter("TABS2027000388");
await click("nt-header-row");
ok("(setup) toggled off in this session", kindsOf(await stored()).join("|") === "---|---|---");
await enter("TABS2027000388");
await key(`${MOD}+z`);
d = await stored();
ok("Ctrl+Z takes the toggle back in ONE step (row 2 is a header row again)", kindsOf(d).join("|") === "---|HHH|---", kindsOf(d).join("|"));
await key(`${MOD}+Shift+z`);
ok("Ctrl+Shift+Z re-applies it", kindsOf(await stored()).join("|") === "---|---|---");

console.log("\n--- Row ↑ above a header row inserts a plain row (the header is pushed down, not copied) ---");
await seed();
await enter("Permit");
await click("nt-row-before");   // above row 1 (plain)
d = await persisted();
ok("Row ↑ above a plain row: new row plain, header still ONE row", kindsOf(d).join("|") === "---|---|HHH|---", kindsOf(d).join("|"));
await seed();
await enter("TABS2027000388");
await click("nt-row-before");
d = await persisted();
ok("Row ↑ above the header row inserts a PLAIN row", kindsOf(d).join("|") === "---|---|HHH|---", kindsOf(d).join("|"));
await seed();
await enter("TABS2027000388");
await click("nt-row-after");
d = await persisted();
ok("Row ↓ below the header row inserts a PLAIN row", kindsOf(d).join("|") === "---|HHH|---|---", kindsOf(d).join("|"));

/* ── NEW-2: fill ───────────────────────────────────────────────────────────────────────────── */
console.log("\n=== NEW-2 — fill and un-fill ===");
await seed();
await enter("Other permit");
ok("Fill button present in the Table group", await page.locator('[data-testid="nt-fill"]').count() === 1);
await click("nt-fill");
const popItems = await page.evaluate(() => [...document.querySelectorAll('[data-testid="nt-fill-popover"] button')].map((b) => b.getAttribute("data-testid")));
ok("popover lists 'No fill' first, then the tints", popItems[0] === "nt-fill-none" && popItems.length === 9, JSON.stringify(popItems));
await click("nt-fill-yellow");
d = await stored();
let r = rowsOf(d);
ok("the caret cell's whole ROW is filled", r[2].every((c) => c.bg === YELLOW), JSON.stringify(r[2]));
ok("other rows untouched", r[0].every((c) => c.bg === null) && r[1].every((c) => c.bg === null));
ok("rendered background is the solid tint", (await css("Other permit", "backgroundColor")) === YELLOW_RGB, await css("Other permit", "backgroundColor"));
ok("text in a filled cell takes dark ink (light theme)", (await css("Other permit", "color")) === INK_RGB, await css("Other permit", "color"));
ok("the Fill button shows the current fill", (await page.locator('[data-testid="nt-fill-swatch"]').first().getAttribute("data-fill")) === YELLOW);
d = await persisted();
ok("still filled after a reload (stored)", rowsOf(d)[2].every((c) => c.bg === YELLOW));
ok("still filled after a reload (rendered)", (await css("Other permit", "backgroundColor")) === YELLOW_RGB);

console.log("\n--- dark theme ---");
await page.evaluate(() => localStorage.setItem("planyr.theme", "dark"));
await reload();
ok("filled cell keeps the solid tint in dark theme", (await css("Other permit", "backgroundColor")) === YELLOW_RGB);
ok("…and dark ink, so it is readable", (await css("Other permit", "color")) === INK_RGB, await css("Other permit", "color"));
ok("an UNFILLED cell still follows the theme ink", (await css("Permit", "color")) !== INK_RGB, await css("Permit", "color"));
await page.evaluate(() => localStorage.setItem("planyr.theme", "light"));
await reload();

console.log("\n--- No fill ---");
await enter("Other permit");
await click("nt-fill"); await click("nt-fill-none");
r = rowsOf(await stored());
ok("No fill clears the row", r[2].every((c) => c.bg === null), JSON.stringify(r[2]));
ok("rendered: no background", /rgba\(0, 0, 0, 0\)|transparent/.test(await css("Other permit", "backgroundColor")));

console.log("\n--- header row + No fill: no shade, still a header ---");
await enter("TABS2027000388");
const shaded = await css("TABS2027000388", "backgroundColor");
ok("(a header row is shaded by default)", !/rgba\(0, 0, 0, 0\)|transparent/.test(shaded), shaded);
await click("nt-fill"); await click("nt-fill-none");
d = await persisted();
r = rowsOf(d);
ok("stored as explicit transparent on every header cell", r[1].every((c) => c.bg === "transparent" && c.kind === "tableHeader"), JSON.stringify(r[1]));
ok("rendered header has NO shade but is still <th>", (await cellTag("TABS2027000388")) === "TH" && /rgba\(0, 0, 0, 0\)|transparent/.test(await css("TABS2027000388", "backgroundColor")), await css("TABS2027000388", "backgroundColor"));
await enter("TABS2027000388");
ok("Header row still reads pressed", (await pressed("nt-header-row")) === "true");
await click("nt-fill"); await click("nt-fill-blue");
ok("a header row can take a colour", rowsOf(await stored())[1].every((c) => c.bg === "#bfdbfe"));
await click("nt-header-row");
ok("un-headering keeps the colour (it is now a plain filled row)", rowsOf(await stored())[1].every((c) => c.kind === "tableCell" && c.bg === "#bfdbfe"));
await click("nt-fill"); await click("nt-fill-none");
ok("…and No fill on the plain row is null, not 'transparent'", rowsOf(await stored())[1].every((c) => c.bg === null), JSON.stringify(rowsOf(await stored())[1]));

console.log("\n--- a cell range fills only those cells ---");
await seed();
await enter("Number");
{
  const a = await pointIn("Number"); const b = await pointIn("N-1");
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); await pacedWait(page, 300);
}
await click("nt-fill"); await click("nt-fill-green");
r = rowsOf(await stored());
ok("only the selected cells (col 2, rows 1–3) are filled", r.every((row) => row[1].bg === "#bbf7d0" && row[0].bg === null && row[2].bg === null), JSON.stringify(r.map((x) => x.map((c) => c.bg))));

console.log("\n--- right-click menu ---");
await seed();
await enter("Other permit");
{ const p = await pointIn("Other permit"); await page.mouse.click(p.x, p.y, { button: "right" }); await pacedWait(page, 500); }
ok("menu offers Header row", await page.locator('[data-testid="note-menu-header-row"]').count() === 1);
ok("menu offers Fill ▸", await page.locator('[data-testid="note-menu-fill"]').count() === 1);
await page.locator('[data-testid="note-menu-fill"]').hover(); await pacedWait(page, 300);
const subItems = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-menu-fill-sub"] button')].map((b) => b.textContent.trim()));
ok("submenu starts with No fill", /No fill$/.test(subItems[0]) && subItems.length === 9, JSON.stringify(subItems));
await page.locator('[data-testid="note-menu-fill-green"]').click(); await pacedWait(page, 500);
ok("picking Green in the menu fills the row", rowsOf(await stored())[2].every((c) => c.bg === "#bbf7d0"));
{ const p = await pointIn("Other permit"); await page.mouse.click(p.x, p.y, { button: "right" }); await pacedWait(page, 500); }
await page.locator('[data-testid="note-menu-header-row"]').click(); await pacedWait(page, 500);
ok("Header row in the menu makes the row a header", kindsOf(await stored()).join("|") === "---|HHH|HHH", kindsOf(await stored()).join("|"));
{ const p = await pointIn("Other permit"); await page.mouse.click(p.x, p.y, { button: "right" }); await pacedWait(page, 500); }
ok("…and shows as on", (await page.locator('[data-testid="note-menu-header-row"]').getAttribute("aria-pressed")) === "true");
await page.keyboard.press("Escape"); await pacedWait(page, 300);
await page.locator('[data-testid="note-doc-menu"]').count();

console.log("\n--- the fill travels: HTML clipboard, paste, print ---");
await seed();
await enter("Other permit");
await click("nt-fill"); await click("nt-fill-pink");
await click("nt-table-select");
await key(`${MOD}+c`);
const clip = await page.evaluate(async () => {
  const items = await navigator.clipboard.read(); const out = {};
  for (const it of items) for (const t of it.types) out[t] = await (await it.getType(t)).text();
  return out;
});
ok("clipboard HTML carries an inline background-color (Excel / Word read this)", /background-color:\s*(#fbcfe8|rgb\(251,\s*207,\s*232\))/i.test(clip["text/html"] || ""), (clip["text/html"] || "").slice(0, 300));
ok("…and Notes' own data-cell-fill", /data-cell-fill="#fbcfe8"/.test(clip["text/html"] || ""));
await enter("Target text");
await key(`${MOD}+End`);
await key(`${MOD}+v`);
d = await persisted();
const tables = []; const walk = (n) => { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(walk); }; walk(d);
ok("pasting the table keeps its fill (two tables, both filled on the same row)", tables.length === 2 && tables.every((t) => t.content[2].content.every((c) => c.attrs.background === "#fbcfe8")), `tables=${tables.length}`);
await page.locator('[data-testid="notes-header-export"]').click(); await pacedWait(page, 300);
await page.locator('[data-testid="notes-header-export-print"]').click(); await pacedWait(page, 1800);
const printed = await page.evaluate(() => {
  const doc = document.querySelector('[data-testid="notes-print-frame"]')?.contentDocument;
  if (!doc) return null;
  const td = [...doc.querySelectorAll("td")].find((x) => x.textContent.includes("Other permit"));
  const th = [...doc.querySelectorAll("th")][0];
  return { style: td?.getAttribute("style") || "", thStyle: th?.getAttribute("style") || "" };
});
ok("the print sheet carries the fill (PDF-PARITY)", !!printed && /background-color:\s*(#fbcfe8|rgb\(251,\s*207,\s*232\))/i.test(printed.style), JSON.stringify(printed));

/* ── PHONE: Fill and Header row live in the More sheet with the rest of the table controls ─────── */
if (!process.env.SKIP_PHONE) {
  console.log("\n=== PHONE (narrow viewport; touch) — one implementation, in the More sheet ===");
  const pctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const pp = await pctx.newPage();
  await pp.addInitScript(() => { window.__PLANYR_E2E = true; });
  await pp.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pp.evaluate(([tree, doc, ak]) => {
    localStorage.clear(); localStorage.setItem("planyr.theme", "light");
    localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify(tree));
    localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify({ type: "doc", content: doc }));
    localStorage.setItem(ak, "p1");
  }, [TREE, DOC(), ACTIVE_KEY]);
  await pp.reload({ waitUntil: "domcontentloaded" });
  await pp.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(pp, 900);
  const pstored = async () => JSON.parse(await pp.evaluate((k) => localStorage.getItem(k), PK("p1")) || "null");
  // Put the caret in a table cell with a real tap on the box, then a second tap.
  const tap = async (needle) => {
    const p = await pp.evaluate((n) => {
      const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
      let node; while ((node = w.nextNode())) { const i = node.nodeValue.indexOf(n); if (i >= 0) { const r = document.createRange(); r.setStart(node, i + 1); r.collapse(true); const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 }; } }
      return null;
    }, needle);
    if (!p) throw new Error(`phone: no "${needle}"`);
    await pp.touchscreen.tap(p.x, p.y); await pacedWait(pp, 500);
  };
  await tap("Other permit"); await tap("Other permit");
  const moreBtn = pp.locator('[data-testid="nt-more"]').first();
  const hasMore = await moreBtn.count();
  ok("phone toolbar has a More control", hasMore > 0);
  if (hasMore) {
    await moreBtn.tap(); await pacedWait(pp, 500);
    ok("More sheet carries Header row", await pp.locator('[data-testid="nt-header-row"]:visible').count() === 1);
    ok("More sheet carries Fill", await pp.locator('[data-testid="nt-fill"]:visible').count() === 1);
    const box = await pp.locator('[data-testid="nt-fill"]').first().boundingBox();
    ok("Fill is a real tap target (≥ 44 tall)", !!box && box.height >= 44, JSON.stringify(box));
    await pp.locator('[data-testid="nt-fill"]').first().tap(); await pacedWait(pp, 400);
    const vis = await pp.evaluate(() => { const el = document.querySelector('[data-testid="nt-fill-popover"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, t: r.top, b: r.bottom, h: innerHeight }; });
    ok("the swatch popover is fully on screen", !!vis && vis.l >= 0 && vis.r <= vis.w && vis.b <= vis.h, JSON.stringify(vis));
    await pp.locator('[data-testid="nt-fill-blue"]').first().tap(); await pacedWait(pp, 600);
    ok("tapping a swatch fills the caret row", rowsOf(await pstored())[2].every((c) => c.bg === "#bfdbfe"), JSON.stringify(rowsOf(await pstored())[2]));
  }
  await pctx.close();
}

ok("no page errors", errs.length === 0, errs.join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
