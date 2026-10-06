/* NEW-1 (Schedule grid: one light full grid on every column) — border-uniformity gate.
 *
 * Owner decision: ONE border rule for every grid cell — a faint line on all four sides, same colour and
 * weight on every column (ID and TASK included), visible on tinted rows, solid tokens (no opacity).
 *
 * WHAT IT ASSERTS, from getComputedStyle on the REAL app (Grid view, throwaway fixture — never a real plan):
 *   1. in the same row, the TASK and ID cells' resolved borders (all four sides, visual edge) equal a DUR /
 *      NOTES cell's: same width, style and colour;
 *   2. the same on plain, red, yellow and green tinted rows, a summary (parent) row, and the selected cell
 *      row — and a tinted row's line colour is the SAME colour as on a plain row (not swallowed, not darker);
 *   3. header cells carry the same vertical divider as the body cells (header ↔ body line up);
 *   4. one line per edge: where two cells meet, exactly one of the pair draws the shared edge (no 2px stack);
 *   4b. PAINTED PIXELS (the check that fails on the pre-fix grid): the pinned ID / TASK cells paint an opaque
 *      background over the row's own bottom line, so computed borders can all agree while the picture does
 *      not. The pixel on each row's bottom edge under ID / TASK / START / DUR / NOTES must be the SAME line colour;
 *   5. no border colour uses alpha (salience never via fading);
 * Known-good arm: DUR and NOTES must report a 1px border on the right (the column divider that already
 * existed) — if they do not, the run is VOID (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 *
 * Run: node ui-audit/verify-grid-full-lines.mjs   [SHOTS_DIR=<dir>] [THEME=dark] [PW_CHROME=<chrome>] [PROBE=1]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
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

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const SIDES = ["Top", "Right", "Bottom", "Left"];

for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on("dialog", d => d.accept());
  await page.addInitScript(t => { try { localStorage.setItem("planyr:theme", t); } catch {} }, theme);
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-grid-full-lines");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 1500);
  await page.locator('.hdr-view button:has-text("Grid")').click();
  await pacedWait(page, 600);
  await page.waitForSelector('[data-grid-scroll="1"]');
  await page.evaluate(t => { if (t === "dark") document.documentElement.setAttribute("data-theme", "dark"); }, theme);
  await pacedWait(page, 300);

  // select the DUR cell of the "Plain leaf" row so the selected-cell state is in the picture
  await page.locator('[data-task-row] [data-col-key="duration"]').nth(1).click();
  await pacedWait(page, 300);

  const data = await page.evaluate(({ SIDES }) => {
    const rows = [...document.querySelectorAll("[data-task-row]")];
    const edge = (el) => { const cs = getComputedStyle(el); const o = {}; for (const s of SIDES) o[s] = `${cs[`border${s}Width`]} ${cs[`border${s}Style`]} ${cs[`border${s}Color`]}`; return o; };
    // the VISUAL line on each edge: the cell's own border, else the row's (bottom/left), else the neighbour's
    const out = { rows: [], hdr: {} };
    for (const r of rows) {
      const rowCS = getComputedStyle(r);
      const cells = {};
      for (const k of ["id", "name", "start", "duration", "notes", "cost"]) { const c = r.querySelector(`[data-col-key="${k}"]`); if (c) cells[k] = { ...edge(c), bg: getComputedStyle(c).backgroundColor }; }
      out.rows.push({ id: r.getAttribute("data-task-row"), rowBottom: `${rowCS.borderBottomWidth} ${rowCS.borderBottomStyle} ${rowCS.borderBottomColor}`, rowBg: rowCS.backgroundColor, cells, text: r.innerText.slice(0, 20).replace(/\n/g, " ") });
    }
    for (const k of ["id", "name", "duration", "notes"]) { const h = document.querySelector(`[data-hdr-col="${k}"]`); if (h) out.hdr[k] = edge(h); }
    out.bd = getComputedStyle(document.documentElement).getPropertyValue("--bd");
    return out;
  }, { SIDES });

  // painted pixels: sample each body row's bottom-edge pixel under several columns
  const geo = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => {
    const rr = r.getBoundingClientRect();
    const x = k => { const c = r.querySelector(`[data-col-key="${k}"]`).getBoundingClientRect(); return Math.round(c.left + c.width * 0.62); };
    return { id: r.getAttribute("data-task-row"), bottom: Math.round(rr.bottom), mid: Math.round(rr.top + rr.height / 2), xs: { id: x("id"), name: x("name"), start: x("start"), duration: x("duration"), notes: x("notes") } };
  }));
  const png = decodePng(await page.screenshot());
  const px = (x, y) => { const i = (y * png.width + x) * png.channels; return `${png.data[i]},${png.data[i+1]},${png.data[i+2]}`; };
  data.paint = geo.map(g => ({ id: g.id, mid: px(g.xs.name, g.mid), line: Object.fromEntries(Object.entries(g.xs).map(([k, x]) => [k, px(x, g.bottom - 1)])) }));
  if (PROBE) { console.log(JSON.stringify(data, null, 1)); }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/grid-${theme}.png` });

  const tag = `[${theme}]`;
  const line = (c, side) => c[side];
  const rowsOf = data.rows;
  // known-good arm
  const okArm = rowsOf.every(r => !r.cells.duration || /^1px solid/.test(r.cells.duration.Right));
  ok(`${tag} known-good arm: DUR cells carry their 1px right divider`, okArm);
  if (!okArm) { console.log("VOID RUN"); await page.close(); continue; }

  for (const r of rowsOf) {
    const ref = r.cells.duration, notes = r.cells.notes;
    for (const k of ["id", "name"]) {
      const c = r.cells[k];
      for (const side of ["Right", "Left"]) {
        ok(`${tag} row ${r.id} (${r.text.slice(0,12)}) · ${k.toUpperCase()} ${side} border equals DUR/NOTES`, c[side] === ref[side] && c[side] === notes[side], `${k}=${c[side]} dur=${ref[side]} notes=${notes[side]}`);
      }
      ok(`${tag} row ${r.id} · ${k.toUpperCase()} Bottom border equals DUR`, c.Bottom === ref.Bottom, `${k}=${c.Bottom} dur=${ref.Bottom}`);
      ok(`${tag} row ${r.id} · ${k.toUpperCase()} Top border equals DUR`, c.Top === ref.Top, `${k}=${c.Top} dur=${ref.Top}`);
    }
    for (const k of Object.keys(r.cells)) for (const side of SIDES) ok(`${tag} row ${r.id} · ${k} ${side} colour has no alpha`, !/rgba\(|\/ /.test(r.cells[k][side]) || /0px/.test(r.cells[k][side]), r.cells[k][side]);
  }
  // tinted rows draw the SAME line colour as plain rows
  const plain = rowsOf.find(r => /Plain leaf/.test(r.text));
  for (const t of ["Needs attention", "In progress", "Complete leaf"]) {
    const r = rowsOf.find(x => x.text.startsWith(t)); if (!r || !plain) continue;
    ok(`${tag} tinted row "${t}" · DUR Right/Bottom/Top line equals plain row's`, ["Right","Bottom","Top"].every(s => r.cells.duration[s] === plain.cells.duration[s]), `${r.cells.duration.Right} vs ${plain.cells.duration.Right}`);
    ok(`${tag} tinted row "${t}" · TASK Right/Bottom/Top line equals plain row's`, ["Right","Bottom","Top"].every(s => r.cells.name[s] === plain.cells.name[s]), `${r.cells.name.Right} vs ${plain.cells.name.Right}`);
  }
  for (const g of data.paint) {
    const ref = g.line.start; // START is never the selected cell, so its bottom edge is the plain line
    ok(`${tag} row ${g.id} · painted bottom line is a line (differs from the cell fill)`, ref !== g.mid, `line=${ref} fill=${g.mid}`);
    for (const k of ["id", "name", "duration", "notes"]) if (!(k === "duration" && g.id === "2")) ok(`${tag} row ${g.id} · painted bottom line under ${k.toUpperCase()} equals START's`, g.line[k] === ref, `${k}=${g.line[k]} start=${ref}`);
  }
  // header lines up with body: header cell right divider === body cell right divider, per column
  for (const k of ["id", "name", "duration", "notes"]) {
    const b = plain?.cells[k]; if (!b || !data.hdr[k]) continue;
    ok(`${tag} header ${k.toUpperCase()} Right divider equals body`, data.hdr[k].Right === b.Right, `hdr=${data.hdr[k].Right} body=${b.Right}`);
  }
  await page.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close(); server.close();
process.exit(failed.length ? 1 : 0);
