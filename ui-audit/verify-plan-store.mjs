#!/usr/bin/env node
/* verify-plan-store — the REAL-BROWSER proof of B2165120 + B2200384: each plan has its own device-storage slot, the move to it is lossless, the
 * whole-library entry is REMOVED afterwards (and never written again), an edit writes only that plan, an older tab's write is folded in per plan and
 * removed, and a reload keeps every edit. The unit half (every failure path, forced, mutation-proven) is test/planStore.test.js; the per-edit COST sweep
 * is ui-audit/perf-plan-store-scaling.mjs. This drives the shipped bundle.
 *
 *   local, signed out (needs a built app: npm run build && npx vite preview --port 4173):
 *     xvfb-run -a node ui-audit/verify-plan-store.mjs                       [--plans 60]
 *     xvfb-run -a node ui-audit/verify-plan-store.mjs --retire              the PREVIOUS build's device (per-plan entries + a mirrored legacy entry + ledger) is retired
 *     xvfb-run -a node ui-audit/verify-plan-store.mjs --tight               a real filled localStorage the old all-at-once split would have REFUSED: every plan moves one at a time
 *   live, signed in as the throwaway test account (E2E_LOGIN_KEY; never print it) — V1619488 steps 1-3 for the per-plan layout:
 *     node ui-audit/verify-plan-store.mjs --live https://planyr.io [--plans 60]
 *
 * LIVE NOTE. The seeded filler plans are written into the TEST ACCOUNT's local cache and the app (correctly) heals them up to its cloud
 * rows. They are all named `zzpsv-*`; the run prints the id list, and the session that ran it deletes them afterwards (CLAUDE.md constraint 15)
 * and verifies they are gone. The two standing fixtures (e2e-fixture-site and its sibling) are never touched.
 *
 * Each step prints PASS/FAIL with the observation. Exit 1 on any FAIL. A step that cannot run says VOID, never PASS.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const LIVE = argOf("--live", "");
const RETIRE = process.argv.includes("--retire"), TIGHT = process.argv.includes("--tight");
const BASE = (LIVE || process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const N = Number(argOf("--plans", 60));
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok === null ? "VOID" : ok ? "PASS" : "FAIL"}  ${name}${detail ? "  —  " + detail : ""}`); };

/* Page-side helper: read the store the way an OLD build or a human would — from raw localStorage. */
const snapshot = (page) => page.evaluate(() => {
  let base = "planarfit:sites:v1";
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("planarfit:sites:cloud:") && !/:(p:|idx$|led$)/.test(k.slice("planarfit:sites:cloud:".length))) base = k; }
  const entries = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(base + ":p:")) entries[k.slice((base + ":p:").length)] = (globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k); }
  let idx = null; try { idx = JSON.parse(localStorage.getItem(base + ":idx")); } catch (_) {}
  const legacyRaw = (globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(base);
  const ledgerRaw = localStorage.getItem(base + ":led");
  let fillerLen = (localStorage.getItem("planarfit:settings:other") || "").length;
  let legacy = null; try { legacy = JSON.parse(legacyRaw); } catch (_) {}
  return { base, entries, idx, legacyLen: legacyRaw ? legacyRaw.length : 0, legacyIds: legacy ? Object.keys(legacy) : null, legacyRaw, ledgerRaw, fillerLen };
});

/* A realistic library: a few big plans (like his 0.94 MB one, scaled down) and many tiny ones (his median is 1.9 KB). */
const makeLibrary = (n) => {
  const lib = {};
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const big = i % 20 === 0;
    const els = []; for (let k = 0; k < (big ? 400 : 3); k++) els.push({ id: `e${i}-${k}`, type: "building", cx: k * 40, cy: i * 3, w: 120, h: 60, rot: 0 });
    lib[`zzpsv-${i}`] = { id: `zzpsv-${i}`, groupId: `zzpsv-g${i % 9}`, site: `ZZ PSV project ${i % 9}`, name: `Plan ${i}`, status: "pursuit", role: "pursuit", origin: null, updatedAt: now - 100000 + i, parcels: [], els, measures: [], callouts: [], markups: [], settings: {} };
  }
  return lib;
};

