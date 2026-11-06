/* NEW-1 (2026-11-06) — "i want ctrl zoom to always work if im hovering over the schedule".
 *
 * THE CASE verify-schedule-scroll-smooth.mjs CANNOT SEE: it boots the Schedule STANDALONE, where keyboard focus is
 * always inside the page that owns the wheel listener. In the app the Schedule is an IFRAME inside the shell, and a
 * Ctrl press while focus is anywhere else (header, project switcher, a panel) is delivered to the PARENT document, never
 * to the frame — so the frame (which only listens for Ctrl+wheel while it knows Ctrl is down, public/sequence/index.html)
 * had no listener, and the browser zoomed the whole page.
 *
 * This boots the real Schedule INSIDE a same-origin parent page, parks keyboard focus in a parent <input>, hovers the
 * Gantt / Grid, holds Ctrl (or Meta), wheels, and asserts BOTH:
 *   · the timeline / grid zoom readout changed, and
 *   · the frame CANCELLED the wheel event (defaultPrevented) — i.e. the browser's own page zoom never gets the event.
 * Neither headless nor headed Chromium applies browser zoom to a CDP-injected wheel, so `defaultPrevented` at the end of
 * dispatch IS the observable: false on a ctrl-wheel means the browser would have zoomed the page.
 * The parent installs THE SHIPPED FORWARDER (src/workspaces/scheduler/lib/modifierForward.js, loaded from disk — not a copy).
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): "focus INSIDE the frame" is the case that worked before this fix. It
 * must pass on any build; if it does not, the instrument is wrong and the run is VOID (exit 2) — it never scores.
 *
 *   node ui-audit/verify-schedule-ctrl-zoom-hover.mjs                                   # the working tree
 *   PLANYR_URL=https://planyr.io/sequence/ node ui-audit/verify-schedule-ctrl-zoom-hover.mjs   # the deployed frame bytes
 * Exit 0 = every case held; 1 = a real defect; 2 = VOID.
 *
 * What this does NOT claim (and the doc on B2644624's follow-up says so): focus outside the page document with the pointer not
 * moving after Ctrl goes down (address bar, another window), and a trackpad pinch (a ctrl+wheel with NO key) are not covered.
 * The "pinch" case is asserted here as the KNOWN LIMIT so a future change to it is seen, not silently assumed.
 */
import { readFile } from "node:fs/promises";
import { bootSchedule } from "./lib/scheduleStandalone.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const failures = [];
const line = (s) => console.log(s);
const fail = (scenario, msg) => { failures.push(`${scenario}: ${msg}`); line(`    ✗ ${msg}`); };
const ok = (msg) => line(`    ✓ ${msg}`);

const FORWARDER = await readFile(new URL("../src/workspaces/scheduler/lib/modifierForward.js", import.meta.url), "utf8");
const { page, url, close } = await bootSchedule({ viewport: { width: 1600, height: 950 } });
const origin = new URL(url).origin;
await page.route(origin + "/__forwarder.js", (r) => r.fulfill({ contentType: "text/javascript", body: FORWARDER }));
await page.route(origin + "/__parent.html*", (r) => r.fulfill({
  contentType: "text/html",
  body: `<!doctype html><html><body style="margin:0;font:14px sans-serif">
<div style="height:40px"><input id="p" placeholder="parent field (stands in for the header / project switcher)" style="width:420px;height:30px;margin:5px"></div>
<iframe id="f" src="/sequence/" title="Sequence" style="position:absolute;left:0;top:40px;width:100%;height:calc(100% - 40px);border:0"></iframe>
<script type="module">
  window.__parentWheel = [];
  window.addEventListener("wheel", e => { const ev = e; setTimeout(() => window.__parentWheel.push({ ctrl: ev.ctrlKey, prevented: ev.defaultPrevented }), 0); }, { passive: true });
  if (!new URLSearchParams(location.search).has("nofwd")) {
    const { installModifierForward } = await import("/__forwarder.js");
    installModifierForward(window, () => document.getElementById("f").contentWindow, location.origin);
  }
</script></body></html>`,
}));

