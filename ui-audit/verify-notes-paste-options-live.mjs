#!/usr/bin/env node
/* verify-notes-paste-options-live — V1944320 / B2494096. THE OFFICE-STYLE PASTE OPTIONS ON A REAL DEPLOY.
 *
 * Signed in as the TEST account on planyr.io, on a THROWAWAY page it creates and deletes (constraint 15): pastes the committed
 * Excel clipboard and Word-style text with a real paste event, opens the flyout with the real Ctrl key, picks every option, undoes
 * each with Ctrl+Z, and reads the document back off the live editor (the E2E read hook, armed by the harness before the page mounts).
 * It proves the WIRING on a deploy; the full 138-check matrix is `verify-notes-paste-options.mjs`, run against the build.
 *
 * `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { loadFixture } from "./lib/clipboardTableFixtures.mjs";

const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE, contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-paste-options-live");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
let pass = 0; let fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const wait = (ms) => page.waitForTimeout(ms);
const SHOT = process.env.SHOTS || "";

const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, build.build === process.env.EXPECT_BUILD, JSON.stringify(build));

const excel = loadFixture("excel");
const TITLE = "ZZ throwaway paste options " + Date.now().toString(36);
await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
const before = await page.locator('[data-testid^="notes-row-"]').count();
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
await page.locator('[data-testid="note-title"]').fill(TITLE);
await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
await wait(800);
await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 15000 });

const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const BOX_DOC = { type: "doc", content: [{ type: "noteAnchor", attrs: { x: 40, y: 40, w: 420, h: null, aid: "b1" }, content: [para("Intro line")] }, para("")] };
const json = () => page.evaluate(() => window.__noteEditor.json());
const walk = (n, f) => { if (!n) return; f(n); (n.content || []).forEach((c) => walk(c, f)); };
const firstOf = (doc, t) => { let h = null; walk(doc, (n) => { if (!h && n.type === t) h = n; }); return h; };
const countType = (doc, t) => { let c = 0; walk(doc, (n) => { if (n.type === t) c += 1; }); return c; };
const cellWords = (c) => { const o = []; walk(c, (n) => { if (n.type === "paragraph") { const r = []; walk(n, (m) => { if (m.text) r.push(m.text); else if (m.type === "hardBreak") r.push(" "); }); o.push(r.join("").trim()); } }); return o.filter(Boolean).join(" "); };
const gridOf = (t) => (t?.content || []).map((r) => (r.content || []).map(cellWords));
const marksIn = (n) => { const m = new Set(); walk(n, (x) => (x.marks || []).forEach((k) => m.add(k.type))); return [...m]; };
const tableJson = (d) => JSON.stringify(firstOf(d, "table"));

async function clickAtEnd(needle) {
  const p = await page.evaluate((n) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i + n.length); r.collapse(true);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, needle);
  if (!p) throw new Error(`could not find "${needle}"`);
  await page.mouse.click(p.x, p.y);
  await wait(250);
}
async function freshBox() {
  await page.evaluate((d) => window.__noteEditor.setDoc(d), BOX_DOC);
  await wait(600);
  await clickAtEnd("Intro line"); await wait(650); await clickAtEnd("Intro line");   // press 1 selects the box, press 2 enters it
}
async function paste(html, text) {
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer();
    if (h) dt.setData("text/html", h);
    if (t != null) dt.setData("text/plain", t);
    (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html, text]);
  await wait(1300);
}
const openFlyout = async () => { await page.keyboard.press("Control"); await wait(300); };
const btns = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="note-paste-options"] button.planyr-paste-btn')].map((b) => ({ id: b.getAttribute("data-testid").replace("note-paste-", ""), tip: b.getAttribute("data-tip"), pressed: b.getAttribute("aria-pressed") })));
const pickByClick = async (id) => { await openFlyout(); await page.locator(`[data-testid="note-paste-${id}"]`).click(); await wait(900); return json(); };

const WORD_HTML = '<html><body><!--StartFragment--><p style="font-family:Calibri;font-size:11pt">Lead <b>bold word</b> and <i>italic</i> then <span style="color:#C00000;font-family:Georgia;font-size:20pt">big red serif</span> and a <a href="https://example.com/x">link</a>.</p><!--EndFragment--></body></html>';
const WORD_TEXT = "Lead bold word and italic then big red serif and a link.";

try {
  console.log("\n[2-3] Excel range → table, the tab, the flyout");
  await freshBox();
  await paste(excel.html, excel.text);
  const landed = await json();
  const lt = firstOf(landed, "table");
  ok("(known-good) the Excel range landed as a 4×3 table", !!lt && gridOf(lt).length === 4 && gridOf(lt)[0].length === 3, JSON.stringify(gridOf(lt)));
  if (!lt) throw new Error("VOID: the table did not land");
  ok("a bordered tab \"(Ctrl)\" is offered", await page.locator('[data-testid="note-paste-badge"]').count() === 1);
  await openFlyout();
  const set = await btns();
  ok("Excel's eight options with their names and keys", JSON.stringify(set.map((b) => b.tip)) === JSON.stringify(["Keep Source Formatting (K)", "Merge Formatting (M)", "Keep Source Column Widths (W)", "Transpose (T)", "Values (V)", "Values and Source Formatting (E)", "Formatting only (R)", "Picture (U)"]), JSON.stringify(set.map((b) => b.tip)));
  ok("Keep Source Formatting shows the pressed state", set[0].pressed === "true");
  const groups = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-paste-options"] [data-paste-group]')].map((g) => g.getAttribute("data-paste-group")));
  ok("grouped Paste · Paste Values · Other Paste Options", JSON.stringify(groups) === JSON.stringify(["Paste", "Paste Values", "Other Paste Options"]), JSON.stringify(groups));
  if (SHOT) await page.screenshot({ path: `${SHOT}/live-flyout.png` });

  console.log("\n[4] every option, then ONE Ctrl+Z");
  const undoOk = async (label) => {
    await page.keyboard.press("Control+z"); await wait(700);
    const d = await json();
    ok(`${label}: one Ctrl+Z returns the table as pasted`, tableJson(d) === tableJson(landed) && countType(d, "noteImage") === 0, JSON.stringify(gridOf(firstOf(d, "table"))).slice(0, 100));
  };
  const cases = [
    ["transpose", "Transpose", (d) => JSON.stringify(gridOf(firstOf(d, "table"))[0]) === JSON.stringify(["Unit", "A-100", "A-200", "B-300"])],
    ["values", "Values", (d) => marksIn(firstOf(d, "table")).length === 0 && JSON.stringify(gridOf(firstOf(d, "table"))) === JSON.stringify(gridOf(lt))],
    ["valuesFormat", "Values and Source Formatting", (d) => (firstOf(d, "table").content[0].content.every((c) => c.attrs.background === "#dbe5f1")) && !marksIn(firstOf(d, "table")).includes("link")],
    ["widths", "Keep Source Column Widths", (d) => JSON.stringify(firstOf(d, "table").content[0].content.map((c) => c.attrs.colwidth)) === JSON.stringify([[100], [100], [240]])],
    ["formatting", "Formatting only", (d) => gridOf(firstOf(d, "table")).flat().every((c) => c === "") && firstOf(d, "table").content[0].content.every((c) => c.attrs.background === "#dbe5f1")],
    ["picture", "Picture", (d) => countType(d, "table") === 0 && countType(d, "noteImage") === 1],
  ];
  for (const [id, label, check] of cases) {
    if (id !== "transpose") { await freshBox(); await paste(excel.html, excel.text); }
    const d = await pickByClick(id);
    ok(`${label}: applied`, check(d), JSON.stringify(gridOf(firstOf(d, "table"))).slice(0, 140));
    if (id === "picture") {
      const info = await page.evaluate(async () => { const i = document.querySelector(".ProseMirror figure.planyr-note-image img"); if (!i) return null; if (!i.complete) await new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 4000); }); return { w: i.naturalWidth, h: i.naturalHeight }; });
      ok("Picture: a real image is drawn", !!info && info.w > 200 && info.h > 60, JSON.stringify(info));
      if (SHOT) await page.screenshot({ path: `${SHOT}/live-picture.png` });
    }
    await undoOk(label);
  }

  console.log("\n[5] Values, then Keep Source Formatting");
  await freshBox(); await paste(excel.html, excel.text);
  const base5 = await json();
  await pickByClick("values");
  await openFlyout(); await page.keyboard.press("k"); await wait(800);
  ok("Keep Source Formatting restores the table byte-for-byte", tableJson(await json()) === tableJson(base5));

  console.log("\n[6] Word-style text: K / M / T");
  await freshBox(); await paste(WORD_HTML, WORD_TEXT);
  const wl = await json();
  ok("Word text arrives with its marks", marksIn(wl).includes("bold") && marksIn(wl).includes("link") && marksIn(wl).includes("textStyle"), JSON.stringify(marksIn(wl)));
  await openFlyout();
  const tset = await btns();
  ok("the text set: Keep Source Formatting (K) · Merge Formatting (M) · Keep Text Only (T)", JSON.stringify(tset.map((b) => b.tip)) === JSON.stringify(["Keep Source Formatting (K)", "Merge Formatting (M)", "Keep Text Only (T)"]), JSON.stringify(tset.map((b) => b.tip)));
  await page.keyboard.press("m"); await wait(800);
  const wm = await json();
  ok("M: font/size/colour gone, bold/italic/link kept", !marksIn(wm).includes("textStyle") && ["bold", "italic", "link"].every((m) => marksIn(wm).includes(m)), JSON.stringify(marksIn(wm)));
  await openFlyout(); await page.keyboard.press("k"); await wait(800);
  ok("K: back exactly as pasted", JSON.stringify(await json()) === JSON.stringify(wl));
  await openFlyout(); await page.keyboard.press("t"); await wait(800);
  const wt = await json();
  ok("T: plain words, no marks", marksIn(wt).length === 0 && /Lead bold word/.test(JSON.stringify(wt)), JSON.stringify(marksIn(wt)));
  await page.keyboard.press("Control+z"); await wait(700);
  ok("one Ctrl+Z after T restores the paste", JSON.stringify(await json()) === JSON.stringify(wl));

  console.log("\n[7] right-click Paste ▸");
  await freshBox();
  const at = await page.evaluate(() => { const r = document.querySelector(".planyr-anchor").getBoundingClientRect(); return { x: r.left + 30, y: r.top + 12 }; });
  await page.mouse.click(at.x, at.y, { button: "right" }); await wait(500);
  await page.locator('[data-testid="note-menu-paste"]').hover(); await wait(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-menu-paste-sub"] button')].map((b) => ({ t: b.textContent, svg: !!b.querySelector("svg.planyr-paste-glyph") })));
  ok("three rows with drawings, Word's names", rows.length === 3 && rows.every((r) => r.svg) && /Keep Source Formatting/.test(rows[0].t) && /Merge Formatting/.test(rows[1].t) && /Keep Text Only/.test(rows[2].t), JSON.stringify(rows));
  await page.keyboard.press("Escape"); await wait(200);

  console.log("\n[8] dark theme");
  await freshBox(); await paste(excel.html, excel.text);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await openFlyout();
  const dark = await page.evaluate(() => { const f = document.querySelector('[data-testid="note-paste-options"]'); const b = f.querySelector('button[aria-pressed="false"]'); return { halo: getComputedStyle(b).getPropertyValue("--paste-halo").trim(), blue: getComputedStyle(b.querySelector("svg")).getPropertyValue("--paste-blue").trim() }; });
  ok("dark theme: the halo follows the surface (not white) and the ink marks use their dark twins", !!dark.halo && !/^#?f{3,6}$/i.test(dark.halo) && dark.blue === "#6FB4F0", JSON.stringify(dark));
  if (SHOT) await page.screenshot({ path: `${SHOT}/live-dark.png` });
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
} finally {
  console.log("\n[cleanup] deleting the throwaway page");
  try {
    await page.keyboard.press("Escape");
    const row = page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first();
    await row.click({ button: "right" });
    await wait(300);
    await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click();
    await wait(800);
    const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
    if (await yes.count()) { await yes.click(); await wait(1200); }
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
