#!/usr/bin/env node
/* verify-notes-table-copy-paste-live — V1570768 / B2155520. Signed in as the TEST account on a real deploy, on a THROWAWAY
 * page it creates and deletes. The table is built by one paste (setup only); every step under test uses REAL keys, real
 * mouse and the real browser clipboard. `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>`. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE, contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-table-copy-paste-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, build.build === process.env.EXPECT_BUILD, JSON.stringify(build));

const TITLE = "ZZ throwaway table copy " + Date.now().toString(36);
const GRID = [["Item", "Qty", "Cost"], ["Slab", "12", "$5"], ["Steel", "7", "$9"]];
const HTML = `<table><tbody><tr><th>Item</th><th>Qty</th><th>Cost</th></tr><tr><td>Slab</td><td>12</td><td><b>$5</b></td></tr><tr><td>Steel</td><td>7</td><td>$9</td></tr></tbody></table>`;
const TEXT = GRID.map((r) => r.join("\t")).join("\n");
const tables = () => page.evaluate(() => [...document.querySelectorAll(".ProseMirror table")].map((t) => [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.trim()))));
const gridOk = (t) => !!t && JSON.stringify(t) === JSON.stringify(GRID);
const wait = (ms) => page.waitForTimeout(ms);
async function arm(fx, fy) {
  const at = await page.evaluate(([a, b]) => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * a, y: r.top + r.height * b }; }, [fx, fy]);
  await page.mouse.dblclick(at.x, at.y); await wait(500);
  return page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]'));
}
async function cellPoint(text) {
  return page.evaluate((n) => {
    const c = [...document.querySelectorAll(".ProseMirror td, .ProseMirror th")].find((x) => x.innerText.trim() === n);
    const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, text);
}
const click = async (n, o) => { const p = await cellPoint(n); await page.mouse.click(p.x, p.y, o); await wait(400); };
const readClip = () => page.evaluate(async () => { const out = {}; for (const it of await navigator.clipboard.read()) for (const t of it.types) out[t] = await (await it.getType(t)).text(); return out; });

await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
const before = await page.locator('[data-testid^="notes-row-"]').count();
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
await page.locator('[data-testid="note-title"]').fill(TITLE);
await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
await wait(800);
try {
  console.log("\n[setup] one table, built by a single paste");
  ok("armed blank paper", await arm(0.3, 0.15));
  await page.evaluate(([h, t]) => { const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t); (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, [HTML, TEXT]);
  await wait(1500);
  ok("source table is on the page", gridOk((await tables())[0]), JSON.stringify(await tables()));

  console.log("\n[2] BOX SELECTED (one press) → Ctrl+C → arm blank paper → Ctrl+V");
  await page.evaluate(() => document.activeElement?.blur?.());
  { const r = await page.evaluate(() => { const q = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: q.left + q.width * 0.85, y: q.top + q.height * 0.9 }; });
    await page.mouse.click(r.x, r.y); await wait(500); }          // one press on blank paper: nothing selected, nothing armed
  await click("Steel");                      // press 1 only selects the box
  await page.keyboard.press("Control+C"); await wait(600);
  const clip = await readClip();
  ok("the clipboard now holds the table (text/html with a <table>)", /<table/i.test(clip["text/html"] || ""), JSON.stringify(Object.keys(clip)));
  ok("…and text/plain is tab-separated rows", (clip["text/plain"] || "").replace(/\r/g, "").trim() === TEXT, JSON.stringify(clip["text/plain"]));
  ok("armed a second spot", await arm(0.3, 0.7));
  await page.keyboard.press("Control+V"); await wait(1800);
  let t = await tables();
  ok("a second intact table arrived in a new box; the original is untouched", t.length === 2 && gridOk(t[0]) && gridOk(t[1]), JSON.stringify(t));

  console.log("\n[3] caret in a cell → Select table → Ctrl+X → table gone → Ctrl+Z → back");
  await click("Slab"); await wait(700); await click("Slab");
  await page.locator('[data-testid="nt-table-select"]').click(); await wait(300);
  await page.keyboard.press("Control+X"); await wait(900);
  t = await tables();
  ok("the cut removed that table (one left, not an empty shell)", t.length === 1 && gridOk(t[0]), JSON.stringify(t));
  await page.keyboard.press("Control+Z"); await wait(900);
  t = await tables();
  ok("Ctrl+Z brings it back intact", t.length === 2 && gridOk(t[0]) && gridOk(t[1]), JSON.stringify(t));

  console.log("\n[4] cell range (2 × 2) → Ctrl+C → paste on blank paper");
  const a = await cellPoint("Item"), b = await cellPoint("7");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); await wait(300);
  await page.keyboard.press("Control+C"); await wait(600);
  await page.evaluate(() => document.activeElement?.blur?.());
  ok("armed a third spot", await arm(0.7, 0.45));
  await page.keyboard.press("Control+V"); await wait(1800);
  t = await tables();
  ok("a new 2-column table arrived holding the copied range's cells", t.length === 3 && t[2].flat().includes("Slab") && t[2][0].length === 2, JSON.stringify(t[2]));

  console.log("\n[6] right-click menu: Paste > Keep source formatting with a table on the clipboard");
  await page.evaluate(([h, tx]) => navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([tx], { type: "text/plain" }) })]), [HTML, TEXT]);
  const before6 = (await tables()).length;
  await click("Cost", { button: "right" }); await wait(600);
  const pasteItem = page.locator('[role="menuitem"]:has-text("Paste")').first();
  ok("the menu offers Paste", (await pasteItem.count()) > 0);
  if (await pasteItem.count()) {
    await pasteItem.hover(); await wait(400);
    const keep = page.locator('[role="menuitem"]:has-text("Keep source formatting")').first();
    if (await keep.count()) { await keep.click(); await wait(1800); }
  }
  t = await tables();
  ok("the menu paste added a table (or said so honestly — never a silent nothing)", t.length > before6, `tables ${before6} → ${t.length}`);
  await page.keyboard.press("Escape").catch(() => {});

  console.log("\n[reload] the pasted tables persist");
  await wait(2000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 }).catch(() => {});
  await wait(2000);
  const row = page.locator('[data-testid^="notes-row-"]', { hasText: TITLE }).first();
  if (await row.count()) { await row.click(); await wait(1500); }
  t = await tables();
  ok("every pasted table is still there after a reload", t.length >= 3, `tables=${t.length}`);
  await page.screenshot({ path: process.env.SHOT || "/tmp/claude-0/live-table-copy.png" });
} finally {
  console.log("\n[cleanup] deleting the throwaway page");
  try {
    const row = page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first();
    await row.click({ button: "right" }); await wait(300);
    await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click(); await wait(800);
    const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
    if (await yes.count()) { await yes.click(); await wait(1200); }
  } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 200)); }
  ok("the throwaway page is gone from the list", (await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count()) === 0);
  const after = await page.locator('[data-testid^="notes-row-"]').count();
  ok("page count is back to what it was", after === before, `${before} → ${after}`);
}
ok("no page error", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await s.close();
process.exit(fail ? 1 : 0);
