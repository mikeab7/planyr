/* verify-library-open-and-tracked — NEW-1 (the first "Open in Review" click after the Library loads does nothing) and
 * NEW-2 (a record-only site's files had no route in the UI).
 *
 * SIGNED-IN against a stub Supabase (same stub as verify-library-home-delete): an in-memory `doc_reviews` / `sites`.
 *
 * NEW-1 — MEASURED on production (2026-10-11, signed in as the test account, rows polled every 100 ms after a hard
 * reload): the first "Open in Review" row paints at one height and ~0.2-0.4 s later every row moves down 35 px, because the
 * "Recently deleted" chip arrives AFTER the lists. A press aimed at where a row was lands between rows. This harness
 * delays that chip's data, then clicks at the exact point where the first row was first seen, with the raw mouse (no
 * driver auto-wait, which would re-aim and hide it): the click must open the file, and the row must never have moved.
 * KNOWN-GOOD ARMS: the late data really arrived (the chip appears), and a row aimed at after everything settled opens.
 *
 * NEW-2 — a tracked (record-only) site holding a flyer: Home must list it, opening it must show the flyer, and the flyer
 * must be deletable (PATCH deleted_at) WITHOUT first picking a project. Rows with no file say so on the row.
 *
 * Run: VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=x npx vite build && npx vite preview --port 4173
 *      node ui-audit/verify-library-open-and-tracked.mjs        (BASE_URL overrides; --expect-red is for the pre-fix build)
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
const PROJ = "zzproj", TRK = "zztracked";
const mkPlan = (id, site, role) => ({ id, groupId: id, site, name: "Concept A", role, status: "active", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() });
const plans = { [PROJ]: mkPlan(PROJ, "ZZ Project", "pursuit"), [TRK]: mkPlan(TRK, "ZZ Tracked Corner", "tracked") };
const siteRow = (p) => ({ id: p.id, group_id: p.id, site: p.site, name: p.name, user_id: UID, team_id: null, share_locked: false, deleted_at: null, version: 1, updated_at: new Date().toISOString(), origin: null, county: null, parcels: [], els: [], measures: [], settings: {}, data: p });
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const row = (id, title, sfile, extra = {}) => ({ id, title, kind: "single", project: "", project_id: null, discipline: "", item: "", revision: "", doc_date: null,
  team_id: null, user_id: UID, updated_at: ago(5), deleted_at: null, placed: null, sfile, folderId: null, orgScope: null, titleAuto: null, data: sfile ? { sourceFile: sfile, markups: [] } : { markups: [] }, ...extra });
const tables = {
  sites: [siteRow(plans[PROJ]), siteRow(plans[TRK])], comps: [], site_elements: [], notes_trees: [], client_errors: [], file_facts: [], upload_sessions: [],
  doc_reviews: [
    row("u-file", "Unfiled with file", "a.pdf"),
    row("u-null", "Unfiled no file", null),
    row("flyer", "Broker flyer", "flyer.doc", { project: "ZZ Tracked Corner", project_id: TRK }),
    row("old-del", "Deleted earlier", "old.pdf", { deleted_at: ago(60) }),
  ],
};
const recents = [{ id: "u-null", projectId: null, openedAt: Date.now() - 1000 }, { id: "u-file", projectId: null, openedAt: Date.now() - 2000 }];
const seed = `(() => { try {
  localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify(plans))});
  localStorage.setItem('planyr:recentDocs:v1:${UID}', ${JSON.stringify(JSON.stringify(recents))});
} catch (e) {} })();`;

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const dbRow = (id) => tables.doc_reviews.find((r) => r.id === id) || null;
const OPEN = '[data-testid="library-home"] button[title="Open in Review"]';

async function newContext(browser, { delayDeletedMs = 0 } = {}) {
  const wire = []; const control = { failWrites: false };
  const ctx = await browser.newContext({ viewport: { width: 1191, height: 800 }, ignoreHTTPSErrors: true });
  await installStubSupabase(ctx, { tables, session, wire, control });
  // Registered AFTER the stub, so it runs first: hold ONLY the "which files were deleted" read, the late data of the real app.
  if (delayDeletedMs) await ctx.route(/rest\/v1\/doc_reviews.*deleted_at=not\.is\.null/, async (route) => { await new Promise((r) => setTimeout(r, delayDeletedMs)); route.fallback(); });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-library-open-and-tracked");
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
  return { ctx, page, wire, control };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  /* ── NEW-1: rows must not move under a hand, and the first press must open ────────────────────────────── */
  {
    const { ctx, page } = await newContext(browser, { delayDeletedMs: 900 });
    await page.goto(BASE + "#/library", { waitUntil: "domcontentloaded" });
    // sample the first Open button every 25 ms from the moment it exists; remember where it FIRST appeared
    const seen = await page.evaluate(async (SEL) => {
      const t0 = performance.now(); let first = null; const tops = [];
      while (performance.now() - t0 < 6000) {
        const b = document.querySelector(SEL);
        if (b) { const r = b.getBoundingClientRect(); if (!first) first = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: Math.round(performance.now() - t0) }; tops.push(Math.round(r.top)); if (performance.now() - t0 > first.at + 1800) break; }
        await new Promise((r) => setTimeout(r, 25));
      }
      return { first, minTop: Math.min(...tops), maxTop: Math.max(...tops), n: tops.length };
    }, OPEN);
    ok("KNOWN-GOOD ARM: an Open button appeared", !!seen.first, JSON.stringify(seen));
    const chip = await page.locator('[data-testid="library-home-recently-deleted"]').count();
    ok("KNOWN-GOOD ARM: the late data arrived (the Recently deleted chip is now on the page)", chip === 1);
    ok("NEW-1: the first row never moved after it first appeared", !!seen.first && seen.maxTop - seen.minTop <= 1, `moved ${seen.maxTop - seen.minTop}px over ${seen.n} samples`);
    // aim with the raw mouse at where the row FIRST appeared (a person aims at what they see)
    const pt = seen.first;
    const firstId = await page.evaluate((SEL) => { const b = document.querySelector(SEL); return b ? (b.closest("[data-review-id]")?.getAttribute("data-review-id") || b.textContent.slice(0, 20)) : null; }, OPEN);
    const under = await page.evaluate(({ x, y, SEL }) => { const e = document.elementFromPoint(x, y); const b = e && e.closest('button[title="Open in Review"]'); const idx = b ? [...document.querySelectorAll(SEL)].indexOf(b) : -1; const r0 = document.querySelector(SEL).getBoundingClientRect(); return { isOpenButton: !!b, index: idx, btn0: [Math.round(r0.top), Math.round(r0.bottom)], tag: e ? e.tagName + ":" + (e.textContent || "").slice(0, 24) : null }; }, { ...pt, SEL: OPEN });
    ok("NEW-1: the spot where the first row appeared is STILL that SAME row (Open button #0) once the page has settled — a press there opens what was aimed at", under.isOpenButton && under.index === 0, JSON.stringify(under) + " first=" + firstId);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(2500);
    const hash1 = await page.evaluate(() => location.hash);
    ok("NEW-1: the FIRST press at the spot the row appeared opens the file", hash1.startsWith("#/markup"), `hash after first press = ${hash1}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await newContext(browser);
    await page.goto(BASE + "#/library", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="unfiled-row"]', { timeout: 20000 });
    ok("a row whose file does not resolve says so on the row", (await page.locator('[data-testid="unfiled-row"][data-review-id="u-null"] [data-testid="row-file-problem"]').count()) === 1);
    ok("a row WITH a file shows no such note (known-good arm)", (await page.locator('[data-testid="unfiled-row"][data-review-id="u-file"] [data-testid="row-file-problem"]').count()) === 0);
    await page.locator('[data-testid="unfiled-row"][data-review-id="u-null"] button[title="Open in Review"]').click();
    await page.waitForTimeout(1500);
    ok("a row with no file still opens (first click)", (await page.evaluate(() => location.hash)).startsWith("#/markup"));
    await ctx.close();
  }
  /* ── NEW-2: a record-only site's files are reachable and deletable without picking a project ──────────── */
  {
    const { ctx, page, wire } = await newContext(browser);
    await page.goto(BASE + "#/library", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="library-home"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="unfiled-row"]', { timeout: 20000 });
    const names = await page.locator('[data-testid="library-home"] >> text=ZZ Project').count();
    ok("KNOWN-GOOD ARM: the ordinary project still has its card (Projects section works)", names >= 1);
    const card = page.locator('[data-testid="library-tracked-site"]');
    ok("Home lists the record-only site that holds a file", (await card.count()) === 1 && /ZZ Tracked Corner/.test(await card.innerText()) && /1 file/.test(await card.innerText()), await card.allInnerTexts().then((a) => a.join("|")));
    ok("the record-only site is NOT in the project picker cards (it stays a separate list)", (await page.locator('[data-testid="library-home"] button[title="Open this project\'s files"]').count()) === 1);
    await card.click();
    await page.waitForTimeout(1500);
    ok("opening it uses the ordinary project route", (await page.evaluate(() => location.hash)).includes(TRK), await page.evaluate(() => location.hash));
    await page.waitForSelector("text=Broker flyer", { timeout: 15000 }).catch(() => {});
    ok("its flyer is listed in the project file view", (await page.locator("text=Broker flyer").count()) >= 1);
    const flyerRow = page.locator('[data-testid="library-file-row"]', { hasText: "Broker flyer" }).first();
    await flyerRow.click({ button: "right" }); // the file row's context menu (B2268417) replaced the inline ✕
    const del = page.locator('[data-testid="file-menu-delete"]').first();
    ok("the flyer's row menu carries the ordinary delete item", (await del.count()) >= 1);
    await del.click(); await page.waitForTimeout(1200);
    ok("deleting it sent a deleted_at PATCH for the flyer only", wire.some((w) => w.table === "doc_reviews" && w.method === "PATCH" && /id=eq\.flyer/.test(w.url) && (w.body || "").includes("deleted_at")) && !!dbRow("flyer").deleted_at);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
