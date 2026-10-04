/* Verify Review tabs FOLLOW THE ACCOUNT (NEW-1 amendment, 2026-10-04) against the REAL built app, with a hermetic
 * fake account: two browser contexts (a desktop and a phone) sign in as the SAME made-up user (ui-audit/lib/authRemount.mjs)
 * and share one in-process fake Supabase (profiles.prefs + doc_reviews) and one fake file store (/api/files).
 *   Run: VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=dummy npm run build && npx vite preview --port 4173
 *        node ui-audit/verify-review-tabs-sync.mjs
 * Proves: a reload restores the tabs (order · active tab · page · zoom) · tabs set on the desktop appear on the phone with the
 * same active tab / page / zoom · closing on the phone removes the tab on the desktop at its next focus · an unsaved Word tab
 * on the desktop survives the phone closing it · offline the local copy is used, and back online the newer local change wins.
 * Known-good arm: the desktop's restored active tab must actually draw its sheet — otherwise the run is VOID. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { buildPdf } from "./lib/tinyPdf.mjs";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";
import { AUTH_FIXTURE, authSessionSeed, detectSupabase } from "./lib/authRemount.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const sb = detectSupabase(new URL("../dist", import.meta.url).pathname);
if (!sb) { console.log("VOID — the build carries no Supabase config (build with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY dummies)"); process.exit(2); }
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  —  " + detail : ""}`); };

/* ---- the fake account ---- */
const uid = AUTH_FIXTURE.uid;
const files = { k1: buildPdf(3, "ONE"), k2: buildPdf(4, "TWO"), k3: Buffer.from(buildFixtureDocx()) };
const rec = (id, name, key, pages) => ({ id, kind: "single", updatedAt: Date.now() - 60000, title: name, project: "", projectId: null, orgScope: false, discipline: "", item: "", revision: "", docDate: "2026-10-04",
  sources: [{ srcId: "s" + id, name, size: files[key].length, driveKey: key, storageKey: null }], single: { srcId: "s" + id, fileName: name, numPages: pages, page: 1, markups: [], calByPage: {}, calInfo: {} } });
