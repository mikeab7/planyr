/* Diagnose why the Schedule (Sequence Planyr) module "doesn't work" on planyr.io.
 *
 * Drives the BUILT app (vite preview on :4173) in headless Chromium and reproduces
 * three real-world scenarios, printing a clear report for each:
 *
 *   A. NORMAL — click the Schedule tab on a fresh load. Does the workspace mount,
 *      does the /sequence/ iframe attach, or does the ErrorBoundary appear?
 *   B. STALE-BUT-RECOVERABLE — the Scheduler chunk 404s on the FIRST request, then
 *      succeeds (mimics a redeploy where reload picks up the live build). Does the
 *      B221 auto-reload guard recover and land us in the module?
 *   C. PERSISTENTLY-MISSING — the Scheduler chunk 404s on EVERY request (mimics a
 *      hard-cached old index.html that keeps pointing at a deleted chunk, or a broken
 *      deploy). Does it loop, or land on a legible ErrorBoundary with a working
 *      hard-reload button?
 *
 * Run:  npm run build && npx vite preview --port 4173   (then, another shell)
 *       node ui-audit/diagnose-scheduler.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const GUARD_KEY = "planyr:chunkReloadAt";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

function wireConsole(page, sink) {
  page.on("console", (m) => { if (m.type() === "error") sink.push("console: " + m.text()); });
  page.on("pageerror", (e) => sink.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (/Scheduler-|sequence|assets\//.test(u)) sink.push(`requestfailed: ${u} (${r.failure()?.errorText})`);
  });
}

async function clickSchedule(page) {
  // Row-2 module tab labelled "Schedule".
  const tab = page.getByRole("button", { name: "Schedule" });
  await tab.waitFor({ timeout: 15000 });
  await tab.click();
}

async function inspect(page) {
  return await page.evaluate(() => {
    // Either boundary variant: the generic render-crash one OR the B228 stale-chunk
    // "A new version of Planyr is ready" one.
    const boundary = [...document.querySelectorAll("p")].some((p) =>
      /hit an error and couldn't load|new version of Planyr is ready/i.test(p.textContent || ""));
    const boundaryMsg = (document.querySelector("pre")?.textContent || "").trim();
    const iframe = document.querySelector('iframe[title="Sequence Planyr"]');
    return {
      errorBoundary: boundary,
      boundaryMsg,
      iframePresent: !!iframe,
      iframeSrc: iframe?.getAttribute("src") || null,
    };
  });
}

const line = (s = "") => console.log(s);

/* ── Scenario A — normal click into Schedule ─────────────────────────── */
async function scenarioA() {
  line("\n══ A. NORMAL click into Schedule ══");
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  wireConsole(page, errs);
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate((k) => sessionStorage.removeItem(k), GUARD_KEY);
  await clickSchedule(page);
  await page.waitForTimeout(3500);
  const r = await inspect(page);
  line("  errorBoundary:  " + r.errorBoundary + (r.errorBoundary ? "  ❌" : "  ✅"));
  if (r.errorBoundary) line("  boundaryMsg:    " + r.boundaryMsg);
  line("  iframe present: " + r.iframePresent + "  src=" + r.iframeSrc);
  // Did the iframe's Gantt actually render inside? The embedded doc transpiles ~500KB
  // of JSX with in-browser Babel, so poll up to ~15s before concluding it's blank.
  let inner = "n/a";
  try {
    const fr = page.frames().find((f) => /\/sequence\//.test(f.url()));
    if (fr) {
      await fr.waitForSelector("[data-task-row]", { timeout: 15000 }).catch(() => {});
      inner = await fr.evaluate(() => ({ tasks: document.querySelectorAll("[data-task-row]").length, bodyLen: document.body.innerText.length })).then(JSON.stringify);
    }
  } catch (e) { inner = "err: " + e.message; }
  line("  iframe inner:   " + inner + (/\"tasks\":[1-9]/.test(inner) ? "  ✅ Gantt rendered" : "  ⚠️ no task rows"));
  await page.screenshot({ path: new URL("./screens/diag-scheduler-A.png", import.meta.url).pathname });
  errs.slice(0, 12).forEach((e) => line("  • " + e));
  await page.close();
  return r;
}

/* ── Scenario B — stale chunk that recovers on reload ────────────────── */
async function scenarioB() {
  line("\n══ B. STALE chunk, 404 once then recovers ══");
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  wireConsole(page, errs);
  let hits = 0;
  await page.route("**/Scheduler-*.js", async (route) => {
    hits++;
    if (hits === 1) { line("  → intercept #" + hits + ": returning 404 (simulating deleted chunk)"); return route.fulfill({ status: 404, body: "gone" }); }
    line("  → intercept #" + hits + ": passing through (live build)");
    return route.continue();
  });
  let reloads = 0;
  page.on("load", () => { reloads++; });
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate((k) => sessionStorage.removeItem(k), GUARD_KEY);
  const baseLoads = reloads;
  await clickSchedule(page);
  await page.waitForTimeout(4000); // allow preloadError → reload → re-fetch
  const r = await inspect(page);
  line("  chunk requests: " + hits + "   page (re)loads after click: " + (reloads - baseLoads));
  line("  errorBoundary:  " + r.errorBoundary + (r.errorBoundary ? "  ❌ (did NOT recover)" : "  ✅ recovered"));
  line("  iframe present: " + r.iframePresent);
  await page.screenshot({ path: new URL("./screens/diag-scheduler-B.png", import.meta.url).pathname });
  await page.close();
  return r;
}

/* ── Scenario C — chunk permanently missing ─────────────────────────── */
async function scenarioC() {
  line("\n══ C. PERSISTENTLY missing chunk (every request 404) ══");
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  wireConsole(page, errs);
  // Record every navigation URL so we can catch the throwaway ?_r= param even though
  // it's stripped from the address bar on the next load.
  const navUrls = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navUrls.push(f.url()); });
  let hits = 0;
  await page.route("**/Scheduler-*.js", async (route) => { hits++; return route.fulfill({ status: 404, body: "gone" }); });
  let reloads = 0;
  page.on("load", () => { reloads++; });
  await page.goto(BASE, { waitUntil: "load" });
  // Pre-seed the cooldown as already-active so the auto-reload guard stays out of the
  // way and the boundary surfaces directly — this isolates the boundary's OWN button
  // (the manual escape hatch a user actually sees after auto-recovery is exhausted).
  await page.evaluate((k) => sessionStorage.setItem(k, String(Date.now())), GUARD_KEY);
  const baseLoads = reloads;
  await clickSchedule(page);
  await page.waitForTimeout(2500);
  const r = await inspect(page);
  line("  chunk requests: " + hits + "   auto-reloads (cooldown active ⇒ expect 0): " + (reloads - baseLoads) + (reloads - baseLoads === 0 ? "  ✅" : "  ⚠️"));
  line("  errorBoundary:  " + r.errorBoundary + (r.errorBoundary ? "  ✅ surfaced" : "  ❌ no boundary shown"));
  if (r.errorBoundary) line("  boundaryMsg:    " + r.boundaryMsg);
  // The B228 boundary frames this as an update: a single primary cache-busting reload.
  const buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));
  line("  buttons:        " + JSON.stringify(buttons));
  // Click the primary button → confirm it navigates with a throwaway ?_r= (cache-bust).
  let freshReload = false;
  if (r.errorBoundary && buttons.length) {
    const nav = page.waitForNavigation({ timeout: 6000 }).catch(() => null);
    await page.getByRole("button", { name: buttons[0] }).click().catch(() => {});
    await nav;
    freshReload = navUrls.some((u) => /[?&]_r=\d+/.test(u));
  }
  line("  primary button → cache-busting reload: " + freshReload + (freshReload ? "  ✅" : "  ❌"));
  line("  nav urls:       " + JSON.stringify(navUrls.map((u) => u.replace(BASE, "/"))));
  await page.screenshot({ path: new URL("./screens/diag-scheduler-C.png", import.meta.url).pathname });
  await page.close();
  return { ...r, freshReload, primaryButton: buttons[0] };
}

const a = await scenarioA();
const b = await scenarioB();
const c = await scenarioC();

line("\n══ SUMMARY ══");
line("  A normal:            " + (a.errorBoundary ? "ERROR BOUNDARY ❌" : (a.iframePresent ? "iframe mounted ✅" : "no iframe ❓")));
line("  B stale-recoverable: " + (b.errorBoundary ? "did NOT recover ❌" : "recovered ✅"));
line("  C persistent-missing:" + (c.errorBoundary ? "boundary shown ✅" : "no boundary ❌") + " | primary='" + c.primaryButton + "' → fresh reload " + (c.freshReload ? "✅" : "❌"));

await browser.close();
