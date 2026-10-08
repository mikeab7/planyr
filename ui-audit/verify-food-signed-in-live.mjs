#!/usr/bin/env node
/* verify-food-signed-in-live — V1471312 (B2046224) + V1476080 (B2057920): the Food steps a TEST ACCOUNT can exercise on
 * the DEPLOYED site, signed in through the shared helper (ui-audit/lib/signedInSession.mjs — never a second sign-in).
 *
 * ENGINES, LABELLED (docs/PHONE-TESTING.md): Playwright WebKit with the iPhone 15 / iPhone SE descriptors (touch, upright
 * + landscape) for layout; Chromium (touch, same descriptor) for the one thing WebKit cannot do — a real touch SWIPE;
 * Chromium desktop 1440 for the desktop steps. The iOS keyboard is a MODEL (layout viewport unchanged, visualViewport
 * shrinks) and Safari's AutoFill bar cannot be produced: those stay parked as REAL-IPHONE steps. Reported as "WebKit" /
 * "Chromium", never "iPhone".
 *
 * DATA: everything it writes is a food_visits row on the TEST account carrying ZZ-E2E-THROWAWAY in `notes`, written and
 * deleted through the page's own Supabase client (RLS bounds it to that account). Cleanup is in `finally` and PROVES the
 * rows are gone (owner rule 15: test artifacts are always cleared). It never touches a real account or Michael's list.
 *
 * KNOWN-ANSWER ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): (a) the pin/panel geometry probe is first pointed at a plain
 * map with NO place selected and must report "no pin" — else the run is VOID; (b) the dedupe arm is first run with NO
 * saved DAO'N and must see the shared place list's single DAO'N row, so "one row" can't be a harness that finds none.
 *
 * Usage: node ui-audit/verify-food-signed-in-live.mjs [https://planyr.io] [--phones="iPhone 15,iPhone SE"] [--only=<regex>]
 *        [--shots=<dir>]   (needs E2E_LOGIN_KEY; see CLAUDE.md "SESSIONS SIGN IN AND VERIFY THEIR OWN WORK")
 */
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "https://planyr.io").replace(/\/$/, "");
const PHONES = ((process.argv.find((a) => a.startsWith("--phones=")) || "--phones=iPhone 15,iPhone SE").slice(9)).split(",").filter(Boolean);
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const MARK = "ZZ-E2E-THROWAWAY";
const DAON = { id: "cce4349a-a4ba-4977-aa22-17c395e1e682", lat: 29.7943229675293, lon: -95.5354843139648 }; // the shared list's DAO'N row
const MANUAL = { lat: DAON.lat + 0.00035, lon: DAON.lon }; // ~40 m away, the same offset Michael's saved pair showed
const FULL_NAME = "DAO'N Korean Modern Restaurant"; // the shared list's own name: the app merges on NORMALISED-NAME EQUALITY + proximity (placeIdentity.js), deliberately not on "contains"
const KB = { "iPhone 15": { up: 336, land: 200 }, "iPhone SE": { up: 260, land: 170 } };
const LONG = "Mizuki Nigiri omakase with extra wasabi and a very long trailing note to run past the edge";
const E2E_FLAG = [() => { window.__PLANYR_E2E = true; }, null]; // arms window.__foodMap (read-only), same flag the repo's e2e uses
const VV_MODEL = [() => {
  // iOS: the LAYOUT viewport stays put when the keyboard opens; only visualViewport shrinks.
  const t = new EventTarget();
  const vv = Object.assign(t, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  window.__setKeyboard = (px) => { vv.width = innerWidth; vv.height = innerHeight - px; vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
}, null];

const results = [];
const row = (id, ok, detail = "") => { results.push({ id, ok: ok === null ? null : !!ok, detail }); console.log(`${ok === null ? "OBS " : ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const want = (id) => !ONLY || new RegExp(ONLY, "i").test(id);

// ── account data (through the page's own client — RLS = the test account's rows only) ───────────────────────────────
const created = new Set();
const sb = (page, fn, arg) => page.evaluate(fn, arg);
async function seedVisit(page, v) {
  const r = await sb(page, async (visit) => {
    let uid = null;
    for (let i = 0; i < 40 && !uid; i++) {
      uid = (await window.pfSupabase.auth.getSession()).data.session?.user?.id || (await window.pfSupabase.auth.getUser()).data?.user?.id || null;
      if (!uid) await new Promise((r) => setTimeout(r, 750));
    }
    if (!uid) return { id: null, error: "no signed-in session on the page after 30 s (the auth backend or a mid-run redeploy dropped it)" };
    const { data, error } = await window.pfSupabase.from("food_visits").insert({ ...visit, user_id: uid }).select("id").single();
    return { id: data && data.id, error: error ? String(error.message) : null };
  }, { notes: MARK, ...v });
  if (r.error) throw new Error("seedVisit failed — " + r.error);
  created.add(r.id);
  return r.id;
}
const allVisitIds = (page) => sb(page, async () => ((await window.pfSupabase.from("food_visits").select("id")).data || []).map((r) => r.id));
async function cleanup(page, baseline) {
  const out = await sb(page, async (ids) => {
    const c = window.pfSupabase, errs = [];
    for (const id of ids) { const { error } = await c.from("food_visits").delete().eq("id", id); if (error) errs.push(String(error.message)); }
    // anything else carrying the marker (a visit the UI itself saved during a step)
    const { data } = await c.from("food_visits").select("id").eq("notes", "ZZ-E2E-THROWAWAY");
    for (const r of data || []) { const { error } = await c.from("food_visits").delete().eq("id", r.id); if (error) errs.push(String(error.message)); }
    const left = ((await c.from("food_visits").select("id")).data || []).map((r) => r.id);
    return { errs, left, dishes: ((await c.from("food_dishes").select("id")).data || []).length };
  }, [...created]);
  const stray = out.left.filter((id) => !baseline.has(id));
  row("CLEANUP — every throwaway visit deleted and re-read as gone", out.errs.length === 0 && stray.length === 0, `errors=${out.errs.length} strayRows=${stray.length} remainingVisits=${out.left.length} remainingDishes=${out.dishes}`);
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const probe = (page) => page.evaluate(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const hostEl = document.querySelector('[data-testid="food-map"]');
  const host = R(hostEl), map = window.__foodMap;
  const side = document.querySelector('[data-testid="food-visit-panel"]');
  const sheet = document.querySelector('[data-testid="food-bottom-sheet"]');
  const panel = R(side || sheet);
  const kind = side ? (side.dataset.layout === "side" ? "side" : "rail") : sheet ? "sheet" : null;
  const lat = hostEl && hostEl.dataset.selectedLat, lon = hostEl && hostEl.dataset.selectedLon;
  let pin = null;
  if (map && host && lat) { const p = map.latLngToContainerPoint([+lat, +lon]); pin = { x: host.left + p.x, y: host.top + p.y }; }
  let box = null;
  if (host) box = { left: host.left, top: host.top, right: (kind === "side" || kind === "rail") ? Math.min(host.right, panel.left) : host.right, bottom: kind === "sheet" ? Math.min(host.bottom, panel.top) : host.bottom };
  return { kind, host, panel, pin, box, selectedPin: (hostEl && hostEl.dataset.selectedPin) || "", selLat: lat ? +lat : null, selLon: lon ? +lon : null, vw: innerWidth, vh: innerHeight };
});
const centred = (g, frac = 0.25) => {
  if (!g.pin || !g.box) return { ok: false, why: "no pin/box" };
  const cx = (g.box.left + g.box.right) / 2, cy = (g.box.top + g.box.bottom) / 2, w = g.box.right - g.box.left, h = g.box.bottom - g.box.top;
  const dx = g.pin.x - cx, dy = g.pin.y - cy;
  return { ok: w > 40 && h > 20 && Math.abs(dx) <= w * frac && Math.abs(dy) <= h * frac && g.pin.x > g.box.left && g.pin.x < g.box.right && g.pin.y > g.box.top && g.pin.y < g.box.bottom,
    why: `pin (${Math.round(g.pin.x)},${Math.round(g.pin.y)}) vs visible-map centre (${Math.round(cx)},${Math.round(cy)}) in ${Math.round(w)}x${Math.round(h)} (${g.kind})` };
};
// toggle (Map | List), Pin button and search field: fully inside the VISUAL viewport and topmost at their own centre
const chromeVisible = (page) => page.evaluate(() => {
  const vv = window.visualViewport, bandB = vv.offsetTop + vv.height;
  const byText = (t) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === t && b.offsetParent !== null);
  const items = { Map: byText("Map"), List: byText("List"), Pin: [...document.querySelectorAll("button")].find((b) => /^(Pin|Drop a pin)$/.test(b.innerText.trim()) && b.offsetParent !== null), Search: document.querySelector('[data-testid="food-search-box"]') };
  const out = {};
  for (const [k, el] of Object.entries(items)) {
    if (!el) { out[k] = "missing"; continue; }
    const r = el.getBoundingClientRect();
    const inView = r.top >= vv.offsetTop - 1 && r.bottom <= bandB + 1 && r.left >= -1 && r.right <= innerWidth + 1 && r.width > 0;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out[k] = inView && (top === el || el.contains(top) || (top && top.contains(el))) ? "ok" : `NOT-VISIBLE ${JSON.stringify({ t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) })}`;
  }
  return out;
});
const searchBox = (page) => page.locator('[data-testid="food-search-box"]');
const rowTexts = (page) => page.locator('[data-testid="food-search-results"] button').evaluateAll((bs) => bs.map((b) => b.innerText.replace(/\s+/g, " ").trim()));
async function typeSearch(page, text, { touch = true } = {}) {
  const box = searchBox(page);
  await box.fill("");
  if (touch) await box.tap(); else await box.click();
  await box.pressSequentially(text, { delay: 40 });
  const t0 = Date.now();
  await page.waitForSelector('[data-testid="food-search-results"] button', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return { rows: await rowTexts(page), ms: Date.now() - t0 };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function openFood(opts) {
  let s = null, last = null;
  for (let i = 0; i < 14 && !s; i++) { // the sign-in route / the session handshake flake around deploys; retry only those
    try { s = await openSignedIn({ base: BASE, initScripts: [E2E_FLAG, VV_MODEL], ...opts }); }
    catch (e) { last = e; if (!/answered 5\d\d|setSession failed|Load failed|Failed to fetch/.test(String(e))) throw e; console.log("  sign-in transient failure, retrying…"); await new Promise((r) => setTimeout(r, 20000)); }
  }
  if (!s) throw last;
  await s.page.goto(BASE + "/#/food", { waitUntil: "domcontentloaded" });
  await s.page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
  await s.page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
  await assertMeasurable(s.page, "verify-food-signed-in-live");
  const chunks = await s.page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.getAttribute("src").split("/").pop()).filter((x) => /index/.test(x)).join(","));
  const build = await s.page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  s.stamp = `build ${build && build.build} · ${chunks}`;
  return s;
}
const pickRow = async (page, re) => { const pr = page.locator('[data-testid="food-search-results"] button').filter({ hasText: re }).first(); if (page.__touch === false) await pr.click(); else await pr.tap(); await page.waitForSelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]', { timeout: 20000 }); await page.waitForTimeout(3800); };


// ── typing in a field with the keyboard up (V1471312 step 8 / 9) ─────────────────────────────────────────────────────
const CONTACT = /(^|[^a-z])(name|title|first|last|full|given|family|nick|e-?mail|phone|tel|mobile|address|street|city|state|zip|postal|org|organi[sz]ation|company|job|contact|country|birthday|bday)([^a-z]|$)/i;
const fieldFacts = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect(), vv = window.visualViewport;
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const multi = el.tagName === "TEXTAREA";
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vvTop: vv.offsetTop, vvBottom: vv.offsetTop + vv.height, vw: innerWidth,
    caretFollows: (() => { const cs = getComputedStyle(el); return multi ? el.scrollTop + el.clientHeight >= el.scrollHeight - parseFloat(cs.paddingBottom || 0) - 2 : (["number", "date"].includes(el.type) ? true : el.scrollLeft + el.clientWidth >= el.scrollWidth - parseFloat(cs.paddingRight || 0) - 2); })(),
    value: el.value, ac: el.getAttribute("autocomplete"), name: el.getAttribute("name"), ekh: el.getAttribute("enterkeyhint"), type: el.type,
    covered: !(t === el || el.contains(t)), scrollsX: document.scrollingElement.scrollWidth > innerWidth + 1 };
});
async function typeField(page, loc, what, { kbPx = 0, text = LONG, L = "" } = {}) {
  const num = (await loc.getAttribute("type").catch(() => "")) === "number", date = (await loc.getAttribute("type").catch(() => "")) === "date";
  const val = date ? "2026-09-01" : num ? "12.50" : text;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  if (kbPx) { await loc.tap(); await page.evaluate((px) => window.__setKeyboard(px), kbPx); await page.waitForTimeout(700); } else await loc.click();
  if (!date && !num) await loc.evaluate((el) => { try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }); // caret at the END of any text already there (as a person adds to a field)
  if (date) await loc.fill(val); else await loc.pressSequentially(val, { delay: 12 });
  await page.waitForTimeout(450);
  const f = await fieldFacts(loc);
  const inBand = f.top >= f.vvTop - 1 && f.bottom <= f.vvBottom + 1, inWidth = f.left >= -1 && f.right <= f.vw + 1;
  const acOk = /^x-food-|^off$/.test(f.ac || "") && !CONTACT.test(f.name || "");
  const valOk = date ? f.value === val : num ? f.value === val || +f.value === +val : f.value.endsWith(val.slice(-20));
  row(`${L}step 8/9 — ${what}: text stays on screen and follows the typing, no AutoFill hooks`,
    inBand && inWidth && !f.covered && f.caretFollows && valOk && acOk && !f.scrollsX,
    `inBand=${inBand} inWidth=${inWidth} covered=${f.covered} caretFollows=${f.caretFollows} valueOk=${valOk} ac=${f.ac} name=${f.name} enterkeyhint=${f.ekh} pageScrollsSideways=${f.scrollsX}`);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard && window.__setKeyboard(0); });
  await page.waitForTimeout(300);
}

// ── the per-phone run ────────────────────────────────────────────────────────────────────────────────────────────────
async function phoneRun(phone) {
  const kb = KB[phone];
  const s = await openFood({ engine: "webkit", device: phone });
  const { page } = s;
  page.__touch = true;
  const L = `${phone}`;
  console.log(`\n## ${L} — WebKit, touch — ${s.stamp}`);
  const baseline = new Set(await allVisitIds(page));
  try {
    // KNOWN-ANSWER ARM (a): with nothing selected the probe must report no pin
    const idle = await probe(page);
    row(`${L} arm — geometry probe reports NO pin when nothing is selected`, !idle.pin && !idle.selectedPin, JSON.stringify({ pin: idle.pin, sel: idle.selectedPin }));
    if (idle.pin || idle.selectedPin) throw new Error("VOID: probe is not trustworthy");

    // KNOWN-ANSWER ARM (b): before the saved pin exists, "dao" shows the shared list's DAO'N exactly once
    if (want("1")) {
      await page.evaluate((px) => window.__setKeyboard(px), kb.up);
      const pre = await typeSearch(page, "dao");
      const daonPre = pre.rows.filter((t) => /^dao['’]n/i.test(t));
      row(`${L} arm — before any saved pin, the shared list's single DAO'N row is found (search took ${Math.round(pre.ms / 1000)}s)`, daonPre.length === 1 && !/been here/i.test(daonPre[0]), JSON.stringify(daonPre));
      if (daonPre.length !== 1) throw new Error("VOID: arm (b) did not see the shared DAO'N row");
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
    }

    // OBSERVATION (stated rule, not a defect): a manual pin named just "DAO'N" is NOT the same place as the list's "DAO'N Korean Modern Restaurant"
    if (want("1")) {
      const shortId = await seedVisit(page, { place_id: null, custom_name: "DAO'N", custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-01", rating: 8 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
      const rs = await typeSearch(page, "dao");
      row(`${L} observation — a saved pin named only "DAO'N" stays a SEPARATE row from the list's full-name place (placeIdentity.js merges on equal normalised names, not "contains")`, null, JSON.stringify(rs.rows.filter((t) => /^dao['’]n/i.test(t))));
      await sb(page, async (id) => { await window.pfSupabase.from("food_visits").delete().eq("id", id); }, shortId); created.delete(shortId);
      await page.locator('[data-testid="food-search-box"]').fill("");
    }

    // ── seed A: his saved DAO'N manual pin ~40 m from the shared row, with one visit ─────────────────────────────────
    let aId = await seedVisit(page, { place_id: null, custom_name: FULL_NAME, custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-01", rating: 8 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
    await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
    await assertMeasurable(page, "verify-food-signed-in-live");

    // ── STEP 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────
    if (want("1")) {
      await page.evaluate((px) => window.__setKeyboard(px), kb.up);
      const r1 = await typeSearch(page, "dao");
      const daon = r1.rows.filter((t) => /^dao['’]n/i.test(t));
      row(`${L} step 1 — "dao" shows ONE DAO'N row, marked Been here`, daon.length === 1 && /been here/i.test(daon[0]), JSON.stringify(daon));
      const cv = await chromeVisible(page);
      row(`${L} step 1 — Map/List, Pin and the search field are all on screen with the keyboard up`, Object.values(cv).every((v) => v === "ok"), JSON.stringify(cv));
      await shot(page, `${phone.replace(/ /g, "_")}-step1`);

      // ── STEP 2 ───────────────────────────────────────────────────────────────────────────────────────────────────────
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
      await pickRow(page, /^DAO['’]N/i);
      const g2 = await probe(page);
      const c2 = centred(g2);
      row(`${L} step 2 — the pick slides the map: pin centred in the map above the card`, c2.ok && g2.kind === "sheet", c2.why);
      row(`${L} step 2 — the pick is marked as the selected pin (data-selected-pin)`, !!g2.selectedPin, g2.selectedPin);
      const past = await page.locator('[data-testid="food-visit-card"]').count();
      row(`${L} step 2 — the card shows the existing past visit`, past === 1, `visit cards=${past}`);
      await shot(page, `${phone.replace(/ /g, "_")}-step2`);
    }

    // ── STEP 3 ───────────────────────────────────────────────────────────────────────────────────────────────────────
    if (want("3")) {
      await page.locator('[data-testid="food-panel-close"]').first().tap().catch(() => {});
      const r3 = await typeSearch(page, "fadi");
      const fadi = r3.rows.find((t) => /fadi/i.test(t) && !/been here/i.test(t) && !/live search/i.test(t));
      row(`${L} step 3 — a never-saved restaurant ("fadi") is in the results (search took ${Math.round(r3.ms / 1000)}s)`, !!fadi, fadi || JSON.stringify(r3.rows));
      if (fadi) {
        await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
        await pickRow(page, /fadi/i);
        const g3 = await probe(page), c3 = centred(g3);
        row(`${L} step 3 — pin centred above the card`, c3.ok && g3.kind === "sheet", c3.why);
        const past3 = await page.locator('[data-testid="food-visit-card"]').count();
        row(`${L} step 3 — the card shows no past visits`, past3 === 0, `visit cards=${past3}`);
      }
    }

    // ── STEP 4 ───────────────────────────────────────────────────────────────────────────────────────────────────────
    if (want("4")) {
      await page.locator('[data-testid="food-panel-close"]').first().tap().catch(() => {});
      await searchBox(page).fill(""); // the List view is filtered by whatever is in the search box
      await page.getByRole("button", { name: /^List$/ }).first().tap();
      await page.waitForSelector('[data-testid="food-visit-row"]', { timeout: 30000 }).catch(() => {});
      const nRows = await page.locator('[data-testid="food-visit-row"]').count();
      await page.locator('[data-testid="food-visit-row"]').first().tap();
      await page.getByRole("button", { name: /^Map$/ }).first().tap();
      await page.waitForTimeout(4200);
      const g4 = await probe(page), c4 = centred(g4);
      const near = g4.selLat != null && Math.abs(g4.selLat - MANUAL.lat) < 0.002 && Math.abs(g4.selLon - MANUAL.lon) < 0.002;
      row(`${L} step 4 — List → tap a row → Map: map is on that restaurant, centred above the card`, near && c4.ok, `${c4.why}; selected at ${g4.selLat},${g4.selLon}; list rows=${nRows}`);
    }

    // ── STEP 5: a restaurant saved under a SLIGHTLY DIFFERENT SPELLING from the shared place is still ONE search row ─────
    //    (the case placeIdentity.js merges: a manual pin vs the snapshot record, names equal after case/apostrophe/punctuation).
    //    Run on a saved pin ALONE (A is removed for this step and re-seeded after).
    if (want("5")) {
      await sb(page, async (id) => { await window.pfSupabase.from("food_visits").delete().eq("id", id); }, aId); created.delete(aId);
      for (const [label, name] of [["curly apostrophe + lower case", "dao’n korean modern restaurant"], ["curly apostrophe, original capitals", "DAO’N Korean Modern Restaurant"]]) {
        const vId = await seedVisit(page, { place_id: null, custom_name: name, custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-02", rating: 7 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
        const r5 = await typeSearch(page, "dao");
        const daon5 = r5.rows.filter((t) => /^dao['’]n/i.test(t));
        row(`${L} step 5 — saved as "${name}" (${label}) vs the list's "${FULL_NAME}": still ONE search row`, daon5.length === 1 && /been here/i.test(daon5[0]), JSON.stringify(daon5));
        await sb(page, async (id) => { await window.pfSupabase.from("food_visits").delete().eq("id", id); }, vId); created.delete(vId);
      }
      // OBSERVATION (by design, B1953796 R5 + test/foodPlaceIdentity.test.js): two MANUAL pins of one name at one spot are never merged with each other
      const m1 = await seedVisit(page, { place_id: null, custom_name: FULL_NAME, custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-01", rating: 8 });
      const m2 = await seedVisit(page, { place_id: null, custom_name: "dao’n korean modern restaurant", custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-02", rating: 7 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
      const r5b = await typeSearch(page, "dao");
      row(`${L} observation — two saved MANUAL pins of one name (different spelling) at one spot stay two rows, by design (B1953796 R5; test/foodPlaceIdentity.test.js)`, null, JSON.stringify(r5b.rows.filter((t) => /^dao['’]n/i.test(t))));
      for (const id of [m1, m2]) { await sb(page, async (x) => { await window.pfSupabase.from("food_visits").delete().eq("id", x); }, id); created.delete(id); }
      aId = await seedVisit(page, { place_id: null, custom_name: FULL_NAME, custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-01", rating: 8 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
      await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
    }

    // ── STEP 6: rotate with the field focused and back ────────────────────────────────────────────────────────────────
    if (want("6")) {
      const vp = page.viewportSize();
      await searchBox(page).tap();
      await page.evaluate((px) => window.__setKeyboard(px), kb.up);
      const a = await chromeVisible(page);
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await page.evaluate((px) => window.__setKeyboard(px), kb.land);
      await page.waitForTimeout(900);
      const b = await chromeVisible(page);
      await page.setViewportSize(vp);
      await page.evaluate((px) => window.__setKeyboard(px), kb.up);
      await page.waitForTimeout(900);
      const c = await chromeVisible(page);
      const ok = (o) => Object.values(o).every((v) => v === "ok");
      row(`${L} step 6 — portrait → landscape → portrait with the field focused: toggle, Pin and field stay on screen`, ok(a) && ok(b) && ok(c), JSON.stringify({ upright: a, landscape: b, backUpright: c }));
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
    }

    // ── STEP 8 (V1471312): type a long entry in EVERY text field with the keyboard (modelled) up ───────────────────────
    if (want("8")) {
      const closePanel = () => page.locator('[data-testid="food-panel-close"]').first().tap().catch(() => {});
      await closePanel();
      await searchBox(page).fill("");
      await typeField(page, searchBox(page), "Map-view search box", { kbPx: kb.up, L: L + " " });
      await searchBox(page).fill("");
      await page.getByRole("button", { name: /^List$/ }).first().tap();
      await page.waitForTimeout(1500);
      await typeField(page, searchBox(page), "List-view filter", { kbPx: kb.up, L: L + " " });
      await searchBox(page).fill("");
      await page.getByRole("button", { name: /^Map$/ }).first().tap();
      await page.waitForTimeout(1200);
      // drop-a-pin name
      await page.locator("button").filter({ hasText: /^(Pin|Drop a pin)$/ }).first().tap();
      const mb = await page.locator('[data-testid="food-map"]').boundingBox();
      await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height * 0.4);
      const pinField = page.locator('[data-testid="pin-label-input"]');
      if (await pinField.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) await typeField(page, pinField, "drop-a-pin name", { kbPx: kb.up, L: L + " " });
      else row(`${L} step 8 — drop-a-pin name field could not be reached`, false, "pin-label-input never appeared after Pin + a map tap");
      await closePanel();
      // visit form on the seeded DAO'N: date, first dish name, what was good, cost, notes
      await searchBox(page).fill(""); await typeSearch(page, "dao");
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
      await pickRow(page, /^DAO['’]N/i);
      await page.locator('[data-testid="food-log-visit-btn"]').tap();
      const form = page.locator("form").filter({ has: page.locator('[data-testid="visit-dishes"]') });
      await form.waitFor({ state: "visible", timeout: 15000 });
      await typeField(page, form.locator('[data-testid="visit-dish-name"]').first(), "visit form — first dish name", { kbPx: kb.up, L: L + " " });
      await typeField(page, form.locator('[data-testid="visit-date-input"]'), "visit form — date", { kbPx: kb.up, L: L + " " });
      await typeField(page, form.locator('[data-testid="visit-highlights-input"]'), "visit form — what was good", { kbPx: kb.up, L: L + " " });
      await typeField(page, form.locator('[data-testid="visit-cost-input"]'), "visit form — cost", { kbPx: kb.up, L: L + " " });
      await typeField(page, form.locator('[data-testid="visit-notes-input"]'), "visit form — notes", { kbPx: kb.up, L: L + " " });
      await page.screenshot({ path: SHOTS ? `${SHOTS}/${phone.replace(/ /g, "_")}-step8-form.png` : "/dev/null" }).catch(() => {});
      // leave the form WITHOUT saving
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
      await closePanel();
      await pickRow(page, /^DAO['’]N/i).catch(async () => { await typeSearch(page, "dao"); await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); }); await pickRow(page, /^DAO['’]N/i); });
      // edit an old visit
      await page.locator('[data-testid="food-visit-menu-btn"]').first().tap();
      await page.locator('[data-testid="food-visit-edit-menu-item"]').first().tap();
      const editing = page.locator('[data-testid="food-visit-card-editing"]');
      if (await editing.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
        for (const [what, tid] of [["edit old visit — date", "visit-date-input"], ["edit old visit — what was good", "visit-highlights-input"], ["edit old visit — cost", "visit-cost-input"], ["edit old visit — notes", "visit-notes-input"]]) {
          await typeField(page, editing.locator(`[data-testid="${tid}"]`), what, { kbPx: kb.up, L: L + " " });
        }
        await page.locator('[data-testid="dish-cancel-btn"]').first().tap().catch(() => {});
      } else row(`${L} step 8 — the edit-an-old-visit form could not be reached`, false, "food-visit-card-editing never appeared");
      // add-a-dish
      await page.locator('[data-testid="food-add-dish-btn"]').first().scrollIntoViewIfNeeded().catch(() => {});
      await page.locator('[data-testid="food-add-dish-btn"]').first().tap();
      const dishEdit = page.locator('[data-testid="dish-edit-row"]');
      if (await dishEdit.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
        for (const [what, tid] of [["add-a-dish — name", "dish-name-input"], ["add-a-dish — price", "dish-price-input"], ["add-a-dish — note", "dish-note-input"]]) {
          await typeField(page, dishEdit.locator(`[data-testid="${tid}"]`), what, { kbPx: kb.up, L: L + " " });
        }
      } else row(`${L} step 8 — add-a-dish could not be reached`, false, "dish-edit-row never appeared");
    }

    // ── V1476080 STEP 5: an OLDER visit with "Had …" text keeps it, read-only, through an edit ─────────────────────────
    if (want("v5")) {
      const hadId = await seedVisit(page, { place_id: null, custom_name: "ZZ-E2E Had Test", custom_lat: 29.8101, custom_lon: -95.5601, visited_on: "2026-08-15", rating: 8, what_i_had: "Brisket plate, queso" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
      await page.getByRole("button", { name: /^List$/ }).first().tap();
      await page.waitForSelector('[data-testid="food-visit-row"]', { timeout: 30000 });
      const hadRow = page.locator('[data-testid="food-visit-row"]').filter({ hasText: "ZZ-E2E Had Test" }).first();
      row(`${L} V1476080 step 5 — the list shows the saved "Had" text`, /brisket plate, queso/i.test(await hadRow.innerText()), (await hadRow.innerText()).replace(/\s+/g, " ").slice(0, 120));
      await hadRow.tap();
      await page.getByRole("button", { name: /^Map$/ }).first().tap();
      await page.waitForSelector('[data-testid="food-visit-card"]', { timeout: 20000 });
      const cardText = (await page.locator('[data-testid="food-visit-card"]').first().innerText()).replace(/\s+/g, " ");
      row(`${L} V1476080 step 5 — the card shows the saved "Had …" text`, /had brisket plate, queso/i.test(cardText), cardText.slice(0, 160));
      await page.locator('[data-testid="food-visit-menu-btn"]').first().tap();
      await page.locator('[data-testid="food-visit-edit-menu-item"]').first().tap();
      const ed = page.locator('[data-testid="food-visit-card-editing"]');
      await ed.waitFor({ state: "visible", timeout: 15000 });
      const legacy = await ed.locator('[data-testid="visit-legacy-had"]').innerText().catch(() => "");
      const editableHad = await ed.locator('input, textarea').evaluateAll((els) => els.filter((e) => /what i had/i.test((e.getAttribute("aria-label") || "") + (e.placeholder || "") + (e.closest("label")?.innerText || ""))).length);
      row(`${L} V1476080 step 5 — the edit form shows "What I had (saved earlier)" read-only, with no editable box`, /what i had \(saved earlier\)/i.test(legacy) && /brisket plate, queso/i.test(legacy) && editableHad === 0, `legacy="${legacy.replace(/\s+/g, " ")}" editableWhatIHad=${editableHad}`);
      const slider = ed.locator('[data-testid="rating-slider"]').first();
      await slider.fill("6");
      await ed.locator('button[type="submit"]').first().scrollIntoViewIfNeeded().catch(() => {});
      await ed.locator('button[type="submit"]').first().tap();
      await page.waitForTimeout(2500);
      const after = await sb(page, async (id) => (await window.pfSupabase.from("food_visits").select("rating,what_i_had").eq("id", id).single()).data, hadId);
      row(`${L} V1476080 step 5 — after changing the rating and saving, the "Had …" text is unchanged`, after && +after.rating === 6 && after.what_i_had === "Brisket plate, queso", JSON.stringify(after));
    }

    // ── V1476080 STEP 6: landscape with the keyboard up in the dish field, then back ───────────────────────────────────
    if (want("v6")) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
      await typeSearch(page, "dao");
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
      await pickRow(page, /^DAO['’]N/i);
      await page.locator('[data-testid="food-log-visit-btn"]').tap();
      const form6 = page.locator("form").filter({ has: page.locator('[data-testid="visit-dishes"]') });
      await form6.waitFor({ state: "visible", timeout: 15000 });
      const dish = form6.locator('[data-testid="visit-dish-name"]').first();
      const vp6 = page.viewportSize();
      const readField = () => page.evaluate(() => {
        const f = document.querySelector('[data-testid="visit-dishes"] [data-testid="visit-dish-name"]'); const vv = window.visualViewport;
        if (!f) return { exists: false };
        const r = f.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const panel = document.querySelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]');
        return { exists: true, focused: document.activeElement === f, fieldIn: r.top >= vv.offsetTop - 1 && r.bottom <= vv.offsetTop + vv.height + 1, fieldTop: Math.round(r.top), fieldBottom: Math.round(r.bottom), vvBottom: Math.round(vv.offsetTop + vv.height), hit: t === f || f.contains(t), panel: panel && panel.dataset.testid };
      });
      const saveReach = () => page.evaluate(() => { const sub = document.querySelector('form [type="submit"]'); sub.scrollIntoView({ block: "end" }); const r = sub.getBoundingClientRect(); const vv = window.visualViewport; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { onScreen: r.top >= vv.offsetTop - 1 && r.bottom <= vv.offsetTop + vv.height + 1, hit: t === sub || sub.contains(t) }; });
      // (a) the literal step: focus the dish field upright, keyboard up, type something, THEN rotate. What survives the rotation is recorded, not assumed.
      await dish.tap();
      await page.evaluate((px) => window.__setKeyboard(px), kb.up);
      await page.waitForTimeout(700);
      await dish.pressSequentially("ZZ rotate draft", { delay: 15 });
      await form6.locator('[data-testid="visit-highlights-input"]').scrollIntoViewIfNeeded().catch(() => {});
      await page.setViewportSize({ width: vp6.height, height: vp6.width });
      await page.evaluate((px) => window.__setKeyboard(px), kb.land);
      await page.waitForTimeout(1500);
      const rot = await readField();
      const kept = await page.evaluate(() => (document.querySelector('[data-testid="visit-dishes"] [data-testid="visit-dish-name"]') || {}).value);
      row(`${L} V1476080 step 6 — text typed in the dish field before rotating is still there after rotating`, kept === "ZZ rotate draft", `value after rotation = ${JSON.stringify(kept)}`);
      row(`${L} V1476080 step 6 — OBSERVATION after rotating with the field focused: the card swaps bottom sheet → side panel; focus kept=${rot.focused}, field on screen=${rot.fieldIn}`, null, JSON.stringify(rot));
      // (b) the practical flow in landscape: tap the dish field (keyboard comes up) — the field and Save must be reachable
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
      await page.waitForTimeout(400);
      await form6.locator('[data-testid="visit-dish-name"]').first().scrollIntoViewIfNeeded().catch(() => {});
      await form6.locator('[data-testid="visit-dish-name"]').first().tap();
      await page.evaluate((px) => window.__setKeyboard(px), kb.land);
      await page.waitForTimeout(1200);
      const land = await readField();
      row(`${L} V1476080 step 6 — landscape: tapping the dish field with the keyboard up leaves the field on screen and takeable`, land.exists && land.fieldIn && land.hit, JSON.stringify(land));
      const saveL = await saveReach();
      row(`${L} V1476080 step 6 — landscape: Save is reachable above the keyboard by scrolling the card (it tucks while typing, by the B2046224 ×3 rule)`, saveL.onScreen && saveL.hit, JSON.stringify(saveL));
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__setKeyboard(0); });
      await page.setViewportSize(vp6);
      await page.waitForTimeout(1500);
      const back = await page.evaluate(() => { const sh = document.querySelector('[data-testid="food-bottom-sheet"]'); if (!sh) return { sheet: false }; const r = sh.getBoundingClientRect(); return { sheet: true, bottom: Math.round(r.bottom), top: Math.round(r.top), vh: innerHeight, atBottom: Math.abs(r.bottom - innerHeight) <= 2, notStuckHigh: r.top > 0 }; });
      row(`${L} V1476080 step 6 — back upright with the keyboard down: the sheet returns to the bottom edge, nothing stuck high`, back.sheet && back.atBottom && back.notStuckHigh, JSON.stringify(back));
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    }
  } finally {
    await cleanup(page, baseline).catch((e) => row("CLEANUP threw", false, String(e)));
    await s.close();
  }
}


// ── desktop (Chromium 1440x900, mouse): V1471312 steps 7 + 9 ─────────────────────────────────────────────────────────
async function desktopRun() {
  const s = await openFood({});
  const { page } = s;
  page.__touch = false;
  const L = "Chromium desktop 1440";
  console.log(`\n## ${L} — ${s.stamp}`);
  const baseline = new Set(await allVisitIds(page));
  try {
    await seedVisit(page, { place_id: null, custom_name: FULL_NAME, custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-01", rating: 8 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
    await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
    await assertMeasurable(page, "verify-food-signed-in-live");
    if (want("7")) {
      const cv = await chromeVisible(page);
      row(`${L} step 7 — toolbar: Map/List, Pin and the search field all on screen`, Object.values(cv).every((v) => v === "ok"), JSON.stringify(cv));
      const r = await typeSearch(page, "dao", { touch: false });
      const daon = r.rows.filter((t) => /^dao['’]n/i.test(t));
      row(`${L} step 7 — "dao" shows ONE DAO'N row, marked Been here`, daon.length === 1 && /been here/i.test(daon[0]), JSON.stringify(daon));
      await pickRow(page, /^DAO['’]N/i);
      const g = await probe(page), c = centred(g);
      row(`${L} step 7 — the pick centres its pin in the area LEFT of the right-hand panel`, c.ok && (g.kind === "rail" || g.kind === "side"), c.why);
      row(`${L} step 7 — no sideways page scroll`, !(await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1)));
      await shot(page, "desktop-step7");
    }
    if (want("9")) {
      const closePanel = () => page.locator('[data-testid="food-panel-close"]').first().click().catch(() => {});
      await closePanel();
      await searchBox(page).fill("");
      await typeField(page, searchBox(page), "Map-view search box", { L: L + " " });
      await searchBox(page).fill("");
      await page.getByRole("button", { name: /^List$/ }).first().click(); await page.waitForTimeout(1200);
      await typeField(page, searchBox(page), "List-view filter", { L: L + " " });
      await searchBox(page).fill("");
      await page.getByRole("button", { name: /^Map$/ }).first().click(); await page.waitForTimeout(1200);
      await page.locator("button").filter({ hasText: /^(Pin|Drop a pin)$/ }).first().click();
      const mb = await page.locator('[data-testid="food-map"]').boundingBox();
      await page.mouse.click(mb.x + mb.width * 0.4, mb.y + mb.height * 0.5);
      const pinField = page.locator('[data-testid="pin-label-input"]');
      if (await pinField.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) await typeField(page, pinField, "drop-a-pin name", { L: L + " " });
      else row(`${L} step 9 — drop-a-pin name field could not be reached`, false, "pin-label-input never appeared");
      await closePanel();
      await typeSearch(page, "dao", { touch: false });
      await pickRow(page, /^DAO['’]N/i);
      await page.locator('[data-testid="food-log-visit-btn"]').click();
      const form = page.locator("form").filter({ has: page.locator('[data-testid="visit-dishes"]') });
      await form.waitFor({ state: "visible", timeout: 15000 });
      for (const [what, tid] of [["visit form — first dish name", "visit-dish-name"], ["visit form — date", "visit-date-input"], ["visit form — what was good", "visit-highlights-input"], ["visit form — cost", "visit-cost-input"], ["visit form — notes", "visit-notes-input"]]) {
        await typeField(page, form.locator(`[data-testid="${tid}"]`).first(), what, { L: L + " " });
      }
      await closePanel();
      await searchBox(page).fill(""); await typeSearch(page, "dao", { touch: false }); await pickRow(page, /^DAO['’]N/i);
      await page.locator('[data-testid="food-visit-menu-btn"]').first().click();
      await page.locator('[data-testid="food-visit-edit-menu-item"]').first().click();
      const editing = page.locator('[data-testid="food-visit-card-editing"]');
      if (await editing.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
        for (const [what, tid] of [["edit old visit — date", "visit-date-input"], ["edit old visit — what was good", "visit-highlights-input"], ["edit old visit — cost", "visit-cost-input"], ["edit old visit — notes", "visit-notes-input"]]) await typeField(page, editing.locator(`[data-testid="${tid}"]`), what, { L: L + " " });
        await page.locator('[data-testid="dish-cancel-btn"]').first().click().catch(() => {});
      } else row(`${L} step 9 — the edit-an-old-visit form could not be reached`, false);
      await page.locator('[data-testid="food-add-dish-btn"]').first().click();
      const dishEdit = page.locator('[data-testid="dish-edit-row"]');
      if (await dishEdit.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
        for (const [what, tid] of [["add-a-dish — name", "dish-name-input"], ["add-a-dish — price", "dish-price-input"], ["add-a-dish — note", "dish-note-input"]]) await typeField(page, dishEdit.locator(`[data-testid="${tid}"]`), what, { L: L + " " });
      } else row(`${L} step 9 — add-a-dish could not be reached`, false);
    }
  } finally {
    await cleanup(page, baseline).catch((e) => row("CLEANUP threw", false, String(e)));
    await s.close();
  }
}

// ── Chromium + REAL touch swipe (V1476080 step 3, second half): a vertical swipe that starts on a rating slider scrolls the
//    card and does NOT change the rating. WebKit has no touch-drag primitive, so this arm is Chromium (same iPhone 15 descriptor,
//    CDP Input.dispatchTouchEvent) — labelled as such. KNOWN-GOOD ARM: a HORIZONTAL touch drag over the same slider must change it.
async function swipeRun() {
  const s = await openFood({ device: "iPhone 15" });
  const { page } = s;
  const L = "Chromium(touch) iPhone 15";
  console.log(`\n## ${L} — ${s.stamp}`);
  const baseline = new Set(await allVisitIds(page));
  try {
    await seedVisit(page, { place_id: null, custom_name: FULL_NAME, custom_lat: MANUAL.lat, custom_lon: MANUAL.lon, visited_on: "2026-09-01", rating: 8 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
    await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
    await assertMeasurable(page, "verify-food-signed-in-live");
    await typeSearch(page, "dao");
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await pickRow(page, /^DAO['’]N/i);
    await page.locator('[data-testid="food-log-visit-btn"]').tap();
    const form = page.locator("form").filter({ has: page.locator('[data-testid="visit-dishes"]') });
    await form.waitFor({ state: "visible", timeout: 15000 });
    const slider = form.locator('[data-testid="dish-score-slider"]').first();
    await slider.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(600);
    const cdp = await page.context().newCDPSession(page);
    const touch = async (pts) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pts[0]] });
      for (const p of pts.slice(1, -1)) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] }); await page.waitForTimeout(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [pts[pts.length - 1]] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(500);
    };
    const geom = () => slider.evaluate((el) => { const r = el.getBoundingClientRect(); const sc = (() => { let n = el.parentElement; while (n) { const o = getComputedStyle(n).overflowY; if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight + 2) return n; n = n.parentElement; } return null; })(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, width: r.width, value: el.value, scrollTop: sc ? sc.scrollTop : null, scrollable: !!sc }; });
    // KNOWN-GOOD ARM: a horizontal drag across the slider changes it
    const g0 = await geom();
    await touch(Array.from({ length: 10 }, (_, i) => ({ x: g0.left + g0.width * (0.2 + 0.06 * i), y: g0.y, id: 1 })));
    const g1 = await geom();
    row(`${L} arm — a HORIZONTAL touch drag across the dish slider changes its value (instrument can see the control)`, g1.value !== g0.value, `${g0.value} → ${g1.value}`);
    if (g1.value === g0.value) throw new Error("VOID: the horizontal drag did not move the slider");
    // THE STEP: a vertical swipe that STARTS on the slider
    await slider.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const a = await geom();
    await touch(Array.from({ length: 10 }, (_, i) => ({ x: a.x, y: a.y - 12 * i, id: 1 })));
    const b = await geom();
    row(`${L} step 3 — a vertical finger-swipe that starts on the rating slider does not change the rating`, b.value === a.value, `value ${a.value} → ${b.value}; card scrollTop ${a.scrollTop} → ${b.scrollTop}`);
    row(`${L} step 3 — vacuity guard: the card actually scrolled under that swipe (so "no change" is not "nothing happened")`, a.scrollable && b.scrollTop !== a.scrollTop, `scrollable=${a.scrollable} ${a.scrollTop} → ${b.scrollTop}`);
    // second dish: + Add another dish, name it, rate it — the row appears with its own slider
    await form.locator('[data-testid="visit-dish-add"]').first().click().catch(() => {});
    const rows2 = await form.locator('[data-testid="visit-dish-row"]').count();
    row(`${L} step 3 — "+ Add another dish" gives a second dish row`, rows2 === 2, `rows=${rows2}`);
  } finally {
    await cleanup(page, baseline).catch((e) => row("CLEANUP threw", false, String(e)));
    await s.close();
  }
}

// ── driver ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
try {
  for (const p of PHONES) { if (!KB[p]) throw new Error("no keyboard model for " + p); await phoneRun(p); }
  if (want("7") || want("9")) await desktopRun();
  if (want("v3")) await swipeRun();
} catch (e) {
  row("RUN", false, String(e && e.message || e));
}
const bad = results.filter((r) => r.ok === false);
console.log(`\n${results.filter((r) => r.ok).length} passed, ${bad.length} failed, ${results.filter((r) => r.ok === null).length} observations`);
process.exit(bad.length ? 1 : 0);
