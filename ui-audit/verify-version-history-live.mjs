/* V1459216 — LIVE signed-in run of Version history (B2034128) on the throwaway test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-version-history-live.mjs [https://planyr.io]
 * Throwaway files only (names start "vh-live-"), deleted at the end. Build from /version.json is read in the
 * SAME call as the assertions. */
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";

const BASE = process.argv[2] || "https://planyr.io";
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
  await page.locator('[data-testid="doc-save"]').click();
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || ""), { timeout: 60000 });
};
const openHistory = async () => { await page.locator('[data-testid="doc-history"]').click(); await page.waitForSelector('[data-testid="version-history"]'); };

try {
  /* 1-3: .txt saved three times, persisted, reloaded */
  await openFile(TXT);
  await page.waitForTimeout(4000); // let the initial upload + first autosave land
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
  await page.waitForFunction(() => !document.querySelector('[data-testid="doc-readonly-banner"]') && /Restored/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || ""), { timeout: 60000 });
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
  await page.waitForFunction(() => /copy of/.test(document.querySelector('[data-testid="doc-save-status"]')?.textContent || "") || /copy of/.test(document.body.innerText), { timeout: 60000 });
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

  /* .docx: one save, list shows 2 */
  await openFile(DOCX); await page.waitForTimeout(4000);
  await saveWith(" docx v2.");
  await openHistory();
  ok("   .docx: after one Save the list has 2 versions", (await rows().count()) === 2);
  await page.locator('[data-testid="vh-close"]').click();
  ok("no download at any point", downloads.length === 0, downloads.join(","));
  const real = s.errors.filter((e) => !/tesseract|importScripts/i.test(e));
  ok("no page errors", real.length === 0, real.join(" | "));
} catch (e) { ok("harness ran to the end", false, e.message.split("\n")[0]); await page.screenshot({ path: "/tmp/vh-live-fail.png" }).catch(() => {}); }
/* CLEANUP — delete every throwaway this run made (names carry "vh-live-"), then delete forever from the bin. */
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
  await page.getByText(/Recently deleted/).first().click();
  const bin = () => page.locator('[data-testid="deleted-row"]', { hasText: "vh-live-" });
  await bin().first().waitFor({ timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 20 && (await bin().count()) > 0; i++) {
    await bin().first().locator('[data-testid="deleted-purge"]').click();
    await page.locator('[data-testid="deleted-purge-confirm"]').first().click();
    await page.waitForTimeout(2500);
  }
  ok("cleanup: no vh-live-* file left in the Library or its bin", (await bin().count()) === 0 && (await mine().count()) === 0);
} catch (e) { ok("cleanup ran", false, e.message.split("\n")[0]); }
await s.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed  (build ${JSON.stringify(s.build)})`);
process.exit(bad.length ? 1 : 0);
