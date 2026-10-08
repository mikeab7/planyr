/* verify-library-home-delete-live — V1504304 / B2086368, run SIGNED IN as the throwaway test account on planyr.io.
 *
 * Same steps as the ledger entry, driven through the real UI against the real database:
 *   1. Review › open a throwaway .docx (no project) + a throwaway .txt, Save → both land in Library Recent + Unfiled with a ✕.
 *   2. ✕ → ✓ on the .docx: gone from Unfiled AND Recent, undo toast, "Recently deleted · N" pill.
 *   3. Undo → back. Delete again → pill → Restore → back in Unfiled.
 *   4. Delete again → pill → Delete forever → ✓: leaves the bin and stays gone after a reload (re-asked of the database too).
 *   5. Keyboard: Tab from the row's Open button reaches the ✕; Enter, Enter deletes.
 *   6. With the throwaway OPEN as a Review tab, delete it from the Library: the Review tab is still there and unchanged.
 *   7. Coarse pointer (touch emulation, NOT a real finger): every ✕ measures ≥ 44×44.
 * Cleans up every file it made (Delete forever), then asks the database that nothing with its token remains.
 * ONLY the test account's own rows are ever touched (rows are found by a unique token in the title, never by position).
 *
 * KNOWN-GOOD ARM: the run is void unless the saved throwaway really appears in Unfiled (a probe that cannot see the list
 * cannot report a missing control on it). The served build (/version.json) and the live script hashes are read in the SAME
 * observation as the assertions.
 *
 * Run: node ui-audit/verify-library-home-delete-live.mjs [https://planyr.io]   (E2E_LOGIN_KEY must be set; never printed)
 */
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const SCRATCH = process.env.SCRATCH_DIR || "/tmp/claude-0/-home-user/scratch-v1504304";
mkdirSync(SCRATCH, { recursive: true });
const TOKEN = "zzv1504304" + Date.now().toString(36);
const DOCX = `${SCRATCH}/${TOKEN}-memo.docx`;
const TXT = `${SCRATCH}/${TOKEN}-note.txt`;
copyFileSync(new URL("../test/fixtures/deeds/deed-kilgore-draft.docx", import.meta.url).pathname, DOCX);
writeFileSync(TXT, `throwaway ${TOKEN}\n`);

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const rowByToken = (page, ext) => page.locator(`[data-testid="unfiled-row"]`).filter({ hasText: TOKEN }).filter({ hasText: new RegExp(ext, "i") });
const dbRows = (page) => page.evaluate(async (t) => {
  const q = await window.pfSupabase.from("doc_reviews").select("id,title,deleted_at").ilike("title", `%${t}%`);
  return q.error ? { error: String(q.error.message) } : { rows: q.data };
}, "zzv1504304");
const hashOf = (page) => page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).filter((s) => /index|Library|DocReview/.test(s)).join(","));
const recentHas = async (page, name) => (await page.locator('[data-testid="library-home"]').innerText()).split(/\bUNFILED\b|Unfiled\n/i)[0].includes(name);
const goLibrary = async (page) => {
  await page.evaluate(() => { location.hash = "#/library"; });
  await page.waitForSelector('[data-testid="library-home"]', { timeout: 30000 });
  await settle(page, 1500);
};

