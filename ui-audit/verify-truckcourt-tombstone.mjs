/* NEW-1 — removing a building's TRUCK COURT (and its bonded trailer parking + buffer) must leave a
 * delete-tombstone, exactly like deleteSel already does (B556). This is the owner's EXACT report:
 * "remove the truck court on the left side… the trailer parking below the building comes back… and
 * the 'changed in another session / Take over editing' prompt keeps re-appearing." Root cause: the
 * dock-zone delete handlers (removeFeature / removeOuterDockZone / removeOuterZoneOnSide) pulled the
 * zones out of `els` but recorded NO tombstone, so (1) a cloud/cross-tab union-merge resurrected them
 * and (2) dropping ≥2 items with no tombstone tripped the B459 thin-clobber guard → the false banner.
 *
 * This harness proves the fix in the REAL app, LOGGED-OUT (the tombstone write is cloud-independent;
 * the thin-clobber guard + take-over banner themselves only run signed-in → that half is the V### check):
 *   1. Seed a cross-dock building; boot the planner.
 *   2. Build a full dock stack (court → trailer parking → buffer) on both dock sides.
 *   3. Select a TRUCK COURT and click "Remove truck court (+ outer)" (removeFeature) — its whole chain
 *      (court + trailer + buffer) leaves `els`… and EVERY id that left is written to `deletedIds` (the fix).
 *   4. Select the building and click "Pull every dock side" (removeOuterDockZone) — same invariant on the
 *      remaining side's outermost zone.
 * The invariant asserted throughout: (zone ids that disappear from els) ⊆ (deletedIds) — no orphaned drop.
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-truckcourt-tombstone.mjs */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";
const DEMO_ID = "verify-truckcourt";

const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify NEW-1", name: "Truck court tombstone",
  origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: [{ x: -900, y: -640 }, { x: 900, y: -640 }, { x: 900, y: 640 }, { x: -900, y: 640 }] }],
  els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* ignore */ }
await page.waitForTimeout(500);

// Read the persisted Site Model (what autosave wrote to the local mirror).
const readModel = () => page.evaluate(({ k, id }) => { try { return JSON.parse(localStorage.getItem(k))[id]; } catch (e) { return null; } }, { k: SITES_KEY, id: DEMO_ID });
const zoneIdsOf = (m) => (m && m.els || []).filter((e) => e.id !== "b1").map((e) => e.id);
const tombsOf = (m) => (m && m.deletedIds) || [];

// Fill-based zone rects on the canvas (same palette verify-dock-zones uses).
const zones = () => page.evaluate(() => {
  const FILL = { "#f3ece1": "building", "#d6d1c7": "court", "#e3d4b2": "trailer", "#bcd3a6": "buffer" };
  const out = [];
  for (const r of document.querySelectorAll("svg rect")) {
    const fill = (r.getAttribute("fill") || "").toLowerCase();
    if (!FILL[fill]) continue;
    const b = r.getBoundingClientRect();
    if (b.width < 15 || b.height < 4 || b.x < 260) continue;
    out.push({ kind: FILL[fill], cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height });
  }
  return out;
});

// Click a visible button whose title/text matches `re` (panel controls).
const clickBtn = async (re, { optional = false } = {}) => {
  const r = await page.evaluate((src) => {
    const rx = new RegExp(src);
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent === null || b.disabled) continue;
      const title = (b.getAttribute("title") || "").trim(), text = (b.textContent || "").trim();
      if (rx.test(title) || rx.test(text)) { b.click(); return text || title || "(btn)"; }
    }
    return null;
  }, re.source);
  await page.waitForTimeout(350);
  if (!r && !optional) throw new Error("control not found: " + re);
  return r;
};

const selectBuilding = async () => {
  const p = await page.evaluate(() => {
    const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width * 0.35, y: b.y + b.height * 0.4 };
  });
  if (p) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(400); }
  return !!p;
};

