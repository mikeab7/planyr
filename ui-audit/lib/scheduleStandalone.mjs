/* Boots public/sequence/index.html (or the DEPLOYED bytes of it) in headless Chromium for a harness.
 * Same recipe verify-grid-row-hold.mjs uses (vendored CDN assets, local static server) — shared here so
 * every scheduler harness need not repeat it. Returns { page, url, close, provenance }. */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { ensureVendored, rewriteCdn, serveVendored } from "./vendorCdn.mjs";
import { servedProvenance, provenanceReport } from "./deployedTarget.mjs";

const ROOT = new URL("../../public/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(existsSync);

export async function bootSchedule({ deployed = process.env.PLANYR_URL || null, viewport = { width: 1600, height: 950 }, hash = "" } = {}) {
  await ensureVendored();
  let deployedBody = null, provenance = null;
  if (deployed) {
    provenance = await servedProvenance(deployed);
    console.log(provenanceReport(provenance, deployed));
    if (!provenance.ok) throw new Error("the deployed artifact could not be read — nothing here would be a measurement of it");
    deployedBody = provenance.body;
  }
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      let body = (deployedBody && p.endsWith("sequence/index.html")) ? deployedBody : await readFile(fp);
      if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteCdn(body.toString("utf8")));
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/sequence/${hash}`;
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
  return { page, url, provenance, browser, close: async () => { await browser.close(); server.close(); } };
}
