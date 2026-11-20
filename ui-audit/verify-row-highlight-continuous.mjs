/* NEW-1 (Schedule grid) — a row's highlight runs edge to edge: the row-number (ID) cell, the Task cell and a
 * date cell must PAINT the same colour on every highlighted row, in every state the grid can be in.
 *
 * Owner report: the highlight coloured the row from the date columns rightward but stopped short of the ID
 * and Task cells. ROOT CAUSE (measured): the frozen ID/Task cells paint their own opaque background, built
 * from a CSS multi-layer `background-image` — and CSS paints the FIRST layer on TOP. The row colour was listed
 * first, so it covered the cell's own range-selection tint and per-cell fill; the unfrozen cells (a single
 * `background-color`) showed them. The row's own health colour was never the problem — that already matched.
 *
 * "Painted colour" is read the way the eye sees it: the top-most layer of the cell's background-image (a
 * solid gradient), else its background-colour, else — a transparent cell — the row's colour beneath it.
 *
 * KNOWN-GOOD ARM: the plain health-coloured rows (red / green / yellow / paused / zebra) already matched on
 * the pre-fix page and must report that; the run is VOID if they do not (DRIVER-SCROLL §6). The failing arms
 * on the pre-fix page are the range-selected and cell-filled rows.
 *
 *   node ui-audit/verify-row-highlight-continuous.mjs             [PW_CHROME=<chrome>]
 *   HTML=<path to an older index.html> node …                      (red-proof against the pre-fix source)
 *
 * LIVE MODE (V2063568): `E2E_LOGIN_KEY=… PLANYR_URL=https://planyr.io EXPECT_BUILD=<sha> node ui-audit/verify-row-highlight-continuous.mjs`
 * signs in as the test account (ui-audit/lib/signedInSession.mjs), seeds ONE throwaway cloud schedule from this fixture (the pattern of
 * verify-grid-strip.mjs), drives the DEPLOYED /sequence/ page with the same checks, reads /version.json in the same run, and soft-deletes
 * every schedule row it created (owner constraint 15). Never touches a real schedule.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = process.env.HTML || new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || (process.env.PW_CHROME_AUTO === "0" ? undefined : "/opt/pw-browsers/chromium");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const SHOTS = process.env.SHOTS_DIR || null;

const realBody = await readFile(HTML_PATH, "utf8");
await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(realBody))); return; }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(await readFile(fp));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/sequence/`;

const task = over => ({ start: "2026-01-01", end: "2026-01-01", duration: 1, predecessors: [], health: "gray",
  percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1,
  predUnresolved: [], meetingBodyMissing: false, finishConflict: false, startConflict: false, ...over });
const PINK = "#fbcfe8";
const fillRow = ks => Object.fromEntries(ks.map(k => [k, { fill: PINK }]));
// id → what it is. Names carry the scenario so a failure says which row.
const tasks = [
  task({ id: 1, name: "Parent expanded", isExpanded: true }),
  task({ id: 2, name: "child red", health: "red", parentId: 1 }),
  task({ id: 3, name: "child yellow", health: "yellow", parentId: 1 }),
  task({ id: 4, name: "grandparent", parentId: 1, isExpanded: true }),
  task({ id: 5, name: "grandchild green", health: "green", parentId: 4 }),
  task({ id: 6, name: "gray zebra A" }),
  task({ id: 7, name: "green", health: "green" }),
  task({ id: 8, name: "paused", health: "paused" }),
  task({ id: 9, name: "row colour", rowColor: "#fde68a" }),
  task({ id: 10, name: "cell fill ID..DUR on green", health: "green", cellFmt: fillRow(["id", "name", "start", "end", "duration"]) }),
  task({ id: 11, name: "locked + collapsed parent", health: "red", isExpanded: false, locked: true }),
  task({ id: 12, name: "collapsed child (hidden)", parentId: 11 }),
  task({ id: 13, name: "plain gray" }),
];
const COLS = ["id", "name", "start", "end", "duration", "predecessors", "successors", "health", "status", "responsibleParty", "cost", "notes", "percentComplete", "budget"];
const fixture = view => ({ aPid: 1, nPid: 2, nTid: 1000, view, section: "projects",
  projects: { 1: { id: 1, name: "Highlight Fixture", tasks, colConfig: { visible: COLS, widths: {} } } } });

const results = []; let voided = false;
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const LIVE = process.env.PLANYR_URL || null;
let browser = null, liveSession = null, liveBefore = null, liveId = null, liveBuild = null;
const liveIds = () => liveSession.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  liveSession = await openSignedIn({ base: LIVE, viewport: { width: 1280, height: 900 } });
  ok("[known-good] signed in as the test account", liveSession.proof.email === "e2e@planyr.test", liveSession.proof.email);
  liveBefore = new Set(await liveIds());
  // a first visit to /sequence/ creates ONE throwaway cloud row; overwrite it with the fixture
  const seedPage = await liveSession.page.context().newPage(); await seedPage.setViewportSize({ width: 1600, height: 950 });
  await seedPage.goto(LIVE + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedPage.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
  if (!(await seedPage.locator('[data-testid="open-history-desktop"]').count())) { await seedPage.getByRole("button", { name: "New schedule" }).click(); await pacedWait(seedPage, 3000); }
  await pacedWait(seedPage, 3000); await seedPage.close();
  const ids = (await liveIds()).filter(i => !liveBefore.has(i));
  if (ids.length !== 1) { console.log("expected exactly one throwaway schedule row, found " + JSON.stringify(ids)); process.exit(1); }
  liveId = ids[0];
  const seedErr = await liveSession.page.evaluate(async ({ id, fx }) => {
    const r = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single();
    if (r.error) return r.error.message;
    const u = await window.pfSupabase.from("schedules").update({ name: fx.name, data: { ...fx, id }, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row"); }, { id: liveId, fx: fixture("grid").projects[1] });
  if (seedErr) { console.log("could not seed the throwaway row: " + seedErr); process.exit(1); }
} else {
  browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
}
async function finish() {
  if (LIVE) {
    const created = (await liveIds()).filter(i => !liveBefore.has(i));
    const err = await liveSession.page.evaluate(async (ids) => { for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; } return null; }, created);
    const left = (await liveIds()).filter(i => !liveBefore.has(i));
    ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
    await liveSession.close();
  } else { await browser.close(); server.close(); }
}

async function openGrid(view, w, h) {
  const page = LIVE ? await liveSession.page.context().newPage() : await browser.newPage({ viewport: { width: w, height: h } });
  if (LIVE) await page.setViewportSize({ width: w, height: h });
  page.on("dialog", d => d.accept());      // the import asks "replace?" — dismissing it silently keeps the starter project
  page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));
  await page.goto(LIVE ? LIVE + "/sequence/" : URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-row-highlight-continuous");
  if (LIVE) {
    await pacedWait(page, 1800);
    liveBuild = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()).then(j => j.build).catch(() => "unreadable"));
    if (process.env.EXPECT_BUILD && !String(liveBuild).startsWith(process.env.EXPECT_BUILD.slice(0, 7))) throw new Error(`served build ${liveBuild} is not the expected ${process.env.EXPECT_BUILD} — void, not scored`);
    await page.locator(`.hdr-view button:has-text("${view === "grid" ? "Grid" : "Split"}")`).click(); await pacedWait(page, 900);
  } else {
    await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
    await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture(view))) });
    await pacedWait(page, 700);
    await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
    await page.locator(`.hdr-view button:has-text("${view === "grid" ? "Grid" : "Split"}")`).click(); await pacedWait(page, 600);
  }
  await page.waitForSelector('[data-grid-scroll="1"]');
  const names = await page.evaluate(() => [...document.querySelectorAll("[data-task-row] [data-col-key=name]")].map(n => n.innerText.trim().split("\n")[0]));
  if (!names.some(n => n.includes("child red"))) throw new Error("fixture did not load (starter project is showing) — void: " + names.slice(0, 3).join(" | "));
  return page;
}

// Read, for every task row: the PAINTED colour of the ID, Task and Start cells (see header) + whether the frozen
// cells are solid. Rows are matched by their Task text so a re-order cannot mislabel one.
const readRows = page => page.evaluate(() => {
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null; const p = m[1].split(",").map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hex = c => c ? `rgb(${c.r},${c.g},${c.b})` : "none";
  const painted = (cell, row) => {
    const cs = getComputedStyle(cell);
    const img = cs.backgroundImage;
    if (img && img !== "none") { const top = /linear-gradient\((rgba?\([^)]+\))/.exec(img); if (top) { const c = parse(top[1]); if (c && c.a === 1) return { c, how: "layer" }; } }
    const bc = parse(cs.backgroundColor); if (bc && bc.a === 1) return { c: bc, how: "color" };
    return { c: parse(getComputedStyle(row).backgroundColor), how: "row" };
  };
  const out = [];
  for (const row of document.querySelectorAll("[data-task-row]")) {
    const get = k => row.querySelector(`[data-col-key="${k}"]`);
    const id = get("id"), nm = get("name"), st = get("start"); if (!id || !nm || !st) continue;
    const solid = el => { const cs = getComputedStyle(el); const bc = parse(cs.backgroundColor); return cs.position === "sticky" && bc && bc.a === 1; };
    out.push({ name: nm.innerText.trim().split("\n").map(x => x.replace(/^[▾▸]\s*/, "").trim()).find(Boolean) || ("row " + row.getAttribute("data-task-row")), rowId: row.getAttribute("data-task-row"),
      id: hex(painted(id, row).c), nameBg: hex(painted(nm, row).c), start: hex(painted(st, row).c),
      idSolid: solid(id), nameSolid: solid(nm), idSticky: getComputedStyle(id).position === "sticky" });
  }
  return out;
});

