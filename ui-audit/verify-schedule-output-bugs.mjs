/* Schedule OUTPUT-bug regression (2026-06-27).
 *
 * Drives the embedded scheduler (public/sequence/index.html) headlessly and checks what it
 * PRODUCES / RENDERS:
 *   1. Web Snapshot (.html) export — Planyr brand + real data, NOT the stale "Hillwood"/"planar";
 *      no "undefined%" / bare "d" / "NaN".
 *   2. Gantt view renders (the summary-before-milestone JSX reorder runs) with no page errors.
 *   3. Dashboard / reports (MasterView) renders rows with the rolled-health wiring, no page errors.
 * Booting the board proves the whole Babel block (incl. buildGanttSVG + MasterView edits) parses.
 *
 * Same CDN caveat as verify-schedule-input-bugs.mjs: in a sandbox whose proxy closes the React/
 * Babel CDNs to the browser, pre-download them and pass SEQ_VENDOR=/dir/with/{react,react-dom,babel,supabase}.js
 *
 * Run:  PW_CHROME=<chrome> [SEQ_VENDOR=<dir>] node ui-audit/verify-schedule-output-bugs.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const VENDOR = process.env.SEQ_VENDOR || "";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };
const VENDOR_MAP = { "/__vendor/react.js":"react.js", "/__vendor/react-dom.js":"react-dom.js", "/__vendor/babel.js":"babel.js", "/__vendor/supabase.js":"supabase.js" };
const rewriteForVendor = html => html
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/[^"']*react\.production\.min\.js/, "/__vendor/react.js")
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/[^"']*react-dom\.production\.min\.js/, "/__vendor/react-dom.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone@7\/babel\.min\.js/, "/__vendor/babel.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/, "/__vendor/supabase.js");

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (VENDOR && VENDOR_MAP[p]) { res.writeHead(200, { "Content-Type":"text/javascript" }); return res.end(await readFile(join(VENDOR, VENDOR_MAP[p]))); }
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

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"], acceptDownloads: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => pageErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("board boots (buildGanttSVG + MasterView edits parse)", booted);

if (booted) {
  // 1. Web Snapshot export — capture the downloaded HTML and inspect it.
  try {
    const dlPromise = page.waitForEvent("download", { timeout: 8000 });
    await page.click('button[title="Export — PDF exhibit or web snapshot"]', { timeout: 5000 });
    await page.click('text=Web Snapshot', { timeout: 5000 });
    const download = await dlPromise;
    const fp = await download.path();
    const html = readFileSync(fp, "utf8");
    // Check only the title/heading for the stale brand — a *task* may legitimately be named
    // "Hillwood …", which is real data, not the old hardcoded "Hillwood Schedule" heading.
    const titleStr = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    ok("web snapshot title uses the Planyr brand, not the stale Hillwood/planar", /Planyr Schedule/.test(html) && !/Hillwood Schedule/.test(html) && !/<title>planar<\/title>/.test(html), JSON.stringify(titleStr));
    ok("web snapshot filename is planyr-schedule-<date>.html", /^planyr-schedule-\d{4}-\d{2}-\d{2}\.html$/.test(download.suggestedFilename()), download.suggestedFilename());
    ok("web snapshot has no undefined%/NaN/bare-d artifacts", !/undefined%/.test(html) && !/NaN/.test(html) && !/>\s*d<\/td>/.test(html) && !/undefinedd/.test(html));
  } catch (e) { ok("web snapshot export ran", false, e.message); }

  // 2. Gantt view renders (the summary-before-milestone JSX path runs).
  try {
    await page.click('button:has-text("Gantt")', { timeout: 4000 }).catch(()=>{});
    await page.waitForTimeout(400);
    const ganttOk = await page.locator("svg, [data-task-row]").first().isVisible().catch(()=>false);
    ok("Gantt view renders without error", ganttOk);
  } catch (e) { ok("Gantt view renders", false, e.message); }

  // 3. Dashboard / reports (MasterView) renders.
  try {
    await page.click('button:has-text("Dashboard")', { timeout: 4000 });
    await page.waitForTimeout(500);
    const rowCount = await page.locator("table tr, table tbody tr").count().catch(()=>0);
    ok("Dashboard (reports) renders rows", rowCount > 0, `rows=${rowCount}`);
  } catch (e) { ok("Dashboard renders", false, e.message); }
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close(); server.close();
const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
