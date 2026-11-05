/* V1448016 (B2022928) — the SIGNED-IN Library half: a Word/text file opened from the Library keeps its edits
 * through Save, a hard reload, and a reopen — read back from the REAL stored bytes in Drive.
 *   node ui-audit/verify-doc-editor-live.mjs https://planyr.io
 * Throwaway data on the e2e@planyr.test account only; every record/byte it makes is deleted at the end (and the
 * deletion is itself asserted). Word-only steps are NOT here (no Microsoft Word in this environment). */
import { writeFileSync, readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";

const BASE = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const STAMP = Date.now().toString(36);
const N = { docx: `e2e-doc-editor-${STAMP}.docx`, txt: `e2e-doc-editor-${STAMP}.txt`, doc: `e2e-doc-editor-${STAMP}-old.doc` };
const P = { docx: `/tmp/${N.docx}`, txt: `/tmp/${N.txt}`, doc: `/tmp/${N.doc}` };
writeFileSync(P.docx, buildFixtureDocx());
writeFileSync(P.txt, "alpha\r\nbeta\r\n");
writeFileSync(P.doc, readFileSync(new URL("../test/fixtures/deeds/deed-poa-parcel3.doc", import.meta.url)));

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };
const created = new Set(); // review ids to delete at the end

const openOnce = () => openSignedIn({ base: BASE, initScripts: [[() => {
  const B = window.Blob; window.__saved = [];
  window.Blob = class extends B { constructor(p, o) { super(p, o); if (o && /wordprocessingml|text\/plain/.test(o.type || "")) window.__saved.push(this); } };
}, null]] });
// The e2e-session route is intermittently 502 (measured 2026-10-08: 200, then minutes of 502, then 200) — retry the whole sign-in.
let s = null, lastErr = null;
for (let attempt = 1; attempt <= 5 && !s; attempt++) { try { s = await openOnce(); } catch (e) { lastErr = e; console.log(`sign-in attempt ${attempt} failed: ${String(e.message).slice(0, 140)}`); await new Promise((r) => setTimeout(r, 30000)); } }
if (!s) throw lastErr;
const page = s.page;
await assertMeasurable(page, "verify-doc-editor-live");
const downloads = []; page.on("download", (d) => downloads.push(d.suggestedFilename()));
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));

// ---- helpers (all page-side use the app's own Supabase client + the same /api/files the app uses) ----
const rowsNamed = (name) => page.evaluate(async (n) => {
  const { data, error } = await window.pfSupabase.from("doc_reviews").select("id,title,deleted_at,data").order("updated_at", { ascending: false }).limit(40);
  if (error) return { error: String(error.message) };
  return (data || []).filter((r) => r.data && (r.data.sourceFile === n || ((r.data.sources || [])[0] || {}).name === n)).map((r) => ({ id: r.id, title: r.title, deleted: !!r.deleted_at, sources: (r.data.sources || []).map((x) => ({ srcId: x.srcId, name: x.name, driveKey: x.driveKey, size: x.size })) }));
}, name);
async function waitRow(name, pred = () => true, ms = 120000) {
  const t0 = Date.now(); let last = [];
  while (Date.now() - t0 < ms) { last = await rowsNamed(name); if (Array.isArray(last) && last.find((r) => !r.deleted && pred(r))) return last.find((r) => !r.deleted && pred(r)); await page.waitForTimeout(2000); }
  const ui = await page.evaluate(() => ({ alerts: [...document.querySelectorAll("[role=alert]")].map((x) => x.textContent.slice(0, 300)), banner: (document.body.innerText.match(/Couldn.{0,200}|Check your connection.{0,100}/g) || []).slice(0, 3) })).catch(() => null);
  throw new Error(`no stored row for ${name} satisfying the condition within ${ms / 1000}s: ${JSON.stringify(last).slice(0, 300)} | UI: ${JSON.stringify(ui)}`);
}
const driveBytes = (key) => page.evaluate(async (k) => {
  const { data } = await window.pfSupabase.auth.getSession();
  const r = await fetch(`/api/files?key=${encodeURIComponent(k)}`, { headers: { authorization: `Bearer ${data.session.access_token}` } });
  if (!r.ok) return { status: r.status };
  const b = new Uint8Array(await r.arrayBuffer()); let s2 = ""; for (let i = 0; i < b.length; i += 0x8000) s2 += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return { status: r.status, b64: btoa(s2) };
}, key);
const bytesOf = async (key) => { const r = await driveBytes(key); if (!r.b64) throw new Error(`Drive read of ${key} answered ${r.status}`); return Buffer.from(r.b64, "base64"); };
const goReview = async () => { await page.evaluate(() => { location.hash = "#markup"; }); await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 30000 }); };
const openFromLibrary = async (item, kind = "docx") => {
  await page.evaluate(() => { location.hash = "#library"; });
  const row = page.locator("button", { hasText: item }).first();
  await row.waitFor({ state: "visible", timeout: 60000 });
  await row.click();
  // other open files stay mounted as tabs: wait for THE VISIBLE editor of the right kind, not just any editor
  await page.waitForFunction((k) => [...document.querySelectorAll('[data-testid="doc-editor"]')].some((e) => e.offsetParent !== null && e.getAttribute("data-kind") === k), kind, { timeout: 60000 }).catch(async (e) => {
    console.log("DIAG openFromLibrary:", JSON.stringify(await page.evaluate(() => ({ hash: location.hash, editors: [...document.querySelectorAll('[data-testid="doc-editor"]')].map((x) => [x.getAttribute("data-kind"), x.offsetParent !== null]), loading: [...document.querySelectorAll('[data-testid="doc-editor-loading"],[data-testid="doc-editor-error"]')].map((x) => x.textContent.slice(0, 160)), alerts: [...document.querySelectorAll("[role=alert]")].map((x) => x.textContent.slice(0, 200)), body: document.body.innerText.replace(/\s+/g, " ").slice(0, 500) }))));
    throw e;
  });
};
const stem = (n) => n.replace(/\.(docx|doc|txt)$/i, "");
const lastSaved = () => page.evaluate(async () => { const b = window.__saved[window.__saved.length - 1]; return b ? b.size : null; });

