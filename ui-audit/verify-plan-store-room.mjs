#!/usr/bin/env node
/* verify-plan-store-room — B2200385's REAL-ENGINE proof: a device whose localStorage is as full as the owner's Device A (legacy library ~2.0M
 * characters, version-history ring ~0.7M, ~3.6M of the browser's ~5.24M used) is refused the per-plan split today; with the make-room step the
 * shipped bundle moves the history ring to IndexedDB (verified), keeps the legacy entry byte-identical, and migrates, leaving >= 250k free.
 *
 *   npm run build && npx vite preview --port 4173      # then:
 *   xvfb-run -a node ui-audit/verify-plan-store-room.mjs [--engine chromium|webkit|both] [--base http://localhost:4173] [--no-room]
 *
 * `--no-room` sets the kill switch so the seeded device stays where main leaves it (the red arm: it must NOT migrate). A run whose
 * seed did not reach the intended fill says VOID, never PASS. Each engine's real cap is MEASURED first and printed — the iPhone's is not
 * reproducible here (Playwright's Linux WebKit accepts the same ~5.24M characters as Chromium). */
import { createRequire } from "module";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const require = createRequire(import.meta.url);
let pw; try { pw = require(process.env.PW_MODULE || "playwright"); } catch (_) { pw = require("/opt/node-tools/node_modules/playwright-core"); }   // PW_MODULE: a playwright whose browser revisions are the ones installed

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const BASE = argOf("--base", "http://localhost:4173").replace(/\/$/, "");
const ENGINE = argOf("--engine", "both");
const NO_ROOM = process.argv.includes("--no-room");
const KEY = "planarfit:sites:v1", HIST = "planarfit:sites:history:v1", FLAG = "planarfit:sites:history:idbonly";
let failed = 0;
const step = (n, ok, d) => { if (ok === false) failed++; console.log(`${ok === null ? "VOID" : ok ? "PASS" : "FAIL"}  ${n}${d ? "  —  " + d : ""}`); };

async function run(name) {
  const browser = await pw[name].launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/version.json").catch(() => {});
  await assertMeasurable(page, "verify-plan-store-room:" + name);
  const seeded = await page.evaluate(({ KEY, HIST }) => {
    localStorage.clear();
    // measure this engine's real cap first
    let cap = 0; try { for (;;) { localStorage.setItem("probe" + (cap / 100000), "a".repeat(100000)); cap += 100000; if (cap > 9e6) break; } } catch (_) {}
    let extra = 0; try { for (;;) { localStorage.setItem("probeZ", "a".repeat(extra + 1000)); extra += 1000; } } catch (_) {}
    cap += extra; localStorage.clear();
    const lib = {}; const N = 77;
    for (let i = 0; i < N; i++) { const id = "p" + String(i).padStart(3, "0"); lib[id] = { id, groupId: "g" + (i % 9), site: "S" + (i % 9), name: "Plan " + i, updatedAt: 1700000000000 + i, els: [{ id: "e" + i, type: "building", cx: 0, cy: 0, w: 100, h: 100, rot: 0 }], pad: "" }; }
    const per = Math.floor((2004695 - KEY.length - JSON.stringify(lib).length) / N);
    for (const r of Object.values(lib)) r.pad = "x".repeat(per);
    const legacy = JSON.stringify(lib); localStorage.setItem(KEY, legacy);
    const ring = {}; let at = 1700000100000;
    for (const id of ["p001", "p002", "p003"]) { ring[id] = []; for (let i = 0; i < 3; i++) ring[id].unshift({ at: (at += 5000), sig: "1/0/0/0/0/" + at + "/0", buildings: 1, name: "n", site: "s", model: { id, els: [{ id: "b", type: "building", cx: 0, cy: 0, w: 10, h: 10 }], pad: "h".repeat(Math.floor((716000 - 700) / 9) - 160) } }); }
    const ringText = JSON.stringify(ring); localStorage.setItem(HIST, ringText);
    let used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + localStorage.getItem(k).length; }
    const filler = 3597555 - used - 24; if (filler > 0) localStorage.setItem("planarfit:settings:other", "z".repeat(filler));
    used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + localStorage.getItem(k).length; }
    return { cap, used, legacy, ringText };
  }, { KEY, HIST });
  console.log(`${name}: measured cap ${seeded.cap} chars; seeded used ${seeded.used}`);
  step(name + " seed reached Device A's fill", Math.abs(seeded.used - 3597555) < 5000 ? true : null, `used ${seeded.used}`);
  if (NO_ROOM) await page.evaluate(() => localStorage.setItem("planarfit:planStore:layout", "blob"));
  await page.goto(BASE + "/#/site-planner");
  const t0 = Date.now(); let st = null;
  while (Date.now() - t0 < 25000) {
    st = await page.evaluate(({ KEY, HIST, FLAG }) => ({ idx: !!localStorage.getItem(KEY + ":idx"), hist: localStorage.getItem(HIST) !== null, flag: localStorage.getItem(FLAG), legacyLen: (localStorage.getItem(KEY) || "").length }), { KEY, HIST, FLAG });
    if (st.idx) break; await new Promise((r) => setTimeout(r, 400));
  }
  const after = await page.evaluate(({ KEY, HIST }) => { let used = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + localStorage.getItem(k).length; } return { used, legacy: localStorage.getItem(KEY), entries: Object.keys(localStorage).filter((k) => k.startsWith(KEY + ":p:")).length }; }, { KEY, HIST });
  const idbRing = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("planyr"); r.onsuccess = () => { try { const g = r.result.transaction("kv").objectStore("kv").get("planarfit:sites:history:v1"); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); } catch (_) { res(null); } }; r.onerror = () => res(null); }));
  if (NO_ROOM) {
    step(name + " RED ARM (kill switch): stays on the legacy layout, as main does", !st.idx && st.hist, JSON.stringify(st));
  } else {
    step(name + " migrated to per-plan entries", st.idx && after.entries >= 77, `${after.entries} entries`);
    step(name + " the legacy entry is byte-identical to the seed", after.legacy === seeded.legacy);
    step(name + " history ring left localStorage, flag set", !st.hist && st.flag === "1", JSON.stringify(st));
    step(name + " IndexedDB holds the identical ring", idbRing === JSON.stringify(JSON.parse(seeded.ringText)), idbRing ? idbRing.length + " chars" : "absent");
    step(name + " >= 250,000 characters stay free", seeded.cap - after.used >= 250000, `free ${seeded.cap - after.used}`);
  }
  await browser.close();
}
for (const e of ENGINE === "both" ? ["chromium", "webkit"] : [ENGINE]) await run(e);
process.exit(failed ? 1 : 0);