const acct = { prefs: {}, records: { r1: rec("r1", "one-site.pdf", "k1", 3), r2: rec("r2", "two-grading.pdf", "k2", 4), r3: rec("r3", "three-scope.docx", "k3", 0) } };
const handler = (route) => {
  const req = route.request(), url = req.url();
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" }, body: JSON.stringify(body) });
  if (url.startsWith(BASE)) {
    if (url.includes("/api/files")) { const k = new URL(url).searchParams.get("key"); return files[k] ? route.fulfill({ status: 200, body: files[k], headers: { "content-type": "application/octet-stream" } }) : route.fulfill({ status: 404, body: "" }); }
    return route.continue();
  }
  if (!url.startsWith(sb.url)) return route.abort();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*" }, body: "" });
  const one = /object\+json/.test(req.headers()["accept"] || "");
  if (url.includes("/auth/v1/user")) return json({ id: uid, aud: "authenticated", role: "authenticated", email: AUTH_FIXTURE.email, app_metadata: {}, user_metadata: {} });
  if (url.includes("/auth/v1/")) return json({});
  if (url.includes("/rest/v1/profiles")) {
    if (req.method() === "GET") return one ? json({ id: uid, prefs: acct.prefs }) : json([{ id: uid, prefs: acct.prefs }]);
    try { const b = JSON.parse(req.postData() || "{}"); const row = Array.isArray(b) ? b[0] : b; if (row && row.prefs) acct.prefs = row.prefs; } catch (_) { /* ignore */ }
    return json([], 201);
  }
  if (url.includes("/rest/v1/doc_reviews") && req.method() === "GET") {
    const id = (url.match(/id=eq\.([^&]+)/) || [])[1]; const r = acct.records[id];
    return r ? (one ? json({ data: r, version: 1, team_id: null, deleted_at: null }) : json([{ data: r, version: 1 }])) : (one ? json({ code: "PGRST116", message: "none" }, 406) : json([]));
  }
  if (url.includes("/rest/v1/")) return one ? json({ code: "PGRST116", message: "none" }, 406) : json([], req.method() === "GET" ? 200 : 201);
  return json({});
};
const mk = async (viewport, seedTabs) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(authSessionSeed({ ref: sb.ref, url: sb.url }));
  if (seedTabs) await ctx.addInitScript(`(() => { try { if (!localStorage.getItem('planyr:review:tabs:v1')) localStorage.setItem('planyr:review:tabs:v1', ${JSON.stringify(seedTabs)}); } catch (e) {} })();`);
  ctx.__offline = false; // a routed request is answered by the harness even under setOffline, so "offline" is enforced here
  await ctx.route("**/*", (r) => (ctx.__offline && !r.request().url().startsWith(BASE) ? r.abort("internetdisconnected") : handler(r)));
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => { if (!/tesseract|importScripts/.test(String(e))) errors.push(String(e)); });
  return { ctx, page, errors };
};
const names = (page) => page.locator('[data-testid="review-tab"]').evaluateAll((els) => els.map((e) => e.querySelector("span").textContent));
const activeName = (page) => page.locator('[data-testid="review-tab"][data-active="1"] span').first().textContent().catch(() => null);
const pageOf = async (page) => (await page.locator('[data-testid="sheet-rail"]').innerText()).match(/(\d+) \/ (\d+)/)?.slice(1, 3).map(Number) || null;
const scaleOf = async (page) => Number(await page.locator('[data-testid="review-sheet"]').getAttribute("data-view-scale"));
const waitCanvas = (page) => page.waitForFunction(() => { const s = document.querySelector('[data-testid="review-sheet"]'); const c = s && s.querySelector("canvas"); return c && c.width > 0; }, { timeout: 25000 });
const tab = (page, n) => page.locator('[data-testid="review-tab"]', { hasText: n });
const focus = async (page) => { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(1200); };
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const cloudTabs = () => (acct.prefs.reviewTabs ? acct.prefs.reviewTabs.tabs.map((t) => t.id) : []);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  /* ---- device A: a desktop that already has three tabs on this device; reload restores them ---- */
  const seed = JSON.stringify({ v: 1, uid, active: "r2", at: 0, tabs: [{ id: "r1", name: "one-site.pdf", kind: "pdf", page: 2 }, { id: "r2", name: "two-grading.pdf", kind: "pdf", page: 3, scale: 1.4, view: { scale: 1.4, tx: 40, ty: 12 } }, { id: "r3", name: "three-scope.docx", kind: "doc" }] });
  const A = await mk({ width: 1280, height: 900 }, seed);
  await assertMeasurable(A.page, "verify-review-tabs-sync");
  await A.page.goto(BASE + "#markup", { waitUntil: "load" });
  await A.page.waitForSelector('[data-testid="review-tab"]', { timeout: 30000 });
  await waitCanvas(A.page); await A.page.waitForTimeout(800);
  ok("known-good arm: A's restored active tab draws its sheet", (await A.page.locator('[data-testid="review-sheet"] canvas').count()) > 0);
  ok("reload restores the three tabs in order with the same active tab", JSON.stringify(await names(A.page)) === JSON.stringify(["one-site.pdf", "two-grading.pdf", "three-scope.docx"]) && (await activeName(A.page)) === "two-grading.pdf", JSON.stringify(await names(A.page)));
  const ap = await pageOf(A.page), as = await scaleOf(A.page);
  ok("…at the active tab's last page and zoom", ap[0] === 3 && Math.abs(as - 1.4) < 0.02, `page ${ap}, scale ${as.toFixed(3)}`);
  ok("A seeded the account with its tabs", await waitFor(() => cloudTabs().join() === "r1,r2,r3"), cloudTabs().join());

  /* A moves: switch to tab 1, page 3, zoom in — then the account carries it */
  await tab(A.page, "one-site").click(); await waitCanvas(A.page); await A.page.waitForTimeout(500);
  await A.page.getByTitle("Next sheet (→)").click(); await A.page.waitForTimeout(300); // tab one was restored on page 2 → 3 of 3
  for (let i = 0; i < 2; i++) { await A.page.getByText("In", { exact: true }).first().click(); await A.page.waitForTimeout(150); }
  await A.page.waitForTimeout(500);
  const aScale = await scaleOf(A.page);
  ok("the account holds A's active tab, page and zoom", await waitFor(() => { const d = acct.prefs.reviewTabs; const t = d && d.tabs.find((x) => x.id === "r1"); return d && d.active === "r1" && t && t.page === 3 && Math.abs(t.scale - aScale) < 0.01; }), JSON.stringify(acct.prefs.reviewTabs && acct.prefs.reviewTabs.active));

  /* ---- device B: a phone, nothing local — opens Review and gets A's tabs ---- */
  const B = await mk({ width: 390, height: 800 }, null);
  await B.page.goto(BASE + "#markup", { waitUntil: "load" });
  await B.page.waitForSelector('[data-testid="review-tab"]', { timeout: 30000 });
  await waitCanvas(B.page); await B.page.waitForTimeout(800);
  ok("tabs opened on A appear on B — same files, same order, same active tab", JSON.stringify(await names(B.page)) === JSON.stringify(["one-site.pdf", "two-grading.pdf", "three-scope.docx"]) && (await activeName(B.page)) === "one-site.pdf", JSON.stringify(await names(B.page)));
  const bp = await pageOf(B.page), bs = await scaleOf(B.page);
  ok("…at A's page and zoom", bp[0] === 3 && Math.abs(bs - aScale) / aScale < 0.02, `page ${bp}, scale ${bs.toFixed(3)} vs A ${aScale.toFixed(3)}`);
  ok("phone strip: × only on the active tab, nothing overflows", (await B.page.locator('[data-testid="review-tab-close"]').count()) === 1 && (await B.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);

  /* ---- an unsaved Word tab on A, then B closes it ---- */
  await tab(A.page, "three-scope").click(); await A.page.waitForSelector('[data-testid="doc-editor"]', { state: "visible", timeout: 25000 }).catch(async (e) => { console.log("DEBUG", (await A.page.locator("body").innerText()).slice(0, 700)); await A.page.screenshot({ path: "/tmp/sync-dbg.png" }); throw e; });
  const para = A.page.locator('[data-testid="doc-editor-page"] p', { hasText: "SF." }).first();
  await para.click(); await A.page.keyboard.press("End"); await A.page.keyboard.type(" UNSAVEDHERE"); await A.page.waitForTimeout(400);
  ok("A: the Word tab shows its unsaved dot", (await tab(A.page, "three-scope").locator('[data-testid="review-tab-dirty"]').count()) === 1);
  await focus(B.page); // B sees A's latest first (last change wins) …
  await tab(B.page, "three-scope").click(); await B.page.waitForSelector('[data-testid="doc-editor"]', { state: "visible", timeout: 25000 }); await B.page.waitForTimeout(500);
  await B.page.locator('[data-testid="review-tab"][data-active="1"] [data-testid="review-tab-close"]').click(); await B.page.waitForTimeout(800);
  ok("B closed the Word tab; the account no longer lists it", await waitFor(() => !cloudTabs().includes("r3")), cloudTabs().join());
  await focus(A.page);
  ok("A's UNSAVED Word tab survives B closing it (still open, text intact)", (await names(A.page)).includes("three-scope.docx") && (await A.page.locator('[data-testid="doc-editor-page"]').innerText()).includes("UNSAVEDHERE"));

  /* ---- B closes another tab; A drops it at its next focus (A is looking at a clean tab now) ---- */
  await tab(A.page, "one-site").click(); await waitCanvas(A.page); await A.page.waitForTimeout(500);
  await tab(B.page, "two-grading").click(); await waitCanvas(B.page); await B.page.waitForTimeout(500);
  await B.page.locator('[data-testid="review-tab"][data-active="1"] [data-testid="review-tab-close"]').click(); await B.page.waitForTimeout(800);
  ok("B closed tab two; the account no longer lists it", await waitFor(() => !cloudTabs().includes("r2")), cloudTabs().join());
  ok("A still shows it until A looks (nothing yanked in the background)", (await names(A.page)).includes("two-grading.pdf"));
  await focus(A.page);
  ok("closing on B removes it on A at the next focus", !(await names(A.page)).includes("two-grading.pdf"), JSON.stringify(await names(A.page)));

  /* ---- offline: B keeps working from its local copy; back online the newer local change wins ---- */
  await B.ctx.setOffline(true); B.ctx.__offline = true;
  const before = JSON.stringify(acct.prefs.reviewTabs);
  await B.page.getByTitle("Previous sheet (←)").click(); await B.page.waitForTimeout(2800); // a page change while offline
  ok("offline: the app keeps working (page changed locally)", (await pageOf(B.page))[0] === 2);
  ok("offline: nothing reached the account", JSON.stringify(acct.prefs.reviewTabs) === before);
  const stored = await B.page.evaluate(() => JSON.parse(localStorage.getItem("planyr:review:tabs:v1") || "null"));
  ok("offline: the local copy holds the newer page", !!stored && stored.tabs.find((t) => t.id === "r1").page === 2, JSON.stringify(stored && stored.tabs.map((t) => [t.id, t.page])));
  await B.ctx.setOffline(false); B.ctx.__offline = false;
  await B.page.evaluate(() => window.dispatchEvent(new Event("online")));
  ok("back online: the newer local change is pushed to the account (not overwritten by the older account copy)", await waitFor(() => { const t = acct.prefs.reviewTabs.tabs.find((x) => x.id === "r1"); return t && t.page === 2; }, 12000), JSON.stringify(acct.prefs.reviewTabs.tabs.map((t) => [t.id, t.page])));
  await focus(A.page);
  ok("…and A picks it up at its next focus without losing its own unsaved Word tab", (await names(A.page)).includes("three-scope.docx"));

  ok("no uncaught page errors on either device", A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 2).join(" | "));
} catch (e) { ok("harness ran to completion", false, String((e && e.stack) || e)); }
await browser.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
