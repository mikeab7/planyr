/* NEW-1 (2026-11-03) — "scrolling on the schedule module is kinda shakey vertically", and the follow-up:
 * "scrolling up to the top ... there seems to be like resistance when I get to like the final top rows".
 *
 * EXPLORATORY PROBE (not the gate — that is verify-schedule-scroll-smooth.mjs). Drives REAL wheel input
 * (page.mouse.wheel) and records, on every animation frame, the scrollTop of both panes, the rendered top
 * of one row in each pane, the scroll events, and the long tasks.
 *
 *   node ui-audit/diagnose-schedule-scroll-feel.mjs [grid|split|gantt] [up|down] [stepPx]
 */
import { bootSchedule } from "./lib/scheduleStandalone.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const view = process.argv[2] || "split";
const dir = process.argv[3] || "up";
const STEP = Number(process.argv[4] || 100);
const { page, url, close } = await bootSchedule();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });
await assertMeasurable(page, "diagnose-schedule-scroll-feel");
await pacedWait(page, 800);

const THROTTLE = Number(process.env.THROTTLE || 1);
if (THROTTLE > 1) { const c = await page.context().newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); }
const GAP = Number(process.env.GAP || 40);
const has = () => page.evaluate(() => ({ grid: !!document.querySelector("[data-grid-scroll]"), gantt: !!document.querySelector("[data-gantt-scroll]") }));
console.log("at boot:", await has());

const run = await page.evaluate(({ dir, STEP }) => new Promise(resolve => {
  const g = document.querySelector("[data-grid-scroll]"), a = document.querySelector("[data-gantt-scroll]");
  const pane = g || a;
  const mid = Math.floor((pane.scrollHeight - pane.clientHeight) / 2);
  const startAt = dir === "up" ? mid : 0;
  if (g) g.scrollTop = startAt; if (a) a.scrollTop = startAt;
  resolve({ sh: pane.scrollHeight, ch: pane.clientHeight, startAt });
}), { dir, STEP });
console.log(JSON.stringify(run));
await pacedWait(page, 400);

// recorder
await page.evaluate(() => {
  const g = document.querySelector("[data-grid-scroll]"), a = document.querySelector("[data-gantt-scroll]");
  window.__rec = { frames: [], ev: 0, long: [] };
  let n = 0; const t0 = performance.now();
  g && g.addEventListener("scroll", () => window.__rec.ev++);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__rec.long.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] }); } catch {}
  const cov = (el, sel) => { // rows needed to fill the visible part of the pane vs rows actually mounted
    if (!el) return null; const st = el.scrollTop, ch = el.clientHeight;
    const lo = Math.floor(st / 24), hi = Math.ceil((st + ch - 30) / 24) - 1;
    let min = Infinity, max = -Infinity;
    for (const r of el.querySelectorAll(sel)) { const top = parseFloat(r.style.top); if (isNaN(top)) continue; const i = Math.round(top / 24); if (i < min) min = i; if (i > max) max = i; }
    return Math.max(0, Math.max(min - lo, 0)) + Math.max(0, hi - max); // rows of viewport with no row mounted
  };
  const tick = () => { window.__rec.frames.push({ t: Math.round(performance.now() - t0), g: g ? g.scrollTop : null, a: a ? a.scrollTop : null, gm: cov(g, ".drow"), am: cov(a, "[data-gantt-row]") }); if (window.__rec.on !== false) requestAnimationFrame(tick); };
  window.__rec.on = true; requestAnimationFrame(tick);
});

const pane = (await has()).grid ? "[data-grid-scroll]" : "[data-gantt-scroll]";
const box = await page.locator(pane).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const sign = dir === "up" ? -1 : 1;
const log = [];
for (let i = 0; i < 400; i++) {
  const before = await page.evaluate(p => document.querySelector(p).scrollTop, pane);
  await page.mouse.wheel(0, sign * STEP);
  await pacedWait(page, GAP);
  const after = await page.evaluate(p => document.querySelector(p).scrollTop, pane);
  log.push({ i, before, after, d: after - before });
  if ((dir === "up" && after <= 0 && log.length > 3 && log[log.length - 2].after <= 0) || (dir === "down" && after === before && i > 5)) break;
}
await pacedWait(page, 300);
const rec = await page.evaluate(() => { window.__rec.on = false; return window.__rec; });
console.log("wheel steps (before→after, Δ) — last 25:");
for (const l of log.slice(-25)) console.log(`  #${l.i}  ${l.before} → ${l.after}  Δ${l.d}  (commanded ${sign * STEP})`);
const full = log.filter(l => Math.abs(l.d) >= STEP - 1).length;
console.log(`steps: ${log.length}, full-size: ${full}, short(non-zero): ${log.filter(l => l.d !== 0 && Math.abs(l.d) < STEP - 1).length}, zero: ${log.filter(l => l.d === 0).length}`);
console.log("scroll events:", rec.ev, "long tasks(ms):", rec.long.join(","));
// pane skew in split
const skew = rec.frames.filter(f => f.g != null && f.a != null && f.g !== f.a);
console.log(`frames: ${rec.frames.length}, frames where grid≠gantt scrollTop: ${skew.length}`, skew.slice(0, 8).map(f => `${f.g}/${f.a}`).join(" "));
// BUCKETS — frame time by scroll position: is the stretch near the top different from the middle?
{ const B = [[0, 150], [150, 400], [400, 1500], [1500, 99999]]; const rows = B.map(([lo, hi]) => { const ds = []; for (let i = 1; i < rec.frames.length; i++) { const st = rec.frames[i].g ?? rec.frames[i].a; if (st >= lo && st < hi) ds.push(rec.frames[i].t - rec.frames[i - 1].t); } ds.sort((x, y) => x - y); return `st ${lo}-${hi === 99999 ? "end" : hi}: n=${ds.length} median=${ds[Math.floor(ds.length / 2)] ?? "-"}ms max=${ds[ds.length - 1] ?? "-"}ms`; }); console.log("BUCKETS (rAF-to-rAF frame time)\n  " + rows.join("\n  ")); }
const want = dir === "up" ? -1 : 1; let nonmono = 0, back = [];
for (let i = 1; i < rec.frames.length; i++) for (const k of ["g", "a"]) { const d = (rec.frames[i][k] ?? 0) - (rec.frames[i - 1][k] ?? 0); if (d * want < 0) { nonmono++; if (back.length < 6) back.push(`${k}@${rec.frames[i].t}ms ${rec.frames[i - 1][k]}→${rec.frames[i][k]}`); } }
console.log(`frames where a pane moved AGAINST the scroll direction: ${nonmono}`, back.join(" | "));
const miss = rec.frames.filter(f => (f.gm || 0) > 0 || (f.am || 0) > 0);
console.log(`frames with part of the viewport showing NO mounted row (grid/gantt): ${miss.length} of ${rec.frames.length}; worst rows missing grid=${Math.max(0, ...rec.frames.map(f => f.gm || 0))} gantt=${Math.max(0, ...rec.frames.map(f => f.am || 0))}`);
if (process.env.DUMP) console.log(rec.frames.filter(f => (f.gm||0)>0 || (f.am||0)>0).slice(0, 40).map(f => JSON.stringify(f)).join("\n"));
await close();
