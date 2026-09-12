/* verify-header-touch-targets.mjs — live-browser proof for the phone-header block
 * (B1343200 NEW-1 touch targets, B1343201 NEW-2 scroll affordance, B1343202 NEW-3 active-tab
 * visibility, B1343203 NEW-4 breadcrumb middle-truncation).
 *
 * Logged out, no network, no GIS — the real AppHeader + ProjectBreadcrumb (+ a plan-crumb
 * stand-in matching the Site Planner's own crumb geometry) in the dev server's own harness page
 * (header-touch-targets-harness.jsx). Per ATTEMPT-BEFORE-YOU-PARK this whole block is exactly the
 * class of check this repo runs itself rather than filing as "needs a live pass": a logged-out,
 * no-external-GIS UI check.
 *
 * Run:  npm run dev -- --port 5199 --strictPort      (separate shell)
 *       node ui-audit/verify-header-touch-targets.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const HARNESS = `${BASE}/ui-audit/header-touch-targets-harness.html`;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const MIN_TAP = 44;

const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass, d }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]
    .find((p) => existsSync(p));

// ── the adjacent-case matrix the item's brief asks for ──────────────────────────────────────
const VIEWPORTS = [
  { name: "phone-narrowest",   w: 320, h: 568 },   // the narrowest phone width this repo supports
  { name: "phone-portrait",    w: 390, h: 844 },   // iPhone 12/13/14-class — the owner's own report
  { name: "phone-portrait-lg", w: 430, h: 932 },   // iPhone Pro Max-class
  { name: "phone-landscape",   w: 844, h: 390 },
  { name: "tablet-portrait",   w: 768, h: 1024 },  // above the narrow breakpoint (760) — behaves as desktop
  { name: "desktop-short",     w: 1024, h: 480 },  // non-narrow width, short window height
];

async function tapArea(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el, "::after");
    const w = parseFloat(cs.width), h = parseFloat(cs.height);
    return {
      visible: { w: box.width, h: box.height },
      tap: (Number.isFinite(w) && Number.isFinite(h)) ? { w, h } : null,
    };
  }, selector);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  await assertMeasurable(page, "verify-header-touch-targets");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const load = async (qs, viewport) => {
    if (viewport) await page.setViewportSize({ width: viewport.w, height: viewport.h });
    await page.goto(`${HARNESS}${qs}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });
    await page.waitForTimeout(120); // let the layout-effect measurement passes settle
  };

  const CONTROL_SELECTORS = {
    wordmark: 'header [data-menu-scope="app-header"] button',           // first button in the header = wordmark
    dashboard: '[data-testid="project-crumb"]',                          // (overwritten below with the real testids)
  };

  // ── NEW-1: every interactive element in both strips clears the 44x44 floor, at every width ──
  console.log("\n=== NEW-1 — touch target floor (44x44) ===");
  const NEW1_TARGETS = [
    ['header button[title]:first-of-type', "wordmark"],
    ['[data-testid="project-crumb"]', "project crumb"],
    ['[data-testid="plan-crumb"]', "plan crumb"],
    ['[data-testid="toggle-fullscreen"]', "fullscreen button"],
    ['[data-testid="cloud-sync-badge"]', "cloud sync badge"],
    ['[data-testid="module-tab-site-planner"]', "module tab (Site)"],
    ['[data-testid="module-tab-model"]', "module tab (Model, last)"],
  ];
  const adjacentTable = [];
  for (const vp of VIEWPORTS) {
    await load("?project=long&plan=long&module=site-planner", vp);
    for (const [sel, label] of NEW1_TARGETS) {
      const m = await tapArea(page, sel);
      if (!m) { ok(`${vp.name}: ${label} present`, false, "not found"); continue; }
      const pass = !!m.tap && m.tap.w >= MIN_TAP - 0.5 && m.tap.h >= MIN_TAP - 0.5;
      ok(`${vp.name} (${vp.w}x${vp.h}): ${label} tap area >= ${MIN_TAP}x${MIN_TAP}`, pass,
        m.tap ? `${m.tap.w.toFixed(1)}x${m.tap.h.toFixed(1)} (visible ${m.visible.w.toFixed(1)}x${m.visible.h.toFixed(1)})` : "no ::after");
      adjacentTable.push({ viewport: `${vp.name} ${vp.w}x${vp.h}`, control: label, tap: m.tap ? `${m.tap.w.toFixed(0)}x${m.tap.h.toFixed(0)}` : "n/a" });
    }
  }

  // ── NEW-2: chevron only on an overflowing side, and a tap actually pages the strip ──────────
  console.log("\n=== NEW-2 — scroll affordance (fade + tappable chevron) ===");
  // ⛔ the chevron is rendered as a DIRECT CHILD of its own row (a sibling of the row's
  // left/center/right zones), never of `<header>` — querying `row.parentElement` instead of `row`
  // itself would match EITHER row's chevron (both are header descendants), misattributing Row 2's
  // genuine six-tab overflow to a Row 1 that already fits. Scope to the row's own subtree.
  const edgesAndChevrons = async (rowSel) => page.evaluate((sel) => {
    const row = document.querySelector(sel);
    if (!row) return null;
    const over = row.scrollWidth - row.clientWidth;
    return {
      left: row.scrollLeft > 1, right: row.scrollLeft < over - 1, overflow: over > 1,
      leftChevron: !!row.querySelector('[aria-label="Scroll left"]'),
      rightChevron: !!row.querySelector('[aria-label="Scroll right"]'),
      scrollLeft: row.scrollLeft,
    };
  }, rowSel);

  // Row 1 (breadcrumb) at a phone width with a long project+plan — genuinely overflows.
  await load("?project=long&plan=long&module=site-planner", { w: 375, h: 667 });
  let row1 = "header > div:first-of-type";
  let e = await edgesAndChevrons(row1);
  ok("an overflowing Row 1 shows a RIGHT chevron and no left one at rest (scrollLeft=0)", e.overflow && e.rightChevron && !e.leftChevron, JSON.stringify(e));
  // Tap it — it should page the row and, once scrolled some, a left chevron should appear too.
  await page.click('header [aria-label="Scroll right"]');
  await page.waitForTimeout(400); // smooth scroll
  let e2 = await edgesAndChevrons(row1);
  ok("tapping the right chevron actually advances scrollLeft", e2.scrollLeft > e.scrollLeft, `before ${e.scrollLeft} → after ${e2.scrollLeft}`);
  ok("once scrolled off the left edge, a LEFT chevron also appears (both-sides overflow)", e2.left ? e2.leftChevron : true, JSON.stringify(e2));

  // A strip that already fits (short project, no plan, wide-ish phone) shows NEITHER chevron.
  await load("?project=short&plan=none&module=site-planner", { w: 430, h: 932 });
  let eFit = await edgesAndChevrons(row1);
  ok("a Row 1 that already fits shows NO chevron on either side (no permanent furniture)", !eFit.leftChevron && !eFit.rightChevron, JSON.stringify(eFit));

  // Row 2 (module tabs) — six tabs at the narrowest phone width should overflow and show its own
  // chevron, exactly like Row 1 above (the same mechanism, proven on the other row).
  await load("?project=short&plan=none&module=site-planner", { w: 320, h: 568 });
  const row2Sel = () => page.evaluate(() => {
    const tabs = document.querySelectorAll('[data-testid^="module-tab-"]');
    let row = tabs[0]?.parentElement;
    while (row && getComputedStyle(row).overflowX !== "auto") row = row.parentElement;
    return row ? row.dataset.probeRow2 || (row.dataset.probeRow2 = "1") : null;
  }).then(() => '[data-probe-row2="1"]');
  const eRow2 = await edgesAndChevrons(await row2Sel());
  ok("Row 2's six tabs overflow at the narrowest phone width and show a chevron", eRow2 && eRow2.overflow && eRow2.rightChevron, JSON.stringify(eRow2));

  // ── NEW-3: the active tab is kept on-screen, on load AND after a later switch ───────────────
  console.log("\n=== NEW-3 — active tab visibility ===");
  await load("?project=short&plan=none&module=model", { w: 375, h: 667 }); // "model" is the LAST tab
  const activeVisible = async () => page.evaluate(() => {
    const active = document.querySelector('[aria-current="page"][data-testid^="module-tab-"]');
    if (!active) return null;
    let row = active.parentElement;
    while (row && getComputedStyle(row).overflowX !== "auto") row = row.parentElement;
    if (!row) return null;
    const a = active.getBoundingClientRect(), r = row.getBoundingClientRect();
    return { insideLeft: a.left >= r.left - 0.5, insideRight: a.right <= r.right + 0.5 };
  });
  let av = await activeVisible();
  ok("the LAST tab, active on first load, is scrolled into view with no interaction", av && av.insideLeft && av.insideRight, JSON.stringify(av));

  // Switch to the FIRST tab (scrolls back left), then back to a MIDDLE one — "leave and return".
  await page.click('[data-testid="switch-site-planner"]');
  await page.waitForTimeout(80);
  av = await activeVisible();
  ok("switching to the FIRST tab keeps it visible", av && av.insideLeft && av.insideRight, JSON.stringify(av));
  await page.click('[data-testid="switch-doc-review"]'); // a MIDDLE tab
  await page.waitForTimeout(80);
  av = await activeVisible();
  ok("switching to a MIDDLE tab keeps it visible (leave-and-return case)", av && av.insideLeft && av.insideRight, JSON.stringify(av));

  // ── NEW-4: the breadcrumb collapses its MIDDLE crumb, never the first or last ────────────────
  console.log("\n=== NEW-4 — breadcrumb middle-truncation ===");
  const crumbState = async () => page.evaluate(() => {
    const dash = document.querySelector('[data-testid="dashboard-crumb"]');
    const proj = document.querySelector('[data-testid="project-crumb"]');
    const plan = document.querySelector('[data-testid="plan-crumb"]');
    const box = (el) => el ? el.getBoundingClientRect() : null;
    const row = proj ? (() => { let r = proj.parentElement; while (r && getComputedStyle(r).overflowX !== "auto" && r.parentElement) r = r.parentElement; return r; })() : null;
    const rowBox = row ? row.getBoundingClientRect() : null;
    return {
      compact: proj ? proj.getAttribute("data-crumb-compact") === "1" : null,
      dash: box(dash), proj: box(proj), plan: box(plan), row: rowBox,
    };
  });

  // A width tight enough that Dashboard + a long project + a long plan cannot all fit — the
  // owner's OWN reported strings verbatim (Goose Creek / Phase II - Revision), his own phone width.
  await load("?project=long&plan=long&module=site-planner", { w: 375, h: 667 });
  let cs = await crumbState();
  const fitsWithoutScroll = (b, row) => !!b && !!row && b.left >= row.left - 0.5 && b.right <= row.right + 0.5;
  ok("NEW-4 reported case: the project crumb compacted", cs.compact === true, JSON.stringify(cs.proj));
  ok("NEW-4 reported case: Dashboard (first) still fits without scrolling", fitsWithoutScroll(cs.dash, cs.row), JSON.stringify({ dash: cs.dash, row: cs.row }));
  ok("NEW-4 reported case: the plan crumb (last, the plan he's actually on) fits without scrolling", fitsWithoutScroll(cs.plan, cs.row), JSON.stringify({ plan: cs.plan, row: cs.row }));

  // A DELIBERATELY longer pair than anything reported — the genuine floor where compacting the
  // middle crumb plus the plan crumb's own existing ellipsis cap still cannot both fit. The brief
  // says scrolling STAYS AVAILABLE, not that nothing ever needs it — so here the bar is narrower:
  // the row must still say (via NEW-2's chevron) that there's more, never silently clip mid-word.
  await load("?project=stress&plan=stress&module=site-planner", { w: 375, h: 667 });
  cs = await crumbState();
  const stressEdges = await edgesAndChevrons(row1);
  ok("NEW-4 stress case: the project crumb still compacted (did everything reasonable)", cs.compact === true, JSON.stringify(cs.proj));
  ok("NEW-4 stress case: if it still doesn't fit, the row says so (right chevron) rather than silently clipping", stressEdges.overflow ? stressEdges.rightChevron : true, JSON.stringify(stressEdges));

  // The same long names on a WIDE viewport (landscape phone / tablet) — plenty of room, so the
  // project crumb must NOT compact. "It can't always be centered but when it can it should" —
  // this is that rule's sibling for compaction: never collapse a crumb that already fits.
  await load("?project=long&plan=long&module=site-planner", { w: 926, h: 430 });
  cs = await crumbState();
  ok("NEW-4 roomy case (phone landscape): the project crumb stays FULL, not compacted", cs.compact === false, JSON.stringify(cs));

  // A 2-crumb workspace (no plan) never compacts the project crumb — it IS the last crumb.
  await load("?project=long&plan=none&module=notes", { w: 320, h: 568 });
  cs = await crumbState();
  ok("NEW-4: with no trailing plan crumb, the project crumb (now the LAST one) never compacts", cs.compact === false, JSON.stringify(cs));

  // A LIVE resize (no reload) — orientation change / a resized browser window — must also
  // re-decide compaction, not just a fresh mount at a given size. This is exactly the case a
  // ref-ordering bug (a child's effect reading an ancestor's ref before React attaches it,
  // fixed via a one-frame rAF retry + then observing the row directly) could silently break:
  // correct on first load, stuck thereafter.
  console.log("\n=== NEW-4 live resize (no reload) ===");
  await load("?project=long&plan=long&module=site-planner", { w: 926, h: 430 }); // roomy landscape — full, not compact
  cs = await crumbState();
  ok("live-resize: starts full at a roomy width", cs.compact === false, JSON.stringify(cs.proj));
  await page.setViewportSize({ width: 375, height: 667 }); // rotate to portrait — now tight
  await page.waitForTimeout(150);
  cs = await crumbState();
  ok("live-resize: rotating to the tight width compacts WITHOUT a reload", cs.compact === true, JSON.stringify(cs.proj));
  await page.setViewportSize({ width: 926, height: 430 }); // rotate back — full again
  await page.waitForTimeout(150);
  cs = await crumbState();
  ok("live-resize: rotating back to roomy un-compacts WITHOUT a reload", cs.compact === false, JSON.stringify(cs.proj));

  // ── Both strips at once must not disagree — same overflow verdict style, same width ─────────
  console.log("\n=== Both strips together ===");
  await load("?project=long&plan=long&module=model", { w: 375, h: 667 });
  const both = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("header > div")].filter((d) => getComputedStyle(d).overflowX === "auto");
    return rows.map((r) => ({ overflow: r.scrollWidth - r.clientWidth > 1, hasChevron: !!r.querySelector('[aria-label^="Scroll"]') }));
  });
  ok("every overflowing row (both Row 1 and Row 2 here) carries at least one chevron", both.every((r) => !r.overflow || r.hasChevron), JSON.stringify(both));

  ok("no page errors across the whole run", errors.length === 0, errors.join(" | "));

  writeFileSync(`${OUT}header-touch-targets-adjacent-cases.json`, JSON.stringify(adjacentTable, null, 2));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const f of failed) console.log(`   ❌ ${f.n} — ${f.d}`); process.exit(1); }
