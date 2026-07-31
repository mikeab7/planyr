#!/usr/bin/env node
/* diagnose-pan-commits — how many React commits does ONE pan frame cost? (NEW-3)
 *
 * THE CLAIM UNDER TEST, reasoned from the code and explicitly NOT observed by the reporter:
 * `setView` runs synchronously inside the pointermove handler, so React 18 batches it into one
 * commit; `setCursor` is scheduled onto the NEXT animation frame by `scheduleFrameJob("cursor")`,
 * which is a separate task, so React cannot batch it with the pan — a straight 2x on the hottest
 * path in the app. `cursor` holds a FRESH `{x,y}` object every move, so it can never bail on
 * Object.is either.
 *
 * HOW IT IS MEASURED WITHOUT AN INSTRUMENTED BUILD. A MutationObserver's callback fires once per
 * DELIVERY BATCH, and React flushes a commit's DOM writes synchronously inside one task — so one
 * callback invocation corresponds to one commit's worth of DOM work. Each batch is then
 * CLASSIFIED by what it actually touched: a `data-view-*` attribute on the canvas (the pan
 * commit) versus the coordinate readout's text (the cursor commit). Counting them separately is
 * what turns "about two" into evidence, and it is what would show the claim to be wrong if the
 * cursor commit were already being batched.
 *
 * Reported against the rAF count across the same gesture, because "commits per frame" is the
 * number that matters — a commit that lands in a frame nobody painted costs nothing.
 *
 *   node ui-audit/diagnose-pan-commits.mjs                      # against http://localhost:4173
 *   BASE_URL=http://localhost:4176 node ui-audit/diagnose-pan-commits.mjs --json
 */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const MOVES = 60;
const stepArg = process.argv.indexOf("--steps");
const STEPS = stepArg > -1 ? Number(process.argv[stepArg + 1]) : 1;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(perfScenarioSeed());
await ctx.addInitScript(() => {
  window.__rafs = 0;
  const tick = () => { window.__rafs++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(2500);

const box = await page.locator("svg[role=application]").boundingBox();
/* Press on BARE CANVAS — a centre press lands on an element and never pans (the NEW-1 finding). */
const at = await page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.3, 0.7]) for (const fx of [0.25, 0.5, 0.75, 0.12]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const hit = document.elementFromPoint(x, y);
    if (hit && svg.contains(hit) && !hit.closest("[data-el-id]")) return { x, y };
  }
  return null;
});
const px = at ? at.x : box.x + box.width / 2, py = at ? at.y : box.y + box.height / 2;

await page.evaluate(() => {
  window.__batches = [];
  window.__rafs = 0;
  const root = document.body;
  const CHIP = () => { const g = document.querySelector("[data-ground-el]"); return g ? g.parentElement : null; };
  window.__mo = new MutationObserver((recs) => {
    let view = false, reg = false, chip = false;
    const chipEl = CHIP();
    for (const r of recs) {
      if (r.type === "attributes" && /^data-view-/.test(r.attributeName || "")) { view = true; continue; }
      if (r.type === "attributes" && /^data-reg-/.test(r.attributeName || "")) { reg = true; continue; }
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (chipEl && el && chipEl.contains(el)) chip = true;
    }
    window.__batches.push({ view, reg, chip, records: recs.length });
  });
  window.__mo.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
});

const t0 = Date.now();
await page.mouse.move(px, py);
await page.mouse.down();
for (let i = 0; i < MOVES; i++) await page.mouse.move(px + Math.sin(i / 6) * 300, py + Math.cos(i / 8) * 180, { steps: STEPS });
await page.mouse.up();
const ms = Date.now() - t0;
await page.waitForTimeout(200);

const out = await page.evaluate(() => {
  window.__mo.disconnect();
  const b = window.__batches;
  return {
    rafs: window.__rafs,
    batches: b.length,
    viewBatches: b.filter((x) => x.view).length,
    regOnlyBatches: b.filter((x) => x.reg && !x.view).length,
    chipBatches: b.filter((x) => x.chip).length,
    chipWithViewBatches: b.filter((x) => x.chip && x.view).length,
    chipAloneBatches: b.filter((x) => x.chip && !x.view && !x.reg).length,
    nonViewBatches: b.filter((x) => !x.view).length,
    records: b.reduce((n, x) => n + x.records, 0),
  };
});
await browser.close();

const perFrame = (n) => +(n / Math.max(1, out.rafs)).toFixed(2);
const res = {
  base: BASE, gestureMs: ms, moves: MOVES,
  ...out,
  commitsPerFrame: perFrame(out.batches),
  viewCommitsPerFrame: perFrame(out.viewBatches),
  cursorOnlyCommitsPerFrame: perFrame(out.nonViewBatches),
};
if (JSON_OUT) console.log(JSON.stringify(res, null, 2));
else {
  console.log(`Pan commit cost (NEW-3)\n  target: ${BASE}\n`);
  console.log(`  ${MOVES * STEPS} pointermove events (${MOVES} x ${STEPS} steps) over ${ms} ms · ${out.rafs} animation frames`);
  console.log(`  DOM-commit batches: ${out.batches} total = ${res.commitsPerFrame} per painted frame`);
  console.log(`  DOM-commit batches per POINTERMOVE EVENT: ${(out.batches / (MOVES * STEPS)).toFixed(2)}   <- the number the claim is about`);
  console.log(`      touched data-view-* (the pan commit):              ${out.viewBatches}`);
  console.log(`      touched data-reg-* and NOT the view (registration): ${out.regOnlyBatches}`);
  console.log(`      touched the coordinate chip at all:                ${out.chipBatches}`);
  console.log(`          ...of those, BATCHED WITH the pan commit:      ${out.chipWithViewBatches}`);
  console.log(`          ...of those, a commit of their OWN:            ${out.chipAloneBatches}`);
  console.log(`      touched neither view nor reg:                      ${out.nonViewBatches}`);
  console.log(`  ${out.records} DOM mutation records in total`);
}
