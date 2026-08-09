/**
 * B276576 — THE APP ENTRY MUST NOT BOOT BEHIND A CROSS-ORIGIN RENDER-BLOCKING RESOURCE.
 *
 * THE DEFECT THIS GUARDS. index.html used to carry
 *     <link href="https://fonts.googleapis.com/css2?family=Inter:…" rel="stylesheet" />
 * A stylesheet is render-blocking, and — the part that actually bit — a script cannot EXECUTE
 * until every preceding stylesheet has resolved. So `<script type="module" src="/src/main.jsx">`,
 * i.e. the entire application, waited on a round trip to a third-party host on every load, and
 * that host's latency passed through one-for-one. The landing page had the same defect and fixed
 * it in B1384 (DOMContentLoaded 12,964 ms → 149 ms); the app entry was never carried across.
 *
 * WHY THIS HARNESS EXISTS RATHER THAN A UNIT TEST. `test/bootRenderBlocking.test.js` asserts the
 * STATIC property — no cross-origin render-blocking tag in the HTML — and is the cheap gate that
 * runs in CI. It cannot show that the property MATTERS. This one measures the behaviour in a real
 * browser, and it is built as an A/B so it can never rot into a permanent green:
 *
 *   ARM A — CONTROL (the pre-fix build, deliberately wrong). dist/index.html with the removed
 *           <link> re-injected. With the font host delayed, this arm MUST stall. If it does not,
 *           the harness FAILS — because an instrument that cannot see the bug it was built for is
 *           not evidence of anything, and a negative control that passes silently is worthless.
 *   ARM B — SHIPPED (what we actually serve). Same server, same delay, same page. Must be
 *           unaffected, and must make ZERO requests to the font host.
 *
 * Both arms run in the SAME process against the SAME build, so the comparison is not across two
 * runs on two machines. The delay is injected with page.route rather than by throttling the
 * network, so it isolates one variable: how long the third-party host takes to answer.
 *
 * Run:  npm run perf:fontblock            (builds if dist/ is missing)
 *       node ui-audit/verify-font-blocking.mjs --delay 2000 --json
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const argv = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DELAY = Number(argOf("--delay", "2000"));
/* The stall assertions are expressed as a fraction of the injected delay, so a tiny delay makes
 * them meaningless rather than lenient: at --delay 0 the bar is 0 ms, "control >= 0" passes for
 * free and "shipped < 0" cannot pass at all. Refuse instead of reporting a degenerate verdict.
 * (--delay 0 IS still a useful measurement — it shows the pre-fix cost of a perfectly fast font
 * host, ~150 ms of first paint — so it is offered as an explicitly unjudged mode.) */
const MIN_DELAY = 500;
if (!Number.isFinite(DELAY) || DELAY < 0) { console.error("--delay must be a non-negative number of ms"); process.exit(2); }
const MEASURE_ONLY = DELAY < MIN_DELAY;
const JSON_OUT = argv.includes("--json");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/* The stylesheet the control arm gets back once its artificial delay elapses. Content is
 * irrelevant to the measurement — what matters is that the browser was WAITING for it. Kept
 * valid so the control arm fails for the reason under test and not for a parse error. */
const FONT_CSS = `@font-face{font-family:'Inter';font-style:normal;font-weight:400;src:local('Inter');}`;

/* The exact tag that was removed from index.html, re-injected verbatim to build the control. */
const REMOVED_TAG =
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />';

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(2);
}

/* ---- A minimal static server over dist/, plus the synthesized control document -------------- */
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".map": "application/json", ".txt": "text/plain",
};

const shippedHtml = await readFile(join(DIST, "index.html"), "utf8");
/* Inject where it originally lived: in <head>, before the entry module script. Asset URLs in the
 * control are untouched and absolute, so both arms load byte-identical JS and CSS off one server. */
