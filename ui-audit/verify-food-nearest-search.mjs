#!/usr/bin/env node
/* verify-food-nearest-search — V1469824 (B2051664): the Food search lists the places nearest the VISIBLE MAP first (a bias,
 * never a filter). SIGNED IN as the test account on a real deploy (shared helper), Chromium DESKTOP, labelled as such —
 * the phone steps' physical finger / Safari toolbar stay a real-device matter (this proves the ordering logic and the
 * data path, which are identical on a phone).
 *
 * DATA: one throwaway MANUAL-PIN visit on the TEST account (notes ZZ-E2E-THROWAWAY) so "a saved place far off screen" exists;
 * written and deleted through the page's own client (RLS = that account), cleanup PROVES it is gone (owner rule 15). Nothing
 * on Michael's account or list is ever touched.
 *
 * KNOWN-ANSWER ARMS (DRIVER-SCROLL §6): ground truth for the ORDER comes from the same RPC called a second way (coordinates the
 * dropdown does not show), and the order check is first pointed at a pair of rows whose order is known to be WRONG
 * (reversed) and must report a violation — else the run is VOID.
 *
 * Usage: node ui-audit/verify-food-nearest-search.mjs [https://planyr.io] (needs E2E_LOGIN_KEY) */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "https://planyr.io").replace(/\/$/, "");
