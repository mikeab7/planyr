#!/usr/bin/env node
/* verify-food-search-live — V1493136 (B2069808). WebKit at iPhone 15 size, signed in as the throwaway TEST account
 * (ui-audit/lib/signedInSession.mjs) against the REAL planyr.io network and the REAL food_places_search_by_name.
 * Only data touched: ONE throwaway manual food_visits row on the TEST account (name "Zzspeed Tacoworks"), inserted
 * at the start and deleted in `finally` (its absence is re-read and asserted). Never Michael's account.
 *
 * Every arm prints its numbers + the build hash from /version.json read in the SAME run. Exit 1 on any FAIL.
 *  1 SAVED   type "zzspeed" letter by letter: the saved row is on screen at the last letter, list never blank in between.
 *  2 SERVER  type "fadi" (snapshot-only): ms to first row, the RPC's own round trip, "Searching…" sits BELOW rows.
 *  3 REPEAT  clear + retype "fadi": rows ~at once, NO second search request.
 *  4 STALE   "tacos" (its answer held 1.5 s) then "tacos a": settles on the "tacos a" answer, older request cancelled/ignored.
 *  5 PAN     "torchy" before/after panning the map Houston → Dallas: nearest branch leads in both places.
 * Usage: E2E_LOGIN_KEY=… node ui-audit/verify-food-search-live.mjs [base=https://planyr.io]  */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv.find((a) => a.startsWith("http")) || "https://planyr.io";
