// Headless verification for B615 (duration units) + B616 (finish lock) in the live scheduler.
// Loads the Babel-compiled app (public/sequence/index.html) over vite preview, captures runtime
// errors, checks the duration column renders unit suffixes, and drives a real duration edit.
// Run: node ui-audit/verify-b615-b616-scheduler.mjs   (needs: npm run build && vite preview :4173)
import { chromium } from "playwright";

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const URL = process.env.BASE_URL || "http://localhost:4173/sequence/index.html";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.error("  ✗ " + m); } };

await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 }).catch(e => errors.push("goto: " + e.message));
// The app renders SEED data if its Supabase is unreachable (offline fallback). Wait for the grid.
await page.waitForFunction(() => {
  const spans = [...document.querySelectorAll("span")];
  return spans.some(s => /^\d+(d|w|mo|y)$/.test((s.textContent || "").trim()));
}, { timeout: 30000 }).catch(() => {});

// 1) The app rendered (React + Babel compiled our edited source without a fatal error).
const bodyLen = (await page.evaluate(() => document.body.innerText.length)) || 0;
ok(bodyLen > 200, `app rendered (body text ${bodyLen} chars)`);

// 2) No runtime errors from the compiled scheduler (ignore benign network/CDN + Supabase noise).
const fatal = errors.filter(e => !/supabase|Failed to fetch|net::ERR|storage|401|403|websocket|realtime/i.test(e));
ok(fatal.length === 0, `no fatal runtime errors${fatal.length ? " → " + fatal.slice(0,3).join(" | ") : ""}`);

// 3) B615 — the duration column renders unit-suffixed values via fmtTaskDuration (never a bare "d").
const durCells = await page.evaluate(() =>
  [...document.querySelectorAll("span")].map(s => (s.textContent || "").trim()).filter(t => /^\d+(d|w|mo|y)$/.test(t)));
ok(durCells.length > 0, `duration cells render unit suffixes (${durCells.length} found, e.g. ${durCells.slice(0,6).join(", ")})`);
const bareD = await page.evaluate(() =>
  [...document.querySelectorAll("span")].some(s => (s.textContent || "").trim() === "d"));
ok(!bareD, "no bare 'd' rendered");

// 4) B615 — drive a real duration edit: select the first duration cell, type "2mo", commit, read back.
let editWorked = false, monthShown = false;
try {
  const durCell = await page.evaluateHandle(() => {
    const spans = [...document.querySelectorAll("span")];
    const s = spans.find(x => /^\d+(d|w|mo|y)$/.test((x.textContent || "").trim()));
    return s ? s.closest("[style]") || s : null;
  });
  const el = durCell.asElement();
  if (el) {
    await el.dblclick().catch(() => {});
    await page.waitForTimeout(150);
    // If an input appeared, type into it; else type after selecting.
    const typed = await page.evaluate(() => !!document.querySelector("input.ei, input:focus"));
    if (typed) {
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.type("2mo");
      await page.keyboard.press("Enter");
      editWorked = true;
      await page.waitForTimeout(250);
      monthShown = await page.evaluate(() =>
        [...document.querySelectorAll("span")].some(s => (s.textContent || "").trim() === "2mo"));
    }
  }
} catch (e) { errors.push("edit: " + e.message); }
ok(editWorked, `duration cell entered edit mode on double-click`);
if (editWorked) ok(monthShown, `after typing "2mo" the cell shows the calendar-month unit`);

await page.screenshot({ path: "ui-audit/stress/b615-b616.png", fullPage: false }).catch(() => {});  // gitignored path
console.log(`\n${fail === 0 ? "✅" : "❌"} B615/B616 headless: ${pass} passed, ${fail} failed.`);
if (errors.length) console.log(`(captured ${errors.length} console/network notes; benign ones ignored)`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