let frame = null;
/** A fresh parent page + a loaded Schedule frame, with the wheel recorder installed in the frame. */
async function fresh({ forwarder = true, view = "Split" } = {}) {
  await page.goto(origin + "/__parent.html" + (forwarder ? "" : "?nofwd"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => { const f = document.getElementById("f"); return f && f.contentDocument && f.contentDocument.querySelector("[data-task-row], [data-gantt-row]"); }, null, { timeout: 40000 });
  frame = page.frames().find((f) => f.url().includes("/sequence/"));
  await assertMeasurable(page, "verify-schedule-ctrl-zoom-hover");
  await frame.evaluate(() => {
    window.__w = [];
    window.addEventListener("wheel", (e) => { const ev = e; setTimeout(() => window.__w.push({ ctrl: ev.ctrlKey, meta: ev.metaKey, cancelable: ev.cancelable, prevented: ev.defaultPrevented }), 0); }, { passive: true });
  });
  // The Schedule's own view buttons are hidden when embedded: the shell's toolbar drives the view over the bridge.
  await page.evaluate((v) => document.getElementById("f").contentWindow.postMessage({ source: "planar-shell", type: "planar:view-set", view: v }, location.origin), view.toLowerCase());
  await frame.waitForFunction((v) => v === "split" ? !!document.querySelector("[data-grid-scroll]") && !!document.querySelector("[data-gantt-scroll]") : v === "grid" ? !!document.querySelector("[data-grid-scroll]") && !document.querySelector("[data-gantt-scroll]") : !document.querySelector("[data-grid-scroll]") && !!document.querySelector("[data-gantt-scroll]"), view.toLowerCase(), { timeout: 15000 });
  await pacedWait(page, 700);
  await page.evaluate(() => document.getElementById("p").focus());
}
const wheelLog = () => frame.evaluate(() => window.__w.splice(0));
const readout = () => frame.evaluate(() => ({
  gantt: document.querySelector("[data-gantt-scroll]")?.scrollWidth ?? null,
  grid: parseFloat(document.querySelector("[data-grid-scroll]")?.style.zoom || "1"),
  gridTop: document.querySelector("[data-grid-scroll]")?.scrollTop ?? null,
  ganttTop: document.querySelector("[data-gantt-scroll]")?.scrollTop ?? null,
}));
async function centre(sel) { const b = await frame.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
/** Where the real keyboard focus is — the precondition of every case, asserted rather than assumed. */
const focusIn = () => page.evaluate(() => { const f = document.getElementById("f"); return document.activeElement === f ? "frame" : (document.activeElement && document.activeElement.id === "p" ? "parent-input" : document.activeElement?.tagName); });

/** Hold `key`, wheel `dy` at the current pointer, release; return what the frame saw and how the readouts moved. */
async function ctrlWheel(key, dy) {
  const before = await readout(); await wheelLog();
  await page.keyboard.down(key); await pacedWait(page, 120);
  await page.mouse.wheel(0, dy); await pacedWait(page, 450);
  await page.keyboard.up(key); await pacedWait(page, 150);
  return { before, after: await readout(), events: await wheelLog() };
}
const cancelled = (events) => events.length > 0 && events.every((e) => e.prevented);
const grew = (a, b) => a != null && b != null && b > a;

async function expectZoom(name, r, target, { dy }) {
  const key = target === "gantt" ? "gantt" : "grid";
  const changed = key === "gantt" ? r.after.gantt !== r.before.gantt : r.after.grid !== r.before.grid;
  const other = key === "gantt" ? r.after.grid === r.before.grid : r.after.gantt === r.before.gantt;
  if (!r.events.length) return fail(name, "the frame saw no wheel event at all — the instrument did not deliver one");
  cancelled(r.events) ? ok(`the frame cancelled the Ctrl wheel (${r.events.length} event, defaultPrevented) — the browser page cannot zoom`) : fail(name, `the Ctrl wheel was NOT cancelled (${JSON.stringify(r.events)}) — the BROWSER would zoom the whole page`);
  changed && (dy < 0 ? grew(key === "gantt" ? r.before.gantt : r.before.grid, key === "gantt" ? r.after.gantt : r.after.grid) : true)
    ? ok(`the ${target} zoom changed (${key === "gantt" ? `timeline width ${r.before.gantt} → ${r.after.gantt}` : `grid ${r.before.grid} → ${r.after.grid}`})`)
    : fail(name, `the ${target} zoom did not change (${JSON.stringify(r.before)} → ${JSON.stringify(r.after)})`);
  other ? ok(`the other pane's zoom is untouched (hover-zone split intact)`) : fail(name, `the OTHER pane zoomed too (${JSON.stringify(r.before)} → ${JSON.stringify(r.after)})`);
}

/** Zoom back out so the next case starts where this one did (and proves zoom-out works too). */
async function restore() { await page.keyboard.down("Control"); await pacedWait(page, 100); await page.mouse.wheel(0, 300); await pacedWait(page, 400); await page.keyboard.up("Control"); await pacedWait(page, 150); }

line("\nNEW-1 — Ctrl+wheel zoom whenever the pointer is over the Schedule (Schedule embedded in a parent page)\n");

// ── KNOWN-GOOD ARM: focus INSIDE the frame (worked before the fix; must work on any build) ──────────────
line("  [known-good arm] focus inside the Schedule (a click on the grid header), pointer over the Gantt, Ctrl");
await fresh({ view: "Split" });
{
  const hb = await frame.locator("[data-grid-header]").first().boundingBox();
  await page.mouse.click(hb.x + 40, hb.y + hb.height / 2);      // neutral: selects nothing, moves keyboard focus into the frame
  if ((await focusIn()) !== "frame") { line(`  VOID — keyboard focus is in "${await focusIn()}", not the frame; the precondition could not be set`); await close(); process.exit(2); }
  await page.mouse.move(...Object.values(await centre("[data-gantt-scroll]")));
  const r = await ctrlWheel("Control", -300);
  if (!cancelled(r.events) || !grew(r.before.gantt, r.after.gantt)) { line(`  VOID — the case that worked before this fix reported ${JSON.stringify(r)}; the instrument cannot be trusted to score the others`); await close(); process.exit(2); }
  ok("focus inside the frame: cancelled and zoomed — the instrument can see a working zoom");
  await restore();
}

// ── the reported case and its neighbours ──────────────────────────────────────────────────────────────
const KEYS = [["Control", "Ctrl"], ["Meta", "Cmd"]];
for (const [key, label] of KEYS) {
  for (const view of ["Gantt", "Grid", "Split"]) {
    // pointer over the Gantt (Gantt and Split views) / the Grid (Grid and Split views)
    const targets = view === "Gantt" ? ["gantt"] : view === "Grid" ? ["grid"] : ["gantt", "grid"];
    for (const target of targets) {
      let name = `${label} · ${view} view · pointer over the ${target} · focus in a PARENT input (pointer already resting)`;
      line(`\n  ${name}`);
      await fresh({ view });
      (await focusIn()) === "parent-input" ? ok("precondition: keyboard focus is in the parent input") : (line(`  VOID — focus is in "${await focusIn()}"`), await close(), process.exit(2));
      await page.mouse.move(...Object.values(await centre(target === "gantt" ? "[data-gantt-scroll]" : "[data-grid-scroll]")));
      await pacedWait(page, 150);
      const r = await ctrlWheel(key, -300);
      await expectZoom(name, r, target, { dy: -300 });
      // the same, then a PLAIN wheel after release: it must scroll and must not zoom (Ctrl released mid-way)
      const before = await readout(); await wheelLog();
      await page.mouse.wheel(0, 300); await pacedWait(page, 450);
      const after = await readout(), ev = await wheelLog();
      const scrolled = (after.gridTop ?? after.ganttTop) !== (before.gridTop ?? before.ganttTop);
      scrolled && after.gantt === before.gantt && after.grid === before.grid && ev.every((e) => !e.ctrl && !e.prevented)
        ? ok("Ctrl released: the next plain wheel scrolls, does not zoom, and is not cancelled (no blocking listener left behind)")
        : fail(name, `after release the plain wheel misbehaved (scrolled=${scrolled}, ${JSON.stringify(before)} → ${JSON.stringify(after)}, events ${JSON.stringify(ev)})`);
      if (key === "Control") await restore();
    }
  }
}

// ── Ctrl pressed BEFORE the pointer enters the frame ─────────────────────────────────────────────────
{
  const name = "Ctrl pressed over the parent, THEN the pointer enters the Gantt, then wheel";
  line(`\n  ${name}`);
  await fresh({ view: "Gantt" });
  await page.mouse.move(900, 12);                       // over the parent's own strip
  await page.keyboard.down("Control"); await pacedWait(page, 120);
  const c = await centre("[data-gantt-scroll]"); await page.mouse.move(c.x, c.y, { steps: 6 }); await pacedWait(page, 120);
  const before = await readout(); await wheelLog();
  await page.mouse.wheel(0, -300); await pacedWait(page, 450);
  await page.keyboard.up("Control"); await pacedWait(page, 150);
  await expectZoom(name, { before, after: await readout(), events: await wheelLog() }, "gantt", { dy: -300 });
  await restore();
}

// ── the frame's OWN pointer path, with no shell forwarding at all (focus outside + modifier already down) ──
{
  const name = "no shell forwarding: Ctrl already down, the pointer MOVES into the Gantt (pointer events carry the modifier)";
  line(`\n  ${name}`);
  await fresh({ view: "Gantt", forwarder: false });
  await page.mouse.move(900, 12);
  await page.keyboard.down("Control"); await pacedWait(page, 120);
  const c = await centre("[data-gantt-scroll]"); await page.mouse.move(c.x, c.y, { steps: 6 }); await pacedWait(page, 120);
  const before = await readout(); await wheelLog();
  await page.mouse.wheel(0, -300); await pacedWait(page, 450);
  await page.keyboard.up("Control"); await pacedWait(page, 150);
  await expectZoom(name, { before, after: await readout(), events: await wheelLog() }, "gantt", { dy: -300 });
  await restore();
}

// ── plain wheel never zooms, and "the rest of the app" behaves as today ───────────────────────────────
{
  const name = "plain wheel over the Schedule (no modifier) scrolls and never zooms; Ctrl+wheel over the PARENT is left alone";
  line(`\n  ${name}`);
  await fresh({ view: "Split" });
  await page.mouse.move(...Object.values(await centre("[data-grid-scroll]")));
  const before = await readout(); await wheelLog();
  await page.mouse.wheel(0, 400); await pacedWait(page, 450);
  const after = await readout(), ev = await wheelLog();
  after.gridTop > before.gridTop && after.gantt === before.gantt && after.grid === before.grid && ev.every((e) => !e.prevented && !e.cancelable)
    ? ok("plain wheel: scrolled, no zoom, not cancelable (non-blocking)") : fail(name, `plain wheel: ${JSON.stringify(before)} → ${JSON.stringify(after)} ${JSON.stringify(ev)}`);
  await page.mouse.move(900, 12); await page.keyboard.down("Control"); await pacedWait(page, 120);
  await page.mouse.wheel(0, -300); await pacedWait(page, 300); await page.keyboard.up("Control");
  const pw = await page.evaluate(() => window.__parentWheel.splice(0));
  pw.length && pw.every((e) => e.ctrl && !e.prevented) ? ok("Ctrl+wheel over the rest of the app: not cancelled by the Schedule — behaves as it does today")
    : fail(name, `Ctrl+wheel over the parent was touched or never arrived: ${JSON.stringify(pw)}`);
}

// ── THE KNOWN LIMIT, asserted so a change to it is seen ──────────────────────────────────────────────
{
  const name = "KNOWN LIMIT — a trackpad pinch (ctrl+wheel with NO key held) is NOT cancelled";
  line(`\n  ${name}`);
  await fresh({ view: "Gantt" });
  await page.mouse.move(...Object.values(await centre("[data-gantt-scroll]")));
  await wheelLog();
  await frame.evaluate(() => { const t = document.querySelector("[data-gantt-scroll]"); t.dispatchEvent(new WheelEvent("wheel", { deltaY: -5, ctrlKey: true, bubbles: true, cancelable: true })); });
  await pacedWait(page, 200);
  const ev = await wheelLog();
  ev.length && ev.every((e) => e.ctrl && !e.prevented) ? line("    · confirmed: the pinch reaches the frame un-cancelled (browser page zoom). Documented limit — see B2644624's NEW-1 follow-up.")
    : line(`    ! the pinch limit changed (${JSON.stringify(ev)}) — update the docs on the B2644624 follow-up`);
}

line("");
if (failures.length) { line(`FAIL — ${failures.length} defect(s):`); failures.forEach((f) => line("  - " + f)); await close(); process.exit(1); }
line("PASS — Ctrl/Cmd+wheel zooms the Gantt / Grid and the browser page never gets the event, wherever keyboard focus is in the page.");
await close();
