/* verify-parcel-list-actions — B2194741–B2194743: the Parcels LIST row actions, driven live at the real panel width.
 *   delete — covered by ui-audit/verify-parcel-delete-flow.mjs since NEW-1 (2026-10-22: one delete path, no confirm step, Undo everywhere)
 *   icons  — on EVERY row (incl. combined / renamed ones) no icon's box overlaps the name text's box (measured)
 *   lock   — the padlock is a click target on each row (always shown — closed when locked, open when not), toggles Lock with an Undo toast,
 *            and the state survives a reload
 * KNOWN-GOOD ARM: VOID unless the seeded 6 rows (incl. 3 combined/renamed + 1 locked) are present.
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 -> ui-audit/lib/signedInSession.mjs.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 300, y }, { x: x + 300, y: y + 300 }, { x, y: y + 300 }], source: "county", ...extra });
const snap = (p, name) => ({ ...p, snapName: name });
const comb = (id, x, label) => ({ id, label, ...sq(x, 400, id), source: undefined, combined: { from: [snap(sq(x, 400, id + "a"), "Lot A"), snap(sq(x + 150, 400, id + "b"), "Lot B")] } });
const SITE_ID = "zz-rowact-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Row Actions", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "chambers",
  parcels: [
    sq(0, 0, "k1", { label: "KILGORE PKWY", gisKey: "k1", attrs: { OWNER: "A" } }),
    sq(400, 0, "k2", { label: "LIBERTY DR", gisKey: "k2", attrs: { OWNER: "B" }, locked: true, lockSem: 2 }),
    comb("c3", 900, "Parcel 3"), comb("c4", 1400, "Parcel 4"), comb("c5", 1900, "Parcel 5"), comb("c6", 2400, "Tract D"),
  ],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const SIGNED = !!process.env.SIGNED_IN;
let browser, ctx, page, UID = null;
const errors = [];
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (_) {} }, site);
}
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const stored = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem(uid ? "planarfit:sites:cloud:" + uid : "planarfit:sites:v1") || "{}"); return (m[id] && m[id].parcels) || []; }, [SITE_ID, UID]);
const rowIds = () => page.locator('[data-testid^="parcel-table-row-"]').evaluateAll((e) => e.map((n) => n.getAttribute("data-testid").replace("parcel-table-row-", "")));
const toast = () => page.locator('text=/^(Deleted|Locked|Unlocked) /').first();

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await page.getByText("ZZ Row Actions", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-parcel-list-actions");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
  const ids0 = await rowIds();
  if (ids0.length !== 6) throw new Error(`VOID: expected 6 seeded rows, saw ${ids0.length}`);
  ok("known-good arm: the 6 seeded rows (3 combined/renamed, 1 locked) are listed", /Parcel 3/.test(await T("parcel-row-c3").innerText()) && (await T("parcel-row-lock-k2").getAttribute("data-locked")) === "1");

  // ---- icons never overlap a name (every row, plus each icon pair)
  const panelW = (await T("parcels-panel").boundingBox()).width;
  for (const id of ids0) {
    const m = await page.evaluate((rid) => {
      const row = document.querySelector(`[data-testid="parcel-table-row-${rid}"]`);
      const name = row.querySelector(`[data-testid="parcel-row-name-${rid}"]`);
      // the visible TEXT extent (range), not the clipped block
      const rg = document.createRange(); rg.selectNodeContents(name); const nb = rg.getBoundingClientRect();
      const nr = name.getBoundingClientRect();
      const tb = { l: nb.left, r: Math.min(nb.right, nr.right), t: nb.top, b: nb.bottom };
      const icons = [...row.querySelectorAll("button")].filter((b) => /parcel-row-(lock|pencil|eye|more)-/.test(b.getAttribute("data-testid") || ""));
      // hover-only icons are opacity 0 but still occupy a box — measure the box either way
      return icons.map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute("data-testid"), l: r.left, r: r.right, t: r.top, b: r.bottom, over: r.left < tb.r - 0.5 && r.right > tb.l + 0.5 && r.top < tb.b - 0.5 && r.bottom > tb.t + 0.5 }; });
    }, id);
    ok(`row ${id}: ${m.length} icon boxes, none overlaps the name text`, m.length >= 2 && m.every((x) => !x.over), JSON.stringify(m.filter((x) => x.over)));
  }
  ok(`measured at the real panel width (${Math.round(panelW)} px wide)`, panelW > 200);
  await shot("rows");

  // ---- lock: the padlock is ALWAYS shown (closed = locked, open = not — the table's lock column, owner 2026-10-16); one click on it toggles, with an Undo toast; ⋯ → Lock does the same
  const lockBtn = (id) => T("parcel-row-lock-" + id);
  const isLocked = async (id) => (await lockBtn(id).getAttribute("data-locked")) === "1";
  ok("an unlocked row shows an OPEN padlock (always there, not hover-only)", (await lockBtn("k1").count()) === 1 && !(await isLocked("k1")) && (await lockBtn("k1").locator('[data-lock-glyph="open"]').count()) === 1);
  await T("parcel-row-more-k1").click(); await T("parcel-row-menu-k1-lock").click(); await sleep(400);
  ok("⋯ → Lock locks it: the padlock closes, state stored, toast with Undo", (await isLocked("k1")) && (await lockBtn("k1").getAttribute("aria-pressed")) === "true" && (await lockBtn("k1").locator('[data-lock-glyph="locked"]').count()) === 1 && (await page.getByRole("button", { name: "Undo" }).count()) >= 1 && (await stored()).find((p) => p.id === "k1").locked === true);
  await page.getByRole("button", { name: "Undo" }).first().click(); await sleep(400);
  ok("Undo unlocks it again (the padlock opens)", !(await isLocked("k1")) && !(await stored()).find((p) => p.id === "k1").locked);
  await lockBtn("k2").click(); await sleep(400);
  ok("clicking a locked row's padlock unlocks it (with Undo)", !(await isLocked("k2")) && (await page.getByRole("button", { name: "Undo" }).count()) >= 1);
  await lockBtn("k2").click(); await sleep(400);
  ok("clicking an open padlock locks it (the padlock closes, state stored)", (await isLocked("k2")) && (await stored()).find((p) => p.id === "k2").locked === true);
  await lockBtn("k2").click(); await sleep(400); // back to unlocked for the reload check
  await T("parcel-row-more-k1").click(); await T("parcel-row-menu-k1-lock").click(); await sleep(600); // leave k1 LOCKED for the reload check
  await page.reload({ waitUntil: "load" }); await sleep(2500);
  if (!(await T("planner-canvas").isVisible().catch(() => false))) { await page.getByText("ZZ Row Actions", { exact: false }).first().click(); await T("planner-canvas").waitFor({ timeout: 25000 }); }
  await page.locator('[data-rail-tab="parcel"]').first().click(); await T("parcels-panel").waitFor();
  ok("lock round-trips through a reload (k1 locked, k2 unlocked)", (await isLocked("k1")) && !(await isLocked("k2")));

  // ---- delete moved to verify-parcel-delete-flow.mjs (NEW-1, 2026-10-22: no confirm step any more).
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
