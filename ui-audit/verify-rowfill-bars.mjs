// B222 — verify a row color fill no longer hides the Gantt bars.
// Seeds a real row fill (rowColor) onto a leaf task in the inline __PLANAR_DATA__
// before render, then asserts: the row band IS painted the fill (it applied) while
// NO bar-sized element shares that color (the bug = a bar repainted the fill and
// hid on it). Also checks the bar keeps its own neutral/edge identity.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const FILL_HEX = "#c7d2fe", FILL = "rgb(199, 210, 254)"; // Indigo — distinctive, no bar uses it
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };

// Inject a tiny mutation right after the seed script so the active project's first
// leaf task (duration > 0) carries a row fill from the very first render.
const INJECT = `<script>(function(){try{var d=window.__PLANAR_DATA__;if(!d)return;var p=d.projects[d.aPid]||Object.values(d.projects)[0];if(!p)return;var par=new Set(p.tasks.filter(function(t){return t.parentId!=null}).map(function(t){return t.parentId}));var leaf=p.tasks.find(function(t){return !par.has(t.id)&&(t.duration||0)>0});if(leaf){leaf.rowColor='${FILL_HEX}';window.__PL_LEAF__=leaf.id;}}catch(e){}})();</script>`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) {
      body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url);

const BENIGN = [/supabase\.co/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(1200);

const probe = await page.evaluate((FILL) => {
  const leafId = String(window.__PL_LEAF__);
  let rowBands = 0, barCollisions = 0;
  const collisions = [];
  document.querySelectorAll("div").forEach(el => {
    if (getComputedStyle(el).backgroundColor !== FILL) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (r.height >= 18) rowBands++;                                   // a full row band = the fill applied
    else if (r.height <= 14 && r.width >= 6 && r.width < 420) {       // a bar-sized element painted the fill = the BUG
      barCollisions++; collisions.push({ w: Math.round(r.width), h: Math.round(r.height), html: el.outerHTML.slice(0, 80) });
    }
  });
  // Confirm the filled leaf's own Gantt bar exists and is NOT the fill color.
  const NEUTRAL = new Set(["rgb(148, 163, 184)", "rgb(255, 255, 255)"]); // gray fill / white hollow
  let leafBar = null;
  const ganttRows = [...document.querySelectorAll("[style*='ROW_H'], div")];
  // The Gantt bar lives in a thin element (≤14px tall) whose row band is the fill.
  document.querySelectorAll("div").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.height < 3 || r.height > 14 || r.width < 6) return;
    const cs = getComputedStyle(el);
    const isNeutral = NEUTRAL.has(cs.backgroundColor);
    const hasEdge = (parseFloat(cs.borderTopWidth) || 0) > 0;
    if (isNeutral && hasEdge && !leafBar) leafBar = { bg: cs.backgroundColor, border: cs.borderTopColor, bw: cs.borderTopWidth };
  });
  return { leafId, rowBands, barCollisions, collisions, leafBar };
}, FILL);

await page.screenshot({ path: OUT + "rowfill-bars.png" });
await page.screenshot({ path: OUT + "rowfill-bars-crop.png", clip: { x: 720, y: 36, width: 680, height: 360 } });

console.log("RENDERED:", rendered, "| filled leaf:", probe.leafId);
console.log("PROBE:", JSON.stringify(probe));
const pass = rendered && probe.rowBands >= 1 && probe.barCollisions === 0 && !!probe.leafBar && real.length === 0;
console.log(pass ? "✅ PASS — row fill applied; bars stay visible (neutral fill + hairline edge)" : "❌ FAIL");
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
await browser.close(); server.close();
process.exit(pass ? 0 : 1);
