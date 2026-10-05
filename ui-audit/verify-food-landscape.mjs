#!/usr/bin/env node
/* verify-food-landscape — B2046224 (×4): Food on a phone held SIDEWAYS. Owner: picking a restaurant opened the
 * bottom card, which covered most of the map, so the picked pin was hidden behind the "Search live for more
 * here" chip. Approved fix: in landscape the place card docks to the RIGHT as a panel, the header collapses to
 * one row, the pin is centred in the map BESIDE the card, the chip is centred there too, and so on.
 *
 * ⛔ THE CHECKS ARE BEHAVIOURAL, NOT "does the new component exist". Every row asks what a person sees (is the
 * pin drawn, uncovered, centred in the part of the map the panel leaves; is the chip clear of it; does the card
 * scroll by itself with "Log a visit" still on screen), whichever panel is the one covering the map — so the
 * SAME script is RED on main (bottom sheet over the pin) and GREEN on the fix. Run it against both:
 *     node ui-audit/verify-food-landscape.mjs http://localhost:4180   # main  → red
 *     node ui-audit/verify-food-landscape.mjs http://localhost:4181   # fix   → green
 * KNOWN-ANSWER ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): before trusting a verdict the covered-pin detector is
 * pointed at a pin we deliberately cover and must say "covered"; the injected safe-area insets must read back
 * non-zero; the card must really overflow before "it scrolls" is scored. Any arm failing makes the run VOID.
 *
 * Engines, labelled (docs/PHONE-TESTING.md): WebKit (Playwright iPhone 15 / iPhone SE descriptors, landscape and
 * portrait) for layout. WebKit cannot inject env(safe-area-inset-*) (0 there), so BOTH ROTATIONS of the notch are
 * driven on Chromium with an injected inset (left notch / right notch + home bar) — emulated, never "on device".
 * The iOS keyboard is a model (visualViewport shrinks), not a real keyboard. What only a phone shows: V1521600.
 *
 * Usage: build with the fixture env (ui-audit/lib/foodFixture.mjs), serve it, then
 *   node ui-audit/verify-food-landscape.mjs [baseUrl] [--shots=<dir>] [--only=<regex>]
 */
import { webkit, chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openFood, readSafeAreas } from "./lib/foodPhoneKit.mjs";

const BASE = process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "http://localhost:4181";
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const ABURI = { lat: 29.7392, lon: -95.4151, key: "place:fx-aburi", name: "Aburi Sushi" };
const FADIS = { lat: 29.68, lon: -95.46, key: "place:fx-fadis", name: "Fadi's Mediterranean Grill" };
const PHONES = {
  "iPhone 15": { portrait: "iPhone 15", landscape: "iPhone 15 landscape", kbPortrait: 380, kbLandscape: 240 },
  "iPhone SE": { portrait: "iPhone SE", landscape: "iPhone SE landscape", kbPortrait: 304, kbLandscape: 200 },
};
// iPhone landscape insets: the notch side is ~59 on the notch phones, the home bar ~21; SE has none. Both rotations.
const ROTATIONS = { "notch-left": { top: 0, left: 59, bottom: 21, right: 0 }, "notch-right": { top: 0, left: 0, bottom: 21, right: 59 } };
// The SE has NO notch (home button), so a real SE reads all zeros — covered by its WebKit run. Its Chromium runs inject a
// small stress inset (20) purely to exercise the padding code on the narrowest screen; 59 on a 568-wide SE is not a real device.
const rotationsFor = (phoneName) => (phoneName === "iPhone SE" ? { "notch-left": { top: 0, left: 20, bottom: 0, right: 0 }, "notch-right": { top: 0, left: 0, bottom: 0, right: 20 } } : ROTATIONS);

