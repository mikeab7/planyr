#!/usr/bin/env node
/* verify-plan-store — B2165120's REAL-BROWSER proof: each plan has its own device-storage slot, the migration copied without moving,
 * an edit writes only that plan, the legacy entry is kept (and refreshed off the edit path), an older build's write is folded in, and a
 * reload keeps every edit. The unit half (every failure path, forced) is test/planStore.test.js; the per-edit COST sweep is
 * ui-audit/perf-plan-store-scaling.mjs. This drives the shipped bundle.
 *
 *   local, signed out (needs a built app: npm run build && npx vite preview --port 4173):
 *     xvfb-run -a node ui-audit/verify-plan-store.mjs                       [--plans 60]
 *   live, signed in as the throwaway test account (E2E_LOGIN_KEY; never print it):
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
const BASE = (LIVE || process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const N = Number(argOf("--plans", 60));
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok === null ? "VOID" : ok ? "PASS" : "FAIL"}  ${name}${detail ? "  —  " + detail : ""}`); };

/* Page-side helper: read the store the way an OLD build or a human would — from raw localStorage. */
const snapshot = (page) => page.evaluate((BASEKEY) => {
  const base = BASEKEY;
  const entries = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(base + ":p:")) entries[k.slice((base + ":p:").length)] = localStorage.getItem(k); }
  let idx = null; try { idx = JSON.parse(localStorage.getItem(base + ":idx")); } catch (_) {}
  const legacyRaw = localStorage.getItem(base);
  let legacy = null; try { legacy = JSON.parse(legacyRaw); } catch (_) {}
  return { base, entries, idx, legacyLen: legacyRaw ? legacyRaw.length : 0, legacyIds: legacy ? Object.keys(legacy) : null, legacyRaw };
}, BASE_KEY);

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

