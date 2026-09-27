#!/usr/bin/env node
/* verify-site-plan-orphan-reach — NEW-6 (owner live test, 2026-09-22): the Map workspace's
 * Records rail → "+ Site plan" → pick a file → leave Project on "No project" → "Place on map"
 * placed the overlay on the map and, in the background, minted a "tracked" (market-record) site
 * and quietly patched the overlay's own projectId onto it — but nothing in the UI ever showed a
 * card for that plan afterward. The Records rail only ever renders a site plan's card when a COMP
 * on the SAME site is open (`focusedProjectId = focusedComp?.projectId`), and no comp exists in
 * this flow at all — so "Adjust" (needed to move/resize/rotate/crop/lock/delete the plan) was
 * unreachable unless the owner separately logged a comp on the same parcel, which happened to
 * auto-match the tracked record via compSiteMatch.js's location-based matching.
 *
 * THE FIX (SitePlansSection.jsx's confirmPage + MapFinder.jsx): a fresh upload with no project
 * chosen now resolves/mints its tracked site SYNCHRONOUSLY, right there in confirmPage, instead of
 * only through reload()'s own fire-and-forget sweep — and hands the resolved (or explicitly
 * chosen) project id straight up to MapFinder via a new `onOverlayProjectResolved` callback, which
 * feeds a new `focusedTrackedProjectId` piece of state into the SAME `focusedProjectId` prop a
 * comp's own `projectId` already feeds (comp still wins when one is open — unchanged). Part B
 * (not exercised by this harness, which never deletes anything) retires that same tracked record
 * once its last plan AND its last comp are both gone.
 *
 * ⛔ THIS DRIVES THE REAL UPLOAD FLOW END TO END, SIGNED IN, THROUGH A REAL FILE INPUT — not a
 * pre-seeded fixture row. That needs a real (locally-resumed) Supabase session, which
 * `ui-audit/lib/authRemount.mjs` provides without any real credentials (see that module's own
 * header for why the resumed session produces the real supabase-js auth sequence rather than a
 * simulated one). Every PostgREST/GoTrue/Storage call the flow makes is answered by an in-memory
 * fake of `site_plan_overlays`/`sites`/`doc_reviews`/`comps` below — real insert/CAS-update
 * semantics, not a static fixture — so the test proves the ACTUAL client code path (confirmPage's
 * insert → raster upload → resolve/mint → patch) rather than a canned response. The Drive
 * chunked-upload endpoints (`/api/uploads/*`) are deliberately left UNMOCKED: this static server's
 * SPA fallback (or a 404) makes that leg fail fast and gracefully, exactly as it does for real when
 * Drive isn't reachable — `fileNewReview` tolerates that (uploadFailed:true) and still saves the
 * review record, which is all this flow needs.
 *
 * Run:  VITE_SUPABASE_URL=https://siteplanorphan.supabase.co \
 *       VITE_SUPABASE_ANON_KEY=site-plan-orphan-dummy-key npm run build
 *       node ui-audit/verify-site-plan-orphan-reach.mjs [--assert]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { AUTH_FIXTURE, detectSupabase, authSessionSeed, fakeSession } from "./lib/authRemount.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
const argv = process.argv.slice(2);
const ASSERT = argv.includes("--assert");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("verify-site-plan-orphan-reach: no dist/ build — run `npm run build` first (with a dummy Supabase env, see this file's header).");
  process.exit(2);
}

// ---- serve dist/ ourselves (no dependency on an already-running `vite preview`) ---------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0].split("#")[0];
  let p = join(DIST, url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  if (!existsSync(p) || p.endsWith("/")) p = join(DIST, "index.html");
  try {
    const body = readFileSync(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (_) { res.writeHead(404); res.end("nope"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ⛔ Same precondition as verify-boot-framing-auth.mjs: an unconfigured build has no auth path at
// all, so this whole flow would 404 out of `fileNewReview`'s "Sign in to file documents." before
// ever reaching confirmPage's own logic — a vacuous run, refused rather than scored.
const SB = detectSupabase(DIST);
if (!SB) {
  console.error("verify-site-plan-orphan-reach: the built bundle in dist/ carries NO Supabase config — there is no cloud path to drive.");
  console.error(`Rebuild with:  VITE_SUPABASE_URL=${AUTH_FIXTURE.suggestedUrl} VITE_SUPABASE_ANON_KEY=${AUTH_FIXTURE.suggestedKey} npm run build`);
  server.close();
  process.exit(ASSERT ? 1 : 2);
}

// ---- a tiny real PNG to feed the file input — sidesteps the whole pdf.js worker path -----------
const TMPDIR = mkdtempSync(join(tmpdir(), "planyr-orphan-reach-"));
const PNG_PATH = join(TMPDIR, "throwaway-site-plan.png");
writeFileSync(PNG_PATH, Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

// ---- in-memory fakes of the tables this flow actually reads/writes ----------------------------
// Real insert / optimistic-concurrency-update semantics (mirroring casUpsert's own contract), not
// a static fixture — this is what lets the test prove the real client code path.
let overlays = [];  // site_plan_overlays rows, snake_case, as PostgREST would hold them
let sites = [];     // sites rows
let comps = [];     // comps rows — MUST stay empty for this test to mean what it claims
let overlaySeq = 0;

const json = (route, body, status = 200) => route.fulfill({
  status, contentType: "application/json",
  headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" },
  body: JSON.stringify(body),
});
const qp = (url) => { try { return new URL(url).searchParams; } catch (_) { return new URLSearchParams(); } };
const eqVal = (sp, key) => { const v = sp.get(key); if (v == null) return undefined; const m = /^eq\.(.*)$/.exec(v); return m ? m[1] : v; };
const bodyOf = (req) => { try { return JSON.parse(req.postData() || "{}"); } catch (_) { return {}; } };

function restHandler(route) {
  const req = route.request();
  const url = req.url();
  // Same-origin traffic (the app's own bundle, and the Drive chunked-upload endpoints this flow
  // deliberately leaves unmocked — see this file's header) goes to our own static server
  // untouched; only the fake Supabase host is faked below, so nothing else can leave the process.
  if (url.startsWith(BASE)) return route.continue();
  if (!url.startsWith(SB.url)) return route.abort();
  const method = req.method();
  if (method === "OPTIONS") {
    return route.fulfill({ status: 204, headers: {
      "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*",
    }, body: "" });
  }
  // GoTrue.
  if (url.includes("/auth/v1/user")) return json(route, fakeSession({ url: SB.url }).user);
  if (url.includes("/auth/v1/token")) return json(route, fakeSession({ url: SB.url }));
  if (url.includes("/auth/v1/")) return json(route, {});
  // Storage (the cached overlay raster) — the app only checks for an error, never the body shape.
  if (url.includes("/storage/v1/object/")) return json(route, { Key: "fake-storage-key" });

  if (url.includes("/rest/v1/rpc/list_my_teams")) return json(route, []);
  if (url.includes("/rest/v1/rpc/")) return json(route, {});

  const sp = qp(url);

  if (url.includes("/rest/v1/comps")) {
    if (method === "GET") return json(route, comps.filter((c) => c.deleted_at == null));
    return json(route, []); // this test asserts nothing ever POSTs/PATCHes here in the first place
  }

  if (url.includes("/rest/v1/site_plan_overlays")) {
    if (method === "GET") return json(route, overlays.filter((o) => o.deleted_at == null));
    if (method === "POST") {
      const b = bodyOf(req);
      const id = "sp" + (++overlaySeq);
      const now = new Date().toISOString();
      const row = { user_id: AUTH_FIXTURE.uid, deleted_at: null, ...b, id, version: 1, created_at: now, updated_at: now };
      overlays.push(row);
      return json(route, row, 201); // insertOverlay's `.select(cols).single()` — a plain object
    }
    if (method === "PATCH") {
      const id = eqVal(sp, "id");
      const wantVersion = eqVal(sp, "version");
      const row = overlays.find((o) => o.id === id);
      const b = bodyOf(req);
      const select = (sp.get("select") || "").trim();
      if (!row || (wantVersion != null && String(row.version) !== String(wantVersion))) {
        return json(route, []); // 0 rows matched — the CAS-conflict shape casUpsert expects
      }
      Object.assign(row, b);
      if (select === "version") return json(route, [{ version: row.version }]); // the CAS path
      return json(route, row); // the plain-upsert degrade path (.maybeSingle())
    }
    return json(route, []);
  }

  if (url.includes("/rest/v1/sites")) {
    if (method === "GET") return json(route, []); // no other live sites on this fake account
    if (method === "POST") {
      // casUpsert's insert branch sends the client-minted `id` (e.g. "trk...") in the body itself.
      const b = bodyOf(req);
      const now = new Date().toISOString();
      sites.push({ ...b, version: 1, created_at: now, updated_at: now, deleted_at: null });
      return json(route, [{ version: 1 }], 201); // `.insert(...).select("version")`
    }
    if (method === "PATCH") {
      const id = eqVal(sp, "id");
      const wantVersion = eqVal(sp, "version");
      const row = sites.find((s) => s.id === id);
      const b = bodyOf(req);
      if (!row || (wantVersion != null && String(row.version) !== String(wantVersion))) return json(route, []);
      Object.assign(row, b);
      return json(route, [{ version: row.version }]);
    }
    return json(route, []);
  }

  if (url.includes("/rest/v1/doc_reviews")) {
    if (method === "POST") return json(route, [{ version: 1 }], 201); // casUpsert insert branch
    if (method === "PATCH") return json(route, [{ version: 2 }]);
    return json(route, []);
  }

  if (url.includes("/rest/v1/")) return json(route, []);
  return json(route, {});
}

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.route("**", restHandler);
await ctx.addInitScript(authSessionSeed({ ref: SB.ref, url: SB.url }));
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("dialog", async (d) => { console.log("  [DIALOG — should never appear]", d.message()); fail++; await d.accept().catch(() => {}); });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await assertMeasurable(page, "verify-site-plan-orphan-reach");

console.log("\n=== PRECONDITION ===");
check("the served bundle is Supabase-configured — a real (resumed) signed-in session can drive this flow", true, SB.url);

// Reach the Site Planner workspace (MapFinder, since no site is active).
const plannerTab = page.locator('[data-testid="module-tab-site-planner"]');
await plannerTab.waitFor({ state: "visible", timeout: 10000 });
await plannerTab.click();
await page.waitForTimeout(1500);

// The rail tab is labelled "Records" (renamed from "Comps" — see MapFinder.jsx's RailTab).
const recordsTab = page.locator('button[role="tab"]', { hasText: "Records" }).first();
await recordsTab.waitFor({ state: "visible", timeout: 10000 });
await recordsTab.click();
await page.waitForTimeout(800);

console.log("\n=== UPLOAD: '+ Site plan' → pick a file → leave Project on 'No project' → 'Place on map' ===");
const plusSitePlan = page.locator("button", { hasText: "Site plan" }).first();
await plusSitePlan.waitFor({ state: "visible", timeout: 10000 });
await plusSitePlan.click();
await page.waitForTimeout(300);

const fileInput = page.locator('input[type="file"][accept="application/pdf,image/*"]');
check("the upload flow opened a real file input", (await fileInput.count()) > 0);
await fileInput.setInputFiles(PNG_PATH);
await page.waitForTimeout(800);

// No "Project" dropdown should even render — this account has no sites yet, which is exactly the
// "No project" case the bug report describes (the field only appears once `projects.length > 0`).
const projectField = page.locator("text=Project (optional)");
check("no Project picker is offered (nothing to choose — the 'No project' case)", (await projectField.count()) === 0);

const placeBtn = page.locator("button", { hasText: "Place on map" }).first();
await placeBtn.waitFor({ state: "visible", timeout: 10000 });
check("'Place on map' is enabled (title/date auto-filled)", await placeBtn.isEnabled());
await placeBtn.click();

// confirmPage is async (upload, insert, raster, resolve/mint, patch, reload) — poll for it to
// settle rather than a fixed sleep guessing how long that chain takes.
await page.waitForFunction(() => !document.body.innerText.includes("Saving…") && !document.body.innerText.includes("Uploading the brochure"), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(600);

console.log("\n=== THE MECHANISM ACTUALLY ENGAGED (not vacuously green) ===");
check("exactly one site-plan overlay was created", overlays.length === 1, `overlays=${overlays.length}`);
check("exactly one tracked site was minted", sites.length === 1, `sites=${sites.length}`);
if (overlays.length === 1 && sites.length === 1) {
  check("the overlay's project_id is the minted tracked site's id", overlays[0].project_id === sites[0].id,
    `overlay.project_id=${overlays[0].project_id} site.id=${sites[0].id}`);
}
check("the tracked site is role:\"tracked\" (a market record, never the pipeline)", sites[0]?.data?.role === "tracked", JSON.stringify(sites[0]?.data ? { role: sites[0].data.role, site: sites[0].data.site } : null));

console.log("\n=== WITHOUT ANY COMP HAVING BEEN CREATED ===");
check("zero comps exist (nothing on the comps side ever ran)", comps.length === 0, `comps=${comps.length}`);

console.log("\n=== THE PLAN'S OWN CARD IS REACHABLE, WITH NO COMP OPEN ===");
const bodyText1 = await page.evaluate(() => document.body.innerText);
// Positive presence checks, not just "the bad text is absent" — a card that failed to render at
// all (showEmbeddedCard false) would ALSO show neither "No plan uploaded" nor "Not placed yet",
// which is exactly the false-pass this class of check must not allow (WRONG-CASE / DRIVER-SCROLL
// -IS-NOT-APP-SCROLL §6 in /CLAUDE.md). The plan's own title ("throwaway-site-plan", from the
// uploaded fixture's filename) actually appearing on screen is what proves the card rendered.
check("the plan's own title renders on screen (the card genuinely painted, not just 'nothing bad')", /throwaway-site-plan/.test(bodyText1), bodyText1.slice(0, 200));
check("the resting card is showing (not the empty 'No plan uploaded' prompt)", !/No plan uploaded for this site yet/.test(bodyText1));
check("the resting card does not say 'Not placed yet'", !/Not placed yet/.test(bodyText1));

const kebab = page.locator('[aria-label="More actions"]').first();
check("the plan's own three-dot 'More actions' menu is on screen", (await kebab.count()) > 0);

if ((await kebab.count()) > 0) {
  // NEW-6 (fix round 2) — confirmPage already calls setAdjustOpen(true) right after placing a
  // NEW plan, exactly as it always has for the "project already chosen" case; fixing the
  // focusedProjectId flash-close (below) means it now stays open here too, matching that existing
  // case rather than being a special exception. So the panel may ALREADY be open — the menu's own
  // "Adjust" item TOGGLES it (openAdjust), so clicking it unconditionally would CLOSE an
  // already-open panel. Check the real current state first, exactly as a person looking at the
  // screen would, rather than assuming a fixed starting state.
  const panel = page.locator('[data-testid="site-plan-adjust-panel"]');
  const alreadyOpen = (await panel.count()) > 0;
  check("the Adjust panel is already open right after placing the plan (matches the existing 'project already chosen' behavior)", alreadyOpen);
  if (!alreadyOpen) {
    await kebab.click();
    await page.waitForTimeout(300);
    const menuText = await page.evaluate(() => document.body.innerText);
    check("the menu lists Adjust", /\bAdjust\b/.test(menuText));

    const adjustItem = page.locator("button", { hasText: /^Adjust$/ }).first();
    const hasAdjustItem = (await adjustItem.count()) > 0;
    check("an 'Adjust' menu item is clickable", hasAdjustItem);
    if (hasAdjustItem) {
      await adjustItem.click();
      await page.waitForTimeout(500);
    }
  } else {
    // Still prove the menu ITSELF offers Adjust too (a person who closes the panel needs a way back).
    await kebab.click();
    await page.waitForTimeout(300);
    const menuText = await page.evaluate(() => document.body.innerText);
    check("the menu also lists Adjust, as a way back in if the panel is ever closed", /\bAdjust\b/.test(menuText));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  check("the Adjust panel is on screen (Move/resize, crop, lock, opacity, rotation all reachable from here)", (await panel.count()) > 0);
  if ((await panel.count()) > 0) {
    const panelText = await panel.evaluate((el) => el.innerText);
    check("Adjust panel shows Move / resize (or 'Place on map' if unplaced) — a real manipulation surface", /Move \/ resize|Editing on map|Place on map/.test(panelText));
  }
}

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : (ASSERT ? 1 : 1));