// ── the one probe: everything a person could see, in viewport coordinates ───────────────────────────────
const probe = (page, sel) => page.evaluate(({ sel: sel0 }) => {
  let sel = sel0;
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const vw = innerWidth, vh = document.documentElement.clientHeight;
  const hostEl = document.querySelector('[data-testid="food-map"]');
  const host = R(hostEl);
  const map = window.__foodMap;
  const side = document.querySelector('[data-testid="food-visit-panel"]');
  const sheet = document.querySelector('[data-testid="food-bottom-sheet"]');
  const panelEl = side || sheet;
  const panel = R(panelEl);
  const kind = side ? (side.dataset.layout === "side" ? "side" : "rail") : sheet ? "sheet" : null;
  let pin = null;
  const live = hostEl?.dataset.selectedLat ? { lat: +hostEl.dataset.selectedLat, lon: +hostEl.dataset.selectedLon } : null;
  if (!sel && live) sel = live; // a live (non-fixture) place: the app reports where its selected pin is
  if (map && host && sel) { const p = map.latLngToContainerPoint([sel.lat, sel.lon]); pin = { x: host.left + p.x, y: host.top + p.y }; }
  const ins = (() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)"; document.body.appendChild(d); const c = getComputedStyle(d); const o = { top: parseFloat(c.paddingTop), right: parseFloat(c.paddingRight), bottom: parseFloat(c.paddingBottom), left: parseFloat(c.paddingLeft) }; d.remove(); return o; })();
  // what the panel leaves visible of the map: left of a side card, above a sheet; minus the notch
  let box = null;
  if (host) {
    box = { left: host.left + ins.left, top: host.top, right: host.right - (kind === "side" || kind === "rail" ? Math.max(0, host.right - panel.left) : ins.right), bottom: kind === "sheet" ? panel.top : host.bottom };
    box.cx = (box.left + box.right) / 2; box.cy = (box.top + box.bottom) / 2; box.w = box.right - box.left; box.h = box.bottom - box.top;
  }
  const chipEl = document.querySelector('[data-testid="food-search-here"]');
  const chipStyle = chipEl ? getComputedStyle(chipEl) : null;
  const chip = R(chipEl);
  const mapStack = chipEl?.parentElement; const stackHidden = mapStack ? getComputedStyle(mapStack).visibility === "hidden" : false;
  // every other thing drawn on the map that the pin must not sit under
  const ctrls = [];
  const add = (name, el) => { const r = R(el); if (r && r.width && r.height && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none") ctrls.push({ name, ...r }); };
  document.querySelectorAll(".leaflet-control").forEach((el, i) => add(`leaflet-control#${i}`, el));
  add("basemap-toggle", document.querySelector('[data-testid="food-basemap-toggle"]')?.parentElement);
  add("attribution-toggle", document.querySelector('[data-testid="food-attribution-toggle"]'));
  add("attribution-text", document.querySelector('[data-testid="food-attribution-text"]'));
  add("help-fab", document.querySelector('[data-testid="help-report-fab"]'));
  add("zoomed-out-notice", document.querySelector('[data-testid="food-zoomed-out-notice"]'));
  add("capped-notice", document.querySelector('[data-testid="food-capped-notice"]'));
  // is the pin DRAWN and UNCOVERED: its centre and a ring around it answer to the map itself
  let covered = [];
  if (pin) {
    const pts = [[0, 0]]; for (let a = 0; a < 8; a++) pts.push([Math.cos(a * Math.PI / 4) * 16, Math.sin(a * Math.PI / 4) * 16]);
    for (const [dx, dy] of pts) {
      const x = pin.x + dx, y = pin.y + dy;
      if (x < 0 || y < 0 || x >= vw || y >= vh) { covered.push(`off-screen@${Math.round(x)},${Math.round(y)}`); continue; }
      const t = document.elementFromPoint(x, y);
      if (!t || !hostEl.contains(t)) covered.push(`${t?.dataset?.testid || t?.tagName}@${Math.round(x)},${Math.round(y)}`);
    }
  }
  const header = document.querySelector("header");
  const hr = R(header);
  const headerButtons = header ? [...header.querySelectorAll("button, input, select, a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height; }).map((e) => ({ name: e.dataset.testid || e.getAttribute("aria-label") || e.tagName, ...R(e) })) : [];
  const rows = header ? [...header.querySelectorAll(":scope > div")] : [];
  const scrollers = header ? [...header.querySelectorAll("div")].filter((d) => d.scrollWidth > d.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(d).overflowX)).map((d) => `${d.scrollWidth}>${d.clientWidth}`) : [];
  const sc = document.querySelector('[data-testid="food-side-scroll"]');
  const actions = document.querySelector('[data-testid="food-actions-row"]');
  const logBtn = actions?.querySelector("button");
  const help = document.querySelector('[data-testid="help-report-fab"]');
  return {
    vw, vh, host, panel, kind, pin, box, chip, chipVisible: !!chipEl && !stackHidden, chipWidthOk: chipEl ? chipEl.scrollWidth <= chipEl.clientWidth + 1 : null, ctrls, covered, header: hr, headerButtons, headerScrollers: scrollers,
    headerHasInlineToolbar: !!document.querySelector("[data-header-toolbar-inline]"), rowsCount: rows.length,
    selectedPin: hostEl?.dataset.selectedPin ?? null,
    title: document.querySelector('[data-testid="food-visit-panel"] [data-testid="food-panel-accent-dot"], [data-testid="food-bottom-sheet"] [data-testid="food-panel-accent-dot"]')?.nextElementSibling?.textContent ?? null,
    side: sc ? { scroll: R(sc), scrollTop: sc.scrollTop, scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth, hidden: [...sc.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > sc.getBoundingClientRect().right + 0.5; }).slice(0, 4).map((e) => e.dataset.testid || e.tagName) } : null,
    actions: R(actions), logBtn: R(logBtn),
    logOnTop: logBtn ? (() => { const r = logBtn.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === logBtn || logBtn.contains(t); })() : null,
    help: R(help), ins, pageScroll: document.scrollingElement.scrollTop + document.body.scrollTop, center: map ? [map.getCenter().lat, map.getCenter().lng] : null,
    docW: document.documentElement.scrollWidth,
  };
}, { sel });

const inter = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const searchBox = (page) => page.locator('input[aria-label="Search restaurants"]').first();
async function pick(page, q, re) {
  await searchBox(page).tap();
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.type(q, { delay: 15 });
  await page.waitForTimeout(800);
  await page.locator('[data-testid="food-search-results"] button').filter({ hasText: re }).first().tap();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForSelector('[data-testid="food-bottom-sheet"], [data-testid="food-visit-panel"]');
  await page.waitForTimeout(2200); // flight + settle window
}
const shot = async (page, name) => {
  if (!SHOTS) return;
  // draw the keyboard where the model puts it, so a picture of a typing state shows what the phone would
  await page.evaluate(() => { const px = window.__kb?.px || 0; let k = document.getElementById("__kbdraw"); if (!k) { k = document.createElement("div"); k.id = "__kbdraw"; document.documentElement.appendChild(k); } k.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${px}px;z-index:2147483647;pointer-events:none;background:#d0d3d9;display:${px ? "block" : "none"}`; });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.evaluate(() => { const k = document.getElementById("__kbdraw"); if (k) k.style.display = "none"; });
};

// ── assertions on one probe ───────────────────────────────────────────────────────────────────────────
function scorePicked(tag, p, sel, { landscape }) {
  const t = (s) => `${tag} — ${s}`;
  check(t("pin drawn in the SELECTED style"), p.selectedPin === sel.key, String(p.selectedPin));
  check(t("pin is never under the card, a chip or a control"), p.pin && p.covered.length === 0 && !p.ctrls.some((c) => inter({ left: p.pin.x - 12, right: p.pin.x + 12, top: p.pin.y - 12, bottom: p.pin.y + 12 }, c)) && !(p.chipVisible && inter({ left: p.pin.x - 12, right: p.pin.x + 12, top: p.pin.y - 12, bottom: p.pin.y + 12 }, p.chip)),
    p.covered.length ? `covered at ${p.covered.slice(0, 3).join(" ")}` : `ctrls over pin: ${p.ctrls.filter((c) => p.pin && inter({ left: p.pin.x - 12, right: p.pin.x + 12, top: p.pin.y - 12, bottom: p.pin.y + 12 }, c)).map((c) => c.name).join(",") || "none"}; chip over pin: ${p.chipVisible && p.pin ? inter({ left: p.pin.x - 12, right: p.pin.x + 12, top: p.pin.y - 12, bottom: p.pin.y + 12 }, p.chip) : false}`);
  if (p.pin && p.box) {
    const tolX = Math.max(14, p.box.w * 0.12), tolY = Math.max(14, p.box.h * 0.12);
    check(t("pin centred in the visible map (not under the card)"), Math.abs(p.pin.x - p.box.cx) <= tolX && Math.abs(p.pin.y - p.box.cy) <= tolY,
      `pin ${Math.round(p.pin.x)},${Math.round(p.pin.y)} vs visible centre ${Math.round(p.box.cx)},${Math.round(p.box.cy)} (visible ${Math.round(p.box.w)}×${Math.round(p.box.h)})`);
  }
  if (p.chipVisible && p.chip && p.box) {
    check(t("'Search live' chip fully on screen and not over the card"), p.chip.left >= 0 && p.chip.right <= p.vw && p.chip.top >= 0 && p.chip.bottom <= p.vh && !(p.panel && inter(p.chip, p.panel)), `chip ${Math.round(p.chip.left)}–${Math.round(p.chip.right)} × ${Math.round(p.chip.top)}–${Math.round(p.chip.bottom)}`);
    check(t("chip text is not cut off"), p.chipWidthOk === true, `scrollWidth>clientWidth: ${p.chipWidthOk === false}`);
    if (landscape) check(t("chip centred in the visible map"), Math.abs((p.chip.left + p.chip.right) / 2 - p.box.cx) <= 8, `chip centre ${Math.round((p.chip.left + p.chip.right) / 2)} vs visible centre ${Math.round(p.box.cx)}`);
    check(t("chip clear of the pin"), !p.pin || !inter({ left: p.pin.x - 18, right: p.pin.x + 18, top: p.pin.y - 18, bottom: p.pin.y + 18 }, p.chip), "");
    check(t("chip not over any map control"), !p.ctrls.some((c) => inter(p.chip, c)), p.ctrls.filter((c) => inter(p.chip, c)).map((c) => c.name).join(","));
  } else if (!p.chipVisible) check(t("chip hidden (no room) — acceptable only if the pin is clear"), p.covered.length === 0, "");
  if (landscape && p.box) check(t("the map keeps real room (visible part ≥ 40% of the screen)"), (p.box.w * p.box.h) / (p.vw * p.vh) >= 0.4, `visible ${Math.round(p.box.w)}×${Math.round(p.box.h)} of ${p.vw}×${p.vh} = ${Math.round(100 * p.box.w * p.box.h / (p.vw * p.vh))}%`);
  const under = p.panel ? p.ctrls.filter((c) => c.name !== "help-fab" && inter(c, p.panel)) : [];
  check(t("no map control is cut off or hidden under the card"), under.length === 0, under.map((c) => c.name).join(","));
  check(t("no page scrollbar sideways"), p.docW <= p.vw + 1, `${p.docW} vs ${p.vw}`);
}
function scoreHeader(tag, p) {
  const t = (s) => `${tag} — ${s}`;
  check(t("header collapsed to ONE compact row"), p.headerHasInlineToolbar && p.header.height <= 48, `header ${Math.round(p.header.height)} tall, inline toolbar ${p.headerHasInlineToolbar}`);
  const cut = p.headerButtons.filter((b) => b.left < p.ins.left - 0.5 || b.right > p.vw - p.ins.right + 0.5 || b.top < p.header.top - 0.5 || b.bottom > p.header.bottom + 0.5);
  check(t("nothing in the header cut off or under the notch"), cut.length === 0 && p.headerScrollers.length === 0, cut.length ? cut.map((b) => `${b.name}@${Math.round(b.left)}–${Math.round(b.right)}`).join(", ") : p.headerScrollers.length ? "row scrolls sideways: " + p.headerScrollers.join(",") : "");
}

// ── case runner ─────────────────────────────────────────────────────────────────────────────────────
const wants = (n) => !ONLY || new RegExp(ONLY).test(n);
async function landscapeFlow({ engine, browser, phoneName, label, insets }) {
  const ph = PHONES[phoneName];
  const tag = `[${engine} · ${phoneName} landscape${label ? " · " + label : ""}]`;
  const slug = `${engine}-${phoneName.replace(/\s+/g, "")}-landscape${label ? "-" + label : ""}`;
  const { ctx, page, errs } = await openFood(browser, devices[ph.landscape], { base: BASE, harness: `verify-food-landscape:${tag}`, kbPortrait: ph.kbPortrait, kbLandscape: ph.kbLandscape, insets });
  await assertMeasurable(page, "verify-food-landscape"); // landscape-flow — FOREGROUND-OR-VOID: visible tab + live rAF before anything is scored
  try {
    if (insets) { const r = await readSafeAreas(page); check(`${tag} — KNOWN ANSWER: injected safe-area insets read back`, r.left === insets.left && r.right === insets.right && r.bottom === insets.bottom, JSON.stringify(r)); }
    // 1. pick
    await pick(page, "aburi", /aburi/i);
    let p = await probe(page, ABURI);
    await shot(page, `${slug}-1-picked`);
    scorePicked(tag, p, ABURI, { landscape: true });
    scoreHeader(tag, p);
    check(`${tag} — card docks to the RIGHT (side panel, not a bottom sheet)`, p.kind === "side" && p.panel && p.panel.right >= p.vw - 1 && p.panel.top <= (p.host?.top ?? 0) + 1 && p.panel.bottom >= p.vh - 1, `panel kind ${p.kind}${p.panel ? ` ${Math.round(p.panel.left)}–${Math.round(p.panel.right)} × ${Math.round(p.panel.top)}–${Math.round(p.panel.bottom)}` : ""}`);
    if (p.kind === "side") {
      check(`${tag} — the map keeps the left part (card is not wider than the share it was given)`, p.panel.width <= Math.max(p.vw * 0.5, 0) + p.ins.right + 1 && p.box.w >= 200, `card ${Math.round(p.panel.width)} of ${p.vw}; visible map ${Math.round(p.box.w)}`);
      if (insets) {
        check(`${tag} — SAFE AREA: card content stays out of the notch side`, p.side.scroll.right <= p.vw - p.ins.right + 0.5, `scroller right ${Math.round(p.side.scroll.right)} vs ${p.vw - p.ins.right}`);
        check(`${tag} — SAFE AREA: the card's bottom bar clears the home bar`, !p.actions || p.actions.bottom <= p.vh - p.ins.bottom + 0.5, `bar bottom ${p.actions && Math.round(p.actions.bottom)} vs ${p.vh - p.ins.bottom}`);
      }
      // 2. the card scrolls by itself; Log a visit stays at its bottom
      check(`${tag} — nothing in the card runs off its edge (no sideways overflow)`, p.side.scrollWidth <= p.side.clientWidth + 1 && p.side.hidden.length === 0, `scrollWidth ${p.side.scrollWidth} vs ${p.side.clientWidth}; wider than the card: ${p.side.hidden.join(",") || "none"}`);
      check(`${tag} — PRECONDITION: the card really overflows (else 'it scrolls' is not scored)`, p.side.scrollHeight > p.side.clientHeight + 4, `${p.side.scrollHeight} vs ${p.side.clientHeight}`);
      check(`${tag} — 'Log a visit' visible at the bottom of the card`, p.logBtn && p.logOnTop && p.logBtn.bottom <= p.side.scroll.bottom + 1 && p.logBtn.top >= p.side.scroll.top && Math.abs(p.actions.bottom - p.side.scroll.bottom) <= 3, p.logBtn ? `bar bottom ${Math.round(p.actions.bottom)} vs card bottom ${Math.round(p.side.scroll.bottom)}; on top ${p.logOnTop}` : "no Log a visit button");
      check(`${tag} — nothing (incl. the ? help button) covers 'Log a visit'`, !p.help || !inter(p.help, p.actions), p.help ? `help ${Math.round(p.help.left)}–${Math.round(p.help.right)} vs bar ${Math.round(p.actions.left)}–${Math.round(p.actions.right)}` : "help hidden");
      const cx = p.panel.left + p.panel.width / 2, cy = p.panel.top + p.panel.height / 2;
      // Mobile WebKit has no wheel/touch-drag primitive (docs/PHONE-TESTING.md #3): there the card's own scroller is
      // moved directly — it proves WHICH element scrolls and that nothing else moves, not a finger's momentum.
      if (engine === "chromium") { await page.mouse.move(cx, cy); await page.mouse.wheel(0, 400); }
      else await page.evaluate(() => { document.querySelector('[data-testid="food-side-scroll"]').scrollTop = 400; });
      await page.waitForTimeout(500);
      const q = await probe(page, ABURI);
      check(`${tag} — the card scrolls on its own; the page and the map stay put`, q.side.scrollTop > 0 && q.pageScroll === 0 && Math.abs(q.header.top - p.header.top) < 1 && Math.abs(q.pin.x - p.pin.x) < 1 && Math.abs(q.pin.y - p.pin.y) < 1, `scrollTop ${q.side.scrollTop}, page ${q.pageScroll}, pin moved ${Math.round(Math.hypot(q.pin.x - p.pin.x, q.pin.y - p.pin.y))}`);
      check(`${tag} — 'Log a visit' still pinned to the card bottom while scrolled`, q.logOnTop && Math.abs(q.actions.bottom - q.side.scroll.bottom) <= 3, `bar bottom ${Math.round(q.actions.bottom)} vs ${Math.round(q.side.scroll.bottom)}`);
      await page.evaluate(() => { const s = document.querySelector('[data-testid="food-side-scroll"]'); if (s) s.scrollTop = 0; });
    }
    // 3. pick another restaurant while the card is open: the pin follows
    await pick(page, "fadi", /fadi/i);
    p = await probe(page, FADIS);
    await shot(page, `${slug}-2-picked-second`);
    scorePicked(`${tag} (second pick)`, p, FADIS, { landscape: true });
    // 4. close: full width back, pin stays where it was
    const before = p.pin;
    await page.locator('[data-testid="food-panel-close"]').tap();
    await page.waitForTimeout(900);
    const c = await probe(page, FADIS);
    await shot(page, `${slug}-3-closed`);
    check(`${tag} — closing the card gives the map the full width`, c.kind === null && c.host.width >= c.vw - 1, `panel ${c.kind}, map ${Math.round(c.host.width)} of ${c.vw}`);
    check(`${tag} — closing keeps the pin where it was`, c.pin && Math.hypot(c.pin.x - before.x, c.pin.y - before.y) <= 2, `moved ${c.pin ? Math.round(Math.hypot(c.pin.x - before.x, c.pin.y - before.y)) : "?"}`);
    if (c.chipVisible && c.chip) check(`${tag} — with the card closed the chip is centred in the whole visible map`, Math.abs((c.chip.left + c.chip.right) / 2 - c.box.cx) <= 8, `chip ${Math.round((c.chip.left + c.chip.right) / 2)} vs ${Math.round(c.box.cx)}`);
    check(`${tag} — closing: help button is back at the corner`, !c.help || c.help.right >= c.vw - c.ins.right - 40, c.help ? `help right ${Math.round(c.help.right)} of ${c.vw}` : "hidden");
    // 5. keyboard up while sideways — search box, then a field in the card
    await searchBox(page).tap(); await page.waitForTimeout(700);
    let k = await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const b = window.__kb.band(); const t = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2); return { open: window.__kb.open, top: r.top, bottom: r.bottom, band: b, on: t === a || a.contains(t) }; });
    check(`${tag} — keyboard up, typing in search: the field stays visible`, k.open && k.top >= k.band.top - 1 && k.bottom <= k.band.bottom + 1 && k.on, `field ${Math.round(k.top)}–${Math.round(k.bottom)} vs visible ${k.band.top}–${Math.round(k.band.bottom)}`);
    await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(500);
    await pick(page, "aburi", /aburi/i);
    await page.locator('[data-testid="food-actions-row"] button').first().tap(); await page.waitForTimeout(700);
    const field = page.locator('[data-testid="food-visit-panel"] input[type="text"], [data-testid="food-visit-panel"] textarea, [data-testid="food-bottom-sheet"] input[type="text"], [data-testid="food-bottom-sheet"] textarea').first();
    await field.tap(); await page.waitForTimeout(1500);
    k = await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const b = window.__kb.band(); const panel = document.querySelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]').getBoundingClientRect(); const t = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2); return { open: window.__kb.open, top: r.top, bottom: r.bottom, band: b, on: t === a || a.contains(t), panelBottom: panel.bottom, label: a.getAttribute("aria-label") || a.name || a.tagName }; });
    await shot(page, `${slug}-4-keyboard-card-field`);
    check(`${tag} — keyboard up, typing in the card: the field stays visible and uncovered`, k.open && k.top >= k.band.top - 1 && k.bottom <= k.band.bottom + 1 && k.on, `field "${k.label}" ${Math.round(k.top)}–${Math.round(k.bottom)} vs visible ${k.band.top}–${Math.round(k.band.bottom)}; on top ${k.on}`);
    check(`${tag} — keyboard up: the card sits flush on the keyboard (no map between)`, Math.abs(k.panelBottom - k.band.bottom) <= 2 || k.panelBottom >= k.band.bottom, `card bottom ${Math.round(k.panelBottom)} vs keyboard top ${Math.round(k.band.bottom)}`);
    check(`${tag} — no uncaught page errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally { await ctx.close(); }
}

async function rotationFlow({ browser, phoneName }) {
  const ph = PHONES[phoneName];
  const tag = `[webkit · ${phoneName} rotate]`;
  const slug = `webkit-${phoneName.replace(/\s+/g, "")}-rotate`;
  const { ctx, page } = await openFood(browser, devices[ph.portrait], { base: BASE, harness: `verify-food-landscape:${tag}`, kbPortrait: ph.kbPortrait, kbLandscape: ph.kbLandscape });
  await assertMeasurable(page, "verify-food-landscape"); // rotation-flow — FOREGROUND-OR-VOID: visible tab + live rAF before anything is scored
  try {
    await pick(page, "aburi", /aburi/i);
    let p = await probe(page, ABURI);
    await shot(page, `${slug}-1-portrait`);
    check(`${tag} — UPRIGHT unchanged: bottom sheet, two-row header`, p.kind === "sheet" && !p.headerHasInlineToolbar && p.header.height > 60, `panel ${p.kind}, header ${Math.round(p.header.height)} tall`);
    const title = p.title;
    const L = devices[ph.landscape].viewport;
    await page.setViewportSize(L); await page.waitForTimeout(2200);
    p = await probe(page, ABURI);
    await shot(page, `${slug}-2-rotated-sideways`);
    check(`${tag} — rotating sideways keeps the same restaurant open`, p.title === title && p.title, `"${p.title}" vs "${title}"`);
    scorePicked(`${tag} → sideways`, p, ABURI, { landscape: true });
    check(`${tag} — rotating sideways: card is now the side panel`, p.kind === "side", p.kind);
    await page.setViewportSize(devices[ph.portrait].viewport); await page.waitForTimeout(2200);
    p = await probe(page, ABURI);
    await shot(page, `${slug}-3-rotated-back`);
    check(`${tag} — rotating back keeps the same restaurant open`, p.title === title && p.title, `"${p.title}" vs "${title}"`);
    check(`${tag} — rotating back: sheet again, pin in view above it`, p.kind === "sheet" && p.pin && p.pin.y < p.panel.top - 8 && p.pin.x > 0 && p.pin.x < p.vw && p.covered.length === 0, `panel ${p.kind}, pin ${p.pin && Math.round(p.pin.x)},${p.pin && Math.round(p.pin.y)} vs sheet top ${p.panel && Math.round(p.panel.top)}; covered ${p.covered.slice(0, 2).join(" ")}`);
  } finally { await ctx.close(); }
}

async function portraitFlow({ browser, phoneName }) {
  const ph = PHONES[phoneName];
  const tag = `[webkit · ${phoneName} portrait]`;
  const { ctx, page } = await openFood(browser, devices[ph.portrait], { base: BASE, harness: `verify-food-landscape:${tag}`, kbPortrait: ph.kbPortrait, kbLandscape: ph.kbLandscape });
  await assertMeasurable(page, "verify-food-landscape"); // portrait-flow — FOREGROUND-OR-VOID: visible tab + live rAF before anything is scored
  try {
    await pick(page, "aburi", /aburi/i);
    const p = await probe(page, ABURI);
    await shot(page, `webkit-${phoneName.replace(/\s+/g, "")}-portrait-picked`);
    check(`${tag} — upright: bottom sheet and the two-row header, as before`, p.kind === "sheet" && !p.headerHasInlineToolbar, `panel ${p.kind}, inline toolbar ${p.headerHasInlineToolbar}`);
    check(`${tag} — upright: pin drawn selected and not under the sheet`, p.selectedPin === ABURI.key && p.pin && p.pin.y < p.panel.top - 6 && p.covered.length === 0, `pin ${p.pin && Math.round(p.pin.y)} vs sheet top ${p.panel && Math.round(p.panel.top)}; ${p.covered.slice(0, 2).join(" ")}`);
  } finally { await ctx.close(); }
}

async function desktopFlow({ browser }) {
  const tag = "[chromium · desktop 1280×800]";
  const { ctx, page } = await openFood(browser, { viewport: { width: 1280, height: 800 } }, { base: BASE, harness: `verify-food-landscape:${tag}` });
  await assertMeasurable(page, "verify-food-landscape"); // desktop-flow — FOREGROUND-OR-VOID: visible tab + live rAF before anything is scored
  try {
    await searchBox(page).click(); await page.keyboard.type("aburi", { delay: 15 }); await page.waitForTimeout(800);
    await page.locator('[data-testid="food-search-results"] button').filter({ hasText: /aburi/i }).first().click(); await page.waitForTimeout(2200);
    const p = await probe(page, ABURI);
    check(`${tag} — desktop unchanged: the right rail (340 wide), two-row header`, p.kind === "rail" && Math.round(p.panel.width) === 340 && !p.headerHasInlineToolbar && p.header.height > 60, `panel ${p.kind} ${p.panel && Math.round(p.panel.width)}, header ${Math.round(p.header.height)}`);
    check(`${tag} — desktop: pin centred left of the rail and uncovered`, p.pin && p.covered.length === 0 && Math.abs(p.pin.x - p.box.cx) <= Math.max(14, p.box.w * 0.12), `pin ${p.pin && Math.round(p.pin.x)} vs ${Math.round(p.box.cx)}`);
  } finally { await ctx.close(); }
}

// ── SIGNED OUT, sideways: the logged-out banner row must not cost the map its room ────────────────────
async function signedOutFlow({ browser, phoneName }) {
  const ph = PHONES[phoneName];
  const tag = `[webkit · ${phoneName} landscape · signed out]`;
  const { ctx, page } = await openFood(browser, devices[ph.landscape], { base: BASE, harness: `verify-food-landscape:${tag}`, kbLandscape: ph.kbLandscape, signedOut: true });
  await assertMeasurable(page, "verify-food-landscape"); // signed-out-flow — FOREGROUND-OR-VOID: visible tab + live rAF before anything is scored
  try {
    // PRECONDITION with a known answer: the account control must read "Sign in" (the fixture's signed-in one reads the account's initial).
    const accountLabel = await page.evaluate(() => (document.querySelector("header")?.innerText || "").replace(/\s+/g, " ").trim());
    check(`${tag} — PRECONDITION: this really is the signed-out app (account control says "Sign in")`, /sign in/i.test(accountLabel), `header text: "${accountLabel.slice(0, 60)}"`);
    const signedOutBanner = await page.evaluate(() => /Sign in to log visits/.test(document.body.innerText));
    await pick(page, "aburi", /aburi/i);
    const p = await probe(page, ABURI);
    await shot(page, `webkit-${phoneName.replace(/\s+/g, "")}-landscape-signedout-picked`);
    const cardSaysSignIn = await page.evaluate(() => /Sign in to log a visit here/.test(document.querySelector('[data-testid="food-visit-panel"], [data-testid="food-bottom-sheet"]')?.innerText || ""));
    check(`${tag} — signed out: the card itself says "Sign in to log a visit here"`, cardSaysSignIn, "");
    check(`${tag} — signed out: no extra banner row above the map`, !signedOutBanner, `banner present: ${signedOutBanner}`);
    scorePicked(tag, p, ABURI, { landscape: true });
    scoreHeader(tag, p);
  } finally { await ctx.close(); }
}

// ── LIVE (planyr.io, logged out): the real deployed bundle, real data, no fixture ─────────────────────
async function liveBody(page, tag, orient, url, slug) {
  await page.goto(`${url}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 30000 });
  await assertMeasurable(page, "verify-food-landscape"); // live — FOREGROUND-OR-VOID: visible tab + live rAF before anything is scored
  await page.waitForTimeout(2500);
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => "?"));
  console.log(`${tag} build ${build}`);
  await searchBox(page).tap(); await page.keyboard.type("taco", { delay: 20 }); await page.waitForTimeout(2500);
  await page.locator('[data-testid="food-search-results"] button').first().tap();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForSelector('[data-testid="food-bottom-sheet"], [data-testid="food-visit-panel"]');
  await page.waitForTimeout(3500);
  const p = await probe(page, null);
  await shot(page, slug);
  check(`${tag} — a real restaurant is selected and its pin located`, !!p.pin && !!p.selectedPin, String(p.selectedPin));
  if (p.pin) scorePicked(tag, p, { key: p.selectedPin }, { landscape: orient === "landscape" });
  if (orient === "landscape") { scoreHeader(tag, p); check(`${tag} — card docks to the RIGHT`, p.kind === "side", String(p.kind)); }
  else check(`${tag} — upright: bottom sheet as before`, p.kind === "sheet", String(p.kind));
  if (orient !== "landscape" || !p.pin) return;
  // V1527936 steps 2–4 on the REAL deploy: card scroll (only scored if it really overflows), close, rotate and back.
  if (p.side && p.side.scrollHeight > p.side.clientHeight + 4) {
    await page.evaluate(() => { document.querySelector('[data-testid="food-side-scroll"]').scrollTop = 400; }); await page.waitForTimeout(400);
    const q = await probe(page, null);
    check(`${tag} — the card scrolls on its own; page and map stay put`, q.side.scrollTop > 0 && q.pageScroll === 0 && Math.hypot(q.pin.x - p.pin.x, q.pin.y - p.pin.y) < 1, `scrollTop ${q.side.scrollTop}, page ${q.pageScroll}`);
    if (q.actions) check(`${tag} — 'Log a visit' still on the card's bottom edge while scrolled`, Math.abs(q.actions.bottom - q.side.scroll.bottom) <= 3, `bar ${Math.round(q.actions.bottom)} vs ${Math.round(q.side.scroll.bottom)}`);
    await page.evaluate(() => { document.querySelector('[data-testid="food-side-scroll"]').scrollTop = 0; });
  } else console.log(`${tag} — card does not overflow for this restaurant: scroll rows not scored (covered on the fixture)`);
  const title = p.title, vp = page.viewportSize();
  await page.setViewportSize({ width: vp.height, height: vp.width }); await page.waitForTimeout(2500);
  let r = await probe(page, null);
  await shot(page, slug + "-rotated-upright");
  check(`${tag} — rotating upright keeps the same restaurant open, sheet again, pin in view above it`, r.title === title && r.kind === "sheet" && r.pin && r.pin.y < r.panel.top - 8 && r.covered.length === 0, `"${r.title}" vs "${title}", ${r.kind}, covered ${r.covered.slice(0, 2).join(" ")}`);
  await page.setViewportSize(vp); await page.waitForTimeout(2500);
  r = await probe(page, null);
  check(`${tag} — rotating back sideways keeps it open, side card, pin uncovered inside the visible map`, r.title === title && r.kind === "side" && r.pin && r.covered.length === 0 && r.pin.x > r.box.left && r.pin.x < r.box.right && r.pin.y > r.box.top && r.pin.y < r.box.bottom, `"${r.title}", ${r.kind}, covered ${r.covered.slice(0, 2).join(" ")}`);
  const before = r.pin;
  // the selected-pin readout clears with the selection, so keep the pin's own coordinates to find it after closing
  const at = await page.evaluate(() => { const h = document.querySelector('[data-testid="food-map"]').dataset; return { lat: +h.selectedLat, lon: +h.selectedLon }; });
  await page.locator('[data-testid="food-panel-close"]').tap(); await page.waitForTimeout(900);
  const c = await probe(page, at);
  check(`${tag} — closing gives the map the full width and the pin stays put`, c.kind === null && c.host.width >= c.vw - 1 && Math.hypot((c.pin?.x ?? 1e9) - before.x, (c.pin?.y ?? 1e9) - before.y) <= 2, `panel ${c.kind}, map ${Math.round(c.host.width)} of ${c.vw}, pin moved ${c.pin ? Math.round(Math.hypot(c.pin.x - before.x, c.pin.y - before.y)) : "?"}`);
}
async function liveFlow({ browser, phoneName, orient, url }) {
  const ph = PHONES[phoneName];
  const tag = `[LIVE webkit · ${phoneName} ${orient}]`;
  const ctx = await browser.newContext({ ...devices[ph[orient]], ignoreHTTPSErrors: false });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => { window.__PLANYR_E2E = true; }); // read-only camera handle (window.__foodMap), as the fixture runs do
  try { await liveBody(page, tag, orient, url, `LIVE-${phoneName.replace(/\s+/g, "")}-${orient}-picked`); } finally { await ctx.close(); }
}
// SIGNED IN as the test account on the real deploy (Chromium — the shared helper's engine; emulated phone, labelled so).
async function signedInFlow({ phoneName, orient, url }) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const ph = PHONES[phoneName];
  const tag = `[LIVE SIGNED-IN chromium-emulated · ${phoneName} ${orient}]`;
  const s = await openSignedIn({ base: url, viewport: devices[ph[orient]].viewport, contextOptions: { ...devices[ph[orient]] } });
  try {
    check(`${tag} — PRECONDITION: signed in as the test account (account email + fixture site, RLS-only)`, s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));
    s.page.setDefaultTimeout(8000);
    await s.page.addInitScript(() => { window.__PLANYR_E2E = true; });
    await liveBody(s.page, tag, orient, url, `LIVE-SIGNEDIN-${phoneName.replace(/\s+/g, "")}-${orient}-picked`);
  } finally { await s.close(); }
}

