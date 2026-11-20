/* NEW-1 (2026-11-03) — "scrolling on the schedule module is kinda shakey vertically", and, more specifically,
 * "scrolling up to the top ... there seems to be like resistance when I get to the final top rows".
 *
 * REAL wheel input (page.mouse.wheel — never a scrollTop assignment) over the Grid, Split and Gantt views, up from the
 * middle to the very top and down to the very bottom, as notch-sized (100) and trackpad-sized (small) deltas. An
 * in-page recorder samples EVERY animation frame, and the verdicts are about what is on screen, frame by frame:
 *
 *   1  DIRECTION   no pane's scrollTop ever moves AGAINST the commanded direction (a write-back that fights the wheel).
 *   2  PANES       in Split the grid and the Gantt show the same scrollTop, and a task mounted in both is at the same
 *                  height in both, in every frame (panes drifting against each other).
 *   3  COVERAGE    every frame has a row mounted for the whole visible part of each pane (rows popping in late — the
 *                  virtualiser's window ran out before React committed the next one).
 *   4  HEADER      the frozen header stays at the top of its pane in every frame.
 *   5  EDGES       each wheel step moves the FULL commanded distance right up to the top (or bottom) edge and lands
 *                  exactly on it — no short, held-back step in the last rows (the owner's "resistance").
 *   6  ECONOMY     the row list is re-laid out a handful of times per screenful, not on every row boundary
 *                  (counted as DOM commit batches in the rows layer).
 *   7  PASSIVE     with no modifier key held, NO non-passive wheel listener exists — one makes every wheel notch wait for
 *                  the main thread before the browser may scroll (the page's Ctrl+wheel zoom must register only while
 *                  Ctrl/Cmd is down, and must still zoom when it is).
 *
 * ⛔ THE KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): before any scenario is scored, the recorder is pointed at the
 * app AT REST at several scroll positions and must report ZERO uncovered rows, matching panes and a pinned header — if it
 * does not, the instrument (not the app) is wrong and the run is VOID.
 *
 * Headless Chromium has no wheel smoothing and no compositor thread to starve, so this gate measures what is
 * measurable there (dropped coverage, write-backs, drift, re-layout count, a blocking listener). The OWNER's feel on a
 * real display stays a live check (V-entry); this gate is why a regression in any of the above cannot return unseen.
 *
 *   node ui-audit/verify-schedule-scroll-smooth.mjs               # the working tree
 *   PLANYR_URL=https://planyr.io/sequence/ node ui-audit/verify-schedule-scroll-smooth.mjs   # the deployed bytes
 *   THROTTLE=4 node ...                                           # CPU-throttled (a slower machine), same verdicts
 * Exit 0 = every verdict held; 1 = a real defect; 2 = VOID (instrument could not see its known-good case).
 */
import { bootSchedule } from "./lib/scheduleStandalone.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const THROTTLE = Number(process.env.THROTTLE || 1);
const ROW_H = 24, HEAD_H = 30;
const failures = [];
const line = s => console.log(s);
const fail = (scenario, msg) => { failures.push(`${scenario}: ${msg}`); line(`    ✗ ${msg}`); };