const controlHtml = shippedHtml.replace(/<script type="module"/, `${REMOVED_TAG}\n    <script type="module"`);
if (controlHtml === shippedHtml) {
  console.error("could not build the control arm: no <script type=module> found in dist/index.html");
  process.exit(2);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = decodeURIComponent(url.pathname);
  if (path === "/__control/" || path === "/__control") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(controlHtml);
  }
  if (path === "/" || path.endsWith("/")) path += "index.html";
  const file = join(DIST, path);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

/* ---- Measurement --------------------------------------------------------------------------- */

/* Record the moment the app actually mounts — "canvas usable" in the owner's terms. Installed
 * before any page script runs, so nothing is missed.
 *
 * ⚠ OBSERVE `document`, NOT `document.documentElement`. An init script runs at document-start,
 * when the document is still EMPTY and documentElement is null — observing it throws, the whole
 * init script dies, and every arm silently reports `mounted: null`. That read as "the app never
 * mounts" when the app was mounting fine; the instrument was the broken thing. `document` always
 * exists, and a subtree observer on it sees <html> itself being inserted. */
const MARK_MOUNT = () => {
  window.__mountMs = null;
  /* Capture first-contentful-paint the moment it fires rather than sampling
   * getEntriesByName() at some later instant. Sampling raced the fast arm: once the mount probe
   * started working, the shipped arm was evaluated ~86 ms in — before the paint entry existed —
   * and reported `null`, which would have read as "no paint" on the arm that paints SOONEST.
   * `buffered: true` also replays an entry that landed before this observer attached. */
  window.__fcpMs = null;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name === "first-contentful-paint" && window.__fcpMs == null) window.__fcpMs = e.startTime;
      }
    }).observe({ type: "paint", buffered: true });
  } catch { /* older engines: the getEntriesByName fallback below still applies */ }
  const check = () => {
    if (window.__mountMs != null) return true;
    const r = document.getElementById("root");
    if (r && r.childElementCount > 0) { window.__mountMs = performance.now(); return true; }
    return false;
  };
  try { new MutationObserver(check).observe(document, { childList: true, subtree: true }); } catch { /* fall through to the poll */ }
  /* Belt-and-braces: React can mount without a mutation the observer is scoped to see, and a
   * missed mount would silently read as "never mounted" again. */
  const id = setInterval(() => { if (check()) clearInterval(id); }, 16);
  check();
};

async function measure(browser, { arm, url }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(MARK_MOUNT);

  const fontHostRequests = [];
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-font-blocking");

  /* The one variable under test: the font host answers slowly. Everything else cross-origin is
   * aborted immediately so a blocked tile/auth host cannot contaminate either arm's timings. */
  await page.route(/^https?:\/\//, async (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    if (/fonts\.googleapis\.com/.test(u)) {
      fontHostRequests.push(u);
      await new Promise((r) => setTimeout(r, DELAY));
      return route.fulfill({ status: 200, contentType: "text/css", body: FONT_CSS });
    }
    return route.abort();
  });

  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  /* Wait for BOTH signals; the control arm is expected to be slow, not hung. Waiting on mount
   * alone raced the paint entry on the fast arm — see the note in MARK_MOUNT. */
  await page.waitForFunction(() => window.__mountMs != null && window.__fcpMs != null, null, { timeout: 60_000 }).catch(() => {});

  const m = await page.evaluate(() => {
    const fcp = window.__fcpMs != null ? { startTime: window.__fcpMs } : performance.getEntriesByName("first-contentful-paint")[0];
    const nav = performance.getEntriesByType("navigation")[0];
    const blocking = [...document.querySelectorAll('link[rel="stylesheet"], script[src]:not([defer]):not([async])')]
      .map((el) => el.href || el.src)
      .filter((u) => { try { return new URL(u, location.href).origin !== location.origin; } catch { return false; } });
    return {
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      domInteractiveMs: nav ? Math.round(nav.domInteractive) : null,
      mountMs: window.__mountMs == null ? null : Math.round(window.__mountMs),
      crossOriginBlocking: blocking,
    };
  });

  await ctx.close();
  return { arm, ...m, fontHostRequests: fontHostRequests.length };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const control = await measure(browser, { arm: "A · CONTROL (pre-fix)", url: `${BASE}/__control/` });
