/* Verify B409 rework (chunked uploads) — logged-out boot smoke. The full upload/stream
 * path is auth-gated + Drive-backed (V280 covers it live); what CAN regress here is an
 * import-time crash from the rewired modules (reviewStore ← chunkedUpload; DocReview's
 * streaming open; FileBrowser's progress wiring), which would blank a whole workspace.
 *
 *   1. the shell boots with no page error;
 *   2. the Library workspace mounts without a crash;
 *   3. the Review workspace mounts without a crash (loadPdf/driveStreamSource imports live
 *      in its lazy chunk);
 *   4. no request ever went to the RETIRED endpoints (/api/files/resumable, POST /api/files).
 *
 * Run: npx vite preview --port 4173 &  then  node ui-audit/verify-b409-chunked-boot.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const retiredHits = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/files/resumable")) retiredHits.push(`${r.method()} ${u}`);
  if (r.method() === "POST" && /\/api\/files(\?|$)/.test(u)) retiredHits.push(`POST ${u}`);
});

const checks = [];
const ok = (name, cond, extra = "") => { checks.push({ name, pass: !!cond }); console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);
ok("shell boots with no page error", errors.length === 0, errors.join(" | ") || "clean");

const clickTab = async (label) => {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll("header button")].find((x) => (x.textContent || "").trim() === l);
    b && b.click();
  }, label);
  await page.waitForTimeout(1800);
};

await clickTab("Library");
ok("Library workspace mounts without a crash (FileBrowser progress wiring)", errors.length === 0, errors.join(" | ") || "clean");

await clickTab("Review");
ok("Review workspace mounts without a crash (reviewStore ← chunkedUpload, streaming open)", errors.length === 0, errors.join(" | ") || "clean");

ok("no request hit a retired upload endpoint", retiredHits.length === 0, retiredHits.join(" | ") || "none");

await browser.close();
const passed = checks.filter((c) => c.pass).length;
console.log(`\nB409 rework boot smoke: ${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
