#!/usr/bin/env node
/* verify-notes-box-width-live — V1668992 / B2142464 ×3 + B2248944. Signed in as the TEST account on a real deploy, on a
 * THROWAWAY page it creates and deletes: (1) the committed OneNote fixture in the owner's shape (6 columns, a
 * merged header over three pairs, nested in a bullet) pasted onto blank paper lands in a box wide enough for all six
 * columns; (2) a new box starts wide; (3) it shrinks to its text when the page title is clicked. Read off the RENDERED
 * boxes (a signed-in account's storage is keyed by user id) with the served /version.json read in the same run.
 * `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs · `SHOT` = screenshot prefix. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { loadFixture } from "./lib/clipboardTableFixtures.mjs";

const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-box-width-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const SHOT = process.env.SHOT || "/tmp/claude-0/live-box-width";

const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, String(build.build).startsWith(process.env.EXPECT_BUILD) || build.build === process.env.EXPECT_BUILD, JSON.stringify(build));

const TITLE = "ZZ throwaway box width " + Date.now().toString(36);
await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
const before = await page.locator('[data-testid^="notes-row-"]').count();
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
await page.locator('[data-testid="note-title"]').fill(TITLE);
await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
await page.waitForTimeout(800);

async function arm(fx, fy) {
  const at = await page.evaluate(([a, b]) => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * a, y: r.top + r.height * b }; }, [fx, fy]);
  await page.mouse.dblclick(at.x, at.y); await page.waitForTimeout(500);
  return page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]'));
}
const boxes = () => page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((el) => {
  const t = el.querySelector("table");
  const first = t ? [...t.querySelector("tr").children].map((c) => ({ w: c.getBoundingClientRect().width, span: c.colSpan || 1 })) : null;
  return { w: Math.round(parseFloat(el.style.width)), rendered: Math.round(el.offsetWidth), hasTable: !!t, first, spill: t ? Math.round(t.getBoundingClientRect().right - el.getBoundingClientRect().right) : null, fit: el.getAttribute("data-anchor-fit"), x: parseFloat(el.style.left) };
}));
const clickOut = async () => { await page.locator('[data-testid="note-title"]').click(); await page.waitForTimeout(900); };

try {
  const fx = loadFixture("onenote-nested-in-li");
  console.log("\n[1] the OneNote-shape table (6 columns, merged header, nested in a bullet) on blank paper");
  ok("a double-click on blank paper armed a caret", await arm(0.08, 0.2));
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t);
    (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [fx.html, fx.text]);
  await page.waitForTimeout(1800);
  let b = await boxes();
  const tb = b.find((x) => x.hasTable);
  ok("a table arrived in a box", !!tb, JSON.stringify(b));
  if (tb) {
    ok(`the box is wide enough for all 6 columns (${tb.w} ≥ 600)`, tb.w >= 600, JSON.stringify(tb));
    ok("no column is squeezed below the readable floor", tb.first.every((c) => c.w >= c.span * 99), JSON.stringify(tb.first));
    ok("the table does not spill out of its box", tb.spill <= 1, `spill ${tb.spill}`);
  }
  await page.screenshot({ path: `${SHOT}-1-table-pasted.png` });

  console.log("\n[2] a NEW box starts wide");
  await clickOut();
  ok("a double-click on blank paper armed a second caret", await arm(0.08, 0.85));
  await page.keyboard.type("Hello world", { delay: 30 });
  await page.waitForTimeout(500);
  const col = await page.evaluate(() => document.querySelector('[data-testid="note-body"]').offsetWidth);
  b = await boxes();
  const nb = b.find((x) => !x.hasTable);
  const want = nb ? Math.max(240, Math.min(Math.min(col, 720), col - Math.max(0, nb.x) - 4)) : 0;
  ok(`the new box starts wide: ${nb && nb.w} (expected ${want}: the column ${col} or the room to the right of the click, floor 240)`, !!nb && nb.w === want && nb.w >= 240 && nb.fit === "1", JSON.stringify(b));
  await page.screenshot({ path: `${SHOT}-2-new-box-wide.png` });

  console.log("\n[3] click out → it shrinks to its text");
  await clickOut();
  b = await boxes();
  const sb = b.find((x) => !x.hasTable);
  ok(`the box shrank to its text (${sb && sb.w} < 200) and renders at that width`, !!sb && sb.w < 200 && Math.abs(sb.rendered - sb.w) <= 1, JSON.stringify(sb));
  const tb2 = b.find((x) => x.hasTable);
  ok("the table's box settled near its table's width, not narrower", !!tb2 && tb2.spill <= 1, JSON.stringify(tb2));
  await page.screenshot({ path: `${SHOT}-3-after-click-out.png` });
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
