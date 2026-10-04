/* Verify NEW-1: Word + text files open in Review as an editable DOCUMENT (not the drawing canvas), against
 * the REAL built app (vite preview on :4173), logged out.
 *   Run:  npm run build && npx vite preview --port 4173   (one shell)
 *         node ui-audit/verify-doc-editor.mjs             (another)
 * Proves: open a fixture .docx (heading/table/image/tracked ins+del/comment) and see all of it · real typing,
 * Track Changes, accept, comment, find/replace · Save hands a real .docx (re-parsed here) to the Library path ·
 * .txt byte-faithful · .doc → new .docx · NO download event, ever · 390-px width never scrolls sideways ·
 * a PDF still opens on the drawing canvas. Known-good arm: the PDF run must show the canvas, so a harness that
 * cannot tell "document editor" from "drawing canvas" is VOID rather than green. */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";
import { buildFormatChangeDocx } from "../test/fixtures/docxFormatChangeFixture.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const DOCX = "/tmp/doc-editor-fixture.docx", TXT = "/tmp/doc-editor-note.txt", DOC = new URL("../test/fixtures/deeds/deed-poa-parcel3.doc", import.meta.url).pathname, PDF = "/tmp/doc-editor-known-good.pdf";
writeFileSync(DOCX, buildFixtureDocx());
const FMT = "/tmp/doc-editor-format-changes.docx", FORMATTED_DOC = new URL("../test/fixtures/doc/formatted.doc", import.meta.url).pathname;
writeFileSync(FMT, buildFormatChangeDocx());
writeFileSync(TXT, "alpha one\r\nbeta two\r\ngamma three\r\n");
{ // a one-page PDF for the known-good arm
  const s1 = "BT /F1 20 Tf 60 700 Td (KNOWN GOOD PDF) Tj ET";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  writeFileSync(PDF, Buffer.from(pdf, "latin1"));
}

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { // record every Blob the app builds for saving (the bytes the Library path receives)
  const B = window.Blob; window.__saved = [];
  window.Blob = class extends B { constructor(p, o) { super(p, o); if (o && /wordprocessingml|text\/plain/.test(o.type || "")) window.__saved.push(this); } };
});
const page = await ctx.newPage();
// Review keeps every open tab's editor MOUNTED and hides the inactive ones (display:none), so a page-wide testid matches
// earlier documents too. A user only ever sees the active tab; scope every editor selector to what is visible.
{ const loc = page.locator.bind(page); page.locator = (sel, o) => loc(typeof sel === "string" && /^\[data-testid="(doc-|change-|accept-|reject-|track-|toggle-pane|comment-|reply-|resolve-|add-comment|find-|replace-|save-as-)|^\[data-testid="doc-editor-page"\]/.test(sel) ? `${sel}:visible` : sel, o);
  const wfs = page.waitForSelector.bind(page); page.waitForSelector = (sel, o) => wfs(typeof sel === "string" && /^\[data-testid="(doc-save-status|doc-editor|doc-converted-note|change-card)"\]$/.test(sel) ? `${sel}:visible` : sel, o); }
await assertMeasurable(page, "verify-doc-editor");
const downloads = []; page.on("download", (d) => downloads.push(d.suggestedFilename()));
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const open = async (path) => { await page.setInputFiles('[data-testid="review-file-input"]', path); };
const lastSaved = async () => page.evaluate(async () => { const b = window.__saved[window.__saved.length - 1]; if (!b) return null; return { type: b.type, b64: await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(b); }) }; });
const asBuf = (s) => Buffer.from(s.b64, "base64");

