/* B2445008 (×2) — "i still cant drop the rows under plan a" — the nest-under drop, driven on the owner's
 * REAL schedule structure (Grand Port › Master Schedule, 365 rows, its exact parent / collapse state —
 * ui-audit/lib/grandPortScheduleStructure.mjs), with real pointer movement in small steps.
 *
 * WHY THE FIRST FIX'S CHECKS MISSED IT. Both of its harnesses (verify-schedule-row-move.mjs §N and the
 * signed-in verify-schedule-row-nest-live.mjs) ran a 13-row fixture at the default 100% grid zoom and
 * started every drag on the 8px GRIP. Two things the owner's real use has and the fixture did not:
 *   1. GRID ZOOM. The grid scales itself with CSS `zoom` (Ctrl+wheel, kept per browser). The drop math
 *      divided VISUAL pointer pixels by the UNZOOMED row height, so at any zoom other than 100% the drop
 *      resolved to a different row from the one under the pointer — and the error grows with distance
 *      from the top of the list, so on a 365-row schedule scrolled to row ~150 it is several rows. With
 *      the selection directly above Plan A (his case), "a few rows above" is a DRAGGED row, which offers
 *      no drop at all: no nest box, nothing on release. At 100% the math is exact, which is why every
 *      check passed.
 *   2. THE ID CELL. He selects rows by clicking their ID numbers and drags by the same ID number
 *      (Microsoft Project's gesture). A press on an ID cell anywhere but its 8px grip started a NEW row
 *      SELECTION, so dragging it down onto Plan A extended the highlight over Plan A and never began a
 *      move at all.
 * Both are covered here, and both go red against the pre-fix source:
 *   node ui-audit/verify-schedule-nest-real-structure.mjs                 # the working tree (must pass)
 *   node ui-audit/verify-schedule-nest-real-structure.mjs --source 3a33571 # pre-fix main (must FAIL)
 *
 * Cases (each on a fresh page): his exact gesture (153…166 selected by ID click + shift-click, onto
 * Plan A directly below) from the grip and from the ID cell, at 100%, 89% and 125% grid zoom · a
 * selection two+ rows above the target · a selection BELOW the target dragged up · a single row · the
 * same in Split view. Each asserts the nest box sits on Plan A's row while hovered, the drop nests the
 * top-most selected rows under Plan A with their own children (collapsed ones still collapsed), one
 * Ctrl+Z restores the exact original structure, and a still press on an ID cell is a plain click.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { grandPortFixture } from "./lib/grandPortScheduleStructure.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const REPO_ROOT = new URL("../", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srcArg = process.argv.indexOf("--source");
const SOURCE_REF = srcArg > 0 ? process.argv[srcArg + 1] : null;
const body = SOURCE_REF
  ? execFileSync("git", ["show", `${SOURCE_REF}:public/sequence/index.html`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString("utf8")
  : await readFile(join(ROOT, "sequence/index.html"), "utf8");
console.log(`source: ${SOURCE_REF ? `git ${SOURCE_REF}` : "working tree"}`);

await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(Buffer.from(rewriteCdn(body))); }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const b = await readFile(fp); res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(b);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const browser = await chromium.launch({ executablePath: EXEC });

async function boot({ zoom = 1, view = "grid" } = {}) {
  const pg = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await pg.addInitScript(z => { try { localStorage.setItem("planar:viewPrefs:v1", JSON.stringify({ gridZoom: z })); } catch {} }, zoom);
  pg.on("dialog", d => d.accept());
  await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pg.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(pg, "verify-schedule-nest-real-structure");
  await pg.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(pg, 250);
  const fx = grandPortFixture({ rowHeight: 20 }); fx.view = view;
  await pg.setInputFiles('input[type="file"][accept=".json"]', { name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fx)) });
  await pacedWait(pg, 900);
  await pg.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(pg, 400);
  const z = await pg.evaluate(() => getComputedStyle(document.querySelector("[data-grid-scroll]")).zoom);
  if (Math.abs(Number(z) - zoom) > 0.005) throw new Error(`grid zoom did not take: wanted ${zoom}, got ${z}`);
  return pg;
}

// Every mounted row of the grid: { id, name, level, expanded } in visual order. Ids are renumbered by a
// move (id = index + 1), so structure is compared by NAME + LEVEL, never by id.
const rows = (pg) => pg.evaluate(() => [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")]
  .map(r => {
    const nameCell = r.querySelector('[data-col-key="name"]');
    const raw = nameCell?.innerText || "";
    const span = nameCell?.querySelector("span");
    const pl = span ? parseFloat(getComputedStyle(span).paddingLeft) : 0;
    return { id: Number(r.dataset.taskRow), top: parseFloat(r.style.top), name: raw.replace(/^[▾▸]\s*/, "").trim(), level: Math.round((pl - 4) / 14), expanded: raw.startsWith("▾") ? true : raw.startsWith("▸") ? false : null };
  }).sort((a, b) => a.top - b.top));
