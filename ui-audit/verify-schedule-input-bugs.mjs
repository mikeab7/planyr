/* Schedule INPUT-bug regression (2026-06-27).
 *
 * Drives the embedded scheduler (public/sequence/index.html) headlessly and exercises the
 * user-input edit paths that were silently dropping / mangling values:
 *   1. Predecessor = self            → toast "can't be its own predecessor"
 *   2. Predecessor = nonexistent id  → toast "No task N in this project"
 *   3. Predecessor closes a cycle    → toast "circular dependency"
 *   4. Finish before Start           → toast "Finish can't be before Start"
 *   5. Unreadable date               → toast "Couldn't read that date"
 * Booting the board at all also proves the whole Babel block still parses with the fixes in.
 *
 * The board needs React/ReactDOM/Babel from a CDN. In CI those resolve directly. In a
 * sandbox whose proxy closes those hosts to the browser, pre-download them and point the
 * harness at them:   SEQ_VENDOR=/path/with/{react,react-dom,babel,supabase}.js
 *
 * Run:  PW_CHROME=<chrome> [SEQ_VENDOR=<dir>] node ui-audit/verify-schedule-input-bugs.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const VENDOR = process.env.SEQ_VENDOR || "";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };

const VENDOR_MAP = {
  "/__vendor/react.js": "react.js",
  "/__vendor/react-dom.js": "react-dom.js",
  "/__vendor/babel.js": "babel.js",
  "/__vendor/supabase.js": "supabase.js",
};
const rewriteForVendor = html => html
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/[^"']*react\.production\.min\.js/, "/__vendor/react.js")
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/[^"']*react-dom\.production\.min\.js/, "/__vendor/react-dom.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone@7\/babel\.min\.js/, "/__vendor/babel.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/, "/__vendor/supabase.js");

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (VENDOR && VENDOR_MAP[p]) {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(await readFile(join(VENDOR, VENDOR_MAP[p])));
    }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (VENDOR && p.endsWith("sequence/index.html")) body = Buffer.from(rewriteForVendor(body.toString("utf8")));
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
ok("board boots (Babel block parses with the input fixes in)", booted);

// Default visible column order → cell index within a [data-task-row]:
//   0 id · 1 name · 2 start · 3 end(Finish) · 4 dur · 5 predecessors · …
const COL = { start: 2, end: 3, predecessors: 5 };
const lastToast = () => page.evaluate(() => {
  // showToast appends a fixed div to <body>; grab the most recent one's text.
  const nodes = [...document.querySelectorAll("body > div")].filter(d => d.style && d.style.position === "fixed" && /translateX/.test(d.style.transform || ""));
  return nodes.length ? nodes[nodes.length - 1].innerText : "";
});

// Edit a cell: double-click to open the inline editor, replace its text, commit with Enter.
async function editCell(rowId, colIdx, text) {
  const cell = page.locator(`[data-task-row="${rowId}"] > div`).nth(colIdx);
  await cell.dblclick();
  const input = page.locator(`[data-task-row="${rowId}"] input.ei`);
  await input.waitFor({ timeout: 4000 });
  await input.fill(String(text));
  await input.press("Enter");
  await page.waitForTimeout(220);
}

if (booted) {
  // Pick two distinct tasks for predecessor tests, and a LEAF task (no children → its
  // date cells are editable; parents' dates are computed/locked) with a real start date
  // for the date tests. Parent rows carry an expand/collapse toggle (▾/▸) in the name cell.
  const pick = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-task-row]")];
    const id = d => +d.getAttribute("data-task-row");
    const isParent = d => /[▾▸]/.test((d.children[1]?.innerText) || "");
    const hasStart = d => /\d/.test((d.children[2]?.innerText) || "");
    const all = rows.map(id);
    const leaf = rows.find(d => !isParent(d) && hasStart(d));
    return { a: all[0], b: all[1], leaf: leaf ? id(leaf) : null };
  });
  const { a, b, leaf } = pick;

  try {
    // 1. self-reference
    await editCell(b, COL.predecessors, String(b));
    ok("predecessor self-reference is rejected with a toast", /its own predecessor/i.test(await lastToast()), JSON.stringify(await lastToast()));

    // 2. nonexistent id
    await editCell(b, COL.predecessors, "9999");
    ok("predecessor to a nonexistent task id is rejected with a toast", /No task 9999/i.test(await lastToast()), JSON.stringify(await lastToast()));

    // 3. cycle: make b depend on a, then a depend on b
    await editCell(b, COL.predecessors, String(a));
    await editCell(a, COL.predecessors, String(b));
    ok("a circular dependency is rejected with a toast", /circular dependency/i.test(await lastToast()), JSON.stringify(await lastToast()));

    // 4. Finish before Start (use a leaf with a real start date)
    ok("found a leaf task with a start date for date tests", leaf != null, "leafId=" + leaf);
    if (leaf != null) {
      await editCell(leaf, COL.end, "1/1/20");
      ok("Finish-before-Start is rejected with a toast", /Finish can't be before Start/i.test(await lastToast()), JSON.stringify(await lastToast()));

      // 5. unreadable date
      await editCell(leaf, COL.start, "garblesnarf");
      ok("an unreadable date gives feedback instead of silently reverting", /Couldn't read that date/i.test(await lastToast()), JSON.stringify(await lastToast()));
    }
  } catch (e) {
    ok("input-edit interactions ran without throwing", false, e.message);
  }
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close(); server.close();
const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
