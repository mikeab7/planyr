/* Schedule grid — keyboard column navigation must SKIP hidden columns so the blue cell
 * selection outline never lands on (and disappears behind) an off-table column.
 *
 * Reporter's layout: Health / Status / Owner hidden — and those three sit immediately LEFT
 * of Cost in the master column registry. Before the fix, ArrowLeft from a Cost cell stepped
 * the cursor onto Owner → Status → Health (all hidden, no rendered cell), so the outline
 * vanished for several presses. This harness reproduces that layout headlessly and asserts
 * every column move keeps exactly one visible, on-screen active cell.
 *
 * Booting the board at all also proves the whole Babel block still parses with the fix in.
 *
 * Run:  PW_CHROME=<chrome> [SEQ_VENDOR=<dir>] node ui-audit/verify-grid-hidden-col-nav.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const VENDOR = process.env.SEQ_VENDOR || "";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };

const VENDOR_MAP = {
  "/__vendor/react.js": "react.js", "/__vendor/react-dom.js": "react-dom.js",
  "/__vendor/babel.js": "babel.js", "/__vendor/supabase.js": "supabase.js",
};
const rewriteForVendor = html => html
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/[^"']*react\.production\.min\.js/, "/__vendor/react.js")
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/[^"']*react-dom\.production\.min\.js/, "/__vendor/react-dom.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone@7\/babel\.min\.js/, "/__vendor/babel.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/, "/__vendor/supabase.js");

// Hide Health / Status / Owner on the active project (id 1) by seeding a colConfig.visible
// into the inline __PLANAR_DATA__ — the deterministic equivalent of un-checking them in the
// Columns chooser. Leaves id/name/.../successors/cost/notes shown (9 columns).
const VISIBLE = ["id","name","start","end","duration","predecessors","successors","cost","notes"];
const injectHiddenCols = html => html.replace(
  '"projects":{"1":{"id":1,',
  `"projects":{"1":{"colConfig":{"visible":${JSON.stringify(VISIBLE)}},"id":1,`);

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (VENDOR && VENDOR_MAP[p]) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(await readFile(join(VENDOR, VENDOR_MAP[p]))); }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (p.endsWith("sequence/index.html")) {
      let s = body.toString("utf8");
      if (VENDOR) s = rewriteForVendor(s);
      s = injectHiddenCols(s);
      body = Buffer.from(s);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url, VENDOR ? "(vendored libs)" : "(CDN libs)");

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => pageErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("board boots (Babel block parses with the column-nav fix in)", booted);

// Display indices with Health/Status/Owner hidden:
//   0 id · 1 name · 2 start · 3 end · 4 dur · 5 predecessors · 6 successors · 7 cost · 8 notes
const COST = 7, SUCC = 6, PRED = 5, NOTES = 8;

// Find the single active cell (inset blue box-shadow) and report its column index within its
// row, plus how many cells the row has. Returns {idx, cellCount} or null when nothing is active.
const activeCell = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  for (const row of rows) {
    const cells = [...row.children].filter(el => el.tagName === "DIV");
    for (let idx = 0; idx < cells.length; idx++) {
      if (/inset/.test(cells[idx].style.boxShadow || "")) return { idx, cellCount: cells.length, rowId: row.getAttribute("data-task-row") };
    }
  }
  return null;
});
const firstRowId = () => page.evaluate(() => document.querySelector("[data-task-row]")?.getAttribute("data-task-row"));
const clickCell = async (rowId, idx) => { await page.locator(`[data-task-row="${rowId}"] > div`).nth(idx).click(); await page.waitForTimeout(120); };
const press = async key => { await page.keyboard.press(key); await page.waitForTimeout(120); };

if (booted) {
  const rowId = await firstRowId();
  const rowCells = await page.locator(`[data-task-row="${rowId}"] > div`).count();
  ok("only the 9 visible columns render (Health/Status/Owner are not on screen)", rowCells === VISIBLE.length, `rendered=${rowCells} expected=${VISIBLE.length}`);

  // Click Cost → it becomes the active cell.
  await clickCell(rowId, COST);
  let a = await activeCell();
  ok("clicking Cost shows the active outline ON the Cost cell", a && a.idx === COST, JSON.stringify(a));

  // THE BUG: ArrowLeft from Cost must land on Successor (skipping hidden Owner/Status/Health),
  // with the outline still visible — not vanish onto an off-table column.
  await press("ArrowLeft");
  a = await activeCell();
  ok("ArrowLeft from Cost → outline still visible (did NOT disappear)", a !== null, JSON.stringify(a));
  ok("ArrowLeft from Cost lands on Successor, not a hidden column", a && a.idx === SUCC, JSON.stringify(a));

  // Continue left → Predecessor (normal adjacent step).
  await press("ArrowLeft");
  a = await activeCell();
  ok("ArrowLeft again lands on Predecessor", a && a.idx === PRED, JSON.stringify(a));

  // ArrowRight back across the hidden gap: Predecessor → Successor → Cost.
  await press("ArrowRight"); await press("ArrowRight");
  a = await activeCell();
  ok("ArrowRight twice returns to Cost across the hidden gap", a && a.idx === COST, JSON.stringify(a));

  // ArrowRight to the last visible column (Notes), then clamp — never off the right edge.
  await press("ArrowRight");
  a = await activeCell();
  ok("ArrowRight from Cost lands on Notes (rightmost visible)", a && a.idx === NOTES, JSON.stringify(a));
  await press("ArrowRight");
  a = await activeCell();
  ok("ArrowRight clamps at Notes (outline stays on the last visible column)", a && a.idx === NOTES, JSON.stringify(a));

  // Plain Tab (not editing) goes through the same skip: click Successor, Tab → Cost.
  await clickCell(rowId, SUCC);
  await press("Tab");
  a = await activeCell();
  ok("Tab from Successor advances to Cost (skips hidden columns)", a && a.idx === COST, JSON.stringify(a));

  // In-cell editing Shift+Tab: open the Cost editor on a leaf, Shift+Tab → Successor.
  const leafRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-task-row]")];
    const isParent = d => /[▾▸]/.test((d.children[1]?.innerText) || "");
    const leaf = rows.find(d => !isParent(d));
    return leaf ? leaf.getAttribute("data-task-row") : null;
  });
  if (leafRow) {
    await page.locator(`[data-task-row="${leafRow}"] > div`).nth(COST).dblclick();
    const editorOpened = await page.locator(`[data-task-row="${leafRow}"] input.ei`).waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (editorOpened) {
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(150);
      a = await activeCell();
      ok("Shift+Tab out of the Cost editor lands on Successor (in-cell nav skips hidden too)", a && a.idx === SUCC, JSON.stringify(a));
    } else {
      ok("Cost editor opened for the in-cell Tab check", false, "editor did not open on leaf " + leafRow);
    }
  }
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close(); server.close();
const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
