#!/usr/bin/env node
/* verify-notes-table-paste-live — V1559744 / B2142464. Signed in as the TEST account on a real deploy,
 * on a THROWAWAY page it creates and deletes: pastes the committed OneNote fixtures (exact bytes via a
 * real paste event, plus a real Ctrl+V through the browser clipboard) and reads the table back off the
 * rendered page. `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { loadFixture, TINY_PNG_B64 } from "./lib/clipboardTableFixtures.mjs";

const BASE = process.env.BASE_URL || "https://planyr.io";
// The sign-in route answers an intermittent 502 right after a deploy; retry only that, never anything else.
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE, contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-table-paste-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };

const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, build.build === process.env.EXPECT_BUILD, JSON.stringify(build));

const TITLE = "ZZ throwaway table paste " + Date.now().toString(36);
await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
const before = await page.locator('[data-testid^="notes-row-"]').count();
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
await page.locator('[data-testid="note-title"]').fill(TITLE);
await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
await page.waitForTimeout(800);

async function dataTransferPaste(html, text, png) {
  await page.evaluate(([h, t, p]) => {
    const dt = new DataTransfer();
    if (h) dt.setData("text/html", h);
    dt.setData("text/plain", t);
    if (p) { const bin = Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); dt.items.add(new File([bin], "image.png", { type: "image/png" })); }
    (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html, text, png]);
  await page.waitForTimeout(1500);
}
const tables = () => page.evaluate(() => [...document.querySelectorAll(".ProseMirror table")].map((t) => [...t.rows].map((r) => [...r.cells].map((c) => ({ t: c.innerText.split(String.fromCharCode(10)).map((x) => x.split(String.fromCharCode(160)).join(" ").trim()).filter(Boolean).join(String.fromCharCode(10)), span: c.colSpan })))));
const GRID = [["Unit", "Area (SF)", "Notes"], ["A-100", "12,500", "Dock high and cross-docked"], ["A-200", "", "Line one\nLine two"], ["B-300", "8,200", "Survey"]];
const same = (t) => !!t && JSON.stringify(t.map((r) => r.map((c) => c.t))) === JSON.stringify(GRID);
async function arm(fx, fy) {
  const at = await page.evaluate(([a, b]) => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * a, y: r.top + r.height * b }; }, [fx, fy]);
  await page.mouse.dblclick(at.x, at.y); await page.waitForTimeout(500);
  return page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]'));
}

try {
  const d = loadFixture("onenote-desktop"), w = loadFixture("onenote-web");
  console.log("\n[1] OneNote DESKTOP clipboard (html + text) on blank paper");
  ok("a double-click on blank paper armed a caret", await arm(0.5, 0.2));
  await dataTransferPaste(d.html, d.text);
  let t = await tables();
  ok("one table arrived, 4 rows × 3 columns, every cell's text intact (empty cell empty, two-line cell kept)", t.length === 1 && same(t[0]), JSON.stringify(t));
  ok("bold / italic / link kept inside cells", await page.evaluate(() => !!document.querySelector(".ProseMirror table strong") && !!document.querySelector(".ProseMirror table em") && !!document.querySelector('.ProseMirror table a[href="https://example.com/survey"]')));
  ok("the paste-options chip is offered", await page.locator('[data-testid="note-paste-badge"]').count() > 0);

  console.log("\n[2] OneNote WEB clipboard + a picture of the table beside it, on a second spot");
  ok("armed a second spot", await arm(0.5, 0.75));
  await dataTransferPaste(w.html, w.text, TINY_PNG_B64);
  t = await tables();
  ok("a second table arrived (not a picture), same content", t.length === 2 && same(t[1]), JSON.stringify(t[1]));
  ok("no picture was pasted", await page.locator(".ProseMirror img, .planyr-note-image").count() === 0);

  console.log("\n[3] a REAL Ctrl+V through the browser clipboard, with nothing focused");
  const frag = d.html.replace(/^[\s\S]*<!--StartFragment-->/, "").replace(/<!--EndFragment-->[\s\S]*$/, "");
  await page.evaluate(async ([h, tx]) => {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([tx], { type: "text/plain" }) })]);
    document.activeElement?.blur?.();
  }, [frag, d.text]);
  await page.keyboard.press("Control+V"); await page.waitForTimeout(1800);
  t = await tables();
  ok("a third table arrived from a real Ctrl+V", t.length === 3 && same(t[2]), `tables=${t.length}`);
  await page.screenshot({ path: process.env.SHOT || "/tmp/claude-0/live-table-paste.png" });
} finally {
  console.log("\n[cleanup] deleting the throwaway page");
  try {
    const row = page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first();
    await row.click({ button: "right" });
    await page.waitForTimeout(300);
    await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click();
    await page.waitForTimeout(800);
    // inline confirm row ("Delete? ✓ ✕")
    const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
    if (await yes.count()) { await yes.click(); await page.waitForTimeout(1200); }
  } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 200)); }
  const left = await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count();
  ok("the throwaway page is gone from the list", left === 0);
  const after = await page.locator('[data-testid^="notes-row-"]').count();
  ok("page count is back to what it was", after === before, `${before} → ${after}`);
}
ok("no page error", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await s.close();
process.exit(fail ? 1 : 0);
