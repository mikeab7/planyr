/* V1459216 — LIVE signed-in run of Version history (B2034128) on the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-version-history-live.mjs [https://planyr.io]
 * Throwaway files only (names start "vh-live-"), deleted at the end. Build from /version.json is read in the
 * SAME call as the assertions. */
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";

const BASE = process.argv.slice(2).find((a) => a.startsWith("http")) || "https://planyr.io";
const stamp = Date.now().toString(36);
const TXT = `/tmp/vh-live-${stamp}.txt`, DOCX = `/tmp/vh-live-${stamp}.docx`;
writeFileSync(TXT, "live first.\n"); writeFileSync(DOCX, buildFixtureDocx());
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };

const s = await openSignedIn({ base: BASE });
const { page } = s;
await assertMeasurable(page, "verify-version-history-live");
console.log("build served:", JSON.stringify(s.build), "| signed in as", s.proof.email);
const downloads = []; page.on("download", (d) => downloads.push(d.suggestedFilename()));
const rows = () => page.locator('[data-testid="vh-row"]');
const body = () => page.locator('[data-testid="doc-editor-page"]');
const status = () => page.locator('[data-testid="doc-save-status"]').innerText().catch(() => "");
const openFile = async (p) => { await page.goto(BASE + "/#/markup", { waitUntil: "load" }); await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 30000 }); await page.setInputFiles('[data-testid="review-file-input"]', p); await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 30000 }); };
const saveWith = async (text) => {
  await body().click(); await page.keyboard.press("Control+End"); await page.keyboard.type(text);
  // The storage backend answers an occasional 502 (measured 2026-10-08); the editor says so and keeps the edits, and a person presses Save again.
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.locator('[data-testid="doc-save"]').click();
    const done = await page.waitForFunction(() => { const t = document.querySelector('[data-testid="doc-save-status"]')?.textContent || ""; return /Saved/.test(t) ? "ok" : /Couldn|HTTP|try again/.test(t) ? "err" : false; }, null, { timeout: 90000 }).then((h) => h.jsonValue(), () => "timeout");
    if (done === "ok") return;
    console.log(`   (save attempt ${attempt} → ${done}; retrying)`);
    await page.waitForTimeout(5000);
  }
  throw new Error("Save never succeeded in 4 attempts");
};
// The original upload must be STORED (a drive key in the cloud record) before the first Save, or there is no version 1 to keep —
// on a day the backend answers 502 it never gets one. Poll the real record; re-open the file once if it never lands.
const storedRow = (tag) => page.evaluate(async (t) => { const q = await window.pfSupabase.from("doc_reviews").select("data").order("updated_at", { ascending: false }).limit(8); return (q.data || []).some((r) => JSON.stringify(r.data).includes(t) && (r.data.sources || []).some((x) => x.driveKey)); }, tag);
const openStored = async (p, tag) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await openFile(p);
    for (let i = 0; i < 30; i++) { if (await storedRow(tag)) return; await page.waitForTimeout(2000); }
    console.log(`   (original upload of ${tag} not stored after 60s, attempt ${attempt}; re-opening)`);
  }
  throw new Error("original upload never stored");
};
const openHistory = async () => { await page.locator('[data-testid="doc-history"]').click(); await page.waitForSelector('[data-testid="version-history"]'); };

