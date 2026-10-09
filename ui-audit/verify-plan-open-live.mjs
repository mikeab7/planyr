#!/usr/bin/env node
/* verify-plan-open-live — NEW-1 / B2224000 on the DEPLOYED app: does opening / switching to a plan stall the main thread?
 *
 * INSTRUMENT. The same MessageChannel ping-gap heartbeat the owner used (it keeps firing in a hidden tab, where `longtask` entries do not), with the same
 * known-good arm: a deliberate 200 ms busy loop must read as ≥150 ms or the run is VOID (ui-audit/lib/planOpenVerdict.mjs scores it). /version.json and the served
 * chunk names are read in the SAME observation as the measurement (a stale tab proves nothing).
 *
 *   xvfb-run -a node ui-audit/verify-plan-open-live.mjs [https://planyr.io]               signed OUT, the owner's Concept A + Bolt-on seeded locally (needs no account)
 *   xvfb-run -a node ui-audit/verify-plan-open-live.mjs [https://planyr.io] --signed-in   signed in as the e2e test account: cold-open its fixture site
 *
 * The seeded arm is what exercises the fixed path on production: the test account's fixture sites carry NO boundary, so a signed-in open of them never reaches the
 * acreage-badge anchor (`polylabel`) at all (stated in the output, never silently scored as a pass). Both arms create nothing in any cloud account.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { fixtureSite } from "./lib/planFixture.mjs";
import { planOpenVerdict } from "./lib/planOpenVerdict.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "https://planyr.io";
const SIGNED_IN = process.argv.includes("--signed-in");
const SETTLE_MS = 6000;   // B2225425 round 3: the same window as the rig (perf-plan-open), so a late task after the switch is inside it
const budget = JSON.parse(readFileSync(join(HERE, "perf-plan-open.budget.json"), "utf8"));

const INSTRUMENT = () => {
  window.__gaps = []; window.__hb = { last: performance.now() };
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { const t = performance.now(), g = t - window.__hb.last; if (g > 30) window.__gaps.push([Math.round(window.__hb.last), Math.round(g)]); window.__hb.last = t; ch.port2.postMessage(0); };
  ch.port2.postMessage(0);
};
const readGaps = (page) => page.evaluate(() => ({ now: performance.now(), gaps: window.__gaps.slice(), feat: new Set([...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size }));
async function window5s(page, t0, label) {
  await pacedWait(page, SETTLE_MS);
  const r = await readGaps(page);
  const g = r.gaps.filter((x) => x[0] >= t0 - 2 && x[0] <= t0 + SETTLE_MS).map((x) => x[1]);
  return { label, feat: r.feat, maxMs: Math.max(0, ...g), over50: g.filter((x) => x > 50).length, sumOver50: g.filter((x) => x > 50).reduce((a, b) => a + b, 0), rowFetches: 1 };
}
async function selfTest(page) {
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate(() => new Promise((r) => setTimeout(() => { const t = performance.now(); while (performance.now() - t < 200); r(); }, 50)));
  await pacedWait(page, 300);
  const r = await readGaps(page);
  return Math.max(0, ...r.gaps.filter((x) => x[0] >= t0 - 5).map((x) => x[1]));
}
const seedStore = () => {
  const mk = (file, id, name, site) => {
    const fx = JSON.parse(readFileSync(join(HERE, "fixtures", "plan-load", file), "utf8"));
    const by = (k) => fx.rows.filter((r) => r.kind === k).map((r) => r.data);
    const h = fx.header;
    const rec = fixtureSite({ schemaVersion: h.schemaVersion, origin: h.origin, county: h.county, settings: h.settings, parcels: by("parcel"), els: by("el"), markups: by("markup"), measures: by("measure"), callouts: by("callout") }, { id, name, site });
    rec.groupId = id; rec.status = "pursuit"; rec.role = "pursuit"; return rec;
  };
  const a = mk("concept-a.json", "live-ca", "Concept A", "Grand Port A");
  const b = mk("bolt-on.json", "live-bo", "Bolt-on", "Grand Port B");
  return { "live-ca": a, "live-bo": b };
};

let s, results = {}, ver = null, chunks = [];
try {
  if (SIGNED_IN) {
    s = await openSignedIn({ base, initScripts: [[INSTRUMENT, null]] });
    const { page } = s; await assertMeasurable(page, "verify-plan-open-live");
    const t0 = await page.evaluate(() => performance.now());
    await page.evaluate((id) => { location.hash = `#/project/${id}/site`; }, FIXTURE_SITE_ID);
    /* the test account's fixture site is not an openable planner route for a hash pasted in by id ("That link points at a project this account doesn't have open
     * here") — say VOID, never crash and never score a page that has no canvas */
    const mounted = await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 30000 }).then(() => true, () => false);
    if (!mounted) { console.log("VOID  signed-in: the test account's fixture site never mounted a planner canvas (by design: no boundary, no location) — nothing was measured. Use the seeded arm; the real-data arm is the owner's own capture."); await s.close(); process.exit(2); }
    const a = await window5s(page, t0, "signed-in cold open (test-account fixture site)"); a.selfTestMs = await selfTest(page);
    results = { "signed-in": [[a]] };
    console.log("NOTE: the test account's fixture sites carry no boundary — this arm proves the signed-in open is not stalling, NOT that the badge-anchor path ran (use the seeded arm for that).");
  } else {
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", headless: false, args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ viewport: { width: 1722, height: 700 }, deviceScaleFactor: 2.15 });
    await ctx.addInitScript((x) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify(x)); window.__PLANYR_LEGACY_MIRROR = "idle"; } catch (_) {} }, seedStore());
    await ctx.addInitScript(INSTRUMENT);
    const page = await ctx.newPage(); await assertMeasurable(page, "verify-plan-open-live");
    await page.goto(`${base}/#/project/live-bo/site`, { waitUntil: "load" });
    /* LOUD-FAILURE: a canvas that never mounts is a finding about the build, not "the harness timed out" — say what the page held */
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }).catch(async (e) => {
      const d = await page.evaluate(() => { const c = document.querySelector('[data-testid="planner-canvas"]'); return { canvas: !!c, inline: c && c.style.visibility, reveal: c && c.getAttribute("data-planner-reveal"), hash: location.hash, text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300), ver: null }; }).catch(() => ({}));
      console.log("CANVAS NEVER BECAME VISIBLE:", JSON.stringify(d)); throw e;
    });
    await pacedWait(page, 6000);
    const chip = (t) => page.locator("span:visible", { hasText: new RegExp(`^${t}$`) }).first();
    const pick = (t) => page.locator("*:visible", { hasText: new RegExp(`^${t}$`) }).last();
    const out = [];
    /* the window opens in the page task that dispatches the click, after the menu has settled — the driver's own locator work (it walks every element of the page) is outside it */
    /* B2225425 round 3 — "one live run didn't open the plan at all" (round 2's report) is now a NAMED outcome, never a silent timeout or a score:
     * after the window, the URL must name the target plan and the canvas must hold its features; otherwise the action is recorded as an error
     * that says what was clicked (VOID in the verdict). Not reproduced in 3 runs on 0841ea0 + 3 on this change; this is what makes the next one
     * diagnosable from the output alone. */
    const hop = async (from, to, toId, label) => {
      await chip(from).click(); await pacedWait(page, 700);
      const h = await pick(to).elementHandle();
      const clicked = await h.evaluate((el) => `${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 40)}"`);
      const t0 = await h.evaluate((el) => { const t = performance.now(); el.click(); return t; });
      const landed = await chip(to).waitFor({ timeout: 60000 }).then(() => true, () => false);
      const w = await window5s(page, t0, label);
      const where = await page.evaluate(() => location.hash);
      if (!landed || !where.includes(toId) || !(w.feat > 0)) w.error = `plan did not open: clicked ${clicked}; route ${where}; ${w.feat} features drawn${landed ? "" : "; the target chip never appeared"}`;
      out.push(w);
    };
    await hop("Grand Port B", "Grand Port A", "live-ca", "Bolt-on → Concept A (first visit)");
    await hop("Grand Port A", "Grand Port B", "live-bo", "Concept A → Bolt-on (back)");
    await hop("Grand Port B", "Grand Port A", "live-ca", "Bolt-on → Concept A (revisit)");
    out[0].selfTestMs = await selfTest(page);
    results = { "seeded-local": [out] };
    s = { page, close: () => browser.close() };
  }
  const page = s.page;
  ver = await page.evaluate(async () => { try { return (await (await fetch("/version.json", { cache: "no-store" })).json()).build; } catch (_) { return "(no /version.json — a local build)"; } });
  chunks = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^(index|SitePlannerApp|siteAnchor)-/.test(n)));
  const v = planOpenVerdict(results, budget);
  console.log(JSON.stringify({ base, build: ver, chunks }, null, 1));
  console.log(v.lines.join("\n"));
  console.log(v.void ? "VOID" : v.pass ? "PASS" : "FAIL");
  await s.close();
  process.exit(v.void ? 2 : v.pass ? 0 : 1);
} catch (e) { console.error("FAIL", e.message); try { await s?.close(); } catch (_) {} process.exit(1); }