const MARK = "ZZ-E2E-THROWAWAY";
const KATY = [29.7858, -95.8245], DALLAS = [32.7767, -96.797], HOUSTON_DAON = [29.7943, -95.5355];
const results = [];
const row = (id, ok, detail = "") => { results.push({ id, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/** Pure: does this sequence of {inView, km} obey "in-view first, then nearest the centre outward"? Returns the first violation or null. */
export function orderViolation(seq) {
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (!a.inView && b.inView) return `row ${i + 1} is in view but follows an off-screen row`;
    if (a.inView === b.inView && b.km + 0.25 < a.km) return `row ${i + 1} (${b.km.toFixed(1)} km) is nearer than row ${i} (${a.km.toFixed(1)} km)`;
  }
  return null;
}

const s = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 }, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
let exit = 0, seededId = null, baseline = new Set();
try {
  const page = s.page;
  page.setDefaultTimeout(10000);
  await page.goto(BASE + "/#/food", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
  await assertMeasurable(page, "verify-food-nearest-search");
  const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  console.log(`BUILD  ${BASE}  version.json=${JSON.stringify(ver)}  entry=${(await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.src.split("/").pop()).filter((n) => /^index-/.test(n)))).join(",")}`);
  row("0 PRECONDITION: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));

  const moveTo = async ([lat, lon], z = 13) => { await page.evaluate(([la, lo, zz]) => { window.__foodMap.setView([la, lo], zz, { animate: false }); }, [lat, lon, z]); await page.waitForTimeout(1500); };
  const box = page.locator('[data-testid="food-search-box"]');
  const rowsSel = '[data-testid="food-search-results"] button:not([data-testid])';
  const search = async (q) => {
    await box.fill(""); await page.waitForTimeout(300); await box.fill(q);
    await page.waitForFunction(() => { const r = document.querySelector('[data-testid="food-search-results"]'); return r && !/Searching/.test(r.innerText); }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return page.$$eval(rowsSel, (bs) => bs.map((b) => b.innerText.replace(/\s+/g, " ").trim()));
  };
  const view = () => page.evaluate(() => { const m = window.__foodMap, b = m.getBounds(), c = m.getCenter(); return { c: [c.lat, c.lng], south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() }; });
  const truth = (q, c) => page.evaluate(async ([qq, cc]) => (await window.pfSupabase.rpc("food_places_search_by_name", { p_query: qq, p_cap: 60, p_center_lat: cc[0], p_center_lon: cc[1] })).data || [], [q, c]);
  const seqFor = async (q, rows) => {
    const v = await view(), t = await truth(q, v.c);
    const sq = rows.map((txt) => { const hit = t.find((r) => txt.includes(r.address || "§§") && txt.startsWith(r.name)); return hit ? { inView: hit.lat >= v.south && hit.lat <= v.north && hit.lon >= v.west && hit.lon <= v.east, km: km(v.c, [hit.lat, hit.lon]), city: (hit.address || "").split(",")[1]?.trim() } : null; });
    return sq;
  };

  // known-answer arm: a deliberately REVERSED sequence must be flagged
  row("A KNOWN ANSWER: the order check flags a reversed pair and passes a right one", orderViolation([{ inView: true, km: 9 }, { inView: true, km: 1 }]) !== null && orderViolation([{ inView: true, km: 1 }, { inView: true, km: 9 }]) === null && orderViolation([{ inView: false, km: 1 }, { inView: true, km: 9 }]) !== null);

  // saved place, far away: a throwaway manual pin on the TEST account, in Houston
  baseline = new Set(await page.evaluate(async () => ((await window.pfSupabase.from("food_visits").select("id")).data || []).map((r) => r.id)));
  const seeded = await page.evaluate(async ([lat, lon, mark]) => {
    let uid = null;
    for (let i = 0; i < 40 && !uid; i++) { uid = (await window.pfSupabase.auth.getSession()).data.session?.user?.id || null; if (!uid) await new Promise((r) => setTimeout(r, 750)); }
    if (!uid) return { error: "no session" };
    const { data, error } = await window.pfSupabase.from("food_visits").insert({ user_id: uid, place_id: null, custom_name: "ZZ Throwaway Saucer", custom_lat: lat, custom_lon: lon, visited_on: "2026-10-01", rating: 8, notes: mark }).select("id").single();
    return { id: data && data.id, error: error ? String(error.message) : null };
  }, [HOUSTON_DAON[0], HOUSTON_DAON[1], MARK]);
  if (seeded.error) throw new Error("seed failed: " + seeded.error);
  seededId = seeded.id;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 45000 });
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });

  // 1 — a chain with branches in several cities, map on a Katy neighbourhood
  await moveTo(KATY);
  const w1 = await search("Whataburger");
  const seq1 = await seqFor("Whataburger", w1);
  const known1 = seq1.filter(Boolean);
  row("1 chain search: rows exist, the visible-area branches come first and nearest the centre first", w1.length >= 5 && known1.length >= 5 && orderViolation(known1.slice(0, 8)) === null, `${w1.length} rows; km ${known1.slice(0, 6).map((x) => x.km.toFixed(1)).join(", ")}; inView ${known1.slice(0, 6).map((x) => +x.inView).join("")}`);

  // 2 — pan to another city, retype: the order re-anchors
  await moveTo(DALLAS);
  const w2 = await search("Whataburger");
  const seq2 = (await seqFor("Whataburger", w2)).filter(Boolean);
  row("2 after panning to Dallas the same query re-ranks: Dallas-area branches lead, order still nearest-first", w2.length >= 5 && /Dallas|Plano|Irving|Garland|Richardson|Carrollton|Fort Worth|Arlington/i.test(w2[0]) && orderViolation(seq2.slice(0, 8)) === null, `first: ${w2[0]} ‖ km ${seq2.slice(0, 5).map((x) => x.km.toFixed(1)).join(", ")}`);

  // 3 — a saved restaurant far off screen, by exact name
  const sv = await search("ZZ Throwaway Saucer");
  row("3a the saved far-away place is the TOP row and carries the 'Been here' mark", sv.length >= 1 && /ZZ Throwaway Saucer/.test(sv[0]) && /Been here/i.test(sv[0]), sv.slice(0, 2).join(" ‖ "));
  await page.locator(rowsSel).first().click();
  await page.waitForTimeout(3000);
  const cc = (await view()).c;
  row("3b tapping it jumps the map there (Houston)", km(cc, HOUSTON_DAON) < 15, `centre ${cc.map((x) => x.toFixed(3))}`);

  // 4 — whole state in view
  await page.evaluate(() => { window.__foodMap.setView([31.2, -99.3], 6, { animate: false }); }); await page.waitForTimeout(1500);
  const w4 = await search("Whataburger");
  row("4 zoomed out to the whole state: results still appear", w4.length >= 5, `${w4.length} rows; first: ${w4[0]}`);

  // 5 — a name that only lives far away is still listed (not an empty list because it is off screen)
  await moveTo(KATY);
  const far = await search("Katy Trail Ice House");
  row("5 a match that exists only far off screen is still listed", far.length >= 1 && far.some((t) => /Katy Trail Ice House/i.test(t)), far.slice(0, 2).join(" ‖ "));
} catch (e) { console.log("ERROR " + (e && e.stack || e)); exit = 1; }
finally {
  try {
    const out = await s.page.evaluate(async ([id, base, mark]) => {
      const c = window.pfSupabase, errs = [];
      if (id) { const { error } = await c.from("food_visits").delete().eq("id", id); if (error) errs.push(String(error.message)); }
      const { data } = await c.from("food_visits").select("id").eq("notes", mark);
      for (const r of data || []) { const { error } = await c.from("food_visits").delete().eq("id", r.id); if (error) errs.push(String(error.message)); }
      const left = ((await c.from("food_visits").select("id")).data || []).map((r) => r.id);
      return { errs, left };
    }, [seededId, [...baseline], MARK]);
    const stray = out.left.filter((id) => !baseline.has(id));
    row("CLEANUP — the throwaway visit is deleted and re-read as gone", out.errs.length === 0 && stray.length === 0, `errors=${out.errs.length} strayRows=${stray.length}`);
  } catch (e) { row("CLEANUP — the throwaway visit is deleted and re-read as gone", false, String(e && e.message || e)); }
  await s.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass${failed ? ", " + failed + " FAIL" : ""}`);
process.exit(exit || (failed ? 1 : 0));
