/* Observe the Scheduler module's loading-overlay lifecycle against the built app
 * (vite preview on :4173). Measures when the loader appears/disappears, whether it
 * flickers, and logs the embedded app's nav-state / cloud timing. Diagnostic only. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const t0 = () => Date.now();
const logs = [];
page.on("console", (m) => { const t = m.text(); if (/planar|cloud|supabase|guard|safety|rev/i.test(t)) logs.push(`[console] ${t.slice(0,120)}`); });

const loaderState = async () => page.evaluate(() => {
  const el = document.querySelector('[role="status"]');
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  return { present: true, opacity: Number(cs.opacity), label: el.getAttribute("aria-label") };
});

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(600);
  const start = t0();
  // Navigate to the Schedule module (hash route slug = "schedule")
  await page.evaluate(() => { window.location.hash = "#schedule"; });
  // Poll the loader state for up to 12s, sampling every 100ms
  const samples = [];
  let firstSeen = null, lastSeen = null, gone = null;
  for (let i = 0; i < 120; i++) {
    const s = await loaderState();
    const t = t0() - start;
    if (s.present && s.opacity > 0.05) { if (firstSeen == null) firstSeen = t; lastSeen = t; }
    if (firstSeen != null && (!s.present || s.opacity <= 0.05) && gone == null && t > firstSeen + 50) gone = t;
    samples.push({ t, present: s.present, op: s.present ? +s.opacity.toFixed(2) : null });
    // stop early once the iframe is interactive and loader is gone
    if (gone != null && t > gone + 400) break;
    await page.waitForTimeout(100);
  }
  // Did the embedded iframe become interactive? (Gantt grid / its body present)
  const iframeReady = await page.evaluate(() => {
    const f = document.querySelector('iframe[title="Sequence Planyr"]');
    try { return !!(f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.childElementCount > 0); } catch { return "cross-doc"; }
  });

  console.log("=== Scheduler loader observation ===");
  console.log(`loader first visible at: ${firstSeen == null ? "NEVER" : firstSeen + "ms"}`);
  console.log(`loader last visible at:  ${lastSeen == null ? "—" : lastSeen + "ms"}`);
  console.log(`loader gone at:          ${gone == null ? "STILL PRESENT at end" : gone + "ms"}`);
  console.log(`visible duration:        ${firstSeen != null && gone != null ? (gone - firstSeen) + "ms" : "n/a"}`);
  console.log(`iframe interactive:      ${iframeReady}`);
  // flicker check: count transitions present→absent→present
  let flips = 0; let prev = null;
  for (const s of samples) { const vis = s.present && s.op > 0.05; if (prev != null && vis !== prev) flips++; prev = vis; }
  console.log(`visibility transitions:  ${flips} (2 = clean show→hide; >2 = flicker)`);
  console.log("--- opacity trace (every ~300ms) ---");
  console.log(samples.filter((_, i) => i % 3 === 0).map((s) => `${s.t}:${s.present ? s.op : "-"}`).join("  "));
  console.log("--- relevant console logs ---");
  console.log(logs.slice(0, 15).join("\n") || "(none)");
} catch (e) {
  console.log("harness threw:", e.message);
}
await ctx.close();
await browser.close();
