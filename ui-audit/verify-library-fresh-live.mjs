/* verify-library-fresh-live — V1500112 / B2084480 (+ B2084481's tag). SIGNED IN as the throwaway test account on a real
 * deploy, TWO tabs of one browser: tab B sits on the Library Home, tab A saves files from Review, then switches to its
 * own Library tab. Neither tab ever reloads (a window marker proves it) and tab B is never focused or touched, so only
 * the same-document signal (tab A) and the BroadcastChannel (tab B) can have updated it — not the focus refetch.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-library-fresh-live.mjs [https://planyr.io]
 * KNOWN-GOOD ARM: a file that already existed before the run must be listed in BOTH tabs, else the probe cannot see the list.
 * Cleans up through the app's own delete (✕ → Recently deleted → Delete forever); reports exactly what it touched. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "https://planyr.io";
const RUN = "zz-v1500112-" + Date.now().toString(36);
const DOC = new URL("../test/fixtures/deeds/deed-poa-parcel3.doc", import.meta.url).pathname;
const pdfBuf = (() => {
  const s1 = "BT /F1 20 Tf 60 700 Td (V1500112 THROWAWAY) Tj ET";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
})();

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };
const touched = [];

const s = await openSignedIn({ base: BASE });
const A = s.page;
const B = await s.context.newPage();
const errs = []; B.on("pageerror", (e) => errs.push(String(e)));
console.log("served build:", JSON.stringify(s.build), "| signed in as", s.proof.email);
try {
  if (process.env.CLEAN_ONLY) throw new Error("CLEAN_ONLY");
  await assertMeasurable(A, "verify-library-fresh-live A");
  await B.goto(BASE + "/#/library", { waitUntil: "load" });
  await B.waitForSelector('[data-testid="library-home"]', { timeout: 30000 });
  const vis = await B.evaluate(() => document.visibilityState);
  console.log("tab B visibilityState:", vis);
  await A.evaluate(() => { window.__noReload = "A"; }); await B.evaluate(() => { window.__noReload = "B"; });

  const rows = (p) => p.evaluate(() => [...document.querySelectorAll('[data-testid="library-home"] [data-testid="unfiled-row"]')].map((r) => ({ id: r.getAttribute("data-review-id"), text: r.innerText.replace(/\s+/g, " "), tag: (r.querySelector('[data-testid="file-type-tag"]') || {}).textContent || null })));
  const recent = (p) => p.evaluate(() => [...document.querySelectorAll('[data-testid="library-home"] [data-testid="file-type-tag"]')].map((t) => t.closest("div[style]")?.innerText.replace(/\s+/g, " ") || ""));
  const waitRow = async (p, base, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = (await rows(p)).find((x) => x.text.includes(base)); if (r) return { ...r, ms: Date.now() - t0 }; await p.waitForTimeout(400); } return null; };

  /* KNOWN-GOOD ARM: whatever the account already lists must appear identically in both tabs. */
  await A.goto(BASE + "/#/library", { waitUntil: "load" }); await A.waitForSelector('[data-testid="library-home"]', { timeout: 30000 });
  await A.evaluate(() => { window.__noReload = "A"; });
  await A.waitForTimeout(2500);
  const preA = await rows(A), preB = await rows(B);
  console.log(`before: tab A Unfiled ${preA.length}, tab B Unfiled ${preB.length}`);
  ok("known-good arm: both tabs list the same pre-existing Unfiled rows", preA.map((r) => r.id).sort().join() === preB.map((r) => r.id).sort().join());

  const goReview = async () => { await A.evaluate(() => { location.hash = "#markup"; }); await A.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 20000 }); };
  const goLibrary = async () => { await A.evaluate(() => { const b = [...document.querySelectorAll("header button")].find((x) => (x.textContent || "").trim() === "Library"); b && b.click(); }); await A.waitForSelector('[data-testid="library-home"]', { timeout: 20000 }); };

  const cases = [
    { label: ".docx", file: { name: `${RUN}-a.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(buildFixtureDocx()) }, base: `${RUN}-a`, tag: "DOCX", edit: true },
    { label: ".txt", file: { name: `${RUN}-b.txt`, mimeType: "text/plain", buffer: Buffer.from("alpha\r\nbeta\r\n") }, base: `${RUN}-b`, tag: "TXT", edit: true },
    { label: "PDF", file: { name: `${RUN}-c.pdf`, mimeType: "application/pdf", buffer: pdfBuf }, base: `${RUN}-c`, tag: "PDF", edit: false },
    { label: ".doc → Save as .docx", file: { name: `${RUN}-d.doc`, mimeType: "application/msword", buffer: readFileSync(DOC) }, base: `${RUN}-d`, tag: "DOCX", docTag: "DOC", edit: true, asNew: true },
  ];
  for (const c of cases) { try {
    console.log(`\n── ${c.label} (${c.file.name})`);
    await goReview();
    await A.setInputFiles('[data-testid="review-file-input"]', c.file);
    if (c.edit) {
      await A.waitForSelector('[data-testid="doc-editor"]:visible', { timeout: 30000 });
      await A.waitForTimeout(1500);
      await A.locator('[data-testid="doc-editor-page"]:visible').first().click({ position: { x: 40, y: 20 } });
      await A.keyboard.press("End"); await A.keyboard.type(" v1500112");
      await A.locator('[data-testid="doc-save"]:visible').click();
      await A.waitForSelector('[data-testid="doc-save-status"]:visible', { timeout: 60000 });
      await A.waitForFunction(() => /Saved/.test([...document.querySelectorAll('[data-testid="doc-save-status"]')].map((e) => e.innerText).join(" ")), null, { timeout: 60000 });
      console.log("   save status:", (await A.locator('[data-testid="doc-save-status"]:visible').first().innerText()).slice(0, 140));
    } else {
      await A.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, null, { timeout: 30000 });
      await A.waitForTimeout(3000);
    }
    await goLibrary(); // same tab, NO reload
    const want = c.asNew ? c.tag : null;
    const waitTagged = async (p, base) => { const t0 = Date.now(); while (Date.now() - t0 < 25000) { const r = (await rows(p)).filter((x) => x.text.includes(base) && (!want || x.tag === want))[0]; if (r) return { ...r, ms: Date.now() - t0 }; await p.waitForTimeout(400); } return null; };
    const a = await waitTagged(A, c.base), b = await waitTagged(B, c.base);
    if (a) touched.push(a.id);
    ok(`${c.label}: tab A Library lists it without a reload`, !!a, a ? `${a.ms} ms · tag ${a.tag}` : "never appeared in 25 s");
    ok(`${c.label}: tab B (never touched) lists it without a reload`, !!b, b ? `${b.ms} ms · tag ${b.tag}` : "never appeared in 25 s");
    if (a) ok(`${c.label}: row carries the ${c.tag} tag`, a.tag === c.tag, `got ${a.tag}`);
    if (c.asNew) {
      // the .doc → .docx save: the ORIGINAL .doc row is not listed by Save-as-new alone; both names share one title base
      const all = (await rows(A)).filter((r) => r.text.includes(c.base));
      console.log("   rows sharing the base:", JSON.stringify(all.map((r) => ({ tag: r.tag, text: r.text.slice(0, 70) }))));
      ok(`${c.label}: BOTH the .doc and the .docx are listed, with different tags`, all.length === 2 && new Set(all.map((r) => r.tag)).size === 2, all.map((r) => r.tag).join("+"));
    }
  } catch (e) { ok(`${c.label}: case ran to completion`, false, String(e.message).split("\n")[0]); } }
  ok("neither tab reloaded during the run", (await A.evaluate(() => window.__noReload)) === "A" && (await B.evaluate(() => window.__noReload)) === "B");
  ok("tab B raised no page error", errs.length === 0, errs.slice(0, 2).join(" | "));
} catch (e) { if (e.message !== "CLEAN_ONLY") ok("harness ran to completion", false, e.message); }

/* cleanup — through the app's own delete (✕ → Recently deleted → Delete forever). Matches the run prefix, so a prior
 * aborted run's leftovers go too. Waits for the list to LOAD before counting (an early 0 is "not loaded", not "clean"). */
try {
  const P = "zz-v1500112-";
  const live = `[data-testid="unfiled-row"]:has-text("${P}")`, dead = `[data-testid="deleted-row"]:has-text("${P}")`;
  await A.evaluate(() => { location.hash = "#/library"; });
  await A.waitForSelector('[data-testid="library-home"]', { timeout: 20000 });
  await A.waitForTimeout(4000);
  for (let i = 0; i < 12 && (await A.locator(live).count()); i++) {
    const row = A.locator(live).first();
    await row.locator('[data-testid="trash-delete"]').click({ timeout: 8000 });
    await row.locator('[data-testid="trash-confirm"]').click({ timeout: 8000 });
    await A.waitForTimeout(1500);
  }
  const bin = A.locator('[data-testid="library-home-recently-deleted"]');
  if (await bin.count() && !(await A.locator('[data-testid="recently-deleted"]').count())) await bin.click();
  await A.waitForTimeout(2500);
  for (let i = 0, fails = 0; i < 16 && fails < 4 && (await A.locator(dead).count()); i++) {
    try { // the list re-renders under the click now and then: a missed click is retried, not fatal
      const d = A.locator(dead).first();
      await d.locator('[data-testid="deleted-purge"]').click({ timeout: 8000 });
      await A.locator('[data-testid="deleted-purge-confirm"]').first().click({ timeout: 8000 });
    } catch (_) { fails++; }
    await A.waitForTimeout(2500);
  }
  await A.waitForTimeout(1500);
  const left = (await A.locator(live).count()) + (await A.locator(dead).count());
  ok("cleanup: no throwaway row left (Unfiled or bin)", left === 0, `${left} left`);
} catch (e) { ok("cleanup ran", false, String(e.message).split("\n")[0]); }
console.log(`\nTOUCHED: only rows named ${RUN}-{a,b,c,d} on the test account (${touched.length} ids seen): ${touched.join(", ")}`);
await s.close();
const bad = results.filter((r) => !r.pass);
console.log(bad.length ? `\n${bad.length} FAILED` : "\nALL PASSED");
process.exit(bad.length ? 1 : 0);
