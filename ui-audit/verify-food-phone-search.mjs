#!/usr/bin/env node
/* verify-food-phone-search — Food module phone defects (owner report, 2026-10-04):
 *   D1  searching a restaurant he already has lists it TWICE (his own saved/manual pin AND the
 *       matching food_places search hit); picking the second copy saved a brand-new restaurant.
 *   D2  picking a restaurant (search result, or a list row then switching to Map) did not move the
 *       map to it.
 *   D3  on a phone, typing in search pushed the Map / List toggle off screen.
 *
 * ⛔ WHAT THIS RUN IS, stated per docs/AGENT-RULES.md ("label every responsive result"): a
 * CHROMIUM run with Playwright's `iPhone 15` descriptor (touch, mobile, DPR, UA) — NOT WebKit.
 * WebKit could not be installed in the authoring sandbox (the egress proxy denied
 * playwright.download.prss.microsoft.com). It also cannot show a real on-screen keyboard; "keyboard
 * up" is emulated by shrinking the viewport height, which is what Chrome-on-Android and iOS's
 * visual viewport both amount to for layout purposes. Re-run against WebKit when it is installable.
 *
 * ⛔ A FIXTURE, NEVER REAL DATA: a locally-minted fake session (ui-audit/lib/authRemount.mjs) and an
 * in-process mock of every Supabase call this module makes. Nothing leaves the process and no real
 * food list is read or written.
 *
 * KNOWN-GOOD ARM (AGENT-RULES "positive control"; CLAUDE.md DRIVER-SCROLL §6): the map probe must
 * report the app's own DEFAULT centre before any action and must report zoom+1 after the map's own
 * zoom-in control — if it does not, the run is VOID, not scored. The layout arm runs the same
 * measurement at desktop width where the toolbar is known to fit.
 *
 * Usage: node ui-audit/verify-food-phone-search.mjs [distDir]   (default ./dist; build with any
 * dummy VITE_SUPABASE_URL=https://<x>.supabase.co + VITE_SUPABASE_ANON_KEY).
 */
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { detectSupabase, authSessionSeed, fakeSession, AUTH_FIXTURE } from "./lib/authRemount.mjs";