let browser, context, page, signedIn = null, BASE_KEY = "planarfit:sites:v1";
try {
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    signedIn = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 900 }, initScripts: [[() => { window.__PLANYR_LEGACY_MIRROR = "idle"; }, null]] });
    ({ browser, context, page } = signedIn);
    const uid = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
    BASE_KEY = "planarfit:sites:cloud:" + uid;
    console.log(`build ${JSON.stringify(signedIn.build)}  signed in as ${signedIn.proof.email}`);
  } else {
    browser = await chromium.launch({ executablePath: EXEC, headless: false, args: ["--no-sandbox"] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => { window.__PLANYR_LEGACY_MIRROR = "idle"; window.__PLANYR_E2E = true; });
    page = await context.newPage();
    await page.goto(BASE + "/", { waitUntil: "load" });
  }
  await assertMeasurable(page, "verify-plan-store");
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));

  /* ── 0. put the device into the PRE-change shape: one whole-library entry, no per-plan entries ───────────────────────────────── */
  await page.goto(BASE + "/version.json", { waitUntil: "load" });         // the app is not running here, so nothing races the seed (its pagehide refresh already ran)
  const lib = makeLibrary(N);
  const seeded = await page.evaluate(([library, BASEKEY]) => {
    const base = BASEKEY;
    const existing = {};
    const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) if (k && k.startsWith(base + ":p:")) { try { existing[k.slice((base + ":p:").length)] = JSON.parse(localStorage.getItem(k)); } catch (_) {} }
    try { Object.assign(existing, JSON.parse(localStorage.getItem(base) || "{}")); } catch (_) {}
    const whole = { ...existing, ...library };
    for (const k of keys) if (k && (k.startsWith(base + ":p:") || k === base + ":idx" || k === base + ":led")) localStorage.removeItem(k);
    const text = JSON.stringify(whole);
    localStorage.setItem(base, text);
    return { base, plans: Object.keys(whole).length, len: text.length, text };
  }, [lib, BASE_KEY]);
  console.log(`seeded the old layout: ${seeded.plans} plans, ${(seeded.len / 1000).toFixed(0)} KB in ONE entry (${seeded.base.replace(/cloud:.+/, "cloud:<uid>")})`);

  /* ── 1. first load of the new build: migrate ─────────────────────────────────────────────────────────────────────────────────── */
  if (LIVE) {
    /* Signed in, a project route only opens a project the ACCOUNT holds. The seeded plans exist only on this device, so open the map first: the first
     * load migrates the store and the app's own heal pushes the local-only plans up (the standing B124 behaviour); wait until the cloud has one. */
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await page.waitForTimeout(1000); up = await page.evaluate(async () => { const q = await window.pfSupabase.from("sites").select("id").eq("id", "zzpsv-1"); return !!(q.data && q.data.length); }).catch(() => false); }
    console.log(`seeded plans reached the account's cloud rows: ${up}`);
  }
  await page.goto(BASE + "/#/project/" + "zzpsv-g1" + "/site", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  let s1 = await snapshot(page);
  const ids1 = Object.keys(s1.entries);
  step("migration ran: an index exists and every plan has its own entry", !!(s1.idx && s1.idx.v === 1 && s1.idx.ok) && ids1.length >= seeded.plans, `index ${JSON.stringify(s1.idx && { v: s1.idx.v, mig: s1.idx.mig })}, ${ids1.length} entries for ${seeded.plans} seeded plans`);
  const legacyKept = s1.legacyRaw === seeded.text;
  const legacyStillWhole = s1.legacyIds && s1.legacyIds.length >= seeded.plans;
  step("the original whole-library entry is still there, still the whole library", !!legacyStillWhole, `${s1.legacyIds ? s1.legacyIds.length : 0} plans in the legacy entry, ${s1.legacyLen} chars${legacyKept ? " (byte-identical to what was seeded)" : " (a refresh already folded in boot-time changes)"}`);
  /* Lossless = no plan and no element lost. (Byte equality holds on a signed-out device; signed in, the first cloud pull may legitimately re-normalise a plan's
   * fields a moment after the migration, so equality of ids/content is what is asserted and the number re-normalised is reported.) The migrator itself
   * already read every entry back and compared it with its source before it wrote the index; the legacy entry above is the byte-identical proof. */
  const parsedEntry = (id) => { try { return JSON.parse(s1.entries[id]); } catch (_) { return null; } };
  const lost = Object.keys(lib).filter((id) => { const e = parsedEntry(id); return !e || e.id !== id || (e.els || []).map((x) => x.id).sort().join() !== (lib[id].els || []).map((x) => x.id).sort().join(); });
  const renorm = Object.keys(lib).filter((id) => s1.entries[id] !== JSON.stringify(lib[id])).length;
  step("lossless: every seeded plan and every element in it is present in its entry", lost.length === 0, `${lost.length} plans or elements missing${renorm ? `; ${renorm} entries re-normalised by the app's own first cloud pull` : "; every entry byte-identical to the seed"}`);

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
  step("the edit never wrote the whole library", biggest < 0.6 * before.legacyLen && !writes.some(([k]) => k === before.base), `${writes.length} writes to ${planKeys.map((k) => k.replace(before.base, "<store>")).join(" · ")}; largest ${(biggest / 1000).toFixed(1)} KB vs a ${(before.legacyLen / 1000).toFixed(0)} KB library`);
  step("the legacy entry was NOT rewritten on the edit path (the refresh is off it)", after.legacyRaw === before.legacyRaw, `legacy chars ${before.legacyLen} → ${after.legacyLen}`);

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

  /* ── 4. tab hidden / left: the legacy entry (the rollback copy) is refreshed ─────────────────────────────────────────────────── */
  await page.goto(BASE + "/version.json", { waitUntil: "load" });         // pagehide on the app page
  const s4 = await snapshot(page);
  const legacyHasEdit = (() => { try { return JSON.parse(s4.legacyRaw)[editedId].els.length === newCount; } catch (_) { return false; } })();
  step("leaving the tab refreshed the legacy entry: an OLD build now sees the edit", legacyHasEdit, `legacy copy of ${editedId}: ${(() => { try { return JSON.parse(s4.legacyRaw)[editedId].els.length; } catch (_) { return "?"; } })()} elements; index.stale=${s4.idx && s4.idx.stale}`);
  step("…and the legacy entry still holds every plan", !!(s4.legacyIds && Object.keys(s4.entries).every((id) => s4.legacyIds.includes(id))), `${s4.legacyIds ? s4.legacyIds.length : 0} plans`);

  /* ── 5. an OLDER build's write (whole legacy entry, while no new-build tab is open) is folded in on the next load ───────────── */
  const victim = `zzpsv-${Math.min(5, N - 1)}`;
  await page.evaluate(({ victim, BASEKEY }) => {
    const base = BASEKEY;
    const all = JSON.parse(localStorage.getItem(base));
    all[victim] = { ...all[victim], name: "renamed by an OLD build", updatedAt: Date.now() + 10000 };
    all["zzpsv-from-old-build"] = { id: "zzpsv-from-old-build", groupId: "zzpsv-from-old-build", site: "ZZ PSV old-build project", name: "Created by an old build", updatedAt: Date.now(), els: [], parcels: [], measures: [], callouts: [], markups: [], settings: {} };
    localStorage.setItem(base, JSON.stringify(all));
  }, { victim, BASEKEY: BASE_KEY });
  await page.goto(BASE + "/#/project/" + "zzpsv-g1" + "/site", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const s5 = await snapshot(page);
  const nameOf = (raw) => { try { return JSON.parse(raw).name; } catch (_) { return null; } };
  step("mixed builds: the older build's rename was adopted", nameOf(s5.entries[victim]) === "renamed by an OLD build", `${victim}: "${nameOf(s5.entries[victim])}"`);
  step("mixed builds: the plan the older build created was adopted", !!s5.entries["zzpsv-from-old-build"]);
  step("mixed builds: this build's earlier edit was NOT reverted", editedId && elCount(s5.entries[editedId]) === newCount, `${editedId}: ${editedId ? elCount(s5.entries[editedId]) : "?"} elements`);

  /* ── 6. nothing threw ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  step("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  /* ── 7. two tabs of one browser (signed out only: a signed-in tab converges through the element rows instead) ────────────────── */
  if (!LIVE) {
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
    await page.evaluate((v) => { const all = JSON.parse(localStorage.getItem("planarfit:sites:v1")); all[v] = { ...all[v], name: "renamed by an OLD build in the other tab", updatedAt: Date.now() + 20000 }; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, victimB);
    let seen = null;
    for (let i = 0; i < 20 && seen !== "renamed by an OLD build in the other tab"; i++) { await b.waitForTimeout(250); seen = await b.evaluate((v) => { try { return JSON.parse(localStorage.getItem("planarfit:sites:v1:p:" + v)).name; } catch (_) { return null; } }, victimB); }
    step("two tabs: an older build's write to the legacy entry is folded into the per-plan entry by the other tab's storage event", seen === "renamed by an OLD build in the other tab", `${victimB} in tab B: "${seen}"`);
    await b.close();
  } else step("two tabs (signed-out only)", null, "a signed-in tab converges through the element rows — not exercised here");

  console.log(`\nseeded plan ids to delete from the test account: zzpsv-0 … zzpsv-${N - 1}, zzpsv-from-old-build`);
} catch (e) {
  step("script ran to completion", false, String(e && e.stack || e).split("\n").slice(0, 4).join(" | "));
} finally { if (browser) await browser.close(); }
const bad = results.filter((r) => r.ok === false).length;
console.log(`\n${results.length} checks, ${bad} failed, ${results.filter((r) => r.ok === null).length} void`);
process.exit(bad ? 1 : 0);
