// Headless verification for the Scheduler (public/sequence/index.html) bug-fix batch
// B246–B251 (orig B3/M4, B6½, B1, B4, B5/M3, P3). Two checks that matter at runtime:
//   1. The app boots and renders the board with NO real console/page errors — this guards
//      the B5/M3 render-nudge (a loop would throw "Maximum update depth") and the B3/M4
//      module-scope hoist (a broken module evals to a blank app).
//   2. The B3/M4 focus fix: typing a multi-word string into a Header/Cover field keeps
//      focus and accumulates the whole string (pre-fix it remounted per keystroke).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(await readFile(fp));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url);

// Errors expected in the offline sandbox (no Supabase/session); not real failures.
const BENIGN = [/supabase\.co/i, /\[BABEL\]/i, /CORS/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /net::/i];
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(1500); // let any render loop manifest

// --- B3/M4 focus check ---
const TYPED = "ALTA & Topo Survey — Phase 2";
let focusOk = false, valueOk = false, gotValue = "", modalOk = false;
try {
  await page.click('button[title="Export — PDF exhibit or web snapshot"]', { timeout: 5000 });
  await page.click('text=PDF / Print Exhibit', { timeout: 5000 });
  modalOk = await page.waitForSelector('text=Header / Cover', { timeout: 5000 }).then(()=>true).catch(()=>false);
  await page.click('text=Header / Cover'); // headerOpen defaults false — expand it
  const title = page.locator('input[placeholder="Schedule title"]');
  await title.waitFor({ timeout: 5000 });
  await title.click();
  await title.pressSequentially(TYPED, { delay: 25 }); // char-by-char = the focus-loss trigger
  gotValue = await title.inputValue();
  valueOk = gotValue === TYPED;
  focusOk = await title.evaluate(el => el === document.activeElement);
} catch (e) { real.push("FOCUS-TEST: " + e.message); }

await browser.close(); server.close();

const pass = booted && modalOk && valueOk && focusOk && real.length === 0;
console.log(`\nboot(board rendered): ${booted}`);
console.log(`export modal opened : ${modalOk}`);
console.log(`B3/M4 value intact  : ${valueOk}  (got "${gotValue}")`);
console.log(`B3/M4 focus retained: ${focusOk}`);
console.log(`real console errors : ${real.length}`);
real.forEach(e => console.log("   • " + e));
console.log(`\n${pass ? "ALL PASS ✅ — boots clean, no render loop, Header/Cover fields keep focus" : "FAIL ❌"}`);
process.exit(pass ? 0 : 1);
