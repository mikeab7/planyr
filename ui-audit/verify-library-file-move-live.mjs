/* verify-library-file-move-live — Library file-row move + context menu, SIGNED IN as the test account, on a THROWAWAY project.
 * Files a PDF into Land › Survey (explicit folder drop), then: (1) NO ✕ on the file row; the ⋯ and a right-click both open the
 * same menu with the row's items; (2) DRAG the row onto 09. Geotech → it leaves Survey, sits in Geotech (UI + record folderId,
 * after a cache-busted reload); (3) right-click › Move to… › 08. Environmental, same confirmation; (4) dropping onto the folder
 * it is already in does nothing; (5) Rename… via the menu (Enter saves, the stored title changes); (6) Delete from the menu →
 * row gone, UndoToast → Undo restores it. KNOWN-GOOD ARM: the file must really sit in Survey first (else the probe is blind).
 * Cleans up its own rows and re-asks the database. Run: E2E_LOGIN_KEY=… node ui-audit/verify-library-file-move-live.mjs [base]  */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const PROJECT = `${LIVE_PREFIX}filemove-${Date.now().toString(36)}`; // a THROWAWAY project, never the fixture or a real one
const TOKEN = "zzfilemove" + Date.now().toString(36);
const pdfBuf = (() => {
  const s1 = `BT /F1 20 Tf 60 700 Td (${TOKEN}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
})();
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const settle = (p, ms = 1500) => p.waitForTimeout(ms);

const s = await openSignedIn({ base: BASE });
const { page } = s;
let reviewId = null;
try {
  await assertMeasurable(page, "verify-library-file-move-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}`);
  await seedThrowawayPlan(page, PROJECT);
  await page.goto(`${BASE}/#/project/${PROJECT}/library`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="folder-tree"]', { timeout: 60000 });
  await settle(page, 2500);
  if (!(await page.locator('[data-testid="folder-row"]').count())) {
    await page.getByRole("button", { name: /Create the standard/i }).first().click();
    await page.waitForSelector('[data-testid="folder-row"]', { timeout: 60000 });
  }
  await settle(page, 2500);
  const bodyHas = (re) => page.evaluate((r) => new RegExp(r, "i").test(document.body.innerText), re);
  const folderRow = (re) => page.locator('[data-testid="folder-row"]').filter({ hasText: re }).first();
  const clickRow = async (re) => { await folderRow(re).click(); await settle(page, 1200); };
  const rowFor = () => page.locator('[data-testid="library-file-row"]', { hasText: TOKEN });
  const dbRec = (id) => page.evaluate(async (i) => { const r = await window.pfSupabase.from("doc_reviews").select("title,deleted_at,data").eq("id", i).single(); return r.data; }, id);
  const folderName = async (fid) => { const rows = await page.evaluate(async (pid) => ((await window.pfSupabase.from("project_folders").select("id,name").eq("project_id", pid)).data || []), PROJECT); return (rows.find((r) => r.id === fid) || {}).name || ""; };
  const reloadFresh = async () => { await page.goto(`${BASE}/?cb=${Date.now()}#/project/${PROJECT}/library`, { waitUntil: "load" }); await page.waitForSelector('[data-testid="folder-tree"]', { timeout: 40000 }); await settle(page, 3000); };
  const openLand = async () => { const exp = folderRow(/02\. Land/).locator('[aria-label="Expand"]'); if (await exp.count()) { await exp.click(); await settle(page, 600); } };

  // File the PDF into Land › Survey by dropping through the picker while that folder is selected.
  await openLand();
  await clickRow(/Survey & Legal/);
  await page.locator('[data-testid="library-unified"] input[type=file]:not([webkitdirectory])').first().setInputFiles({ name: `${TOKEN}.pdf`, mimeType: "application/pdf", buffer: pdfBuf });
  await rowFor().first().waitFor({ timeout: 90000 });
  const q = await page.evaluate(async (t) => { const r = await window.pfSupabase.from("doc_reviews").select("id").ilike("title", `%${t}%`); return r.data || []; }, TOKEN);
  reviewId = q[0] && q[0].id;
  if (!reviewId) throw new Error("void run — the throwaway never reached doc_reviews");
  ok("KNOWN-GOOD ARM: the file sits in Land › Survey & Legal Descriptions", (await rowFor().count()) === 1 && /Survey & Legal/.test(await folderName((await dbRec(reviewId)).data.folderId)));

  // (1) no ✕; ⋯ and right-click open the same menu
  const row = rowFor().first();
  ok("no inline ✕ delete button on the file row", (await row.locator('[data-testid="trash-delete"]').count()) === 0);
  ok("the row has a ⋯ labelled for the file", (await row.locator('[data-testid="library-file-kebab"]').count()) === 1);
  const menu = page.locator('[data-testid="library-file-menu"]');
  await row.hover();
  await row.locator('[data-testid="library-file-kebab"]').click();
  await menu.waitFor({ timeout: 8000 });
  const kebabItems = await menu.locator('[role="menuitem"]').allInnerTexts();
  ok("⋯ opens the menu: Open · Download · Move to… · Rename… · Share link · Versions · Pin · Delete", ["Open", "Download", "Move to…", "Rename…", "Share link", "Versions", "Pin to Library home", "Delete"].every((t) => kebabItems.includes(t)), kebabItems.join(" | "));
  ok("Place is absent (not a mapped-able drawing)", !kebabItems.includes("Place on the map"));
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached", timeout: 5000 });
  await row.click({ button: "right" });
  await menu.waitFor({ timeout: 8000 });
  ok("right-click opens the same menu", JSON.stringify(await menu.locator('[role="menuitem"]').allInnerTexts()) === JSON.stringify(kebabItems));
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  ok("opens with focus on Open; two ArrowDowns land on Move to…", (await page.evaluate(() => document.activeElement && document.activeElement.textContent)) === "Move to…");
  await page.keyboard.press("Escape");

  // (4) drop onto the folder it is already in: no-op
  const before = (await dbRec(reviewId)).data.folderId;
  await row.dragTo(folderRow(/Survey & Legal/));
  await settle(page, 2500);
  ok("dropping onto its own folder is a no-op (no notice, record unchanged)", (await dbRec(reviewId)).data.folderId === before && !(await bodyHas("Couldn.t move")));

  // (2) DRAG to 09. Geotech
  await row.dragTo(folderRow(/09\. Geotech/));
  await settle(page, 4000);
  ok("DRAG: the row left the Survey view", (await rowFor().count()) === 0);
  let rec = await dbRec(reviewId);
  ok("DRAG: the record stores the Geotech folderId", /Geotech/.test(await folderName(rec.data.folderId)), await folderName(rec.data.folderId));
  const ff = await page.evaluate(async (id) => (await window.pfSupabase.from("file_facts").select("id,project_id,needs_filing").eq("id", id).maybeSingle()).data, reviewId);
  ok("DRAG: file_facts row still filed to the project", !!ff && ff.project_id === PROJECT && ff.needs_filing === false, JSON.stringify(ff));
  await reloadFresh();
  await openLand();
  await clickRow(/09\. Geotech/);
  ok("DRAG: after a cache-busted reload the file is listed under 09. Geotech", (await rowFor().count()) === 1);

  // (3) right-click › Move to… › 08. Environmental
  await rowFor().first().click({ button: "right" });
  await menu.waitFor({ timeout: 8000 });
  await page.locator('[data-testid="file-menu-move"]').click();
  const mv = page.locator('[data-testid="library-move-folder"]');
  await mv.waitFor({ timeout: 8000 });
  const curOpt = (await mv.locator("option:checked").innerText()) || "";
  ok("Move to… pre-selects the current folder, marked (current)", /Geotech.*\(current\)/.test(curOpt), curOpt);
  const envLabel = (await mv.locator("option").allInnerTexts()).find((o) => /08\. Environmental/.test(o));
  await mv.selectOption({ label: envLabel });
  await page.locator('[data-testid="library-move-confirm"]').click();
  await settle(page, 4000);
  ok("Move to…: the row left the Geotech view", (await rowFor().count()) === 0);
  rec = await dbRec(reviewId);
  ok("Move to…: the record stores the Environmental folderId", /08\. Environmental/.test(await folderName(rec.data.folderId)), await folderName(rec.data.folderId));
  await reloadFresh();
  await openLand();
  await clickRow(/08\. Environmental/);
  ok("Move to…: after reload the file is under 08. Environmental", (await rowFor().count()) === 1);

  // (5) Rename via the menu
  const NEWNAME = `${TOKEN} renamed`;
  await rowFor().first().click({ button: "right" });
  await menu.waitFor({ timeout: 8000 });
  await page.locator('[data-testid="file-menu-rename"]').click();
  const inp = page.locator('[data-testid="library-rename-input"]');
  await inp.waitFor({ timeout: 8000 });
  await inp.fill(NEWNAME);
  await inp.press("Enter");
  await settle(page, 3500);
  rec = await dbRec(reviewId);
  ok("Rename: Enter saved the stored title (typed titles are flagged so a project rename can't overwrite them)", rec.title === NEWNAME && rec.data.titleAuto === false, rec.title);
  ok("Rename: the Library row shows the new name", (await rowFor().first().innerText()).includes("renamed"));

  // (6) Delete from the menu → gone → Undo
  await rowFor().first().click({ button: "right" });
  await menu.waitFor({ timeout: 8000 });
  await page.locator('[data-testid="file-menu-delete"]').click();
  await settle(page, 3500);
  ok("Delete: the row is gone with no arm/confirm step", (await rowFor().count()) === 0);
  ok("Delete: the Undo toast shows", (await page.locator('[data-testid="trash-undo"]').count()) === 1);
  ok("Delete: the record is soft-deleted", !!(await dbRec(reviewId)).deleted_at);
  await page.locator('[data-testid="trash-undo"] button', { hasText: "Undo" }).click();
  await settle(page, 3500);
  ok("Undo: the row is back and the record restored", (await rowFor().count()) === 1 && !(await dbRec(reviewId)).deleted_at);
} catch (e) {
  console.log("ERROR", e && e.message); failures++;
} finally {
  if (reviewId) {
    const left = await page.evaluate(async (id) => {
      await window.pfSupabase.from("file_facts").delete().eq("id", id);
      await window.pfSupabase.from("doc_reviews").delete().eq("id", id);
      const a = await window.pfSupabase.from("doc_reviews").select("id").eq("id", id);
      return (a.data || []).length;
    }, reviewId).catch(() => "unknown");
    ok("cleanup: throwaway review removed (verified)", left === 0, `rows left: ${left}`);
  }
  const pf = await page.evaluate(async (pid) => { await window.pfSupabase.from("project_folders").delete().eq("project_id", pid); return ((await window.pfSupabase.from("project_folders").select("id").eq("project_id", pid)).data || []).length; }, PROJECT).catch(() => "unknown");
  const cl = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)], left: {} }));
  ok("cleanup: throwaway project + its folders removed (verified)", pf === 0 && cl.left.site === 0, `folders left: ${pf}, project left: ${cl.left.site}, errors: ${(cl.errors || []).join("; ") || "none"}`);
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
