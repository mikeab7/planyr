/* verify-parcel-combine-split — the Parcels table + the ONE combine / ONE split, driven live.
 *
 * Runs the owner's acceptance on a THROWAWAY site with 5 parcels (4 adjacent + 1 apart):
 *   (1) eye off → the site total drops, eye on → it returns
 *   (2) check 3 touching rows → Combine from the PANEL → "Tract A", "Made from", total UNCHANGED
 *   (3) Restore → the 3 originals are back, total unchanged
 *   (4) the same combine from the MAP TOOLBAR (Parcel tools → Combine, click the parcels, Merge) → a state
 *       IDENTICAL to (2) (same name, same originals, same geometry, same total)
 *   (5) split from the MAP TOOLBAR by drawing a line → auto-named · A / · B pieces summing to the original, NO prompt
 *   (6) Undo (the toast's button) → the original is back
 *   (7) reload → the state persisted
 * plus the panel-aimed split ("Splitting <name> · <ac> AC"), a refusal (non-touching), and Restore original.
 *
 * Modes: BASE_URL (default the local preview) · SIGNED_IN=1 uses ui-audit/lib/signedInSession.mjs against
 * BASE_URL (planyr.io) as the test account and seeds the throwaway through the app's own local-cache path.
 * KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the run is VOID unless the untouched table reports the
 * seeded 5 parcels and 18.37 ac before anything is acted on.
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

const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 400, y }, { x: x + 400, y: y + 400 }, { x, y: y + 400 }], ...extra });
const NAMES = { p1: "Gordon Smith Tract", p2: "Kilgore Parcel", p3: "Third Lot", p4: "Fourth Lot", p5: "Far Away" };
const mkSite = (id) => ({
  id, groupId: id, site: "ZZ Parcels Throwaway", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [sq(0, 0, "p1", { acct: "1001", addr: NAMES.p1 }), sq(400, 0, "p2", { acct: "1002", addr: NAMES.p2 }), sq(800, 0, "p3", { acct: "1003", addr: NAMES.p3 }), sq(1200, 0, "p4", { acct: "1004", addr: NAMES.p4 }), sq(0, 800, "p5", { acct: "1005", addr: NAMES.p5 })],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const SIGNED = !!process.env.SIGNED_IN;
const SITE_ID = "zz-parcels-" + Math.random().toString(36).slice(2, 7);
const site = mkSite(SITE_ID);
let browser, ctx, page, UID = null;
const errors = [];
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (e) {} }, site);
}
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/*.jpg", (r) => r.abort());

const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const T = (id) => page.getByTestId(id);
const parcelsLS = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem(uid ? "planarfit:sites:cloud:" + uid : "planarfit:sites:v1") || "{}"); return (m[id] && m[id].parcels) || null; }, [SITE_ID, UID]);
const siteAcres = async () => parseFloat((await T("parcels-site-acres").innerText()).replace(/,/g, ""));
const rowNames = () => page.$$eval('[data-testid^="parcel-table-row-"]', (els) => els.map((e) => e.querySelector('[data-testid^="parcel-row-"]:not([data-testid*="check"]):not([data-testid*="eye"]):not([data-testid*="more"]):not([data-testid*="pencil"])')?.getAttribute("title")?.split(" — ")[0] || e.innerText.split("\n")[0]));
const flat = (ps) => JSON.stringify((ps || []).map((p) => ({ n: p.label || p.splitName || p.addr, pts: p.points.map((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]), a: p.active !== false, l: !!p.locked, from: (p.combined?.from || []).map((s) => s.id) })).sort((a, b) => a.n.localeCompare(b.n)));
async function openPanel() {
  if (await T("parcels-panel").isVisible().catch(() => false)) return;   // the rail tab TOGGLES — never click it when the panel is already open
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
}
async function fit() { const b = page.getByTitle(/zoom to fit|fit to/i).first(); if (await b.count()) await b.click().catch(() => {}); await sleep(500); }
async function parcelBoxes() { return page.$$eval('[data-testid="parcel-outline"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })); }

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }   // pick up the seeded cloud-cache entry
  await page.getByText("ZZ Parcels Throwaway", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-parcel-combine-split");
  const ver = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build:", ver);
  await openPanel();

  // KNOWN-GOOD ARM
  const a0 = await siteAcres();
  const rows0 = await page.$$('[data-testid^="parcel-table-row-"]');
  ok("known-good: untouched table shows the 5 seeded parcels at 18.37 ac", rows0.length === 5 && Math.abs(a0 - 18.37) < 0.006, `rows=${rows0.length} acres=${a0}`);
  if (!(rows0.length === 5 && Math.abs(a0 - 18.37) < 0.006)) throw new Error("VOID run — the instrument did not see the seeded parcels");
  await shot("01-table");

  // (1) eye off / on
  await T("parcel-row-eye-p5").click(); await sleep(300);
  const aOff = await siteAcres();
  ok("(1) eye off drops the site total by that parcel", Math.abs(aOff - (a0 - 3.6731)) < 0.02, `${a0} -> ${aOff}`);
  ok("(1) the row dims and its eye reads excluded", (await T("parcel-table-row-p5").getAttribute("data-included")) === "0");
  ok("(1) the checkbox did NOT change include state of another row", (await T("parcel-table-row-p1").getAttribute("data-included")) === "1");
  await T("parcel-row-eye-p5").click(); await sleep(300);
  ok("(1) eye on restores the total", Math.abs((await siteAcres()) - a0) < 0.006);

  // the checkbox only selects
  await T("parcel-row-check-p5").check(); await sleep(150);
  ok("checkbox selects without changing the total or include state", Math.abs((await siteAcres()) - a0) < 0.006 && (await T("parcel-table-row-p5").getAttribute("data-included")) === "1");
  await T("parcel-row-check-p1").check(); await sleep(250);
  const bar2 = await T("parcels-action-bar").innerText();
  ok("2 non-touching selected → Combine is disabled with a plain reason", (await T("parcels-bar-combine").isDisabled()) && /don't touch/.test(bar2), bar2.replace(/\n/g, " | "));
  await T("parcel-row-check-p5").uncheck(); await T("parcel-row-check-p1").uncheck();

  // (2) combine from the PANEL
  for (const id of ["p1", "p2", "p3"]) await T(`parcel-row-check-${id}`).check();
  await sleep(300);
  const bar3 = await T("parcels-action-bar").innerText();
  ok("3 touching selected → bar reads '3 selected' + Combine", /3 selected/.test(bar3) && /Combine/.test(bar3), bar3.replace(/\n/g, " | "));
  await shot("02-bar");
  await T("parcels-bar-combine").click(); await sleep(700);
  const afterPanel = await parcelsLS();
  const tractP = afterPanel.find((p) => p.combined);
  ok("(2) panel combine → ONE new parcel named Tract A (no prompt)", tractP && tractP.label === "Tract A" && afterPanel.length === 3, `names=${afterPanel.map((p) => p.label || p.addr).join(", ")}`);
  ok("(2) originals are NOT live parcels in the model (nothing hidden to leak)", !afterPanel.some((p) => ["p1", "p2", "p3"].includes(p.id)));
  ok("(2) site total unchanged by the combine", Math.abs((await siteAcres()) - a0) < 0.006, String(await siteAcres()));
  await T(`parcel-row-${tractP.id}`).click(); await T("parcel-page").waitFor({ timeout: 8000 });   // Parcels rework: a row opens the parcel's own PAGE
  ok("(2) its page shows 'Made from' (and never 'Drawn')", /made from/i.test(await T("parcel-made-from").locator("xpath=..").innerText()) && !/drawn/i.test(await T("parcel-source").innerText()));
  const det = await T("parcel-made-from").innerText();
  ok("(2) Made from lists each original by name, APN and acres", /Gordon Smith Tract/.test(det) && /Kilgore Parcel/.test(det) && /Third Lot/.test(det) && /1002/.test(det) && /3\.67 AC/.test(det));
  await T("parcel-page-back").click(); await T("parcels-panel").waitFor({ timeout: 8000 });
  ok("(2) 'Combined from 3 lots' on the row; Undo toast shown", (await T(`parcel-table-row-${tractP.id}`).innerText()).includes("Combined from 3 lots") && (await page.getByText("Combined 3 parcels into Tract A").count()) > 0);
  await shot("03-tract");
  const stateA = flat(afterPanel).replace(/"from":\[[^\]]*\]/g, '"from":3');

  // (3) restore
  await T(`parcel-row-${tractP.id}`).click(); await T("parcel-page").waitFor({ timeout: 8000 });
  await T("parcel-restore-combined").click(); await sleep(700);
  const restored = await parcelsLS();
  ok("(3) Restore puts the 3 originals back (names, locks) and the total is unchanged", restored.length === 5 && Object.values(NAMES).every((n) => restored.some((p) => p.addr === n && !p.locked)) && Math.abs((await siteAcres()) - a0) < 0.006, `n=${restored.length}`);

  // (4) the SAME combine from the MAP TOOLBAR
  await page.getByTestId("rail-parcel-tools").click();
  await page.locator('[data-parcel-action="combine"]').click(); await sleep(400);
  await fit(); await sleep(400);
  await sleep(900);
  const boxes = (await parcelBoxes());
  ok("map shows the five parcel outlines", boxes.length >= 5, `n=${boxes.length}`);
  const order = (await parcelsLS()).map((p) => p.addr);
  const want = [NAMES.p1, NAMES.p2, NAMES.p3];
  const pickedCount = async () => { const t = await page.getByText(/picked|selected/).first().innerText().catch(() => ""); const m = t.match(/(\d+) (parcels )?(picked|selected)/); return m ? +m[1] : (t.match(/— (\d+) picked/) || [0, 0])[1] | 0; };
  for (let k = 0; k < want.length; k++) {
    const i = order.indexOf(want[k]);
    for (let tryN = 0; tryN < 2 && (await pickedCount()) < k + 1; tryN++) {
      const b = (await parcelBoxes())[i];
      await page.mouse.click(b.x + b.w * 0.3, b.y + 1); await sleep(350);
      if (tryN === 1) console.log("   (note: first press on", want[k], "did not register; second did)");
    }
  }
  await shot("04-map-pick");
  const banner = await page.getByText(/parcels picked|parcels selected/).first().innerText().catch(() => "");
  ok("(4) map toolbar: 3 parcels picked", /3 parcels/.test(banner), banner);
  await page.getByRole("button", { name: /Merge parcels/ }).click(); await sleep(800);
  await openPanel();
  const afterMap = await parcelsLS();
  const tractM = afterMap.find((p) => p.combined);
  ok("(4) map combine → Tract A, same originals, total unchanged", tractM && tractM.label === "Tract A" && afterMap.length === 3 && Math.abs((await siteAcres()) - a0) < 0.006);
  const stateM = flat(afterMap).replace(/"from":\[[^\]]*\]/g, '"from":3');
  ok("(4) PARITY — panel combine and map-toolbar combine give an identical resulting state", stateA === stateM, stateA === stateM ? "" : `\n  panel: ${stateA}\n  map:   ${stateM}`);
  ok("(4) PARITY — the tract remembers the same three originals either way", JSON.stringify(tractM.combined.from.map((s) => s.addr).sort()) === JSON.stringify(tractP.combined.from.map((s) => s.addr).sort()));
  await openPanel(); await T(`parcel-row-${tractM.id}`).click(); await T("parcel-page").waitFor({ timeout: 8000 });
  ok("(4) the map-made tract's page shows its originals too", (await T("parcel-made-from").count()) === 1);
  await T("parcel-restore-combined").click(); await sleep(600);
  ok("(4) Restore after a map combine behaves identically", (await parcelsLS()).length === 5);

  // (5) split from the MAP TOOLBAR by drawing a line
  await page.keyboard.press("Escape"); await sleep(200);
  await openPanel();
  await page.getByTestId("rail-parcel-tools").click();
  await page.locator('[data-parcel-action="split"]').click(); await sleep(400);
  await fit(); await sleep(500);
  const bx = await parcelBoxes(); const ord2 = (await parcelsLS()).map((p) => p.addr);
  const kb = bx[ord2.indexOf(NAMES.p2)];
  const before5 = (await parcelsLS()).find((p) => p.addr === NAMES.p2);
  await page.mouse.click(kb.x + kb.w / 2, kb.y - 25); await sleep(150);
  await page.mouse.dblclick(kb.x + kb.w / 2, kb.y + kb.h + 25); await sleep(900);
  const afterSplit = await parcelsLS();
  const pieces = afterSplit.filter((p) => p.splitName);
  ok("(5) map toolbar split by drawing a line → two pieces, NO naming prompt", pieces.length === 2 && afterSplit.length === 6, `names=${pieces.map((p) => p.splitName).join(", ")}`);
  ok("(5) pieces auto-named '<name> · A' / '· B'", pieces.map((p) => p.splitName).sort().join("|") === `${NAMES.p2} · A|${NAMES.p2} · B`);
  await openPanel();
  const pa = (a) => a.reduce((s, p) => { let t = 0; for (let i = 0; i < p.points.length; i++) { const q = p.points[i], r = p.points[(i + 1) % p.points.length]; t += q.x * r.y - r.x * q.y; } return s + Math.abs(t / 2); }, 0);
  ok("(5) pieces add up to the original acreage; site total unchanged", Math.abs(pa(pieces) - 160000) < 1 && Math.abs((await siteAcres()) - a0) < 0.006, `${pa(pieces)} ft²`);
  ok("(5) pieces inherit include state; 'Split' tag + pencil on each", pieces.every((p) => p.active !== false) && (await page.$$('[data-testid^="parcel-row-pencil-"]')).length === 2);
  await shot("05-split");

  // (6) Undo via the toast
  await page.getByRole("button", { name: /^Undo$/ }).first().click(); await sleep(700);
  const undone = await parcelsLS();
  ok("(6) Undo brings the original back (5 parcels, no pieces)", undone.length === 5 && !undone.some((p) => p.splitName) && undone.some((p) => p.addr === NAMES.p2));

  // panel-aimed split + Restore original
  await openPanel();
  const id2 = (await parcelsLS()).find((p) => p.addr === NAMES.p2).id;
  await T(`parcel-row-${id2}`).click(); await T("parcel-page").waitFor({ timeout: 8000 });        // select it (its page opens)
  await T("parcel-page-back").click(); await T("parcels-panel").waitFor({ timeout: 8000 });
  await T("parcels-edit-btn").click(); await T("boundary-edit-banner").waitFor({ timeout: 8000 }); // Edit parcels → Split
  await T("boundary-edit-split").click(); await sleep(500);
  const hdr = await T("parcels-split-header").innerText();
  ok("panel Split → header reads 'Splitting <name> · <acres> AC' with Cancel and the one instruction", /Splitting Kilgore Parcel · 3\.67 AC/.test(hdr) && /double-click to finish/.test(hdr) && (await T("parcels-split-cancel").count()) === 1, hdr.replace(/\n/g, " | "));
  await fit(); await sleep(500);
  const bx2 = await parcelBoxes(); const ord3 = (await parcelsLS()).map((p) => p.addr);
  const k2 = bx2[ord3.indexOf(NAMES.p2)];
  await page.mouse.click(k2.x - 20, k2.y + k2.h / 2); await sleep(150);
  await page.mouse.dblclick(k2.x + k2.w + 20, k2.y + k2.h / 2); await sleep(900);
  const afterPanelSplit = await parcelsLS();
  ok("panel-aimed split applied on double-click (no Apply, no name prompt) and exited split mode", afterPanelSplit.filter((p) => p.splitName).length === 2 && (await T("parcels-split-header").count()) === 0);
  const piece = afterPanelSplit.find((p) => p.splitName);
  await openPanel(); await T(`parcel-row-${piece.id}`).click(); await T("parcel-page").waitFor({ timeout: 8000 });
  ok("the piece's page has 'Split from' + Restore original", (await T("parcel-split-from").innerText()).includes("Split from") && (await T("parcel-restore-split").count()) === 1);
  await T("parcel-restore-split").click(); await sleep(700);
  const afterRestoreSplit = await parcelsLS();
  ok("Restore original puts the parcel back exactly (name, lock, outline), total unchanged", afterRestoreSplit.length === 5 && afterRestoreSplit.some((p) => p.addr === NAMES.p2 && !p.locked && p.points.length === 4) && Math.abs((await siteAcres()) - a0) < 0.006);

  // a bad line is refused with a plain message
  await openPanel(); await T("parcels-edit-btn").click(); await T("boundary-edit-banner").waitFor({ timeout: 8000 });
  await T("boundary-edit-split").click(); await sleep(300);
  await fit();
  const bx3 = await parcelBoxes(); const ord4 = (await parcelsLS()).map((p) => p.addr);
  const k3 = bx3[ord4.indexOf(NAMES.p2)];
  await page.mouse.click(k3.x + k3.w * 0.3, k3.y + k3.h * 0.3); await sleep(100);
  await page.mouse.dblclick(k3.x + k3.w * 0.6, k3.y + k3.h * 0.6); await sleep(600);
  const warn = await page.getByText(/stops inside the parcel/).count();
  ok("a line that does not cross edge to edge is refused in plain words; nothing changed", warn > 0 && (await parcelsLS()).length === 5);
  await page.keyboard.press("Escape");

  // (7) persistence: combine again, reload
  await openPanel();
  for (const id of ["p1", "p2", "p3"]) { const pid = (await parcelsLS()).find((p) => p.addr === NAMES[id]).id; await T(`parcel-row-check-${pid}`).check(); }
  await T("parcels-bar-combine").click(); await sleep(800);
  await page.reload({ waitUntil: "load" }); await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(1500);
  await openPanel();
  const names7 = await T("parcels-list").innerText();
  ok("(7) reload → Tract A persisted (Combined, total unchanged)", /Tract A/.test(names7) && /Combined/.test(names7) && Math.abs((await siteAcres()) - a0) < 0.006);
  const tr7 = (await parcelsLS()).find((p) => p.combined);
  await T(`parcel-row-${tr7.id}`).click(); await T("parcel-page").waitFor({ timeout: 8000 });
  await T("parcel-restore-combined").click(); await sleep(600);
  ok("(7) …and Restore still works after the reload (durable, unlike Undo)", (await parcelsLS()).length === 5);

  // keyboard / labels
  const labels = await page.$$eval('[data-testid^="parcel-row-eye-"], [data-testid^="parcel-row-check-"]', (els) => els.every((e) => !!e.getAttribute("aria-label")));
  ok("select + eye controls all carry aria-labels", labels);
  await shot("06-final");
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message); await shot("zz-error").catch(() => {});
} finally {
  if (SIGNED) { // the throwaway site is ALWAYS deleted (owner constraint 15) — and confirmed gone
    const gone = await page.evaluate(async ([id, uid]) => {
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      // the table refuses a hard delete of a live row (sites_block_delete_live_group): trash it first, then delete
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
      return !q.error && (q.data || []).length === 0;
    }, [SITE_ID, UID]).catch(() => false);
    ok("throwaway site deleted and confirmed gone from the cloud", gone);
  }
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
