/* SCHEDULE › the custom-drawn PLAT task icon (B2671217, owner-approved artwork 2026-11-11) — rendered check in a real browser.
 *
 * Drives the REAL public/sequence/index.html and proves, one assertion at a time:
 *   A  the street is a TRUE cut-out: rasterised on a TRANSPARENT canvas, the street and the cul-de-sac bulb have alpha 0, the
 *      shaded lots have the ~20% tint, the lot lines / frame are solid — and the markup holds no <mask>, no id, no fixed colour
 *   B  the same on the actual page: on a normal, a HOVERED and a SELECTED row, in light AND with a dark row simulated, the pixel
 *      at the middle of the street equals the pixel of the row's own background beside the icon (so it reads as open, not as a
 *      coloured block), while a shaded lot pixel differs from it
 *   C  the icon follows the row's text colour (currentColor): computed fill/stroke colour of the drawing = the cell's text colour,
 *      and it follows a changed colour
 *   D  the picker: "Plat" is offered (green "drawn for Planyr" dot, hover label), found by plat / final plat / mylar / recordation /
 *      subdivision / lots; picking it draws it in the row before the name; it sits with an emoji under the two-icon rule
 *   E  what is STORED is the key `svg:plat` — never markup — and a save → import round trip (the app's own path) brings it back
 *   F  an existing emoji task still shows its emoji, and the older c:plat draw still draws (nothing else was touched)
 *   G  a collapsed phase's faded summary shows the plat, drawn from the same artwork
 * KNOWN-GOOD ARM: the emoji row reports an <img> and no <svg>, the plat row reports an <svg> and no <img> for that icon; a run
 *   that cannot see both is VOID.
 * Teeth: PLANYR_PLAT_MUTANT=1 serves a taskIcons.js whose plat is the "painted over" kind (a full shaded square with the street
 *   drawn in a fixed white on top) and A and B must go RED.
 *
 * Run: node ui-audit/verify-schedule-plat-icon.mjs   [--shots]   (PNGs to ui-audit/_shots/plat-icon/)
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
const SHOT_DIR = new URL("./_shots/plat-icon/", import.meta.url).pathname;
const SHOTS = process.argv.includes("--shots");
const MUTANT = process.env.PLANYR_PLAT_MUTANT === "1";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };

await ensureVendored();
await mkdir(SHOT_DIR, { recursive: true });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const src = await readFile(HTML_PATH, "utf8");
let iconsJs = await readFile(join(ROOT, "sequence/taskIcons.js"), "utf8");
if (MUTANT) {
  // the defect the rule forbids: shade the whole square, then paint the street over it in a fixed colour
  const a = iconsJs.indexOf('markup: \'<path d="M4 2.5H20'), b = iconsJs.indexOf("'<path d=\"M2.5 10.7H10.75A3.5 3.5 0 1 1");
  if (a < 0 || b < 0) throw new Error("mutant: plat markup not found");
  iconsJs = iconsJs.slice(0, a) + 'markup: \'<rect x="2.5" y="2.5" width="19" height="19" rx="1.5" fill="currentColor" fill-opacity=".2" stroke="none"/>\' +\n        \'<path d="M2.5 10.7H10.75A3.5 3.5 0 1 1 10.75 13.3H2.5Z" fill="#fff" stroke="none"/>\' +\n        ' + iconsJs.slice(b);
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
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Plat Icon Fixture", tasks: [
    task({ id: 1, name: "Final plat recorded", icons: ["svg:plat"] }),
    task({ id: 2, name: "Plat and TIA", icons: ["svg:plat", "🚦"] }),
    task({ id: 3, name: "Zoning review", icons: ["🗺️"] }),
    task({ id: 4, name: "Pick me" }),
    task({ id: 5, name: "Subdivision phase", isExpanded: false }),
    task({ id: 6, name: "Child lots", parentId: 5, icons: ["svg:plat"] }),
    task({ id: 7, name: "Old sketch plat", icons: ["c:plat"] }),
    task({ id: 8, name: "Spacer row" }),
  ] } },
};

async function boot(page, url, fixture = FIXTURE) {
  page.removeAllListeners("dialog"); page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-plat-icon");
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
  return [...cell.querySelectorAll("[data-task-icon]")].map(e => ({ id: e.getAttribute("data-task-icon"), svg: !!e.querySelector("svg"), img: !!e.querySelector("img"), title: e.title }));
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

const { server, url } = await makeServer();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium" });
try {
  const DSF = 4;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await boot(page, url);

  // ── KNOWN-GOOD ARM ───────────────────────────────────────────────────────────
  const g1 = await glyphs(page, 1), g3 = await glyphs(page, 3);
  ok("0 KNOWN-GOOD: the emoji row reports an <img> and no <svg>; the plat row an <svg> and no <img>",
    g3?.length === 1 && g3[0].img && !g3[0].svg && g1?.length === 1 && g1[0].svg && !g1[0].img, JSON.stringify({ g1, g3 }));

  // ── A the cut-out, in isolation, on a TRANSPARENT canvas ─────────────────────
  const A = await page.evaluate(async () => {
    const TI = window.PlanyrTaskIcons, b = TI.BUILTIN_SVG.plat;
    const S = 240, k = S / 24;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.viewBox}" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="color:rgb(200,30,30)">${b.markup}</svg>`;
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0, S, S);
    const at = (u, v) => Array.from(cx.getImageData(Math.round(u * k), Math.round(v * k), 1, 1).data);
    return {
      markup: b.markup,
      street: at(5, 12), streetMid: at(8.5, 12), bulb: at(14, 12), bulbNearEdge: at(12.2, 12),
      lotTopLeft: at(4.5, 6), lotBelowStreet: at(5, 17), lotRightTop: at(18, 6), pieUpper: at(19.5, 10.5), pieMiddle: at(16, 5),
      pieLower: at(19.5, 15), lotLine: at(7, 6), frame: at(2.5, 12 + 5), outside: at(1, 1),
    };
  });
  const alpha = p => p[3];
  ok("A the street is EMPTY (alpha 0), end to end", alpha(A.street) === 0 && alpha(A.streetMid) === 0, JSON.stringify({ street: A.street, mid: A.streetMid }));
  ok("A the cul-de-sac bulb is EMPTY (alpha 0), including right up to its kerb", alpha(A.bulb) === 0 && alpha(A.bulbNearEdge) === 0, JSON.stringify({ bulb: A.bulb, near: A.bulbNearEdge }));
  ok("A the lots are the soft ~20% tint of the text colour (above and below the street, and the three pie lots)",
    [A.lotTopLeft, A.lotBelowStreet, A.lotRightTop, A.pieUpper, A.pieMiddle, A.pieLower].every(p => alpha(p) >= 40 && alpha(p) <= 62 && p[0] > 150 && p[1] < 80),
    JSON.stringify({ a: [A.lotTopLeft, A.lotBelowStreet, A.lotRightTop, A.pieUpper, A.pieMiddle, A.pieLower].map(alpha) }));
  ok("A the lot lines and the frame are solid; outside the frame is empty", alpha(A.lotLine) >= 200 && alpha(A.frame) >= 200 && alpha(A.outside) === 0, JSON.stringify({ line: A.lotLine, frame: A.frame, outside: A.outside }));
  ok("A the drawing holds no <mask>, no id=, no fixed colour — only currentColor", !/<mask|\sid=|#[0-9a-fA-F]{3,8}\b|rgb\(|url\(/.test(A.markup) && /currentColor/.test(A.markup), A.markup.slice(0, 80) + "…");

  // ── B on the page: normal / hovered / selected, light and simulated dark ─────
  const rowPixels = async (id, label) => {
    const svg = page.locator(`${row(id)} [data-task-icon="svg:plat"] svg`).first();
    const r = await svg.boundingBox();
    const M = 3;
    const clip = { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M };
    const buf = await page.screenshot({ clip });
    if (SHOTS) { const fs = await import("node:fs/promises"); await fs.writeFile(`${SHOT_DIR}${label}-icon.png`, buf); }
    if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}${label}-row.png`, clip: { x: 0, y: r.y - 14, width: 520, height: r.height + 28 } });
    const k = (r.width * DSF) / 24, ox = M * DSF, oy = M * DSF;
    const pt = (u, v) => [ox + u * k, oy + v * k];
    // The street is a ~1px channel at row size and the screenshot clip snaps to whole pixels, so sample ACROSS the channel
    // (and a little along it) and keep the pixel nearest the row's own background.
    const chan = []; for (let v = 11.3; v <= 12.71; v += 0.1) for (const u of [4, 5, 6]) chan.push(pt(u, v));
    const [bg, bulb, lot, below, ...cs] = await samplePng(page, buf, [[1.5 * DSF, oy + (r.height * DSF) / 2], pt(14, 12), pt(4.5, 6), pt(5, 17), ...chan]);
    const dist = (a, b) => Math.max(...a.slice(0, 3).map((x, i) => Math.abs(x - b[i])));
    const street = cs.reduce((best, c) => (dist(c, bg) < dist(best, bg) ? c : best), cs[0]);
    return { street, bulb, lot, below, bg };
  };
  const near = (a, b, t = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
  const differs = (a, b, t = 8) => a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) >= t);
  const judge = (label, p) => ok(`B ${label}: the street and the bulb read as OPEN (they are the row's own background), the lots are shaded`,
    near(p.street, p.bg) && near(p.bulb, p.bg) && differs(p.lot, p.bg) && differs(p.below, p.bg), JSON.stringify(p));

  await page.mouse.move(5, 5); await pacedWait(page, 200);
  judge("normal row", await rowPixels(1, "normal"));
  const sl = await page.locator(`${row(1)} [data-task-icon-slot]`).boundingBox();
  await page.mouse.move(sl.x + sl.width / 2, sl.y + sl.height / 2); await pacedWait(page, 250);
  judge("hovered (the slot is tinted blue)", await rowPixels(1, "hover"));
  await page.mouse.move(5, 5);
  const nb = await page.locator(`${row(1)} [data-col-key="name"]`).boundingBox();
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ position: { x: nb.width - 14, y: 8 } }); await pacedWait(page, 300);
  judge("selected row", await rowPixels(1, "selected"));

  // dark simulation: the Schedule page has no dark theme of its own today, so force the row to a dark surface + light text
  await page.addStyleTag({ content: '[data-task-row], [data-task-row] [data-col-key="name"] { background: rgb(22,27,34) !important; color: rgb(230,237,243) !important; }' });
  await page.mouse.move(5, 5); await pacedWait(page, 250);
  const dark = await rowPixels(1, "dark");
  judge("dark row (simulated)", dark);
  ok("B dark row: the street is the DARK background — not white, not black", near(dark.street, [22, 27, 34], 4), JSON.stringify(dark.street));
  ok("B dark row: the shaded lot is lighter than that background (light text colour, tinted)", dark.lot[0] > dark.bg[0] + 8, JSON.stringify({ lot: dark.lot, bg: dark.bg }));

  // ── C follows the row's text colour ──────────────────────────────────────────
  const C = await page.evaluate(() => {
    const cell = document.querySelector('[data-task-row="1"] [data-col-key="name"]');
    const svg = cell.querySelector('[data-task-icon="svg:plat"] svg');
    return { cell: getComputedStyle(cell).color, svgColor: getComputedStyle(svg).color, stroke: getComputedStyle(svg).stroke };
  });
  ok("C the drawing's colour IS the cell's text colour (light text in the dark sim)", C.svgColor === C.cell && C.stroke === C.cell && C.cell === "rgb(230, 237, 243)", JSON.stringify(C));

  // ── D the picker ─────────────────────────────────────────────────────────────
  // boot() navigates afresh, which drops the dark simulation
  await boot(page, url);
  await page.locator(`${row(4)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 250);
  await page.locator("div", { hasText: /^Set icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 300);
  const picker = page.locator("[data-task-icon-picker]");
  ok("D “Set icon…” opens the picker", await picker.count() === 1);
  const ids = async () => picker.locator("[data-icon-id]").evaluateAll(bs => bs.map(b => b.getAttribute("data-icon-id")));
  for (const q of ["plat", "final plat", "mylar", "recordation", "subdivision", "lots"]) {
    await picker.locator("input").fill(q); await pacedWait(page, 120);
    const got = await ids();
    ok(`D search “${q}” offers the new Plat`, got.includes("svg:plat"), JSON.stringify(got));
  }
  await picker.locator("input").fill("zoning"); await pacedWait(page, 120);
  ok("D search “zoning” does NOT offer it (it is only the plat)", !(await ids()).includes("svg:plat"));
  await picker.locator("input").fill(""); await pacedWait(page, 120);
  const cell = picker.locator('[data-icon-id="svg:plat"]');
  ok("D in the picker: labelled “Plat · drawn for Planyr”, drawn as an <svg>, with the green dot",
    await cell.evaluate(b => b.title === "Plat · drawn for Planyr" && !!b.querySelector("svg") && !b.querySelector("img") && [...b.querySelectorAll("span")].some(s => s.style.background === "rgb(22, 163, 74)")));
  ok("D in the picker it sits in Entitlements and permits", await cell.evaluate(b => b.closest("[data-icon-group]").getAttribute("data-icon-group") === "ent"));
  ok("D in the picker it is drawn in the picker's text colour (dark ink on the white card)", await cell.evaluate(b => getComputedStyle(b.querySelector("svg")).color === getComputedStyle(b).color && getComputedStyle(b).color !== "rgb(255, 255, 255)"));
  if (SHOTS) await page.screenshot({ path: SHOT_DIR + "picker-open.png" });
  await page.evaluate(() => { window.__saves = []; const o = window.storage.set; window.storage.set = function (k, v, opts) { if (opts && opts.label === "auto") window.__saves.push(v); return o.apply(this, arguments); }; });
  await picker.locator("input").fill("plat"); await picker.locator('[data-icon-id="svg:plat"]').click(); await pacedWait(page, 250);
  const g4 = await glyphs(page, 4);
  ok("D picking it draws it in the row, before the name", g4?.length === 1 && g4[0].id === "svg:plat" && g4[0].svg && g4[0].title === "Plat · drawn for Planyr", JSON.stringify(g4));
  ok("D the slot comes before the name in the cell", await page.evaluate(() => { const c = document.querySelector('[data-task-row="4"] [data-col-key="name"]'); const s = c.querySelector("[data-task-icon-slot]").getBoundingClientRect(), n = c.querySelector("[data-task-name]").getBoundingClientRect(); return s.right <= n.left + 1; }));
  await picker.locator("input").fill("signage"); await picker.locator("[data-icon-id]").first().click(); await pacedWait(page, 200);
  ok("D a second pick joins it (two-icon rule), plat first", JSON.stringify((await glyphs(page, 4)).map(g => g.id)) === JSON.stringify(["svg:plat", "🪧"]));
  await page.keyboard.press("Escape"); await pacedWait(page, 200);

  // ── E what is stored, and the round trip ─────────────────────────────────────
  await pacedWait(page, 2500);   // debounced auto-save
  const payload = await page.evaluate(() => window.__saves[window.__saves.length - 1] || null);
  const saved = payload ? JSON.parse(payload) : null;
  const proj = saved?.projects ? Object.values(saved.projects).find(p => p.name === "Plat Icon Fixture") : null;
  const t4 = proj?.tasks.find(t => t.name === "Pick me");
  ok("E the document handed to storage carries the KEY svg:plat (and the emoji) in the task's own `icons` field", JSON.stringify(t4?.icons) === JSON.stringify(["svg:plat", "🪧"]) && t4?.name === "Pick me", JSON.stringify(t4?.icons));
  ok("E no SVG markup is stored anywhere in the document", !!payload && !/<path|<svg|<rect|currentColor/.test(payload));
  if (saved?.projects) { saved.aPid = saved.aPid ?? Object.keys(saved.projects).find(k => saved.projects[k].name === "Plat Icon Fixture"); saved.view = saved.view || "grid"; saved.section = saved.section || "projects"; }
  const page2 = await ctx.newPage(); page2.on("pageerror", e => errors.push(String(e)));
  await boot(page2, url, saved);
  const g4b = await glyphs(page2, 4);
  ok("E loaded back through the app's own import into a fresh page (a reload / a second device): the plat is there, drawn", JSON.stringify(g4b?.map(g => g.id)) === JSON.stringify(["svg:plat", "🪧"]) && g4b[0].svg, JSON.stringify(g4b));
  await page2.close();

  // ── F nothing else changed ───────────────────────────────────────────────────
  const g3b = await glyphs(page, 3), g7b = await glyphs(page, 7);
  ok("F an existing emoji task still shows its emoji (🗺️)", g3b?.length === 1 && g3b[0].id === "🗺️" && g3b[0].img && !g3b[0].svg, JSON.stringify(g3b));
  ok("F the older green-sketch c:plat still draws, unchanged", g7b?.length === 1 && g7b[0].id === "c:plat" && g7b[0].svg, JSON.stringify(g7b));
  ok("F the picker still offers the older “Plat / replat” too", await (async () => { await page.locator(`${row(8)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 200); await page.locator("div", { hasText: /^Set icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 250); const has = (await page.locator("[data-task-icon-picker] [data-icon-id]").evaluateAll(bs => bs.map(b => b.getAttribute("data-icon-id")))).includes("c:plat"); await page.keyboard.press("Escape"); await pacedWait(page, 150); return has; })());

  // ── G collapsed phase summary ────────────────────────────────────────────────
  const G = await page.evaluate(() => { const c = document.querySelector('[data-task-row="5"] [data-col-key="name"]'); const s = c.querySelector("[data-phase-icons]"); return { n: s ? s.querySelectorAll("svg").length : 0, op: s ? getComputedStyle(s.querySelector("svg")).opacity : null, vb: s ? s.querySelector("svg").getAttribute("viewBox") : null }; });
  ok("G the collapsed phase's faded summary draws the plat from the same artwork", G.n === 1 && Number(G.op) < 1 && G.vb === "0 0 24 24", JSON.stringify(G));

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close(); server.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${MUTANT ? "  (MUTANT run — failures are EXPECTED here: this proves the checks have teeth)" : ""}`);
process.exit(MUTANT ? (failed.length ? 0 : 1) : (failed.length ? 1 : 0));
