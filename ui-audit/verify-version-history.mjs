/* Verify B2022929 / NEW-1 — "Version history": list, open read-only, restore, in the REAL built app, logged out.
 *   Run:  npm run build && npx vite preview --port 4173   then   node ui-audit/verify-version-history.mjs
 * Signed out, a Save is held on this device and the replaced version stays listed for the session, so the whole
 * list/open/restore flow is drivable here. Cloud persistence of the same list (sources[1..] in the record) is the
 * unit suite's seam (test/docVersions.test.js) + a signed-in check (V-entry). Known-good arm: a PDF still opens
 * on the canvas and shows exactly one version with no Open/Restore. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const TXT = "/tmp/vh-note.txt", PDF = "/tmp/vh-known-good.pdf";
writeFileSync(TXT, "first draft\n");
{ const s1 = "BT /F1 20 Tf 60 700 Td (KNOWN GOOD PDF) Tj ET";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  writeFileSync(PDF, Buffer.from(pdf, "latin1")); }

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-version-history");
const downloads = []; page.on("download", (d) => downloads.push(d.suggestedFilename()));
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const open = (p) => page.setInputFiles('[data-testid="review-file-input"]', p);
const body = () => page.locator('[data-testid="doc-editor-page"]');
const saveWith = async (text) => {
  await body().click(); await page.keyboard.press("Control+End"); await page.keyboard.type(text);
  await page.locator('[data-testid="doc-save"]').click();
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || ""), { timeout: 8000 });
};
const rows = () => page.locator('[data-testid="vh-row"]');

try {
  await page.goto(BASE + "#markup", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 15000 });

  /* known-good arm: PDF → canvas, one version, no Open/Restore */
  await open(PDF);
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 15000 });
  await page.locator('[data-testid="version-history-open"]').click();
  await page.waitForSelector('[data-testid="version-history"]');
  ok("PDF: one version listed, no Open/Restore, plain note (known-good arm)", (await rows().count()) === 1 && (await page.locator('[data-testid="vh-open"]').count()) === 0 && (await page.locator('[data-testid="vh-pdf-note"]').count()) === 1);
  await page.locator('[data-testid="vh-close"]').click();

  /* text file saved three times */
  await open(TXT);
  await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 15000 });
  await page.locator('[data-testid="doc-history"]').click();
  ok("one version so far: one row + 'Only one version' note", (await rows().count()) === 1 && (await page.locator('[data-testid="vh-single-note"]').count()) === 1);
  await page.locator('[data-testid="vh-close"]').click();
  await saveWith(" second.");
  await saveWith(" third.");
  await page.locator('[data-testid="doc-history"]').click();
  await page.waitForSelector('[data-testid="version-history"]');
  ok("saved three times → three versions, newest first", (await rows().count()) === 3 && (await rows().first().getAttribute("data-current")) === "1" && /Version 3/.test(await rows().nth(0).innerText()) && /Version 1/.test(await rows().nth(2).innerText()));
  ok("each row shows date, who saved and size", /(AM|PM)/.test(await rows().nth(1).innerText()) && /Saved by/.test(await rows().nth(1).innerText()) && /\b(B|KB)\b/.test(await rows().nth(1).innerText()));

  /* 390-wide: sheet fits, no sideways scroll */
  await page.setViewportSize({ width: 390, height: 844 });
  const fit = await page.evaluate(() => { const r = document.querySelector('[data-testid="version-history"]').getBoundingClientRect(); return { w: r.width, iw: innerWidth, sw: document.documentElement.scrollWidth, shw: document.querySelector('[data-testid="version-history"]').scrollWidth }; });
  ok("phone width: sheet fits and nothing scrolls sideways", fit.w <= fit.iw && fit.sw <= fit.iw && fit.shw <= fit.w + 1, JSON.stringify(fit));
  await page.setViewportSize({ width: 1280, height: 900 });

  /* open the middle one read-only */
  await rows().nth(1).locator('[data-testid="vh-open"]').click();
  await page.waitForSelector('[data-testid="doc-readonly-banner"]', { timeout: 8000 });
  const label = await page.locator('[data-testid="doc-readonly-label"]').innerText();
  ok("middle version opens labelled 'Earlier version — <date>'", /^Earlier version — /.test(label), label);
  ok("its content is version 2's (… second., not third.)", (await body().innerText()).includes("second.") && !(await body().innerText()).includes("third."));
  ok("read-only: page not editable, no Save, no formatting tools", (await body().getAttribute("contenteditable")) === "false" && (await page.locator('[data-testid="doc-save"]').count()) === 0 && (await page.locator('[data-testid="track-toggle"]').count()) === 0);
  await body().click(); await page.keyboard.type("XYZ");
  ok("typing into an earlier version changes nothing", !(await body().innerText()).includes("XYZ"));

  /* restore it */
  await page.locator('[data-testid="ro-restore"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="doc-readonly-banner"]') && /Restored/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || ""), { timeout: 8000 });
  ok("restore reopens it EDITABLE with version 2's content", (await body().getAttribute("contenteditable")) === "true" && (await body().innerText()).includes("second.") && !(await body().innerText()).includes("third."));
  await page.locator('[data-testid="doc-history"]').click();
  await page.waitForSelector('[data-testid="version-history"]');
  ok("a FOURTH version exists; the three originals are still listed", (await rows().count()) === 4 && /restored from an earlier version/.test(await rows().nth(0).innerText()));
  /* undo by restoring the previous latest (the old Version 3, now second in the list) */
  await rows().nth(1).locator('[data-testid="vh-restore"]').click();
  await page.waitForFunction(() => /Restored/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || "") && document.querySelector('[data-testid="doc-editor-page"]')?.innerText.includes("third."), { timeout: 8000 });
  await page.locator('[data-testid="doc-history"]').click();
  await page.waitForSelector('[data-testid="version-history"]');
  ok("restoring the previous latest brings it back as a FIFTH version; nothing lost", (await rows().count()) === 5);
  ok("no download at any point", downloads.length === 0, downloads.join(","));
  const real = errors.filter((e) => !/tesseract|importScripts/i.test(e)); // OCR core is fetched from a CDN the sandbox blocks (PDF open path, unrelated)
ok("no page errors", real.length === 0, real.join(" | "));
} catch (e) { ok("harness ran to the end", false, e.message); }
await browser.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
