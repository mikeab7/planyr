#!/usr/bin/env node
/* verify-notes-table-multiselect — CTRL+CLICK ADDS CELLS TO A NOTES TABLE'S SELECTION (B2530690, owner report
 * 2026-10-29: "Using Control to click multiple cells doesn't work. It should work.").
 *
 * REAL input throughout: Control is HELD on the keyboard (page.mouse.click alone drops the modifier —
 * NOTES-CARRY-FORWARD trap 8), clicks are real mouse presses on the cell's visible centre, bold goes on with a real
 * Ctrl+B, fill with the real toolbar swatch. Every verdict about formatting is read from the STORED document after the
 * save debounce, never from the screen.
 *
 *   BASE_URL=http://localhost:4173 node ui-audit/verify-notes-table-multiselect.mjs                local dev/preview server
 *   E2E_LOGIN_KEY=… node ui-audit/verify-notes-table-multiselect.mjs https://planyr.io [build]     signed in on the deployed site
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): entering the box and a PLAIN click on a second cell must put
 * the caret there with no cell highlighted — if it does not, the run is VOID. The box machinery is also checked to be
 * untouched: a Ctrl+click on a box that is NOT entered still only selects the box (stage 1), never starts a multi-select.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = process.argv[2] || null;
const live = !!arg && /^https?:/.test(arg);
const BASE = live ? arg.replace(/\/$/, "") : (process.env.BASE_URL || "http://localhost:4173");
const WANT = live ? (process.argv[3] || "") : "";
const EXEC = process.env.PW_CHROME || undefined;
const ACTIVE_KEY = "planyr:notes:activePage:v1:local";

let browser, ctx, page, signed = null;
if (live) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  signed = await openSignedIn({ base: BASE, viewport: { width: 1500, height: 950 } });
  console.log("signed in as", signed.proof.email);
  page = signed.page;
} else {
  browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  page = await ctx.newPage();
}
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-table-multiselect");

let passN = 0, failN = 0;
const results = [];
const ok = (label, cond, detail = "") => { results.push({ label, cond: !!cond }); if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); } };

/* ── fixture: one box holding a 3×3 table, one box of text ─────────────────────────────── */
const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [130] }, content: [para(t)] });
const TABLE = () => ({ type: "table", content: ["A", "B", "C"].map((r) => ({ type: "tableRow", content: [1, 2, 3].map((c) => cell(`${r}${c}`)) })) });
const box = (aid, x, y, content, w = 440) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content });
const DOC = () => [box("tb", 40, 40, [TABLE()]), box("tx", 40, 330, [para("Other box")]), para("")];
const TREE = { v: 3, tombs: [], trash: [], pages: [{ id: "ms1", title: "Multi-select check (throwaway)", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] };

async function seed() {
  if (live) {
    // signed in: build the throwaway note through the app's own storage seam under the account's scope
    await page.goto(`${BASE}/#/notes`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"], [data-testid="notes-new-page"], button:has-text("Page")', { timeout: 40000 });
  } else {
    await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  }
  const scope = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("planyr:notes:tree:v1:"));
    return k ? k.slice("planyr:notes:tree:v1:".length) : "local";
  });
  await page.evaluate(([tree, doc, scopeId]) => {
    if (scopeId === "local") localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    const existing = (() => { try { return JSON.parse(localStorage.getItem(`planyr:notes:tree:v1:${scopeId}`) || "null"); } catch { return null; } })();
    const t = existing && Array.isArray(existing.pages) ? existing : tree;
    if (!t.pages.some((p) => p.id === "ms1")) t.pages.unshift(tree.pages[0]);
    localStorage.setItem(`planyr:notes:tree:v1:${scopeId}`, JSON.stringify(t));
    localStorage.setItem(`planyr:notes:page:v1:${scopeId}:ms1`, JSON.stringify({ type: "doc", content: doc }));
    localStorage.setItem(`planyr:notes:activePage:v1:${scopeId}`, "ms1");
  }, [TREE, DOC(), scope]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 });
  await pacedWait(page, 900);
  return scope;
}
const scope = await seed();
const PK = `planyr:notes:page:v1:${scope}:ms1`;