// ── KNOWN-ANSWER ARM: the covered-pin detector must see a pin we cover ───────────────────────────────
async function knownAnswer({ browser }) {
  const ph = PHONES["iPhone 15"];
  const { ctx, page } = await openFood(browser, devices[ph.landscape], { base: BASE, harness: "verify-food-landscape:known-answer", kbLandscape: ph.kbLandscape });
  await assertMeasurable(page, "verify-food-landscape"); // known-answer — FOREGROUND-OR-VOID: visible tab + live rAF before anything is scored
  try {
    await pick(page, "aburi", /aburi/i);
    const before = await probe(page, ABURI);
    await page.evaluate((pin) => { const d = document.createElement("div"); d.id = "__cover"; d.style.cssText = `position:fixed;left:${pin.x - 30}px;top:${pin.y - 30}px;width:60px;height:60px;background:red;z-index:2147483000`; document.body.appendChild(d); }, before.pin);
    const covered = await probe(page, ABURI);
    check("0a KNOWN ANSWER: a pin with something painted over it reads as COVERED", covered.covered.length > 0, `covered points: ${covered.covered.length}`);
    check("0b KNOWN ANSWER: the same pin without the plant reads as uncovered or covered by the real UI (control for 0a)", before.covered.length === 0 || before.kind !== "side", `before covered: ${before.covered.length}, panel ${before.kind}`);
  } finally { await ctx.close(); }
}

