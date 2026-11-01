/* verify-indent-geometry-live — B2525585 / V1966721, driven LIVE as the test account on planyr.io. PORTED to the Univer grid (NEW-2, 2026-10-31).
 *
 * Seeds a THROWAWAY project through the app's own local-cache path, opens its Spreadsheet (the Univer canvas) and proves, on the owner's exact
 * layout (label in B with an EMPTY C and the amount in D; a second label with a filled C): Increase indent moves the painted text one step per
 * press, an indent never changes a cell's width or any other cell's position (every cell rectangle in the row stays on Univer's column grid,
 * at 1 and at 12 steps), Decrease indent returns it, a multi-cell selection steps each cell from its own level, undo/redo are exact, and the
 * indent survives a reload. Geometry = Univer's cell rectangles (facade) + the painted ink of the label (screenshot pixels); real mouse + keys.
 * KNOWN-GOOD ARMS: the run is VOID unless the unindented rows already sit on the column grid, and unless the filled-neighbour row (which the
 * owner reports as working) passes. The throwaway project (site row + model_sheets row) is ALWAYS deleted and confirmed gone (constraint 15).
 * Usage (live):  BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-indent-geometry-live.mjs
 *       (local, no sign-in):  node ui-audit/verify-indent-geometry-live.mjs --local http://localhost:4173 */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import {
  launchLocalHarness, gotoSpreadsheet, enter, clickCell, modClickCell, press, cellInk, parkCursor, rowGeometry, clickUniverCommand, flushGrid, waitForGrid,
} from "../e2e/lib/univerGrid.js";

const argv = process.argv.slice(2);
const LOCAL = argv.includes("--local");
const BASE = (argv.find((a) => /^https?:/.test(a)) || process.env.BASE_URL || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-indent-" + Math.random().toString(36).slice(2, 7);
const NAME = "ZZ Indent live (throwaway)";
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
const INC = "planyr.sheet.command.increase-indent", DEC = "planyr.sheet.command.decrease-indent";
const CURRENCY = "Control+Shift+$";
const press_ = async (cmd, n = 1) => { for (let i = 0; i < n; i++) await clickUniverCommand(page, cmd); };
const near = (got, want) => Math.abs(got - want) <= 1.5;   // anti-aliasing: ±1 px on a painted edge
/** Every cell of the row sits where Univer's column widths say (x == running sum, w == column width). */
const aligned = (rects) => { let x = rects[0].x; return rects.every((r) => { const good = Math.abs(r.x - x) < 0.01 && Math.abs(r.w - r.colW) < 0.01; x += r.colW; return good; }); };
const edges = async (r) => { await parkCursor(page); return rowGeometry(page, r, 6); };
const ink = async (r, c) => { await parkCursor(page); return (await cellInk(page, r, c)).left; };
const ALL = [2, 3];
// rows are 0-based: B3 = (2,1) "Reimbursables" (C3 empty, amount in D3), B4 = (3,1) "Traffic Study" (amount in C4)

try {
  if (!LOCAL) await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planyr:freshProjects:v1", JSON.stringify([st.id])); }, [UID, site]);
  await gotoSpreadsheet(page, BASE, SITE_ID, "spreadsheet");
  await sleep(1000);
  await assertMeasurable(page, "verify-indent-geometry-live");
  console.log("served chunks (same call as the assertions):", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /ModelApp|UniverSheet|index-/.test(x)).slice(0, 3))), "| version.json:", JSON.stringify(s.build || null));

  await enter(page, 2, 1, "Reimbursables"); await enter(page, 2, 3, "2000"); await clickCell(page, 2, 3); await press(page, CURRENCY);
  await enter(page, 3, 1, "Traffic Study"); await enter(page, 3, 2, "75000"); await clickCell(page, 3, 2); await press(page, CURRENCY);
  for (const r of ALL) ok(`known-good: row ${r + 1} sits on the column grid before any indent`, aligned(await edges(r)));

  for (const [row, label] of [[3, "filled neighbour (reported as working)"], [2, "EMPTY neighbour (reported broken)"]]) {
    const geo0 = await edges(row);
    await clickCell(page, row, 1);
    const x0 = await ink(row, 1);
    await clickCell(page, row, 1); await press_(INC, 1);
    const x1 = await ink(row, 1);
    ok(`${label}: one press moves the text exactly one step`, near(x1 - x0, 14), `moved ${x1 - x0}`);
    const e1 = await edges(row);
    ok(`${label}: row still on the column grid and every rectangle unchanged after 1 step`, aligned(e1) && JSON.stringify(e1) === JSON.stringify(geo0));
    await clickCell(page, row, 1); await press_(INC, 11);
    const e12 = await edges(row);
    ok(`${label}: row still on the column grid and every rectangle unchanged after 12 steps`, aligned(e12) && JSON.stringify(e12) === JSON.stringify(geo0));
    ok(`${label}: the text stays inside its own cell on the left after 12 steps`, (await ink(row, 1)) >= e12[1].x);
    await clickCell(page, row, 1); await press_(DEC, 15);
    ok(`${label}: Decrease returns the text to where it started`, near(await ink(row, 1), x0) && aligned(await edges(row)));
  }

  // multi-cell: each cell steps from its own level
  await clickCell(page, 2, 1); await press_(INC, 2);
  await clickCell(page, 3, 1); await press_(INC, 4);
  const a0 = await ink(2, 1), b0 = await ink(3, 1);
  await clickCell(page, 2, 1); await modClickCell(page, 3, 1, "Shift");
  await press_(INC, 1);
  const a1 = await ink(2, 1), b1 = await ink(3, 1);
  ok("multi-cell: B3 and B4 each moved one step from their OWN level", near(a1 - a0, 14) && near(b1 - b0, 14), `${a1 - a0}, ${b1 - b0}`);
  for (const r of ALL) ok(`multi-cell: row ${r + 1} still on the column grid`, aligned(await edges(r)));

  await clickCell(page, 2, 1);
  await press(page, "Control+z"); await sleep(300);
  ok("Ctrl+Z restores the previous geometry exactly (one undo step per click)", near(await ink(2, 1), a0) && near(await ink(3, 1), b0));
  await clickCell(page, 2, 1);
  await press(page, "Control+y"); await sleep(300);
  ok("Ctrl+Y re-applies it exactly", near(await ink(2, 1), a1) && near(await ink(3, 1), b1));

  await flushGrid(page); await sleep(2500); // let the autosave settle before the reload
  await page.reload({ waitUntil: "load" });
  await waitForGrid(page); await sleep(800);
  ok("after a reload the indents are still drawn", near(await ink(2, 1), a1) && near(await ink(3, 1), b1));
  for (const r of ALL) ok(`after a reload row ${r + 1} is still on the column grid`, aligned(await edges(r)));
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
