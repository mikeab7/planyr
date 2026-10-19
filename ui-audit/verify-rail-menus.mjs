/* verify-rail-menus — B2243168/B2243169: the Parcel tools ▾ and Measure ▾ menus on a real deploy.
 * Parcel tools: headings ADD LAND / EDIT; no "Remove parcels" row; THIS PARCEL absent with nothing selected, present with a
 * parcel selected (name · acreage + three switches that flip IN PLACE with the menu staying open and persist);
 * red "Delete parcel" last. Measure: four explained rows, remembered mode (pick Area → Select → click Measure arms Area,
 * ▾ shows the mode icon, aria "Measure mode: Area"), Polylength finishes with a REAL double-click (no echo point) and with Enter.
 * KNOWN-GOOD ARM: the typed parcel name must read in THIS PARCEL's header — VOID otherwise.
 * THEME=dark|light sets the theme before the run. Modes: BASE_URL (default local preview) · SIGNED_IN=1 -> ui-audit/lib/signedInSession.mjs. SHOTS_DIR writes light+dark screenshots. */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-railmenus-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Rail Menus", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "chambers",
  parcels: [{ id: "p1", label: "ZZ Menu Lot", points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }], source: "drawn" }],
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
if (process.env.THEME) await page.evaluate((t) => { try { localStorage.setItem("planyr.theme", t); } catch (_) {} }, process.env.THEME);
const T = (id) => page.getByTestId(id);
const row = (id) => page.locator(`[data-parcel-action="${id}"]`);
const storeKey = () => (UID ? "planarfit:sites:cloud:" + UID : "planarfit:sites:v1");
const stored = () => page.evaluate(([id, k]) => (JSON.parse(localStorage.getItem(k) || "{}")[id]) || {}, [SITE_ID, storeKey()]);
const parcel = async () => ((await stored()).parcels || [])[0] || {};
const measures = async () => ((await stored()).measures || []).map((m) => ({ mode: m.mode, n: (m.pts || []).length }));
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, clip: { x: 1000, y: 0, width: 440, height: 900 } }); };
const pill = () => page.getByRole("button", { name: /^Measure mode:/ });
const dbl = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 }); await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 }); };

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await page.getByText("ZZ Rail Menus", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-rail-menus");
  const build = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")).filter((s) => /SitePlannerApp/.test(s)).join(","));
  console.log("served build", build, "| chunk", chunks);

  /* ---------- Parcel tools, nothing selected ---------- */
  await page.keyboard.press("Escape");
  await T("rail-parcel-tools").click();
  await row("draw").waitFor({ timeout: 10000 });
  const heads = await page.locator("[data-parcel-group] .rail-menu-hdr").evaluateAll((e) => e.map((n) => n.textContent.trim()));
  ok("headings read ADD LAND and EDIT (and no other heading with nothing selected)", heads.join("|") === "Add land|Edit", heads.join("|"));
  ok("no \"Remove parcels — click to delete\" row", (await row("removeMode").count()) === 0 && !(await page.getByText(/Remove parcels/i).count()));
  ok("THIS PARCEL is absent with nothing selected", (await page.locator('[data-parcel-group="this"]').count()) === 0);
  ok("Delete parcel is the last row and reads red", (await page.locator("[data-parcel-action]").last().getAttribute("data-parcel-action")) === "deleteSelected" && (await row("deleteSelected").evaluate((n) => getComputedStyle(n).color)) !== (await row("draw").evaluate((n) => getComputedStyle(n).color)));
  await shot("parcel-none");
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 860);

  /* ---------- select the parcel, THIS PARCEL appears ---------- */
  const at = await page.evaluate(() => { const poly = document.querySelectorAll('[data-testid="parcel-outline"]')[0]; if (!poly) return null; const pts = poly.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number)); const p = poly.ownerSVGElement.createSVGPoint(); p.x = (pts[0][0] + pts[1][0]) / 2; p.y = (pts[0][1] + pts[1][1]) / 2; const s = p.matrixTransform(poly.getScreenCTM()); return [s.x, s.y]; });
  if (!at) throw new Error("VOID: no parcel outline on the canvas");
  await page.mouse.click(...at); await sleep(300);
  if (!(await row("draw").isVisible().catch(() => false))) await T("rail-parcel-tools").click();
  await page.locator('[data-parcel-this-name]').waitFor({ timeout: 8000 });
  const nm = (await page.locator("[data-parcel-this-name]").innerText()).trim();
  if (nm !== "ZZ Menu Lot") throw new Error("VOID: known-good arm — the typed parcel name does not read in THIS PARCEL: " + nm);
  ok("known-good arm: THIS PARCEL header carries the typed name", true, nm);
  ok("…and an acreage", /AC$/.test((await page.locator("[data-parcel-this-acres]").innerText()).trim()), await page.locator("[data-parcel-this-acres]").innerText());
  const labels = await page.locator('[data-parcel-group="this"] [data-parcel-action]').evaluateAll((e) => e.map((n) => n.textContent.trim().replace(/\s+/g, " ")));
  ok("switches + setbacks row read as specified", /^Lock boundary/.test(labels[0]) && /^Count in yield totals/.test(labels[1]) && /^Show acreage label/.test(labels[2]) && /^Setbacks and settings\s*Land/.test(labels[labels.length - 1]), labels.join(" | "));
  await shot("parcel-selected");
  const before = await parcel();
  for (const [id, key, want] of [["chip", "chipHidden", true], ["lock", "locked", true], ["active", "active", false]]) {
    const was = await row(id).getAttribute("aria-checked");
    await row(id).click(); await sleep(250);
    ok(`${id} switch flips in place, menu stays open`, (await row("draw").isVisible()) && (await row(id).getAttribute("aria-checked")) !== was);
    const p = await parcel();
    ok(`${id} persisted (${key} = ${want})`, !!p[key] === want || (key === "active" && p.active === false), JSON.stringify({ [key]: p[key] }));
  }
  await page.reload({ waitUntil: "load" }); await sleep(2500);
  const after = await parcel();
  ok("switch states survive a reload", after.chipHidden === true && after.locked === true && after.active === false, JSON.stringify({ c: after.chipHidden, l: after.locked, a: after.active }));
  // put them back (so Delete + later steps act on a normal parcel)
  await page.getByText("ZZ Rail Menus", { exact: false }).first().click().catch(() => {});
  await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(1200);

  /* ---------- Measure ---------- */
  await page.keyboard.press("Escape");
  await pill().click();
  const hints = { line: "Two clicks, straight line", polyline: "Click points; double-click or Enter to finish", area: "Click corners; double-click to close", count: "Click each item; double-click or Enter to finish" };
  let allRows = true;
  for (const [k, h] of Object.entries(hints)) { const r = T("measure-mode-" + k); allRows = allRows && (await r.isVisible()) && (await r.locator("svg[data-menu-icon]").count()) === 1 && (await r.innerText()).includes(h); }
  ok("Measure ▾: four rows, each icon + name + hint", allRows);
  ok("current mode wears a check mark (exactly one)", (await page.locator("[data-menu-check]").count()) === 1);
  await shot("measure-menu");
  await T("measure-mode-area").click(); await sleep(300);
  ok("▾ pill aria says the mode in words", (await pill().getAttribute("aria-label")) === "Measure mode: Area");
  ok("▾ pill shows an icon (not the word)", (await pill().locator("svg[data-menu-icon]").count()) === 1 && !/area/i.test(await pill().innerText()));
  await page.getByRole("button", { name: /^Select V$/ }).click();
  ok("Select armed, Measure disarmed", (await page.getByRole("button", { name: /^Measure$/ }).getAttribute("aria-pressed")) === "false");
  await page.getByRole("button", { name: /^Measure$/ }).click();
  ok("clicking Measure arms the remembered mode (Area) with no menu", (await page.getByRole("button", { name: /^Measure$/ }).getAttribute("aria-pressed")) === "true" && (await pill().getAttribute("aria-label")) === "Measure mode: Area" && !(await T("measure-mode-line").isVisible().catch(() => false)));
  await page.keyboard.press("Escape");

  const b = await T("planner-canvas").boundingBox();
  await pill().click(); await T("measure-mode-polyline").click(); await sleep(200);
  await page.mouse.click(b.x + 300, b.y + 300); await page.mouse.click(b.x + 400, b.y + 360); await dbl(b.x + 520, b.y + 300);
  await sleep(500);
  let m = await measures();
  ok("Polylength finished with a real DOUBLE-CLICK: one measurement, 3 points (no echo)", m.length === 1 && m[0].mode === "polyline" && m[0].n === 3, JSON.stringify(m));
  await page.mouse.click(b.x + 300, b.y + 420); await page.mouse.click(b.x + 400, b.y + 470); await page.mouse.click(b.x + 520, b.y + 420); await page.keyboard.press("Enter");
  await sleep(500);
  m = await measures();
  ok("Polylength finished with ENTER: second measurement, 3 points", m.length === 2 && m[1].mode === "polyline" && m[1].n === 3, JSON.stringify(m));
  await page.keyboard.press("Escape");

  /* ---------- Delete parcel ---------- */
  await page.mouse.click(...(at)); await sleep(300);
  await T("rail-parcel-tools").click();
  await row("deleteSelected").click(); await sleep(600);
  ok("Delete parcel removes the selected parcel", ((await stored()).parcels || []).filter((p) => !p.deletedAt).length === 0, JSON.stringify(((await stored()).parcels || []).map((p) => p.id)));
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  // The planner syncs the seeded throwaway plan to the cloud — soft-delete it (the repo's delete convention) so a run leaves nothing behind.
  if (SIGNED) { try { await sleep(2500); await page.evaluate(async (id) => { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); }, SITE_ID); } catch (_) {} }
  if (SIGNED) { try { await page.evaluate(([id, uid]) => { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); }, [SITE_ID, UID]); } catch (_) {} }
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