async function launchChromium() {
  if (process.env.PW_CHROMIUM) return chromium.launch({ executablePath: process.env.PW_CHROMIUM });
  try { return await chromium.launch(); } catch (_) {
    // Playwright pins one Chromium revision; this container ships another. Use the newest installed one (never `playwright install`).
    const { readdirSync, existsSync } = await import("node:fs");
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split("-")[1] - +a.split("-")[1]);
    for (const d of dirs) for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) if (existsSync(`${root}/${d}/${sub}`)) return chromium.launch({ executablePath: `${root}/${d}/${sub}` });
    throw new Error("no Chromium found under " + root);
  }
}
const LIVE = (process.argv.find((a) => a.startsWith("--live=")) || "").slice(7);
const SIGNED_IN = (process.argv.find((a) => a.startsWith("--signed-in=")) || "").slice(12);
if (SIGNED_IN) {
  for (const phoneName of Object.keys(PHONES)) for (const orient of ["landscape", "portrait"]) await signedInFlow({ phoneName, orient, url: SIGNED_IN.replace(/\/$/, "") }).catch((e) => check(`[LIVE SIGNED-IN ${phoneName} ${orient}] aborted`, false, e.message.split("\n")[0]));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (LIVE, signed in as the test account)`);
  process.exit(failed.length ? 1 : 0);
}
const wk = await webkit.launch();
let cr = null;
if (LIVE) {
  try {
    for (const phoneName of Object.keys(PHONES)) for (const orient of ["landscape", "portrait"]) await liveFlow({ browser: wk, phoneName, orient, url: LIVE.replace(/\/$/, "") }).catch((e) => check(`[LIVE ${phoneName} ${orient}] aborted`, false, e.message.split("\n")[0]));
  } finally { await wk.close(); }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (LIVE, logged out)`);
  process.exit(failed.length ? 1 : 0);
}
try {
  if (wants("known")) await knownAnswer({ browser: wk }).catch((e) => check("0: known-answer arm aborted", false, e.message.split("\n")[0]));
  for (const phoneName of Object.keys(PHONES)) {
    if (wants(`webkit.*${phoneName}.*landscape`)) await landscapeFlow({ engine: "webkit", browser: wk, phoneName }).catch((e) => check(`[webkit · ${phoneName} landscape] aborted`, false, e.message.split("\n")[0]));
    if (wants(`signedout.*${phoneName}|signed out.*${phoneName}`)) await signedOutFlow({ browser: wk, phoneName }).catch((e) => check(`[webkit · ${phoneName} signed out] aborted`, false, e.message.split("\n")[0]));
    if (wants(`rotate.*${phoneName}`)) await rotationFlow({ browser: wk, phoneName }).catch((e) => check(`[webkit · ${phoneName} rotate] aborted`, false, e.message.split("\n")[0]));
    if (wants(`portrait.*${phoneName}`)) await portraitFlow({ browser: wk, phoneName }).catch((e) => check(`[webkit · ${phoneName} portrait] aborted`, false, e.message.split("\n")[0]));
  }
  // This container's Chromium is a different revision than Playwright pins (docs say: use executablePath, never `playwright install`).
  cr = await launchChromium();
  for (const phoneName of Object.keys(PHONES)) {
    for (const [label, insets] of Object.entries(rotationsFor(phoneName))) {
      if (!wants(`chromium.*${phoneName}.*${label}`)) continue;
      await landscapeFlow({ engine: "chromium", browser: cr, phoneName, label, insets }).catch((e) => check(`[chromium · ${phoneName} ${label}] aborted`, false, e.message.split("\n")[0]));
    }
  }
  if (wants("desktop")) await desktopFlow({ browser: cr }).catch((e) => check("[desktop] aborted", false, e.message.split("\n")[0]));
} finally { await wk.close(); await cr?.close(); }

const arms = results.filter((r) => /KNOWN ANSWER|PRECONDITION|^0/.test(r.id));
const void_ = arms.some((r) => !r.ok);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${void_ ? " — RUN VOID: a known-answer arm or precondition failed, the verdicts above are not evidence" : ""}`);
process.exit(failed.length || void_ ? 1 : 0);
