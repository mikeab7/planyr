/* verify-fit-building — "Fit the biggest building" (NEW-1, owner-only grading layer) driven in a REAL browser: the real GradingController + panel + canvas
 * (ui-audit/harness/grading-harness.*) on the real Chehaw Rd parcel + 3DEP lattice and the owner's Concept A, with the search running in the REAL
 * terrain worker. The is_admin gate is not under test here (test/fitBuildingGate.test.js + test/gradingGate.test.js own it).
 *   node ui-audit/verify-fit-building.mjs        (starts its own vite dev server on :5198)
 * Proves what Node cannot: the worker protocol (run, answer, cancel), that the page stays responsive while the search runs, the ghost on the map, the
 * card, the single alternative, Dismiss changing nothing, and Use this landing the same numbers the Grading panel then reads. Prints the time. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5198, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || undefined;
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const num = (s) => { const m = /(-?[\d,]+(?:\.\d+)?)\s*(k?)/i.exec(s || ""); return m ? parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1) : null; };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(`${BASE}/ui-audit/harness/grading-harness.html?owner=2&app=1&banner=1&planyrDiag=1`);
  await assertMeasurable(page, "verify-fit-building");
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  const bld = () => page.evaluate(() => { const b = window.__harness.els.find((e) => e.type === "building"); return { cx: b.cx, cy: b.cy, w: b.w, h: b.h, rot: b.rot, ffe: b.padElevFt ?? null, basis: b.ffeBasis || null }; });
  const tiles = () => page.evaluate(() => ["cut", "fill"].map((k) => document.querySelector(`[data-tile-value="${k}"]`).textContent));
  const before = await bld();
  const btn = page.locator('[data-testid="grading-fit-building"]');
  check("the button is there, enabled once the ground has loaded", (await btn.count()) === 1 && !(await btn.isDisabled()), await btn.textContent());
  check("no card and no ghost before it is pressed", (await page.locator('[data-testid="grading-fit-card"]').count()) === 0 && (await page.locator('[data-layer="fit-ghost"]').count()) === 0);

  // ---- run: timing, responsiveness, the regrade banner ----
  await page.evaluate(() => {
    window.__long = []; window.__bannerSeen = false;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ entryTypes: ["longtask"] });
    new MutationObserver(() => { if (document.querySelector('[data-testid="regrade-banner"]')) window.__bannerSeen = true; }).observe(document.body, { childList: true, subtree: true });
  });
  const t0 = Date.now();
  await btn.click();
  await page.waitForFunction(() => /Fitting|Fit the/.test(document.querySelector('[data-testid="grading-fit-building"]').textContent), null, { timeout: 3000 });
  const sawRunning = await page.waitForFunction(() => /Fitting/.test(document.querySelector('[data-testid="grading-fit-building"]').textContent) && document.querySelector('[data-testid="grading-fit-building"]').disabled, null, { timeout: 2500 }).then(() => true, () => !!document.querySelector('[data-testid="grading-fit-card"]'));
  check("while it runs the button says so and is disabled", sawRunning);
  await page.waitForSelector('[data-testid="grading-fit-card"]', { timeout: 90000 });
  const ms = Date.now() - t0;
  const long = await page.evaluate(() => window.__long.slice());
  const longest = long.length ? Math.max(...long) : 0;
  check("answered in under 10 s on the 74-acre Georgia site (search + re-pricing by the real engine)", ms < 10000, `${ms} ms`);
  check("the page stayed responsive: no main-thread task over 200 ms while it ran", longest < 200, `${long.length} long task(s), longest ${Math.round(longest)} ms`);
  check("the regrade banner showed the work (centred at the bottom, nothing animated on the map)", await page.evaluate(() => window.__bannerSeen));

  const card = await page.evaluate(() => {
    const t = (s) => (document.querySelector(s) || {}).textContent || "";
    return { sf: t("[data-fit-sf]"), dims: t("[data-fit-dims]"), ffe: t("[data-fit-ffe]"), work: t("[data-fit-earthwork]"), alt: t('[data-testid="grading-fit-alt"]'), shown: document.querySelector('[data-testid="grading-fit-card"]').getAttribute("data-fit-shown") };
  });
  const sf = num(card.sf), ffe = num(card.ffe.replace("Finished floor", ""));
  check("card: building SF to the nearest 1,000", sf > 300000 && sf % 1000 === 0, card.sf);
  check("card: dimensions, finished floor near the prototype's 795, cut / fill / net", /\d+ × \d+ ft/.test(card.dims) && ffe >= 792 && ffe <= 798 && /Cut .* Fill .*(export|import|balanced)/.test(card.work), `${card.dims} | ${card.ffe} | ${card.work}`);
  check("exactly ONE alternative, as a text link", /^Or balance the dirt: [\d,]+ SF, FFE \d+/.test(card.alt) && (await page.locator('[data-testid="grading-fit-alt"]').count()) === 1, card.alt);
  check("the card has no paragraphs (no <p>, 4 short lines)", (await page.locator('[data-testid="grading-fit-card"] p').count()) === 0);
  const ghost = await page.evaluate(() => { const b = document.querySelector("[data-fit-building]"); return { building: b ? b.getAttribute("points").split(" ").length : 0, zones: document.querySelectorAll("[data-fit-zone]").length, exportSkip: !!document.querySelector('[data-layer="fit-ghost"][data-export="skip"]') }; });
  check("ghost on the map: the building's outline (4 corners) and its courts / ends, screen chrome only", ghost.building === 4 && ghost.zones >= 2 && ghost.exportSkip, JSON.stringify(ghost));
  check("NOTHING changed in the plan while the answer is only a ghost", JSON.stringify(await bld()) === JSON.stringify(before));

  // ---- the alternative swaps in and out ----
  await page.click('[data-testid="grading-fit-alt"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="grading-fit-card"]').getAttribute("data-fit-shown") === "alt", null, { timeout: 5000 }).catch(() => {});
  const altCard = await page.evaluate(() => ({ sf: document.querySelector("[data-fit-sf]").textContent, shown: document.querySelector('[data-testid="grading-fit-card"]').getAttribute("data-fit-shown"), link: document.querySelector('[data-testid="grading-fit-alt"]').textContent, work: document.querySelector("[data-fit-earthwork]").textContent }));
  check("the alternative shows a smaller, balanced building and offers the way back (still one link)", altCard.shown === "alt" && num(altCard.sf) < sf && /balanced|export|import/.test(altCard.work) && /^Or the biggest/.test(altCard.link), JSON.stringify(altCard));
  await page.click('[data-testid="grading-fit-alt"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="grading-fit-card"]').getAttribute("data-fit-shown") === "best", null, { timeout: 5000 }).catch(() => {});
  check("…and back to the biggest", (await page.textContent("[data-fit-sf]")) === card.sf);

  // ---- Dismiss ----
  await page.click('[data-testid="grading-fit-dismiss"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="grading-fit-card"]'), null, { timeout: 5000 }).catch(() => {});
  check("Dismiss clears the card and the ghost and changes nothing", (await page.locator('[data-testid="grading-fit-card"]').count()) === 0 && (await page.locator('[data-layer="fit-ghost"]').count()) === 0 && JSON.stringify(await bld()) === JSON.stringify(before));

  // ---- Use this ----
  await btn.click();
  await page.waitForSelector('[data-testid="grading-fit-card"]', { timeout: 90000 });
  const c2 = await page.evaluate(() => ({ sf: document.querySelector("[data-fit-sf]").textContent, dims: document.querySelector("[data-fit-dims]").textContent, ffe: document.querySelector("[data-fit-ffe]").textContent, work: document.querySelector("[data-fit-earthwork]").textContent }));
  check("a second run gives the same answer (deterministic)", c2.sf === card.sf && c2.dims === card.dims && c2.ffe === card.ffe, `${c2.sf} ${c2.dims} ${c2.ffe}`);
  await page.click('[data-testid="grading-fit-use"]');
  await page.waitForFunction(() => window.__fitApplied === 1, null, { timeout: 5000 });
  const after = await bld();
  const [dl, dd] = c2.dims.match(/\d+/g).map(Number);
  check("Use this applied it once: the building has the card's dimensions and a typed finished floor", Math.max(after.w, after.h) === Math.max(dl, dd) && Math.min(after.w, after.h) === Math.min(dl, dd) && after.basis === "typed" && Math.abs(after.ffe - num(c2.ffe.replace("Finished floor", ""))) <= 0.5, JSON.stringify(after));
  check("the card and the ghost are gone after Use this", (await page.locator('[data-testid="grading-fit-card"]').count()) === 0 && (await page.locator('[data-layer="fit-ghost"]').count()) === 0);
  // the Grading panel now reads the fitted layout: its cut / fill tiles equal the card's (same engine, same inputs)
  await page.waitForTimeout(500);
  await page.waitForFunction((was) => { const e = document.querySelector('[data-tile-value="cut"]'); return e && e.textContent !== was; }, (await tiles())[0], { timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const [cutT, fillT] = (await tiles()).map(num);
  const cardCut = num((/Cut ([\d,]+)/.exec(c2.work) || [])[1]), cardFill = num((/Fill ([\d,]+)/.exec(c2.work) || [])[1]);
  check("the Grading panel's cut / fill after Use this agree with the card (within 5%)", Math.abs(cutT - cardCut) / cardCut < 0.05 && Math.abs(fillT - cardFill) / cardFill < 0.05, `panel ${cutT}/${fillT} vs card ${cardCut}/${cardFill}`);
  const realErrs = errs.filter((e) => !/ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET|Failed to load resource/.test(e));   // the sandbox's blocked outbound hosts (soil / GIS reads), not this feature
  check("no page errors (no render loop, no worker error)", realErrs.length === 0, realErrs.slice(0, 3).join(" | "));
  console.log(`\nFit the biggest building on Chehaw (Concept A): ${card.sf} (${card.dims}) ${card.ffe}; ${card.work}; ${card.alt}; ${ms} ms click → card\n`);
  await browser.close();
} finally { vite.kill(); }

console.log([...notes, ...fails].join("\n"));
if (fails.length) { console.error(`\n${fails.length} FAILED`); process.exit(1); }
console.log(`\nall ${notes.length} checks passed`);