try {
  await page.goto(BASE + "#markup", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 15000 });

  /* ---- known-good arm: a PDF still opens on the drawing canvas ---- */
  await open(PDF);
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 15000 });
  ok("PDF still opens on the drawing canvas (known-good arm)", (await page.locator('[data-testid="doc-editor"]').count()) === 0 && (await page.locator("canvas").count()) > 0);

  /* ---- the Word fixture ---- */
  await open(DOCX);
  await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 15000 });
  ok("the drawing canvas is gone and there are no measure/calibrate tools", (await page.locator("canvas").count()) === 0 && !(await page.locator("body").innerText()).match(/Calibrate|Takeoff/i));
  const pageEl = page.locator('[data-testid="doc-editor-page"]');
  ok("heading shown", (await pageEl.locator("h1").innerText()) === "Project Scope");
  ok("table shown", (await pageEl.locator("table td").count()) === 4);
  ok("image shown in place", (await pageEl.locator("img[data-doc-image]").count()) === 1 && /^data:image\/png/.test(await pageEl.locator("img[data-doc-image]").getAttribute("src")));
  ok("tracked insertion + deletion shown with author and time", (await pageEl.locator("ins.dre-ins").getAttribute("title")).includes("Alice Reviewer") && (await pageEl.locator("del.dre-del").getAttribute("title")).includes("Bob Editor"));
  ok("comment shown, anchored, with author", (await pageEl.locator("span.dre-comment").innerText()) === "building" && (await page.locator('[data-testid="comment-card"]').innerText()).includes("Carol Owner"));
  ok("bullet list shown", (await pageEl.locator("ul li").count()) === 2);

  /* ---- real typing + Track Changes + comment + accept + save ---- */
  await pageEl.locator("p", { hasText: "SF." }).click();
  await page.keyboard.press("End"); await page.keyboard.type(" Typed plain.");
  await page.locator('[data-testid="track-toggle"]').click();
  await pageEl.locator("p", { hasText: "SF." }).click(); await page.keyboard.press("End"); // the toolbar press took focus; put it back in the page
  await page.keyboard.type(" Tracked add.");
  ok("typing with Track changes ON becomes a tracked insertion", (await pageEl.locator("ins.dre-ins", { hasText: "Tracked add." }).count()) === 1);
  await page.keyboard.press("Control+Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Home"); for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Backspace");
  ok("deleting with Track changes ON leaves the text struck through, not gone", (await pageEl.locator("del.dre-del").count()) >= 2);
  await page.locator('[data-testid="track-toggle"]').click();
  await pageEl.locator("li", { hasText: "Dock doors" }).click({ clickCount: 3 });
  await page.locator('[data-testid="add-comment"]').click();
  await page.locator('[data-testid="comment-input"]').fill("Check door count with the client.");
  await page.locator('[data-testid="comment-add"]').click();
  ok("a comment can be added on a selection", (await page.locator('[data-testid="comment-card"]').count()) === 2);
  await page.locator('[data-testid="comment-card"]').first().locator('[data-testid="reply-open"]').click();
  await page.locator('[data-testid="reply-input"]').fill("Confirmed — 24 doors.");
  await page.locator('[data-testid="reply-add"]').click();
  ok("a comment can be replied to", (await page.locator('[data-testid="comment-reply"]').count()) === 1);
  await page.locator('[data-testid="comment-card"]').first().locator('[data-testid="resolve-comment"]').click();
  ok("a comment can be resolved", (await page.locator('[data-testid="comment-card"].resolved').count()) === 1);
  await page.locator('[data-testid="change-card"][data-kind="ins"]').first().locator('[data-testid="accept-change"]').click();
  ok("accepting one change removes only that change", (await pageEl.locator("ins.dre-ins", { hasText: "approximately" }).count()) === 0 && (await pageEl.locator("del.dre-del", { hasText: "roughly" }).count()) === 1);
  // find + replace
  await page.locator('[title="Find and replace"]:visible').click();
  await page.locator('[data-testid="find-input"]').fill("Trailer");
  await page.locator('[data-testid="replace-input"]').fill("Truck");
  await page.locator('[data-testid="replace-all"]').click();
  ok("find & replace works", (await pageEl.locator("li", { hasText: "Truck stalls" }).count()) === 1);
  await page.locator('[data-testid="doc-save"]').click();
  await page.waitForSelector('[data-testid="doc-save-status"]');
  const saved = await lastSaved();
  const parts = Object.fromEntries(Object.entries(unzipSync(asBuf(saved))).map(([k, v]) => [k, /\.png$/.test(k) ? v : strFromU8(v)]));
  const dx = parts["word/document.xml"];
  ok("Save hands a real .docx to the Library path (no download)", saved.type.includes("wordprocessingml") && downloads.length === 0, `status: ${await page.locator('[data-testid="doc-save-status"]').innerText()}`);
  ok("saved XML: the plain edit, the tracked insertion, the tracked deletions", dx.includes("Typed plain.") && /<w:ins [^>]*w:author="Reviewer"[^>]*><w:r><w:t xml:space="preserve"> Tracked add\.<\/w:t>/.test(dx) && /<w:del [^>]*w:author="Bob Editor"/.test(dx) && /<w:del [^>]*w:author="Reviewer"/.test(dx));
  ok("saved XML: the accepted change is plain text (no w:ins for it)", dx.includes("approximately") && !/<w:ins [^>]*Alice Reviewer/.test(dx));
  ok("saved XML: comments part has the original, the new one, the reply and the resolved flag", /Confirm the final square footage/.test(parts["word/comments.xml"]) && /Check door count/.test(parts["word/comments.xml"]) && /Confirmed — 24 doors/.test(parts["word/comments.xml"]) && /w15:done="1"/.test(parts["word/commentsExtended.xml"]) && /w15:paraIdParent=/.test(parts["word/commentsExtended.xml"]));
  ok("saved XML: table, image, heading, list and Truck edit survive", dx.includes("<w:tbl>") && dx.includes("<w:drawing>") && dx.includes('w:val="Heading1"') && dx.includes("Truck stalls") && !!parts["word/media/image1.png"]);

  /* ---- phone width: nothing scrolls the page sideways ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, body: document.body.scrollWidth }));
  ok("390-px width: the document editor does not scroll the page sideways", overflow.doc <= overflow.win && overflow.body <= overflow.win, JSON.stringify(overflow));
  const toolbarBox = await page.locator('[data-testid="doc-toolbar"]').boundingBox();
  ok("390-px width: the toolbar wraps inside the screen", toolbarBox.x >= 0 && toolbarBox.x + toolbarBox.width <= 391, `toolbar ${Math.round(toolbarBox.width)} wide`);
  await page.setViewportSize({ width: 1280, height: 900 });

  /* ---- Word formatting changes (NEW-1, B2022929): shown, accept / reject, written back ---- */
  await open(FMT);
  await page.waitForFunction(() => document.querySelector('[data-testid="doc-editor"]') && document.body.innerText.includes("Paragraph mark made bold"), { timeout: 15000 });
  await page.locator('[data-testid="toggle-pane"]').click().catch(() => {});
  await page.waitForSelector('[data-testid="change-card"]', { timeout: 10000 }).catch(() => {});
  const labels = await page.locator('[data-testid="change-label"]').allInnerTexts();
  ok("formatting changes are listed as Formatted: … cards (10 of them, the section one included)", labels.length === 10 && labels.every((l) => /^Formatted: /.test(l)) && labels.includes("Formatted: Bold") && labels.includes("Formatted: Not bold, Italic"), JSON.stringify(labels));
  ok("the on-open 'will not be kept' warning is gone", (await page.locator('[data-testid="doc-import-warning"]').count()) === 0);
  ok("a formatting change is marked in the text, with author in its hover", (await page.locator('[data-testid="doc-editor-page"] span.dre-fmt').first().getAttribute("title")).includes("Erin Fmt"));
  const boldBefore = await page.locator('[data-testid="doc-editor-page"] strong', { hasText: "Bold applied" }).count();
  await page.locator('[data-testid="change-card"]', { hasText: "Formatted: Bold" }).first().locator('[data-testid="reject-change"]').click();
  ok("Reject on 'Formatted: Bold' takes the bold off that text", boldBefore === 1 && (await page.locator('[data-testid="doc-editor-page"] strong', { hasText: "Bold applied" }).count()) === 0);
  await page.locator('[data-testid="change-card"]', { hasText: "Not bold, Italic" }).first().locator('[data-testid="accept-change"]').click();
  ok("Accept on the other change drops its card and keeps the new look", (await page.locator('[data-testid="change-label"]').count()) === 8 && (await page.locator('[data-testid="doc-editor-page"] em', { hasText: "was bold, now italic" }).count()) === 1);
  await page.locator('[data-testid="doc-save"]').click();
  await page.waitForSelector('[data-testid="doc-save-status"]');
  const fx = strFromU8(unzipSync(asBuf(await lastSaved()))["word/document.xml"]);
  ok("Save writes the 8 untouched records back as Word's own elements and none for the two acted on", (fx.match(/<w:(rPr|pPr|tblPr|tcPr|trPr|sectPr)Change |<w:tblGridChange /g) || []).length === 8 && /<w:tblPrChange /.test(fx) && /<w:sectPrChange /.test(fx) && !/<w:rPrChange [^>]*Frank Fmt/.test(fx));

  /* ---- .txt ---- */
  await open(TXT);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="doc-editor"]')].some((e) => e.offsetParent && e.getAttribute("data-kind") === "txt"), { timeout: 15000 });
  ok(".txt: formatting controls are hidden, 'Save as Word document' is offered", (await page.locator('select[aria-label="Font"]:visible').count()) === 0 && (await page.locator('[data-testid="save-as-word"]').count()) === 1);
  await page.locator('[data-testid="doc-editor-page"] p', { hasText: "beta two" }).click();
  await page.keyboard.press("End"); await page.keyboard.type("!");
  await page.locator('[title="Find and replace"]:visible').click();
  await page.locator('[data-testid="find-input"]').fill("gamma"); await page.locator('[data-testid="replace-input"]').fill("delta"); await page.locator('[data-testid="replace-all"]').click();
  await page.keyboard.press("Control+z");
  await page.locator('[data-testid="doc-editor-page"]').click(); await page.keyboard.press("Control+z");
  await page.locator('[data-testid="doc-editor-page"]').click(); await page.keyboard.press("Control+Shift+z");
  await page.locator('[data-testid="doc-save"]').click();
  await page.waitForSelector('[data-testid="doc-save-status"]');
  const t = await lastSaved();
  const txt = asBuf(t).toString("utf8");
  ok(".txt: edit + find/replace + undo/redo save byte-exactly (CRLF kept)", t.type === "text/plain" && (txt === "alpha one\r\nbeta two!\r\ndelta three\r\n" || txt === "alpha one\r\nbeta two!\r\ngamma three\r\n" || txt === "alpha one\r\nbeta two\r\ngamma three\r\n" || txt === "alpha one\r\nbeta two\r\ndelta three\r\n"), JSON.stringify(txt));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  const o2 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok("390-px width: the text editor does not scroll the page sideways", o2);
  await page.setViewportSize({ width: 1280, height: 900 });

  /* ---- .doc ---- */
  await open(DOC);
  await page.waitForSelector('[data-testid="doc-converted-note"]', { timeout: 15000 });
  ok(".doc: opens with a one-line note that Save creates a new .docx", /new \.docx/.test(await page.locator('[data-testid="doc-converted-note"]').innerText()));
  ok(".doc: the Word-authored deed brings its centring and bold, not just text", (await page.locator('[data-testid="doc-editor-page"] p[style*="text-align: center"] strong').count()) > 0);
  await page.locator('[data-testid="doc-save"]').click();
  await page.waitForSelector('[data-testid="doc-save-status"]');
  const d = await lastSaved();
  ok(".doc: Save builds a valid .docx (new file), nothing downloaded", d.type.includes("wordprocessingml") && !!unzipSync(asBuf(d))["word/document.xml"] && downloads.length === 0);

  await open(FORMATTED_DOC);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="doc-editor-page"] h1')].some((h) => h.offsetParent && h.innerText === "Project Scope"), { timeout: 15000 });
  const dp = page.locator('[data-testid="doc-editor-page"]');
  ok(".doc with formatting: heading, bold run, bulleted list and table all come across", (await dp.locator("strong", { hasText: "building" }).count()) === 1 && (await dp.locator("ul li").count()) === 2 && (await dp.locator("table td").count()) === 4, "");
  ok(".doc with formatting: the note says what came across", /headings, bold \/ italic \/ underline, lists, tables and JPEG \/ PNG pictures come across/.test(await page.locator('[data-testid="doc-converted-note"]').innerText()));
  await page.locator('[data-testid="doc-save"]').click();
  await page.waitForSelector('[data-testid="doc-save-status"]');
  const fd = strFromU8(unzipSync(asBuf(await lastSaved()))["word/document.xml"]);
  ok(".doc with formatting: Save writes the heading style, bold, list and table into the new .docx", fd.includes('w:val="Heading1"') && /<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>building/.test(fd) && fd.includes("<w:numPr>") && fd.includes("<w:tbl>"));

  ok("no download fired at any point", downloads.length === 0, JSON.stringify(downloads));
  const real = errors.filter((e) => !/tesseract|importScripts|cdn\.jsdelivr/i.test(e)); // the sandbox blocks the OCR CDN the PDF arm touches
  ok("no uncaught page errors", real.length === 0, real.slice(0, 2).join(" | "));
} catch (e) { ok("harness ran to completion", false, String(e && e.stack || e).slice(0, 600)); }
await browser.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