const DIST = resolve(process.argv[2] || "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

// ── fixture ────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_CENTER = { lat: 29.76, lon: -95.37 };
const DAON = { lat: 29.7500, lon: -95.4200 };           // ~4.7 km from the default centre
const CAFE = { lat: 29.8000, lon: -95.3000 };           // ~8 km the other way
const FAR = { lat: 29.9000, lon: -95.5000 };
const place = (id, name, c, extra = {}) => ({
  id, name, lat: c.lat, lon: c.lon, category: "restaurant", address: "1 Fixture St, Houston, TX 77002",
  confidence: 0.99, sim: 0.9, distance_km: 3, total_matched: 3, ...extra,
});
const PLACES = [
  // The snapshot's own record of the SAME restaurant as the owner's manual pin, a few metres away.
  place("p-daon", "DAO'N", { lat: DAON.lat + 0.0002, lon: DAON.lon + 0.0002 }),
  place("p-cafe", "Sample Cafe", CAFE),
  place("p-far", "Pho Far Away", FAR),
];
const visitRow = (o) => ({
  id: o.id, user_id: AUTH_FIXTURE.uid, place_id: null, custom_name: null, custom_lat: null, custom_lon: null,
  visited_on: "2026-09-20", rating: 8, rating_ambiance: null, cost: "25", what_i_had: null, what_was_good: null,
  notes: null, would_return: true, created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", ...o,
});
const norm = (s) => String(s || "").normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();

function makeBackend(manualName = "DAO'N") {
  const state = {
    visits: [
      // HIS manual pin for the same restaurant (name variant per scenario: straight, or curly
      // apostrophe + mixed case — what makes a naive string compare call it a different place).
      visitRow({ id: "v-daon", custom_name: manualName, custom_lat: DAON.lat, custom_lon: DAON.lon, what_i_had: "Bibimbap" }),
      visitRow({ id: "v-cafe", place_id: "p-cafe", what_i_had: "Pancakes" }),
    ],
    posts: [],
  };
  return state;
}

function startServer() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let f = join(DIST, p);
      if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
      rsp.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
      rsp.end(readFileSync(f));
    }).listen(0, "127.0.0.1", () => res({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

function installBackend(ctx, base, supabaseUrl, backend) {
  const json = (route, body, status = 200) => route.fulfill({
    status, contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" },
    body: JSON.stringify(body),
  });
  return ctx.route("**", (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(base)) return route.continue();
    if (!url.startsWith(supabaseUrl)) return route.abort(); // tiles etc. — hermetic
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*" }, body: "" });
    }
    if (url.includes("/auth/v1/user")) return json(route, fakeSession({ url: supabaseUrl }).user);
    if (url.includes("/auth/v1/token")) return json(route, fakeSession({ url: supabaseUrl }));
    if (url.includes("/auth/v1/")) return json(route, {});
    if (url.includes("/rpc/food_places_search_by_name")) {
      const q = norm(JSON.parse(req.postData() || "{}").p_query);
      return json(route, PLACES.filter((p) => norm(p.name).includes(q)));
    }
    if (url.includes("/rpc/food_places_in_bounds_sampled")) return json(route, PLACES);
    if (url.includes("/rest/v1/food_places")) {
      if (process.env.FOOD_DEBUG) console.log("  [places-by-id]", url.replace(supabaseUrl, ""));
      const m = decodeURIComponent(url).match(/id=in\.\(([^)]*)\)/);
      const ids = m ? m[1].replace(/"/g, "").split(",") : [];
      return json(route, PLACES.filter((p) => ids.includes(p.id)));
    }
    if (process.env.FOOD_DEBUG) console.log("  [req]", req.method(), url.replace(supabaseUrl, ""));
    if (url.includes("/rest/v1/food_visits")) {
      if (req.method() === "POST") {
        const body = JSON.parse(req.postData() || "{}");
        backend.posts.push(body);
        const row = visitRow({ ...body, id: `v-new-${backend.posts.length}` });
        backend.visits.unshift(row);
        return json(route, row, 201);
      }
      return json(route, backend.visits);
    }
    if (url.includes("/rest/v1/")) return json(route, []);
    return json(route, {});
  });
}

// ── measurement helpers ────────────────────────────────────────────────────────────────────────
const readView = (page) => page.evaluate(() => {
  const h = document.querySelector('[data-testid="food-map"]');
  if (!h || h.dataset.mapLat == null) return null;
  const r = h.getBoundingClientRect();
  return { lat: +h.dataset.mapLat, lon: +h.dataset.mapLon, zoom: +h.dataset.mapZoom, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
});
const world = (lat, lon, z) => {
  const s = 256 * 2 ** z, rad = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * s, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * s };
};
/** Where on the SCREEN a lat/lon sits, from the probe's centre/zoom — pure Web-Mercator. */
const screenPt = (v, t) => {
  const c = world(v.lat, v.lon, v.zoom), p = world(t.lat, t.lon, v.zoom);
  return { x: v.rect.x + v.rect.w / 2 + (p.x - c.x), y: v.rect.y + v.rect.h / 2 + (p.y - c.y) };
};
const panelTop = (page) => page.evaluate(() => {
  const p = document.querySelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { top: r.top, left: r.left, w: r.width, h: r.height };
});
async function settleMap(page, ms = 2200) { await page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms); }

