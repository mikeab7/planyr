/* NEW-1 / B2465520 — the "a cell's popover stays attached to its cell" scenarios, shared by the local harness
 * (verify-schedule-anchored-popovers.mjs, iframe-hosted page + a known-bad arm on the pre-fix page) and the signed-in live
 * one (verify-schedule-anchored-popovers-live.mjs), so both press the same REAL input against the same fixture.
 * REAL input only (page.mouse.wheel / clicks); geometry is read after real animation frames (FOREGROUND-OR-VOID).
 * `boot(w, h, view)` -> { ctx, page, frame } where `frame` answers `.evaluate` for the schedule page (a Frame when the
 * page is iframe-hosted, the Page itself otherwise); `headerH` is the offset of the schedule page inside `page`. */
import { pacedWait } from "./tabTiming.mjs";

// ── in-frame helpers (serialised into the page) ───────────────────────────────────────────────────────────────
export const IN = {
  // two REAL frames — a scroll lands, then the popover's own per-frame loop has had its turn
  settle: () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))),
  // the open popup = the last fixed-position child of <body> that is not a full-window click-away backdrop
  popup: (needle) => {
    const c = [...document.body.children].filter(e => getComputedStyle(e).position === "fixed" && (!needle || e.textContent.includes(needle)) && e.getBoundingClientRect().width < innerWidth * 0.9 && e.getBoundingClientRect().width > 0);
    const e = c[c.length - 1]; if (!e) return null; const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  },
};

