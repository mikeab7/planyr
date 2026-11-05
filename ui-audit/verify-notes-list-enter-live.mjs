#!/usr/bin/env node
/* verify-notes-list-enter-live — V2008753 / B2557985. Signed in as the TEST account on a real deploy, on a THROWAWAY page it
 * creates and deletes: (1) a Word outline pasted onto blank paper, Enter at the end of a level-1, a level-3 and a level-4 item
 * continues the list at that level; (2) a note holding the shape the OLD paste stored (paragraphs that begin with the glyph) opens
 * as real lists, Enter at the end of the level-2 line makes a level-2 sibling, and after a RELOAD the new item is still a real
 * list item at level 2. Judged on the RENDERED lists, with the served /version.json + entry chunk read in the same run.
 * ⛔ The Word markup is a SYNTHETIC model (test/fixtures/clipboard-lists). `BASE_URL` (default https://planyr.io) ·
 * `EXPECT_BUILD=<sha>` · `SHOT` = screenshot prefix. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/clipboard-lists");
const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-list-enter-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const SHOT = process.env.SHOT || "/tmp/claude-0/live-list-enter";
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, String(build.build).startsWith(process.env.EXPECT_BUILD) || build.build === process.env.EXPECT_BUILD, JSON.stringify(build));
console.log("served entry chunk(s):", (await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /index-/.test(x)))).join(", "));
// the E2E hook (insertContent for the legacy shape) arms from a flag set BEFORE the app mounts
await page.addInitScript(() => { window.__PLANYR_E2E = true; });

const TITLE = "ZZ throwaway list enter " + Date.now().toString(36);
const open = async () => { await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" }); await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 }); await page.waitForTimeout(3500); };
await open();
const before = await page.locator('[data-testid^="notes-row-"]').count();
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
await page.locator('[data-testid="note-title"]').fill(TITLE);
await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
await page.waitForTimeout(800);

const lists = () => page.evaluate(() => {
  const out = [];
  const walk = (ul, d) => [...ul.children].forEach((li, i) => {
    const p = li.querySelector(":scope > p");
    out.push(`${"  ".repeat(d)}${ul.tagName === "OL" ? `${i + 1}.` : "•"} ${(p ? p.textContent : "").trim()}`);
    li.querySelectorAll(":scope > ul, :scope > ol").forEach((n) => walk(n, d + 1));
  });
  document.querySelectorAll(".ProseMirror > .planyr-anchor > .planyr-anchor-content > ul, .ProseMirror .planyr-anchor-content > ul, .ProseMirror .planyr-anchor-content > ol").forEach((ul) => walk(ul, 0));
  return out;
});
async function clickEnd(needle) {
  const p = await page.evaluate((n) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) { const i = node.nodeValue.indexOf(n); if (i < 0) continue; const r = document.createRange(); r.setStart(node, i + n.length); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) }; }
    return null;
  }, needle);
  if (!p) throw new Error(`could not find "${needle}"`);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
}
const enterAt = async (needle) => { await clickEnd(needle); await page.waitForTimeout(650); await clickEnd(needle); await page.keyboard.press("End"); };

let got;
try {
  console.log("\n[1] a note holding the OLD paste's shape (paragraphs that begin with the glyph)");
  const GAP = " ".repeat(7);
  const fake = (g, w) => ({ type: "paragraph", content: [{ type: "text", text: g }, { type: "text", text: GAP }, { type: "text", text: w }] });
  const inserted = await page.evaluate((nodes) => window.__noteEditor ? window.__noteEditor.runCommand("insertContent", nodes) : "nohook", [{ type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid: "legacy1" }, content: [fake("•", "LEED"), fake("○", "1M SF - $90K"), fake("§", "Third level"), fake("□", "Fourth level"), fake("•", "Next")] }]);
  ok("the legacy-shaped box was placed on the throwaway page", inserted === true, String(inserted));
  await page.waitForTimeout(2500);                                        // the save debounce + a cloud push
  await open();                                                           // re-open: the normaliser runs on read
  await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first().click();
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  got = await lists();
  ok("the legacy box opens as real nested lists (LEED › 1M SF › Third › Fourth)", got.includes("• LEED") && got.includes("  • 1M SF - $90K") && got.includes("    • Third level") && got.includes("      • Fourth level"), JSON.stringify(got));
  await enterAt("1M SF - $90K"); await page.keyboard.press("Enter"); await page.keyboard.type("400K SF - $85K", { delay: 25 }); await page.waitForTimeout(500);
  got = await lists();
  const j = got.findIndex((l) => l === "  • 1M SF - $90K");
  ok("Enter at the end of the level-2 line makes a level-2 sibling (the owner's exact case)", j >= 0 && got[j + 1] === "  • 400K SF - $85K", JSON.stringify(got));
  await page.screenshot({ path: `${SHOT}-2-legacy-enter.png` });
  await page.waitForTimeout(2500);
  await open();
  await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first().click();
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const after = await lists();
  const k = after.findIndex((l) => l === "  • 1M SF - $90K");
  ok("after a RELOAD the new item is still a real level-2 list item", k >= 0 && after[k + 1] === "  • 400K SF - $85K", JSON.stringify(after));
  console.log("\n[2] a Word outline pasted on blank paper; Enter at levels 1, 3 and 4");
  const at = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * 0.08, y: r.top + r.height * 0.7 }; });
  await page.mouse.dblclick(at.x, at.y); await page.waitForTimeout(500);
  ok("a double-click on blank paper armed a caret", await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]')));
  const html = fs.readFileSync(path.join(FX, "word-outline-table.html"), "utf8"), text = fs.readFileSync(path.join(FX, "word-outline-table.txt"), "utf8");
  await page.evaluate(([h, t]) => { const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t); (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, [html, text]);
  await page.waitForTimeout(1800);
  got = await lists();
  ok("the outline pasted as real nested lists", got.includes("• Soft costs") && got.includes("  • Design and engineering") && got.includes("    • Fee by building size, per square foot"), JSON.stringify(got));
  for (const [needle, depth] of [["Hard costs", 0], ["Impact fees are charged per lot", 2], ["Fees step down as the building gets larger", 3]]) {
    await enterAt(needle); await page.keyboard.press("Enter"); await page.keyboard.type("NEW" + depth, { delay: 25 }); await page.waitForTimeout(500);
    got = await lists();
    const i = got.findIndex((l) => l.endsWith(needle));
    ok(`Enter at the end of the level-${depth + 1} item makes a level-${depth + 1} sibling`, i >= 0 && got[i + 1] === `${"  ".repeat(depth)}• NEW${depth}`, JSON.stringify(got.slice(Math.max(0, i - 1), i + 3)));
  }
  await page.screenshot({ path: `${SHOT}-1-word-enter.png` });

} finally {
  console.log("\n[cleanup] deleting the throwaway page");
  try {
    const row = page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first();
    await row.click({ button: "right" });
    await page.waitForTimeout(300);
    await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click();
    await page.waitForTimeout(800);
    const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
    if (await yes.count()) { await yes.click(); await page.waitForTimeout(1200); }
  } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 200)); }
  ok("the throwaway page is gone from the list", (await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count()) === 0);
  ok("page count is back to what it was", (await page.locator('[data-testid^="notes-row-"]').count()) === before);
}
ok("no page error", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await s.close();
process.exit(fail ? 1 : 0);
