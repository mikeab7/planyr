/* SCHEDULE GRID — Alt+F TOGGLES FOCUS (NEW-1, B2455200). Real keys in a real browser, local page.
 * Presses Alt+F on a summary, on a child task, on a top-level task, in a multi-row selection and WHILE EDITING a
 * cell, and checks which rows hide / show, that the chip state matches, where the selection lands, that Ctrl+Z
 * reverses it like a chip click, and that preventDefault ran (Chrome's File menu) except while editing.
 * Scenarios live in lib/focusKeyScenarios.mjs (shared with the signed-in live harness).
 * Run: node ui-audit/verify-schedule-focus-key.mjs [baseUrl]   (default: the local public/sequence/index.html) */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { FIXTURE, runFocusKeyScenarios } from "./lib/focusKeyScenarios.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || undefined;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const results = [];
const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS ✅" : "FAIL ❌"} — ${n}${x ? "  ::  " + x : ""}`); };

async function localServer() {
  const realBody = await readFile(HTML_PATH, "utf8");
  await ensureVendored();
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(realBody))); return; }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://localhost:${server.address().port}/sequence/` };
}

const base = process.argv[2];
const srv = base ? null : await localServer();
const url = base || srv.url;
const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
try {
  const newPage = async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on("dialog", d => d.accept());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-task-row]", { timeout: 40000 });
    await assertMeasurable(page, "verify-schedule-focus-key");
    await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
    await page.setInputFiles('input[type="file"][accept=".json"]', { name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FIXTURE)) });
    await pacedWait(page, 700);
    await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 2500);
    return page;
  };
  await runFocusKeyScenarios({ newPage, ok });
} catch (e) { ok("run completed without throwing", false, e.stack || e.message); }
finally { await browser.close(); srv?.server.close(); }
const known = results.filter(r => r.n.includes("[known-good]") && !r.c);
if (known.length) { console.log("VOID — a known-good arm failed, so this instrument cannot vouch for the rest."); process.exit(1); }
console.log(`${results.filter(r => r.c).length}/${results.length} passed`);
process.exit(results.every(r => r.c) ? 0 : 1);
