/* SCHEDULE › the colour Permit / approval task icon — clipboard + approved seal + rubber stamp (NEW-1, owner-approved artwork 2026-11-13).
 *
 * Drives the REAL public/sequence/index.html and proves, one assertion at a time:
 *   A  the gap round the stamp is a TRUE cut-out: rasterised on a TRANSPARENT canvas, the pixels in the gap are alpha 0 while the
 *      board's fill and outline beside it, the clip, the seal, the check and the stamp are solid and in the approved colours
 *   B  the same on the actual page — on a normal, a HOVERED and a SELECTED row, in light AND with a dark row simulated, the gap pixels
 *      equal the row's own background beside the icon (no white halo), the stamp stays #d4506c and the board stays #e3f3fb
 *   C  the coloured parts are FIXED: their computed fills are identical in light and in the dark simulation
 *   D  the picker: Permit / approval is still offered (green "drawn for Planyr" dot, hover label, inline <svg>, Entitlements and permits),
 *      found by permit / approval / approved; picking it draws the new drawing before the task name
 *   E  what is STORED is the key `c:permit` — never markup — and a save → import round trip (the app's own path) brings it back
 *   F  a task that ALREADY used the permit icon shows the new 24x24 drawing, with no change to its stored data
 *   G  MANY permit icons on one page (rows, a collapsed phase's summary, the open picker): every mask id in the document is unique,
 *      every url(#id) resolves, every icon still shows its gap — and removing the first one from the page leaves every other one intact
 * KNOWN-GOOD ARM: the emoji row reports an <img> and no <svg>, the permit row an <svg> and no <img>; a run that cannot see both is VOID.
 * Teeth: PLANYR_PERMIT_MUTANT=1 serves a taskIcons.js whose gap is the "painted over" kind (no mask: a fixed white ring drawn under the
 * stamp) and A and B must go RED; PLANYR_PERMIT_MUTANT=2 serves one with a fixed mask id (no per-instance id) and G must go RED.
 *
 * Run: node ui-audit/verify-schedule-permit-icon.mjs   [--shots]   (PNGs to ui-audit/_shots/permit-icon/)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const SHOT_DIR = new URL("./_shots/permit-icon/", import.meta.url).pathname;
const SHOTS = process.argv.includes("--shots");
const MUTANT = process.env.PLANYR_PERMIT_MUTANT || "";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };

await ensureVendored();
await mkdir(SHOT_DIR, { recursive: true });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const src = await readFile(HTML_PATH, "utf8");
let iconsJs = await readFile(join(ROOT, "sequence/taskIcons.js"), "utf8");
if (MUTANT === "1") {
  // the defect the rule forbids: no mask — a fixed white ring painted under the stamp instead of a hole
  const before = iconsJs;
  iconsJs = iconsJs.replace('<g mask="url(#pm-__UID__)">', '<g>')
    .replace(/<g transform="translate\(18\.6 14\.2\)" fill="#d4506c">/, '<g transform="translate(18.6 14.2)" fill="#fff" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"><ellipse cx="0" cy="0" rx="1.8" ry="1.6"/><path d="M-1 1.2h2l.5 2.1h-3z"/><rect x="-3.7" y="3.1" width="7.4" height="2.3" rx="0.7"/><rect x="-3.7" y="5.9" width="7.4" height="0.9" rx="0.35"/></g><g transform="translate(18.6 14.2)" fill="#d4506c">');
  if (iconsJs === before) throw new Error("mutant 1: nothing replaced");
}
if (MUTANT === "2") {
  // the other defect: every icon shares ONE mask id
  const before = iconsJs;
  iconsJs = iconsJs.split("pm-__UID__").join("pm-shared");
  if (iconsJs === before) throw new Error("mutant 2: nothing replaced");
}
const pageHtml = () => rewriteCdn(src);

async function makeServer() {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(pageHtml())); return; }
      if (p === "/sequence/taskIcons.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(Buffer.from(iconsJs)); return; }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://localhost:${server.address().port}/sequence/` };
}


const task = (over) => ({ start: "2026-01-05", end: "2026-01-05", duration: 1, predecessors: [], health: "gray", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, ...over });
const MANY = [11, 12, 13, 14, 15, 16].map(i => task({ id: i, name: "Permit " + i, icons: ["c:permit"] }));
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Permit Icon Fixture", tasks: [
    task({ id: 1, name: "Site plan approved", icons: ["c:permit"] }),            // a task that ALREADY used the permit icon
    task({ id: 2, name: "Zoning review", icons: ["🗺️"] }),
    task({ id: 3, name: "Pick me" }),
    task({ id: 4, name: "Permit phase", isExpanded: false }),
    task({ id: 5, name: "Child permit", parentId: 4, icons: ["c:permit"] }),
    task({ id: 6, name: "Plat and permit", icons: ["c:plat", "c:permit"] }),
    ...MANY,
  ] } },
};

async function boot(page, url, fixture = FIXTURE) {
  page.removeAllListeners("dialog"); page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-permit-icon");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 400);
  await page.waitForFunction(n => [...document.querySelectorAll("[data-task-row]")].some(r => (r.innerText || "").includes(n)), fixture.projects[fixture.aPid].tasks[0].name, { timeout: 15000 });
}

const row = (id) => `[data-task-row="${id}"]`;
const glyphs = (page, id) => page.evaluate((id) => {
  const r = document.querySelector(`[data-task-row="${id}"]`); if (!r) return null;
  const cell = r.querySelector('[data-col-key="name"]');
  return [...cell.querySelectorAll("[data-task-icon]")].map(e => ({ id: e.getAttribute("data-task-icon"), svg: !!e.querySelector("svg"), img: !!e.querySelector("img"), title: e.title, vb: e.querySelector("svg")?.getAttribute("viewBox") }));
}, id);

// PNG bytes → RGBA samples at the given device-pixel points (decoded in the page; no extra dependency).
async function samplePng(page, buf, pts) {
  return page.evaluate(async ({ b64, pts }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return pts.map(([x, y]) => Array.from(cx.getImageData(Math.round(x), Math.round(y), 1, 1).data));
  }, { b64: buf.toString("base64"), pts });
}

// Probe points in the icon's own 24x24 units.
const GAP = [[14.35, 18.4], [14.35, 20.6], [16.1, 14.2]];   // the clean gap between the stamp (base, foot, knob) and the board it overlaps
const P = { edge: [16.5, 8], board: [14.3, 12.3], seal: [9.75, 18.4], clip: [9.75, 2.6], check: [9.4, 17], stamp: [18.6, 18.4] };

const { server, url } = await makeServer();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium" });
try {
  const DSF = 4;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await boot(page, url);

  // ── KNOWN-GOOD ARM ───────────────────────────────────────────────────────────
  const g1 = await glyphs(page, 1), g2 = await glyphs(page, 2);
  ok("0 KNOWN-GOOD: the emoji row reports an <img> and no <svg>; the permit row an <svg> and no <img>",
    g2?.length === 1 && g2[0].img && !g2[0].svg && g1?.length === 1 && g1[0].svg && !g1[0].img, JSON.stringify({ g1, g2 }));

  // ── A the cut-out, in isolation, on a TRANSPARENT canvas ─────────────────────
  const A = await page.evaluate(async () => {
    const TI = window.PlanyrTaskIcons;
    const S = 480, k = S / 24;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${TI.customViewBox("permit")}" width="${S}" height="${S}">${TI.customMarkup("permit", "iso")}</svg>`;
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0, S, S);
    const at = ([u, v]) => Array.from(cx.getImageData(Math.round(u * k), Math.round(v * k), 1, 1).data);
    return { markup: TI.customMarkup("permit", "iso"), at: Object.fromEntries([["g0", [14.35, 18.4]], ["g1", [14.35, 20.6]], ["g2", [16.1, 14.2]], ["edge", [16.5, 8]], ["board", [14.3, 12.3]], ["seal", [9.75, 18.4]], ["clip", [9.75, 2.6]], ["check", [9.4, 17]], ["stamp", [18.6, 18.4]], ["outside", [1.5, 1.5]]].map(([n, p]) => [n, at(p)])) };
  });
  const hex = p => "#" + p.slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join("");
  const nearHex = (p, h, t = 6) => [1, 3, 5].every((i, j) => Math.abs(p[j] - parseInt(h.slice(i, i + 2), 16)) <= t);
  ok("A the gap round the stamp is EMPTY (alpha 0) — beside the base, beside the foot, beside the knob", ["g0", "g1", "g2"].every(n => A.at[n][3] === 0), JSON.stringify([A.at.g0, A.at.g1, A.at.g2]));
  ok("A the board fill (#e3f3fb), its outline (#2f3a6b), the clip (#3f7fe0), the seal (#3f7fe0), the check (white) and the stamp (#d4506c) are solid and in the approved colours",
    A.at.board[3] === 255 && nearHex(A.at.board, "#e3f3fb") && A.at.edge[3] === 255 && nearHex(A.at.edge, "#2f3a6b") && nearHex(A.at.clip, "#3f7fe0") && A.at.seal[3] === 255 && nearHex(A.at.seal, "#3f7fe0") &&
    A.at.check[3] === 255 && nearHex(A.at.check, "#ffffff", 8) && A.at.stamp[3] === 255 && nearHex(A.at.stamp, "#d4506c"),
    JSON.stringify({ board: hex(A.at.board), edge: hex(A.at.edge), clip: hex(A.at.clip), seal: hex(A.at.seal), check: hex(A.at.check), stamp: hex(A.at.stamp) }));
  ok("A outside the clipboard it is transparent", A.at.outside[3] === 0);
  ok("A the drawing is built with a <mask> and carries no page-colour stroke (the only white is the mask field and the check)", /<mask /.test(A.markup) && (A.markup.match(/#fff\b/g) || []).length === 2, A.markup.slice(0, 70) + "…");

  // ── B on the page: normal / hovered / selected, light and simulated dark ─────
  const iconPixels = async (pg, selector, label) => {
    const svg = pg.locator(selector).first();
    const r = await svg.boundingBox();
    const M = 3;
    const clip = { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M };
    const buf = await pg.screenshot({ clip });
    if (SHOTS && label) { const fs = await import("node:fs/promises"); await fs.writeFile(`${SHOT_DIR}${label}-icon.png`, buf); await pg.screenshot({ path: `${SHOT_DIR}${label}-row.png`, clip: { x: 0, y: r.y - 14, width: 520, height: r.height + 28 } }); }
    const k = (r.width * DSF) / 24, ox = M * DSF, oy = M * DSF;
    const pt = (u, v) => [ox + u * k, oy + v * k];
    const probes = [];
    GAP.forEach(([u, v]) => { for (const du of [-0.12, 0, 0.12]) for (const dv of [-0.2, 0, 0.2]) probes.push(pt(u + du, v + dv)); });
    const [bg, edge, board, stamp, seal, ...gap] = await samplePng(pg, buf, [[1.5 * DSF, oy + (r.height * DSF) / 2], pt(...P.edge), pt(...P.board), pt(...P.stamp), pt(...P.seal), ...probes]);
    return { gap, bg, edge, board, stamp, seal, w: r.width };
  };
  const near = (a, b, t = 4) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
  const differs = (a, b, t = 12) => a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) >= t);
  // each gap is ~1 css px wide at row size, so its outer columns are antialiased against the neighbours: it reads as OPEN when the clear majority (5 of 9) of its samples are the row's own background
  const open = (p, t = 4) => [0, 1, 2].every(w => p.gap.slice(w * 9, w * 9 + 9).filter(c => near(c, p.bg, t)).length >= 5);
  const judge = (label, p) => ok(`B ${label}: the gap beside the stamp is the row's OWN background (no white ring); the outline, seal and stamp are drawn`,
    open(p) && differs(p.edge, p.bg) && differs(p.seal, p.bg) && near(p.stamp, [212, 80, 108], 14), JSON.stringify({ bg: p.bg, gapOff: p.gap.filter(c => !near(c, p.bg, 4)).slice(0, 3), edge: p.edge, stamp: p.stamp }));
  const sel1 = `${row(1)} [data-task-icon="c:permit"] svg`;

  await page.mouse.move(5, 5); await pacedWait(page, 200);
  const normal = await iconPixels(page, sel1, "normal");
  judge("normal row", normal);
  ok("B the icon is 16 css px like every other task icon", Math.abs(normal.w - 16) < 0.5, String(normal.w));
  const sl = await page.locator(`${row(1)} [data-task-icon-slot]`).boundingBox();
  await page.mouse.move(sl.x + sl.width / 2, sl.y + sl.height / 2); await pacedWait(page, 250);
  const hov = await iconPixels(page, sel1, "hover");
  judge("hovered (the slot is tinted)", hov);
  await page.mouse.move(5, 5);
  const nb = await page.locator(`${row(1)} [data-col-key="name"]`).boundingBox();
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ position: { x: nb.width - 14, y: 8 } }); await pacedWait(page, 300);
  judge("selected row", await iconPixels(page, sel1, "selected"));

  // computed fills before the dark simulation
  const fills = () => page.evaluate(() => {
    const svg = document.querySelector('[data-task-row="1"] [data-task-icon="c:permit"] svg');
    const f = (sel) => getComputedStyle(svg.querySelector(sel)).fill;
    return { board: f('g[mask] > rect:nth-of-type(1)'), clip: f('g[mask] > rect:nth-of-type(2)'), seal: f('g[mask] > circle'), stamp: f('g[fill="#d4506c"] > ellipse') };
  });
  const lightFills = await fills();

  // dark simulation: the Schedule page has no dark theme of its own today, so force the row to a dark surface + light text
  await page.addStyleTag({ content: '[data-task-row], [data-task-row] [data-col-key="name"] { background: rgb(22,27,34) !important; color: rgb(230,237,243) !important; }' });
  await page.mouse.move(5, 5); await pacedWait(page, 250);
  const dark = await iconPixels(page, sel1, "dark");
  judge("dark row (simulated)", dark);
  ok("B dark row: the gap is the DARK background — not white, not black", near(dark.gap[4], [22, 27, 34], 4) && open(dark, 4) && dark.bg.slice(0, 3).every(c => c < 60), JSON.stringify({ bg: dark.bg, mid: dark.gap.slice(0, 3) }));
  ok("B dark row: the stamp is still the stamp red, the board still the pale blue (fixed colours, not text colour)", near(dark.stamp, [212, 80, 108], 14) && near(dark.board, [227, 243, 251], 10), JSON.stringify({ stamp: dark.stamp, board: dark.board }));

  // ── C the coloured parts are FIXED ───────────────────────────────────────────
  const darkFills = await fills();
  ok("C the computed fills are the approved colours and IDENTICAL in light and dark (board #e3f3fb, clip + seal #3f7fe0, stamp #d4506c)",
    JSON.stringify(lightFills) === JSON.stringify(darkFills) && lightFills.board === "rgb(227, 243, 251)" && lightFills.clip === "rgb(63, 127, 224)" && lightFills.seal === "rgb(63, 127, 224)" && lightFills.stamp === "rgb(212, 80, 108)", JSON.stringify({ lightFills, darkFills }));

  // ── D the picker ─────────────────────────────────────────────────────────────
  await boot(page, url);   // navigates afresh, which drops the dark simulation
  await page.locator(`${row(3)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 250);
  await page.locator("div", { hasText: /^Set icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 300);
  const picker = page.locator("[data-task-icon-picker]");
  ok("D “Set icon…” opens the picker", await picker.count() === 1);
  const ids = async () => picker.locator("[data-icon-id]").evaluateAll(bs => bs.map(b => b.getAttribute("data-icon-id")));
  for (const q of ["permit", "approval", "approved"]) {
    await picker.locator("input").fill(q); await pacedWait(page, 120);
    ok(`D search “${q}” offers Permit / approval`, (await ids()).includes("c:permit"), JSON.stringify(await ids()));
  }
  await picker.locator("input").fill("zoning"); await pacedWait(page, 120);
  ok("D search “zoning” does NOT offer it", !(await ids()).includes("c:permit"));
  await picker.locator("input").fill(""); await pacedWait(page, 120);
  const cell = picker.locator('[data-icon-id="c:permit"]');
  ok("D in the picker: labelled “Permit / approval · drawn for Planyr”, drawn as an inline <svg> (24x24, with its mask), with the green dot, in Entitlements and permits",
    await cell.evaluate(b => b.title === "Permit / approval · drawn for Planyr" && !!b.querySelector("svg") && !b.querySelector("img") && b.querySelector("svg").getAttribute("viewBox") === "0 0 24 24" && !!b.querySelector("svg mask") &&
      [...b.querySelectorAll("span")].some(s => s.style.background === "rgb(22, 163, 74)") && b.closest("[data-icon-group]").getAttribute("data-icon-group") === "ent"));
  if (SHOTS) { await picker.locator("input").fill("permit"); await pacedWait(page, 150); await page.screenshot({ path: SHOT_DIR + "picker-open.png" }); await picker.locator("input").fill(""); await pacedWait(page, 100); }
  // the picker's own cell shows the gap on the white card
  const pk = await iconPixels(page, '[data-task-icon-picker] [data-icon-id="c:permit"] svg', "picker");
  ok("D in the picker the gap shows the white card (not a halo): gap = card colour, stamp red", near(pk.bg, [255, 255, 255], 6) && [0, 1, 2].every(w => pk.gap.slice(w * 9, w * 9 + 9).filter(c => near(c, [255, 255, 255], 10)).length >= 5) && near(pk.stamp, [212, 80, 108], 14), JSON.stringify({ bg: pk.bg, stamp: pk.stamp }));
  await page.evaluate(() => { window.__saves = []; const o = window.storage.set; window.storage.set = function (k, v, opts) { if (opts && opts.label === "auto") window.__saves.push(v); return o.apply(this, arguments); }; });
  await picker.locator("input").fill("permit"); await picker.locator('[data-icon-id="c:permit"]').click(); await pacedWait(page, 250);
  const g3 = await glyphs(page, 3);
  ok("D picking it draws the new drawing in the row, before the name", g3?.length === 1 && g3[0].id === "c:permit" && g3[0].svg && g3[0].vb === "0 0 24 24" && g3[0].title === "Permit / approval · drawn for Planyr", JSON.stringify(g3));
  ok("D the slot comes before the name in the cell", await page.evaluate(() => { const c = document.querySelector('[data-task-row="3"] [data-col-key="name"]'); const s = c.querySelector("[data-task-icon-slot]").getBoundingClientRect(), n = c.querySelector("[data-task-name]").getBoundingClientRect(); return s.right <= n.left + 1; }));
  await page.keyboard.press("Escape"); await pacedWait(page, 200);

  // ── E what is stored, and the round trip ─────────────────────────────────────
  await pacedWait(page, 2500);   // debounced auto-save
  const payload = await page.evaluate(() => window.__saves[window.__saves.length - 1] || null);
  const saved = payload ? JSON.parse(payload) : null;
  const proj = saved?.projects ? Object.values(saved.projects).find(p => p.name === "Permit Icon Fixture") : null;
  const t3 = proj?.tasks.find(t => t.name === "Pick me");
  ok("E the document handed to storage carries the KEY c:permit in the task's own `icons` field", JSON.stringify(t3?.icons) === JSON.stringify(["c:permit"]) && t3?.name === "Pick me", JSON.stringify(t3?.icons));
  ok("E no SVG markup is stored anywhere in the document", !!payload && !/<path|<svg|<rect|<mask|#d4506c/.test(payload));
  if (saved?.projects) { saved.aPid = saved.aPid ?? Object.keys(saved.projects).find(k => saved.projects[k].name === "Permit Icon Fixture"); saved.view = saved.view || "grid"; saved.section = saved.section || "projects"; }
  const page2 = await ctx.newPage(); page2.on("pageerror", e => errors.push(String(e)));
  await boot(page2, url, saved);
  const g3b = await glyphs(page2, 3);
  ok("E loaded back through the app's own import into a fresh page (a reload / a second device): the permit icon is there, drawn", JSON.stringify(g3b?.map(g => g.id)) === JSON.stringify(["c:permit"]) && g3b[0].svg, JSON.stringify(g3b));
  await page2.close();

  // ── F a task that ALREADY used the permit icon ───────────────────────────────
  const F = await page.evaluate(() => { const e = document.querySelector('[data-task-row="1"] [data-task-icon="c:permit"] svg'); return { vb: e.getAttribute("viewBox"), mask: !!e.querySelector("mask"), stamp: !!e.querySelector('g[fill="#d4506c"]'), oldGreenSeal: /#77B255/i.test(e.innerHTML) }; });
  ok("F a task that already had the permit icon now shows the NEW drawing (24x24, mask, red stamp; the old green seal is gone) — its stored data was not touched", F.vb === "0 0 24 24" && F.mask && F.stamp && !F.oldGreenSeal, JSON.stringify(F));
  const g6 = await glyphs(page, 6);
  ok("F the older Plat drawing beside a permit on one task still draws both", JSON.stringify(g6?.map(g => g.id)) === JSON.stringify(["c:plat", "c:permit"]) && g6.every(g => g.svg) && g6[0].vb === "0 0 36 36", JSON.stringify(g6));

  // ── G many permit icons on one page ──────────────────────────────────────────
  // expand the collapsed phase so its child shows too, and open the picker so its own permit cell is on the page as well
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 250);
  await page.locator("div", { hasText: /^(Change|Set) icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 300);
  const G = await page.evaluate(() => {
    const masks = [...document.querySelectorAll("mask")].map(m => m.id);
    const refs = [...document.querySelectorAll('g[mask]')].map(g => (g.getAttribute("mask").match(/#([^)]+)/) || [])[1]);
    const dup = masks.filter((id, i) => masks.indexOf(id) !== i);
    const uniqueDomIds = [...document.querySelectorAll("[id]")].map(e => e.id); const domDup = uniqueDomIds.filter((id, i) => uniqueDomIds.indexOf(id) !== i && id.indexOf("pm-") === 0);
    return { n: masks.length, masks, dup, domDup, refsResolve: refs.every(id => id && document.getElementById(id) && document.getElementById(id).tagName.toLowerCase() === "mask"), refs: refs.length };
  });
  ok("G many permit icons on one page (rows + collapsed-phase summary + the open picker): every mask id is UNIQUE and every url(#id) resolves to its own mask", G.n >= 9 && G.dup.length === 0 && G.domDup.length === 0 && G.refsResolve && G.refs === G.n, JSON.stringify({ n: G.n, dup: G.dup, refs: G.refs }));
  const allGaps = async () => {
    const out = [];
    const total = await page.locator('[data-task-icon="c:permit"] svg').count();
    for (let i = 0; i < total; i++) {
      const loc = page.locator('[data-task-icon="c:permit"] svg').nth(i);
      if (!(await loc.isVisible())) continue;
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const bb = await loc.boundingBox(); if (!bb) continue;
      const M = 3, clip = { x: bb.x - M, y: bb.y - M, width: bb.width + 2 * M, height: bb.height + 2 * M };
      const buf = await page.screenshot({ clip });
      const k = (bb.width * DSF) / 24, o = M * DSF;
      const pts = [[1.5 * DSF, o + (bb.height * DSF) / 2], ...[0, 1, 2].map(j => [o + GAP[j][0] * k, o + GAP[j][1] * k]), [o + P.stamp[0] * k, o + P.stamp[1] * k]];
      const [bg, g0, g1, g2, st] = await samplePng(page, buf, pts);
      out.push({ i, gapsOpen: [g0, g1, g2].every(c => near(c, bg, 14)), stamp: near(st, [212, 80, 108], 20) });
    }
    return out;
  };
  await page.keyboard.press("Escape"); await pacedWait(page, 250);   // the open picker covers some rows: probe the pixels with it closed
  const before = await allGaps();
  ok(`G every one of the ${before.length} visible permit icons shows its gap and its stamp`, before.length >= 8 && before.every(r => r.gapsOpen && r.stamp), JSON.stringify(before.filter(r => !(r.gapsOpen && r.stamp))));
  await page.evaluate(() => { const first = document.querySelector('[data-task-row="11"] [data-task-icon="c:permit"] svg'); first.remove(); });   // take the FIRST permit icon off the page
  const after = await allGaps();
  ok("G taking one icon out of the page leaves every other permit icon intact (no id is shared, so none was borrowing its mask)", after.length >= 6 && after.every(r => r.gapsOpen && r.stamp), JSON.stringify(after.filter(r => !(r.gapsOpen && r.stamp))));
  const Gph = await page.evaluate(() => { const c = document.querySelector('[data-task-row="4"] [data-col-key="name"]'); const s = c.querySelector("[data-phase-icons]"); return { n: s ? s.querySelectorAll("svg").length : 0, op: s ? getComputedStyle(s.querySelector("svg")).opacity : null, vb: s ? s.querySelector("svg").getAttribute("viewBox") : null }; });
  ok("G the collapsed phase's faded summary draws the permit from the same artwork", Gph.n === 1 && Number(Gph.op) < 1 && Gph.vb === "0 0 24 24", JSON.stringify(Gph));

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close(); server.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${MUTANT ? "  (MUTANT run — failures are EXPECTED here: this proves the checks have teeth)" : ""}`);
process.exit(MUTANT ? (failed.length ? 0 : 1) : (failed.length ? 1 : 0));
