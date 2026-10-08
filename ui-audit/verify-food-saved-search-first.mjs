/* verify-food-saved-search-first (V1493760 / B2070432) — signed in as the throwaway test account on a real
 * deploy: seed a few of ITS OWN visits at real snapshot places, then check the Food Map search puts each saved
 * place first, tagged, exactly once, at a Houston-wide view and a zoomed-in view elsewhere. Seeds are tagged and
 * ALWAYS deleted (finally). Never touches the owner's list. Usage: node ui-audit/verify-food-saved-search-first.mjs https://planyr.io */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const TAG = "V1493760 throwaway";
const HOUSTON = [[29.5, -95.8], [30.1, -95.0]];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
let uid = null;
try {
  console.log("build", JSON.stringify(s.build), "signed in as", s.proof.email);
  await page.goto(`${base}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-search-box"]', { timeout: 40000 });
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
  await assertMeasurable(page, "verify-food-saved-search-first");
  const live = await page.evaluate(async () => ({ v: await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()), chunks: performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /food/i.test(n)).slice(0, 3) }));
  console.log("same-call build", JSON.stringify(live));

  // ---- seed: pick real snapshot places by RPC (read-only), insert the test account's own visits ----
  const seeds = await page.evaluate(async (tag) => {
    const sb = window.pfSupabase;
    const { data: au } = await sb.auth.getUser();
    const uid = au.user.id;
    const rpc = async (q, cap) => (await sb.rpc("food_places_search_by_name", { p_query: q, p_cap: cap, p_center_lat: 29.8, p_center_lon: -95.4 })).data || [];
    const pick = {};
    // DAO'N: the zip+4 record (id fixed from the 2026-10-04 read of the snapshot), fallback to any 9861 Long Point record.
    const daonAll = (await rpc("daon", 60)).filter((r) => /dao'n/i.test(r.name));
    pick.daon = daonAll.find((r) => r.id === "cce4349a-a4ba-4977-aa22-17c395e1e682") || daonAll.find((r) => /77055-4107/.test(r.address || "")) || daonAll[0];
    pick.captain = (await rpc("Captain Tom", 60)).find((r) => /katy/i.test(r.address || ""));
    const pool = new Set((await rpc("roadhouse", 60)).map((r) => r.id));
    const all = await rpc("roadhouse", 200);
    pick.roadhouse = all.find((r) => /texas roadhouse/i.test(r.name) && !pool.has(r.id)) || null;
    pick.roadhouseOutsidePool = !!pick.roadhouse;
    pick.roadhouse = pick.roadhouse || all.find((r) => /texas roadhouse/i.test(r.name));
    const et = await rpc("el tiempo", 60);
    pick.cantina = et.find((r) => /cantina/i.test(r.name));
    pick.taqueria = et.find((r) => /taqueria/i.test(r.name));
    pick.soma = (await rpc("soma", 20)).find((r) => /soma sushi/i.test(r.name));
    pick.tio = (await rpc("tio trompo", 20))[0];
    pick.ikes = (await rpc("ikes", 20)).find((r) => /ike/i.test(r.name));
    const ids = Object.entries(pick).filter(([, v]) => v && v.id).map(([k, v]) => [k, v.id]);
    const rows = ids.map(([, id]) => ({ user_id: uid, place_id: id, visited_on: "2026-01-01", rating: 7, notes: tag }));
    const { error } = await sb.from("food_visits").insert(rows);
    return { uid, error: error ? String(error.message) : null, ids: Object.fromEntries(ids), outside: pick.roadhouseOutsidePool, names: Object.fromEntries(Object.entries(pick).filter(([, v]) => v && v.name).map(([k, v]) => [k, v.name + " | " + v.address])) };
  }, TAG);
  uid = seeds.uid;
  // PRECONDITION: every case must actually be seeded, or the run is VOID rather than scored.
  for (const k of ["daon", "captain", "roadhouse", "cantina", "taqueria", "soma", "tio", "ikes"]) if (!seeds.ids[k]) throw new Error("VOID: could not seed " + k);
  console.log("seeded", JSON.stringify(seeds.names), seeds.error || "");
  if (seeds.error) throw new Error("seed insert failed: " + seeds.error);
  console.log("roadhouse seed lies OUTSIDE the capped 60-row pool:", seeds.outside);

  // reload so Food loads the seeded visits
  await page.goto(`${base}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-search-box"]');
  await page.waitForFunction(() => !!window.__foodMap, null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const setView = (v) => page.evaluate((v) => { const m = window.__foodMap; if (v === "houston") m.fitBounds([[29.5, -95.8], [30.1, -95.0]], { animate: false }); else m.setView([32.78, -96.8], 13, { animate: false }); }, v);
  const rowsFor = async (q) => {
    const box = page.getByTestId("food-search-box");
    await box.fill(""); await box.fill(q);
    await page.waitForFunction(() => { const r = document.querySelector('[data-testid="food-search-results"]'); return r && !/Searching…/.test(r.innerText) && r.querySelectorAll("button").length > 0; }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    return page.evaluate(() => [...document.querySelectorAll('[data-testid="food-search-results"] button')].map((b) => {
      const spans = b.querySelectorAll("span > span");
      return { name: spans[0]?.innerText || "", addr: spans[1]?.innerText || "", mine: /been here/i.test(b.innerText), text: b.innerText.replace(/\n/g, " | ") };
    }));
  };

  const cases = [
    { q: "daon", saved: [/dao'n/i], once: /dao'n/i },
    { q: "Captain Tom", saved: [/captain tom/i], onlyFirst: 1 },
    { q: "Roadhouse", saved: [/texas roadhouse/i] },
    { q: "El Tiempo", saved: [/cantina/i, /taqueria/i] },
    { q: "soma", saved: [/soma sushi/i] },
    { q: "tio trompo", saved: [/trompo/i] },
    { q: "ikes", saved: [/ike/i] },
  ];
  for (const view of ["houston", "dallas"]) {
    await setView(view);
    await page.waitForTimeout(600);
    for (const c of cases) {
      const rows = await rowsFor(c.q);
      const n = c.saved.length;
      const lead = rows.slice(0, n);
      const okLead = rows.length >= n && lead.every((r) => r.mine) && c.saved.every((re) => lead.some((r) => re.test(r.name)));
      check(`[${view}] "${c.q}": saved place(s) lead, tagged`, okLead, rows.slice(0, 3).map((r) => `${r.name}${r.mine ? " ✔" : ""}`).join(" ; "));
      if (c.once) check(`[${view}] "${c.q}": appears exactly once`, rows.filter((r) => c.once.test(r.name)).length === 1, String(rows.filter((r) => c.once.test(r.name)).length));
      const keys = rows.map((r) => r.name.toLowerCase() + "|" + r.addr.toLowerCase().replace(/-\d{4}\b/, ""));
      check(`[${view}] "${c.q}": no row repeated (same name + address)`, new Set(keys).size === keys.length);
    }
  }

  // Map -> List -> Map: no _leaflet_pos error
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.getByTestId("food-search-box").fill("");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: /^list$/i }).first().click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: /^map$/i }).first().click();
    await page.waitForTimeout(900);
  }
  check("Map→List→Map ×4: no _leaflet_pos error", !errs.some((e) => /_leaflet_pos/.test(e)), errs.join(" | ").slice(0, 200));
} finally {
  if (uid) {
    const del = await page.evaluate(async (tag) => { const { error, count } = await window.pfSupabase.from("food_visits").delete({ count: "exact" }).eq("notes", tag); return { error: error ? String(error.message) : null, count }; }, TAG).catch((e) => ({ error: String(e) }));
    const left = await page.evaluate(async (tag) => (await window.pfSupabase.from("food_visits").select("id", { count: "exact", head: true }).eq("notes", tag)).count, TAG).catch(() => "?");
    console.log("cleanup", JSON.stringify(del), "remaining seeded rows:", left);
  }
  await s.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
