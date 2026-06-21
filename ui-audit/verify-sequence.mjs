// Headless verification of the embedded Schedule app (public/sequence/index.html).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(fp);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url);

const BENIGN = [/supabase\.co/i, /\[BABEL\] Note/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i];
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(1000);

// Probe bar colors. Navy bracket tints (B194) and the gray task hue (B195).
const probe = await page.evaluate(() => {
  const NAVY = new Set(["rgb(43, 51, 64)","rgb(70, 80, 106)","rgb(110, 119, 144)","rgb(138, 147, 168)"]);
  const GRAY = "rgb(148, 163, 184)";
  const OLD_HEALTH = new Set(["rgb(196, 123, 0)","rgb(220, 38, 38)","rgb(22, 163, 42)"]); // yellow/red/green bar fills (should NOT be bar backgrounds anymore)
  let navy=0, grayFill=0, grayOutline=0, oldHealthBars=0, sampled=0;
  document.querySelectorAll("div").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.height > 12) return; // bar-ish thin elements only
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor, bd = cs.borderTopColor, bw = parseFloat(cs.borderTopWidth)||0;
    if (NAVY.has(bg)) navy++;
    if (bg === GRAY) grayFill++;
    if (bw>0 && bd === GRAY && (bg==="rgba(0, 0, 0, 0)"||bg==="rgb(255, 255, 255)")) grayOutline++;
    if (OLD_HEALTH.has(bg) && r.height <= 8) { oldHealthBars++; }
    sampled++;
  });
  return { navy, grayFill, grayOutline, oldHealthBars };
});

await page.screenshot({ path: OUT + "sequence-split.png" });
await page.screenshot({ path: OUT + "sequence-bars-crop.png", clip: { x: 812, y: 36, width: 588, height: 420 } });

console.log("RENDERED:", rendered);
console.log("PROBE:", JSON.stringify(probe));
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
await browser.close(); server.close();
process.exit(real.length || !rendered ? 1 : 0);