/** The target must be genuinely VISIBLE: inside the map host, and not under the bottom sheet. */
async function targetVisible(page, t) {
  const v = await readView(page);
  if (!v) return { ok: false, why: "map probe missing" };
  const pt = screenPt(v, t);
  const vp = page.viewportSize();
  const pan = await panelTop(page);
  let bottomLimit = v.rect.y + v.rect.h, rightLimit = v.rect.x + v.rect.w;
  if (pan) {
    if (pan.w >= vp.width * 0.9) bottomLimit = Math.min(bottomLimit, pan.top);   // bottom sheet
    else rightLimit = Math.min(rightLimit, pan.left);                            // desktop right rail
  }
  const ok = pt.x > v.rect.x && pt.x < rightLimit && pt.y > v.rect.y && pt.y < bottomLimit && v.zoom >= 15;
  return { ok, pt, v, bottomLimit, rightLimit, why: ok ? "" : `target at (${pt.x.toFixed(0)},${pt.y.toFixed(0)}) zoom ${v.zoom}, visible region x<${rightLimit.toFixed(0)} y<${bottomLimit.toFixed(0)}` };
}

const PANEL = '[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]';
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

async function newPage(browser, base, supa, backend, { desktop = false } = {}) {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1280, height: 800 } } : { ...devices["iPhone 15"] });
  await ctx.addInitScript(authSessionSeed({ ref: supa.ref, url: supa.url }));
  await installBackend(ctx, base, supa.url, backend);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(`${base}/#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, "verify-food-phone-search");
  await page.waitForFunction(() => document.querySelector('[data-testid="food-map"]')?.dataset.mapLat != null, null, { timeout: 10000 });
  await page.waitForTimeout(800); // visits + place names land
  if (process.env.FOOD_DEBUG) { await page.getByRole("button", { name: "List", exact: true }).click({ force: true }); await page.waitForTimeout(500); console.log("  [debug] list body:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 600)); await page.getByRole("button", { name: "Map", exact: true }).click({ force: true }); await page.waitForTimeout(500); }
  if (process.env.FOOD_DEBUG) { console.log("  [debug] body:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 400)); }
  return { ctx, page };
}

const rowsFor = (page, needle) => page.evaluate((n) => {
  const norm = (s) => String(s || "").normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return [...document.querySelectorAll('[data-testid="food-search-results"] button:not([data-testid])')]
    .map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter((t) => norm(t).includes(n));
}, needle);

async function typeSearch(page, text) {
  const box = page.locator('[data-testid="food-search-box"]');
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await box.tap(); else await box.click();
  await box.fill("");
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForSelector('[data-testid="food-search-results"]', { timeout: 5000 });
  await page.waitForTimeout(700);
}

async function main() {
  const supa = detectSupabase(DIST);
  if (!supa) throw new Error("dist has no Supabase config — rebuild with dummy VITE_SUPABASE_URL/KEY");
  const { srv, base } = await startServer();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors"] });
  try {
    // ── KNOWN-GOOD ARM: the probe itself ─────────────────────────────────────────────────────
    {
      const { ctx, page } = await newPage(browser, base, supa, makeBackend());
      const v0 = await readView(page);
      const centred = Math.abs(v0.lat - DEFAULT_CENTER.lat) < 1e-4 && Math.abs(v0.lon - DEFAULT_CENTER.lon) < 1e-4;
      await page.locator(".leaflet-control-zoom-in").tap();
      await settleMap(page, 900);
      const v1 = await readView(page);
      const stepped = v1.zoom === v0.zoom + 1;
      if (!centred || !stepped) { console.error(`VOID — the map probe cannot see the camera (centred=${centred}, zoomStep=${stepped}). Not scoring.`); process.exit(2); }
      console.log("known-good arm OK: probe reads the default centre and a real zoom step");
      await ctx.close();
    }

    // ── D1: ONE row for a restaurant he already has ──────────────────────────────────────────
    {
      const backend = makeBackend();
      const { ctx, page } = await newPage(browser, base, supa, backend);
      await typeSearch(page, "dao'n");
      const rows = await rowsFor(page, "daon");
      if (process.env.FOOD_DEBUG) console.log("  [debug] results html:", await page.locator('[data-testid="food-search-results"]').innerText());
      check("D1 search lists his DAO'N exactly once (manual pin + snapshot hit merged)", rows.length === 1, `rows=${JSON.stringify(rows)}`);
      // known-good: a never-saved restaurant is still found, once.
      await page.locator('[data-testid="food-search-box"]').fill("pho far");
      await page.waitForTimeout(900);
      const far = await rowsFor(page, "phofar");
      check("D1 control: a restaurant he never saved still lists once", far.length === 1, `rows=${JSON.stringify(far)}`);

      await page.locator('[data-testid="food-search-box"]').fill("dao'n");
      await page.waitForTimeout(900);
      const btns = page.locator('[data-testid="food-search-results"] button:not([data-testid])');
      const n = await btns.count();
      // Pick the LAST matching row — on main that is the snapshot copy that saved a new restaurant.
      let pickIdx = 0;
      for (let i = 0; i < n; i++) { const t = await btns.nth(i).innerText(); if (norm(t).includes("daon")) pickIdx = i; }
      await btns.nth(pickIdx).tap();
      if (process.env.FOOD_DEBUG) { await page.waitForTimeout(500); await page.screenshot({ path: "/tmp/claude-0/-home-user-planyr/3d49a76c-f765-5908-a623-8cc845cb3dcd/scratchpad/after-tap.png" }); }
      await page.waitForSelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]', { timeout: 5000 });
      await page.waitForTimeout(500);
      const panelText = await page.locator('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]').first().innerText();
      check("D1 picking it opens the EXISTING restaurant (his Bibimbap visit is there)", /Bibimbap/.test(panelText), panelText.slice(0, 120).replace(/\s+/g, " "));
      // log a visit and make sure it lands on the same restaurant, never a second record
      await page.locator('[data-testid="food-log-visit-btn"]').tap();
      await page.locator('input[placeholder="Brisket plate, queso…"]').fill("Bulgogi");
      await page.locator('button[type="submit"]').tap();
      await page.waitForTimeout(900);
      const post = backend.posts[0];
      const sameRecord = post && post.place_id == null && norm(post.custom_name) === "daon" &&
        Math.abs(post.custom_lat - DAON.lat) < 1e-6 && Math.abs(post.custom_lon - DAON.lon) < 1e-6;
      check("D1 the saved visit joins his existing DAO'N pin (no second restaurant record)", !!sameRecord, JSON.stringify(post && { place_id: post.place_id, custom_name: post.custom_name, lat: post.custom_lat, lon: post.custom_lon }));
      await ctx.close();
    }

    // ── D1b: same restaurant under a curly-apostrophe / mixed-case spelling ───────────────────
    {
      const backend = makeBackend("Dao\u2019N");
      const { ctx, page } = await newPage(browser, base, supa, backend);
      await typeSearch(page, "dao'n");
      const rows = await rowsFor(page, "daon");
      check("D1b curly-apostrophe / mixed-case saved name merges into ONE row", rows.length === 1, `rows=${JSON.stringify(rows)}`);
      await page.locator('[data-testid="food-search-results"] button:not([data-testid])').first().tap();
      await page.waitForSelector(PANEL, { timeout: 5000 });
      await page.waitForTimeout(500);
      const t = await page.locator(PANEL).first().innerText();
      check("D1b picking it opens his EXISTING Dao\u2019N (Bibimbap visit present)", /Bibimbap/.test(t), t.slice(0, 100).replace(/\s+/g, " "));
      await ctx.close();
    }

    // ── D2: the map follows the selection ────────────────────────────────────────────────────
    {
      const { ctx, page } = await newPage(browser, base, supa, makeBackend());
      await typeSearch(page, "pho far");
      await page.locator('[data-testid="food-search-results"] button:not([data-testid])', { hasText: "Pho Far" }).first().tap();
      await page.waitForSelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]');
      await settleMap(page);
      let tv = await targetVisible(page, FAR);
      check("D2 search pick (never-saved restaurant): map moved to it, pin in the visible area", tv.ok, tv.why);
      await page.locator('[data-testid="food-panel-close"]').tap();

      await typeSearch(page, "dao'n");
      await page.locator('[data-testid="food-search-results"] button:not([data-testid])').first().tap();
      await page.waitForSelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]');
      await settleMap(page);
      tv = await targetVisible(page, DAON);
      check("D2 search pick (his own DAO'N): map moved to it, pin in the visible area", tv.ok, tv.why);
      await page.locator('[data-testid="food-panel-close"]').tap();

      // from the LIST, then switch to Map (clear the search text first: in List view it FILTERS rows)
      await page.locator('[data-testid="food-search-box"]').fill("");
      await page.getByRole("button", { name: "List", exact: true }).tap();
      await page.waitForTimeout(500);
      await page.getByText("Sample Cafe").first().tap();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "Map", exact: true }).tap();
      await page.waitForSelector('[data-testid="food-map"]');
      await settleMap(page, 2600);
      tv = await targetVisible(page, CAFE);
      check("D2 list pick then Map: map is on the picked restaurant, pin visible, panel open", tv.ok && !!(await panelTop(page)), tv.why);
      await ctx.close();
    }

    // ── D3: search + Map/List stay on screen together ────────────────────────────────────────
    const layout = async (page, label) => {
      const m = await page.evaluate(() => {
        const vv = window.visualViewport;
        const W = vv ? vv.width : innerWidth, H = vv ? vv.height : innerHeight;
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
        const btn = (txt) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === txt);
        const hit = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && (e === el || el.contains(e)); };
        const search = document.querySelector('[data-testid="food-search-box"]');
        const res = document.querySelector('[data-testid="food-search-results"]');
        return {
          W, H, scrollY: window.scrollY, map: box(btn("Map")), list: box(btn("List")), search: box(search), results: box(res?.parentElement),
          mapHit: hit(btn("Map")), listHit: hit(btn("List")), searchHit: hit(search),
        };
      });
      const inside = (b) => b && b.l >= -0.5 && b.r <= m.W + 0.5 && b.t >= -0.5 && b.b <= m.H + 0.5;
      const toggles = inside(m.map) && inside(m.list) && m.mapHit && m.listHit;
      const field = inside(m.search) && m.searchHit && m.search.w >= 120;
      const drop = !m.results || (m.results.l >= -0.5 && m.results.r <= m.W + 0.5 && m.results.b <= m.H + 0.5);
      check(`D3 ${label}: Map/List toggle fully on screen and tappable`, toggles, JSON.stringify({ map: m.map, list: m.list, W: m.W }));
      check(`D3 ${label}: search field on screen, tappable, usable width`, field, JSON.stringify({ search: m.search }));
      check(`D3 ${label}: results dropdown fits the visible area`, drop, JSON.stringify({ results: m.results, W: m.W, H: m.H }));
      check(`D3 ${label}: page itself not scrolled away`, m.scrollY === 0, `scrollY=${m.scrollY}`);
    };
    {
      const { ctx, page } = await newPage(browser, base, supa, makeBackend());
      await layout(page, "phone, idle");
      await typeSearch(page, "dao");
      await layout(page, "phone, typing");
      await page.setViewportSize({ width: 393, height: 340 }); // keyboard-up emulation
      await page.waitForTimeout(500);
      await layout(page, "phone, keyboard up");
      await page.setViewportSize({ width: 852, height: 393 }); // landscape
      await page.waitForTimeout(500);
      await layout(page, "phone landscape, typing");
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage(browser, base, supa, makeBackend(), { desktop: true });
      await typeSearch(page, "dao");
      await layout(page, "desktop (known-good arm)");
      const tv0 = await page.evaluate(() => !!document.querySelector('[data-testid="food-map"]'));
      check("D3 desktop: map still mounted", tv0);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (Chromium iPhone-15 emulation, NOT WebKit)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