const { page, url, close } = await bootSchedule({ viewport: { width: 1600, height: 950 } });
// Record every wheel listener the page registers, with its passive flag — so verdict 7 reads the page's own registrations.
await page.addInitScript(() => {
  window.__wheelRegs = [];
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const flag = o => (typeof o === "object" && o ? !!o.passive : false);
  EventTarget.prototype.addEventListener = function (t, fn, o) {
    if (t === "wheel" && (this === window || this === document || this === document.body || this === document.documentElement)) window.__wheelRegs.push({ fn, passive: flag(o), on: this === window ? "window" : "document" });
    return add.call(this, t, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (t, fn, o) {
    if (t === "wheel") window.__wheelRegs = window.__wheelRegs.filter(r => r.fn !== fn);
    return rem.call(this, t, fn, o);
  };
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });
await assertMeasurable(page, "verify-schedule-scroll-smooth");
if (THROTTLE > 1) { const c = await page.context().newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); }
await pacedWait(page, 800);

const PANES = `
  window.__tasksN = () => { const g = document.querySelector("[data-grid-scroll]") || document.querySelector("[data-gantt-scroll]");
    return Math.round((g.scrollHeight - ${HEAD_H}) / ${ROW_H}) - Math.max(100, Math.ceil((g.clientHeight - 80) / ${ROW_H}) + 40); };
  window.__pane = () => ({ g: document.querySelector("[data-grid-scroll]"), a: document.querySelector("[data-gantt-scroll]") });
  window.__cov = (el, sel) => { // rows of the visible part of the pane with NO row mounted
    if (!el) return 0; const st = el.scrollTop, ch = el.clientHeight;
    const lo = Math.floor(st / ${ROW_H}), hi = Math.ceil((st + ch - ${HEAD_H}) / ${ROW_H}) - 1;
    let min = Infinity, max = -Infinity;
    for (const r of el.querySelectorAll(sel)) { const i = Math.round(parseFloat(r.style.top) / ${ROW_H}); if (!isNaN(i)) { if (i < min) min = i; if (i > max) max = i; } }
    const need0 = Math.max(lo, 0), need1 = Math.min(hi, window.__tasksN() - 1);
    if (need1 < need0) return 0;                       // the pane is showing only the blank rows below the last task
    if (min === Infinity) return need1 - need0 + 1;
    return Math.max(0, Math.min(min, need1 + 1) - need0) + Math.max(0, need1 - Math.max(max, need0 - 1));
  };`;
await page.evaluate(PANES);

/** One sample of everything a frame can get wrong. Runs inside the page. */
const SAMPLE = `(() => {
  const { g, a } = window.__pane();
  const gr = g && g.getBoundingClientRect(), ar = a && a.getBoundingClientRect();
  const hdr = g && g.querySelector("[data-grid-header]");
  let drift = null;
  if (g && a) { // a task mounted in BOTH panes must sit at the same height in both
    for (const r of g.querySelectorAll("[data-task-row]")) {
      const id = r.getAttribute("data-task-row"), m = a.querySelector('[data-gantt-row="' + id + '"]');
      if (m) { const d = (r.getBoundingClientRect().top - gr.top) - (m.getBoundingClientRect().top - ar.top); drift = Math.max(drift ?? 0, Math.abs(d)); break; }
    }
  }
  return { g: g ? g.scrollTop : null, a: a ? a.scrollTop : null, gc: window.__cov(g, ".drow"), ac: window.__cov(a, "[data-gantt-row]"),
           hdr: hdr ? Math.round(hdr.getBoundingClientRect().top - gr.top) : null, drift };
})()`;

async function openView(label) {
  await page.locator(".hdr-view button", { hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForFunction(l => (l === "Grid" ? !!document.querySelector("[data-grid-scroll]") && !document.querySelector("[data-gantt-scroll]")
    : l === "Gantt" ? !!document.querySelector("[data-gantt-scroll]") && !document.querySelector("[data-grid-scroll]")
    : !!document.querySelector("[data-grid-scroll]") && !!document.querySelector("[data-gantt-scroll]")), label, { timeout: 15000 });
  await pacedWait(page, 500);
  await page.evaluate(PANES);
}
const paneSel = () => page.evaluate(() => document.querySelector("[data-grid-scroll]") ? "[data-grid-scroll]" : "[data-gantt-scroll]");
const rangeOf = sel => page.evaluate(s => { const e = document.querySelector(s); return { max: e.scrollHeight - e.clientHeight }; }, sel);
const setTop = (v) => page.evaluate(v => { for (const s of ["[data-grid-scroll]", "[data-gantt-scroll]"]) { const e = document.querySelector(s); if (e) e.scrollTop = v; } }, v);

async function record(on) {
  if (on) {
    await page.evaluate(SAMPLE_START => {
      window.__rec = { frames: [], commits: 0, on: true };
      const spacers = [...document.querySelectorAll("[data-grid-scroll] .drow, [data-gantt-scroll] [data-gantt-row]")].map(r => r.parentElement);
      const mo = new MutationObserver(m => { if (m.some(x => x.addedNodes.length || x.removedNodes.length)) window.__rec.commits++; });
      new Set(spacers).forEach(s => mo.observe(s, { childList: true }));
      window.__rec.mo = mo;
      const tick = () => { window.__rec.frames.push(eval(SAMPLE_START)); if (window.__rec.on) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, SAMPLE);
    return null;
  }
  return page.evaluate(() => { window.__rec.on = false; window.__rec.mo.disconnect(); return { frames: window.__rec.frames, commits: window.__rec.commits }; });
}

/** Verdicts 1-4 over a recorded run. */
function judge(name, rec, dir, hasBoth) {
  const f = rec.frames; const want = dir === "up" ? -1 : 1;
  let against = 0, firstAgainst = "";
  for (let i = 1; i < f.length; i++) for (const k of ["g", "a"]) {
    if (f[i][k] == null) continue; const d = f[i][k] - f[i - 1][k];
    if (d * want < 0) { against++; if (!firstAgainst) firstAgainst = `${k} ${f[i - 1][k]} → ${f[i][k]}`; }
  }
  against ? fail(name, `${against} frame(s) moved a pane AGAINST the scroll direction (first: ${firstAgainst})`) : line(`    ✓ direction — no frame moved against the wheel (${f.length} frames)`);
  if (hasBoth) {
    const skew = f.filter(x => Math.abs((x.g ?? 0) - (x.a ?? 0)) > 1), drift = f.filter(x => x.drift != null && x.drift > 1);
    skew.length || drift.length ? fail(name, `panes drifted: scrollTop differed in ${skew.length} frame(s) (worst ${Math.max(0, ...skew.map(x => Math.abs(x.g - x.a)))}px); a shared row sat at different heights in ${drift.length} frame(s) (worst ${Math.max(0, ...drift.map(x => x.drift)).toFixed(1)}px)`)
      : line("    ✓ panes — grid and Gantt scrollTop equal, shared rows level, in every frame");
  }
  const unc = f.filter(x => x.gc > 0 || x.ac > 0);
  unc.length ? fail(name, `${unc.length} of ${f.length} frames showed part of a pane with NO row mounted (worst: grid ${Math.max(0, ...f.map(x => x.gc))} row(s), Gantt ${Math.max(0, ...f.map(x => x.ac))} row(s)) — rows popping in late`)
    : line("    ✓ coverage — a row was mounted for the whole visible pane in every frame");
  const hd = f.filter(x => x.hdr != null && x.hdr !== 0);
  hd.length ? fail(name, `the frozen header left the top of the grid in ${hd.length} frame(s) (e.g. ${hd[0].hdr}px)`) : line("    ✓ header — pinned to the top in every frame");
}

// ── THE KNOWN-GOOD ARM: the recorder at rest, before anything is scored ─────────────────
line("\nNEW-1 — Schedule vertical scroll: frame-by-frame, real wheel input\n");
line("  [known-good arm] the recorder at rest, Split view");
const rangeSplit = await rangeOf("[data-grid-scroll]");
if (!(rangeSplit.max > 3000)) { line(`  VOID — the fixture is too short to scroll meaningfully (${rangeSplit.max}px of travel)`); await close(); process.exit(2); }
for (const pos of [0, 100, 1234, Math.floor(rangeSplit.max / 2), rangeSplit.max]) {
  await setTop(pos); await pacedWait(page, 350);
  const s = await page.evaluate(SAMPLE);
  const bad = s.gc > 0 || s.ac > 0 || (s.g !== s.a) || s.hdr !== 0 || (s.drift != null && s.drift > 1);
  if (bad) { line(`  VOID — at rest at ${pos}px the instrument reports ${JSON.stringify(s)}; it cannot be trusted to score a scroll`); await close(); process.exit(2); }
}
line("    ✓ at rest at 5 positions: nothing uncovered, panes equal, header pinned — the instrument can see a healthy page");

// ── 7  PASSIVE: wheel listeners, read from the page's own registrations ──────────────────
line("\n  [7 PASSIVE] wheel listeners on window/document with no modifier held");
{
  const regs = await page.evaluate(() => window.__wheelRegs.map(r => ({ passive: r.passive, on: r.on })));
  const blocking = regs.filter(r => !r.passive);
  blocking.length ? fail("passive", `${blocking.length} NON-PASSIVE wheel listener(s) on the page at rest — every wheel notch must wait for the main thread before the browser may scroll`)
    : line(`    ✓ none (${regs.length} passive)`);
  // Ctrl+wheel must still zoom the Gantt timeline.
  await openView("Gantt"); await page.mouse.move(800, 500);
  const before = await page.evaluate(() => document.querySelector("[data-gantt-scroll]").scrollWidth);
  await page.keyboard.down("Control");
  await pacedWait(page, 100);
  const during = await page.evaluate(() => window.__wheelRegs.filter(r => !r.passive).length);
  await page.mouse.wheel(0, -300); await pacedWait(page, 400);
  await page.keyboard.up("Control"); await pacedWait(page, 200);
  const after = await page.evaluate(() => document.querySelector("[data-gantt-scroll]").scrollWidth);
  const after2 = await page.evaluate(() => window.__wheelRegs.filter(r => !r.passive).length);
  after > before && during >= 1 ? line(`    ✓ Ctrl held: a blocking listener is registered and Ctrl+wheel still zooms the timeline (width ${before} → ${after})`)
    : fail("passive", `Ctrl+wheel no longer zooms the Gantt (width ${before} → ${after}; blocking listeners while Ctrl held: ${during})`);
  after2 === 0 ? line("    ✓ Ctrl released: back to none") : fail("passive", `${after2} blocking wheel listener(s) still registered after Ctrl was released`);
  await page.mouse.wheel(0, 300); await pacedWait(page, 300);   // restore zoom for the rest
}

// ── scenarios ───────────────────────────────────────────────────────────────────────────
async function scenario(view, dir, style) {
  const name = `${view} · ${dir} · ${style}`;
  line(`\n  ${name}`);
  await openView(view);
  const sel = await paneSel(); const { max } = await rangeOf(sel);
  const start = dir === "up" ? Math.floor(max * 0.6) : 0;
  await setTop(start); await pacedWait(page, 500);
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await record(true);
  const sign = dir === "up" ? -1 : 1, delta = style === "notch" ? 100 : 14, gap = style === "notch" ? 45 : 8;
  const travel = dir === "up" ? start : Math.min(max, 2600);
  const steps = Math.ceil(travel / delta) + 4;
  const t0 = Date.now();
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, sign * delta); await pacedWait(page, gap); }
  await pacedWait(page, 400);
  const rec = await record(false);
  judge(name, rec, dir, view === "Split");
  const moved = Math.abs(rec.frames[rec.frames.length - 1][view === "Gantt" ? "a" : "g"] - start);
  const panes = view === "Split" ? 2 : 1, perScreen = rec.commits / Math.max(1, moved / 869) / panes;
  perScreen > 6 ? fail(name, `the row list re-laid out ${rec.commits} times over ${Math.round(moved)}px (${perScreen.toFixed(1)} per screenful per pane; budget 6) — it commits on every row boundary`)
    : line(`    ✓ economy — ${rec.commits} row-list commits over ${Math.round(moved)}px (${perScreen.toFixed(1)} per screenful)`);
}
for (const view of ["Split", "Grid", "Gantt"]) for (const dir of ["down", "up"]) for (const style of ["notch", "trackpad"]) {
  if (style === "trackpad" && view !== "Split") continue;      // one trackpad arm is enough to read the rhythm
  await scenario(view, dir, style);
}

// ── 1b  SMOOTHED WHEEL EMULATION: the driven pane advances EVERY frame, as Chrome's smooth wheel animation does ──────────
// Headless wheel input lands in one jump, so it cannot show what a pane being scrolled FRAME BY FRAME meets when the other
// pane's write-back arrives late. This advances the driven pane by 30px per frame (the compositor's job in a real browser —
// a script write is the closest stand-in) and requires it never to be pulled back and the other pane to follow.
for (const [driven, up] of [["grid", false], ["gantt", false], ["grid", true], ["gantt", true]]) {
  const name = `Split · smooth-wheel emulation driving the ${driven} ${up ? "UP to the very top" : "down"}`;
  line(`\n  ${name}`);
  await openView("Split");
  await setTop(up ? 900 : 1000); await pacedWait(page, 500);
  const r = await page.evaluate(async ([d, up]) => {
    const g = document.querySelector("[data-grid-scroll]"), a = document.querySelector("[data-gantt-scroll]"), me = d === "grid" ? g : a, other = d === "grid" ? a : g;
    const frames = []; let pos = me.scrollTop;
    await new Promise(res => { let n = 0; const tick = () => { pos = up ? Math.max(0, pos - 30) : pos + 30; me.scrollTop = pos; frames.push({ me: me.scrollTop, other: other.scrollTop }); if (++n < 80) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    await new Promise(r => setTimeout(r, 300));
    return { frames, end: { me: me.scrollTop, other: other.scrollTop }, want: pos };
  }, [driven, up]);
  let back = 0, worst = 0;
  for (let i = 1; i < r.frames.length; i++) { const d = r.frames[i].me - r.frames[i - 1].me; if (up ? d > 0 : d < 0) back++; }
  for (const f of r.frames) worst = Math.max(worst, Math.abs(f.me - f.other));
  back ? fail(name, `the pane being scrolled was pulled BACK against the scroll in ${back} frame(s) — the other pane's echo wrote a stale position into it`) : line("    ✓ the driven pane never moved backward");
  r.end.me !== r.want ? fail(name, `the driven pane ended at ${r.end.me}, not where it was driven to (${r.want}${up ? ", the very top" : ""}) — a write-back overrode it, so the scroll stops short of the edge`) : line(`    ✓ the driven pane ended exactly where it was driven (${r.want})`);
  r.end.other !== r.end.me ? fail(name, `the other pane ended at ${r.end.other}, not level with the driven one (${r.end.me})`) : line("    ✓ the other pane ended level with it");
}

// ── 5  EDGES: every step lands in full right up to the edge, and ON it ───────────────────
for (const view of ["Split", "Grid", "Gantt"]) for (const dir of ["up", "down"]) {
  const name = `edge · ${view} · ${dir}`;
  line(`\n  ${name}`);
  await openView(view);
  const sel = await paneSel(); const { max } = await rangeOf(sel);
  const sign = dir === "up" ? -1 : 1, edge = dir === "up" ? 0 : max, STEP = 100;
  await setTop(dir === "up" ? 700 : max - 700); await pacedWait(page, 500);
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const log = [];
  for (let i = 0; i < 12; i++) {
    const b = await page.evaluate(s => document.querySelector(s).scrollTop, sel);
    await page.mouse.wheel(0, sign * STEP); await pacedWait(page, 60);
    const a = await page.evaluate(s => document.querySelector(s).scrollTop, sel);
    log.push({ b, a, d: a - b });
  }
  const short = log.filter(l => l.a !== edge && Math.abs(l.d) < STEP - 1);
  const last = log[log.length - 1].a;
  short.length ? fail(name, `${short.length} wheel step(s) moved less than the commanded ${STEP}px short of the edge: ${short.slice(0, 4).map(l => `${l.b}→${l.a}`).join(", ")} — the scroll was held back`)
    : line(`    ✓ every step moved the full ${STEP}px until the edge`);
  last === edge ? line(`    ✓ landed exactly on the ${dir === "up" ? "top" : "bottom"} edge (${edge})`) : fail(name, `after 12 steps the pane sits at ${last}, not on the ${dir === "up" ? "top" : "bottom"} edge (${edge})`);
  // one big flick must reach the edge in a single step
  await setTop(dir === "up" ? 1500 : max - 1500); await pacedWait(page, 400);
  await page.mouse.wheel(0, sign * 4000); await pacedWait(page, 500);
  const flick = await page.evaluate(s => document.querySelector(s).scrollTop, sel);
  flick === edge ? line("    ✓ a single 4000px flick reaches the edge in one go") : fail(name, `a 4000px flick stopped at ${flick}, not the edge (${edge})`);
}

line("");
if (failures.length) { line(`FAIL — ${failures.length} defect(s):`); failures.forEach(f => line("  - " + f)); await close(); process.exit(1); }
line("PASS — every frame covered, panes level, no write-back, edges clean, no blocking wheel listener at rest.");
await close();
