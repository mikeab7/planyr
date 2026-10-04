/* Verify Review TABS (NEW-1, 2026-10-04) against the REAL built app (vite preview on :4173), logged out.
 *   Run:  VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=dummy npm run build
 *         npx vite preview --port 4173      (one shell)      node ui-audit/verify-review-tabs.mjs   (another)
 * Proves: Review is BLANK with nothing open (no heading, no buttons, no sheet index, no strip) · opening two PDFs and a
 * .docx gives three tabs in order, active = last · each tab keeps its own page + zoom across switches · the Word tab keeps
 * its typed text AND its undo history · reopening an already-open file adds no tab · an unsaved Word tab shows a dot and
 * closing it prompts (Cancel keeps it, Discard drops it) · closing the active tab shows its right neighbour (left if last) ·
 * closing everything leaves Review blank · the drop outline shows only while a file is dragged · at 390 wide the strip
 * scrolls, × is on the active tab only, targets are ≥44 tall and nothing overflows the page.
 * Known-good arm: the PDF tabs must actually render a canvas — a run that cannot see a sheet is VOID, not green. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildPdf } from "./lib/tinyPdf.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const A = "/tmp/tabs-A-site-plan.pdf", B = "/tmp/tabs-B-grading.pdf", C = "/tmp/tabs-C-scope.docx", AA = "/tmp/tabs-A-site-plan-copy/tabs-A-site-plan.pdf";
writeFileSync(A, buildPdf(3, "A")); writeFileSync(B, buildPdf(4, "B")); writeFileSync(C, buildFixtureDocx());
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
// The build carries a dummy Supabase host; answer it (and the OCR CDN) instantly so no check waits on a dead network.
await ctx.route(/supabase\.co|cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
const page = await ctx.newPage();
await assertMeasurable(page, "verify-review-tabs");
const errors = []; page.on("pageerror", (e) => { if (!/tesseract|importScripts/.test(String(e))) errors.push(String(e)); }); // OCR worker CDN is unreachable in the sandbox — environment noise
const open = (p) => page.setInputFiles('[data-testid="review-file-input"]', p);
const names = () => page.locator('[data-testid="review-tab"]').evaluateAll((els) => els.map((e) => e.querySelector("span").textContent));
const activeName = () => page.locator('[data-testid="review-tab"][data-active="1"] span').first().textContent().catch(() => null);
const pageOf = async () => (await page.locator('[data-testid="sheet-rail"]').innerText()).match(/(\d+) \/ (\d+)/)?.slice(1, 3).map(Number) || null;
const scaleOf = async () => Number(await page.locator('[data-testid="review-sheet"]').getAttribute("data-view-scale"));
const settle = async () => { await page.waitForTimeout(500); };
const waitCanvas = () => page.waitForFunction(() => { const s = document.querySelector('[data-testid="review-sheet"]'); const c = s && s.querySelector("canvas"); return c && c.width > 0; }, { timeout: 20000 });
const tabByName = (n) => page.locator('[data-testid="review-tab"]', { hasText: n });

try {
  await page.goto(BASE + "#markup", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 20000 });
  await page.waitForSelector('[data-testid="review-blank"]', { timeout: 20000 });
  await settle();

  /* ---- blank ---- */
  const blankText = (await page.locator('[data-testid="review-blank"]').innerText()).trim();
  const body = await page.locator("body").innerText();
  ok("blank: the canvas area is empty (no heading, no buttons)", blankText === "" && (await page.locator('[data-testid="review-blank"] button').count()) === 0, JSON.stringify(blankText));
  ok("blank: no sheet index / 'Pick a project' / 'Current set'", !/Pick a project|Current set|Upload a file without/i.test(body));
  ok("blank: the tab strip is empty (not rendered)", (await page.locator('[data-testid="review-tabs"]').count()) === 0);
  ok("blank: toolbar Open… is still there", (await page.getByRole("button", { name: "Open…" }).count()) === 1);

  /* ---- three files → three tabs ---- */
  await open(A); await waitCanvas(); await settle();
  ok("known-good arm: a PDF tab renders a sheet", (await page.locator('[data-testid="review-sheet"] canvas').count()) > 0);
  await open(B); await waitCanvas(); await settle();
  await open(C); await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 20000 }); await settle();
  const n3 = await names();
  ok("three tabs, in the order opened", n3.length === 3 && n3[0].includes("A-site-plan") && n3[1].includes("B-grading") && n3[2].includes("C-scope"), JSON.stringify(n3));
  ok("the last opened tab is active", (await activeName()).includes("C-scope"));
  ok("hover shows the full name", (await tabByName("A-site-plan").getAttribute("title")).includes("tabs-A-site-plan.pdf"));

  /* ---- per-tab page + zoom ---- */
  await tabByName("A-site-plan").click(); await waitCanvas(); await settle();
  await page.getByTitle("Next sheet (→)").click(); await page.getByTitle("Next sheet (→)").click(); await settle();
  const aFit = await scaleOf();
  for (let i = 0; i < 3; i++) { await page.getByText("In", { exact: true }).first().click(); await page.waitForTimeout(150); } await settle();
  const aPage = await pageOf(), aScale = await scaleOf();
  ok("A: moved to page 3 and zoomed in (a zoom that differs from fit — else this check proves nothing)", aPage && aPage[0] === 3 && aScale > aFit * 1.2, `page ${aPage}, scale ${aScale.toFixed(3)}`);
  await tabByName("B-grading").click(); await waitCanvas(); await settle();
  await page.getByTitle("Next sheet (→)").click(); await settle();
  for (let i = 0; i < 2; i++) { await page.getByText("Out", { exact: true }).first().click(); await page.waitForTimeout(150); } await settle();
  const bPage = await pageOf(), bScale = await scaleOf();
  ok("B: its own page (2) and its own zoom, not A's", bPage && bPage[0] === 2 && bPage[1] === 4 && Math.abs(bScale - aScale) / aScale > 0.1, `page ${bPage}, scale ${bScale.toFixed(3)} vs A ${aScale.toFixed(3)}`);
  await tabByName("A-site-plan").click(); await waitCanvas(); await settle();
  const aPage2 = await pageOf(), aScale2 = await scaleOf();
  ok("back on A: same page and same zoom", aPage2[0] === 3 && Math.abs(aScale2 - aScale) / aScale < 0.02, `page ${aPage2}, scale ${aScale2.toFixed(3)} vs ${aScale.toFixed(3)}`);
  await tabByName("B-grading").click(); await waitCanvas(); await settle();
  const bPage2 = await pageOf(), bScale2 = await scaleOf();
  ok("back on B: same page and same zoom", bPage2[0] === 2 && Math.abs(bScale2 - bScale) / bScale < 0.02, `page ${bPage2}, scale ${bScale2.toFixed(3)} vs ${bScale.toFixed(3)}`);

  /* ---- Word tab keeps text + undo history across a switch ---- */
  await tabByName("C-scope").click(); await page.waitForSelector('[data-testid="doc-editor"]', { state: "visible", timeout: 20000 });
  const para = page.locator('[data-testid="doc-editor-page"] p', { hasText: "SF." }).first();
  await para.click(); await page.keyboard.press("End"); await page.keyboard.type(" ZZTYPED"); await settle();
  ok("Word tab: typing shows the unsaved dot", (await tabByName("C-scope").locator('[data-testid="review-tab-dirty"]').count()) === 1);
  await tabByName("A-site-plan").click(); await waitCanvas(); await settle();
  ok("switched away from the Word tab: its editor is hidden, not destroyed", (await page.locator('[data-testid="doc-editor-host"]').count()) === 1 && !(await page.locator('[data-testid="doc-editor"]').isVisible()));
  ok("the dot stays while the Word tab is in the background", (await tabByName("C-scope").locator('[data-testid="review-tab-dirty"]').count()) === 1);
  await tabByName("C-scope").click(); await page.waitForSelector('[data-testid="doc-editor"]', { state: "visible", timeout: 20000 }); await settle();
  ok("Word tab back: the typed text is still there", (await page.locator('[data-testid="doc-editor-page"]').innerText()).includes("ZZTYPED"));
  await page.locator('[data-testid="doc-editor-page"] p', { hasText: "ZZTYPED" }).first().click(); await page.keyboard.press("End");
  await page.keyboard.press("Control+z"); await settle();
  ok("Word tab back: undo history survived (Ctrl+Z removes the typing)", !(await page.locator('[data-testid="doc-editor-page"]').innerText()).includes("ZZTYPED"));
  await page.keyboard.press("Control+Shift+z"); await settle();
  ok("…and redo brings it back (the history is the editor's own)", (await page.locator('[data-testid="doc-editor-page"]').innerText()).includes("ZZTYPED"));

  /* ---- reopening an open file does not add a tab ---- */
  const before = (await names()).length;
  await open(A); await waitCanvas(); await settle();
  ok("reopening the already-open file adds no tab and switches to it", (await names()).length === before && (await activeName()).includes("A-site-plan"), `${before} → ${(await names()).length}`);
  const aPage3 = await pageOf();
  ok("…and it is still on its page", aPage3[0] === 3, `page ${aPage3}`);

  /* ---- closing: dirty Word tab prompts ---- */
  await tabByName("C-scope").locator('[data-testid="review-tab-close"]').click();
  await page.waitForSelector('[data-testid="close-file-dialog"]', { timeout: 10000 });
  ok("closing the unsaved Word tab asks Save / Discard / Cancel", (await page.locator('[data-testid="close-file-save"]').count()) === 1 && (await page.locator('[data-testid="close-file-discard"]').count()) === 1);
  await page.locator('[data-testid="close-file-cancel"]').click(); await settle();
  ok("Cancel keeps the tab and its text", (await names()).length === 3 && (await page.locator('[data-testid="doc-editor-page"]').innerText()).includes("ZZTYPED"));
  await tabByName("C-scope").locator('[data-testid="review-tab-close"]').click();
  await page.waitForSelector('[data-testid="close-file-dialog"]', { timeout: 10000 });
  await page.locator('[data-testid="close-file-discard"]').click(); await waitCanvas(); await settle();
  const n2 = await names();
  ok("Discard drops the tab; the neighbour on the LEFT (it was last) is shown", n2.length === 2 && (await activeName()).includes("B-grading"), JSON.stringify(n2));

  /* ---- close the active tab → right neighbour; middle-click closes ---- */
  await tabByName("A-site-plan").click(); await waitCanvas(); await settle();
  await tabByName("A-site-plan").locator('[data-testid="review-tab-close"]').click(); await waitCanvas(); await settle();
  ok("closing the first (active) tab shows the one to its right", (await names()).length === 1 && (await activeName()).includes("B-grading"));
  await open(A); await waitCanvas(); await settle(); await open(C); await page.waitForSelector('[data-testid="doc-editor"]', { state: "visible" }); await settle();
  await tabByName("A-site-plan").click({ button: "middle" }); await settle();
  ok("middle-click closes a tab", (await names()).length === 2 && !(await names()).some((n) => n.includes("A-site-plan")), JSON.stringify(await names()));

  /* ---- drag to reorder ---- */
  const before2 = await names();
  await tabByName("C-scope").dragTo(tabByName("B-grading")); await settle();
  const after2 = await names();
  ok("drag reorders tabs", after2[0].includes("C-scope") && after2[1].includes("B-grading") && before2[0].includes("B-grading"), JSON.stringify(after2));

  /* ---- close everything → blank ---- */
  for (let i = 0; i < 4 && (await page.locator('[data-testid="review-tab"]').count()) > 0; i++) {
    await page.locator('[data-testid="review-tab"][data-active="1"] [data-testid="review-tab-close"]').click(); await page.waitForTimeout(700);
    if (await page.locator('[data-testid="close-file-dialog"]').count()) { await page.locator('[data-testid="close-file-discard"]').click(); await page.waitForTimeout(700); }
  }
  await settle();
  const bodyEnd = await page.locator("body").innerText();
  ok("close all: Review is blank — no tabs, no sheet index", (await page.locator('[data-testid="review-tab"]').count()) === 0 && !/Pick a project|Current set/i.test(bodyEnd) && (await page.locator('[data-testid="review-blank"]').innerText()).trim() === "");

  /* ---- drop outline only while dragging ---- */
  ok("no drop outline at rest", (await page.locator('[data-testid="review-drop-outline"]').count()) === 0);
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(["x"], "x.pdf", { type: "application/pdf" })); window.__dt = dt; document.querySelector('[data-testid="doc-review-root"]').dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt })); });
  await page.waitForTimeout(150);
  ok("drop outline shows while a file is dragged over", (await page.locator('[data-testid="review-drop-outline"]').count()) === 1);
  await page.evaluate(() => { document.querySelector('[data-testid="doc-review-root"]').dispatchEvent(new DragEvent("dragleave", { bubbles: true, dataTransfer: window.__dt })); });
  await page.waitForTimeout(150);
  ok("…and goes away when the drag leaves", (await page.locator('[data-testid="review-drop-outline"]').count()) === 0);

  /* ---- phone ---- */
  await page.setViewportSize({ width: 390, height: 800 }); await settle();
  const files = [];
  for (let i = 1; i <= 10; i++) { const f = `/tmp/tabs-phone-${i}-a-rather-long-drawing-name.pdf`; writeFileSync(f, buildPdf(2, `P${i}`)); files.push(f); }
  for (const f of files) { await open(f); await waitCanvas(); await page.waitForTimeout(250); }
  await settle();
  const geo = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="review-tabs"]');
    const tabs = [...document.querySelectorAll('[data-testid="review-tab"]')];
    const act = document.querySelector('[data-testid="review-tab"][data-active="1"]');
    const sr = strip.getBoundingClientRect(), ar = act.getBoundingClientRect();
    return { n: tabs.length, scrolls: strip.scrollWidth > strip.clientWidth + 1, overflow: document.documentElement.scrollWidth - window.innerWidth, minH: Math.min(...tabs.map((t) => t.getBoundingClientRect().height)),
      xCount: document.querySelectorAll('[data-testid="review-tab-close"]').length, xH: act.querySelector('[data-testid="review-tab-close"]').getBoundingClientRect().height, xW: act.querySelector('[data-testid="review-tab-close"]').getBoundingClientRect().width,
      activeInView: ar.left >= sr.left - 1 && ar.right <= sr.right + 1 };
  });
  ok("phone: ten tabs, the strip scrolls sideways", geo.n === 10 && geo.scrolls, JSON.stringify(geo));
  ok("phone: the active tab is kept in view", geo.activeInView);
  ok("phone: × only on the active tab, and it is a ≥44 target", geo.xCount === 1 && geo.xH >= 44 && geo.xW >= 44);
  ok("phone: every tab is ≥44 tall", geo.minH >= 44);
  ok("phone: nothing overflows the page", geo.overflow <= 0, `overflow ${geo.overflow}`);
  await page.locator('[data-testid="review-tab"]').first().click(); await waitCanvas(); await page.waitForTimeout(400);
  const inView = await page.evaluate(() => { const s = document.querySelector('[data-testid="review-tabs"]').getBoundingClientRect(), a = document.querySelector('[data-testid="review-tab"][data-active="1"]').getBoundingClientRect(); return a.left >= s.left - 1 && a.right <= s.right + 1; });
  ok("phone: switching to the first tab scrolls it into view", inView);

  ok("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) { ok("harness ran to completion", false, String(e && e.stack || e)); }
await browser.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
