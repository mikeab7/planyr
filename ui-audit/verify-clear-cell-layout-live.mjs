/* verify-clear-cell-layout-live — B2525584 / V1966720, driven LIVE as the test account on planyr.io. PORTED to the Univer grid (NEW-2, 2026-10-31).
 *
 * Seeds a THROWAWAY project through the app's own local-cache path, opens its Spreadsheet (the Univer CANVAS — there are no cell nodes, so
 * "geometry" is what a person SEES: each cell's painted pixels + dark-ink extent, and Univer's own cell rectangles, read through the
 * facade handle `window.__planyrUniverRead` that is armed only because this harness sets `window.__PLANYR_E2E` before load), builds the
 * owner's layout (labels in B, currency amounts in C under a "Costs" header), then proves clearing / refilling the amount never moves the
 * label beside it: Delete, Backspace+Enter, cut+paste, right-click ▸ Clear ▸ Clear contents, Ctrl+Z, retype, an indented label, a label
 * longer than its column. Real mouse + real keys only (SYNTHETIC-KEYS-DONT-EDIT).
 * KNOWN-GOOD ARMS: the run is VOID unless (a) the served build is read in the same call, (b) the amount cell shows "$25,000.00" before the
 * clear, (c) editing the label itself DOES change its pixels (the instrument can see a change), (d) clearing the cell to the LEFT of the
 * label leaves it put. The throwaway project (site row + model_sheets row) is ALWAYS deleted and confirmed gone (constraint 15).
 * Usage (live):  BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-clear-cell-layout-live.mjs
 *       (local, no sign-in, against a preview):  node ui-audit/verify-clear-cell-layout-live.mjs --local http://localhost:4173 */
import { createHash } from "node:crypto";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import {
  launchLocalHarness, gotoSpreadsheet, enter, clickCell, press, rightClickCell, shown, cellInk, parkCursor, rowGeometry, clickUniverCommand, chooseFromToolbarMenu,
} from "../e2e/lib/univerGrid.js";

