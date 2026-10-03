/* Verify NEW-1/NEW-2 (Review): an open file can be CLOSED back to the sheet index, and a file opened inside a
 * project is filed under that project. Against the REAL built app (vite preview on :4173), logged out.
 *   Run:  npm run build && npx vite preview --port 4173   (one shell)
 *         node ui-audit/verify-review-close-file.mjs      (another)
 * Proves: Close (×) on the file name · PDF closes to the index · Word/txt with unsaved edits prompt Save / Discard / Cancel
 * (each one) · a clean doc closes with no prompt · reload after Close STAYS on the index · the project's "Current set" is
 * where Close lands (and "Pick a project" when none) · phone width: control visible, nothing overflows, dialog fits ·
 * a file uploaded from a project's index is filed to that project (local mirror carries the project id) ·
 * switching project with a dirty Word file open asks Save / Discard / Cancel (Cancel returns to the previous project).
 * Known-good arm: the empty state must show NO Close control and the PDF must reach the canvas, or the run is VOID. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const DOCX = "/tmp/close-fixture.docx", TXT = "/tmp/close-note.txt", PDF = "/tmp/close-known-good.pdf";
writeFileSync(DOCX, buildFixtureDocx());
writeFileSync(TXT, "alpha one\r\nbeta two\r\n");
{
  const s1 = "BT /F1 20 Tf 60 700 Td (KNOWN GOOD PDF) Tj ET";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  writeFileSync(PDF, Buffer.from(pdf, "latin1"));
}
const mk = (id, name) => ({ id, groupId: id, site: name, name, role: "pursuit", status: "pursuit", updatedAt: Date.now(), savedAt: Date.now() });
const sites = { p1: mk("p1", "Grand Port"), p2: mk("p2", "Bain") };

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
await ctx.addInitScript((s) => { try { if (!localStorage.getItem("planarfit:sites:v1")) localStorage.setItem("planarfit:sites:v1", JSON.stringify(s)); } catch (_) {} }, sites);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-review-close-file");
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const downloads = []; page.on("download", (d) => downloads.push(d.suggestedFilename()));
const T = (id) => page.locator(`[data-testid="${id}"]`);
const open = (path) => page.setInputFiles('[data-testid="review-file-input"]', path);
const emptyState = async () => (await T("review-empty").count()) ? await T("review-empty").getAttribute("data-state") : null;
const waitIndex = () => page.waitForSelector('[data-testid="review-empty"]', { timeout: 15000 });
const waitCanvas = () => page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 15000 });
const waitDoc = () => page.waitForSelector('[data-testid="doc-editor"]', { timeout: 15000 });
const type = async (txt) => { await T("doc-editor-page").locator("p").first().click(); await page.keyboard.press("End"); await page.keyboard.type(txt); };

try {
  await page.goto(BASE + "#/markup", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 20000 });
  await waitIndex();
  ok("known-good arm: the empty index shows no Close control", (await T("review-close-file").count()) === 0 && (await emptyState()) === "pick-project");

  /* ---- PDF, no project: open → Close → index ("Pick a project") ---- */
  await open(PDF); await waitCanvas();
  ok("known-good arm: the PDF reaches the drawing canvas", (await page.locator("canvas").count()) > 0 && (await T("doc-editor").count()) === 0);
  ok("PDF open: a Close control sits on the file name", (await T("review-close-file").count()) === 1 && /close-known-good/.test(await T("review-close-file").innerText()));
  await T("review-close-file").click(); await waitIndex();
  ok("PDF, no project: Close → 'Pick a project' index, canvas gone, no prompt", (await emptyState()) === "pick-project" && (await page.locator("canvas").count()) === 0 && (await T("close-file-dialog").count()) === 0);
  await page.reload({ waitUntil: "load" }); await waitIndex(); await page.waitForTimeout(1500);
  ok("reload after Close stays on the index (the closed PDF does not reopen)", (await T("review-empty").count()) === 1 && (await page.locator("canvas").count()) === 0 && (await T("review-close-file").count()) === 0);

  /* ---- pick a project; upload from its Current set; Close returns to THAT project's Current set ---- */
  await T("empty-project-card").first().click(); await page.waitForFunction(() => document.querySelector('[data-testid="review-empty"]')?.getAttribute("data-state") === "current-set", { timeout: 10000 });
  await open(PDF); await waitCanvas();
  await page.waitForTimeout(1800); // let the local mirror write
  const filed = await page.evaluate(() => { for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k) || ""; if (/close-known-good/.test(v) && /"projectId":"p1"/.test(v)) return k; } return null; });
  ok("a file uploaded from a project's index is filed to that project (local mirror carries projectId)", !!filed, String(filed));
  await T("review-close-file").click(); await waitIndex();
  ok("PDF in a project: Close → that project's 'Current set'", (await emptyState()) === "current-set" && /Grand Port/.test(await T("review-empty").innerText()));
  await page.reload({ waitUntil: "load" }); await waitIndex(); await page.waitForTimeout(1500);
  ok("reload after Close (in a project) stays on the index", (await T("review-empty").count()) === 1 && (await page.locator("canvas").count()) === 0);

  /* ---- Word, clean: closes with no prompt ---- */
  await open(DOCX); await waitDoc();
  ok("Word open: Close control present", (await T("review-close-file").count()) === 1);
  await T("review-close-file").click(); await waitIndex();
  ok("Word with no edits: closes straight to the index, no prompt", (await T("close-file-dialog").count()) === 0 && (await T("doc-editor").count()) === 0);

  /* ---- Word, dirty: Cancel / Discard / Save ---- */
  await open(DOCX); await waitDoc(); await type(" ZZCANCEL");
  ok("typing marks the document unsaved", (await T("doc-editor").getAttribute("data-dirty")) === "1");
  await T("review-close-file").click();
  ok("Word with unsaved edits: Close asks Save / Discard / Cancel", (await T("close-file-dialog").count()) === 1 && (await T("close-file-save").count()) === 1 && (await T("close-file-discard").count()) === 1 && (await T("close-file-cancel").count()) === 1);
  await T("close-file-cancel").click();
  ok("Cancel: file stays open with the edit intact and still unsaved", (await T("close-file-dialog").count()) === 0 && (await T("doc-editor-page").innerText()).includes("ZZCANCEL") && (await T("doc-editor").getAttribute("data-dirty")) === "1");
  await T("review-close-file").click(); await page.keyboard.press("Escape");
  ok("Escape on the prompt = Cancel", (await T("close-file-dialog").count()) === 0 && (await T("doc-editor").count()) === 1);
  await T("review-close-file").click(); await T("close-file-discard").click(); await waitIndex();
  ok("Discard: closes to the index", (await T("doc-editor").count()) === 0 && (await T("close-file-dialog").count()) === 0);
  await open(DOCX); await waitDoc();
  ok("Discard really dropped the edit (reopening shows the original)", !(await T("doc-editor-page").innerText()).includes("ZZCANCEL"));
  await type(" ZZSAVE");
  await T("review-close-file").click(); await T("close-file-save").click(); await waitIndex();
  ok("Save: writes (no download) then closes to the index", (await T("doc-editor").count()) === 0 && downloads.length === 0);
  await page.reload({ waitUntil: "load" }); await waitIndex(); await page.waitForTimeout(1500);
  ok("reload after closing a Word file stays on the index (it does not reopen)", (await T("review-empty").count()) === 1 && (await T("doc-editor").count()) === 0);

  /* ---- txt ---- */
  await open(TXT); await page.waitForFunction(() => document.querySelector('[data-testid="doc-editor"]')?.getAttribute("data-kind") === "txt", { timeout: 15000 });
  await type("!");
  await T("review-close-file").click();
  ok(".txt with unsaved edits: prompts", (await T("close-file-dialog").count()) === 1);
  await T("close-file-discard").click(); await waitIndex();
  ok(".txt Discard: back on the index", (await T("doc-editor").count()) === 0);

  /* ---- Word dirty, then switch project via the route (B2039234) ---- */
  await page.evaluate(() => { location.hash = "#/project/p1/markup"; }); await page.waitForTimeout(800);
  await open(DOCX); await waitDoc(); await type(" ZZSWITCH");
  await page.evaluate(() => { location.hash = "#/project/p2/markup"; });
  await page.waitForSelector('[data-testid="close-file-dialog"]', { timeout: 8000 }).catch(() => {});
  ok("switching project with unsaved Word edits asks first (file still on screen)", (await T("close-file-dialog").count()) === 1 && (await T("doc-editor").count()) === 1 && /switching project/.test(await T("close-file-dialog").innerText()));
  await T("close-file-cancel").click(); await page.waitForTimeout(800);
  ok("Cancel: navigates back to the previous project and the file keeps its unsaved edit", /\/project\/p1\//.test(await page.evaluate(() => location.hash)) && (await T("doc-editor-page").innerText()).includes("ZZSWITCH") && (await T("doc-editor").getAttribute("data-dirty")) === "1");
  await page.evaluate(() => { location.hash = "#/project/p2/markup"; });
  await page.waitForSelector('[data-testid="close-file-dialog"]', { timeout: 8000 });
  await T("close-file-discard").click(); await waitIndex();
  ok("Discard: leaves for the other project's index", (await T("doc-editor").count()) === 0 && (await emptyState()) === "current-set" && /Bain/.test(await T("review-empty").innerText()));
  await page.evaluate(() => { location.hash = "#/project/p1/markup"; }); await page.waitForTimeout(800);
  await open(DOCX); await waitDoc(); await type(" ZZSAVE2");
  await page.evaluate(() => { location.hash = "#/project/p2/markup"; });
  await page.waitForSelector('[data-testid="close-file-dialog"]', { timeout: 8000 });
  await T("close-file-save").click(); await waitIndex();
  ok("Save: writes (no download) then leaves for the other project's index", (await T("doc-editor").count()) === 0 && downloads.length === 0);
  ok("a clean Word file switches project with no prompt", await (async () => { await page.evaluate(() => { location.hash = "#/project/p1/markup"; }); await page.waitForTimeout(800); await open(DOCX); await waitDoc(); await page.evaluate(() => { location.hash = "#/project/p2/markup"; }); await page.waitForTimeout(1500); return (await T("close-file-dialog").count()) === 0; })());
  await page.evaluate(() => { location.hash = "#/markup"; }); await page.waitForTimeout(800);

  /* ---- phone width ---- */
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ph.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify(s)); } catch (_) {} }, sites);
  const pp = await ph.newPage();
  await assertMeasurable(pp, "verify-review-close-file (phone)");
  await pp.goto(BASE + "#/markup", { waitUntil: "load" });
  await pp.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 20000 });
  for (const [label, path, ready] of [["PDF", PDF, async () => pp.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 15000 })], ["Word", DOCX, async () => pp.waitForSelector('[data-testid="doc-editor"]', { timeout: 15000 })]]) {
    await pp.setInputFiles('[data-testid="review-file-input"]', path); await ready(); await pp.waitForTimeout(500);
    const box = await pp.locator('[data-testid="review-close-file"]').boundingBox();
    const vis = await pp.evaluate(() => { const b = document.querySelector('[data-testid="review-close-file"]'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hit: !!el && (el === b || b.contains(el)), over: document.documentElement.scrollWidth - window.innerWidth }; });
    ok(`phone ${label}: Close control is on screen, tappable and nothing scrolls sideways`, !!box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.height >= 40 && vis.hit && vis.over <= 0, JSON.stringify({ box: box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }, ...vis }));
    if (label === "Word") {
      await pp.locator('[data-testid="doc-editor-page"] p').first().click(); await pp.keyboard.press("End"); await pp.keyboard.type("x");
      await pp.locator('[data-testid="review-close-file"]').tap();
      const d = await pp.locator('[data-testid="close-file-dialog"]').boundingBox();
      const over2 = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("phone: the unsaved-changes prompt fits the screen", !!d && d.x >= 0 && d.x + d.width <= 391 && d.y >= 0 && d.y + d.height <= 845 && over2 <= 0, JSON.stringify(d));
      await pp.locator('[data-testid="close-file-discard"]').tap(); await pp.waitForSelector('[data-testid="review-empty"]', { timeout: 10000 });
    } else {
      await pp.locator('[data-testid="review-close-file"]').tap(); await pp.waitForSelector('[data-testid="review-empty"]', { timeout: 10000 });
      ok("phone PDF: tapping Close returns to the index", (await pp.locator("canvas").count()) === 0);
    }
  }
  const realErrors = errors.filter((e) => !/tesseract|importScripts/i.test(e)); // the OCR worker fetches its core from a CDN this sandbox blocks — not under test
  ok("no uncaught page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));
} catch (e) {
  ok("harness ran to completion", false, String(e && e.stack || e).slice(0, 400));
} finally { await browser.close(); }
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
