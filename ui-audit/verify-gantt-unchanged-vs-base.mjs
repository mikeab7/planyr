/* B2160464 — the Schedule GANTT must render pixel-identical before and after the grid-lines change.
 *   node ui-audit/verify-gantt-unchanged-vs-base.mjs [baseRef=3711e18^]
 * Renders the same fixture's Gantt from `git show <baseRef>:public/sequence/index.html` and from the working tree,
 * through the same server, and pixel-diffs the two screenshots (known-good arm: the base compared with itself is 0). */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng, diffImages } from "./lib/pngDiff.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
const ref = process.argv[2] || "3711e18^";
const ROOT = new URL("../public/", import.meta.url).pathname;
const bodies = { base: execFileSync("git", ["show", `${ref}:public/sequence/index.html`], { maxBuffer: 1 << 28 }).toString("utf8"), head: await readFile(new URL("../public/sequence/index.html", import.meta.url), "utf8") };
await ensureVendored();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    const u = new URL(req.url, "http://x"); let p = decodeURIComponent(u.pathname); if (p.endsWith("/")) p += "index.html";
    if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(bodies[u.searchParams.get("v")] || bodies.head))); return; }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(await readFile(fp));
  } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise(r => server.listen(0, r));
const URL_ = v => `http://localhost:${server.address().port}/sequence/?v=${v}`;
const task = o => ({ start: "2026-01-05", end: "2026-01-09", duration: 5, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5, predUnresolved: [], ...o });
const tasks = [task({ id: 1, name: "Summary" }), task({ id: 2, name: "Plain", parentId: 1 }), task({ id: 3, name: "Red", parentId: 1, health: "red", start: "2026-01-12", end: "2026-01-20" }), task({ id: 4, name: "Yellow", parentId: 1, health: "yellow", predecessors: [{ id: 2, type: "FS", lag: 0 }], start: "2026-01-12", end: "2026-01-16" }), task({ id: 5, name: "Green", parentId: 1, health: "green" }), task({ id: 6, name: "Plain 2", start: "2026-02-02", end: "2026-02-13" })];
const fixture = { aPid: 1, nPid: 2, nTid: 1000, view: "gantt", section: "projects", projects: { 1: { id: 1, name: "Gantt Unchanged Check", tasks } } };
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
async function render(v) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on("dialog", d => d.accept());
  await page.goto(URL_(v), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-gantt-unchanged-vs-base");
  await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
  await page.locator('.hdr-view button:has-text("Gantt")').click(); await pacedWait(page, 1500);
  const hasGantt = await page.evaluate(() => document.querySelectorAll("svg").length > 0 && document.body.innerText.includes("Plain"));
  const png = decodePng(await page.screenshot()); await page.close(); return { png, hasGantt };
}
const a = await render("base"), a2 = await render("base"), b = await render("head");
let okAll = true; const ok = (n, c, x = "") => { okAll = okAll && !!c; console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
ok("the Gantt rendered with the fixture tasks (both builds)", a.hasGantt && b.hasGantt);
// the header's save indicator animates (base vs base differs there by 1 level), so the compare is the Gantt BODY only
const HDR = 90, body = im => ({ ...im, height: im.height - HDR, data: im.data.subarray(HDR * im.width * im.channels) });
const self = diffImages(body(a.png), body(a2.png)), d = diffImages(body(a.png), body(b.png));
ok("known-good arm: the base build rendered twice is identical (Gantt body)", self.differing === 0, JSON.stringify(self));
ok(`Gantt body is pixel-identical between ${ref} and the working tree`, d.differing === 0, JSON.stringify(d));
await browser.close(); server.close(); process.exit(okAll ? 0 : 1);
