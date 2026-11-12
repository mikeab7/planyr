#!/usr/bin/env node
/* verify-notes-click-after-paste-live — NEW-3 (owner report 2026-11-12 1:43 PM): after an Outlook outline is pasted, a click on a line ABOVE the
 * caret must place the caret exactly there ("the caret jumps right back to where it was"). Signed in as the TEST account on a real deploy, on a
 * THROWAWAY page it creates and deletes. Everything the owner's session had that a sandbox usually lacks is here: a REAL clipboard and a real
 * Ctrl+V (trusted input → autosave runs), the cloud-sync round trip (we wait for it, then click AGAIN), the paste-options chip showing, and
 * the menu open (Ctrl tap) / closed (Escape). The clicks are judged by WHERE THE CARET IS, read from the browser's own selection — and the
 * click point is proven to land on the editor first (`elementFromPoint`), because a click that hit the toolbar or sat off-screen is the
 * instrument's fault, not the app's (AGENT-RULES; it nearly filed a false bug during this work).
 * `BASE_URL` (default https://planyr.io) · `FIXTURE` (default owa-recopy-restart-blanks, from test/fixtures/clipboard-bank). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/clipboard-bank");
const name = process.env.FIXTURE || "owa-recopy-restart-blanks";
const fx = { html: fs.readFileSync(path.join(FX, `${name}.html`), "utf8"), text: fs.readFileSync(path.join(FX, `${name}.txt`), "utf8") };
const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE }); }
  catch (e) { if (!/answered 5\d\d/.test(String(e)) || i === 11) throw e; console.log("sign-in route 5xx, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await s.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => {});
await assertMeasurable(page, "verify-notes-click-after-paste-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build, "· fixture", name);
if (process.env.EXPECT_BUILD) ok(`served build is ${process.env.EXPECT_BUILD}`, String(build.build).startsWith(process.env.EXPECT_BUILD), JSON.stringify(build));

const TITLE = "ZZ throwaway click after paste " + Date.now().toString(36);
await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
await page.waitForTimeout(3500);
const before = await page.locator('[data-testid^="notes-row-"]').count();
let n = 0;
const newPage = async () => {
  n += 1;
  await page.locator('[data-testid="notes-new-page"]').first().click();
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await page.locator('[data-testid="note-title"]').fill(`${TITLE} ${n}`);
  await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await page.waitForTimeout(800);
};
const arm = async () => {
  const at = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * 0.08, y: r.top + r.height * 0.12 }; });
  await page.mouse.dblclick(at.x, at.y); await page.waitForTimeout(500);
  return page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]'));
};
const realPaste = async () => {
  await page.evaluate(async ([h, t]) => { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([t], { type: "text/plain" }) })]); }, [fx.html, fx.text]);
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(1500);
};
const caret = () => page.evaluate(() => {
  const sel = getSelection(); const nd = sel.anchorNode; const el = nd && (nd.nodeType === 3 ? nd.parentElement : nd);
  const para = el && el.closest && el.closest("p");
  return { text: para ? para.textContent.slice(0, 30) : null, off: sel.anchorOffset, inEditor: !!(el && el.closest && el.closest(".ProseMirror")), chip: !!document.querySelector("[data-testid='note-paste-badge']") };
});
/* click the END of the first paragraph whose text starts with `starts`; proves the point is on the editor's own text first */
const clickLine = async (starts) => {
  const pt = await page.evaluate((st) => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((x) => x.textContent.includes(st));
    if (!p) return null;
    const mat = document.querySelector("[data-testid='note-mat']"); if (mat) { const r = p.getBoundingClientRect(), m = mat.getBoundingClientRect(); if (r.top < m.top + 60 || r.bottom > m.bottom - 20) mat.scrollTop += r.top - (m.top + m.height / 2); }
    const range = document.createRange(); range.selectNodeContents(p); const b = range.getBoundingClientRect();
    const x = Math.round(b.right) - 3, y = Math.round(b.top + b.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, onText: !!(hit && hit.closest && hit.closest(".ProseMirror")) };
  }, starts);
  if (!pt) return { found: false };
  await page.waitForTimeout(250);
  const again = await page.evaluate(([x, y]) => { const h = document.elementFromPoint(x, y); return !!(h && h.closest && h.closest(".ProseMirror")); }, [pt.x, pt.y]);
  if (!again) return { found: true, onText: false };
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  const a = await caret(); await page.waitForTimeout(700); const b = await caret();
  return { found: true, onText: true, now: a, later: b };
};

const check = async (label, starts) => {
  const r = await clickLine(starts);
  if (!r.found) return ok(`${label}: the line "${starts}" exists`, false);
  if (!r.onText) return ok(`${label}: INSTRUMENT — the click point for "${starts}" is not on the editor (covered/off-screen); this check is VOID`, false);
  ok(`${label}: a click at the end of "${starts}" puts the caret there`, !!r.now.text && r.now.text.includes(starts.slice(0, 12)) && r.now.inEditor, JSON.stringify(r.now));
  ok(`${label}: …and it STAYS there (not snapped back)`, !!r.later.text && r.later.text.includes(starts.slice(0, 12)), JSON.stringify(r.later));
};

try {
  const flows = [
    ["chip showing", async () => {}],
    ["menu open (Ctrl tap)", async () => { await page.keyboard.down("Control"); await page.keyboard.up("Control"); await page.waitForTimeout(300); }],
    ["menu opened then Escape", async () => { await page.keyboard.down("Control"); await page.keyboard.up("Control"); await page.waitForTimeout(250); await page.keyboard.press("Escape"); await page.waitForTimeout(250); }],
    ["after the save + sync settle (6 s)", async () => { await page.waitForTimeout(6000); }],
  ];
  for (const [label, act] of flows) {
    console.log(`\n[${label}]`);
    await newPage();
    ok("a double-click on blank paper armed a caret", await arm());
    await realPaste();
    await act();
    const lines = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror li > p, .ProseMirror > div > p, .ProseMirror p")].map((p) => p.textContent.trim()).filter(Boolean).slice(0, 3));
    console.log("   pasted; first lines:", JSON.stringify(lines));
    await check(label, "Baytown Submittal");
    await check(label, "Final Plat");
    await check(label, "Updates in red");
  }
  console.log("\n[a plain TYPED list, nothing pasted]");
  await newPage();
  ok("armed", await arm());
  await page.keyboard.type("Alpha line"); await page.keyboard.press("Enter"); await page.keyboard.type("Beta line"); await page.keyboard.press("Enter"); await page.keyboard.type("Gamma line");
  await page.waitForTimeout(500);
  await check("typed lines", "Alpha line");
} finally {
  console.log("\n[cleanup] deleting the throwaway pages");
  try {
    for (let g = 0; g < 12 && (await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count()); g++) {
      const row = page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first();
      await row.click({ button: "right" }); await page.waitForTimeout(300);
      await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click(); await page.waitForTimeout(800);
      const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
      if (await yes.count()) { await yes.click(); await page.waitForTimeout(1200); }
    }
  } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 200)); }
  const left = await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count();
  ok("the throwaway pages are gone from the list", left === 0);
}
ok("no page error", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await s.close();
process.exit(fail ? 1 : 0);
