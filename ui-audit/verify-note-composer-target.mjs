#!/usr/bin/env node
/* verify-note-composer-target.mjs — NEW-1 (2026-10-08): "Adding a note to a site on the map: the thing
 * you clicked disappears and you can't tell where the note is going."
 *
 * WHAT IT DRIVES (the real map, the real composer, at an iPhone-sized WebKit viewport AND desktop):
 *   Drop a pin LOW on the map (so the composer would sit on top of it if nothing moved the map) →
 *   Record info ▾ → Add a note, then asserts
 *     · the composer NAMES its target (never the bare "On a parcel" / "Dropped pin")
 *     · the target is still there — the decide pin AND the notes-colour ring — and is VISIBLE: its
 *       centre is inside the map, below the toolbar and ABOVE the composer's top edge
 *     · with the on-screen keyboard up (phone, ui-audit/lib/iosKeyboard.mjs) the composer sits above
 *       the keyboard and the target is STILL above the composer
 *     · a stray tap on the map neither retargets (no second pin, same position) nor closes the note
 *     · Cancel returns to the decide bar as it was ("Pin dropped", same pin); nothing was written
 *     · Save writes ONE row, releases the ground (toolbar back at rest, no decide bar) and rings the
 *       new note's marker (data-open) so the owner lands on it
 *   Then (stub mode) an EXISTING parcel-anchored note: its outline is drawn and the label names the
 *   account. Known-good arm: the composer opened from a pin at all (a vacuous run says so).
 *
 * MODES
 *   node ui-audit/verify-note-composer-target.mjs                 stub server (BASE_URL, default :4185)
 *   node ui-audit/verify-note-composer-target.mjs --live <base>   signed in as the test account on a deploy
 * Stub mode needs a build made with VITE_SUPABASE_URL=https://stubproj.supabase.co (see the PR).
 * Engine: WebKit for the phone arm, Chromium for desktop. "WebKit", never "iPhone"/"Safari".
 */
import { webkit, chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { IOS_MODEL, KEYBOARDS } from "./lib/iosKeyboard.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const LIVE = process.argv.includes("--live");
const LIVE_BASE = LIVE ? (process.argv[process.argv.indexOf("--live") + 1] || "https://planyr.io") : null;
const BASE = process.env.BASE_URL || "http://localhost:4185/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const ok = (t, pass, d = "") => { results.push({ t, pass }); console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

const UID = "00000000-0000-4000-8000-000000000001";
const HOME = { lat: 29.76, lon: -95.37 };
// Read-only: exposes the Leaflet map as window.__mapFinderMap so the harness can centre it (E2E-gated in the app).
const E2E_FLAG = () => { window.__PLANYR_E2E = true; };

/* ── stub server (stub mode only) ─────────────────────────────────────────────────────────── */
function stubRoute(state) {
  return async (route) => {
    const req = route.request(), url = req.url(), method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/auth/v1/user")) return json({ id: UID, aud: "authenticated", email: "owner@example.com" });
    if (url.includes("/auth/v1/token")) return json({ access_token: "stub", token_type: "bearer", expires_in: 3600, refresh_token: "r", user: { id: UID } });
    if (url.includes("/rest/v1/map_notes")) {
      let body = null; try { body = req.postDataJSON(); } catch (_) {}
      if (method === "GET") return json(state.rows.filter((r) => !r.deleted_at));
      const single = (req.headers()["accept"] || "").includes("pgrst.object");
      const shape = (r) => (single ? r : [r]);
      if (method === "POST") { const r = { ...state.rows[0], ...body, id: `new-${state.writes.length}`, created_at: "2026-10-08T10:00:00Z" }; state.rows = [...state.rows, r]; state.writes.push({ method, body }); return json(shape(r), 201); }
      if (method === "PATCH" || method === "DELETE") { state.writes.push({ method, body }); return json(shape(state.rows[0])); }
    }
    return json([]);
  };
}
const SQUARE = (lat, lon, d = 0.0006) => ({ type: "Polygon", coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });

/* ── helpers ──────────────────────────────────────────────────────────────────────────────── */
const mapRect = (page) => page.evaluate(() => { const r = document.querySelector(".leaflet-container").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, bottom: r.bottom }; }, sel);
const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);
const text = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").trim(), sel);