const shipped = await measure(browser, { arm: "B · SHIPPED", url: `${BASE}/` });
await browser.close();
server.close();

/* ---- Verdict -------------------------------------------------------------------------------- */
const failures = [];
const checks = [];
const check = (label, cond, detail) => {
  checks.push({ label, pass: !!cond, detail });
  if (!cond) failures.push(label);
};

/* RED FIRST. The control must actually stall, or this harness proves nothing. The bar is a
 * conservative fraction of the injected delay rather than the delay itself: what is being
 * asserted is "the third-party latency passes through", not an exact millisecond count. */
const STALL_BAR = DELAY * 0.5;
if (MEASURE_ONLY) {
  console.log(`\n  (--delay ${DELAY} is below the ${MIN_DELAY} ms floor — REPORTED, NOT JUDGED. The stall`);
  console.log(`   assertions are a fraction of the delay and degenerate at this scale; re-run without`);
  console.log(`   --delay, or with --delay ${MIN_DELAY} or more, to get a verdict.)`);
  process.exit(0);
}
check(
  "control arm STALLS with the font host delayed (the instrument can see the defect)",
  control.fcpMs != null && control.fcpMs >= STALL_BAR,
  `FCP ${control.fcpMs} ms ≥ ${STALL_BAR} ms of an injected ${DELAY} ms delay`,
);
check(
  "control arm actually requested the third-party font host",
  control.fontHostRequests > 0,
  `${control.fontHostRequests} request(s)`,
);

/* GREEN AFTER. Same delay, same build — the shipped entry must not notice. */
check(
  "shipped arm makes ZERO requests to fonts.googleapis.com",
  shipped.fontHostRequests === 0,
  `${shipped.fontHostRequests} request(s)`,
);
check(
  "shipped arm has NO cross-origin render-blocking resource",
  shipped.crossOriginBlocking.length === 0,
  shipped.crossOriginBlocking.join(", ") || "none",
);
check(
  "shipped arm's first paint is unaffected by the font host's latency",
  shipped.fcpMs != null && shipped.fcpMs < STALL_BAR,
  `FCP ${shipped.fcpMs} ms < ${STALL_BAR} ms`,
);
check(
  "shipped arm mounts the app without waiting on the font host",
  shipped.mountMs != null && shipped.mountMs < STALL_BAR,
  `mounted at ${shipped.mountMs} ms`,
);

const delta = control.fcpMs != null && shipped.fcpMs != null ? control.fcpMs - shipped.fcpMs : null;

if (JSON_OUT) {
  console.log(JSON.stringify({ delayMs: DELAY, control, shipped, fcpDeltaMs: delta, checks, failures }, null, 2));
} else {
  console.log(`Planyr boot render-blocking A/B (B276576)`);
  console.log(`  one build, one server, two documents · font host delayed ${DELAY} ms\n`);
  for (const a of [control, shipped]) {
    console.log(`  ${a.arm}`);
    console.log(`      first paint      ${a.fcpMs} ms`);
    console.log(`      dom interactive  ${a.domInteractiveMs} ms`);
    console.log(`      app mounted      ${a.mountMs} ms`);
    console.log(`      font-host reqs   ${a.fontHostRequests}`);
    console.log(`      cross-origin render-blocking: ${a.crossOriginBlocking.join(", ") || "none"}`);
  }
  if (delta != null) console.log(`\n  the delay the owner no longer pays: ${delta} ms of first paint\n`);
  for (const c of checks) console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ boot is free of cross-origin render-blocking resources, and the control proves the check can fail.");