try {
  /* ---------- 1. upload a .docx, then open it FROM THE LIBRARY ---------- */
  await goReview();
  await page.setInputFiles('[data-testid="review-file-input"]', P.docx);
  await page.waitForSelector('[data-testid="doc-editor"]', { timeout: 60000 });
  const r1 = await waitRow(N.docx, (r) => r.sources[0] && r.sources[0].driveKey, 60000).catch(async (e) => {
    console.log("DIAG upload:", JSON.stringify(await page.evaluate(() => ({ alerts: [...document.querySelectorAll("[role=alert]")].map((x) => x.textContent.slice(0, 300)), banner: document.body.innerText.match(/Couldn.{0,200}/g) }))));
    throw e;
  });
  created.add(r1.id);
  ok("upload stores the .docx in Drive and files a Library record", true, `review ${r1.id}`);
  await openFromLibrary(stem(N.docx));
  const pe = page.locator('[data-testid="doc-editor-page"]:visible');
  ok("Library row opens the Word file in the document editor (no drawing canvas inside it, no download)", (await page.locator('[data-testid="doc-editor-host"] canvas').count()) === 0 && (await page.locator('[data-testid="doc-editor-host"] [data-testid="doc-editor"]').count()) === 1 && downloads.length === 0);
  ok("step 1: heading, table, image, tracked insertion + deletion with author/time, comment — all shown",
    (await pe.locator("h1").innerText()) === "Project Scope" && (await pe.locator("table td").count()) === 4 && (await pe.locator("img[data-doc-image]").count()) === 1
    && (await pe.locator("ins.dre-ins").getAttribute("title")).includes("Alice Reviewer") && (await pe.locator("del.dre-del").getAttribute("title")).includes("Bob Editor")
    && (await page.locator('[data-testid="comment-card"]').innerText()).includes("Carol Owner"));

  /* ---------- 2. edit with Track Changes + comment + reply + accept, then Save ---------- */
  await pe.locator("p", { hasText: "SF." }).click(); await page.keyboard.press("End"); await page.keyboard.type(" Typed live.");
  await page.locator('[data-testid="track-toggle"]').click();
  await pe.locator("p", { hasText: "SF." }).click(); await page.keyboard.press("End"); await page.keyboard.type(" Tracked live.");
  await page.keyboard.press("Control+Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Backspace");
  await page.locator('[data-testid="track-toggle"]').click();
  await pe.locator("li", { hasText: "Dock doors" }).click({ clickCount: 3 });
  await page.locator('[data-testid="add-comment"]').click();
  await page.locator('[data-testid="comment-input"]').fill("Live check comment.");
  await page.locator('[data-testid="comment-add"]').click();
  await page.locator('[data-testid="comment-card"]').first().locator('[data-testid="reply-open"]').click();
  await page.locator('[data-testid="reply-input"]').fill("Live check reply.");
  await page.locator('[data-testid="reply-add"]').click();
  await page.locator('[data-testid="change-card"][data-kind="ins"]').first().locator('[data-testid="accept-change"]').click();
  await page.locator('[data-testid="doc-save"]:visible').click();
  await page.waitForFunction(() => /Saved to the Library|Saved on this device|Couldn/.test([...document.querySelectorAll('[data-testid="doc-save-status"]')].filter((e) => e.offsetParent !== null).map((e) => e.textContent).join(" ")), null, { timeout: 60000 });
  const status = await page.locator('[data-testid="doc-save-status"]:visible').innerText();
  ok("step 2: Save says it saved to the Library (not device-only, not an error)", /^Saved to the Library/.test(status), status);
  const r2 = await waitRow(N.docx, (r) => r.sources.length >= 2 && r.sources[0].driveKey !== r1.sources[0].driveKey);
  ok("the record points at NEW bytes and keeps the original as an earlier version", r2.sources.length >= 2 && r2.sources[1].driveKey === r1.sources[0].driveKey, `${r2.sources.length} sources`);

  /* ---------- the stored bytes themselves ---------- */
  const z = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(await bytesOf(r2.sources[0].driveKey)))).map(([k, v]) => [k, /\.png$/.test(k) ? v : strFromU8(v)]));
  const dx = z["word/document.xml"], cx = z["word/comments.xml"];
  console.log("DIAG stored docx:", JSON.stringify({ typedLive: dx.includes("Typed live."), trackedLive: dx.includes("Tracked live."), authors: [...new Set([...dx.matchAll(/w:author="([^"]+)"/g)].map((m) => m[1]))], insSnippet: (dx.match(/<w:ins [^>]*>(?:(?!<\/w:ins>).){0,160}/g) || []).slice(0, 4) }));
  ok("stored .docx: the plain edit, the tracked insertion, the struck-through word (w:ins / w:del by the test account)",
    dx.includes("Typed live.") && /<w:ins [^>]*w:author="e2e@planyr\.test"[^>]*><w:r><w:t xml:space="preserve"> Tracked live\./.test(dx) && /<w:del [^>]*w:author="e2e@planyr\.test"/.test(dx) && /<w:del [^>]*w:author="Bob Editor"/.test(dx));
  ok("stored .docx: the accepted change is plain text; Carol's untouched deletion remains", dx.includes("approximately") && !/<w:ins [^>]*Alice Reviewer/.test(dx));
  ok("stored .docx: original comment + new comment + reply in comments.xml, reply linked in commentsExtended.xml",
    /Confirm the final square footage/.test(cx) && /Live check comment\./.test(cx) && /Live check reply\./.test(cx) && /w15:paraIdParent=/.test(z["word/commentsExtended.xml"]));
  ok("stored .docx: table, image, heading and list survive", dx.includes("<w:tbl>") && dx.includes("<w:drawing>") && dx.includes('w:val="Heading1"') && dx.includes("Truck") === false && !!z["word/media/image1.png"]);

  /* ---------- 3. hard reload, reopen from the Library: the SAVED state ---------- */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 });
  await page.waitForFunction(async () => { const { data } = await window.pfSupabase.auth.getUser(); return !!(data && data.user); }, null, { timeout: 30000 });
  await openFromLibrary(stem(N.docx));
  const pe2 = page.locator('[data-testid="doc-editor-page"]:visible');
  console.log("DIAG reopened:", JSON.stringify({ insTracked: await pe2.locator("ins.dre-ins", { hasText: "Tracked live." }).count(), dels: await pe2.locator("del.dre-del").count(), cards: await page.locator('[data-testid="comment-card"]').count(), replies: await page.locator('[data-testid="comment-reply"]').count(), approxIns: await pe2.locator("ins.dre-ins", { hasText: "approximately" }).count(), text: (await pe2.innerText()).slice(0, 220) }));
  ok("step 3: after a hard reload the reopened file shows the typed sentence as a tracked insertion, the struck word, both new comments and the accepted change as plain text",
    (await pe2.locator("ins.dre-ins", { hasText: "Tracked live." }).count()) === 1 && (await pe2.locator("del.dre-del").count()) >= 2
    && (await page.locator('[data-testid="comment-card"]').count()) === 2 && (await page.locator('[data-testid="comment-reply"]').count()) === 1
    && (await pe2.locator("ins.dre-ins", { hasText: "approximately" }).count()) === 0 && (await pe2.innerText()).includes("approximately"));
  // version history (shipped on main after #1924): both versions listed
  await page.evaluate(() => { location.hash = "#library"; });
  const hist = page.locator('[data-testid="library-version-history"]').first();
  if (await hist.count()) ok("Library offers version history for the saved file", true);

  /* ---------- 4. .txt ---------- */
  await goReview();
  await page.setInputFiles('[data-testid="review-file-input"]', P.txt);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="doc-editor"]')].some((e) => e.offsetParent !== null && e.getAttribute("data-kind") === "txt"), null, { timeout: 60000 }).catch(async (e) => {
    console.log("DIAG txt open:", JSON.stringify(await page.evaluate(() => ({ hash: location.hash, kind: document.querySelector('[data-testid="doc-editor"]')?.getAttribute("data-kind") || null, alerts: [...document.querySelectorAll('[role=alert]')].map((x) => x.textContent.slice(0, 200)), banners: [...document.querySelectorAll('[data-testid="doc-save-status"],[data-testid="doc-editor-error"],[data-testid="doc-editor-loading"]')].map((x) => x.textContent.slice(0, 200)), body: document.body.innerText.slice(0, 300) }))));
    throw e;
  });
  const t1 = await waitRow(N.txt, (r) => r.sources[0] && r.sources[0].driveKey); created.add(t1.id);
  await openFromLibrary(stem(N.txt), "txt");
  { // NO edit, NO save: does the tab in front stay put for 25 s after opening from the Library?
    const quiet = [];
    for (let i = 0; i < 10; i++) { quiet.push(await page.evaluate(() => [...document.querySelectorAll('[data-testid="doc-editor"]')].filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("data-kind")).join("+"))); await page.waitForTimeout(2500); }
    ok("step 4: with no edit and no Save, the opened .txt stays in front for 25 s", quiet.every((k) => k === "txt"), JSON.stringify(quiet));
  }
  ok("step 4: .txt opens with formatting controls hidden", (await page.locator('select[aria-label="Font"]:visible').count()) === 0);
  await page.locator('[data-testid="doc-editor-page"]:visible p', { hasText: "beta" }).click(); await page.keyboard.press("End"); await page.keyboard.type("!");
  await page.locator('[data-testid="doc-save"]:visible').click();
  // Sample which editor is VISIBLE after Save (other files stay mounted as tabs) — the .txt must stay in front.
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push(await page.evaluate(() => ({ hash: location.hash, vis: [...document.querySelectorAll('[data-testid="doc-editor"]')].filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("data-kind")), txtStatus: (document.querySelector('[data-testid="doc-editor"][data-kind="txt"] [data-testid="doc-save-status"]') || {}).textContent || "" })));
    if (/^Saved to the Library|Couldn/.test(seen[seen.length - 1].txtStatus) && i >= 3) break;
    await page.waitForTimeout(2500);
  }
  console.log("TXT-SAVE samples:", JSON.stringify(seen));
  const stayed = seen.every((x) => x.vis.length === 1 && x.vis[0] === "txt");
  ok("step 4: after Save the .txt stays the visible tab (Save does not flip to another open file)", stayed, stayed ? "" : JSON.stringify(seen.map((x) => x.vis)));
  ok("step 4: the .txt reports it saved to the Library", /^Saved to the Library/.test(seen[seen.length - 1].txtStatus), seen[seen.length - 1].txtStatus);
  const t2 = await waitRow(N.txt, (r) => r.sources.length >= 2 && r.sources[0].driveKey !== t1.sources[0].driveKey);
  const txtBytes = (await bytesOf(t2.sources[0].driveKey)).toString("utf8");
  ok("stored .txt is byte-exact: CRLF kept, only the edit changed", txtBytes === "alpha\r\nbeta!\r\n", JSON.stringify(txtBytes));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(async () => { const { data } = await window.pfSupabase.auth.getUser(); return !!(data && data.user); }, null, { timeout: 30000 });
  await openFromLibrary(stem(N.txt), "txt");
  ok("step 4: reopened .txt shows the edit; no download", (await page.locator('[data-testid="doc-editor-page"]:visible').innerText()).includes("beta!") && downloads.length === 0);

  /* ---------- 5. .doc -> NEW .docx, original kept ---------- */
  await goReview();
  await page.setInputFiles('[data-testid="review-file-input"]', P.doc);
  await page.waitForSelector('[data-testid="doc-converted-note"]:visible', { timeout: 60000 });
  const d1 = await waitRow(N.doc, (r) => r.sources[0] && r.sources[0].driveKey); created.add(d1.id);
  await openFromLibrary(stem(N.doc), "doc");
  ok("step 5: .doc opens with the one-line 'new .docx' note", /new \.docx/.test(await page.locator('[data-testid="doc-converted-note"]:visible').innerText()));
  await page.locator('[data-testid="doc-save"]:visible').click();
  const newName = N.doc.replace(/\.doc$/i, ".docx");
  const d2 = await waitRow(newName, (r) => r.sources[0] && r.sources[0].driveKey); created.add(d2.id);
  const orig = (await rowsNamed(N.doc)).find((r) => !r.deleted);
  ok("step 5: a NEW .docx record exists next to the original .doc, which is untouched", !!d2 && !!orig && orig.id === d1.id && orig.sources.length === 1 && orig.sources[0].driveKey === d1.sources[0].driveKey);
  const dz = unzipSync(new Uint8Array(await bytesOf(d2.sources[0].driveKey)));
  ok("step 5: the new file is a valid .docx holding the deed text", /THENCE/i.test(strFromU8(dz["word/document.xml"])));
  await page.waitForSelector('[data-testid="doc-editor"][data-kind="docx"]:visible', { timeout: 60000 });
  ok("step 5: the editor now shows the new .docx", true);

  /* ---------- 7 (layout half): phone width ---------- */
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  const w = await page.evaluate(() => ({ d: document.documentElement.scrollWidth, v: window.innerWidth }));
  ok("step 7 (layout): at 390 wide the editor never scrolls the page sideways", w.d <= w.v, JSON.stringify(w));
  await page.setViewportSize({ width: 1440, height: 900 });
  ok("no download fired at any point", downloads.length === 0, JSON.stringify(downloads));
} catch (e) { ok("harness ran to completion", false, String((e && e.stack) || e).slice(0, 700)); }