export function makeScenarios({ boot, rec, headerH = 0, needle = "Project Kick Off" }) {
  const HEADER_H = headerH, TOL = 1.5, NEEDLE = needle;
  const near = (a, b) => Math.abs(a - b) <= TOL;
  const settle = (f) => f.evaluate(IN.settle);
  // a REAL wheel over a spot of the grid that is not under the popup
  async function wheel(page, frame, dy, dx = 0) {
    const sc = await frame.evaluate(() => { const r = document.querySelector("[data-grid-scroll]").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const pop = await frame.evaluate(IN.popup);
    let x = sc.x + 160, y = sc.y + sc.h - 40;                      // the pinned id/name area, near the bottom edge
    if (pop && x >= pop.left - 8 && x <= pop.right + 8 && y >= pop.top - 8 && y <= pop.bottom + 8) y = sc.y + 70;
    await page.mouse.move(x, y + HEADER_H);
    const before = await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); return [s.scrollTop, s.scrollLeft]; });
    await page.mouse.wheel(dx, dy);
    for (let i = 0; i < 40; i++) {                                 // wait for the wheel's scroll (possibly smoothed) to land
      await pacedWait(page, 40);
      const now = await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); return [s.scrollTop, s.scrollLeft]; });
      if ((now[0] !== before[0] || now[1] !== before[1]) && i > 2) { const again = await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); return [s.scrollTop, s.scrollLeft]; }); if (again[0] === now[0] && again[1] === now[1]) break; }
    }
    await settle(frame);
  }
  // scroll the grid by `d` VIEWPORT px — the grid is CSS-zoomed (gridZoom), so scrollTop units are not viewport px
  const scrollByView = async (frame, d) => { await frame.evaluate(dd => { const s = document.querySelector("[data-grid-scroll]"); const z = s.getBoundingClientRect().height / s.offsetHeight || 1; s.scrollTop += dd / z; }, d); await settle(frame); };
  const setScroll = async (frame, top, left) => { await frame.evaluate(([t, l]) => { const s = document.querySelector("[data-grid-scroll]"); if (t != null) s.scrollTop = t; if (l != null) s.scrollLeft = l; }, [top, left]); await settle(frame); };
  
  
  // A cell popover (traffic-light dot / Status text / Owner): follows the cell, then closes when the cell leaves the view.
  async function cellScenario(tag, { view, anchorSel, open, expectGap, name, anchorIdx, probeClosest }) {
    const { ctx, page, frame } = await boot(1400, 800, view);
    const ov = await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); return { v: s.scrollHeight > s.clientHeight + 200, h: s.scrollWidth > s.clientWidth + 50 }; });
    rec(tag, "VACUITY: the grid really overflows vertically", ov.v);
    const IDX = 6; let AI = anchorIdx ?? IDX;
    await open(page, frame, IDX);
    await settle(frame);
    await frame.evaluate(([s, i, c]) => { const e = document.querySelectorAll(s)[i]; (c ? e.closest(c) : e).setAttribute("data-anchor-probe", "1"); }, [anchorSel, AI, probeClosest || null]);
    anchorSel = "[data-anchor-probe]"; AI = 0;
    let pop = await frame.evaluate(IN.popup);
    rec(tag, `${name} popup opened`, !!pop);
    if (!pop) { await ctx.close(); return; }
    let a = await frame.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, h: r.height }; }, [anchorSel, AI]);
    rec(tag, `${name} popup starts just under its cell`, near(pop.top - a.bottom, expectGap) || (expectGap == null && pop.top >= a.bottom - 1), `gap=${(pop.top - a.bottom).toFixed(1)}`);
    // 1 · a real wheel scroll moves the rows; the popup must move with its row
    const gap0 = pop.top - a.bottom, left0 = pop.left - a.left;
    const sBefore = await frame.evaluate(() => document.querySelector("[data-grid-scroll]").scrollTop);
    await wheel(page, frame, 90);
    const sAfter = await frame.evaluate(() => document.querySelector("[data-grid-scroll]").scrollTop);
    rec(tag, "VACUITY: the wheel really scrolled the grid", sAfter > sBefore + 20, `scrollTop ${sBefore}→${sAfter}`);
    pop = await frame.evaluate(IN.popup);
    a = await frame.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; const r = e && e.getBoundingClientRect(); return r && { top: r.top, bottom: r.bottom, left: r.left }; }, [anchorSel, AI]);
    rec(tag, `${name} popup STAYS glued to its cell after the wheel scroll`, !!pop && !!a && near(pop.top - a.bottom, gap0) && near(pop.left - a.left, left0),
      pop && a ? `gapΔ=${(pop.top - a.bottom - gap0).toFixed(1)} leftΔ=${(pop.left - a.left - left0).toFixed(1)}` : `popup=${!!pop} cell=${!!a}`);
    // 2 · the cell scrolls out of the grid's top edge but its row is STILL MOUNTED (the virtualiser keeps a buffer) ->
    //     closed. (A far-off scroll would unmount the row and kill the popup for the wrong reason, on main too.)
    const dOut = await frame.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i].getBoundingClientRect(); return e.bottom - document.querySelector("[data-grid-scroll]").getBoundingClientRect().top + 30; }, [anchorSel, AI]);
    await scrollByView(frame, dOut);
    const still = await frame.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; if (!e) return null; const r = e.getBoundingClientRect(); return r.bottom < document.querySelector("[data-grid-scroll]").getBoundingClientRect().top; }, [anchorSel, AI]);
    rec(tag, "VACUITY: the cell is still mounted and now sits above the grid's top edge", still === true, String(still));
    pop = await frame.evaluate(IN.popup);
    rec(tag, `${name} popup CLOSES once its cell has scrolled out of the grid`, !pop);
    await ctx.close();
  }
  
  // the cell goes UNDER the sticky header (still inside the scroller's box) -> closed, never drawn over the header
  async function underHeaderScenario(tag, { anchorSel, open, name, anchorIdx, probeClosest }) {
    const { ctx, page, frame } = await boot(1400, 800, "Grid");
    const IDX = 6; let AI = anchorIdx ?? IDX;
    await open(page, frame, IDX); await settle(frame);
    await frame.evaluate(([s, i, c]) => { const e = document.querySelectorAll(s)[i]; (c ? e.closest(c) : e).setAttribute("data-anchor-probe", "1"); }, [anchorSel, AI, probeClosest || null]);
    anchorSel = "[data-anchor-probe]"; AI = 0;
    rec(tag, `${name} popup opened (header test)`, !!(await frame.evaluate(IN.popup)));
    const d = await frame.evaluate(([s, i]) => { const el = document.querySelectorAll(s)[i]; if (!el) return null; const e = el.getBoundingClientRect(); const hb = document.querySelector("[data-hdr-col]").parentElement.getBoundingClientRect().bottom; return e.bottom - hb + 2; }, [anchorSel, AI]);
    if (d == null) { rec(tag, "VACUITY: the anchor is still mounted after the popup opened (a re-mounted cell would drop its popup for the wrong reason)", false); await ctx.close(); return; }
    await scrollByView(frame, d);
    const st = await frame.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; const r = e && e.getBoundingClientRect(); const hb = document.querySelector("[data-hdr-col]").parentElement.getBoundingClientRect().bottom; return r ? { under: r.bottom <= hb, inScroller: r.bottom > document.querySelector("[data-grid-scroll]").getBoundingClientRect().top } : null; }, [anchorSel, AI]);
    rec(tag, "VACUITY: the cell is now fully under the sticky header yet still inside the scroller", !!st && st.under && st.inScroller);
    rec(tag, `${name} popup CLOSES when its cell goes under the sticky header`, !(await frame.evaluate(IN.popup)));
    await ctx.close();
  }
  
  const openHealth = async (page, frame, i) => { await frame.evaluate(idx => document.querySelectorAll("[data-health-dot]")[idx].click(), i); };
  const openStatus = async (page, frame, i) => { await frame.evaluate(idx => document.querySelectorAll('[data-col-key="status"] span[style*="cursor: pointer"]')[idx].click(), i); };
  // Owner: select the cell and press Enter (the grid's own edit gesture) via a real click + key
  const openOwner = async (page, frame, i) => {
    const r = await frame.evaluate(idx => { const e = document.querySelectorAll('[data-col-key="responsibleParty"]')[idx]; e.scrollIntoView?.({ block: "nearest" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, i);
    await page.mouse.dblclick(r.x, r.y + HEADER_H);
    await pacedWait(page, 250);
  };
  
  // header-cell menus follow SIDEWAYS scroll (the header row scrolls with the columns); pinned columns hide cells
  async function hdrMenuScenario(tag) {
    const { ctx, page, frame } = await boot(900, 760, "Grid");
    const ov = await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); return s.scrollWidth - s.clientWidth; });
    rec(tag, "VACUITY: the grid really overflows sideways at this width", ov > 80, `${ov}px`);
    await setScroll(frame, null, await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); const h = document.querySelector('[data-hdr-col="status"]').getBoundingClientRect(); return s.scrollLeft + h.left - 480; }));
    await frame.evaluate(() => { const h = document.querySelector('[data-hdr-col="status"]'); h.querySelector("span").click(); });
    await settle(frame);
    let pop = await frame.evaluate(IN.popup);
    rec(tag, "Status header menu opened", !!pop);
    const hdr = () => frame.evaluate(() => { const r = document.querySelector('[data-hdr-col="status"]').getBoundingClientRect(); return { left: r.left, bottom: r.bottom }; });
    let h0 = await hdr(); const l0 = pop && pop.left - h0.left, t0 = pop && pop.top - h0.bottom;
    await setScroll(frame, null, await frame.evaluate(() => document.querySelector("[data-grid-scroll]").scrollLeft + 120));
    pop = await frame.evaluate(IN.popup); const h1 = await hdr();
    rec(tag, "Status header menu STAYS glued to its header cell after a sideways scroll", !!pop && near(pop.left - h1.left, l0) && near(pop.top - h1.bottom, t0), pop ? `leftΔ=${(pop.left - h1.left - l0).toFixed(1)} (header moved ${(h1.left - h0.left).toFixed(0)})` : "popup gone");
    rec(tag, "VACUITY: the header cell really moved sideways", Math.abs(h1.left - h0.left) > 50);
    await ctx.close();
  }
  // the "+N" predecessor list (hover popover) follows its cell too. The sample has no cell with 3+ links, so make one
  // through the grid's own editor (a real double-click + typing + Enter), then hover it.
  async function depHoverScenario(tag) {
    const { ctx, page, frame } = await boot(1400, 800, "Grid");
    await setScroll(frame, null, await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); const h = document.querySelector('[data-hdr-col="predecessors"]').getBoundingClientRect(); return s.scrollLeft + h.left - 400; }));
    const cell = await frame.evaluate(() => { const cs = [...document.querySelectorAll('[data-col-key="predecessors"]')]; const ids = [...document.querySelectorAll('[data-col-key="id"]')].map(e => parseInt(e.textContent, 10)); const i = ids.findIndex((n, k) => n >= 8 && cs[k]); const b = cs[i].getBoundingClientRect(); cs[i].setAttribute("data-anchor-probe", "1"); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.dblclick(cell.x, cell.y + HEADER_H); await pacedWait(page, 250);
    await page.keyboard.press("Control+A"); await page.keyboard.type("1,2,3,4"); await page.keyboard.press("Enter"); await pacedWait(page, 400);
    const has = await frame.evaluate(() => { const e = document.querySelector('[data-anchor-probe] [data-dep-lines]'); return !!e && /\+\d/.test(e.textContent); });
    rec(tag, "VACUITY: the cell really shows a '+N' overflow of links", has);
    if (!has) { await ctx.close(); return; }
    const r = await frame.evaluate(() => { const b = document.querySelector('[data-anchor-probe] [data-dep-lines]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.move(r.x - 3, r.y + HEADER_H); await page.mouse.move(r.x, r.y + HEADER_H); await pacedWait(page, 250); await settle(frame);
    let pop = await frame.evaluate(IN.popup, NEEDLE);
    rec(tag, "'+N' list popup opened on hover", !!pop);
    if (!pop) { await ctx.close(); return; }
    const rect = () => frame.evaluate(() => { const b = document.querySelector('[data-anchor-probe] [data-dep-lines]').getBoundingClientRect(); return { bottom: b.bottom, left: b.left }; });
    const a0 = await rect(); const g0 = pop.top - a0.bottom;
    // scroll the grid with the page's own wheel handler path but WITHOUT moving the mouse off the cell (hover stays armed)
    await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); s.scrollTop += 52; });
    await settle(frame);
    pop = await frame.evaluate(IN.popup, NEEDLE); const a1 = await rect();
    // A hover popover is dismissed by the pointer leaving as often as by the hook, so "gone" is as good as "glued";
    // what is never acceptable is a popup left STRANDED where its cell used to be. (Not red on main: pointer-leave hides it
    // there too — which is why this one is an invariant check and is not part of the known-bad arm.)
    rec(tag, "'+N' list popup is never left STRANDED after a scroll (glued to its cell, or gone)", !pop || (near(pop.top - a1.bottom, g0) && near(pop.left - a1.left, 0)), pop ? `gapΔ=${(pop.top - a1.bottom - g0).toFixed(1)}` : "gone");
    await ctx.close();
  }
  async function pinnedScenario(tag) {
    const { ctx, page, frame } = await boot(700, 760, "Grid");   // narrow enough that there is room to slide the Health column under the pinned ones
    await setScroll(frame, null, await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); const d = document.querySelectorAll("[data-health-dot]")[6].getBoundingClientRect(); return s.scrollLeft + d.right - (s.getBoundingClientRect().right - 40); }));   // just inside the right edge: leaves the most room to scroll it leftwards
    await openHealth(page, frame, 6); await settle(frame);
    rec(tag, "Health dot popup opened (pinned test)", !!(await frame.evaluate(IN.popup)));
    // scroll sideways until the Health column sits fully UNDER the pinned id/name columns
    const need = await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); const dot = document.querySelectorAll("[data-health-dot]")[6].getBoundingClientRect(); const pin = [...document.querySelectorAll("[data-hdr-col]")].filter(h => getComputedStyle(h).position === "sticky").reduce((m, h) => Math.max(m, h.getBoundingClientRect().right), 0); return { shift: dot.right - pin + 4, max: s.scrollWidth - s.clientWidth - s.scrollLeft, pin }; });
    rec(tag, "VACUITY: the grid has pinned columns and room to scroll the dot under them", need.pin > 0 && need.shift <= need.max, JSON.stringify(need));
    await setScroll(frame, null, await frame.evaluate(d => document.querySelector("[data-grid-scroll]").scrollLeft + d, need.shift));
    const hid = await frame.evaluate(() => { const dot = document.querySelectorAll("[data-health-dot]")[6].getBoundingClientRect(); const pin = [...document.querySelectorAll("[data-hdr-col]")].filter(h => getComputedStyle(h).position === "sticky").reduce((m, h) => Math.max(m, h.getBoundingClientRect().right), 0); return { ok: dot.right <= pin, dotRight: Math.round(dot.right), dotLeft: Math.round(dot.left), pin: Math.round(pin), sl: document.querySelector("[data-grid-scroll]").scrollLeft }; });
    rec(tag, "VACUITY: the dot is now fully behind the pinned columns", hid.ok, JSON.stringify(hid));
    rec(tag, "Health dot popup CLOSES when its cell goes under a pinned column", !(await frame.evaluate(IN.popup)));
    await ctx.close();
  }
  // a window resize re-lays the grid out; the popup follows the cell to its new place
  async function resizeScenario(tag) {
    const { ctx, page, frame } = await boot(1400, 800, "Grid");
    await setScroll(frame, null, await frame.evaluate(() => { const s = document.querySelector("[data-grid-scroll]"); const d = document.querySelectorAll("[data-health-dot]")[6].getBoundingClientRect(); return s.scrollLeft + d.left - 330; }));
    await openHealth(page, frame, 6); await settle(frame);
    rec(tag, "Health dot popup opened (resize test)", !!(await frame.evaluate(IN.popup)));
    await page.setViewportSize({ width: 1250, height: 640 });
    await pacedWait(page, 500); await settle(frame);
    const pop1 = await frame.evaluate(IN.popup);
    const a1 = await frame.evaluate(() => { const r = document.querySelectorAll("[data-health-dot]")[6]?.getBoundingClientRect(); return r && { bottom: r.bottom, left: r.left, w: r.width }; });
    rec(tag, "Health dot popup still glued to its cell after the window is resized", !!pop1 && !!a1 && near(pop1.top - a1.bottom, 4) && near(pop1.left - (a1.left + a1.w / 2 - 10), 0), pop1 && a1 ? `gap=${(pop1.top - a1.bottom).toFixed(1)}` : "popup gone or cell gone");
    await ctx.close();
  }
  // right-click menu: closes on scroll (conventional) rather than stranding
  async function ctxScenario(tag) {
    const { ctx, page, frame } = await boot(1400, 800, "Grid");
    const r = await frame.evaluate(() => { const b = document.querySelectorAll('[data-col-key="name"]')[6].getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; });
    await page.mouse.click(r.x, r.y + HEADER_H, { button: "right" }); await pacedWait(page, 250);
    rec(tag, "row right-click menu opened", !!(await frame.evaluate(IN.popup)));
    await wheel(page, frame, 90);
    rec(tag, "row right-click menu CLOSES on scroll instead of stranding", !(await frame.evaluate(IN.popup)));
    await ctx.close();
  }
  // Gantt has no cell pickers at all
  async function ganttScenario(tag) {
    const { ctx, frame } = await boot(1400, 800, "Gantt");
    const n = await frame.evaluate(() => document.querySelectorAll("[data-health-dot]").length);
    rec(tag, "Gantt view carries no cell popovers to anchor (no health dots / pickers)", n === 0, `dots=${n}`);
    await ctx.close();
  }
  
  
  const all = { cellScenario, underHeaderScenario, hdrMenuScenario, depHoverScenario, pinnedScenario, resizeScenario, ctxScenario, ganttScenario, openHealth, openStatus, openOwner };
  /** The scenarios that must hold on ANY schedule page (the full list a signed-in run repeats on a real deploy). */
  all.runAll = async () => {
    await cellScenario("health", { view: "Grid", anchorSel: "[data-health-dot]", open: openHealth, expectGap: 4, name: "Health dot" });
    await cellScenario("status", { view: "Grid", anchorSel: '[data-col-key="status"] span[style*="cursor: pointer"]', open: openStatus, expectGap: 4, name: "Status" });
    await cellScenario("owner", { view: "Grid", anchorSel: '[data-col-key="responsibleParty"] input', open: openOwner, expectGap: null, name: "Owner", anchorIdx: 0, probeClosest: "[data-col-key]" });
    await cellScenario("split", { view: "Split", anchorSel: "[data-health-dot]", open: openHealth, expectGap: 4, name: "Health dot (Split)" });
    await underHeaderScenario("health-hdr", { anchorSel: "[data-health-dot]", open: openHealth, name: "Health dot" });
    await underHeaderScenario("owner-hdr", { anchorSel: '[data-col-key="responsibleParty"] input', open: openOwner, name: "Owner", anchorIdx: 0, probeClosest: "[data-col-key]" });
    await hdrMenuScenario("hdr-menu");
    await depHoverScenario("dep-hover");
    await pinnedScenario("pinned");
    await resizeScenario("resize");
    await ctxScenario("ctx");
    await ganttScenario("gantt");
  };
  return all;
}
