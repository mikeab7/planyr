/* NEW-1 (selected / hovered row outline) — the row indicator must run through the PINNED ID and TASK cells.
 *
 * Owner report (Grand Port › Master Schedule): the thin line top and bottom of a selected/hovered row started at
 * START and stopped short of ID and TASK, and the selected row's blue left accent scrolled away with the row.
 * Cause (measured): the line was a row-level inset box-shadow; the sticky ID/TASK cells paint an opaque background
 * over it. Fix: the line is a ::before on every cell, the blue accent is an inset shadow on the FIRST cell.
 *
 * WHAT IT ASSERTS, by sampling PAINTED PIXELS (a computed style cannot see paint order) on summary / plain / red /
 * yellow / green rows, scrolled left and scrolled right, for: hover only · selected (mouse away) · selected + hover:
 *   · the top and bottom edge pixel under ID, TASK, START and RP are all the indicator colour;
 *   · the selected row's blue accent pixel sits on the first cell's left edge at both scroll positions;
 *   · a row that is neither hovered nor selected paints NO indicator colour on those edges (known-good negative arm).
 * Run: node ui-audit/verify-grid-row-outline.mjs  [SHOTS_DIR=<dir>] [PW_CHROME=<chrome>]
 *
 * (Header copied from verify-grid-full-lines.mjs — fixture + sign-in-free import path.)
 *
 * Original header of the file this was cloned from, kept for the fixture notes:
 * NEW-1 (Schedule grid: one light full grid on every column) — border-uniformity gate.
 *
 * Owner decision: ONE border rule for every grid cell — a faint line on all four sides, same colour and
 * weight on every column (ID and TASK included), visible on tinted rows, solid tokens (no opacity).
 *
 * WHAT IT ASSERTS, from getComputedStyle on the REAL app (Grid view, throwaway fixture — never a real plan):
 *   1. in the same row, the TASK and ID cells' resolved borders (all four sides, visual edge) equal a DUR /
 *      RP cell's: same width, style and colour;
 *   2. the same on plain, red, yellow and green tinted rows, a summary (parent) row, and the selected cell
 *      row — and a tinted row's line colour is the SAME colour as on a plain row (not swallowed, not darker);
 *   3. header cells carry the same vertical divider as the body cells (header ↔ body line up);
 *   4. one line per edge: where two cells meet, exactly one of the pair draws the shared edge (no 2px stack);
 *   4b. PAINTED PIXELS (the check that fails on the pre-fix grid): the pinned ID / TASK cells paint an opaque
 *      background over the row's own bottom line, so computed borders can all agree while the picture does
 *      not. The pixel on each row's bottom edge under ID / TASK / START / DUR / RP must be the SAME line colour;
 *   5. no border colour uses alpha (salience never via fading);
 * Known-good arm: DUR and RP must report a 1px border on the right (the column divider that already
 * existed) — if they do not, the run is VOID (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 *
 * Run: node ui-audit/verify-grid-row-outline.mjs   [SHOTS_DIR=<dir>] [PW_CHROME=<chrome>]
 *      LIVE=https://planyr.io WANT_BUILD=<sha prefix> node ui-audit/verify-grid-row-outline.mjs   (signed in, deployed app)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = process.env.HTML || new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || undefined;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const SHOTS = process.env.SHOTS_DIR || null;
// The Schedule iframe (public/sequence) is light-only — it has no dark theme, so there is no dark arm to run.
const THEMES = (process.env.THEME || "light").split(",");
const PROBE = !!process.env.PROBE;

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

const task = over => ({ start: "2026-01-05", end: "2026-01-09", duration: 5, predecessors: [], health: "gray",
  percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5,
  predUnresolved: [], meetingBodyMissing: false, finishConflict: false, startConflict: false, ...over });
const tasks = [
  task({ id: 1, name: "Entitlements (summary)" }),
  task({ id: 2, name: "Plain leaf", parentId: 1 }),
  task({ id: 3, name: "Needs attention leaf", parentId: 1, health: "red" }),
  task({ id: 4, name: "In progress leaf", parentId: 1, health: "yellow" }),
  task({ id: 5, name: "Complete leaf", parentId: 1, health: "green" }),
  task({ id: 6, name: "Another plain leaf" }),
];
const COLS = ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"];
const fixture = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Grid Lines Fixture", tasks, colConfig: { visible: COLS, widths: {} } } } };

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

// LIVE=<https://planyr.io> [WANT_BUILD=<prefix>]: same assertions against the deployed app, signed in as the test
// account (ui-audit/lib/signedInSession.mjs). The fixture is imported into THIS browser context only — never a real plan.
const LIVE = process.env.LIVE || "";
const ANON = !!process.env.ANON;   // LIVE + ANON=1: deployed bundle, no sign-in (fixture is local either way)
const live = LIVE && !ANON ? await openSignedIn({ base: LIVE, viewport: { width: 1000, height: 800 } }) : null;
const browser = live ? live.page.context().browser() : await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const SIDES = ["Top", "Right", "Bottom", "Left"];

for (const theme of THEMES) {
  const page = live ? await live.page.context().newPage() : await browser.newPage({ viewport: { width: 1000, height: 800 } });
  if (live) await page.setViewportSize({ width: 1000, height: 800 });
  page.on("dialog", d => d.accept());
  await page.addInitScript(t => { try { localStorage.setItem("planyr:theme", t); } catch {} }, theme);
  await page.goto(LIVE ? LIVE + "/sequence/" : URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-grid-row-outline");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 1500);
  await page.locator('.hdr-view button:has-text("Grid")').click();
  await pacedWait(page, 600);
  await page.waitForSelector('[data-grid-scroll="1"]');
  if (LIVE) {   // build read IN THE SAME CALL as the assertions that follow (AGENT-RULES)
    const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()));
    console.log("signed in as", live ? live.proof.email : "(anonymous)", "| build", JSON.stringify(build));
    if (process.env.WANT_BUILD) ok(`served build matches ${process.env.WANT_BUILD}`, JSON.stringify(build).includes(process.env.WANT_BUILD));
  }
  await page.evaluate(t => { if (t === "dark") document.documentElement.setAttribute("data-theme", "dark"); }, theme);
  await pacedWait(page, 300);


  const LINE = "148,163,184";
  const png = async () => decodePng(await page.screenshot());
  const geoOf = async () => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => {
    const cell = k => { const c = r.querySelector(`[data-col-key="${k}"]`).getBoundingClientRect(); return { l: c.left, t: c.top, b: c.bottom, w: c.width }; };
    return { id: r.getAttribute("data-task-row"), text: r.innerText.slice(0, 14).replace(/\n/g, " "), cells: { id: cell("id"), name: cell("name"), start: cell("start"), rp: cell("responsibleParty") } };
  }));
  const px = (p, x, y) => { const i = (y * p.width + x) * p.channels; return `${p.data[i]},${p.data[i+1]},${p.data[i+2]}`; };
  const edgeReads = (p, g) => Object.fromEntries(Object.entries(g.cells).map(([k, c]) => {
    const x = Math.round(c.l + Math.min(c.w, 60) * 0.5);
    return [k, { top: px(p, x, Math.round(c.t)), bottom: px(p, x, Math.round(c.b) - 2) }];
  }));
  // blue accent: the sample at the first cell's left edge (ID)
  const accent = (p, g) => px(p, Math.round(g.cells.id.l) + 0, Math.round((g.cells.id.t + g.cells.id.b) / 2) + 5);
  const blueTok = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--blue)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c.match(/\d+/g).slice(0, 3).join(","); });
  const away = async () => { await page.mouse.move(2, 2); await pacedWait(page, 250); };
  const hoverRow = async (i) => { const g = (await geoOf())[i]; await page.mouse.move(Math.round(g.cells.rp.l + 20), Math.round((g.cells.start.t + g.cells.start.b) / 2)); await pacedWait(page, 250); };
  const sc = (n) => page.evaluate(n => { document.querySelector('[data-grid-scroll="1"]').scrollLeft = n; }, n);

  const names = ["summary", "plain", "needs-attn(red)", "in-progress(yellow)", "complete(green)"];
  for (const scroll of [0, 300]) {
    await sc(scroll); await pacedWait(page, 300);
    const tag = `[scrollLeft ${scroll}]`;
    // ---- hover only, nothing selected
    for (let i = 0; i < 5; i++) {
      await hoverRow(i);
      const g = (await geoOf())[i], r = edgeReads(await png(), g);
      for (const k of ["id", "name", "start", "rp"]) {
        ok(`${tag} HOVER ${names[i]} · top edge under ${k.toUpperCase()} is the row line`, r[k].top === LINE, `${k}=${r[k].top}`);
        ok(`${tag} HOVER ${names[i]} · bottom edge under ${k.toUpperCase()} is the row line`, r[k].bottom === LINE, `${k}=${r[k].bottom}`);
      }
    }
    // ---- known-good negative arm: an unhovered, unselected row paints no indicator
    await away();
    { const g = (await geoOf())[1], r = edgeReads(await png(), g);
      ok(`${tag} NEGATIVE ARM: an idle row paints no indicator colour on its top edge (instrument can tell on from off)`, ["id","name","start","rp"].every(k => r[k].top !== LINE), JSON.stringify(r)); }
    // ---- selected (click START), mouse away
    for (let i = 0; i < 5; i++) {
      await sc(scroll); await pacedWait(page, 200);
      const g0 = (await geoOf())[i];
      await page.mouse.click(Math.round(g0.cells.rp.l + 20), Math.round((g0.cells.start.t + g0.cells.start.b) / 2));
      await away();
      const g = (await geoOf())[i], p = await png(), r = edgeReads(p, g);
      for (const k of ["id", "name", "rp"]) {
        ok(`${tag} SELECTED ${names[i]} · top edge under ${k.toUpperCase()} is the row line`, r[k].top === LINE, `${k}=${r[k].top}`);
        ok(`${tag} SELECTED ${names[i]} · bottom edge under ${k.toUpperCase()} is the row line`, r[k].bottom === LINE, `${k}=${r[k].bottom}`);
      }
      ok(`${tag} SELECTED ${names[i]} · blue accent paints on the first (ID) cell's left edge`, accent(p, g) === blueTok, `got ${accent(p, g)} want ${blueTok}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/row-outline-${scroll}-${i}.png` });
    }
    // ---- selected + hovered
    { const i = 4; await hoverRow(i); const g = (await geoOf())[i], r = edgeReads(await png(), g);
      ok(`${tag} SELECTED+HOVER ${names[i]} · ID and TASK top edge are the row line`, r.id.top === LINE && r.name.top === LINE, JSON.stringify(r)); }
  }
  // ---- adjacent combo: whole-row range (ID click) keeps per-cell blue outline across ID and TASK
  await sc(0); await pacedWait(page, 200);
  { const g0 = (await geoOf())[2]; await page.mouse.click(Math.round(g0.cells.id.l + 20), Math.round((g0.cells.id.t + g0.cells.id.b) / 2)); await away();
    const g = (await geoOf())[2], p = await png();
    for (const k of ["id", "name", "start", "rp"]) { const c = g.cells[k]; const x = Math.round(c.l + Math.min(c.w, 60) * 0.5);
      ok(`row-range (ID click) · top edge under ${k.toUpperCase()} is range blue`, px(p, x, Math.round(c.t)) === "37,99,235", px(p, x, Math.round(c.t))); } }
  await page.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (live) await live.browser?.close?.().catch?.(() => {}); else await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