const verdict = (tag, rows, { requireSolid = true } = {}) => {
  let bad = 0;
  for (const r of rows) {
    const same = r.id === r.nameBg && r.nameBg === r.start;
    // a row whose ID / Task cell is in a range that starts later (the ID cell is not selected) is not expected to match
    if (!same) { bad++; ok(`${tag} · "${r.name}" — ID, Task and Start paint one colour`, false, `id=${r.id} task=${r.nameBg} start=${r.start}`); }
  }
  if (!bad) ok(`${tag} · every row (${rows.length}) — ID, Task and Start paint one colour`, true);
  if (requireSolid) {
    const hollow = rows.filter(r => r.idSticky && !(r.idSolid && r.nameSolid));
    ok(`${tag} · frozen ID/Task cells stay solid (sticky, opaque background-colour)`, hollow.length === 0, hollow.map(r => r.name).join("; "));
  }
};

// ── Arm 0 (KNOWN-GOOD): resting grid, plain health / row-colour rows. Matched before the fix and must now.
let page = await openGrid("grid", 1280, 900);
await page.waitForSelector('[data-task-row]');
const resting = await readRows(page);
const byName = n => resting.find(r => r.name === n);
const expectColour = { "child red": "rgb(255,223,223)", "child yellow": "rgb(255,247,185)", "grandchild green": "rgb(214,250,226)", "green": "rgb(214,250,226)", "paused": "rgb(243,244,246)", "row colour": "rgb(253,230,138)" };
for (const [n, want] of Object.entries(expectColour)) { const r = byName(n); if (!r || r.id !== want) { voided = true; ok(`KNOWN-GOOD · "${n}" ID cell paints its own health/row colour`, false, `want ${want} got ${r && r.id}`); } }
if (voided) { console.log("RUN VOID — the known-good arm did not report its known colours; no score printed."); await finish(); process.exit(2); }
ok("KNOWN-GOOD · the plain health / row-colour rows paint their known colours on the ID cell", true);
// the filled row is the one that is allowed to differ from its health colour (it is pink on every filled cell)
verdict("grid 1280 · resting (no selection)", resting);
{ const r = byName("cell fill ID..DUR on green"); ok("grid 1280 · cell-filled row: the ID and Task cells show the PINK fill, not the green row colour", r && r.id === "rgb(251,207,232)" && r.nameBg === "rgb(251,207,232)", JSON.stringify(r)); }
if (SHOTS) await page.screenshot({ path: `${SHOTS}/resting.png` });