const argv = process.argv.slice(2);
const LOCAL = argv.includes("--local");
const BASE = (argv.find((a) => /^https?:/.test(a)) || process.env.BASE_URL || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-clearcell-" + Math.random().toString(36).slice(2, 7);
const NAME = "ZZ Clear-cell live (throwaway)";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: NAME, name: NAME, origin: null, county: "harris", parcels: [], els: [],
  markups: [], measures: [], callouts: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const s = LOCAL
  ? await launchLocalHarness(BASE, SITE_ID)
  : await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
console.log(LOCAL ? `LOCAL (no sign-in) against ${BASE}` : `signed in as ${s.proof.email} | served build ${JSON.stringify(s.build)}`);
const UID = LOCAL ? null : await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const hash = (b) => createHash("sha1").update(b).digest("hex");
const CURRENCY = "Control+Shift+$";
const INC = "planyr.sheet.command.increase-indent";

/** What a person sees on row r's cells A..D: Univer's rectangle + the painted text (ink extent + exact pixels). */
async function geometry(r, n = 4) {
  await parkCursor(page);
  const rects = await rowGeometry(page, r, n);
  const out = [];
  for (let c = 0; c < n; c++) { const k = await cellInk(page, r, c); out.push({ rect: rects[c], ink: { left: k.left, right: k.right, dark: k.dark }, pix: hash(k.buf) }); }
  return out;
}
const strip = (g, col) => g.map((x, i) => (i === col ? { rect: x.rect } : x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const put = (r, c, text) => enter(page, r, c, text);

try {
  if (!LOCAL) {
    // A brand-new project opens before its first write only if its id is in the "freshly minted" list
    // (projectModel.markProjectFreshlyMinted); without it a signed-in session reads "This project doesn't exist".
    await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planyr:freshProjects:v1", JSON.stringify([st.id])); }, [UID, site]);
  }
  await gotoSpreadsheet(page, BASE, SITE_ID, "spreadsheet");
  await sleep(1000);
  await assertMeasurable(page, "verify-clear-cell-layout-live");
  const build = await page.evaluate(() => ({ chunks: [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /ModelApp|UniverSheet|index-/.test(x)).slice(0, 3), canvas: !!document.querySelector('canvas[id^="univer-sheet-main-canvas"]'), oldGrid: !!document.querySelector('[data-testid="model-sheet"]') }));
  console.log("served chunks (same call as the assertions):", JSON.stringify(build.chunks), "| version.json:", JSON.stringify(s.build || null));
  ok("known-good: the Univer canvas is the grid (and the old DOM grid is not in the page)", build.canvas && !build.oldGrid);

  await put(0, 0, "Costs");
  const labels = ["Architectural", "Civil Engineering", "General"];
  for (let i = 0; i < 3; i++) {
    await put(1 + i, 1, labels[i]);
    await put(1 + i, 2, ["30000", "25000", "25000"][i]);
    await clickCell(page, 1 + i, 2); await press(page, CURRENCY);
  }
  ok("known-good: C3 shows $25,000.00 before the clear", (await shown(page, 2, 2)) === "$25,000.00");
  const before = await geometry(2);
  ok("known-good: the label has ink", before[1].ink.dark > 20);

  for (const [name, clear] of [
    ["Delete", async () => { await press(page, "Delete"); }],
    ["Backspace + Enter (Excel empties and opens the cell)", async () => { await press(page, "Backspace"); await press(page, "Enter"); }],
    ["cut + paste elsewhere (Excel blanks the source on paste)", async () => { await press(page, "Control+x"); await clickCell(page, 9, 6); await press(page, "Control+v"); }],
    ["right-click ▸ Clear ▸ Clear contents", async () => { await rightClickCell(page, 2, 2); await page.getByText("Clear", { exact: true }).last().hover(); await sleep(350); await page.getByText(/^Clear contents$/i).last().click(); await sleep(250); }],
  ]) {
    await put(2, 2, "25000"); await clickCell(page, 2, 2); await press(page, CURRENCY);
    await clickCell(page, 2, 2);
    await clear();
    await sleep(300);
    ok(`${name}: C3 is blank`, (await shown(page, 2, 2)) === "");
    ok(`${name}: the label's pixels + every cell box identical to before the clear`, same(strip(await geometry(2), 2), strip(before, 2)));
  }

  await put(2, 2, "25000"); await clickCell(page, 2, 2); await press(page, CURRENCY);
  ok("typing the value back: label unchanged", same(strip(await geometry(2), 2), strip(before, 2)));
  await clickCell(page, 2, 2); await press(page, "Delete"); await press(page, "Control+z"); await sleep(300);
  ok("Ctrl+Z after the clear: C3 restored with its currency format", (await shown(page, 2, 2)) === "$25,000.00");
  ok("Ctrl+Z after the clear: exact original geometry", same(await geometry(2), before));

  // known-good arms: the instrument sees a change to the label itself; a cell to the LEFT of the label does not move it
  await put(3, 1, "General Contractor");
  const g3 = await geometry(3);
  await put(3, 1, "General");
  const g3b = await geometry(3);
  ok("known-good arm: a different label has different pixels (the instrument sees changes)", g3b[1].pix !== g3[1].pix);
  await put(2, 0, "Phase 1");
  const g0 = await geometry(2);
  await clickCell(page, 2, 0); await press(page, "Delete"); await sleep(300);
  ok("known-good arm: clearing the cell LEFT of the label leaves it put", same(strip(await geometry(2), 0), strip(g0, 0)));

  // indented label keeps its indent when the neighbour empties
  await clickCell(page, 3, 1); await clickUniverCommand(page, INC); await clickUniverCommand(page, INC);
  const gi = await geometry(3);
  await clickCell(page, 3, 2); await press(page, "Delete"); await sleep(300);
  ok("indented label keeps its indent when the amount beside it is cleared", same(strip(await geometry(3), 2), strip(gi, 2)));
  // centred label
  await clickCell(page, 2, 1); await chooseFromToolbarMenu(page, "sheet.command.set-horizontal-text-align", "center");
  await put(2, 2, "25000");
  const gc = await geometry(2);
  await clickCell(page, 2, 2); await press(page, "Delete"); await sleep(300);
  ok("centred label keeps its position when the amount beside it is cleared", same(strip(await geometry(2), 2), strip(gc, 2)));

  // long label
  await put(1, 1, "Architectural and Landscape Services — Phase 1 Allowance (long)");
  const gl = await geometry(1);
  await clickCell(page, 1, 2); await press(page, "Delete"); await sleep(300);
  const ga = await geometry(1);
  ok("long label starts at the same point when its neighbour empties", ga[1].ink.left === gl[1].ink.left && same(ga[1].rect, gl[1].rect) && ga[2].ink.dark > gl[2].ink.dark, `ink left ${gl[1].ink.left} -> ${ga[1].ink.left}; spill ink ${gl[2].ink.dark} -> ${ga[2].ink.dark}`);

  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
} finally {
  if (!LOCAL) {
    const gone = await page.evaluate(async ([id, uid]) => {
      await window.pfSupabase.from("model_sheets").delete().eq("id", id);
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q1 = await window.pfSupabase.from("sites").select("id").eq("id", id);
      const q2 = await window.pfSupabase.from("model_sheets").select("id").eq("id", id);
      try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) { /* best effort */ }
      return !q1.error && !q2.error && (q1.data || []).length === 0 && (q2.data || []).length === 0;
    }, [SITE_ID, UID]).catch(() => false);
    ok("throwaway project (site row + model_sheets row) deleted and confirmed gone from the cloud", gone);
  }
  await s.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