let browser, context, page, signedIn = null;
try {
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    signedIn = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 }, });
    ({ browser, context, page } = signedIn);
    console.log(`build ${JSON.stringify(signedIn.build)}  signed in as ${signedIn.proof.email}`);
  } else {
    browser = await chromium.launch({ executablePath: EXEC, headless: false, args: ["--no-sandbox"] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => { window.__PLANYR_E2E = true; });
    page = await context.newPage();
    await page.goto(BASE + "/", { waitUntil: "load" });
  }
  await assertMeasurable(page, "verify-plan-store");
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));

  /* ── 0. put the device into the shape under test ──────────────────────────────────────────────────────────────────────────────── */
  await page.goto(BASE + "/version.json", { waitUntil: "load" });         // the app is not running here, so nothing races the seed
  const lib = makeLibrary(N);
  const BASEKEY = "planarfit:sites:v1";
  const measureCap = () => page.evaluate(() => {
    localStorage.clear();
    let cap = 0; try { for (;;) { localStorage.setItem("probe" + (cap / 100000), "a".repeat(100000)); cap += 100000; if (cap > 9e6) break; } } catch (_) {}
    let extra = 0; try { for (;;) { localStorage.setItem("probeZ", "a".repeat(extra + 1000)); extra += 1000; } } catch (_) {}
    cap += extra; localStorage.clear(); return cap;
  });
  let seeded, cap = null, maxEntry = 0, filler = 0;
  if (TIGHT) {
    /* A REAL filled localStorage: the whole library as one entry (~2.0M characters, like the owner's device), then filler up to within ~1.3 plan entries of this
     * browser's measured cap. The all-at-once split of B2165120 needed the library's size AGAIN beside the original and was refused on every load here. */
    cap = await measureCap();
    console.log(`measured this browser's localStorage cap: ${cap} characters`);
    /* THE PREMISE OF THE WHOLE MOVE, measured in this engine before relying on it: with the store FULL, replacing a key's value with a SMALLER string is accepted
     * (no extra room), and replacing it with a LARGER one is refused. */
    const shrink = await page.evaluate((cap) => {
      localStorage.clear();
      let used = 0; const put = (k, n) => { localStorage.setItem(k, "a".repeat(n)); };
      put("probeA", cap - "probeA".length - "probeB".length - 1000); put("probeB", 1000);
      let atCap = false; try { put("probeB", 1000 + 3000); atCap = false; } catch (_) { atCap = true; }   // (the cap was measured to within 1000 characters)
      let shrinkOk = false; try { put("probeA", 1000); shrinkOk = true; } catch (_) { shrinkOk = false; }
      localStorage.clear(); return { atCap, shrinkOk };
    }, cap);
    step("real engine: at the cap a BIGGER value is refused, a SMALLER rewrite of a key is accepted (what the plan-by-plan move relies on)", shrink.atCap && shrink.shrinkOk, JSON.stringify(shrink));
    const big = {}; const per = Math.floor(2_000_000 / N);
    for (const [id, r] of Object.entries(lib)) big[id] = { ...r, pad: "x".repeat(per) };
    Object.assign(lib, big);
    const text = JSON.stringify(lib);
    maxEntry = Math.max(...Object.values(lib).map((r) => JSON.stringify(r).length + BASEKEY.length + 6));
    seeded = await page.evaluate(({ BASEKEY, text, cap, maxEntry }) => {
      localStorage.clear();
      localStorage.setItem(BASEKEY, text);
      let used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + (globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k).length; }
      const want = cap - used - Math.floor(maxEntry * 1.3);
      const key = "planarfit:settings:other";
      if (want > key.length) localStorage.setItem(key, "z".repeat(want - key.length));
      used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + (globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k).length; }
      return { base: BASEKEY, plans: Object.keys(JSON.parse(text)).length, len: text.length, text, used, fillerLen: ((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(key) || "").length };
    }, { BASEKEY, text, cap, maxEntry });
    filler = seeded.fillerLen;
    const oldNeed = seeded.len + seeded.plans * (BASEKEY.length + 12) + 600 + 250000;
    step("tight seed reached the intended fill (free room ≈ 1.3 plan entries)", Math.abs(cap - seeded.used - Math.floor(maxEntry * 1.3)) < 3000 ? true : null, `used ${seeded.used} of ${cap}; biggest plan entry ${maxEntry}`);
    step("the OLD all-at-once split would have REFUSED this device (main: plan-store-migration-aborted, reason headroom)", seeded.used + oldNeed > cap, `it needed ${oldNeed} more, the device has ${cap - seeded.used}`);
  } else if (RETIRE) {
    /* The PREVIOUS build's device: one entry per plan + an index (no legacyRetired) + the legacy entry kept as a mirror + its ledger. */
    seeded = await page.evaluate(({ BASEKEY, library }) => {
      localStorage.clear();
      const text = JSON.stringify(library);
      for (const [id, r] of Object.entries(library)) localStorage.setItem(BASEKEY + ":p:" + id, JSON.stringify(r));
      localStorage.setItem(BASEKEY + ":idx", JSON.stringify({ v: 1, ok: true, gen: "prev-build", stale: false, mig: { at: 1, count: Object.keys(library).length, len: text.length, ms: 1 } }));
      localStorage.setItem(BASEKEY, text);
      localStorage.setItem(BASEKEY + ":led", JSON.stringify({ sig: "old:1", len: text.length, ids: Object.keys(library), at: 1 }));
      return { base: BASEKEY, plans: Object.keys(library).length, len: text.length, text };
    }, { BASEKEY, library: lib });
    console.log(`seeded the PREVIOUS build's layout: ${seeded.plans} per-plan entries + a ${(seeded.len / 1000).toFixed(0)} KB mirrored legacy entry + ledger`);
  } else {
    seeded = await page.evaluate((library) => {
      let base = "planarfit:sites:v1";
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("planarfit:sites:cloud:") && !/:(p:|idx$|led$)/.test(k.slice("planarfit:sites:cloud:".length))) base = k; }
      const existing = {};
      const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      for (const k of keys) if (k && k.startsWith(base + ":p:")) { try { existing[k.slice((base + ":p:").length)] = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k)); } catch (_) {} }
      try { Object.assign(existing, JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(base) || "{}")); } catch (_) {}
      const whole = { ...existing, ...library };
      for (const k of keys) if (k && (k.startsWith(base + ":p:") || k === base + ":idx" || k === base + ":led")) localStorage.removeItem(k);
      const text = JSON.stringify(whole);
      localStorage.setItem(base, text);
      return { base, plans: Object.keys(whole).length, len: text.length, text };
    }, lib);
    console.log(`seeded the old layout: ${seeded.plans} plans, ${(seeded.len / 1000).toFixed(0)} KB in ONE entry (${seeded.base.replace(/cloud:.+/, "cloud:<uid>")})`);
  }

  /* ── 1. first load of the new build ──────────────────────────────────────────────────────────────────────────────────────────── */
  const t0 = Date.now();
  await page.goto(BASE + "/#/project/" + (LIVE ? "e2e-fixture-site" : "zzpsv-g1") + "/site", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  // the move may run in slices on a tight device: wait for it to finish (the legacy entry disappearing is its last act)
  let s1 = await snapshot(page);
  for (let i = 0; i < 80 && (s1.legacyRaw !== null || !(s1.idx && !s1.idx.migrating)); i++) { await page.waitForTimeout(400); s1 = await snapshot(page); }
  const ids1 = Object.keys(s1.entries);
  step("every plan has its own entry and the index says the legacy entry is retired", !!(s1.idx && s1.idx.v === 1 && s1.idx.ok && s1.idx.legacyRetired && !s1.idx.migrating) && ids1.length >= seeded.plans, `index ${JSON.stringify(s1.idx && { mig: s1.idx.mig, legacyRetired: s1.idx.legacyRetired, migrating: s1.idx.migrating })}, ${ids1.length} entries for ${seeded.plans} plans, ${Date.now() - t0} ms`);
  step("THE WHOLE-LIBRARY ENTRY IS GONE (and its ledger)", s1.legacyRaw === null && s1.ledgerRaw === null, `legacy ${s1.legacyRaw === null ? "absent" : s1.legacyLen + " chars"}; ledger ${s1.ledgerRaw === null ? "absent" : "present"}`);
  const lossless = Object.keys(lib).every((id) => { try { return JSON.stringify(JSON.parse(s1.entries[id])) === JSON.stringify(lib[id]); } catch (_) { return false; } });
  step("lossless: every seeded plan's entry equals the plan that was seeded", lossless);
  if (TIGHT) {
    const free = await page.evaluate(() => { let used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + (globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k).length; } return used; });
    // A plan-by-plan move cannot CREATE room (entries hold the same text the legacy entry did); what matters is it needed none and lost none beyond the entries' own key names.
    step("tight: the filler on the device was not touched, and the move cost the device no room beyond the entries' key names", s1.fillerLen === filler && (cap - seeded.used) - (cap - free) < 12000, `free before ${cap - seeded.used}, after ${cap - free}`);
  }
  if (RETIRE) step("retire: the previous build's mirrored legacy entry and ledger were removed with every plan intact", s1.legacyRaw === null && s1.ledgerRaw === null && ids1.length === seeded.plans, `${ids1.length} entries`);

  /* ── 2. an edit writes ONLY that plan ───────────────────────────────────────────────────────────────────────────────────────── */
  await page.evaluate(() => {
    window.__w = [];
    const SI = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (typeof k === "string" && k.startsWith("planarfit:sites:") && !k.includes(":history:") && !k.includes(":deltomb:")) window.__w.push([k, String(v).length]); return SI.call(this, k, v); };
  });
  const before = await snapshot(page);
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const x0 = box.x + box.width * 0.58, y0 = box.y + box.height * 0.28, x1 = box.x + box.width * 0.76, y1 = box.y + box.height * 0.44;
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(2500);
  const after = await snapshot(page);
  const writes = await page.evaluate(() => window.__w.slice());
  const planKeys = [...new Set(writes.map(([k]) => k))];
  const changed = Object.keys(after.entries).filter((id) => after.entries[id] !== before.entries[id]);
  step("exactly ONE plan's entry changed", changed.length === 1, `changed: ${changed.join(", ") || "none"}`);
  const biggest = Math.max(0, ...writes.map(([, n]) => n));
  const libChars = Object.values(after.entries).reduce((n, t) => n + t.length, 0);
  step("the edit never wrote the whole library — no write to the legacy key at all", biggest < 0.6 * libChars && !writes.some(([k]) => k === before.base), `${writes.length} writes to ${planKeys.map((k) => k.replace(before.base, "<store>")).join(" · ")}; largest ${(biggest / 1000).toFixed(1)} KB vs a ${(libChars / 1000).toFixed(0)} KB library`);
  step("no legacy entry exists after the edit", after.legacyRaw === null);

  /* ── 3. reload: the edit persisted ──────────────────────────────────────────────────────────────────────────────────────────── */
  const editedId = changed[0];
  const elCount = (raw) => { try { return (JSON.parse(raw).els || []).length; } catch (_) { return -1; } };
  const oldCount = editedId ? elCount(before.entries[editedId]) : -1, newCount = editedId ? elCount(after.entries[editedId]) : -1;
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const s3 = await snapshot(page);
  step("reload: the edit is still in that plan's entry", editedId && elCount(s3.entries[editedId]) === newCount && newCount > oldCount, `elements ${oldCount} → ${newCount} → (after reload) ${editedId ? elCount(s3.entries[editedId]) : "?"}`);
  const featuresOnCanvas = await page.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="el:"]')].map((n) => n.getAttribute("data-feature"))).size);
  step("reload: the canvas shows the elements", featuresOnCanvas > 0, `${featuresOnCanvas} elements on the canvas`);

  /* ── 4. leaving the tab writes nothing to the legacy key (there is no mirror any more) ──────────────────────────────────────── */
  await page.goto(BASE + "/version.json", { waitUntil: "load" });         // pagehide on the app page
  const s4 = await snapshot(page);
  step("leaving the tab did not recreate a whole-library entry", s4.legacyRaw === null, `legacy ${s4.legacyRaw === null ? "absent" : s4.legacyLen + " chars"}`);

  /* ── 5. an OLDER build's write (not on the tight device: its whole-library write is exactly what no room exists for) */
  if (TIGHT) step("mixed builds (not exercised on the tight device)", null, "an older tab's multi-MB write has nowhere to go on a device with ~100 KB free");
  else {
  /* an OLDER build's write (whole legacy entry, while no new-build tab is open) is folded in per plan on the next load, then removed ─ */
  const victim = `zzpsv-${Math.min(5, N - 1)}`;
  await page.evaluate(({ victim }) => {
    let base = "planarfit:sites:v1";
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("planarfit:sites:cloud:") && !/:(p:|idx$|led$)/.test(k.slice("planarfit:sites:cloud:".length))) base = k; }
    const all = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(base + ":p:")) { try { all[k.slice((base + ":p:").length)] = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k)); } catch (_) {} } }
    all[victim] = { ...all[victim], name: "renamed by an OLD build", updatedAt: Date.now() + 10000 };
    all["zzpsv-from-old-build"] = { id: "zzpsv-from-old-build", groupId: "zzpsv-from-old-build", site: "ZZ PSV old-build project", name: "Created by an old build", updatedAt: Date.now(), els: [], parcels: [], measures: [], callouts: [], markups: [], settings: {} };
    localStorage.setItem(base, JSON.stringify(all));
  }, { victim });
  await page.goto(BASE + "/#/project/" + (LIVE ? "e2e-fixture-site" : "zzpsv-g1") + "/site", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const s5 = await snapshot(page);
  const nameOf = (raw) => { try { return JSON.parse(raw).name; } catch (_) { return null; } };
  step("mixed builds: the older build's rename was adopted", nameOf(s5.entries[victim]) === "renamed by an OLD build", `${victim}: "${nameOf(s5.entries[victim])}"`);
  step("mixed builds: the plan the older build created was adopted", !!s5.entries["zzpsv-from-old-build"]);
  step("mixed builds: this build's earlier edit was NOT reverted", editedId && elCount(s5.entries[editedId]) === newCount, `${editedId}: ${editedId ? elCount(s5.entries[editedId]) : "?"} elements`);
  step("mixed builds: the older build's whole-library entry was folded in and removed again", s5.legacyRaw === null);
  }

  /* ── 6. nothing threw ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  step("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  /* ── 7. two tabs of one browser (signed out only: a signed-in tab converges through the element rows instead) ────────────────── */
  if (!LIVE && !TIGHT) {
    const b = await context.newPage();
    await b.goto(BASE + "/#/project/zzpsv-g1/site", { waitUntil: "load" });
    await b.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
    await b.waitForTimeout(1500);
    const bBefore = await b.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="el:"]')].map((n) => n.getAttribute("data-feature"))).size);
    const box2 = await page.locator('[data-testid="planner-canvas"]').boundingBox();
    await page.bringToFront();
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    const ax = box2.x + box2.width * 0.20, ay = box2.y + box2.height * 0.60;
    await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(ax + 80, ay + 50, { steps: 6 }); await page.mouse.up();
    let bAfter = bBefore;
    for (let i = 0; i < 16 && bAfter === bBefore; i++) { await b.waitForTimeout(250); bAfter = await b.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="el:"]')].map((n) => n.getAttribute("data-feature"))).size); }
    step("two tabs: an edit in tab A reaches tab B live through the per-plan entry's storage event", bAfter > bBefore, `tab B elements ${bBefore} → ${bAfter}`);
    /* …and an OLDER build's whole-entry write in one tab is folded in by the other through the REAL storage event (no reload, no focus). */
    const victimB = "zzpsv-" + Math.min(7, N - 1);
    await page.evaluate((v) => { const all = JSON.parse(globalThis.__planyrSitesRaw("planarfit:sites:v1")); all[v] = { ...all[v], name: "renamed by an OLD build in the other tab", updatedAt: Date.now() + 20000 }; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, victimB);
    let seen = null;
    for (let i = 0; i < 20 && seen !== "renamed by an OLD build in the other tab"; i++) { await b.waitForTimeout(250); seen = await b.evaluate((v) => { try { return JSON.parse(localStorage.getItem("planarfit:sites:v1:p:" + v)).name; } catch (_) { return null; } }, victimB); }
    step("two tabs: an older build's write to the legacy entry is folded into the per-plan entry by the other tab's storage event", seen === "renamed by an OLD build in the other tab", `${victimB} in tab B: "${seen}"`);
    await b.close();
  } else step("two tabs (signed-out, non-tight only)", null, "a signed-in tab converges through the element rows — not exercised here");

  console.log(`\nseeded plan ids to delete from the test account: zzpsv-0 … zzpsv-${N - 1}, zzpsv-from-old-build`);
} catch (e) {
  step("script ran to completion", false, String(e && e.stack || e).split("\n").slice(0, 4).join(" | "));
} finally { if (browser) await browser.close(); }
const bad = results.filter((r) => r.ok === false).length;
console.log(`\n${results.length} checks, ${bad} failed, ${results.filter((r) => r.ok === null).length} void`);
process.exit(bad ? 1 : 0);
