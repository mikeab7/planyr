/* verify-library-home-delete — B2086368. Can a file be deleted from the Library's RECENT and UNFILED lists?
 *
 * Owner report 2026-10-04 (build f853752): the no-project Library Home rendered Open + "Move to project…" and nothing
 * else, so a file saved from Review with no project could never be removed. The delete path existed only in the
 * project folder tree. Home now carries the SAME ✕ and a "Recently deleted" bin (one shared implementation:
 * library/components/ReviewTrash.jsx).
 *
 * SIGNED-IN against a stub Supabase (the sandbox cannot sign in for real — standing `Blocker: auth`): an in-memory
 * `doc_reviews` table answers every request, so what is asserted is what the app SENT (a deleted_at PATCH, a DELETE) and
 * what the table then holds. Touches no real account and no real data — a made-up uid, a throwaway context.
 *
 * KNOWN-GOOD ARM: the run is VOID unless the app really read doc_reviews AND the seeded Unfiled rows rendered (a probe
 * that cannot see the list cannot report a missing control on it).
 *
 * Run: build with a stub host, `vite preview --port 4173`, then `node ui-audit/verify-library-home-delete.mjs`
 *   VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=x npx vite build
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installStubSupabase } from "./lib/stubSupabase.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";

const jwt = (p) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b(p)}.sig`; };
const session = {
  access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }),
  refresh_token: "stub-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};
const PROJ = "zzproj";
const plan = { id: PROJ, groupId: PROJ, site: "ZZ Project", name: "Concept A", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };

const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const MARKUPS = { markups: [{ id: "m1", type: "rect", page: 1 }, { id: "m2", type: "line", page: 1 }] };
const row = (id, title, sfile, extra = {}) => ({ id, title, kind: "single", project: "", project_id: null, discipline: "Other", item: "", revision: "", doc_date: null,
  team_id: null, user_id: UID, updated_at: ago(5), deleted_at: null, placed: null, sfile, folderId: null, orgScope: null, titleAuto: null, data: { sourceFile: sfile, ...MARKUPS }, ...extra });
const tables = {
  sites: [{ id: PROJ, group_id: PROJ, site: "ZZ Project", name: "Concept A", user_id: UID, team_id: null, share_locked: false, deleted_at: null, version: 1, updated_at: new Date().toISOString(), origin: null, county: null, parcels: [], els: [], measures: [], settings: {} }], comps: [], site_elements: [], notes_trees: [], client_errors: [], file_facts: [], upload_sessions: [],
  doc_reviews: [
    row("u-pdf", "Unfiled drawing", "drawing.pdf"),
    row("u-docx", "Unfiled memo", "memo.docx"),
    row("u-png", "Unfiled photo", "photo.png"),
    row("u-both", "In Recent AND Unfiled", "both.pdf"),
    row("p-pdf", "Project drawing", "proj.pdf", { project: "ZZ Project", project_id: PROJ }),
  ],
};
const recents = [{ id: "u-both", projectId: null, openedAt: Date.now() - 1000 }, { id: "p-pdf", projectId: PROJ, openedAt: Date.now() - 2000 }, { id: "u-pdf", projectId: null, openedAt: Date.now() - 3000 }];
const seed = `(() => { try {
  localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify({ [PROJ]: plan }))});
  localStorage.setItem('planyr:recentDocs:v1:${UID}', ${JSON.stringify(JSON.stringify(recents))});
} catch (e) {} })();`;

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const dbRow = (id) => tables.doc_reviews.find((r) => r.id === id) || null;

async function newContext(browser, opts = {}) {
  const wire = []; const control = { failWrites: false };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, ...opts });
  await installStubSupabase(ctx, { tables, session, wire, control });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-library-home-delete");
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
  await page.goto(BASE + "#/library", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="library-home"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="unfiled-row"]', { timeout: 15000 }).catch(() => {});
  return { ctx, page, wire, control };
}
const sections = (page) => page.evaluate(() => {
  const out = { recent: [], unfiled: [] }; let cur = null;
  for (const el of document.querySelector('[data-testid="library-home"]').querySelectorAll("div")) {
    const t = el.children.length === 0 ? el.textContent.trim() : "";
    if (t === "Recent") cur = "recent"; else if (t === "Unfiled") cur = "unfiled"; else if (t === "Projects") cur = null;
    if (cur === "unfiled" && el.matches('[data-testid="unfiled-row"]')) out.unfiled.push(el.getAttribute("data-review-id"));
  }
  return out;
});
// Recent cards carry no id attr; read their titles. Unfiled rows carry data-review-id.
const recentTitles = (page) => page.evaluate(() => {
  const home = document.querySelector('[data-testid="library-home"]');
  const heads = [...home.querySelectorAll("div")].filter((d) => d.children.length === 0 && d.textContent.trim() === "Recent");
  if (!heads.length) return [];
  const out = []; let el = heads[0].nextElementSibling;
  while (el && !(el.children.length === 0 && /^(Unfiled|Projects|Pinned)$/.test(el.textContent.trim()))) {
    const b = el.querySelector("button[title='Open in Review'] span span"); if (b) out.push(b.textContent.replace(/(DOCX?|PDF|TXT|PNG|[A-Z]{2,4})$/, "").trim());
    el = el.nextElementSibling;
  }
  return out;
});
const unfiledIds = async (page) => (await sections(page)).unfiled;
const patches = (wire) => wire.filter((w) => w.table === "doc_reviews" && w.method === "PATCH" && (w.body || "").includes("deleted_at"));
const settle = (page, ms = 900) => page.waitForTimeout(ms);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  /* ── 1. fine pointer: controls present, keyboard reachable ─────────────────────────────── */
  let { ctx, page, wire, control } = await newContext(browser);
  ok("KNOWN-GOOD ARM: the app really read rest/v1/doc_reviews", wire.some((w) => w.table === "doc_reviews" && w.method === "GET"));
  let ids = await unfiledIds(page);
  ok("KNOWN-GOOD ARM: the 4 seeded Unfiled rows rendered", ids.length === 4, ids.join(","));
  const rec0 = await recentTitles(page);
  ok("Recent lists the 3 seeded recents", rec0.length === 3, JSON.stringify(rec0));

  const delBtns = await page.locator('[data-testid="library-home"] [data-testid="trash-delete"]').count();
  ok("a delete ✕ is present on every Recent row (3) and every Unfiled row (4)", delBtns === 7, `${delBtns} found`);
  const first = page.locator('[data-testid="unfiled-row"] [data-testid="trash-delete"]').first();
  ok('the ✕ carries title "Delete (moves to Recently deleted)"', (await first.getAttribute("title")) === "Delete (moves to Recently deleted)");
  ok("the ✕ has an accessible name", /Delete .* \(moves to Recently deleted\)/.test((await first.getAttribute("aria-label")) || ""));

  // keyboard: focus the ✕ on u-png and press Enter, then Enter again on the auto-focused confirm
  const pngRow = page.locator('[data-testid="unfiled-row"][data-review-id="u-png"]');
  await pngRow.locator('[data-testid="trash-delete"]').focus();
  ok("the ✕ takes keyboard focus", await pngRow.locator('[data-testid="trash-delete"]').evaluate((e) => document.activeElement === e));
  await page.keyboard.press("Enter"); await settle(page, 300);
  ok("Enter on the ✕ arms the confirm and moves focus onto it", await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid") === "trash-confirm"));
  await page.keyboard.press("Enter"); await settle(page);
  ok("PNG: delete sent a deleted_at PATCH for u-png only", patches(wire).length === 1 && /id=eq\.u-png/.test(patches(wire)[0].url));
  ok("PNG: row left Unfiled", !(await unfiledIds(page)).includes("u-png"));
  ok("PNG: the row is soft-deleted in the table, markups intact", !!dbRow("u-png")?.deleted_at && dbRow("u-png").data.markups.length === 2);
  ok("undo toast appeared", await page.locator('[data-testid="trash-undo"]').count() === 1);

  /* ── 2. in BOTH Recent and Unfiled: no ghost ───────────────────────────────────────────── */
  const bothRow = page.locator('[data-testid="unfiled-row"][data-review-id="u-both"]');
  await bothRow.locator('[data-testid="trash-delete"]').click(); await bothRow.locator('[data-testid="trash-confirm"]').click(); await settle(page);
  ok("Recent+Unfiled: gone from Unfiled", !(await unfiledIds(page)).includes("u-both"));
  ok("Recent+Unfiled: gone from Recent (no ghost)", !(await recentTitles(page)).some((t) => /In Recent AND Unfiled/.test(t)), JSON.stringify(await recentTitles(page)));

  /* ── 3. bin reachable from the no-project view; restore → back in Unfiled ──────────────── */
  const pill = page.locator('[data-testid="library-home-recently-deleted"]');
  ok("the Recently deleted pill is reachable on Home and counts 2", (await pill.count()) === 1 && /· 2/.test(await pill.innerText()));
  await pill.click(); await settle(page, 300);
  ok("bin lists both deleted files", (await page.locator('[data-testid="deleted-row"]').count()) === 2);
  await page.locator('[data-testid="deleted-row"][data-review-id="u-both"] [data-testid="deleted-restore"]').click(); await settle(page);
  ok("restore: table row deleted_at cleared, markups intact", dbRow("u-both").deleted_at === null && dbRow("u-both").data.markups.length === 2);
  await pill.click(); await settle(page, 300);
  ok("restore: file is back in Unfiled", (await unfiledIds(page)).includes("u-both"));
  ok("restore: file is back in Recent", (await recentTitles(page)).some((t) => /In Recent AND Unfiled/.test(t)));

  /* ── 4. delete forever from the no-project view ────────────────────────────────────────── */
  await pill.click(); await settle(page, 300);
  await page.locator('[data-testid="deleted-row"][data-review-id="u-png"] [data-testid="deleted-purge"]').click();
  ok("Delete forever asks first (two-step)", (await page.locator('[data-testid="deleted-purge-confirm"]').count()) === 1 && !!dbRow("u-png"));
  await page.locator('[data-testid="deleted-purge-confirm"]').click(); await settle(page, 1500);
  ok("Delete forever: the row is gone from the table", dbRow("u-png") === null);
  ok("Delete forever: it left the bin", (await page.locator('[data-testid="deleted-row"][data-review-id="u-png"]').count()) === 0);
  await pill.click(); await settle(page, 300);

  /* ── 5. a project file, from the no-project view (Recent) ──────────────────────────────── */
  const proj = page.locator('[data-testid="library-home"] >> text=Project drawing').first();
  ok("a project's file shows in Recent with its delete ✕", await proj.count() === 1);
  const card = proj.locator("xpath=ancestor::div[.//button[@title='Open in Review']][1]");
  await card.locator('[data-testid="trash-delete"]').click(); await card.locator('[data-testid="trash-confirm"]').click(); await settle(page);
  ok("project file: soft-deleted, project_id untouched", !!dbRow("p-pdf").deleted_at && dbRow("p-pdf").project_id === PROJ);
  ok("project file: PATCH body is only deleted_at (nothing else rewritten)", Object.keys(JSON.parse(patches(wire).at(-1).body)).join() === "deleted_at");
  await pill.click(); await settle(page, 300);
  await page.locator('[data-testid="deleted-row"][data-review-id="p-pdf"] [data-testid="deleted-restore"]').click(); await settle(page);
  ok("project file: restore returns it to ITS project (not Unfiled)", dbRow("p-pdf").deleted_at === null && dbRow("p-pdf").project_id === PROJ && !(await unfiledIds(page)).includes("p-pdf"));
  await pill.click().catch(() => {}); await settle(page, 300);

  /* ── 6. DOCX + PDF deletes ──────────────────────────────────────────────────────────────── */
  for (const id of ["u-docx", "u-pdf"]) {
    const r = page.locator(`[data-testid="unfiled-row"][data-review-id="${id}"]`);
    await r.locator('[data-testid="trash-delete"]').click(); await r.locator('[data-testid="trash-confirm"]').click(); await settle(page);
    ok(`${id}: soft-deleted + left Unfiled`, !!dbRow(id).deleted_at && !(await unfiledIds(page)).includes(id));
  }

  /* ── 7. a failed delete is loud and the row stays ──────────────────────────────────────── */
  control.failWrites = true;
  const keep = page.locator('[data-testid="unfiled-row"][data-review-id="u-both"]');
  await keep.locator('[data-testid="trash-delete"]').click(); await keep.locator('[data-testid="trash-confirm"]').click(); await settle(page);
  ok("failed delete: a visible notice, and the row is still listed", (await page.locator('[data-testid="trash-notice"]').count()) === 1 && (await unfiledIds(page)).includes("u-both") && dbRow("u-both").deleted_at === null);
  control.failWrites = false;
  await page.screenshot({ path: "ui-audit/screens/library/home-delete.png" }).catch(() => {});
  await ctx.close();

  /* ── 7b. REGRESSION: the project folder-tree list (FileBrowser) runs the same shared code and must behave as before ── */
  tables.doc_reviews.forEach((r) => { r.deleted_at = null; });
  ({ ctx, page, wire } = await newContext(browser));
  await page.locator(`button[title="Open this project's files"]`).first().click();
  await page.waitForSelector('[data-testid="trash-delete"]', { timeout: 15000 }).catch(() => {});
  const treeBtn = page.locator('[data-testid="trash-delete"]');
  ok("tree: the project's file row still has its delete ✕", (await treeBtn.count()) >= 1, `${await treeBtn.count()} found`);
  const before = patches(wire).length;
  await treeBtn.first().click(); await page.locator('[data-testid="trash-confirm"]').first().click(); await settle(page);
  ok("tree: delete still sends the deleted_at PATCH", patches(wire).length === before + 1 && dbRow("p-pdf").deleted_at !== null);
  ok("tree: undo toast + Recently deleted pill appear", (await page.locator('[data-testid="trash-undo"]').count()) === 1 && (await page.getByText(/Recently deleted · 1/).count()) === 1);
  await page.getByText(/Recently deleted · 1/).click(); await settle(page, 300);
  await page.locator('[data-testid="deleted-restore"]').first().click(); await settle(page);
  ok("tree: Restore from the bin brings the row back", dbRow("p-pdf").deleted_at === null);
  await ctx.close();

  /* ── 8. coarse pointer: the ✕ is a 44px target ─────────────────────────────────────────── */
  tables.doc_reviews.forEach((r) => { r.deleted_at = null; });
  if (!dbRow("u-png")) tables.doc_reviews.push(row("u-png", "Unfiled photo", "photo.png"));
  ({ ctx, page } = await newContext(browser, { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } }));
  ok("coarse pointer is really emulated", await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
  const boxes = await page.locator('[data-testid="library-home"] [data-testid="trash-delete"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  ok("every ✕ is at least 44×44 on a coarse pointer", boxes.length >= 5 && boxes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(boxes));
  await ctx.close();
} finally { await browser.close(); }
console.log(failures === 0 ? "\n✓ All Library-home delete checks passed." : `\n✗ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
