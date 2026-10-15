/* verify-library-file-folder-live — V1688016 / B2262880 + B2262881, SIGNED IN as the throwaway test account.
 * Drops an unclassifiable PDF into the test account's fixture project Library, then: (1) the tray says Needs filing,
 * (2) the File row carries a folder picker and File is disabled until a folder is chosen, (3) File to Land › Survey,
 * (4) with NO reload the tray row is gone and the view agrees, (5) after a reload the file sits under Land › Survey and
 * NOT under Design. Cleans up its own throwaway rows (own rows, RLS) and re-asks the database that none remain.
 * KNOWN-GOOD ARM: the dropped file must really reach Needs filing (else the probe cannot see the thing it tests).
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-library-file-folder-live.mjs [https://planyr.io]   (key never printed) */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const TOKEN = "zzv1688016" + Date.now().toString(36);
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
  await assertMeasurable(page, "verify-library-file-folder-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}`);
  await page.goto(`${BASE}/#/project/${FIXTURE_SITE_ID}/library`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="library-unified"], [data-testid="library-root"]', { timeout: 40000 });
  await settle(page, 3000);
  await page.waitForSelector('[data-testid="folder-tree"]', { timeout: 40000 });
  await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles({ name: `${TOKEN}.pdf`, mimeType: "application/pdf", buffer: pdfBuf });
  // KNOWN-GOOD ARM: the tray must show Needs filing for our file
  const tray = page.locator(`text=${TOKEN}.pdf`).first();
  await tray.waitFor({ timeout: 90000 });
  await page.waitForFunction((t) => /Needs filing/i.test(document.body.innerText) && document.body.innerText.includes(t), TOKEN, { timeout: 90000 }).catch(() => {});
  const bodyHas = (re) => page.evaluate((r) => new RegExp(r, "i").test(document.body.innerText), re);
  ok("KNOWN-GOOD ARM: the tray shows 'Needs filing' for the dropped file", await bodyHas("Needs filing — confirm a discipline"));
  const q = await page.evaluate(async (t) => { const r = await window.pfSupabase.from("doc_reviews").select("id").ilike("title", `%${t}%`); return r.data || []; }, TOKEN);
  reviewId = q[0] && q[0].id;
  if (!reviewId) throw new Error("void run — the throwaway never reached doc_reviews");
  // open the Needs filing view
  const holdBtn = page.getByText(/^Needs filing/).first();
  await holdBtn.click().catch(() => {});
  await settle(page);
  const row = page.locator("div", { has: page.locator(`text=${TOKEN}`) }).filter({ has: page.locator('[data-testid="library-refile-folder"]') }).last();
  const picker = page.locator('[data-testid="library-refile-folder"]').first();
  ok("File row has a folder picker", (await picker.count()) === 1);
  const fileBtn = page.getByRole("button", { name: /^File$/ }).first();
  ok("File is disabled until a folder is chosen (unclassified file: no guess)", await fileBtn.isDisabled());
  const opts = await picker.locator("option").allInnerTexts();
  const survey = opts.find((o) => /Survey & Legal/i.test(o));
  ok("picker lists the Land › Survey & Legal Descriptions folder", !!survey, survey || "missing");
  await picker.selectOption({ label: survey });
  ok("File enabled after picking", await fileBtn.isEnabled());
  await fileBtn.click();
  await settle(page, 3500);
  ok("NO reload: the tray no longer says 'Needs filing — confirm a discipline'", !(await bodyHas("Needs filing — confirm a discipline")));
  ok("NO reload: the view says nothing is waiting", await bodyHas("Nothing waiting to be filed"));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="folder-tree"]', { timeout: 40000 });
  await settle(page, 3000);
  const rec = await page.evaluate(async (id) => { const r = await window.pfSupabase.from("doc_reviews").select("data").eq("id", id).single(); return r.data && r.data.data; }, reviewId);
  const rows = await page.evaluate(async (pid) => { const r = await window.pfSupabase.from("project_folders").select("id,name,parent_id").eq("project_id", pid); return r.data || []; }, FIXTURE_SITE_ID);
  const chosen = rows.find((r) => r.id === (rec && rec.folderId));
  ok("record stores the picked folderId (Survey & Legal Descriptions)", !!chosen && /Survey & Legal/.test(chosen.name), chosen ? chosen.name : "no folderId on record");
  const clickRow = async (re) => { await page.locator('[data-testid="folder-row"]').filter({ hasText: re }).first().click(); await settle(page, 1200); };
  await clickRow(/Survey & Legal/);
  ok("after reload the file is listed in Land › Survey & Legal Descriptions", await bodyHas(TOKEN));
  await clickRow(/04\. Design/);
  ok("…and NOT under 04. Design", !(await bodyHas(TOKEN)));
  ok("tray stays clear after reload", !(await bodyHas("Needs filing — confirm a discipline")));
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
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
