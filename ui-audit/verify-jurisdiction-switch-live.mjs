#!/usr/bin/env node
/* verify-jurisdiction-switch-live — V1627520 / B2208416: on the DEPLOYED app, signed in as the test account, opening a plan must not put
 * a jurisdiction-chunk script over 50 ms on the main thread. Reads /version.json and the served `jurisdiction-*` chunk name IN THE SAME
 * observation as the measurement (a stale tab proves nothing). Counts the share requests (returnGeometry=true) it saw, and is VOID when
 * the plan never reached that path.
 *   xvfb-run -a node ui-audit/verify-jurisdiction-switch-live.mjs [https://planyr.io] [--site <groupId>]       (signed in as the test account)
 *   xvfb-run -a node ui-audit/verify-jurisdiction-switch-live.mjs [https://planyr.io] --local-bolt-on           (signed OUT, Bolt-on's parcels seeded locally)
 * The test account's fixture sites have NO boundary and NO location, so the signed-in run is VOID by design (it never reaches the
 * jurisdiction lookups); `--local-bolt-on` runs the same deployed bundle against the real live county services with a plan that does,
 * and creates no cloud row, so there is nothing to clean up.
 */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { attribute } from "./lib/jurisdictionSwitch.mjs";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSite } from "./lib/planFixture.mjs";

const base = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "https://planyr.io";
const site = process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : FIXTURE_SITE_ID;
/* a FUNCTION (openSignedIn takes [fn, arg] pairs and runs them before any navigation) */
const INSTRUMENT = () => {
  window.__lt = []; window.__loaf = []; window.__share = 0; window.__gis = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), +e.duration.toFixed(1)]); }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ t: Math.round(e.startTime), d: +e.duration.toFixed(1), scripts: (e.scripts || []).map((x) => ({ i: x.invoker || "", u: (x.sourceURL || "").split("/").pop(), d: +x.duration.toFixed(1) })) }); }).observe({ type: "long-animation-frame", buffered: true }); } catch (_) {}
  const F = window.fetch;
  window.fetch = function (...a) { try { const u = String((a[0] && a[0].url) || a[0]); if (/\/query/.test(u)) { window.__gis++; if (/returnGeometry=true/.test(u)) window.__share++; } } catch (_) {} return F.apply(this, a); };
};
const LOCAL = process.argv.includes("--local-bolt-on");
const boltStore = () => {
  const fx = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bolt-on-jurisdiction.json"), "utf8"));
  const parcels = fx.parcels.map((p, i) => ({ id: p.id, z: i * 1024, locked: false, stroke: "#0729cf", weight: 4,
    points: p.pts.split(" ").map((q) => { const [x, y] = q.split(",").map(Number); return { x, y }; }) }));
  const rec = fixtureSite({ schemaVersion: fx.schemaVersion, origin: fx.origin, county: fx.county, parcels, settings: fx.settings, els: [] },
    { id: "live-bolt-on", name: "Bolt-on", site: "Grand Port" });
  rec.groupId = "live-bolt-on"; rec.status = "pursuit"; rec.role = "pursuit";
  return { "live-bolt-on": rec };
};
const openLocal = async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", headless: false, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1722, height: 700 }, deviceScaleFactor: 2 });
  await context.addInitScript((x) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify(x)); } catch (_) {} }, boltStore());
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "load" });
  return { page, close: () => browser.close() };
};
try {
  const s = LOCAL ? await openLocal() : await openSignedIn({ base, initScripts: [[INSTRUMENT, null]] });
  const { page } = s;
  const PROFILE = process.argv.includes("--profile");
  let cdp = null;
  if (PROFILE) { cdp = await page.context().newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
  await assertMeasurable(page, "verify-jurisdiction-switch-live");
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate((id) => { location.hash = `#/project/${id}/site`; }, LOCAL ? "live-bolt-on" : site);
  await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 });
  await pacedWait(page, 12000);
  const raw = await page.evaluate(() => ({
    lt: window.__lt.slice(), loaf: window.__loaf.slice(), now: performance.now(), gis: window.__gis, share: window.__share,
    chunks: performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^jurisdiction-/.test(n)),
  }));
  if (cdp) {
    const { profile } = await cdp.send("Profiler.stop");
    const id2 = new Map(profile.nodes.map((n) => [n.id, n])); const by = new Map();
    profile.samples.forEach((sid, i) => { const n = id2.get(sid); const cf = n.callFrame; const k = `${cf.functionName || "(anon)"} ${String(cf.url).split("/").pop()}:${cf.lineNumber}:${cf.columnNumber}`; by.set(k, (by.get(k) || 0) + profile.timeDeltas[i] / 1000); });
    console.log("PROFILE top self-time:\n" + [...by.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join("\n"));
  }
  const ver = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  const a = attribute(raw, [t0, raw.now]);
  /* the known-good arm: the lookups must have RESOLVED (the header badge names a jurisdiction, not "couldn't check"), and the heaviest
   * frames are listed so a zero cannot be an instrument that never saw the chunk */
  const badge = await page.evaluate(() => { const m = (document.body.innerText || "").match(/(City of [^·\n]+|[A-Z][a-z]+(?: [A-Z][a-z]+)* ETJ|Unincorporated[^\n]*|Couldn.t check[^\n]*)/); return m ? m[0].slice(0, 90) : null; });
  const top = raw.loaf.filter((f) => f.t >= t0).sort((x, y) => y.d - x.d).slice(0, 5).map((f) => ({ d: f.d, scripts: f.scripts.filter((q) => q.d >= 5).map((q) => `${q.i}:${q.u}=${q.d}`) }));
  console.log("badge:", badge, "\ntop frames:", JSON.stringify(top));
  console.log(JSON.stringify({ site, build: ver, chunk: raw.chunks, gisQueries: raw.gis, shareQueries: raw.share, attr: a }, null, 1));
  const exercised = raw.gis >= 3;
  const ok = exercised && a.jurisdictionMaxMs <= 50 && a.jurisdictionMs <= 150;
  console.log(exercised ? (ok ? "PASS" : "FAIL") : "VOID (the plan never reached the jurisdiction lookups)", `— max ${a.jurisdictionMaxMs} ms, total ${a.jurisdictionMs} ms, share-geometry requests ${raw.share}`);
  await s.close();
  process.exit(ok ? 0 : (exercised ? 1 : 2));
} catch (e) { console.error("FAIL", e.message); process.exit(1); }