const rowByName = async (pg, name, nth = 0) => (await rows(pg)).filter(r => r.name === name)[nth] || null;

// Scroll the grid so the named row sits about a third of the way down the viewport — the place a
// person working this block would have it. Scrolling is done by the app's own scroller, not the driver.
async function scrollTo(pg, name) {
  for (let i = 0; i < 40; i++) {
    const r = await rowByName(pg, name);
    if (r) {
      await pg.evaluate(top => { const el = document.querySelector("[data-grid-scroll]"); el.scrollTop = Math.max(0, top - el.clientHeight / 3); }, r.top);
      await pacedWait(pg, 250);
      if (await rowByName(pg, name)) return;
    }
    await pg.evaluate(() => { const el = document.querySelector("[data-grid-scroll]"); el.scrollTop += el.clientHeight * 0.8; });
    await pacedWait(pg, 120);
  }
  throw new Error(`row "${name}" never came into view`);
}
const idCell = (pg, id) => pg.locator(`[data-grid-scroll] [data-task-row="${id}"] [data-col-key="id"]`).first();
const centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// Select a contiguous range the way he does: click the first row's ID number, shift-click the last's.
async function selectById(pg, firstName, lastName) {
  const a = await rowByName(pg, firstName), b = await rowByName(pg, lastName);
  const ab = await idCell(pg, a.id).boundingBox(), bb = await idCell(pg, b.id).boundingBox();
  await pg.mouse.click(ab.x + ab.width * 0.7, ab.y + ab.height / 2);
  await pacedWait(pg, 150);
  await pg.keyboard.down("Shift");
  await pg.mouse.click(bb.x + bb.width * 0.7, bb.y + bb.height / 2);
  await pg.keyboard.up("Shift");
  await pacedWait(pg, 200);
}

const nestState = (pg) => pg.evaluate(() => {
  const n = document.querySelector("[data-grid-scroll] [data-drag-nest]"), l = document.querySelector("[data-grid-scroll] [data-drag-insert-line]");
  const vis = e => !!e && getComputedStyle(e).display !== "none";
  const r = vis(n) ? n.getBoundingClientRect() : null;
  return { nest: vis(n), kind: n?.getAttribute("data-drag-nest-kind") || null, line: vis(l), top: r?.top ?? null, h: r?.height ?? null };
});

// Press at `from`, travel to the centre of `toName`'s row in small steps (real intermediate frames),
// settle, read the paint, release. Returns the paint read while hovering.
async function dragOnto(pg, from, toName) {
  const to = await rowByName(pg, toName);
  const tb = await pg.locator(`[data-grid-scroll] [data-task-row="${to.id}"]`).first().boundingBox();
  await pg.mouse.move(from.x, from.y);
  await pg.mouse.down();
  await pacedWait(pg, 60);
  const target = { x: tb.x + 300, y: tb.y + tb.height / 2 };
  const steps = Math.max(12, Math.round(Math.abs(target.y - from.y) / 6));
  await pg.mouse.move(target.x, target.y, { steps });
  await pacedWait(pg, 250);
  const paint = await nestState(pg);
  await pg.mouse.up();
  await pacedWait(pg, 600);
  return { paint, targetBox: tb };
}

const sig = (rs, from, to) => { const i = rs.findIndex(r => r.name === from), j = rs.findIndex(r => r.name === to); return rs.slice(i, j + 1).map(r => `${r.name}:${r.level}:${r.expanded}`).join(" | "); };
// The children of `parentName` (direct, by visual level) as "name:level" strings.
const childrenOf = (rs, parentName) => {
  const i = rs.findIndex(r => r.name === parentName); if (i < 0) return null;
  const L = rs[i].level, out = [];
  for (let k = i + 1; k < rs.length && rs[k].level > L; k++) if (rs[k].level === L + 1) out.push(rs[k].name);
  return out;
};

