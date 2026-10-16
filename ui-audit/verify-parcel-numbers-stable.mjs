/* verify-parcel-numbers-stable — B2289936 (owner 2026-10-16): an unnamed drawn lot reads "Parcel N" and N STAYS with its lot when another is deleted.
 *   · a LEGACY plan (four drawn lots, nobody ever named or numbered them, no `parcelNo` on disk) opens reading Parcel 1…4
 *   · deleting Parcel 2 leaves Parcel 3 and Parcel 4 reading 3 and 4 — in the list, in storage, and after a reload
 *   · Undo brings Parcel 2 back as Parcel 2; delete it again and the numbers survive a reload
 *   · NO row ever reads "Unnamed"
 * KNOWN-GOOD ARM: VOID unless the four seeded rows read Parcel 1…4 BEFORE anything is deleted (an instrument that cannot see the numbers proves nothing).
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 -> ui-audit/lib/signedInSession.mjs (live planyr.io, test account).
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sq = (x, id) => ({ id, points: [{ x, y: 0 }, { x: x + 300, y: 0 }, { x: x + 300, y: 300 }, { x, y: 300 }], source: "drawn" });
const SITE_ID = "zz-parcelno-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Parcel Numbers", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [sq(0, "p1"), sq(500, "p2"), sq(1000, "p3"), sq(1500, "p4")],
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
const names = () => page.locator('[data-testid^="parcel-row-name-"]').evaluateAll((e) => Object.fromEntries(e.map((n) => [n.getAttribute("data-testid").replace("parcel-row-name-", ""), n.textContent.trim()])));
const stored = () => page.evaluate(([id, uid]) => {
  // a per-plan slot (planStore) or the legacy whole-library entry — read whichever holds the plan
  const direct = Object.keys(localStorage).filter((k) => /:p:/.test(k) && k.endsWith(":" + id) && (uid ? k.includes("cloud:" + uid) : !k.includes("cloud:")));
  for (const k of direct) { try { const p = JSON.parse(localStorage.getItem(k)); if (p && p.parcels) return p.parcels; } catch (_) {} }
  const m = JSON.parse(localStorage.getItem(uid ? "planarfit:sites:cloud:" + uid : "planarfit:sites:v1") || "{}");
  return (m[id] && m[id].parcels) || [];
}, [SITE_ID, UID]);
const openPanel = async () => {
  await page.getByText("ZZ Parcel Numbers", { exact: false }).first().click({ timeout: 4000 }).catch(() => {});
  await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(1500);
  await page.locator('[data-rail-tab="parcel"]').first().click(); await T("parcels-panel").waitFor({ timeout: 15000 });
};

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await openPanel();
  await assertMeasurable(page, "verify-parcel-numbers-stable");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  const n0 = await names();
  if (JSON.stringify(n0) !== JSON.stringify({ p1: "Parcel 1", p2: "Parcel 2", p3: "Parcel 3", p4: "Parcel 4" })) throw new Error("VOID: the four seeded unnamed lots do not read Parcel 1…4 before the delete: " + JSON.stringify(n0));
  ok("known-good arm: four unnamed drawn lots read Parcel 1, 2, 3, 4", true);

  await T("parcel-row-more-p2").click(); await T("parcel-row-menu-delete-p2").click(); await T("parcel-row-delete-yes-p2").click(); await sleep(700);
  const n1 = await names();
  ok("after deleting Parcel 2, Parcel 3 and Parcel 4 keep their numbers", n1.p3 === "Parcel 3" && n1.p4 === "Parcel 4" && n1.p1 === "Parcel 1" && !("p2" in n1), JSON.stringify(n1));
  ok("…and no row reads Unnamed", !Object.values(n1).some((t) => /unnamed/i.test(t)));
  const st = await stored();
  ok("the numbers are STORED on the lots (parcelNo 1, 3, 4)", JSON.stringify(st.map((p) => p.parcelNo)) === JSON.stringify([1, 3, 4]), JSON.stringify(st.map((p) => [p.id, p.parcelNo])));

  // Undo brings the lot back under its own number
  await page.getByRole("button", { name: "Undo" }).first().click(); await sleep(700);
  const n3 = await names();
  ok("Undo brings Parcel 2 back as Parcel 2 (and 3, 4 are untouched)", n3.p2 === "Parcel 2" && n3.p3 === "Parcel 3" && n3.p4 === "Parcel 4", JSON.stringify(n3));
  // delete it again and prove the numbers survive a reload
  await T("parcel-row-more-p2").click(); await T("parcel-row-menu-delete-p2").click(); await T("parcel-row-delete-yes-p2").click(); await sleep(900);
  await page.reload({ waitUntil: "load" }); await sleep(SIGNED ? 3000 : 2000);
  await openPanel();
  const n2 = await names();
  ok("after a reload they still read Parcel 1, Parcel 3, Parcel 4", JSON.stringify(n2) === JSON.stringify({ p1: "Parcel 1", p3: "Parcel 3", p4: "Parcel 4" }), JSON.stringify(n2));
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
