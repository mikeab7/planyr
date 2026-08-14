#!/usr/bin/env node
/* diagnose-edit-listener-leak — NAME THE LEAK, don't characterise it (B519906)
 *
 *   node ui-audit/diagnose-edit-listener-leak.mjs [--edits N] [--rounds N] [--fixture NAME]
 *
 * ⛔ WHY A SEPARATE INSTRUMENT FROM `diagnose-richfield-memory`. That one MEASURED the curve:
 * with real edits in the loop, Richfield leaks ≈1 event listener and ≈0.2 MB of retained heap PER
 * EDIT, linearly, with no plateau over 12 rounds — while the identical cycle WITHOUT edits is flat
 * for 25 rounds. That is a signature, and a signature is not a diagnosis. A heap-snapshot class
 * histogram cannot close the gap either: it says `Object +226,488 nodes` and `Path2D +4,081`, which
 * names a shape, not a line of code.
 *
 * ⛔ SO THIS INSTRUMENTS THE SUBSCRIPTION ITSELF. `EventTarget.prototype.addEventListener` and
 * `removeEventListener` are wrapped before any app code runs, each call stamped with its capture
 * stack, and every listener kept in a live registry keyed by (target-kind, type, stack). What the
 * run prints is the NET-LIVE count per call site, sorted by growth — i.e. exactly "who subscribed
 * and never unsubscribed", attributed to a stack frame, which is the thing that determines the fix.
 *
 * ⛔ AND IT MAPS THE FRAME BACK TO REAL SOURCE. A production build's stack says
 * `SitePlannerApp-H8Hjme35.js:1:284119`, which names nothing. The build is made with sourcemaps for
 * this run and `lib/sourceMapIndex.mjs` resolves each frame to its original file and line, so the
 * output is a path in `src/`, not a minified offset. A diagnosis that cannot be pointed at is not
 * a diagnosis.
 *
 * ⛔ ONE THING IT DELIBERATELY DOES NOT DO: guess. If the net-live growth does not concentrate in a
 * small number of call sites, the run says INCONCLUSIVE in those words rather than promoting the
 * largest row to a culprit. This programme has killed five plausible stories already (B1121).
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture, cachedRaster } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed, rasterIdbPlan, idbPutInPage } from "./lib/planFixture.mjs";
import { pngDataUrl } from "./lib/synthRaster.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { makeSourceLookup } from "./lib/sourceMapIndex.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const DIST = join(HERE, "..", "dist", "assets");
const SITE_ID = "smsdrvzr9gzx";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("rounds", 6));
const EDITS = Number(arg("edits", 8));
const FIXTURE = arg("fixture", "richfield");

/* ---- the subscription probe, installed before any app code ------------------------------------ */
function installListenerProbe() {
  window.__PLANYR_E2E = true;
  const proto = EventTarget.prototype;
  const rawAdd = proto.addEventListener;
  const rawRemove = proto.removeEventListener;
  /* One record per LIVE subscription. Keyed by the (target, type, listener, capture) tuple the DOM
   * itself uses to identify a registration, so a remove is matched the way the platform matches it
   * and a double-add of the same tuple is counted once — exactly as the platform counts it. */
  const live = new Map();          // key -> { site, type, kind }
  const bySite = new Map();        // site -> { added, removed, live }
  let seq = 0;
  const keyOf = (t, type, fn, cap) => {
    if (!fn.__lk) { Object.defineProperty(fn, "__lk", { value: `f${++seq}`, enumerable: false }); }
    if (!t.__tk) { try { Object.defineProperty(t, "__tk", { value: `t${++seq}`, enumerable: false }); } catch (_) { return null; } }
    return `${t.__tk}|${type}|${fn.__lk}|${cap ? 1 : 0}`;
  };
  const kindOf = (t) => {
    try {
      if (t === window) return "window";
      if (t === document) return "document";
      if (t && t.nodeType === 1) return `el:${t.tagName.toLowerCase()}`;
      return (t && t.constructor && t.constructor.name) || "other";
    } catch (_) { return "other"; }
  };
  /* The capture stack, trimmed of the probe's own frames. The FIRST app frame is what identifies
   * the call site; the next few are kept so a shared helper is distinguishable from its callers. */
  const siteOf = () => {
    const s = (new Error().stack || "").split("\n").slice(1);
    const frames = s.filter((l) => !l.includes("installListenerProbe") && /https?:\/\//.test(l))
      .map((l) => { const m = /(https?:\/\/[^\s)]+):(\d+):(\d+)/.exec(l); return m ? `${m[1].split("/").pop()}:${m[2]}:${m[3]}` : null; })
      .filter(Boolean);
    return frames.slice(0, 3).join(" < ") || "unknown";
  };
  const bump = (site, field) => {
    let r = bySite.get(site);
    if (!r) { r = { added: 0, removed: 0, live: 0 }; bySite.set(site, r); }
    r[field]++;
    return r;
  };
  proto.addEventListener = function (type, fn, opts) {
    const out = rawAdd.call(this, type, fn, opts);
    try {
      if (typeof fn === "function") {
        const cap = !!(opts === true || (opts && opts.capture));
        const k = keyOf(this, type, fn, cap);
        if (k && !live.has(k)) {
          const site = siteOf();
          live.set(k, { site, type, kind: kindOf(this) });
          bump(site, "added").live++;
        }
      }
    } catch (_) {}
    return out;
  };
  proto.removeEventListener = function (type, fn, opts) {
    const out = rawRemove.call(this, type, fn, opts);
    try {
      if (typeof fn === "function") {
        const cap = !!(opts === true || (opts && opts.capture));
        const k = keyOf(this, type, fn, cap);
        const rec = k && live.get(k);
        if (rec) { live.delete(k); const r = bump(rec.site, "removed"); r.live--; }
      }
    } catch (_) {}
    return out;
  };
  window.__lp = {
    snapshot: () => [...bySite.entries()].map(([site, r]) => ({ site, ...r })).filter((r) => r.live !== 0 || r.added),
    liveTotal: () => live.size,
    byKind: () => {
      const m = {};
      for (const v of live.values()) m[`${v.kind}/${v.type}`] = (m[`${v.kind}/${v.type}`] || 0) + 1;
      return m;
    },
  };
}