/* ── instruments ───────────────────────────────────────────────────────────────────────── */
const cellEl = (text) => page.locator(`.ProseMirror td:has-text("${text}"), .ProseMirror th:has-text("${text}")`).first();
async function press(text, mods = []) {
  const b = await cellEl(text).boundingBox();
  if (!b) throw new Error(`no cell ${text}`);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await pacedWait(page, 50); await page.mouse.up();
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
  await pacedWait(page, 250);
}
const selected = () => page.evaluate(() => [...document.querySelectorAll(".ProseMirror .selectedCell")].map((c) => c.textContent.trim()).sort());
const storedDoc = async () => { await pacedWait(page, 1500); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PK) || "null"); };
function cellsOf(doc) {
  const out = [];
  const w = (n) => { if (!n) return; if (n.type === "tableCell" || n.type === "tableHeader") { const texts = [], marks = new Set(); const t = (m) => { if (m.text) { texts.push(m.text); (m.marks || []).forEach((k) => marks.add(k.type)); } (m.content || []).forEach(t); }; t(n); out.push({ t: texts.join(""), bold: marks.has("bold"), fill: n.attrs?.background ?? null }); return; } (n.content || []).forEach(w); };
  w(doc); return out;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 0. enter the box; known-good arm ─────────────────────────────────────────────────── */
console.log("\n0. Entering the table box (two presses: select, then enter)");
await press("A1"); await press("A1");
await press("B2");
ok("[known-good] a plain click in the entered box puts the caret in a cell and highlights none", eq(await selected(), []));
if (!results.every((r) => r.cond)) { console.log("VOID — the known-good arm failed."); process.exit(1); }

/* ── A. Ctrl+click adds cells ─────────────────────────────────────────────────────────── */
console.log("\nA. Ctrl+click adds cells");
await press("A1");
await press("C3", ["Control"]);
await press("A3", ["Control"]);
ok("A1, C3 and A3 (and only those) are highlighted", eq(await selected(), ["A1", "A3", "C3"]), JSON.stringify(await selected()));
await press("C3", ["Control"]);
ok("Ctrl+click on a highlighted cell takes just that cell out", eq(await selected(), ["A1", "A3"]), JSON.stringify(await selected()));
await press("B2", ["Control"]);
ok("…and B2 joins", eq(await selected(), ["A1", "A3", "B2"]), JSON.stringify(await selected()));

/* ── B. formatting reaches every selected cell ────────────────────────────────────────── */
console.log("\nB. Bold (Ctrl+B) and a fill reach every selected cell — read from the STORED document");
await page.keyboard.press("Control+b"); await pacedWait(page, 300);
await page.locator('[data-testid="nt-fill"]').click(); await pacedWait(page, 200);
await page.locator('[data-testid="nt-fill-yellow"]').click(); await pacedWait(page, 300);
ok("the three cells are still highlighted after formatting", eq(await selected(), ["A1", "A3", "B2"]), JSON.stringify(await selected()));
{
  const cs = cellsOf(await storedDoc());
  const boldCells = cs.filter((c) => c.bold).map((c) => c.t).sort();
  const filled = cs.filter((c) => c.fill).map((c) => c.t).sort();
  ok("bold is stored on A1, A3 and B2 — and nowhere else", eq(boldCells, ["A1", "A3", "B2"]), JSON.stringify(boldCells));
  ok("the yellow fill is stored on A1, A3 and B2 — and nowhere else", eq(filled, ["A1", "A3", "B2"]) && cs.filter((c) => c.fill).every((c) => c.fill.toLowerCase() === "#fef08a"), JSON.stringify(filled));
}
await page.locator('[data-testid="nt-fill"]').click(); await pacedWait(page, 200);
await page.locator('[data-testid="nt-fill-none"]').click(); await pacedWait(page, 300);
{
  const cs = cellsOf(await storedDoc());
  ok("un-fill (No fill) clears every selected cell", cs.every((c) => !c.fill), JSON.stringify(cs.filter((c) => c.fill)));
}
await page.keyboard.press("Control+b"); await pacedWait(page, 300);
{
  const cs = cellsOf(await storedDoc());
  ok("Ctrl+B again un-bolds all three", cs.every((c) => !c.bold), JSON.stringify(cs.filter((c) => c.bold).map((c) => c.t)));
}

/* ── C. one undo step ─────────────────────────────────────────────────────────────────── */
console.log("\nC. Ctrl+Z reverts a multi-cell format in ONE step");
await page.keyboard.press("Control+b"); await pacedWait(page, 300);
await page.keyboard.press("Control+z"); await pacedWait(page, 400);
{
  const cs = cellsOf(await storedDoc());
  ok("one Ctrl+Z un-bolds every cell the single Ctrl+B bolded", cs.every((c) => !c.bold), JSON.stringify(cs.filter((c) => c.bold).map((c) => c.t)));
}

/* ── D. refusals are loud ─────────────────────────────────────────────────────────────── */
console.log("\nD. What can't run on several ranges says so");
await press("A1"); await press("C3", ["Control"]);
await page.locator('[data-testid="nt-row-after"]').click(); await pacedWait(page, 500);
ok("Row ↓ with two ranges shows the message", /multiple selections/i.test(await page.evaluate(() => document.body.innerText)));
ok("…and added no row", (await page.locator(".ProseMirror tr").count()) === 3);

/* ── E. plain click collapses; a Ctrl+click on a box that is NOT entered only selects the box ──────── */
console.log("\nE. A plain click collapses; the box machinery is untouched");
await press("B3");
ok("a plain click collapses to a caret (nothing highlighted)", eq(await selected(), []));
await press("A1", ["Control"]);
ok("after a plain click, Ctrl+click starts a fresh multi-selection (B3's cell + A1)", eq(await selected(), ["A1", "B3"]), JSON.stringify(await selected()));
// click away onto the other box (stage 1: selects THAT box), then Ctrl+click the (now un-entered) table
await page.locator('.planyr-anchor:has-text("Other box")').first().click({ position: { x: 20, y: 10 } }); await pacedWait(page, 300);
await press("C1", ["Control"]);
ok("Ctrl+click on a table that is not entered adds NO multi-selection", eq(await selected(), []), JSON.stringify(await selected()));

ok("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
if (signed) await signed.close(); else await browser.close();
console.log(`\n${passN}/${passN + failN} passed`);
process.exit(failN ? 1 : 0);
