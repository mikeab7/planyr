/* Verify the Scheduler loading-overlay fix (reliable + bounded ready signal) against the
 * REAL built shell (vite preview on :4173), with the heavy embedded /sequence/ app replaced
 * by a tiny CONTROLLABLE stub via Playwright request interception — so we can exercise the
 * handshake + fallback paths that the sandbox's blocked CDN otherwise prevents (the real embed
 * never finishes loading here, so its iframe onLoad never fires).
 *
 *   A — RESPONSIVE embed: replies to the shell's `planar:nav-request` with a `nav-state`.
 *       Expect the loader to drop FAST (handshake), well under the old 9 s and under the
 *       2.5 s onLoad fallback.
 *   B — SILENT embed: loads but never signals. Expect the loader to drop at ~onLoad+2.5 s
 *       (the bounded fallback), NOT the old 9 s and not even the 6 s backstop.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-scheduler-loader.mjs              (another)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const stubHtml = (responsive) => `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;font-family:system-ui"><div id="app">stub Gantt</div><script>
  // Mimic the embedded scheduler's shell bridge just enough to exercise the loader handshake.
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.source !== "planar-shell") return;
    if (e.data.type === "planar:nav-request" && ${responsive ? "true" : "false"}) {
      parent.postMessage({ source: "planar-seq", type: "planar:nav-state",
        section: "projects", activeId: "p1", projects: [{ id: "p1", name: "Test Project" }] }, e.origin);
    }
  });
</script></body></html>`;

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

async function run(responsive) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // Stub the embedded app document (but NOT the shell's own assets).
  await ctx.route("**/sequence/", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: stubHtml(responsive) }));
  const page = await ctx.newPage();
  let navRequested = false;
  await page.exposeFunction("__noteNavReq", () => { navRequested = true; });

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const start = Date.now();
  await page.evaluate(() => { window.location.hash = "#schedule"; });

  const loaderGone = async () => page.evaluate(() => {
    const el = document.querySelector('[role="status"]');
    if (!el) return true;
    return Number(getComputedStyle(el).opacity) <= 0.05;
  });
  let firstSeen = null, goneAt = null;
  for (let i = 0; i < 100; i++) {
    const t = Date.now() - start;
    const present = await page.evaluate(() => {
      const el = document.querySelector('[role="status"]');
      return el ? Number(getComputedStyle(el).opacity) > 0.05 : false;
    });
    if (present && firstSeen == null) firstSeen = t;
    if (firstSeen != null && !present && goneAt == null && t > firstSeen + 30) { goneAt = t; break; }
    await page.waitForTimeout(80);
  }
  await ctx.close();
  await browser.close();
  return { firstSeen, goneAt };
}

try {
  console.log("--- Scenario A: responsive embed (handshake) ---");
  const a = await run(true);
  console.log(`  loader visible ${a.firstSeen ?? "—"}ms → gone ${a.goneAt ?? "NEVER"}ms`);
  ok("A: loader drops fast via handshake (<2000ms)", a.goneAt != null && a.goneAt < 2000, `gone at ${a.goneAt}ms (old behaviour: 9000ms safety net)`);

  console.log("--- Scenario B: silent embed (bounded fallback) ---");
  const b = await run(false);
  console.log(`  loader visible ${b.firstSeen ?? "—"}ms → gone ${b.goneAt ?? "NEVER"}ms`);
  ok("B: silent embed still bounded (onLoad+2.5s, <4000ms)", b.goneAt != null && b.goneAt < 4000, `gone at ${b.goneAt}ms (old behaviour: 9000ms; must be well under)`);
  ok("B: but not instant (loader did show, ≥1500ms)", b.goneAt != null && b.goneAt >= 1500, `gone at ${b.goneAt}ms (the onLoad fallback, not a premature drop)`);
} catch (e) {
  ok("harness", false, "threw: " + e.message);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
