// B223 + B224 — verify on the built app (dist/):
//  • idle prefetch injects a <link rel=prefetch> for the Schedule iframe doc (B223)
//  • navigating to Schedule shows the themed "assembling" loader in #7F77DD (B224)
//  • no boot regressions from the new wiring.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../dist/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json", ".woff2":"font/woff2", ".png":"image/png" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/" || p === "") p = "/index.html"; if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(fp);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

const BENIGN = [/supabase/i, /CORS/i, /ERR_/i, /WebSocket/i, /Failed to load resource/i, /Cloud/i, /realtime/i, /BABEL/i, /deoptimised/i, /favicon/i, /net::/i, /fetch/i];
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
// Site Planner boots by default; wait for the module tabs.
const booted = await page.waitForSelector('button:has-text("Schedule")', { timeout: 20000 }).then(()=>true).catch(()=>false);

// NEW-2: idle prefetch should inject a <link rel=prefetch> for /sequence/ after boot.
await page.waitForTimeout(2200);
const prefetchLink = await page.evaluate(() =>
  !!document.querySelector('link[rel="prefetch"][href*="/sequence/"]'));

// NEW-3: navigate to Schedule → the themed loader overlay should appear.
await page.click('button:has-text("Schedule")').catch(e => real.push("TAB: "+e.message));
await page.waitForTimeout(400); // past the ~250ms show threshold, before the iframe is interactive
const loader = await page.evaluate(() => {
  const el = document.querySelector('[role="status"]');
  if (!el) return { seen: false };
  const label = el.getAttribute("aria-label") || "";
  const accentEls = [...el.querySelectorAll("rect, path, circle, polygon, span")]
    .filter(n => { const cs = getComputedStyle(n); return cs.fill === "rgb(127, 119, 221)" || cs.backgroundColor === "rgb(127, 119, 221)"; });
  const hasSvg = !!el.querySelector("svg");
  return { seen: true, label, hasSvg, accentCount: accentEls.length };
});
await page.screenshot({ path: OUT + "loader-schedule.png" });

// Loader should cross-fade out once the iframe is interactive.
const iframeOk = await page.waitForSelector('iframe[title="Sequence Planyr"]', { timeout: 15000 }).then(()=>true).catch(()=>false);

// NEW-3 accessibility: with prefers-reduced-motion the cascade + sweep are dropped
// (no playhead, bars carry no CSS animation) — a static skeleton instead.
const rmPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await rmPage.emulateMedia({ reducedMotion: "reduce" });
await rmPage.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("RM-GOTO: "+e.message));
await rmPage.waitForSelector('button:has-text("Schedule")', { timeout: 20000 }).catch(()=>{});
await rmPage.click('button:has-text("Schedule")').catch(()=>{});
await rmPage.waitForTimeout(450);
const reducedMotion = await rmPage.evaluate(() => {
  const el = document.querySelector('[role="status"]');
  if (!el) return { seen: false };
  const bars = [...el.querySelectorAll("rect")];
  const animatedBars = bars.filter(b => getComputedStyle(b).animationName !== "none").length;
  // The SMIL playhead <animate> sits inside a <g>; in reduced mode that <g> isn't rendered.
  const hasPlayheadAnimate = !!el.querySelector("animate");
  return { seen: true, animatedBars, hasPlayheadAnimate };
});
await rmPage.screenshot({ path: OUT + "loader-reduced-motion.png" });
await rmPage.close();

console.log("BOOTED:", booted, "| prefetchLink:", prefetchLink);
console.log("LOADER:", JSON.stringify(loader));
console.log("iframe present:", iframeOk);
console.log("REDUCED-MOTION:", JSON.stringify(reducedMotion));
const rmOk = reducedMotion.seen && reducedMotion.animatedBars === 0 && !reducedMotion.hasPlayheadAnimate;
const pass = booted && prefetchLink && loader.seen && loader.hasSvg && loader.accentCount > 0 && iframeOk && rmOk && real.length === 0;
console.log(pass ? "✅ PASS — prefetch injected; themed #7F77DD loader shown on Schedule nav" : "❌ FAIL");
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
await browser.close(); server.close();
process.exit(pass ? 0 : 1);