/* ---- source-map resolution --------------------------------------------------------------------- */
function buildLookups() {
  const out = new Map();
  if (!existsSync(DIST)) return out;
  for (const f of readdirSync(DIST)) {
    if (!f.endsWith(".js.map")) continue;
    try { out.set(f.replace(/\.map$/, ""), makeSourceLookup(JSON.parse(readFileSync(join(DIST, f), "utf8")))); } catch (_) {}
  }
  return out;
}
function resolveSite(site, lookups) {
  return site.split(" < ").map((frame) => {
    const m = /^(.+?):(\d+):(\d+)$/.exec(frame);
    if (!m) return frame;
    const lk = lookups.get(m[1]);
    if (!lk) return frame;
    try {
      const hit = lk(Number(m[2]), Number(m[3]));
      return hit && hit.source ? `${hit.source.replace(/^.*\/src\//, "src/")}:${hit.line}` : frame;
    } catch (_) { return frame; }
  }).join(" < ");
}

async function run() {
  const fixture = readFixture(FIXTURE);
  const browser = await chromium.launch({ headless: false, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
  await ctx.addInitScript(installListenerProbe);
  await ctx.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    const t = parseTileUrl(u);
    if (t) return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: fakeTilePng(t.z, t.x, t.y) });
    return route.abort();
  });

  const page = await ctx.newPage();
  await assertMeasurable(page, "diagnose-edit-listener-leak");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
    const r = cachedRaster(spec, join(HERE, ".raster-cache"));
    await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
  }
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("svg[data-view-ppf]", { timeout: 30000 });
  await page.evaluate(() => window.__plannerView?.centerOn(0, 0, 0.12));
  await pacedWait(page, 1500);

  const editOnce = async () => {
    const spot = await page.evaluate(() => {
      const ns = [...document.querySelectorAll("[data-el-id]")];
      if (!ns.length) return null;
      const n = ns[Math.floor(ns.length / 2)];
      const r = n.getBoundingClientRect();
      return r.width > 4 && r.height > 4 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (!spot) return false;
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(spot.x + k * 5, spot.y + k * 3);
    await page.mouse.up();
    await pacedWait(page, 80);
    await page.keyboard.press("Control+z");
    await pacedWait(page, 80);
    return true;
  };

  const before = await page.evaluate(() => ({ rows: window.__lp.snapshot(), total: window.__lp.liveTotal(), kinds: window.__lp.byKind() }));
  let edits = 0;
  for (let r = 0; r < ROUNDS; r++) for (let e = 0; e < EDITS; e++) if (await editOnce()) edits++;
  const after = await page.evaluate(() => ({ rows: window.__lp.snapshot(), total: window.__lp.liveTotal(), kinds: window.__lp.byKind() }));

  const lookups = buildLookups();
  const b = new Map(before.rows.map((r) => [r.site, r]));
  const growth = after.rows
    .map((r) => ({ site: r.site, live: r.live, delta: r.live - (b.get(r.site)?.live || 0), added: r.added - (b.get(r.site)?.added || 0), removed: r.removed - (b.get(r.site)?.removed || 0) }))
    .filter((r) => r.delta > 0)
    .sort((x, y) => y.delta - x.delta);

  const kindDelta = {};
  for (const k of new Set([...Object.keys(before.kinds), ...Object.keys(after.kinds)])) {
    const d = (after.kinds[k] || 0) - (before.kinds[k] || 0);
    if (d) kindDelta[k] = d;
  }

  const netTotal = after.total - before.total;
  const topShare = growth.length ? growth[0].delta / Math.max(1, netTotal) : 0;
  /* ⛔ THE REFUSAL PATH. Concentration is what makes this a diagnosis; without it the run says so
   * rather than promoting row 1 to a culprit. */
  const verdict = netTotal <= 0 ? "NO-GROWTH"
    : growth.length && (topShare >= 0.5 || growth.slice(0, 3).reduce((a, r) => a + r.delta, 0) / netTotal >= 0.8) ? "CONCENTRATED"
    : "INCONCLUSIVE — net-live listener growth does not concentrate in a small number of call sites";

  console.log(JSON.stringify({
    fixture: FIXTURE, rounds: ROUNDS, editsPerRound: EDITS, editsPerformed: edits,
    liveListeners: { before: before.total, after: after.total, net: netTotal },
    perEdit: edits ? +(netTotal / edits).toFixed(2) : null,
    verdict,
    byKindDelta: kindDelta,
    topSites: growth.slice(0, 12).map((r) => ({ ...r, source: resolveSite(r.site, lookups) })),
  }, null, 2));
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
