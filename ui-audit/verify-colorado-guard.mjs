/* NEW-8 — does the Colorado guard actually REACH a deployed build?
 *
 * "Merged ≠ live." The unit suite proves the guard's LOGIC; the build proves it compiles. Neither
 * proves the copy and the branches survived bundling and actually shipped — a tree-shake, a dead
 * dynamic import or a chunk that never loads would leave the panel silently back to its old
 * behaviour, which for this feature means a Colorado site rendering nothing at all.
 *
 * So this drives a REAL browser against a REAL built origin, logged out, and asserts:
 *   1. the app boots with zero runtime errors;
 *   2. THE SPLIT IS REAL IN BOTH DIRECTIONS — the guard's own short copy is in what the page
 *      eagerly loads (so a Colorado site's verdict renders instantly), and the Colorado PROSE is
 *      NOT (so a Texas user downloads none of it), while still being present in the on-demand
 *      chunk a Colorado site fetches;
 *   3. the guard's branch and flag survived bundling intact.
 *
 * Point 2 is the one that matters, and it is what the first run of this harness established: it
 * locks in the bundle-budget optimization so a future refactor cannot silently make the Colorado
 * tier static again.
 *
 *   node ui-audit/verify-colorado-guard.mjs                       # builds + serves locally
 *   BASE_URL=https://…pages.dev node ui-audit/verify-colorado-guard.mjs
 *
 * Sandbox note: outbound HTTPS is TLS-inspected, so Chromium needs --ignore-certificate-errors +
 * ignoreHTTPSErrors — the same flags every ui-audit harness here uses.
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const local = !process.env.BASE_URL;

const pass = [], fail = [];
const check = (ok, label, detail = "") => (ok ? pass : fail).push(label + (ok || !detail ? "" : ` — ${detail}`));

let server = null;
async function serve() {
  if (!local) return;
  server = spawn("npx", ["vite", "preview", "--port", "4173", "--host"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE_URL); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("preview server never came up");
}

const run = async () => {
  await serve();
  const browser = await chromium.launch({ args: ["--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Collect every script body the app actually loads, so the copy assertions run against SHIPPED
  // bytes rather than the source tree.
  const scripts = [];
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!/\.js(\?|$)/.test(url) || !res.ok()) return;
      scripts.push(await res.text());
    } catch { /* body already consumed / redirect */ }
  });

  // NOT networkidle: the app keeps retrying external GIS/tile hosts that this environment blocks,
  // so the network never goes idle and the wait would time out on a perfectly healthy page.
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".leaflet-container", { timeout: 60000 });

  // The planner chunk is lazy — open a blank plan so its bundle actually loads.
  const startBlank = page.getByRole("button", { name: /start blank/i });
  if (await startBlank.count()) {
    await startBlank.first().click();
    await page.waitForTimeout(4000);
  }

  const js = scripts.join("\n");
  check(js.length > 100000, "the app's JS bundles were captured", `${js.length} bytes`);

  /* 2 — THE SPLIT IS REAL, in both directions. This is the assertion that matters, and the first
   * run of this harness is what proved it: the Colorado prose must be ABSENT from what a page
   * eagerly loads (that is the whole bundle-budget optimization — a Texas user downloads none of
   * it) and PRESENT in the on-demand chunk (or the guard would render a bare line with no ⓘ). A
   * future refactor that quietly makes the Colorado tier static would go red here. */
  const guardCopy = [
    ["the Colorado unavailable state", /not yet available in Colorado/i],
    ["the named verdict chip", /N\/A · CO/],
    ["the guard's own short line", /does not yet carry Colorado detention criteria/],
  ];
  for (const [label, re] of guardCopy) check(re.test(js), `eager bundle carries ${label} (it must render instantly)`);

  const lazyOnly = [
    ["the WQCV explanation", /WQCV/],
    ["the EURV explanation", /EURV/],
    ["Full Spectrum Detention", /Full Spectrum Detention/],
    ["the Mile High Flood District label", /Mile High Flood District/],
    ["the non-MHFD warning", /NOT in the Mile High Flood District/],
    ["the drawdown statute citation", /37-92-602/],
    ["the State Engineer notification", /State Engineer/],
    ["the CWCB floodplain floor", /2 CCR 408-1/],
    ["the never-says-pass caveat", /not ruled out/i],
  ];
  for (const [label, re] of lazyOnly) check(!re.test(js), `eager bundle does NOT carry ${label} — Texas pays nothing for it`);

  // …and the same strings ARE in the on-demand chunk, which a Colorado site fetches. Read the
  // built assets directly: the page never requests them on a Texas path, which is the point.
  const assets = local ? readdirSync("dist/assets").filter((f) => f.endsWith(".js")) : [];
  const lazyJs = assets.map((f) => readFileSync(`dist/assets/${f}`, "utf8")).join("\n");
  if (local) {
    check(lazyJs.length > js.length, "the built asset graph is larger than what a Texas page loads");
    for (const [label, re] of lazyOnly) check(re.test(lazyJs), `the on-demand Colorado chunk carries ${label}`);
  }

  /* 3 — the guard's branch survived bundling intact. The rendered verdict is behind a saved plan,
   * so the behavioural proof lives in test/coloradoGuard.test.js (26 cases, including the
   * adversarial forced-Texas-authority one); this is the shipped-bytes half a unit test cannot give. */
  const coIdx = js.indexOf("not yet available in Colorado");
  check(coIdx > -1, "the guard branch is reachable in the eager bundle");
  if (coIdx > -1) {
    const around = js.slice(Math.max(0, coIdx - 4000), coIdx + 4000);
    check(/colorado-not-wired/.test(around), "the guard's flag ships next to its copy");
    check(/unavailable/.test(around), 'the guard returns kind:"unavailable"');
  }

  check(errors.length === 0, "no runtime errors on boot", errors.join(" | "));

  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }

  console.log(`\nColorado guard — shipped-bundle verification against ${BASE_URL}\n`);
  for (const p of pass) console.log("  ✓ " + p);
  for (const f of fail) console.log("  ✗ " + f);
  console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
  process.exit(fail.length ? 1 : 0);
};

run().catch((e) => {
  if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }
  console.error("harness error:", e);
  process.exit(1);
});