async function dropPinAndAddNote(page, at) {
  await page.click('[data-testid="map-toolbar-drop-pin"]');
  await pacedWait(page, 200);
  await page.mouse.click(at.x, at.y);
  await pacedWait(page, 500);
  await page.click('[data-testid="map-decide-record-info"]');
  await pacedWait(page, 200);
  await page.click('[data-testid="map-decide-verb-note"]');
  await page.waitForSelector('[data-testid="map-note-editor"]', { timeout: 8000 });
  await pacedWait(page, 900);   // composer measured → pan settled
}

async function scenario(page, tag, { phone, kbPx, knownSiteName = null, writes, live }) {
  console.log(`\n=== ${tag} ===`);
  await assertMeasurable(page, "verify-note-composer-target");
  await page.waitForSelector(".leaflet-container", { timeout: 25000 });
  await pacedWait(page, 2200);
  const m0 = await mapRect(page);
  // A point LOW on the map: exactly where the composer lands if nothing moves the map.
  let at = { x: m0.x + m0.w * 0.5, y: m0.y + m0.h * 0.78 };

  if (knownSiteName) {
    // Centre on the saved site and drop the pin on its origin, so the label can name the site.
    const p = await page.evaluate(({ lat, lon }) => {
      const map = window.__mapFinderMap; map.setView([lat, lon], 17, { animate: false });
      const pt = map.latLngToContainerPoint([lat, lon]); const r = map.getContainer().getBoundingClientRect();
      return { x: r.left + pt.x, y: r.top + pt.y };
    }, knownSiteName.origin);
    await pacedWait(page, 800);
    at = p;
  }

  await dropPinAndAddNote(page, at);
  ok(`${tag} · the composer opened from a dropped pin (known-good arm)`, await has(page, '[data-testid="map-note-editor"]'));

  const label = await text(page, '[data-testid="map-note-target"]');
  ok(`${tag} · the composer names its target`, /^On .{3,}/.test(label) && label !== "On a parcel", JSON.stringify(label));
  // The pin sits on the saved site's origin, so the label must name a SAVED SITE (the nearest one wins — the
  // account may hold another site right beside it), never fall back to coordinates.
  if (knownSiteName) ok(`${tag} · …and it names a saved site, not coordinates`, !/^On dropped pin/.test(label) && (await page.getAttribute('[data-testid="map-note-target"]', "data-target-kind")) === "site", label);
  else ok(`${tag} · …a pin with no site reads its coordinates`, /^On dropped pin \(-?\d+\.\d{4}, -?\d+\.\d{4}\)$/.test(label), label);

  ok(`${tag} · the dropped pin is STILL on the map`, await has(page, '[data-testid="map-decide-pin"]'));
  ok(`${tag} · …and ringed in the notes colour`, await has(page, '[data-testid="map-note-target-pin"]'));
  ok(`${tag} · the decide bar stepped aside (no second question on screen)`, !(await has(page, '[data-testid="map-decide-summary"]')));
  ok(`${tag} · the toolbar did not fall back to a stale mode`, !(await has(page, '[data-testid="map-toolbar-select-parcels"]')));

  const m1 = await mapRect(page);
  const card = await rectOf(page, '[data-testid="map-note-editor"]');
  const ring = await rectOf(page, '[data-testid="map-note-target-pin"]');
  const clearOfCard = (r, c, top = 60) => !!r && !!c && r.cy < c.y - 4 && r.cy > m1.y + top && r.cx > m1.x + 8 && r.cx < m1.x + m1.w - 8;
  ok(`${tag} · the target is VISIBLE — inside the map, clear of the toolbar, above the composer`, clearOfCard(ring, card, phone ? 6 : 60) && ring.cy + 15 <= card.y,
    ring && card ? `target y=${Math.round(ring.cy)}, composer top=${Math.round(card.y)}` : "missing");
  await page.screenshot({ path: `${OUT}note-composer-${tag.replace(/\W+/g, "-")}-open.png` });

  // A stray tap on the map: neither retargets nor discards.
  const pinBefore = await rectOf(page, '[data-testid="map-decide-pin"]');
  await page.mouse.click(m1.x + m1.w * 0.25, m1.y + Math.max(110, m1.h * 0.25));
  await pacedWait(page, 500);
  const pinAfter = await rectOf(page, '[data-testid="map-decide-pin"]');
  ok(`${tag} · a stray tap on the map does not close the note`, await has(page, '[data-testid="map-note-editor"]'));
  ok(`${tag} · …and does not retarget it (same pin, same place, only one)`,
    !!pinBefore && !!pinAfter && Math.abs(pinBefore.cx - pinAfter.cx) < 2 && Math.abs(pinBefore.cy - pinAfter.cy) < 2
    && (await page.evaluate(() => document.querySelectorAll('[data-testid="map-decide-pin"]').length)) === 1);

  // Keyboard up (phone): the composer rides above it and the target stays above the composer.
  if (phone) {
    await page.focus('[data-testid="map-note-body"]');
    await pacedWait(page, 900);
    const kb = await page.evaluate(() => ({ open: window.__kb?.open, px: window.__kb?.px, vvH: window.visualViewport?.height, vvTop: window.visualViewport?.offsetTop }));
    const c2 = await rectOf(page, '[data-testid="map-note-editor"]');
    const r2 = await rectOf(page, '[data-testid="map-note-target-pin"]');
    const m2 = await mapRect(page);
    ok(`${tag} · keyboard model is up (known-good arm)`, kb.open === true && kb.px === kbPx, JSON.stringify(kb));
    ok(`${tag} · with the keyboard up the composer is wholly above it`, !!c2 && c2.bottom <= kb.vvTop + kb.vvH + 1, c2 ? `card bottom=${Math.round(c2.bottom)}, visible bottom=${Math.round(kb.vvTop + kb.vvH)}` : "missing");
    ok(`${tag} · …and the target is still above the composer (its whole ring clears the card)`, clearOfCard(r2, c2, 6) && r2.cy + 15 <= c2.y && r2.cy < kb.vvTop + kb.vvH, r2 && c2 ? `target y=${Math.round(r2.cy)}, composer top=${Math.round(c2.y)}` : "missing");
    ok(`${tag} · …and the Save / Cancel row is reachable above the keyboard`,
      await page.evaluate((vb) => { const b = document.querySelector('[data-testid="map-note-save"]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.bottom <= vb + 1 && r.top >= 0; }, kb.vvTop + kb.vvH));
    await page.screenshot({ path: `${OUT}note-composer-${tag.replace(/\W+/g, "-")}-keyboard.png` });
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await pacedWait(page, 900);
    const c3 = await rectOf(page, '[data-testid="map-note-editor"]');
    const r3 = await rectOf(page, '[data-testid="map-note-target-pin"]');
    ok(`${tag} · keyboard dismissed: the target is still above the (full-size) composer`, clearOfCard(r3, c3, 6), r3 && c3 ? `target y=${Math.round(r3.cy)}, composer top=${Math.round(c3.y)}` : "missing");
    await page.screenshot({ path: `${OUT}note-composer-${tag.replace(/\W+/g, "-")}-kbdown.png` });
  }

  // Cancel → back on the decide bar exactly as before, nothing written.
  const w0 = writes();
  await page.getByRole("button", { name: "Cancel" }).last().click();
  await pacedWait(page, 500);
  ok(`${tag} · Cancel closes the composer`, !(await has(page, '[data-testid="map-note-editor"]')));
  ok(`${tag} · …back on the decide bar for the SAME pin`, (await text(page, '[data-testid="map-decide-summary"]')) === "Pin dropped" && await has(page, '[data-testid="map-decide-pin"]'));
  ok(`${tag} · …and nothing was written`, writes() === w0);
  ok(`${tag} · …the notes-colour ring is gone with the composer`, !(await has(page, '[data-testid="map-note-target-pin"]')));

  // Save → one row, ground released, new note ringed.
  await page.click('[data-testid="map-decide-record-info"]');
  await pacedWait(page, 200);
  await page.click('[data-testid="map-decide-verb-note"]');
  await page.waitForSelector('[data-testid="map-note-editor"]', { timeout: 8000 });
  await pacedWait(page, 600);
  const stamp = `harness note ${Date.now()}`;
  await page.fill('[data-testid="map-note-body"]', stamp);
  await page.click('[data-testid="map-note-save"]');
  await pacedWait(page, 1500);
  ok(`${tag} · Save closes the composer`, !(await has(page, '[data-testid="map-note-editor"]')));
  ok(`${tag} · …wrote exactly one row`, writes() === w0 + 1, `${writes() - w0} write(s)`);
  ok(`${tag} · …released the ground (no decide bar, no stray pin)`, !(await has(page, '[data-testid="map-decide-summary"]')) && !(await has(page, '[data-testid="map-decide-pin"]')));
  ok(`${tag} · …toolbar is back at rest`, await has(page, '[data-testid="map-toolbar-select-parcels"]'));
  ok(`${tag} · …and you land on the new note, ringed on the map`, await has(page, '.map-note-feature [data-open="1"]'));
  await page.screenshot({ path: `${OUT}note-composer-${tag.replace(/\W+/g, "-")}-saved.png` });
  return { stamp };
}

/* ── run ──────────────────────────────────────────────────────────────────────────────────── */
let exitBad = false;
try {
  if (!LIVE) {
    const state = { rows: [{
      id: "parcel-note", user_id: UID, team_id: null, project_id: null, title: "Parcel note", body: "Existing parcel-anchored note.",
      anchor_kind: "parcel", lat: HOME.lat + 0.01, lon: HOME.lon + 0.01, county: "harris", parcel_apn: "1234567",
      parcel_geom: SQUARE(HOME.lat + 0.01, HOME.lon + 0.01), created_at: "2026-10-08T09:00:00Z", updated_at: "2026-10-08T09:00:00Z",
    }], writes: [] };
    const arms = [
      { tag: "WebKit phone", engine: webkit, ctx: { ...devices["iPhone 15"] }, phone: true, init: [[E2E_FLAG, null], [IOS_MODEL, { kbPx: KEYBOARDS["iPhone 15"] }]] },
      { tag: "Chromium desktop", engine: chromium, launch: { executablePath: CHROME, args: ["--no-sandbox"] }, ctx: { viewport: { width: 1440, height: 900 } }, phone: false, init: [[E2E_FLAG, null]] },
    ];
    for (const a of arms) {
      const browser = await a.engine.launch(a.launch || {});
      const context = await browser.newContext(a.ctx);
      await context.route("**/stubproj.supabase.co/**", stubRoute(state));
      await context.addInitScript(({ uid }) => { try { localStorage.setItem("sb-stubproj-auth-token", JSON.stringify({ access_token: "stub", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, refresh_token: "r", user: { id: uid, aud: "authenticated", role: "authenticated", email: "owner@example.com" } })); } catch (e) {} }, { uid: UID });
      for (const [fn, arg] of a.init) await context.addInitScript(fn, arg);
      const page = await context.newPage();
      const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
      await page.goto(BASE, { waitUntil: "load" });
      await scenario(page, a.tag, { phone: a.phone, kbPx: KEYBOARDS["iPhone 15"], writes: () => state.writes.length });

      // An EXISTING parcel-anchored note: outline drawn, label names the account.
      await page.evaluate(({ lat, lon }) => window.__mapFinderMap.setView([lat, lon], 16, { animate: false }), { lat: HOME.lat + 0.01, lon: HOME.lon + 0.01 });
      await pacedWait(page, 900);
      const mk = await rectOf(page, '[data-note-id="parcel-note"]');
      if (mk) { await page.mouse.click(mk.cx, mk.cy); await pacedWait(page, 900); }
      const lbl = await text(page, '[data-testid="map-note-target"]');
      ok(`${a.tag} · an existing parcel note names its account`, lbl === "On Account 1234567", JSON.stringify(lbl));
      ok(`${a.tag} · …and its parcel is outlined while the composer is open`, await page.evaluate(() => document.querySelectorAll("path.map-note-target-outline").length) >= 1);
      await page.screenshot({ path: `${OUT}note-composer-${a.tag.replace(/\W+/g, "-")}-parcel.png` });
      const mine = errs.filter((e) => !/access control checks|quiddity|Load failed/i.test(e));   // third-party GIS hosts CORS-refuse in this sandbox; not ours
      ok(`${a.tag} · no page errors of our own`, mine.length === 0, mine.slice(0, 2).join(" | "));
      await browser.close();
    }
  } else {
    // SIGNED IN as the test account against a real deploy. Each arm writes then soft-deletes its own throwaway note.
    const arms = [
      { tag: "WebKit phone (live)", engine: "webkit", device: "iPhone 15", phone: true, init: [[E2E_FLAG, null], [IOS_MODEL, { kbPx: KEYBOARDS["iPhone 15"] }]] },
      { tag: "Chromium desktop (live)", engine: "chromium", device: null, phone: false, init: [[E2E_FLAG, null]] },
    ];
    for (const a of arms) {
      const s = await openSignedIn({ base: LIVE_BASE, engine: a.engine, device: a.device, initScripts: a.init, viewport: { width: 1440, height: 900 } });
      console.log(`build ${JSON.stringify(s.build)} · signed in as ${s.proof.email}`);
      const page = s.page;
      // A signed-in account lands on the Dashboard; the Site route is the account Map. (The app may
      // reload itself once if a newer deploy landed mid-run, so a re-navigation is tolerated.)
      await page.goto(LIVE_BASE + "/#/site", { waitUntil: "load" }).catch(() => {});
      await pacedWait(page, 1500);
      await page.waitForSelector('[data-testid="map-toolbar-drop-pin"]', { timeout: 20000 }).catch(() => {});
      const before = await page.evaluate(async () => { const { data } = await window.pfSupabase.from("map_notes").select("id").is("deleted_at", null); return (data || []).map((r) => r.id); });
      let n = before.length;
      const fixture = await page.evaluate(async () => {
        const { data } = await window.pfSupabase.from("sites").select("id,data").eq("id", "e2e-fixture-site").maybeSingle();
        const d = data && data.data; return d && d.origin ? { name: d.site || d.name || "", origin: d.origin } : null;
      });
      const live = { writes: () => n };
      // count writes by watching the table, polled after each action via the harness's own getter
      const getN = async () => page.evaluate(async () => { const { data } = await window.pfSupabase.from("map_notes").select("id").is("deleted_at", null); return (data || []).length; });
      const writes = () => n;
      // wrap scenario so `writes()` reflects the DB: refresh before each read
      const wrapped = { writes };
      const sc = scenario(page, a.tag, { phone: a.phone, kbPx: KEYBOARDS["iPhone 15"], writes, live, knownSiteName: a.phone ? (fixture && fixture.name ? fixture : null) : null });
      // keep n in sync with the DB while the scenario runs
      const poll = setInterval(async () => { try { n = await getN(); } catch (_) {} }, 250);
      try { await sc; } finally { clearInterval(poll); }
      // Clean up: soft-delete the throwaway note(s) this arm created, then verify they are gone.
      const created = await page.evaluate(async (keep) => {
        const { data } = await window.pfSupabase.from("map_notes").select("id,body").is("deleted_at", null);
        return (data || []).filter((r) => !keep.includes(r.id) && /^harness note \d+$/.test(r.body || "")).map((r) => r.id);
      }, before);
      for (const id of created) await page.evaluate(async (i) => { await window.pfSupabase.from("map_notes").update({ deleted_at: new Date().toISOString() }).eq("id", i); }, id);
      const left = await page.evaluate(async (keep) => { const { data } = await window.pfSupabase.from("map_notes").select("id,body").is("deleted_at", null); return (data || []).filter((r) => !keep.includes(r.id)).length; }, before);
      ok(`${a.tag} · throwaway note(s) deleted and verified gone`, created.length >= 1 && left === 0, `${created.length} removed, ${left} left`);
      const mine = s.errors.filter((e) => !/access control checks|quiddity|Load failed/i.test(e));   // third-party GIS hosts CORS-refuse WebKit here; not ours
      ok(`${a.tag} · no page errors of our own`, mine.length === 0, mine.slice(0, 2).join(" | "));
      await s.close();
    }
  }
} catch (e) {
  console.error("HARNESS ERROR:", e && e.stack || e);
  exitBad = true;
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (results.length < 10) { console.log("VOID — too few checks ran to mean anything"); exitBad = true; }
process.exit(exitBad || failed.length ? 1 : 0);
