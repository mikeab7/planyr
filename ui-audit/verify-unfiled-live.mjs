/* Live check for B2039233 / V1464321 — signed in as the throwaway test account on a real deploy (planyr.io or a preview).
 *   node ui-audit/verify-unfiled-live.mjs [https://planyr.io]
 * Creates THREE throwaway files (name prefix v1464321-<stamp>) and deletes every one of them — soft delete, then
 * "Delete forever" from Recently deleted — in a finally block, so a failed step still cleans up. Nothing of Michael's is touched.
 *   A  Word file, no project → save banner says Unfiled → listed under Unfiled → opens from it → Move to project → leaves
 *      Unfiled and shows in that project's Library view
 *   B  PDF, no project → listed under Unfiled
 *   C  PDF opened while a project is selected → filed to that project (not Unfiled)
 * The /version.json build is read in the SAME call as the assertions (CLAUDE.md: a live PASS names its build). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const CLEAN_ONLY = process.argv[3] || null; // node … <base> <prefix> : only delete leftovers with that name prefix (no checks run)
const stamp = Date.now().toString(36);
const PFX = CLEAN_ONLY || "v1464321-" + stamp;
const DOCX = `/tmp/${PFX}-a.docx`, PDF_B = `/tmp/${PFX}-b.pdf`, PDF_C = `/tmp/${PFX}-c.pdf`;
writeFileSync(DOCX, buildFixtureDocx());
const mkPdf = (label) => {
  const s1 = `BT /F1 20 Tf 60 700 Td (${label}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
};
writeFileSync(PDF_B, mkPdf("LIVE CHECK B")); writeFileSync(PDF_C, mkPdf("LIVE CHECK C"));

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };
const s = await openSignedIn({ base: BASE });
const p = s.page; const T = (id) => p.locator(`[data-testid="${id}"]`);
await assertMeasurable(p, "verify-unfiled-live");
console.log("build:", JSON.stringify(s.build), "| signed in as", s.proof.email, "| prefix", PFX);

const go = async (hash) => { await p.goto(`${BASE}/${hash}`, { waitUntil: "load" }); await p.waitForTimeout(1500); };
const reviewReady = async () => { await p.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 60000 }); await p.waitForTimeout(2500); };
const libraryHome = async () => { await go("#/library"); await p.waitForSelector('[data-testid="library-home"]', { timeout: 60000 }); await p.waitForTimeout(4000); };
const unfiledRow = (tag) => T("unfiled-row").filter({ hasText: tag });
const waitRow = async (tag, ms = 45000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await unfiledRow(tag).count()) return true; await p.waitForTimeout(3000); await libraryHome(); } return false; };
let projectId = null;

try {
  if (CLEAN_ONLY) throw new Error("cleanup-only");
  /* ---- A: Word, no project ---- */
  await go("#/markup"); await reviewReady();
  await p.setInputFiles('[data-testid="review-file-input"]', DOCX);
  await p.waitForSelector('[data-testid="doc-editor"]', { timeout: 30000 });
  await p.locator('[data-testid="doc-editor-page"] p').first().click(); await p.keyboard.press("End"); await p.keyboard.type(" live-check");
  await T("doc-save").click();
  await p.waitForFunction(() => { const e = document.querySelector('[data-testid="doc-save-status"]'); return e && !/^Saving/.test(e.textContent); }, null, { timeout: 60000 });
  const banner = await T("doc-save-status").innerText();
  ok("A1 banner after Save names where the file went (Unfiled)", /Unfiled/.test(banner) && /Library/.test(banner), banner);
  await p.waitForTimeout(6000); // let the review row + file index land in the cloud
  await libraryHome();
  ok("A2 Library Home lists the saved Word file under Unfiled", await waitRow(PFX + "-a"));
  await unfiledRow(PFX + "-a").locator("button").first().click();
  await p.waitForSelector('[data-testid="doc-editor"]', { timeout: 45000 }).catch(() => {});
  ok("A3 clicking the Unfiled row opens it in Review", (await T("doc-editor").count()) === 1);
  await libraryHome(); await waitRow(PFX + "-a");
  const opts = await unfiledRow(PFX + "-a").locator('[data-testid="unfiled-move"] option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
  const target = opts.find((o) => o.v && /E2E Fixture/i.test(o.t)) || opts.find((o) => o.v);
  ok("A4 Move to project… offers the account's projects", !!target, `${opts.length - 1} options; using "${target && target.t}"`);
  projectId = target.v;
  await unfiledRow(PFX + "-a").locator('[data-testid="unfiled-move"]').selectOption(projectId);
  await p.waitForSelector('[data-testid="unfiled-note"]', { timeout: 60000 });
  const note = await T("unfiled-note").innerText();
  ok("A5 a confirmation line says it moved", /Moved/.test(note), note);
  ok("A6 the file left Unfiled", (await unfiledRow(PFX + "-a").count()) === 0);
  await go(`#/project/${encodeURIComponent(projectId)}/library`); await p.waitForTimeout(9000);
  ok("A7 the project's Library view lists the file", (await p.locator("body").innerText()).includes(PFX + "-a"));

  /* ---- B: PDF, no project ---- */
  await go("#/markup"); await reviewReady();
  await p.setInputFiles('[data-testid="review-file-input"]', PDF_B);
  await p.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, null, { timeout: 45000 });
  await p.waitForTimeout(9000);
  await libraryHome();
  ok("B1 a PDF opened with no project is listed under Unfiled too", await waitRow(PFX + "-b"));

  /* ---- C: PDF while a project is selected ---- */
  await go(`#/project/${encodeURIComponent(projectId)}/markup`); await reviewReady();
  await p.setInputFiles('[data-testid="review-file-input"]', PDF_C);
  await p.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, null, { timeout: 45000 });
  await p.waitForTimeout(9000);
  await go(`#/project/${encodeURIComponent(projectId)}/library`); await p.waitForTimeout(9000);
  ok("C1 a PDF opened inside a project is listed in that project's Library view", (await p.locator("body").innerText()).includes(PFX + "-c"));
  await libraryHome();
  ok("C2 …and is NOT under Unfiled", (await unfiledRow(PFX + "-c").count()) === 0);
} catch (e) {
  if (!CLEAN_ONLY) ok("harness ran to completion", false, String((e && e.stack) || e).slice(0, 500));
} finally {
  /* ---- cleanup: soft-delete then Delete forever, for everything with our prefix, wherever it lives ---- */
  const sweep = async (where) => {
    for (let guard = 0; guard < 6; guard++) {
      const btn = p.locator(`button[aria-label*="${PFX}"][data-testid="trash-delete"]`).first();
      if (!(await btn.count())) break;
      await btn.click(); await T("trash-confirm").first().click(); await p.waitForTimeout(2500);
    }
  };
  try {
    await libraryHome(); await sweep("home");
    if (projectId) { await go(`#/project/${encodeURIComponent(projectId)}/library`); await p.waitForTimeout(8000); await sweep("project"); }
    await libraryHome();
    const bin = T("library-home-recently-deleted");
    if (await bin.count()) {
      await bin.click(); await p.waitForTimeout(1500);
      for (let guard = 0; guard < 6; guard++) {
        const row = T("deleted-row").filter({ hasText: PFX }).first();
        if (!(await row.count())) break;
        await row.locator('[data-testid="deleted-purge"]').click(); await row.locator('[data-testid="deleted-purge-confirm"]').click(); await p.waitForTimeout(2500);
      }
    }
    await libraryHome();
    const left = await p.locator("body").innerText();
    ok("cleanup: no file with our prefix remains on Home (Unfiled/Recent)", !left.includes(PFX));
    const bin2 = T("library-home-recently-deleted");
    if (await bin2.count()) { await bin2.click(); await p.waitForTimeout(1500); ok("cleanup: nothing with our prefix left in Recently deleted", !(await p.locator("body").innerText()).includes(PFX)); }
  } catch (e) { ok("cleanup ran", false, String(e).slice(0, 300)); }
  await s.close();
}
const bad = results.filter((r) => !r.pass);
console.log(`\nbuild ${s.build && s.build.build}: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
