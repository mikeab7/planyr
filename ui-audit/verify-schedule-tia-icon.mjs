/* SCHEDULE › the custom-drawn TIA task icon — cars on a road (NEW-1, owner-approved artwork 2026-11-12) — rendered check in a real browser.
 *
 * Drives the REAL public/sequence/index.html and proves, one assertion at a time:
 *   A  the windshields are TRUE cut-outs: rasterised on a TRANSPARENT canvas, each of the three windshields has alpha 0 while the car
 *      body round it is solid, the dashed centre line has gaps, the road edges are solid — and the markup holds no <mask>, no id, no
 *      fixed colour
 *   B  the same on the actual page: on a normal, a HOVERED and a SELECTED row, in light AND with a dark row simulated, the pixels at
 *      the middle of every windshield equal the row's own background beside the icon (so they read as openings, not as coloured
 *      blocks), while a car-body pixel differs from it
 *   C  the icon follows the row's text colour (currentColor): the drawing's computed colour and its cars' fill = the cell's text colour
 *   D  the picker: the TIA is offered (green "drawn for Planyr" dot, hover label, inline <svg>, in Entitlements and permits), found by
 *      tia / traffic / impact / analysis, the traffic light is NO LONGER offered; picking it draws it in the row before the name
 *   E  what is STORED is the key `svg:tia` — never markup — and a save → import round trip (the app's own path) brings it back
 *   F  a task that ALREADY saved 🚦 still shows it (a real Twemoji image that loaded, with its hover label) — saved data is untouched
 *   G  a collapsed phase's faded summary shows the TIA, drawn from the same artwork
 * KNOWN-GOOD ARM: the emoji row reports an <img> and no <svg>, the TIA row reports an <svg> and no <img>; a run that cannot see both
 *   is VOID.
 * Teeth: PLANYR_TIA_MUTANT=1 serves a taskIcons.js whose windshields are the "painted over" kind (a solid car body with each
 *   windshield drawn in a fixed white on top) and A and B must go RED.
 *
 * Run: node ui-audit/verify-schedule-tia-icon.mjs   [--shots]   (PNGs to ui-audit/_shots/tia-icon/)
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
const SHOT_DIR = new URL("./_shots/tia-icon/", import.meta.url).pathname;
const SHOTS = process.argv.includes("--shots");
const MUTANT = process.env.PLANYR_TIA_MUTANT === "1";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };

await ensureVendored();
await mkdir(SHOT_DIR, { recursive: true });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const src = await readFile(HTML_PATH, "utf8");
let iconsJs = await readFile(join(ROOT, "sequence/taskIcons.js"), "utf8");
if (MUTANT) {
  // the defect the rule forbids: a solid car body with each windshield painted over it in a fixed white
  let n = 0;
  iconsJs = iconsJs.replace(/<path fill="currentColor" stroke="none" fill-rule="evenodd" d="([^"]+)"\/>/g, (m, d) => {
    const [body, ws] = d.split("Z"); n++;
    return `<path fill="currentColor" stroke="none" d="${body}Z"/><path fill="#fff" stroke="none" d="${ws}Z"/>`;
  });
  if (n !== 3) throw new Error("mutant: expected 3 car paths, found " + n);
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
  projects: { 1: { id: 1, name: "TIA Icon Fixture", tasks: [
    task({ id: 1, name: "TIA submitted", icons: ["svg:tia"] }),
    task({ id: 2, name: "Old traffic light task", icons: ["🚦"] }),
    task({ id: 3, name: "Zoning review", icons: ["🗺️"] }),
    task({ id: 4, name: "Pick me" }),
    task({ id: 5, name: "Traffic phase", isExpanded: false }),
    task({ id: 6, name: "Child TIA", parentId: 5, icons: ["svg:tia"] }),
    task({ id: 7, name: "Plat and TIA", icons: ["svg:plat", "svg:tia"] }),
    task({ id: 8, name: "Spacer row" }),
  ] } },
};

async function boot(page, url, fixture = FIXTURE) {
  page.removeAllListeners("dialog"); page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-tia-icon");
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
  ok("0 KNOWN-GOOD: the emoji row reports an <img> and no <svg>; the TIA row an <svg> and no <img>",
    g3?.length === 1 && g3[0].img && !g3[0].svg && g1?.length === 1 && g1[0].svg && !g1[0].img, JSON.stringify({ g1, g3 }));

  // ── A the cut-outs, in isolation, on a TRANSPARENT canvas ────────────────────
  const A = await page.evaluate(async () => {
    const TI = window.PlanyrTaskIcons, b = TI.BUILTIN_SVG.tia;
    const S = 240, k = S / 24;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.viewBox}" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="color:rgb(200,30,30)">${b.markup}</svg>`;
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0, S, S);
    const at = (u, v) => Array.from(cx.getImageData(Math.round(u * k), Math.round(v * k), 1, 1).data);
    return {
      markup: b.markup,
      ws1: at(7.4, 7.7), ws1Top: at(7.4, 6.6), ws1Bot: at(7.4, 8.8), ws2: at(16.1, 7.7), ws3: at(15.4, 16.3), ws3Top: at(15.4, 15.2), ws3Bot: at(15.4, 17.4),
      body1: at(3.6, 7.7), body1Top: at(6, 5.9), body2: at(12.6, 7.7), body3: at(19.6, 16.3), body3Rear: at(20.4, 16.3),
      edgeTop: at(12, 3.5), edgeBot: at(12, 20.5), dash: at(3.2, 12), gap: at(6, 12), between: at(12, 4.7), outside: at(12, 1),
    };
  });
  const alpha = p => p[3];
  ok("A every windshield is EMPTY (alpha 0), top to bottom, in all three cars", [A.ws1, A.ws1Top, A.ws1Bot, A.ws2, A.ws3, A.ws3Top, A.ws3Bot].every(p => alpha(p) === 0), JSON.stringify({ ws1: A.ws1, ws2: A.ws2, ws3: A.ws3 }));
  ok("A the car bodies round the windshields are SOLID (alpha 255) — three cars, the third one in the other lane", [A.body1, A.body1Top, A.body2, A.body3, A.body3Rear].every(p => alpha(p) === 255 && p[0] > 150 && p[1] < 80), JSON.stringify({ b1: A.body1, b2: A.body2, b3: A.body3 }));
  ok("A the road edges and a centre-line dash are solid; the gap between dashes, the strip between edge and cars, and outside the road are empty",
    alpha(A.edgeTop) >= 200 && alpha(A.edgeBot) >= 200 && alpha(A.dash) >= 200 && alpha(A.gap) === 0 && alpha(A.between) === 0 && alpha(A.outside) === 0,
    JSON.stringify({ edgeTop: A.edgeTop, edgeBot: A.edgeBot, dash: A.dash, gap: A.gap, between: A.between, outside: A.outside }));
  ok("A the drawing holds no <mask>, no id=, no fixed colour — only currentColor", !/<mask|\sid=|#[0-9a-fA-F]{3,8}\b|rgb\(|url\(/.test(A.markup) && /currentColor/.test(A.markup), A.markup.slice(0, 80) + "…");

  // ── B on the page: normal / hovered / selected, light and simulated dark ─────
  const WS = [[7.4, 7.7], [16.1, 7.7], [15.4, 16.3]];
  const rowPixels = async (id, label) => {
    const svg = page.locator(`${row(id)} [data-task-icon="svg:tia"] svg`).first();
    const r = await svg.boundingBox();
    const M = 3;
    const clip = { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M };
    const buf = await page.screenshot({ clip });
    if (SHOTS) { const fs = await import("node:fs/promises"); await fs.writeFile(`${SHOT_DIR}${label}-icon.png`, buf); }
    if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}${label}-row.png`, clip: { x: 0, y: r.y - 14, width: 520, height: r.height + 28 } });
    const k = (r.width * DSF) / 24, ox = M * DSF, oy = M * DSF;
    const pt = (u, v) => [ox + u * k, oy + v * k];
    // a windshield is ~1 css px wide at row size: sample a small grid round its middle (all of it must read as the row's background)
    const probes = []; WS.forEach(([cu, cv]) => { for (const du of [-0.1, 0, 0.1]) for (const dv of [-0.4, 0, 0.4]) probes.push(pt(cu + du, cv + dv)); });
    const [bg, body1, body2, body3, ...ws] = await samplePng(page, buf, [[1.5 * DSF, oy + (r.height * DSF) / 2], pt(3.6, 7.7), pt(12.6, 7.7), pt(19.6, 16.3), ...probes]);
    return { ws, body1, body2, body3, bg };
  };
  const near = (a, b, t = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
  const differs = (a, b, t = 8) => a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) >= t);
  // A windshield is under one CSS pixel wide at row size, so its outer columns are anti-aliased against the car body; it reads as
  // OPEN when the clear majority of its sample points (5 of 9) are the row's own background.
  const open = (p, bg, t = 3) => [0, 1, 2].every(w => p.ws.slice(w * 9, w * 9 + 9).filter(c => near(c, bg, t)).length >= 5);
  const judge = (label, p) => ok(`B ${label}: every windshield reads as OPEN (it is the row's own background), the car bodies are drawn`,
    open(p, p.bg) && differs(p.body1, p.bg) && differs(p.body2, p.bg) && differs(p.body3, p.bg), JSON.stringify({ bg: p.bg, ws: p.ws.filter(c => !near(c, p.bg)).slice(0, 3), bodies: [p.body1, p.body2, p.body3] }));

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
  ok("B dark row: the windshields are the DARK background — not white, not black", open(dark, [22, 27, 34], 4), JSON.stringify(dark.ws.slice(0, 3)));
  ok("B dark row: the car bodies are light (the light text colour)", [dark.body1, dark.body2, dark.body3].every(c => c[0] > dark.bg[0] + 100), JSON.stringify([dark.body1, dark.body2, dark.body3]));

  // ── C follows the row's text colour ──────────────────────────────────────────
  const C = await page.evaluate(() => {
    const cell = document.querySelector('[data-task-row="1"] [data-col-key="name"]');
    const svg = cell.querySelector('[data-task-icon="svg:tia"] svg');
    const car = svg.querySelector('path[fill-rule="evenodd"]');
    return { cell: getComputedStyle(cell).color, svgColor: getComputedStyle(svg).color, stroke: getComputedStyle(svg).stroke, carFill: getComputedStyle(car).fill };
  });
  ok("C the drawing's colour and its cars' fill ARE the cell's text colour (light text in the dark sim)", C.svgColor === C.cell && C.stroke === C.cell && C.carFill === C.cell && C.cell === "rgb(230, 237, 243)", JSON.stringify(C));

  // ── D the picker ─────────────────────────────────────────────────────────────
  // boot() navigates afresh, which drops the dark simulation
  await boot(page, url);
  await page.locator(`${row(4)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 250);
  await page.locator("div", { hasText: /^Set icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 300);
  const picker = page.locator("[data-task-icon-picker]");
  ok("D “Set icon…” opens the picker", await picker.count() === 1);
  const ids = async () => picker.locator("[data-icon-id]").evaluateAll(bs => bs.map(b => b.getAttribute("data-icon-id")));
  for (const q of ["tia", "traffic", "impact", "analysis"]) {
    await picker.locator("input").fill(q); await pacedWait(page, 120);
    const got = await ids();
    ok(`D search “${q}” offers the TIA, and the traffic light is gone`, got.includes("svg:tia") && !got.includes("🚦"), JSON.stringify(got));
  }
  await picker.locator("input").fill("tia"); await pacedWait(page, 120);
  ok("D search “tia” → exactly the TIA (nothing else, “substantial” does not match)", JSON.stringify(await ids()) === JSON.stringify(["svg:tia"]), JSON.stringify(await ids()));
  await picker.locator("input").fill("zoning"); await pacedWait(page, 120);
  ok("D search “zoning” does NOT offer it", !(await ids()).includes("svg:tia"));
  await picker.locator("input").fill(""); await pacedWait(page, 120);
  ok("D the full picker has no 🚦 anywhere", !(await ids()).includes("🚦"));
  const cell = picker.locator('[data-icon-id="svg:tia"]');
  ok("D in the picker: labelled “Traffic impact analysis (TIA) · drawn for Planyr”, drawn as an <svg>, with the green dot",
    await cell.evaluate(b => b.title === "Traffic impact analysis (TIA) · drawn for Planyr" && !!b.querySelector("svg") && !b.querySelector("img") && [...b.querySelectorAll("span")].some(s => s.style.background === "rgb(22, 163, 74)")));
  ok("D in the picker it sits in Entitlements and permits", await cell.evaluate(b => b.closest("[data-icon-group]").getAttribute("data-icon-group") === "ent"));
  ok("D in the picker it is drawn in the picker's text colour (dark ink on the white card)", await cell.evaluate(b => getComputedStyle(b.querySelector("svg")).color === getComputedStyle(b).color && getComputedStyle(b).color !== "rgb(255, 255, 255)"));
  if (SHOTS) { await picker.locator("input").fill("traffic"); await pacedWait(page, 150); await page.screenshot({ path: SHOT_DIR + "picker-open.png" }); await picker.locator("input").fill(""); await pacedWait(page, 100); }
  await page.evaluate(() => { window.__saves = []; const o = window.storage.set; window.storage.set = function (k, v, opts) { if (opts && opts.label === "auto") window.__saves.push(v); return o.apply(this, arguments); }; });
  await picker.locator("input").fill("traffic"); await picker.locator('[data-icon-id="svg:tia"]').click(); await pacedWait(page, 250);
  const g4 = await glyphs(page, 4);
  ok("D picking it draws it in the row, before the name", g4?.length === 1 && g4[0].id === "svg:tia" && g4[0].svg && g4[0].title === "Traffic impact analysis (TIA) · drawn for Planyr", JSON.stringify(g4));
  ok("D the slot comes before the name in the cell", await page.evaluate(() => { const c = document.querySelector('[data-task-row="4"] [data-col-key="name"]'); const s = c.querySelector("[data-task-icon-slot]").getBoundingClientRect(), n = c.querySelector("[data-task-name]").getBoundingClientRect(); return s.right <= n.left + 1; }));
  await picker.locator("input").fill("signage"); await picker.locator("[data-icon-id]").first().click(); await pacedWait(page, 200);
  ok("D a second pick joins it (two-icon rule), TIA first", JSON.stringify((await glyphs(page, 4)).map(g => g.id)) === JSON.stringify(["svg:tia", "🪧"]));
  await page.keyboard.press("Escape"); await pacedWait(page, 200);

  // ── E what is stored, and the round trip ─────────────────────────────────────
  await pacedWait(page, 2500);   // debounced auto-save
  const payload = await page.evaluate(() => window.__saves[window.__saves.length - 1] || null);
  const saved = payload ? JSON.parse(payload) : null;
  const proj = saved?.projects ? Object.values(saved.projects).find(p => p.name === "TIA Icon Fixture") : null;
  const t4 = proj?.tasks.find(t => t.name === "Pick me");
  ok("E the document handed to storage carries the KEY svg:tia (and the emoji) in the task's own `icons` field", JSON.stringify(t4?.icons) === JSON.stringify(["svg:tia", "🪧"]) && t4?.name === "Pick me", JSON.stringify(t4?.icons));
  ok("E the saved 🚦 task was NOT rewritten by any of this (its `icons` is still exactly [🚦])", JSON.stringify(proj?.tasks.find(t => t.name === "Old traffic light task")?.icons) === JSON.stringify(["🚦"]));
  ok("E no SVG markup is stored anywhere in the document", !!payload && !/<path|<svg|<rect|currentColor/.test(payload));
  if (saved?.projects) { saved.aPid = saved.aPid ?? Object.keys(saved.projects).find(k => saved.projects[k].name === "TIA Icon Fixture"); saved.view = saved.view || "grid"; saved.section = saved.section || "projects"; }
  const page2 = await ctx.newPage(); page2.on("pageerror", e => errors.push(String(e)));
  await boot(page2, url, saved);
  const g4b = await glyphs(page2, 4);
  ok("E loaded back through the app's own import into a fresh page (a reload / a second device): the TIA is there, drawn", JSON.stringify(g4b?.map(g => g.id)) === JSON.stringify(["svg:tia", "🪧"]) && g4b[0].svg, JSON.stringify(g4b));
  await page2.close();

  // ── F a task that already saved 🚦 still shows it ────────────────────────────
  const F = await page.evaluate(async () => {
    const e = document.querySelector('[data-task-row="2"] [data-col-key="name"] [data-task-icon]');
    const img = e && e.querySelector("img");
    if (img && !img.complete) await new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 3000); });
    return { id: e && e.getAttribute("data-task-icon"), title: e && e.title, img: !!img, svg: !!(e && e.querySelector("svg")), loaded: !!(img && img.complete && img.naturalWidth > 0), src: img && img.getAttribute("src") };
  });
  ok("F a task that already saved 🚦 still shows it: a real Twemoji image that LOADED, with its hover label", F.id === "🚦" && F.img && !F.svg && F.loaded && /1f6a6\.svg$/.test(F.src || "") && F.title === "Traffic impact analysis (TIA)", JSON.stringify(F));
  const g3b = await glyphs(page, 3), g7 = await glyphs(page, 7);
  ok("F an existing emoji task still shows its emoji (🗺️)", g3b?.length === 1 && g3b[0].id === "🗺️" && g3b[0].img && !g3b[0].svg, JSON.stringify(g3b));
  ok("F the Plat icon beside a TIA on one task still draws both", JSON.stringify(g7?.map(g => g.id)) === JSON.stringify(["svg:plat", "svg:tia"]) && g7.every(g => g.svg), JSON.stringify(g7));

  // ── G collapsed phase summary ────────────────────────────────────────────────
  const G = await page.evaluate(() => { const c = document.querySelector('[data-task-row="5"] [data-col-key="name"]'); const s = c.querySelector("[data-phase-icons]"); return { n: s ? s.querySelectorAll("svg").length : 0, op: s ? getComputedStyle(s.querySelector("svg")).opacity : null, vb: s ? s.querySelector("svg").getAttribute("viewBox") : null }; });
  ok("G the collapsed phase's faded summary draws the TIA from the same artwork", G.n === 1 && Number(G.op) < 1 && G.vb === "0 0 24 24", JSON.stringify(G));

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close(); server.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${MUTANT ? "  (MUTANT run — failures are EXPECTED here: this proves the checks have teeth)" : ""}`);
process.exit(MUTANT ? (failed.length ? 0 : 1) : (failed.length ? 1 : 0));