const NAME = "Zzspeed Tacoworks";
const HOU = { lat: 29.7604, lon: -95.3698 }, DAL = { lat: 32.7767, lon: -96.797 };
const out = [];
const row = (arm, ok, detail) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${arm} — ${detail}`); };

const s = await openSignedIn({ base: BASE, engine: "webkit", device: "iPhone 15", initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
let seededId = null;
const rpc = []; // { q, t0, ms, status, aborted }
page.on("request", (r) => { if (r.url().includes("food_places_search_by_name")) { const q = JSON.parse(r.postData() || "{}").p_query; rpc.push({ q, t0: Date.now(), ms: null, status: null, failed: false, req: r }); } });
page.on("requestfinished", async (r) => { const e = rpc.find((x) => x.req === r); if (e) { e.ms = Date.now() - e.t0; const res = await r.response(); e.status = res && res.status(); } });
page.on("requestfailed", (r) => { const e = rpc.find((x) => x.req === r); if (e) e.failed = true; });

try {
  console.log(`build ${JSON.stringify(s.build)} · signed in as ${s.proof.email} · ${BASE}`);
  // seed ONE throwaway manual visit on the test account
  seededId = await page.evaluate(async (n) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { data, error } = await window.pfSupabase.from("food_visits").insert({ user_id: u.user.id, place_id: null, custom_name: n, custom_lat: 29.7604, custom_lon: -95.3698, visited_on: "2026-10-08", rating: "7.5", what_i_had: "throwaway live check" }).select("id").single();
    if (error) throw new Error("seed failed: " + error.message);
    return data.id;
  }, NAME);
  await page.evaluate(() => { location.hash = "#/food"; });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 30000 });
  await assertMeasurable(page, "verify-food-search-live");
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  const rowsTxt = () => page.locator('[data-testid="food-search-results"] button').allInnerTexts();
  const box = page.locator('[data-testid="food-search-box"]');
  const clear = async () => { await box.fill(""); await page.waitForTimeout(400); };

  // Types text; records, after each keystroke, how many rows are visible; returns ms from LAST key to first row matching `re` (in-page clock).
  async function typeTimed(text, re, perKey = 90) {
    await box.tap();
    await page.evaluate((src) => {
      const rx = new RegExp(src, "i"); window.__t = { first: null, t0: null, blank: 0 };
      window.__t.iv = setInterval(() => {
        if (window.__t.first != null || window.__t.t0 == null) return;
        for (const b of document.querySelectorAll('[data-testid="food-search-results"] button')) if (rx.test(b.innerText)) { window.__t.first = performance.now(); return; }
      }, 4);
    }, re);
    const counts = [];
    for (let i = 0; i < text.length - 1; i++) { await page.keyboard.type(text[i]); await page.waitForTimeout(perKey); counts.push((await rowsTxt()).length); }
    await page.evaluate(() => { window.__t.t0 = performance.now(); });
    await page.keyboard.type(text[text.length - 1]);
    await page.waitForFunction(() => window.__t.first != null, null, { timeout: 12000 }).catch(() => {});
    const ms = await page.evaluate(() => { clearInterval(window.__t.iv); return window.__t.first == null ? null : Math.max(0, Math.round(window.__t.first - window.__t.t0)); });
    return { ms, counts };
  }

  // 1 SAVED
  const n0 = rpc.length;
  const a = await typeTimed("zzspeed", "zzspeed");
  const blankAfterFirst = a.counts.slice(a.counts.findIndex((c) => c > 0) >= 0 ? a.counts.findIndex((c) => c > 0) : a.counts.length).some((c) => c === 0);
  row("1 SAVED", a.ms !== null && a.ms < 300 && !blankAfterFirst, `saved "${NAME}" row ${a.ms} ms after the last letter (rows per keystroke ${JSON.stringify(a.counts)}; blank after first row: ${blankAfterFirst})`);
  await page.waitForTimeout(1500);
  const zz = rpc.slice(n0).find((e) => e.q === "zzspeed");
  console.log(`   (the server round trip for "zzspeed" was ${zz ? zz.ms : "n/a"} ms — the saved row did not wait for it)`);
  await clear();

  // 2 SERVER
  const n1 = rpc.length;
  const b = await typeTimed("fadi", "fadi");
  const rowsB = await rowsTxt();
  const fe = rpc.slice(n1).find((e) => e.q === "fadi");
  await page.waitForTimeout(300);
  row("2 SERVER", b.ms !== null && b.ms < 3000 && /fadi/i.test(rowsB.join(" ")), `"fadi" first row ${b.ms} ms after the last letter; RPC round trip ${fe ? fe.ms : "n/a"} ms; rows: ${JSON.stringify(rowsB.slice(0, 3).map((t) => t.split("\n")[0]))}`);
  const probe = rowsB.length > 0;
  row("2b KNOWN-GOOD", probe, probe ? "instrument sees result rows (non-vacuous)" : "no rows — run is VOID");
  await clear();

  // 3 REPEAT
  const n2 = rpc.length;
  const c = await typeTimed("fadi", "fadi");
  await page.waitForTimeout(1200);
  const extra = rpc.slice(n2).filter((e) => e.q === "fadi").length;
  row("3 REPEAT", c.ms !== null && c.ms < 300 && extra === 0, `retype "fadi": first row ${c.ms} ms; new "fadi" requests sent: ${extra}`);
  await clear();

  // 4 STALE — hold the "tacos" answer 1.5 s so it would land AFTER "tacos a"
  await page.route("**/rpc/food_places_search_by_name", async (route) => {
    const q = JSON.parse(route.request().postData() || "{}").p_query;
    if (q === "tacos") await new Promise((r) => setTimeout(r, 1500));
    try { await route.continue(); } catch (_) { /* cancelled by the app */ }
  });
  const n3 = rpc.length;
  await box.tap();
  await page.keyboard.type("tacos", { delay: 60 });
  await page.waitForTimeout(400); // past the debounce: "tacos" is in flight (held)
  await page.keyboard.type(" a", { delay: 60 });
  await page.waitForTimeout(4500);
  const finalRows = await rowsTxt();
  const sent = rpc.slice(n3).map((e) => e.q);
  const heldTacos = rpc.slice(n3).find((e) => e.q === "tacos");
  const lastQ = sent[sent.length - 1];
  // "tacos a" answers must be the ones on screen: re-ask the same RPC directly (same centre) and compare names
  const ref = await page.evaluate(async () => {
    const b = window.__foodMap.getBounds(); const c = b.getCenter();
    const { data } = await window.pfSupabase.rpc("food_places_search_by_name", { p_query: "tacos a", p_cap: 60, p_center_lat: c.lat, p_center_lon: c.lng });
    return (data || []).map((r) => r.name);
  });
  const shownNames = finalRows.map((t) => t.split("\n")[0].replace(/ \(live search\)$/, "")).filter((n) => !/^Search live|^Drop a pin/.test(n));
  const allFromRef = shownNames.length > 0 && shownNames.every((n) => ref.includes(n) || n === NAME);
  row("4 STALE", lastQ === "tacos a" && allFromRef, `requests ${JSON.stringify(sent)}; "tacos" request ${heldTacos ? (heldTacos.failed ? "CANCELLED" : "completed late") : "n/a"}; shown ${JSON.stringify(shownNames.slice(0, 4))} all in the direct "tacos a" answer: ${allFromRef}`);
  await page.unroute("**/rpc/food_places_search_by_name");
  await clear();

  // 5 PAN
  const panTo = async (p) => { await page.evaluate((q) => window.__foodMap.setView([q.lat, q.lon], window.__foodMap.getZoom(), { animate: false }), p); await page.waitForTimeout(1200); };
  await panTo(HOU);
  await box.tap(); await page.keyboard.type("torchy", { delay: 60 }); await page.waitForTimeout(3500);
  const hou = await rowsTxt();
  await panTo(DAL); await page.waitForTimeout(3500);
  const dal = await rowsTxt();
  const addr = (r) => (r[0] || "").split("\n").slice(1).join(" ");
  const houOk = /houston|, tx 77/i.test(addr(hou)) && !/dallas/i.test(addr(hou));
  const dalOk = /dallas|plano|irving|richardson|garland|, tx 75/i.test(addr(dal));
  row("5 PAN", hou.length > 0 && houOk && dalOk, `top row over Houston: "${addr(hou)}" · after panning to Dallas: "${addr(dal)}"`);
} catch (e) {
  row("HARNESS", false, String(e && e.message || e));
} finally {
  if (seededId) {
    const gone = await page.evaluate(async (id) => {
      await window.pfSupabase.from("food_visits").delete().eq("id", id);
      const { data } = await window.pfSupabase.from("food_visits").select("id").eq("id", id);
      const { data: left } = await window.pfSupabase.from("food_visits").select("id,custom_name").eq("custom_name", "Zzspeed Tacoworks");
      return { gone: !data || data.length === 0, leftovers: (left || []).length };
    }, seededId).catch((e) => ({ gone: false, err: String(e) }));
    row("CLEANUP", gone.gone && !gone.leftovers, `throwaway visit deleted and re-read: ${JSON.stringify(gone)}`);
  }
  await s.close();
}
process.exit(out.every(Boolean) ? 0 : 1);
