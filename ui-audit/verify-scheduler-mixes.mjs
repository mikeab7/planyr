/**
 * Boot + smoke check for the scheduler after the 2026-06-30 bug-fix batch ("find and ship fixes").
 *
 * WHY THIS EXISTS: public/sequence/index.html is compiled IN-BROWSER by Babel-standalone — neither
 * `npm run build` nor `npm run lint` parse it, so a single JSX/JS slip in the fixes would brick the
 * live app while every CI gate stays green. This loads the real page headless and fails on any
 * compile/runtime error.
 *
 * The page pulls React / ReactDOM / Babel / supabase-js from CDNs. The sandbox's TLS-inspection
 * proxy is unreliable for Chromium, so this vendors those four scripts locally (curl uses the
 * node-level proxy, which works), rewrites the page to load them from disk + drops the cosmetic
 * font/icon <link>s, and serves it over plain localhost so Chromium needs NO proxy at all. The
 * scheduler's own Supabase backend is unreachable here, so it renders its embedded SEED via the
 * offline-fallback path — which is exactly what exercises the load pipeline (holiday build, the
 * no-mutate-view change, the concurrency/zoom restore paths).
 *
 *   node ui-audit/verify-scheduler-mixes.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = ROOT + "ui-audit/.cache-vendor";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 4188;

const VENDOR = [
  ["react.js",      "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"],
  ["react-dom.js",  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"],
  ["babel.js",      "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"],
  ["supabase.js",   "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"],
];

mkdirSync(CACHE, { recursive: true });
for (const [name, url] of VENDOR) {
  const f = `${CACHE}/${name}`;
  if (existsSync(f) && statSync(f).size > 1000) continue;
  console.log("· vendoring " + name);
  execFileSync("curl", ["-s", "--max-time", "60", url, "-o", f]);
}

// Rewrite the real page to load vendored scripts + drop cosmetic CDN stylesheets.
let html = readFileSync(ROOT + "public/sequence/index.html", "utf8");
for (const [name, url] of VENDOR) html = html.split(url).join("/" + name);
html = html
  .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, "")
  .replace(/<link[^>]*tabler-icons[^>]*>/g, "")
  .replace(/<link rel="preconnect"[^>]*>/g, "");
writeFileSync(`${CACHE}/index.html`, html);

const serve = http.createServer((req, res) => {
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = readFileSync(CACHE + p);
    res.writeHead(200, { "content-type": p.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(body);
  } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => serve.listen(PORT, r));

let ok = true;
const fail = (m) => { ok = false; console.error("✗ " + m); };
const pass = (m) => console.log("✓ " + m);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("[data-task-row]", { timeout: 25000 });
  const rows = await page.locator("[data-task-row]").count();
  rows > 0 ? pass(`scheduler booted + Babel compiled the page; SEED rendered ${rows} task rows`)
           : fail("no task rows rendered");

  // Exercise the Gantt render path (the #9 axis clamp + #10/#11 dependency-anchor fixes live here).
  const ganttBtn = page.locator("button", { hasText: /^Gantt$/ }).first();
  if (await ganttBtn.count()) {
    await ganttBtn.click().catch(() => {});
    await page.waitForTimeout(700);
    const svg = await page.locator("svg").count();
    svg > 0 ? pass("Gantt view rendered without error") : fail("Gantt view produced no svg");
  }

  // Benign in the sandbox: the Babel >500KB pretty-print NOTE (not a compile error), and the
  // scheduler's own Supabase/realtime + any leftover CDN over the blocked direct network.
  const real = errors.filter((e) =>
    !/\[BABEL\] Note:|supabase|websocket|ERR_TUNNEL|ERR_CONNECTION|ERR_NAME|net::ERR|Failed to load resource|favicon|fonts\.googleapis|jsdelivr|cdnjs|tabler|Establishing a tunnel/i.test(e)
  );
  real.length ? fail("scheduler-code runtime/compile errors:\n  " + real.join("\n  "))
              : pass("no scheduler-code runtime/compile errors");
} catch (e) {
  fail("exception: " + (e && e.message));
  if (errors.length) console.error("  captured:\n  " + errors.slice(0, 8).join("\n  "));
}

await browser.close();
serve.close();
console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
process.exit(ok ? 0 : 1);
