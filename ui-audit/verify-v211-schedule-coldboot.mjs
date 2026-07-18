/* verify-v211-schedule-coldboot.mjs — V211 (B644 x2) live self-verify, local build.
 *
 * Covers the three pending V211 steps against the merged HEAD build:
 *  1. Fresh project (Start blank) -> Schedule tab = clean empty state/connect panel,
 *     no "This view failed to load — Cannot read properties of null (reading 'projects')"
 *     banner behind the modal.
 *  2. The original cold-boot Site->Schedule first switch of a session (V153 path) —
 *     same navigation, first thing in a brand-new browser context (no prior warm nav).
 *  3. Observation only: does the "Assembling schedule…" loader overlay exceed the 6s
 *     backstop on this cold load? (loader-timing is a separate, non-blocking observation
 *     per B644/B494/B495 — this fix does not claim to change it.)
 *
 * Reuses the CDN-vendoring trick from verify-b644-fresh-null.mjs (sandbox Chromium can't
 * tunnel to the CDN hosts directly; the assets are fetched once via curl, which does
 * proxy cleanly, then served to the page via request interception).
 *
 * Usage: npm run build && npx vite preview --port 4173 &  then  node ui-audit/verify-v211-schedule-coldboot.mjs
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
  if (!existsSync(p)) execFileSync("curl", ["-s", "-o", p, url]);
}

async function runOnce(label) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    for (const [file, , re] of ASSETS) {
      if (re.test(url)) return route.fulfill({ body: readFileSync(join(CDN, file)), contentType: "application/javascript" });
    }
    if (/fonts\.googleapis|tabler-icons/.test(url)) return route.fulfill({ body: "", contentType: "text/css" });
    return route.abort();
  });

  const nullProjectErrors = [];
  page.on("console", (m) => { if (m.type() === "error" && /null \(reading 'projects'\)/.test(m.text())) nullProjectErrors.push(m.text()); });
  page.on("pageerror", (e) => { if (/null \(reading 'projects'\)/.test(e.message)) nullProjectErrors.push("PAGEERROR: " + e.message); });

  let out = { label, pass: false, detail: "" };
  try {
    await page.goto(BASE, { waitUntil: "load" });
    const startBlank = page.getByRole("button", { name: "Start blank" });
    await startBlank.waitFor({ state: "visible", timeout: 20000 });
    await startBlank.click();
    await page.waitForTimeout(1000);

    const switchAt = Date.now();
    await page.getByRole("button", { name: "Schedule", exact: true }).first().click()
      .catch(() => page.getByText("Schedule", { exact: true }).first().click());

    // Poll up to 20s for the failure banner / loader-clear timing.
    let sawFailure = false, loaderClearedMs = null, lastAssembling = false;
    for (let i = 0; i < 40; i++) {
      const state = await page.evaluate(() => {
        const body = document.body.innerText || "";
        return { hasFailure: /This view failed to load/i.test(body), hasAssembling: /Assembling schedule/i.test(body) };
      });
      if (state.hasFailure) { sawFailure = true; break; }
      if (!state.hasAssembling && loaderClearedMs === null) loaderClearedMs = Date.now() - switchAt;
      lastAssembling = state.hasAssembling;
      if (loaderClearedMs !== null) break;
      await page.waitForTimeout(500);
    }

    const embed = await page.evaluate(() => {
      const f = document.querySelector("iframe");
      if (!f) return { iframe: false };
      try {
        const body = f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText : "";
        return { iframe: true, failed: /This view failed to load/i.test(body), rendered: body.trim().length > 0 };
      } catch { return { iframe: true, crossDoc: true }; }
    });

    out.pass = !sawFailure && !embed.failed && nullProjectErrors.length === 0;
    out.detail = JSON.stringify({ sawFailure, loaderClearedMs, stillAssemblingAt20s: lastAssembling && loaderClearedMs === null, embed, nullProjectErrors: nullProjectErrors.slice(0, 2) });
  } catch (e) {
    out.detail = "harness error: " + e.message;
  } finally {
    await browser.close();
  }
  return out;
}

const results = [];
results.push(await runOnce("cold-boot-1 (V153 path: brand-new context, Start blank -> Schedule)"));
results.push(await runOnce("cold-boot-2 (repeat, fresh context each time)"));

let allPass = true;
for (const r of results) {
  console.log(`${r.label}: ${r.pass ? "PASS" : "FAIL"} — ${r.detail}`);
  if (!r.pass) allPass = false;
}
process.exit(allPass ? 0 : 1);
