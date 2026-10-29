/* verify-indent-geometry-live — B2525585 / V1966721, driven LIVE as the test account on planyr.io.
 *
 * Seeds a THROWAWAY project through the app's own local-cache path, opens its Spreadsheet and proves, on the
 * owner's exact layout (label in B with an EMPTY C and the amount in D; a second label with a filled C):
 * Increase indent moves the text one step per press, an indent never changes a cell's width or any other
 * cell's position (every cell edge in the row equals the column header's, at 1 and at 12 steps), Decrease
 * indent returns it, a multi-cell selection steps each cell from its own level, undo/redo are exact, and the
 * indent survives a reload. KNOWN-GOOD ARMS: the run is VOID unless the unindented rows already align with the
 * headers, and unless the filled-neighbour row (which the owner reports as working) passes. The throwaway
 * project (site row + model_sheets row) is ALWAYS deleted and confirmed gone (constraint 15).
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-indent-geometry-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-indent-" + Math.random().toString(36).slice(2, 7);
const NAME = "ZZ Indent live (throwaway)";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: NAME, name: NAME, origin: null, county: "harris", parcels: [], els: [],
  markups: [], measures: [], callouts: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
async function put(r, c, text) { await cell(r, c).click(); await page.keyboard.type(text); await page.keyboard.press("Enter"); }
const press = async (testid, n = 1) => { for (let i = 0; i < n; i++) await page.getByTestId(testid).click(); };
const edges = (r) => page.evaluate((row) => {
  const round = (x) => Math.round(x * 100) / 100;
  const out = { cells: [], headers: [] };
  for (let c = 0; c < 6; c++) {
    const e = document.querySelector(`[data-row="${row}"][data-col="${c}"]`).getBoundingClientRect();
    const h = document.querySelector(`[data-testid="model-col-header-${c}"]`).getBoundingClientRect();
    out.cells.push({ left: round(e.left), right: round(e.right) }); out.headers.push({ left: round(h.left), right: round(h.right) });
  }
  return out;
}, r);
const aligned = (e) => e.cells.every((c, i) => c.left === e.headers[i].left && c.right === e.headers[i].right);
const ink = (r, c) => page.evaluate(([row, col]) => {
  const el = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
  const rg = document.createRange(); rg.setStart(node, 0); rg.setEnd(node, 1);
  return Math.round(rg.getBoundingClientRect().left * 100) / 100;
}, [r, c]);
const ALL = [2, 3];

try {
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); }, [UID, site]);
  await page.goto(`${BASE}/#/project/${SITE_ID}/model`, { waitUntil: "load" });
  await page.getByTestId("model-sheet").waitFor({ timeout: 30000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-indent-geometry-live");
  console.log("served chunks (same call as the assertions):", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /ModelApp|index-/.test(x)).slice(0, 3))), "| version.json:", JSON.stringify(s.build));

  await put(2, 1, "Reimbursables"); await put(2, 3, "2000"); await cell(2, 3).click(); await page.getByTestId("ribbon-currency").click();
  await put(3, 1, "Traffic Study"); await put(3, 2, "75000"); await cell(3, 2).click(); await page.getByTestId("ribbon-currency").click();
  for (const r of ALL) ok(`known-good: row ${r + 1} aligned with the column headers before any indent`, aligned(await edges(r)));

  for (const [row, label] of [[3, "filled neighbour (reported as working)"], [2, "EMPTY neighbour (reported broken)"]]) {
    await cell(row, 1).click();
    const x0 = await ink(row, 1);
    await press("ribbon-indent-inc", 1);
    ok(`${label}: one press moves the text exactly one step`, (await ink(row, 1)) - x0 === 14, `moved ${(await ink(row, 1)) - x0}`);
    ok(`${label}: row still aligned with the headers after 1 step`, aligned(await edges(row)));
    await press("ribbon-indent-inc", 11);
    ok(`${label}: row still aligned with the headers after 12 steps`, aligned(await edges(row)));
    await press("ribbon-indent-dec", 15);
    ok(`${label}: Decrease returns the text to where it started`, (await ink(row, 1)) === x0 && aligned(await edges(row)));
  }

  // multi-cell: each cell steps from its own level
  await cell(2, 1).click(); await press("ribbon-indent-inc", 2);
  await cell(3, 1).click(); await press("ribbon-indent-inc", 4);
  const a0 = await ink(2, 1), b0 = await ink(3, 1);
  await cell(2, 1).click(); await cell(3, 1).click({ modifiers: ["Shift"] });
  await press("ribbon-indent-inc", 1);
  ok("multi-cell: B2 and B3 each moved one step from their OWN level", (await ink(2, 1)) - a0 === 14 && (await ink(3, 1)) - b0 === 14);
  for (const r of ALL) ok(`multi-cell: row ${r + 1} still aligned`, aligned(await edges(r)));

  const x3 = await ink(2, 1);
  await page.keyboard.press("Control+z"); await sleep(300);
  ok("Ctrl+Z restores the previous geometry exactly", (await ink(2, 1)) === a0 && (await ink(3, 1)) === b0);
  await page.keyboard.press("Control+y"); await sleep(300);
  ok("Ctrl+Y re-applies it exactly", (await ink(2, 1)) === x3);

  await sleep(2500); // let the autosave settle before the reload
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("model-sheet").waitFor({ timeout: 30000 }); await sleep(1500);
  ok("after a reload the indents are still drawn", (await ink(2, 1)) === x3);
  for (const r of ALL) ok(`after a reload row ${r + 1} is still aligned`, aligned(await edges(r)));
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
} finally {
  const gone = await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("model_sheets").delete().eq("id", id);
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q1 = await window.pfSupabase.from("sites").select("id").eq("id", id);
    const q2 = await window.pfSupabase.from("model_sheets").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q1.error && !q2.error && (q1.data || []).length === 0 && (q2.data || []).length === 0;
  }, [SITE_ID, UID]).catch(() => false);
  ok("throwaway project (site row + model_sheets row) deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
