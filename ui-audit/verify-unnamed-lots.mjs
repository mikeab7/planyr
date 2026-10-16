/* verify-unnamed-lots — B2194745: an unnamed lot (county attrs carry an owner + street) reads grey "Unnamed" in the list and on its page, its name field is empty, the source line is intact; typing a name shows it, clearing returns "Unnamed".
 * KNOWN-GOOD ARM: a typed-name lot must still read its name — VOID otherwise.
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 -> ui-audit/lib/signedInSession.mjs. */
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
const SITE_ID = "zz-unnamed-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Unnamed Lots", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "chambers",
  parcels: [
    sq(0, 0, "u1", { addr: "123 KILGORE PKWY", acct: "0421030000129", gisKey: "u1", attrs: { OWNER_NAME: "BAUER HOCKLEY 550 LP", SITUS_ADDRESS: "123 KILGORE PKWY", ACCOUNT: "0421030000129" } }),
    sq(400, 0, "n1", { label: "Typed Lot", gisKey: "n1", attrs: { OWNER_NAME: "SOMEONE ELSE" } }),
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
  await page.getByText("ZZ Unnamed Lots", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-unnamed-lots");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
  const nameOf = (id) => T("parcel-row-name-" + id).evaluate((n) => ({ text: n.textContent.trim(), color: getComputedStyle(n).color }));
  const typed = await nameOf("n1");
  if (typed.text !== "Typed Lot") throw new Error("VOID: known-good arm — the typed-name lot does not read its name: " + typed.text);
  ok("known-good arm: a typed name still reads as typed", true, typed.text);
  const un = await nameOf("u1");
  ok("the unnamed COUNTY lot reads by its account in the list (Layout C) — never its owner/street, and never the word Unnamed (a drawn / other lot reads \"Parcel N\", see verify-parcel-list-layout)", /^Acct \d+$/.test(un.text), un.text);
  ok("…and in a quieter (grey) colour than a typed name", un.color !== typed.color, `${un.color} vs ${typed.color}`);
  ok("the list never shows the owner or street as a name", !/BAUER|KILGORE/i.test(await T("parcel-row-u1").innerText().then((t) => t.split("\n")[0])));
  await shot("list");
  await T("parcel-row-u1").click();
  await T("parcel-page").waitFor({ timeout: 10000 });
  ok("the page header reads \"Unnamed\"", (await T("parcel-page-name").innerText()).trim() === "Unnamed");
  ok("the name field is empty", (await T("parcel-field-label").inputValue()) === "");
  const sub = await T("parcel-page-sub").innerText().catch(() => "");
  ok("the source line still shows the CAD / account", /0421030000129|CCAD|HCAD|Chambers|County/i.test(sub + " " + (await T("parcel-page").innerText())), sub.slice(0, 80));
  await shot("page");
  await T("parcel-field-label").fill("My Lot"); await T("parcel-field-label").press("Enter"); await sleep(500);
  ok("typing a name shows it on the page header", (await T("parcel-page-name").innerText()).trim() === "My Lot");
  await T("parcel-field-label").fill(""); await T("parcel-field-label").press("Enter"); await sleep(500);
  ok("clearing it returns \"Unnamed\"", (await T("parcel-page-name").innerText()).trim() === "Unnamed");
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  if (SIGNED) { try { await page.evaluate(([id, uid]) => { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); }, [SITE_ID, UID]); } catch (_) {} }
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
