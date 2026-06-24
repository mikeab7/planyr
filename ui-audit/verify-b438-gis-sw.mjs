// B438 — verify the GIS imagery service worker: it registers, activates, controls the page,
// caches a cross-origin ArcGIS tile (the headline: instant replay + outage survival), and
// leaves the app's own assets untouched (the safety rule). Runs on the localhost preview
// (a secure context, so service workers are allowed).
//
// The sandbox can't reach the real gov GIS hosts, so the tile response is MOCKED at the network
// layer (route.fulfill) — that exercises the SW's real cache-write path deterministically,
// without an external dependency. The request-matching rules are also unit-tested
// (test/gisSwRules.test.js).
import { chromium } from "playwright";

const EXEC = "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const BASE = "http://localhost:4173";
const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/3";
// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };

async function run() {
  const br = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await br.newContext();
  // Mock the cross-origin tile so the SW has a real response to cache (host unreachable in-sandbox).
  await ctx.route("**/MapServer/tile/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  ).catch(() => {});
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });

  const controlled = await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller != null,
    { timeout: 20000 },
  ).then(() => true).catch(() => false);
  controlled ? ok("service worker controls the page") : bad("SW never took control");

  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? { active: !!r.active, script: r.active && r.active.scriptURL } : null;
  });
  if (reg && reg.active && /gis-sw\.js$/.test(reg.script || "")) ok("gis-sw.js is the active registration");
  else bad(`unexpected registration: ${JSON.stringify(reg)}`);

  const cached = await page.evaluate(async (tile) => {
    const url = tile + "?cb=" + Date.now();
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = url;
      setTimeout(resolve, 5000);
    });
    await new Promise((r) => setTimeout(r, 800));
    const c = await caches.open("planyr-gis-v1");
    const keys = (await c.keys()).map((rq) => rq.url);
    return {
      has: keys.some((u) => u.indexOf("/MapServer/tile/3/2/3") !== -1),
      count: keys.length,
      appAsset: keys.find((u) => u.indexOf("/assets/") !== -1 || u.indexOf("localhost:4173") !== -1) || null,
    };
  }, TILE);

  cached.has ? ok(`tile cached in planyr-gis-v1 (entries: ${cached.count})`) : bad("tile was NOT cached by the SW");
  cached.appAsset
    ? bad(`SAFETY VIOLATION: an app/same-origin asset leaked into the GIS cache: ${cached.appAsset}`)
    : ok("no app/same-origin assets in the GIS cache (host-scoping holds)");

  const hasShell = await page.locator('[data-testid="module-tab-site-planner"]').count();
  hasShell ? ok("app shell still renders with the SW active") : bad("app shell missing");

  await br.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