// ---- Build a full dock stack on both dock sides: "+" x3 → court, trailer parking, buffer ----
await selectBuilding();
await clickBtn(/Extend every dock side/);
await clickBtn(/Extend every dock side/);
await clickBtn(/Extend every dock side/);
await page.waitForTimeout(1400);
const built = await readModel();
const builtZones = zoneIdsOf(built);
check("built a full dock stack (court+trailer+buffer on both sides = 6 zones)", builtZones.length === 6, `zones=${builtZones.length}`);
await page.screenshot({ path: OUT + "new1-stack-built.png" });

// ---- Scenario A — the owner's exact action: select a TRUCK COURT, "Remove truck court (+ outer)" ----
const courtRect = (await zones()).filter((z) => z.kind === "court").sort((a, b) => b.w * b.h - a.w * a.h)[0];
let scenarioA = false;
const removeCourtVisible = () => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.offsetParent !== null && /Remove truck court/i.test(b.textContent || "")));
if (courtRect) {
  // The court is the innermost zone; nudge the click along its depth axis until it selects (robust to
  // dock-door marks / overlapping bounds), exactly like verify-delete-tombstone's offset loop.
  let selectedCourt = false;
  for (const [dx, dy] of [[0, 0], [0, -8], [0, 8], [-40, 0], [40, 0], [0, -16], [0, 16]]) {
    await page.mouse.click(courtRect.cx + dx, courtRect.cy + dy);
    await page.waitForTimeout(300);
    if (await removeCourtVisible()) { selectedCourt = true; break; }
  }
  const clicked = selectedCourt ? await clickBtn(/Remove truck court/i, { optional: true }) : null;
  if (clicked) {
    scenarioA = true;
    await page.waitForTimeout(1500); // immediate mirror + debounced autosave
    const after = await readModel();
    const removed = builtZones.filter((id) => !zoneIdsOf(after).includes(id));
    const tombs = tombsOf(after);
    check("removeFeature: the court cascade (court+trailer+buffer) left els", removed.length >= 3, `removed=${removed.length} [${removed.join(",")}]`);
    check("removeFeature: EVERY removed id is tombstoned in deletedIds (the fix)", removed.length > 0 && removed.every((id) => tombs.includes(id)), `tombs=[${tombs.join(",")}]`);
    await page.screenshot({ path: OUT + "new1-after-remove-court.png" });
  }
}
if (!scenarioA) {
  check("removeFeature: the court cascade (court+trailer+buffer) left els", false, "skipped — court select / button not found");
  check("removeFeature: EVERY removed id is tombstoned in deletedIds (the fix)", false, "skipped");
}

// ---- Scenario B — removeOuterDockZone: select the building, "Pull every dock side" ----
const beforeB = await readModel();
const beforeBZones = zoneIdsOf(beforeB);
await selectBuilding();
const pulled = await clickBtn(/Pull every dock side/, { optional: true });
if (pulled && beforeBZones.length) {
  await page.waitForTimeout(1500);
  const after = await readModel();
  const removed = beforeBZones.filter((id) => !zoneIdsOf(after).includes(id));
  const tombs = tombsOf(after);
  check("removeOuterDockZone: peeled the outermost zone(s)", removed.length >= 1, `removed=${removed.length} [${removed.join(",")}]`);
  check("removeOuterDockZone: EVERY removed id is tombstoned too", removed.length > 0 && removed.every((id) => tombs.includes(id)), `tombs=[${tombs.join(",")}]`);
} else {
  check("removeOuterDockZone: peeled the outermost zone(s)", false, pulled ? "skipped — no zones left" : "skipped — control not found");
  check("removeOuterDockZone: EVERY removed id is tombstoned too", false, "skipped");
}

// Ignore proxy-blocked resource loads (basemap tiles / fonts / external hosts) — those are the sandbox
// TLS proxy, not app faults. Only genuine JS/app errors should fail this check.
const appErrors = errors.filter((e) => !/Failed to load resource|ERR_(CONNECTION|TUNNEL|CERT|NAME|NETWORK)|net::/i.test(e));
check("no uncaught app errors", appErrors.length === 0, appErrors.slice(0, 4).join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nNEW-1 truck-court tombstone: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