// ── Range selection across Task → Finish on rows 3..6 (a multi-row range): blue tint must reach the Task cell.
const rows = page.locator("[data-task-row]");
await rows.nth(2).locator('[data-col-key="name"]').click();
await page.keyboard.down("Shift"); await rows.nth(5).locator('[data-col-key="end"]').click(); await page.keyboard.up("Shift"); await pacedWait(page, 300);
{
  const r = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].slice(2, 6).map(row => {
    const g = k => row.querySelector(`[data-col-key="${k}"]`);
    const top = el => { const m = /linear-gradient\((rgba?\([^)]+\))/.exec(getComputedStyle(el).backgroundImage); return m ? m[1] : getComputedStyle(el).backgroundColor; };
    return { name: g("name").innerText.trim().split("\n")[0], task: top(g("name")), start: top(g("start")), end: top(g("end")), inRange: g("name").hasAttribute("data-cell-in-range") };
  }));
  const BLUE = "rgb(219, 234, 254)";
  const bad = r.filter(x => !(x.inRange && x.task === BLUE && x.start === BLUE && x.end === BLUE));
  ok("grid 1280 · range Task→Finish over 4 rows: the selection tint reaches the Task cell (same blue as Start/Finish)", bad.length === 0, JSON.stringify(bad));
}
// the ID cell is outside that range, so it keeps the row's colour — the range edge, not a dropped layer
if (SHOTS) await page.screenshot({ path: `${SHOTS}/range.png` });

// ── Full-row selection (click the ID cell): every cell of the row, ID and Task included, tinted alike.
await rows.nth(1).locator('[data-col-key="id"]').click(); await pacedWait(page, 300);
{
  const r = (await readRows(page)).find(x => x.name.startsWith("child red"));
  ok("grid 1280 · a whole selected row paints ID, Task and Start alike", r && r.id === r.nameBg && r.nameBg === r.start, JSON.stringify(r));
}
await page.close();

// ── Sideways scroll + vertical scroll under the sticky header, narrow pane (columns overflow, ID/Task frozen).
page = await openGrid("grid", 900, 520);
await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); g.scrollLeft = 420; g.scrollTop = 40; });
await pacedWait(page, 300);
const scrolled = await readRows(page);
ok("narrow pane · the grid really overflows and scrolled sideways (precondition)", await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); return g.scrollLeft > 100 && g.scrollWidth > g.clientWidth + 100; }));
verdict("grid 900×520 · scrolled sideways + 40 down", scrolled);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/scrolled.png` });
await page.close();

// ── The grid side of Split view.
page = await openGrid("split", 1280, 900);
verdict("split 1280 · grid side", await readRows(page));
await page.close();

if (LIVE) console.log("served build", liveBuild);
await finish();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