try {
  if (process.argv.includes("--cleanup-only")) throw new Error("cleanup-only"); // `node … --cleanup-only` just deletes leftover vh-live-* files
  /* 1-3: .txt saved three times, persisted, reloaded */
  await openStored(TXT, `${stamp}.txt`);
  await saveWith(" second."); await saveWith(" third.");
  await page.waitForTimeout(3000); // record autosave after the last version swap
  await openHistory();
  ok("1. saved 3× → 3 rows newest first, with date / author / size", (await rows().count()) === 3 && /Version 3/.test(await rows().nth(0).innerText()) && /Saved by/.test(await rows().nth(0).innerText()) && /(KB|B)\b/.test(await rows().nth(1).innerText()), (await rows().nth(0).innerText()).replace(/\n/g, " | "));
  await page.locator('[data-testid="vh-close"]').click();

  /* hard reload: session byte cache is gone, so everything below comes from the cloud record + Drive */
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 60000 });
  await openHistory();
  ok("   after reload the list still has 3 versions (from the cloud record)", (await rows().count()) === 3);

  await rows().nth(1).locator('[data-testid="vh-open"]').click();
  await page.waitForSelector('[data-testid="doc-readonly-banner"]', { timeout: 60000 });
  const txt = await body().innerText();
  ok("2. middle version opens read-only from Drive: 'Earlier version — <date>', version 2's text, no editing/Save, no download",
    /^Earlier version — /.test(await page.locator('[data-testid="doc-readonly-label"]').innerText()) && txt.includes("second.") && !txt.includes("third.") && (await body().getAttribute("contenteditable")) === "false" && (await page.locator('[data-testid="doc-save"]').count()) === 0 && downloads.length === 0);

  await page.locator('[data-testid="ro-restore"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="doc-readonly-banner"]') && /Restored/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || ""), null, { timeout: 90000 });
  ok("3. Restore reopens editable with version 2's text", (await body().getAttribute("contenteditable")) === "true" && (await body().innerText()).includes("second.") && !(await body().innerText()).includes("third."));
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 60000 });
  ok("   reload: the restored text is the latest", (await body().innerText()).includes("second.") && !(await body().innerText()).includes("third."));
  await openHistory();
  ok("   FOUR versions after reload, top tagged restored, the three originals still listed", (await rows().count()) === 4 && /restored from an earlier version/.test(await rows().nth(0).innerText()), (await rows().allInnerTexts()).map((t) => t.split("\n")[0]).join(" / "));

  /* 4: Save a copy */
  await rows().nth(3).locator('[data-testid="vh-open"]').click();
  await page.waitForSelector('[data-testid="doc-readonly-banner"]', { timeout: 60000 });
  await page.locator('[data-testid="ro-copy"]').click();
  await page.waitForFunction(() => /copy of/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || "") || /copy of/.test(document.body.innerText), null, { timeout: 90000 });
  const copyNote = await status();
  ok("4. Save a copy files a separate '(copy of <date>)' file and opens it", /copy of/.test(copyNote), copyNote);

  /* 5: Library row button on the .txt; and PDF-less docx run */
  await page.goto(BASE + "/#/library", { waitUntil: "load" });
  const row = page.locator('[data-testid="unfiled-row"]', { hasText: `vh-live-${stamp}` }).filter({ hasNotText: "copy of" }).first();
  await row.waitFor({ timeout: 60000 });
  ok("5. the file's Library row (no project) carries a Versions button", (await row.locator('[data-testid="library-version-history"]').count()) === 1);
  await row.locator('[data-testid="library-version-history"]').click();
  await page.waitForSelector('[data-testid="version-history"]', { timeout: 60000 });
  ok("   Versions from the Library row opens Review with the history sheet showing 4 rows", (await rows().count()) === 4);
  /* 7: phone width */
  await page.setViewportSize({ width: 390, height: 844 });
  const fit = await page.evaluate(() => { const e = document.querySelector('[data-testid="version-history"]'); const r = e.getBoundingClientRect(); return { w: r.width, iw: innerWidth, sw: document.documentElement.scrollWidth, shw: e.scrollWidth }; });
  ok("7. 390-wide: bottom sheet fits, no sideways scroll", fit.w <= fit.iw && fit.sw <= fit.iw && fit.shw <= fit.w + 1, JSON.stringify(fit));
  await page.setViewportSize({ width: 1440, height: 900 });

  ok("no download at any point", downloads.length === 0, downloads.join(","));
  const real = s.errors.filter((e) => !/tesseract|importScripts/i.test(e));
  ok("no page errors", real.length === 0, real.join(" | "));
} catch (e) { if (e.message !== "cleanup-only") ok("harness ran to the end", false, e.message.split("\n")[0] + " @ " + ((e.stack.match(/verify-version-history-live\.mjs:(\d+)/) || [])[1] || "?")); await page.screenshot({ path: "/tmp/vh-live-fail.png" }).catch(() => {}); }
await s.close(); // one signed-in browser at a time
/* PHASE 2 — .docx (real docx writer) and a PDF row, in a FRESH signed-in session (isolated from phase 1's tabs). */
if (!process.argv.includes("--cleanup-only")) {
  const s2 = await openSignedIn({ base: BASE });
  const p2 = s2.page; const PDF = `/tmp/vh-live-${stamp}.pdf`;
  { const s1 = "BT /F1 20 Tf 60 700 Td (VH LIVE PDF) Tj ET";
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    let pdf = "%PDF-1.4\n"; const off = [];
    objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
    const x = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    writeFileSync(PDF, Buffer.from(pdf, "latin1")); }
  const stored2 = (tag) => p2.evaluate(async (t) => { const q = await window.pfSupabase.from("doc_reviews").select("data").order("updated_at", { ascending: false }).limit(8); return (q.data || []).some((r) => JSON.stringify(r.data).includes(t) && (r.data.sources || []).some((x) => x.driveKey)); }, tag);
  const waitStored2 = async (tag) => { for (let i = 0; i < 40; i++) { if (await stored2(tag)) return true; await p2.waitForTimeout(2000); } return false; };
  try {
    await p2.goto(BASE + "/#/markup", { waitUntil: "load" });
    await p2.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 30000 });
    await p2.setInputFiles('[data-testid="review-file-input"]', DOCX);
    await p2.waitForSelector('[data-testid="doc-editor"]', { timeout: 60000 });
    ok("   .docx original stored in the cloud record", await waitStored2(`${stamp}.docx`));
    for (let attempt = 1; attempt <= 4; attempt++) {
      await p2.locator('[data-testid="doc-editor-page"]').click(); await p2.keyboard.press("Control+End"); await p2.keyboard.type(" docx v2.");
      await p2.locator('[data-testid="doc-save"]').click();
      const r = await p2.waitForFunction(() => { const t = document.querySelector('[data-testid="doc-save-status"]')?.textContent || ""; return /Saved/.test(t) ? "ok" : /Couldn|HTTP|try again/.test(t) ? "err" : false; }, null, { timeout: 90000 }).then((h) => h.jsonValue(), () => "timeout");
      if (r === "ok") break; await p2.waitForTimeout(5000);
    }
    await p2.locator('[data-testid="doc-history"]').click(); await p2.waitForSelector('[data-testid="version-history"]');
    ok("   .docx: after one Save the list has 2 versions", (await p2.locator('[data-testid="vh-row"]').count()) === 2);
    await p2.locator('[data-testid="vh-row"]').nth(1).locator('[data-testid="vh-open"]').click();
    await p2.waitForSelector('[data-testid="doc-readonly-banner"]', { timeout: 60000 });
    const t = await p2.locator('[data-testid="doc-editor-page"]').innerText();
    ok("   .docx: the earlier version opens read-only with the ORIGINAL content (no 'docx v2.')", !t.includes("docx v2.") && t.length > 20 && (await p2.locator('[data-testid="doc-editor-page"]').getAttribute("contenteditable")) === "false");
    /* 6: a PDF row */
    await p2.goto(BASE + "/#/markup", { waitUntil: "load" });
    await p2.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 30000 });
    await p2.setInputFiles('[data-testid="review-file-input"]', PDF);
    await p2.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, null, { timeout: 60000 });
    await waitStored2(`${stamp}.pdf`);
    await p2.locator('[data-testid="version-history-open"]').click(); await p2.waitForSelector('[data-testid="version-history"]');
    ok("6. PDF: one version listed with the 'one stored file' note, no Open/Restore", (await p2.locator('[data-testid="vh-row"]').count()) === 1 && (await p2.locator('[data-testid="vh-pdf-note"]').count()) === 1 && (await p2.locator('[data-testid="vh-open"]').count()) === 0);
  } catch (e) { ok("phase 2 ran to the end", false, e.message.split("\n")[0] + " @ " + ((e.stack.match(/verify-version-history-live\.mjs:(\d+)/) || [])[1] || "?")); await p2.screenshot({ path: "/tmp/vh-live-fail2.png" }).catch(() => {}); }
  await s2.close();
}
/* CLEANUP — delete every throwaway this run made (names carry "vh-live-"), then delete forever from the bin. */
{ const sc = await openSignedIn({ base: BASE }); const page = sc.page; // its own session: phase 1's browser is already closed
try {
  await page.goto(BASE + "/#/library", { waitUntil: "load" });
  const mine = () => page.locator('[data-testid="unfiled-row"]', { hasText: "vh-live-" });
  await mine().first().waitFor({ timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 20 && (await mine().count()) > 0; i++) {
    const n = await mine().count();
    await mine().first().locator('[data-testid="trash-delete"]').click();
    await page.locator('[data-testid="trash-confirm"]').first().click();
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid="unfiled-row"]').length < k || k === 0, await page.locator('[data-testid="unfiled-row"]').count(), { timeout: 15000 }).catch(() => {});
    if ((await mine().count()) >= n) await page.waitForTimeout(1500);
  }
  await page.getByRole("button", { name: /Recently deleted/ }).first().click();
  const bin = () => page.locator('[data-testid="deleted-row"]', { hasText: "vh-live-" });
  await bin().first().waitFor({ timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 20 && (await bin().count()) > 0; i++) {
    await bin().first().locator('[data-testid="deleted-purge"]').click();
    await page.locator('[data-testid="deleted-purge-confirm"]').first().click();
    await page.waitForTimeout(2500);
  }
  ok("cleanup: no vh-live-* file left in the Library or its bin", (await bin().count()) === 0 && (await mine().count()) === 0);
} catch (e) { ok("cleanup ran", false, e.message.split("\n")[0]); }
await sc.close(); }
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed  (build ${JSON.stringify(s.build)})`);
process.exit(bad.length ? 1 : 0);