async function runCase(label, { zoom = 1, view = "grid", select, grab, target = "Plan A", expectChildren, expectTargetLevel }) {
  const pg = await boot({ zoom, view });
  try {
    await scrollTo(pg, "Kinder Morgan");
    const before = await rows(pg);
    const beforeSig = sig(before, "Pipeline Coordination & LONOs", "CenterPoint GTO");
    if (select) await selectById(pg, select[0], select[1]);
    const g = await rowByName(pg, grab.row);
    let from;
    if (grab.by === "grip") from = centreOf(await pg.locator(`[data-grid-scroll] [data-row-drag-handle="${g.id}"]`).first().boundingBox());
    else { const b = await idCell(pg, g.id).boundingBox(); from = { x: b.x + b.width * 0.7, y: b.y + b.height / 2 }; }
    const { paint, targetBox } = await dragOnto(pg, from, target);
    ok(`${label} · hovering the centre of "${target}" shows the "Nest inside" box ON that row`,
      paint.nest && paint.kind === "into" && !paint.line && Math.abs(paint.top - targetBox.y) < 3, JSON.stringify(paint) + ` targetTop=${targetBox.y.toFixed(1)}`);
    await scrollTo(pg, target);
    const after = await rows(pg);
    const kids = childrenOf(after, target);
    const tRow = after.find(r => r.name === target);
    ok(`${label} · the drop nests the top-most selected rows under "${target}", in order`,
      JSON.stringify(kids) === JSON.stringify(expectChildren) && tRow?.level === expectTargetLevel, `children=${JSON.stringify(kids)} level=${tRow?.level}`);
    if (expectChildren.includes("Kinder Morgan")) {
      const km = after.find(r => r.name === "Kinder Morgan"), ex = childrenOf(after, "Exxon");
      ok(`${label} · collapsed parents stay collapsed, expanded ones keep their children`, km?.expanded === false && ex?.length === 4, `KM expanded=${km?.expanded} Exxon kids=${ex?.length}`);
    }
    await pg.keyboard.press("Control+z");
    await pacedWait(pg, 600);
    await scrollTo(pg, "Kinder Morgan");
    const undone = sig(await rows(pg), "Pipeline Coordination & LONOs", "CenterPoint GTO");
    ok(`${label} · one Ctrl+Z restores the exact original structure`, undone === beforeSig, undone === beforeSig ? "" : `\n   before: ${beforeSig}\n   after : ${undone}`);
  } catch (e) {
    ok(`${label} · ran`, false, e.message.split("\n")[0]);
  } finally { await pg.close(); }
}

const HIS_KIDS = ["Kinder Morgan", "Enterprise", "Exxon", "Air Liquide"];
const HIS_SELECT = ["Kinder Morgan", "Set up meeting once we have pipeline depths"];
for (const zoom of [1, 0.89, 1.25]) {
  const z = `${Math.round(zoom * 100)}%`;
  await runCase(`HIS GESTURE @${z} · grip`, { zoom, select: HIS_SELECT, grab: { by: "grip", row: "Exxon" }, expectChildren: HIS_KIDS, expectTargetLevel: 1 });
  await runCase(`HIS GESTURE @${z} · ID cell`, { zoom, select: HIS_SELECT, grab: { by: "id", row: "Kinder Morgan" }, expectChildren: HIS_KIDS, expectTargetLevel: 1 });
}
await runCase("two+ rows above the target @89% · ID cell", { zoom: 0.89, select: ["Kinder Morgan", "Enterprise"], grab: { by: "id", row: "Enterprise" }, expectChildren: ["Kinder Morgan", "Enterprise"], expectTargetLevel: 1 });
await runCase("single row onto Plan A @89% · grip", { zoom: 0.89, grab: { by: "grip", row: "Surveying" }, expectChildren: ["Surveying"], expectTargetLevel: 1 });
await runCase("selection BELOW the target, dragged up @89% · ID cell", { zoom: 0.89, select: ["CenterPoint GTO", "Task 173"], grab: { by: "id", row: "CenterPoint GTO" }, expectChildren: ["CenterPoint GTO", "Task 173"], expectTargetLevel: 1 });
await runCase("HIS GESTURE in SPLIT view @89% · ID cell", { zoom: 0.89, view: "split", select: HIS_SELECT, grab: { by: "id", row: "Kinder Morgan" }, expectChildren: HIS_KIDS, expectTargetLevel: 1 });

// A still press on an ID cell inside the selection is a click: it selects that one row, moves nothing.
{
  const pg = await boot({ zoom: 1 });
  try {
    await scrollTo(pg, "Kinder Morgan");
    const beforeSig = sig(await rows(pg), "Pipeline Coordination & LONOs", "CenterPoint GTO");
    await selectById(pg, ...HIS_SELECT);
    const ex = await rowByName(pg, "Exxon");
    const b = await idCell(pg, ex.id).boundingBox();
    const cursor = await pg.evaluate(id => getComputedStyle(document.querySelector(`[data-grid-scroll] [data-task-row="${id}"] [data-col-key="id"]`)).cursor, ex.id);
    ok("an ID cell inside the multi-row selection shows the pick-up (grab) cursor", cursor === "grab", `cursor=${cursor}`);
    await pg.mouse.click(b.x + b.width * 0.7, b.y + b.height / 2);
    await pacedWait(pg, 300);
    const afterSig = sig(await rows(pg), "Pipeline Coordination & LONOs", "CenterPoint GTO");
    ok("a still click on an ID cell inside the selection is a click — nothing moves", afterSig === beforeSig);
  } catch (e) { ok("still-click case ran", false, e.message.split("\n")[0]); } finally { await pg.close(); }
}

await browser.close(); server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
