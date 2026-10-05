/* verify-notes-title-header — page title header (NEW-1..5, owner 2026-10-05).
 * Title defaults to 16 and a user-set size survives reload; meta + placeholder smaller than the title;
 * no project chip; title box hugs its text and the band beside it is page (double-click places a note);
 * a selected title clears on a double-click / click elsewhere. Real mouse, local fixture. */
import { chromium } from "playwright";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local", PAGE_KEY = "planyr:notes:page:v1:local:p1";
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await assertMeasurable(page, "verify-notes-title-header");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
await pacedWait(page, 250);
const seed = (title, titleStyle) => page.evaluate(([tk, pk, t, ts]) => {
  localStorage.clear();
  localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: t, createdAt: 1, updatedAt: Date.now(), projectId: null, pages: [] }] }));
  localStorage.setItem(pk, JSON.stringify({ type: "doc", attrs: ts ? { titleStyle: ts } : {}, content: [{ type: "paragraph", content: [{ type: "text", text: "Body line one." }] }] }));
}, [TREE_KEY, PAGE_KEY, title, titleStyle]);
const load = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 }); await pacedWait(page, 700); };
const tb = (id) => page.locator(`[data-testid="${id}"]`);
const fs = (id) => page.evaluate((i) => parseFloat(getComputedStyle(document.querySelector(`[data-testid="${i}"]`)).fontSize), id);

await seed("Site Design"); await load();
ok("NEW-1 title defaults to 16", (await fs("note-title")) === 16, await fs("note-title"));
ok("NEW-2 edited line smaller than title", (await fs("note-edited")) < 16);
ok("NEW-3 no project chip", (await tb("note-project-badge").count()) === 0);
const tr = await tb("note-title").boundingBox(), sr = await tb("note-sheet").boundingBox();
ok("NEW-4 title box hugs its text (much narrower than the page)", tr.width < sr.width * 0.4, `${Math.round(tr.width)} vs ${Math.round(sr.width)}`);
ok("NEW-4 title box is one line tall", tr.height < 40, Math.round(tr.height));

// NEW-4: double-click in the band right of the title places a note
const before = await page.locator(".planyr-anchor").count();
const x = tr.x + tr.width + 150, y = tr.y + tr.height / 2;
await page.mouse.click(x, y); await pacedWait(page, 120); await page.mouse.dblclick(x, y); await pacedWait(page, 300); await page.keyboard.type("Hi"); await pacedWait(page, 400);
ok("NEW-4 double-click beside the title starts a note", (await page.locator(".planyr-anchor").count()) > before);

// NEW-5: selection clears
const matBox = await tb("note-mat").boundingBox();
for (const [label, target] of [["blank page double-click", () => [tr.x + tr.width + 300, tr.y + 300]], ["grey mat click", () => { const m = matBox; return [m.x + 6, m.y + 400]; }], ["body text double-click", null]]) {
  await seed("Site Design"); await load();
  await tb("note-title").click(); await tb("note-title").evaluate((el) => el.select());
  let px, py;
  if (target) [px, py] = target(); else { const b = await page.locator(".ProseMirror p").first().boundingBox(); px = b.x + 20; py = b.y + 8; }
  if (label.includes("double")) { await page.mouse.click(px, py); await pacedWait(page, 100); await page.mouse.dblclick(px, py); } else await page.mouse.click(px, py);
  await pacedWait(page, 300);
  const st = await page.evaluate(() => { const t = document.querySelector('[data-testid="note-title"]'); return { focused: document.activeElement === t, sel: t.selectionEnd - t.selectionStart }; });
  ok(`NEW-5 ${label} clears the title highlight`, !st.focused && st.sel === 0, JSON.stringify(st));
}
// user-set size round-trips
await seed("Site Design", { fontSize: 24 }); await load();
ok("user-set title size (24) kept after reload", (await fs("note-title")) === 24);
await browser.close();
if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
console.log("\nall passed");