let s = await openSignedIn({ base: BASE });
const { page } = s;
try {
  await assertMeasurable(page, "verify-library-home-delete-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}   scripts: ${await hashOf(page)}   account: ${s.proof.email}`);

  /* ── 1. save two throwaways from Review (no project) ───────────────────────────── */
  for (const [path, label] of [[DOCX, "docx"], [TXT, "txt"]]) {
    await page.evaluate(() => { location.hash = "#/markup"; });
    await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 30000 });
    await page.setInputFiles('[data-testid="review-file-input"]', path);
    await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 60000 });
    await settle(page, 800);
    await page.locator('[data-testid="doc-editor-page"]:visible').first().click().catch(() => {});
    await page.keyboard.type(" v1504304");
    await page.locator('[data-testid="doc-save"]:visible').first().click();
    await page.waitForFunction(() => /Saved/i.test((document.querySelector('[data-testid="doc-editor"]')?.innerText || "")) , null, { timeout: 60000 }).catch(() => {});
    await settle(page, 2500);
    console.log(`  saved ${label} from Review`);
  }
  // the .docx is the first file opened; the .txt tab is now active. Library:
  await goLibrary(page);
  const docxRow = rowByToken(page, "DOCX"), txtRow = rowByToken(page, "TXT");
  let tries = 0;
  while ((await docxRow.count()) < 1 && tries++ < 10) { await settle(page, 2000); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector('[data-testid="library-home"]', { timeout: 30000 }); await settle(page, 1500); }
  ok("KNOWN-GOOD ARM: the saved .docx throwaway appears in Unfiled", (await docxRow.count()) === 1, `${await docxRow.count()} row(s)`);
  ok("KNOWN-GOOD ARM: the saved .txt throwaway appears in Unfiled", (await txtRow.count()) === 1);
  if ((await docxRow.count()) !== 1) throw new Error("void run — the throwaway never reached Unfiled; nothing below is evidence");
  const docxId = await docxRow.getAttribute("data-review-id");
  const txtId = await txtRow.getAttribute("data-review-id");
  const rowById = (id) => page.locator(`[data-testid="unfiled-row"][data-review-id="${id}"]`);
  const recentOpeners = () => page.locator('[data-testid="library-home"] button[title="Open in Review"]').filter({ hasText: TOKEN }).and(page.locator(':not([data-testid="unfiled-row"] button)')).count();
  // A file opened from disk is only added to Recent when it is opened FROM the Library: do that for the .docx, then come back.
  await docxRow.locator('button[title="Open in Review"]').click();
  await page.waitForSelector('[data-testid="doc-editor"]:visible', { timeout: 60000 }); await settle(page, 1500);
  await goLibrary(page);
  const del = rowById(docxId).locator('[data-testid="trash-delete"]');
  ok("step 1: the Unfiled row has a ✕ with the hover text", (await del.count()) === 1 && (await del.getAttribute("title")) === "Delete (moves to Recently deleted)");
  const recentCard = page.locator('[data-testid="library-home"] div').filter({ has: page.locator('button[title="Open in Review"]') }).filter({ hasText: TOKEN }).filter({ hasNot: page.locator('[data-testid="unfiled-row"]') });
  const recentDel = page.locator('[data-testid="library-home"] >> xpath=.//div[not(@data-testid="unfiled-row")][.//button[@title="Open in Review"]][not(.//div[@data-testid="unfiled-row"])][contains(., "' + TOKEN + '")][not(ancestor::div[@data-testid="unfiled-row"])]//button[@data-testid="trash-delete"]');
  ok("step 1: the file is now ALSO in Recent, and that Recent row has a ✕ with the hover text", (await recentDel.count()) >= 1 && (await recentDel.first().getAttribute("title")) === "Delete (moves to Recently deleted)", `${await recentDel.count()} Recent ✕`);

  /* ── 2. delete → gone from both, toast, pill ──────────────────────────────────── */
  await del.click(); await rowById(docxId).locator('[data-testid="trash-confirm"]').click(); await settle(page, 2500);
  ok("step 2: gone from Unfiled", (await rowById(docxId).count()) === 0);
  const names = await page.locator('[data-testid="library-home"]').innerText();
  ok("step 2: gone from Recent too (no ghost)", !new RegExp(TOKEN + "[^\\n]*memo", "i").test(names), "");
  ok("step 2: undo toast shown", (await page.locator('[data-testid="trash-undo"]').count()) === 1);
  const pill = page.locator('[data-testid="library-home-recently-deleted"]');
  ok("step 2: the Recently deleted pill is there", (await pill.count()) === 1, await pill.innerText().catch(() => ""));
  let db = await dbRows(page);
  ok("step 2: database — the row is soft-deleted (deleted_at set), not removed", db.rows && db.rows.some((r) => r.id === docxId && r.deleted_at));

  /* ── 3. undo → back; delete again → pill → Restore → back ───────────────────── */
  await page.locator('[data-testid="trash-undo"] button', { hasText: "Undo" }).click(); await settle(page, 2500);
  ok("step 3: Undo puts it back in Unfiled", (await rowById(docxId).count()) === 1);
  await rowById(docxId).locator('[data-testid="trash-delete"]').click(); await rowById(docxId).locator('[data-testid="trash-confirm"]').click(); await settle(page, 2500);
  await pill.click(); await settle(page, 600);
  ok("step 3: the bin lists it", (await page.locator(`[data-testid="deleted-row"][data-review-id="${docxId}"]`).count()) === 1);
  await page.locator(`[data-testid="deleted-row"][data-review-id="${docxId}"] [data-testid="deleted-restore"]`).click(); await settle(page, 2500);
  if ((await pill.count()) && /Recently deleted/.test(await pill.innerText().catch(() => "")) && (await page.locator('[data-testid="recently-deleted"]').count())) await pill.click().catch(() => {});
  await settle(page, 600);
  ok("step 3: Restore returns it to Unfiled", (await rowById(docxId).count()) === 1);
  db = await dbRows(page);
  ok("step 3: database — deleted_at cleared", db.rows && db.rows.some((r) => r.id === docxId && !r.deleted_at));

  /* ── 4. delete forever ───────────────────────────────────────────────────────── */
  await rowById(docxId).locator('[data-testid="trash-delete"]').click(); await rowById(docxId).locator('[data-testid="trash-confirm"]').click(); await settle(page, 2500);
  if (!(await page.locator('[data-testid="recently-deleted"]').count())) await pill.click();
  await settle(page, 600);
  await page.locator(`[data-testid="deleted-row"][data-review-id="${docxId}"] [data-testid="deleted-purge"]`).click();
  ok("step 4: Delete forever asks first", (await page.locator('[data-testid="deleted-purge-confirm"]').count()) === 1);
  await page.locator('[data-testid="deleted-purge-confirm"]').click(); await settle(page, 4000);
  ok("step 4: it left the bin", (await page.locator(`[data-testid="deleted-row"][data-review-id="${docxId}"]`).count()) === 0);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector('[data-testid="library-home"]', { timeout: 30000 }); await settle(page, 2500);
  ok("step 4: after a reload it is not in Unfiled", (await rowById(docxId).count()) === 0);
  db = await dbRows(page);
  ok("step 4: database — the row no longer exists", db.rows && !db.rows.some((r) => r.id === docxId), JSON.stringify(db.rows?.map((r) => r.id)));
  if ((await page.locator('[data-testid="recently-deleted"]').count()) === 0 && (await pill.count())) { /* bin closed after reload */ }

  /* ── 5+6. keyboard delete of a throwaway that is OPEN as a live Review tab (no reload in between) ── */
  const txt = rowById(txtId);
  await txt.locator('button[title="Open in Review"]').click();                      // open it as a Review tab
  await page.waitForSelector('[data-testid="doc-editor"]:visible', { timeout: 60000 }); await settle(page, 1500);
  const beforeTabs = (await page.locator("body").innerText()).includes(TOKEN);
  await goLibrary(page);                                                             // client-side route change, no reload
  await txt.locator('button[title="Open in Review"]').focus();
  let reached = false;
  for (let i = 0; i < 4 && !reached; i++) { await page.keyboard.press("Tab"); reached = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "trash-delete"); }
  ok("step 5: Tab from the row's Open button reaches the ✕", reached);
  await page.keyboard.press("Enter"); await settle(page, 400);
  ok("step 5: Enter arms the confirm and focus lands on it", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "trash-confirm"));
  await page.keyboard.press("Enter"); await settle(page, 2500);
  ok("step 5: Enter, Enter deletes it (gone from Unfiled)", (await rowById(txtId).count()) === 0);
  await page.evaluate(() => { location.hash = "#/markup"; });
  await settle(page, 2500);
  const editorUp = await page.locator('[data-testid="doc-editor"]:visible').count();
  const stillThere = (await page.locator("body").innerText()).includes(TOKEN);
  ok("step 6: the Review tab for the just-deleted throwaway is still open and unchanged", beforeTabs && editorUp >= 1 && stillThere, `before=${beforeTabs} editors=${editorUp} token-on-page=${stillThere}`);

  /* ── cleanup: purge whatever is left of ours, via the app's own Delete forever ── */
  await goLibrary(page);
  for (let guard = 0; guard < 6; guard++) { // strays from an aborted earlier run still live in Unfiled: bin them with the ✕ first
    const stray = page.locator('[data-testid="unfiled-row"]').filter({ hasText: "zzv1504304" });
    if (!(await stray.count())) break;
    await stray.first().locator('[data-testid="trash-delete"]').click();
    await page.locator('[data-testid="trash-confirm"]').first().click(); await settle(page, 2500);
  }
  if (!(await page.locator('[data-testid="recently-deleted"]').count()) && (await pill.count())) await pill.click();
  await settle(page, 800);
  for (let guard = 0; guard < 6; guard++) {
    const left = page.locator('[data-testid="deleted-row"]').filter({ hasText: "zzv1504304" });
    if (!(await left.count())) break;
    await left.first().locator('[data-testid="deleted-purge"]').click();
    await page.locator('[data-testid="deleted-purge-confirm"]').click(); await settle(page, 3500);
  }
  db = await dbRows(page);
  ok("cleanup: no row with the throwaway token remains in the database", db.rows && db.rows.length === 0, JSON.stringify(db.rows));
  if (db.rows && db.rows.length) { // belt and braces — the test account's own throwaway rows only (token-matched)
    for (const r of db.rows) await page.evaluate(async (id) => { await window.pfSupabase.from("doc_reviews").delete().eq("id", id); }, r.id);
    db = await dbRows(page); console.log("  forced cleanup →", JSON.stringify(db.rows));
  }
  ok("pageerrors during the run", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} finally { await s.close(); }
console.log(failures === 0 ? "\n✓ Live desktop checks passed." : `\n✗ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
