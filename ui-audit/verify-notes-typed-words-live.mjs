#!/usr/bin/env node
/* verify-notes-typed-words-live — V2032368 / B2557985 ×2. Signed in as the TEST account on a real deploy, on a THROWAWAY page it creates and
 * deletes: a box of TYPED lines that only look like list markers ("Mr.  Jones will review.", "A.  Ryan to send", "1.  Entitlements", …) is
 * placed, saved, re-opened, edited (Enter at the end of the last line + a word) and re-opened again — every line must still be a plain
 * paragraph with its exact words, never a list. The glyph-bullet shape of an old pasted note must STILL open as real lists beside it.
 * Judged on the RENDERED page with the served /version.json and entry chunk read in the same run. `BASE_URL` (default https://planyr.io) ·
 * `EXPECT_BUILD=<sha>` · `SHOT` = screenshot prefix. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-typed-words-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const SHOT = process.env.SHOT || "/tmp/claude-0/live-typed-words";
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, String(build.build).startsWith(process.env.EXPECT_BUILD) || build.build === process.env.EXPECT_BUILD, JSON.stringify(build));
console.log("served entry chunk(s):", (await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /index-/.test(x)))).join(", "));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });

const TITLE = "ZZ throwaway typed words " + Date.now().toString(36);
const open = async () => { await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" }); await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 }); await page.waitForTimeout(3500); };
await open();
const before = await page.locator('[data-testid^="notes-row-"]').count();
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
await page.locator('[data-testid="note-title"]').fill(TITLE);
await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
await page.waitForTimeout(800);

const LINES = ["Mr.  Jones will review.", "Dr.  Smith to call", "No.  3 is the corner lot", "Re.  Utility easement", "A.  Ryan to send", "1.  Entitlements", "I.  Introduction", "Done.  Next steps follow.", "• typed bullet", "- typed dash", "o   hello world", "Total  $85K", "400K SF - $85K"];
const GAP = " ".repeat(7);
const para = (...t) => ({ type: "paragraph", content: t.map((x) => ({ type: "text", text: x })) });
const reopen = async () => {
  await page.waitForTimeout(2500);
  await open();
  await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first().click();
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
};
const typedLines = () => page.evaluate(() => [...document.querySelectorAll(".ProseMirror .planyr-anchor-content")].map((box) => [...box.children].map((c) => `${c.tagName}:${c.textContent.replace(/ /g, " ").trim()}`)));
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

try {
  const inserted = await page.evaluate((nodes) => window.__noteEditor ? window.__noteEditor.runCommand("insertContent", nodes) : "nohook", [
    { type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid: "typed1" }, content: LINES.map((l) => para(l)) },
    { type: "noteAnchor", attrs: { x: 40, y: 520, w: 460, h: null, aid: "glyph1" }, content: [para("·", GAP, "Kept bullet"), para("o", GAP, "Kept sub bullet")] },
  ]);
  ok("a box of typed lines and a box of old-style glyph bullets were placed", inserted === true, String(inserted));
  await reopen();
  let boxes = await typedLines();
  const typedBox = boxes.find((b) => b.some((l) => /Mr\./.test(l)));
  const glyphBox = boxes.find((b) => b.some((l) => /Kept bullet/.test(l)));
  ok("every typed line opens as a plain paragraph with its exact words (nothing deleted, no list)", !!typedBox && typedBox.length === LINES.length && LINES.every((l, i) => typedBox[i].replace(/\s+/g, " ") === `P:${l}`.replace(/\s+/g, " ")), JSON.stringify(typedBox));
  ok("the old-style glyph bullets still open as a real nested list beside it", !!glyphBox && glyphBox.some((l) => l.startsWith("UL:") && l.includes("Kept bullet")), JSON.stringify(glyphBox));
  await clickEnd("400K SF - $85K"); await page.waitForTimeout(650); await clickEnd("400K SF - $85K");
  await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.keyboard.type("tail", { delay: 25 }); await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT}-after-edit.png` });
  await reopen();
  boxes = await typedLines();
  const again = boxes.find((b) => b.some((l) => /Mr\./.test(l)));
  const words = ["Mr.", "Dr.", "No.", "Re.", "A.", "1.", "I.", "Done.", "typed bullet", "typed dash", "hello world", "Total", "400K SF"];
  ok("after the edit was saved and the page re-opened every typed word is still there as a plain paragraph", !!again && words.every((w) => again.some((l) => l.startsWith("P:") && l.includes(w))) && !again.some((l) => /^(OL|UL):/.test(l)), JSON.stringify(again));
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
