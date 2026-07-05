/* verify-b644-fresh-null.mjs — B644 recurrence (fresh-project null crash) self-test.
 *
 * Repro it guards: Start blank → Schedule tab. The shell posts planar:nav-* into the
 * sequence iframe before its async hs-v1 load resolves; pre-fix, the queued functional
 * updater read `d.projects` with d === null INSIDE the next useState render and crashed
 * App into the error boundary ("This view failed to load — Cannot read properties of
 * null (reading 'projects')") behind the connect-a-schedule panel.
 *
 * PASS = the embed renders (no error boundary, no null-projects TypeError in console).
 * The embed's CDN deps (React/Babel/Supabase) are served from local copies via request
 * interception — sandbox Chromium egress can't tunnel to the CDNs (same class as the
 * V204 GIS mock note); the copies are fetched once with curl, which does proxy cleanly.
 *
 * Usage: npm run build && npx vite preview --port 4173 &  then  node ui-audit/verify-b644-fresh-null.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const CDN = process.env.CDN_DIR || join(dirname(fileURLToPath(import.meta.url)), ".cache-vendor");

const ASSETS = [
  ["react.js", "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js", /react\/18\.2\.0\/umd\/react\.production\.min\.js/],
  ["react-dom.js", "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js", /react-dom\/18\.2\.0\/umd\/react-dom\.production\.min\.js/],
  ["supabase.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", /@supabase\/supabase-js@2/],
  ["babel.js", "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js", /@babel\/standalone@7\/babel\.min\.js/],
];
mkdirSync(CDN, { recursive: true });
for (const [file, url] of ASSETS) {
  const p = join(CDN, file);
  if (!existsSync(p)) execFileSync("curl", ["-s", "-o", p, url]); // curl rides HTTPS_PROXY + CA bundle
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.route(/^https:\/\//, async (route) => {
  const url = route.request().url();
  for (const [file, , re] of ASSETS) {
    if (re.test(url)) return route.fulfill({ body: readFileSync(join(CDN, file)), contentType: "application/javascript" });
  }
  if (/fonts\.googleapis|tabler-icons/.test(url)) return route.fulfill({ body: "", contentType: "text/css" });
  return route.abort(); // Supabase/GIS/etc — the embed must survive offline (it has an offline fallback)
});

const nullProjectErrors = [];
page.on("console", (m) => { if (m.type() === "error" && /null \(reading 'projects'\)/.test(m.text())) nullProjectErrors.push(m.text()); });
page.on("pageerror", (e) => { if (/null \(reading 'projects'\)/.test(e.message)) nullProjectErrors.push("PAGEERROR: " + e.message); });

let pass = false, detail = "";
try {
  await page.goto(BASE, { waitUntil: "load" });
  const startBlank = page.getByRole("button", { name: "Start blank" });
  await startBlank.waitFor({ state: "visible", timeout: 20000 });
  await startBlank.click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Schedule", exact: true }).first().click()
    .catch(() => page.getByText("Schedule", { exact: true }).first().click());
  await page.waitForTimeout(15000);

  const embed = await page.evaluate(() => {
    const f = document.querySelector("iframe");
    if (!f) return { iframe: false };
    try {
      const body = f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText : "";
      return { iframe: true, failed: /This view failed to load/i.test(body), rendered: body.trim().length > 0 };
    } catch { return { iframe: true, crossDoc: true }; }
  });

  pass = embed.iframe && !embed.crossDoc && !embed.failed && embed.rendered && nullProjectErrors.length === 0;
  detail = JSON.stringify({ embed, nullProjectErrors: nullProjectErrors.slice(0, 2) });
} catch (e) {
  detail = "harness error: " + e.message;
} finally {
  await browser.close();
}

console.log(`B644 fresh-project null crash: ${pass ? "PASS" : "FAIL"} — ${detail}`);
process.exit(pass ? 0 : 1);
