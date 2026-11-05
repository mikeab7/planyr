#!/usr/bin/env node
/* verify-notes-table-size-live — NEW-1 / NEW-2 / NEW-3 (2026-11-05), signed in as the TEST account on a real deploy, on a
 * THROWAWAY page it creates and deletes (Grand Port / any real notebook is never opened). The table is built by one paste
 * (setup only); every step under test uses the real mouse, real keys and the real toolbar. Judged on RENDERED sizes and row
 * heights, re-read after a RELOAD (the signed-in page comes back through the cloud-synced copy).
 *
 * Acceptance (from the brief): set a row to 9 → add a row below → type in it → reload → still 9. Plus: drag a row taller, then
 * shorter, reload, it held. `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` (the served build is read IN THE
 * SAME CALL as the assertions, per the live-measurement rule). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE, contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-table-size-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const wait = (ms) => page.waitForTimeout(ms);
const J = JSON.stringify;
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.getAttribute("src")).filter((x) => /index-|Notes-/.test(x)));
console.log("signed in as", s.proof.email, "· served build", build.build, "· entry chunks", J(chunks));
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, build.build === process.env.EXPECT_BUILD, J(build));

const TITLE = "ZZ throwaway table size " + Date.now().toString(36);
const HTML = `<table><tbody><tr><td>Permit</td><td>Number</td><td>Authority</td></tr><tr><td>TDLR</td><td></td><td>Texas Dept</td></tr><tr><td></td><td></td><td></td></tr></tbody></table>`;
const TEXT = "Permit\tNumber\tAuthority\nTDLR\t\tTexas Dept\n\t\t";
const sizes = () => page.evaluate(() => [...document.querySelector(".ProseMirror table").rows].map((r) => [...r.cells].map((c) => {
  const n = document.createTreeWalker(c, NodeFilter.SHOW_TEXT).nextNode();
  const el = n ? n.parentElement : c.querySelector("p");
  return Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
})));
const rowGeo = (r) => page.evaluate((i) => { const t = document.querySelector(".ProseMirror table").rows[i]; const b = t.getBoundingClientRect(); return { css: t.offsetHeight, scale: b.height / t.offsetHeight, bottom: b.bottom }; }, r);
const cellPoint = (r, c) => page.evaluate(([r, c]) => { const x = document.querySelector(".ProseMirror table").rows[r].cells[c].getBoundingClientRect(); return { x: Math.round(x.left + x.width / 2), y: Math.round(x.top + x.height / 2) }; }, [r, c]);
async function enter(r, c) { const p = await cellPoint(r, c); await page.mouse.click(p.x, p.y); await wait(650); await page.mouse.click(p.x, p.y); await wait(300); }
async function drag(a, b) { const p = await cellPoint(...a), q = await cellPoint(...b); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up(); await wait(300); }
async function pickSize(n) { await page.locator('[data-testid="nt-size"]').first().click(); await wait(250); await page.locator(`[data-testid="nt-size-opt-${n}"]`).first().click(); await wait(500); }
async function dragLine(r, dy) {
  const g = await rowGeo(r); const p = await cellPoint(r, 1);
  await page.mouse.move(p.x, g.bottom - 1); await page.mouse.move(p.x, g.bottom); await wait(150);
  await page.mouse.down(); await page.mouse.move(p.x, g.bottom + dy / 2, { steps: 5 }); await page.mouse.move(p.x, g.bottom + dy, { steps: 5 }); await page.mouse.up(); await wait(600);
  return g;
}
async function reopen() {
  await wait(2500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 }).catch(() => {});
  await wait(2000);
  const row = page.locator('[data-testid^="notes-row-"]', { hasText: TITLE }).first();
  if (await row.count()) { await row.click(); await wait(1800); }
}

await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
const before = await page.locator('[data-testid^="notes-row-"]').count();
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
await page.locator('[data-testid="note-title"]').fill(TITLE);
await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
await wait(800);
try {
  console.log("\n[setup] a 3 × 3 table (filled, empty-between, a whole empty row) built by one paste");
  const at = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.15 }; });
  await page.mouse.dblclick(at.x, at.y); await wait(500);
  await page.evaluate(([h, t]) => { const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t); (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, [HTML, TEXT]);
  await wait(1500);
  const base = await sizes();
  ok("the table is on the page", base.length === 3 && base[0].length === 3, J(base));
  const BASE_PX = base[0][0];

  console.log("\n[NEW-1] highlight the TDLR row (filled · empty · filled) and pick 9");
  await enter(1, 0); await drag([1, 0], [1, 2]);
  await pickSize(9);
  let g = await sizes();
  ok("all three cells of the row render 9 — the EMPTY one included", g[1].every((v) => v === 9), J(g));
  ok("the other rows are untouched", g[0].every((v) => v === BASE_PX) && g[2].every((v) => v === BASE_PX), J(g));

  console.log("\n[NEW-2] add a row below it, type in the new row");
  { const p = await cellPoint(1, 1); await page.mouse.click(p.x, p.y); await wait(300); }
  await page.locator('[data-testid="nt-row-after"]').click(); await wait(600);
  g = await sizes();
  ok("a row was added", g.length === 4, J(g));
  ok("the new row (empty) renders 9, cell by cell", g[2].every((v) => v === 9), J(g));
  { const p = await cellPoint(2, 0); await page.mouse.click(p.x, p.y); await wait(300); await page.keyboard.type("abc", { delay: 30 }); await wait(500); }
  g = await sizes();
  ok("the word typed into the new row's first cell renders 9", g[2][0] === 9, J(g));

  console.log("\n[reload] it is still 9 — in the row that was set AND in the new row, typed text included");
  await reopen();
  g = await sizes();
  const txt = await page.evaluate(() => [...document.querySelector(".ProseMirror table").rows].map((r) => [...r.cells].map((c) => c.innerText.trim())));
  ok("the typed word survived the reload", txt[2]?.[0] === "abc", J(txt));
  ok("row 2 (set to 9) still renders 9 in every cell", g[1].every((v) => v === 9), J(g));
  ok("the new row still renders 9 in every cell, the typed one included", g[2].every((v) => v === 9), J(g));

  console.log("\n[NEW-3] drag the line under row 1 taller, then shorter; reload; it held");
  await enter(1, 0);
  const h0 = await rowGeo(1);
  const l1 = await dragLine(1, 40);
  const h1 = await rowGeo(1);
  ok("dragging the line down made the row taller by the dragged amount", Math.abs((h1.css - h0.css) - 40 / l1.scale) < 3, `${h0.css} → ${h1.css}`);
  await reopen(); await enter(1, 0);
  const h2 = await rowGeo(1);
  ok("taller held after a reload", Math.abs(h2.css - h1.css) < 3, `${h1.css} → ${h2.css}`);
  const l3 = await dragLine(1, -20);
  const h3 = await rowGeo(1);
  ok("dragging the line up made it shorter", h3.css < h2.css - 8 && h3.css > h0.css - 1, `${h2.css} → ${h3.css} (text needs ${h0.css})`);
  await reopen();
  const h4 = await rowGeo(1);
  ok("shorter held after a reload", Math.abs(h4.css - h3.css) < 3, `${h3.css} → ${h4.css}`);
  void l3;
  await page.screenshot({ path: process.env.SHOT || "/tmp/claude-0/live-table-size.png" });
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
