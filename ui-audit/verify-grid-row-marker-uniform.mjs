/* NEW-1 (B2584496, Schedule grid) — the selected / hovered ROW MARKER is ONE continuous line: identical in colour, weight and
 * vertical position from the ID cell, through Task, and across every cell to the right. No visible change at the Task / Start boundary.
 *
 * Owner report (Grand Port / Groundbreaking Path, Grid, a Needs Attn. row selected by clicking its Dur cell, a zoomed browser):
 * "the task column gets a weird outline that doesn't match the rest of the cells" — the ID + Task part of the line looks thinner and
 * greyer, from Start rightward heavier and bluer.
 *
 * MEASURED (build 879a557): the marker pixel itself was the same colour on every cell, which is why ui-audit/verify-grid-filler-row-
 * marker.mjs (one pixel per edge, device pixel ratio 1, Start cell clicked) stayed green. The difference is the 1–2 pixels of GRID
 * LINE beside it: the line is a ::before inside each cell and the grid line is each cell's own border, and a frozen (sticky, opaque)
 * cell rasterises that border slightly differently from a plain one wherever the device pixel ratio is fractional (browser zoom 125 /
 * 150 / 175 %). At ratios 1 and 2 the row is already identical, so a lower-zoom Chrome shows nothing.
 *
 * WHAT IT ASSERTS. Per state, a short strip of the row's TOP edge and of its BOTTOM edge, under the ID cell and under the Task cell,
 * is compared with the same strip under a date cell: EVERY pixel within CIEDE2000 1.0 (the just-noticeable difference; chosen before any
 * candidate fix was measured, never tuned to a result) AND the repo's PERCEPTUAL-PARITY detail <= 6.0 / perceived <= 1.0 (ui-audit/lib/
 * perceptualDiff.mjs). Its third limit, the FRAME-MEAN <= 0.10, is deliberately NOT applied: it is defined for whole frames and is not
 * meaningful on a 20 x 6 pixel strip. Measured on the unfixed page the blurred bars alone are met (perceived 0.66) while single pixels
 * differ by up to ΔE00 2.8 (5.8 on the frozen right-hand Health cell) — so the single-pixel bar is the one that sees what the owner
 * reported. The line must look the same there as on a date cell. States: Needs Attn., plain, Complete and summary rows, hovered and selected
 * (the Dur cell clicked), a blank filler row and "+ New task" hovered; grid scrolled sideways 0 and 300; device pixel ratios 0.8
 * (browser zoom 80 %), 1, 1.25, 1.5, 1.6, 1.75, 2, 2.5.
 * KNOWN-GOOD arms (else the run is VOID, not scored): the marked row's edge strip is visibly darker than an idle row's; an idle row's is
 * not; and the Needs Attn. / Complete rows really carry their status tint (the case reported is on a status row, not a plain one).
 *
 *   node ui-audit/verify-grid-row-marker-uniform.mjs                  [DPRS=1.25,1.5] [HTML=<older index.html>] [SHOTS_DIR=<dir>]
 *   E2E_LOGIN_KEY=… PLANYR_URL=https://planyr.io EXPECT_BUILD=<sha> node ui-audit/verify-grid-row-marker-uniform.mjs
 *      LIVE: signs in as the test account, seeds ONE throwaway cloud schedule, drives the deployed /sequence/ (device pixel ratio set
 *      with Emulation.setDeviceMetricsOverride), reads /version.json in the same run, deletes the row it created (owner constraint 15).
 *      Never a real schedule.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { srgbToLab, deltaE2000, perceptualParity } from "./lib/perceptualDiff.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = process.env.HTML || new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS_DIR || null;
const LIVE = process.env.PLANYR_URL || null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

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
// 0 first row · 1 summary · 2 indented plain child · 3 indented needs-attn child · 4 plain · 5 green · then a few more; blank rows + "+ New task" follow below
const tasks = [
  task({ id: 11, name: "First row" }),
  task({ id: 1, name: "Summary parent" }),
  task({ id: 2, name: "child plain", parentId: 1 }),
  task({ id: 3, name: "child red", health: "red", start: "2025-01-01", end: "2025-01-10", duration: 7, parentId: 1 }),
  task({ id: 4, name: "plain" }),
  task({ id: 5, name: "green", health: "green" }),
  ...Array.from({ length: 7 }, (_, i) => task({ id: 6 + i, name: "filler task " + (i + 1) })),
];
const COLS = ["id", "name", "start", "end", "duration", "predecessors", "successors", "health", "status", "responsibleParty", "cost", "notes", "percentComplete", "budget"];
const fixture = view => ({ aPid: 1, nPid: 2, nTid: 1000, view, section: "projects", projects: { 1: { id: 1, name: "Marker Fixture", tasks, colConfig: { visible: COLS, widths: {} } } } });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const void_ = async why => { console.log(`VOID ⚠ — ${why} (no score printed)`); await finish(); process.exit(2); };

let browser = null, liveSession = null, liveBefore = null, liveBuild = null;
const liveIds = () => liveSession.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  liveSession = await openSignedIn({ base: LIVE, viewport: { width: 1280, height: 900 } });
  ok("[known-good] signed in as the test account", liveSession.proof.email === "e2e@planyr.test", liveSession.proof.email);
  liveBefore = new Set(await liveIds());
  const seedPage = await liveSession.page.context().newPage(); await seedPage.setViewportSize({ width: 1600, height: 950 });
  await seedPage.goto(LIVE + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedPage.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
  if (!(await seedPage.locator('[data-testid="open-history-desktop"]').count())) { await seedPage.getByRole("button", { name: "New schedule" }).click(); await pacedWait(seedPage, 3000); }
  await pacedWait(seedPage, 3000); await seedPage.close();
  const ids = (await liveIds()).filter(i => !liveBefore.has(i));
  if (ids.length !== 1) { console.log("expected exactly one throwaway schedule row, found " + JSON.stringify(ids)); process.exit(1); }
  const seedErr = await liveSession.page.evaluate(async ({ id, fx }) => {
    const r = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single();
    if (r.error) return r.error.message;
    const u = await window.pfSupabase.from("schedules").update({ name: fx.name, data: { ...fx, id }, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row"); }, { id: ids[0], fx: fixture("grid").projects[1] });
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

let curDpr = 1;
async function openGrid(view, w, h, dpr) {
  // the device pixel ratio IS the browser zoom (125 % zoom on a ratio-1 screen is ratio 1.25 and a narrower CSS window). It must be set on
  // the CONTEXT: an Emulation override on a page Playwright already sized is ignored by its screenshot (measured: every difference read 0.00).
  curDpr = dpr;
  let sess = null, ctx;
  if (LIVE) { const { openSignedIn } = await import("./lib/signedInSession.mjs"); sess = await openSignedIn({ base: LIVE, viewport: { width: w, height: h }, contextOptions: { deviceScaleFactor: dpr } }); ctx = sess.page.context(); }
  else ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  page.__done = async () => { await page.close(); if (sess) await sess.close(); else await ctx.close(); };
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));
  await page.goto(LIVE ? LIVE + "/sequence/" : URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-grid-row-marker-uniform");
  if (LIVE) {
    await pacedWait(page, 1800);
    liveBuild = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()).then(j => j.build).catch(() => "unreadable"));
    if (process.env.EXPECT_BUILD && !String(liveBuild).startsWith(process.env.EXPECT_BUILD.slice(0, 7))) throw new Error(`served build ${liveBuild} is not the expected ${process.env.EXPECT_BUILD} — void, not scored`);
  } else {
    await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
    await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture(view))) });
    await pacedWait(page, 700);
    await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
  }
  await page.locator(`.hdr-view button:has-text("${view === "grid" ? "Grid" : "Split"}")`).click(); await pacedWait(page, 700);
  await page.waitForSelector('[data-grid-scroll="1"]');
  const names = await page.evaluate(() => [...document.querySelectorAll("[data-task-row] [data-col-key=name]")].map(n => n.innerText));
  if (!names.some(n => n.includes("child red"))) throw new Error("fixture did not load (starter project is showing)");
  return page;
}


const BLANK = ".drow:not([data-task-row]):not([data-new-task-row])", TASKROW = "[data-task-row]", NEWROW = "[data-new-task-row]";
const DPRS = (process.env.DPRS || "0.8,1,1.25,1.5,1.75,2,2.5").split(",").map(Number);
const PIXEL_MAX_DE = 1.0;   // the CIE just-noticeable difference = the repo's PERCEIVED_MAX_DE; fixed BEFORE any candidate was measured, applied to every single pixel of the strip (no blur)
const MARGIN = 15;   // a marked edge has a pixel at least this much darker (red channel) than the SAME cell's idle-row edge (the marker is 148,163,184 at full coverage, fainter below a device pixel ratio of 1)

// geometry of one row: its device-pixel top/bottom and, per cell, whether it is frozen and the part of it actually visible
const geo = (page, sel, n) => page.evaluate(({ sel, n }) => {
  const row = [...document.querySelectorAll(sel)][n]; if (!row) return null;
  const rr = row.getBoundingClientRect(), kids = [...row.children].filter(c => !c.hasAttribute("data-grid-strip"));
  const gr = document.querySelector('[data-grid-scroll="1"]').getBoundingClientRect();
  const rects = kids.map(c => ({ c, r: c.getBoundingClientRect(), sticky: getComputedStyle(c).position === "sticky", active: c.hasAttribute("data-cell-active") }));
  const pinR = Math.max(gr.left, ...rects.filter(x => x.sticky).map(x => x.r.right));
  return { mk: row.style.getPropertyValue("--mk-top") === "0px" ? 0 : -1, bg: getComputedStyle(row).backgroundColor, top: rr.top, bottom: rr.bottom, vw: innerWidth,
    cells: rects.map(({ c, r, sticky, active }) => { const l = sticky ? r.left : Math.max(r.left, pinR), rt = Math.min(r.right, gr.right); return { k: c.getAttribute("data-col-key"), l: r.left, w: r.width, sticky, active, vl: l, vw: Math.max(0, rt - l) }; }) };
}, { sel, n });
const visibleIdx = (page, sel) => page.evaluate((sel) => {
  const g = document.querySelector('[data-grid-scroll="1"]').getBoundingClientRect();
  const hdr = Math.max(0, ...[...document.querySelectorAll("[data-hdr-col]")].map(h => h.getBoundingClientRect().bottom));
  return [...document.querySelectorAll(sel)].findIndex(r => { const b = r.getBoundingClientRect(); return b.top >= Math.max(g.top, hdr) + 2 && b.bottom <= Math.min(g.bottom, innerHeight) - 2; });
}, sel);
const png = async page => decodePng(await page.screenshot());
const away = async page => { await page.mouse.move(2, 2); await pacedWait(page, 250); };
const rowPoint = (g, k = 0) => { const c = g.cells.filter(x => !x.sticky && x.vw >= 6)[k]; return [Math.round(c.vl + Math.min(c.vw, 60) * 0.5), Math.round((g.top + g.bottom) / 2)]; };
const hoverRow = async (page, sel, n) => { const g = await geo(page, sel, n); const [x, y] = rowPoint(g); await page.mouse.move(x, y); await pacedWait(page, 250); return geo(page, sel, n); };
const clickDur = async (page, sel, n) => { const g = await geo(page, sel, n); const i = (await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")[0].children].filter(c => !c.hasAttribute("data-grid-strip")).map(c => c.getAttribute("data-col-key")))).indexOf("duration"); const c = g.cells[i]; await page.mouse.click(Math.round(c.vl + Math.min(c.vw, 40) * 0.5), Math.round((g.top + g.bottom) / 2)); await away(page); return geo(page, sel, n); };

// a strip of an RGBA image: device-pixel rows y0..y1, columns x0..x1
const strip = (p, x0, x1, y0, y1) => { const w = x1 - x0, h = y1 - y0, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y0 + y) * p.width + (x0 + x)) * p.channels, o = (y * w + x) * 4; out[o] = p.data[i]; out[o + 1] = p.data[i + 1]; out[o + 2] = p.data[i + 2]; out[o + 3] = 255; }
  return { width: w, height: h, channels: 4, data: out }; };
const minR = s => { let m = 255; for (let i = 0; i < s.data.length; i += 4) m = Math.min(m, s.data[i]); return m; };
// the edge strips of one row under a given cell: TOP (row top - 2 .. + 2 CSS px) and BOTTOM (row bottom - 3 .. + 1.5 CSS px), 20 CSS px wide.
// The window is defined in CSS pixels so it scales with the zoom: a fixed count of DEVICE pixels reaches into the row's text below a ratio of 1
// (measured: a 6-device-pixel window at 0.8 took in glyph descenders and read them as a marker difference).
const edgeStrips = (p, g, cell, S) => { const x0 = Math.round((cell.vl + 8) * S), x1 = x0 + Math.round(20 * S), t = g.top * S, b = g.bottom * S;
  return { top: strip(p, x0, x1, Math.round(t - 2 * S), Math.round(t + 2 * S)), bottom: strip(p, x0, x1, Math.round(b - 3 * S), Math.round(b + 1.5 * S)) }; };

let shotN = 0;
async function check(page, tag, g, opts = {}) {
  // ref: which sampled cell the ID / Task are compared with = the first plain cell that is not the active one
  const p = await png(page), S = p.width / g.vw;
  if (Math.abs(S - curDpr) > 0.02) await void_(`instrument: the screenshot is ${S.toFixed(3)} device pixels per CSS pixel, not the ${curDpr} this run claims — the ratio was not applied`);
  const vis = g.cells.map((c, i) => ({ c, i })).filter(x => x.c.vw >= 20);
  const idC = vis.find(x => x.i === 0 && x.c.sticky), taskC = vis.find(x => x.i === 1 && x.c.sticky);
  const plain = vis.filter(x => !x.c.sticky && !x.c.active && x.c.k !== "duration");   // never the clicked (Dur) column: it carries the row above's active-cell box
  if (!idC || !taskC || plain.length < 2) { await void_(`precondition: ${tag} — need the frozen ID and Task and two plain visible cells, have ${JSON.stringify({ id: !!idC, task: !!taskC, plain: plain.length })}`); }
  const R = edgeStrips(p, g, plain[0].c, S), R2 = edgeStrips(p, g, plain[1].c, S);
  // the marker is present on all four cells (else this is not the state under test)
  const cellsToCheck = [["ID", idC.c], ["Task", taskC.c], ["date", plain[0].c], ["date2", plain[1].c]];
  const idleG = await geo(page, TASKROW, 7), idleP = idleG ? edgeStrips(p, idleG, plain[0].c, S) : null;   // a row that is neither hovered nor selected, same x
  const missing = []; for (const [n, c] of cellsToCheck) { const e = edgeStrips(p, g, c, S); for (const k of ["top", "bottom"]) if (!(k === "top" && opts.skipTop) && !(minR(e[k]) <= minR(idleP[k]) - MARGIN)) missing.push(n + "." + k); }
  if (missing.length) { ok(`${tag} · the marker is painted on every sampled cell (top and bottom)`, false, "no marker on " + missing.join(" ")); return; }
  const bad = [], worst = {};
  for (const [n, c, base] of [["ID", idC.c, R], ["Task", taskC.c, R], ["date2", plain[1].c, R]]) {
    const e = edgeStrips(p, g, c, S);
    for (const k of ["top", "bottom"]) {
      if (k === "top" && opts.skipTop) continue;
      let m = 0; for (let i = 0; i < e[k].data.length; i += 4) m = Math.max(m, deltaE2000(srgbToLab(e[k].data[i], e[k].data[i + 1], e[k].data[i + 2]), srgbToLab(base[k].data[i], base[k].data[i + 1], base[k].data[i + 2])));
      const v = perceptualParity(e[k], base[k]);   // the repo's two-scale blurred bar; its FRAME-MEAN limit is not applied (see the header)
      worst[n + "." + k] = m;
      if (m > PIXEL_MAX_DE) bad.push(`${n}.${k}: a pixel differs by ΔE00 ${m.toFixed(2)} (bar ${PIXEL_MAX_DE})`);
      if (v.detail.maxDE > v.bars.DETAIL_MAX_DE) bad.push(`${n}.${k}: detail ΔE00 ${v.detail.maxDE} (bar ${v.bars.DETAIL_MAX_DE})`);
      if (v.perceived.maxDE > v.bars.PERCEIVED_MAX_DE) bad.push(`${n}.${k}: perceived ΔE00 ${v.perceived.maxDE} (bar ${v.bars.PERCEIVED_MAX_DE})`);
    } }
  if (process.env.DIAG) console.log(`   DIAG ${tag}: worst pixel ΔE00 ${Math.max(...Object.values(worst)).toFixed(2)} (${Object.entries(worst).sort((a, b) => b[1] - a[1])[0][0]})`);
  ok(`${tag} · the line looks the same under ID, Task and a date cell (top and bottom)`, bad.length === 0, bad.join(" | "));
  if (SHOTS && shotN++ < 40) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${LIVE ? "live-" : ""}${tag.replace(/[^a-z0-9.]+/gi, "_").slice(0, 90)}.png` }); }
}

async function runDpr(dpr) {
  const w = dpr < 1 ? 1600 : 1280, h = dpr < 1 ? 950 : 760;
  const page = await openGrid("grid", w, h, dpr);
  const sc = async l => { await page.evaluate(l => { const g = document.querySelector('[data-grid-scroll="1"]'); g.scrollLeft = l; g.scrollTop = 0; }, l); await pacedWait(page, 300); };
  const T = n => `dpr ${dpr} · ${n}`;
  // ---- KNOWN-GOOD + NEGATIVE arms
  await sc(0);
  { const gh = await hoverRow(page, TASKROW, 4);
    const p = await png(page), S = p.width / gh.vw;
    const idle = edgeStrips(p, await geo(page, TASKROW, 7), gh.cells[0], S);       // row 7 is neither hovered nor selected
    const hot = edgeStrips(p, gh, gh.cells.find(c => !c.sticky && c.vw >= 20), S);
    const idleHot = edgeStrips(p, await geo(page, TASKROW, 7), gh.cells.find(c => !c.sticky && c.vw >= 20), S);
    if (!(minR(hot.top) <= minR(idleHot.top) - MARGIN && minR(hot.bottom) <= minR(idleHot.bottom) - MARGIN)) await void_("known-good arm: a hovered row's edge strip is not darker than an idle row's — the instrument cannot see the marker (" + dpr + ")");
    if (minR(idle.top) < minR(idleHot.top) - 5 || minR(idle.bottom) < minR(idleHot.bottom) - 5) await void_("negative arm: two idle rows' edge strips differ — the instrument cannot tell on from off (" + dpr + ")");
    const tints = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].slice(0, 6).map(r => getComputedStyle(r).backgroundColor));
    if (tints[3] !== "rgb(255, 223, 223)" || tints[5] !== "rgb(214, 250, 226)") await void_("known-good arm: the Needs Attn. / Complete rows do not carry their status tint: " + JSON.stringify(tints));
    ok(T("known-good: a marked row's edge is darker than an idle row's; the status rows carry their tint"), true);
    await away(page); }
  const KINDS = [["Needs Attn.", 3], ["plain", 4], ["Complete", 5], ["summary", 1], ["first (top edge not compared: it abuts the sticky header)", 0]];
  for (const l of [0, 300]) {
    await sc(l);
    if (l > 0) { const sw = await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); return g.scrollWidth - g.clientWidth; }); if (sw < 50) { console.log(`NOTE — dpr ${dpr}: the grid fits this window (nothing to scroll sideways, ${sw}), so the scrolled states are not run here`); continue; } }
    for (const [name, n] of KINDS) {
      const first = n === 0;
      const g = await hoverRow(page, TASKROW, n); await check(page, T(`${name} row hovered · scrollLeft ${l}`), g, { skipTop: first });
      const gs = await clickDur(page, TASKROW, n); await check(page, T(`${name} row selected (Dur clicked) · scrollLeft ${l}`), gs, { skipTop: first });
    }
    const bi = await visibleIdx(page, BLANK);
    if (bi >= 0) { const g = await hoverRow(page, BLANK, bi); await check(page, T(`blank row hovered · scrollLeft ${l}`), g); }
    const ni = await visibleIdx(page, NEWROW);
    if (ni >= 0) { const g = await hoverRow(page, NEWROW, ni); await check(page, T(`"+ New task" row hovered · scrollLeft ${l}`), g); }
    await away(page);
  }
  await page.__done();
}

for (const dpr of DPRS) await runDpr(dpr);
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log("FAILED:\n" + failed.map(f => " - " + f.name).join("\n"));
await finish();
process.exit(failed.length ? 1 : 0);