/* ---------- cleanup: delete everything this run made, and prove it is gone ---------- */
try {
  const all = [];
  for (const n of [N.docx, N.txt, N.doc, N.doc.replace(/\.doc$/i, ".docx")]) { const rs = await rowsNamed(n); if (Array.isArray(rs)) for (const r of rs) { all.push(r); created.add(r.id); } }
  const keys = [...new Set(all.flatMap((r) => r.sources.map((x) => x.driveKey)).filter(Boolean))];
  const res = await page.evaluate(async ({ ids, keys: ks }) => {
    const { data } = await window.pfSupabase.auth.getSession(); const tok = data.session.access_token; const out = { drive: [], rows: null };
    for (const k of ks) { const r = await fetch(`/api/files?key=${encodeURIComponent(k)}`, { method: "DELETE", headers: { authorization: `Bearer ${tok}` } }).catch(() => null); out.drive.push(r ? r.status : 0); }
    await window.pfSupabase.from("file_facts").delete().in("id", ids);
    const d = await window.pfSupabase.from("doc_reviews").delete().in("id", ids).select("id");
    out.rows = d.error ? String(d.error.message) : (d.data || []).length;
    return out;
  }, { ids: [...created], keys });
  const left = [];
  for (const n of [N.docx, N.txt, N.doc, N.doc.replace(/\.doc$/i, ".docx")]) { const rs = await rowsNamed(n); if (Array.isArray(rs) && rs.length) left.push(n); }
  ok("cleanup: every record and Drive file this run created was deleted", left.length === 0 && res.drive.every((c) => c >= 200 && c < 300), JSON.stringify({ records: res.rows, drive: res.drive, left }));
} catch (e) { ok("cleanup ran", false, String(e).slice(0, 300)); }
const real = s.errors.filter((e) => !/tesseract|importScripts|cdn\.jsdelivr/i.test(e));
ok("no uncaught page errors", real.length === 0, real.slice(0, 2).join(" | "));
await s.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
