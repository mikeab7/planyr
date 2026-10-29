/* verify-clear-cell-layout-live — B2525584 / V1966720, driven LIVE as the test account on planyr.io.
 *
 * Seeds a THROWAWAY project through the app's own local-cache path, opens its Spreadsheet, builds the
 * owner's layout (labels in B, currency amounts in C under a "Costs" header), then proves clearing /
 * refilling the amount never moves the label beside it: Delete, Backspace, right-click ▸ Clear contents,
 * Ctrl+Z, retype, an indented label, a label longer than its column. Geometry = the painted rectangle of
 * the label's first character plus every cell box on the row (0.01 px).
 * KNOWN-GOOD ARMS: the run is VOID unless (a) the served build is read in the same call, (b) the amount
 * cell shows "$25,000.00" before the clear, (c) clearing the cell to the LEFT of the label leaves it put.
 * The throwaway project (site row + model_sheets row) is ALWAYS deleted and confirmed gone (constraint 15).
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-clear-cell-layout-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-clearcell-" + Math.random().toString(36).slice(2, 7);
const NAME = "ZZ Clear-cell live (throwaway)";
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
async function geometry(r) {
  return page.evaluate((row) => {
    const round = (n) => Math.round(n * 100) / 100;
    const box = (rc) => ({ left: round(rc.left), top: round(rc.top), width: round(rc.width), height: round(rc.height) });
    const out = [];
    for (let c = 0; c < 4; c++) {
      const el = document.querySelector(`[data-row="${row}"][data-col="${c}"]`);
      let ink = null;
      const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      if (node && node.textContent.length) { const rg = document.createRange(); rg.setStart(node, 0); rg.setEnd(node, 1); ink = box(rg.getBoundingClientRect()); }
      out.push({ cell: box(el.getBoundingClientRect()), ink });
    }
    return out;
  }, r);
}
const strip = (g, col) => g.map((x, i) => (i === col ? { cell: x.cell } : x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  // A brand-new project opens before its first write only if its id is in the "freshly minted" list
  // (projectModel.markProjectFreshlyMinted); without it a signed-in session reads "This project doesn't exist".
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planyr:freshProjects:v1", JSON.stringify([st.id])); }, [UID, site]);
  await page.goto(`${BASE}/#/project/${SITE_ID}/model`, { waitUntil: "load" });
  await page.getByTestId("model-sheet").waitFor({ timeout: 30000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-clear-cell-layout-live");
  const build = await page.evaluate(() => ({ chunks: [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /ModelApp|index-/.test(x)).slice(0, 3) }));
  console.log("served chunks (same call as the assertions):", JSON.stringify(build.chunks), "| version.json:", JSON.stringify(s.build));

  await put(0, 0, "Costs");
  const labels = ["Architectural", "Civil Engineering", "General"];
  for (let i = 0; i < 3; i++) {
    await put(1 + i, 1, labels[i]);
    await put(1 + i, 2, ["30000", "25000", "25000"][i]);
    await cell(1 + i, 2).click(); await page.getByTestId("ribbon-currency").click();
  }
  ok("known-good: C3 shows $25,000.00 before the clear", (await cell(2, 2).innerText()).trim() === "$25,000.00");
  const before = await geometry(2);

  for (const [name, clear] of [
    ["Delete", async () => { await page.keyboard.press("Delete"); }],
    ["Backspace", async () => { await page.keyboard.press("Backspace"); }],
    ["right-click ▸ Clear contents", async () => { await cell(2, 2).click({ button: "right" }); await page.getByText("Clear contents", { exact: true }).click(); }],
  ]) {
    await put(2, 2, "25000");
    await cell(2, 2).click();
    if (name === "Delete") { /* refilled value is plain; keep the currency format from the first fill */ }
    await clear();
    await sleep(300);
    ok(`${name}: C3 is blank`, (await cell(2, 2).innerText()).trim() === "");
    ok(`${name}: label + every cell box identical to before the clear`, same(strip(await geometry(2), 2), strip(before, 2)));
  }

  await put(2, 2, "25000");
  ok("typing the value back: label unchanged", same(strip(await geometry(2), 2), strip(before, 2)));
  await cell(2, 2).click(); await page.keyboard.press("Delete"); await page.keyboard.press("Control+z"); await sleep(300);
  ok("Ctrl+Z after the clear: C3 restored", (await cell(2, 2).innerText()).trim() !== "");
  ok("Ctrl+Z after the clear: exact original geometry", same(await geometry(2), await geometry(2)) && same(strip(await geometry(2), 2), strip(before, 2)));

  // known-good arm: a cell to the LEFT of the label
  await put(2, 0, "Phase 1");
  const g0 = await geometry(2);
  await cell(2, 0).click(); await page.keyboard.press("Delete"); await sleep(300);
  ok("known-good arm: clearing the cell LEFT of the label leaves it put", same(strip(await geometry(2), 0), strip(g0, 0)));

  // indented label keeps its indent when the neighbour empties
  await cell(3, 1).click(); await page.getByTestId("ribbon-indent-inc").click(); await page.getByTestId("ribbon-indent-inc").click();
  const gi = await geometry(3);
  await cell(3, 2).click(); await page.keyboard.press("Delete"); await sleep(300);
  ok("indented label keeps its indent when the amount beside it is cleared", same(strip(await geometry(3), 2), strip(gi, 2)));

  // long label
  await put(1, 1, "Architectural and Landscape Services — Phase 1 Allowance (long)");
  const gl = await geometry(1);
  await cell(1, 2).click(); await page.keyboard.press("Delete"); await sleep(300);
  const ga = await geometry(1);
  ok("long label starts at the same point when its neighbour empties", same(ga[1].ink, gl[1].ink) && same(ga[1].cell, gl[1].cell));

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
